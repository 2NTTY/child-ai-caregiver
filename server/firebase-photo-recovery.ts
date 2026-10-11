import { createHash } from "node:crypto";
import type { SaveOptions } from "@google-cloud/storage";
import { z } from "zod";
import { PHOTO_LIMITS } from "../src/shared/photos.ts";
import { decodePhoto, photoHash } from "./photo-files.ts";
import type { StorageCipher } from "./storage-crypto.ts";
import { canonical } from "./firestore-session-codec.ts";
import { workRecoveryScopeSchema, type WorkRecoveryScope } from "./firestore-work-continuation-recovery.ts";
import { readFirebaseStorageResponse, FIREBASE_PHOTO_TIMEOUT_MS, firebasePhotoObjectDescriptorSchema,
  type FirebasePhotoObjects, type FirebasePhotoObjectDescriptor, type FirebasePhotoBucketPort, type FirebasePhotoSdkBucket } from "./firebase-photo-objects.ts";

const FORMAT = "yuban-photo-backup", VERSION = 1;
export const FIREBASE_PHOTO_BACKUP_MIN_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
export const FIREBASE_PHOTO_BACKUP_MAX_RETENTION_MS = 15 * 24 * 60 * 60 * 1000;
const MAX_BASE64_BYTES = Math.ceil(PHOTO_LIMITS.bytes / 3) * 4;
const MAX_BODY_BYTES = MAX_BASE64_BYTES + 16 * 1024;
export const FIREBASE_PHOTO_BACKUP_MAX_CIPHER_BYTES = 4 + Math.ceil((MAX_BODY_BYTES + 32) / 3) * 4;
const uuid = z.uuid(), datetime = z.iso.datetime({ offset: true }), hash = z.string().regex(/^[a-f0-9]{64}$/u);
const generation = firebasePhotoObjectDescriptorSchema.shape.generation;
const objectNameSchema = z.string().regex(/^firebase-backups\/v1\/[a-f0-9-]{36}\/photos\/[a-f0-9-]{36}$/u);
export const firebasePhotoRecoveryConfigSchema = z.object({
  projectId: z.string().regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u),
  namespace: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/u),
  backupBucketName: z.string().min(3).max(222).regex(/^[a-z0-9][a-z0-9._-]*[a-z0-9]$/u),
}).strict();
export type FirebasePhotoRecoveryConfig = z.infer<typeof firebasePhotoRecoveryConfigSchema>;
export const backupPhotoDescriptorSchema = z.object({
  format: z.literal("yuban-photo-backup/v1"), objectName: objectNameSchema, generation, cipherSha256: hash,
  bytes: z.number().int().positive().max(FIREBASE_PHOTO_BACKUP_MAX_CIPHER_BYTES), retainedUntil: datetime,
}).strict();
export type BackupPhotoDescriptor = z.infer<typeof backupPhotoDescriptorSchema>;
export interface BackupPhotoInput {
  backupId: string; scope: WorkRecoveryScope; photoId: string; descriptor: FirebasePhotoObjectDescriptor; retainedUntil: string;
}
export interface RestorePhotoInput { backupId: string; backup: BackupPhotoDescriptor; targetScope: WorkRecoveryScope }
export interface FirebasePhotoRecoveryOptions {
  config: FirebasePhotoRecoveryConfig; cipher: StorageCipher; backupBucket: FirebasePhotoBucketPort;
  sourceObjects: Pick<FirebasePhotoObjects, "read">; targetObjects: Pick<FirebasePhotoObjects, "write" | "recover">;
  serverClock?: () => number;
}
export interface FirebasePhotoRecovery {
  backupPhoto(input: BackupPhotoInput): Promise<BackupPhotoDescriptor>;
  restorePhoto(input: RestorePhotoInput): Promise<FirebasePhotoObjectDescriptor>;
}
export class FirebasePhotoRecoveryError extends Error {
  readonly code: "photo_backup_invalid" | "photo_backup_conflict" | "photo_backup_integrity" | "photo_backup_expired" | "photo_backup_unavailable";
  readonly status: 400 | 409 | 503;
  constructor(code: FirebasePhotoRecoveryError["code"], status: FirebasePhotoRecoveryError["status"]) {
    super(code); this.name = "FirebasePhotoRecoveryError"; this.code = code; this.status = status;
  }
}
function fail(code: FirebasePhotoRecoveryError["code"], status: FirebasePhotoRecoveryError["status"]): never {
  throw new FirebasePhotoRecoveryError(code,status);
}
function parse<T>(schema: z.ZodType<T>, value: unknown, input = false): T {
  const parsed=schema.safeParse(value);
  if(!parsed.success)fail(input?"photo_backup_invalid":"photo_backup_integrity",input?400:503);
  return parsed.data;
}
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const payloadSchema = z.object({
  backupId: uuid, scope: workRecoveryScopeSchema, photoId: uuid, descriptor: firebasePhotoObjectDescriptorSchema,
  base64: z.string().min(1).max(MAX_BASE64_BYTES), retainedUntil: datetime,
  metadata: z.object({ bytes: z.number().int().positive().max(PHOTO_LIMITS.bytes),
    mimeType: z.enum(["image/png","image/jpeg"]), sha256: hash }).strict(),
}).strict();
const metadataSchema = z.object({
  name: objectNameSchema, bucket: z.string(), generation,
  size: z.union([z.string().regex(/^[1-9][0-9]{0,19}$/u),z.number().int().positive().max(Number.MAX_SAFE_INTEGER)])
    .refine(value=>BigInt(value)<=BigInt(FIREBASE_PHOTO_BACKUP_MAX_CIPHER_BYTES)),
  temporaryHold: z.literal(true), contentEncoding: z.string().optional(),
  metadata: z.object({ format: z.literal("yuban-photo-backup/v1"), binding: hash, cipherSha256: hash,
    payloadSha256: hash, retainedUntil: datetime }).strict(),
});
type Payload = z.infer<typeof payloadSchema>;
type Metadata = z.infer<typeof metadataSchema>;

