import { contentErasureSchema } from './firestore-content-erasure.ts';
import { sharingRestoreSchemas, sharingRestoreMetadata, isSharingKind } from './firestore-sharing-records.ts';
import { materialRestoreSchemas, isMaterialRestoreKind, materialRestoreMetadata } from './firestore-restore-material-records.ts';
import { firestorePreparationSchema } from './firestore-care-summary.ts';
import { z } from 'zod';
import { importConfirmationActor } from './handover-provenance.ts';
import { sourceHistoryRecordSchema, sourceHistoryId, sourceHistoryMetadata } from './handover-history-records.ts';
import { validateSourceHistory } from './handover-source-history.ts';
import { handoverImportItemSchema, handoverImportMappingSchema, handoverImportItemId, handoverImportMappingId,
  handoverImportItemMetadata, handoverImportMappingMetadata } from './handover-import-records.ts';
import { firestoreCareStorageSchema as firestoreCareSchema, firestoreProfileStorageSchema as firestoreProfileSchema, firestoreCareRecoverySchemas } from './firestore-care.ts';
import { validSharedAttribution } from './shared-write-attribution.ts';
import { firestoreFactStorageSchema as firestoreFactSchema, firestoreTopicStorageSchema as firestoreTopicSchema, firestoreMemoryRecoverySchemas, validMemoryFactAttribution } from './firestore-memory.ts';
import { firestoreChatMessageSchema, firestoreChatRecoverySchemas } from './firestore-chat.ts';
import { firestoreContextRecoverySchema } from './firestore-context-basis.ts';
import type { FirestoreRecoveryContext } from './firestore-recovery-envelope.ts';

