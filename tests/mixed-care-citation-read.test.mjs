import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreSharingStore } from '../server/firestore-sharing.ts';
import { createFirestoreChatStore } from '../server/firestore-chat.ts';
import { createFirestoreCareStore } from '../server/firestore-care.ts';
import { createFirestoreAgentRuns } from '../server/firestore-agent-runs.ts';
import { createFirebaseRequestHandler } from '../server/firebase-app.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { CHAT_DELIVERY_REVIEW_POLICY_VERSION } from '../src/shared/chat-delivery-review.ts';
import { careRecordCitationId } from '../src/shared/assistant-care-citation.ts';
import { emptyCareDetails } from '../src/shared/care.ts';

async function setup() {
  const fake=serialFirestoreFixture(); let transactions=0,actor='owner',lateActor;
  const database={...fake.database,runTransaction(...args){transactions++;return fake.database.runTransaction(...args);}};
  const options={database,projectId:'demo-care-citation',namespace:'care_citation',cipher:createStorageCipher(Buffer.alloc(32,92))};
  const authority=createFirestoreAuthority(options),sharing=createFirestoreSharingStore(options),chat=createFirestoreChatStore(options),care=createFirestoreCareStore(options);
  const runs=createFirestoreAgentRuns({...options,chat,care,memory:{}});
  await authority.initializeControl({generation:randomUUID(),enabled:true});
  for (const userId of ['owner','reader']) {
    const email=userId+'@example.test';
    await authority.issueInvitation({email,expiresAt:'2099-01-01T00:00:00Z',operationId:randomUUID()});
    await authority.admitIdentity({userId,email,emailVerified:true});
    await authority.acknowledge({userId,policyVersion:SERVICE_POLICY_VERSION,operationId:randomUUID()});
  }
  const origin='https://example.test',auth={async getSession(){
    const userId=actor;if(lateActor!==undefined){actor=lateActor;lateActor=undefined;}
    return userId ? {user:{id:userId}} : null;
  },async handler(){throw Error('Unexpected auth operation');}};
  const handle=createFirebaseRequestHandler({authority,chat,care,auth,publicOrigin:origin,mailConfigured:true,
    product:{runs,agent:{async replyMixed(){throw Error('Citation reads must not execute the Agent');}}}});
  const read=(room,message,ordinal=1,query='',expected=actor)=>handle(new Request(origin+'/api/account/mixed-chats/'+room.id+'/messages/'+message.id+'/care-citations/'+ordinal+query,
    {headers:expected ? {'x-expected-user-id':expected} : {}}));
  async function finish(room,record,review='pass',sources) {
    const userId=actor,{message}=await chat.mixed.append(userId,room.id,{operationId:randomUUID(),expectedVersion:room.version,text:'查回原文'});
    room.version=message.version;
    const claim=await runs.claimMixed(userId,room.id,message.id),citationId=careRecordCitationId(room.childIds.indexOf(record.childId),record.id,record.version);
    const deliveryReview=review===null ? undefined : {draftHash:'a'.repeat(64),sourceVersions:sources??[{citationId,version:String(record.version),contentHash:'b'.repeat(64)}],
      scope:claim.scope,visibility:'private',decision:review,model:'synthetic-review',promptVersion:'test',policyVersion:CHAT_DELIVERY_REVIEW_POLICY_VERSION};
    await runs.finishMixed(userId,room.id,message.id,{runId:claim.runId,status:'completed',stopReason:null,provenance:null,text:'依據原始記錄。',citations:[],
      privateSourceCitations:[],retrievalMode:'not_used',tools:[],counts:{modelCalls:0,toolCalls:0,queryEmbeddings:0},proposals:[],...(deliveryReview?{deliveryReview}:{})});
    return {message,citationId};
  }
  return {authority,sharing,chat,care,runs,read,finish,setActor:value=>{actor=value;},expireAfterRead:()=>{lateActor=null;},transactions:()=>transactions};
}

