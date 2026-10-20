import { chatFileObjectDescriptorSchema, type ChatFileObjects, type ChatFileObjectDescriptor } from './firebase-chat-file-objects.ts';
import { erasureCoversPhoto, erasureCoversVoice, erasureCoversChatFile } from './firebase-erasure-journal.ts';
import { z } from 'zod';
import type { Bucket } from '@google-cloud/storage';
import type { FirebasePhotoObjects, FirebasePhotoObjectDescriptor } from './firebase-photo-objects.ts';
import { firebasePhotoObjectDescriptorSchema } from './firebase-photo-objects.ts';
import { voiceObjectDescriptorSchema, type VoiceObjects, type VoiceObjectDescriptor } from './firebase-voice-objects.ts';
import type { FirebaseErasureJournal } from './firebase-erasure-journal.ts';
import { firebaseErasureIntentSchema } from './firebase-erasure-journal.ts';
import type { WorkRecoveryScope } from './firestore-work-continuation-recovery.ts';
import type { createFirestoreAuthority } from './firestore-authority.ts';

const pageSchema=z.object({items:z.array(z.object({name:z.string().regex(/^erasures\/v1\/[a-f0-9]{64}$/u),
  generation:z.string().regex(/^[1-9][0-9]*$/u)})).optional(),nextPageToken:z.string().optional()});
type MediaDescriptor=Pick<FirebasePhotoObjectDescriptor,'objectName'|'cipherSha256'|'sha256'|'bytes'|'generation'>&{mimeType:string};
function same(left:MediaDescriptor,right:MediaDescriptor) {
  return left.objectName===right.objectName&&left.cipherSha256===right.cipherSha256&&left.sha256===right.sha256
    &&left.bytes===right.bytes&&left.mimeType===right.mimeType;
}
type ManagedMediaOptions<D extends MediaDescriptor,R>={bucket:Bucket;journalBucket:Bucket;
  journal:Pick<FirebaseErasureJournal,'readObject'>;
  objects:{read(scope:WorkRecoveryScope,id:string,descriptor:D):Promise<R>;inspect(scope:WorkRecoveryScope,id:string):Promise<D|null>};
  authority:Pick<ReturnType<typeof createFirestoreAuthority>,'readControl'>;sourceGeneration:string};