const NIL = '00000000-0000-0000-0000-000000000000';
const FAR_FUTURE = '9999-12-31T23:59:59.999Z';
export const coreRestoreSchemas = {
  ...sharingRestoreSchemas,
  ...materialRestoreSchemas,
  'handover-import-item': { suffix: 'handover_import_items', schema: handoverImportItemSchema },
  'handover-import-mapping': { suffix: 'handover_import_mappings', schema: handoverImportMappingSchema },
  'handover-source-history': { suffix: 'handover_source_history', schema: sourceHistoryRecordSchema },
  'content-erasure': { suffix: 'content_erasures', schema: contentErasureSchema },
  'visit-preparation': { suffix: 'visit_preparations', schema: firestorePreparationSchema },
  'visit-preparation-revision': { suffix: 'visit_preparation_revisions', schema: firestorePreparationSchema },
  'care-record': { suffix: 'care_records', schema: firestoreCareSchema },
  'care-revision': { suffix: 'care_revisions', schema: firestoreCareSchema },
  'care-tombstone': { suffix: 'care_records', schema: firestoreCareRecoverySchemas.tombstone },
  'child-profile': { suffix: 'child_profiles', schema: firestoreProfileSchema },
  'profile-revision': { suffix: 'profile_revisions', schema: firestoreProfileSchema },
  'context-version': { suffix: 'context_versions', schema: firestoreContextRecoverySchema },
  'chat-message': { suffix: 'chat_messages', schema: firestoreChatMessageSchema },
  'chat-reply': { suffix: 'chat_replies', schema: firestoreChatRecoverySchemas.reply },
  'chat-reply-leases': { suffix: 'chat_reply_leases', schema: firestoreChatRecoverySchemas.leases },
  'memory-fact': { suffix: 'memory_facts', schema: firestoreFactSchema },
  'memory-fact-revision': { suffix: 'memory_fact_revisions', schema: firestoreFactSchema },
  'memory-topic': { suffix: 'memory_topics', schema: firestoreTopicSchema },
  'memory-topic-revision': { suffix: 'memory_topic_revisions', schema: firestoreTopicSchema },
  // Tombstones deliberately keep the address of the erased fact/topic.
  'memory-tombstone': { suffix: 'memory_facts', schema: firestoreMemoryRecoverySchemas.tombstone },
  'memory-key': { suffix: 'memory_keys', schema: firestoreMemoryRecoverySchemas.key },
  'memory-reopened': { suffix: 'memory_reopened', schema: firestoreMemoryRecoverySchemas.key },
  'conversation-summary-head': { suffix: 'conversation_summary_heads', schema: firestoreMemoryRecoverySchemas.summary },
  'conversation-summary': { suffix: 'conversation_summaries', schema: firestoreMemoryRecoverySchemas.summary },
} as const;
export type CoreRestoreKind = keyof typeof coreRestoreSchemas;
export type CoreRestoreValue = z.infer<(typeof coreRestoreSchemas)[CoreRestoreKind]['schema']>;
export function isCoreRestoreKind(kind: string): kind is CoreRestoreKind { return Object.hasOwn(coreRestoreSchemas, kind); }
function requireValue(ok: boolean): void { if (!ok) throw Object.assign(new Error('Restore core record binding rejected'), { code: 'restore_binding', status: 409 }); }
function parts(id: string): unknown[] {
  let result: unknown; try { result = JSON.parse(id); } catch { requireValue(false); }
  requireValue(Array.isArray(result) && JSON.stringify(result) === id); return result as unknown[];
}
function equalId(id: string, expected: unknown[]): void { requireValue(JSON.stringify(parts(id)) === JSON.stringify(expected)); }
/** Physical address aliases are limited to the two existing tombstone representations. */
export function coreRestoreAddress(kind: CoreRestoreKind, id: string, collection: string, namespace: string) {
  let suffix: string = coreRestoreSchemas[kind].suffix, pathKind: string = kind;
  if (kind === 'care-tombstone') pathKind = 'care-record';
  if (kind === 'shared-input-tombstone') pathKind = 'shared-input';
  if (kind === 'memory-tombstone') {
    requireValue(collection === namespace + '_memory_facts' || collection === namespace + '_memory_topics');
    suffix = collection.slice(namespace.length + 1); pathKind = suffix === 'memory_facts' ? 'memory-fact' : 'memory-topic';
  }
  requireValue(collection === namespace + '_' + suffix);
  return { suffix, pathKind, id };
}
/** Rebuild query projections from the authenticated domain body; retain only checked ordering metadata. */
export function coreRestoreMetadata(context: FirestoreRecoveryContext & { kind: CoreRestoreKind }, raw: CoreRestoreValue,
  original: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const { kind, id, scope, recordVersion } = context;
  if (isSharingKind(kind)) return sharingRestoreMetadata({ ...context, kind }, raw);
  if (isMaterialRestoreKind(kind)) return materialRestoreMetadata({ ...context, kind }, materialRestoreSchemas[kind].schema.parse(raw), original);
  requireValue(context.family === 'domain' && context.envelopeVersion === 1 && recordVersion !== undefined);
  if (kind === 'chat-reply-leases') {
    requireValue(id === 'active' && scope.ownerUserId === 'system:chat-reply' && scope.workspaceId === NIL && scope.childId === NIL && scope.storageEpoch === NIL && recordVersion === 1);
    firestoreChatRecoverySchemas.leases.parse(raw); return {};
  }
  requireValue(scope.workspaceId !== NIL && scope.storageEpoch !== NIL);
  if (kind === 'context-version') { equalId(id, [scope.ownerUserId, scope.childId]); requireValue(recordVersion === 1);
    return { summaryPending: firestoreContextRecoverySchema.parse(raw).summaryPending === true }; }
  requireValue(scope.childId !== NIL);
  if (kind === 'handover-source-history') {
    const value = validateSourceHistory(sourceHistoryRecordSchema.parse(raw));
    requireValue(id === sourceHistoryId(scope, value) && value.childId === scope.childId && recordVersion === 1);
    return { ...sourceHistoryMetadata(value), historyId: id };
  }
  if (kind === 'handover-import-item') {
    const value = handoverImportItemSchema.parse(raw);
    requireValue(id === handoverImportItemId(scope, value.opId) && recordVersion === 1);
    return handoverImportItemMetadata(value);
  }
  if (kind === 'handover-import-mapping') {
    const value = handoverImportMappingSchema.parse(raw);
    requireValue(id === handoverImportMappingId(scope, value.source) && recordVersion === value.revision);
    return handoverImportMappingMetadata(value);
  }
  if (kind === 'content-erasure') {
    const v = contentErasureSchema.parse(raw);
    requireValue(id === v.intent.operationId && v.intent.scope.ownerUserId === scope.ownerUserId && v.intent.scope.childId === scope.childId);
    return { stage: v.stage };
  }
  const entity = (value: { id: string; childId: string; version: number }, revision = false) => {
    requireValue(value.childId === scope.childId && value.version === recordVersion);
    if (revision) equalId(id, [value.id, value.version]); else requireValue(id === value.id);
    return { entityId: value.id, entityVersion: value.version };
  };
  if (kind === 'visit-preparation' || kind === 'visit-preparation-revision') {
    const value = firestorePreparationSchema.parse(raw);
    requireValue(value.childId === scope.childId && value.version === recordVersion && value.updatedBy === scope.ownerUserId);
    if (kind === 'visit-preparation-revision') equalId(id, [value.childId, value.version]); else requireValue(id === value.childId);
    return { entityId: value.childId, entityVersion: value.version };
  }
  if (kind === 'care-record' || kind === 'care-revision') {
    const value = firestoreCareSchema.parse(raw), metadata = entity(value, kind === 'care-revision');
    const confirmer = importConfirmationActor(value, 'care');
    // Legacy records retain owner-only attribution. Shared actors require authenticated, resource-bound evidence.
    requireValue(validSharedAttribution(value.createdViaShare, scope, value.id, value.version, value.authorUserId, true)
      && !!confirmer && validSharedAttribution(value.confirmedViaShare, scope, value.id, value.version, confirmer));
    return kind === 'care-record' ? { ...metadata, createdAt: value.createdAt, live: true } : metadata;
  }
  if (kind === 'care-tombstone' || kind === 'memory-tombstone') {
    const value = firestoreCareRecoverySchemas.tombstone.parse(raw), metadata = entity(value);
    if (kind === 'memory-tombstone') return { ...metadata, live: false };
    return { ...metadata, live: false, createdAt: z.iso.datetime({ offset: true }).parse(original.createdAt) };
  }
  if (kind === 'child-profile' || kind === 'profile-revision') {
    const value = firestoreProfileSchema.parse(raw);
    const confirmer = importConfirmationActor(value, 'profile');
    requireValue(value.childId === scope.childId && value.version === recordVersion
      && (value.confirmedBy === null ? value.confirmedViaShare === undefined
        : !!confirmer && validSharedAttribution(value.confirmedViaShare, scope, value.childId, value.version, confirmer))
      && (value.confirmationBasis !== 'imported_source' || !!confirmer));
    if (kind === 'profile-revision') { equalId(id, [value.childId, value.version]); return { entityId: value.childId, entityVersion: value.version }; }
    requireValue(id === value.childId);
    return { historyFloor: z.number().int().min(1).max(value.version).parse(original.historyFloor) };
  }
  if (kind === 'chat-message') {
    const value = firestoreChatMessageSchema.parse(raw);
    requireValue(value.id === id && value.childId === scope.childId && recordVersion === 1 && (value.role === 'user'
      ? value.authorUserId === scope.ownerUserId && value.inReplyTo === null : value.authorUserId === null && value.inReplyTo !== null));
    return { messageId: id, createdAt: value.createdAt, sortKey: z.string().regex(/^[0-9]{19}$/u).parse(original.sortKey) };
  }
  if (kind === 'chat-reply') {
    const ids = parts(id); requireValue(ids.length === 3 && ids[0] === scope.ownerUserId && ids[1] === scope.childId && z.uuid().safeParse(ids[2]).success && recordVersion === 1);
    return {};
  }
  if (kind === 'memory-fact' || kind === 'memory-fact-revision') {
    const value = firestoreFactSchema.parse(raw), metadata = entity(value, kind.endsWith('-revision'));
    requireValue(validMemoryFactAttribution(value, scope));
    return { ...metadata, live: true, visibility: value.visibility, status: value.status, createdAt: value.createdAt,
      validUntil: value.validUntil === null ? FAR_FUTURE : new Date(value.validUntil).toISOString() };
  }
  if (kind === 'memory-topic' || kind === 'memory-topic-revision') {
    const value = firestoreTopicSchema.parse(raw), metadata = entity(value, kind.endsWith('-revision'));
    requireValue(validSharedAttribution(value.changedViaShare, scope, value.id, value.version, value.updatedBy));
    return { ...metadata, live: true, visibility: value.visibility, status: value.status, validUntil: FAR_FUTURE };
  }
  if (kind === 'memory-key') {
    const ids = parts(id); requireValue(ids.length === 5 && ids[0] === scope.ownerUserId && ids[1] === scope.childId
      && (['facts', 'topics'].includes(String(ids[2])) || (ids[2] === 'instructions' && ids[3] === 'private'))
      && ['private', 'family'].includes(String(ids[3])) && typeof ids[4] === 'string' && recordVersion === 1);
    return {};
  }
  if (kind === 'memory-reopened') { requireValue(z.uuid().safeParse(id).success && recordVersion === 1); return {}; }
  const value = firestoreMemoryRecoverySchemas.summary.parse(raw);
  requireValue(value.summary.childId === scope.childId && value.summary.version === recordVersion);
  if (kind === 'conversation-summary-head') { equalId(id, [scope.ownerUserId, scope.childId]); return {}; }
  requireValue(id === value.summary.id);
  return { entityId: value.summary.id, entityVersion: value.summary.version, ...(value.batch ? {
    currentBatch: original.currentBatch === true, lastMessageSortKey: value.batch.lastMessageSortKey } : {}) };
}
