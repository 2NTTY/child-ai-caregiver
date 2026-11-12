import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Firestore } from '@google-cloud/firestore';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { FirestoreDomainData } from '../server/firestore-domain-data.ts';
import { FirestoreDeviceSessions } from '../server/firestore-device-sessions.ts';
import { createFirestoreNativePush } from '../server/firestore-native-push.ts';
import { createFirestoreChatStore } from '../server/firestore-chat.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirestoreBackgroundQueue, firestoreBackgroundWorkSchema,
  type FirestoreBackgroundDelivery } from '../server/firestore-background-work.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';

async function fixture() {
  const fake = firestoreDomainFixture();
  // The serial fixture supplies transaction queries; expose the same read to the scheduled scan.
  function query(raw: any): any { return new Proxy(raw, { get(target, key) {
    if (key === 'get') return () => fake.database.runTransaction(tx => tx.get(target));
    const value = target[key];
    return typeof value === 'function' ? (...args: any[]) => {
      const result = value(...args); return result?.query ? query(result) : result;
    } : value;
  } }); }
  const database = { ...fake.database, collection: (path: string) => query(fake.database.collection(path)) } as Firestore;
  const options = { database, cipher: createStorageCipher(Buffer.alloc(32, 95)),
    projectId: 'synthetic-immediate', namespace: 'native_immediate' };
  const authority = createFirestoreAuthority(options), data = new FirestoreDomainData(options), userId = 'synthetic-parent';
  await authority.initializeControl({ enabled: true, generation: randomUUID() });
  await authority.issueInvitation({ email: 'parent@example.test', expiresAt: new Date(Date.now() + 60_000).toISOString(), operationId: randomUUID() });
  await authority.admitIdentity({ userId, email: 'parent@example.test', emailVerified: true });
  await authority.acknowledge({ userId, policyVersion: SERVICE_POLICY_VERSION, operationId: randomUUID() });
  const childId = (await authority.createChild({ userId, displayName: 'Synthetic child', operationId: randomUUID() })).child.id;
  const personalScope = await authority.runTransaction(userId, null, async b => b.scope);
  const sessions = new FirestoreDeviceSessions({ ...options, namespace: 'native_immediate_sessions', serverClock: () => Date.now() });
  const session = { userId, sessionHash: 'a'.repeat(64) };
  await sessions.issue({ ...session, expiresAtMs: Date.now() + 86400_000, authTimeSeconds: Math.floor(Date.now() / 1000) });
  const enqueued: FirestoreBackgroundDelivery[] = [], probed: FirestoreBackgroundDelivery[] = [];
  const nativeJobs = new Set<string>();
  let sends = 0, failEnqueue = false;
  let queue: ReturnType<typeof createFirestoreBackgroundQueue>;
  const store = createFirestoreNativePush({ ...options, sessions,
    currentAuth: async () => ({ disabled: false, emailVerified: true }),
    dispatchChatWork: async (id: string) => {
      nativeJobs.add(id);
      // Reading the original work here also proves that no transport ran inside the write transaction.
      const job = await readJob(id); assert.equal(job.kind, 'native-push');
      return queue.dispatchOne(id);
    },
    gateway: { available: true, send: async (_token, _reference, _signal, authorized) => {
      assert.equal(await authorized(), true); sends++; return { status: 'accepted', reason: null, providerStatus: 200 };
    } },
  });
  queue = createFirestoreBackgroundQueue({ ...options, enabled: true, readControl: tx => authority.readControl(tx),
    transport: { enqueue: async job => {
      if (nativeJobs.has(job.id)) { enqueued.push(job); if (failEnqueue) throw Error('Synthetic first transport failure'); }
      return { state: 'confirmed' };
    }, probe: async job => { if (nativeJobs.has(job.id)) probed.push(job); return { state: 'confirmed' }; } },
    execute: (job, signal) => store.process(job, signal) });
  const online = createFirestoreOnlineStore({ ...options, mutations: [store.mutation] });
  const path = '/api/native-push/subscriptions', payload = { token: 'synthetic-native-immediate-token', label: 'Synthetic phone' };
  const operation = { ...await online.context(userId, { path, payload }), opId: randomUUID(), deviceId: randomUUID() };
  await online.submit(userId, { path, payload, operation }, { nativeSession: session });
  async function presence(child: string | null, enabled = true) {
    const view = await store.readChatPresence(userId, session);
    return store.setChatPresence(userId, session, { childId: child, expectedPresenceVersion: view.presenceVersion, chatNotificationsEnabled: enabled });
  }
  await presence(null);
  const chat = createFirestoreChatStore({ ...options, notifications: store });
  async function contact(opId = randomUUID(), commit = true) {
    return authority.runTransaction(userId, childId, async b => {
      const prepared = await chat.prepareParentContact(b, { origin: 'demo', opId, text: 'Synthetic saved message' });
      if (commit) prepared.commit();
      return prepared.receipt;
    });
  }
  async function readJob(id: string) {
    return database.runTransaction(async tx => {
      const row = await tx.get(data.ref('background_work', 'background-work', id));
      assert.ok(row.exists, 'Only committed original work can be dispatched');
      return data.open('background-work', id, personalScope, firestoreBackgroundWorkSchema, row);
    });
  }
  return { ...fake, options, authority, data, store, queue, enqueued, probed, presence, contact, readJob, childId,
    sends: () => sends, failEnqueue: () => { failEnqueue = true; } };
}

