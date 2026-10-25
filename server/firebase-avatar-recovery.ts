import type { ManagedAvatarRead } from './firebase-managed-avatar-recovery.ts';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { canonical } from './firestore-session-codec.ts';
import { avatarBindingSchema, avatarObjectDescriptorSchema, sameAvatarBinding, type AvatarBinding, type AvatarObjectDescriptor } from './avatar-data.ts';
import { type AvatarObjects } from './firebase-avatar-objects.ts';
import { firebasePhotoRecoveryConfigSchema, FIREBASE_PHOTO_BACKUP_MIN_RETENTION_MS, FIREBASE_PHOTO_BACKUP_MAX_RETENTION_MS } from './firebase-photo-recovery.ts';
import type { FirebasePhotoBucketPort } from './firebase-photo-objects.ts';
import type { StorageCipher } from './storage-crypto.ts';

const FORMAT = 'yuyoufang-avatar-backup/v1';
// Format bound covers the 4 MiB normalized JPEG, base64 JSON and encrypted envelope; it is not upload admission.
export const AVATAR_BACKUP_MAX_CIPHER_BYTES = 12 * 1024 * 1024;
const hash = z.string().regex(/^[a-f0-9]{64}$/u), at = z.iso.datetime({ offset: true });
const objectName = z.string().regex(/^firebase-backups\/v1\/[a-f0-9-]{36}\/avatars\/[a-f0-9-]{36}$/u);
export const avatarBackupDescriptorSchema = z.object({ format: z.literal(FORMAT), objectName,
  generation: avatarObjectDescriptorSchema.shape.generation, cipherSha256: hash,
  bytes: z.number().int().positive().max(AVATAR_BACKUP_MAX_CIPHER_BYTES), retainedUntil: at }).strict();
export type AvatarBackupDescriptor = z.infer<typeof avatarBackupDescriptorSchema>;
const inputSchema = z.object({ backupId: z.uuid(), binding: avatarBindingSchema, version: z.number().int().min(1).max(2147483647),
  descriptor: avatarObjectDescriptorSchema, retainedUntil: at }).strict();
