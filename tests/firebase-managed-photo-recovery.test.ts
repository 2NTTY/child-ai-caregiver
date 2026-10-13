import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import type {Bucket} from '@google-cloud/storage';
import {createFirebaseManagedPhotoReader} from '../server/firebase-managed-photo-recovery.ts';

test('retained photo recovery reads the independent deletion journal before a conditional restore',async()=>{
  const generation=randomUUID(),photoId=randomUUID(),scope={ownerUserId:'synthetic-owner',workspaceId:randomUUID(),childId:randomUUID(),storageEpoch:randomUUID()};
  const descriptor={objectName:'photos/v1/'+'a'.repeat(64)+'/'+photoId,generation:'10',cipherSha256:'b'.repeat(64),sha256:'c'.repeat(64),bytes:1,mimeType:'image/png' as const};
  let erased=true,restored=false,posts=0,reads=0;
  const content={buffer:Buffer.from('x'),base64:'eA==',mimeType:'image/png' as const};
  const bucket={name:'synthetic-private',async request(request:any){
    if(request.method==='GET')return[{...descriptor,name:descriptor.objectName,bucket:'synthetic-private',
      softDeleteTime:new Date().toISOString(),hardDeleteTime:new Date(Date.now()+86400000).toISOString(),
      metadata:{format:'yuban-photo-object/v1',cipherSha256:descriptor.cipherSha256,sha256:descriptor.sha256}},{statusCode:200}];
    assert.equal(request.method,'POST');assert.deepEqual(request.qs,{generation:'10',ifGenerationMatch:0});
    posts++;restored=true;throw Error('synthetic acknowledgement lost');
  }} as unknown as Bucket;
  const journalBucket={name:'synthetic-independent-journal',async request(){reads++;return[{items:erased?[{name:'erasures/v1/'+'d'.repeat(64),generation:'1'}]:[]},{statusCode:200}];}} as unknown as Bucket;
  const reader=createFirebaseManagedPhotoReader({bucket,journalBucket,sourceGeneration:generation,
    authority:{async readControl(){return{enabled:false,generation};}},
    journal:{async readObject(){return{intent:{scope,type:'child-delete',assetId:scope.childId,operationId:randomUUID(),at:new Date().toISOString()},descriptor:{} as never};}},
    objects:{async inspect(){return restored?{...descriptor,generation:'20'}:null;},async read(_s,_id,value){
      if(value.generation==='10')throw Error('synthetic old generation absent');assert.equal(value.generation,'20');return content;}}
  });
  await assert.rejects(reader(scope,photoId,descriptor),(error:any)=>error.code==='recovery_photo_permanently_erased');
  assert.equal(posts,0);erased=false;
  assert.deepEqual(await reader(scope,photoId,descriptor),content);assert.equal(posts,1);assert.ok(reads>=4);
  assert.deepEqual(await reader(scope,photoId,descriptor),content);assert.equal(posts,1);
});
