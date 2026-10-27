import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import childProcess, { type ChildProcessWithoutNullStreams } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { avatarDomainFixture } from './helpers/avatar-memory.ts';
import { avatarReserveResultSchema, avatarMutationResultSchema } from '../src/shared/avatars.ts';
import { FirestoreDomainError } from '../server/firestore-domain-data.ts';
import { createAvatarCodec } from '../server/avatar-codec.ts';
import { readAvatarConfig } from '../server/avatar-config.ts';
import type { AvatarCleanupRecord, AvatarHeadRecord, AvatarUploadRecord } from '../server/avatar-data.ts';

type Fixture = Awaited<ReturnType<typeof avatarDomainFixture>>;
const code = (expected: string) => (error: unknown) => error instanceof FirestoreDomainError && error.code === expected;
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
async function reserve(f: Fixture, expectedVersion = 0) {
  return avatarReserveResultSchema.parse((await f.online.submit(f.owner, f.reserve(expectedVersion))).result).upload;
}
async function rows(f: Fixture, id: string) {
  return f.options.database.runTransaction(async transaction => {
    const b = { transaction }, upload = await f.data.upload(b, f.binding, id); assert.ok(upload);
    const cleanup = await f.data.cleanup(b, f.binding, upload.assetId); assert.ok(cleanup);
    const head = await f.data.head(b, f.binding); return { upload, cleanup, head };
  });
}
async function setRows(f: Fixture, value: { upload: AvatarUploadRecord; cleanup: AvatarCleanupRecord; head: AvatarHeadRecord }) {
  await f.options.database.runTransaction(async transaction => {
    const b = { transaction }, writes = [f.data.prepareUpload(b, value.upload), f.data.prepareCleanup(b, value.cleanup), f.data.prepareHead(b, value.head)];
    for (const write of writes) write();
  });
}
async function pause(f: Fixture, expectedVersion = 0) {
  const entered = deferred(), finish = deferred(); f.decodeHook(async () => { entered.resolve(); await finish.promise; });
  const upload = await reserve(f, expectedVersion), pending = f.upload(upload.id);
  const rejected = assert.rejects(pending, code('avatar_upload_not_ready'));
  await entered.promise; return { upload, finish, rejected, before: await rows(f, upload.id) };
}

test('fence wins while codec is paused: exact lease CAS before TTL blocks all later Storage and keeps old head', async () => {
  const f = await avatarDomainFixture(), old = await reserve(f); await f.upload(old.id);
  const current = avatarMutationResultSchema.parse((await f.online.submit(f.owner,
    f.submission('commit', { uploadId: old.id, expectedVersion: 0 }))).result).avatar;
  const p = await pause(f, 1), decodes = f.decodes(), writes = f.bucket.writes();
  assert.equal(p.before.cleanup.nextAttemptAt, p.before.upload.lease!.until);
  assert.equal((await f.cleanup.process(f.binding, p.before.upload.assetId)).state, 'retained');
  f.advance(f.config.admission.totalTimeoutMs + 1); assert.ok(f.now() < Date.parse(p.before.upload.expiresAt));
  f.fake.retry(); // Discard one transaction attempt; only the rerun's two-row CAS is authority.
  assert.equal((await f.cleanup.process(f.binding, p.before.upload.assetId)).state, 'complete');
  const after = await rows(f, p.upload.id);
  assert.equal(after.upload.state, 'expired'); assert.equal(after.upload.lease, null);
  assert.equal(after.cleanup.state, 'complete'); assert.equal(after.cleanup.writeLease, null);
  assert.equal(after.cleanup.reason, 'expired'); assert.equal(after.cleanup.preparedAsset, null);
  p.finish.resolve(); await p.rejected;
  assert.equal(f.decodes(), decodes); assert.equal(f.bucket.writes(), writes);
  assert.deepEqual((await f.avatars.read(f.owner, f.target)).avatar, current);
  await assert.rejects(f.upload(p.upload.id), code('avatar_upload_expired'));
  assert.equal(f.decodes(), decodes);
});

