import { createHash } from 'node:crypto';
import { z } from 'zod';
import { canonical } from './firestore-session-codec.ts';
import { workRecoveryScopeSchema,type WorkRecoveryScope } from './firestore-work-continuation-recovery.ts';
import { firebasePhotoRecoveryConfigSchema,FIREBASE_PHOTO_BACKUP_MIN_RETENTION_MS,FIREBASE_PHOTO_BACKUP_MAX_RETENTION_MS } from './firebase-photo-recovery.ts';
import { voiceObjectDescriptorSchema,readVoiceCiphertext,VOICE_OBJECT_MAX_BYTES,type VoiceObjects,type VoiceObjectDescriptor } from './firebase-voice-objects.ts';
import { decodeVoiceBase64 } from './voice-files.ts';
import type { FirebasePhotoBucketPort } from './firebase-photo-objects.ts';
import type { StorageCipher } from './storage-crypto.ts';

const format='yuyoufang-voice-backup/v1',hash=z.string().regex(/^[a-f0-9]{64}$/u);
const objectName=z.string().regex(/^firebase-backups\/v1\/[a-f0-9-]{36}\/voices\/[a-f0-9-]{36}$/u);
export const voiceBackupDescriptorSchema=z.object({format:z.literal(format),objectName,generation:voiceObjectDescriptorSchema.shape.generation,
  cipherSha256:hash,bytes:z.number().int().positive().max(VOICE_OBJECT_MAX_BYTES),retainedUntil:z.iso.datetime({offset:true})}).strict();
export type VoiceBackupDescriptor=z.infer<typeof voiceBackupDescriptorSchema>;
const bodySchema=z.object({backupId:z.uuid(),scope:workRecoveryScopeSchema,voiceId:z.uuid(),descriptor:voiceObjectDescriptorSchema,
  base64:z.string().min(1).max(7*1024*1024),retainedUntil:z.iso.datetime({offset:true})}).strict();
const metadataSchema=z.object({name:objectName,bucket:z.string(),generation:voiceObjectDescriptorSchema.shape.generation,
  size:z.union([z.string().regex(/^[1-9][0-9]{0,19}$/u),z.number().int().positive()]).refine(v=>Number(v)<=VOICE_OBJECT_MAX_BYTES),
  contentEncoding:z.string().optional(),temporaryHold:z.literal(true),metadata:z.object({format:z.literal(format),binding:hash,cipherSha256:hash,
    payloadSha256:hash,retainedUntil:z.iso.datetime({offset:true})}).strict()});
