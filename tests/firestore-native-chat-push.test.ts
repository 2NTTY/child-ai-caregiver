import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Query } from '@google-cloud/firestore';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { FirestoreDeviceSessions } from '../server/firestore-device-sessions.ts';
import { createFirestoreNativePush } from '../server/firestore-native-push.ts';
import { createNativePushGateway, type NativePushGateway } from '../server/native-push-gateway.ts';
import { parseNativePushData } from '../src/shared/native-push.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { FirestoreDomainData } from '../server/firestore-domain-data.ts';
import { firestoreChatMessageSchema } from '../server/chat-message-schema.ts';
import { firestoreBackgroundWorkSchema } from '../server/firestore-background-work.ts';
import { createNotificationPreferencesData } from '../server/firestore-notification-preferences.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { nativePushStatusSchema, nativePushStatusV2Schema } from '../src/shared/native-push.ts';
import type { NativePushBinding } from '../src/shared/native-push.ts';
import { createFirebaseRequestHandler } from '../server/firebase-app.ts';
import type { FirebaseAuthPort } from '../server/firebase-auth.ts';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';
import { createFirestoreErasureStore, type FirestoreScopeErasure } from '../server/firestore-erasure.ts';
import { createFirestoreErasureCleanup } from '../server/firestore-erasure-cleanup.ts';
import { FIREBASE_BACKUP_COLLECTION_SUFFIXES } from '../server/firestore-backup.ts';
import { firebaseErasureIntentHash, type FirebaseErasureIntent, type FirebaseErasureDescriptor } from '../server/firebase-erasure-journal.ts';
import { readNotificationHistory } from '../server/firestore-notification-history.ts';
import { createFirestoreChatStore } from '../server/firestore-chat.ts';
import { createFirestoreTaskWorker, firestoreTaskNotificationOutboxSchema, type FirestoreTaskDelivery } from '../server/firestore-task-worker.ts';
import type { CareTask } from '../src/shared/tasks.ts';
import { createProactiveWakes } from '../server/firestore-proactive-wakes.ts';

