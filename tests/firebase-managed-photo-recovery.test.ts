import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import type {Bucket} from '@google-cloud/storage';
import type {FirebasePhotoObjectDescriptor, FirebasePhotoObjects} from '../server/firebase-photo-objects.ts';
import type {VoiceObjectDescriptor, VoiceObjects} from '../server/firebase-voice-objects.ts';
import type {WorkRecoveryScope} from '../server/firestore-work-continuation-recovery.ts';
import {createFirebaseManagedPhotoReader,createFirebaseManagedVoiceReader} from '../server/firebase-managed-photo-recovery.ts';

for(const kind of ['photo','voice'] as const)test('retained '+kind+' recovery reads the independent deletion journal before a conditional restore',async()=>{
  const generation=randomUUID(),photoId=randomUUID(),scope={ownerUserId:'synthetic-owner',workspaceId:randomUUID(),childId:randomUUID(),storageEpoch:randomUUID()};
  const base={objectName:(kind==='photo'?'photos':'voice')+'/v1/'+'a'.repeat(64)+'/'+photoId,generation:'10',cipherSha256:'b'.repeat(64),sha256:'c'.repeat(64),bytes:1};
  const photoDescriptor:FirebasePhotoObjectDescriptor={...base,mimeType:'image/png'};
  const voiceDescriptor:VoiceObjectDescriptor={...base,mimeType:'audio/wav',durationMs:1000};
  const descriptor=kind==='photo'?photoDescriptor:voiceDescriptor;
  let erased=true,restored=false,posts=0,reads=0;
  const photoContent:Awaited<ReturnType<FirebasePhotoObjects['read']>>={buffer:Buffer.from('x'),base64:'eA==',mimeType:'image/png'};
  const voiceContent:Awaited<ReturnType<VoiceObjects['read']>>={buffer:Buffer.from('x'),base64:'eA==',descriptor:{...voiceDescriptor,generation:'20'}};
  const content=kind==='photo'?photoContent:voiceContent;
  const bucket={name:'synthetic-private',async request(request:{method?:string;qs?:unknown}){
    if(request.method==='GET')return[{...descriptor,name:descriptor.objectName,bucket:'synthetic-private',
      softDeleteTime:new Date().toISOString(),hardDeleteTime:new Date(Date.now()+86400000).toISOString(),
      metadata:{format:kind==='photo'?'yuban-photo-object/v1':'yuyoufang-voice-object/v1',cipherSha256:descriptor.cipherSha256,sha256:descriptor.sha256}},{statusCode:200}];
    assert.equal(request.method,'POST');assert.deepEqual(request.qs,{generation:'10',ifGenerationMatch:0});
    posts++;restored=true;throw Error('synthetic acknowledgement lost');
  }} as unknown as Bucket;
  const journalBucket={name:'synthetic-independent-journal',async request(){reads++;return[{items:erased?[{name:'erasures/v1/'+'d'.repeat(64),generation:'1'}]:[]},{statusCode:200}];}} as unknown as Bucket;
  const options={bucket,journalBucket,sourceGeneration:generation,
    authority:{async readControl(){return{enabled:false,generation};}},
    journal:{async readObject(objectName,generation){return{intent:{scope,type:'child-delete',assetId:scope.childId,operationId:randomUUID(),at:new Date().toISOString()},
      descriptor:{objectName,generation,cipherSha256:'e'.repeat(64),intentSha256:'f'.repeat(64),bytes:1,format:'yuban-erasure-journal/v1'}};}}
  } satisfies Omit<Parameters<typeof createFirebaseManagedPhotoReader>[0],'objects'>;
  function objects<D extends FirebasePhotoObjectDescriptor|VoiceObjectDescriptor,C>(descriptor:D,content:C){
    return {async inspect(){return restored?{...descriptor,generation:'20'}:null;},async read(_s:WorkRecoveryScope,_id:string,value:D){
      if(value.generation==='10')throw Error('synthetic old generation absent');assert.equal(value.generation,'20');return content;}};
  }
  let read:()=>Promise<typeof photoContent|typeof voiceContent>;
  if(kind==='photo'){
    const reader=createFirebaseManagedPhotoReader({...options,objects:objects(photoDescriptor,photoContent)});
    read=()=>reader(scope,photoId,photoDescriptor);
  }else{
    const reader=createFirebaseManagedVoiceReader({...options,objects:objects(voiceDescriptor,voiceContent)});
    read=()=>reader(scope,photoId,voiceDescriptor);
  }
  await assert.rejects(read(),error=>error instanceof Error&&'code' in error&&error.code==='recovery_'+kind+'_permanently_erased');
  assert.equal(posts,0);erased=false;
  assert.deepEqual(await read(),content);assert.equal(posts,1);assert.ok(reads>=4);
  assert.deepEqual(await read(),content);assert.equal(posts,1);
});
