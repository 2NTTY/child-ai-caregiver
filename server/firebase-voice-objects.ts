import { createHash } from "node:crypto";
import { Storage } from "@google-cloud/storage";
import { z } from "zod";
import type { StorageCipher } from "./storage-crypto.ts";
import { workRecoveryScopeSchema, type WorkRecoveryScope } from "./firestore-work-continuation-recovery.ts";
import { createFirebasePhotoBucketPort, firebaseObjectStorageConfigSchema, type FirebasePhotoBucketPort, type FirebasePhotoObjectsConfig } from "./firebase-photo-objects.ts";
import { voiceFileMetadataSchema } from "../src/shared/voice.ts";
import { validateVoiceFile, decodeVoiceBase64 } from "./voice-files.ts";

export const VOICE_OBJECT_MAX_BYTES = 10 * 1024 * 1024;
const hash = z.string().regex(/^[a-f0-9]{64}$/u), format = "yuyoufang-voice-object/v1";
const generation = z.string().regex(/^[1-9][0-9]{0,19}$/u).refine(v => BigInt(v) <= 18446744073709551615n);
export const voiceObjectDescriptorSchema = voiceFileMetadataSchema.extend({
  objectName: z.string().regex(/^voice\/v1\/[a-f0-9]{64}\/[0-9a-f-]{36}$/u), generation, cipherSha256: hash,
}).strict();
export type VoiceObjectDescriptor = z.infer<typeof voiceObjectDescriptorSchema>;
export class VoiceObjectError extends Error {
  readonly code = "voice_object_unavailable";
  constructor() { super("Voice object unavailable"); this.name = "VoiceObjectError"; }
}
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const storedBodySchema = z.object({ metadata: voiceFileMetadataSchema, base64: z.string().max(7 * 1024 * 1024) }).strict();
const metadataSchema = z.object({ name: z.string(), bucket: z.string(), generation,
  size: z.union([z.string().regex(/^[1-9][0-9]{0,19}$/u), z.number().int().min(1)]).refine(v => Number(v) <= VOICE_OBJECT_MAX_BYTES),
  contentEncoding: z.string().optional(), metadata: z.object({ format: z.literal(format), binding: hash, cipherSha256: hash, sha256: hash }).strict(),
});
export function voiceObjectAddress(config: FirebasePhotoObjectsConfig, scopeInput: WorkRecoveryScope, idInput: string) {
  const scope = workRecoveryScopeSchema.parse(scopeInput), id = z.uuid().parse(idInput);
  const identity = JSON.stringify([format, config.projectId, config.namespace, config.bucketName,
    scope.ownerUserId, scope.workspaceId, scope.childId, scope.storageEpoch, id]);
  const scopeHash = digest(JSON.stringify([format, config.projectId, config.namespace, config.bucketName,
    scope.ownerUserId, scope.workspaceId, scope.childId, scope.storageEpoch]));
  return { objectName: "voice/v1/" + scopeHash + "/" + id, aad: identity, tag: digest(identity) };
}
/** Bounded encrypted media read shared by original voice objects and their pinned backup artifacts. */
export async function readVoiceCiphertext(bucket: Pick<FirebasePhotoBucketPort,'readPinned'>,objectName:string,revision:string,maximum:number,sha256:string) {
  if (!Number.isSafeInteger(maximum)||maximum<1||maximum>VOICE_OBJECT_MAX_BYTES) throw new VoiceObjectError();
  const stream=bucket.readPinned(objectName,revision),chunks:Buffer[]=[];let size=0,accepted=false;
  stream.once('response',(response:{statusCode?:number;headers?:Record<string,string>})=>{
    const h=response.headers??{},length=h['content-length'];
    if (![200,206].includes(response.statusCode??0)||h['content-encoding']!==undefined&&h['content-encoding']!=='identity'
      ||h['x-goog-generation']!==undefined&&h['x-goog-generation']!==revision
      ||length!==undefined&&(!/^[0-9]+$/u.test(length)||BigInt(length)>BigInt(maximum)))stream.destroy(new VoiceObjectError());else accepted=true;
  });
  const timer=setTimeout(()=>stream.destroy(new VoiceObjectError()),15000);
  try {for await(const part of stream){if(!accepted||!Buffer.isBuffer(part)||size+part.length>maximum)throw new VoiceObjectError();size+=part.length;chunks.push(part);}
    const bytes=Buffer.concat(chunks,size);if(!accepted||size!==maximum||digest(bytes)!==sha256)throw new VoiceObjectError();return bytes;
  }finally{clearTimeout(timer);stream.destroy();}
}
/** Object integrity only. Caller must establish current Firestore authority before and after I/O. */
export function createVoiceObjects(options: { config: FirebasePhotoObjectsConfig; cipher: StorageCipher; bucket: FirebasePhotoBucketPort }) {
  const config = firebaseObjectStorageConfigSchema.parse(options.config), { cipher, bucket } = options;
  type Address = ReturnType<typeof voiceObjectAddress>;
  function metadata(raw: unknown, address: Address, pinned?: string) {
    const value = metadataSchema.parse(raw);
    if (value.name !== address.objectName || value.bucket !== config.bucketName || value.metadata.binding !== address.tag
      || pinned !== undefined && value.generation !== pinned || value.contentEncoding !== undefined && value.contentEncoding !== "identity") throw new VoiceObjectError();
    return value;
  }
  async function read(address: Address, raw: unknown, expected?: VoiceObjectDescriptor) {
    const meta = metadata(raw, address, expected?.generation), maximum = Number(meta.size);
    const bytes = await readVoiceCiphertext(bucket,address.objectName,meta.generation,maximum,meta.metadata.cipherSha256);
      const body = storedBodySchema.parse(JSON.parse(cipher.decrypt(new TextDecoder("utf-8", { fatal: true }).decode(bytes), address.aad)));
      const buffer = decodeVoiceBase64(body.base64);
      if (body.metadata.bytes !== buffer.length || body.metadata.sha256 !== digest(buffer) || body.metadata.sha256 !== meta.metadata.sha256) throw new VoiceObjectError();
      const descriptor = voiceObjectDescriptorSchema.parse({ ...body.metadata, objectName: address.objectName,
        generation: meta.generation, cipherSha256: meta.metadata.cipherSha256 });
      if (expected && Object.keys(descriptor).some(key => descriptor[key as keyof typeof descriptor] !== expected[key as keyof typeof expected])) throw new VoiceObjectError();
      return { descriptor, base64: body.base64, buffer };
  }
  async function inspect(scope: WorkRecoveryScope, id: string) {
    const address = voiceObjectAddress(config, scope, id);
    let raw: unknown;
    try { raw = await bucket.metadata(address.objectName); }
    catch (e) { if (e && typeof e === "object" && "code" in e && e.code === 404) return null; throw new VoiceObjectError(); }
    try { return await read(address, raw); } catch { throw new VoiceObjectError(); }
  }
  return {
    address(scope: WorkRecoveryScope, id: string) { return voiceObjectAddress(config, scope, id).objectName; },
    async write(scope: WorkRecoveryScope, id: string, base64: string, mimeType: string, signal?: AbortSignal) {
      const validated = await validateVoiceFile(base64, mimeType, signal), address = voiceObjectAddress(config, scope, id);
      const ciphertext = Buffer.from(cipher.encrypt(JSON.stringify({ metadata: validated.metadata, base64 }), address.aad), "utf8");
      if (ciphertext.length > VOICE_OBJECT_MAX_BYTES || signal?.aborted) throw new VoiceObjectError();
      const cipherSha256 = digest(ciphertext);
      try {
        const meta = metadata(await bucket.writeNew(address.objectName, ciphertext, { resumable: false, validation: "crc32c", timeout: 15_000,
          preconditionOpts: { ifGenerationMatch: 0 }, metadata: { contentType: "application/octet-stream", cacheControl: "private, no-store",
            metadata: { format, binding: address.tag, cipherSha256, sha256: validated.metadata.sha256 } } }), address);
        if (Number(meta.size) !== ciphertext.length || meta.metadata.cipherSha256 !== cipherSha256 || meta.metadata.sha256 !== validated.metadata.sha256) throw new VoiceObjectError();
        return voiceObjectDescriptorSchema.parse({ ...validated.metadata, objectName: address.objectName, generation: meta.generation, cipherSha256 });
      } catch {
        // An uncertain write may only look up the original immutable address, never resend it.
        const existing = await inspect(scope, id);
        if (!existing || !existing.buffer.equals(validated.buffer) || existing.descriptor.mimeType !== validated.metadata.mimeType) throw new VoiceObjectError();
        return existing.descriptor;
      }
    },
    async inspect(scope: WorkRecoveryScope, id: string) { return (await inspect(scope, id))?.descriptor ?? null; },
    async read(scope: WorkRecoveryScope, id: string, descriptor: VoiceObjectDescriptor) {
      const checked = voiceObjectDescriptorSchema.parse(descriptor), address = voiceObjectAddress(config, scope, id);
      if (address.objectName !== checked.objectName) throw new VoiceObjectError();
      try { return await read(address, await bucket.metadata(address.objectName, checked.generation), checked); }
      catch { throw new VoiceObjectError(); }
    },
    async remove(scope: WorkRecoveryScope, id: string, descriptor: VoiceObjectDescriptor) {
      const checked = voiceObjectDescriptorSchema.parse(descriptor), address = voiceObjectAddress(config, scope, id);
      if (address.objectName !== checked.objectName || !bucket.removePinned) throw new VoiceObjectError();
      try {
        const meta = metadata(await bucket.metadata(address.objectName, checked.generation), address, checked.generation);
        if (meta.metadata.cipherSha256 !== checked.cipherSha256 || meta.metadata.sha256 !== checked.sha256) throw new VoiceObjectError();
        await bucket.removePinned(address.objectName, checked.generation);
      } catch (e) { if (!(e && typeof e === "object" && "code" in e && e.code === 404)) throw new VoiceObjectError(); }
    },
  };
}
export type VoiceObjects = ReturnType<typeof createVoiceObjects>;
export function createCloudStorageVoiceObjects(options: { config: FirebasePhotoObjectsConfig; cipher: StorageCipher }) {
  if (process.env.STORAGE_EMULATOR_HOST !== undefined || process.env.FIREBASE_STORAGE_EMULATOR_HOST !== undefined) throw new VoiceObjectError();
  const config = firebaseObjectStorageConfigSchema.parse(options.config);
  const storage = new Storage({ projectId: config.projectId, retryOptions: { autoRetry: false }, timeout: 15_000 });
  return createVoiceObjects({ ...options, config, bucket: createFirebasePhotoBucketPort(storage.bucket(config.bucketName), VOICE_OBJECT_MAX_BYTES) });
}