async function fixture(fake: Pick<ReturnType<typeof firestoreDomainFixture>, 'database' | 'records'> = firestoreDomainFixture(), gateway?: NativePushGateway) {
  const options = { database: fake.database, cipher: createStorageCipher(Buffer.alloc(32, 86)),
    projectId: 'synthetic-chat-push', namespace: 'chat_push_case' };
  const authority = createFirestoreAuthority(options), data = new FirestoreDomainData(options), userId = 'parent';
  await authority.initializeControl({ generation: randomUUID(), enabled: true });
  await authority.issueInvitation({ email: 'parent@example.test', expiresAt: new Date(Date.now() + 60_000).toISOString(), operationId: randomUUID() });
  await authority.admitIdentity({ userId, email: 'parent@example.test', emailVerified: true });
  await authority.acknowledge({ userId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  const childId = (await authority.createChild({ userId, displayName: 'Synthetic child', operationId: randomUUID() })).child.id;
  const otherChildId = (await authority.createChild({ userId, displayName: 'Other synthetic child', operationId: randomUUID() })).child.id;
  const sessions = new FirestoreDeviceSessions({ ...options, namespace: 'chat_push_sessions' });
  const keys = [{ userId, sessionHash: 'a'.repeat(64) }, { userId, sessionHash: 'b'.repeat(64) }];
  for (const key of keys) await sessions.issue({ ...key, expiresAtMs: Date.now() + 86400_000, authTimeSeconds: Math.floor(Date.now() / 1000) });
  const calls: { token: string; reference: any }[] = [];
  let beforeAuthorization: () => Promise<void> = async () => {};
  const store = createFirestoreNativePush({ ...options, sessions, currentAuth: async () => ({ disabled: false, emailVerified: true }),
    gateway: gateway ?? { available: true, send: async (token, reference, _signal, authorized) => {
      await beforeAuthorization();
      if (!await authorized()) return { status: 'stopped', reason: 'revoked', providerStatus: null };
      calls.push({ token, reference }); return { status: 'accepted', reason: null, providerStatus: 200 };
    } } });
  const online = createFirestoreOnlineStore({ ...options, mutations: [store.mutation] });
  const bindings: NativePushBinding[] = [];
  for (let index = 0; index < keys.length; index++) {
    const path = '/api/native-push/subscriptions', payload = { token: `synthetic-android-token-${index}`, label: `Phone ${index}` };
    const operation = { ...await online.context(userId, { path, payload }), deviceId: randomUUID(), opId: randomUUID() };
    bindings.push(((await online.submit(userId, { path, payload, operation }, { nativeSession: keys[index] })).result as any).binding);
  }
  const presence = async (index: number, child: string | null, enabled?: boolean) => {
    const current = await store.readChatPresence(userId, keys[index]!);
    return store.setChatPresence(userId, keys[index]!, { childId: child, bindingId: bindings[index]!.id,
      expectedPresenceVersion: current.presenceVersion, ...(enabled === undefined ? {} : { chatNotificationsEnabled: enabled }) });
  };
  async function prepare(messageId = randomUUID(), commit = true) {
    const ids = await authority.runTransaction(userId, childId, async b => {
      const prepared = await store.prepareChatDeliveries(b, messageId);
      const row = await b.transaction.get(data.ref('chat_messages', 'chat-message', messageId));
      if (commit) {
        if (!row.exists) {
          const message = { id: messageId, childId, authorUserId: null, role: 'model' as const, text: 'Private synthetic message',
            inReplyTo: randomUUID(), createdAt: new Date(Date.now()).toISOString() };
          b.transaction.create(data.ref('chat_messages', 'chat-message', messageId), { ...data.tags(b.scope), messageId,
            createdAt: message.createdAt, ...data.seal('chat-message', messageId, b.scope, firestoreChatMessageSchema, message) });
        }
        prepared.commit();
      }
      return prepared.ids;
    });
    return { messageId, ids };
  }
  async function jobFor(id: string) {
    return authority.runTransaction(userId, null, async b => {
      let query: Query = data.collection('background_work');
      for (const [key, value] of Object.entries(data.tags(b.scope))) query = query.where(key, '==', value);
      const found = await b.transaction.get(query.limit(20));
      for (const row of found.docs) {
        const job = data.open('background-work', row.get('id'), b.scope, firestoreBackgroundWorkSchema, row);
        if (job.resourceId === id) return job;
      }
      throw new Error('Missing chat delivery job');
    });
  }
  const statuses = (ids: string[], child: string | null = childId) => authority.runTransaction(userId, child, b => store.readChatDeliveryStatuses(b, ids));
  return { ...fake, options, authority, data, store, online, sessions, keys, bindings, userId, childId, otherChildId,
    presence, prepare, jobFor, statuses, calls, beforeAuthorization: (callback: () => Promise<void>) => { beforeAuthorization = callback; } };
}

test('chat delivery requires explicit device consent and atomically reuses bounded delivery identities', async t => {
  t.mock.method(Date, 'now', () => Date.parse('2026-11-12T04:00:00Z'));
  const f = await fixture();
  assert.deepEqual((await f.prepare()).ids, []);
  await f.presence(0, null, true); await f.presence(1, null, true);
  const uncommitted = await f.prepare(randomUUID(), false);
  assert.equal(uncommitted.ids.length, 2); assert.deepEqual(await f.statuses(uncommitted.ids), []);
  const sent = await f.prepare(); assert.equal(sent.ids.length, 2);
  assert.deepEqual((await f.prepare(sent.messageId)).ids, sent.ids);
  assert.equal((await f.statuses(sent.ids)).length, 2);
  assert.equal((await f.jobFor(sent.ids[0]!)).resourceId, sent.ids[0]);
  await assert.rejects(f.statuses([...sent.ids, ...sent.ids, ...sent.ids]), e => (e as any).status === 400);
  assert.deepEqual(await f.statuses(sent.ids, f.otherChildId), []);
  nativePushStatusSchema.parse(await f.store.status(f.userId, f.keys[0]));
  nativePushStatusV2Schema.parse(await f.store.status(f.userId, f.keys[0], 2));
  assert.ok(!JSON.stringify([...f.records.values()]).includes('Private synthetic message'));
});

test('only an opted-in handset receives the saved chat excerpt with its original tap target', async t => {
  t.mock.method(Date, 'now', () => Date.parse('2026-11-12T04:00:00Z'));
  const messages: Array<{data: Record<string,string>; notification?: {body: string}}> = [];
  const gateway = createNativePushGateway({projectId:'synthetic-push'}, {accessToken: async () => 'synthetic', fetch: async (_url, init) => {
    messages.push(JSON.parse(String(init?.body)).message);
    return Response.json({name:'projects/synthetic-push/messages/example'});
  }});
  const f = await fixture(undefined, gateway);
  await f.presence(0, null, true);
  await f.presence(1, null, true);
  const preference = await f.store.readChatPresence(f.userId, f.keys[0]!, true);
  await f.store.setChatPresence(f.userId, f.keys[0]!, {childId:null, expectedPresenceVersion:preference.presenceVersion, chatPreviewEnabled:true}, true);
  const prepared = await f.prepare();
  for (const id of prepared.ids) await f.store.process(await f.jobFor(id), new AbortController().signal);
  const preview = messages.find(message => message.data.message);
  assert.equal(preview?.data.message, 'Private synthetic message');
  assert.equal(preview?.notification, undefined);
  const tap = parseNativePushData(JSON.parse(preview!.data.body!));
  assert.ok(tap);
  assert.deepEqual(await f.store.authorizeOpen(f.userId, f.keys[0]!, tap), {screen:'chat', childId:f.childId, messageId:prepared.messageId});
  assert.ok(messages.find(message => message.notification)?.notification?.body.includes('請開啟育有方'));
  assert.equal(messages.length, 2);
});

test('fresh foreground lease suppresses only its own device and stale CAS cannot reactivate it', async t => {
  let now = Date.parse('2026-11-12T04:00:00Z'); t.mock.method(Date, 'now', () => now);
  const f = await fixture();
  const lease = await f.presence(0, f.childId, true); await f.presence(1, null, true);
  const prepared = await f.prepare(), jobs = await Promise.all(prepared.ids.map(f.jobFor));
  for (const job of jobs) await f.store.process(job, new AbortController().signal);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0]!.token, 'synthetic-android-token-1');
  const statuses = await f.statuses(prepared.ids);
  assert.ok(statuses.some(value => value.reason === 'foreground_chat'));
  assert.ok(statuses.some(value => value.status === 'accepted'));
  await f.presence(0, null);
  await assert.rejects(f.store.setChatPresence(f.userId, f.keys[0]!, { childId: f.childId,
    bindingId: f.bindings[0]!.id, expectedPresenceVersion: lease.presenceVersion }), e => (e as any).code === 'presence_changed');
  const accepted = f.calls[0]!.reference;
  assert.equal(accepted.kind, 'care');
  assert.deepEqual(await f.store.authorizeOpen(f.userId, f.keys[1]!, accepted), { screen: 'chat', childId: f.childId, messageId: prepared.messageId });
  await assert.rejects(f.store.authorizeOpen(f.userId, f.keys[0]!, accepted));
  await f.presence(0, f.childId); now += 61_000;
  const afterExpiry = await f.prepare();
  for (const id of afterExpiry.ids) await f.store.process(await f.jobFor(id), new AbortController().signal);
  assert.equal(f.calls.length, 3);
});

