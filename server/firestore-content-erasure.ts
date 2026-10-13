import { FieldPath, type DocumentSnapshot } from '@google-cloud/firestore';
import { z } from 'zod';
import { createFirestoreAuthority, type FirestoreAuthorityTransaction } from './firestore-authority.ts';
import { FirestoreDomainData, domainReject, firestoreDomainHash, type FirestoreDomainOptions } from './firestore-domain-data.ts';
import { firebaseErasureIntentSchema, firebaseErasureDescriptorSchema, firebaseErasureIntentHash, type FirebaseErasureJournal } from './firebase-erasure-journal.ts';
import { contentPointerSchema, contentResult, type ContentKind } from './firestore-disclosure.ts';
import { firestoreOnlineRecordSchema, isFirestoreOnlinePending } from './firestore-online-receipts.ts';
import { openRecoveryEnvelope } from './firestore-recovery-envelope.ts';

export const contentErasureSchema = z.object({ intent: firebaseErasureIntentSchema.refine(v => v.type === 'content-delete'),
  journal: firebaseErasureDescriptorSchema.nullable(), stage: z.enum(['revisions', 'receipts', 'done']), after: z.string().nullable() }).strict();
export const contentHistory = { care: ['care_revisions', 'care-revision'], profile: ['profile_revisions', 'profile-revision'],
  fact: ['memory_fact_revisions', 'memory-fact-revision'], topic: ['memory_topic_revisions', 'memory-topic-revision'] } as const;
