import { z } from 'zod';
import { firestoreSharedInputSchema, firestoreSharedInputPartSchema, firestoreSourceManagementRevisionSchema,
  firestoreSharedInputTombstoneSchema } from './firestore-shared-inputs.ts';
import { firestoreConcernSchema, firestoreConcernRecoverySchemas } from './firestore-concerns.ts';
import { firestoreDocumentConcernEventSchema } from './firestore-document-sources.ts';
import { firestoreGrowthSchema, firestoreGrowthTopicSchema, firestoreGrowthRecoverySchema } from './firestore-growth.ts';
import type { FirestoreRecoveryContext } from './firestore-recovery-envelope.ts';

export const materialRestoreSchemas = {
  'shared-input': { suffix: 'shared_inputs', schema: firestoreSharedInputSchema },
  'shared-input-part': { suffix: 'shared_input_parts', schema: firestoreSharedInputPartSchema },
  'shared-input-management': { suffix: 'shared_input_management_revisions', schema: firestoreSourceManagementRevisionSchema },
  'shared-input-tombstone': { suffix: 'shared_inputs', schema: firestoreSharedInputTombstoneSchema },
  concern: { suffix: 'concerns', schema: firestoreConcernSchema },
  'concern-revision': { suffix: 'concern_revisions', schema: firestoreConcernSchema },
  'concern-event': { suffix: 'concern_events', schema: firestoreDocumentConcernEventSchema },
  'concern-operation': { suffix: 'concern_operations', schema: firestoreConcernRecoverySchemas.receipt },
  'concern-followup': { suffix: 'concern_followups', schema: firestoreConcernRecoverySchemas.followup },
  'growth-attention': { suffix: 'growth_attention', schema: firestoreGrowthSchema },
  'growth-revision': { suffix: 'growth_revisions', schema: firestoreGrowthSchema },
  'growth-topic': { suffix: 'growth_topics', schema: firestoreGrowthTopicSchema },
  'growth-topic-revision': { suffix: 'growth_topic_revisions', schema: firestoreGrowthTopicSchema },
  'growth-check': { suffix: 'growth_checks', schema: firestoreGrowthRecoverySchema },
} as const;
export type MaterialRestoreKind = keyof typeof materialRestoreSchemas;
export type MaterialRestoreValue = z.infer<(typeof materialRestoreSchemas)[MaterialRestoreKind]['schema']>;
export function isMaterialRestoreKind(kind: string): kind is MaterialRestoreKind { return Object.hasOwn(materialRestoreSchemas, kind); }
function check(ok: boolean): void { if (!ok) throw Object.assign(new Error('Restore material binding rejected'), { code: 'restore_binding', status: 409 }); }
const equal = (id: string, values: unknown[]) => check(id === JSON.stringify(values));
export function materialRestoreMetadata(context: FirestoreRecoveryContext & { kind: MaterialRestoreKind }, raw: MaterialRestoreValue,
  original: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const { kind, id, scope, recordVersion } = context;
  check(scope.childId !== '00000000-0000-0000-0000-000000000000' && recordVersion !== undefined);
  if (kind === 'shared-input') {
    const row = firestoreSharedInputSchema.parse(raw);
    check(row.id === id && row.childId === scope.childId && row.ownerUserId === scope.ownerUserId && row.version === recordVersion);
    return { live: true, entityId: row.id, createdAt: row.createdAt };
  }
  if (kind === 'shared-input-part') {
    const row = firestoreSharedInputPartSchema.parse(raw); equal(id, [row.inputId, row.index]); check(row.version === recordVersion);
    return { entityId: row.inputId };
  }
  if (kind === 'shared-input-management') {
    const row = firestoreSourceManagementRevisionSchema.parse(raw); equal(id, [row.inputId, row.version]);
    check(row.childId === scope.childId && row.ownerUserId === scope.ownerUserId && row.version === recordVersion);
    return { entityId: row.inputId, entityVersion: row.version };
  }
  if (kind === 'shared-input-tombstone') {
    const row = firestoreSharedInputTombstoneSchema.parse(raw); check(row.id === id && row.childId === scope.childId && row.version === recordVersion);
    return { entityId: id, createdAt: z.iso.datetime({ offset: true }).parse(original.createdAt), live: false };
  }
  if (kind === 'concern' || kind === 'concern-revision') {
    const row = firestoreConcernSchema.parse(raw); check(row.childId === scope.childId && row.version === recordVersion);
    if (kind === 'concern') check(id === row.id); else equal(id, [row.id, row.version]);
    return { concernId: row.id, entityVersion: row.version, createdAt: row.createdAt };
  }
  if (kind === 'concern-event') {
    const row = firestoreDocumentConcernEventSchema.parse(raw), source = row.importedFrom?.current;
    const actor = source ? source.source.section === 'concern_events' && source.source.authorUserId === row.actorUserId
      ? source.importedBy : null : row.actorUserId;
    check(id === row.id && row.childId === scope.childId && recordVersion === 1 && actor === scope.ownerUserId);
    return { ...(row.timelineId ? { timelineId: row.timelineId } : { concernId: row.concernId }), eventId: row.id, sequence: row.sequence };
  }
  if (kind === 'concern-operation') {
    let key: unknown; try { key = JSON.parse(id); } catch { check(false); }
    check(Array.isArray(key) && key.length === 2 && key[0] === scope.ownerUserId && z.uuid().safeParse(key[1]).success && JSON.stringify(key) === id && recordVersion === 1);
    return {};
  }
  if (kind === 'concern-followup') { const row = firestoreConcernRecoverySchemas.followup.parse(raw); check(id === row.id && recordVersion === 1); return {}; }
  if (kind === 'growth-attention' || kind === 'growth-revision') {
    const { item } = firestoreGrowthSchema.parse(raw); check(item.childId === scope.childId && item.version === recordVersion);
    if (kind === 'growth-attention') check(id === item.id); else equal(id, [item.id, item.version]);
    return { attentionId: item.id, createdAt: item.createdAt, entityVersion: item.version };
  }
  if (kind === 'growth-topic' || kind === 'growth-topic-revision') {
    const row = firestoreGrowthTopicSchema.parse(raw), key = JSON.stringify([scope.childId, row.topicId]), origin = row.importedFrom?.current;
    check(row.version === recordVersion && (row.actor === scope.ownerUserId || origin?.source.section === 'growth_topics'
      && origin.source.authorUserId === row.actor && origin.source.growthTopic === row.topicId && origin.importedBy === scope.ownerUserId));
    if (kind === 'growth-topic') check(id === key); else equal(id, [scope.childId, row.topicId, row.version]);
    return {};
  }
  const row = firestoreGrowthRecoverySchema.parse(raw); check(id === row.childId && id === scope.childId && recordVersion === 1);
  return {}; // Current context/basis is re-evaluated before further growth actions.
}