const bodySchema = inputSchema.extend({ base64: z.string().min(1).max(Math.ceil(4 * 1024 * 1024 / 3) * 4) }).strict();
const metadataSchema = z.object({ name: objectName, bucket: z.string(), generation: avatarObjectDescriptorSchema.shape.generation,
  size: z.union([z.string().regex(/^[1-9][0-9]{0,19}$/u), z.number().int().positive()]).refine(value => BigInt(value) <= BigInt(AVATAR_BACKUP_MAX_CIPHER_BYTES)),
  contentEncoding: z.string().optional(), temporaryHold: z.literal(true), metadata: z.object({ format: z.literal(FORMAT), binding: hash,
    cipherSha256: hash, payloadSha256: hash, retainedUntil: at }).strict() });
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
function check(value: unknown, code = 'avatar_backup_integrity'): asserts value {
  if (!value) throw Object.assign(new Error('Avatar backup could not be verified'), { code, status: 503 });
}
async function ciphertext(bucket: FirebasePhotoBucketPort, descriptor: AvatarBackupDescriptor): Promise<Buffer> {
  const stream = bucket.readPinned(descriptor.objectName, descriptor.generation), parts: Buffer[] = []; let size = 0, accepted = false;
  const response = (raw: unknown) => {
    const value = raw as { statusCode?: unknown; headers?: Record<string, unknown> } | null;
    const headers = value?.headers ?? {};
    if (!value || ![200, 206].includes(Number(value.statusCode)) || headers['content-encoding'] !== undefined && headers['content-encoding'] !== 'identity'
      || headers['x-goog-generation'] !== undefined && headers['x-goog-generation'] !== descriptor.generation
      || headers['content-length'] !== undefined && (!/^[0-9]+$/u.test(String(headers['content-length'])) || BigInt(String(headers['content-length'])) > BigInt(descriptor.bytes))) {
      stream.destroy(new Error('Avatar backup response rejected')); return;
    }
    accepted = true;
  };
  stream.once('response', response); const timer = setTimeout(() => stream.destroy(new Error('Avatar backup timed out')), 20_000);
  try {
    for await (const part of stream) { check(accepted && Buffer.isBuffer(part)); size += part.length; check(size <= descriptor.bytes); parts.push(part); }
    check(accepted && size === descriptor.bytes); const result = Buffer.concat(parts, size); check(digest(result) === descriptor.cipherSha256); return result;
  } finally { clearTimeout(timer); stream.removeListener('response', response); stream.destroy(); parts.length = 0; }
}
/** Immutable normalized-only backup. Journal authorization is the managed recovery caller's responsibility. */
export function createFirebaseAvatarRecovery(options: { config: z.infer<typeof firebasePhotoRecoveryConfigSchema>; cipher: StorageCipher;
  backupBucket: FirebasePhotoBucketPort; objects: AvatarObjects; readNormalized: ManagedAvatarRead; serverClock?: () => number }) {
  const config = firebasePhotoRecoveryConfigSchema.parse(options.config), clock = options.serverClock ?? Date.now;
  function address(backupId: string, assetId: string) {
    z.uuid().parse(backupId); z.uuid().parse(assetId);
    const name = 'firebase-backups/v1/' + backupId + '/avatars/' + assetId;
    const aad = canonical([FORMAT, config.projectId, config.namespace, config.backupBucketName, name]); return { name, aad, tag: digest(aad) };
  }
  function normalized(raw: unknown) {
    const body = bodySchema.parse(raw), bytes = Buffer.from(body.base64, 'base64');
    try {
      check(bytes.toString('base64') === body.base64 && bytes.length === body.descriptor.asset.bytes && digest(bytes) === body.descriptor.asset.sha256
        && body.descriptor.objectName === options.objects.address(body.binding, body.descriptor.asset.id));
      return body;
    } finally { bytes.fill(0); }
  }
  async function read(backupId: string, assetId: string, raw: AvatarBackupDescriptor) {
    const descriptor = avatarBackupDescriptorSchema.parse(raw), expected = address(backupId, assetId); check(descriptor.objectName === expected.name);
    const metadata = metadataSchema.parse(await options.backupBucket.metadata(expected.name, descriptor.generation));
    check(metadata.name === expected.name && metadata.bucket === config.backupBucketName && metadata.generation === descriptor.generation
      && Number(metadata.size) === descriptor.bytes && metadata.metadata.binding === expected.tag && metadata.metadata.cipherSha256 === descriptor.cipherSha256
      && metadata.metadata.retainedUntil === descriptor.retainedUntil && (metadata.contentEncoding === undefined || metadata.contentEncoding === 'identity'));
    check(Date.parse(descriptor.retainedUntil) > clock(), 'avatar_backup_expired');
    const encrypted = await ciphertext(options.backupBucket, descriptor);
    const body = normalized(JSON.parse(options.cipher.decrypt(new TextDecoder('utf-8', { fatal: true }).decode(encrypted), expected.aad)));
    check(body.backupId === backupId && body.descriptor.asset.id === assetId && body.retainedUntil === descriptor.retainedUntil
      && digest(canonical(body)) === metadata.metadata.payloadSha256); return body;
  }
  return {
    async backupAvatar(raw: z.infer<typeof inputSchema>): Promise<AvatarBackupDescriptor> {
      const input = inputSchema.parse(raw), expires = Date.parse(input.retainedUntil), now = clock();
      check(Number.isSafeInteger(now) && expires >= now + FIREBASE_PHOTO_BACKUP_MIN_RETENTION_MS && expires <= now + FIREBASE_PHOTO_BACKUP_MAX_RETENTION_MS, 'avatar_backup_retention');
      const source = await options.readNormalized(input.binding, input.descriptor, input.version);
      let body: z.infer<typeof bodySchema>; try { body = normalized({ ...input, base64: source.toString('base64') }); } finally { source.fill(0); }
      const expected = address(input.backupId, input.descriptor.asset.id), plain = canonical(body);
      const encrypted = Buffer.from(options.cipher.encrypt(plain, expected.aad), 'utf8'); check(encrypted.length <= AVATAR_BACKUP_MAX_CIPHER_BYTES);
      let rawMetadata: unknown;
      try { rawMetadata = await options.backupBucket.writeNew(expected.name, encrypted, { resumable: false, validation: 'crc32c', timeout: 20_000,
        preconditionOpts: { ifGenerationMatch: 0 }, metadata: { contentType: 'application/octet-stream', cacheControl: 'private, no-store', temporaryHold: true,
          metadata: { format: FORMAT, binding: expected.tag, cipherSha256: digest(encrypted), payloadSha256: digest(plain), retainedUntil: input.retainedUntil } } }); }
      catch { rawMetadata = await options.backupBucket.metadata(expected.name); }
      const metadata = metadataSchema.parse(rawMetadata), descriptor = avatarBackupDescriptorSchema.parse({ format: FORMAT, objectName: expected.name,
        generation: metadata.generation, cipherSha256: metadata.metadata.cipherSha256, bytes: Number(metadata.size), retainedUntil: metadata.metadata.retainedUntil });
      check(canonical(await read(input.backupId, input.descriptor.asset.id, descriptor)) === plain); return descriptor;
    },
    async restoreAvatar(input: { backupId: string; binding: AvatarBinding; version: number; descriptor: AvatarObjectDescriptor;
      backup: AvatarBackupDescriptor; targetBinding: AvatarBinding; authorizeCopy(): Promise<void> }): Promise<AvatarObjectDescriptor> {
      const body = await read(input.backupId, input.descriptor.asset.id, input.backup), target = avatarBindingSchema.parse(input.targetBinding);
      check(sameAvatarBinding(body.binding, input.binding) && body.version === input.version && canonical(body.descriptor) === canonical(input.descriptor)
        && sameAvatarBinding({ ...body.binding, scope: { ...body.binding.scope, storageEpoch: target.scope.storageEpoch } }, target)
        && target.scope.storageEpoch !== body.binding.scope.storageEpoch);
      const bytes = Buffer.from(body.base64, 'base64');
      try { await input.authorizeCopy(); const result = await options.objects.write(target, body.descriptor.asset, bytes);
        check(canonical(result.asset) === canonical(body.descriptor.asset)); return result; } finally { bytes.fill(0); }
    },
  };
}
export type FirebaseAvatarRecovery = ReturnType<typeof createFirebaseAvatarRecovery>;
