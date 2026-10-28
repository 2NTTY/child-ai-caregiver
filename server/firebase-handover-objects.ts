import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Transform, type Readable, type Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Storage, type CreateWriteStreamOptions } from '@google-cloud/storage';
import { z } from 'zod';
import { firebaseObjectStorageConfigSchema, createFirebasePhotoBucketPort, readFirebaseStorageResponse,
  type FirebasePhotoObjectsConfig } from './firebase-photo-objects.ts';
import { workRecoveryScopeSchema, type WorkRecoveryScope } from './firestore-work-continuation-recovery.ts';
import { canonical } from './firestore-session-codec.ts';
import { waitForHandoverStep } from './handover-archive.ts';
import type { StorageFileCipher, StorageFileResult } from './storage-crypto.ts';

export const HANDOVER_OBJECT_LIMIT = 256 * 1024 * 1024;
const TIMEOUT = 300_000, FORMAT = 'yuyoufang-package/v1';
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const generation = z.string().regex(/^[1-9][0-9]{0,19}$/u).refine(value => BigInt(value) <= 18446744073709551615n);
const contentSchema = z.object({ sha256: hash, bytes: z.number().int().positive().max(HANDOVER_OBJECT_LIMIT) }).strict();
export const handoverObjectDescriptorSchema = contentSchema.extend({ objectName: z.string().min(1).max(256), generation, cipherSha256: hash }).strict();
export type HandoverObjectDescriptor = z.infer<typeof handoverObjectDescriptorSchema>;
type Content = z.infer<typeof contentSchema>;
type Identity = { scope: WorkRecoveryScope; packageId: string };
type Options = { signal?: AbortSignal };
const metadataSchema = z.object({ name: z.string(), bucket: z.string(), generation,
  size: z.union([z.number().int().positive(), z.string().regex(/^[1-9][0-9]{0,9}$/u)]),
  contentEncoding: z.string().optional(), metadata: z.object({ format: z.literal(FORMAT), binding: hash,
    sha256: hash, bytes: z.string().regex(/^[1-9][0-9]{0,9}$/u), cipherSha256: hash }).strict() });
export class HandoverObjectError extends Error {
  readonly code: 'package_object_invalid' | 'package_object_conflict' | 'package_object_unknown' | 'package_object_unavailable';
  constructor(code: HandoverObjectError['code']) {
    super(code); this.name = 'HandoverObjectError'; this.code = code;
  }
}
function reject(code: HandoverObjectError['code']): never { throw new HandoverObjectError(code); }
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
function checked<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value); if (!result.success) reject('package_object_invalid'); return result.data;
}
function deadline(input?: AbortSignal) { return AbortSignal.any([AbortSignal.timeout(TIMEOUT), ...(input ? [input] : [])]); }

/** The bucket never decides user authorization. Immutable object identity is supplied by the durable domain job. */
export interface HandoverBucketPort {
  createWrite(name: string, options: CreateWriteStreamOptions): Writable;
  metadata(name: string, signal: AbortSignal): Promise<unknown | null>;
  readPinned(name: string, generation: string, signal: AbortSignal): Readable;
  removePinned(name: string, generation: string, signal: AbortSignal): Promise<void>;
}

/** Uses the installed Storage SDK; no automatic upload retry or numeric generation conversion. */
export function createCloudStorageHandoverObjects(options: { config: FirebasePhotoObjectsConfig; files: StorageFileCipher }) {
  const config = checked(firebaseObjectStorageConfigSchema, options.config);
  if (process.env.STORAGE_EMULATOR_HOST !== undefined || process.env.FIREBASE_STORAGE_EMULATOR_HOST !== undefined)
    reject('package_object_unavailable');
  const storage = new Storage({ projectId: config.projectId, retryOptions: { autoRetry: false }, timeout: TIMEOUT });
  const bucket = storage.bucket(config.bucketName), existing = createFirebasePhotoBucketPort(bucket);
  return createFirebaseHandoverObjects({ ...options, config, bucket: {
    createWrite: (name, writeOptions) => bucket.file(name).createWriteStream(writeOptions),
    async metadata(name, signal) {
      try { return await waitForHandoverStep(existing.metadata(name), signal); }
      catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 404) return null; throw error; }
    },
    readPinned(name, version, signal) {
      const stream = readFirebaseStorageResponse(bucket, name, version, HANDOVER_OBJECT_LIMIT + 32, TIMEOUT);
      const cancel = () => stream.destroy(new Error('Package download cancelled'));
      signal.addEventListener('abort', cancel, { once: true });
      stream.once('close', () => signal.removeEventListener('abort', cancel));
      if (signal.aborted) cancel();
      return stream;
    },
    async removePinned(name, version, signal) {
      signal.throwIfAborted();
      // A cancelled/lost DELETE response remains unknown; retry only this exact generation.
      await waitForHandoverStep(existing.removePinned!(name, version), signal);
    },
  } });
}

