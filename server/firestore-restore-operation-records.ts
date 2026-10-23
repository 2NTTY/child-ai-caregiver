import { messageSortMetadata } from './notification-message-content.ts';
import { z } from 'zod';
import { FirestoreDomainData, firestoreDomainHash, FIRESTORE_TASK_DISPATCH_SCOPE as SYSTEM } from './firestore-domain-data.ts';
import type { FirestoreRecoveryContext } from './firestore-recovery-envelope.ts';
import type { WorkRecoveryScope } from './firestore-work-continuation-recovery.ts';
import { firestoreBackgroundWorkSchema, firestoreBackgroundRecoverySchemas as background, firestoreBackgroundReference } from './firestore-background-work.ts';
import { firestoreMaintenanceRecoverySchema } from './firestore-background-maintenance.ts';
import { firestoreWorkWatchSchema, firestoreWorkEventSchema, firestoreWorkDailyRecoverySchema } from './firestore-work-followup.ts';
import { firestoreModelSettingsRecoverySchema, firestoreModelSettingsOperationRecoverySchema } from './firestore-model-settings.ts';
import { firestoreModelChecksRecoverySchema } from './firestore-model-routing.ts';
import { firestoreAgentAdmissionRecoverySchema } from './firestore-agent-admission.ts';
import { firestoreScopeErasureSchema, firestoreErasureReceiptPointerSchema } from './firestore-erasure.ts';
import { firestoreNativeBindingSchema, firestoreNativeDeliverySchema, firestoreNativePointerSchema } from './firestore-native-push.ts';
import { firestorePushBindingSchema, firestorePushDeliverySchema, firestorePushEndpointRecoverySchema } from './firestore-web-push.ts';
import { firestoreTelegramBindingSchema, firestoreTelegramDeliverySchema, firestoreTelegramChallengeSchema, firestoreTelegramRecoverySchemas as telegram } from './firestore-telegram.ts';
import { firestoreContactConsentSchema, firestoreContactGrantSchema, firestoreContactRequestSchema, firestoreContactRecoverySchemas as contact } from './firestore-contact.ts';

export const operationRestoreSchemas = {
  'background-work': { suffix: 'background_work', schema: firestoreBackgroundWorkSchema },
  'background-reference': { suffix: 'background_references', schema: background.reference },
  'maintenance-state': { suffix: 'maintenance_state', schema: firestoreMaintenanceRecoverySchema },
  'work-watch': { suffix: 'work_watches', schema: firestoreWorkWatchSchema },
  'work-event': { suffix: 'work_events', schema: firestoreWorkEventSchema },
  'work-daily-slot': { suffix: 'work_daily_slots', schema: firestoreWorkDailyRecoverySchema },
  'model-settings': { suffix: 'model_settings', schema: firestoreModelSettingsRecoverySchema },
  'model-settings-operation': { suffix: 'model_settings_operations', schema: firestoreModelSettingsOperationRecoverySchema },
  'model-key-checks': { suffix: 'model_key_checks', schema: firestoreModelChecksRecoverySchema },
  'agent-admission': { suffix: 'agent_admission', schema: firestoreAgentAdmissionRecoverySchema },
  'scope-erasure': { suffix: 'erasures', schema: firestoreScopeErasureSchema },
  'erasure-receipt-pointer': { suffix: 'erasure_receipts', schema: firestoreErasureReceiptPointerSchema },
  'native-push-binding': { suffix: 'native_push_bindings', schema: firestoreNativeBindingSchema },
  'native-push-delivery': { suffix: 'native_push_deliveries', schema: firestoreNativeDeliverySchema },
  'native-push-token': { suffix: 'native_push_tokens', schema: firestoreNativePointerSchema },
  'push-binding': { suffix: 'push_bindings', schema: firestorePushBindingSchema },
  'push-delivery': { suffix: 'push_deliveries', schema: firestorePushDeliverySchema },
  'push-endpoint': { suffix: 'push_endpoints', schema: firestorePushEndpointRecoverySchema },
  'telegram-binding': { suffix: 'telegram_bindings', schema: firestoreTelegramBindingSchema },
  'telegram-challenge': { suffix: 'telegram_challenges', schema: firestoreTelegramChallengeSchema },
  'telegram-delivery': { suffix: 'telegram_deliveries', schema: firestoreTelegramDeliverySchema },
  'telegram-state': { suffix: 'telegram_state', schema: telegram.state },
  'telegram-pointer': { suffix: 'telegram_pointers', schema: telegram.pointer },
  'telegram-meta': { suffix: 'telegram_meta', schema: telegram.meta },
  'telegram-update': { suffix: 'telegram_updates', schema: telegram.update },
  'contact-consent': { suffix: 'contact_consents', schema: firestoreContactConsentSchema },
  'contact-consent-revision': { suffix: 'contact_consent_revisions', schema: firestoreContactConsentSchema },
  'contact-grant': { suffix: 'contact_grants', schema: firestoreContactGrantSchema },
  'contact-grant-revision': { suffix: 'contact_grant_revisions', schema: firestoreContactGrantSchema },
  'contact-request': { suffix: 'contact_requests', schema: firestoreContactRequestSchema },
  'contact-callback': { suffix: 'contact_callbacks', schema: contact.pointer },
  'contact-update': { suffix: 'contact_updates', schema: contact.update },
  'contact-daily-slot': { suffix: 'contact_daily_slots', schema: contact.daily },
} as const;
export type OperationRestoreKind = keyof typeof operationRestoreSchemas;
export type OperationRestoreValue = z.infer<(typeof operationRestoreSchemas)[OperationRestoreKind]['schema']>;
export function isOperationRestoreKind(kind: string): kind is OperationRestoreKind { return Object.hasOwn(operationRestoreSchemas, kind); }
// Historical deliveries and their references retain original identity. They never become new work.
export const originalRestoreScopeKinds = new Set(['photo-cleanup', 'background-work', 'background-reference']);
export const discardedRestoreKinds = new Set(['native-push-token', 'push-endpoint', 'telegram-pointer', 'contact-callback', 'erasure-receipt-pointer']);
function check(ok: boolean) { if (!ok) throw Object.assign(new Error('Restore operation binding rejected'), { code: 'restore_binding', status: 409 }); }
function same(a: unknown, b: unknown) { return firestoreDomainHash(a) === firestoreDomainHash(b); }

