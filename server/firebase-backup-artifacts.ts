import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import { Storage, type Bucket, type SaveOptions } from "@google-cloud/storage";
import { z } from "zod";
import { PHOTO_LIMITS } from "../src/shared/photos.ts";
import type { StorageCipher } from "./storage-crypto.ts";
import { canonical } from "./firestore-session-codec.ts";
import type { FirebaseBackupInventory } from "./firestore-backup.ts";
import { workRecoveryScopeSchema, type WorkRecoveryScope } from "./firestore-work-continuation-recovery.ts";
import { FIREBASE_PHOTO_TIMEOUT_MS, firebasePhotoObjectDescriptorSchema, type FirebasePhotoObjectDescriptor } from "./firebase-photo-objects.ts";
import { backupPhotoDescriptorSchema, FIREBASE_PHOTO_BACKUP_MIN_RETENTION_MS, FIREBASE_PHOTO_BACKUP_MAX_RETENTION_MS,
  type BackupPhotoDescriptor } from "./firebase-photo-recovery.ts";

const FORMAT = "yuban-firebase-backup-manifest", VERSION = 1;
export const FIREBASE_NATIVE_EXPORT_MAX_OBJECTS = 256;
export const FIREBASE_NATIVE_EXPORT_MAX_BYTES = 256 * 1024 * 1024;
export const FIREBASE_BACKUP_MANIFEST_MAX_BYTES = 32 * 1024 * 1024;
export const FIREBASE_BACKUP_MANIFEST_MAX_CIPHER_BYTES = 4 + Math.ceil((FIREBASE_BACKUP_MANIFEST_MAX_BYTES + 32) / 3) * 4;
const PAGE_SIZE = 64, MAX_DOCUMENTS = 2000;
const uuid = z.uuid().refine(value => value === value.toLowerCase()), hash = z.string().regex(/^[a-f0-9]{64}$/u);
const generation = firebasePhotoObjectDescriptorSchema.shape.generation;
const at = z.iso.datetime({ offset: true });
const databaseId = z.string().regex(/^[a-z][a-z0-9-]{2,61}[a-z0-9]$/u);
const projectId = z.string().regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u), namespace = z.string().regex(/^[a-z][a-z0-9_]{0,47}$/u);
const objectName = z.string().min(1).max(1024).refine(value => value.isWellFormed() && Buffer.byteLength(value) <= 1024
  && !/[\u0000-\u001f\u007f\\?#%]/u.test(value) && value.split("/").every(part => part !== "" && part !== "." && part !== ".."));
const path = z.string().min(3).max(6144).refine(value => value.isWellFormed() && Buffer.byteLength(value) <= 6144
  && !/[\u0000-\u001f\u007f\\]/u.test(value) && value.split("/").length % 2 === 0
  && value.split("/").every(part => part !== "" && part !== "." && part !== ".."));
const crc32c = z.string().regex(/^[A-Za-z0-9+/]{6}==$/u)
  .refine(value => Buffer.from(value,"base64").length === 4 && Buffer.from(value,"base64").toString("base64") === value);
const size = z.union([z.string().regex(/^(0|[1-9][0-9]{0,19})$/u),z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)])
  .refine(value => BigInt(value) <= BigInt(FIREBASE_NATIVE_EXPORT_MAX_BYTES));
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export const firebaseBackupArtifactsConfigSchema = z.object({
  projectId, namespace, bucketName: z.string().min(3).max(222).regex(/^[a-z0-9][a-z0-9._-]*[a-z0-9]$/u),
}).strict();
export type FirebaseBackupArtifactsConfig = z.infer<typeof firebaseBackupArtifactsConfigSchema>;
export const firebaseNativeExportObjectSchema = z.object({
  name: objectName, generation, size: z.number().int().nonnegative().max(FIREBASE_NATIVE_EXPORT_MAX_BYTES), crc32c,
}).strict();
export type FirebaseNativeExportObject = z.infer<typeof firebaseNativeExportObjectSchema>;
const nativeObjectsSchema = z.array(firebaseNativeExportObjectSchema).min(1).max(FIREBASE_NATIVE_EXPORT_MAX_OBJECTS);
export const firebaseBackupInventorySchema: z.ZodType<FirebaseBackupInventory> = z.object({
  schema: z.literal("yuban-firestore-backup-inventory/v1"), projectId, databaseId, namespace,
  snapshotTime: z.iso.datetime({ precision: 3 }),
  documents: z.array(z.object({ path, sha256: hash }).strict()).min(1).max(MAX_DOCUMENTS),
  documentCount: z.number().int().min(1).max(MAX_DOCUMENTS), bytes: z.number().int().min(1).max(FIREBASE_BACKUP_MANIFEST_MAX_BYTES), sha256: hash,
}).strict();
export interface FirebaseBackupPhotoManifestEntry {
  path: string; photoId: string; scope: WorkRecoveryScope; descriptor: FirebasePhotoObjectDescriptor; backup: BackupPhotoDescriptor;
}
const photoSchema: z.ZodType<FirebaseBackupPhotoManifestEntry> = z.object({
  path, photoId: uuid, scope: workRecoveryScopeSchema, descriptor: firebasePhotoObjectDescriptorSchema, backup: backupPhotoDescriptorSchema,
}).strict();
export const firebaseBackupManifestPayloadSchema = z.object({
  format: z.literal("yuban-firebase-backup-manifest/v1"), backupId: uuid, databaseId,
  snapshotTime: z.iso.datetime({ precision: 3 }), controlGeneration: uuid, sourceCommit: z.string().regex(/^[a-f0-9]{40}$/u),
  keyVersionRef: z.string().max(1024).regex(/^projects\/[a-zA-Z0-9-]{1,64}\/secrets\/[a-zA-Z0-9_-]{1,255}\/versions\/[1-9][0-9]{0,19}$/u),
  retainedUntil: at, nativeExport: z.object({ outputUriPrefix: z.string().min(1).max(1500), objects: nativeObjectsSchema }).strict(),
  inventory: firebaseBackupInventorySchema, photos: z.array(photoSchema).max(PHOTO_LIMITS.totalCount),
}).strict();
export type FirebaseBackupManifestPayload = z.infer<typeof firebaseBackupManifestPayloadSchema>;
export const firebaseBackupManifestDescriptorSchema = z.object({
  format: z.literal("yuban-firebase-backup-manifest/v1"),
  objectName: z.string().regex(/^firebase-backups\/v1\/[a-f0-9-]{36}\/manifest$/u),
  generation, cipherSha256: hash, bytes: z.number().int().positive().max(FIREBASE_BACKUP_MANIFEST_MAX_CIPHER_BYTES), retainedUntil: at,
}).strict();
export type FirebaseBackupManifestDescriptor = z.infer<typeof firebaseBackupManifestDescriptorSchema>;
export interface FirebaseBackupArtifactBucketPort {
  list(prefix: string, pageToken?: string): Promise<{ objects: unknown[]; nextPageToken?: string }>;
  metadata(objectName: string, generation?: string): Promise<unknown>;
  hold(objectName: string, generation: string, metageneration: string): Promise<unknown>;
  writeNew(objectName: string, ciphertext: Buffer, options: SaveOptions): Promise<unknown>;
  readPinned(objectName: string, generation: string): Readable;
}
export interface FirebaseBackupArtifactsOptions {
  config: FirebaseBackupArtifactsConfig; cipher: StorageCipher; bucket: FirebaseBackupArtifactBucketPort; serverClock?: () => number;
}
export interface FirebaseBackupArtifacts {
  holdNativeExport(input: { backupId: string; outputUriPrefix: string }): Promise<FirebaseNativeExportObject[]>;
  assertNativeExportObjects(input: { backupId: string; objects: FirebaseNativeExportObject[] }): Promise<void>;
  writeManifest(payload: FirebaseBackupManifestPayload): Promise<FirebaseBackupManifestDescriptor>;
  readManifest(input: { backupId: string; descriptor: FirebaseBackupManifestDescriptor }): Promise<FirebaseBackupManifestPayload>;
}
type ErrorCode = "backup_artifact_invalid" | "backup_artifact_conflict" | "backup_artifact_integrity"
  | "backup_artifact_expired" | "backup_artifact_limit" | "backup_artifact_unavailable";
export class FirebaseBackupArtifactError extends Error {
  readonly code: ErrorCode; readonly status: 400 | 409 | 413 | 503;
  constructor(code: ErrorCode, status: FirebaseBackupArtifactError["status"]) {
    super(code); this.name = "FirebaseBackupArtifactError"; this.code = code; this.status = status;
  }
}
function fail(code: ErrorCode, status: FirebaseBackupArtifactError["status"]): never { throw new FirebaseBackupArtifactError(code,status); }
function parse<T>(schema: z.ZodType<T>, value: unknown, input = false): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) fail(input ? "backup_artifact_invalid" : "backup_artifact_integrity", input ? 400 : 503);
  return parsed.data;
}
const nativeMetadataSchema = z.object({
  name: objectName, bucket: z.string(), generation, metageneration: generation, size, crc32c, temporaryHold: z.boolean().optional(),
});
type NativeMetadata = z.infer<typeof nativeMetadataSchema>;
const manifestMetadataSchema = z.object({
  name: z.string(), bucket: z.string(), generation,
  size: z.union([z.string().regex(/^[1-9][0-9]{0,19}$/u),z.number().int().positive().max(Number.MAX_SAFE_INTEGER)])
    .refine(value => BigInt(value) <= BigInt(FIREBASE_BACKUP_MANIFEST_MAX_CIPHER_BYTES)),
  temporaryHold: z.literal(true), contentEncoding: z.string().optional(),
  metadata: z.object({ format: z.literal("yuban-firebase-backup-manifest/v1"), binding: hash,
    cipherSha256: hash, payloadSha256: hash, retainedUntil: at }).strict(),
});
type ManifestMetadata = z.infer<typeof manifestMetadataSchema>;

