import { createHash } from 'node:crypto';
import { Storage } from '@google-cloud/storage';
import { z } from 'zod';
import { avatarAssetSchema, type AvatarAsset } from '../src/shared/avatars.ts';
import { avatarBindingSchema, avatarObjectDescriptorSchema, type AvatarBinding, type AvatarObjectDescriptor } from './avatar-data.ts';
import { firebaseObjectStorageConfigSchema, createFirebasePhotoBucketPort, type FirebasePhotoBucketPort, type FirebasePhotoObjectsConfig } from './firebase-photo-objects.ts';
import { canonical } from './firestore-session-codec.ts';
import type { StorageCipher } from './storage-crypto.ts';

const FORMAT = 'yuyoufang-avatar-object/v1';
// Persisted format bound, not mutable admission policy. Lowering new-upload limits must not corrupt existing heads.
const MAX_PLAIN = 4 * 1024 * 1024, MAX_CIPHER = 4 + Math.ceil((Math.ceil(MAX_PLAIN / 3) * 4 + 32) / 3) * 4;
const hash = z.string().regex(/^[a-f0-9]{64}$/u), positive = z.string().regex(/^[1-9][0-9]{0,19}$/u);
const metadataSchema = z.object({ name: z.string(), bucket: z.string(), generation: positive.refine(value => BigInt(value) <= 18446744073709551615n),
  size: z.union([positive, z.number().int().positive()]).refine(value => BigInt(value) <= BigInt(MAX_CIPHER)), contentEncoding: z.string().optional(),
  metadata: z.object({ format: z.literal(FORMAT), binding: hash, cipherSha256: hash, sha256: hash,
    bytes: positive, width: positive, height: positive }).strict() });