export function prepareContentErasure(data: FirestoreDomainData, binding: FirestoreAuthorityTransaction,
  kind: ContentKind, id: string, throughVersion: number, operationId: string) {
  const value = contentErasureSchema.parse({ intent: { type: 'content-delete', scope: binding.scope, assetId: id, operationId,
    at: new Date().toISOString(), content: { kind, throughVersion } }, journal: null, stage: 'revisions', after: null });
  const ref = data.ref('content_erasures', 'content-erasure', operationId);
  return () => binding.transaction.create(ref, { ...data.tags(binding.scope), stage: value.stage,
    ...data.seal('content-erasure', operationId, binding.scope, contentErasureSchema, value) });
}
/** Bounded, resumable physical cleanup. The independent journal survives business backup rollback. */
export function createFirestoreContentErasure(options: FirestoreDomainOptions & { journal: Pick<FirebaseErasureJournal, 'writeOnce' | 'read'> }) {
  const data = new FirestoreDomainData(options), authority = createFirestoreAuthority(options);
  function open(row: DocumentSnapshot) {
    const raw = row.data()!;
    const opened = openRecoveryEnvelope({ ...options, locator: raw.recovery,
      envelope: { family: 'domain', version: raw.version, recordVersion: raw.recordVersion, ciphertext: raw.ciphertext } });
    if (opened.context.kind !== 'content-erasure' || data.ref('content_erasures', 'content-erasure', opened.context.id).path !== row.ref.path)
      domainReject('erasure_binding', 500);
    return { scope: opened.context.scope, id: opened.context.id, value: contentErasureSchema.parse(opened.value) };
  }
  async function advance(row: DocumentSnapshot) {
    const original = open(row); if (original.value.stage === 'done') return;
    const intent = original.value.intent, descriptor = original.value.journal ?? await options.journal.writeOnce(intent);
    if (firebaseErasureIntentHash(await options.journal.read(intent, descriptor)) !== firebaseErasureIntentHash(intent)) domainReject('erasure_binding', 500);
    await options.database.runTransaction(async tx => {
      if (!(await authority.readControl(tx)).enabled) return;
      const current = await tx.get(row.ref); if (!current.exists) return;
      const { scope, id, value } = open(current); if (value.stage === 'done') return;
      if (firebaseErasureIntentHash(value.intent) !== firebaseErasureIntentHash(intent)) domainReject('erasure_binding', 500);
      const [suffix] = contentHistory[intent.content!.kind], tags = data.tags(scope);
      let q = data.collection(value.stage === 'revisions' ? suffix : 'online_operations')
        .where('workspaceTag', '==', tags.workspaceTag).where('epochTag', '==', tags.epochTag).where('userTag', '==', tags.userTag);
      if (value.stage === 'revisions') q = q.where('childTag', '==', tags.childTag).where('entityId', '==', intent.assetId);
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
          if (decoded.context.scope.childId !== scope.childId || decoded.context.kind !== contentHistory[intent.content!.kind][1]) domainReject('erasure_binding', 500);
          const revision = z.object({ version: z.number().int().positive() }).passthrough().parse(decoded.value);
          if (revision.version <= intent.content!.throughVersion) writes.push(() => tx.delete(entry.ref));
        } else {
          const receipt = firestoreOnlineRecordSchema.safeParse(decoded.value);
          if (!receipt.success || isFirestoreOnlinePending(receipt.data) || receipt.data.childId !== scope.childId) continue;
          const pointer = contentPointerSchema.safeParse(receipt.data.result);
          const target = pointer.success ? pointer.data : contentResult(receipt.data.path, receipt.data.result);
          if (target?.kind === intent.content!.kind && target.id === intent.assetId && target.version <= intent.content!.throughVersion) {
            const sealed = data.seal('online-receipt', decoded.context.id, decoded.context.scope, firestoreOnlineRecordSchema, { ...receipt.data, result: null });
            writes.push(() => tx.set(entry.ref, { ...data.tags(decoded.context.scope), ...sealed }));
          }
        }
      }
      const next = { ...value, journal: descriptor, after: rows.size === 25 ? value.stage === 'revisions' ? String(rows.docs.at(-1)!.get('entityVersion')) : rows.docs.at(-1)!.id : null,
        stage: rows.size === 25 ? value.stage : value.stage === 'revisions' ? 'receipts' as const : 'done' as const };
      for (const write of writes) write();
      tx.set(row.ref, { ...data.tags(scope), stage: next.stage, ...data.seal('content-erasure', id, scope, contentErasureSchema, next) });
    });
  }
  async function backfill(row: DocumentSnapshot) {
    const raw = row.data()!, opened = openRecoveryEnvelope({ ...options, locator: raw.recovery,
      envelope: { family: 'domain', version: raw.version, recordVersion: raw.recordVersion, ciphertext: raw.ciphertext } });
    const { context } = opened, body = opened.value as { version: number; operationId?: string };
    const kind: ContentKind | null = context.kind === 'care-tombstone' ? 'care' : context.kind === 'memory-tombstone'
      ? row.ref.path.startsWith(options.namespace + '_memory_facts/') ? 'fact' : 'topic'
      : context.kind === 'child-profile' && Number(raw.historyFloor) > 1 ? 'profile' : null;
    if (!kind) return;
    const throughVersion = kind === 'profile' ? Number(raw.historyFloor) - 1 : body.version - 1;
    const hash = firestoreDomainHash(['legacy-content-erasure', context.scope, kind, context.id, throughVersion]);
    const deterministic = hash.slice(0, 8) + '-' + hash.slice(8, 12) + '-5' + hash.slice(13, 16) + '-8' + hash.slice(17, 20) + '-' + hash.slice(20, 32);
    const opId = body.operationId ?? deterministic, target = data.ref('content_erasures', 'content-erasure', opId);
    await options.database.runTransaction(async tx => {
      if (!(await authority.readControl(tx)).enabled) return;
      const current = await tx.get(row.ref), prior = await tx.get(target);
      if (prior.exists || !current.exists || firestoreDomainHash(current.data()) !== firestoreDomainHash(raw)) return;
      const value = contentErasureSchema.parse({ intent: { type: 'content-delete', scope: context.scope, assetId: context.id, operationId: opId,
        at: new Date().toISOString(), content: { kind, throughVersion } }, journal: null, stage: 'revisions', after: null });
      tx.create(target, { ...data.tags(context.scope), stage: value.stage, ...data.seal('content-erasure', opId, context.scope, contentErasureSchema, value) });
    });
  }
  return { advance, backfill };
}
