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
import {createFirestoreProductAgent} from '../server/firestore-product-agent.ts';
import {createFirebaseNodeHandler} from '../server/firebase-http.ts';
import {handleProductAgentRequest} from '../server/product-agent-api.ts';
import {createChatApi} from '../src/client/chat-api.ts';
import {readAiConfig} from '../server/ai-config.ts';
import {SERVICE_POLICY_VERSION} from '../src/shared/account-service.ts';

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
  let saved=deferred<void>(),gate=deferred<void>(),calls=0,step=0,medical=true;
  const realChat=createFirestoreChatStore(options),chat={...realChat,async createModelMessageForUser(...args:Parameters<typeof realChat.createModelMessageForUser>){
    const result=await realChat.createModelMessageForUser(...args);saved.resolve();return result;
  }};
  const care=createFirestoreCareStore(options),memory=createFirestoreMemoryStore({...options,chat,care});
  const online=createFirestoreOnlineStore({...options,mutations:[chat.mutation,care.mutation,memory.mutation]});
  const product=await createFirestoreProductAgent({...options,chat,care,memory,online,config:readAiConfig({AI_ENABLED:'true',GCP_PROJECT_ID:options.projectId}),
    platformProvider:{async generate(){calls++;step++;
      const card=medical&&step===1;
      if(!card) await gate.promise;
      return {content:{role:'model',parts:[{functionCall:{id:'step-'+step,name:card?'show_official_help':'present_answer',
        args:card?{card:'medical-consult-hk-v1'}:{kind:'clarification',paragraphs:[{text:'可以幫你整理到診問題。',citationIds:[]}]}}}]},
        finishReason:FinishReason.STOP,usageMetadata:{promptTokenCount:10,candidatesTokenCount:5}};
    }}});
  let origin='',posts=0;
  const server=createServer((req,res)=>{void createFirebaseNodeHandler({publicOrigin:origin,auth:{fromNodeHeaders(headers){
    const value=new Headers();for(const [key,item]of Object.entries(headers))if(typeof item==='string')value.set(key,item);return value;
  }},handler:request=>{if(request.method==='POST')posts++;return handleProductAgentRequest(request,'owner',{agent:product.agent,store:product.store,chat,isCurrentUser:async()=>true});}})(req,res);});
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+(server.address() as {port:number}).port;
  const api=createChatApi(origin,async()=>({id:'owner',name:'Owner',email:'owner@example.test'}),(input,init)=>fetch(input,{...init,headers:{...init?.headers,origin}}));
  try {
    const original=await chat.createUserMessageForUser('owner',child.id,'我想整理用藥方面要問醫生的問題。');
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
    await reader.cancel();gate.resolve();await saved.promise;
    assert.equal(await api.getReplyState!(child.id,initial.progress.runId,new AbortController().signal,'owner'),'completed');
    const second=(await chat.listForUser('owner',child.id))!.messages.find(m=>m.inReplyTo===ordinary!.id)!;
    assert.deepEqual(second.officialHelp,[]);assert.equal(posts,2);assert.equal(calls,3);
  } finally {gate.resolve();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
