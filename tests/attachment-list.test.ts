import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { readAttachmentListPolicy } from '../server/config.ts';
import { attachmentListQuery, createPrivateAttachmentList } from '../server/firestore-attachment-list.ts';
import { voiceAttachmentPageSchema } from '../src/shared/voice.ts';
import { chatFileAttachmentPageSchema } from '../src/shared/chat-files.ts';
import { createVoiceApi } from '../src/client/voice-api.ts';
import { createChatFileApi } from '../src/client/chat-file-api.ts';
import { handleFirebaseVoiceRequest, type FirebaseVoiceApiPort } from '../server/firebase-voice-api.ts';
import { handleFirebaseChatFileRequest, type FirebaseChatFileApiPort } from '../server/firebase-chat-files-api.ts';
import { createFirestoreAuthority, type FirestoreAuthority, type FirestoreAuthorityTransaction } from '../server/firestore-authority.ts';
import { FirestoreDomainData, firestoreDomainHash } from '../server/firestore-domain-data.ts';
import { createFirestoreVoiceStore, firestoreVoiceRowSchema } from '../server/firestore-voice.ts';
import { createFirestoreChatFilesStore, firestoreChatFileRowSchema } from '../server/firestore-chat-files.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';

const date = '2026-10-23T06:00:00.000Z';
const id = (n: number) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const code = (expected: string) => (error: unknown) => (error as { code: string }).code === expected;
const policy = { defaultLimit: 2, maxLimit: 2, scanLimit: 2 };
const item = (n = 1) => ({ id: id(n), childId: id(99), version: 3, createdAt: date, state: 'ready' as const,
  fileName: 'synthetic.wav', mimeType: 'audio/wav' as const, bytes: 4, sha256: 'a'.repeat(64), durationMs: 1000, messageId: id(80 + n) });
const page = { items: [item()], nextCursor: null, complete: true, scanned: 1 };

// Narrow deterministic checks; no emulators, network, media objects or models.
test('list policy is adjustable per request, and strict metadata pages reject leakage and false completion', () => {
  assert.deepEqual(readAttachmentListPolicy({}), { defaultLimit: 20, maxLimit: 50, scanLimit: 100 });
  assert.deepEqual(readAttachmentListPolicy({ ATTACHMENT_LIST_DEFAULT_LIMIT: '2', ATTACHMENT_LIST_MAX_LIMIT: '3', ATTACHMENT_LIST_SCAN_LIMIT: '4' }), { defaultLimit: 2, maxLimit: 3, scanLimit: 4 });
  for (const env of [{ ATTACHMENT_LIST_DEFAULT_LIMIT: '0' }, { ATTACHMENT_LIST_MAX_LIMIT: '101' },
    { ATTACHMENT_LIST_SCAN_LIMIT: '501' }, { ATTACHMENT_LIST_SCAN_LIMIT: '2' }, { ATTACHMENT_LIST_DEFAULT_LIMIT: '20.0' }]) assert.throws(() => readAttachmentListPolicy(env));
  assert.ok(voiceAttachmentPageSchema.safeParse(page).success);
  assert.ok(voiceAttachmentPageSchema.safeParse({ items: [], scanned: 2, nextCursor: 'opaque', complete: false }).success);
  for (const bad of [{ ...page, url: 'https://example.test' }, { ...page, complete: false },
    { ...page, items: [{ ...item(), base64: 'AAAA' }] }, { ...page, items: [{ ...item(), state: 'deleted' }] },
    { ...page, items: [{ ...item(), messageId: null }] }, { ...page, items: [item(1), item(2)], scanned: 2 },
    { ...page, items: [item(1), item(1)], scanned: 2 }, { items: [], scanned: 0, nextCursor: 'opaque', complete: false }])
    assert.equal(voiceAttachmentPageSchema.safeParse(bad).success, false);
  const { durationMs: _, ...file } = item();
  assert.ok(chatFileAttachmentPageSchema.safeParse({ ...page, items: [file] }).success);
  for (const query of ['?limit=0', '?limit=101', '?limit=02', '?limit=2&limit=2', '?cursor=', '?filter=all'])
    assert.throws(() => attachmentListQuery(new URL('https://example.test' + query)), code('invalid_input'));
});

