import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createHandoverApi } from '../../../src/client/handover-api.ts';
import { createMixedChatApi } from '../../../src/client/mixed-chat-api.ts';
import { HandoverImportOwner } from './HandoverImportOwner.ts';
import { MixedChatController } from './MixedChatController.ts';

test('mixed transcript recipient explicitly maps a whole room and recovers the original import request', async () => {
  const childIds=[randomUUID(),randomUUID()], localIds=[randomUUID(),randomUUID()], roomId=randomUUID(), uploadId=randomUUID();
  const at='2026-11-11T12:00:00.000Z', manifestSha256='a'.repeat(64), packageId=randomUUID();
  const upload={id:uploadId,version:2,filename:'conversation.zip',bytes:3,state:'ready',error:null,createdAt:at,expiresAt:'2026-11-12T12:00:00.000Z',
    preview:{integrity:'trusted',manifestSha256,children:childIds.map((id,index)=>({id,displayName:'Source '+index})),coverage:[],
      header:{format:'yuyoufang-data',version:4,packageId,packageVersion:1,createdAt:at,purpose:'handover',
        source:{serverId:'https://source.example.test',accountId:'source'},mixedAuthorAccountId:'source',
        selection:{childIds,modules:[],period:null,mixedRooms:[{id:roomId,version:3,childIds}]}}}};
  let advertised=false, lost=true, batch: any;
  const commands: any[]=[];
  const api=createHandoverApi('https://example.test',async (url,init)=>{
    const headers=new Headers(init?.headers);if(String(url).includes('/package-imports'))assert.equal(headers.get('x-handover-mixed-import'),'1');
    assert.equal(headers.get('x-expected-user-id'),'recipient');assert.equal(init?.credentials,'include');
    if(String(url).endsWith('/capabilities'))return Response.json({classEnrolment:false,...(advertised?{mixedConversationImport:true}:{})});
    if(String(url).includes('/package-uploads/'))return Response.json(upload);
    if(init?.method==='GET')return Response.json(batch);
    const command=JSON.parse(String(init?.body));commands.push(command);
    batch={id:command.opId,version:1,uploadId,packageId,packageVersion:1,manifestSha256,integrity:'trusted',targets:command.targets,
      state:'queued',processedItems:0,totalItems:2,counts:{created:0,updated:0,skipped:0,conflict:0},error:null,createdAt:at,updatedAt:at};
    if(lost){lost=false;throw Error('Lost original import response');}return Response.json(batch);
  });
  const owner=new HandoverImportOwner(api);owner.syncContext('recipient','recipient:1',true);
  const targets=childIds.map((sourceChildId,index)=>({sourceChildId,target:{childId:localIds[index],spaceId:null},sections:[]}));
  await owner.readImportCapabilities();assert.equal(owner.getSnapshot().mixedConversationImportEnabled,false);
  await owner.openUpload(uploadId);await owner.create(targets,false,[roomId]);assert.equal(commands.length,0,'An older server without the capability cannot import a conversation');
  advertised=true;await owner.readImportCapabilities();assert.equal(owner.getSnapshot().mixedConversationImportEnabled,true);
  await owner.create(targets,false);assert.equal(commands.length,0,'Mapping alone does not select a whole conversation');
  await owner.create(targets.slice(0,1),false,[roomId]);assert.equal(commands.length,0,'All room children must be mapped');
  await owner.create(targets.map(row=>({...row,target:targets[0].target})),false,[roomId]);assert.equal(commands.length,0,'Different source children require different targets');
  await owner.create(targets.map((row,index)=>({...row,target:{...row.target,spaceId:index?randomUUID():null}})),false,[roomId]);
  assert.equal(commands.length,0,'One room cannot cross personal and class scopes');
  await owner.create(targets,false,[roomId]);assert.equal(commands.length,1);assert.deepEqual(commands[0].mixedRoomIds,[roomId]);
  assert.deepEqual(commands[0].targets,targets);assert.ok(owner.getSnapshot().pending);
  await owner.create(targets,false,[roomId]);assert.equal(commands.length,1,'Unknown original request prevents blind resend');
  await owner.checkOriginal();assert.equal(owner.getSnapshot().pending,null);assert.equal(owner.getSnapshot().items[0].id,commands[0].opId);
  owner.syncContext('other','other:1',true);assert.equal(owner.getSnapshot().mixedConversationImportEnabled,false);
});

