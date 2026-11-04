import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreBackgroundQueue, type FirestoreBackgroundDelivery, type FirestoreBackgroundWork } from '../server/firestore-background-work.ts';
import { createKnowledgeIndexBatches } from '../server/firestore-knowledge-index-batches.ts';
import { FirestoreKnowledgeError } from '../server/firestore-knowledge.ts';

test('admin rebuild stops between pages, fences the old lease and preserves partial results across resume and replay', async () => {
  const options = { database: serialFirestoreFixture().database, cipher: createStorageCipher(Buffer.alloc(32, 178)), projectId: 'synthetic-index', namespace: 'test_index' };
  const authority = createFirestoreAuthority(options);
  await authority.initializeControl({ enabled: true, generation: randomUUID() });
  const actor = 'admin-one', first = randomUUID(), bad = randomUUID(), calls: number[] = [];
  const readControl = authority.readControl.bind(authority);
  const store = createKnowledgeIndexBatches(options, {
    async listVersions() { return { items: [], nextVersionId: null }; },
    async rebuildSearchPageIn(_tx, id, _hash, start) {
      if (id === bad) throw new FirestoreKnowledgeError('knowledge_review_version_mismatch');
      assert.equal(id, first); calls.push(start);
      return { complete: start === 192, bucketsCompleted: start + 64, bucketsTotal: 256, termCount: 1 };
    }
  }, readControl, actor);
  const command = { opId: randomUUID(), targets: [first, bad].map(versionId => ({ versionId, versionHash: 'a'.repeat(64) })) };
  await assert.rejects(store.create('other', command), (e: any) => e.code === 'forbidden');
  const job = (await store.create(actor, command)).batch;
  assert.equal(job.id, command.opId);
  await assert.rejects(store.create(actor, { ...command, targets: command.targets.slice(0, 1) }), (e: any) => e.code === 'operation_conflict');
  let phase = 0, stale: FirestoreBackgroundWork;
  const received: FirestoreBackgroundDelivery[] = [];
  const queue = createFirestoreBackgroundQueue({
    ...options, enabled: true, readControl, transport: {
      async enqueue(v) { received.push(v); return { state: 'confirmed' }; }, async probe() { return { state: 'confirmed' }; }
    }, async execute(work, signal) {
      if (phase++ === 0) {
        stale = work;
        const page = await store.process(work, signal, true); assert.equal(page.state, 'deferred');
        await store.process(work, signal, true); assert.deepEqual(calls, [0]);
        const stop = { opId: randomUUID(), expectedControlVersion: 1 };
        const paused = await store.control(actor, job.id, 'stop', stop);
        assert.deepEqual(await store.control(actor, job.id, 'stop', stop), paused);
        assert.equal(paused.batch.targets[0].bucketsCompleted, 64);
        assert.equal((await store.process(work, signal, true)).state, 'stopped');
        return { state: 'stopped' };
      }
      assert.equal((await store.process(stale, signal, true)).state, 'stopped');
      return store.process(work, signal, true);
    }
  });
  const tick = async () => { await queue.dispatch(); assert.equal(received.length, 1); return queue.process(received.shift()!); };
  const original = Date.now; let clock = original();
  try {
    Date.now = () => clock;
    await tick();
    await assert.rejects(store.control(actor, job.id, 'resume', { opId: randomUUID(), expectedControlVersion: 1 }), (e: any) => e.code === 'version_conflict');
    await store.control(actor, job.id, 'resume', { opId: randomUUID(), expectedControlVersion: 2 });
    for (let n = 0; n < 4; n++) { clock += 10000; await tick(); }
    const latest = (await store.get(job.id)).batch!;
    assert.equal(latest.state, 'failed'); assert.deepEqual(latest.targets.map(t => t.state), ['completed', 'failed']);
    assert.equal(latest.targets[1].error, 'knowledge_review_version_mismatch');
    assert.deepEqual(calls, [0, 64, 128, 192]);
    assert.deepEqual((await store.create(actor, command)).batch, latest);
    assert.deepEqual((await store.list(null)).items, [latest]);
    assert.equal((await store.get(randomUUID())).batch, null);
  } finally { Date.now = original; }
});
