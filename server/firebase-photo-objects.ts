import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import { Storage, type SaveOptions } from "@google-cloud/storage";
import { z } from "zod";
import { PHOTO_LIMITS } from "../src/shared/photos.ts";
import { decodePhoto, photoHash } from "./photo-files.ts";
import { workRecoveryScopeSchema, type WorkRecoveryScope } from "./firestore-work-continuation-recovery.ts";
import type { StorageCipher } from "./storage-crypto.ts";

const FORMAT = "yuban-photo-object", VERSION = 1;
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const generationSchema = z.string().regex(/^[1-9][0-9]{0,19}$/u)
  .refine(value => BigInt(value) <= 18446744073709551615n);
const configSchema = z.object({
  projectId: z.string().regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u),
  namespace: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/u),
  bucketName: z.string().min(3).max(222).regex(/^[a-z0-9][a-z0-9._-]*[a-z0-9]$/u),
}).strict();
const inputSchema = z.object({ base64: z.string(), mimeType: z.enum(["image/jpeg", "image/png"]) }).strict();
export const FIREBASE_PHOTO_TIMEOUT_MS = 20_000;
const MAX_BASE64_BYTES = Math.ceil(PHOTO_LIMITS.bytes / 3) * 4;
/** yb1. plus base64 of the existing YBG1/nonce/tag/encrypted-base64 envelope. */
export const FIREBASE_PHOTO_MAX_CIPHER_BYTES = 4 + Math.ceil((MAX_BASE64_BYTES + 32) / 3) * 4;
export const firebasePhotoObjectDescriptorSchema = z.object({
  objectName: z.string().min(1).max(256),
  generation: generationSchema,
  cipherSha256: hashSchema,
  sha256: hashSchema,
  bytes: z.number().int().positive().max(PHOTO_LIMITS.bytes),
  mimeType: z.enum(["image/jpeg", "image/png"]),
}).strict();
export type FirebasePhotoObjectDescriptor = z.infer<typeof firebasePhotoObjectDescriptorSchema>;
export type FirebasePhotoObjectsConfig = z.infer<typeof configSchema>;
export interface FirebasePhotoObjectContent { buffer: Buffer; base64: string; mimeType: "image/jpeg" | "image/png" }
type ErrorCode = "photo_object_invalid_input" | "photo_object_conflict" | "photo_object_integrity_failed" | "photo_object_unavailable";
export class FirebasePhotoObjectError extends Error {
  readonly code: ErrorCode;
  readonly status: 400 | 409 | 503;
  constructor(code: ErrorCode, status: 400 | 409 | 503) { super(code); this.name = "FirebasePhotoObjectError"; this.code = code; this.status = status; }
}
function fail(code: ErrorCode, status: 400 | 409 | 503): never { throw new FirebasePhotoObjectError(code, status); }
function parse<T>(schema: z.ZodType<T>, value: unknown, input = false): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) fail(input ? "photo_object_invalid_input" : "photo_object_integrity_failed", input ? 400 : 503);
  return parsed.data;
}
const digest = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const customMetadataSchema = z.object({
  format: z.literal(FORMAT + "/v1"), binding: hashSchema, cipherSha256: hashSchema, sha256: hashSchema,
}).strict();
const metadataSchema = z.object({
  name: z.string(), bucket: z.string(), generation: generationSchema,
  size: z.union([z.string().regex(/^(0|[1-9][0-9]{0,19})$/u), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)])
    .refine(value => BigInt(value) > 0n && BigInt(value) <= BigInt(FIREBASE_PHOTO_MAX_CIPHER_BYTES)),
  metadata: customMetadataSchema,
  contentEncoding: z.string().optional(),
});
type ObjectMetadata = z.infer<typeof metadataSchema>;
export interface FirebasePhotoBucketPort {
  writeNew(objectName: string, ciphertext: Buffer, options: SaveOptions): Promise<unknown>;
  metadata(objectName: string, generation?: string): Promise<unknown>;
  readPinned(objectName: string, generation: string): Readable;
}
interface SdkRequest {
  method: "GET"; uri: ""; qs?: { generation?: string; alt?: "media" };
  headers?: Record<string, string>; gzip?: false; timeout: number;
}
export interface FirebasePhotoSdkFile {
  readonly metadata: unknown;
  save(data: Buffer, options: SaveOptions): Promise<void>;
  request(options: SdkRequest): Promise<[unknown, unknown]>;
  requestStream(options: SdkRequest): Readable;
}
export interface FirebasePhotoSdkBucket { file(objectName: string): FirebasePhotoSdkFile }