const digest=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
function check(v:unknown,code='voice_backup_integrity'):asserts v{if(!v)throw Object.assign(new Error('Voice backup unavailable'),{code,status:503});}
export function createFirebaseVoiceRecovery(options:{config:z.infer<typeof firebasePhotoRecoveryConfigSchema>;cipher:StorageCipher;
  backupBucket:FirebasePhotoBucketPort;objects:VoiceObjects;serverClock?:()=>number}) {
  const config=firebasePhotoRecoveryConfigSchema.parse(options.config),clock=options.serverClock??Date.now;
  function binding(backupId:string,voiceId:string){z.uuid().parse(backupId);z.uuid().parse(voiceId);
    const name='firebase-backups/v1/'+backupId+'/voices/'+voiceId;
    const aad=canonical([format,config.projectId,config.namespace,config.backupBucketName,name]);return {name,aad,tag:digest(aad)};}
  function content(value:unknown){const body=bodySchema.parse(value),buffer=decodeVoiceBase64(body.base64);
    check(body.descriptor.objectName===options.objects.address(body.scope,body.voiceId)&&buffer.length===body.descriptor.bytes&&digest(buffer)===body.descriptor.sha256);return body;}
  async function read(backupId:string,voiceId:string,descriptor:VoiceBackupDescriptor){
    const expected=binding(backupId,voiceId),d=voiceBackupDescriptorSchema.parse(descriptor);check(d.objectName===expected.name);
    const m=metadataSchema.parse(await options.backupBucket.metadata(expected.name,d.generation));
    check(m.name===expected.name&&m.bucket===config.backupBucketName&&m.generation===d.generation&&Number(m.size)===d.bytes
      &&m.metadata.binding===expected.tag&&m.metadata.cipherSha256===d.cipherSha256&&m.metadata.retainedUntil===d.retainedUntil
      &&(m.contentEncoding===undefined||m.contentEncoding==='identity'));
    check(Date.parse(d.retainedUntil)>clock(),'voice_backup_expired');
    const encrypted=await readVoiceCiphertext(options.backupBucket,expected.name,d.generation,d.bytes,d.cipherSha256);
    const body=content(JSON.parse(options.cipher.decrypt(new TextDecoder('utf-8',{fatal:true}).decode(encrypted),expected.aad)));
    check(body.backupId===backupId&&body.voiceId===voiceId&&body.retainedUntil===d.retainedUntil&&digest(canonical(body))===m.metadata.payloadSha256);return body;
  }
  return {
    async backupVoice(input:{backupId:string;scope:WorkRecoveryScope;voiceId:string;descriptor:VoiceObjectDescriptor;retainedUntil:string}){
      const expires=Date.parse(input.retainedUntil),now=clock();
      check(expires>=now+FIREBASE_PHOTO_BACKUP_MIN_RETENTION_MS&&expires<=now+FIREBASE_PHOTO_BACKUP_MAX_RETENTION_MS,'voice_backup_retention');
      const source=await options.objects.read(input.scope,input.voiceId,input.descriptor),body=content({...input,base64:source.base64});
      const expected=binding(input.backupId,input.voiceId),plain=canonical(body),encrypted=Buffer.from(options.cipher.encrypt(plain,expected.aad),'utf8');
      check(encrypted.length<=VOICE_OBJECT_MAX_BYTES);let raw:unknown;
      try {raw=await options.backupBucket.writeNew(expected.name,encrypted,{resumable:false,validation:'crc32c',timeout:15000,
        preconditionOpts:{ifGenerationMatch:0},metadata:{contentType:'application/octet-stream',cacheControl:'private, no-store',temporaryHold:true,
          metadata:{format,binding:expected.tag,cipherSha256:digest(encrypted),payloadSha256:digest(plain),retainedUntil:input.retainedUntil}}});}
      catch {raw=await options.backupBucket.metadata(expected.name);}
      const m=metadataSchema.parse(raw),descriptor=voiceBackupDescriptorSchema.parse({format,objectName:expected.name,generation:m.generation,
        cipherSha256:m.metadata.cipherSha256,bytes:Number(m.size),retainedUntil:m.metadata.retainedUntil});
      // An uncertain original write is reconciled at its same immutable address, never resent.
      check(canonical(await read(input.backupId,input.voiceId,descriptor))===plain);return descriptor;
    },
    async restoreVoice(input:{backupId:string;voiceId:string;scope:WorkRecoveryScope;descriptor:VoiceObjectDescriptor;backup:VoiceBackupDescriptor;targetScope:WorkRecoveryScope}){
      const body=await read(input.backupId,input.voiceId,input.backup),target=workRecoveryScopeSchema.parse(input.targetScope);
      check(canonical(body.scope)===canonical(input.scope)&&canonical(body.descriptor)===canonical(input.descriptor)
        &&target.ownerUserId===body.scope.ownerUserId&&target.workspaceId===body.scope.workspaceId&&target.childId===body.scope.childId&&target.storageEpoch!==body.scope.storageEpoch);
      const result=await options.objects.write(target,body.voiceId,body.base64,body.descriptor.mimeType);
      check(['bytes','sha256','mimeType','durationMs'].every(k=>result[k as keyof VoiceObjectDescriptor]===body.descriptor[k as keyof VoiceObjectDescriptor]));return result;
    },
  };
}
export type FirebaseVoiceRecovery=ReturnType<typeof createFirebaseVoiceRecovery>;
