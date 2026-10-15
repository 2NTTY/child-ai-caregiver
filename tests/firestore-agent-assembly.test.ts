import type { AgentDiagnostic } from '../server/agent-observer.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {Firestore} from '@google-cloud/firestore';
import {FinishReason} from '@google/genai';
import {firestoreDomainFixture} from './helpers/firestore-domain-memory.ts';
import {createStorageCipher} from '../server/storage-crypto.ts';
import {createFirestoreAuthority} from '../server/firestore-authority.ts';
import {createFirestoreChatStore} from '../server/firestore-chat.ts';
import {createFirestoreCareStore} from '../server/firestore-care.ts';
import {createFirestoreMemoryStore} from '../server/firestore-memory.ts';
import {createFirestoreCareSummary} from '../server/firestore-care-summary.ts';
import {createFirestoreOnlineStore} from '../server/firestore-online.ts';
import {createFirestoreProductAgent} from '../server/firestore-product-agent.ts';
import {createFirestorePhotoStore} from '../server/firestore-photos.ts';
import {createFirestoreSharedInputStore} from '../server/firestore-shared-inputs.ts';
import {createPhotoAgent} from '../server/photo-agent.ts';
import {createSharedInputService} from '../server/shared-input-service.ts';
import {FirestoreDomainData} from '../server/firestore-domain-data.ts';
import {createFirestoreBackgroundQueue,prepareFirestoreBackgroundWork,readFirestoreBackgroundClaim,firestoreBackgroundReference,type FirestoreBackgroundDelivery} from '../server/firestore-background-work.ts';
import {readAiConfig} from '../server/ai-config.ts';
import {photoHash} from '../server/photo-files.ts';
import {SERVICE_POLICY_VERSION} from '../src/shared/account-service.ts';

