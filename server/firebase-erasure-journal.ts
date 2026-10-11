import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import { Storage, type SaveOptions } from "@google-cloud/storage";
import { z } from "zod";
import type { StorageCipher } from "./storage-crypto.ts";
import { workRecoveryScopeSchema } from "./firestore-work-continuation-recovery.ts";
import { canonical } from "./firestore-session-codec.ts";
import { FIREBASE_PHOTO_TIMEOUT_MS, type FirebasePhotoBucketPort, type FirebasePhotoSdkBucket } from "./firebase-photo-objects.ts";

const FORMAT = "yuban-erasure-journal", MAX_BYTES = 8192;
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const generation = z.string().regex(/^[1-9][0-9]{0,19}$/u).refine(value => BigInt(value) <= 18446744073709551615n);
export const firebaseErasureIntentSchema = z.object({
  scope: workRecoveryScopeSchema, assetId: z.uuid(), operationId: z.uuid(),
  at: z.iso.datetime({ offset: true }), type: z.literal("photo-delete"),
}).strict();
export type FirebaseErasureIntent = z.infer<typeof firebaseErasureIntentSchema>;
export const firebaseErasureDescriptorSchema = z.object({
  objectName: z.string().min(1).max(256), generation, cipherSha256: hash,
  intentSha256: hash, bytes: z.number().int().positive().max(MAX_BYTES), format: z.literal("yuban-erasure-journal/v1"),
}).strict();
export type FirebaseErasureDescriptor = z.infer<typeof firebaseErasureDescriptorSchema>;
const configSchema = z.object({ projectId: z.string().regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u),
  namespace: z.string().regex(/^[a-z][a-z0-9_]{0,60}$/u),
  bucketName: z.string().min(3).max(222).regex(/^[a-z0-9][a-z0-9._-]*[a-z0-9]$/u) }).strict();
