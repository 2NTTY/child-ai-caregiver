import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { avatarDomainFixture } from './helpers/avatar-memory.ts';
import { avatarReserveResultSchema, avatarMutationResultSchema } from '../src/shared/avatars.ts';
import { createFirestoreAccountExport } from '../server/firestore-account-export.ts';
import { FirestoreDomainError } from '../server/firestore-domain-data.ts';
const code = (expected: string) => (error: unknown) => error instanceof FirestoreDomainError && error.code === expected;

test('self avatar needs no child; ready swap is atomic, private and emits no Agent/change event', async () => {
  const f = await avatarDomainFixture(), before = [...f.fake.records.keys()].filter(key => /changes|background|work_events/u.test(key));
  assert.equal((await f.avatars.read(f.owner, f.target)).avatar.version, 0);
  const reserve = f.reserve(), first = await f.online.submit(f.owner, reserve), upload = avatarReserveResultSchema.parse(first.result).upload;
  assert.equal((await f.avatars.read(f.owner, f.target)).avatar.asset, null);
  await f.upload(upload.id); assert.equal((await f.avatars.read(f.owner, f.target)).avatar.version, 0);
  const command = f.submission('commit', { uploadId: upload.id, expectedVersion: 0 }), committed = avatarMutationResultSchema.parse((await f.online.submit(f.owner, command)).result);
  assert.equal(committed.avatar.version, 1); assert.ok(committed.avatar.asset);
  const content = await f.avatars.content(f.owner, f.target, committed.avatar.asset.id, 1); assert.ok(content.buffer.length); content.buffer.fill(0);
  assert.equal(f.decodes(), 1); assert.equal(f.bucket.writes(), 1);
  assert.deepEqual([...f.fake.records.keys()].filter(key => /changes|background|work_events/u.test(key)), before);
  assert.equal(JSON.stringify([...f.fake.records]).includes(f.input.toString()), false);
  assert.equal(JSON.stringify([...f.fake.records]).includes(f.input.toString('base64')), false);
  assert.equal((await f.online.submit(f.owner, command)).operation.opId, command.operation.opId);
});

test('two store instances share actor/target pending cap; reservation nonce does not change public version', async () => {
  const f = await avatarDomainFixture(), second = f.makeStore();
  const outcomes = await Promise.allSettled([f.avatars.submitOnline(f.owner, f.reserve()), second.submitOnline(f.owner, f.reserve()), second.submitOnline(f.owner, f.reserve())]);
  assert.equal(outcomes.filter(value => value.status === 'fulfilled').length, 2);
  const rejected = outcomes.find(value => value.status === 'rejected'); assert.ok(rejected && rejected.status === 'rejected' && code('avatar_busy')(rejected.reason));
  assert.equal((await f.avatars.read(f.owner, f.target)).avatar.version, 0);
  f.advance(f.config.admission.uploadTtlMs + 1);
  await second.submitOnline(f.owner, f.reserve());
  assert.equal((await f.avatars.read(f.owner, f.target)).avatar.version, 0);
});

test('uncertain normalized write reconciles the original upload without another decode or write', async () => {
  const f = await avatarDomainFixture(), reserved = avatarReserveResultSchema.parse((await f.online.submit(f.owner, f.reserve())).result).upload;
  f.bucket.lose(); f.bucket.unavailable(true);
  await assert.rejects(f.upload(reserved.id), code('avatar_unavailable'));
  assert.equal(f.decodes(), 1); assert.equal(f.bucket.writes(), 1);
  f.bucket.unavailable(false); f.advance(f.config.admission.totalTimeoutMs + 1);
  assert.equal((await f.avatars.uploadStatus(f.owner, f.target, reserved.id)).state, 'ready');
  assert.equal((await f.upload(reserved.id)).state, 'ready');
  assert.equal(f.decodes(), 1); assert.equal(f.bucket.writes(), 1);
});

test('failed replacement preserves old current head; superseded cleanup never deletes new current', async () => {
  const f = await avatarDomainFixture(), one = avatarReserveResultSchema.parse((await f.online.submit(f.owner, f.reserve())).result).upload;
  await f.upload(one.id); const original = avatarMutationResultSchema.parse((await f.online.submit(f.owner, f.submission('commit', { uploadId: one.id, expectedVersion: 0 }))).result).avatar;
  const two = avatarReserveResultSchema.parse((await f.online.submit(f.owner, f.reserve(1))).result).upload;
  f.decodeHook(async () => { throw new Error('Synthetic invalid image'); }); await assert.rejects(f.upload(two.id));
  assert.deepEqual((await f.avatars.read(f.owner, f.target)).avatar, original);
  f.decodeHook(); const three = avatarReserveResultSchema.parse((await f.online.submit(f.owner, f.reserve(1))).result).upload;
  await f.upload(three.id); const current = avatarMutationResultSchema.parse((await f.online.submit(f.owner, f.submission('commit', { uploadId: three.id, expectedVersion: 1 }))).result).avatar;
  assert.equal(current.version, 2); assert.equal((await f.cleanup.process(f.binding, current.asset!.id)).state, 'retained');
  assert.equal((await f.cleanup.process(f.binding, original.asset!.id)).state, 'complete');
  assert.ok((await f.avatars.content(f.owner, f.target, current.asset!.id, 2)).buffer.length);
});