test('formal mixed care citation reads the current original in one transaction and refuses changed, erased and legacy evidence',async()=>{
  const f=await setup(),child=(await f.authority.createChild({userId:'owner',displayName:'同名',operationId:randomUUID()})).child;
  const values={text:'未裁切原文 '+ '🍼'.repeat(500),source:'家長原文',details:{...emptyCareDetails('feeding'),
    eventTime:{rawText:'昨晚大約七點',at:null,timeZone:'UTC',precision:'approximate'}}};
  const record=await f.care.create('owner',child.id,values),{room}=await f.chat.mixed.create('owner',{operationId:randomUUID(),scope:{kind:'personal'},childIds:[child.id]});
  const {message,citationId}=await f.finish(room,record),before=f.transactions();
  const response=await f.read(room,message); assert.equal(response.status,200);
  assert.equal(f.transactions()-before,1,'the run, source and current record share one transaction');
  assert.deepEqual(await response.json(),{citation:{citationId,recordId:record.id,version:1,childId:child.id,childName:'同名',text:values.text,source:values.source,eventTimeLabel:'昨晚大約七點'}});
  assert.match(response.headers.get('cache-control'),/no-store/u);
  for(const ordinal of [0,2,7,'01']) assert.equal((await f.read(room,message,ordinal)).status,404);
  assert.equal((await f.read(room,message,1,'?childId='+randomUUID())).status,400);
  const {room:otherRoom}=await f.chat.mixed.create('owner',{operationId:randomUUID(),scope:{kind:'personal'},childIds:[child.id]});
  assert.equal((await f.read(otherRoom,message)).status,404);
  f.setActor('reader'); assert.equal((await f.read(room,message)).status,404); f.setActor('owner');
  assert.equal((await f.read(room,message,1,'',null)).status,428);
  f.expireAfterRead(); assert.equal((await f.read(room,message)).status,409);f.setActor('owner');
  const old=(await f.finish(room,record,null)).message;
  assert.equal((await f.read(room,old)).status,404);
  const hashed=(await f.finish(room,record,'pass',[{citationId:'care:'+'c'.repeat(64),version:'d'.repeat(64),contentHash:'e'.repeat(64)}])).message;
  assert.equal((await f.read(room,hashed)).status,404);
  const failed=(await f.finish(room,record,'revise')).message;
  assert.equal((await f.read(room,failed)).status,404);
  const updated=await f.care.revise('owner',child.id,record.id,{...values,text:'更新後原文'},1,'更正');
  assert.equal((await f.read(room,message)).status,409);
  await f.care.delete('owner',child.id,record.id,updated.version);
  assert.equal((await f.read(room,message)).status,404);
  f.setActor(null);assert.equal((await f.read(room,message)).status,401);
});

test('formal class care citation keeps private-room ownership and rejects withdrawn or rejoined membership',async()=>{
  const f=await setup();
  let classroom=await f.sharing.create('owner',{kind:'class',name:'班級',operationId:randomUUID()});
  const added=await f.sharing.addClassChild('owner',{spaceId:classroom.id,expectedVersion:classroom.version,displayName:'同名',operationId:randomUUID()});
  classroom=added.space;const childId=added.child.id;
  const record=await f.sharing.withResource('owner',{spaceId:classroom.id,childId,module:'care',mode:'write'},async access=>{
    const saved=await f.care.prepareRecord(access.binding,randomUUID(),{text:'班級照護原文',source:'老師原文',details:emptyCareDetails()});saved.commit();return saved.value;
  });
  async function invite(){const invitation=await f.sharing.invite('owner',{spaceId:classroom.id,expectedVersion:classroom.version,email:'reader@example.test',role:'viewer',expiresAt:'2099-01-01T00:00:00Z',operationId:randomUUID()});
    classroom=await f.sharing.acceptInvitation('reader',{token:invitation.token,operationId:randomUUID()});}
  await invite();f.setActor('reader');
  const {room}=await f.chat.mixed.create('reader',{operationId:randomUUID(),scope:{kind:'class',spaceId:classroom.id,spaceVersion:classroom.version,teacherSpaceVersion:null},childIds:[childId]});
  const {message}=await f.finish(room,record),before=f.transactions();
  const response=await f.read(room,message);assert.equal(response.status,200);assert.equal(f.transactions()-before,1);
  assert.equal((await response.json()).citation.text,'班級照護原文');
  f.setActor('owner');assert.equal((await f.read(room,message)).status,404);
  classroom=await f.sharing.updateMember('owner',{spaceId:classroom.id,expectedVersion:classroom.version,targetUserId:'reader',role:null,operationId:randomUUID()});
  f.setActor('reader');assert.equal((await f.read(room,message)).status,403);
  f.setActor('owner');await invite();f.setActor('reader');assert.equal((await f.read(room,message)).status,403);
});