/** Only public SDK methods are used; revisions are never converted to Number. */
export function createFirebaseBackupArtifactBucketPort(bucket: Bucket): FirebaseBackupArtifactBucketPort {
  async function request(file: ReturnType<Bucket["file"]>, options: Parameters<typeof file.request>[0]) {
    const [body,response] = await file.request(options);
    if (!response || response.statusCode !== 200) fail("backup_artifact_unavailable",503);
    return body;
  }
  return {
    async list(prefix,pageToken) {
      const [body,response] = await bucket.request({ method:"GET",uri:"/o",timeout:FIREBASE_PHOTO_TIMEOUT_MS,
        qs:{ prefix,maxResults:PAGE_SIZE,...(pageToken === undefined ? {} : {pageToken}),
          fields:"items(name,bucket,generation,metageneration,size,crc32c,temporaryHold),nextPageToken" },
        headers:{"Cache-Control":"no-store"} });
      if (!response || response.statusCode !== 200) fail("backup_artifact_unavailable",503);
      const page = parse(z.object({items:z.array(z.unknown()).optional(),nextPageToken:z.string().min(1).max(4096).optional()}),body);
      return {objects:page.items ?? [],...(page.nextPageToken === undefined ? {} : {nextPageToken:page.nextPageToken})};
    },
    metadata(name,revision) {
      return request(bucket.file(name),{method:"GET",uri:"",timeout:FIREBASE_PHOTO_TIMEOUT_MS,
        qs:revision === undefined ? {} : {generation:revision},headers:{"Cache-Control":"no-store"}});
    },
    hold(name,revision,metageneration) {
      // Target the live object with both conditions; native import cannot select a historical revision.
      return request(bucket.file(name),{method:"PATCH",uri:"",timeout:FIREBASE_PHOTO_TIMEOUT_MS,
        qs:{ifGenerationMatch:revision,ifMetagenerationMatch:metageneration},json:{temporaryHold:true}});
    },
    async writeNew(name,ciphertext,options) {
      const file = bucket.file(name); await file.save(ciphertext,options); return file.metadata;
    },
    readPinned(name,revision) {
      return bucket.file(name).requestStream({method:"GET",uri:"",qs:{alt:"media",generation:revision},gzip:false,
        timeout:FIREBASE_PHOTO_TIMEOUT_MS,headers:{Range:"bytes=0-"+FIREBASE_BACKUP_MANIFEST_MAX_CIPHER_BYTES,
          "Accept-Encoding":"identity","Cache-Control":"no-store"}});
    },
  };
}

