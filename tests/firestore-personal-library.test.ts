import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFirestorePersonalLibrary } from '../server/firestore-personal-library.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
const scope = { ownerUserId: 'synthetic-owner', workspaceId: '11111111-1111-4111-8111-111111111111',
  childId: '22222222-2222-4222-8222-222222222222', storageEpoch: '33333333-3333-4333-8333-333333333333' };
const base = { cipher: createStorageCipher(Buffer.alloc(32, 7)), projectId: 'synthetic-project', namespace: 'test_authority' };

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

test('scope changes while reading the public catalogue do not return a stale success', async () => {
  let calls = 0;
  const library = createFirestorePersonalLibrary({ ...base, authority: { async readScope() {
    return { scope, authorizationVersion: ++calls === 1 ? '1' : '2' };
  } }, knowledge: { async catalog() { return { items: [], nextSourceId: null }; } } });
  await assert.rejects(library.page(scope.ownerUserId, scope.childId), { code: 'library_scope_changed' });
});
