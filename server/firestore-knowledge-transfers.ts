import type { DocumentSnapshot, Transaction } from '@google-cloud/firestore';
import { FirestoreDomainData, FIRESTORE_TASK_DISPATCH_SCOPE as SYSTEM, type FirestoreDomainOptions } from './firestore-domain-data.ts';
import { adminTransferView, transferBatchSchema, transferResultSchema, transferItemId, type KnowledgeTransferBatch } from './knowledge-transfer-records.ts';
import { adminTransferDigestSchema, adminTransferPageSize } from '../src/shared/admin-knowledge-transfer.ts';
import { FirestoreKnowledgeError, type FirestoreKnowledgeImportCommit } from './firestore-knowledge.ts';

const collection = 'knowledge_transfers', batchKind = 'knowledge-transfer-batch', resultKind = 'knowledge-transfer-result';
const reject = (code: string): never => { throw new FirestoreKnowledgeError(code); };
const now = () => new Date().toISOString();
type Entry = { sourceId: string; versionHash: string };
type Control = (tx: Transaction) => Promise<{ enabled: boolean; generation: string }>;
export function createKnowledgeTransfers(options: FirestoreDomainOptions, readControl: Control) {
  const data = new FirestoreDomainData(options), db = options.database;
  const batchRef = (id: string) => data.ref(collection, batchKind, id);
  const resultRef = (id: string, index: number) => data.ref(collection, resultKind, transferItemId(id, index));
  function openBatch(snap: DocumentSnapshot, id: string) {
    if (snap.id !== batchRef(id).id) return reject('knowledge_transfer_binding_invalid');
    const job = data.open(batchKind, id, SYSTEM, transferBatchSchema, snap);
    if (job.id !== id || job.revision !== snap.get('recordVersion')) return reject('knowledge_transfer_binding_invalid');
    return job;
  }
  async function read(tx: Transaction, id: string) {
    if (!adminTransferDigestSchema.safeParse(id).success) return reject('knowledge_transfer_digest_invalid');
    const snap = await tx.get(batchRef(id));
    return snap.exists ? openBatch(snap, id) : null;
  }
  function write(tx: Transaction, job: KnowledgeTransferBatch) {
    tx.set(batchRef(job.id), { ...data.tags(SYSTEM), transferDigest: job.id, ...data.seal(batchKind, job.id, SYSTEM, transferBatchSchema, job, job.revision) });
    return job;
  }
  async function current(tx: Transaction, expected: KnowledgeTransferBatch) {
    const live = await read(tx, expected.id), control = await readControl(tx);
    if (!live || live.revision !== expected.revision || live.next !== expected.next || live.state !== 'ready'
      || !control.enabled || live.generation !== control.generation) return reject('knowledge_transfer_changed');
    return live;
  }
  async function readResults(tx: Transaction, job: KnowledgeTransferBatch, from: number, limit: number) {
    const count = Math.max(0, Math.min(limit, job.next - from));
    if (!count) return [];
    const snaps = await tx.getAll(...Array.from({ length: count }, (_, offset) => resultRef(job.id, from + offset)));
    return snaps.map((snap, offset) => {
      const index = from + offset;
      const row = data.open(resultKind, transferItemId(job.id, index), SYSTEM, transferResultSchema, snap);
      if (row.id !== job.id || row.index !== index) return reject('knowledge_transfer_binding_invalid');
      return row;
    });
  }
  return {
    list(cursor: string | null) {
      if (cursor !== null && !adminTransferDigestSchema.safeParse(cursor).success) return reject('knowledge_transfer_digest_invalid');
      return db.runTransaction(async tx => {
        let query = data.collection(collection).where('transferDigest', '>=', '0'.repeat(64)).orderBy('transferDigest').limit(adminTransferPageSize + 1);
        if (cursor !== null) query = query.startAfter(cursor);
        const page = await tx.get(query);
        const items = page.docs.slice(0, adminTransferPageSize).map(snap => {
          const id = adminTransferDigestSchema.parse(snap.get('transferDigest'));
          return adminTransferView(openBatch(snap, id));
        });
        return { items, nextCursor: page.size > adminTransferPageSize ? items.at(-1)!.id : null };
      }, { readOnly: true });
    },
    page(id: string, from: number) {
      if (!Number.isInteger(from) || from < 0 || from > 4096) return reject('knowledge_transfer_page_invalid');
      return db.runTransaction(async tx => {
        const job = await read(tx, id);
        if (!job) throw new FirestoreKnowledgeError('knowledge_transfer_unknown', 404);
        const rows = await readResults(tx, job, from, adminTransferPageSize);
        const items = rows.map(({ id: _id, operator: _operator, ...item }) => item);
        const next = from + items.length;
        return { batch: adminTransferView(job), items, nextFrom: next < job.next ? next : null };
      }, { readOnly: true });
    },
    get(id: string) { return db.runTransaction(tx => read(tx, id), { readOnly: true }); },
    start(id: string, total: number, actor: string) {
      return db.runTransaction(async tx => {
        const prior = await read(tx, id);
        if (prior) {
          if (prior.total !== total) return reject('knowledge_transfer_binding_invalid');
          return prior;
        }
        const control = await readControl(tx);
        if (!control.enabled) return reject('knowledge_transfer_maintenance');
        return write(tx, { id, total, next: 0, state: 'ready', revision: 1, generation: control.generation,
          lastOperator: actor, updatedAt: now(), lastFailure: null });
      });
    },
    control(id: string, action: 'stop' | 'resume', revision: number, actor: string) {
      return db.runTransaction(async tx => {
        const job = await read(tx, id), control = await readControl(tx);
        if (!job || job.revision !== revision || job.state === 'completed') return reject('knowledge_transfer_changed');
        if (action === 'resume' && !control.enabled) return reject('knowledge_transfer_maintenance');
        const state = action === 'stop' ? 'stopped' : 'ready';
        if (job.state === state && job.generation === control.generation) return job;
        return write(tx, { ...job, state, generation: control.generation, revision: revision + 1, lastOperator: actor, updatedAt: now() });
      });
    },
    fence(expected: KnowledgeTransferBatch, entry: Entry, actor: string): FirestoreKnowledgeImportCommit {
      return async (tx, edition) => {
        const job = await current(tx, expected);
        if (edition.sourceId !== entry.sourceId || edition.hash !== entry.versionHash) return reject('knowledge_transfer_binding_invalid');
        const index = job.next, at = now(), id = transferItemId(job.id, index);
        const result = { id: job.id, index, sourceId: entry.sourceId, versionHash: entry.versionHash, versionId: edition.versionId,
          unchanged: edition.unchanged, editionState: edition.state, operator: actor, at };
        tx.create(resultRef(job.id, index), { ...data.tags(SYSTEM), ...data.seal(resultKind, id, SYSTEM, transferResultSchema, result) });
        write(tx, { ...job, next: index + 1, state: index + 1 === job.total ? 'completed' : 'ready',
          revision: job.revision + 1, lastOperator: actor, updatedAt: at });
      };
    },
    fail(expected: KnowledgeTransferBatch, entry: Entry, reason: string, actor: string) {
      return db.runTransaction(async tx => {
        const job = await current(tx, expected), at = now();
        return write(tx, { ...job, state: 'failed', revision: job.revision + 1, lastOperator: actor, updatedAt: at,
          lastFailure: { index: job.next, sourceId: entry.sourceId, reason, at } });
      });
    },
    results(id: string, from: number, limit: number) {
      if (!Number.isInteger(from) || from < 0 || !Number.isInteger(limit) || limit < 1 || limit > 50) return reject('knowledge_transfer_page_invalid');
      return db.runTransaction(async tx => {
        const job = await read(tx, id);
        if (!job) return reject('knowledge_transfer_unknown');
        return readResults(tx, job, from, limit);
      }, { readOnly: true });
    }
  };
}