export class AvatarObjectError extends Error {
  readonly code: 'avatar_integrity_failed' | 'avatar_unavailable';
  constructor(code: AvatarObjectError['code']) { super('Avatar object could not be verified'); this.name = 'AvatarObjectError'; this.code = code; }
}
const fail = (code: AvatarObjectError['code'] = 'avatar_integrity_failed'): never => { throw new AvatarObjectError(code); };
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const absent = (error: unknown) => error !== null && typeof error === 'object' && 'code' in error && Number(error.code) === 404;
export function avatarObjectAddress(configInput: FirebasePhotoObjectsConfig, bindingInput: AvatarBinding, assetId: string) {
  const config = firebaseObjectStorageConfigSchema.parse(configInput), binding = avatarBindingSchema.parse(bindingInput);
  z.uuid().parse(assetId);
  const scope = { ownerUserId: binding.scope.ownerUserId, workspaceId: binding.scope.workspaceId, childId: binding.scope.childId,
    storageEpoch: binding.scope.storageEpoch, targetKind: binding.target.kind, targetId: binding.targetId };
  const scopeHash = digest(canonical([FORMAT, config.projectId, config.namespace, scope]));
  const objectName = 'avatars/v1/' + scopeHash + '/' + assetId;
  const aad = canonical([FORMAT, config.projectId, config.namespace, config.bucketName, scope, assetId, objectName]);
  return { objectName, aad, tag: digest(aad) };
}
export function createAvatarObjects(options: { config: FirebasePhotoObjectsConfig; cipher: StorageCipher; bucket: FirebasePhotoBucketPort }) {
  const config = firebaseObjectStorageConfigSchema.parse(options.config), { cipher, bucket } = options;
  function checkedMetadata(raw: unknown, address: ReturnType<typeof avatarObjectAddress>, assetId: string, generation?: string) {
    const parsed = metadataSchema.safeParse(raw); if (!parsed.success) fail();
    const metadata = parsed.data;
    if (metadata.name !== address.objectName || metadata.bucket !== config.bucketName || metadata.metadata.binding !== address.tag
      || generation !== undefined && metadata.generation !== generation || metadata.contentEncoding !== undefined && metadata.contentEncoding !== 'identity') fail();
    const asset = avatarAssetSchema.safeParse({ id: assetId, mimeType: 'image/jpeg', sha256: metadata.metadata.sha256,
      bytes: Number(metadata.metadata.bytes), width: Number(metadata.metadata.width), height: Number(metadata.metadata.height) });
    if (!asset.success || asset.data.bytes > MAX_PLAIN || asset.data.width > 2048) fail();
    const descriptor = avatarObjectDescriptorSchema.parse({ format: FORMAT, asset: asset.data, objectName: address.objectName,
      generation: metadata.generation, cipherSha256: metadata.metadata.cipherSha256 });
    return { metadata, descriptor };
  }
  async function read(binding: AvatarBinding, descriptorInput: AvatarObjectDescriptor): Promise<Buffer> {
    const descriptor = avatarObjectDescriptorSchema.parse(descriptorInput), address = avatarObjectAddress(config, binding, descriptor.asset.id);
    if (descriptor.objectName !== address.objectName) fail();
    const checked = checkedMetadata(await bucket.metadata(address.objectName, descriptor.generation), address, descriptor.asset.id, descriptor.generation);
    if (canonical(checked.descriptor) !== canonical(descriptor)) fail();
    const stream = bucket.readPinned(address.objectName, descriptor.generation), parts: Buffer[] = [];
    let size = 0, accepted = false;
    const limit = Number(checked.metadata.size);
    const onResponse = (response: unknown) => {
      if (!response || typeof response !== 'object' || !('statusCode' in response) || ![200, 206].includes(Number(response.statusCode))) { stream.destroy(new AvatarObjectError('avatar_unavailable')); return; }
      const headers = 'headers' in response && response.headers && typeof response.headers === 'object' ? response.headers as Record<string, unknown> : {};
      if (headers['content-encoding'] !== undefined && headers['content-encoding'] !== 'identity'
        || headers['x-goog-generation'] !== undefined && headers['x-goog-generation'] !== descriptor.generation
        || headers['content-length'] !== undefined && (!/^[0-9]+$/u.test(String(headers['content-length'])) || BigInt(String(headers['content-length'])) > BigInt(limit))) {
        stream.destroy(new AvatarObjectError('avatar_integrity_failed')); return;
      }
      accepted = true;
    };
    stream.once('response', onResponse);
    const deadline = setTimeout(() => stream.destroy(new AvatarObjectError('avatar_unavailable')), 20_000);
    try {
      for await (const part of stream) {
        if (!accepted || !Buffer.isBuffer(part)) fail(); size += part.length;
        if (size > limit) fail(); parts.push(part);
      }
      if (!accepted || size !== limit) fail();
      const ciphertext = Buffer.concat(parts, size); if (digest(ciphertext) !== descriptor.cipherSha256) fail();
      let plain: string; try { plain = cipher.decrypt(ciphertext.toString('utf8'), address.aad); } catch { fail(); }
      if (plain!.length > Math.ceil(MAX_PLAIN / 3) * 4) fail();
      const buffer = Buffer.from(plain!, 'base64');
      if (buffer.toString('base64') !== plain! || buffer.length !== descriptor.asset.bytes || digest(buffer) !== descriptor.asset.sha256
        || buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) fail();
      return buffer;
    } finally { clearTimeout(deadline); stream.removeListener('response', onResponse); stream.destroy(); parts.length = 0; }
  }
  async function inspect(binding: AvatarBinding, assetId: string, expected?: AvatarAsset): Promise<AvatarObjectDescriptor | null> {
    const address = avatarObjectAddress(config, binding, assetId);
    let raw: unknown; try { raw = await bucket.metadata(address.objectName); } catch (error) { if (absent(error)) return null; throw error; }
    const { descriptor } = checkedMetadata(raw, address, assetId);
    if (expected && canonical(descriptor.asset) !== canonical(avatarAssetSchema.parse(expected))) fail();
    const bytes = await read(binding, descriptor); bytes.fill(0); return descriptor;
  }
  return {
    read, inspect,
    address(binding: AvatarBinding, assetId: string) { return avatarObjectAddress(config, binding, assetId).objectName; },
    async write(binding: AvatarBinding, assetInput: AvatarAsset, buffer: Buffer): Promise<AvatarObjectDescriptor> {
      const asset = avatarAssetSchema.parse(assetInput), address = avatarObjectAddress(config, binding, asset.id);
      if (!Buffer.isBuffer(buffer) || buffer.length !== asset.bytes || buffer.length > MAX_PLAIN || digest(buffer) !== asset.sha256) fail();
      const ciphertext = Buffer.from(cipher.encrypt(buffer.toString('base64'), address.aad), 'utf8');
      if (ciphertext.length > MAX_CIPHER) fail();
      const cipherSha256 = digest(ciphertext);
      try {
        await bucket.writeNew(address.objectName, ciphertext, { resumable: false, validation: 'crc32c', preconditionOpts: { ifGenerationMatch: 0 }, timeout: 20_000,
          metadata: { contentType: 'application/octet-stream', cacheControl: 'private, no-store',
            metadata: { format: FORMAT, binding: address.tag, cipherSha256, sha256: asset.sha256, bytes: String(asset.bytes), width: String(asset.width), height: String(asset.height) } } });
      } catch (error) {
        // A lost write response never creates a new address or overwrites a generation.
        const recovered = await inspect(binding, asset.id, asset); if (recovered) return recovered; throw error;
      }
      const result = await inspect(binding, asset.id, asset); if (!result) fail('avatar_unavailable'); return result;
    },
    async remove(binding: AvatarBinding, descriptorInput: AvatarObjectDescriptor): Promise<void> {
      if (!bucket.removePinned) fail('avatar_unavailable');
      const descriptor = avatarObjectDescriptorSchema.parse(descriptorInput), address = avatarObjectAddress(config, binding, descriptor.asset.id);
      if (descriptor.objectName !== address.objectName) fail();
      try {
        const current = checkedMetadata(await bucket.metadata(address.objectName, descriptor.generation), address, descriptor.asset.id, descriptor.generation);
        if (canonical(current.descriptor) !== canonical(descriptor)) fail();
      } catch (error) { if (absent(error)) return; throw error; }
      await bucket.removePinned!(address.objectName, descriptor.generation);
      try { await bucket.metadata(address.objectName, descriptor.generation); } catch (error) { if (absent(error)) return; throw error; }
      fail('avatar_unavailable');
    },
  };
}
export type AvatarObjects = ReturnType<typeof createAvatarObjects>;
export function createCloudStorageAvatarObjects(options: { config: FirebasePhotoObjectsConfig; cipher: StorageCipher }): AvatarObjects {
  const config = firebaseObjectStorageConfigSchema.parse(options.config);
  if (process.env.STORAGE_EMULATOR_HOST !== undefined || process.env.FIREBASE_STORAGE_EMULATOR_HOST !== undefined) fail('avatar_unavailable');
  const storage = new Storage({ projectId: config.projectId, retryOptions: { autoRetry: false }, timeout: 20_000 });
  return createAvatarObjects({ ...options, config, bucket: createFirebasePhotoBucketPort(storage.bucket(config.bucketName), MAX_CIPHER) });
}
