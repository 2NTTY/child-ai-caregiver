import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { firestoreAuthoritySchemas, createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreNotificationMessages } from '../server/firestore-notification-messages.ts';
import { createFirestoreAccountExport } from '../server/firestore-account-export.ts';
import { FirestoreDomainData } from '../server/firestore-domain-data.ts';
import { firestorePushDeliverySchema } from '../server/firestore-web-push.ts';
import { firestoreTelegramDeliverySchema } from '../server/firestore-telegram.ts';
import { firestoreNativeDeliverySchema } from '../server/firestore-native-push.ts';
import { firestoreContactRequestSchema } from '../server/firestore-contact.ts';
import { restoreOperationRecord } from '../server/firestore-restore-operation-records.ts';
import { createFirestoreRestoreCodec } from '../server/firestore-restore-codec.ts';
import { workRecoveryAad, workRecoveryDocumentId } from '../server/firestore-work-continuation-recovery.ts';
import { openRecoveryEnvelope } from '../server/firestore-recovery-envelope.ts';
import { createFirebaseRequestHandler } from '../server/firebase-app.ts';
import type { FirebaseAuthPort } from '../server/firebase-auth.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { notificationMessagesPageSchema, type NotificationMessageContent } from '../src/shared/notification-messages.ts';

async function fixture(messageHistoryEnabled = true) {
  const fake = firestoreDomainFixture(), options = { database: fake.database, projectId: 'synthetic-messages', namespace: 'message_case', messageHistoryEnabled, cipher: createStorageCipher(Buffer.alloc(32, 91)) };
  const authority = createFirestoreAuthority(options), data = new FirestoreDomainData(options), generation = randomUUID();
  await authority.initializeControl({ generation, enabled: true });
  for (const userId of ['owner', 'peer']) {
    const email = userId + '@example.test';
    await authority.issueInvitation({ email, operationId: randomUUID(), expiresAt: new Date(Date.now() + 60000).toISOString() });
    await authority.admitIdentity({ userId, email, emailVerified: true });
    await authority.acknowledge({ userId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  }
  const child = (await authority.createChild({ userId: 'owner', displayName: '合成孩子', operationId: randomUUID() })).child;
  const history = createFirestoreNotificationMessages(options);
  const exporter = createFirestoreAccountExport({ ...options, photos: { async content() { throw new Error('No photos'); } } });
  let active = 'owner';
  const auth = { getSession: async () => ({ user: { id: active } }), handler: async () => new Response('', { status: 404 }) } as unknown as FirebaseAuthPort;
  const handler = createFirebaseRequestHandler({ authority, auth, accountData: { exporter, erasures: {} as any }, publicOrigin: 'https://example.test', mailConfigured: false });
  return { ...fake, options, authority, data, generation, child, history, exporter, handler, setUser(value: string) { active = value; } };
}
const at = (i: number) => new Date(Date.now() - 100000 - i * 1000).toISOString();
async function seed(f: Awaited<ReturnType<typeof fixture>>, i: number, owner = 'owner', captured = true) {
  const definitions = [ ['push_deliveries', 'push-delivery', 'web_push', firestorePushDeliverySchema], ['native_push_deliveries', 'native-push-delivery', 'native_push', firestoreNativeDeliverySchema], ['telegram_deliveries', 'telegram-delivery', 'telegram', firestoreTelegramDeliverySchema] ] as const;
  const [suffix, kind, channel, schema] = definitions[i % 3], id = randomUUID(), sentAt = at(i);
  const message: NotificationMessageContent = { channel, contentVersion: 'synthetic-v1', title: channel === 'telegram' ? null : 'Same title', body: 'synthetic exact private body ' + i, sentAt };
  let path = '';
  await f.authority.runTransaction(owner, null, async b => {
    const delivery = { id, bindingId: randomUUID(), status: 'accepted', reason: null, providerStatus: 201, createdAt: at(50 - i), attemptedAt: sentAt, finishedAt: sentAt, ...(channel === 'telegram' ? { messageId: 1, acknowledgedAt: null } : {}) };
    const value = { delivery, bindingVersion: 1, generation: f.generation, authorizationVersion: b.authorizationVersion, attempt: randomUUID(), ...(channel === 'telegram' ? { botId: 'synthetic', callback: null } : {}), ...(captured ? { message } : {}) };
    const ref = f.data.ref(suffix, kind, id); path = ref.path;
    b.transaction.create(ref, { ...f.data.tags(b.scope), deliveryId: id, createdAt: delivery.createdAt, ...(captured ? { messageSentAt: sentAt } : {}), ...f.data.seal(kind, id, b.scope, schema as any, value) });
  });
  return { id, path, message };
}
async function seedContact(f: Awaited<ReturnType<typeof fixture>>, captured = true) {
  const id = randomUUID(), taskId = randomUUID(), sentAt = at(1);
  await f.authority.runTransaction('owner', f.child.id, async b => {
    const attempts = (['web_push', 'telegram'] as const).map(channel => ({ id: randomUUID(), recipientUserId: 'owner', channel, grantVersion: 1, taskVersion: 1, status: 'accepted', reason: null, providerStatus: 200, messageId: channel === 'telegram' ? 1 : null, attemptedAt: sentAt, finishedAt: sentAt, acknowledgedAt: null }));
    const value = { request: { id, taskId, taskVersion: 1, occurrenceId: randomUUID(), phase: 'initial', state: 'accepted', reason: null, nextAt: sentAt, groupedTo: null, createdAt: at(80), attempts },
      grant: { value: { taskId, version: 1, taskVersion: 1, enabled: true, primaryUserId: 'owner', backupUserId: null, allowFollowUp: false, allowFallback: true, validUntil: sentAt, authorizedBy: 'owner', content: 'generic_notice', trigger: 'task_due', updatedAt: sentAt }, authorityVersion: b.authorizationVersion, consentVersion: 1, bindings: [] },
      generation: f.generation, authorizationVersion: b.authorizationVersion, runId: randomUUID(), reminderId: id, batchId: randomUUID(), callbackHash: null,
      ...(captured ? { messages: attempts.map(a => ({ attemptId: a.id, recipientUserId: a.recipientUserId, content: { channel: a.channel, contentVersion: 'synthetic-v1', title: null, body: 'Exact ' + a.channel + ' body', sentAt } })) } : {}) };
    b.transaction.create(f.data.ref('contact_requests', 'contact-request', id), { ...f.data.tags(b.scope), requestId: id, createdAt: value.request.createdAt, ...(captured ? { messageSentAt: sentAt } : {}), ...f.data.seal('contact-request', id, b.scope, firestoreContactRequestSchema, value as any) });
  });
  return id;
}

test('private messages merge actual content times, bind cursors, group only real IDs and preserve legacy coverage', async () => {
  const f = await fixture();
  for (let i = 0; i < 24; i++) await seed(f, i);
  await seed(f, 1, 'owner', false); await seed(f, 1, 'peer'); const contactId = await seedContact(f);
  assert.equal(JSON.stringify([...f.records.values()]).includes('synthetic exact private body'), false);
  const read = (query = '') => f.handler(new Request('https://example.test/api/account/messages' + query, { headers: { 'x-expected-user-id': 'owner' } }));
  const response = await read(); assert.equal(response.status, 200); assert.match(response.headers.get('cache-control')!, /no-store/u);
  const first = notificationMessagesPageSchema.parse(await response.json()); assert.equal(first.items.length, 20); assert.ok(first.nextCursor); assert.equal(first.complete, false);
  assert.equal(first.coverage.historical, 'unknown'); assert.equal(first.coverage.pagination, 'live');
  const second = await f.history.page('owner', { scopeVersion: first.scopeVersion, cursor: first.nextCursor });
  assert.equal(second.asOf, first.asOf); assert.equal(second.complete, true); assert.equal(second.items.length, 5);
  const all = [...first.items, ...second.items]; assert.equal(new Set(all.map(item => item.messageId)).size, 25);
  assert.deepEqual(all.map(item => item.sentAt), all.map(item => item.sentAt).sort().reverse());
  const contact = all.find(item => item.messageId === 'contact:' + contactId)!;
  assert.equal(contact.contents.length, 2); assert.equal(contact.scope.kind, 'child'); assert.notEqual(contact.contents[0].body, contact.contents[1].body);
  assert.equal(JSON.stringify(all).includes('bindingId'), false); assert.equal(JSON.stringify(all).includes('providerStatus'), false);
  await assert.rejects(f.history.page('peer', { scopeVersion: first.scopeVersion, cursor: first.nextCursor }), (e: any) => e.code === 'invalid_message_cursor');
  await assert.rejects(f.history.page('owner', { scopeVersion: '0'.repeat(64) }), (e: any) => e.code === 'messages_scope_changed');
  await assert.rejects(f.history.page('owner', { scopeVersion: first.scopeVersion, cursor: first.nextCursor + 'a' }), (e: any) => e.code === 'invalid_message_cursor');
  await f.authority.runTransaction('owner', null, async b => (await b.prepareChange(randomUUID(), 'preferences', false)).commit());
  assert.equal((await f.history.page('owner', { scopeVersion: first.scopeVersion })).scopeVersion, first.scopeVersion);
  const exported = await f.exporter.page('owner', { section: 'push_deliveries' });
  assert.ok(exported.items.some((item: any) => item.message?.body));
  f.setUser('peer'); assert.equal((await read()).status, 409);
});

test('message metadata tampering is rejected and encrypted recovery preserves exact snapshots', async () => {
  const f = await fixture(), stored = await seed(f, 0), row = f.records.get(stored.path);
  const opened = openRecoveryEnvelope({ ...f.options, locator: row.recovery, envelope: { family: 'domain', version: row.version, recordVersion: row.recordVersion, ciphertext: row.ciphertext } });
  const restored = restoreOperationRecord(f.data, { ...opened.context, kind: 'push-delivery' }, firestorePushDeliverySchema.parse(opened.value));
  assert.equal((restored.metadata as Record<string, unknown>).messageSentAt, stored.message.sentAt);
  assert.deepEqual(firestorePushDeliverySchema.parse(restored.value).message, stored.message);
  f.records.set(stored.path, { ...row, messageSentAt: at(60) });
  await assert.rejects(f.history.page('owner', {}), (e: any) => e.code === 'message_content_binding');
});

test('restore codec round trips all message sources and rebuilds sort metadata only from authenticated content', async () => {
  const f = await fixture(), codec = createFirestoreRestoreCodec(f.options), newEpoch = randomUUID(), generation = randomUUID();
  for (const captured of [true, false]) {
    const stored = [];
    for (let i = 0; i < 3; i++) stored.push(await seed(f, i, 'owner', captured));
    const contactId = await seedContact(f, captured);
    const paths = [...stored.map(row => row.path), f.data.ref('contact_requests', 'contact-request', contactId).path];
    for (const path of paths) {
      const row = f.records.get(path), original = codec.decode({ path, data: row });
      assert.equal(original.context.family, 'domain');
      if (original.context.family !== 'domain') throw new Error('Expected a domain message record');
      const target = { generation, newEpochByWorkspace: new Map([[original.context.scope.workspaceId, newEpoch]]), photoDescriptors: new Map() };
      const { messageSentAt: _projection, ...withoutProjection } = row;
      // Old rows may omit the projection; hostile plaintext must neither replace content nor invent legacy history.
      for (const source of [row, withoutProjection, { ...row, messageSentAt: '2099-01-01T00:00:00.000Z' }]) {
        const restored = codec.transform(codec.decode({ path, data: source }), target), reopened = codec.decode(restored);
        assert.equal(restored.oldPath, path); assert.equal(restored.path, path);
        assert.deepEqual(reopened.value, original.value);
        assert.equal(reopened.context.family, 'domain');
        if (reopened.context.family !== 'domain') throw new Error('Expected a restored domain message record');
        assert.deepEqual(reopened.context.scope, { ...original.context.scope, storageEpoch: newEpoch });
        assert.equal(restored.data.messageSentAt, captured ? row.messageSentAt : undefined);
        assert.equal(Object.hasOwn(restored.data, 'messageSentAt'), captured);
      }
    }
  }
});

test('message pagination retries replay the original cursor without skipping the second page', async () => {
  const f = await fixture(), expectedIds: string[] = [];
  for (let i = 0; i < 45; i++) { const saved = await seed(f, i); expectedIds.push(saved.message.channel + ':' + saved.id); }
  const ids = (page: Awaited<ReturnType<typeof f.history.page>>) => page.items.map(item => item.messageId);
  const first = await f.history.page('owner', {});
  assert.equal(first.items.length, 20); assert.equal(first.complete, false); assert.ok(first.nextCursor);
  assert.deepEqual(ids(first), expectedIds.slice(0, 20));
  const query = { scopeVersion: first.scopeVersion, cursor: first.nextCursor };
  const ordinary = await f.history.page('owner', query);
  assert.equal(ordinary.items.length, 20); assert.equal(ordinary.complete, false); assert.ok(ordinary.nextCursor);
  assert.deepEqual(ids(ordinary), expectedIds.slice(20, 40));
  const underlying = f.options.database.runTransaction.bind(f.options.database);
  let transactionCalls = 0, discardedAttempts = 0;
  f.options.database.runTransaction = ((callback: any, ...args: any[]) => {
    // Activation is the first transaction; discard/replay the actual page-read callback.
    if (++transactionCalls === 2) f.retry(async () => { discardedAttempts++; });
    return (underlying as any)(callback, ...args);
  }) as typeof f.options.database.runTransaction;
  let retried: Awaited<ReturnType<typeof f.history.page>>;
  try { retried = await f.history.page('owner', query); }
  finally { f.options.database.runTransaction = underlying; }
  assert.equal(transactionCalls, 3); assert.equal(discardedAttempts, 1);
  assert.equal(retried.items.length, 20); assert.equal(retried.complete, false); assert.ok(retried.nextCursor);
  assert.deepEqual(retried.items, ordinary.items);
  const cursorValue = (cursor: string) => JSON.parse(f.options.cipher.decrypt(Buffer.from(cursor, 'base64url').toString(), 'notification-messages-cursor:1:owner'));
  assert.deepEqual(cursorValue(retried.nextCursor), cursorValue(ordinary.nextCursor));
  const last = await f.history.page('owner', { scopeVersion: retried.scopeVersion, cursor: retried.nextCursor });
  assert.equal(last.items.length, 5); assert.equal(last.complete, true); assert.equal(last.nextCursor, null);
  assert.deepEqual(ids(last), expectedIds.slice(40));
  assert.deepEqual([...ids(first), ...ids(retried), ...ids(last)], expectedIds);
  for (const page of [ordinary, retried, last]) {
    assert.equal(page.scopeVersion, first.scopeVersion); assert.equal(page.asOf, first.asOf);
  }
});

test('deleting a child invalidates all previously loaded message pages without using ordinary changeSeq', async () => {
  const f = await fixture(); await seedContact(f);
  for (let i = 0; i < 21; i++) await seed(f, i);
  const first = await f.history.page('owner', {}); assert.ok(first.nextCursor);
  await f.authority.runTransaction('owner', null, async b => (await b.prepareErasure(randomUUID(), 'child', f.child.id)).commit());
  await assert.rejects(f.history.page('owner', { scopeVersion: first.scopeVersion, cursor: first.nextCursor }), (e: any) => e.code === 'messages_scope_changed');
  const fresh = await f.history.page('owner', {}); assert.ok(fresh.items.every(item => item.scope.kind === 'account'));
  const remaining = (await f.authority.createChild({ userId: 'owner', displayName: 'Remaining child', operationId: randomUUID() })).child;
  await f.authority.runTransaction('owner', remaining.id, async b => (await b.prepareChange(randomUUID(), 'care', false)).commit());
  assert.equal((await f.history.page('owner', {})).scopeVersion, fresh.scopeVersion);
  await assert.rejects(f.history.page('owner', { scopeVersion: first.scopeVersion, cursor: first.nextCursor }), (e: any) => e.code === 'messages_scope_changed');
});

test('accepted content commits with the delivery; failed post-send commits never resend to fill history', async () => {
  for (const fail of [false, true]) {
  const { createFirestoreWebPush, firestorePushBindingSchema } = await import('../server/firestore-web-push.ts');
  const f = await fixture(), bindingId = randomUUID(), id = randomUUID(), time = new Date().toISOString();
  let job: any, sends = 0;
  await f.authority.runTransaction('owner', null, async b => {
    const binding = { id: bindingId, version: 1, status: 'active', provider: 'fcm', label: 'synthetic', endpointHash: 'a'.repeat(64), vapidPublicKey: 'synthetic-key', expiresAt: null, createdAt: time, updatedAt: time };
    const input = { label: 'synthetic', subscription: { endpoint: 'https://fcm.googleapis.com/synthetic', keys: { p256dh: 'a'.repeat(87), auth: 'b'.repeat(22) }, expirationTime: null } };
    b.transaction.create(f.data.ref('push_bindings', 'push-binding', bindingId), { ...f.data.tags(b.scope), bindingId, status: 'active', ...f.data.seal('push-binding', bindingId, b.scope, firestorePushBindingSchema, { binding, input } as any, 1) });
    b.transaction.create(f.data.ref('push_deliveries', 'push-delivery', id), { ...f.data.tags(b.scope), deliveryId: id, createdAt: time, ...f.data.seal('push-delivery', id, b.scope, firestorePushDeliverySchema, { delivery: { id, bindingId, status: 'queued', reason: null, providerStatus: null, createdAt: time, attemptedAt: null, finishedAt: null }, bindingVersion: 1, generation: f.generation, authorizationVersion: b.authorizationVersion, attempt: null }) });
    job = { kind: 'push', resourceId: id, scope: b.scope, generation: f.generation, authorizationVersion: b.authorizationVersion };
  });
  const store = createFirestoreWebPush({ ...f.options, enabled: true, currentAuth: async () => ({ disabled: false, emailVerified: true }), gateway: { publicKey: 'synthetic-key', send: async (_input, _payload, _signal, authorized) => {
    assert.equal(await authorized(), true); sends++; if (fail) f.failCommit();
    return { status: 'accepted', reason: null, providerStatus: 201, message: { channel: 'web_push', contentVersion: 'synthetic-v1', title: 'Exact title', body: 'Exact body', sentAt: new Date().toISOString() } };
  } } });
  if (fail) await assert.rejects(store.process(job, new AbortController().signal), /Synthetic transaction commit failed/u);
  else assert.equal((await store.process(job, new AbortController().signal)).state, 'completed');
  assert.equal(sends, 1);
  const page = await f.history.page('owner', {}); assert.equal(page.items.length, fail ? 0 : 1);
  if (!fail) assert.equal(page.items[0].contents[0].body, 'Exact body');
  assert.equal((await store.process(job, new AbortController().signal)).state, fail ? 'unknown' : 'completed'); assert.equal(sends, 1);
  assert.equal((await f.history.page('owner', {})).coverage.historical, 'unknown');
  }
});


test('legacy workspace round trips preserve an absent permission revision; consumers treat absence as zero', () => {
  const legacy = { id: randomUUID(), ownerUserId: 'owner', storageEpoch: randomUUID(), accessVersion: '1', changeSeq: '12', status: 'active' };
  assert.deepEqual(firestoreAuthoritySchemas.workspace.parse(legacy), legacy);
  const updated = firestoreAuthoritySchemas.workspace.parse({ ...legacy, childAccessVersion: '3' });
  assert.equal(firestoreAuthoritySchemas.workspace.parse({ ...updated, changeSeq: '13', storageEpoch: randomUUID() }).childAccessVersion, '3');
});

test('native wire content commits only after capture activation, through gateway, encrypted store and authenticated route', async () => {
  for (const enabled of [false, true]) {
  const { createNativePushGateway } = await import('../server/native-push-gateway.ts');
  const { createFirestoreNativePush, firestoreNativeBindingSchema } = await import('../server/firestore-native-push.ts');
  const { FirestoreDeviceSessions } = await import('../server/firestore-device-sessions.ts');
  const f = await fixture(enabled), id = randomUUID(), bindingId = randomUUID(), time = new Date().toISOString();
  const sessions = new FirestoreDeviceSessions({ ...f.options, namespace: 'message_native_sessions' });
  const session = { userId: 'owner', sessionHash: 'a'.repeat(64) };
  await sessions.issue({ ...session, expiresAtMs: Date.now() + 60000, authTimeSeconds: Math.floor(Date.now() / 1000) });
  let job: any, wire: any, sends = 0;
  await f.authority.runTransaction('owner', null, async b => {
    const binding = { id: bindingId, version: 1, tokenRevision: 1, status: 'active', label: 'Synthetic Android', createdAt: time, updatedAt: time };
    b.transaction.create(f.data.ref('native_push_bindings', 'native-push-binding', bindingId), { ...f.data.tags(b.scope), bindingId, status: 'active', sessionTag: session.sessionHash,
      ...f.data.seal('native-push-binding', bindingId, b.scope, firestoreNativeBindingSchema, { binding, token: 'synthetic-fcm-token-only', tokenHash: 'b'.repeat(64), sessionHash: session.sessionHash } as any, 1) });
    b.transaction.create(f.data.ref('native_push_deliveries', 'native-push-delivery', id), { ...f.data.tags(b.scope), deliveryId: id, createdAt: time,
      ...f.data.seal('native-push-delivery', id, b.scope, firestoreNativeDeliverySchema, { delivery: { id, bindingId, status: 'queued', reason: null, providerStatus: null, createdAt: time, attemptedAt: null, finishedAt: null }, bindingVersion: 1, generation: f.generation, authorizationVersion: b.authorizationVersion, attempt: null }) });
    job = { kind: 'native-push', resourceId: id, scope: b.scope, generation: f.generation, authorizationVersion: b.authorizationVersion };
  });
  const gateway = createNativePushGateway({ projectId: 'synthetic-fcm' }, { accessToken: async () => 'synthetic-token', fetch: (async (_url, init) => {
    sends++; wire = JSON.parse(String(init!.body)); return Response.json({ name: 'projects/synthetic-fcm/messages/synthetic-id' });
  }) as typeof fetch });
  const store = createFirestoreNativePush({ ...f.options, sessions, gateway, currentAuth: async () => ({ disabled: false, emailVerified: true }) });
  assert.equal((await store.process(job, new AbortController().signal)).state, 'completed');
  assert.equal((await store.process(job, new AbortController().signal)).state, 'completed'); assert.equal(sends, 1);
  const response = await f.handler(new Request('https://example.test/api/account/messages', { headers: { 'x-expected-user-id': 'owner' } }));
  if (!enabled) {
    assert.equal(response.status, 503); assert.equal((await response.json()).error.code, 'message_history_unavailable');
    const saved = [...f.records.values()].find(value => value.deliveryId === id); assert.equal(saved.messageSentAt, undefined);
    const newlyEnabled = createFirestoreNotificationMessages({ ...f.options, messageHistoryEnabled: true });
    assert.equal((await newlyEnabled.page('owner', {})).items.length, 0); continue;
  }
  assert.equal(response.status, 200); const page = notificationMessagesPageSchema.parse(await response.json());
  assert.equal(page.items.length, 1); const content = page.items[0].contents[0];
  assert.deepEqual({ title: content.title, body: content.body }, wire.message.notification);
  assert.equal(content.channel, 'native_push'); assert.equal(page.items[0].messageId, 'native_push:' + id);
  assert.equal(JSON.stringify([...f.records.values()]).includes(content.body), false);
  }
});


test('reader-compatible rollout writes no absent fields, then maintains the activation fence even when capture is disabled', async () => {
  const f = await fixture(false), compatibilityAuthority = createFirestoreAuthority(f.options);
  async function workspace() {
    const scope = await compatibilityAuthority.runTransaction('owner', null, async b => b.scope);
    const raw = f.records.get(f.options.namespace + '/' + workRecoveryDocumentId('workspace', scope.workspaceId));
    return JSON.parse(f.options.cipher.decrypt(raw.ciphertext, workRecoveryAad(f.options.projectId, f.options.namespace, 'workspace', scope.workspaceId, scope)));
  }
  const initial = await workspace(); assert.equal('childAccessVersion' in initial, false);
  const beforeUnavailable = JSON.stringify([...f.records]);
  const unavailable = await f.handler(new Request('https://example.test/api/account/messages', { headers: { 'x-expected-user-id': 'owner' } }));
  assert.equal(unavailable.status, 503); assert.equal(JSON.stringify([...f.records]), beforeUnavailable);
  await compatibilityAuthority.runTransaction('owner', null, async b => { const change = await b.prepareErasure(randomUUID(), 'child', f.child.id); change.commit(); });
  assert.equal('childAccessVersion' in await workspace(), false);
  const secondChild = (await compatibilityAuthority.createChild({ userId: 'owner', displayName: '另一合成孩子', operationId: randomUUID() })).child;
  const active = createFirestoreNotificationMessages({ ...f.options, messageHistoryEnabled: true });
  const beforeActivation = await workspace(), page = await active.page('owner', {}), activated = await workspace();
  assert.equal(activated.childAccessVersion, '0'); assert.equal(activated.changeSeq, beforeActivation.changeSeq);
  await active.page('owner', {}); assert.deepEqual(await workspace(), activated);
  // A still-compatible/rolled-back process is unaware of the environment flag, but must honor the durable marker.
  await compatibilityAuthority.runTransaction('owner', null, async b => { const change = await b.prepareErasure(randomUUID(), 'child', secondChild.id); change.commit(); });
  assert.equal((await workspace()).childAccessVersion, '1');
  await assert.rejects(active.page('owner', { scopeVersion: page.scopeVersion }), (error: any) => error.code === 'messages_scope_changed');
  await compatibilityAuthority.runTransaction('owner', null, async b => { const change = await b.prepareChange(randomUUID(), 'preferences', false); change.commit(); });
  assert.equal((await workspace()).childAccessVersion, '1');
  await assert.rejects(f.history.page('owner', {}), (error: any) => error.code === 'message_history_unavailable');
});


test('restoring an older pre-activation workspace preserves the live permission marker in its new epoch', async () => {
  const { createFirestoreRestoreCodec } = await import('../server/firestore-restore-codec.ts');
  const { prepareFirebaseRestore } = await import('../server/firestore-restore.ts');
  const f = await fixture(false), codec = createFirestoreRestoreCodec(f.options);
  const documents = () => [...f.records].map(([path, data]) => ({ path, data: structuredClone(data) }));
  const backup = documents();
  await createFirestoreNotificationMessages({ ...f.options, messageHistoryEnabled: true }).page('owner', {});
  await f.authority.runTransaction('owner', null, async b => { const change = await b.prepareErasure(randomUUID(), 'child', f.child.id); change.commit(); });
  function paused(rows: ReturnType<typeof documents>) {
    return rows.map(row => { const opened = codec.decode(row); return opened.context.kind === 'control'
      ? codec.transform(opened, { generation: f.generation, newEpochByWorkspace: new Map(), photoDescriptors: new Map() }) : row; });
  }
  const result = prepareFirebaseRestore(f.options, { restoreId: randomUUID(), targetDatabaseId: 'synthetic-restored', sourceGeneration: f.generation,
    documents: paused(backup), liveDocuments: paused(documents()), authUsers: ['owner', 'peer'].map(userId => ({ userId, email: userId + '@example.test', emailVerified: true, disabled: false })),
    erasures: [], photoDescriptors: new Map(), erasureDescriptors: new Map() });
  const workspace = result.records.map(row => codec.decode(row)).find(row => row.context.kind === 'workspace' && row.context.scope.ownerUserId === 'owner');
  assert.equal(firestoreAuthoritySchemas.workspace.parse(workspace!.value).childAccessVersion, '1');
  const peer = result.records.map(row => codec.decode(row)).find(row => row.context.kind === 'workspace' && row.context.scope.ownerUserId === 'peer');
  assert.equal('childAccessVersion' in firestoreAuthoritySchemas.workspace.parse(peer!.value), false);
});