async function helperFixture() {
  const fake = firestoreDomainFixture();
  const options = { database: fake.database, cipher: createStorageCipher(Buffer.alloc(32, 33)), projectId: 'synthetic-list-project', namespace: 'list_unit' };
  const data = new FirestoreDomainData(options);
  let current = { scope: { ownerUserId: 'parent', workspaceId: id(60), childId: id(99), storageEpoch: id(61) },
    authorizationVersion: '1', childAccessVersion: '1', generation: id(62) };
  let calls = 0, afterFirst: (() => void) | undefined;
  const authority = { async runTransaction<T>(_userId: string, _childId: string | null, operation: (b: FirestoreAuthorityTransaction) => Promise<T>) {
    const result = await fake.database.runTransaction(transaction => operation({ ...current, transaction } as FirestoreAuthorityTransaction));
    if (++calls % 2 === 1) afterFirst?.();
    return result;
  } } satisfies Pick<FirestoreAuthority, 'runTransaction'>;
  const scopeTag = (scope: unknown) => firestoreDomainHash(scope);
  const make = (source: 'voices' | 'files' = 'voices') => createPrivateAttachmentList({ data, authority, source, policy, scopeTag,
    open: snapshot => snapshot.get('row') as ReturnType<typeof item>, view: row => row });
  const seed = (n: number, linked = true, at = date) => {
    const row = { ...item(n), createdAt: at, messageId: linked ? id(80 + n) : null };
    fake.records.set(data.ref('voice_assets', 'voice-asset', row.id).path, {
      assetId: row.id, createdAt: at, state: row.state, scopeTag: scopeTag(current.scope), row });
  };
  return { ...fake, options, data, make, seed, current: () => current,
    set: (next: typeof current) => { current = next; }, after: (hook?: () => void) => { calls = 0; afterFirst = hook; } };
}

test('bounded scan uses last scanned cursor, handles empty not-complete and stable timestamp/id order', async () => {
  const f = await helperFixture(), list = f.make();
  for (const n of [1, 2, 3, 4, 5]) f.seed(n, n < 4);
  const before = JSON.stringify([...f.records]);
  const first = await list('parent', id(99));
  assert.deepEqual(first.items, []); assert.equal(first.scanned, 2); assert.equal(first.complete, false); assert.ok(first.nextCursor);
  assert.equal(Buffer.from(first.nextCursor!, 'base64url').toString().includes('parent'), false);
  const second = await list('parent', id(99), { cursor: first.nextCursor });
  assert.deepEqual(second.items.map(v => v.id), [id(3), id(2)]); assert.equal(second.complete, false);
  const final = await list('parent', id(99), { cursor: second.nextCursor });
  assert.deepEqual(final.items.map(v => v.id), [id(1)]); assert.equal(final.complete, true); assert.equal(final.nextCursor, null);
  assert.equal(JSON.stringify([...f.records]), before, 'List must perform no writes');
  await assert.rejects(list('parent', id(99), { limit: 3 }), code('invalid_input'));
  await assert.rejects(list('parent', id(99), { cursor: first.nextCursor!.slice(0, -8) + 'changed' }), code('invalid_cursor'));
  await assert.rejects(f.make('files')('parent', id(99), { cursor: first.nextCursor }), code('attachment_scope_changed'));
  // New rows above a continuation are intentionally not an immutable historical snapshot.
  f.seed(6, true, '2026-10-23T07:00:00.000Z');
  assert.deepEqual((await list('parent', id(99), { cursor: second.nextCursor })).items.map(v => v.id), [id(1)]);
});

test('first-page transaction retry discards prior items and returns a cursor for the replay authority', async () => {
  const f = await helperFixture(), list = f.make(); for (const n of [1, 2, 3, 4, 5]) f.seed(n);
  const before = JSON.stringify([...f.records]);
  f.retry(async () => { f.set({ ...f.current(), authorizationVersion: '2' }); });
  const first = await list('parent', id(99));
  assert.deepEqual(first.items.map(value => value.id), [id(5), id(4)]);
  assert.equal(first.scanned, 2); assert.equal(first.complete, false);
  // This continuation must accept the replay's authority, not the discarded attempt's fence.
  const second = await list('parent', id(99), { cursor: first.nextCursor });
  const final = await list('parent', id(99), { cursor: second.nextCursor });
  assert.deepEqual([...first.items, ...second.items, ...final.items].map(value => value.id), [5, 4, 3, 2, 1].map(id));
  assert.equal(final.complete, true); assert.equal(JSON.stringify([...f.records]), before);
});

