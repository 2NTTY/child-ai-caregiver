import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { handlePersonalLibraryRequest } from '../server/personal-library-api.ts';
import { createProductAgentApi } from '../src/client/product-agent-api.ts';
import { createFirestorePersonalLibrary } from '../server/firestore-personal-library.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
const scope = { ownerUserId: 'synthetic-owner', workspaceId: '11111111-1111-4111-8111-111111111111',
  childId: '22222222-2222-4222-8222-222222222222', storageEpoch: '33333333-3333-4333-8333-333333333333' };
const base = { cipher: createStorageCipher(Buffer.alloc(32, 7)), projectId: 'synthetic-project', namespace: 'test_authority' };

test('ending a library ZIP download releases its scratch file, including a session change before delivery', { timeout: 5_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'library-download-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const revoked of [false, true]) {
    const path = join(dir, revoked ? 'revoked.zip' : 'cancelled.zip');
    const bytes = 1024 * 1024;
    await writeFile(path, Buffer.alloc(bytes));
    let notifyRelease!: () => void;
    const released = new Promise<void>(resolve => { notifyRelease = resolve; });
    let checked = 0;
    const response = await handlePersonalLibraryRequest(new Request('https://example.test/api/children/' + scope.childId + '/library?export=zip', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-expected-user-id': scope.ownerUserId },
      body: JSON.stringify({ seriesId: 'series', editions: [{ sourceId: 'book', versionHash: 'a'.repeat(64) }] }),
    }), scope.ownerUserId, { isCurrentUser: async () => ++checked === 1 || !revoked,
      readJson: request => request.json(), library: { async page() { throw Error('unused'); }, async exportArchive() {
        return { path, bytes, sha256: 'a'.repeat(64), async dispose() { await rm(path); notifyRelease(); } };
      } } });
    assert.equal(response.status, revoked ? 409 : 200);
    if (!revoked) {
      assert.equal(response.headers.get('content-length'), String(bytes));
      await response.body!.cancel();
    }
    await released;
  }
});

test('public catalogue cursor binds the current account, child, epoch and authorization version', async () => {
  let current = { scope: { ...scope }, authorizationVersion: '1' }; const after: (string | null)[] = [];
  const library = createFirestorePersonalLibrary({ ...base, authority: { async readScope(userId, childId) {
    assert.equal(userId, scope.ownerUserId); assert.equal(childId, scope.childId); return structuredClone(current);
  } }, knowledge: { async catalog(value = null) { after.push(value); return { items: [], nextSourceId: value === null ? 'source-one' : null }; } } });
  const first = await library.page(scope.ownerUserId, scope.childId); assert.equal(first.complete, false); assert.ok(first.nextCursor);
  assert.equal((await library.page(scope.ownerUserId, scope.childId, first.nextCursor)).complete, true);
  assert.deepEqual(after, [null, 'source-one']);
  current.authorizationVersion = '2';
  await assert.rejects(library.page(scope.ownerUserId, scope.childId, first.nextCursor), { code: 'library_scope_changed' });
  assert.equal(after.length, 2);
  current.authorizationVersion = '1'; current.scope.storageEpoch = '44444444-4444-4444-8444-444444444444';
  await assert.rejects(library.page(scope.ownerUserId, scope.childId, first.nextCursor), { code: 'library_scope_changed' });
  const other = createFirestorePersonalLibrary({ ...base, projectId: 'another-project', authority: { async readScope() { return { scope, authorizationVersion: '1' }; } },
    knowledge: { async catalog() { throw new Error('must not load'); } } });
  await assert.rejects(other.page(scope.ownerUserId, scope.childId, first.nextCursor), { code: 'invalid_cursor' });
});

test('existing strict Android catalogue and new series-aware client read the same authenticated route', async () => {
  // Keep the released client's field set independent of the current contract.
  const time = z.iso.datetime({ offset: true });
  const released = z.strictObject({ items: z.array(z.strictObject({ sourceId: z.string(), versionId: z.uuid(), title: z.string(),
    publisher: z.string(), url: z.url(), classification: z.enum(['official_guidance', 'recent_information']), checkedAt: time,
    sourceUpdatedAt: time.nullable(), validUntil: time.nullable() })), nextCursor: z.string().nullable(), complete: z.boolean() });
  const item = { sourceId: 'fhs-solid-food', versionId: scope.storageEpoch, title: 'Booklet', publisher: 'FHS', url: 'https://www.fhs.gov.hk/',
    classification: 'official_guidance' as const, checkedAt: '2026-11-01T12:00:00Z', sourceUpdatedAt: null, validUntil: null,
    series: { id: 'fhs-infant-feeding', institutionId: 'www.fhs.gov.hk', name: 'Feeding' }, versionHash: 'a'.repeat(64),
    preference: { revision: 1, enabled: true, mode: 'fixed' as const, selectedVersionId: scope.storageEpoch, eligible: true } };
  const library = { async page() { return { items: [item], registered: [], complete: true, nextCursor: null }; } };
  const route = (req: Request) => handlePersonalLibraryRequest(req, scope.ownerUserId, { library, isCurrentUser: async () => true });
  const baseUrl = 'https://example.test', path = '/api/children/' + scope.childId + '/library';
  const old = await route(new Request(baseUrl + path, { headers: { accept: 'application/json', 'x-expected-user-id': scope.ownerUserId } }));
  assert.equal(old.status, 200); assert.equal(released.parse(await old.json()).items[0]?.versionId, item.versionId);
  const client = createProductAgentApi(baseUrl, (url, init) => route(new Request(url, init)));
  const current = await client.getLibrary(scope.childId, new AbortController().signal, scope.ownerUserId);
  assert.equal(current.items[0]?.series?.id, item.series.id); assert.deepEqual(current.items[0]?.preference, item.preference);
  assert.deepEqual(current.registered, []);
});

test('scope changes while reading the public catalogue do not return a stale success', async () => {
  let calls = 0;
  const library = createFirestorePersonalLibrary({ ...base, authority: { async readScope() {
    return { scope, authorizationVersion: ++calls === 1 ? '1' : '2' };
  } }, knowledge: { async catalog() { return { items: [], nextSourceId: null }; } } });
  await assert.rejects(library.page(scope.ownerUserId, scope.childId), { code: 'library_scope_changed' });
});
