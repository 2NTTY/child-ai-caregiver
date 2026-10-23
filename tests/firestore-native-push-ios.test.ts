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
import { createFirestoreContact } from '../server/firestore-contact.ts';
import { createFirestoreAccountExport } from '../server/firestore-account-export.ts';
import { FirestoreDomainData } from '../server/firestore-domain-data.ts';
import { firestoreBackgroundWorkSchema } from '../server/firestore-background-work.ts';
import { restoreOperationRecord } from '../server/firestore-restore-operation-records.ts';
import { openRecoveryEnvelope } from '../server/firestore-recovery-envelope.ts';
import { createNativePushApi } from '../src/client/native-push-api.ts';
import { createOnlineTransport } from '../src/client/online-transport.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { nativePushBindingV2Schema, nativePushStatusV2Schema } from '../src/shared/native-push.ts';
import type { NativePushGateway } from '../server/native-push-gateway.ts';
import type { FirebaseAuthPort } from '../server/firebase-auth.ts';

test('iOS v2 shares original receipts and device authority while old Android remains strict and independent', async t => {
  const fake = firestoreDomainFixture(), options = { database: fake.database, cipher: createStorageCipher(Buffer.alloc(32, 74)),
    projectId: 'synthetic-ios-push', namespace: 'ios_push_case' };
  const authority = createFirestoreAuthority(options), data = new FirestoreDomainData(options);
  await authority.initializeControl({ generation: randomUUID(), enabled: true });
  for (const userId of ['parent', 'other']) {
    const email = userId + '@example.test';
    await authority.issueInvitation({ email, expiresAt: new Date(Date.now() + 60_000).toISOString(), operationId: randomUUID() });
    await authority.admitIdentity({ userId, email, emailVerified: true });
    await authority.acknowledge({ userId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  }
  const child = (await authority.createChild({ userId: 'parent', displayName: 'Synthetic child', operationId: randomUUID() })).child;
  const sessions = new FirestoreDeviceSessions({ ...options, namespace: 'ios_device_sessions' });
  const keys = { ios: { userId: 'parent', sessionHash: 'a'.repeat(64) }, android: { userId: 'parent', sessionHash: 'b'.repeat(64) },
    other: { userId: 'other', sessionHash: 'c'.repeat(64) } };
  for (const key of Object.values(keys)) await sessions.issue({ ...key, expiresAtMs: Date.now() + 86400_000, authTimeSeconds: Math.floor(Date.now() / 1000) });
  let current: keyof typeof keys = 'android', native = true, iosSends = 0, fcmSends = 0;
  let outcome: 'accepted' | 'unknown' = 'accepted';
  const token = 'AB'.repeat(32), binding = { topic: 'org.yuyoufang.app', environment: 'production' as const };
  const gateway: NativePushGateway = { available: true,
    send: async () => { fcmSends++; throw new Error('Unexpected FCM send'); },
    apns: { available: true, binding, send: async (sent, reference, _signal, authorized) => {
      assert.equal(sent, token.toLowerCase()); assert.equal(reference.kind, 'test'); assert.equal(await authorized(), true); iosSends++;
      return { status: outcome, reason: outcome === 'unknown' ? 'transport_unknown' : null, providerStatus: outcome === 'accepted' ? 200 : null };
    } } };
  const currentAuth = async () => ({ disabled: false, emailVerified: true });
  const store = createFirestoreNativePush({ ...options, sessions, gateway, currentAuth });
  const online = createFirestoreOnlineStore({ ...options, mutations: [store.mutation] }), origin = 'https://ios.example.test';
  const handler = createFirebaseRequestHandler({ authority, online, nativePush: store, publicOrigin: origin, mailConfigured: false,
    auth: { getSession: async () => ({ user: { id: keys[current].userId } }), nativeSessionProof: async () => native ? keys[current] : null,
      handler: async () => new Response(null, { status: 404 }) } as unknown as FirebaseAuthPort });
  let lost = false, submissions = 0;
  const fetcher: typeof fetch = async (url, init) => {
    const response = await handler(new Request(url, { ...init, headers: { ...init?.headers, origin } }));
    if (String(url).endsWith('/online/submit')) {
      submissions++;
      if (lost && response.ok) { lost = false; throw new Error('Synthetic lost reply'); }
    }
    return response;
  };
  const signal = new AbortController().signal, oldApi = createNativePushApi(origin, fetcher);
  const android = await oldApi.register({ token: 'synthetic-fcm-token-untouched', label: 'Android' }, signal, 'parent');
  const transport = createOnlineTransport(origin + '/api', fetcher);
  const command = { path: '/api/native-push/v2/subscriptions', payload: { platform: 'ios', token, label: 'iPhone' } };
  const mutate = (path: string, payload: Record<string, unknown>) => transport.submit({ path, payload }, signal, keys[current].userId);
  const view = async () => {
    const response = await fetcher(origin + '/api/native-push/v2', { headers: { 'x-expected-user-id': keys[current].userId } });
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(response.status, 200); return nativePushStatusV2Schema.parse(await response.json());
  };
  current = 'ios'; lost = true;
  await assert.rejects(transport.submit(command, signal, 'parent'));
  const beforeLookup = submissions, receipt = await transport.checkPending(signal, 'parent');
  assert.equal(submissions, beforeLookup); assert.equal(receipt?.state, 'confirmed');
  assert.ok(receipt && receipt.state === 'confirmed');
  const ios = nativePushBindingV2Schema.parse((receipt.result as { binding: unknown }).binding);
  assert.equal(ios.platform, 'ios'); assert.equal(ios.provider, 'apns');
  const replay = await fetcher(origin + '/api/online/operations/' + receipt.operation.opId, { headers: { 'x-expected-user-id': 'parent' } });
  assert.deepEqual((await replay.json()).result, receipt.result);
  assert.deepEqual((await view()).availablePlatforms, { android: true, ios: true });
  assert.equal((await view()).currentBindingId, ios.id);
  assert.equal((await view()).bindings.length, 2);
  const repeated = await transport.submit({ ...command, payload: { ...command.payload, token: token.toLowerCase() } }, signal, 'parent') as { binding: unknown };
  assert.deepEqual(repeated.binding, ios);
  current = 'android'; const oldView = await oldApi.status(signal, 'parent');
  assert.deepEqual(oldView.bindings.map(v => v.id), [android.id]); assert.equal(oldView.currentBindingId, android.id);
  assert.equal('availablePlatforms' in oldView, false);
  await assert.rejects(oldApi.revoke(ios.id, ios.version, signal, 'parent'));
  current = 'ios'; native = false;
  await assert.rejects(transport.submit(command, signal, 'parent')); native = true;
  current = 'other'; assert.equal((await view()).bindings.length, 0);
  await assert.rejects(transport.submit(command, signal, 'other')); current = 'ios';
  await assert.rejects(mutate(command.path, { ...command.payload, platform: 'android', bindingId: ios.id,
    expectedVersion: ios.version, expectedTokenRevision: ios.tokenRevision }));
  const unavailable = { ...gateway, available: false };
  const onlyIos = createFirestoreNativePush({ ...options, sessions, gateway: unavailable, currentAuth });
  assert.equal((await onlyIos.status('parent', keys.ios, 2)).available, true);
  // Read real contact eligibility with FCM unavailable; no substitute contact tools or provider call.
  const contact = createFirestoreContact({ ...options, nativePush: onlyIos, nativePushGateway: unavailable,
    push: {} as any, telegram: {} as any, pushGateway: { publicKey: null } as any, telegramGateway: {} as any,
    telegramBotId: null, growth: { taskAllowedIn: async () => true }, runs: () => { throw Error('No Agent run in this check'); }, currentAuth });
  assert.deepEqual((await contact.page('parent', child.id)).availableBindings.map(v => v.bindingId), [ios.id]);
  const jobFor = async (id: string) => authority.runTransaction('parent', null, async b => {
    let query = data.collection('background_work');
    for (const [key, value] of Object.entries(data.tags(b.scope))) query = query.where(key, '==', value);
    const rows = await b.transaction.get(query.limit(10));
    for (const row of rows.docs) {
      const job = data.open('background-work', row.get('id'), b.scope, firestoreBackgroundWorkSchema, row);
      if (job.resourceId === id) return job;
    }
    throw Error('Missing original job');
  });
  const sendTest = async () => {
    const result = await mutate(command.path + '/' + ios.id + '/test', { expectedVersion: ios.version, confirmImmediate: true }) as { delivery: { id: string } };
    return jobFor(result.delivery.id);
  };
  const first = await sendTest();
  assert.equal((await onlyIos.process(first, signal)).state, 'completed');
  assert.equal((await onlyIos.process(first, signal)).state, 'completed'); assert.equal(iosSends, 1); assert.equal(fcmSends, 0);
  assert.equal((await oldApi.status(signal, 'parent')).deliveries.length, 0);
  assert.equal((await view()).deliveries[0].status, 'accepted');
  const opened = await oldApi.open({ v: 1, kind: 'test', bindingId: ios.id, bindingVersion: ios.version, deliveryId: first.resourceId }, signal, 'parent');
  assert.equal(opened.kind, 'test');
  let now = Date.now(); t.mock.method(Date, 'now', () => now); now += 61_000;
  outcome = 'unknown'; const second = await sendTest();
  assert.equal((await store.process(second, signal)).state, 'unknown');
  assert.equal((await store.process(second, signal)).state, 'unknown'); assert.equal(iosSends, 2);
  const changedGateway = { ...gateway, apns: { ...gateway.apns!, binding: { ...binding, environment: 'sandbox' as const } } };
  const changedStore = createFirestoreNativePush({ ...options, sessions, gateway: changedGateway, currentAuth });
  const changedOnline = createFirestoreOnlineStore({ ...options, mutations: [changedStore.mutation] });
  const rotate = { ...command, payload: { ...command.payload, bindingId: ios.id, expectedVersion: ios.version, expectedTokenRevision: ios.tokenRevision } };
  const ctx = await changedOnline.context('parent', rotate);
  await assert.rejects(changedOnline.submit('parent', { ...rotate, operation: { workspaceId: ctx.workspaceId,
    storageEpoch: ctx.storageEpoch, opId: randomUUID(), deviceId: randomUUID() } }, { nativeSession: keys.ios }));
  now += 61_000; const third = await sendTest();
  assert.equal((await changedStore.process(third, signal)).state, 'stopped'); assert.equal(iosSends, 2);
  const exported = await createFirestoreAccountExport({ ...options, photos: {} as any }).page('parent', { section: 'native_push_bindings' });
  assert.ok(!JSON.stringify(exported).includes(token.toLowerCase())); assert.ok(!JSON.stringify(exported).includes(keys.ios.sessionHash));
  await authority.runTransaction('parent', null, async b => {
    const row = await b.transaction.get(data.ref('native_push_bindings', 'native-push-binding', ios.id)), raw = row.data()!;
    const opened = openRecoveryEnvelope({ ...options, locator: raw.recovery, envelope: { family: 'domain', version: raw.version, recordVersion: raw.recordVersion, ciphertext: raw.ciphertext } });
    const restored = restoreOperationRecord(data, { ...opened.context, kind: 'native-push-binding' }, firestoreNativeBindingSchema.parse(opened.value), { ...b.scope, storageEpoch: randomUUID() });
    const value = firestoreNativeBindingSchema.parse(restored.value);
    assert.equal(value.binding.status, 'revoked'); assert.equal(value.token, null); assert.deepEqual(value.apns, binding);
  });
  await sessions.revokeThis(keys.ios);
  await assert.rejects(oldApi.open({ v: 1, kind: 'test', bindingId: ios.id, bindingVersion: ios.version, deliveryId: first.resourceId }, signal, 'parent'));
});
