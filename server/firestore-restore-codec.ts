import { avatarRestoreSchemas, isAvatarRestoreKind, assertAvatarRestoreBinding, transformAvatarRestore } from './firestore-restore-avatar-codec.ts';
import { isSharingKind, transformSharingRecord, sharingMetadata } from './firestore-sharing-records.ts';
import type { AvatarObjectDescriptor } from './avatar-data.ts';
import { firestoreChatFileRowSchema } from './firestore-chat-files.ts';
import { chatFileObjectAddress, chatFileObjectDescriptorSchema, type ChatFileObjectDescriptor } from './firebase-chat-file-objects.ts';
import { firestoreVoiceRowSchema } from './firestore-voice.ts';
import { firestoreVoiceTranscriptSchema } from './firestore-voice-transcripts.ts';
import { voiceObjectAddress, voiceObjectDescriptorSchema, type VoiceObjectDescriptor } from './firebase-voice-objects.ts';
import { adminDirectorySchema } from './firestore-admin.ts';
import { adminReceiptSchema, platformPolicySchema } from '../src/shared/admin.ts';
import { operationRestoreSchemas, isOperationRestoreKind, restoreOperationRecord } from './firestore-restore-operation-records.ts';
import { firestoreKnowledgeRefreshSchemas as knowledgeRefresh } from './firestore-knowledge-refresh.ts';
import { definitionHash } from './knowledge-observation.ts';
import { KNOWLEDGE_LEXICAL_PIPELINE, lexicalBucket } from './knowledge-lexical-index.ts';
import { agentRestoreSchemas, isAgentRestoreKind, restoreAgentRecord } from './firestore-restore-agent-records.ts';
import { coreRestoreSchemas, isCoreRestoreKind, coreRestoreAddress, coreRestoreMetadata } from './firestore-restore-core-records.ts';
import { createHash } from 'node:crypto';
import { VectorValue } from '@google-cloud/firestore';
import { z } from 'zod';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { agentWorkValuesSchema } from '../src/shared/agent-work.ts';
import { KNOWLEDGE_EMBEDDING } from '../src/shared/knowledge.ts';
import { canonicalJson } from './online-routing.ts';
import { canonical } from './firestore-session-codec.ts';
import { openRecoveryEnvelope, sealRecoveryLocator, type FirestoreRecoveryContext } from './firestore-recovery-envelope.ts';
import { workRecoveryAad, workRecoverySchemas, workRecoveryScopeSchema, type WorkRecoveryScope } from './firestore-work-continuation-recovery.ts';
import { firestoreAuthoritySchemas as authority } from './firestore-authority.ts';
import { firestoreFamilyDocumentSchemas as documents, validDocumentOperationAttribution } from './firestore-family-documents.ts';
import { firestoreFamilyDocumentSnapshotSchemas as snapshots } from './firestore-family-document-snapshots.ts';
import { firestorePhotoSchemas as photos, photoObjectScope } from './firestore-photos.ts';
import { firestoreKnowledgeSchemas as knowledge } from './firestore-knowledge.ts';
import { firestoreOnlineRecordSchema, firestoreOnlineErasureBarrierSchema } from './firestore-online-receipts.ts';
import { FirestoreDomainData, firestoreDomainHash, firestoreChildSchema, firestoreChangeSchema, firestoreTaskStorageSchema as firestoreTaskSchema,
  firestoreTaskRevisionStorageSchema as firestoreTaskRevisionSchema, firestoreReminderOutboxSchema, sealFirestoreReminderOutbox, FIRESTORE_TASK_DISPATCH_SCOPE,
  type FirestoreDomainOptions } from './firestore-domain-data.ts';
import { validTaskAttribution, validTaskRevisionAttribution } from './firestore-task-records.ts';
import { firestoreTaskReminderSchema, firestoreTaskReminderBatchSchema, firestoreNotificationPreferencesSchema,
  firestoreTaskNotificationOutboxSchema, firestoreTaskReminderId, firestoreTaskReminderBatchId } from './firestore-task-worker.ts';
import { firestoreTaskDispatchScanSchema, firestoreTaskDispatchObservationSchema } from './firestore-task-dispatcher.ts';
import { firebasePhotoObjectDescriptorSchema, type FirebasePhotoObjectDescriptor } from './firebase-photo-objects.ts';
import { firebaseErasureIntentHash } from './firebase-erasure-journal.ts';
import { knowledgeHash, knowledgeChunkInputSchema, internalKnowledgeSource } from './knowledge-inputs.ts';
import { knowledgeReviewHash } from './knowledge-review-assessment.ts';

const NIL = '00000000-0000-0000-0000-000000000000';
const uuid = z.uuid(), positive = z.number().int().positive().max(2147483647);
const decimal = authority.workspace.shape.accessVersion;
const changeSchema = authority.childCreationChange.extend({ kind: authority.changeKind, childId: z.uuid().nullable(), deleted: z.boolean() }).strict();
const onlineReceiptSchema = z.union([firestoreOnlineRecordSchema, firestoreOnlineErasureBarrierSchema]);
const authoritySchemas = { control: authority.control, account: authority.account, workspace: authority.workspace, child: authority.child,
  change: changeSchema, 'authority-invitation': authority.invitation, 'authority-identity': authority.identity,
  'authority-owner': authority.owner, 'authority-operation': authority.operation, 'authority-child-detail': authority.childDetail,
  work: workRecoverySchemas.work, followup: workRecoverySchemas.followup, 'authority-work-detail': authority.workDetail } as const;
const domainSchemas = {
  ...avatarRestoreSchemas,
  'platform-policy': { suffix: 'admin_policy', schema: platformPolicySchema },
  'admin-invitation': { suffix: 'admin_invitations', schema: adminDirectorySchema },
  'admin-receipt': { suffix: 'admin_operations', schema: adminReceiptSchema },
  ...operationRestoreSchemas,
  ...coreRestoreSchemas,
  ...agentRestoreSchemas,
  'child-projection': { suffix: 'children', schema: firestoreChildSchema },
  'change-projection': { suffix: 'changes', schema: firestoreChangeSchema },
  task: { suffix: 'tasks', schema: firestoreTaskSchema },
  'task-revision': { suffix: 'task_revisions', schema: firestoreTaskRevisionSchema },
  'task-reminder-outbox': { suffix: 'task_outbox', schema: firestoreReminderOutboxSchema },
  'online-receipt': { suffix: 'online_operations', schema: onlineReceiptSchema },
  'family-document': { suffix: 'documents', schema: documents.metadata },
  'document-operation': { suffix: 'document_operations', schema: documents.operation },
  'document-snapshot': { suffix: 'document_snapshots', schema: snapshots.manifest },
  'document-snapshot-chunk': { suffix: 'document_chunks', schema: snapshots.chunk },
  'chat-file-asset': { suffix: 'chat_file_assets', schema: firestoreChatFileRowSchema },
  'voice-asset': { suffix: 'voice_assets', schema: firestoreVoiceRowSchema },
  'voice-transcript': { suffix: 'voice_transcripts', schema: firestoreVoiceTranscriptSchema },
  photo: { suffix: 'photos', schema: photos.photo },
  'photo-operation': { suffix: 'photo_ops', schema: photos.operation },
  'photo-child-quota': { suffix: 'photo_quota', schema: photos.childQuota },
  'photo-global-quota': { suffix: 'photo_quota', schema: photos.globalQuota },
  'photo-cleanup': { suffix: 'photo_cleanup', schema: photos.cleanup },
  'task-reminder': { suffix: 'task_reminders', schema: firestoreTaskReminderSchema },
  'task-reminder-batch': { suffix: 'task_reminder_batches', schema: firestoreTaskReminderBatchSchema },
  'notification-preferences': { suffix: 'notification_preferences', schema: firestoreNotificationPreferencesSchema },
  'task-notification-outbox': { suffix: 'notification_outbox', schema: firestoreTaskNotificationOutboxSchema },
  'task-dispatch-scan': { suffix: 'task_dispatches', schema: firestoreTaskDispatchScanSchema },
  'task-dispatch-observation': { suffix: 'task_dispatches', schema: firestoreTaskDispatchObservationSchema },
} as const;
const knowledgeSchemas = { 'knowledge-source': knowledge.source, 'knowledge-version': knowledge.version, 'knowledge-chunk': knowledge.chunk,
  'knowledge-lexical': knowledge.lexical, 'knowledge-vector': knowledge.vector, 'knowledge-watch': knowledgeRefresh.watch,
  'knowledge-observation': knowledgeRefresh.observation, 'knowledge-observation-part': knowledgeRefresh.part, 'knowledge-check': knowledgeRefresh.check } as const;