test('prepared wins before Storage: even after TTL the unknown write responsibility survives and late object is reconciled', async () => {
  const f = await avatarDomainFixture(), entered = deferred(), finish = deferred(), write = f.bucket.port.writeNew;
  f.bucket.port.writeNew = async (...args) => { entered.resolve(); await finish.promise; return write(...args); };
  const upload = await reserve(f), pending = f.upload(upload.id); await entered.promise;
  const prepared = await rows(f, upload.id); assert.ok(prepared.upload.preparedAsset); assert.equal(prepared.cleanup.state, 'writing');
  f.advance(f.config.admission.uploadTtlMs + 1);
  assert.equal((await f.cleanup.process(f.binding, prepared.upload.assetId)).state, 'unknown');
  const unknown = await rows(f, upload.id);
  assert.equal(unknown.upload.state, 'processing'); assert.equal(unknown.cleanup.state, 'unresolved');
  assert.deepEqual(unknown.cleanup.writeLease, prepared.upload.lease); assert.equal(f.bucket.removes(), 0);
  finish.resolve(); assert.equal((await pending).state, 'expired');
  const stored = await rows(f, upload.id); assert.ok(stored.cleanup.descriptor);
  assert.equal(stored.cleanup.descriptor.generation, '9007199254740994');
  assert.equal((await f.cleanup.process(f.binding, prepared.upload.assetId)).state, 'complete');
  assert.equal(f.bucket.writes(), 1); assert.equal(f.bucket.removes(), 1); assert.equal(f.bucket.records.size, 0); assert.equal(f.decodes(), 1);
});

test('lost or failed fence acknowledgement never redecodes: capacity follows only persisted original-row outcome', async () => {
  const f = await avatarDomainFixture(), p = await pause(f); await reserve(f);
  f.advance(f.config.admission.totalTimeoutMs + 1);
  f.fake.failCommit(); await assert.rejects(f.cleanup.process(f.binding, p.before.upload.assetId), /Synthetic transaction commit failed/u);
  assert.equal((await rows(f, p.upload.id)).upload.state, 'processing');
  await assert.rejects(f.makeStore().submitOnline(f.owner, f.reserve()), code('avatar_busy'));
  f.fake.loseReply(); await assert.rejects(f.cleanup.process(f.binding, p.before.upload.assetId), /Synthetic lost commit acknowledgement/u);
  assert.equal((await rows(f, p.upload.id)).upload.state, 'expired');
  assert.equal((await f.cleanup.process(f.binding, p.before.upload.assetId)).state, 'complete');
  await f.makeStore().submitOnline(f.owner, f.reserve());
  await assert.rejects(f.makeStore().uploadAdmission(f.owner, f.target, p.upload.id), code('avatar_upload_expired'));
  p.finish.resolve(); await p.rejected; assert.equal(f.decodes(), 1); assert.equal(f.bucket.writes(), 0);
  // Prepared commit acknowledgement loss is a different unknown: never use the no-prepared shortcut.
  const g = await avatarDomainFixture(), original = await reserve(g);
  g.decodeHook(async () => { g.fake.loseReply(); });
  await assert.rejects(g.upload(original.id), code('avatar_unavailable')); // Public wrapper sanitizes the injected lost acknowledgement.
  const prepared = await rows(g, original.id);
  assert.ok(prepared.upload.preparedAsset); assert.equal(prepared.cleanup.state, 'writing');
  g.advance(g.config.admission.uploadTtlMs + 1);
  assert.equal((await g.cleanup.process(g.binding, prepared.upload.assetId)).state, 'unknown');
  assert.equal((await rows(g, original.id)).upload.state, 'processing');
  await assert.rejects(g.upload(original.id), code('avatar_upload_not_ready'));
  assert.equal(g.decodes(), 1); assert.equal(g.bucket.writes(), 0);
});

test('mismatched/missing lease, one-sided preparation, foreign epoch, asset mismatch and current reference all fail closed', async () => {
  const cases: ((value: Awaited<ReturnType<typeof rows>>) => void)[] = [
    value => { value.cleanup.writeLease = null; },
    value => { value.cleanup.writeLease = { ...value.cleanup.writeLease!, token: randomUUID() }; },
    value => { value.cleanup.preparedAsset = { id: value.upload.assetId, bytes: 8, sha256: 'a'.repeat(64), mimeType: 'image/jpeg', width: 256, height: 256 }; },
    value => { value.upload.preparedAsset = { id: value.upload.assetId, bytes: 8, sha256: 'a'.repeat(64), mimeType: 'image/jpeg', width: 256, height: 256 }; },
    value => { value.upload.binding.scope.storageEpoch = randomUUID(); },
    value => { value.upload.assetId = randomUUID(); },
    value => { value.head = { ...value.head, version: 1, updatedAt: new Date().toISOString(), descriptor: {
      format: 'yuyoufang-avatar-object/v1', asset: { id: value.upload.assetId, bytes: 8, sha256: 'a'.repeat(64), mimeType: 'image/jpeg', width: 256, height: 256 },
      objectName: 'avatars/v1/' + 'b'.repeat(64) + '/' + value.upload.assetId, generation: '1', cipherSha256: 'c'.repeat(64) } }; },
  ];
  for (const mutate of cases) {
    const f = await avatarDomainFixture(), p = await pause(f), bad = structuredClone(p.before); mutate(bad); await setRows(f, bad);
    f.advance(f.config.admission.totalTimeoutMs + 1);
    const evidence = structuredClone([...f.fake.records]);
    await assert.rejects(f.cleanup.process(f.binding, p.before.upload.assetId), code('avatar_integrity_failed'));
    assert.deepEqual([...f.fake.records], evidence); assert.equal(f.bucket.writes(), 0); assert.equal(f.bucket.removes(), 0);
    await setRows(f, p.before); await f.cleanup.process(f.binding, p.before.upload.assetId);
    p.finish.resolve(); await p.rejected;
  }
});