/** Use public requests: Storage 7.22 FileOptions.generation otherwise converts strings to Number. */
export function createFirebasePhotoBucketPort(bucket: FirebasePhotoSdkBucket): FirebasePhotoBucketPort {
  return {
    async writeNew(objectName, ciphertext, options) {
      const file = bucket.file(objectName);
      await file.save(ciphertext, options);
      return file.metadata;
    },
    async metadata(objectName, generation) {
      const [body, response] = await bucket.file(objectName).request({
        method: "GET", uri: "", qs: generation === undefined ? {} : { generation }, timeout: FIREBASE_PHOTO_TIMEOUT_MS,
        headers: { "Cache-Control": "no-store" },
      });
      if (!response || typeof response !== "object" || !("statusCode" in response) || response.statusCode !== 200)
        fail("photo_object_unavailable", 503);
      return body;
    },
    readPinned(objectName, generation) {
      return bucket.file(objectName).requestStream({
        method: "GET", uri: "", qs: { alt: "media", generation }, gzip: false, timeout: FIREBASE_PHOTO_TIMEOUT_MS,
        headers: { Range: "bytes=0-" + FIREBASE_PHOTO_MAX_CIPHER_BYTES, "Accept-Encoding": "identity", "Cache-Control": "no-store" },
      });
    },
  };
}

/** Constructs the real SDK only at explicit runtime assembly; no custom endpoints or emulator. */
export function createCloudStoragePhotoObjects(options: { config: FirebasePhotoObjectsConfig; cipher: StorageCipher }) {
  const config = parse(configSchema, options.config, true);
  if (Object.keys(options).some(key => key !== "config" && key !== "cipher")
    || process.env.STORAGE_EMULATOR_HOST !== undefined || process.env.FIREBASE_STORAGE_EMULATOR_HOST !== undefined)
    fail("photo_object_unavailable", 503);
  const storage = new Storage({ projectId: config.projectId, retryOptions: { autoRetry: false }, timeout: FIREBASE_PHOTO_TIMEOUT_MS });
  return createFirebasePhotoObjects({ config, cipher: options.cipher, bucket: createFirebasePhotoBucketPort(storage.bucket(config.bucketName)) });
}

