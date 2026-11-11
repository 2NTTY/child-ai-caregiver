import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreSharingStore } from '../server/firestore-sharing.ts';
import { createFirestoreChatStore } from '../server/firestore-chat.ts';
import { createFirestoreAccountExport } from '../server/firestore-account-export.ts';
import { createFirestoreAgentRuns } from '../server/firestore-agent-runs.ts';
import { createProductAgentTools } from '../server/product-agent-tools.ts';
import { createFirestoreProductAgent } from '../server/firestore-product-agent.ts';
import { createFirestoreCareStore } from '../server/firestore-care.ts';
import { createFirestoreMemoryStore } from '../server/firestore-memory.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { readAiConfig } from '../server/ai-config.ts';
import { createFirebaseRequestHandler } from '../server/firebase-app.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';

test('mixed messages are account-private, idempotent and lose disclosure when class access ends', async () => {
  const { database } = serialFirestoreFixture();
  const options = { database, cipher: createStorageCipher(Buffer.alloc(32, 70)), namespace:'test_mixed', projectId:'demo-mixed',
    serverClock: Date.now };
  const authority = createFirestoreAuthority(options), sharing = createFirestoreSharingStore(options);
  await authority.initializeControl({ generation:randomUUID(), enabled:true });
  for (const userId of ['owner','colleague']) {
    const email = userId+'@example.test';
    await authority.issueInvitation({email, expiresAt:new Date(Date.now()+86400000).toISOString(),operationId:randomUUID()});
    await authority.admitIdentity({userId,email,emailVerified:true});
    await authority.acknowledge({userId,policyVersion:SERVICE_POLICY_VERSION,operationId:randomUUID()});
  }
  const origin='https://example.test';
  let actor='owner', expireOnRead=0, product;
  const server = () => createFirebaseRequestHandler({ authority, product, chat:createFirestoreChatStore(options),
    auth:{getSession:async()=>expireOnRead>0 && --expireOnRead===0 ? null : {user:{id:actor}},
      handler:async()=>new Response(null,{status:404})},publicOrigin:origin,mailConfigured:true });
  let handle=server();
  const call = (path,body) => handle(new Request(origin+'/api/account/mixed-chats'+path,{ method:body?'POST':'GET',
    headers:{origin,'content-type':'application/json','x-expected-user-id':actor}, ...(body ? {body:JSON.stringify(body)} : {}) }));
  let classroom=await sharing.create(actor,{kind:'class',name:'Class',operationId:randomUUID()});
  const childIds=[];
  for (const name of ['同名','同名']) {
    const added=await sharing.addClassChild(actor,{spaceId:classroom.id,expectedVersion:classroom.version,displayName:name,operationId:randomUUID()});
    classroom=added.space; childIds.push(added.child.id);
  }
  const invitation=await sharing.invite('owner',{spaceId:classroom.id,expectedVersion:classroom.version,operationId:randomUUID(),
    email:'colleague@example.test',role:'viewer',expiresAt:'2099-11-15T00:00:00Z'});
  classroom=await sharing.acceptInvitation('colleague',{token:invitation.token,operationId:randomUUID()});
  actor='colleague';
  const scope={kind:'class',spaceId:classroom.id,spaceVersion:classroom.version,teacherSpaceVersion:null};
  const selection={scope,childIds,operationId:randomUUID()};
  const created=await call('',selection);
  assert.equal(created.status,201);
  const {room}=await created.json(), path='/'+room.id;
  assert.deepEqual((await (await call('',selection)).json()).room,room);
  assert.equal((await call('',{...selection,childIds:childIds.slice(0,1)})).status,409);
  const input={text:'這是我對兩個孩子的私人問題',expectedVersion:1,operationId:randomUUID()};
  expireOnRead=2;
  const lostReceipt=await call(path+'/messages',input);
  assert.equal(lostReceipt.status,503);
  assert.equal((await lostReceipt.json()).error.code,'operation_result_unknown');
  const sent=await call(path+'/messages',input);
  assert.equal(sent.status,201);
  const {message}=await sent.json();
  const chat=createFirestoreChatStore(options);
  const runs=createFirestoreAgentRuns({...options,chat,memory:{}});
  const claimed=await runs.claimMixed(actor,room.id,message.id);
  const repeated=await runs.claimMixed(actor,room.id,message.id);
  assert.equal(claimed.created,true);
  assert.equal(repeated.created,false);
  assert.equal(repeated.runId,claimed.runId);
  assert.equal(await runs.authorizeMixed(actor,room.id,message.id,claimed.runId),true);
  assert.equal((await runs.mixedResult(actor,room.id,message.id,true)).stopReason,'cancelled');
  assert.equal((await runs.claimMixed(actor,room.id,message.id)).state,'stopped');
  assert.equal((await (await call(path+'/messages',input)).json()).message.id,message.id);
  assert.equal((await call(path+'/messages',{...input,text:'另一問題'})).status,409);
  assert.equal((await call(path+'/messages',{...input,operationId:randomUUID()})).status,409);
  handle=server();
  const history=await (await call(path)).json();
  assert.deepEqual(history.messages.map(m=>m.text),[input.text]);
  assert.deepEqual((await (await call('')).json()).rooms.map(r=>r.id),[room.id]);
  const care=createFirestoreCareStore(options),memory=createFirestoreMemoryStore({...options,chat,care}),online=createFirestoreOnlineStore(options);
  let generations=0, blockGeneration=false;
  const started=Promise.withResolvers(), finish=Promise.withResolvers();
  product=await createFirestoreProductAgent({...options,chat,care,memory,online,
    config:readAiConfig({AI_ENABLED:'true',GCP_PROJECT_ID:options.projectId}),platformProvider:{async generate(request,signal){
      generations++;
      if (blockGeneration) {
        started.resolve(signal); await finish.promise;
        return {content:{role:'model',parts:[{text:'cancelled answer'}]},finishReason:'STOP'};
      }
      const parts=request.contents.flatMap(content=>content.parts??[]);
      const respond=part=>({content:{role:'model',parts:[part]},finishReason:'STOP',usageMetadata:{promptTokenCount:10,candidatesTokenCount:5}});
      if (generations===1) return respond({functionCall:{id:'read',name:'read_selected_tasks',args:{from:0}}});
      if (generations===2) {
        const evidence=JSON.stringify(parts.map(p=>p.functionResponse)).match(/tasks:[a-f0-9]{64}/u);
        assert.ok(evidence,'review must have an actual scope-bound task result');
        return respond({functionCall:{id:'present',name:'present_answer',args:{kind:'private_reference',
          paragraphs:[{text:'第一位選中的孩子目前沒有待辦。',citationIds:[evidence[0]]}]}}});
      }
      assert.equal(generations,3);
      const text=parts.map(p=>p.text??'').join('\n');
      const draft=JSON.parse(text.slice(text.indexOf('{')));
      assert.ok(draft.sources[0].excerpt.includes(childIds[0]) || draft.sources[0].excerpt.includes(childIds[1]));
      return respond({text:JSON.stringify({draftHash:draft.draftHash,decision:'pass',issues:[]})});
    }}});
  handle=server();
  const question=(await (await call(path+'/messages',{operationId:randomUUID(),expectedVersion:2,text:'呢兩位同學有咩待辦？'})).json()).message;
  const replyPath=path+'/messages/'+question.id+'/reply';
  const answer=(await (await call(replyPath,{})).json()).result;
  assert.equal(answer?.status,'completed',JSON.stringify(answer));
  assert.equal(answer.deliveryReview.decision,'pass');
  assert.equal((await (await call(replyPath)).json()).result.runId,answer.runId);
  assert.equal((await (await call(replyPath,{})).json()).result.runId,answer.runId);
  assert.equal(generations,3);
  const later=(await (await call(path+'/messages',{operationId:randomUUID(),expectedVersion:3,text:'再看看？'})).json()).message;
  const laterPath=path+'/messages/'+later.id+'/reply';
  blockGeneration=true;
  const pending=call(laterPath,{});
  const signal=await started.promise;
  const stopped=await handle(new Request(origin+'/api/account/mixed-chats'+laterPath,{method:'DELETE',
    headers:{origin,'x-expected-user-id':actor}}));
  const wasAborted=signal.aborted;
  finish.resolve(); await pending;
  assert.equal((await stopped.json()).result.stopReason,'cancelled');
  assert.equal(wasAborted,true,'stopping the original run interrupts the active provider call');
  const personal=[];
  for (const name of ['兄','弟']) personal.push((await authority.createChild({userId:actor,displayName:name,operationId:randomUUID()})).child.id);
  const both=await (await call('',{operationId:randomUUID(),scope:{kind:'personal'},childIds:personal})).json();
  assert.equal((await call('/'+both.room.id+'/messages',{...input,operationId:randomUUID()})).status,201);
  const exporter=createFirestoreAccountExport({...options,photos:{async content(){throw Error('unexpected photo');}}});
  assert.deepEqual((await createFirestoreChatStore(options).listForUser(actor,personal[0])).messages,[]);
  assert.deepEqual((await exporter.page(actor,{section:'chat', childId:personal[0]})).items,[]);
  actor='owner';
  assert.deepEqual((await (await call('')).json()).rooms,[]);
  assert.equal((await call(path)).status,404);
  await sharing.updateMember(actor,{operationId:randomUUID(),spaceId:classroom.id,expectedVersion:classroom.version,
    targetUserId:'colleague',role:null});
  actor='colleague';
  const revoked=await call(path);
  assert.notEqual(revoked.status,200);
  assert.ok(!(await revoked.text()).includes(input.text));
  assert.deepEqual((await (await call('')).json()).rooms.map(r=>r.id),[both.room.id]);
  assert.equal((await call(path+'/messages',input)).status,403);
  assert.equal((await call(replyPath)).status,403);
  assert.equal(await runs.authorizeMixed(actor,room.id,message.id,claimed.runId),false);
});

test('group task evidence returns a complete prefix and resumes at the first unread child within the model budget', async()=>{
  const children=Array.from({length:3},()=>({childId:randomUUID(),childName:'學生',tasks:[],nextCursor:null}));
  const run={scope:{userId:'member',childId:randomUUID()},runId:randomUUID(),budget:{toolResponseCharacters:830}};
  const surface=createProductAgentTools({run,authorize:async()=>true,store:{},memory:{},tasks:{},knowledge:{createRun:()=>({})},
    mixedTasks:async({from})=>({children:children.slice(from),nextFrom:null})});
  const read=surface.tools.find(tool=>tool.name==='read_selected_tasks');
  const page=await read.execute({from:0});
  assert.equal(page.data.result.children.length,1);
  assert.equal(page.data.result.nextFrom,1);
  assert.equal((await read.execute({from:1})).data.result.children[0].childId,children[1].childId);
  run.budget.toolResponseCharacters=520;
  assert.equal((await read.execute({from:0})).data.code,'response_limit');
});
