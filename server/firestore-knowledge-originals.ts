import { createHash } from "node:crypto";
import type { Firestore } from "@google-cloud/firestore";
import { Storage } from "@google-cloud/storage";
import { z } from "zod";
import { KNOWLEDGE_PDF_MAX_BYTES } from "./knowledge-pdf.ts";
import { createFirebasePhotoBucketPort, readFirebaseStorageResponse, type FirebasePhotoBucketPort } from "./firebase-photo-objects.ts";
import { readChatFileCiphertext } from "./firebase-chat-file-objects.ts";
import { largeFhsPdf, largestFhsOriginalBytes } from './platform-materials.ts';

const digest = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const source = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/u);
const sha = z.string().regex(/^[a-f0-9]{64}$/u);
const mime = z.enum(["application/pdf", "application/rss+xml"]);
const generation = z.string().regex(/^[1-9][0-9]{0,19}$/u);
const size = z.number().int().positive().max(largestFhsOriginalBytes);
function allowedSize(m: { size: number; contentHash: string; sourceId: string; mimeType: string }) {
  if (m.size <= KNOWLEDGE_PDF_MAX_BYTES) return true;
  const large = largeFhsPdf(m.sourceId);
  return m.mimeType === 'application/pdf' && large?.sourceId === m.sourceId && large.sha256 === m.contentHash && large.bytes === m.size;
}
export const knowledgeOriginalManifest = z.strictObject({
  schemaVersion: z.literal(1), projectId: z.string().min(1), namespace: z.string().min(1),
  sourceId: source, contentHash: sha, mimeType: mime, size, bucketName: z.string().min(1), generation,
}).refine(allowedSize);
export type KnowledgeOriginalManifest = z.infer<typeof knowledgeOriginalManifest>;
type Mime = z.infer<typeof mime>;
type Identity = Omit<KnowledgeOriginalManifest, "bucketName" | "generation">;
export type KnowledgeOriginalBucket = { bucketName: string; bucket: FirebasePhotoBucketPort };

export function cloudKnowledgeOriginalBucket(projectId: string, bucketName: string): KnowledgeOriginalBucket {
  const storage = new Storage({ projectId, retryOptions: { autoRetry: false }, timeout: 20000 });
  const bucket = storage.bucket(bucketName);
  return { bucketName, bucket: { ...createFirebasePhotoBucketPort(bucket, KNOWLEDGE_PDF_MAX_BYTES),
    readPinned: (name, revision) => readFirebaseStorageResponse(bucket, name, revision, largestFhsOriginalBytes) } };
}

export function knowledgeOriginalName(m: Identity) {
  return "knowledge-original/v1/" + digest(JSON.stringify([m.projectId, m.namespace, m.sourceId])) + "/" + m.contentHash;
}

function objectBinding(m: Identity) {
  return digest(JSON.stringify([m.projectId, m.namespace, m.sourceId, m.mimeType, m.contentHash, m.size]));
}

const objectMetadata = z.object({
  bucket: z.string(), name: z.string(), generation, size: z.union([size, z.string().regex(/^[1-9][0-9]{0,9}$/u)]),
  contentType: z.string(), contentEncoding: z.string().optional(), temporaryHold: z.boolean().optional(), metadata: z.record(z.string(), z.string()),
});

function checkedMetadata(target: KnowledgeOriginalBucket, name: string, m: Identity, raw: unknown, revision?: string, retainedUntil?: string) {
  const meta = objectMetadata.parse(raw);
  const tag = objectBinding(m);
  if (meta.bucket !== target.bucketName || meta.name !== name || meta.contentType !== m.mimeType || Number(meta.size) !== m.size
    || meta.metadata.binding !== tag || meta.metadata.sha256 !== m.contentHash
    || revision !== undefined && meta.generation !== revision || meta.contentEncoding && meta.contentEncoding !== "identity"
    || retainedUntil !== undefined && (meta.temporaryHold !== true || meta.metadata.retainedUntil !== retainedUntil))
    throw Error("knowledge_original_binding");
  return meta.generation;
}

export async function readKnowledgeOriginalObject(target: KnowledgeOriginalBucket, name: string, m: Identity,
  revision: string, retainedUntil?: string) {
  if (!allowedSize(m)) throw Error('knowledge_original_binding');
  checkedMetadata(target, name, m, await target.bucket.metadata(name, revision), revision, retainedUntil);
  return readChatFileCiphertext(target.bucket, name, revision, m.size, m.contentHash, largestFhsOriginalBytes);
}

