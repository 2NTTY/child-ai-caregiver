import { createHash, randomUUID } from 'node:crypto';
import { readAvatarConfig } from '../../server/avatar-config.ts';
import { avatarBinding } from '../../server/avatar-data.ts';
import { createAvatarObjects } from '../../server/firebase-avatar-objects.ts';
import { createFirebaseAvatarRecovery } from '../../server/firebase-avatar-recovery.ts';
import { FirestoreDomainData, type FirestoreDomainOptions } from '../../server/firestore-domain-data.ts';
import { sealAvatarRestoreRecord } from '../../server/firestore-restore-avatar-codec.ts';
import type { WorkRecoveryScope } from '../../server/firestore-work-continuation-recovery.ts';
import { avatarMemoryBucket } from './avatar-memory.ts';

/** Synthetic normalized bytes and bucket only; real encrypted object/backup/schema ports remain enabled. */
export async function recoveryOperatorAvatar(options: FirestoreDomainOptions, scope: WorkRecoveryScope, now: number) {
  const bucketName = 'synthetic-operator-avatar', backupBucketName = 'synthetic-operator-avatar-backup';
  const bucket = avatarMemoryBucket(bucketName), backupBucket = avatarMemoryBucket(backupBucketName);
  const objects = createAvatarObjects({ config: { projectId: options.projectId, namespace: options.namespace, bucketName },
    cipher: options.cipher, bucket: bucket.port });
  const binding = avatarBinding(scope, { kind: 'child', childId: scope.childId }), data = new FirestoreDomainData(options);
  const bytes = Buffer.from([255, 216, 255, 224, 0, 2, 255, 217]), asset = { id: randomUUID(), mimeType: 'image/jpeg' as const,
    bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), width: 256, height: 256 };
  const descriptor = await objects.write(binding, asset, bytes), uploadId = randomUUID(), at = new Date(now).toISOString();
  bytes.fill(0); const config = readAvatarConfig({});
  const head = sealAvatarRestoreRecord(data, 'avatar-head', { binding, version: 1, descriptor, updatedAt: at,
    reservationNonce: randomUUID(), erasedThroughVersion: null, removal: null });
  const upload = sealAvatarRestoreRecord(data, 'avatar-upload', { id: uploadId, assetId: asset.id, binding, actorUserId: scope.ownerUserId,
    reservationOperationId: randomUUID(), expectedVersion: 0, createdAt: at, expiresAt: new Date(now + 60_000).toISOString(),
    mimeType: 'image/jpeg', bytes: asset.bytes, sha256: asset.sha256, crop: { centerX: .5, centerY: .5, zoom: 1 },
    policyId: config.policy.policyId, recipe: config.recipe, admission: config.admission, state: 'committed', lease: null,
    preparedAsset: asset, descriptor, committedVersion: 1, errorCode: null });
  const cleanup = sealAvatarRestoreRecord(data, 'avatar-cleanup', { assetId: asset.id, uploadId, expectedVersion: 0, binding, objectBinding: binding,
    reason: 'staging', state: 'known', preparedAsset: asset, descriptor, writeLease: null, committedVersion: 1, attempt: 0, nextAttemptAt: at });
  const readNormalized = (bound: typeof binding, pinned: typeof descriptor) => objects.read(bound, pinned);
  const recovery = createFirebaseAvatarRecovery({ config: { projectId: options.projectId, namespace: options.namespace, backupBucketName },
    cipher: options.cipher, backupBucket: backupBucket.port, objects, readNormalized, serverClock: () => now });
  return { records: [head, upload, cleanup], binding, descriptor, bucket,
    ports: { bucketName, objects, readNormalized, recovery },
    async entry(backupId: string, retainedUntil: string) {
      const backup = await recovery.backupAvatar({ backupId, binding, version: 1, descriptor, retainedUntil });
      return { path: head.path, binding, version: 1, descriptor, backup };
    } };
}