test('confirmed fence frees exactly one actor-target slot across instances; child target remains independent', async () => {
  const f = await avatarDomainFixture(), path = '/api/children', payload = { displayName: '合成孩子' };
  const created = await f.online.submit(f.owner, { path, payload, operation: { ...await f.online.context(f.owner, { path, payload }), deviceId: randomUUID(), opId: randomUUID() } });
  const child = { kind: 'child' as const, childId: (created.result as { child: { id: string } }).child.id };
  const p = await pause(f); await reserve(f);
  await assert.rejects(f.makeStore().submitOnline(f.owner, f.reserve()), code('avatar_busy'));
  await f.makeStore().submitOnline(f.owner, f.reserve(0, child));
  f.advance(f.config.admission.totalTimeoutMs + 1); await f.cleanup.process(f.binding, p.before.upload.assetId);
  const a = f.makeStore(), b = f.makeStore();
  const results = await Promise.allSettled([a.submitOnline(f.owner, f.reserve()), b.submitOnline(f.owner, f.reserve())]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = results.find(result => result.status === 'rejected'); assert.ok(rejected?.status === 'rejected' && code('avatar_busy')(rejected.reason));
  assert.equal((await f.avatars.read(f.owner, f.target)).avatar.version, 0);
  p.finish.resolve(); await p.rejected; assert.equal(f.decodes(), 1); assert.equal(f.bucket.writes(), 0);
});

test('Firestore fence and HTTP abort cannot release the real codec supervisor slot before synthetic child close', async t => {
  const started = deferred(), stdout = new PassThrough(), stderr = new PassThrough(), stdin = new PassThrough(); let kills = 0;
  const child = Object.assign(new EventEmitter(), { stdout, stderr, stdin, kill(signal: string) { assert.equal(signal, 'SIGKILL'); kills++; return true; } });
  const spawn = t.mock.method(childProcess, 'spawn', () => { started.resolve(); return child as unknown as ChildProcessWithoutNullStreams; });
  syncBuiltinESMExports();
  const config = readAvatarConfig({}), codec = createAvatarCodec(config.admission);
  try {
    const f = await avatarDomainFixture({ codec }), upload = await reserve(f), admission = await f.avatars.uploadAdmission(f.owner, f.target, upload.id);
    const controller = new AbortController(), response = admission.upload(Buffer.from(f.input), controller.signal);
    const rejected = assert.rejects(response, code('avatar_decode_limit'));
    await started.promise; controller.abort(); await rejected; admission.release();
    const before = await rows(f, upload.id); f.advance(f.config.admission.totalTimeoutMs + 1);
    assert.equal((await f.cleanup.process(f.binding, before.upload.assetId)).state, 'complete');
    assert.deepEqual(codec.state(), { active: 1, queued: 0, actors: 1 }); assert.equal(kills, 1);
    const another = await reserve(f); await assert.rejects(f.avatars.uploadAdmission(f.owner, f.target, another.id), code('avatar_busy'));
    child.emit('close', null, 'SIGKILL'); await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual(codec.state(), { active: 0, queued: 0, actors: 0 });
    const next = await f.avatars.uploadAdmission(f.owner, f.target, another.id); next.release();
    assert.equal(spawn.mock.callCount(), 1); assert.equal(f.bucket.writes(), 0);
  } finally {
    child.emit('close', null, 'SIGKILL'); await codec.close(); spawn.mock.restore(); syncBuiltinESMExports(); stdin.destroy(); stdout.destroy(); stderr.destroy();
  }
});