export function createFirebaseHandoverObjects(options: { config: FirebasePhotoObjectsConfig; files: StorageFileCipher; bucket: HandoverBucketPort }) {
  const config = checked(firebaseObjectStorageConfigSchema, options.config), { files, bucket } = options;
  function identity(input: Identity) {
    const scope = checked(workRecoveryScopeSchema, input.scope), packageId = checked(z.uuid(), input.packageId);
    const context = canonical([FORMAT, config.projectId, config.namespace, scope, packageId]);
    const binding = sha(context), objectName = 'packages/v1/' + binding + '/' + packageId;
    return { context, binding, objectName };
  }
  function descriptor(raw: unknown, id: ReturnType<typeof identity>, content: Content) {
    const row = checked(metadataSchema, raw), expected = checked(contentSchema, content);
    if (row.name !== id.objectName || row.bucket !== config.bucketName || row.contentEncoding
      || row.metadata.binding !== id.binding || row.metadata.sha256 !== expected.sha256
      || Number(row.metadata.bytes) !== expected.bytes || Number(row.size) !== expected.bytes + 32) reject('package_object_conflict');
    return checked(handoverObjectDescriptorSchema, { objectName: id.objectName, generation: row.generation,
      sha256: expected.sha256, bytes: expected.bytes, cipherSha256: row.metadata.cipherSha256 });
  }
  async function probe(input: Identity & { content: Content } & Options) {
    const signal = deadline(input.signal); signal.throwIfAborted();
    const id = identity(input), content = checked(contentSchema, input.content);
    let metadata: unknown;
    try { metadata = await waitForHandoverStep(bucket.metadata(id.objectName, signal), signal); }
    catch { reject('package_object_unavailable'); }
    return metadata === null ? null : descriptor(metadata, id, content);
  }
  function pinned(input: Identity & { descriptor: HandoverObjectDescriptor }) {
    const id = identity(input), value = checked(handoverObjectDescriptorSchema, input.descriptor);
    if (value.objectName !== id.objectName) reject('package_object_invalid');
    return { id, value };
  }
  return {
    probe,
    async put(input: Identity & { source: string; directory: string; content: Content } & Options): Promise<HandoverObjectDescriptor> {
      const signal = deadline(input.signal); signal.throwIfAborted();
      const id = identity(input), content = checked(contentSchema, input.content);
      const found = await probe({ ...input, signal }); if (found) return found;
      let encrypted: StorageFileResult | undefined;
      try {
        encrypted = await files.encrypt({ source: input.source, directory: input.directory, context: id.context, maxBytes: content.bytes, signal });
        // Hash the input through the encryption pass so the persisted job's fingerprint is the uploaded content.
        if (encrypted.bytes !== content.bytes + 32 || encrypted.sourceSha256 !== content.sha256) reject('package_object_conflict');
        const output = bucket.createWrite(id.objectName, { resumable: false, validation: 'crc32c',
          preconditionOpts: { ifGenerationMatch: 0 }, metadata: { contentType: 'application/octet-stream', cacheControl: 'private, no-store',
            metadata: { format: FORMAT, binding: id.binding, sha256: content.sha256, bytes: String(content.bytes), cipherSha256: encrypted.sha256 } } });
        try { await pipeline(createReadStream(encrypted.path), output, { signal }); }
        catch { reject('package_object_unknown'); }
        try {
          const saved = await probe({ ...input, signal }); if (!saved) reject('package_object_unknown');
          return saved;
        } catch (error) {
          if (error instanceof HandoverObjectError && ['package_object_conflict', 'package_object_invalid'].includes(error.code)) throw error;
          reject('package_object_unknown');
        }
      } finally { if (encrypted) await rm(encrypted.path, { force: true }); }
    },
    async read(input: Identity & { descriptor: HandoverObjectDescriptor; directory: string } & Options): Promise<StorageFileResult> {
      const signal = deadline(input.signal); signal.throwIfAborted();
      const { id, value } = pinned(input);
      const cipherPath = join(input.directory, randomUUID() + '.package-cipher');
      let plaintext: StorageFileResult | undefined, owned = false;
      try {
        let bytes = 0; const digest = createHash('sha256');
        const bound = new Transform({ transform(chunk: Buffer, _encoding, callback) {
          bytes += chunk.length; digest.update(chunk);
          callback(bytes > value.bytes + 32 ? new Error('Package object exceeds saved bound') : null, chunk);
        } });
        // Acquire the source before opening a destination: SDK initialization can throw synchronously.
        const source = bucket.readPinned(value.objectName, value.generation, signal);
        const output = createWriteStream(cipherPath, { flags: 'wx', mode: 0o600 }); output.once('open', () => { owned = true; });
        await pipeline(source, bound, output, { signal });
        if (bytes !== value.bytes + 32 || digest.digest('hex') !== value.cipherSha256) reject('package_object_invalid');
        plaintext = await files.decrypt({ source: cipherPath, directory: input.directory, context: id.context, maxBytes: value.bytes, signal });
        if (plaintext.bytes !== value.bytes || plaintext.sha256 !== value.sha256) reject('package_object_invalid');
        return plaintext;
      } catch (error) {
        if (plaintext) await rm(plaintext.path, { force: true });
        if (error instanceof HandoverObjectError) throw error;
        reject('package_object_unavailable');
      } finally { if (owned) await rm(cipherPath, { force: true }); }
    },
    async remove(input: Identity & { descriptor: HandoverObjectDescriptor } & Options) {
      const signal = deadline(input.signal); signal.throwIfAborted(); const { value } = pinned(input);
      try { await bucket.removePinned(value.objectName, value.generation, signal); }
      catch { reject('package_object_unknown'); }
    },
  };
}
