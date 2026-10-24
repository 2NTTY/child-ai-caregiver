import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import type {Firestore} from '@google-cloud/firestore';
import {FinishReason} from '@google/genai';
import {firestoreDomainFixture} from './helpers/firestore-domain-memory.ts';
import {createStorageCipher} from '../server/storage-crypto.ts';
import {createFirestoreAuthority} from '../server/firestore-authority.ts';
import {createFirestoreChatStore} from '../server/firestore-chat.ts';
import {createFirestoreCareStore} from '../server/firestore-care.ts';
import {createFirestoreMemoryStore} from '../server/firestore-memory.ts';
import {createFirestoreOnlineStore} from '../server/firestore-online.ts';
import {createFirestoreAgentRuns} from '../server/firestore-agent-runs.ts';
import {createFirestoreProductAgent} from '../server/firestore-product-agent.ts';
import {createFirebaseNodeHandler} from '../server/firebase-http.ts';
import {handleProductAgentRequest} from '../server/product-agent-api.ts';
import {ChatController} from '../src/client/chat-controller.ts';
import {handleChatRequest} from '../server/chat-api.ts';
import {createChatApi} from '../src/client/chat-api.ts';
import {readAiConfig} from '../server/ai-config.ts';
import {SERVICE_POLICY_VERSION} from '../src/shared/account-service.ts';
import { AGENT_PROGRESS_LABELS, agentProgressSchema } from '../src/shared/agent-feedback.ts';

function deferred<T>() { let resolve!: (value:T)=>void; const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve}; }

