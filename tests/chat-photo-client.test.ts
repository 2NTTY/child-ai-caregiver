import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { createPhotoApi } from '../src/client/photo-api.ts';
import { createChatApi, ChatApiError } from '../src/client/chat-api.ts';
import { ChatController } from '../src/client/chat-controller.ts';
import { ChatPhotoUploadController } from '../frontend/src/production/ChatPhotoUploadController.ts';
import type { PhotoAttachment, PhotoMessageReference } from '../src/shared/photos.ts';
import type { ChatMessage } from '../src/shared/chat.ts';
import type { OnlineReceipt, OnlineSubmission } from '../src/shared/online.ts';

test('chat photo owners recover original operations, reuse saved originals and isolate changed identities', async () => {
  const user={id:'parent',name:'Parent',email:'parent@example.test'},childId=randomUUID(),photoId=randomUUID();
  let currentUser=user,photo:PhotoAttachment|null=null,photoWrites=0,uploads=0,messageWrites=0,lookups=0,localReads=0;
  let delayPhoto=false,photoMissing=false,release:(()=>void)|undefined;
  const messages:ChatMessage[]=[],receipts=new Map<string,OnlineReceipt>();
  const context={workspaceId:randomUUID(),storageEpoch:randomUUID()};
  const hash=async(bytes:Uint8Array<ArrayBuffer>)=>createHash('sha256').update(bytes).digest('hex');
  const sha256=await hash(new Uint8Array([1]));
  const savedPhoto=():PhotoAttachment=>{assert.ok(photo);return photo;};
  const reference=():PhotoMessageReference=>{
    const {id,version,fileName,mimeType,bytes,sha256,source}=savedPhoto();
    return {id,version,fileName,mimeType,bytes,sha256,source};
  };
  const fetcher:typeof fetch=async(input,init)=>{
    const path=new URL(String(input)).pathname;
    const body=init?.body?JSON.parse(String(init.body)):null;
    if(path==='/api/online/context')return Response.json(context);
    if(path.startsWith('/api/online/operations/')){
      lookups++;const opId=path.split('/').at(-1)!;assert.ok(receipts.has(opId));return Response.json(receipts.get(opId));
    }
    if(path==='/api/online/submit'){
      const submission=body as OnlineSubmission;
      assert.equal(new Headers(init?.headers).get('x-expected-user-id'),user.id);
      assert.equal(receipts.has(submission.operation.opId),false);
      let result:unknown;
      if(submission.path===`/api/children/${childId}/photos`){
        photoWrites++;photo={...submission.payload as PhotoAttachment,id:photoId,childId,ownerUserId:user.id,version:1,
          state:'reserved',recoveryPending:false,visibility:'private',canManage:true,recordId:null,createdAt:'2026-10-24T00:00:00.000Z',
          extraction:{state:'not_requested',runId:null,draft:null,stopReason:null,processedAt:null,model:null}};
        result={photo};
      }else{
        assert.equal(submission.path,`/api/children/${childId}/messages`);
        assert.deepEqual(submission.payload,{text:'',photo:{id:photoId,expectedVersion:photo!.version}});
        messageWrites++;const message:ChatMessage={id:randomUUID(),childId,authorUserId:user.id,role:'user',text:'',
          inReplyTo:null,createdAt:'2026-10-24T00:01:00.000Z',photo:reference()};messages.push(message);result={message};
      }
      const receipt:OnlineReceipt={state:'confirmed',operation:submission.operation,path:submission.path,changeSeq:String(receipts.size+1),statusCode:201,result};
      receipts.set(submission.operation.opId,receipt);
      if(messageWrites===2)return Response.json(receipt);
      // Both writes committed; their responses were lost. Recovery must read their original receipts.
      throw new Error('Synthetic lost response');
    }
    if(path===`/api/children/${childId}/photos/${photoId}/content`){
      assert.deepEqual(body,{base64:'AQ=='});uploads++;assert.ok(photo);photo={...photo,state:'ready',version:2};
      throw new Error('Synthetic lost upload response');
    }
    if(path===`/api/children/${childId}/photos/${photoId}`){
      if(delayPhoto)await new Promise<void>(resolve=>{release=resolve;});
      if(photoMissing)return Response.json({error:{code:'not_found'}},{status:404});
      assert.ok(photo);return Response.json({photo});
    }
    if(path===`/api/children/${childId}/messages`)return Response.json({messages,limit:100});
    if(path.endsWith('/reply'))return Response.json({reply:null});
    if(path==='/api/ai/status')return Response.json({available:true});
    if(path==='/api/ai/usage')return Response.json({day:'2026-10-24',attempts:0,inputTokens:0,outputTokens:0,cachedTokens:0,unknownUsageAttempts:0});
    throw new Error(`Unexpected synthetic route ${path}`);
  };
  const api=createPhotoApi('https://synthetic.test',fetcher,hash);
  const owner=new ChatPhotoUploadController(api,hash,()=>assert.fail('Unexpected access loss'));
  const scope={key:'parent:child',userId:user.id,childId};owner.syncContext(scope,true);
  const input={id:'local-photo',photo:{fileName:'photo.png',mimeType:'image/png' as const,bytes:1,sha256,imageSource:{uri:'local:photo'},
    async readBase64(){localReads++;return 'AQ==';}}};
  assert.equal(await owner.prepare(input),null);assert.equal(owner.getSnapshot().unknown,true);
  assert.equal(await owner.prepare(input),null);assert.equal(photoWrites,1);assert.equal(uploads,0);
  assert.equal(await owner.discard(),false);
  await owner.check();assert.equal(owner.getSnapshot().photo?.id,photoId);assert.equal(owner.getSnapshot().unknown,false);
  assert.equal(await owner.prepare(input),null);assert.equal(uploads,1);assert.equal(owner.getSnapshot().unknown,true);
  await owner.check();const ready=await owner.prepare(input);assert.equal(ready?.version,2);assert.equal(localReads,2);
  assert.equal(photoWrites,1);assert.equal(uploads,1);

  const chatApi=createChatApi('https://synthetic.test',async()=>currentUser,fetcher),chat=new ChatController(chatApi);
  chat.syncContext(user.id,true,childId);await new Promise<void>(resolve=>setTimeout(resolve,0));
  assert.ok(chat.getSnapshot().loadedAt);
  await assert.rejects(chatApi.saveMessage(childId,'',new AbortController().signal,user.id,{id:randomUUID(),version:1},undefined,ready!),
    error=>error instanceof ChatApiError&&error.code==='invalid_input');
  await chat.send(undefined,undefined,ready!);
  assert.equal(chat.getSnapshot().drafts[childId].phase,'save_unknown');assert.equal(messageWrites,1);
  await chat.reloadMessages();
  assert.equal(chat.getSnapshot().drafts[childId].savedUserMessageId,messages[0].id);
  assert.equal(chat.getSnapshot().drafts[childId].phase,'reply_failed');assert.equal(messageWrites,1);assert.equal(lookups,2);
  assert.deepEqual(chat.getSnapshot().messages[0].photo,reference());assert.equal(photo!.version,2);
  owner.linked(messages[0].id,photoId);assert.equal(owner.getSnapshot().photo,null);assert.ok(photo);
  chat.dispose();
  const reopened=new ChatController(chatApi);reopened.syncContext(user.id,true,childId);
  await new Promise<void>(resolve=>setTimeout(resolve,0));assert.deepEqual(reopened.getSnapshot().messages[0].photo,reference());

  const oldReference=reference();photo={...savedPhoto(),version:3};
  assert.equal((await owner.prepareReference(oldReference,'library-photo'))?.version,3);
  assert.equal(photoWrites,1);assert.equal(uploads,1);
  const reused=await chatApi.saveMessage(childId,'',new AbortController().signal,user.id,undefined,undefined,owner.getSnapshot().photo!);
  assert.equal(reused.photo?.version,3);assert.equal(messageWrites,2);assert.equal(photo!.version,3);
  assert.equal(await owner.discard(),true);assert.ok(photo);
  photo={...photo!,recoveryPending:true};assert.equal(await owner.prepareReference(oldReference,'library-photo'),null);
  assert.equal(owner.getSnapshot().photo,null);photo={...photo!,recoveryPending:false};
  delayPhoto=true;const delayed=owner.prepareReference(oldReference,'library-photo');
  owner.syncContext({key:'other:child',userId:'other',childId},true);
  currentUser={...user,id:'other'};reopened.syncContext('other',false,childId);
  assert.ok(release);release();await delayed;
  assert.equal(owner.getSnapshot().photo,null);assert.equal(owner.getSnapshot().localId,null);
  assert.deepEqual(reopened.getSnapshot().messages,[]);assert.deepEqual(reopened.getSnapshot().drafts,{});
  delayPhoto=false;owner.syncContext(scope,true);
  assert.ok(await owner.prepareReference(oldReference,'library-photo'));
  photoMissing=true;await owner.check();
  assert.equal(owner.getSnapshot().photo,null);assert.equal(owner.getSnapshot().unknown,false);
  assert.equal(await owner.prepare({...input,id:'library-photo'}),null);
  assert.equal(await owner.prepareReference(oldReference,'library-photo'),null);
  assert.equal(photoWrites,1);assert.equal(uploads,1);assert.equal(await owner.discard(),true);
  owner.syncContext(scope,false);assert.equal(await owner.prepare(input),null);
  assert.equal(photoWrites,1);assert.equal(uploads,1);owner.dispose();reopened.dispose();
});