/** Public SDK requests keep uint64 revisions exact and include the encrypted JSON overhead in Range. */
export function createFirebasePhotoBackupBucketPort(bucket: FirebasePhotoSdkBucket): FirebasePhotoBucketPort {
  return {
    async writeNew(objectName,ciphertext,options) {
      const file=bucket.file(objectName);await file.save(ciphertext,options);return file.metadata;
    },
    async metadata(objectName,revision) {
      const [body,response]=await bucket.file(objectName).request({method:"GET",uri:"",
        qs:revision===undefined?{}:{generation:revision},timeout:FIREBASE_PHOTO_TIMEOUT_MS,headers:{"Cache-Control":"no-store"}});
      if(!response||typeof response!=="object"||!("statusCode" in response)||response.statusCode!==200)fail("photo_backup_unavailable",503);
      return body;
    },
    readPinned(objectName,revision) {
      return readFirebaseStorageResponse(bucket, objectName, revision, FIREBASE_PHOTO_BACKUP_MAX_CIPHER_BYTES);
    },
  };
}

/** Operator-only single-asset copying. Erasure admission and domain restoration remain outside this port. */
export function createFirebasePhotoRecovery(options: FirebasePhotoRecoveryOptions): FirebasePhotoRecovery {
  const config=parse(firebasePhotoRecoveryConfigSchema,options.config,true),{cipher,backupBucket,sourceObjects,targetObjects}=options;
  if(typeof cipher?.encrypt!=="function"||typeof cipher?.decrypt!=="function"
    ||["writeNew","metadata","readPinned"].some(key=>typeof backupBucket?.[key as keyof FirebasePhotoBucketPort]!=="function")
    ||typeof sourceObjects?.read!=="function"||typeof targetObjects?.write!=="function"||typeof targetObjects?.recover!=="function"
    ||options.serverClock!==undefined&&typeof options.serverClock!=="function")fail("photo_backup_unavailable",503);
  const serverClock=options.serverClock??Date.now;
  const now=()=>{
    const at=serverClock();if(!Number.isSafeInteger(at)||at<0)fail("photo_backup_unavailable",503);return at;
  };
  function binding(value: string) {
    const objectName=parse(objectNameSchema,value,true),parts=objectName.split("/");
    parse(uuid,parts[2],true);parse(uuid,parts[4],true);
    const aad=canonical([FORMAT,VERSION,config.projectId,config.namespace,config.backupBucketName,objectName]);
    return {objectName,aad,tag:digest(aad),backupId:parts[2],photoId:parts[4]};
  }
  const backupName=(backupId:string,photoId:string)=>"firebase-backups/v1/"+backupId+"/photos/"+photoId;
  function photoName(scope: WorkRecoveryScope,photoId: string) {
    const full={ownerUserId:scope.ownerUserId,workspaceId:scope.workspaceId,childId:scope.childId,storageEpoch:scope.storageEpoch};
    return "photos/v1/"+digest(JSON.stringify(["yuban-photo-object",1,config.projectId,config.namespace,full]))+"/"+photoId;
  }
  function content(payload: Payload): Buffer {
    if(payload.descriptor.objectName!==photoName(payload.scope,payload.photoId))fail("photo_backup_integrity",503);
    let bytes:Buffer;
    try {bytes=decodePhoto(payload.base64,payload.metadata.mimeType);}catch {fail("photo_backup_integrity",503);}
    if(bytes.length!==payload.metadata.bytes||photoHash(bytes)!==payload.metadata.sha256
      ||payload.descriptor.bytes!==payload.metadata.bytes||payload.descriptor.sha256!==payload.metadata.sha256
      ||payload.descriptor.mimeType!==payload.metadata.mimeType)fail("photo_backup_integrity",503);
    return bytes;
  }
  function checkedMetadata(value:unknown,expected:ReturnType<typeof binding>,revision?:string) {
    const metadata=parse(metadataSchema,value),retained=Date.parse(metadata.metadata.retainedUntil),at=now();
    if(metadata.name!==expected.objectName||metadata.bucket!==config.backupBucketName||metadata.metadata.binding!==expected.tag
      ||revision!==undefined&&metadata.generation!==revision
      ||metadata.contentEncoding!==undefined&&metadata.contentEncoding!=="identity")fail("photo_backup_integrity",503);
    if(retained<=at)fail("photo_backup_expired",409);
    if(retained>at+FIREBASE_PHOTO_BACKUP_MAX_RETENTION_MS)fail("photo_backup_integrity",503);
    return metadata;
  }
  async function media(expected:ReturnType<typeof binding>,metadata:Metadata):Promise<Buffer> {
    const stream=backupBucket.readPinned(expected.objectName,metadata.generation),limit=Number(metadata.size),chunks:Buffer[]=[];
    let size=0,accepted=false;
    const response=(value:unknown)=>{
      if(!value||typeof value!=="object"||!("statusCode" in value)||(value.statusCode!==200&&value.statusCode!==206)) {
        stream.destroy(new FirebasePhotoRecoveryError("photo_backup_unavailable",503));return;
      }
      const headers="headers" in value&&value.headers&&typeof value.headers==="object"?value.headers as Record<string,unknown>:{};
      const length=headers["content-length"],encoding=headers["content-encoding"],revision=headers["x-goog-generation"];
      if(encoding!==undefined&&encoding!=="identity"||revision!==undefined&&revision!==metadata.generation
        ||length!==undefined&&(typeof length!=="string"||!/^[0-9]+$/u.test(length)||BigInt(length)>BigInt(limit))) {
        stream.destroy(new FirebasePhotoRecoveryError("photo_backup_integrity",503));return;
      }
      accepted=true;
    };
    stream.once("response",response);
    const deadline=setTimeout(()=>stream.destroy(new FirebasePhotoRecoveryError("photo_backup_unavailable",503)),FIREBASE_PHOTO_TIMEOUT_MS);
    try {
      for await(const chunk of stream) {
        if(!accepted||!Buffer.isBuffer(chunk))fail("photo_backup_integrity",503);
        const part=chunk.subarray(0,Math.max(0,limit+1-size));size+=part.length;chunks.push(part);
        if(size>limit||part.length!==chunk.length)fail("photo_backup_integrity",503);
      }
      if(!accepted||size!==limit)fail("photo_backup_integrity",503);
      return Buffer.concat(chunks,size);
    }finally {clearTimeout(deadline);stream.removeListener("response",response);stream.destroy();}
  }
  async function readStored(expected:ReturnType<typeof binding>,revision:string,descriptor?:BackupPhotoDescriptor) {
    const metadata=checkedMetadata(await backupBucket.metadata(expected.objectName,revision),expected,revision);
    if(descriptor&&(descriptor.bytes!==Number(metadata.size)||descriptor.cipherSha256!==metadata.metadata.cipherSha256
      ||descriptor.retainedUntil!==metadata.metadata.retainedUntil))fail("photo_backup_integrity",503);
    const ciphertext=await media(expected,metadata);
    if(digest(ciphertext)!==metadata.metadata.cipherSha256)fail("photo_backup_integrity",503);
    let payload:Payload,text:string;
    try {
      text=cipher.decrypt(new TextDecoder("utf-8",{fatal:true}).decode(ciphertext),expected.aad);
      if(Buffer.byteLength(text)>MAX_BODY_BYTES)fail("photo_backup_integrity",503);
      payload=parse(payloadSchema,JSON.parse(text));
    }catch {fail("photo_backup_integrity",503);}
    if(payload.backupId!==expected.backupId||payload.photoId!==expected.photoId
      ||backupName(payload.backupId,payload.photoId)!==expected.objectName
      ||payload.retainedUntil!==metadata.metadata.retainedUntil
      ||digest(canonical(payload))!==metadata.metadata.payloadSha256)fail("photo_backup_integrity",503);
    content(payload);
    const result=parse(backupPhotoDescriptorSchema,{format:FORMAT+"/v1",objectName:expected.objectName,generation:revision,
      cipherSha256:digest(ciphertext),bytes:ciphertext.length,retainedUntil:payload.retainedUntil});
    return {payload,descriptor:result};
  }
  async function safe<T>(action:()=>Promise<T>):Promise<T> {
    try {return await action();}catch(error) {
      if(error instanceof FirebasePhotoRecoveryError)throw error;
      fail("photo_backup_unavailable",503);
    }
  }
  return {
    async backupPhoto(value) {
      const input=parse(z.object({backupId:uuid,scope:workRecoveryScopeSchema,photoId:uuid,
        descriptor:firebasePhotoObjectDescriptorSchema,retainedUntil:datetime}).strict(),value,true);
      const retained=Date.parse(input.retainedUntil),at=now();
      if(retained<at+FIREBASE_PHOTO_BACKUP_MIN_RETENTION_MS||retained>at+FIREBASE_PHOTO_BACKUP_MAX_RETENTION_MS)fail("photo_backup_invalid",400);
      const backupId=input.backupId.toLowerCase(),photoId=input.photoId.toLowerCase(),expected=binding(backupName(backupId,photoId));
      if(input.descriptor.objectName!==photoName(input.scope,photoId))fail("photo_backup_conflict",409);
      return safe(async()=>{
        const original=await sourceObjects.read(input.scope,photoId,input.descriptor);
        const payload=parse(payloadSchema,{backupId,scope:input.scope,photoId,descriptor:input.descriptor,
          base64:original.base64,retainedUntil:input.retainedUntil,
          metadata:{sha256:input.descriptor.sha256,bytes:input.descriptor.bytes,mimeType:input.descriptor.mimeType}});
        const plaintext=content(payload);
        if(!Buffer.isBuffer(original.buffer)||!plaintext.equals(original.buffer)||original.mimeType!==input.descriptor.mimeType)fail("photo_backup_integrity",503);
        const body=canonical(payload);
        if(Buffer.byteLength(body)>MAX_BODY_BYTES)fail("photo_backup_integrity",503);
        const ciphertext=Buffer.from(cipher.encrypt(body,expected.aad)),payloadSha256=digest(body);
        if(!ciphertext.length||ciphertext.length>FIREBASE_PHOTO_BACKUP_MAX_CIPHER_BYTES)fail("photo_backup_integrity",503);
        try {
          const metadata=checkedMetadata(await backupBucket.writeNew(expected.objectName,ciphertext,{
            resumable:false,validation:"crc32c",timeout:FIREBASE_PHOTO_TIMEOUT_MS,preconditionOpts:{ifGenerationMatch:0},
            metadata:{temporaryHold:true,contentType:"application/octet-stream",cacheControl:"private, no-store",
              metadata:{format:FORMAT+"/v1",binding:expected.tag,cipherSha256:digest(ciphertext),payloadSha256,retainedUntil:input.retainedUntil}},
          } satisfies SaveOptions),expected);
          if(Number(metadata.size)!==ciphertext.length||metadata.metadata.cipherSha256!==digest(ciphertext)
            ||metadata.metadata.payloadSha256!==payloadSha256||metadata.metadata.retainedUntil!==input.retainedUntil)fail("photo_backup_integrity",503);
          return parse(backupPhotoDescriptorSchema,{format:FORMAT+"/v1",objectName:expected.objectName,generation:metadata.generation,
            cipherSha256:digest(ciphertext),bytes:ciphertext.length,retainedUntil:input.retainedUntil});
        }catch {
          // An unknown create has exactly one same-address readback, never another create or another name.
          const latest=checkedMetadata(await backupBucket.metadata(expected.objectName),expected);
          const recovered=await readStored(expected,latest.generation);
          if(canonical(recovered.payload)!==body)fail("photo_backup_conflict",409);
          return recovered.descriptor;
        }
      });
    },
    async restorePhoto(value) {
      const input=parse(z.object({backupId:uuid,backup:backupPhotoDescriptorSchema,targetScope:workRecoveryScopeSchema}).strict(),value,true);
      const expected=binding(input.backup.objectName);
      if(expected.backupId!==input.backupId.toLowerCase())fail("photo_backup_conflict",409);
      return safe(async()=>{
        const {payload}=await readStored(expected,input.backup.generation,input.backup),target=input.targetScope,original=payload.scope;
        if(target.ownerUserId!==original.ownerUserId||target.workspaceId!==original.workspaceId||target.childId!==original.childId
          ||target.storageEpoch===original.storageEpoch)fail("photo_backup_conflict",409);
        const restored=parse(firebasePhotoObjectDescriptorSchema,await targetObjects.write(target,payload.photoId,
          {base64:payload.base64,mimeType:payload.metadata.mimeType}));
        if(restored.objectName!==photoName(target,payload.photoId)||restored.sha256!==payload.descriptor.sha256
          ||restored.bytes!==payload.descriptor.bytes||restored.mimeType!==payload.descriptor.mimeType)fail("photo_backup_integrity",503);
        return restored;
      });
    },
  };
}