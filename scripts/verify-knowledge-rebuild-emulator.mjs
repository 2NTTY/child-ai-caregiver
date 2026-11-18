import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { Firestore } from '@google-cloud/firestore';
import { createFirestoreKnowledgeStore } from '../server/firestore-knowledge.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createKnowledgeIndexBatches } from '../server/firestore-knowledge-index-batches.ts';
import { createFirestoreBackgroundQueue } from '../server/firestore-background-work.ts';
import { parseKnowledgeSource } from '../server/knowledge-inputs.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { buildLocalOfficialSeedAssessment } from './local-knowledge-assessments.ts';

const host = process.env.FIRESTORE_EMULATOR_HOST;
assert.match(host ?? '', /^127\.0\.0\.1:[1-9]\d{0,4}$/, 'Set FIRESTORE_EMULATOR_HOST to a loopback emulator');
const projectId = 'demo-p4-knowledge';
const database = new Firestore({ projectId, host, ssl: false });
const options = { projectId, database, namespace: 'verify_' + randomBytes(6).toString('hex'), cipher: createStorageCipher(randomBytes(32)) };
const load = async name => JSON.parse(await readFile(new URL('../knowledge/' + name, import.meta.url), 'utf8'));
try {
  const sources = (await load('hk-official-seed.json')).map(source => parseKnowledgeSource(source));
  const manifest = await load('local-development-seed.json');
  const store = createFirestoreKnowledgeStore({ ...options, sourceIds: sources.map(s => s.sourceId) });
  const authority = createFirestoreAuthority(options);
  const actor = 'local-index-operator';
  await authority.initializeControl({ generation: randomUUID(), enabled: true });
  const readControl = authority.readControl.bind(authority);
  const jobs = createKnowledgeIndexBatches(options, store, readControl, actor);
  const targets = [];
  for (const source of sources) {
    const { versionId, hash } = await store.importSource(source);
    await store.review(versionId, hash, actor, buildLocalOfficialSeedAssessment(source, manifest));
    targets.push({ versionId, versionHash: hash });
  }

  const deliveries = [];
  let pageCount = 0, processingMs = 0;
  const queue = createFirestoreBackgroundQueue({ ...options, enabled: true, readControl,
    transport: {
      async enqueue(delivery) { deliveries.push(delivery); return { state: 'confirmed' }; },
      async probe() { throw Error('Unexpected transport probe in isolated run'); },
    },
    async execute(work, signal) {
      const start = performance.now();
      const result = await jobs.process(work, signal, true);
      processingMs += performance.now() - start;
      pageCount++;
      return result;
    },
  });
  const started = performance.now();
  const command = { opId: randomUUID(), targets };
  const { batch } = await jobs.create(actor, command);
  let result = batch;
  while (result.state === 'running' && performance.now() - started < 240000) {
    await queue.dispatch();
    const delivery = deliveries.shift();
    if (delivery) {
      await delay(Math.max(0, Date.parse(delivery.scheduledAt) - Date.now()));
      const outcome = await queue.process(delivery);
      assert.ok(['pending', 'completed'].includes(outcome.state), 'Unexpected worker outcome: ' + outcome.state);
      result = (await jobs.get(batch.id)).batch;
    }
    if (result.state === 'running') await delay(1000);
  }
  assert.equal(result.state, 'completed');
  assert.ok(result.targets.every(target => target.state === 'completed' && target.bucketsCompleted > 0));
  assert.equal((await jobs.create(actor, command)).batch.id, batch.id);
  const { items, nextVersionId } = await store.listVersions();
  assert.equal(nextVersionId, null);
  assert.equal(items.length, targets.length);
  for (const target of targets) {
    const item = items.find(version => version.id === target.versionId);
    assert.equal(item?.hash, target.versionHash);
    assert.ok(item.searchReady);
    assert.equal(item.publishedAt, null);
  }
  console.log(JSON.stringify({ sources: targets.length, chunks: sources.reduce((sum, s) => sum + s.chunks.length, 0),
    pages: pageCount, processingMs: Math.round(processingMs), elapsedMs: Math.round(performance.now() - started),
    replaySameBatch: true }, null, 2));
} finally {
  await database.terminate();
}
