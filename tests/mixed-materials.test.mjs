import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreSharingStore } from '../server/firestore-sharing.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreChatStore } from '../server/firestore-chat.ts';
import { createFirestoreCareStore } from '../server/firestore-care.ts';
import { createFirestoreMemoryStore } from '../server/firestore-memory.ts';
import { createFirestoreAgentRuns } from '../server/firestore-agent-runs.ts';
import { createFirebaseRequestHandler } from '../server/firebase-app.ts';
import { createFirestoreFamilyDocumentStore } from '../server/firestore-family-documents.ts';
import { createProductAgentTools } from '../server/product-agent-tools.ts';
import { AgentBudget } from '../server/agent-budget.ts';
import { CHAT_DELIVERY_REVIEW_POLICY_VERSION } from '../src/shared/chat-delivery-review.ts';
import { createSelectedMaterials } from '../server/firestore-selected-materials.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';

test('mixed conversation reads only selected facts and documents, binds reviewed links to current originals', async () => {
  const {database} = serialFirestoreFixture();
  const options = {database, projectId:'demo-selected', namespace:'selected', cipher:createStorageCipher(Buffer.alloc(32,47))};
  const authority = createFirestoreAuthority(options), chat = createFirestoreChatStore(options), care = createFirestoreCareStore(options);
  const memory = createFirestoreMemoryStore({...options,care,chat});
  const materials = createSelectedMaterials({...options,chat,memory});
  const uid='parent', email='selected@example.test';
  await authority.initializeControl({generation:randomUUID(),enabled:true});
  await authority.issueInvitation({email,expiresAt:'2099-01-01T00:00:00Z',operationId:randomUUID()});
  await authority.admitIdentity({userId:uid,email,emailVerified:true});
  await authority.acknowledge({userId:uid,policyVersion:SERVICE_POLICY_VERSION,operationId:randomUUID()});
  const createChild=async()=>(await authority.createChild({userId:uid,displayName:'同名',operationId:randomUUID()})).child;
  const first=await createChild(), second=await createChild(), outside=await createChild();
  const save=async (child,content)=>{
    const fact=await memory.createFact(uid,child.id,{values:{key:'偏好',content,source:{kind:'manual',description:'家長記錄'},validUntil:null},intendedVisibility:'private'});
    await memory.confirmFact(uid,child.id,fact.id,{expectedVersion:fact.version,confirm:true,confirmShared:false});
    return fact;
  };
  const hidden=await save(outside,'不可出現');
  const original=await save(first,'喜歡橙色');
  const {room}=await chat.mixed.create(uid,{operationId:randomUUID(),scope:{kind:'personal'},childIds:[first.id,second.id]});
  const {message}=await chat.mixed.append(uid,room.id,{operationId:randomUUID(),text:'喜歡甚麼？',expectedVersion:room.version});
  const q={kind:'memory',from:room.childIds.indexOf(first.id),query:'橙色'};
  const page=await materials.search(uid,room.id,message.id,q);
  assert.deepEqual(page.items.map(x=>[x.id,x.childId,x.title]),[[original.id,first.id,'偏好']]);
  const keywords=await materials.search(uid,room.id,message.id,{...q,query:'橙色 圖案'});
  assert.deepEqual(keywords.items,page.items,'A second descriptive search word must not hide the matching source.');
  assert.deepEqual((await materials.search(uid,room.id,message.id,{...q,query:'偏好 顏色'})).items,page.items);
  assert.deepEqual((await materials.search(uid,room.id,message.id,{...q,query:'車票 單據'})).items,[]);
  const found=page.items[0], ref={kind:q.kind,from:q.from,id:found.id,version:found.version};
  assert.equal((await materials.read(uid,room.id,message.id,ref)).text,'喜歡橙色');
  await assert.rejects(materials.read(uid,room.id,message.id,{...ref,id:hidden.id}));
  const documents=createFirestoreFamilyDocumentStore(options);
  const doc=await documents.create(uid,first.id,{title:'外出準備',purpose:'outing',kind:'preparation',eventDate:null,
    period:{from:'2026-10-01',to:'2026-10-31'}},randomUUID());
  const dq={kind:'document',from:q.from,query:'外出'};
  const runs=createFirestoreAgentRuns({...options,chat,care,memory}), claim=await runs.claimMixed(uid,room.id,message.id);
  const budget=new AgentBudget();
  try {
    const product=createProductAgentTools({
      run:{scope:claim.scope,runId:claim.runId,budget},memory:{},tasks:{},store:{},authorize:async()=>true,
      knowledge:{createRun:()=>({})},mixedTasks:async()=>({children:[],nextFrom:null}),
      mixedMaterials:{search:(query,limit)=>materials.search(uid,room.id,message.id,query,limit),
        read:ref=>materials.read(uid,room.id,message.id,ref)},
    });
    const search=product.tools.find(t=>t.name==='search_selected_materials');
    const {data:{result:returned}}=await search.execute(dq,{});
    assert.deepEqual(returned.items.map(item=>[item.id,item.title]),[[doc.id,'外出準備']]);
    const answer=product.tools.find(t=>t.name==='present_answer');
    const item=returned.items[0], proposed=await answer.execute({kind:'private_reference',
      paragraphs:[{text:'有這份外出準備單。',citationIds:[item.citationId]}]},{});
    assert.equal(proposed.status,'succeeded');
    const shown=await product.presentation();
    assert.match(shown.text,/\[孩子資料 1\]/u);
    const draft=product.deliveryDraft();
    const review={draftHash:'a'.repeat(64),sourceVersions:draft.sources.map(({citationId,version,contentHash})=>({citationId,version,contentHash})),
      scope:claim.scope,visibility:'private',decision:'pass',model:'synthetic-review',promptVersion:'test',policyVersion:CHAT_DELIVERY_REVIEW_POLICY_VERSION};
    await runs.finishMixed(uid,room.id,message.id,{runId:claim.runId,status:'completed',stopReason:null,provenance:null,
      text:shown.text,citations:[],privateSourceCitations:[],retrievalMode:'not_used',tools:[],counts:{modelCalls:0,toolCalls:2,queryEmbeddings:0},proposals:[],deliveryReview:review});
    const origin='https://example.test';
    const handle=createFirebaseRequestHandler({authority,chat,care,auth:{getSession:async()=>({user:{id:uid}}),handler:()=>{throw Error("unexpected auth request");}},
      publicOrigin:origin,mailConfigured:true,product:{runs}});
    const url=origin+'/api/account/mixed-chats/'+room.id+'/messages/'+message.id+'/material-citations/1';
    const fetchOriginal=()=>handle(new Request(url,{headers:{'x-expected-user-id':uid}}));
    const response=await fetchOriginal();
    assert.equal(response.status,200);
    const source=(await response.json()).citation;
    assert.equal(source.childId,first.id);
    assert.equal(source.id,doc.id);
    assert.equal(source.citationId,item.citationId);
    const detail=await documents.describe(uid,first.id,doc.id);
    await documents.change(uid,first.id,doc.id,{action:'archive',expectedVersion:doc.version,authorityVersion:detail.authorityVersion},randomUUID());
    assert.equal((await fetchOriginal()).status,404);
  } finally {budget.close();}
  await memory.deactivateFact(uid,first.id,original.id,{expectedVersion:found.version,reason:'已改變'});
  await assert.rejects(materials.read(uid,room.id,message.id,ref));
  assert.equal((await materials.search(uid,room.id,message.id,q)).items.length,0);

  const sharing=createFirestoreSharingStore(options), teacher='teacher', teacherEmail='teacher@example.test';
  await authority.issueInvitation({email:teacherEmail,expiresAt:'2099-01-01T00:00:00Z',operationId:randomUUID()});
  await authority.admitIdentity({userId:teacher,email:teacherEmail,emailVerified:true});
  await authority.acknowledge({userId:teacher,policyVersion:SERVICE_POLICY_VERSION,operationId:randomUUID()});
  const classroom=await sharing.create(uid,{kind:'class',name:'青班',operationId:randomUUID()});
  const member=await sharing.addClassChild(uid,{spaceId:classroom.id,expectedVersion:classroom.version,displayName:'同名',operationId:randomUUID()});
  await sharing.withResource(uid,{spaceId:classroom.id,childId:member.child.id,module:'memory',mode:'write'},async ({binding})=>{
    const prepared=await memory.prepareConfirmedFact(binding,{intendedVisibility:'family',values:{key:'交代',content:'帶水樽',source:{kind:'manual',description:'班級記錄'},validUntil:null}},true,randomUUID());
    prepared.commit();
  });
  const invitation=await sharing.invite(uid,{spaceId:classroom.id,expectedVersion:member.space.version,email:teacherEmail,role:'viewer',
    expiresAt:'2099-01-01T00:00:00Z',operationId:randomUUID()});
  const joined=await sharing.acceptInvitation(teacher,{token:invitation.token,operationId:randomUUID()});
  const classRoom=(await chat.mixed.create(teacher,{operationId:randomUUID(),scope:{kind:'class',spaceId:joined.id,spaceVersion:joined.version,teacherSpaceVersion:null},childIds:[member.child.id]})).room;
  const classMessage=(await chat.mixed.append(teacher,classRoom.id,{operationId:randomUUID(),expectedVersion:classRoom.version,text:'要帶什麼？'})).message;
  const classQuery={from:0,kind:'memory',query:'水樽'};
  assert.deepEqual((await materials.search(teacher,classRoom.id,classMessage.id,classQuery)).items.map(x=>x.text),['帶水樽']);
  await sharing.updateMember(uid,{spaceId:joined.id,expectedVersion:joined.version,targetUserId:teacher,role:null,operationId:randomUUID()});
  await assert.rejects(materials.search(teacher,classRoom.id,classMessage.id,classQuery));
});
