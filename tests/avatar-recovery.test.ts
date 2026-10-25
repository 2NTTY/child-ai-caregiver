import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Bucket } from '@google-cloud/storage';
import { avatarDomainFixture, avatarMemoryBucket } from './helpers/avatar-memory.ts';
import { avatarReserveResultSchema } from '../src/shared/avatars.ts';
import { createFirebaseAvatarRecovery } from '../server/firebase-avatar-recovery.ts';
import { createFirebaseManagedAvatarReader } from '../server/firebase-managed-avatar-recovery.ts';
import { FIREBASE_PHOTO_BACKUP_MIN_RETENTION_MS } from '../server/firebase-photo-recovery.ts';
import { avatarCleanupId, avatarCleanupRecordSchema, avatarHeadRecordSchema } from '../server/avatar-data.ts';
import { createFirestoreRestoreCodec } from '../server/firestore-restore-codec.ts';
import { restoredAvatarCleanupRecords, mergeAvatarCopyResponsibilities, assertRestoredAvatarRelations } from '../server/firestore-restore-avatars.ts';
import { sealAvatarRestoreRecord } from '../server/firestore-restore-avatar-codec.ts';
import { FirestoreDomainData } from '../server/firestore-domain-data.ts';

async function committed() {
  const f = await avatarDomainFixture(), upload = avatarReserveResultSchema.parse((await f.online.submit(f.owner, f.reserve())).result).upload;
  await f.upload(upload.id); await f.online.submit(f.owner, f.submission('commit', { uploadId: upload.id, expectedVersion: 0 }));
  const head = await f.authority.runTransaction(f.owner, null, b => f.data.head(b, f.binding));
  return { ...f, head, descriptor: head.descriptor! };
}
const code = (expected: string) => (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === expected;

test('normalized-only encrypted backup pins generation, hold and retention; restore checks authorization before target write', async () => {
  const f = await committed(), backup = avatarMemoryBucket('synthetic-avatar-backup'), backupId = randomUUID();
  const recovery = createFirebaseAvatarRecovery({ config: { projectId: f.options.projectId, namespace: f.options.namespace,
    backupBucketName: 'synthetic-avatar-backup' }, cipher: f.options.cipher, backupBucket: backup.port, objects: f.objects,
    readNormalized: (binding, descriptor) => f.objects.read(binding, descriptor), serverClock: f.now });
  const input = { backupId, binding: f.binding, version: 1, descriptor: f.descriptor,
    retainedUntil: new Date(f.now() + FIREBASE_PHOTO_BACKUP_MIN_RETENTION_MS + 1000).toISOString() };
  backup.lose(); const saved = await recovery.backupAvatar(input);
  assert.equal(backup.records.size, 1); assert.equal(backup.records.get(saved.objectName)!.metadata.temporaryHold, true);
  assert.ok(BigInt(saved.generation) > BigInt(Number.MAX_SAFE_INTEGER));
  assert.equal([...backup.records.values()].some(row => row.bytes.includes(f.input)), false);
  assert.deepEqual(await recovery.backupAvatar(input), saved);
  const targetBinding = { ...f.binding, scope: { ...f.binding.scope, storageEpoch: randomUUID() } }, before = f.bucket.writes();
  await assert.rejects(recovery.restoreAvatar({ ...input, backup: saved, targetBinding, async authorizeCopy() { throw new Error('Synthetic authority changed'); } }));
  assert.equal(f.bucket.writes(), before);
  let authorized = 0;
  const descriptor = await recovery.restoreAvatar({ ...input, backup: saved, targetBinding, async authorizeCopy() { authorized++; } });
  assert.equal(authorized, 1); assert.notEqual(descriptor.objectName, f.descriptor.objectName); assert.deepEqual(descriptor.asset, f.descriptor.asset);
  const content = await f.objects.read(targetBinding, descriptor); content.fill(0);
  await assert.rejects(recovery.restoreAvatar({ ...input, version: 2, backup: saved, targetBinding, async authorizeCopy() {} }), code('avatar_backup_integrity'));
});

test('retained avatar reader never undeletes a missing source or invokes another loader', async () => {
  const f = await committed(), methods: string[] = [], sourceMethods: string[] = [];
  const reader = createFirebaseManagedAvatarReader({ sourceGeneration: f.generation,
    bucket: { name: 'synthetic-avatar-private', async request(value: { method: string }) { sourceMethods.push(value.method); throw new Error('Forbidden source mutation'); } } as unknown as Bucket,
    journalBucket: { name: 'synthetic-avatar-journal', async request(value: { method: string }) { methods.push(value.method); return [{ items: [] }, { statusCode: 200 }]; } } as unknown as Bucket,
    journal: f.journal, objects: { async read() { throw Object.assign(new Error('Synthetic soft-deleted source'), { code: 404 }); } },
    authority: { async readControl() { return { enabled: false, generation: f.generation }; } } as any });
  await assert.rejects(reader(f.binding, f.descriptor, 1), code('recovery_retained_avatar_unconfirmed'));
  assert.deepEqual(sourceMethods, []); assert.deepEqual(methods, ['GET']); assert.equal(f.bucket.writes(), 1);
});

test('late independent erasure makes retained reader zero the normalized buffer and reject disclosure', async () => {
  const f = await committed(); let reveal = false, returned: Buffer | undefined;
  const operation = f.submission('remove', { expectedVersion: 1, confirmRemove: true });
  await f.online.submit(f.owner, operation); // Durable synthetic independent journal.
  const entries = [...f.journalBucket.records].map(([name, row]) => ({ name, generation: row.metadata.generation }));
  const reader = createFirebaseManagedAvatarReader({ sourceGeneration: f.generation,
    bucket: { name: 'synthetic-avatar-private' } as Bucket,
    journalBucket: { name: 'synthetic-avatar-journal', async request() { return [{ items: reveal ? entries : [] }, { statusCode: 200 }]; } } as unknown as Bucket,
    journal: f.journal, objects: { async read(binding, descriptor) { returned = await f.objects.read(binding, descriptor); reveal = true; return returned; } },
    authority: { async readControl() { return { enabled: false, generation: f.generation }; } } as any });
  await assert.rejects(reader(f.binding, f.descriptor, 1), code('recovery_avatar_permanently_erased'));
  assert.ok(returned); assert.equal(returned.every(value => value === 0), true);
});

test('real recovery codec retains old epoch cleanup and adds exact new epoch responsibility; forged query metadata rejects', async () => {
  const f = await committed(), codec = createFirestoreRestoreCodec(f.options), data = new FirestoreDomainData(f.options);
  const originals = [...f.fake.records].filter(([path]) => /_avatar_(heads|uploads|cleanup)\//u.test(path)).map(([path, value]) => codec.decode({ path, data: value }));
  assertRestoredAvatarRelations(originals);
  const epoch = randomUUID(), newBinding = { ...f.binding, scope: { ...f.binding.scope, storageEpoch: epoch } };
  const bytes = await f.objects.read(f.binding, f.descriptor), descriptor = await f.objects.write(newBinding, f.descriptor.asset, bytes); bytes.fill(0);
  const transform = { generation: randomUUID(), newEpochByWorkspace: new Map([[f.scope.workspaceId, epoch]]), photoDescriptors: new Map(),
    avatarDescriptors: new Map([[descriptor.asset.id, descriptor]]), avatarObjectBucketName: 'synthetic-avatar-private' };
  const changed = originals.map(row => codec.transform(row, transform));
  const extra = restoredAvatarCleanupRecords(data, originals, transform), restored = [...changed, ...extra].map(row => codec.decode(row));
  assertRestoredAvatarRelations(restored, true);
  const cleanups = restored.filter(row => row.context.kind === 'avatar-cleanup').map(row => avatarCleanupRecordSchema.parse(row.value));
  assert.equal(cleanups.length, 2); assert.equal(new Set(cleanups.map(row => avatarCleanupId(row.binding, row.assetId))).size, 2);
  assert.ok(cleanups.some(row => row.binding.scope.storageEpoch === f.scope.storageEpoch));
  const encoded = extra[0]!; assert.throws(() => codec.decode({ ...encoded, data: { ...encoded.data, complete: true } }));
  const head = restored.find(row => row.context.kind === 'avatar-head')!; assert.equal(avatarHeadRecordSchema.parse(head.value).descriptor!.generation, descriptor.generation);
});

test('copy responsibility union keeps a normalized orphan after its head is absent', async () => {
  const f = await committed(), codec = createFirestoreRestoreCodec(f.options), data = new FirestoreDomainData(f.options);
  const old = await f.authority.runTransaction(f.owner, null, b => f.data.cleanup(b, f.binding, f.descriptor.asset.id)); assert.ok(old);
  const epoch = randomUUID(), binding = { ...f.binding, scope: { ...f.binding.scope, storageEpoch: epoch } };
  const bytes = await f.objects.read(f.binding, f.descriptor), descriptor = await f.objects.write(binding, f.descriptor.asset, bytes); bytes.fill(0);
  const responsibility = avatarCleanupRecordSchema.parse({ ...old, binding, objectBinding: binding, descriptor, preparedAsset: descriptor.asset,
    state: 'known', reason: 'staging', writeLease: null });
  const records = [sealAvatarRestoreRecord(data, 'avatar-cleanup', old)];
  mergeAvatarCopyResponsibilities(data, codec, records, [responsibility], { bucketName: 'synthetic-avatar-private', epochFor: () => epoch, erasures: [] });
  assert.equal(records.length, 2);
  assert.equal(avatarCleanupRecordSchema.parse(codec.decode(records[1]!).value).reason, 'superseded');
});