/** Operator only. Photos and audio share the same pause/journal/immutable-generation safeguards. */
function createManagedMediaReader<D extends MediaDescriptor,R>(options:ManagedMediaOptions<D,R>,policy:{
  kind:'photo'|'voice'|'file';parse(value:unknown):D;address:RegExp;format:string;covers:typeof erasureCoversPhoto}) {
  function reject(code='recovery_retained_'+policy.kind+'_unconfirmed'):never {
    throw Object.assign(new Error('Retained media recovery rejected'),{code});
  }
  const {bucket,journalBucket,journal,objects,authority,sourceGeneration}=options;
  z.uuid().parse(sourceGeneration);
  if(bucket.name===journalBucket.name)reject('recovery_journal_not_independent');
  async function assertNotErased(scope:WorkRecoveryScope,photoId:string){
    const control=await authority.readControl();
    if(control.enabled||control.generation!==sourceGeneration)reject('recovery_source_not_paused');
    const names=new Set<string>(),tokens=new Set<string>();let cursor:string|undefined;
    for(let page=0;page<32;page++){
      const [raw,response]=await journalBucket.request({method:'GET',uri:'/o',timeout:20000,
        qs:{prefix:'erasures/v1/',maxResults:100,fields:'items(name,generation),nextPageToken',...(cursor?{pageToken:cursor}:{})},headers:{'Cache-Control':'no-store'}});
      if(response?.statusCode!==200)reject('recovery_journal_unavailable');
      const value=pageSchema.parse(raw);
      for(const row of value.items??[]){
        if(names.has(row.name)||names.size>=2000)reject('recovery_journal_incomplete');names.add(row.name);
        const intent=firebaseErasureIntentSchema.parse((await journal.readObject(row.name,row.generation)).intent);
        if(policy.covers(intent,scope,photoId))reject('recovery_'+policy.kind+'_permanently_erased');
      }
      if(!value.nextPageToken)return;
      if(tokens.has(value.nextPageToken))reject('recovery_journal_incomplete');tokens.add(value.nextPageToken);cursor=value.nextPageToken;
    }
    reject('recovery_journal_incomplete');
  }
  return async(scope:WorkRecoveryScope,photoId:string,value:D):Promise<R>=>{
    const descriptor=policy.parse(value);
    await assertNotErased(scope,photoId);
    try{return await objects.read(scope,photoId,descriptor);}catch{/* A proven retained generation is required below. */}
    const found=await objects.inspect(scope,photoId);
    if(found){if(!same(found,descriptor))reject();return objects.read(scope,photoId,found);}
    if(!policy.address.test(descriptor.objectName))reject();
    const uri='/o/'+encodeURIComponent(descriptor.objectName);
    const [raw,response]=await bucket.request({method:'GET',uri,timeout:20000,
      qs:{generation:descriptor.generation,softDeleted:true},headers:{'Cache-Control':'no-store'}});
    const metadata=raw as {name?:string;bucket?:string;generation?:string;softDeleteTime?:string;hardDeleteTime?:string;
      metadata?:{format?:string;cipherSha256?:string;sha256?:string}};
    if(response?.statusCode!==200||metadata.name!==descriptor.objectName||metadata.bucket!==bucket.name
      ||metadata.generation!==descriptor.generation||!metadata.softDeleteTime||!metadata.hardDeleteTime
      ||!(Date.parse(metadata.hardDeleteTime)>Date.now())||metadata.metadata?.format!==policy.format
      ||metadata.metadata.cipherSha256!==descriptor.cipherSha256||metadata.metadata.sha256!==descriptor.sha256)reject();
    // Re-read authenticated independent intents immediately before the only mutation; no caller-supplied approval flag.
    await assertNotErased(scope,photoId);
    try{
      const [,result]=await bucket.request({method:'POST',uri:uri+'/restore',timeout:20000,
        qs:{generation:descriptor.generation,ifGenerationMatch:0},headers:{'Cache-Control':'no-store'}});
      if(result?.statusCode!==200)reject();
    }catch{/* Unknown result gets one same-address read, never another restore or another object name. */}
    const restored=await objects.inspect(scope,photoId);
    if(!restored||!same(restored,descriptor))reject();
    await assertNotErased(scope,photoId);
    return objects.read(scope,photoId,restored);
  };
}

export function createFirebaseManagedPhotoReader(options:ManagedMediaOptions<FirebasePhotoObjectDescriptor,Awaited<ReturnType<FirebasePhotoObjects['read']>>>):FirebasePhotoObjects['read'] {
  return createManagedMediaReader(options,{kind:'photo',parse:v=>firebasePhotoObjectDescriptorSchema.parse(v),
    address:/^photos\/v1\/[a-f0-9]{64}\/[a-f0-9-]{36}$/u,format:'yuban-photo-object/v1',covers:erasureCoversPhoto});
}
export function createFirebaseManagedVoiceReader(options:ManagedMediaOptions<VoiceObjectDescriptor,Awaited<ReturnType<VoiceObjects['read']>>>):VoiceObjects['read'] {
  return createManagedMediaReader(options,{kind:'voice',parse:v=>voiceObjectDescriptorSchema.parse(v),
    address:/^voice\/v1\/[a-f0-9]{64}\/[a-f0-9-]{36}$/u,format:'yuyoufang-voice-object/v1',covers:erasureCoversVoice});
}

export function createFirebaseManagedChatFileReader(options:ManagedMediaOptions<ChatFileObjectDescriptor,Awaited<ReturnType<ChatFileObjects['read']>>>):ChatFileObjects['read'] {
  return createManagedMediaReader(options,{kind:'file',parse:v=>chatFileObjectDescriptorSchema.parse(v),
    address:/^chat-file\/v1\/[a-f0-9]{64}\/[a-f0-9-]{36}$/u,format:'yuyoufang-chat-file-object/v1',covers:erasureCoversChatFile});
}
