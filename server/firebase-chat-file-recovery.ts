import { createHash } from 'node:crypto';
import { z } from 'zod';
import { canonical } from './firestore-session-codec.ts';
import { workRecoveryScopeSchema,type WorkRecoveryScope } from './firestore-work-continuation-recovery.ts';
import { firebasePhotoRecoveryConfigSchema,FIREBASE_PHOTO_BACKUP_MIN_RETENTION_MS,FIREBASE_PHOTO_BACKUP_MAX_RETENTION_MS } from './firebase-photo-recovery.ts';
import { chatFileObjectDescriptorSchema,readChatFileCiphertext,CHAT_FILE_OBJECT_MAX_BYTES,type ChatFileObjects,type ChatFileObjectDescriptor } from './firebase-chat-file-objects.ts';
import { decodeChatFileBase64 } from './chat-file-bytes.ts';
import type { FirebasePhotoBucketPort } from './firebase-photo-objects.ts';
import type { StorageCipher } from './storage-crypto.ts';

const format='yuyoufang-chat-file-backup/v1',hash=z.string().regex(/^[a-f0-9]{64}$/u);
const objectName=z.string().regex(/^firebase-backups\/v1\/[a-f0-9-]{36}\/files\/[a-f0-9-]{36}$/u);
export const chatFileBackupDescriptorSchema=z.object({format:z.literal(format),objectName,generation:chatFileObjectDescriptorSchema.shape.generation,
  cipherSha256:hash,bytes:z.number().int().positive().max(CHAT_FILE_OBJECT_MAX_BYTES),retainedUntil:z.iso.datetime({offset:true})}).strict();
export type ChatFileBackupDescriptor=z.infer<typeof chatFileBackupDescriptorSchema>;
const bodySchema=z.object({backupId:z.uuid(),scope:workRecoveryScopeSchema,fileId:z.uuid(),descriptor:chatFileObjectDescriptorSchema,
  base64:z.string().min(1).max(28*1024*1024),retainedUntil:z.iso.datetime({offset:true})}).strict();
const metadataSchema=z.object({name:objectName,bucket:z.string(),generation:chatFileObjectDescriptorSchema.shape.generation,
  size:z.union([z.string().regex(/^[1-9][0-9]{0,19}$/u),z.number().int().positive()]).refine(v=>Number(v)<=CHAT_FILE_OBJECT_MAX_BYTES),
  contentEncoding:z.string().optional(),temporaryHold:z.literal(true),metadata:z.object({format:z.literal(format),binding:hash,cipherSha256:hash,
    payloadSha256:hash,retainedUntil:z.iso.datetime({offset:true})}).strict()});