test('continuation transaction retry neither skips nor duplicates and rejects a changed replay authority', async () => {
  const f = await helperFixture(), list = f.make(); for (const n of [1, 2, 3, 4, 5]) f.seed(n);
  const first = await list('parent', id(99));
  f.retry();
  const second = await list('parent', id(99), { cursor: first.nextCursor });
  assert.deepEqual(second.items.map(value => value.id), [id(3), id(2)]);
  assert.equal(second.scanned, 2); assert.equal(second.complete, false);
  const final = await list('parent', id(99), { cursor: second.nextCursor });
  assert.deepEqual([...first.items, ...second.items, ...final.items].map(value => value.id), [5, 4, 3, 2, 1].map(id));
  assert.equal(final.nextCursor, null);
  f.retry(async () => { f.set({ ...f.current(), childAccessVersion: '2' }); });
  await assert.rejects(list('parent', id(99), { cursor: first.nextCursor }), code('attachment_scope_changed'));
});

test('cursor binds all authority fences and rejects authorization changing before publication', async () => {
  const f = await helperFixture(), list = f.make(); for (const n of [1, 2, 3]) f.seed(n);
  const first = await list('parent', id(99)), original = structuredClone(f.current());
  const changed = [
    { ...original, authorizationVersion: '2' }, { ...original, childAccessVersion: '2' }, { ...original, generation: id(63) },
    ...(['ownerUserId', 'workspaceId', 'childId', 'storageEpoch'] as const).map(key => ({ ...original, scope: { ...original.scope, [key]: key === 'ownerUserId' ? 'other' : id(70) } })),
  ];
  for (const next of changed) { f.set(next); await assert.rejects(list('parent', id(99), { cursor: first.nextCursor }), code('attachment_scope_changed')); }
  f.set(original);
  const aad = JSON.stringify(['yuban-attachment-list-cursor', 1, f.options.projectId, f.options.namespace]);
  const decoded = JSON.parse(f.options.cipher.decrypt(Buffer.from(first.nextCursor!, 'base64url').toString(), aad));
  for (const field of ['sourceVersion', 'sort', 'filter']) {
    const stale = Buffer.from(f.options.cipher.encrypt(JSON.stringify({ ...decoded, [field]: 'future-contract' }), aad)).toString('base64url');
    await assert.rejects(list('parent', id(99), { cursor: stale }), code('attachment_scope_changed'));
  }
  f.after(() => f.set({ ...original, childAccessVersion: '2' }));
  await assert.rejects(list('parent', id(99)), code('attachment_scope_changed'));
  f.after(); f.set(original);
  const doc = [...f.records.values()][0]; doc.createdAt = '2026-10-24T06:00:00.000Z';
  await assert.rejects(list('parent', id(99)), code('attachment_list_integrity'));
});

