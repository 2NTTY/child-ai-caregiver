import { randomUUID, createHash } from 'node:crypto';
import type { Query, DocumentSnapshot } from '@google-cloud/firestore';
import { z } from 'zod';
import { notificationMessageContentSchema } from '../src/shared/notification-messages.ts';
import { acceptedMessage, messageSortMetadata } from './notification-message-content.ts';
import { apnsPushTokenSchema, nativePushBindingSchema, nativePushRegistrationSchema, nativePushRegistrationV2Schema, nativePushReferenceSchema,
  nativeChatPresenceInputSchema, type NativeChatPresence, type NativeChatDestination } from '../src/shared/native-push.ts';
import { pushDeliverySchema, pushVersionInput, pushTestInput, type PushDelivery } from '../src/shared/web-push.ts';
import { FirestoreDomainData, domainParse, domainReject, firestoreDomainHash, firestoreDomainUuid, firestoreTaskSchema, type FirestoreDomainOptions } from './firestore-domain-data.ts';
import { createFirestoreAuthority, type FirestoreAuthorityTransaction as Binding } from './firestore-authority.ts';
import { prepareFirestoreBackgroundWork, type FirestoreBackgroundWork } from './firestore-background-work.ts';
import { workRecoveryScopeSchema } from './firestore-work-continuation-recovery.ts';
import { openRecoveryEnvelope } from './firestore-recovery-envelope.ts';
import { DeviceSessionError, type FirestoreDeviceSessions, type DeviceSessionKey } from './firestore-device-sessions.ts';
import type { FirestoreOnlineMutation } from './firestore-online.ts';
import { apnsBindingSchema, apnsInvalidationTimestampSchema, nativePushSender, type ApnsBinding, type NativePushGateway, type NativePushSendResult } from './native-push-gateway.ts';
import { firestoreChatMessageSchema } from './chat-message-schema.ts';
import { createNotificationPreferencesData } from './firestore-notification-preferences.ts';
import { reminderLocalTime } from './task-policy.ts';
import { proactiveReceiptSchema, proactiveMessageId } from './proactive-chat.ts';
import { readProactivePolicy } from './firestore-proactive-wakes.ts';
import { firestoreTaskReminderSchema } from './firestore-task-worker.ts';

const uuid = z.uuid(), NIL = '00000000-0000-0000-0000-000000000000';
const chatStateSchema = z.object({ notificationsEnabled: z.boolean(), previewEnabled: z.boolean().optional(), brandedCard: z.literal(true).optional(), presenceVersion: z.number().int().nonnegative(),
  childId: uuid.nullable(), expiresAt: z.iso.datetime().nullable() }).strict();
const chatTargetSchema = z.object({ childId: uuid, messageId: uuid }).strict();
const presenceLifetimeMs = 60_000;
const chatReasonSchema = z.enum(['foreground_chat', 'awaiting_presence', 'chat_consent_disabled', 'quiet_hours', 'message_unavailable', 'proactive_disabled', 'task_unavailable']);
export const firestoreNativeBindingSchema = z.object({ binding: nativePushBindingSchema,
  token: z.string().min(20).max(4096).nullable(), tokenHash: z.string().length(64).nullable(), sessionHash: z.string().length(64),
  apns: apnsBindingSchema.optional(), chat: chatStateSchema.optional(),
}).strict();
export const firestoreNativeDeliverySchema = z.object({ delivery: pushDeliverySchema, bindingVersion: z.number().int().positive(),
  generation: uuid, authorizationVersion: z.string(), attempt: uuid.nullable(), message: notificationMessageContentSchema.optional(),
  platform: z.literal('ios').optional(), chatTarget: chatTargetSchema.optional(), chatReason: chatReasonSchema.nullable().optional() }).strict();
export const firestoreNativePointerSchema = z.object({ scope: workRecoveryScopeSchema, bindingId: uuid, tokenHash: z.string().length(64) }).strict();
type SavedBinding = z.infer<typeof firestoreNativeBindingSchema>;
type SavedDelivery = z.infer<typeof firestoreNativeDeliverySchema>;
const routePattern = /^\/api\/native-push(?:\/(v2))?\/subscriptions(?:\/([0-9a-f-]{36})\/(revoke|test))?$/iu;
const hashToken = (token: string, apns?: ApnsBinding) => createHash('sha256')
  .update(apns ? JSON.stringify(['apns', apns.topic, apns.environment, token]) : token).digest('hex');
const platformMetadata = (apns?: ApnsBinding) => apns
  ? { platform: 'ios' as const, provider: 'apns' as const } : { platform: 'android' as const, provider: 'fcm' as const };