test('closing the app without a final heartbeat still delivers a newer reply on the original job', async t => {
  let now = Date.parse('2026-11-12T04:00:00Z');
  t.mock.method(Date, 'now', () => now);
  const f = await fixture();
  await f.presence(0, f.childId, true);
  now += 8_000;
  const prepared = await f.prepare(), job = await f.jobFor(prepared.ids[0]!);
  assert.equal((await f.store.process(job, new AbortController().signal)).state, 'deferred');
  assert.equal(f.calls.length, 0);
  now += 60_000;
  await f.store.process(job, new AbortController().signal);
  assert.equal(f.calls.length, 1);
  assert.equal((await f.statuses(prepared.ids))[0]?.status, 'accepted');
});

test('chat worker defers quiet time and rechecks presence immediately before provider send', async t => {
  let now = Date.parse('2026-11-12T15:00:00Z'); t.mock.method(Date, 'now', () => now);
  const f = await fixture(); await f.presence(0, null, true);
  const prepared = await f.prepare(), job = await f.jobFor(prepared.ids[0]!);
  const quiet = await f.store.process(job, new AbortController().signal);
  assert.equal(quiet.state, 'deferred'); assert.ok(Date.parse(quiet.nextAt!) > now);
  assert.equal((await f.statuses(prepared.ids))[0]!.status, 'queued'); assert.equal(f.calls.length, 0);
  now = Date.parse('2026-11-13T04:00:00Z');
  f.beforeAuthorization(async () => { await f.presence(0, f.childId); });
  await f.store.process(job, new AbortController().signal);
  assert.equal(f.calls.length, 0); assert.equal((await f.statuses(prepared.ids))[0]!.reason, 'foreground_chat');
});

