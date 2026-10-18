import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { FirestoreDeviceSessions } from '../server/firestore-device-sessions.ts';
import { createFirestoreNativePush, firestoreNativeBindingSchema } from '../server/firestore-native-push.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirebaseRequestHandler } from '../server/firebase-app.ts';
import { createNativePushApi } from '../src/client/native-push-api.ts';
import type { FirebaseAuthPort } from '../server/firebase-auth.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { FirestoreDomainData } from '../server/firestore-domain-data.ts';
import { firestoreBackgroundWorkSchema } from '../server/firestore-background-work.ts';
import { readNotificationHistory } from '../server/firestore-notification-history.ts';
import { restoreOperationRecord } from '../server/firestore-restore-operation-records.ts';
import { openRecoveryEnvelope } from '../server/firestore-recovery-envelope.ts';
import { createFirestoreAccountExport } from '../server/firestore-account-export.ts';

test('native push uses the formal API, original receipts, device authority and restored revocation', async t => {
  const fake = firestoreDomainFixture(), options = { database: fake.database, cipher: createStorageCipher(Buffer.alloc(32, 63)),
    projectId: 'synthetic-native-push', namespace: 'native_push_case' };
  const authority = createFirestoreAuthority(options), data = new FirestoreDomainData(options);
  await authority.initializeControl({ generation: randomUUID(), enabled: true });
  for (const userId of ['parent','other']) {
    const email = userId + '@example.test';
    await authority.issueInvitation({ email, expiresAt: new Date(Date.now() + 60_000).toISOString(), operationId: randomUUID() });
    await authority.admitIdentity({ userId, email, emailVerified: true });
    await authority.acknowledge({ userId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  }
  const sessions = new FirestoreDeviceSessions({ ...options, namespace: 'native_push_sessions' });
  const keys = { parent: { userId: 'parent', sessionHash: 'a'.repeat(64) }, other: { userId: 'other', sessionHash: 'b'.repeat(64) } };
  for (const key of Object.values(keys)) await sessions.issue({ ...key, expiresAtMs: Date.now() + 86400_000, authTimeSeconds: Math.floor(Date.now()/1000) });
  let sends = 0, deliveryOutcome: 'accepted' | 'unknown' = 'accepted', user: keyof typeof keys = 'parent', native = true;
  const store = createFirestoreNativePush({ ...options, sessions, currentAuth: async () => ({ disabled: false, emailVerified: true }),
    gateway: { available: true, send: async (_token, _reference, _signal, authorized) => {
      if (!await authorized()) return { status: 'stopped', reason: 'revoked', providerStatus: null };
      sends++; return { status: deliveryOutcome, reason: deliveryOutcome === 'unknown' ? 'transport_unknown' : null, providerStatus: deliveryOutcome === 'accepted' ? 200 : null };
    } } });
  const online = createFirestoreOnlineStore({ ...options, mutations: [store.mutation] }), origin = 'https://synthetic.invalid';
  const handler = createFirebaseRequestHandler({ authority, online, nativePush: store, publicOrigin: origin, mailConfigured: false,
    auth: { getSession: async () => ({ user: { id: user } }), nativeSessionProof: async () => native ? keys[user] : null,
      handler: async () => new Response(null, { status: 404 }) } as unknown as FirebaseAuthPort });
  let loseReply = true;
  const api = createNativePushApi(origin, async (url, init) => {
    const response = await handler(new Request(url, { ...init, headers: { ...init?.headers, origin } }));
    if (loseReply && String(url).endsWith('/online/submit') && response.ok) { loseReply = false; throw new Error('synthetic lost response'); }
    return response;
  });
  const signal = new AbortController().signal, token = 'synthetic-fcm-token-' + '1'.repeat(30);
  await assert.rejects(api.register({ token, label: 'My Android' }, signal, user));
  assert.equal(api.hasPendingOnline(), true);
  assert.equal((await api.reconcilePending(signal, user))?.state, 'confirmed');
  let view = await api.status(signal, user); assert.equal(view.bindings.length, 1);
  const first = view.bindings[0]; assert.equal(view.currentBindingId, first.id);
  assert.ok(!JSON.stringify(view).includes(token));
  const unchanged = await api.register({ token, label: 'My Android' }, signal, user); assert.equal(unchanged.id, first.id);
  native = false;
  await assert.rejects(api.register({ token: token+'forged', label: 'No native proof' }, signal, user), e => (e as any).status === 403);
  native = true; user = 'other';
  await assert.rejects(api.register({ token, label: 'Other account' }, signal, user));
  assert.equal((await api.status(signal, user)).bindings.length, 0); user = 'parent';
  const rotated = await api.register({ token: token+'rotation', label: 'My Android', bindingId: first.id, expectedVersion: first.version, expectedTokenRevision: first.tokenRevision }, signal, user);
  assert.equal(rotated.version, first.version); assert.equal(rotated.tokenRevision, 2);
  await assert.rejects(api.register({ token: token+'stale', label: 'Stale', bindingId: first.id, expectedVersion: first.version, expectedTokenRevision: first.tokenRevision }, signal, user), e => (e as any).status === 409);
  const jobFor = async (id: string) => authority.runTransaction('parent', null, async b => {
    const rows = await b.transaction.get(data.collection('background_work').limit(10));
    for (const row of rows.docs) {
      const job = data.open('background-work', row.get('id'), b.scope, firestoreBackgroundWorkSchema, row);
      if (job.resourceId === id) return job;
    }
    throw new Error('missing original job');
  });
  const firstDelivery = await api.test(first.id, first.version, signal, user), firstJob = await jobFor(firstDelivery.id);
  assert.equal((await store.process(firstJob, signal)).state, 'completed');
  assert.equal((await store.process(firstJob, signal)).state, 'completed'); assert.equal(sends, 1);
  const target = await api.open({ v: 1, kind: 'test', bindingId: first.id, bindingVersion: first.version, deliveryId: firstDelivery.id }, signal, user);
  assert.equal(target.kind, 'test');
  const history = await authority.runTransaction(user, null, b => readNotificationHistory(options, b));
  assert.ok(history.items.some((entry: any) => entry.channel === 'native_push' && entry.id === firstDelivery.id));
  let now = Date.now(); t.mock.method(Date, 'now', () => now); now += 61_000;
  deliveryOutcome = 'unknown';
  const uncertain = await api.test(first.id, first.version, signal, user), unknownJob = await jobFor(uncertain.id);
  assert.equal((await store.process(unknownJob, signal)).state, 'unknown');
  assert.equal((await store.process(unknownJob, signal)).state, 'unknown'); assert.equal(sends, 2);
  now += 61_000;
  const stopped = await api.test(first.id, first.version, signal, user), stoppedJob = await jobFor(stopped.id);
  await sessions.revokeThis(keys.parent);
  assert.equal((await store.process(stoppedJob, signal)).state, 'stopped'); assert.equal(sends, 2);
  await assert.rejects(api.open({ v: 1, kind: 'test', bindingId: first.id, bindingVersion: first.version, deliveryId: firstDelivery.id }, signal, user));
  // The same physical token can move only after the previous session loses authority.
  user = 'other'; const replacement = await api.register({ token: token+'rotation', label: 'Other Android' }, signal, user);
  assert.notEqual(replacement.id, first.id);
  assert.equal((await store.status('parent')).bindings[0].status, 'revoked');
  const exported = await createFirestoreAccountExport({ ...options, photos: { content: async () => { throw new Error('unused'); } } as any }).page(user, { section: 'native_push_bindings' });
  assert.ok(!JSON.stringify(exported).includes(token)); assert.ok(!JSON.stringify(exported).includes(keys.other.sessionHash));
  await authority.runTransaction(user, null, async b => {
    const row = await b.transaction.get(data.ref('native_push_bindings', 'native-push-binding', replacement.id)), raw = row.data()!;
    const opened = openRecoveryEnvelope({ ...options, locator: raw.recovery, envelope: { family: 'domain', version: raw.version, recordVersion: raw.recordVersion, ciphertext: raw.ciphertext } });
    const restored = restoreOperationRecord(data, { ...opened.context, kind: 'native-push-binding' }, firestoreNativeBindingSchema.parse(opened.value), { ...b.scope, storageEpoch: randomUUID() });
    const restoredValue = firestoreNativeBindingSchema.parse(restored.value);
    assert.equal(restoredValue.binding.status, 'revoked'); assert.equal(restoredValue.token, null);
  });
  assert.equal(sends, 2);
});