const knowledgeSuffixes = { 'knowledge-source': 'knowledge_sources', 'knowledge-version': 'knowledge_versions', 'knowledge-chunk': 'knowledge_chunks',
  'knowledge-lexical': 'knowledge_lexical', 'knowledge-vector': 'knowledge_vectors', 'knowledge-watch': 'knowledge_watches',
  'knowledge-observation': 'knowledge_observations', 'knowledge-observation-part': 'knowledge_observation_parts', 'knowledge-check': 'knowledge_checks' } as const;
export type FirestoreRestoreAuthorityKind = keyof typeof authoritySchemas;
export type FirestoreRestoreDomainKind = keyof typeof domainSchemas;
export type FirestoreRestoreKnowledgeKind = keyof typeof knowledgeSchemas;
export type FirestoreRestoreContext = (FirestoreRecoveryContext & { kind: FirestoreRestoreAuthorityKind | FirestoreRestoreDomainKind })
  | { family: 'knowledge'; kind: FirestoreRestoreKnowledgeKind; id: string };
export type FirestoreRestoreValue = z.infer<(typeof authoritySchemas)[FirestoreRestoreAuthorityKind]>
  | z.infer<(typeof domainSchemas)[FirestoreRestoreDomainKind]['schema']> | z.infer<(typeof knowledgeSchemas)[FirestoreRestoreKnowledgeKind]>;
export interface FirestoreRestoreDecoded { path: string; context: FirestoreRestoreContext; value: FirestoreRestoreValue }
export interface FirestoreRestoreTransform {
  newEpochByWorkspace: ReadonlyMap<string, string>; generation: string;
  newAuthorizationVersionByWorkspace?: ReadonlyMap<string, string>;
  photoDescriptors: ReadonlyMap<string, FirebasePhotoObjectDescriptor>;
  avatarDescriptors?: ReadonlyMap<string, AvatarObjectDescriptor>; avatarObjectBucketName?: string;
  voiceDescriptors?: ReadonlyMap<string, VoiceObjectDescriptor>; voiceObjectBucketName?: string;
  chatFileDescriptors?: ReadonlyMap<string, ChatFileObjectDescriptor>; chatFileObjectBucketName?: string;
}
export interface FirestoreRestoreRecord { oldPath: string; path: string; data: Record<string, unknown> }
export interface FirestoreRestoreCodec {
  decode(record: { path: string; data: unknown }): FirestoreRestoreDecoded;
  transform(decoded: FirestoreRestoreDecoded, input: FirestoreRestoreTransform): FirestoreRestoreRecord;
}
export class FirestoreRestoreCodecError extends Error {
  readonly code: string; readonly status: number;
  constructor(code: string, status = 409) { super('Firestore restore record rejected'); this.name = 'FirestoreRestoreCodecError'; this.code = code; this.status = status; }
}
function reject(code: string, status = 409): never { throw new FirestoreRestoreCodecError(code, status); }
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value); if (!result.success) reject('restore_record_invalid'); return result.data;
}
function object(raw: unknown): Record<string, unknown> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw) || Object.getPrototypeOf(raw) !== Object.prototype) reject('restore_record_invalid');
  return Object.fromEntries(Object.entries(raw));
}
function key<T extends object>(table: T, value: string): value is Extract<keyof T, string> { return Object.hasOwn(table, value); }
function requireBinding(value: boolean): void { if (!value) reject('restore_binding'); }
function size(value: unknown, maximum: number): void {
  let text: string | undefined;
  try { text = JSON.stringify(value); } catch { reject('restore_record_invalid'); }
  if (text === undefined || Buffer.byteLength(text, 'utf8') > maximum) reject('restore_document_too_large', 413);
}
function nextDecimal(value: string): string {
  const next = (BigInt(parse(decimal, value)) + 1n).toString();
  if (!decimal.safeParse(next).success) reject('restore_version_exhausted'); return next;
}
function nextVersion(value: number): number {
  if (value >= 2147483647) reject('restore_version_exhausted'); return parse(positive, value + 1);
}
function sameScope(left: WorkRecoveryScope, right: WorkRecoveryScope): boolean { return canonicalJson(left) === canonicalJson(right); }
function arrayId(id: string): unknown[] {
  let value: unknown; try { value = JSON.parse(id); } catch { reject('restore_binding'); }
  if (!Array.isArray(value) || JSON.stringify(value) !== id) reject('restore_binding'); return value;
}
function idEquals(id: string, expected: unknown[]): void { requireBinding(canonicalJson(arrayId(id)) === canonicalJson(expected)); }
function deterministicUuid(value: unknown): string {
  const bytes = createHash('sha256').update(JSON.stringify(value)).digest().subarray(0, 16);
  const seventh = bytes.readUInt8(6), ninth = bytes.readUInt8(8);
  bytes.writeUInt8((seventh & 15) | 80, 6); bytes.writeUInt8((ninth & 63) | 128, 8);
  const text = bytes.toString('hex'); return text.slice(0, 8) + '-' + text.slice(8, 12) + '-' + text.slice(12, 16) + '-' + text.slice(16, 20) + '-' + text.slice(20);
}
const authorityEnvelopeSchema = z.object({ format: z.literal('yuban-work-recovery'), version: z.union([z.literal(1), z.literal(2)]),
  ciphertext: z.string().min(1), recovery: z.unknown() }).strict();
const domainEnvelopeSchema = z.object({ format: z.literal('yuban-firestore-domain'), version: z.literal(1), recordVersion: positive,
  ciphertext: z.string().min(1), recovery: z.unknown() }).strict();
// messageSentAt is untrusted query metadata; operation restores rebuild it from authenticated content.
const privateMetadata = new Set(['entryId', 'managerTag', 'memberTag', 'sourceUserTag', 'active', 'spaceId', 'messageSentAt', 'targetTag', 'actorTag', 'uploadId', 'pending', 'complete', 'nextAttemptAt', 'summaryPending', 'cleanupState', 'cleanupAt', 'retryAt', 'updatedAt', 'workspaceTag', 'epochTag', 'userTag', 'childTag', 'childId', 'createdAt', 'sortKey', 'stage',
  'teacherSpaceId', 'taskId', 'taskVersion', 'occurrenceId', 'documentId', 'status', 'autoRefresh', 'snapshotId', 'snapshotVersion', 'assetId', 'scopeTag',
  'live', 'state', 'dueAt', 'leaseUntil', 'dispatchId', 'dispatchRouting', 'entityId', 'entityVersion', 'historyFloor', 'messageId', 'visibility', 'validUntil', 'runId', 'triggerKind', 'workId', 'confirmationId', 'askingRunId', 'askMessageId', 'expiresAt', 'proposalId', 'authorizationVersion', 'receiptId', 'noteId', 'concernId', 'eventId', 'sequence', 'attentionId', 'id', 'dispatch', 'route', 'enabled', 'nextCheckAt', 'operationId', 'bindingId', 'deliveryId', 'challengeId', 'unresolved', 'requestId', 'attemptIds']);

