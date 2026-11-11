import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreChatStore } from '../server/firestore-chat.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirestoreAgentRuns } from '../server/firestore-agent-runs.ts';
import { createMixedTaskBatches } from '../server/firestore-mixed-task-batches.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { createFirestoreSharingStore } from '../server/firestore-sharing.ts';
import { createFirestoreCareStore } from '../server/firestore-care.ts';
import { createFirestoreMemoryStore } from '../server/firestore-memory.ts';
import { createFirestoreProductAgent } from '../server/firestore-product-agent.ts';
import { createFirebaseRequestHandler } from '../server/firebase-app.ts';
import { readAiConfig } from '../server/ai-config.ts';

test('one explicit confirmation pins a multi-child batch, partial conflict and retry retain the original item receipts', async () => {
  const {database}=serialFirestoreFixture(), options={database,cipher:createStorageCipher(Buffer.alloc(32,57)),projectId:'demo-p4-batch',namespace:'mixed_batch'};
  const authority=createFirestoreAuthority(options), chat=createFirestoreChatStore(options), online=createFirestoreOnlineStore(options);
  const runs=createFirestoreAgentRuns({...options,chat,memory:{}});
  const service=()=>createMixedTaskBatches({...options,chat,online,runs});
  let batches=service();
  const user='parent', email='parent@example.test';
  await authority.initializeControl({generation:randomUUID(),enabled:true});
  await authority.issueInvitation({email,expiresAt:new Date(Date.now()+86400000).toISOString(),operationId:randomUUID()});
  await authority.admitIdentity({userId:user,email,emailVerified:true});
  await authority.acknowledge({userId:user,policyVersion:SERVICE_POLICY_VERSION,operationId:randomUUID()});
  const ids=[];
  for(const displayName of ['阿彤','阿彤']) ids.push((await authority.createChild({userId:user,operationId:randomUUID(),displayName})).child.id);
  const {room}=await chat.mixed.create(user,{operationId:randomUUID(),scope:{kind:'personal'},childIds:ids});
  async function question(expectedVersion,text) {
    const {message}=await chat.mixed.append(user,room.id,{operationId:randomUUID(),expectedVersion,text});
    const run=await runs.claimMixed(user,room.id,message.id);
    return {message,run};
  }
  const {message,run}=await question(1,'幫兩個孩子加一項旅行待辦');
  const action={kind:'create',title:'帶水樽',details:'放入背囊',type:'ordinary',dueAt:'2028-03-01T10:00:00+08:00',timeZone:'Asia/Hong_Kong'};
  const draft=await batches.propose(user,room.id,message.id,run.runId,action);
  assert.equal(draft.state,'awaiting_confirmation');
  assert.deepEqual(draft.items.map(i=>i.childId).sort(),[...ids].sort());
  assert.equal((await online.tasks.list(user,ids[0])).items.length,0);
  const confirm={action:'confirm',digest:draft.digest};
  await assert.rejects(batches.control(user,room.id,message.id,{...confirm,digest:'f'.repeat(64)}),e=>e.code==='version_conflict');
  async function finish(source,claim) {
    await runs.finishMixed(user,room.id,source.id,{runId:claim.runId,status:'completed',stopReason:null,provenance:null,
      text:'待辦已列出，請先確認。',citations:[],privateSourceCitations:[],retrievalMode:'not_used',tools:[],countsKnown:true,
      counts:{modelCalls:0,toolCalls:0,queryEmbeddings:0},proposals:[]});
  }
  await assert.rejects(batches.control(user,room.id,message.id,confirm),e=>e.code==='batch_proposal_unavailable');
  await finish(message,run);
  await batches.control(user,room.id,message.id,confirm);
  const first=await batches.step(user,room.id,message.id,0,draft.digest);
  assert.equal(first.items[0].status,'completed');
  assert.equal(first.items[1].status,'pending');
  batches=service();
  assert.deepEqual((await batches.step(user,room.id,message.id,0,draft.digest)).items,first.items);
  const complete=await batches.step(user,room.id,message.id,1,draft.digest);
  assert.equal(complete.state,'completed');
  assert.equal((await batches.control(user,room.id,message.id,confirm)).state,'completed');
  for (const item of complete.items) {
    const original=await online.lookup(user,item.operationId);
    assert.equal(original.state,'confirmed');
    assert.equal(original.result.task.id,item.taskId);
    assert.equal((await online.tasks.list(user,item.childId)).items.length,1);
  }
  const change=await question(2,'這兩項已準備好了');
  const target=complete.items.map(i=>({childId:i.childId,taskId:i.taskId,expectedVersion:1}));
  const changeDraft=await batches.propose(user,room.id,change.message.id,change.run.runId,{kind:'complete',targets:target,note:''});
  await finish(change.message,change.run);
  await batches.control(user,room.id,change.message.id,{action:'confirm',digest:changeDraft.digest});
  const command={path:'/api/children/'+target[1].childId+'/tasks/'+target[1].taskId+'/change',
    payload:{action:'cancel',note:'已改行程',expectedVersion:1,confirm:true}};
  await online.submit(user,{...command,operation:{...await online.context(user,command),deviceId:randomUUID(),opId:randomUUID()}});
  await batches.step(user,room.id,change.message.id,0,changeDraft.digest);
  const partial=await batches.step(user,room.id,change.message.id,1,changeDraft.digest);
  assert.equal(partial.state,'partial');
  assert.equal(partial.items[1].status,'conflict');
  assert.equal((await online.tasks.list(user,target[1].childId)).items[0].occurrence.state,'cancelled');

  const sharing=createFirestoreSharingStore(options);
  let classroom=await sharing.create(user,{kind:'class',name:'戶外課',operationId:randomUUID()});
  const classChildren=[];
  for(const displayName of ['同名','同名']) {
    const added=await sharing.addClassChild(user,{spaceId:classroom.id,expectedVersion:classroom.version,displayName,operationId:randomUUID()});
    classroom=added.space;classChildren.push(added.child.id);
  }
  const classRoom=(await chat.mixed.create(user,{operationId:randomUUID(),childIds:classChildren,
    scope:{kind:'class',spaceId:classroom.id,spaceVersion:classroom.version,teacherSpaceVersion:null}})).room;
  const classMessage=(await chat.mixed.append(user,classRoom.id,{operationId:randomUUID(),expectedVersion:1,text:'替兩位同學安排下次上課要帶水樽'})).message;
  const care=createFirestoreCareStore(options),memory=createFirestoreMemoryStore({...options,chat,care});
  const product=await createFirestoreProductAgent({...options,chat,memory,care,online,config:readAiConfig({AI_ENABLED:'true',GCP_PROJECT_ID:options.projectId})});
  const classRun=await runs.claimMixed(user,classRoom.id,classMessage.id);
  await product.mixedTaskBatches.propose(user,classRoom.id,classMessage.id,classRun.runId,action);
  await runs.finishMixed(user,classRoom.id,classMessage.id,{runId:classRun.runId,status:'completed',stopReason:null,provenance:null,
    text:'請核對。',citations:[],privateSourceCitations:[],retrievalMode:'not_used',tools:[],countsKnown:true,
    counts:{modelCalls:0,toolCalls:0,queryEmbeddings:0},proposals:[]});
  const origin='https://example.test',handler=createFirebaseRequestHandler({authority,chat,product,publicOrigin:origin,mailConfigured:true,
    auth:{getSession:async()=>({user:{id:user}}),handler:async()=>new Response(null,{status:404})}});
  const api=async(tail,body)=>{
    const response=await handler(new Request(origin+'/api/account/mixed-chats/'+classRoom.id+'/messages/'+classMessage.id+'/'+tail,{
      method:body?'POST':'GET',headers:{origin,'content-type':'application/json','x-expected-user-id':user},...(body?{body:JSON.stringify(body)}:{})}));
    const json=await response.json();assert.equal(response.status,200,JSON.stringify(json));return json;
  };
  const preview=(await api('task-batch')).batch;
  assert.equal(preview.state,'awaiting_confirmation');
  assert.equal((await online.tasks.forSharedSpace(classroom.id).list(user,classChildren[0])).items.length,0);
  await api('task-batch',{action:'confirm',digest:preview.digest});
  const done=(await api('task-batch/advance',{position:0,digest:preview.digest})).batch;
  assert.equal(done.state,'completed');
  assert.deepEqual((await api('task-batch/advance',{position:0,digest:preview.digest})).batch.items,done.items);
  for(const item of done.items) assert.equal((await online.tasks.forSharedSpace(classroom.id).get(user,item.childId,item.taskId)).title,action.title);
});