test('chat delivery rechecks consent, erased child and missing message at worker and open boundaries', async t => {
  t.mock.method(Date, 'now', () => Date.parse('2026-11-12T04:00:00Z'));
  const f = await fixture(); await f.presence(0, null, true);
  const first = await f.prepare(); await f.presence(0, null, false);
  await f.store.process(await f.jobFor(first.ids[0]!), new AbortController().signal);
  assert.equal(f.calls.length, 0); assert.equal((await f.statuses(first.ids))[0]!.reason, 'chat_consent_disabled');
  await f.presence(0, null, true);
  const missing = await f.prepare();
  await f.database.runTransaction(async tx => { tx.delete(f.data.ref('chat_messages', 'chat-message', missing.messageId)); });
  await f.store.process(await f.jobFor(missing.ids[0]!), new AbortController().signal);
  assert.equal(f.calls.length, 0); assert.equal((await f.statuses(missing.ids))[0]!.reason, 'message_unavailable');
  const accepted = await f.prepare(); await f.store.process(await f.jobFor(accepted.ids[0]!), new AbortController().signal);
  assert.equal(f.calls.length, 1);
  await f.authority.runTransaction(f.userId, null, async b => {
    const erase = await b.prepareErasure(randomUUID(), 'child', f.childId); erase.commit();
  });
  await assert.rejects(f.store.authorizeOpen(f.userId, f.keys[0]!, f.calls[0]!.reference));
});

test('quiet deferral does not hide a later device-session revocation', async t => {
  t.mock.method(Date, 'now', () => Date.parse('2026-11-12T15:00:00Z'));
  const f = await fixture(); await f.presence(0, null, true);
  const prepared = await f.prepare(), job = await f.jobFor(prepared.ids[0]!);
  assert.equal((await f.store.process(job, new AbortController().signal)).state, 'deferred');
  await f.sessions.revokeThis(f.keys[0]!);
  assert.equal((await f.store.process(job, new AbortController().signal)).state, 'stopped');
  assert.equal((await f.statuses(prepared.ids))[0]!.reason, 'revoked');
  assert.equal(f.calls.length, 0);
});

test('new quiet preferences before network send retain the same queued delivery for its later wake', async t => {
  t.mock.method(Date, 'now', () => Date.parse('2026-11-12T04:00:00Z'));
  const f = await fixture(); await f.presence(0, null, true);
  const prepared = await f.prepare(), job = await f.jobFor(prepared.ids[0]!);
  f.beforeAuthorization(async () => {
    await f.authority.runTransaction(f.userId, null, async b => {
      const preferences = createNotificationPreferencesData(f.data), current = await preferences.read(b);
      const update = await preferences.prepare(b, randomUUID(), { expectedVersion: current.version,
        timeZone: 'UTC', quietStart: '03:00', quietEnd: '05:00', allowAppointmentDuringQuiet: true }, current);
      update.commit();
    });
  });
  const outcome = await f.store.process(job, new AbortController().signal);
  assert.equal(outcome.state, 'deferred'); assert.equal(outcome.nextAt, '2026-11-12T05:00:00.000Z');
  assert.equal(f.calls.length, 0);
  assert.deepEqual(await f.statuses(prepared.ids), [{ id: prepared.ids[0], status: 'queued', reason: 'quiet_hours' }]);
});