async function realStoreFixture() {
  const fake = firestoreDomainFixture(), options = { database: fake.database, cipher: createStorageCipher(Buffer.alloc(32, 35)), projectId: 'synthetic-list-project', namespace: 'list_store' };
  const authority = createFirestoreAuthority(options), data = new FirestoreDomainData(options);
  await authority.initializeControl({ generation: randomUUID(), enabled: true });
  for (const userId of ['parent', 'other']) {
    const email = userId + '@example.test';
    await authority.issueInvitation({ email, expiresAt: new Date(Date.now() + 60_000).toISOString(), operationId: randomUUID() });
    await authority.admitIdentity({ userId, email, emailVerified: true });
    await authority.acknowledge({ userId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  }
  const online = createFirestoreOnlineStore(options);
  const children: string[] = [];
  for (let n = 0; n < 2; n++) {
    const path = '/api/children', payload = { displayName: 'Synthetic list child ' + n };
    const result = await online.submit('parent', { path, payload, operation: { ...await online.context('parent', { path, payload }), opId: randomUUID(), deviceId: randomUUID() } });
    children.push((result.result as { child: { id: string } }).child.id);
  }
  const scope = await authority.runTransaction('parent', children[0], async b => b.scope);
  const forbidden = () => { throw new Error('List must not access objects or mutation journal'); };
  const shared = { ...options, attachmentListPolicy: policy, objects: { address: forbidden, read: forbidden, write: forbidden, inspect: forbidden, remove: forbidden }, journal: { writeOnce: forbidden, read: forbidden } };
  const voices = createFirestoreVoiceStore(shared), files = createFirestoreChatFilesStore(shared);
  const seed = (source: 'voice' | 'file', n: number, linked = true, state = 'ready') => {
    const assetId = id(n), kind = source === 'voice' ? 'voice-asset' : 'chat-file-asset', collection = source === 'voice' ? 'voice_assets' : 'chat_file_assets';
    const schema = source === 'voice' ? firestoreVoiceRowSchema : firestoreChatFileRowSchema;
    const row = { id: assetId, scope, objectScope: scope, version: 3, createdAt: date, updatedAt: date, fingerprint: 'b'.repeat(64),
      metadata: { fileName: source + '.synthetic', mimeType: source === 'voice' ? 'audio/wav' : 'video/mp4', bytes: 4, sha256: 'a'.repeat(64) },
      state, upload: null, messageId: linked ? id(n + 80) : null, deletion: null,
      descriptor: state === 'ready' ? { objectName: (source === 'voice' ? 'voice' : 'chat-file') + '/v1/' + 'a'.repeat(64) + '/' + assetId,
        generation: '1', cipherSha256: 'c'.repeat(64), sha256: 'a'.repeat(64), bytes: 4, mimeType: source === 'voice' ? 'audio/wav' : 'video/mp4', ...(source === 'voice' ? { durationMs: 1000 } : {}) } : null };
    const parsed = schema.parse(row);
    fake.records.set(data.ref(collection, kind, assetId).path, { ...data.tags(scope), scopeTag: firestoreDomainHash([source === 'voice' ? 'voice-scope' : 'chat-file-scope', scope]),
      assetId, createdAt: date, updatedAt: date, state, messageId: row.messageId,
      ...data.seal(kind, assetId, scope, schema as z.ZodType<typeof parsed>, parsed, 3) });
  };
  return { ...fake, voices, files, children, seed };
}

test('both real stores list sealed own-child linked metadata only and preserve existing get DTO', async () => {
  const f = await realStoreFixture();
  for (const source of ['voice', 'file'] as const) { f.seed(source, 1); f.seed(source, 2, false); f.seed(source, 3, false, 'reserved'); }
  // Query-level removal excludes tombstones without opening their former private payload.
  for (const [path, value] of [...f.records]) {
    if (path.includes('_voice_assets/') || path.includes('_chat_file_assets/')) {
      if (value.assetId === id(3)) { value.state = 'deleting'; }
      if (value.assetId === id(2)) f.records.set(path + '-removed', { ...value, assetId: id(4), state: 'deleted', ciphertext: 'unreadable-tombstone' });
    }
  }
  const before = JSON.stringify([...f.records]);
  for (const store of [f.voices, f.files]) {
    const listed = await store.list('parent', f.children[0]);
    assert.equal(listed.items.length, 1); assert.equal(listed.items[0].id, id(1)); assert.equal(listed.scanned, 2); assert.equal(listed.complete, true);
    assert.deepEqual(listed.items[0], await store.get('parent', f.children[0], id(1)));
    assert.deepEqual((await store.list('parent', f.children[1])).items, []);
    await assert.rejects(store.list('other', f.children[0]));
    await assert.rejects(store.list('parent', id(999)));
  }
  assert.ok(voiceAttachmentPageSchema.safeParse(await f.voices.list('parent', f.children[0])).success);
  assert.ok(chatFileAttachmentPageSchema.safeParse(await f.files.list('parent', f.children[0])).success);
  assert.equal(JSON.stringify([...f.records]), before);
  const ready = [...f.records.values()].find(value => value.assetId === id(1) && value.state === 'ready');
  ready.ciphertext = 'corrupt-sealed-metadata';
  await assert.rejects(f.voices.list('parent', f.children[0]), code('attachment_list_integrity'));
});

test('handlers preserve session preconditions, expose no-store metadata and reject unavailable or late identity', async () => {
  for (const source of ['voices', 'files'] as const) {
    const handler = source === 'voices' ? handleFirebaseVoiceRequest : handleFirebaseChatFileRequest;
    let calls = 0, expectedQuery: unknown;
    const port = { list: async (_u: string, _c: string, query: unknown) => { calls++; expectedQuery = query; return page; },
      get: async () => item() } as unknown as FirebaseVoiceApiPort & FirebaseChatFileApiPort;
    const request = (suffix = '?limit=2&cursor=opaque', user: string | null = 'parent') => new Request('https://example.test/api/children/' + id(99) + '/' + source + suffix,
      { headers: user === null ? {} : { 'x-expected-user-id': user } });
    const response = await handler(request(), 'parent', port, async () => true);
    assert.equal(response.headers.get('cache-control'), 'private, no-store'); assert.deepEqual(await response.json(), page);
    assert.deepEqual(expectedQuery, { limit: 2, cursor: 'opaque' }); assert.equal(calls, 1);
    await assert.rejects(handler(request('', null), 'parent', port, async () => true), code('account_precondition_required'));
    await assert.rejects(handler(request('', 'other'), 'parent', port, async () => true), code('session_changed'));
    await assert.rejects(handler(request('?limit=2&limit=2'), 'parent', port, async () => true), code('invalid_input'));
    await assert.rejects(handler(request(''), 'parent', {} as typeof port, async () => true), code('attachment_list_unavailable'));
    let checks = 0;
    await assert.rejects(handler(request(''), 'parent', port, async () => ++checks === 1), code('identity_changed'));
    const old = await handler(request('/' + id(1)), 'parent', port, async () => true);
    assert.deepEqual(await old.json(), { [source === 'voices' ? 'voice' : 'file']: item() });
    await assert.rejects(handler(request('/' + id(1) + '?limit=2'), 'parent', port, async () => true), code('invalid_input'));
  }
});

test('clients use formal list routes and reject cross-child, raw leakage, repeated cursors and late bodies', async () => {
  for (const source of ['voices', 'files'] as const) {
    const { durationMs: _, ...file } = item(); const dto = source === 'voices' ? item() : file;
    let body: unknown = { ...page, items: [dto] }, late: (() => void) | undefined;
    const fetcher: typeof fetch = async (url, init) => {
      assert.equal(String(url), 'https://example.test/api/children/' + id(99) + '/' + source + '?limit=2&cursor=opaque');
      assert.equal(init?.cache, 'no-store'); assert.equal(new Headers(init?.headers).get('x-expected-user-id'), 'parent');
      const response = Response.json(body); response.json = async () => { late?.(); return body; }; return response;
    };
    const api = source === 'voices' ? createVoiceApi(fetcher, 'https://example.test') : createChatFileApi(fetcher, 'https://example.test');
    const query = { limit: 2, cursor: 'opaque' }, controller = new AbortController();
    assert.equal((await api.list(id(99), query, controller.signal, 'parent')).items.length, 1);
    for (const bad of [{ ...page, items: [{ ...dto, childId: id(98) }] }, { ...page, items: [{ ...dto, base64: 'AAAA' }] },
      { ...page, items: [dto], nextCursor: 'opaque', complete: false }]) {
      body = bad; await assert.rejects(api.list(id(99), query, controller.signal, 'parent'), code(source === 'voices' ? 'voice_response_invalid' : 'file_response_invalid'));
    }
    body = { ...page, items: [dto] }; late = () => controller.abort();
    await assert.rejects(api.list(id(99), query, controller.signal, 'parent'), code('identity_changed'));
  }
});

test('real clients and handlers traverse sealed stores without reading originals or writing records', async () => {
  const f = await realStoreFixture();
  for (const source of ['voice', 'file'] as const) {
    f.seed(source, 1); f.seed(source, 2); f.seed(source, 3, false); f.seed(source, 4, false);
  }
  const before = JSON.stringify([...f.records]);
  for (const source of ['voices', 'files'] as const) {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (url, init) => {
      const request = new Request(url, init); requests.push(request.url);
      assert.equal(request.method, 'GET');
      assert.equal(request.headers.get('x-expected-user-id'), 'parent');
      const response = source === 'voices'
        ? await handleFirebaseVoiceRequest(request, 'parent', f.voices, async () => true)
        : await handleFirebaseChatFileRequest(request, 'parent', f.files, async () => true);
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
      return response;
    };
    const api = source === 'voices' ? createVoiceApi(fetcher, 'https://example.test') : createChatFileApi(fetcher, 'https://example.test');
    const signal = new AbortController().signal;
    const first = await api.list(f.children[0], {}, signal, 'parent');
    assert.deepEqual(first.items, []); assert.equal(first.complete, false); assert.ok(first.nextCursor);
    const second = await api.list(f.children[0], { cursor: first.nextCursor }, signal, 'parent');
    assert.deepEqual(second.items.map(value => value.id), [id(2), id(1)]); assert.equal(second.complete, true);
    assert.equal(requests.length, 2); assert.equal(new URL(requests[0]).search, '');
    assert.equal(new URL(requests[1]).searchParams.get('cursor'), first.nextCursor);
    assert.equal(second.items[0].mimeType, source === 'voices' ? 'audio/wav' : 'video/mp4');
  }
  assert.equal(JSON.stringify([...f.records]), before);
});