test('production Runner assembly accepts persisted worker and capture claims, reads the real summary and retains cancellation and dedupe',async()=>{
  const diagnostics: AgentDiagnostic[] = [];
  const fake=firestoreDomainFixture();
  function query(raw:any):any {return new Proxy(raw,{get(target,key){if(key==='get')return ()=>fake.database.runTransaction(tx=>tx.get(target));
    const value=target[key];return typeof value==='function'? (...args:any[])=>{const result=value(...args);return result?.query?query(result):result?.path?{...result,id:result.path.split('/').at(-1)}:result;}:value;}});}
  const database={...fake.database,collection:(path:string)=>query(fake.database.collection(path))} as Firestore;
  const options={database,projectId:'synthetic-assembly',namespace:'unit_assembly',cipher:createStorageCipher(Buffer.alloc(32,63))};
  const authority=createFirestoreAuthority(options), data=new FirestoreDomainData(options), generation=randomUUID();
  await authority.initializeControl({generation,enabled:true});
  await authority.issueInvitation({email:'owner@example.test',operationId:randomUUID(),expiresAt:new Date(Date.now()+60000).toISOString()});
  await authority.admitIdentity({userId:'owner',email:'owner@example.test',emailVerified:true});
  await authority.acknowledge({userId:'owner',operationId:randomUUID(),policyVersion:SERVICE_POLICY_VERSION});
  const {child}=await authority.createChild({userId:'owner',displayName:'合成孩子',operationId:randomUUID()});
  const chat=createFirestoreChatStore(options),care=createFirestoreCareStore(options),memory=createFirestoreMemoryStore({...options,chat,care});
  const summary=createFirestoreCareSummary(options,care),sources=createFirestoreSharedInputStore(options);
  const online=createFirestoreOnlineStore({...options,mutations:[chat.mutation,care.mutation,memory.mutation,sources.mutation,summary.mutation]});
  let mode='background',step=0,calls=0;let failure:unknown;const cancel=new AbortController();
  const draft={text:'今天帶了手冊',kind:'note',rawValue:null,unit:null,approximate:false,timeRaw:'今天',uncertainties:[]};
  const product=await createFirestoreProductAgent({...options,diagnostics: event => { diagnostics.push(event); },chat,care,memory,online,summary,sources,
    config:readAiConfig({AI_ENABLED:'true',GCP_PROJECT_ID:options.projectId}),
    authorizeWorker:async(b,reference,recipe)=>{const job=await readFirestoreBackgroundClaim(data,b,reference);return !!job && recipe===(job.kind==='work-continuation'?'product-work-followup':'product-background');},
    platformProvider:{async generate(request){try {calls++;step++;assert.ok(step<=(mode==='work-continuation'?3:2),'No extra generation');
      if(mode==='cancel'){cancel.abort();return {content:{role:'model',parts:[{text:'discard'}]},finishReason:FinishReason.STOP};}
      const capture=mode==='photo'||mode==='shared', continuation=mode==='work-continuation';
      if(capture&&step===2)return {content:{role:'model',parts:[{text:'候選待核對。'}]},finishReason:FinishReason.STOP,usageMetadata:{promptTokenCount:10,candidatesTokenCount:5}};
      const load=continuation&&step===1, read=step===(continuation?2:1);
      const name=capture?(mode==='photo'?'present_photo_draft':'present_shared_draft'):load?'load_capabilities':read?'read_care_summary':'present_answer';
      const args=capture?draft:load?{capabilities:['documents']}:read?{startDay:'2026-10-13',period:'day',timeZone:'Asia/Hong_Kong'}:{kind:'record_restatement',paragraphs:[{text:'目前沒有已記錄事項，不代表沒有發生。',citationIds:[]}]};
      if(!capture&&!read&&!load)assert.ok(request.contents.some(c=>c.parts?.some(p=>p.functionResponse?.name==='read_care_summary')));
      return {content:{role:'model',parts:[{functionCall:{id:mode+'-'+step,name,args}}]},finishReason:FinishReason.STOP,usageMetadata:{promptTokenCount:10,candidatesTokenCount:5}};
    }catch(error){failure=error;throw error;}}}});
  const deliveries:FirestoreBackgroundDelivery[]=[];let results:any[]=[];
  const queue=createFirestoreBackgroundQueue({...options,enabled:true,readControl:async()=>({enabled:true,generation}),
    transport:{enqueue:async d=>{deliveries.push(d);return {state:'confirmed'};},probe:async()=>({state:'confirmed'})},
    execute:async(job,signal)=>{const result=await product.agent.background({userId:'owner',childId:child.id,reference:firestoreBackgroundReference(job),
      context:{eventType:job.kind==='work-continuation'?'work_continuation':'task_due'},authorize:async()=>true,signal});results.push(result);
      assert.equal(result?.status,'completed',JSON.stringify(result));assert.equal(result?.tools.find(t=>t.name==='read_care_summary')?.status,'succeeded');return {state:'completed'};}});
  for(const kind of ['task-agent','work-continuation'] as const){mode=kind;step=0;
    const workId=await authority.runTransaction('owner',child.id,async b=>{const job=await prepareFirestoreBackgroundWork(data,b.transaction,{kind,scope:b.scope,
      resourceId:randomUUID(),basis:'synthetic',generation:b.generation,authorizationVersion:b.authorizationVersion},new Date(Date.now()-1000).toISOString());job.commit();return job.id;});
    await queue.dispatch();const delivery=deliveries.find(d=>d.id===workId)!;const outcome=await queue.process(delivery);assert.ifError(failure);assert.equal(outcome.state,'completed',JSON.stringify(results));
    const before=calls;assert.equal((await queue.process(delivery)).state,'completed');assert.equal(calls,before);
  }
  const bytes=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(4),Buffer.from('IHDR'),Buffer.alloc(8)]),base64=bytes.toString('base64');
  let object:any;
  const photos=createFirestorePhotoStore({...options,objects:{async write(scope,id,input){const full={ownerUserId:scope.ownerUserId,workspaceId:scope.workspaceId,childId:scope.childId,storageEpoch:scope.storageEpoch};
    object={objectName:'photos/v1/'+photoHash(Buffer.from(JSON.stringify(['yuban-photo-object',1,options.projectId,options.namespace,full])))+'/'+id,
      generation:'1',cipherSha256:'1'.repeat(64),sha256:photoHash(bytes),bytes:bytes.length,mimeType:input.mimeType};return object;},
    async recover(){return object;},async read(){return {buffer:bytes,base64,mimeType:'image/png'};},async remove(){}},
    journal:{async writeOnce(){throw Error('No deletion in this scenario');},async read(){throw Error('No deletion in this scenario');}}});
  const photo=await photos.reserve('owner',child.id,randomUUID(),{fileName:'note.png',source:'synthetic',mimeType:'image/png',bytes:bytes.length,sha256:photoHash(bytes)});
  const ready=await photos.upload('owner',child.id,photo.id,base64);mode='photo';step=0;
  const photoAgent=createPhotoAgent(photos,product.runtime),signal=new AbortController().signal;
  const extracted=await photoAgent.extract('owner',child.id,photo.id,ready.version,signal,async()=>true);
  assert.equal(extracted?.extraction.state,'available',JSON.stringify(extracted));assert.deepEqual(extracted?.extraction.draft,draft);
  const previous=calls;await photoAgent.extract('owner',child.id,photo.id,ready.version,signal,async()=>true);assert.equal(calls,previous);
  const source=await sources.create('owner',child.id,{kind:'paste',text:'今天帶了手冊',sourceLabel:'合成文字',sourceUrl:null,sourceDateText:null});mode='shared';step=0;
  const service=createSharedInputService(sources,product.runtime);
  const shared=await service.extract('owner',child.id,source!.id,source!.version,'今天帶了手冊',signal,async()=>true);
  assert.equal(shared?.extraction.state,'available',JSON.stringify(shared));assert.deepEqual(shared?.extraction.draft,draft);
  const message=await chat.createUserMessageForUser('owner',child.id,'請先等等。');mode='cancel';step=0;
  const cancelled=await product.agent.reply('owner',child.id,message!.id,async()=>true,cancel.signal);
  assert.equal(cancelled?.stopReason,'cancelled');
  assert.equal(results.length,2);assert.ok(calls<=10);
  assert.ok(diagnostics.some(event => event.layer === 'model' && event.phase === 'model_end'));
  assert.ok(diagnostics.some(event => event.layer === 'tool' && event.phase === 'tool_end'));
  assert.ok(diagnostics.every(event => !('args' in event) && !('content' in event) && !('error' in event)));
});
