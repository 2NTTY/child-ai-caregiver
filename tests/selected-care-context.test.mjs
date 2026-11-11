import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreSharingStore } from '../server/firestore-sharing.ts';
import { createFirestoreCareStore, firestoreCareStorageSchema } from '../server/firestore-care.ts';
import { FirestoreDomainData } from '../server/firestore-domain-data.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { emptyCareDetails } from '../src/shared/care.ts';

async function setup() {
  const fake=serialFirestoreFixture(), careReads=[];
  const database={...fake.database,runTransaction(use,options){return fake.database.runTransaction(tx=>use({...tx,async get(target){
    const result=await tx.get(target);
    if (target.query && target.path.endsWith('_care_records')) careReads.push({limit:target.cap,returned:result.size});
    return result;
  }}),options);}};
  const options={database,projectId:'demo-selected-care',namespace:'selected_care',
    cipher:createStorageCipher(Buffer.alloc(32,74)),serverClock:()=>Date.parse('2026-11-11T00:00:00Z')};
  const authority=createFirestoreAuthority(options), sharing=createFirestoreSharingStore(options), care=createFirestoreCareStore(options);
  await authority.initializeControl({generation:randomUUID(),enabled:true});
  for (const userId of ['owner','reader']) {
    const email=userId+'@example.test';
    await authority.issueInvitation({email,expiresAt:'2026-11-15T00:00:00Z',operationId:randomUUID()});
    await authority.admitIdentity({userId,email,emailVerified:true});
    await authority.acknowledge({userId,policyVersion:SERVICE_POLICY_VERSION,operationId:randomUUID()});
  }
  const children=[];
  for (let i=0;i<2;i++) children.push(await authority.createChild({userId:'owner',operationId:randomUUID(),displayName:'同名'}));
  const data=new FirestoreDomainData(options);
  function seed(index,values={},child=children[0]) {
    const id=randomUUID(),at=new Date(Date.UTC(2026,1,index+1)).toISOString();
    const value={id,childId:child.child.id,authorUserId:'owner',createdAt:at,version:1,confirmedBy:'owner',confirmedAt:at,
      reason:'Initial confirmation',text:'不相關',source:'使用者原文',details:emptyCareDetails(),...values};
    fake.records.set(data.ref('care_records','care-record',id).path,{...data.tags(child.scope),entityId:id,entityVersion:1,createdAt:at,live:true,
      ...data.seal('care-record',id,child.scope,firestoreCareStorageSchema,value,1)});
    return value;
  }
  return {fake,options,authority,sharing,care,children,seed,careReads};
}

test('selected care scans bounded pages and filters by event time while preserving source values',async()=>{
  const f=await setup(),details=emptyCareDetails('feeding'),rows=[];
  const dated=at=>({...details,eventTime:{rawText:'當時的原話',at,timeZone:'Asia/Hong_Kong',precision:'exact'}});
  for (let i=0;i<28;i++) rows.push(f.seed(i));
  function replace(i,values) {
    f.fake.records.delete([...f.fake.records.keys()].find(path=>path.includes('_care_records/') && f.fake.records.get(path).entityId===rows[i].id));
    rows[i]=f.seed(i,values);
  }
  replace(27,{text:'半樽，未知日期',details});
  replace(26,{text:'半樽，不同類型'});
  replace(25,{text:'不相關的餵食',details});
  replace(24,{text:'半樽，期間之外',details:dated('2026-01-01T00:00:00Z')});
  const sourceDetails={...dated('2026-10-01T12:30:00+08:00'),quantity:{rawValue:'半樽',unit:'樽',precision:'approximate'}};
  replace(2,{text:'半樽'+ '🍼'.repeat(400),details:sourceDetails});
  replace(1,{text:'半樽，早於事件期間',details:dated('2026-09-01T00:00:00Z')});
  replace(0,{text:'半樽，另一個未知日期',details});
  f.seed(29,{text:'半樽，另一名同名孩子',details:sourceDetails},f.children[1]);
  const deleted=f.seed(30,{text:'半樽，已刪除',details:sourceDetails});
  await f.care.delete('owner',f.children[0].child.id,deleted.id,1);
  const input={scope:{kind:'personal'},childId:f.children[0].child.id,
    filters:{query:'半樽',kind:'feeding',eventFrom:'2026-10-01T00:00:00Z',eventTo:'2026-10-02T00:00:00Z'}};
  const first=await f.care.readSelectedCare('owner',input);
  assert.deepEqual(f.careReads.at(-1),{limit:26,returned:26});
  assert.equal(first.childName,'同名'); assert.equal(first.childId,input.childId);
  assert.deepEqual(first.records,[]); assert.equal(first.scanned,25); assert.equal(first.undatedMatches,1);
  assert.equal(first.nextCursor.id,rows[3].id); assert.equal(first.nextCursor.createdAt,rows[3].createdAt);
  const second=await f.care.readSelectedCare('owner',{...input,cursor:first.nextCursor});
  assert.deepEqual(f.careReads.at(-1),{limit:26,returned:3});
  assert.equal(second.scanned,3); assert.equal(second.undatedMatches,1); assert.equal(second.nextCursor,null);
  assert.deepEqual(second.records.map(r=>r.id),[rows[2].id]);
  assert.equal([...second.records[0].text].length,350); assert.equal(second.records[0].textComplete,false);
  assert.ok(second.records[0].text.isWellFormed()); assert.deepEqual(second.records[0].details,sourceDetails);
  assert.deepEqual(Object.keys(second.records[0]).sort(),['createdAt','details','id','text','textComplete','version']);
  const ordinary=await f.care.search('owner',input.childId,{query:'半樽',kind:'feeding'});
  assert.equal(ordinary.records.length,5); assert.equal(ordinary.records.find(r=>r.id===rows[2].id).text,rows[2].text);
  assert.equal(ordinary.limit,50); assert.equal(ordinary.scanned,28); assert.equal(ordinary.nextCursor,null);
});