export async function putKnowledgeOriginalObject(target: KnowledgeOriginalBucket, name: string, m: Identity,
  bytes: Buffer, retainedUntil?: string) {
  if (!allowedSize(m) || bytes.length !== m.size || digest(bytes) !== m.contentHash) throw Error("knowledge_original_hash_mismatch");
  const binding = objectBinding(m);
  let raw: unknown;
  try {
    raw = await target.bucket.writeNew(name, bytes, { resumable: false, validation: "crc32c",
      preconditionOpts: { ifGenerationMatch: 0 }, metadata: { contentType: m.mimeType, cacheControl: "private, no-store",
        ...(retainedUntil ? { temporaryHold: true } : {}), metadata: { binding, sha256: m.contentHash, ...(retainedUntil ? { retainedUntil } : {}) } } });
  } catch {
    // A concurrent create or lost acknowledgement is resolved against exactly this address.
    raw = await target.bucket.metadata(name);
    const existing = checkedMetadata(target, name, m, raw, undefined, retainedUntil);
    await readChatFileCiphertext(target.bucket, name, existing, m.size, m.contentHash, largestFhsOriginalBytes);
    return existing;
  }
  return checkedMetadata(target, name, m, raw, undefined, retainedUntil);
}

/** Immutable source objects in the existing private bucket. Only descriptors enter Firestore. */
export function createFirestoreKnowledgeOriginals({ database, projectId, namespace, originalBucket }: {
  database: Firestore; projectId: string; namespace: string; originalBucket?: KnowledgeOriginalBucket;
}) {
  const root = database.collection(namespace + "_knowledge_original_manifests");
  function reference(sourceId: string, contentHash: string) {
    return root.doc(source.parse(sourceId) + "-" + sha.parse(contentHash));
  }
  function target() {
    if (!originalBucket) throw Error("knowledge_original_bucket_unconfigured");
    return originalBucket;
  }
  function valid(raw: unknown, sourceId: string, contentHash: string, mimeType: Mime) {
    const m = knowledgeOriginalManifest.parse(raw);
    if (m.projectId !== projectId || m.namespace !== namespace || m.sourceId !== sourceId || m.contentHash !== contentHash
      || m.mimeType !== mimeType || m.bucketName !== target().bucketName) throw Error("knowledge_original_binding");
    return m;
  }
  async function find(sourceId: string, contentHash: string, mimeType: Mime) {
    const snapshot = await reference(sourceId, contentHash).get();
    if (!snapshot.exists) return null;
    const m = valid(snapshot.data(), sourceId, contentHash, mimeType);
    return readKnowledgeOriginalObject(target(), knowledgeOriginalName(m), m, m.generation);
  }
  async function read(sourceId: string, contentHash: string, mimeType: Mime) {
    const bytes = await find(sourceId, contentHash, mimeType);
    if (!bytes) throw Error("knowledge_original_missing");
    return bytes;
  }
  return {
    findPdf: (sourceId: string, hash: string) => find(sourceId, hash, "application/pdf"),
    readPdf: (sourceId: string, hash: string) => read(sourceId, hash, "application/pdf"),
    readFeed: (sourceId: string, hash: string) => read(sourceId, hash, "application/rss+xml"),
    async save(sourceId: string, mimeType: Mime, bytes: Buffer) {
      if (mimeType === "application/pdf" && bytes.subarray(0,5).toString("ascii") !== "%PDF-") throw Error("knowledge_original_media_invalid");
      const contentHash = digest(bytes), ref = reference(sourceId, contentHash);
      const identity: Identity = { schemaVersion: 1, projectId, namespace, sourceId, contentHash, mimeType: mime.parse(mimeType), size: size.parse(bytes.length) };
      const snapshot = await ref.get();
      if (snapshot.exists) {
        const existing = valid(snapshot.data(), sourceId, contentHash, mimeType);
        if (existing.size !== bytes.length) throw Error("knowledge_original_binding");
        return contentHash;
      }
      const bucket = target();
      const revision = await putKnowledgeOriginalObject(bucket, knowledgeOriginalName(identity), identity, bytes);
      const descriptor = { ...identity, bucketName: bucket.bucketName, generation: revision };
      await database.runTransaction(async tx => {
        const prior = await tx.get(ref);
        if (!prior.exists) tx.create(ref, descriptor);
        else if (valid(prior.data(), sourceId, contentHash, mimeType).generation !== revision) throw Error("knowledge_original_binding");
      });
      return contentHash;
    },
  };
}