/** Device-session-bound registration. Product grants refer to a binding, never a token. */
export function createFirestoreNativePush(options: FirestoreDomainOptions & {
  gateway: NativePushGateway;
  sessions: Pick<FirestoreDeviceSessions, 'assertActive' | 'assertActiveIn'>;
  currentAuth(userId: string): Promise<{ disabled: boolean; emailVerified: boolean }>;
  dispatchChatWork?: (id: string) => Promise<unknown>;
}) {
  const data = new FirestoreDomainData(options), authority = createFirestoreAuthority(options);
  const preferences = createNotificationPreferencesData(data);
  const personal = (b: Binding): Binding => ({ ...b, scope: { ...b.scope, childId: NIL } });
  function own(b: Binding) {
    if (b.sharedAccess || b.actorUserId !== b.scope.ownerUserId) domainReject('private_scope_unavailable', 403);
  }
  function query(b: Pick<Binding, 'scope'>, suffix: string): Query {
    let q: Query = data.collection(suffix); for (const [key, value] of Object.entries(data.tags(b.scope))) q = q.where(key, '==', value); return q;
  }
  function decode<T>(b: Pick<Binding, 'scope'>, row: DocumentSnapshot, kind: string, id: string, schema: z.ZodType<T>): T {
    if (!row.exists || Object.entries(data.tags(b.scope)).some(([key, value]) => row.get(key) !== value)) domainReject('not_found', 404);
    return data.open(kind, id, b.scope, schema, row);
  }
  async function binding(b: Pick<Binding, 'scope' | 'transaction'>, id: string) {
    const row = await b.transaction.get(data.ref('native_push_bindings', 'native-push-binding', domainParse(uuid, id)));
    const saved = decode(b, row, 'native-push-binding', id, firestoreNativeBindingSchema);
    if (saved.binding.id !== id || saved.binding.version !== row.get('recordVersion') || saved.binding.status !== row.get('status')) domainReject('push_binding', 500);
    return saved;
  }
  const bindingEnvelope = (b: Pick<Binding, 'scope'>, saved: SavedBinding) => ({ ...data.tags(b.scope), bindingId: saved.binding.id,
    createdAt: saved.binding.createdAt, status: saved.binding.status, sessionTag: saved.sessionHash,
    ...data.seal('native-push-binding', saved.binding.id, b.scope, firestoreNativeBindingSchema, saved, saved.binding.version) });
  const deliveryEnvelope = (b: Pick<Binding, 'scope'>, saved: SavedDelivery) => ({ ...data.tags(b.scope), deliveryId: saved.delivery.id,
    bindingId: saved.delivery.bindingId, ...(saved.chatTarget ? { chatCreatedAt: saved.delivery.createdAt } : { createdAt: saved.delivery.createdAt }), status: saved.delivery.status,
    ...messageSortMetadata(saved.message ? [saved.message] : []),
    ...data.seal('native-push-delivery', saved.delivery.id, b.scope, firestoreNativeDeliverySchema, saved) });
  async function pointer(b: Pick<Binding, 'transaction'>, hash: string) {
    const ref = data.ref('native_push_tokens', 'native-push-token', hash), row = await b.transaction.get(ref);
    if (!row.exists) return null;
    // Internal uniqueness lookup only. Scope is authenticated, then path, tags and payload are checked.
    const raw = row.data()!, opened = openRecoveryEnvelope({ ...options, locator: raw.recovery,
      envelope: { family: 'domain', version: raw.version, recordVersion: raw.recordVersion, ciphertext: raw.ciphertext } });
    if (opened.context.kind !== 'native-push-token' || opened.context.id !== hash) domainReject('push_binding', 500);
    const value = decode({ scope: opened.context.scope }, row, 'native-push-token', hash, firestoreNativePointerSchema);
    if (value.tokenHash !== hash || firestoreDomainHash(value.scope) !== firestoreDomainHash(opened.context.scope)) domainReject('push_binding', 500);
    return value;
  }
  async function sessionActiveIn(b: Pick<Binding, 'transaction' | 'scope'>, saved: SavedBinding) {
    try { await options.sessions.assertActiveIn(b.transaction, { userId: b.scope.ownerUserId, sessionHash: saved.sessionHash }); return true; }
    catch (error) { if (error instanceof DeviceSessionError && error.status === 401) return false; throw error; }
  }
  async function sessionBinding(b: Binding, session: DeviceSessionKey, id?: string) {
    if (session.userId !== b.scope.ownerUserId) domainReject('native_session_required', 403);
    await options.sessions.assertActiveIn(b.transaction, session);
    if (id) {
      const saved = await binding(b, id);
      if (saved.sessionHash !== session.sessionHash || saved.binding.status !== 'active' || saved.apns) domainReject('subscription_unavailable');
      return saved;
    }
    const rows = await b.transaction.get(query(b, 'native_push_bindings').where('status', '==', 'active').limit(5));
    const row = rows.docs.find(row => row.get('sessionTag') === session.sessionHash);
    if (!row) return null;
    const saved = await binding(b, row.get('bindingId'));
    if (saved.sessionHash !== session.sessionHash) domainReject('push_binding', 500);
    return saved.apns ? null : saved;
  }
  function presenceView(saved: SavedBinding | null, withPreview: boolean): NativeChatPresence {
    return { bindingId: saved?.binding.id ?? null, presenceVersion: saved?.chat?.presenceVersion ?? 0,
      chatNotificationsEnabled: saved?.chat?.notificationsEnabled === true, expiresAt: saved?.chat?.expiresAt ?? null,
      ...(withPreview ? { chatPreviewEnabled: saved?.chat?.previewEnabled === true } : {}) };
  }
  async function readChatPresence(userId: string, session: DeviceSessionKey, withPreview = false) {
    return authority.runTransaction(userId, null, async b => presenceView(await sessionBinding(b, session), withPreview));
  }
  async function setChatPresence(userId: string, session: DeviceSessionKey, raw: unknown, withPreview = false) {
    const input = domainParse(nativeChatPresenceInputSchema, raw);
    if (!withPreview && input.chatPreviewEnabled !== undefined) domainReject('invalid_input', 400);
    return authority.runTransaction(userId, null, async b => {
      const saved = await sessionBinding(b, session, input.bindingId);
      if (!saved) domainReject('subscription_unavailable');
      if (input.expectedBindingVersion !== undefined && input.expectedBindingVersion !== saved.binding.version) domainReject('subscription_changed');
      const current = saved.chat?.presenceVersion ?? 0;
      // An old foreground heartbeat must not overwrite a newer background clear or consent change.
      if ((input.expectedPresenceVersion ?? 0) !== current) domainReject('presence_changed');
      if (current >= Number.MAX_SAFE_INTEGER - 1) domainReject('presence_changed');
      if (input.childId !== null && !await b.readChild(input.childId)) domainReject('not_found', 404);
      const notificationsEnabled = input.chatNotificationsEnabled ?? saved.chat?.notificationsEnabled ?? false;
      if (input.chatPreviewEnabled && !notificationsEnabled) domainReject('invalid_input', 400);
      const previewEnabled = notificationsEnabled && (input.chatPreviewEnabled ?? saved.chat?.previewEnabled ?? false);
      const change = notificationsEnabled !== (saved.chat?.notificationsEnabled ?? false) || previewEnabled !== (saved.chat?.previewEnabled ?? false)
        ? await b.prepareChange(randomUUID(), 'preferences', false) : null;
      saved.chat = { notificationsEnabled, ...(previewEnabled ? {previewEnabled: true} : {}),
        ...(withPreview || saved.chat?.brandedCard ? {brandedCard: true as const} : {}), presenceVersion: current + 1, childId: input.childId,
        expiresAt: input.childId === null ? null : new Date(Date.now() + presenceLifetimeMs).toISOString() };
      change?.commit();
      b.transaction.set(data.ref('native_push_bindings', 'native-push-binding', saved.binding.id), bindingEnvelope(b, saved));
      return presenceView(saved, withPreview);
    });
  }
  async function prepareChatDeliveries(b: Binding, messageId: string) {
    own(b); domainParse(uuid, messageId);
    if (b.scope.childId === NIL) domainReject('invalid_scope', 400);
    if (!await b.readChild(b.scope.childId)) domainReject('not_found', 404);
    const p = personal(b), rows = await b.transaction.get(query(p, 'native_push_bindings').where('status', '==', 'active').limit(5));
    const writes: (() => void)[] = [], ids: string[] = [], createdAt = new Date(Date.now()).toISOString();
    for (const row of rows.docs) {
      const subscribed = await binding(p, row.get('bindingId'));
      if (subscribed.apns || !subscribed.token || !subscribed.chat?.notificationsEnabled || !await sessionActiveIn(p, subscribed)) continue;
      const id = firestoreDomainUuid(['native-chat-delivery', p.scope, b.scope.childId, messageId, subscribed.binding.id]);
      const ref = data.ref('native_push_deliveries', 'native-push-delivery', id), existing = await b.transaction.get(ref);
      if (existing.exists) {
        const saved = decode(p, existing, 'native-push-delivery', id, firestoreNativeDeliverySchema);
        if (saved.delivery.id !== id || saved.delivery.bindingId !== subscribed.binding.id
          || saved.chatTarget?.childId !== b.scope.childId || saved.chatTarget.messageId !== messageId) domainReject('push_binding', 500);
        ids.push(id); continue;
      }
      const saved: SavedDelivery = { delivery: { id, bindingId: subscribed.binding.id, status: 'queued', reason: null, providerStatus: null,
        createdAt, attemptedAt: null, finishedAt: null }, bindingVersion: subscribed.binding.version, generation: b.generation,
        authorizationVersion: b.authorizationVersion, attempt: null, chatTarget: { childId: b.scope.childId, messageId } };
      const job = await prepareFirestoreBackgroundWork(data, b.transaction, { kind: 'native-push', scope: p.scope, resourceId: id,
        basis: id, generation: b.generation, authorizationVersion: b.authorizationVersion }, createdAt);
      writes.push(() => {
        b.transaction.create(ref, deliveryEnvelope(p, saved)); job.commit();
        if (options.dispatchChatWork) b.afterCommit?.(() => options.dispatchChatWork!(job.id));
      }); ids.push(id);
    }
    return { ids, commit() { for (const write of writes) write(); } };
  }
  async function readChatDeliveryStatuses(b: Binding, raw: string[]) {
    own(b); const ids = domainParse(z.array(uuid).max(5), raw), p = personal(b);
    const result: { id: string; status: PushDelivery['status']; reason: string | null }[] = [];
    for (const id of new Set(ids)) {
      const row = await b.transaction.get(data.ref('native_push_deliveries', 'native-push-delivery', id));
      if (!row.exists || Object.entries(data.tags(p.scope)).some(([key, value]) => row.get(key) !== value)) continue;
      const saved = decode(p, row, 'native-push-delivery', id, firestoreNativeDeliverySchema);
      if (saved.delivery.id !== id) domainReject('push_binding', 500);
      if (!saved.chatTarget || b.scope.childId !== NIL && saved.chatTarget.childId !== b.scope.childId) continue;
      result.push({ id, status: saved.delivery.status, reason: saved.chatReason ?? saved.delivery.reason });
    }
    return result;
  }
  async function chatMessageAvailable(b: Binding, target: z.infer<typeof chatTargetSchema>) {
    if (!await b.readChild(target.childId)) return false;
    const child = { ...b, scope: { ...b.scope, childId: target.childId } };
    const row = await b.transaction.get(data.ref('chat_messages', 'chat-message', target.messageId));
    if (!row.exists || Object.entries(data.tags(child.scope)).some(([key, value]) => row.get(key) !== value)) return false;
    const message = decode(child, row, 'chat-message', target.messageId, firestoreChatMessageSchema);
    if (message.id !== target.messageId || message.childId !== target.childId || message.role !== 'model' || message.authorUserId !== null
      || row.get('messageId') !== target.messageId || row.get('createdAt') !== message.createdAt || row.get('recordVersion') !== 1) return false;
    return message;
  }
  async function chatEligibility(b: Binding, saved: SavedDelivery, subscribed: SavedBinding): Promise<{
    reason: z.infer<typeof chatReasonSchema> | null; nextAt?: string; previewText?: string | null;
  }> {
    if (!saved.chatTarget) return { reason: null };
    if (subscribed.apns || !subscribed.chat?.notificationsEnabled) return { reason: 'chat_consent_disabled' };
    const target = saved.chatTarget;
    const message = await chatMessageAvailable(b, target);
    if (!message) return { reason: 'message_unavailable' };
    if (message.proactive) {
      const child = { ...b, scope: { ...b.scope, childId: target.childId } },
        key = JSON.stringify([b.scope.ownerUserId, target.childId, 'proactive', target.messageId]);
      const row = await b.transaction.get(data.ref('chat_replies', 'chat-reply', key));
      if (!row.exists) return { reason: 'message_unavailable' };
      const receipt = decode(child, row, 'chat-reply', key, proactiveReceiptSchema);
      if (receipt.messageId !== target.messageId || proactiveMessageId(b.scope.ownerUserId, target.childId, receipt.origin, receipt.opId) !== target.messageId)
        domainReject('push_binding', 500);
      if (receipt.origin !== 'demo' && !(await readProactivePolicy(data, child)).enabled) return { reason: 'proactive_disabled' };
      if (receipt.origin === 'task') {
        const reminderRow = await b.transaction.get(data.ref('task_reminders', 'task-reminder', receipt.opId));
        if (!reminderRow.exists) return { reason: 'task_unavailable' };
        const reminder = decode(child, reminderRow, 'task-reminder', receipt.opId, firestoreTaskReminderSchema);
        if (reminder.id !== receipt.opId || reminder.taskVersion !== reminderRow.get('recordVersion')) domainReject('push_binding', 500);
        const taskRow = await b.transaction.get(data.ref('tasks', 'task', reminder.taskId));
        if (!taskRow.exists) return { reason: 'task_unavailable' };
        const task = decode(child, taskRow, 'task', reminder.taskId, firestoreTaskSchema);
        if (task.id !== reminder.taskId || task.childId !== target.childId || task.version !== taskRow.get('recordVersion')) domainReject('push_binding', 500);
        if (task.version !== reminder.taskVersion || task.occurrence.id !== reminder.occurrenceId || task.occurrence.state !== 'scheduled'
          || task.assigneeUserId !== b.scope.ownerUserId || Date.parse(task.occurrence.dueAt) > Date.now()) return { reason: 'task_unavailable' };
      }
    }
    if (subscribed.chat.childId === target.childId && subscribed.chat.expiresAt && Date.parse(subscribed.chat.expiresAt) > Date.now()) {
      // A handset killed after its last heartbeat cannot acknowledge a newer message.
      const observedAt = Date.parse(subscribed.chat.expiresAt) - presenceLifetimeMs;
      if (observedAt < Date.parse(saved.delivery.createdAt))
        return { reason: 'awaiting_presence', nextAt: subscribed.chat.expiresAt };
      return { reason: 'foreground_chat' };
    }
    const prefs = await preferences.read(b), start = Number(prefs.quietStart.slice(0, 2)) * 60 + Number(prefs.quietStart.slice(3)),
      end = Number(prefs.quietEnd.slice(0, 2)) * 60 + Number(prefs.quietEnd.slice(3));
    const quiet = (at: number) => {
      const minutes = reminderLocalTime(new Date(at).toISOString(), prefs.timeZone).minutes;
      return start !== end && (start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end);
    };
    if (!quiet(Date.now())) return { reason: null,
      ...(subscribed.chat.brandedCard ? { previewText: subscribed.chat.previewEnabled ? message.text : null } : {}) };
    // Scan real instants so a DST change cannot cause a guessed offset or premature retry.
    const from = (Math.floor(Date.now() / 60_000) + 1) * 60_000;
    for (let minute = 0; minute < 48 * 60; minute++) {
      const at = from + minute * 60_000;
      if (!quiet(at)) return { reason: 'quiet_hours', nextAt: new Date(at).toISOString() };
    }
    return { reason: 'quiet_hours', nextAt: new Date(Date.now() + 3_600_000).toISOString() };
  }
  async function prepareRegister(b: Binding, raw: unknown, session: DeviceSessionKey, v2: boolean) {
    const input = v2 ? domainParse(nativePushRegistrationV2Schema, raw) : domainParse(nativePushRegistrationSchema, raw);
    const ios = 'platform' in input && input.platform === 'ios';
    const apns = ios ? options.gateway.apns?.binding : undefined;
    if (ios && !apns || !nativePushSender(options.gateway, apns).available) domainReject('push_unavailable');
    const token = ios ? domainParse(apnsPushTokenSchema, input.token) : input.token;
    const hash = hashToken(token, apns), tokenRef = data.ref('native_push_tokens', 'native-push-token', hash);
    const occupied = await pointer(b, hash);
    let displaced: { scope: Binding['scope']; saved: SavedBinding } | null = null;
    if (occupied && (occupied.scope.ownerUserId !== b.scope.ownerUserId || occupied.bindingId !== input.bindingId)) {
      const other = { transaction: b.transaction, scope: occupied.scope }, old = await binding(other, occupied.bindingId);
      if (old.tokenHash !== hash) domainReject('push_binding', 500);
      if (old.binding.status === 'active' && await sessionActiveIn(other, old)) {
        if (occupied.scope.ownerUserId === b.scope.ownerUserId && old.sessionHash === session.sessionHash
          && old.token === token && !input.bindingId) return { binding: old.binding, apns: old.apns, commit() {} };
        domainReject('subscription_unavailable');
      }
      displaced = { scope: occupied.scope, saved: old };
    }
    const replacesOwnBinding = displaced !== null && displaced.scope.ownerUserId === b.scope.ownerUserId
      && displaced.scope.workspaceId === b.scope.workspaceId && displaced.scope.storageEpoch === b.scope.storageEpoch;
    const at = new Date().toISOString(); let saved: SavedBinding, oldPointer: string | null = null;
    if (input.bindingId) {
      saved = await binding(b, input.bindingId);
      if (saved.sessionHash !== session.sessionHash || saved.binding.status !== 'active') domainReject('subscription_unavailable');
      if (saved.apns?.topic !== apns?.topic || saved.apns?.environment !== apns?.environment) domainReject('subscription_changed');
      if (saved.binding.version !== input.expectedVersion || saved.binding.tokenRevision !== input.expectedTokenRevision) domainReject('version_conflict');
      if (saved.tokenHash) {
        const previous = await pointer(b, saved.tokenHash);
        if (!previous || previous.bindingId !== saved.binding.id || previous.scope.ownerUserId !== b.scope.ownerUserId) domainReject('push_binding', 500);
        if (saved.tokenHash !== hash) oldPointer = saved.tokenHash;
      }
      // Rotation preserves the logical device consent, but conflicts with a stale rotation request.
      saved = { ...saved, token, tokenHash: hash, binding: { ...saved.binding, label: input.label,
        tokenRevision: saved.binding.tokenRevision + 1, updatedAt: at } };
    } else {
      const active = await b.transaction.get(query(b, 'native_push_bindings').where('status', '==', 'active').limit(replacesOwnBinding ? 6 : 5));
      const created = await b.transaction.get(query(b, 'native_push_bindings').where('createdAt', '>', new Date(Date.now() - 86400_000).toISOString()).limit(20));
      const displacedId = replacesOwnBinding ? displaced?.saved.binding.id : undefined;
      if (active.docs.filter(row => row.get('bindingId') !== displacedId).length >= 5 || created.size >= 20) domainReject('subscription_limit');
      if (active.docs.some(row => row.get('sessionTag') === session.sessionHash)) domainReject('subscription_changed');
      saved = { token, tokenHash: hash, sessionHash: session.sessionHash, ...(apns ? { apns: { ...apns } } : {}),
        binding: { id: randomUUID(), version: 1, tokenRevision: 1, status: 'active', label: input.label, createdAt: at, updatedAt: at } };
    }
    // The enclosing registration already publishes the preference change in this workspace.
    const changed = displaced && !replacesOwnBinding
      ? await authority.prepareReceiptChange(b.transaction, displaced.scope, randomUUID(), 'preferences') : null;
    return { binding: saved.binding, apns: saved.apns, commit() {
      changed?.commit();
      if (displaced) {
        const old = displaced.saved; old.token = null; old.tokenHash = null;
        old.binding = { ...old.binding, status: 'revoked', version: old.binding.version + 1, updatedAt: at };
        b.transaction.set(data.ref('native_push_bindings', 'native-push-binding', old.binding.id), bindingEnvelope(displaced, old));
      }
      if (oldPointer) b.transaction.delete(data.ref('native_push_tokens', 'native-push-token', oldPointer));
      b.transaction.set(data.ref('native_push_bindings', 'native-push-binding', saved.binding.id), bindingEnvelope(b, saved));
      b.transaction.set(tokenRef, { ...data.tags(b.scope), ...data.seal('native-push-token', hash, b.scope, firestoreNativePointerSchema,
        { scope: b.scope, bindingId: saved.binding.id, tokenHash: hash }) });
    } };
  }
  async function prepareInvalidation(b: Pick<Binding, 'scope' | 'transaction'>, id: string, version: number, status: 'expired' | 'revoked' = 'expired',
    expected?: { tokenHash: string; tokenRevision: number; apnsInvalidatedAt?: number }) {
    const saved = await binding(b, id);
    // Consent version survives token refreshes; hash alone cannot fence a same-token registration.
    // Active bindings already record their latest revision-bearing registration in updatedAt.
    const timestamp = apnsInvalidationTimestampSchema.safeParse(expected?.apnsInvalidatedAt);
    if (saved.binding.version !== version || saved.binding.status !== 'active'
      || expected && (saved.tokenHash !== expected.tokenHash || saved.binding.tokenRevision !== expected.tokenRevision)
      || status === 'expired' && (!expected || saved.apns && (!timestamp.success || timestamp.data < Date.parse(saved.binding.updatedAt))))
      return { binding: saved.binding, apns: saved.apns, commit() {} };
    const hash = saved.tokenHash, occupied = hash ? await pointer(b, hash) : null;
    saved.token = null; saved.tokenHash = null;
    saved.binding = { ...saved.binding, status, version: version + 1, updatedAt: new Date().toISOString() };
    return { binding: saved.binding, apns: saved.apns, commit() {
      b.transaction.set(data.ref('native_push_bindings', 'native-push-binding', id), bindingEnvelope(b, saved));
      if (hash && occupied?.bindingId === id && occupied.scope.ownerUserId === b.scope.ownerUserId)
        b.transaction.delete(data.ref('native_push_tokens', 'native-push-token', hash));
    } };
  }
  async function recent(b: Binding) {
    const rows = await b.transaction.get(query(b, 'native_push_deliveries').where('createdAt', '>', new Date(Date.now() - 86400_000).toISOString())
      .orderBy('createdAt', 'desc').orderBy('deliveryId', 'desc').limit(4));
    return rows.docs.map(row => decode(b, row, 'native-push-delivery', row.get('deliveryId'), firestoreNativeDeliverySchema).delivery);
  }
  async function prepareTest(b: Binding, id: string, version: number) {
    if (!(await authority.readControl(b.transaction)).enabled) domainReject('worker_paused');
    const saved = await binding(b, id);
    if (!nativePushSender(options.gateway, saved.apns).available) domainReject('push_unavailable');
    if (saved.binding.version !== version) domainReject('version_conflict');
    if (saved.binding.status !== 'active' || !saved.token || !await sessionActiveIn(b, saved)) domainReject('subscription_unavailable');
    const used = await recent(b);
    if (used.length >= 3 || used.some(item => Date.parse(item.createdAt) > Date.now() - 60_000)) domainReject('test_limit');
    const deliveryId = randomUUID(), createdAt = new Date().toISOString();
    const stored: SavedDelivery = { delivery: { id: deliveryId, bindingId: id, status: 'queued', reason: null, providerStatus: null,
      createdAt, attemptedAt: null, finishedAt: null }, bindingVersion: version, generation: b.generation,
      authorizationVersion: b.authorizationVersion, attempt: null, ...(saved.apns ? { platform: 'ios' as const } : {}) };
    const job = await prepareFirestoreBackgroundWork(data, b.transaction, { kind: 'native-push', scope: b.scope, resourceId: deliveryId,
      basis: deliveryId, generation: b.generation, authorizationVersion: b.authorizationVersion }, createdAt);
    return { delivery: stored.delivery, commit() { b.transaction.create(data.ref('native_push_deliveries', 'native-push-delivery', deliveryId), deliveryEnvelope(b, stored)); job.commit(); } };
  }
  const mutation: FirestoreOnlineMutation = {
    supports: path => routePattern.test(path),
    async prepare(b, submission, context) {
      if (b.scope.childId !== NIL) domainReject('invalid_scope', 400);
      const route = routePattern.exec(submission.path); if (!route) domainReject('not_found', 404);
      const v2 = !!route[1], id = route[2]?.toLowerCase(), action = route[3]?.toLowerCase();
      if (id && !v2 && (await binding(b, id)).apns) domainReject('not_found', 404);
      let prepared;
      if (!id) {
        const session = context?.nativeSession;
        if (!session || session.userId !== b.scope.ownerUserId) domainReject('native_session_required', 403);
        await options.sessions.assertActiveIn(b.transaction, session);
        prepared = await prepareRegister(b, submission.payload, session, v2);
      } else if (action === 'revoke') {
        const input = domainParse(pushVersionInput, submission.payload), saved = await binding(b, id);
        if (saved.binding.version !== input.expectedVersion) domainReject('version_conflict');
        prepared = await prepareInvalidation(b, id, input.expectedVersion, 'revoked');
      } else prepared = await prepareTest(b, id, domainParse(pushTestInput, submission.payload).expectedVersion);
      const change = await b.prepareChange(submission.operation.opId, 'preferences', false);
      return { childId: null, changeSeq: change.changeSeq, statusCode: !id || action === 'test' ? 201 : 200,
        result: 'binding' in prepared ? { binding: v2 ? { ...prepared.binding, ...platformMetadata(prepared.apns) } : prepared.binding }
          : { delivery: prepared.delivery }, commit() { change.commit(); prepared.commit(); } };
    },
  };
  async function status(userId: string, session: DeviceSessionKey | null = null, version: 1 | 2 = 1) {
    return authority.runTransaction(userId, null, async b => {
      const rows = await b.transaction.get(query(b, 'native_push_bindings').orderBy('createdAt', 'desc').orderBy('bindingId', 'desc').limit(20));
      const values = rows.docs.map(row => decode(b, row, 'native-push-binding', row.get('bindingId'), firestoreNativeBindingSchema))
        .filter(value => version === 2 || !value.apns);
      const messages = await b.transaction.get(query(b, 'native_push_deliveries').orderBy('createdAt', 'desc').orderBy('deliveryId', 'desc').limit(20));
      const used = await recent(b), next = Math.max(0, ...used.map(item => Date.parse(item.createdAt) + 60_000),
        used.length >= 3 ? Math.min(...used.map(item => Date.parse(item.createdAt))) + 86400_000 : 0);
      const availablePlatforms = { android: options.gateway.available, ios: options.gateway.apns?.available === true };
      return { userId, available: version === 2 ? availablePlatforms.android || availablePlatforms.ios : availablePlatforms.android,
        ...(version === 2 ? { availablePlatforms } : {}), workerEnabled: (await authority.readControl(b.transaction)).enabled,
        currentBindingId: session?.userId === userId ? values.find(v => v.sessionHash === session.sessionHash && v.binding.status === 'active')?.binding.id ?? null : null,
        bindings: values.map(v => version === 2 ? { ...v.binding, ...platformMetadata(v.apns) } : v.binding),
        deliveries: messages.docs.map(row => decode(b, row, 'native-push-delivery', row.get('deliveryId'), firestoreNativeDeliverySchema))
          .filter(value => version === 2 || value.platform !== 'ios').map(value => value.delivery),
        testsRemaining: Math.max(0, 3 - used.length), nextTestAt: next > Date.now() ? new Date(next).toISOString() : null };
    });
  }
  async function process(job: FirestoreBackgroundWork, signal: AbortSignal) {
    const { scope } = job, id = job.resourceId;
    if (job.kind !== 'native-push' || scope.childId !== NIL) domainReject('invalid_scope', 400);
    const original = await authority.runTransaction(scope.ownerUserId, null, async b => {
      if (job.generation !== b.generation || job.authorizationVersion !== b.authorizationVersion || firestoreDomainHash(scope) !== firestoreDomainHash(b.scope)) return null;
      const ref = data.ref('native_push_deliveries', 'native-push-delivery', id), row = await b.transaction.get(ref);
      const saved = decode(b, row, 'native-push-delivery', id, firestoreNativeDeliverySchema), value = saved.delivery;
      if (value.id !== id || saved.generation !== job.generation || saved.authorizationVersion !== b.authorizationVersion) domainReject('push_binding', 500);
      if (!['queued', 'sending'].includes(value.status)) return { terminal: value.status === 'unknown' ? 'unknown' as const : 'completed' as const };
      if (value.status === 'sending') {
        saved.delivery = { ...value, status: 'unknown', reason: 'worker_interrupted', finishedAt: new Date().toISOString() };
        b.transaction.set(ref, deliveryEnvelope(b, saved)); return { terminal: 'unknown' as const };
      }
      const subscribed = await binding(b, value.bindingId), control = await authority.readControl(b.transaction);
      const reason: PushDelivery['reason'] = !control.enabled ? 'worker_paused' : !nativePushSender(options.gateway, subscribed.apns).available ? 'configuration_unavailable'
        : subscribed.binding.status !== 'active' || subscribed.binding.version !== saved.bindingVersion || !subscribed.token || !await sessionActiveIn(b, subscribed) ? 'revoked' : null;
      if (reason) {
        if (saved.chatTarget) saved.chatReason = null;
        saved.delivery = { ...value, status: 'stopped', reason, finishedAt: new Date().toISOString() };
        b.transaction.set(ref, deliveryEnvelope(b, saved)); return null;
      }
      const chat = await chatEligibility(b, saved, subscribed);
      if (chat.reason) {
        saved.chatReason = chat.reason;
        if (chat.nextAt) {
          b.transaction.set(ref, deliveryEnvelope(b, saved)); return { deferred: chat.nextAt };
        }
        saved.delivery = { ...value, status: 'stopped', reason: 'revoked', finishedAt: new Date(Date.now()).toISOString() };
        b.transaction.set(ref, deliveryEnvelope(b, saved)); return null;
      }
      if (saved.chatTarget) saved.chatReason = null;
      saved.attempt = randomUUID(); saved.delivery = { ...value, status: 'sending', attemptedAt: new Date().toISOString() };
      b.transaction.set(ref, deliveryEnvelope(b, saved)); return { saved, subscribed };
    });
    if (!original) return { state: 'stopped' as const };
    if ('deferred' in original) return { state: 'deferred' as const, nextAt: original.deferred };
    if (original.terminal) return { state: original.terminal };
    const authorization = { chat: null as Awaited<ReturnType<typeof chatEligibility>> | null };
    const authorized = async () => {
      authorization.chat = null;
      if (signal.aborted) return false;
      const identity = await options.currentAuth(scope.ownerUserId); if (identity.disabled || !identity.emailVerified) return false;
      try { return await authority.runTransaction(scope.ownerUserId, null, async b => {
        const current = decode(b, await b.transaction.get(data.ref('native_push_deliveries', 'native-push-delivery', id)), 'native-push-delivery', id, firestoreNativeDeliverySchema);
        const subscribed = await binding(b, current.delivery.bindingId);
        const active = b.generation === job.generation && b.authorizationVersion === job.authorizationVersion
          && firestoreDomainHash(b.scope) === firestoreDomainHash(scope) && (await authority.readControl(b.transaction)).enabled
          && current.delivery.status === 'sending' && current.attempt === original.saved.attempt && subscribed.binding.status === 'active'
          && subscribed.binding.version === current.bindingVersion && subscribed.tokenHash === original.subscribed.tokenHash
          && subscribed.binding.tokenRevision === original.subscribed.binding.tokenRevision && await sessionActiveIn(b, subscribed);
        if (!active) return false;
        authorization.chat = await chatEligibility(b, current, subscribed);
        return !authorization.chat.reason;
      }); } catch (error) { if (error && typeof error === 'object' && 'status' in error && [401, 403, 404, 409].includes(Number(error.status))) return false; throw error; }
    };
    let result: NativePushSendResult;
    try { result = await authorized() ? await nativePushSender(options.gateway, original.subscribed.apns).send(original.subscribed.token!, {
      v: 1, kind: original.saved.chatTarget ? 'care' : 'test', bindingId: original.saved.delivery.bindingId,
      bindingVersion: original.saved.bindingVersion, deliveryId: id }, signal, authorized, () => authorization.chat?.previewText)
      : { status: 'stopped', reason: 'revoked', providerStatus: null }; }
    catch { result = { status: 'unknown', reason: 'transport_unknown', providerStatus: null }; }
    await options.database.runTransaction(async tx => {
      const b = { scope, transaction: tx }, ref = data.ref('native_push_deliveries', 'native-push-delivery', id), row = await tx.get(ref); if (!row.exists) return;
      const saved = decode(b, row, 'native-push-delivery', id, firestoreNativeDeliverySchema);
      if (saved.attempt !== original.saved.attempt || saved.delivery.status !== 'sending') return;
      const subscriptionRow = await tx.get(data.ref('native_push_bindings', 'native-push-binding', saved.delivery.bindingId));
      const subscribed = subscriptionRow.exists ? decode(b, subscriptionRow, 'native-push-binding', saved.delivery.bindingId, firestoreNativeBindingSchema) : null;
      const expired = result.status === 'rejected' && result.reason === 'subscription_expired' && subscribed
        ? await prepareInvalidation(b, saved.delivery.bindingId, saved.bindingVersion, 'expired', {
          tokenHash: original.subscribed.tokenHash!, tokenRevision: original.subscribed.binding.tokenRevision, apnsInvalidatedAt: result.apnsInvalidatedAt }) : null;
      const change = await authority.prepareReceiptChange(tx, scope, randomUUID(), 'preferences');
      change?.commit(); expired?.commit();
      if (saved.chatTarget && result.status === 'stopped' && authorization.chat?.reason) {
        saved.chatReason = authorization.chat.reason;
        if (authorization.chat.nextAt) {
          saved.attempt = null;
          saved.delivery = { ...saved.delivery, status: 'queued', reason: null, attemptedAt: null, finishedAt: null };
          tx.set(ref, deliveryEnvelope(b, saved)); return;
        }
      }
      const { message: capturedMessage, apnsInvalidatedAt: _apnsInvalidatedAt, ...deliveryResult } = result;
      const message = options.messageHistoryEnabled === true ? acceptedMessage({ ...deliveryResult, message: capturedMessage }, 'native_push') : undefined;
      if (message) saved.message = message;
      saved.delivery = { ...saved.delivery, ...deliveryResult, finishedAt: new Date().toISOString() }; tx.set(ref, deliveryEnvelope(b, saved));
    });
    if (result.status === 'stopped' && authorization.chat?.nextAt) return { state: 'deferred' as const, nextAt: authorization.chat.nextAt };
    return { state: result.status === 'unknown' ? 'unknown' as const : 'completed' as const };
  }
  async function authorizeOpen(userId: string, session: DeviceSessionKey | null, raw: unknown) {
    const reference = domainParse(nativePushReferenceSchema, raw);
    if (!session || session.userId !== userId) domainReject('native_session_required', 403);
    return authority.runTransaction(userId, null, async b => {
      const subscribed = await binding(b, reference.bindingId);
      if (subscribed.binding.version !== reference.bindingVersion || subscribed.binding.status !== 'active'
        || subscribed.sessionHash !== session.sessionHash || !await sessionActiveIn(b, subscribed)) domainReject('not_found', 404);
      const row = await b.transaction.get(data.ref('native_push_deliveries', 'native-push-delivery', reference.deliveryId));
      if (reference.kind === 'test' || row.exists) {
        const saved = decode(b, row, 'native-push-delivery', reference.deliveryId, firestoreNativeDeliverySchema);
        if (saved.delivery.bindingId !== reference.bindingId || saved.bindingVersion !== reference.bindingVersion
          || !['accepted', 'unknown', 'sending'].includes(saved.delivery.status)) domainReject('not_found', 404);
        if (saved.chatTarget) {
          if (reference.kind !== 'care' || saved.generation !== b.generation || saved.authorizationVersion !== b.authorizationVersion
            || !await chatMessageAvailable(b, saved.chatTarget)) domainReject('not_found', 404);
          return { screen: 'chat', ...saved.chatTarget } satisfies NativeChatDestination;
        }
        if (reference.kind !== 'test') domainReject('not_found', 404);
      }
      return reference;
    });
  }
  return { status, mutation, process, authorizeOpen, readBinding: binding, prepareInvalidation, sessionActiveIn,
    prepareChatDeliveries, readChatDeliveryStatuses, setChatPresence, readChatPresence };
}
export type FirestoreNativePush = ReturnType<typeof createFirestoreNativePush>;