const digest=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
function check(v:unknown,code='chat_file_backup_integrity'):asserts v{if(!v)throw Object.assign(new Error('File backup unavailable'),{code,status:503});}
export function createFirebaseChatFileRecovery(options:{config:z.infer<typeof firebasePhotoRecoveryConfigSchema>;cipher:StorageCipher;
  backupBucket:FirebasePhotoBucketPort;objects:ChatFileObjects;serverClock?:()=>number}) {
  const config=firebasePhotoRecoveryConfigSchema.parse(options.config),clock=options.serverClock??Date.now;
  function binding(backupId:string,fileId:string){z.uuid().parse(backupId);z.uuid().parse(fileId);
    const name='firebase-backups/v1/'+backupId+'/files/'+fileId;
    const aad=canonical([format,config.projectId,config.namespace,config.backupBucketName,name]);return {name,aad,tag:digest(aad)};}
  function content(value:unknown){const body=bodySchema.parse(value),buffer=decodeChatFileBase64(body.base64);
    check(body.descriptor.objectName===options.objects.address(body.scope,body.fileId)&&buffer.length===body.descriptor.bytes&&digest(buffer)===body.descriptor.sha256);return body;}
  async function read(backupId:string,fileId:string,descriptor:ChatFileBackupDescriptor){
    const expected=binding(backupId,fileId),d=chatFileBackupDescriptorSchema.parse(descriptor);check(d.objectName===expected.name);
    const m=metadataSchema.parse(await options.backupBucket.metadata(expected.name,d.generation));
    check(m.name===expected.name&&m.bucket===config.backupBucketName&&m.generation===d.generation&&Number(m.size)===d.bytes
      &&m.metadata.binding===expected.tag&&m.metadata.cipherSha256===d.cipherSha256&&m.metadata.retainedUntil===d.retainedUntil
      &&(m.contentEncoding===undefined||m.contentEncoding==='identity'));
    check(Date.parse(d.retainedUntil)>clock(),'chat_file_backup_expired');
    const encrypted=await readChatFileCiphertext(options.backupBucket,expected.name,d.generation,d.bytes,d.cipherSha256);
    const body=content(JSON.parse(options.cipher.decrypt(new TextDecoder('utf-8',{fatal:true}).decode(encrypted),expected.aad)));
    check(body.backupId===backupId&&body.fileId===fileId&&body.retainedUntil===d.retainedUntil&&digest(canonical(body))===m.metadata.payloadSha256);return body;
  }
  return {
    async backupFile(input:{backupId:string;scope:WorkRecoveryScope;fileId:string;descriptor:ChatFileObjectDescriptor;retainedUntil:string}){
      const expires=Date.parse(input.retainedUntil),now=clock();
      check(expires>=now+FIREBASE_PHOTO_BACKUP_MIN_RETENTION_MS&&expires<=now+FIREBASE_PHOTO_BACKUP_MAX_RETENTION_MS,'chat_file_backup_retention');
      const source=await options.objects.read(input.scope,input.fileId,input.descriptor),body=content({...input,base64:source.base64});
      const expected=binding(input.backupId,input.fileId),plain=canonical(body),encrypted=Buffer.from(options.cipher.encrypt(plain,expected.aad),'utf8');
      check(encrypted.length<=CHAT_FILE_OBJECT_MAX_BYTES);let raw:unknown;
      try {raw=await options.backupBucket.writeNew(expected.name,encrypted,{resumable:false,validation:'crc32c',timeout:15000,
        preconditionOpts:{ifGenerationMatch:0},metadata:{contentType:'application/octet-stream',cacheControl:'private, no-store',temporaryHold:true,
          metadata:{format,binding:expected.tag,cipherSha256:digest(encrypted),payloadSha256:digest(plain),retainedUntil:input.retainedUntil}}});}
      catch {raw=await options.backupBucket.metadata(expected.name);}
      const m=metadataSchema.parse(raw),descriptor=chatFileBackupDescriptorSchema.parse({format,objectName:expected.name,generation:m.generation,
        cipherSha256:m.metadata.cipherSha256,bytes:Number(m.size),retainedUntil:m.metadata.retainedUntil});
      // An uncertain original write is reconciled at its same immutable address, never resent.
      check(canonical(await read(input.backupId,input.fileId,descriptor))===plain);return descriptor;
    },
    async restoreFile(input:{backupId:string;fileId:string;scope:WorkRecoveryScope;descriptor:ChatFileObjectDescriptor;backup:ChatFileBackupDescriptor;targetScope:WorkRecoveryScope}){
      const body=await read(input.backupId,input.fileId,input.backup),target=workRecoveryScopeSchema.parse(input.targetScope);
      check(canonical(body.scope)===canonical(input.scope)&&canonical(body.descriptor)===canonical(input.descriptor)
        &&target.ownerUserId===body.scope.ownerUserId&&target.workspaceId===body.scope.workspaceId&&target.childId===body.scope.childId&&target.storageEpoch!==body.scope.storageEpoch);
      const result=await options.objects.write(target,body.fileId,body.base64,body.descriptor.mimeType);
      check(['bytes','sha256','mimeType'].every(k=>result[k as keyof ChatFileObjectDescriptor]===body.descriptor[k as keyof ChatFileObjectDescriptor]));return result;
    },
  };
}
export type FirebaseChatFileRecovery=ReturnType<typeof createFirebaseChatFileRecovery>;