test('formal HTTP streams real Runner progress before saving and disconnect reads the original result without another run',{timeout:10000},async()=>{
  const fake=firestoreDomainFixture();
  function query(raw:any):any {return new Proxy(raw,{get(target,key){if(key==='get')return ()=>fake.database.runTransaction(tx=>tx.get(target));
    const value=target[key];return typeof value==='function'? (...args:any[])=>{const result=value(...args);return result?.query?query(result):result?.path?{...result,id:result.path.split('/').at(-1)}:result;}:value;}});}
  const database={...fake.database,collection:(path:string)=>query(fake.database.collection(path))} as Firestore;
  const options={database,projectId:'synthetic-feedback',namespace:'unit_feedback',cipher:createStorageCipher(Buffer.alloc(32,64))};
  const authority=createFirestoreAuthority(options);
  await authority.initializeControl({generation:randomUUID(),enabled:true});
  await authority.issueInvitation({email:'owner@example.test',operationId:randomUUID(),expiresAt:new Date(Date.now()+60000).toISOString()});
  await authority.admitIdentity({userId:'owner',email:'owner@example.test',emailVerified:true});
  await authority.acknowledge({userId:'owner',operationId:randomUUID(),policyVersion:SERVICE_POLICY_VERSION});
  const {child}=await authority.createChild({userId:'owner',displayName:'合成孩子',operationId:randomUUID()});
  let saved=deferred<void>(),gate=deferred<void>(),entered=deferred<void>(),calls=0,step=0,medical=true;
  const realChat=createFirestoreChatStore(options),chat={...realChat,async createModelMessageForUser(...args:Parameters<typeof realChat.createModelMessageForUser>){
    const result=await realChat.createModelMessageForUser(...args);saved.resolve();return result;
  }};
  const care=createFirestoreCareStore(options),memory=createFirestoreMemoryStore({...options,chat,care});
  const online=createFirestoreOnlineStore({...options,mutations:[chat.mutation,care.mutation,memory.mutation]});
  const product=await createFirestoreProductAgent({...options,chat,care,memory,online,config:readAiConfig({AI_ENABLED:'true',GCP_PROJECT_ID:options.projectId}),
    platformProvider:{async generate(){calls++;step++;entered.resolve();
      const card=medical&&step===1;
      if(!card) await gate.promise;
      return {content:{role:'model',parts:[{functionCall:{id:'step-'+step,name:card?'show_official_help':'present_answer',
        args:card?{card:'medical-consult-hk-v1'}:{kind:'clarification',paragraphs:[{text:'已儲存任務候選，仍待你確認。',citationIds:[]}]}}}]},
        finishReason:FinishReason.STOP,usageMetadata:{promptTokenCount:10,candidatesTokenCount:5}};
    }}});
  let origin='',posts=0;
  const server=createServer((req,res)=>{void createFirebaseNodeHandler({publicOrigin:origin,auth:{fromNodeHeaders(headers){
    const value=new Headers();for(const [key,item]of Object.entries(headers))if(typeof item==='string')value.set(key,item);return value;
  }},handler:request=>{if(request.method==='POST')posts++;if(new URL(request.url).pathname.endsWith('/messages'))return handleChatRequest(request,'owner',chat);return handleProductAgentRequest(request,'owner',{agent:product.agent,store:product.store,chat,isCurrentUser:async()=>true});}})(req,res);});
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+(server.address() as {port:number}).port;
  const api=createChatApi(origin,async()=>({id:'owner',name:'Owner',email:'owner@example.test'}),(input,init)=>fetch(input,{...init,headers:{...init?.headers,origin}}));
  try {
    const original=await chat.createUserMessageForUser('owner',child.id,'我想整理用藥方面要問醫生的問題。');
    assert.equal(await api.getOriginalReply!(child.id,original!.id,new AbortController().signal,'owner'),null);
    const progress:string[]=[],seen=deferred<void>();
    const response=api.requestReply(child.id,original!.id,new AbortController().signal,'owner',event=>{progress.push(event.phase);if(event.card)seen.resolve();});
    await seen.promise;
    assert.ok(progress.includes('started'));assert.ok(progress.includes('help'));
    assert.equal((await chat.listForUser('owner',child.id))!.messages.filter(m=>m.role==='model').length,0,'progress must arrive before the final answer exists');
    gate.resolve();const message=await response;await saved.promise;
    assert.deepEqual(message.officialHelp,['medical-consult-hk-v1']);assert.equal(calls,2);
    assert.deepEqual((await chat.listForUser('owner',child.id))!.messages.find(m=>m.id===message.id)?.officialHelp,message.officialHelp);
    // A second ordinary run loses only its channel, not its operation or final save.
    medical=false;step=0;gate=deferred<void>();saved=deferred<void>();
    const ordinary=await chat.createUserMessageForUser('owner',child.id,'幫我整理日常問題。');
    const interrupted=await fetch(origin+`/api/children/${child.id}/messages/${ordinary!.id}/reply`,{method:'POST',headers:{origin,accept:'text/event-stream','content-type':'application/json','x-expected-user-id':'owner'},body:'{}'});
    const reader=interrupted.body!.getReader(),first=new TextDecoder().decode((await reader.read()).value);
    const initial=JSON.parse(first.split('data: ')[1].split('\n\n')[0]);assert.equal(initial.type,'progress');
    await reader.cancel();
    // A fresh device has no run ID or local draft. It discovers the original operation by saved message identity.
    const reopened = new ChatController({...api,getStatus:async()=>true,getUsage:async()=>({day:'2026-10-16',attempts:0,inputTokens:0,outputTokens:0,cachedTokens:0,unknownUsageAttempts:0})});
    const recovered=deferred<void>();const stop=reopened.subscribe(()=>{if(reopened.getSnapshot().remoteReply?.status==='running'&&!reopened.getSnapshot().loading)recovered.resolve();});
    reopened.syncContext('owner',true,child.id);await recovered.promise;stop();
    assert.equal(reopened.getSnapshot().remoteReply?.runId,initial.progress.runId);
    reopened.setText('這是另一設備未發送的草稿');
    await reopened.requestReply(ordinary!.id);
    assert.equal(posts,2,'checking an existing run cannot POST another execution');
    assert.equal(reopened.getSnapshot().drafts[child.id]?.text,'這是另一設備未發送的草稿');
    await assert.rejects(api.getOriginalReply!(child.id,ordinary!.id,new AbortController().signal,'different-user'),error=>(error as {status:number}).status===409);
    await assert.rejects(api.getOriginalReply!(randomUUID(),ordinary!.id,new AbortController().signal,'owner'),error=>(error as {status:number}).status===404);
    gate.resolve();await saved.promise;
    await reopened.refreshOriginalReply();
    assert.ok(reopened.getSnapshot().messages.some(item=>item.inReplyTo===ordinary!.id));
    assert.equal(reopened.getSnapshot().remoteReply,null);
    assert.equal(reopened.getSnapshot().drafts[child.id]?.text,'這是另一設備未發送的草稿');
    reopened.syncContext('different-user',false,null);
    assert.deepEqual(reopened.getSnapshot().messages,[]);assert.deepEqual(reopened.getSnapshot().drafts,{});reopened.dispose();
    assert.equal(await api.getReplyState!(child.id,initial.progress.runId,new AbortController().signal,'owner'),'completed');
    const second=(await chat.listForUser('owner',child.id))!.messages.find(m=>m.inReplyTo===ordinary!.id)!;
    assert.deepEqual(second.officialHelp,[]);assert.equal(posts,2);assert.equal(calls,3);
    // The legacy JSON channel has the same detach semantics as SSE.
    step=0;gate=deferred<void>();saved=deferred<void>();entered=deferred<void>();
    const jsonMessage=await chat.createUserMessageForUser('owner',child.id,'幫我整理準備事項。');
    const abort=new AbortController();
    const pending=fetch(origin+`/api/children/${child.id}/messages/${jsonMessage!.id}/reply`,{method:'POST',signal:abort.signal,
      headers:{origin,accept:'application/json','content-type':'application/json','x-expected-user-id':'owner'},body:'{}'}).catch(()=>null);
    await entered.promise;abort.abort();await pending;gate.resolve();await saved.promise;
    const third=(await chat.listForUser('owner',child.id))!.messages.find(m=>m.inReplyTo===jsonMessage!.id)!;
    assert.equal((await product.store.get('owner',child.id,third.agentRunId!))!.status,'completed');
    assert.equal(calls,4);assert.equal(posts,3);

  } finally {gate.resolve();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});

// One transaction scenario covers late settlement, observer expiry and terminal fencing.
test('expired execution saves its real result without reviving work or overwriting cancellation',async()=>{
  const fake=firestoreDomainFixture();let clock=Date.now();
  const options={database:fake.database,projectId:'synthetic-settlement',namespace:'unit_settlement',
    cipher:createStorageCipher(Buffer.alloc(32,65)),serverClock:()=>clock};
  const authority=createFirestoreAuthority(options);
  await authority.initializeControl({generation:randomUUID(),enabled:true});
  await authority.issueInvitation({email:'owner@example.test',operationId:randomUUID(),expiresAt:new Date(clock+60000).toISOString()});
  await authority.admitIdentity({userId:'owner',email:'owner@example.test',emailVerified:true});
  await authority.acknowledge({userId:'owner',operationId:randomUUID(),policyVersion:SERVICE_POLICY_VERSION});
  const {child}=await authority.createChild({userId:'owner',displayName:'合成孩子',operationId:randomUUID()});
  const chat=createFirestoreChatStore(options),care=createFirestoreCareStore(options),memory=createFirestoreMemoryStore({...options,chat,care});
  const runs=createFirestoreAgentRuns({...options,chat,memory});
  const message=await chat.createUserMessageForUser('owner',child.id,'需要整理');
  const claim=await runs.claim('owner',child.id,{kind:'interactive',reference:message!.id},'product-interactive');
  clock=Date.parse(claim.expiresAt)+1;
  assert.equal(await runs.authorize(claim.scope,claim.runId),false,'expiry still prevents model/tools');
  const projection={async read(_b:any,_run:any,result:any){return result;}};
  assert.equal((await runs.result('owner',child.id,claim.runId,projection))!.stopReason,'interrupted');
  const result={runId:claim.runId,status:'stopped' as const,stopReason:'deadline',provenance:null,countsKnown:true,text:'',
    citations:[],privateSourceCitations:[],retrievalMode:'not_used' as const,tools:[],counts:{modelCalls:5,toolCalls:5,queryEmbeddings:1},proposals:[]};
  assert.equal(await runs.finish(claim.scope,result),true);
  const reopened=createFirestoreAgentRuns({...options,chat,memory});
  assert.equal((await reopened.result('owner',child.id,claim.runId,projection))!.stopReason,'deadline');
  assert.deepEqual((await reopened.result('owner',child.id,claim.runId,projection))!.counts,result.counts);
  assert.equal(await reopened.finish(claim.scope,{...result,stopReason:'unavailable'}),false,'settled results are immutable');
  assert.equal(await reopened.authorize(claim.scope,claim.runId),false);
  const next=await chat.createUserMessageForUser('owner',child.id,'另一個問題');
  const cancelled=await runs.claim('owner',child.id,{kind:'interactive',reference:next!.id},'product-interactive');
  assert.equal(await runs.cancelReply('owner',child.id,next!.id),true);
  clock=Date.parse(cancelled.expiresAt)+1;
  assert.equal(await runs.finish(cancelled.scope,{...result,runId:cancelled.runId}),false);
  assert.equal((await runs.result('owner',child.id,cancelled.runId,projection))!.stopReason,'cancelled');
});

test('reviewing phase is a real progress event with a parent-facing label', () => {
  const runId = randomUUID(), messageId = randomUUID();
  const parsed = agentProgressSchema.parse({ runId, messageId, phase: 'reviewing' });
  assert.equal(parsed.phase, 'reviewing');
  assert.equal(AGENT_PROGRESS_LABELS.reviewing, '正在獨立核對回覆');
});