/** Domain schemas and identities stay identical to the live writers. No provider call occurs in recovery. */
export function restoreOperationRecord(data: FirestoreDomainData, context: FirestoreRecoveryContext & { kind: OperationRestoreKind },
  raw: OperationRestoreValue, target?: WorkRecoveryScope) {
  const { kind, scope, recordVersion } = context;
  let id = context.id, value = raw, version = recordVersion!;
  const outputScope = originalRestoreScopeKinds.has(kind) ? scope : target ?? scope;
  const metadata: Record<string, unknown> = {};
  check(context.family === 'domain' && context.envelopeVersion === 1 && version >= 1);
  switch (kind) {
    case 'background-work': {
      const v = firestoreBackgroundWorkSchema.parse(raw), identity = background.identity.parse({ kind: v.kind, scope: v.scope,
        resourceId: v.resourceId, basis: v.basis, generation: v.generation, authorizationVersion: v.authorizationVersion });
      check(v.id === id && version === v.version && same(v.scope, scope) && id === firestoreDomainHash(['product-work', identity]));
      const next = target ? { ...v, state: v.state === 'leased' ? 'unknown' as const : v.state === 'pending' ? 'stopped' as const : v.state,
        lease: null, dispatchLease: null } : v;
      value = next; Object.assign(metadata, { id, state: next.state, dueAt: next.dueAt, dispatch: next.dispatch, leaseUntil: next.lease?.until ?? null,
        route: data.seal('background-route', id, SYSTEM, background.route, { id, scope }) }); break;
    }
    case 'background-reference': {
      const v = background.reference.parse(raw); check(id === JSON.stringify([scope.ownerUserId, scope.childId, v.reference]) && v.reference === firestoreBackgroundReference(v)); break;
    }
    case 'maintenance-state':
      if (target) value = { after: {}, complete: [], minute: -1, token: null, until: 0 }; break;
    case 'work-watch': {
      const v = firestoreWorkWatchSchema.parse(raw); check(v.workId === id);
      value = target ? { ...v, enabled: false } : v;
      Object.assign(metadata, { workId: id, enabled: target ? false : v.enabled, nextCheckAt: v.nextCheckAt }); break;
    }
    case 'work-event': {
      const v = firestoreWorkEventSchema.parse(raw); check(v.id === id && v.result.eventId === id && v.work.childId === scope.childId);
      if (target) value = { ...v, result: { ...v.result, state: v.result.state === 'queued' ? 'stopped' : v.result.state } }; break;
    }
    case 'work-daily-slot': {
      const v = firestoreWorkDailyRecoverySchema.parse(raw); check(id === JSON.stringify([scope, v.day]));
      if (target) id = JSON.stringify([target, v.day]); break;
    }
    case 'model-settings': { const v = firestoreModelSettingsRecoverySchema.parse(raw); check(id === scope.ownerUserId && version === v.version); break; }
    case 'model-settings-operation': { const v = firestoreModelSettingsOperationRecoverySchema.parse(raw);
      check(id === JSON.stringify([scope.ownerUserId, v.opId]) && version === v.settings.version); break; }
    case 'model-key-checks': check(id === 'active' && scope.ownerUserId === 'system:model-key-check'); break;
    case 'agent-admission': check(id === 'active'); if (target) value = { leases: [] }; break;
    case 'scope-erasure': {
      const v = firestoreScopeErasureSchema.parse(raw); check(id === JSON.stringify([scope.ownerUserId, v.intent.operationId]) && v.intent.scope.ownerUserId === scope.ownerUserId);
      if (target) value = { ...v, receiptToken: null, expiresAt: null };
      Object.assign(metadata, { operationId: v.intent.operationId, state: v.state }); break;
    }
    case 'erasure-receipt-pointer': { const v = firestoreErasureReceiptPointerSchema.parse(raw); check(scope.ownerUserId === 'system:erasure-receipt' && id === v.operationId); break; }
    case 'native-push-binding': {
      const v = firestoreNativeBindingSchema.parse(raw); check(id === v.binding.id && version === v.binding.version);
      const binding = target && v.binding.status === 'active' ? { ...v.binding, status: 'revoked' as const } : v.binding;
      value = target ? { ...v, token: null, tokenHash: null, binding } : v;
      Object.assign(metadata, { bindingId: id, createdAt: binding.createdAt, status: binding.status, sessionTag: v.sessionHash }); break;
    }
    case 'native-push-delivery': {
      const v = firestoreNativeDeliverySchema.parse(raw); check(id === v.delivery.id);
      const delivery = target ? { ...v.delivery, status: v.delivery.status === 'queued' ? 'stopped' as const : v.delivery.status === 'sending' ? 'unknown' as const : v.delivery.status } : v.delivery;
      value = { ...v, delivery }; Object.assign(metadata, { ...messageSortMetadata(v.message ? [v.message] : []), deliveryId: id, createdAt: delivery.createdAt, bindingId: delivery.bindingId, status: delivery.status }); break;
    }
    case 'native-push-token': { const v = firestoreNativePointerSchema.parse(raw); check(v.tokenHash === id && same(v.scope, scope)); break; }
    case 'push-binding': {
      const v = firestorePushBindingSchema.parse(raw); check(id === v.binding.id && version === v.binding.version);
      const binding = target && v.binding.status === 'active' ? { ...v.binding, status: 'revoked' as const, endpointHash: null } : v.binding;
      value = target ? { input: null, binding } : v;
      Object.assign(metadata, { bindingId: id, createdAt: binding.createdAt, status: binding.status }); break;
    }
    case 'push-delivery': {
      const v = firestorePushDeliverySchema.parse(raw); check(id === v.delivery.id);
      const delivery = target ? { ...v.delivery, status: v.delivery.status === 'queued' ? 'stopped' as const : v.delivery.status === 'sending' ? 'unknown' as const : v.delivery.status } : v.delivery;
      value = { ...v, delivery }; Object.assign(metadata, { ...messageSortMetadata(v.message ? [v.message] : []), deliveryId: id, createdAt: delivery.createdAt, bindingId: delivery.bindingId, status: delivery.status }); break;
    }
    case 'push-endpoint': { const v = firestorePushEndpointRecoverySchema.parse(raw); check(v.endpointHash === id && v.ownerUserId === scope.ownerUserId); break; }
    case 'telegram-binding': {
      const v = firestoreTelegramBindingSchema.parse(raw); check(id === v.binding.id && version === v.binding.version);
      const binding = target && v.binding.status === 'active' ? { ...v.binding, status: 'revoked' as const } : v.binding;
      value = target ? { ...v, binding, target: null, targetHash: null } : v;
      Object.assign(metadata, { bindingId: id, createdAt: binding.createdAt, status: binding.status }); break;
    }
    case 'telegram-challenge': {
      const v = firestoreTelegramChallengeSchema.parse(raw); check(v.id === id && v.version === version);
      const next = target ? { ...v, state: v.state === 'waiting' || v.state === 'seen' ? 'cancelled' as const : v.state, token: null, candidate: null } : v;
      value = next; Object.assign(metadata, { challengeId: id, createdAt: v.createdAt, state: next.state }); break;
    }
    case 'telegram-delivery': {
      const v = firestoreTelegramDeliverySchema.parse(raw); check(v.delivery.id === id);
      const delivery = target ? { ...v.delivery, status: v.delivery.status === 'queued' ? 'stopped' as const : v.delivery.status === 'sending' ? 'unknown' as const : v.delivery.status } : v.delivery;
      value = target ? { ...v, delivery, callback: null } : v;
      Object.assign(metadata, { ...messageSortMetadata(v.message ? [v.message] : []), deliveryId: id, bindingId: delivery.bindingId, createdAt: delivery.createdAt, status: delivery.status,
        unresolved: ['queued', 'sending', 'unknown'].includes(delivery.status) && !delivery.acknowledgedAt }); break;
    }
    case 'telegram-state':
      check(id === JSON.stringify([scope.ownerUserId, scope.workspaceId, scope.storageEpoch]));
      if (target) { id = JSON.stringify([target.ownerUserId, target.workspaceId, target.storageEpoch]); value = { bindingId: null, challengeId: null }; } break;
    case 'telegram-pointer': check(same(telegram.pointer.parse(raw).scope, scope)); break;
    case 'telegram-meta': check(id === 'lookup-key'); break;
    case 'telegram-update': break; // The encrypted provider receipt is authoritative; retain original id.
    case 'contact-consent': case 'contact-consent-revision': {
      const v = firestoreContactConsentSchema.parse(raw), key = JSON.stringify([scope.childId, scope.ownerUserId]);
      check(v.value.userId === scope.ownerUserId && version === v.value.version && id === (kind === 'contact-consent' ? key : JSON.stringify([key, version])));
      if (target && kind === 'contact-consent') value = { ...v, value: { ...v.value, enabled: false } }; break;
    }
    case 'contact-grant': case 'contact-grant-revision': {
      const v = firestoreContactGrantSchema.parse(raw); check(version === v.value.version && id === (kind === 'contact-grant' ? v.value.taskId : JSON.stringify([v.value.taskId, version])));
      if (target && kind === 'contact-grant') value = { ...v, value: { ...v.value, enabled: false } };
      if (kind === 'contact-grant') metadata.taskId = v.value.taskId; break;
    }
    case 'contact-request': {
      const v = firestoreContactRequestSchema.parse(raw); check(v.request.id === id && v.reminderId === id);
      const request = target ? { ...v.request, state: v.request.state === 'pending' ? 'stopped' as const : v.request.state,
        attempts: v.request.attempts.map(a => ({ ...a, status: a.status === 'sending' ? 'unknown' as const : a.status })) } : v.request;
      value = target ? { ...v, request, callbackHash: null } : v;
      Object.assign(metadata, { ...messageSortMetadata((v.messages ?? []).map(message => message.content)), requestId: id, runId: v.runId, taskId: request.taskId, createdAt: request.createdAt,
        attemptIds: request.attempts.map(a => a.id), unresolved: request.attempts.some(a => ['sending', 'unknown'].includes(a.status) && !a.acknowledgedAt) }); break;
    }
    case 'contact-callback': check(same(contact.pointer.parse(raw).scope, scope)); break;
    case 'contact-update': break;
    case 'contact-daily-slot': check(id === JSON.stringify([scope.ownerUserId, contact.daily.parse(raw).day])); break;
  }
  const schema = operationRestoreSchemas[kind].schema;
  return { id, scope: outputScope, value: schema.parse(value), metadata: { ...data.tags(outputScope), ...metadata }, version };
}