/** Explicit operator assembly; discovery imports neither open Storage nor create network requests. */
export function createCloudStorageBackupArtifacts(options: {
  config: FirebaseBackupArtifactsConfig; cipher: StorageCipher; serverClock?: () => number;
}): FirebaseBackupArtifacts {
  const config = parse(firebaseBackupArtifactsConfigSchema,options.config,true);
  if (Object.keys(options).some(key => key !== "config" && key !== "cipher" && key !== "serverClock")
    || process.env.STORAGE_EMULATOR_HOST !== undefined || process.env.FIREBASE_STORAGE_EMULATOR_HOST !== undefined)
    fail("backup_artifact_unavailable",503);
  const storage = new Storage({projectId:config.projectId,retryOptions:{autoRetry:false},timeout:FIREBASE_PHOTO_TIMEOUT_MS});
  return createFirebaseBackupArtifacts({...options,config,bucket:createFirebaseBackupArtifactBucketPort(storage.bucket(config.bucketName))});
}

/** This port pairs immutable artifacts. It does not authorize native export/import or declare a restore complete. */
export function createFirebaseBackupArtifacts(options: FirebaseBackupArtifactsOptions): FirebaseBackupArtifacts {
  const config = parse(firebaseBackupArtifactsConfigSchema,options.config,true), {cipher,bucket} = options;
  if (typeof cipher?.encrypt !== "function" || typeof cipher?.decrypt !== "function"
    || ["list","metadata","hold","writeNew","readPinned"].some(key => typeof bucket?.[key as keyof FirebaseBackupArtifactBucketPort] !== "function")
    || options.serverClock !== undefined && typeof options.serverClock !== "function") fail("backup_artifact_unavailable",503);
  const serverClock = options.serverClock ?? Date.now;
  const now = () => { const value = serverClock(); if (!Number.isSafeInteger(value) || value < 0) fail("backup_artifact_unavailable",503); return value; };
  const base = (id: string) => "firebase-backups/v1/"+id;
  const nativePrefix = (id: string) => base(id)+"/firestore/";
  const nameFor = (id: string) => base(id)+"/manifest";
  function outputPrefix(id: string,value: string) {
    const root = "gs://"+config.bucketName+"/"+nativePrefix(id).slice(0,-1);
    if (value !== root && !value.startsWith(root+"/")) fail("backup_artifact_conflict",409);
    const relative = value.slice(("gs://"+config.bucketName+"/").length);
    parse(objectName,relative,true);
    return relative+"/";
  }
  function nativeMetadata(value: unknown,prefix: string): NativeMetadata {
    const result = parse(nativeMetadataSchema,value);
    if (result.bucket !== config.bucketName || !result.name.startsWith(prefix)) fail("backup_artifact_integrity",503);
    return result;
  }
  const describe = (value: NativeMetadata): FirebaseNativeExportObject => ({
    name:value.name,generation:value.generation,size:Number(value.size),crc32c:value.crc32c,
  });
  function checkedObjects(id: string,values: FirebaseNativeExportObject[],input = false) {
    const objects = parse(nativeObjectsSchema,values,input), names = new Set<string>(); let bytes = 0;
    for (const object of objects) {
      if (!object.name.startsWith(nativePrefix(id)) || names.has(object.name)) fail("backup_artifact_conflict",409);
      names.add(object.name); bytes += object.size;
    }
    if (bytes < 1 || bytes > FIREBASE_NATIVE_EXPORT_MAX_BYTES) fail("backup_artifact_limit",413);
    return [...objects].sort((a,b) => a.name.localeCompare(b.name));
  }
  async function listNative(id: string): Promise<NativeMetadata[]> {
    const prefix = nativePrefix(id), objects:NativeMetadata[] = [], tokens = new Set<string>(), names = new Set<string>();
    let token:string|undefined,bytes=0;
    for (let pageNumber=0;pageNumber<FIREBASE_NATIVE_EXPORT_MAX_OBJECTS;pageNumber++) {
      const raw = await bucket.list(prefix,token);
      const page = parse(z.object({objects:z.array(z.unknown()),nextPageToken:z.string().min(1).max(4096).optional()}).strict(),raw);
      if (page.objects.length > PAGE_SIZE) fail("backup_artifact_limit",413);
      for (const rawObject of page.objects) {
        const object = nativeMetadata(rawObject,prefix);
        if (names.has(object.name)) fail("backup_artifact_integrity",503);
        names.add(object.name); objects.push(object); bytes += Number(object.size);
        if (objects.length > FIREBASE_NATIVE_EXPORT_MAX_OBJECTS || bytes > FIREBASE_NATIVE_EXPORT_MAX_BYTES) fail("backup_artifact_limit",413);
      }
      if (page.nextPageToken === undefined) {
        if (!objects.length || bytes < 1) fail("backup_artifact_integrity",503);
        return objects.sort((a,b) => a.name.localeCompare(b.name));
      }
      if (!page.objects.length || tokens.has(page.nextPageToken)) fail("backup_artifact_integrity",503);
      tokens.add(page.nextPageToken); token=page.nextPageToken;
    }
    fail("backup_artifact_limit",413);
  }
  async function assertObjects(id: string,expectedInput: FirebaseNativeExportObject[]) {
    const expected = checkedObjects(id,expectedInput), current = await listNative(id);
    if (current.some(object => object.temporaryHold !== true)
      || canonical(current.map(describe)) !== canonical(expected)) fail("backup_artifact_conflict",409);
  }
  function manifestBinding(id: string) {
    const objectName = nameFor(id),aad=canonical([FORMAT,VERSION,config.projectId,config.namespace,config.bucketName,objectName]);
    return {objectName,aad,tag:digest(aad)};
  }
  function validatePayload(value: unknown,input=false): FirebaseBackupManifestPayload {
    const payload = parse(firebaseBackupManifestPayloadSchema,value,input), inventory=payload.inventory;
    if (inventory.projectId !== config.projectId || inventory.namespace !== config.namespace || inventory.databaseId !== payload.databaseId
      || inventory.snapshotTime !== payload.snapshotTime || Date.parse(payload.snapshotTime)%60_000 !== 0
      || Date.parse(payload.snapshotTime)>now() || inventory.documentCount !== inventory.documents.length
      || digest(canonical(inventory.documents)) !== inventory.sha256) fail("backup_artifact_integrity",503);
    const paths = inventory.documents.map(row => row.path), sorted=[...paths].sort((a,b)=>a.localeCompare(b));
    if (new Set(paths).size !== paths.length || canonical(paths)!==canonical(sorted)
      || paths.some(value => value.split("/")[0]!==config.namespace && !value.split("/")[0].startsWith(config.namespace+"_")))
      fail("backup_artifact_integrity",503);
    const prefix=outputPrefix(payload.backupId,payload.nativeExport.outputUriPrefix);
    const native = checkedObjects(payload.backupId,payload.nativeExport.objects,input);
    if (native.some(object => !object.name.startsWith(prefix))) fail("backup_artifact_conflict",409);
    let bytes=0;const photoIds = new Set<string>(), photoPaths = new Set<string>();
    for (const photo of payload.photos) {
      const fullScope={ownerUserId:photo.scope.ownerUserId,workspaceId:photo.scope.workspaceId,childId:photo.scope.childId,storageEpoch:photo.scope.storageEpoch};
      const expectedOriginal="photos/v1/"+digest(JSON.stringify(["yuban-photo-object",1,config.projectId,config.namespace,fullScope]))+"/"+photo.photoId;
      const expectedPath=config.namespace+"_photos/"+digest(canonical(["photo",photo.photoId]));
      if (photoIds.has(photo.photoId) || photoPaths.has(photo.path) || photo.path!==expectedPath || !paths.includes(photo.path)
        || photo.descriptor.objectName!==expectedOriginal
        || photo.backup.objectName!==base(payload.backupId)+"/photos/"+photo.photoId
        || photo.backup.retainedUntil!==payload.retainedUntil) fail("backup_artifact_integrity",503);
      photoIds.add(photo.photoId);photoPaths.add(photo.path);bytes+=photo.descriptor.bytes;
      if (bytes>PHOTO_LIMITS.totalBytes) fail("backup_artifact_limit",413);
    }
    return payload;
  }
  function retained(until: string,creation=false) {
    const end=Date.parse(until),at=now();
    if (creation && (end<at+FIREBASE_PHOTO_BACKUP_MIN_RETENTION_MS || end>at+FIREBASE_PHOTO_BACKUP_MAX_RETENTION_MS))
      fail("backup_artifact_invalid",400);
    if (end<=at) fail("backup_artifact_expired",409);
    if (end>at+FIREBASE_PHOTO_BACKUP_MAX_RETENTION_MS) fail("backup_artifact_integrity",503);
  }
  function manifestMetadata(raw:unknown,expected:ReturnType<typeof manifestBinding>,revision?:string):ManifestMetadata {
    const metadata=parse(manifestMetadataSchema,raw);
    if (metadata.name!==expected.objectName || metadata.bucket!==config.bucketName || metadata.metadata.binding!==expected.tag
      || revision!==undefined && metadata.generation!==revision
      || metadata.contentEncoding!==undefined && metadata.contentEncoding!=="identity") fail("backup_artifact_integrity",503);
    retained(metadata.metadata.retainedUntil);
    return metadata;
  }
  async function boundedMedia(expected:ReturnType<typeof manifestBinding>,metadata:ManifestMetadata):Promise<Buffer> {
    const stream=bucket.readPinned(expected.objectName,metadata.generation),limit=Number(metadata.size),chunks:Buffer[]=[];
    let size=0,accepted=false;
    const response=(value:unknown)=>{
      if (!value || typeof value!=="object" || !("statusCode" in value) || value.statusCode!==200 && value.statusCode!==206) {
        stream.destroy(new FirebaseBackupArtifactError("backup_artifact_unavailable",503));return;
      }
      const headers="headers" in value && value.headers && typeof value.headers==="object" ? value.headers as Record<string,unknown> : {};
      const length=headers["content-length"],encoding=headers["content-encoding"],revision=headers["x-goog-generation"];
      if (encoding!==undefined && encoding!=="identity" || revision!==undefined && revision!==metadata.generation
        || length!==undefined && (typeof length!=="string" || !/^[0-9]+$/u.test(length) || BigInt(length)>BigInt(limit))) {
        stream.destroy(new FirebaseBackupArtifactError("backup_artifact_integrity",503));return;
      }
      accepted=true;
    };
    stream.once("response",response);
    const deadline=setTimeout(()=>stream.destroy(new FirebaseBackupArtifactError("backup_artifact_unavailable",503)),FIREBASE_PHOTO_TIMEOUT_MS);
    try {
      for await (const chunk of stream) {
        if (!accepted || !Buffer.isBuffer(chunk)) fail("backup_artifact_integrity",503);
        const part=chunk.subarray(0,Math.max(0,limit+1-size));size+=part.length;chunks.push(part);
        if (size>limit || part.length!==chunk.length) fail("backup_artifact_integrity",503);
      }
      if (!accepted || size!==limit) fail("backup_artifact_integrity",503);
      return Buffer.concat(chunks,size);
    } finally {clearTimeout(deadline);stream.removeListener("response",response);stream.destroy();}
  }
  async function readStored(id:string,revision:string,descriptor?:FirebaseBackupManifestDescriptor) {
    const expected=manifestBinding(id),metadata=manifestMetadata(await bucket.metadata(expected.objectName,revision),expected,revision);
    if (descriptor && (descriptor.bytes!==Number(metadata.size) || descriptor.cipherSha256!==metadata.metadata.cipherSha256
      || descriptor.retainedUntil!==metadata.metadata.retainedUntil)) fail("backup_artifact_integrity",503);
    const ciphertext=await boundedMedia(expected,metadata);
    if (digest(ciphertext)!==metadata.metadata.cipherSha256) fail("backup_artifact_integrity",503);
    let payload:FirebaseBackupManifestPayload;
    try {
      const text=cipher.decrypt(new TextDecoder("utf-8",{fatal:true}).decode(ciphertext),expected.aad);
      if (Buffer.byteLength(text)>FIREBASE_BACKUP_MANIFEST_MAX_BYTES) fail("backup_artifact_limit",413);
      payload=validatePayload(JSON.parse(text));
    } catch(error) {if(error instanceof FirebaseBackupArtifactError)throw error;fail("backup_artifact_integrity",503);}
    if (payload.backupId!==id || payload.retainedUntil!==metadata.metadata.retainedUntil
      || digest(canonical(payload))!==metadata.metadata.payloadSha256) fail("backup_artifact_integrity",503);
    const result=parse(firebaseBackupManifestDescriptorSchema,{format:FORMAT+"/v1",objectName:expected.objectName,generation:revision,
      cipherSha256:digest(ciphertext),bytes:ciphertext.length,retainedUntil:payload.retainedUntil});
    return {payload,descriptor:result};
  }
  async function safe<T>(action:()=>Promise<T>):Promise<T> {
    try {return await action();} catch(error) {
      if (error instanceof FirebaseBackupArtifactError) throw error;
      fail("backup_artifact_unavailable",503);
    }
  }
  return {
    async holdNativeExport(value) {
      const input=parse(z.object({backupId:uuid,outputUriPrefix:z.string().min(1).max(1500)}).strict(),value,true);
      const prefix=outputPrefix(input.backupId,input.outputUriPrefix);
      return safe(async()=>{
        const listed=await listNative(input.backupId);
        if (listed.some(object=>!object.name.startsWith(prefix))) fail("backup_artifact_conflict",409);
        for (const object of listed) {
          const current=nativeMetadata(await bucket.metadata(object.name),nativePrefix(input.backupId));
          if (current.name!==object.name || canonical(describe(current))!==canonical(describe(object))
            || current.metageneration!==object.metageneration) fail("backup_artifact_conflict",409);
          if (current.temporaryHold===true) continue;
          let held:NativeMetadata;
          try {held=nativeMetadata(await bucket.hold(object.name,object.generation,object.metageneration),nativePrefix(input.backupId));}
          catch {held=nativeMetadata(await bucket.metadata(object.name),nativePrefix(input.backupId));}
          if (held.temporaryHold!==true || canonical(describe(held))!==canonical(describe(object))) fail("backup_artifact_conflict",409);
        }
        const result=listed.map(describe);await assertObjects(input.backupId,result);return result;
      });
    },
    async assertNativeExportObjects(value) {
      const input=parse(z.object({backupId:uuid,objects:nativeObjectsSchema}).strict(),value,true);
      return safe(()=>assertObjects(input.backupId,input.objects));
    },
    async writeManifest(value) {
      const payload=validatePayload(value,true);retained(payload.retainedUntil,true);
      const expected=manifestBinding(payload.backupId),body=canonical(payload);
      if (Buffer.byteLength(body)>FIREBASE_BACKUP_MANIFEST_MAX_BYTES) fail("backup_artifact_limit",413);
      return safe(async()=>{
        await assertObjects(payload.backupId,payload.nativeExport.objects);
        const ciphertext=Buffer.from(cipher.encrypt(body,expected.aad)),payloadSha256=digest(body);
        if (!ciphertext.length || ciphertext.length>FIREBASE_BACKUP_MANIFEST_MAX_CIPHER_BYTES) fail("backup_artifact_limit",413);
        let descriptor:FirebaseBackupManifestDescriptor;
        try {
          const metadata=manifestMetadata(await bucket.writeNew(expected.objectName,ciphertext,{
            resumable:false,validation:"crc32c",timeout:FIREBASE_PHOTO_TIMEOUT_MS,preconditionOpts:{ifGenerationMatch:0},
            metadata:{temporaryHold:true,contentType:"application/octet-stream",cacheControl:"private, no-store",
              metadata:{format:FORMAT+"/v1",binding:expected.tag,cipherSha256:digest(ciphertext),payloadSha256,retainedUntil:payload.retainedUntil}},
          } satisfies SaveOptions),expected);
          if (Number(metadata.size)!==ciphertext.length || metadata.metadata.cipherSha256!==digest(ciphertext)
            || metadata.metadata.payloadSha256!==payloadSha256 || metadata.metadata.retainedUntil!==payload.retainedUntil)
            fail("backup_artifact_integrity",503);
          descriptor=parse(firebaseBackupManifestDescriptorSchema,{format:FORMAT+"/v1",objectName:expected.objectName,generation:metadata.generation,
            cipherSha256:digest(ciphertext),bytes:ciphertext.length,retainedUntil:payload.retainedUntil});
        } catch {
          // Probe the original address once, then pin its original generation. Never create a replacement.
          const latest=manifestMetadata(await bucket.metadata(expected.objectName),expected);
          const recovered=await readStored(payload.backupId,latest.generation);
          if (canonical(recovered.payload)!==body) fail("backup_artifact_conflict",409);
          descriptor=recovered.descriptor;
        }
        await assertObjects(payload.backupId,payload.nativeExport.objects);return descriptor;
      });
    },
    async readManifest(value) {
      const input=parse(z.object({backupId:uuid,descriptor:firebaseBackupManifestDescriptorSchema}).strict(),value,true);
      if (input.descriptor.objectName!==nameFor(input.backupId)) fail("backup_artifact_conflict",409);
      return safe(async()=>{
        const stored=await readStored(input.backupId,input.descriptor.generation,input.descriptor);
        await assertObjects(input.backupId,stored.payload.nativeExport.objects);return stored.payload;
      });
    },
  };
}