test('mixed transcript history reads original replies across pages without restarting source runs or leaking late responses', async () => {
  const localIds=[randomUUID(),randomUUID()],roomId=randomUUID(),at='2026-11-11T12:00:00.000Z';
  const messageIds=[randomUUID(),randomUUID(),randomUUID()], statuses=['completed','stopped','running'] as const;
  const room={id:roomId,version:5,scope:{kind:'personal'},childIds:localIds,createdAt:at,updatedAt:at};
  const messages=messageIds.map((id,index)=>({id,roomId,version:index+2,role:'user',text:'Imported '+index,createdAt:at}));
  const citation={sourceId:'source',versionId:'v1',chunkId:'c1',title:'Original reference',url:'https://example.test/source',section:'Care'};
  const archivedReplies=messageIds.map((messageId,index)=>({messageId,reply:statuses[index]==='completed'
    ?{status:'completed',text:'Original answer',citations:[citation]}:{status:statuses[index]}}));
  const replyCalls: string[]=[], writes: string[]=[];let hold=false, release: (()=>void)|undefined;
  const mixed=createMixedChatApi('https://example.test',async (url,init)=>{
    assert.equal(new Headers(init?.headers).get('x-expected-user-id'),'recipient');
    if(String(url).endsWith('/mixed-chats'))return Response.json({rooms:[room],nextCursor:null});
    if(String(url).endsWith('/reply')){replyCalls.push(String(init?.method));return Response.json({result:{runId:randomUUID(),status:'completed',stopReason:null,
      text:'New local answer',citations:[],retrievalMode:'not_used',tools:[],counts:{modelCalls:1,toolCalls:0,queryEmbeddings:0},proposals:[],provenance:null}});}
    if(init?.method==='POST'){writes.push(String(url));const body=JSON.parse(String(init.body));
      return Response.json({message:{id:randomUUID(),roomId,version:body.expectedVersion+1,role:'user',text:body.text,createdAt:at}});}
    assert.equal(new Headers(init?.headers).get('x-handover-mixed-import'),'1');
    const more=String(url).includes('cursor=older');
    const response=Response.json({room,messages:more?messages.slice(0,1):messages.slice(1),
      archivedReplies:more?archivedReplies.slice(0,1):archivedReplies.slice(1),nextCursor:more?null:'older'});
    return hold?new Promise<Response>(resolve=>{release=()=>resolve(response);}):response;
  });
  const conversation=new MixedChatController(mixed);conversation.syncContext('recipient','recipient:1',true,{kind:'personal'},'own');
  await conversation.loadRooms();assert.equal(conversation.getSnapshot().rooms[0].id,roomId,'The existing conversation list exposes the imported room');
  await conversation.openRoom(roomId);assert.equal(replyCalls.length,0);
  await conversation.openRoom(roomId,true);assert.equal(replyCalls.length,0);
  assert.equal(Object.keys(conversation.getSnapshot().archivedReplies).length,3,'Older archived replies merge into the same room');
  assert.deepEqual(conversation.getSnapshot().archivedReplies[messageIds[0]],archivedReplies[0].reply);
  for(const id of messageIds){await conversation.startReply(id);await conversation.stopReply(id);await conversation.readReply(id);}
  assert.equal(replyCalls.length,0,'Archived original runs are never looked up, restarted or stopped locally');
  conversation.setDraft('A new local question');await conversation.send();assert.equal(writes.length,1);
  assert.deepEqual(replyCalls,['POST'],'Only the new local question may start a model reply');
  assert.equal(conversation.getSnapshot().pending,null);
  hold=true;const stale=conversation.openRoom(roomId);await new Promise(resolve=>setTimeout(resolve,0));
  conversation.syncContext('other','other:1',true,{kind:'personal'},'other');release?.();await stale;
  assert.deepEqual(conversation.getSnapshot().archivedReplies,{});assert.deepEqual(conversation.getSnapshot().messages,[]);
});