test('native presence and chat-open routes require expected identity and recheck the native session', async t => {
  t.mock.method(Date, 'now', () => Date.parse('2026-11-12T04:00:00Z'));
  const f = await fixture(), origin = 'https://native.example.test';
  let native = true, proofs = 0, switchAtFinal = false;
  const handler = createFirebaseRequestHandler({ authority: f.authority, nativePush: f.store, publicOrigin: origin, mailConfigured: false,
    auth: { getSession: async () => ({ user: { id: f.userId } }), handler: async () => new Response(null, { status: 404 }),
      nativeSessionProof: async () => {
        proofs++; return !native ? null : switchAtFinal && proofs % 2 === 0 ? f.keys[1] : f.keys[0];
      } } as unknown as FirebaseAuthPort });
  const headers = { authorization: 'Bearer yuban-native-v1.synthetic', 'x-expected-user-id': f.userId, 'content-type': 'application/json' };
  const call = (method = 'GET', body?: unknown, extra: Record<string, string> = {}, version = 1) => handler(new Request(origin + (version === 2 ? '/api/native-push/v2/chat-presence' : '/api/native-push/chat-presence'), {
    method, headers: { ...headers, ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  assert.equal((await call()).status, 200);
  assert.equal((await call('GET', undefined, { 'x-expected-user-id': 'other' })).status, 409);
  native = false; assert.equal((await call()).status, 401); native = true;
  assert.equal((await call('POST', { childId: null, expectedPresenceVersion: 0, chatNotificationsEnabled: true }, { origin: 'https://evil.test' })).status, 403);
  const enabled = await call('POST', { childId: null, expectedPresenceVersion: 0, chatNotificationsEnabled: true });
  assert.equal(enabled.status, 200); const value = await enabled.json(); assert.equal(value.chatNotificationsEnabled, true);
  assert.equal('chatPreviewEnabled' in value, false);
  const pref = {childId: null, expectedPresenceVersion: value.presenceVersion, chatPreviewEnabled: true};
  assert.equal((await call('POST', pref)).status, 400);
  assert.equal((await (await call('GET', undefined, {}, 2)).json()).chatPreviewEnabled, false);
  assert.equal((await (await call('POST', pref, {}, 2)).json()).chatPreviewEnabled, true);
  assert.equal((await call('POST', { childId: f.childId, expectedPresenceVersion: 0 })).status, 409);
  const prepared = await f.prepare(); await f.store.process(await f.jobFor(prepared.ids[0]!), new AbortController().signal);
  const url = origin + '/api/native-push/open?reference=' + encodeURIComponent(JSON.stringify(f.calls[0]!.reference));
  const opened = await handler(new Request(url, { headers }));
  assert.equal(opened.status, 200); assert.deepEqual(await opened.json(), { kind: 'chat', childId: f.childId, messageId: prepared.messageId });
  proofs = 0; switchAtFinal = true;
  assert.equal((await call()).status, 409);
  proofs = 0; assert.equal((await handler(new Request(url, { headers }))).status, 409);
});

test('child cleanup removes account chat targets and clears its device lease while preserving consent and siblings', async t => {
  t.mock.method(Date, 'now', () => Date.parse('2026-11-12T04:00:00Z'));
  const f = await fixture(serialFirestoreFixture());
  const original = await f.presence(0, f.childId, true); await f.presence(1, f.otherChildId, true);
  const removed = await f.prepare();
  const retained = await f.authority.runTransaction(f.userId, f.otherChildId, async b => {
    const prepared = await f.store.prepareChatDeliveries(b, randomUUID()); prepared.commit(); return prepared.ids;
  });
  const binding = await f.authority.readScope(f.userId, f.childId);
  const intent: FirebaseErasureIntent = { type: 'child-delete', scope: binding.scope, assetId: f.childId,
    operationId: randomUUID(), at: new Date(Date.now() - 121_000).toISOString() };
  const proof: FirebaseErasureDescriptor = { objectName: 'erasures/v1/' + 'a'.repeat(64), generation: '1', cipherSha256: 'b'.repeat(64),
    intentSha256: firebaseErasureIntentHash(intent), bytes: 512, format: 'yuban-erasure-journal/v1' };
  const journal = { async writeOnce() { return proof; }, async read() { return intent; } };
  const erasures = createFirestoreErasureStore({ ...f.options, journal });
  const collections = FIREBASE_BACKUP_COLLECTION_SUFFIXES.filter(suffix => !['_erasures', '_erasure_receipts', '_sessions', '_adk', '_root_budget', '_ai_usage', '_private_summary_usage'].includes(suffix)
    && !suffix.startsWith('_knowledge_'));
  const job: FirestoreScopeErasure = { intent, authorizationVersion: binding.authorizationVersion, generation: (await f.authority.readControl()).generation,
    state: 'cleaning', journal: proof, receiptToken: null, expiresAt: null, blockedAt: intent.at, scopeVersion: '1', childCount: 1,
    cleanup: { stage: 'data:' + collections.indexOf('_native_push_bindings'), cursor: null } };
  f.records.set(erasures.ref(f.userId, intent.operationId).path, erasures.seal(job));
  const cleanup = createFirestoreErasureCleanup({ ...f.options, journal, erasures,
    photos: { async eraseForScope() { throw Error('No photos'); } }, async deleteAgentSession() {},
    async eraseAgentUserPage() { throw Error('Child cleanup must preserve account sessions'); },
    async eraseDeviceSessions() { throw Error('Child cleanup must preserve device sessions'); }, async eraseAuthUser() { throw Error('Child cleanup must preserve identity'); } });
  await cleanup.advance(f.userId, intent.operationId);
  await cleanup.advance(f.userId, intent.operationId);
  const current = await f.store.readChatPresence(f.userId, f.keys[0]!);
  assert.equal(current.bindingId, original.bindingId); assert.equal(current.chatNotificationsEnabled, true);
  assert.equal(current.expiresAt, null); assert.ok(current.presenceVersion > original.presenceVersion);
  assert.deepEqual(await f.statuses(removed.ids, null), []);
  assert.equal((await f.statuses(retained, f.otherChildId)).length, 2);
  assert.equal((await f.store.status(f.userId)).bindings.filter(binding => binding.status === 'active').length, 2);
});

test('chat history remains visible without consuming the existing channel-test quota', async t => {
  t.mock.method(Date, 'now', () => Date.parse('2026-11-12T04:00:00Z'));
  const f = await fixture(); await f.presence(0, null, true);
  const chats = [];
  for (let index = 0; index < 3; index++) chats.push(await f.prepare());
  const path = '/api/native-push/subscriptions/' + f.bindings[0]!.id + '/test', payload = { expectedVersion: f.bindings[0]!.version, confirmImmediate: true };
  const operation = { ...await f.online.context(f.userId, { path, payload }), opId: randomUUID(), deviceId: randomUUID() };
  const result = await f.online.submit(f.userId, { path, payload, operation }, { nativeSession: f.keys[0]! });
  assert.equal(result.state, 'confirmed');
  assert.equal((await f.store.status(f.userId)).testsRemaining, 2);
  const history = await f.authority.runTransaction(f.userId, null, b => readNotificationHistory(f.options, b));
  for (const chat of chats) assert.ok(history.items.some((item: any) => item.id === chat.ids[0]), 'Chat delivery missing from general history');
});

async function dueTask(f: Awaited<ReturnType<typeof fixture>>, kind: 'ordinary' | 'appointment' = 'ordinary') {
  const path = `/api/children/${f.childId}/tasks`, payload = { confirm: true, values: { title: 'Synthetic deadline', details: '', kind,
    assigneeUserId: f.userId, dueAt: new Date(Date.now() - 60_000).toISOString(), timeZone: 'UTC' } };
  const operation = { ...await f.online.context(f.userId, { path, payload }), opId: randomUUID(), deviceId: randomUUID() };
  const receipt = await f.online.submit(f.userId, { path, payload, operation });
  const task = (receipt.result as { task: CareTask }).task, binding = await f.authority.readScope(f.userId, f.childId);
  const job: FirestoreTaskDelivery = { kind: 'task-reminder', scope: binding.scope, taskId: task.id, taskVersion: task.version,
    occurrenceId: task.occurrence.id, authorizationVersion: binding.authorizationVersion, generation: (await f.authority.readControl()).generation,
    scheduledAt: task.occurrence.dueAt };
  return { task, job };
}

test('an opted-in deadline creates one canonical chat and skips automatic follow-up contact without needing a model', async t => {
  let now = Date.parse('2026-11-12T04:00:00Z'); t.mock.method(Date, 'now', () => now);
  const f = await fixture(); await f.presence(0, null, true);
  const chat = createFirestoreChatStore({ ...f.options, notifications: f.store }), { task, job } = await dueTask(f);
  const worker = createFirestoreTaskWorker({ ...f.options, enabled: true,
    currentAuth: async userId => ({ userId, email: 'parent@example.test', disabled: false, emailVerified: true }),
    prepareParentContact: async (b, input) => chat.prepareParentContact(b, { origin: 'task', opId: input.opId, text: input.text }) });
  const first = await worker.process(job);
  assert.ok(first.receipt); assert.ok(first.nextAt);
  const original = await chat.listForUser(f.userId, f.childId);
  assert.equal(original!.messages.length, 1); assert.equal(original!.messages[0]!.proactive, true);
  assert.ok(original!.messages[0]!.text.includes(task.title));
  await worker.process(job);
  now = Date.parse(first.nextAt!); await worker.process({ ...job, scheduledAt: first.nextAt! });
  assert.equal((await chat.listForUser(f.userId, f.childId))!.messages.length, 1);
  await f.authority.runTransaction(f.userId, f.childId, async b => {
    const notification = f.data.open('task-notification-outbox', first.receipt!.id, b.scope, firestoreTaskNotificationOutboxSchema,
      await b.transaction.get(f.data.ref('notification_outbox', 'task-notification-outbox', first.receipt!.id)));
    assert.equal(notification.chatContact, true);
    let query: Query = f.data.collection('background_work');
    for (const [key, value] of Object.entries(f.data.tags(b.scope))) query = query.where(key, '==', value);
    const jobs = await b.transaction.get(query.limit(20));
    for (const row of jobs.docs) assert.notEqual(f.data.open('background-work', row.get('id'), b.scope, firestoreBackgroundWorkSchema, row).kind, 'task-agent');
  });
});

test('an opted-out deadline keeps the original task-agent route and terminal tasks cannot prepare a chat', async t => {
  t.mock.method(Date, 'now', () => Date.parse('2026-11-12T04:00:00Z'));
  const f = await fixture(), { job } = await dueTask(f, 'appointment');
  let calls = 0;
  const worker = createFirestoreTaskWorker({ ...f.options, enabled: true,
    currentAuth: async userId => ({ userId, email: 'parent@example.test', disabled: false, emailVerified: true }),
    prepareParentContact: async () => { calls++; return null; } });
  assert.equal((await worker.process(job)).state, 'processed'); assert.equal(calls, 1);
  const pending = await dueTask(f, 'appointment'), lease = await worker.claim(pending.job);
  assert.equal(lease.state, 'claimed'); if (lease.state !== 'claimed') throw Error('Missing task lease');
  const path = `/api/children/${f.childId}/tasks/${pending.task.id}/change`, payload = { confirm: true, action: 'complete', expectedVersion: pending.task.version, note: '' };
  const operation = { ...await f.online.context(f.userId, { path, payload }), opId: randomUUID(), deviceId: randomUUID() };
  await f.online.submit(f.userId, { path, payload, operation });
  assert.equal((await worker.complete(pending.job, lease.lease)).state, 'stopped'); assert.equal(calls, 1);
});

test('automatic chat delivery rechecks parent policy immediately before send while demo contact remains explicit', async t => {
  t.mock.method(Date, 'now', () => Date.parse('2026-11-12T04:00:00Z'));
  const f = await fixture(); await f.presence(0, null, true);
  const chat = createFirestoreChatStore({ ...f.options, notifications: f.store }), proactive = createProactiveWakes(f.options, chat);
  await f.authority.runTransaction(f.userId, f.childId, b => proactive.configure(b, { expectedVersion: 0, enabled: true, timeZone: 'UTC', opId: randomUUID() }));
  const daily = await f.authority.runTransaction(f.userId, f.childId, b => chat.contactParent(b, { origin: 'daily', opId: randomUUID(), text: 'Synthetic daily contact' }));
  f.beforeAuthorization(async () => {
    await f.authority.runTransaction(f.userId, f.childId, b => proactive.configure(b, { expectedVersion: 1, enabled: false, timeZone: 'UTC', opId: randomUUID() }));
  });
  await f.store.process(await f.jobFor(daily.deliveryIds[0]!), new AbortController().signal);
  assert.equal(f.calls.length, 0); assert.equal((await f.statuses(daily.deliveryIds))[0]!.reason, 'proactive_disabled');
  f.beforeAuthorization(async () => {});
  const demo = await f.authority.runTransaction(f.userId, f.childId, b => chat.contactParent(b, { origin: 'demo', opId: randomUUID(), text: 'Synthetic explicit demo' }));
  await f.store.process(await f.jobFor(demo.deliveryIds[0]!), new AbortController().signal);
  assert.equal(f.calls.length, 1);
});

test('a task completed after queueing is suppressed at dispatch and immediately before network send', async t => {
  t.mock.method(Date, 'now', () => Date.parse('2026-11-12T04:00:00Z'));
  for (const beforeNetwork of [false, true]) {
    const f = await fixture(); await f.presence(0, null, true);
    const chat = createFirestoreChatStore({ ...f.options, notifications: f.store }), proactive = createProactiveWakes(f.options, chat);
    await f.authority.runTransaction(f.userId, f.childId, b => proactive.configure(b, { expectedVersion: 0, enabled: true, timeZone: 'UTC', opId: randomUUID() }));
    const { job, task } = await dueTask(f, 'appointment');
    const worker = createFirestoreTaskWorker({ ...f.options, enabled: true,
      currentAuth: async userId => ({ userId, email: 'parent@example.test', disabled: false, emailVerified: true }),
      prepareParentContact: async (b, input) => chat.prepareParentContact(b, { origin: 'task', opId: input.opId, text: input.text }) });
    const sent = await worker.process(job); assert.ok(sent.receipt);
    const contact = await f.authority.runTransaction(f.userId, f.childId, b => chat.getContact(b, 'task', sent.receipt!.id));
    assert.ok(contact?.deliveryIds.length);
    const complete = async () => {
      const path = `/api/children/${f.childId}/tasks/${task.id}/change`, payload = { confirm: true, action: 'complete', expectedVersion: task.version, note: '' };
      const operation = { ...await f.online.context(f.userId, { path, payload }), opId: randomUUID(), deviceId: randomUUID() };
      await f.online.submit(f.userId, { path, payload, operation });
    };
    if (beforeNetwork) f.beforeAuthorization(complete); else await complete();
    await f.store.process(await f.jobFor(contact!.deliveryIds[0]!), new AbortController().signal);
    assert.equal(f.calls.length, 0);
    assert.equal((await f.statuses(contact!.deliveryIds))[0]!.reason, 'task_unavailable');
    assert.equal((await chat.listForUser(f.userId, f.childId))!.messages.length, 1);
  }
});
