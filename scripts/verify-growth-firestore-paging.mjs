import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { Firestore } from '@google-cloud/firestore';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { FirestoreDomainData } from '../server/firestore-domain-data.ts';
import { createFirestoreCareStore } from '../server/firestore-care.ts';
import { createFirestoreChatStore } from '../server/firestore-chat.ts';
import { createFirestoreMemoryStore } from '../server/firestore-memory.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirestoreGrowthStore, firestoreGrowthSchema } from '../server/firestore-growth.ts';
import { handleGrowthRequest } from '../server/growth-api.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createGrowthApi } from '../src/client/growth-api.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { makeGrowthItem } from '../tests/helpers/growth-item.ts';

const cloud = process.argv[2] === '--cloud';
assert.ok(cloud || process.argv.length === 2);
if (cloud) assert.ok(!process.env.FIRESTORE_EMULATOR_HOST);
else assert.match(process.env.FIRESTORE_EMULATOR_HOST ?? '', /^127\.0\.0\.1:\d+$/);
const projectId = cloud ? 'ai-caregivers-for-children' : process.env.GCLOUD_PROJECT;
if (!cloud) assert.match(projectId ?? '', /^demo-/);
const databaseId = cloud ? 'yuban-firebase-20261011' : '(default)';
const db = new Firestore({ projectId, databaseId });
const namespace = 'yuban_authority', id = randomUUID();
const root = db.collection('req005_growth_verification').doc(id);
// Collection IDs keep the installed product indexes; every data read and write is below this fresh fixture.
const database = {
  collection(name) {
    assert.match(name, /^yuban_authority(?:_[a-z0-9_]+)?$/);
    return root.collection(name);
  },
  runTransaction: db.runTransaction.bind(db),
};
const options = { projectId, namespace, database, cipher: createStorageCipher(randomBytes(32)) };
const authority = createFirestoreAuthority(options), data = new FirestoreDomainData(options);
const care = createFirestoreCareStore(options), chat = createFirestoreChatStore(options);
const memory = createFirestoreMemoryStore({ ...options, care, chat });
const growth = createFirestoreGrowthStore({ ...options, care, memory, online: createFirestoreOnlineStore(options) });
const userId = 'paging-' + id, email = 'paging@example.test';
let created = false, phase = 'create-fixture', receipt;
try {
  await root.create({ purpose: 'req005-growth-paging', fixture: id });
  created = true;
  phase = 'synthetic-authority';
  await authority.initializeControl({ enabled: true, generation: randomUUID() });
  await authority.issueInvitation({ email, operationId: randomUUID(), expiresAt: new Date(Date.now() + 3600000).toISOString() });
  await authority.admitIdentity({ userId, email, emailVerified: true });
  await authority.acknowledge({ userId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  const { child } = await authority.createChild({ userId, operationId: randomUUID(), displayName: 'Paging fixture' });
  const rows = Array.from({ length: 32 }, (_, i) => makeGrowthItem({ childId: child.id, state: 'dismissed',
    title: 'REQ005 growth ' + (i + 1), updatedAt: '2026-10-01T12:00:00.000Z' }));
  phase = 'seed-tied-timestamps';
  await authority.runTransaction(userId, child.id, async b => {
    for (const item of rows) {
      const ref = data.ref('growth_attention', 'growth-attention', item.id);
      b.transaction.create(ref, { ...data.tags(b.scope), attentionId: item.id, createdAt: item.createdAt, entityVersion: item.version,
        ...data.seal('growth-attention', item.id, b.scope, firestoreGrowthSchema, { item, lastRequest: null }, item.version) });
    }
  });
  phase = 'build-reading-index';
  for (let page = 0; page < 3; page++) {
    const result = await growth.advanceReadingIndex(userId, child.id);
    if (result.state !== 'deferred') break;
    assert.ok(page < 2);
  }
  phase = 'page-through-product-api';
  const origin = 'http://127.0.0.1';
  const api = createGrowthApi(origin, (url, init) => {
    assert.equal(new URL(url).origin, origin);
    return handleGrowthRequest(new Request(url, init), userId, growth, async expected => expected === userId);
  });
  const signal = AbortSignal.timeout(60000);
  const first = await api.getPage(child.id, signal, userId);
  assert.equal(first.items.length, 30);
  assert.ok(first.historyHasMore && first.historyNextCursor);
  const second = await api.getPage(child.id, signal, userId, { historyCursor: first.historyNextCursor });
  assert.equal(second.historyHasMore, false);
  assert.equal(second.items.length, 2);
  const ids = [...first.items, ...second.items].map(row => row.id);
  assert.deepEqual(ids.toSorted(), rows.map(row => row.id).toSorted());
  receipt = { projectId, databaseId, fixture: id, equalTimestamps: rows.length, pageSizes: [first.items.length, second.items.length],
    unique: new Set(ids).size, missing: 0, scope: 'isolated-subcollections', route: 'growth-api', client: 'createGrowthApi' };
} catch (error) {
  console.error(JSON.stringify({ phase, code: error.code ?? error.name, message: String(error.message).split('\n')[0].slice(0, 290) }));
  process.exitCode = 1;
} finally {
  try {
    if (created) {
      const marker = await root.get();
      assert.equal(marker.get('fixture'), id);
      assert.equal(marker.get('purpose'), 'req005-growth-paging');
      for (const collection of await root.listCollections()) {
        const batch = db.batch(), docs = await collection.listDocuments();
        for (const doc of docs) {
          assert.equal(doc.parent.parent?.path, root.path);
          batch.delete(doc);
        }
        if (docs.length) await batch.commit();
      }
      await root.delete();
      assert.equal((await root.get()).exists, false);
      assert.equal((await root.listCollections()).length, 0);
      if (receipt) console.log(JSON.stringify({ ...receipt, cleaned: true }));
    }
  } finally { await db.terminate(); }
}
