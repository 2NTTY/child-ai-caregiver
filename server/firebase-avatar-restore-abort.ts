import { z } from 'zod';
import { avatarCopyPayloadSchema, type AvatarCopyPayload } from './firebase-avatar-restore-copies.ts';
import { avatarObjectAddress, type AvatarObjects } from './firebase-avatar-objects.ts';
import { firebaseObjectStorageConfigSchema, type FirebasePhotoBucketPort, type FirebasePhotoObjectsConfig } from './firebase-photo-objects.ts';
import { firestoreDomainHash } from './firestore-domain-data.ts';
import { canonical } from './firestore-session-codec.ts';
import type { StorageCipher } from './storage-crypto.ts';
import { sameAvatarBinding } from './avatar-data.ts';
import { firebaseRestoreEpoch } from './firestore-restore.ts';

const FORMAT = 'yuyoufang-avatar-restore-abort/v1';
const BODY = Buffer.from('Abandoned avatar restore\n', 'utf8');
const generation = z.string().regex(/^[1-9][0-9]{0,19}$/u).refine(value => BigInt(value) <= 18446744073709551615n);
const proofSchema = z.object({ identity: z.string().regex(/^[a-f0-9]{64}$/u), payloadHash: z.string().regex(/^[a-f0-9]{64}$/u),
  priorGeneration: generation.nullable() }).strict();
const metadataSchema = z.object({ name: z.string(), bucket: z.string(), generation, size: z.union([z.string(), z.number()]),
  metadata: z.object({ format: z.literal(FORMAT), proof: z.string().min(1).max(4096) }).strict() });
const absent = (error: unknown) => !!error && typeof error === 'object' && 'code' in error && Number(error.code) === 404;
function reject(): never { throw Object.assign(new Error('Avatar restore abandonment is unconfirmed'), { code: 'recovery_avatar_abort_unconfirmed' }); }

/** Operator-only target cleanup. A permanent non-content marker fences delayed create-if-absent writes. */
export function createAvatarRestoreAborter(options: { config: FirebasePhotoObjectsConfig; cipher: StorageCipher;
  bucket: FirebasePhotoBucketPort; objects: Pick<AvatarObjects, 'inspect'> }) {
  const config = firebaseObjectStorageConfigSchema.parse(options.config), { bucket, cipher } = options;
  return async (raw: AvatarCopyPayload): Promise<void> => {
    const value = avatarCopyPayloadSchema.parse(raw), binding = value.cleanup.objectBinding, asset = value.cleanup.preparedAsset;
    if (!bucket.removePinned || !asset || value.targetBucket !== config.bucketName
      || !sameAvatarBinding(binding, value.cleanup.binding)
      || binding.scope.storageEpoch !== firebaseRestoreEpoch(config.projectId, value.targetDatabaseId, value.restoreId, value.source.binding.scope.workspaceId)
      || !sameAvatarBinding(binding, { ...value.source.binding, scope: { ...value.source.binding.scope, storageEpoch: binding.scope.storageEpoch } })
      || binding.scope.storageEpoch === value.source.binding.scope.storageEpoch) reject();
    const address = avatarObjectAddress(config, binding, value.cleanup.assetId);
    const aad = canonical([FORMAT, address.aad]), payloadHash = firestoreDomainHash(value);
    const read = () => bucket.metadata(address.objectName).catch(error => { if (absent(error)) return null; throw error; });
    function marker(rawMetadata: unknown) {
      const metadata = metadataSchema.parse(rawMetadata);
      if (metadata.name !== address.objectName || metadata.bucket !== config.bucketName || String(metadata.size) !== String(BODY.length)) reject();
      const proof = proofSchema.parse(JSON.parse(cipher.decrypt(metadata.metadata.proof, aad)));
      if (proof.identity !== value.identity || proof.payloadHash !== payloadHash || proof.priorGeneration === metadata.generation) reject();
      return { generation: metadata.generation, priorGeneration: proof.priorGeneration };
    }
    const current = await read();
    let confirmed: ReturnType<typeof marker>;
    if (metadataSchema.safeParse(current).success) confirmed = marker(current);
    else {
      // Verify only the exact target copy. Never read or remove the source generation.
      const prior = current === null ? null : await options.objects.inspect(binding, asset.id, asset);
      if (current !== null && prior === null) reject();
      const priorGeneration = prior?.generation ?? null;
      const proof = cipher.encrypt(canonical({ identity: value.identity, payloadHash, priorGeneration }), aad);
      try {
        await bucket.writeNew(address.objectName, BODY, { resumable: false, validation: 'crc32c', timeout: 20_000,
          preconditionOpts: { ifGenerationMatch: priorGeneration ?? 0 },
          metadata: { contentType: 'application/octet-stream', cacheControl: 'no-store', metadata: { format: FORMAT, proof } } });
      } catch {
        // A lost response or competing writer permits readback, never an unconditional retry.
      }
      confirmed = marker(await read());
    }
    // Keep the live marker permanently; removing it would let a delayed original write recreate the copy.
    if (confirmed.priorGeneration !== null) {
      await bucket.removePinned(address.objectName, confirmed.priorGeneration);
      const prior = await bucket.metadata(address.objectName, confirmed.priorGeneration).catch(error => { if (absent(error)) return null; throw error; });
      if (prior !== null) reject();
    }
    if (canonical(marker(await read())) !== canonical(confirmed)) reject();
  };
}