test('selected care stops after three matches and fences continuation by child, actor, filters and live changes',async()=>{
  const f=await setup(),rows=[];
  for (let i=0;i<6;i++) rows.push(f.seed(i,{text:'目標 '+i}));
  const input={scope:{kind:'personal'},childId:f.children[0].child.id,filters:{query:'目標'}};
  const first=await f.care.readSelectedCare('owner',input);
  assert.deepEqual(first.records.map(r=>r.id),[rows[5].id,rows[4].id,rows[3].id]);
  assert.equal(first.scanned,3); assert.equal(first.undatedMatches,3); assert.equal(first.nextCursor.id,rows[3].id);
  assert.ok(first.records.every(r=>r.textComplete));
  const second=await f.care.readSelectedCare('owner',{...input,cursor:first.nextCursor});
  assert.deepEqual(second.records.map(r=>r.id),[rows[2].id,rows[1].id,rows[0].id]); assert.equal(second.nextCursor,null);
  await assert.rejects(f.care.readSelectedCare('owner',{...input,childId:f.children[1].child.id,cursor:first.nextCursor}),{code:'cursor_changed'});
  await assert.rejects(f.care.readSelectedCare('owner',{...input,filters:{query:'別的'},cursor:first.nextCursor}),{code:'cursor_changed'});
  await assert.rejects(f.care.readSelectedCare('reader',{...input,cursor:first.nextCursor}));
  await f.care.create('owner',input.childId,{text:'新內容',details:emptyCareDetails(),source:'原話'});
  await assert.rejects(f.care.readSelectedCare('owner',{...input,cursor:first.nextCursor}),{code:'cursor_changed'});
});

test('selected class care requires current class membership and exact class scope versions',async()=>{
  const f=await setup();
  let room=await f.sharing.create('owner',{kind:'class',name:'班級',operationId:randomUUID()});
  const added=await f.sharing.addClassChild('owner',{spaceId:room.id,expectedVersion:room.version,displayName:'同名',operationId:randomUUID()});
  room=added.space; const childId=added.child.id;
  for (let i=0;i<4;i++) await f.sharing.withResource('owner',{spaceId:room.id,childId,module:'care',mode:'write'},async access=>{
    const record=await f.care.prepareRecord(access.binding,randomUUID(),{text:'班級原文 '+i,details:emptyCareDetails(),source:'原話'});record.commit();
  });
  const invitation=await f.sharing.invite('owner',{spaceId:room.id,expectedVersion:room.version,email:'reader@example.test',role:'caregiver',
    expiresAt:'2026-11-15T00:00:00Z',operationId:randomUUID()});
  room=await f.sharing.acceptInvitation('reader',{token:invitation.token,operationId:randomUUID()});
  const input={scope:{kind:'class',spaceId:room.id,spaceVersion:room.version,teacherSpaceVersion:null},childId,filters:{}};
  const first=await f.care.readSelectedCare('reader',input);
  assert.equal(first.records.length,3); assert.ok(first.nextCursor);
  const next=await f.care.readSelectedCare('reader',{...input,cursor:first.nextCursor});
  assert.equal(next.records.length,1); assert.equal(next.nextCursor,null);
  await assert.rejects(f.care.readSelectedCare('reader',{...input,scope:{...input.scope,spaceVersion:room.version-1}}),{code:'sharing_scope_changed'});
  await assert.rejects(f.care.readSelectedCare('reader',{...input,scope:{...input.scope,teacherSpaceVersion:1}}),{code:'sharing_scope_changed'});
  await assert.rejects(f.care.readSelectedCare('owner',{...input,cursor:first.nextCursor}),{code:'cursor_changed'});
  await assert.rejects(f.care.readSelectedCare('reader',{...input,scope:{kind:'personal'}}));
  await f.sharing.leave('reader',{spaceId:room.id,expectedVersion:room.version,operationId:randomUUID()});
  await assert.rejects(f.care.readSelectedCare('reader',{...input,cursor:first.nextCursor}),{code:'space_access_denied'});
});
