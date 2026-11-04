import { FieldPath, type DocumentSnapshot } from '@google-cloud/firestore';
import { z } from 'zod';
import { createFirestoreAuthority, type FirestoreAuthorityTransaction } from './firestore-authority.ts';
import { FirestoreDomainData, domainReject, firestoreDomainHash, type FirestoreDomainOptions } from './firestore-domain-data.ts';
import { firebaseErasureIntentSchema, firebaseErasureDescriptorSchema, firebaseErasureIntentHash, privateSourceErasureOperationId, privateInstructionErasureOperationId, type FirebaseErasureJournal } from './firebase-erasure-journal.ts';
import { contentPointerSchema, contentResult, type ContentKind } from './firestore-disclosure.ts';
import { firestoreOnlineRecordSchema, isFirestoreOnlinePending, privateInputReceiptTarget } from './firestore-online-receipts.ts';
import { openRecoveryEnvelope } from './firestore-recovery-envelope.ts';
import { sourceHistoryRecordSchema, sourceHistoryId, historyResourceForContent } from './handover-history-records.ts';
import { firestoreAgentActionSavedSchema, redactErasedNoteEvidence } from './firestore-private-note-receipt.ts';
import { preparePrivateSummaryRevisionErasure, preparePrivateSummaryAttemptErasure,
  type PrivateSummarySessionErasurePort } from './firestore-private-summary-erasure.ts';

export const contentErasureSchema = z.object({ intent: firebaseErasureIntentSchema.refine(v => v.type === 'content-delete'),
  journal: firebaseErasureDescriptorSchema.nullable(), stage: z.enum(['revisions', 'source_history', 'receipts', 'summary_revisions', 'summary_attempts', 'done']),
  after: z.string().nullable(), privateSummaryComplete: z.literal(true).optional() }).strict();
/** Restore may reseal a job into a new epoch, but its independent journal keeps the original subject and intent. */
export function contentErasureScopeMatches(value: z.infer<typeof contentErasureSchema>, scope: z.infer<typeof firebaseErasureIntentSchema>['scope']): boolean {
  const original = value.intent.scope;
  return original.ownerUserId === scope.ownerUserId && original.workspaceId === scope.workspaceId && original.childId === scope.childId
    && (original.storageEpoch === scope.storageEpoch || value.journal !== null)
    && (value.journal === null || value.journal.intentSha256 === firebaseErasureIntentHash(value.intent));
}
/** Completed journal evidence stays bound to its original subject across storage epochs. */
export function privateInstructionDeletionProof(scope: FirestoreAuthorityTransaction['scope'], id: string,
  value: z.infer<typeof contentErasureSchema>) {
  const { intent, journal } = value, content = intent.content;
  if (value.stage !== 'done' || value.after !== null || !journal || content?.kind !== 'private_instruction'
    || intent.operationId !== privateInstructionErasureOperationId(scope, id) || intent.assetId !== id
    || intent.scope.ownerUserId !== scope.ownerUserId || intent.scope.workspaceId !== scope.workspaceId
    || intent.scope.childId !== scope.childId || journal.intentSha256 !== firebaseErasureIntentHash(intent)) return null;
  return { version: content.throughVersion + 1, operationId: content.sourceOperationId };
}
export async function readPrivateInstructionDeletion(data: FirestoreDomainData, binding: FirestoreAuthorityTransaction, id: string) {
  const operationId = privateInstructionErasureOperationId(binding.scope, id);
  const row = await binding.transaction.get(data.ref('content_erasures', 'content-erasure', operationId));
  if (!row.exists) return null;
  if (Object.entries(data.tags(binding.scope)).some(([key, value]) => row.get(key) !== value)) domainReject('erasure_binding', 500);
  const value = data.open('content-erasure', operationId, binding.scope, contentErasureSchema, row);
  return privateInstructionDeletionProof(binding.scope, id, value);
}
export const contentHistory = { care: ['care_revisions', 'care-revision'], profile: ['profile_revisions', 'profile-revision'],
  fact: ['memory_fact_revisions', 'memory-fact-revision'], topic: ['memory_topic_revisions', 'memory-topic-revision'],
  private_source: ['shared_input_management_revisions', 'shared-input-management'] } as const;