test('remove unknown keeps original pending receipt, hides old content and confirms only after durable journal', async () => {
  const f = await avatarDomainFixture(), one = avatarReserveResultSchema.parse((await f.online.submit(f.owner, f.reserve())).result).upload;
  await f.upload(one.id); const old = avatarMutationResultSchema.parse((await f.online.submit(f.owner, f.submission('commit', { uploadId: one.id, expectedVersion: 0 }))).result).avatar;
  const command = f.submission('remove', { expectedVersion: 1, confirmRemove: true });
  f.journalBucket.lose(); f.journalBucket.unavailable(true);
  await assert.rejects(f.online.submit(f.owner, command)); assert.deepEqual(await f.online.lookup(f.owner, command.operation.opId), { state: 'unconfirmed' });
  await assert.rejects(f.avatars.content(f.owner, f.target, old.asset!.id, 1), code('avatar_unavailable'));
  f.journalBucket.unavailable(false); const result = avatarMutationResultSchema.parse((await f.online.submit(f.owner, command)).result);
  assert.equal(result.avatar.version, 2); assert.equal(result.avatar.asset, null);
  assert.equal((await f.online.submit(f.owner, command)).operation.opId, command.operation.opId);
  await assert.rejects(f.online.submit(f.owner, f.submission('commit', { uploadId: one.id, expectedVersion: 1 })), code('avatar_version_conflict'));
  assert.equal((await f.cleanup.process(f.binding, old.asset!.id)).state, 'complete');
});


test('disabled avatar port does not break an otherwise empty account export; genuine content still requires the port', async () => {
  const f = await avatarDomainFixture();
  const exporter = createFirestoreAccountExport({ ...f.options, photos: { async content() { throw new Error('Not a photo path'); } } });
  const empty = await exporter.page(f.owner, { section: 'self_avatar_content' }); assert.deepEqual(empty.items, []);
  const reserved = avatarReserveResultSchema.parse((await f.online.submit(f.owner, f.reserve())).result).upload; await f.upload(reserved.id);
  await f.online.submit(f.owner, f.submission('commit', { uploadId: reserved.id, expectedVersion: 0 }));
  await assert.rejects(exporter.page(f.owner, { section: 'self_avatar_content' }), code('avatar_export_unavailable'));
});

test('export includes only current normalized avatar and fences a head change without changeSeq', async () => {
  const f = await avatarDomainFixture(), reserved = avatarReserveResultSchema.parse((await f.online.submit(f.owner, f.reserve())).result).upload;
  await f.upload(reserved.id); await f.online.submit(f.owner, f.submission('commit', { uploadId: reserved.id, expectedVersion: 0 }));
  const photos = { async content() { throw new Error('Not a photo path'); } };
  const exporter = createFirestoreAccountExport({ ...f.options, photos, avatars: f.avatars });
  const metadata = await exporter.page(f.owner, { section: 'self_avatar' });
  assert.equal(metadata.items.length, 1); assert.equal(JSON.stringify(metadata.items).includes('objectName'), false);
  const content = await exporter.page(f.owner, { section: 'self_avatar_content' });
  assert.equal(content.items.length, 1); assert.equal(JSON.stringify(content.items).includes(f.input.toString('base64')), false);
  const late = createFirestoreAccountExport({ ...f.options, photos, avatars: { async content(...args) {
    const result = await f.avatars.content(...args);
    await f.online.submit(f.owner, f.submission('remove', { expectedVersion: 1, confirmRemove: true })); return result;
  } } });
  await assert.rejects(late.page(f.owner, { section: 'self_avatar_content' }), code('export_scope_changed'));
});


test('child and self targets have separate current heads and actor-target admission; child authority is still required', async () => {
  const f = await avatarDomainFixture(), path = '/api/children', payload = { displayName: '合成孩子' };
  const created = await f.online.submit(f.owner, { path, payload, operation: { ...await f.online.context(f.owner, { path, payload }),
    deviceId: randomUUID(), opId: randomUUID() } });
  const childId = (created.result as { child: { id: string } }).child.id, child = { kind: 'child' as const, childId };
  await f.online.submit(f.owner, f.reserve()); await f.online.submit(f.owner, f.reserve());
  const reserved = avatarReserveResultSchema.parse((await f.online.submit(f.owner, f.reserve(0, child))).result).upload;
  await f.upload(reserved.id, child);
  const current = avatarMutationResultSchema.parse((await f.online.submit(f.owner, f.submission('commit', { uploadId: reserved.id, expectedVersion: 0 }, child))).result).avatar;
  assert.equal(current.target.kind, 'child'); assert.equal(current.version, 1);
  assert.equal((await f.avatars.read(f.owner, f.target)).avatar.asset, null);
  await assert.rejects(f.avatars.read(f.owner, { kind: 'child', childId: randomUUID() }));
  await assert.rejects(f.avatars.content(f.owner, f.target, current.asset!.id, 1));
});
