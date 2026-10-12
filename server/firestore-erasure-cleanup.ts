import { createHash } from 'node:crypto';
import { FieldPath } from '@google-cloud/firestore';
import { z } from 'zod';
import { createFirestoreAuthority } from './firestore-authority.ts';
import { FIREBASE_BACKUP_COLLECTION_SUFFIXES } from './firestore-backup.ts';
import { domainReject, firestoreDomainHash } from './firestore-domain-data.ts';
import { firestoreOnlineErasureBarrierSchema } from './firestore-online-receipts.ts';
import { firebaseErasureIntentHash } from './firebase-erasure-journal.ts';
import { openRecoveryEnvelope, type OpenedRecoveryEnvelope } from './firestore-recovery-envelope.ts';
import { workRecoveryDocumentId } from './firestore-work-continuation-recovery.ts';
import { firestorePhotoSchemas, type createFirestorePhotoStore } from './firestore-photos.ts';
import { type FirestoreErasureOptions, type FirestoreErasureStore, type FirestoreScopeErasure } from './firestore-erasure.ts';

// New domains join the existing backup registry and must carry authenticated recovery scope.
const collections = FIREBASE_BACKUP_COLLECTION_SUFFIXES.filter(suffix => !['_erasures', '_erasure_receipts', '_sessions', '_adk', '_root_budget', '_ai_usage'].includes(suffix)
  && !suffix.startsWith('_knowledge_'));
