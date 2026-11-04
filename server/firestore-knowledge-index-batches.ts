import type { DocumentSnapshot, Transaction } from '@google-cloud/firestore';
import { z } from 'zod';
import {
  FirestoreDomainData, domainParse, domainReject, firestoreDomainHash, FIRESTORE_TASK_DISPATCH_SCOPE as SYSTEM,
  type FirestoreDomainOptions
} from './firestore-domain-data.ts';
import { firestoreBackgroundWorkSchema, prepareFirestoreBackgroundWork, type FirestoreBackgroundWork } from './firestore-background-work.ts';
import { FirestoreKnowledgeError, type FirestoreKnowledgeStore } from './firestore-knowledge.ts';
import {
  indexBatchCreateSchema, indexBatchControlSchema, indexBatchSchema, indexBatchReceiptSchema,
  indexBatchSort, indexBatchView, type IndexBatch
} from './knowledge-index-batch-records.ts';

const batches = 'knowledge_index_batches', receipts = 'knowledge_index_receipts';
const jobKind = 'knowledge-index-batch', receiptKind = 'knowledge-index-receipt';
const timestamp = () => new Date(Date.now()).toISOString();
type Corpus = Pick<FirestoreKnowledgeStore, 'listVersions' | 'rebuildSearchPageIn'>;
type Control = (tx: Transaction) => Promise<{ generation: string; enabled: boolean }>;
const deferred = () => ({ state: 'deferred' as const, nextAt: new Date(Date.now() + 5000).toISOString() });
export function createKnowledgeIndexBatches(options: FirestoreDomainOptions, corpus: Corpus, readControl: Control, adminUid: string | null) {
  const data = new FirestoreDomainData(options), db = options.database;
  const jobRef = (id: string) => data.ref(batches, jobKind, id);
  function requireAdmin(actorId: string) { if (!adminUid || actorId !== adminUid) domainReject('forbidden', 403); }
  function open(id: string, snap: DocumentSnapshot) {
    if (!snap.exists) return null;
    const job = data.open(jobKind, id, SYSTEM, indexBatchSchema, snap);
    if (snap.id !== jobRef(id).id || job.id !== id || snap.get('batchId') !== id || snap.get('sort') !== indexBatchSort(job)
      || job.recordVersion !== snap.get('recordVersion')) domainReject('knowledge_batch_binding', 503);
    return job;
  }
  function save(tx: Transaction, job: IndexBatch) {
    tx.set(jobRef(job.id), {
      ...data.tags(SYSTEM), batchId: job.id, sort: indexBatchSort(job),
      ...data.seal(jobKind, job.id, SYSTEM, indexBatchSchema, job, job.recordVersion)
    });
  }
  async function workFor(tx: Transaction, job: IndexBatch) {
    const snap = await tx.get(data.ref('background_work', 'background-work', job.workId));
    if (!snap.exists) domainReject('knowledge_batch_work_missing', 503);
    const work = data.open('background-work', job.workId, SYSTEM, firestoreBackgroundWorkSchema, snap);
    if (work.id !== job.workId || work.kind !== jobKind || work.resourceId !== job.id || work.generation !== job.generation
      || work.authorizationVersion !== firestoreDomainHash(job.actorId) || work.basis !== String(job.controlVersion)
      || firestoreDomainHash(work.scope) !== firestoreDomainHash(SYSTEM)) domainReject('knowledge_batch_work_invalid', 503);
    return work;
  }
  async function effective(tx: Transaction, job: IndexBatch, control: Awaited<ReturnType<Control>>) {
    if (job.state !== 'running') return job;
    if (job.generation !== control.generation || job.actorId !== adminUid) return { ...job, state: 'interrupted' as const };
    const work = await workFor(tx, job);
    return ['unknown', 'stopped', 'failed', 'completed'].includes(work.state) || ['conflict', 'needs_attention'].includes(work.dispatch)
      ? { ...job, state: 'interrupted' as const } : job;
  }
  async function command(actorId: string, id: string, action: 'create' | 'stop' | 'resume', raw: unknown) {
    requireAdmin(actorId);
    const input = action === 'create' ? domainParse(indexBatchCreateSchema, raw) : domainParse(indexBatchControlSchema, raw);
    const signature = firestoreDomainHash([actorId, id, action, input]);
    const receiptRef = data.ref(receipts, receiptKind, input.opId);
    return db.runTransaction(async tx => {
      const control = await readControl(tx);
      const prior = await tx.get(receiptRef), stored = open(id, await tx.get(jobRef(id)));
      if (prior.exists) {
        const receipt = data.open(receiptKind, input.opId, SYSTEM, indexBatchReceiptSchema, prior);
        if (receipt.fingerprint !== signature || receipt.actorId !== actorId || receipt.batchId !== id || receipt.opId !== input.opId)
          domainReject('operation_conflict');
        if (!stored) domainReject('knowledge_batch_missing', 503);
        return { batch: indexBatchView(await effective(tx, stored, control)) };
      }
      let job: IndexBatch;
      const now = timestamp();
      if ('targets' in input) {
        if (stored || id !== input.opId) domainReject('operation_conflict');
        job = {
          id, state: 'running', controlVersion: 1, recordVersion: 1, actorId, generation: control.generation, createdAt: now, updatedAt: now,
          workId: '', lastDispatchRevision: 0, targets: input.targets.map(t => ({ ...t, state: 'pending', bucketsCompleted: 0, error: null }))
        };
      } else {
        if (!stored) domainReject('knowledge_batch_not_found', 404);
        const current = await effective(tx, stored, control);
        if (input.expectedControlVersion !== current.controlVersion) domainReject('version_conflict');
        if (action === 'stop' ? current.state !== 'running' : !['paused', 'interrupted'].includes(current.state)) domainReject('knowledge_batch_state');
        job = {
          ...current, actorId, generation: control.generation, controlVersion: current.controlVersion + 1, recordVersion: current.recordVersion + 1,
          lastDispatchRevision: 0, updatedAt: now, state: action === 'stop' ? 'paused' : 'running'
        };
      }
      if (job.state === 'running') {
        if (!control.enabled) domainReject('knowledge_worker_paused');
        const work = await prepareFirestoreBackgroundWork(data, tx, {
          kind: jobKind, scope: SYSTEM, resourceId: id, basis: String(job.controlVersion),
          generation: control.generation, authorizationVersion: firestoreDomainHash(actorId)
        }, now);
        job.workId = work.id; work.commit();
      }
      save(tx, job);
      const receipt = { opId: input.opId, batchId: id, actorId, action, fingerprint: signature, controlVersion: job.controlVersion, at: now };
      tx.create(receiptRef, { ...data.tags(SYSTEM), ...data.seal(receiptKind, input.opId, SYSTEM, indexBatchReceiptSchema, receipt) });
      return { batch: indexBatchView(job) };
    });
  }
  return {
    versions(cursor: string | null) { return corpus.listVersions(cursor === null ? undefined : domainParse(z.uuid(), cursor)); },
    create(actorId: string, raw: unknown) { const input = domainParse(indexBatchCreateSchema, raw); return command(actorId, input.opId, 'create', input); },
    control(actorId: string, id: string, action: 'stop' | 'resume', raw: unknown) { return command(actorId, domainParse(z.uuid(), id), action, raw); },
    async get(rawId: string) {
      const id = domainParse(z.uuid(), rawId);
      return db.runTransaction(async tx => {
        const job = open(id, await tx.get(jobRef(id)));
        return { batch: job ? indexBatchView(await effective(tx, job, await readControl(tx))) : null };
      }, { readOnly: true });
    },
    async list(cursor: string | null) {
      const id = cursor === null ? null : domainParse(z.uuid(), cursor);
      return db.runTransaction(async tx => {
        let query = data.collection(batches).orderBy('sort', 'desc').limit(21);
        if (id) { const prior = open(id, await tx.get(jobRef(id))); if (!prior) domainReject('invalid_cursor', 400); query = query.startAfter(indexBatchSort(prior)); }
        const control = await readControl(tx), page = await tx.get(query);
        const items = await Promise.all(page.docs.slice(0, 20).map(async row => {
          const batch = open(domainParse(z.uuid(), row.get('batchId'), 'knowledge_batch_binding', 503), row)!;
          return indexBatchView(await effective(tx, batch, control));
        }));
        return { items, nextCursor: page.size > 20 ? items[19].id : null };
      }, { readOnly: true });
    },
    async process(work: FirestoreBackgroundWork, signal: AbortSignal, actorVerified: boolean) {
      const stopped = { state: 'stopped' as const };
      if (signal.aborted || !work.lease || work.kind !== jobKind || firestoreDomainHash(work.scope) !== firestoreDomainHash(SYSTEM)) return stopped;
      return db.runTransaction(async tx => {
        const control = await readControl(tx), job = open(work.resourceId, await tx.get(jobRef(work.resourceId)));
        if (!job || job.state !== 'running' || job.workId !== work.id || !control.enabled || control.generation !== job.generation
          || job.generation !== work.generation || job.actorId !== adminUid || !actorVerified) return stopped;
        const live = await workFor(tx, job);
        const leaseValid = () => !signal.aborted && live.state === 'leased' && live.lease?.token === work.lease?.token
          && live.dispatchRevision === work.dispatchRevision && !!live.lease && Date.parse(live.lease.until) > Date.now();
        if (!leaseValid()) return stopped;
        if (job.lastDispatchRevision === live.dispatchRevision) return deferred();
        const target = job.targets.find(t => t.state === 'pending');
        if (!target) domainReject('knowledge_batch_binding', 503);
        try {
          const page = await corpus.rebuildSearchPageIn(tx, target.versionId, target.versionHash, target.bucketsCompleted);
          target.bucketsCompleted = page.bucketsCompleted;
          if (page.complete) target.state = 'completed';
        } catch (error) {
          // Only definitive source checks thrown before any index write may complete a failed item.
          if (!(error instanceof FirestoreKnowledgeError) || !['knowledge_version_unknown', 'knowledge_review_version_mismatch',
            'knowledge_source_internal_review_required', 'knowledge_version_unreviewed', 'knowledge_search_prefix_incomplete'].includes(error.code)) throw error;
          target.state = 'failed'; target.error = error.code;
        }
        if (!leaseValid()) domainReject('knowledge_batch_claim_expired');
        if (job.targets.every(t => t.state !== 'pending')) job.state = job.targets.some(t => t.state === 'failed') ? 'failed' : 'completed';
        save(tx, { ...job, recordVersion: job.recordVersion + 1, updatedAt: timestamp(), lastDispatchRevision: live.dispatchRevision });
        return job.state === 'running' ? deferred() : { state: 'completed' as const };
      });
    }
  };
}
export type KnowledgeIndexBatches = ReturnType<typeof createKnowledgeIndexBatches>;
