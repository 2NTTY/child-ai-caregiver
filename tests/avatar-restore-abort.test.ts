import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { createAvatarRestoreAborter } from '../server/firebase-avatar-restore-abort.ts';
import { createAvatarObjects } from '../server/firebase-avatar-objects.ts';
import type { FirebasePhotoBucketPort } from '../server/firebase-photo-objects.ts';
import { createFirebaseAvatarRestoreCopies, type AvatarCopyPayload } from '../server/firebase-avatar-restore-copies.ts';
import { avatarRestoreFixture } from './helpers/avatar-restore-memory.ts';

/** Versioned Storage semantics, including exact 64-bit generations and live create-if-absent fencing. */
function bucketFixture() {
  type Row = { bytes: Buffer; metadata: any };
  const live = new Map<string, Row>(), versions = new Map<string, Row>(), writes: { name: string; precondition: string }[] = [];
  let next = 9007199254740993n, unavailable = false, loseFence = false;
  const failure = (code: number) => Object.assign(new Error('Synthetic Storage result'), { code });
  const port: FirebasePhotoBucketPort = {
    async metadata(name, generation) {
      if (unavailable) throw failure(503);
      const row = generation ? versions.get(name + '@' + generation) : live.get(name);
      if (!row) throw failure(404); return structuredClone(row.metadata);
    },
    async writeNew(name, bytes, options) {
      const expected = String(options.preconditionOpts?.ifGenerationMatch);
      writes.push({ name, precondition: expected });
      if (expected === '0' ? live.has(name) : live.get(name)?.metadata.generation !== expected) throw failure(412);
      const row: Row = { bytes: Buffer.from(bytes), metadata: { ...structuredClone(options.metadata),
        name, bucket: 'synthetic-avatar-private', generation: String(next++), size: String(bytes.length) } };
      versions.set(name + '@' + row.metadata.generation, row); live.set(name, row);
      if (loseFence && row.metadata.metadata?.format === 'yuyoufang-avatar-restore-abort/v1') {
        loseFence = false; unavailable = true; throw failure(503);
      }
      return structuredClone(row.metadata);
    },
    readPinned(name, generation) {
      let sent = false;
      return new Readable({ read() {
        if (sent) return; sent = true;
        const row = versions.get(name + '@' + generation);
        if (!row || unavailable) { this.destroy(failure(503)); return; }
        this.emit('response', { statusCode: 200, headers: { 'x-goog-generation': generation, 'content-length': String(row.bytes.length) } });
        this.push(Buffer.from(row.bytes)); this.push(null);
      } });
    },
    async removePinned(name, generation) {
      if (unavailable) throw failure(503);
      versions.delete(name + '@' + generation);
      if (live.get(name)?.metadata.generation === generation) live.delete(name);
    },
  };
  return { port, live, versions, writes, loseFence: () => { loseFence = true; }, restore: () => { unavailable = false; } };
}

test('abandoned isolated avatar copies remain fenced across lost replies, late writes and restart without touching source', { timeout: 10_000 }, async () => {
  let abortCopy: (value: AvatarCopyPayload) => Promise<void>;
  const f = avatarRestoreFixture({ abortCopy: value => abortCopy(value) }), bucket = bucketFixture();
  const config = { projectId: f.options.projectId, namespace: f.options.namespace, bucketName: 'synthetic-avatar-private' };
  const objects = createAvatarObjects({ config, cipher: f.options.cipher, bucket: bucket.port });
  abortCopy = createAvatarRestoreAborter({ config, cipher: f.options.cipher, bucket: bucket.port, objects });
  const jpeg = Buffer.from([255, 216, 255, 224, 1, 2, 255, 217]), sha256 = createHash('sha256').update(jpeg).digest('hex');
  const values = [f.value(0), f.value(1), f.value(2)].map(value => {
    const asset = { ...value.source.descriptor.asset, bytes: jpeg.length, sha256 };
    return { ...value, source: { ...value.source, descriptor: { ...value.source.descriptor, asset } },
      cleanup: { ...value.cleanup, preparedAsset: asset } };
  });
  const [known, delayed, prepared] = values as [AvatarCopyPayload, AvatarCopyPayload, AvatarCopyPayload];
  const source = await objects.write(known.source.binding, known.source.descriptor.asset, jpeg);
  const savedSource = bucket.live.get(source.objectName)!;
  const sourceBefore = { bytes: Buffer.from(savedSource.bytes), metadata: structuredClone(savedSource.metadata) };
  await f.copies.stage(values);
  const write = (value: AvatarCopyPayload) => objects.write(value.cleanup.objectBinding, value.cleanup.preparedAsset!, jpeg);
  const copied = await f.copies.execute(known, () => write(known));
  let resume!: () => void, started!: () => void;
  const held = new Promise<void>(resolve => { resume = resolve; }), entered = new Promise<void>(resolve => { started = resolve; });
  const pending = f.copies.execute(delayed, async () => { started(); await held; return write(delayed); });
  const rejectedLate = assert.rejects(pending);
  await entered;
  bucket.loseFence();
  await assert.rejects(f.copies.abandon(f.identity));
  assert.equal((await f.copies.inspectAbandonment()).phase, 'aborting');
  assert.equal(f.fake.records.has(f.options.namespace + '_restore_operations/current'), false);
  bucket.restore();
  const reopened = createFirebaseAvatarRestoreCopies({ ...f.options, targetBucket: config.bucketName, objects, abortCopy,
    batches: { scanPageSize: 2, handoffBatchSize: 2, handoffBatchBytes: 32 * 1024 } });
  const result = await reopened.abandon(f.identity);
  assert.equal(result.state, 'abandoned'); assert.equal(result.count, 3);
  resume(); await rejectedLate;
  await assert.rejects(f.copies.execute(prepared, () => write(prepared)), error =>
    !!error && typeof error === 'object' && 'code' in error && error.code === 'recovery_avatar_copy_stage_closed');
  const writes = bucket.writes.length;
  assert.deepEqual(await reopened.abandon(f.identity), result);
  assert.equal(bucket.writes.length, writes, 'Confirmed replay only reads fences and completes pinned cleanup');
  for (const value of values) {
    const name = objects.address(value.cleanup.objectBinding, value.cleanup.assetId);
    assert.equal(bucket.live.get(name)!.metadata.metadata.format, 'yuyoufang-avatar-restore-abort/v1');
    assert.equal([...bucket.versions.keys()].filter(key => key.startsWith(name + '@')).length, 1);
  }
  assert.equal(bucket.versions.has(copied.objectName + '@' + copied.generation), false);
  assert.deepEqual(bucket.live.get(source.objectName), sourceBefore);
  await assert.rejects(f.copies.inventory(f.identity, { phase: 'none', ids: new Set() }, () => {}), error =>
    !!error && typeof error === 'object' && 'code' in error && error.code === 'recovery_avatar_copy_abandoned');
  assert.equal([...f.fake.records.keys()].filter(path => path.includes('/avatar-copy-')).length, 4, 'Retain the index and all cleanup provenance');
  const before = bucket.writes.length;
  f.fake.records.set(f.options.namespace + '_restore_operations/current', { synthetic: 'activation marker' });
  await assert.rejects(f.copies.abandon(f.identity));
  assert.equal(bucket.writes.length, before, 'Never abandon an activated target');
  jpeg.fill(0);
});