const BATCH = 25;
export interface FirestoreErasureCleanupOptions extends FirestoreErasureOptions {
  erasures: FirestoreErasureStore;
  photos: Pick<ReturnType<typeof createFirestorePhotoStore>, 'eraseForScope'>;
  deleteAgentSession(userId: string, runId: string): Promise<void>;
  eraseAgentUserPage(userId: string): Promise<boolean>;
  /** Account-only ports are supplied by the runtime, with no product writes or notification sending. */
  eraseDeviceSessions(userId: string, cursor: string | null): Promise<{ cursor: string | null; complete: boolean }>;
  eraseAuthUser(userId: string): Promise<void>;
}
/** One bounded, retry-safe maintenance page. F06 dispatches it; callers never choose collections or raw document paths. */
export function createFirestoreErasureCleanup(options: FirestoreErasureCleanupOptions) {
  const { erasures, database } = options, clock = options.serverClock ?? Date.now, authority = createFirestoreAuthority(options);
  function decode(path: string, raw: any): OpenedRecoveryEnvelope {
    const family = raw?.format === 'yuban-work-recovery' ? 'authority' : raw?.format === 'yuban-firestore-domain' ? 'domain' : null;
    if (!family) domainReject('erasure_unsupported_envelope', 503);
    const opened = openRecoveryEnvelope({ ...options, locator: raw.recovery, envelope: {
      family, version: raw.version, ciphertext: raw.ciphertext, ...(family === 'domain' ? { recordVersion: raw.recordVersion } : {}) } });
    const { context } = opened;
    const suffix = path.split('/')[0].slice(options.namespace.length);
    const storageKind = context.kind === 'care-tombstone' && suffix === '_care_records' ? 'care-record'
      : context.kind === 'shared-input-tombstone' && suffix === '_shared_inputs' ? 'shared-input'
      : context.kind === 'memory-tombstone' && suffix === '_memory_facts' ? 'memory-fact'
      : context.kind === 'memory-tombstone' && suffix === '_memory_topics' ? 'memory-topic' : context.kind;
    const id = family === 'domain' ? firestoreDomainHash([storageKind, context.id]) : context.kind.startsWith('authority-')
      ? createHash('sha256').update(JSON.stringify([context.kind, context.id])).digest('hex')
      : workRecoveryDocumentId(context.kind as Parameters<typeof workRecoveryDocumentId>[0], context.id);
    if (path.split('/').at(-1) !== id) domainReject('erasure_document_binding', 503);
    return opened;
  }
  function matches(job: FirestoreScopeErasure, row: OpenedRecoveryEnvelope) {
    const scope = job.intent.scope, candidate = row.context.scope;
    if (job.intent.type === 'account-delete' && row.context.kind === 'authority-invitation')
      return (row.value as { consumedBy?: string }).consumedBy === scope.ownerUserId;
    if (scope.ownerUserId !== candidate.ownerUserId) return false;
    if (job.intent.type === 'account-delete') return true;
    if (row.context.kind === 'authority-operation') {
      const result = (row.value as any).result;
      // Child creation receipts are intentionally stored under the owner-wide NIL scope.
      if (result?.child?.id === scope.childId && result?.scope?.workspaceId === scope.workspaceId
        && result?.scope?.storageEpoch === scope.storageEpoch) return true;
    }
    if (scope.workspaceId !== candidate.workspaceId || scope.storageEpoch !== candidate.storageEpoch) return false;
    if (candidate.childId === scope.childId) return true;
    // Original owner-wide receipts must not retain copies of erased child content.
    const value = row.value as Record<string, any>;
    return ['online-receipt', 'authority-operation'].includes(row.context.kind)
      && (value.childId === scope.childId || value.result?.child?.id === scope.childId || value.result?.childId === scope.childId);
  }
  function retainBarrier(row: OpenedRecoveryEnvelope, job: FirestoreScopeErasure) {
    return ['account', 'child', 'workspace', 'authority-owner'].includes(row.context.kind)
      || row.context.kind === 'online-receipt' && (row.value as any).operation?.opId === job.intent.operationId;
  }
  function nextStage(stage: string) {
    if (stage === 'photos') return 'data:0';
    if (stage.startsWith('data:')) {
      const index = Number(stage.slice(5)) + 1;
      return index < collections.length ? 'data:' + index : 'device-sessions';
    }
    return stage === 'device-sessions' ? 'agent-user' : stage === 'agent-user' ? 'auth' : 'done';
  }
  async function load(owner: string, opId: string) {
    z.uuid().parse(opId);
    const job = await database.runTransaction(tx => erasures.read(tx, owner, opId));
    if (!job || !['blocked', 'cleaning', 'completed'].includes(job.state) || !job.journal) domainReject('erasure_not_blocked');
    await erasures.journal(job);
    return job;
  }
  async function checkpoint(previous: FirestoreScopeErasure, cursor: string | null, finished: boolean) {
    return database.runTransaction(async tx => {
      const owner = previous.intent.scope.ownerUserId, opId = previous.intent.operationId;
      const current = await erasures.read(tx, owner, opId);
      if (!current || JSON.stringify(current) !== JSON.stringify(previous)) domainReject('erasure_progress_changed');
      const stage = finished ? nextStage(previous.cleanup.stage) : previous.cleanup.stage;
      const updated: FirestoreScopeErasure = { ...current, state: stage === 'done' ? 'completed' : 'cleaning', cleanup: { stage, cursor } };
      tx.set(erasures.ref(owner, opId), erasures.seal(updated)); return erasures.result(updated);
    });
  }
  async function advance(owner: string, opId: string) {
    const job = await load(owner, opId); if (job.state === 'completed') return erasures.result(job);
    // Let already admitted bounded invocations finish their cancellation/teardown before physical collection.
    if (!job.blockedAt || clock() < Date.parse(job.blockedAt) + 120_000) return erasures.result(job);
    const stage = job.cleanup.stage;
    if (stage === 'device-sessions') {
      if (job.intent.type !== 'account-delete') return checkpoint(job, null, true);
      const page = await options.eraseDeviceSessions(owner, job.cleanup.cursor);
      return checkpoint(job, page.cursor, page.complete);
    }
    if (stage === 'auth') {
      if (job.intent.type === 'account-delete') await options.eraseAuthUser(owner);
      await authority.finishErasure(job.intent.scope, job.intent.type === 'account-delete' ? 'account' : 'child');
      return checkpoint(job, null, true);
    }
    if (stage === 'agent-user') {
      if (job.intent.type === 'account-delete' && !await options.eraseAgentUserPage(owner)) return erasures.result(job);
      return checkpoint(job, null, true);
    }
    const index = stage.startsWith('data:') ? Number(stage.slice(5)) : -1;
    if (stage !== 'photos' && (!Number.isInteger(index) || index < 0 || index >= collections.length)) domainReject('erasure_progress_invalid', 500);
    const suffix = stage === 'photos' ? '_photos' : collections[index];
    let query = database.collection(options.namespace + suffix).orderBy(FieldPath.documentId()).limit(BATCH);
    if (job.cleanup.cursor) query = query.startAfter(job.cleanup.cursor);
    const page = await query.get();
    for (const snapshot of page.docs) {
      const opened = decode(snapshot.ref.path, snapshot.data()); if (!matches(job, opened)) continue;
      if (stage === 'photos') {
        const photo = firestorePhotoSchemas.photo.parse(opened.value);
        if (!await options.photos.eraseForScope(photo.scope, photo.id, job.intent, job.journal!)) return erasures.result(job);
        continue;
      }
      if (retainBarrier(opened, job)) continue;
      if (opened.context.kind === 'agent-run' || opened.context.kind === 'run')
        await options.deleteAgentSession(owner, opened.context.id);
      await database.runTransaction(async tx => {
        const progress = await erasures.read(tx, owner, opId), current = await tx.get(snapshot.ref);
        if (!progress || progress.cleanup.stage !== stage || progress.cleanup.cursor !== job.cleanup.cursor) domainReject('erasure_progress_changed');
        if (!current.exists) return;
        const fresh = decode(current.ref.path, current.data());
        if (!matches(job, fresh) || retainBarrier(fresh, job)) domainReject('erasure_document_binding', 503);
        // Deleting these keys would let an old create operation acquire a new identity.
        if (fresh.context.kind === 'authority-operation') {
          await authority.redactOperation(tx, fresh.context.id, fresh.context.scope);
        } else if (fresh.context.kind === 'online-receipt') {
          const value = fresh.value as any;
          const operationId = value.operation?.opId ?? value.operationId;
          const barrier = { state: 'erasure_barrier' as const, ownerUserId: owner, operationId,
            childId: job.intent.scope.childId, assetId: job.intent.assetId, intentSha256: firebaseErasureIntentHash(job.intent) };
          const data = erasures.data;
          tx.set(current.ref, { ...data.tags(fresh.context.scope),
            ...data.seal('online-receipt', fresh.context.id, fresh.context.scope, firestoreOnlineErasureBarrierSchema, barrier) });
        } else tx.delete(current.ref);
      });
    }
    const complete = page.size < BATCH;
    return checkpoint(job, complete ? null : page.docs.at(-1)!.id, complete);
  }
  return { advance };
}