/** This immutable object port does not grant domain authorization; callers must check Firestore authority. */
export function createFirebasePhotoObjects(options: {
  config: FirebasePhotoObjectsConfig; cipher: StorageCipher; bucket: FirebasePhotoBucketPort;
}) {
  const config = parse(configSchema, options.config, true), { cipher, bucket } = options;
  function binding(scopeInput: WorkRecoveryScope, photoIdInput: string) {
    const scope = parse(workRecoveryScopeSchema, scopeInput, true), photoId = parse(z.uuid(), photoIdInput, true);
    const fullScope = { ownerUserId: scope.ownerUserId, workspaceId: scope.workspaceId, childId: scope.childId, storageEpoch: scope.storageEpoch };
    const scopeHash = digest(JSON.stringify([FORMAT, VERSION, config.projectId, config.namespace, fullScope]));
    const objectName = "photos/v1/" + scopeHash + "/" + photoId;
    const aad = JSON.stringify({ format: FORMAT, version: VERSION, projectId: config.projectId,
      namespace: config.namespace, bucket: config.bucketName, objectName, scope: fullScope, photoId });
    return { objectName, aad, tag: digest(aad) };
  }
  type Binding = ReturnType<typeof binding>;
  function checkedMetadata(value: unknown, expected: Binding, generation?: string): ObjectMetadata {
    const metadata = parse(metadataSchema, value);
    if (metadata.name !== expected.objectName || metadata.bucket !== config.bucketName
      || metadata.metadata.binding !== expected.tag || (generation !== undefined && metadata.generation !== generation)
      || (metadata.contentEncoding !== undefined && metadata.contentEncoding !== "identity"))
      fail("photo_object_integrity_failed", 503);
    return metadata;
  }
  async function boundedMedia(expected: Binding, metadata: ObjectMetadata): Promise<Buffer> {
    const stream = bucket.readPinned(expected.objectName, metadata.generation);
    const limit = Number(metadata.size), chunks: Buffer[] = [];
    let size = 0, responseAccepted = false;
    const onResponse = (response: unknown) => {
      if (!response || typeof response !== "object" || !("statusCode" in response)
        || (response.statusCode !== 200 && response.statusCode !== 206)) {
        stream.destroy(new FirebasePhotoObjectError("photo_object_unavailable", 503)); return;
      }
      const headers = "headers" in response && response.headers && typeof response.headers === "object"
        ? response.headers as Record<string, unknown> : {};
      const length = headers["content-length"], encoding = headers["content-encoding"], generation = headers["x-goog-generation"];
      if ((encoding !== undefined && encoding !== "identity") || (generation !== undefined && generation !== metadata.generation)
        || (length !== undefined && (typeof length !== "string" || !/^[0-9]+$/u.test(length)
          || BigInt(length) > BigInt(limit)))) {
        stream.destroy(new FirebasePhotoObjectError("photo_object_integrity_failed", 503)); return;
      }
      responseAccepted = true;
    };
    stream.once("response", onResponse);
    const deadline = setTimeout(() => stream.destroy(new FirebasePhotoObjectError("photo_object_unavailable", 503)), FIREBASE_PHOTO_TIMEOUT_MS);
    try {
      for await (const chunk of stream) {
        if (!responseAccepted || !Buffer.isBuffer(chunk)) fail("photo_object_integrity_failed", 503);
        // Retain no more than the declared size plus one, even when a server ignores Range.
        const part = chunk.subarray(0, Math.max(0, limit + 1 - size));
        size += part.length; chunks.push(part);
        if (size > limit || part.length !== chunk.length) fail("photo_object_integrity_failed", 503);
      }
      if (!responseAccepted || size !== limit) fail("photo_object_integrity_failed", 503);
      return Buffer.concat(chunks, size);
    } finally { clearTimeout(deadline); stream.removeListener("response", onResponse); stream.destroy(); }
  }
  async function stored(expected: Binding, generation: string, descriptor?: FirebasePhotoObjectDescriptor) {
    const metadata = checkedMetadata(await bucket.metadata(expected.objectName, generation), expected, generation);
    if (descriptor && (metadata.metadata.cipherSha256 !== descriptor.cipherSha256 || metadata.metadata.sha256 !== descriptor.sha256))
      fail("photo_object_integrity_failed", 503);
    const ciphertext = await boundedMedia(expected, metadata);
    if (photoHash(ciphertext) !== metadata.metadata.cipherSha256) fail("photo_object_integrity_failed", 503);
    let base64: string, buffer: Buffer, mimeType: "image/png" | "image/jpeg";
    try {
      base64 = cipher.decrypt(new TextDecoder("utf-8", { fatal: true }).decode(ciphertext), expected.aad);
      try { buffer = decodePhoto(base64, "image/png"); mimeType = "image/png"; }
      catch { buffer = decodePhoto(base64, "image/jpeg"); mimeType = "image/jpeg"; }
    } catch { fail("photo_object_integrity_failed", 503); }
    const sha256 = photoHash(buffer);
    if (sha256 !== metadata.metadata.sha256 || (descriptor
      && (sha256 !== descriptor.sha256 || buffer.length !== descriptor.bytes || mimeType !== descriptor.mimeType)))
      fail("photo_object_integrity_failed", 503);
    const actual = parse(firebasePhotoObjectDescriptorSchema, { objectName: expected.objectName, generation,
      cipherSha256: metadata.metadata.cipherSha256, sha256, bytes: buffer.length, mimeType });
    return { descriptor: actual, content: { buffer, base64, mimeType } satisfies FirebasePhotoObjectContent };
  }
  function safe(error: unknown): never {
    if (error instanceof FirebasePhotoObjectError) throw error;
    fail("photo_object_unavailable", 503);
  }
  return {
    async recover(scope: WorkRecoveryScope, photoId: string, input: { base64: string; mimeType: "image/jpeg" | "image/png" }): Promise<FirebasePhotoObjectDescriptor> {
      const expected = binding(scope, photoId), payload = parse(inputSchema, input, true);
      let plaintext: Buffer;
      try { plaintext = decodePhoto(payload.base64, payload.mimeType); } catch { fail("photo_object_invalid_input", 400); }
      try {
        const latest = checkedMetadata(await bucket.metadata(expected.objectName), expected);
        const existing = await stored(expected, latest.generation);
        if (existing.descriptor.sha256 !== photoHash(plaintext) || existing.descriptor.bytes !== plaintext.length
          || existing.descriptor.mimeType !== payload.mimeType || !existing.content.buffer.equals(plaintext))
          fail("photo_object_conflict", 409);
        return existing.descriptor;
      } catch (error) { return safe(error); }
    },
    async write(scope: WorkRecoveryScope, photoId: string, input: { base64: string; mimeType: "image/jpeg" | "image/png" }): Promise<FirebasePhotoObjectDescriptor> {
      const expected = binding(scope, photoId), payload = parse(inputSchema, input, true);
      let plaintext: Buffer;
      try { plaintext = decodePhoto(payload.base64, payload.mimeType); } catch { fail("photo_object_invalid_input", 400); }
      const sha256 = photoHash(plaintext);
      let ciphertext: Buffer;
      try { ciphertext = Buffer.from(cipher.encrypt(payload.base64, expected.aad), "utf8"); } catch { fail("photo_object_unavailable", 503); }
      if (!ciphertext.length || ciphertext.length > FIREBASE_PHOTO_MAX_CIPHER_BYTES) fail("photo_object_unavailable", 503);
      const cipherSha256 = photoHash(ciphertext);
      try {
        try {
          const metadata = checkedMetadata(await bucket.writeNew(expected.objectName, ciphertext, {
            resumable: false, validation: "crc32c", timeout: FIREBASE_PHOTO_TIMEOUT_MS, preconditionOpts: { ifGenerationMatch: 0 },
            metadata: { contentType: "application/octet-stream", cacheControl: "private, no-store",
              metadata: { format: FORMAT + "/v1", binding: expected.tag, cipherSha256, sha256 } },
          }), expected);
          if (Number(metadata.size) !== ciphertext.length || metadata.metadata.cipherSha256 !== cipherSha256 || metadata.metadata.sha256 !== sha256)
            fail("photo_object_integrity_failed", 503);
          return parse(firebasePhotoObjectDescriptorSchema, { objectName: expected.objectName, generation: metadata.generation,
            cipherSha256, sha256, bytes: plaintext.length, mimeType: payload.mimeType });
        } catch {
          // Resolve a precondition conflict or unknown upload outcome with reads only; never recreate.
          const latest = checkedMetadata(await bucket.metadata(expected.objectName), expected);
          const existing = await stored(expected, latest.generation);
          if (existing.descriptor.sha256 !== sha256 || existing.descriptor.bytes !== plaintext.length
            || existing.descriptor.mimeType !== payload.mimeType || !existing.content.buffer.equals(plaintext))
            fail("photo_object_conflict", 409);
          return existing.descriptor;
        }
      } catch (error) { return safe(error); }
    },
    async read(scope: WorkRecoveryScope, photoId: string, value: FirebasePhotoObjectDescriptor): Promise<FirebasePhotoObjectContent> {
      const expected = binding(scope, photoId), descriptor = parse(firebasePhotoObjectDescriptorSchema, value, true);
      if (descriptor.objectName !== expected.objectName) fail("photo_object_invalid_input", 400);
      try { return (await stored(expected, descriptor.generation, descriptor)).content; }
      catch (error) { return safe(error); }
    },
  };
}
export type FirebasePhotoObjects = ReturnType<typeof createFirebasePhotoObjects>;
