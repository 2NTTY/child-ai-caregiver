import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createFirebaseRestoreApply } from '../server/firebase-restore-apply.ts';
import { canonical } from '../server/firestore-session-codec.ts';
import { firebaseBackupDocumentDigest } from '../server/firestore-backup.ts';
import { avatarRestoreFixture } from './helpers/avatar-restore-memory.ts';
const digest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
const code = (expected: string) => (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === expected;
async function fixture(count = 81) {
  const f = avatarRestoreFixture(), collection = f.options.namespace + '_restore_operations/';
  const original = Array.from({ length: count }, (_, i) => ({ path: f.options.namespace + '/row-' + i, data: { value: 1 } }));
  for (const row of original) f.fake.records.set(row.path, row.data);
  const originalHash = digest(original.map(row => ({ path: row.path, sha256: firebaseBackupDocumentDigest(row).sha256 })).sort((a,b) => a.path.localeCompare(b.path)));
  const value = { ...f.value(), originalInventoryHash: originalHash }, descriptor = f.stored(value); let writes = 0;
  await f.copies.stage([value]);
  const write = async () => { writes++; f.objects.set(descriptor.objectName, descriptor); return descriptor; };
  await f.copies.execute(value, write); const frozen = await f.copies.freeze(f.identity);
  const binding = { setHash: frozen.setHash, recordsHash: frozen.recordsHash, originalInventoryHash: originalHash };
  const apply = createFirebaseRestoreApply(f.options), records = original.map(row => ({ ...row, data: { value: 2 } }));
  const final = { synthetic: 'immutable encrypted final', nonce: 'original' };
  const inventory = async () => f.copies.inventory(f.identity, await apply.checkpointState(f.identity), () => {});
  const validate = async () => {
    await inventory();
    for (const row of original) assert.deepEqual(f.fake.records.get(row.path), row.data, 'original business inventory unchanged');
  };
  const stage = (validateSource = validate) => apply.stage(f.identity, original, records, [], final, { binding, validateSource });
  const keys = () => [...f.fake.records.keys()].filter(path => path.startsWith(collection));
  return { ...f, collection, original, records, value, write, writes: () => writes, apply, binding, final, inventory, validate, stage, keys };
}

test('avatar marker is durable before first page; lost acknowledgement never restages a fresh ciphertext', async () => {
  const f = await fixture(); f.fake.loseReply(); await assert.rejects(f.stage());
  assert.equal(f.keys().filter(path => path.includes('/page-')).length, 0);
  assert.equal((await f.apply.checkpointState(f.identity)).phase, 'avatar-staging');
  await assert.rejects(f.stage(), code('recovery_avatar_plan_recovery_required'));
  assert.equal(await f.apply.recoverAvatarStage(f.identity, f.validate), 'discarded');
  assert.equal((await f.inventory()).payloads.length, 1); assert.equal(f.writes(), 1);
  await f.copies.execute(f.value, f.write); assert.equal(f.writes(), 1);
  await f.stage(); assert.equal((await f.apply.checkpointState(f.identity)).phase, 'progress');
  assert.equal(f.fake.records.has(f.collection + 'current'), false);
});

test('partial pages discard is fenced, survives a lost CAS acknowledgement, and retains copy responsibility', async () => {
  const f = await fixture(); let checks = 0;
  await assert.rejects(f.stage(async () => { await f.validate(); if (++checks === 3) throw new Error('synthetic interrupted second page'); }), /interrupted/);
  assert.equal(f.keys().filter(path => path.includes('/page-')).length, 1);
  f.fake.loseReply(); await assert.rejects(f.apply.recoverAvatarStage(f.identity, f.validate));
  assert.equal((await f.apply.checkpointState(f.identity)).phase, 'avatar-staging');
  assert.equal(await createFirebaseRestoreApply(f.options).recoverAvatarStage(f.identity, f.validate), 'discarded');
  assert.equal(f.keys().some(path => path.includes('/page-') || path.endsWith('/avatar-plan-stage')), false);
  assert.equal((await f.inventory()).payloads.length, 1); assert.equal(f.writes(), 1);
  await f.stage(); assert.equal((await f.apply.read(f.identity))?.nextPage, 0);
});

test('a complete authenticated page set promotes its original final without rebuilding or recopying', async () => {
  const f = await fixture(); let checks = 0;
  await assert.rejects(f.stage(async () => { await f.validate(); if (++checks === 4) throw new Error('synthetic before progress'); }), /before progress/);
  assert.equal(f.keys().filter(path => path.includes('/page-')).length, 2);
  const pages = new Map(f.keys().filter(path => path.includes('/page-')).map(path => [path, structuredClone(f.fake.records.get(path))]));
  assert.equal(await f.apply.recoverAvatarStage(f.identity, f.validate), 'promoted');
  assert.deepEqual((await f.apply.read(f.identity))?.final, f.final);
  for (const [path, data] of pages) assert.deepEqual(f.fake.records.get(path), data);
  assert.equal(f.fake.records.has(f.collection + 'avatar-plan-stage'), false); assert.equal(f.writes(), 1);
  assert.equal((await f.inventory()).payloads.length, 1);
});

test('tampered, extra and marker-free legacy pages remain rejected, never broadly excluded', async () => {
  for (const kind of ['tampered', 'extra', 'legacy']) {
    const f = await fixture(); let checks = 0;
    await assert.rejects(f.stage(async () => { if (++checks === 3) throw new Error('synthetic interruption'); }));
    const page = f.keys().find(path => path.includes('/page-'))!;
    if (kind === 'tampered') f.fake.records.set(page, { ...f.fake.records.get(page), ciphertext: 'invalid' });
    if (kind === 'extra') f.fake.records.set(f.collection + 'page-' + f.identity + '-999', { foreign: true });
    if (kind === 'legacy') f.fake.records.delete(f.collection + 'avatar-plan-stage');
    await assert.rejects(f.inventory());
    assert.equal(f.fake.records.has(f.collection + 'current'), false); assert.equal(f.writes(), 1);
    assert.equal(f.keys().filter(path => path.includes('/avatar-copy-')).length, 2);
  }
});

test('discard and new attempt fence the delayed original page writer without an ABA overwrite', async () => {
  const f = await fixture(1); let reached!: () => void, release!: () => void, checks = 0;
  const blocked = new Promise<void>(resolve => { reached = resolve; }), resume = new Promise<void>(resolve => { release = resolve; });
  const original = f.stage(async () => { if (++checks === 2) { reached(); await resume; } });
  const rejected = assert.rejects(original, code('recovery_avatar_plan_changed'));
  await blocked; assert.equal(await f.apply.recoverAvatarStage(f.identity, f.validate), 'discarded');
  let nextReached!: () => void, nextRelease!: () => void, nextChecks = 0;
  const nextBlocked = new Promise<void>(resolve => { nextReached = resolve; }), nextResume = new Promise<void>(resolve => { nextRelease = resolve; });
  const next = f.stage(async () => { if (++nextChecks === 2) { nextReached(); await nextResume; } });
  await nextBlocked; assert.equal(f.fake.records.has(f.collection + 'progress'), false);
  assert.equal((await f.apply.checkpointState(f.identity)).phase, 'avatar-staging');
  const before = structuredClone([...f.fake.records]); release(); await rejected;
  assert.deepEqual([...f.fake.records], before); assert.equal(f.writes(), 1);
  nextRelease(); await next; assert.equal((await f.apply.checkpointState(f.identity)).phase, 'progress');
});

test('changed provenance or original target stops both promotion and discard with intents retained', async () => {
  for (const complete of [false, true]) {
    const f = await fixture(1); let checks = 0;
    await assert.rejects(f.stage(async () => { if (++checks === (complete ? 3 : 2)) throw new Error('synthetic interruption'); }));
    const before = structuredClone([...f.fake.records]);
    await assert.rejects(f.apply.recoverAvatarStage(f.identity, async () => { throw Object.assign(new Error('changed'), { code: 'recovery_native_provenance_changed' }); }), code('recovery_native_provenance_changed'));
    assert.deepEqual([...f.fake.records], before);
    f.fake.records.set(f.original[0]!.path, { value: 99 });
    await assert.rejects(f.apply.recoverAvatarStage(f.identity, f.validate), /original business inventory unchanged/);
    assert.equal(f.fake.records.has(f.collection + 'avatar-plan-stage'), true);
    assert.equal(f.fake.records.has(f.collection + 'current'), false); assert.equal(f.writes(), 1);
  }
});

test('staging cannot be authorized without the same known copy set and exact original inventory binding', async () => {
  const f = await fixture(1); let checks = 0;
  await assert.rejects(f.stage(async () => { if (++checks === 2) throw new Error('synthetic interruption'); }));
  const state = await f.apply.checkpointState(f.identity); assert.equal(state.phase, 'avatar-staging');
  if (state.phase !== 'avatar-staging') assert.fail('expected staging');
  await assert.rejects(f.copies.inventory(f.identity, { ...state, binding: { ...state.binding, recordsHash: '0'.repeat(64) } }, () => {}), code('recovery_avatar_copy_phase'));
  f.fake.records.delete(f.collection + 'avatar-copy-index');
  await assert.rejects(f.inventory(), code('recovery_avatar_copy_header_missing'));
  assert.equal(f.fake.records.has(f.collection + 'current'), false); assert.equal(f.writes(), 1);
});