test('native chat immediate dispatch runs once after the winning commit and preserves the original receipt', async t => {
  t.mock.method(Date, 'now', () => Date.parse('2026-11-12T04:00:00Z'));
  const f = await fixture(), opId = randomUUID();
  await f.contact(randomUUID(), false); assert.equal(f.enqueued.length, 0);
  f.failCommit(); await assert.rejects(f.contact()); assert.equal(f.enqueued.length, 0);
  f.retry(); const receipt = await f.contact(opId);
  assert.equal(f.enqueued.length, 1, 'The winning committed chat must dispatch without waiting for the minute scan');
  const job = await f.readJob(f.enqueued[0]!.id);
  assert.equal(job.resourceId, receipt.deliveryIds[0]);
  assert.equal(job.dispatch, 'confirmed');
  await Promise.all([f.queue.dispatchOne(job.id), f.queue.dispatchOne(job.id)]);
  assert.deepEqual(await f.contact(opId), receipt);
  assert.equal(f.enqueued.length, 1, 'Receipt replay must not create or dispatch a second work');
  assert.equal(f.sends(), 0, 'Immediate dispatch only schedules the original worker; it does not send a push');
});

test('native chat immediate dispatch failure preserves the saved receipt and minute-scan recovery', async t => {
  let clock = Date.parse('2026-11-12T04:00:00Z'); t.mock.method(Date, 'now', () => clock);
  const f = await fixture(); f.failEnqueue();
  const receipt = await f.contact();
  assert.equal(f.enqueued.length, 1);
  assert.equal((await f.readJob(f.enqueued[0]!.id)).resourceId, receipt.deliveryIds[0]);
  clock += 61_000; await f.queue.dispatch();
  assert.equal(f.enqueued.length, 1, 'An uncertain first enqueue must not create another Task');
  assert.deepEqual(f.probed, f.enqueued);
  assert.equal((await f.readJob(f.enqueued[0]!.id)).dispatch, 'confirmed');
});

for (const deferredBy of ['foreground', 'quiet'] as const) test(`native chat immediate dispatch reschedules the original ${deferredBy} deferral without sending early`, async t => {
  let clock = Date.parse(deferredBy === 'quiet' ? '2026-11-12T15:00:00Z' : '2026-11-12T04:00:00Z');
  t.mock.method(Date, 'now', () => clock);
  const f = await fixture();
  if (deferredBy === 'foreground') { await f.presence(f.childId); clock += 8_000; }
  await f.contact(); assert.equal(f.enqueued.length, 1);
  assert.equal((await f.queue.process(f.enqueued[0]!)).state, 'pending');
  assert.equal(f.enqueued.length, 2, 'A legitimate deferral must schedule its original work immediately after updating dueAt');
  const [first, next] = f.enqueued;
  assert.equal(next!.id, first!.id);
  assert.equal(next!.dispatchRevision, first!.dispatchRevision + 1);
  assert.ok(Date.parse(next!.scheduledAt) > clock);
  assert.equal((await f.queue.process(next!)).state, 'busy');
  assert.equal(f.sends(), 0);
  clock = Date.parse(next!.scheduledAt) + 1;
  assert.equal((await f.queue.process(next!)).state, 'completed');
  assert.equal(f.sends(), 1);
  await f.queue.process(next!); assert.equal(f.sends(), 1);
});