/** Pure authenticated record conversion. No reads, writes, permissions, journal replay or object transfer occur here. */
export function createFirestoreRestoreCodec(options: FirestoreDomainOptions): FirestoreRestoreCodec {
  const data = new FirestoreDomainData(options), { cipher, projectId, namespace } = options;
  const originalEnvelopes = new WeakMap<FirestoreRestoreDecoded, Record<string, unknown>>();
  const coreMetadata = new WeakMap<FirestoreRestoreDecoded, Record<string, unknown>>();
  const photoTag = (scope: WorkRecoveryScope) => firestoreDomainHash([projectId, namespace, 'photo-scope', scope]);
  function pathFor(context: FirestoreRestoreContext, originalPath?: string): string {
    if (context.family === 'knowledge') return namespace + '_' + knowledgeSuffixes[context.kind] + '/' + context.id;
    if (context.family === 'authority') {
      if (!key(authoritySchemas, context.kind)) reject('unsupported_restore_domain');
      return namespace + '/' + createHash('sha256').update(JSON.stringify([context.kind, context.id])).digest('hex');
    }
    if (!key(domainSchemas, context.kind)) reject('unsupported_restore_domain');
    if (isCoreRestoreKind(context.kind)) {
      const collection = originalPath?.split('/')[0] ?? namespace + '_' + coreRestoreSchemas[context.kind].suffix;
      const address = coreRestoreAddress(context.kind, context.id, collection, namespace);
      return namespace + '_' + address.suffix + '/' + firestoreDomainHash([address.pathKind, context.id]);
    }
    return namespace + '_' + domainSchemas[context.kind].suffix + '/' + firestoreDomainHash([context.kind, context.id]);
  }
  function scopeAfter(scope: WorkRecoveryScope, input: FirestoreRestoreTransform): WorkRecoveryScope {
    parse(workRecoveryScopeSchema, scope);
    if (scope.workspaceId === NIL || scope.storageEpoch === NIL) {
      requireBinding(scope.workspaceId === NIL && scope.storageEpoch === NIL); return { ...scope };
    }
    const epoch = input.newEpochByWorkspace.get(scope.workspaceId);
    if (!uuid.safeParse(epoch).success || epoch === NIL || epoch === scope.storageEpoch) reject('restore_epoch_missing');
    return { ...scope, storageEpoch: parse(uuid, epoch) };
  }
  function authorityBinding(context: FirestoreRecoveryContext & { kind: FirestoreRestoreAuthorityKind }, raw: FirestoreRestoreValue): void {
    const { kind, id, scope } = context;
    requireBinding(context.envelopeVersion === (kind.startsWith('authority-') ? 2 : 1) && context.recordVersion === undefined);
    if (kind === 'work' || kind === 'followup') {
      const row = kind === 'work' ? parse(workRecoverySchemas.work, raw) : parse(workRecoverySchemas.followup, raw);
      requireBinding(sameScope(scope, { ownerUserId: row.ownerUserId, workspaceId: row.workspaceId, childId: row.childId, storageEpoch: row.storageEpoch })
        && scope.workspaceId !== NIL && scope.childId !== NIL && id === ('id' in row ? row.id : row.workId));
      if (kind === 'work') {
        const work = parse(workRecoverySchemas.work, row);
        let payload: unknown;
        try { payload = JSON.parse(cipher.decrypt(work.payloadEncrypted, `agent-work:${scope.childId}:${scope.ownerUserId}:${id}:${work.version}`)); }
        catch { reject('restore_work_payload'); }
        requireBinding(parse(agentWorkValuesSchema, payload).status === work.status);
      }
    } else if (kind === 'authority-work-detail') {
      const row = parse(authority.workDetail, raw); requireBinding(id === row.id && scope.workspaceId !== NIL && scope.childId !== NIL);
    } else if (kind === 'control') { parse(authority.control, raw); requireBinding(id === 'current' && scope.ownerUserId === 'control' && scope.workspaceId === NIL && scope.childId === NIL && scope.storageEpoch === NIL); }
    else if (kind === 'account') { const row = parse(authority.account, raw); requireBinding(row.userId === id && id === scope.ownerUserId && scope.workspaceId === NIL && scope.childId === NIL && scope.storageEpoch === NIL); }
    else if (kind === 'workspace') { const row = parse(authority.workspace, raw); requireBinding(row.id === id && id === scope.workspaceId && row.ownerUserId === scope.ownerUserId && row.storageEpoch === scope.storageEpoch && id !== NIL && scope.storageEpoch !== NIL); }
    else if (kind === 'child' || kind === 'authority-child-detail') {
      const row = kind === 'child' ? parse(authority.child, raw) : parse(authority.childDetail, raw);
      requireBinding(row.id === id && id === scope.childId && row.workspaceId === scope.workspaceId && scope.workspaceId !== NIL && scope.storageEpoch !== NIL);
    } else if (kind === 'authority-identity' || kind === 'authority-owner') {
      const row = kind === 'authority-identity' ? parse(authority.identity, raw) : parse(authority.owner, raw);
      requireBinding(row.userId === id && id === scope.ownerUserId && scope.workspaceId === NIL && scope.childId === NIL && scope.storageEpoch === NIL);
      if ('workspaceId' in row) requireBinding(row.workspaceId !== NIL);
      if ('email' in row) requireBinding(row.email === row.email.trim().toLowerCase());
    } else if (kind === 'authority-invitation') {
      const row = parse(authority.invitation, raw), invitationOwner = 'invitation:' + createHash('sha256').update(canonical(row.email)).digest('hex');
      requireBinding(row.email === id && id === id.trim().toLowerCase() && scope.workspaceId === NIL && scope.childId === NIL && scope.storageEpoch === NIL
        && (scope.ownerUserId === invitationOwner || row.consumedBy !== null && scope.ownerUserId === row.consumedBy));
    } else if (kind === 'change') {
      const row = parse(changeSchema, raw);
      requireBinding(row.workspaceId === scope.workspaceId && row.storageEpoch === scope.storageEpoch && row.privateUserId === scope.ownerUserId
        && row.childId === (scope.childId === NIL ? null : scope.childId));
      idEquals(id, [scope.workspaceId, scope.storageEpoch, scope.ownerUserId, scope.childId, row.operationId, 'authority']);
    } else {
      const row = parse(authority.operation, raw);
      requireBinding(row.ownerUserId === scope.ownerUserId && row.childId === null && scope.workspaceId === NIL && scope.childId === NIL && scope.storageEpoch === NIL);
      idEquals(id, [row.ownerUserId, row.childId, row.operationId]);
      // A journal-backed erasure removes receipt payloads while retaining the original operation identity.
      if (row.result === null) return;
      if (row.action === 'create_child') {
        const result = parse(z.object({ child: authority.childDetail, scope: workRecoveryScopeSchema, authorizationVersion: decimal }).strict(), row.result);
        requireBinding(result.scope.ownerUserId === row.ownerUserId && result.child.id === result.scope.childId && result.child.workspaceId === result.scope.workspaceId
          && result.scope.workspaceId !== NIL && result.scope.storageEpoch !== NIL);
      } else if (row.action === 'issue_invitation' || row.action === 'revoke_invitation') parse(authority.invitation, row.result);
      else if (row.action === 'acknowledge') parse(z.object({ policyVersion: z.literal(SERVICE_POLICY_VERSION) }).strict(), row.result);
      else if (row.action === 'set_account_state') parse(z.object({ state: z.enum(['revoked', 'deleting', 'deleted']) }).strict(), row.result);
      else reject('unsupported_restore_domain');
    }
  }
  function domainBinding(context: FirestoreRecoveryContext & { kind: FirestoreRestoreDomainKind }, raw: FirestoreRestoreValue): void {
    if (isAvatarRestoreKind(context.kind)) { assertAvatarRestoreBinding(data, context, raw); return; }
    if (isCoreRestoreKind(context.kind) || isAgentRestoreKind(context.kind) || isOperationRestoreKind(context.kind)) return; // Checked with the authenticated ordering projection below.
    const { kind, id, scope, recordVersion } = context;
    requireBinding(context.envelopeVersion === 1 && recordVersion !== undefined);
    parse(workRecoveryScopeSchema, scope);
    if (!['photo-global-quota', 'task-dispatch-scan', 'platform-policy', 'admin-invitation', 'admin-receipt'].includes(kind)) requireBinding(scope.workspaceId !== NIL && scope.storageEpoch !== NIL);
    const versionMatches = (value: number) => requireBinding(recordVersion === value);
    const taskRecipient = (userId: string) => userId === scope.ownerUserId
      || scope.ownerUserId === 'space:' + scope.workspaceId && !userId.startsWith('space:');
    const taskBinding = (row: z.infer<typeof firestoreTaskSchema>) => requireBinding(validTaskAttribution(row, scope)
      && scope.workspaceId !== NIL && scope.storageEpoch !== NIL);
    if (kind === 'task') { const row = parse(firestoreTaskSchema, raw); requireBinding(row.id === id); taskBinding(row); versionMatches(row.version); }
    else if (kind === 'task-revision') { const row = parse(firestoreTaskRevisionSchema, raw); taskBinding(row.task); requireBinding(validTaskRevisionAttribution(row, scope)); idEquals(id, [row.task.id, row.task.version]); versionMatches(row.task.version); }
    else if (kind === 'child-projection') { const row = parse(firestoreChildSchema, raw); requireBinding(row.id === id && id === scope.childId && row.workspaceId === scope.workspaceId); versionMatches(1); }
    else if (kind === 'change-projection') { const row = parse(firestoreChangeSchema, raw); requireBinding(row.childId === (scope.childId === NIL ? null : scope.childId)); idEquals(id, [scope.workspaceId, scope.storageEpoch, row.changeSeq]); versionMatches(1); }
    else if (kind === 'task-reminder-outbox') {
      const row = parse(firestoreReminderOutboxSchema, raw);
      requireBinding(row.ownerUserId === scope.ownerUserId && row.workspaceId === scope.workspaceId && row.childId === scope.childId && row.storageEpoch === scope.storageEpoch);
      idEquals(id, [row.taskId, row.taskVersion]); versionMatches(row.taskVersion);
    } else if (kind === 'online-receipt') {
      const row = parse(onlineReceiptSchema, raw);
      requireBinding(row.ownerUserId === scope.ownerUserId && scope.childId === NIL); versionMatches(1);
      if ('state' in row && row.state === 'erasure_barrier') idEquals(id, [row.ownerUserId, row.operationId]);
      else {
        const normal = parse(firestoreOnlineRecordSchema, row);
        requireBinding(normal.operation.workspaceId === scope.workspaceId && (normal.restoredFromEpoch === undefined
          ? normal.operation.storageEpoch === scope.storageEpoch
          : normal.restoredFromEpoch === normal.operation.storageEpoch && normal.restoredFromEpoch !== scope.storageEpoch));
        idEquals(id, [normal.ownerUserId, normal.operation.opId]);
      }
    } else if (kind === 'platform-policy' || kind === 'admin-invitation' || kind === 'admin-receipt') {
      requireBinding(sameScope(scope, { ownerUserId: 'system:admin', workspaceId: NIL, childId: NIL, storageEpoch: NIL })); versionMatches(1);
      if (kind === 'platform-policy') requireBinding(id === 'current');
      else if (kind === 'admin-invitation') requireBinding(id === firestoreDomainHash(parse(adminDirectorySchema, raw).email));
      else { const receipt = parse(adminReceiptSchema, raw); requireBinding(id === receipt.opId && receipt.command.opId === id && receipt.fingerprint === firestoreDomainHash(receipt.command)); }
    } else if (kind === 'family-document') {
      const row = parse(documents.metadata, raw); requireBinding(row.id === id && row.ownerUserId === scope.ownerUserId && row.childId === scope.childId); versionMatches(row.version);
    } else if (kind === 'document-operation') {
      const row = parse(documents.operation, raw); requireBinding(validDocumentOperationAttribution(row, scope));
      idEquals(id, [row.ownerUserId, row.operationId]); versionMatches(1);
    } else if (kind === 'document-snapshot') {
      const row = parse(snapshots.manifest, raw); requireBinding(row.snapshotId === id && row.childId === scope.childId); versionMatches(row.snapshotVersion);
    } else if (kind === 'document-snapshot-chunk') { const row = parse(snapshots.chunk, raw), parts = arrayId(id); requireBinding(parts.length === 2 && uuid.safeParse(parts[0]).success && parts[1] === row.index && Buffer.byteLength(row.text) <= 48 * 1024); }
    else if (kind === 'voice-asset') {
      const row = parse(firestoreVoiceRowSchema, raw); versionMatches(row.version);
      requireBinding(row.id === id && sameScope(row.scope, scope)
        && row.objectScope.ownerUserId === scope.ownerUserId && row.objectScope.workspaceId === scope.workspaceId && row.objectScope.childId === scope.childId);
      const integrity = row.metadata ?? row.deletion?.integrity;
      if (row.descriptor) requireBinding(Boolean(integrity && ['sha256','bytes','mimeType'].every(k => row.descriptor![k as keyof VoiceObjectDescriptor] === integrity[k as keyof typeof integrity])));
    }
    else if (kind === 'chat-file-asset') {
      const row = parse(firestoreChatFileRowSchema, raw); versionMatches(row.version);
      requireBinding(row.id === id && sameScope(row.scope, scope)
        && row.objectScope.ownerUserId === scope.ownerUserId && row.objectScope.workspaceId === scope.workspaceId && row.objectScope.childId === scope.childId);
      const integrity = row.metadata ?? row.deletion?.integrity;
      if (row.descriptor) requireBinding(Boolean(integrity && ['sha256','bytes','mimeType'].every(k => row.descriptor![k as keyof ChatFileObjectDescriptor] === integrity[k as keyof typeof integrity])));
    } else if (kind === 'voice-transcript') {
      const row = parse(firestoreVoiceTranscriptSchema, raw); versionMatches(row.value.version);
      requireBinding(row.value.voice.id === id && sameScope(row.scope, scope));
    }
    else if (kind === 'photo') {
      const row = parse(photos.photo, raw); photoObjectScope(row); requireBinding(row.id === id && sameScope(row.scope, scope)); versionMatches(row.version);
      if (row.descriptor && row.metadata) requireBinding(row.descriptor.sha256 === row.metadata.sha256 && row.descriptor.bytes === row.metadata.bytes && row.descriptor.mimeType === row.metadata.mimeType);
      if (row.deletion) {
        requireBinding(row.deletion.intent.assetId === row.id && row.deletion.fingerprint === firestoreDomainHash(['delete', row.id, row.deletion.expectedVersion])
          && row.deletion.intent.scope.ownerUserId === scope.ownerUserId && row.deletion.intent.scope.workspaceId === scope.workspaceId && row.deletion.intent.scope.childId === scope.childId);
        if (row.deletion.journal) requireBinding(row.deletion.journal.intentSha256 === firebaseErasureIntentHash(row.deletion.intent));
      }
    } else if (kind === 'photo-operation') { const row = parse(photos.operation, raw); requireBinding(row.operationId === id && sameScope(row.scope, scope)); versionMatches(1); }
    else if (kind === 'photo-child-quota') { parse(photos.childQuota, raw); requireBinding(id === photoTag(scope) && scope.workspaceId !== NIL && scope.childId !== NIL); versionMatches(1); }
    else if (kind === 'photo-global-quota') { parse(photos.globalQuota, raw); requireBinding(id === 'global' && sameScope(scope, { ownerUserId: 'system:photos', workspaceId: NIL, childId: NIL, storageEpoch: NIL })); versionMatches(1); }
    else if (kind === 'photo-cleanup') {
      const row = parse(photos.cleanup, raw); photoObjectScope(row); requireBinding(id === row.photoId && sameScope(scope, row.scope)); versionMatches(1);
      if (row.descriptor) requireBinding(row.descriptor.sha256 === row.sha256 && row.descriptor.bytes === row.bytes && row.descriptor.mimeType === row.mimeType);
    } else if (kind === 'task-reminder') { const row = parse(firestoreTaskReminderSchema, raw); requireBinding(row.id === id && scope.childId !== NIL && row.id === firestoreTaskReminderId(scope, row.occurrenceId, row.phase)); versionMatches(row.taskVersion); }
    else if (kind === 'task-reminder-batch') { const row = parse(firestoreTaskReminderBatchSchema, raw); requireBinding(row.id === id && taskRecipient(row.recipientUserId) && scope.childId === NIL && row.id === firestoreTaskReminderBatchId(scope, row.category, row.key)); versionMatches(1); }
    else if (kind === 'notification-preferences') { const row = parse(firestoreNotificationPreferencesSchema, raw); requireBinding(id === scope.ownerUserId && scope.childId === NIL); versionMatches(row.version); }
    else if (kind === 'task-notification-outbox') { const row = parse(firestoreTaskNotificationOutboxSchema, raw); requireBinding(row.id === id && row.reminderId === id && taskRecipient(row.recipientUserId) && scope.childId !== NIL); versionMatches(row.taskVersion); }
    else if (kind === 'task-dispatch-scan') { const row = parse(firestoreTaskDispatchScanSchema, raw); requireBinding(id === 'current' && sameScope(scope, FIRESTORE_TASK_DISPATCH_SCOPE)); versionMatches(row.revision); }
    else if (kind === 'task-dispatch-observation') { const row = parse(firestoreTaskDispatchObservationSchema, raw); requireBinding(row.taskName === id && scope.childId !== NIL); }
  }
  function knowledgeBinding(kind: FirestoreRestoreKnowledgeKind, id: string, raw: FirestoreRestoreValue): void {
    if (kind === 'knowledge-source') {
      const row = parse(knowledge.source, raw); requireBinding(row.projectId === projectId && row.namespace === namespace && row.sourceId === id);
    } else if (kind === 'knowledge-version') {
      const row = parse(knowledge.version, raw);
      requireBinding(row.projectId === projectId && row.namespace === namespace && row.versionId === id && row.header.sourceId === row.sourceId
        && id === deterministicUuid([projectId, namespace, 'version', row.sourceId, row.versionHash]));
      requireBinding(new Set(row.chunks.map(chunk => chunk.key)).size === row.chunks.length);
      row.chunks.forEach((chunk, index) => requireBinding(chunk.order === index + 1 && chunk.chunkId === deterministicUuid([projectId, namespace, 'chunk', id, chunk.key])));
      if (row.review) requireBinding(row.review.assessmentHash === knowledgeReviewHash(row.review.assessment));
      requireBinding(!internalKnowledgeSource(row.header.url));
    } else if (kind === 'knowledge-chunk') {
      const row = parse(knowledge.chunk, raw);
      requireBinding(row.projectId === projectId && row.namespace === namespace && row.chunkId === id
        && id === deterministicUuid([projectId, namespace, 'chunk', row.versionId, row.document.key]) && row.contentHash === knowledgeHash(row.document));
      parse(knowledgeChunkInputSchema, row.document);
      requireBinding((row.document.pageStart === undefined) === (row.document.pageEnd === undefined));
      if (row.document.pageStart !== undefined && row.document.pageEnd !== undefined)
        requireBinding(row.document.pageStart <= row.document.pageEnd && typeof row.document.originalText === 'string');
      if (row.embedding === null) requireBinding([row.vectorHash, row.model, row.dimensions, row.pipeline].every(value => value === null));
      else {
        requireBinding(row.embedding instanceof VectorValue);
        const values = row.embedding.toArray();
        requireBinding(values.length === KNOWLEDGE_EMBEDDING.dimensions && values.every(value => Number.isFinite(value) && Math.abs(value) <= 1e10)
          && values.some(value => value !== 0) && row.vectorHash === knowledgeHash(values)
          && row.model === KNOWLEDGE_EMBEDDING.model && row.dimensions === KNOWLEDGE_EMBEDDING.dimensions && row.pipeline === KNOWLEDGE_EMBEDDING.pipeline);
      }
    } else {
      const row = parse(knowledgeSchemas[kind] as z.ZodType<Record<string, unknown>>, raw);
      requireBinding(row.projectId === projectId && row.namespace === namespace);
      if (kind === 'knowledge-lexical') {
        const value = parse(knowledge.lexical, row);
        requireBinding(id === deterministicUuid([projectId, namespace, 'lexical', KNOWLEDGE_LEXICAL_PIPELINE, value.versionId, value.bucket])
          && value.termsHash === knowledgeHash(value.terms) && Object.keys(value.terms).every(term => lexicalBucket(term) === value.bucket));
      } else if (kind === 'knowledge-vector') {
        const value = parse(knowledge.vector, row);
        requireBinding(id === knowledgeHash([KNOWLEDGE_EMBEDDING, value.inputHash]));
        if (value.state === 'ready') {
          requireBinding(value.embedding instanceof VectorValue);
          const values = value.embedding!.toArray();
          requireBinding(values.length === KNOWLEDGE_EMBEDDING.dimensions && values.every(n => Number.isFinite(n) && Math.abs(n) <= 1e10)
            && values.some(n => n !== 0) && value.vectorHash === knowledgeHash(values));
        } else requireBinding(value.embedding === null && value.vectorHash === null);
      } else if (kind === 'knowledge-watch') {
        const value = parse(knowledgeRefresh.watch, row); requireBinding(value.id === id && value.definition.id === id && value.definitionHash === definitionHash(value.definition));
      } else if (kind === 'knowledge-observation') requireBinding(parse(knowledgeRefresh.observation, row).sourceId === id);
      else if (kind === 'knowledge-observation-part') {
        const value = parse(knowledgeRefresh.part, row); requireBinding(id === knowledgeHash([value.sourceId, value.contentHash, value.part]));
      } else requireBinding(parse(knowledgeRefresh.check, row).jobId === id);
    }
  }
  function decode(record: { path: string; data: unknown }): FirestoreRestoreDecoded {
    if (typeof record.path !== 'string' || record.path.length > 300 || !/^[A-Za-z][A-Za-z0-9_]*\/[A-Za-z0-9-]+$/u.test(record.path)) reject('restore_path_invalid');
    const raw = object(record.data); size(raw, 900 * 1024);
    const [collection, documentId] = record.path.split('/');
    const publicKinds = Object.fromEntries(Object.entries(knowledgeSuffixes).map(([kind, suffix]) => [namespace + '_' + suffix, kind])) as Record<string, FirestoreRestoreKnowledgeKind>;
    if (collection && key(publicKinds, collection)) {
      if (!documentId) reject('restore_path_invalid');
      const kind = publicKinds[collection]!, value = parse<FirestoreRestoreValue>(knowledgeSchemas[kind], raw);
      knowledgeBinding(kind, documentId, value); return { path: record.path, context: { family: 'knowledge', kind, id: documentId }, value };
    }
    if (collection !== namespace && !Object.values(domainSchemas).some(entry => collection === namespace + '_' + entry.suffix) && collection !== namespace + '_memory_topics') reject('unsupported_restore_domain');
    const core: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(raw)) {
      if (['format', 'version', 'recordVersion', 'ciphertext', 'recovery'].includes(name)) core[name] = value;
      else if (collection === namespace || !privateMetadata.has(name)) reject('restore_record_invalid');
    }
    const family = collection === namespace ? 'authority' : 'domain';
    const envelope = family === 'authority' ? parse(authorityEnvelopeSchema, core) : parse(domainEnvelopeSchema, core);
    size(envelope, family === 'authority' ? 192 * 1024 : 384 * 1024);
    const opened = openRecoveryEnvelope({ cipher, projectId, namespace,
      envelope: { family, version: envelope.version, ciphertext: envelope.ciphertext,
        ...('recordVersion' in envelope ? { recordVersion: envelope.recordVersion } : {}) }, locator: envelope.recovery });
    const kind = opened.context.kind;
    let result: FirestoreRestoreDecoded;
    if (family === 'authority') {
      if (!key(authoritySchemas, kind)) reject('unsupported_restore_domain');
      const context = { ...opened.context, kind }, value = parse<FirestoreRestoreValue>(authoritySchemas[kind], opened.value);
      authorityBinding(context, value); result = { path: record.path, context, value };
    } else {
      if (!key(domainSchemas, kind)) reject('unsupported_restore_domain');
      const context = { ...opened.context, kind }, value = parse<FirestoreRestoreValue>(domainSchemas[kind].schema, opened.value);
      domainBinding(context, value); result = { path: record.path, context, value };
      if (isAvatarRestoreKind(kind)) assertAvatarRestoreBinding(data, context, value, raw);
      // Earlier snapshots lack this query projection; the authenticated document remains authoritative.
      if (kind === 'family-document' && raw.autoRefresh !== undefined)
        requireBinding(raw.autoRefresh === parse(documents.metadata, value).autoRefresh);
      if (isCoreRestoreKind(kind)) coreMetadata.set(result, coreRestoreMetadata({ ...context, kind },
        coreRestoreSchemas[kind].schema.parse(value), raw));
      if (isAgentRestoreKind(kind)) restoreAgentRecord({ ...context, kind }, agentRestoreSchemas[kind].schema.parse(value));
      if (isOperationRestoreKind(kind)) restoreOperationRecord(data, { ...context, kind }, operationRestoreSchemas[kind].schema.parse(value));
    }
    requireBinding(pathFor(result.context, record.path) === record.path); originalEnvelopes.set(result, object(JSON.parse(JSON.stringify(core)))); return result;
  }
  function transform(decoded: FirestoreRestoreDecoded, input: FirestoreRestoreTransform): FirestoreRestoreRecord {
    const context = decoded.context; parse(uuid, input.generation); requireBinding(pathFor(context, decoded.path) === decoded.path);
    if (context.family === 'knowledge') {
      const value = parse<FirestoreRestoreValue>(knowledgeSchemas[context.kind], decoded.value); knowledgeBinding(context.kind, context.id, value);
            // In-flight acquisition is not proof of completion and must not be replayed after restore.
      if (context.kind === 'knowledge-watch') return { oldPath: decoded.path, path: decoded.path, data: { ...object(value), lease: null } };
      if (context.kind === 'knowledge-check') {
        const row = parse(knowledgeRefresh.check, value);
        return { oldPath: decoded.path, path: decoded.path, data: { ...row, state: row.state === 'running' ? 'unknown' : row.state } };
      }
      if (context.kind === 'knowledge-vector') {
        const row = parse(knowledge.vector, value);
        return { oldPath: decoded.path, path: decoded.path, data: { ...row, state: row.state === 'running' ? 'unknown' : row.state } };
      }
      return { oldPath: decoded.path, path: decoded.path, data: object(value) };
    }
    if (context.family === 'domain' && isAvatarRestoreKind(context.kind)) return transformAvatarRestore(data, decoded, input);
    if (context.family === 'domain' && ['platform-policy', 'admin-invitation', 'admin-receipt'].includes(context.kind)) {
      domainBinding(context as Extract<FirestoreRestoreDecoded['context'], { family: 'domain' }>, decoded.value);
      const original = originalEnvelopes.get(decoded); if (!original) reject('restore_admin_origin_missing');
      if (context.kind === 'platform-policy') {
        const row = parse(platformPolicySchema, decoded.value), disabled = { ...row, enabled: false, version: nextVersion(row.version) };
        return { oldPath: decoded.path, path: decoded.path, data: { ...data.seal('platform-policy', 'current', context.scope, platformPolicySchema, disabled) } };
      }
      if (context.kind === 'admin-invitation') return { oldPath: decoded.path, path: decoded.path,
        data: { sortKey: firestoreDomainHash(context.id), entityId: context.id, ...original } };
      const row = parse(adminReceiptSchema, decoded.value);
      return { oldPath: decoded.path, path: decoded.path, data: { sortKey: row.at + ':' + row.opId, operationId: row.opId, ...original } };
    }
    if (context.family === 'domain' && context.kind === 'photo-cleanup') {
      domainBinding({ ...context, kind: 'photo-cleanup' }, decoded.value);
      const original = originalEnvelopes.get(decoded); if (!original) reject('restore_cleanup_origin_missing');
      const row = parse(photos.cleanup, decoded.value);
      return { oldPath: decoded.path, path: decoded.path, data: { scopeTag: photoTag(context.scope), state: row.state, ...original } };
    }
    if (context.family === 'domain' && context.kind === 'photo' && parse(photos.photo, decoded.value).state === 'deleted') {
      const row = parse(photos.photo, decoded.value), original = originalEnvelopes.get(decoded);
      if (!original) reject('restore_cleanup_origin_missing');
      return {oldPath:decoded.path,path:decoded.path,data:{assetId:row.id,scopeTag:photoTag(context.scope),
        sortKey:row.createdAt+'/'+row.id,live:false,...original}};
    }
    if (context.family === 'domain' && context.kind === 'voice-asset' && parse(firestoreVoiceRowSchema, decoded.value).deletion) {
      const row = parse(firestoreVoiceRowSchema, decoded.value); domainBinding({...context,kind:'voice-asset'}, row);
      // Cleanup addresses remain bound to their original immutable object and scope.
      return { oldPath: decoded.path, path: decoded.path, data: { ...data.tags(row.scope),
        scopeTag: firestoreDomainHash(['voice-scope', row.scope]), assetId: row.id, state: row.state,
        createdAt: row.createdAt, updatedAt: row.updatedAt, messageId: row.messageId,
        cleanupState: row.deletion!.cleanup, cleanupAt: row.deletion!.nextCheckAt,
        ...data.seal('voice-asset',row.id,row.scope,firestoreVoiceRowSchema,row,row.version) } };
    }
    if (context.family === 'domain' && context.kind === 'chat-file-asset' && parse(firestoreChatFileRowSchema, decoded.value).deletion) {
      const row = parse(firestoreChatFileRowSchema, decoded.value); domainBinding({...context,kind:'chat-file-asset'}, row);
      // Cleanup addresses remain bound to their original immutable object and scope.
      return { oldPath: decoded.path, path: decoded.path, data: { ...data.tags(row.scope),
        scopeTag: firestoreDomainHash(['chat-file-scope', row.scope]), assetId: row.id, state: row.state,
        createdAt: row.createdAt, updatedAt: row.updatedAt, messageId: row.messageId,
        cleanupState: row.deletion!.cleanup, cleanupAt: row.deletion!.nextCheckAt,
        ...data.seal('chat-file-asset',row.id,row.scope,firestoreChatFileRowSchema,row,row.version) } };
    }
    const scope = scopeAfter(context.scope, input);
    if (context.family === 'authority') {
      if (!key(authoritySchemas, context.kind)) reject('unsupported_restore_domain');
      authorityBinding({ ...context, kind: context.kind }, decoded.value);
      let id = context.id, value: FirestoreRestoreValue = decoded.value;
      if (context.kind === 'control') value = { ...parse(authority.control, value), enabled: false, generation: input.generation };
      else if (context.kind === 'workspace') { const row = parse(authority.workspace, value); value = { ...row, storageEpoch: scope.storageEpoch, accessVersion: nextDecimal(row.accessVersion) }; }
      else if (context.kind === 'work') value = { ...parse(workRecoverySchemas.work, value), ...scope };
      else if (context.kind === 'followup') {
        const row = parse(workRecoverySchemas.followup, value);
        value = { ...row, ...scope, enabled: false, authorizationVersion: input.newAuthorizationVersionByWorkspace?.get(scope.workspaceId) ?? nextDecimal(row.authorizationVersion) };
      }
      else if (context.kind === 'change') {
        const row = parse(changeSchema, value); value = { ...row, storageEpoch: scope.storageEpoch };
        id = JSON.stringify([scope.workspaceId, scope.storageEpoch, scope.ownerUserId, scope.childId, row.operationId, 'authority']);
      }
      const binding = context.kind === 'authority-invitation' ? null
        : context.kind === 'authority-identity' || context.kind === 'authority-owner' || context.kind === 'authority-operation' && scope.childId === NIL
          ? { ownerUserId: scope.ownerUserId } : scope;
      const aad = context.kind === 'control' || context.kind === 'account' || context.kind === 'workspace' || context.kind === 'child' || context.kind === 'change' || context.kind === 'work' || context.kind === 'followup'
        ? workRecoveryAad(projectId, namespace, context.kind, id, scope)
        : JSON.stringify(['yuban-work-recovery', 2, projectId, namespace, context.kind, id, binding]);
      const body = canonical(value); size(value, 192 * 1024); const ciphertext = cipher.encrypt(body, aad);
      const recovery = sealRecoveryLocator({ cipher, projectId, namespace, ciphertext,
        context: { ...context, id, scope, aad } });
      const envelope = { format: 'yuban-work-recovery', version: context.envelopeVersion, ciphertext, recovery }; size(envelope, 192 * 1024);
      return { oldPath: decoded.path, path: pathFor({ ...context, id, scope, aad }), data: envelope };
    }
    if (!key(domainSchemas, context.kind)) reject('unsupported_restore_domain');
    if (isOperationRestoreKind(context.kind)) {
      const result = restoreOperationRecord(data, { ...context, kind: context.kind }, operationRestoreSchemas[context.kind].schema.parse(decoded.value), scope);
      return { oldPath: decoded.path, path: pathFor({ ...context, id: result.id, scope: result.scope }),
        data: { ...result.metadata, ...data.seal<FirestoreRestoreValue>(context.kind, result.id, result.scope,
          operationRestoreSchemas[context.kind].schema, result.value, result.version) } };
    }
    if (isAgentRestoreKind(context.kind)) {
      const result = restoreAgentRecord({ ...context, kind: context.kind }, agentRestoreSchemas[context.kind].schema.parse(decoded.value), scope);
      const envelope = data.seal<FirestoreRestoreValue>(context.kind, context.id, scope, agentRestoreSchemas[context.kind].schema, result.value, context.recordVersion);
      return { oldPath: decoded.path, path: pathFor({ ...context, scope }), data: { ...data.tags(scope), ...result.metadata, ...envelope } };
    }
    if (isCoreRestoreKind(context.kind)) {
      const schema = coreRestoreSchemas[context.kind].schema;
      const saved = coreMetadata.get(decoded); if (!saved) reject('restore_core_origin_missing');
      const value = isSharingKind(context.kind) ? transformSharingRecord(context.kind, decoded.value, input.newEpochByWorkspace)
        : context.kind === 'chat-reply-leases' ? { leases: [] } : schema.parse(decoded.value);
      const metadata = isSharingKind(context.kind) ? { ...data.tags(scope), ...sharingMetadata(context.kind, value) }
        : context.kind === 'chat-reply-leases' ? {} : { ...data.tags(scope), ...saved };
      const envelope = data.seal<FirestoreRestoreValue>(context.kind, context.id, scope, schema, value, context.recordVersion);
      return { oldPath: decoded.path, path: pathFor({ ...context, scope }, decoded.path), data: { ...metadata, ...envelope } };
    }
    domainBinding({ ...context, kind: context.kind }, decoded.value);
    let id = context.id, value: FirestoreRestoreValue = decoded.value, recordVersion = parse(positive, context.recordVersion);
    const metadata: Record<string, unknown> = { ...data.tags(scope) };
    switch (context.kind) {
      case 'child-projection': { const row = parse(firestoreChildSchema, value); Object.assign(metadata, { childId: row.id, createdAt: row.createdAt }); break; }
      case 'change-projection': { const row = parse(firestoreChangeSchema, value); id = JSON.stringify([scope.workspaceId, scope.storageEpoch, row.changeSeq]); Object.assign(metadata, { sortKey: data.sortKey(row.changeSeq), childId: row.childId }); break; }
      case 'task': Object.assign(metadata, { taskId: parse(firestoreTaskSchema, value).id }); break;
      case 'task-revision': { const row = parse(firestoreTaskRevisionSchema, value); Object.assign(metadata, { taskId: row.task.id, taskVersion: row.task.version }); break; }
      case 'task-reminder-outbox': {
        const row = parse(firestoreReminderOutboxSchema, value), rebound = parse(firestoreReminderOutboxSchema, { ...row, ...scope,
          authorizationVersion: input.newAuthorizationVersionByWorkspace?.get(scope.workspaceId) ?? nextDecimal(row.authorizationVersion), generation: input.generation, lease: null,
          state: row.state === 'leased' ? 'unknown' : row.state });
        return { oldPath: decoded.path, path: pathFor({ ...context, scope }), data: sealFirestoreReminderOutbox(data, scope, rebound) };
      }
      case 'family-document': { const row = parse(documents.metadata, value); Object.assign(metadata, { documentId: row.id, status: row.status, createdAt: row.createdAt, autoRefresh: row.autoRefresh }); break; }
      case 'document-operation': value = { ...parse(documents.operation, value), storageEpoch: scope.storageEpoch }; break;
      case 'document-snapshot': { const row = parse(snapshots.manifest, value); Object.assign(metadata, { documentId: row.documentId, snapshotId: row.snapshotId, snapshotVersion: row.snapshotVersion }); break; }
      case 'document-snapshot-chunk': for (const name of Object.keys(metadata)) delete metadata[name]; break;
      case 'voice-asset': {
        const row = parse(firestoreVoiceRowSchema, value); let descriptor = row.descriptor;
        if (descriptor) {
          const replacement = input.voiceDescriptors?.get(row.id);
          if (!replacement || !input.voiceObjectBucketName) reject('restore_voice_descriptor_missing');
          const checked = parse(voiceObjectDescriptorSchema,replacement);
          requireBinding(['sha256','bytes','mimeType','durationMs'].every(k => checked[k as keyof VoiceObjectDescriptor] === descriptor![k as keyof VoiceObjectDescriptor])
            && checked.objectName === voiceObjectAddress({projectId,namespace,bucketName:input.voiceObjectBucketName},scope,row.id).objectName);
          descriptor = checked;
        }
        value = { ...row, scope, descriptor, objectScope: descriptor || !row.upload ? scope : row.objectScope,
          upload: row.upload ? {...row.upload,unknown:true} : null };
        Object.assign(metadata,{scopeTag:firestoreDomainHash(['voice-scope',scope]),assetId:row.id,state:row.state,
          createdAt:row.createdAt,updatedAt:row.updatedAt,messageId:row.messageId,cleanupState:row.messageId===null?'unlinked':null,cleanupAt:null}); break;
      }
      case 'chat-file-asset': {
        const row = parse(firestoreChatFileRowSchema, value); let descriptor = row.descriptor;
        if (descriptor) {
          const replacement = input.chatFileDescriptors?.get(row.id);
          if (!replacement || !input.chatFileObjectBucketName) reject('restore_chat_file_descriptor_missing');
          const checked = parse(chatFileObjectDescriptorSchema,replacement);
          requireBinding(['sha256','bytes','mimeType'].every(k => checked[k as keyof ChatFileObjectDescriptor] === descriptor![k as keyof ChatFileObjectDescriptor])
            && checked.objectName === chatFileObjectAddress({projectId,namespace,bucketName:input.chatFileObjectBucketName},scope,row.id).objectName);
          descriptor = checked;
        }
        value = { ...row, scope, descriptor, objectScope: descriptor || !row.upload ? scope : row.objectScope,
          upload: row.upload ? {...row.upload,unknown:true} : null };
        Object.assign(metadata,{scopeTag:firestoreDomainHash(['chat-file-scope',scope]),assetId:row.id,state:row.state,
          createdAt:row.createdAt,updatedAt:row.updatedAt,messageId:row.messageId,cleanupState:row.messageId===null?'unlinked':null,cleanupAt:null}); break;
      }
      case 'voice-transcript': {
        const row = parse(firestoreVoiceTranscriptSchema,value), interrupted = row.value.state === 'running';
        const pending = row.value.state === 'pending';
        value = { ...row,scope,value:{...row.value,state:interrupted?'unknown':pending?'stopped':row.value.state,
          reason:interrupted?'restore_unknown':pending?'restore_paused':row.value.reason,retryAt:null} };
        Object.assign(metadata,{assetId:row.value.voice.id,state:(value as typeof row).value.state,retryAt:null}); break;
      }
      case 'photo': {
        const row = parse(photos.photo, value); let upload = row.upload;
        if (upload !== null) {
          if (row.metadata === null || !['reserved','ready'].includes(row.state)) reject('restore_unsettled_upload');
          requireBinding(upload.reservationOperationId === row.reservationOperationId
            && upload.sha256 === row.metadata.sha256 && upload.bytes === row.metadata.bytes && upload.mimeType === row.metadata.mimeType
            && (row.descriptor === null || upload.sha256 === row.descriptor.sha256 && upload.bytes === row.descriptor.bytes && upload.mimeType === row.descriptor.mimeType));
          upload = { ...upload, authorizationVersion: nextDecimal(upload.authorizationVersion), generation: input.generation };
        }
        let descriptor = row.descriptor;
        if (row.state !== 'deleted' && descriptor !== null) {
          const replacement = input.photoDescriptors.get(row.id); if (!replacement) reject('restore_photo_descriptor_missing');
          const checked = parse(firebasePhotoObjectDescriptorSchema, replacement);
          requireBinding(checked.sha256 === descriptor.sha256 && checked.bytes === descriptor.bytes && checked.mimeType === descriptor.mimeType);
          const scopeHash = createHash('sha256').update(JSON.stringify(['yuban-photo-object', 1, projectId, namespace, scope])).digest('hex');
          requireBinding(checked.objectName === 'photos/v1/' + scopeHash + '/' + row.id);
          descriptor = checked;
        }
        value = { ...row, scope, descriptor, upload, ...(row.state === 'reserved' && upload ? {objectScope: row.objectScope ?? row.scope} : {}) };
        if (descriptor) delete (value as {objectScope?:unknown}).objectScope;
        for (const name of Object.keys(metadata)) delete metadata[name];
        Object.assign(metadata, { assetId: row.id, scopeTag: photoTag(scope), sortKey: row.createdAt + '/' + row.id, live: row.state === 'reserved' || row.state === 'ready' }); break;
      }
      case 'photo-operation': value = { ...parse(photos.operation, value), scope }; for (const name of Object.keys(metadata)) delete metadata[name]; metadata.scopeTag = photoTag(scope); break;
      case 'photo-child-quota': id = photoTag(scope); for (const name of Object.keys(metadata)) delete metadata[name]; metadata.scopeTag = id; break;
      case 'photo-global-quota': for (const name of Object.keys(metadata)) delete metadata[name]; break;
      case 'task-reminder': { const row = parse(firestoreTaskReminderSchema, value); Object.assign(metadata, { taskId: row.taskId, occurrenceId: row.occurrenceId }); break; }
      case 'task-notification-outbox': { const row = parse(firestoreTaskNotificationOutboxSchema, value); value = { ...row, state: row.state === 'leased' ? 'unknown' : row.state }; metadata.state = row.state === 'leased' ? 'unknown' : row.state; break; }
      case 'task-dispatch-scan': { const row = parse(firestoreTaskDispatchScanSchema, value); recordVersion = nextVersion(row.revision); value = { revision: recordVersion, cursor: null, lease: null }; break; }
      case 'online-receipt': {
        const row = parse(onlineReceiptSchema, value);
        if ('state' in row && row.state === 'erasure_barrier') value = row;
        else {
          const normal = parse(firestoreOnlineRecordSchema, row), origin = normal.restoredFromEpoch ?? normal.operation.storageEpoch;
          requireBinding(origin !== scope.storageEpoch); value = { ...normal, restoredFromEpoch: origin };
        }
        break;
      }
      default: break;
    }
    const envelope = data.seal<FirestoreRestoreValue>(context.kind, id, scope, domainSchemas[context.kind].schema, value, recordVersion);
    return { oldPath: decoded.path, path: pathFor({ ...context, id, scope }), data: { ...metadata, ...envelope } };
  }
  return { decode, transform };
}