export type FirebaseErasureConfig = z.infer<typeof configSchema>;
export class FirebaseErasureError extends Error {
  readonly code: "erasure_invalid" | "erasure_conflict" | "erasure_unavailable";
  readonly status: 400 | 409 | 503;
  constructor(code: FirebaseErasureError["code"], status: FirebaseErasureError["status"]) {
    super(code); this.name = "FirebaseErasureError"; this.code = code; this.status = status;
  }
}
function reject(code: FirebaseErasureError["code"], status: FirebaseErasureError["status"]): never { throw new FirebaseErasureError(code, status); }
function parse<T>(schema: z.ZodType<T>, value: unknown, input = false): T {
  const parsed = schema.safeParse(value); if (!parsed.success) reject(input ? "erasure_invalid" : "erasure_unavailable", input ? 400 : 503);
  return parsed.data;
}
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export const firebaseErasureIntentHash = (intent: FirebaseErasureIntent) => digest(canonical(parse(firebaseErasureIntentSchema, intent, true)));
const metadataSchema = z.object({
  name: z.string(), bucket: z.string(), generation,
  size: z.string().regex(/^[1-9][0-9]{0,19}$/u).refine(value => BigInt(value) <= BigInt(MAX_BYTES)),
  contentEncoding: z.string().optional(),
  metadata: z.object({ format: z.literal("yuban-erasure-journal/v1"), binding: hash, cipherSha256: hash, intentSha256: hash }).strict(),
});
export function createFirebaseErasureBucketPort(bucket: FirebasePhotoSdkBucket): FirebasePhotoBucketPort {
  return {
    async writeNew(name, ciphertext, options) { const file = bucket.file(name); await file.save(ciphertext, options); return file.metadata; },
    async metadata(name, revision) {
      const [body, response] = await bucket.file(name).request({ method: "GET", uri: "",
        qs: revision === undefined ? {} : { generation: revision }, timeout: FIREBASE_PHOTO_TIMEOUT_MS,
        headers: { "Cache-Control": "no-store" } });
      if (!response || typeof response !== "object" || !("statusCode" in response) || response.statusCode !== 200) reject("erasure_unavailable", 503);
      return body;
    },
    readPinned(name, revision) { return bucket.file(name).requestStream({ method: "GET", uri: "", qs: { alt: "media", generation: revision },
      timeout: FIREBASE_PHOTO_TIMEOUT_MS, gzip: false,
      headers: { Range: "bytes=0-" + MAX_BYTES, "Accept-Encoding": "identity", "Cache-Control": "no-store" } }); },
  };
}
export function createCloudStorageErasureJournal(options: { config: FirebaseErasureConfig; cipher: StorageCipher }) {
  const config = parse(configSchema, options.config, true);
  if (Object.keys(options).some(key => key !== "config" && key !== "cipher")
    || process.env.STORAGE_EMULATOR_HOST !== undefined || process.env.FIREBASE_STORAGE_EMULATOR_HOST !== undefined) reject("erasure_unavailable", 503);
  const storage = new Storage({ projectId: config.projectId, retryOptions: { autoRetry: false }, timeout: FIREBASE_PHOTO_TIMEOUT_MS });
  return createFirebaseErasureJournal({ config, cipher: options.cipher, bucket: createFirebaseErasureBucketPort(storage.bucket(config.bucketName)) });
}
/** Independent append-only intents. No bucket deletion, object deletion, list, or public access. */
export function createFirebaseErasureJournal(options: { config: FirebaseErasureConfig; cipher: StorageCipher; bucket: FirebasePhotoBucketPort }) {
  const config = parse(configSchema, options.config, true), { cipher, bucket } = options;
  const objectNameSchema = z.string().regex(/^erasures\/v1\/[a-f0-9]{64}$/u);
  const nameFor = (intent: FirebaseErasureIntent) =>
    "erasures/v1/" + digest(canonical([config.projectId, config.namespace, intent.scope.ownerUserId, intent.operationId]));
  function objectBinding(value: string) {
    const objectName = parse(objectNameSchema, value, true);
    // Recovery only needs the immutable object address; the complete intent remains encrypted.
    const aad = canonical([FORMAT, 1, config.projectId, config.namespace, config.bucketName, objectName]);
    return { objectName, aad, tag: digest(aad) };
  }
  function binding(value: FirebaseErasureIntent) {
    const intent = parse(firebaseErasureIntentSchema, value, true), body = canonical(intent);
    return { ...objectBinding(nameFor(intent)), intent, body, intentSha256: digest(body) };
  }
  type Binding = ReturnType<typeof objectBinding>;
  function checked(raw: unknown, expected: Binding, revision?: string) {
    const metadata = parse(metadataSchema, raw);
    if (metadata.name !== expected.objectName || metadata.bucket !== config.bucketName
      || metadata.metadata.binding !== expected.tag || (revision !== undefined && metadata.generation !== revision)
      || (metadata.contentEncoding !== undefined && metadata.contentEncoding !== "identity")) reject("erasure_conflict", 409);
    return metadata;
  }
  async function readStored(expected: Binding, revision: string, descriptor?: FirebaseErasureDescriptor, expectedIntent?: FirebaseErasureIntent) {
    const metadata = checked(await bucket.metadata(expected.objectName, revision), expected, revision);
    if (descriptor && (metadata.metadata.cipherSha256 !== descriptor.cipherSha256 || metadata.metadata.intentSha256 !== descriptor.intentSha256
      || Number(metadata.size) !== descriptor.bytes)) reject("erasure_unavailable", 503);
    const stream: Readable = bucket.readPinned(expected.objectName, revision), chunks: Buffer[] = [];
    const limit = Number(metadata.size); let size = 0, accepted = false;
    const response = (raw: unknown) => {
      if (!raw || typeof raw !== "object" || !("statusCode" in raw) || (raw.statusCode !== 200 && raw.statusCode !== 206)) {
        stream.destroy(new FirebaseErasureError("erasure_unavailable", 503)); return;
      }
      const headers = "headers" in raw && raw.headers && typeof raw.headers === "object" ? raw.headers as Record<string, unknown> : {};
      const length = headers["content-length"], encoding = headers["content-encoding"], revisionHeader = headers["x-goog-generation"];
      if ((encoding !== undefined && encoding !== "identity") || (revisionHeader !== undefined && revisionHeader !== revision)
        || (length !== undefined && (typeof length !== "string" || !/^[0-9]+$/u.test(length) || BigInt(length) > BigInt(limit)))) {
        stream.destroy(new FirebaseErasureError("erasure_unavailable", 503)); return;
      }
      accepted = true;
    };
    stream.once("response", response);
    const deadline = setTimeout(() => stream.destroy(new FirebaseErasureError("erasure_unavailable", 503)), FIREBASE_PHOTO_TIMEOUT_MS);
    let ciphertext: Buffer;
    try {
      for await (const chunk of stream) {
        if (!accepted || !Buffer.isBuffer(chunk)) reject("erasure_unavailable", 503);
        const part = chunk.subarray(0, Math.max(0, limit + 1 - size)); size += part.length; chunks.push(part);
        if (size > limit || part.length !== chunk.length) reject("erasure_unavailable", 503);
      }
      if (!accepted || size !== limit) reject("erasure_unavailable", 503);
      ciphertext = Buffer.concat(chunks, size);
    } finally { clearTimeout(deadline); stream.removeListener("response", response); stream.destroy(); }
    if (digest(ciphertext) !== metadata.metadata.cipherSha256) reject("erasure_unavailable", 503);
    let actual: FirebaseErasureIntent;
    try {
      const text = cipher.decrypt(new TextDecoder("utf-8", { fatal: true }).decode(ciphertext), expected.aad);
      if (Buffer.byteLength(text) > MAX_BYTES) reject("erasure_unavailable", 503);
      actual = parse(firebaseErasureIntentSchema, JSON.parse(text));
    } catch { reject("erasure_unavailable", 503); }
    if (nameFor(actual) !== expected.objectName || digest(canonical(actual)) !== metadata.metadata.intentSha256
      || (expectedIntent !== undefined && canonical(actual) !== canonical(expectedIntent))) reject("erasure_conflict", 409);
    return { intent: actual, descriptor: parse(firebaseErasureDescriptorSchema, { objectName: expected.objectName, generation: revision, cipherSha256: digest(ciphertext),
      intentSha256: digest(canonical(actual)), bytes: size, format: FORMAT + "/v1" }) };
  }
  const safe = (error: unknown): never => { if (error instanceof FirebaseErasureError) throw error; return reject("erasure_unavailable", 503); };
  return {
    async writeOnce(value: FirebaseErasureIntent): Promise<FirebaseErasureDescriptor> {
      const expected = binding(value); let ciphertext: Buffer;
      try { ciphertext = Buffer.from(cipher.encrypt(expected.body, expected.aad)); } catch { reject("erasure_unavailable", 503); }
      if (!ciphertext.length || ciphertext.length > MAX_BYTES) reject("erasure_unavailable", 503);
      try {
        try {
          const metadata = checked(await bucket.writeNew(expected.objectName, ciphertext, {
            resumable: false, validation: "crc32c", timeout: FIREBASE_PHOTO_TIMEOUT_MS, preconditionOpts: { ifGenerationMatch: 0 },
            metadata: { contentType: "application/octet-stream", cacheControl: "private, no-store",
              metadata: { format: FORMAT + "/v1", binding: expected.tag, cipherSha256: digest(ciphertext), intentSha256: expected.intentSha256 } },
          } satisfies SaveOptions), expected);
          if (Number(metadata.size) !== ciphertext.length || metadata.metadata.cipherSha256 !== digest(ciphertext)
            || metadata.metadata.intentSha256 !== expected.intentSha256) reject("erasure_unavailable", 503);
          return parse(firebaseErasureDescriptorSchema, { objectName: expected.objectName, generation: metadata.generation,
            cipherSha256: digest(ciphertext), intentSha256: expected.intentSha256, bytes: ciphertext.length, format: FORMAT + "/v1" });
        } catch { const latest = checked(await bucket.metadata(expected.objectName), expected); return (await readStored(expected, latest.generation, undefined, expected.intent)).descriptor; }
      } catch (error) { return safe(error); }
    },
    async readObject(objectName: string, revision: string): Promise<{ intent: FirebaseErasureIntent; descriptor: FirebaseErasureDescriptor }> {
      const expected = objectBinding(objectName), pinned = parse(generation, revision, true);
      try { return await readStored(expected, pinned); } catch (error) { return safe(error); }
    },
    async read(intent: FirebaseErasureIntent, value: FirebaseErasureDescriptor): Promise<FirebaseErasureIntent> {
      const expected = binding(intent), descriptor = parse(firebaseErasureDescriptorSchema, value, true);
      if (descriptor.objectName !== expected.objectName || descriptor.intentSha256 !== expected.intentSha256) reject("erasure_conflict", 409);
      try { return (await readStored(expected, descriptor.generation, descriptor, expected.intent)).intent; } catch (error) { return safe(error); }
    },
  };
}
export type FirebaseErasureJournal = ReturnType<typeof createFirebaseErasureJournal>;