export type ContentErasureKind = ContentKind | 'private_source' | 'private_instruction';
export function prepareContentErasure(data: FirestoreDomainData, binding: FirestoreAuthorityTransaction,
  kind: ContentErasureKind, id: string, throughVersion: number, operationId: string, origin?: { at: string; sourceOperationId: string }) {
  const value = contentErasureSchema.parse({ intent: { type: 'content-delete', scope: binding.scope, assetId: id, operationId,
    at: origin?.at ?? new Date().toISOString(), content: { kind, throughVersion,
      ...(kind === 'private_source' || kind === 'private_instruction' ? { sourceOperationId: origin?.sourceOperationId } : {}) } },
    journal: null, stage: kind === 'private_instruction' ? 'receipts' : 'revisions', after: null });
  const ref = data.ref('content_erasures', 'content-erasure', operationId);
  return () => binding.transaction.create(ref, { ...data.tags(binding.scope), stage: value.stage,
    ...data.seal('content-erasure', operationId, binding.scope, contentErasureSchema, value) });
}
/** Bounded, resumable physical cleanup. The independent journal survives business backup rollback. */
export function createFirestoreContentErasure(options: FirestoreDomainOptions & {
  journal: Pick<FirebaseErasureJournal, 'writeOnce' | 'read'>; summarySessions?: PrivateSummarySessionErasurePort;
}) {
  const data = new FirestoreDomainData(options), authority = createFirestoreAuthority(options);
  function open(row: DocumentSnapshot) {
    const raw = row.data()!;
    const opened = openRecoveryEnvelope({ ...options, locator: raw.recovery,
      envelope: { family: 'domain', version: raw.version, recordVersion: raw.recordVersion, ciphertext: raw.ciphertext } });
    if (opened.context.kind !== 'content-erasure' || data.ref('content_erasures', 'content-erasure', opened.context.id).path !== row.ref.path)
      domainReject('erasure_binding', 500);
    const value = contentErasureSchema.parse(opened.value);
    if (value.intent.operationId !== opened.context.id || !contentErasureScopeMatches(value, opened.context.scope)
      || raw.stage !== value.stage || Object.entries(data.tags(opened.context.scope)).some(([key, tag]) => raw[key] !== tag)) domainReject('erasure_binding', 500);
    return { scope: opened.context.scope, id: opened.context.id, value };
  }
  async function advance(row: DocumentSnapshot) {
    const original = open(row);
    const intent = original.value.intent, descriptor = original.value.journal ?? await options.journal.writeOnce(intent);
    if (descriptor.intentSha256 !== firebaseErasureIntentHash(intent)
      || firebaseErasureIntentHash(await options.journal.read(intent, descriptor)) !== firebaseErasureIntentHash(intent)) domainReject('erasure_binding', 500);
    if (original.value.stage === 'done' && original.value.privateSummaryComplete) return;
    await options.database.runTransaction(async tx => {
      if (!(await authority.readControl(tx)).enabled) return;
      const current = await tx.get(row.ref); if (!current.exists) return;
      const { scope, id, value } = open(current);
      if (firebaseErasureIntentHash(value.intent) !== firebaseErasureIntentHash(intent)
        || value.journal && firestoreDomainHash(value.journal) !== firestoreDomainHash(descriptor)) domainReject('erasure_binding', 500);
      if (value.stage === 'done' && value.privateSummaryComplete) return;
      const stage = value.stage === 'done' ? 'summary_revisions' : value.stage;
      if (stage === 'summary_revisions' || stage === 'summary_attempts') {
        const tags = data.tags(scope), suffix = stage === 'summary_revisions' ? 'private_summary_revisions' : 'private_summary_attempts';
        // Restore retains immutable protocol identities in their original epoch. A content intent covers every such epoch.
        let page = data.collection(suffix).where('workspaceTag', '==', tags.workspaceTag).where('userTag', '==', tags.userTag)
          .where('childTag', '==', tags.childTag).orderBy(FieldPath.documentId()).limit(stage === 'summary_revisions' ? 25 : 1);
        if (value.stage !== 'done' && value.after) page = page.startAfter(value.after);
        const rows = await tx.get(page), writes: (() => void)[] = [];
        for (const entry of rows.docs) {
          const raw = entry.data(), decoded = openRecoveryEnvelope({ ...options, locator: raw.recovery,
            envelope: { family: 'domain', version: raw.version, recordVersion: raw.recordVersion, ciphertext: raw.ciphertext } });
          const kind = stage === 'summary_revisions' ? 'private-summary-revision' : 'private-summary-attempt';
          if (decoded.context.kind !== kind || data.ref(suffix, kind, decoded.context.id).path !== entry.ref.path
            || decoded.context.scope.ownerUserId !== scope.ownerUserId || decoded.context.scope.workspaceId !== scope.workspaceId
            || decoded.context.scope.childId !== scope.childId) domainReject('erasure_binding', 500);
          if (stage === 'summary_revisions') writes.push(await preparePrivateSummaryRevisionErasure(data, tx, id, decoded.context.id));
          else writes.push(await preparePrivateSummaryAttemptErasure(data, tx, id, decoded.context.id, options.summarySessions));
        }
        const full = rows.size === (stage === 'summary_revisions' ? 25 : 1), next = { ...value, journal: descriptor,
          after: full ? rows.docs.at(-1)!.id : null,
          stage: full ? stage : stage === 'summary_revisions' ? 'summary_attempts' as const : 'done' as const,
          ...(!full && stage === 'summary_attempts' ? { privateSummaryComplete: true as const } : {}) };
        for (const write of writes) write();
        tx.set(row.ref, { ...data.tags(scope), stage: next.stage, ...data.seal('content-erasure', id, scope, contentErasureSchema, next) });
        return;
      }
      const kind = intent.content!.kind, tags = data.tags(scope);
      if (kind === 'private_instruction') {
        if (value.stage !== 'receipts') domainReject('erasure_binding', 500);
        let query = data.collection('agent_action_receipts').where('workspaceTag', '==', tags.workspaceTag)
          .where('epochTag', '==', tags.epochTag).where('userTag', '==', tags.userTag).where('childTag', '==', tags.childTag)
          .orderBy(FieldPath.documentId()).limit(25);
        if (value.after) query = query.startAfter(value.after);
        const page = await tx.get(query);
        for (const entry of page.docs) {
          const receiptId = z.uuid().parse(entry.get('receiptId'));
          if (data.ref('agent_action_receipts', 'agent-action-receipt', receiptId).path !== entry.ref.path) domainReject('erasure_binding', 500);
          const saved = data.open('agent-action-receipt', receiptId, scope, firestoreAgentActionSavedSchema, entry);
          if (saved.receipt.id !== receiptId) domainReject('erasure_binding', 500);
          const redacted = redactErasedNoteEvidence(saved, intent.assetId);
          if (redacted !== saved) tx.set(entry.ref, { ...entry.data(),
            ...data.seal('agent-action-receipt', receiptId, scope, firestoreAgentActionSavedSchema, redacted) });
        }
        const after = page.size === 25 ? page.docs.at(-1)!.id : null;
        const next = { ...value, after, stage: after ? 'receipts' as const : 'summary_revisions' as const, journal: descriptor };
        tx.set(row.ref, { ...tags, stage: next.stage, ...data.seal('content-erasure', id, scope, contentErasureSchema, next) });
        return;
      }
      const [suffix, revisionKind] = contentHistory[kind];
      let q = data.collection(value.stage === 'revisions' ? suffix : value.stage === 'source_history' ? 'handover_source_history' : 'online_operations')
        .where('workspaceTag', '==', tags.workspaceTag).where('epochTag', '==', tags.epochTag).where('userTag', '==', tags.userTag);
      if (value.stage === 'revisions') q = q.where('childTag', '==', tags.childTag).where('entityId', '==', intent.assetId);
      if (value.stage === 'source_history') q = q.where('childTag', '==', tags.childTag)
        .where('module', '==', historyResourceForContent(kind)).where('entityId', '==', intent.assetId);
      let page = value.stage === 'revisions' ? q.where('entityVersion', '<=', intent.content!.throughVersion).orderBy('entityVersion', 'desc').limit(25)
        : q.orderBy(FieldPath.documentId()).limit(25);
      if (value.after) page = page.startAfter(value.stage === 'revisions' ? Number(value.after) : value.after);
      const rows = await tx.get(page), writes: (() => void)[] = [];
      for (const entry of rows.docs) {
        const raw = entry.data(), decoded = openRecoveryEnvelope({ ...options, locator: raw.recovery,
          envelope: { family: 'domain', version: raw.version, recordVersion: raw.recordVersion, ciphertext: raw.ciphertext } });
        if (decoded.context.scope.ownerUserId !== scope.ownerUserId || decoded.context.scope.workspaceId !== scope.workspaceId
          || decoded.context.scope.storageEpoch !== scope.storageEpoch) domainReject('erasure_binding', 500);
        if (value.stage === 'revisions') {
          if (decoded.context.scope.childId !== scope.childId || decoded.context.kind !== revisionKind) domainReject('erasure_binding', 500);
          const revision = z.object({ version: z.number().int().positive() }).passthrough().parse(decoded.value);
          if (intent.content!.kind === 'private_source' && (revision.inputId !== intent.assetId || revision.childId !== scope.childId
            || revision.ownerUserId !== scope.ownerUserId || decoded.context.id !== JSON.stringify([intent.assetId, revision.version])
            || data.ref(suffix, decoded.context.kind, decoded.context.id).path !== entry.ref.path)) domainReject('erasure_binding', 500);
          if (revision.version <= intent.content!.throughVersion) writes.push(() => tx.delete(entry.ref));
        } else if (value.stage === 'source_history') {
          const retained = sourceHistoryRecordSchema.parse(decoded.value);
          if (decoded.context.scope.childId !== scope.childId || decoded.context.kind !== 'handover-source-history'
            || retained.childId !== scope.childId || retained.evidence.module !== historyResourceForContent(kind) || retained.resource.id !== intent.assetId
            || decoded.context.id !== sourceHistoryId(scope, retained) || data.ref('handover_source_history', decoded.context.kind, decoded.context.id).path !== entry.ref.path)
            domainReject('erasure_binding', 500);
          if (retained.resource.version <= intent.content!.throughVersion) writes.push(() => tx.delete(entry.ref));
        } else {
          const receipt = firestoreOnlineRecordSchema.safeParse(decoded.value);
          if (!receipt.success || isFirestoreOnlinePending(receipt.data) || receipt.data.childId !== scope.childId) continue;
          const pointer = contentPointerSchema.safeParse(receipt.data.result);
          const input = kind === 'private_source' ? privateInputReceiptTarget(receipt.data.path, receipt.data.result) : null;
          const target: { kind: ContentErasureKind; id: string; version: number } | null = input ? { ...input, kind: 'private_source' }
            : pointer.success ? pointer.data : contentResult(receipt.data.path, receipt.data.result);
          if (target?.kind === intent.content!.kind && target.id === intent.assetId && target.version <= intent.content!.throughVersion) {
            const sealed = data.seal('online-receipt', decoded.context.id, decoded.context.scope, firestoreOnlineRecordSchema, { ...receipt.data, result: null });
            writes.push(() => tx.set(entry.ref, { ...data.tags(decoded.context.scope), ...sealed }));
          }
        }
      }
      const next = { ...value, journal: descriptor, after: rows.size === 25 ? value.stage === 'revisions' ? String(rows.docs.at(-1)!.get('entityVersion')) : rows.docs.at(-1)!.id : null,
        stage: rows.size === 25 ? value.stage : value.stage === 'revisions'
          ? 'source_history' as const
          : value.stage === 'source_history' ? 'receipts' as const : 'summary_revisions' as const };
      for (const write of writes) write();
      tx.set(row.ref, { ...data.tags(scope), stage: next.stage, ...data.seal('content-erasure', id, scope, contentErasureSchema, next) });
    });
  }
  async function backfill(row: DocumentSnapshot) {
    const raw = row.data()!, opened = openRecoveryEnvelope({ ...options, locator: raw.recovery,
      envelope: { family: 'domain', version: raw.version, recordVersion: raw.recordVersion, ciphertext: raw.ciphertext } });
    const { context } = opened, body = opened.value as { version: number; operationId?: string; deletedAt?: string };
    const kind: ContentErasureKind | null = context.kind === 'care-tombstone' ? 'care' : context.kind === 'shared-input-tombstone' ? 'private_source' : context.kind === 'memory-tombstone'
      ? row.ref.path.startsWith(options.namespace + '_memory_facts/') ? 'fact' : 'topic'
      : context.kind === 'child-profile' && Number(raw.historyFloor) > 1 ? 'profile' : null;
    if (!kind) return;
    if (kind === 'private_source') {
      const deleted = z.object({ id: z.uuid(), childId: z.uuid(), version: z.number().int().positive(), operationId: z.uuid(), deletedAt: z.iso.datetime({ offset: true }) }).parse(body);
      if (deleted.id !== context.id || deleted.childId !== context.scope.childId || deleted.version !== raw.recordVersion
        || data.ref('shared_inputs', 'shared-input', context.id).path !== row.ref.path) domainReject('erasure_binding', 500);
    }
    const throughVersion = kind === 'profile' ? Number(raw.historyFloor) - 1 : body.version - 1;
    const hash = firestoreDomainHash(['legacy-content-erasure', context.scope, kind, context.id, throughVersion]);
    const deterministic = hash.slice(0, 8) + '-' + hash.slice(8, 12) + '-5' + hash.slice(13, 16) + '-8' + hash.slice(17, 20) + '-' + hash.slice(20, 32);
    const opId = kind === 'private_source' ? privateSourceErasureOperationId(context.scope, context.id, throughVersion, body.operationId!)
      : body.operationId ?? deterministic, target = data.ref('content_erasures', 'content-erasure', opId);
    await options.database.runTransaction(async tx => {
      if (!(await authority.readControl(tx)).enabled) return;
      const current = await tx.get(row.ref), prior = await tx.get(target);
      if (prior.exists || !current.exists || firestoreDomainHash(current.data()) !== firestoreDomainHash(raw)) return;
      const value = contentErasureSchema.parse({ intent: { type: 'content-delete', scope: context.scope, assetId: context.id, operationId: opId,
        at: kind === 'private_source' ? body.deletedAt! : new Date().toISOString(), content: { kind, throughVersion,
          ...(kind === 'private_source' ? { sourceOperationId: body.operationId! } : {}) } }, journal: null, stage: 'revisions', after: null });
      tx.create(target, { ...data.tags(context.scope), stage: value.stage, ...data.seal('content-erasure', opId, context.scope, contentErasureSchema, value) });
    });
  }
  return { advance, backfill };
}
