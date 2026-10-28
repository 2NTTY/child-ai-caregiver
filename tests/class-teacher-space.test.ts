import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Timestamp } from '@google-cloud/firestore';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreSharingStore } from '../server/firestore-sharing.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { assertNoManagedSharedSpaces } from '../server/firestore-sharing-records.ts';
import { FirestoreDomainData } from '../server/firestore-domain-data.ts';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';
import { handleSharingControlRequest } from '../server/sharing-control-api.ts';
import { createSharingApi } from '../src/client/sharing-api.ts';
import { setFirebaseBackupControl } from '../server/firestore-backup.ts';
import { prepareFirebaseRestore } from '../server/firestore-restore.ts';
import { createFirestoreRestoreCodec } from '../server/firestore-restore-codec.ts';
import { firebaseErasureIntentHash, type FirebaseErasureIntent } from '../server/firebase-erasure-journal.ts';
import { firestoreScopeErasureSchema } from '../server/firestore-erasure.ts';

const rejected=(code:string)=>(error:unknown)=>(error as {code?:string}).code===code;
test('class attachment inherits current teacher roles and detachment never revives former direct access',async t=>{
  const fake=serialFirestoreFixture(),database={...fake.database,databaseId:'class-teachers-synthetic',collection(path:string){
    const collection=fake.database.collection(path);
    return {...collection,doc(id:string){const ref=collection.doc(id);return {...ref,async get(){
      const snapshot=await fake.database.runTransaction(tx=>tx.get(ref),{readOnly:true});
      return {...snapshot,updateTime:Timestamp.fromMillis(Date.parse('2026-10-28T11:00:00Z'))};
    }};}};
  }} as typeof fake.database,options={database,cipher:createStorageCipher(Buffer.alloc(32,63)),
    projectId:'demo-class-teachers',namespace:'class_teachers',serverClock:()=>Date.parse('2026-10-28T11:00:00Z')};
  const authority=createFirestoreAuthority(options),store=createFirestoreSharingStore(options),data=new FirestoreDomainData(options);
  let generation:string=randomUUID();
  await authority.initializeControl({generation,enabled:true});
  const documents=()=>[...fake.records].map(([path,data])=>({path,data:structuredClone(data)}));
  async function control(enabled:boolean){const next=randomUUID();
    await setFirebaseBackupControl(options,{expectedGeneration:generation,generation:next,enabled});generation=next;}
  const api=createSharingApi('http://localhost',async(url,init)=>{
    const request=new Request(url,init),userId=request.headers.get('x-expected-user-id')!;
    try{return await handleSharingControlRequest(request,userId,store,async()=>true,request=>request.json());}
    catch(error){const failure=error as {status?:number;code?:string};return Response.json({error:{code:failure.code}},{status:failure.status??500});}
  }),signal=new AbortController().signal;
  for(const userId of ['creator','manager','colleague','recipient','former','late']){
    await authority.issueInvitation({email:userId+'@example.test',expiresAt:'2026-10-30T00:00:00Z',operationId:randomUUID()});
    await authority.admitIdentity({userId,email:userId+'@example.test',emailVerified:true});
    await authority.acknowledge({userId,policyVersion:SERVICE_POLICY_VERSION,operationId:randomUUID()});
  }
  async function join(manager:string,spaceId:string,userId:string,role:'caregiver'|'viewer'){
    const s=await store.get(manager,spaceId),invite=await store.invite(manager,{operationId:randomUUID(),spaceId,expectedVersion:s.version,
      email:userId+'@example.test',role,expiresAt:'2026-10-30T00:00:00Z'});
    return store.acceptInvitation(userId,{operationId:randomUUID(),token:invite.token});
  }
  const created=await api.submit({action:'create',operationId:randomUUID(),kind:'teachers',name:'Teachers'},'manager',signal);
  let team=await store.get('manager',created.space!.id);
  for(const person of ['creator','recipient'])team=await join('manager',team.id,person,'caregiver');
  team=await join('manager',team.id,'colleague','viewer');
  let classroom=await store.create('creator',{operationId:randomUUID(),kind:'class',name:'Class'});
  const enrolCommand={operationId:randomUUID(),spaceId:classroom.id,expectedVersion:classroom.version,displayName:'Learner'};
  const enrolled=await store.addClassChild('creator',enrolCommand);
  classroom=await join('creator',classroom.id,'former','caregiver');
  const oldInvite=await store.invite('creator',{operationId:randomUUID(),spaceId:classroom.id,expectedVersion:classroom.version,
    email:'late@example.test',role:'caregiver',expiresAt:'2026-10-30T00:00:00Z'});classroom=oldInvite.space;
  const resource={spaceId:classroom.id,childId:enrolled.child.id,module:'care' as const,mode:'read' as const};
  const original=await store.withResource('creator',resource,a=>Promise.resolve(a.scope));
  const attach={operationId:randomUUID(),spaceId:classroom.id,expectedVersion:classroom.version,
    teacherSpaceId:team.id,expectedTeacherVersion:team.version};
  await control(false);const snapshot=documents();await control(true);
  const attached=await api.submit({action:'attachClass',...attach},'creator',signal);
  classroom=await store.get('creator',classroom.id);
  assert.equal(attached.space!.teacherSpaceId,team.id);
  await t.test('a historical receipt projects one coherent current class relationship',async()=>{
    const previous=await api.operation(enrolCommand.operationId,'creator',signal);
    assert.equal(previous!.space!.teacherSpaceId,team.id);
    assert.equal(previous!.space!.teacherSpaceVersion,attached.space!.teacherSpaceVersion);
    assert.equal(previous!.childId,enrolled.child.id);
  });
  assert.deepEqual(await store.attachClass('creator',attach),classroom);
  assert.deepEqual(await store.withResource('colleague',resource,a=>Promise.resolve(a.scope)),original);
  await assert.rejects(store.withResource('colleague',{...resource,mode:'write'},async()=>true),rejected('read_only'));
  await assert.rejects(store.withResource('former',resource,async()=>true),rejected('space_access_denied'));
  assert.equal((await store.spaceView('manager',classroom.id)).managerUserId,'manager');
  assert.equal((await api.teacherClasses(team.id,'colleague',signal)).items[0].id,classroom.id);
  assert.equal((await api.teachers('colleague',signal)).items[0].id,team.id);
  assert.equal((await api.spaces('colleague',signal)).items.length,0);
  assert.equal((await api.members(classroom.id,'colleague',signal)).items.some(row=>row.userId==='former'),false);
  team=await store.get('manager',team.id);
  await assert.rejects(store.dissolve('manager',{operationId:randomUUID(),spaceId:team.id,expectedVersion:team.version}),rejected('teacher_space_has_classes'));
  await assert.rejects(store.invite('manager',{operationId:randomUUID(),spaceId:classroom.id,expectedVersion:classroom.version,
    email:'late@example.test',role:'viewer',expiresAt:'2026-10-30T00:00:00Z'}),rejected('class_members_managed_by_teachers'));
  const before=await store.childView('colleague',classroom.id,enrolled.child.id);
  team=await store.get('manager',team.id);
  team=await store.updateMember('manager',{operationId:randomUUID(),spaceId:team.id,expectedVersion:team.version,targetUserId:'colleague',role:'caregiver'});
  await assert.rejects(store.withResource('colleague',{...resource,expectedBasis:before.basis},async()=>true),rejected('sharing_scope_changed'));
  await store.leave('creator',{operationId:randomUUID(),spaceId:team.id,expectedVersion:team.version});
  await authority.runTransaction('creator',null,b=>assertNoManagedSharedSpaces(data,b.transaction,'creator'));
  const creatorScope=await authority.runTransaction('creator',null,async b=>b.scope);
  const erase:FirebaseErasureIntent={type:'account-delete',scope:creatorScope,assetId:'00000000-0000-0000-0000-000000000000',operationId:randomUUID(),at:'2026-10-28T11:00:00Z'};
  const hash=firebaseErasureIntentHash(erase),proof={objectName:'erasures/v1/'+hash,generation:'1',cipherSha256:'c'.repeat(64),
    intentSha256:hash,bytes:1,format:'yuban-erasure-journal/v1' as const};
  // Supply the existing erasure consumer's completed obligation to the pure restore boundary.
  const nil='00000000-0000-0000-0000-000000000000',erasureScope={ownerUserId:'creator',workspaceId:nil,childId:nil,storageEpoch:nil};
  const erasureId=JSON.stringify(['creator',erase.operationId]),completed=firestoreScopeErasureSchema.parse({intent:erase,authorizationVersion:'1',
    generation:randomUUID(),state:'completed',journal:null,receiptToken:null,expiresAt:null,blockedAt:erase.at,scopeVersion:'1',childCount:0,
    cleanup:{stage:'done',cursor:null}});
  const erasureRecord={path:data.ref('erasures','scope-erasure',erasureId).path,data:{...data.tags(erasureScope),operationId:erase.operationId,state:'completed',
    ...data.seal('scope-erasure',erasureId,erasureScope,firestoreScopeErasureSchema,completed)}};
  await control(false);
  const erased=prepareFirebaseRestore(options,{restoreId:randomUUID(),targetDatabaseId:'class-teachers-erased',sourceGeneration:generation,
    documents:snapshot,liveDocuments:[...documents(),erasureRecord],erasures:[erase],erasureDescriptors:new Map([[hash,proof]]),photoDescriptors:new Map(),
    authUsers:['creator','manager','colleague','recipient','former','late'].map(userId=>({userId,email:userId+'@example.test',disabled:userId==='creator',emailVerified:true}))});
  const codec=createFirestoreRestoreCodec(options),decoded=erased.records.map(record=>codec.decode(record));
  assert.ok(decoded.some(row=>row.context.kind==='child'&&row.context.id===enrolled.child.id));
  assert.ok(decoded.some(row=>row.context.kind==='shared-space'&&row.context.id===classroom.id));
  assert.equal(decoded.some(row=>row.context.kind==='shared-membership'&&(row.value as {userId?:string}).userId==='creator'),false);
  await control(true);
  team=await store.get('manager',team.id);
  const stale=await store.detachClass('manager',{operationId:randomUUID(),spaceId:classroom.id,expectedVersion:classroom.version,
    expectedTeacherVersion:team.version,targetUserId:'recipient'});classroom=stale;
  team=await store.proposeTransfer('manager',{operationId:randomUUID(),spaceId:team.id,expectedVersion:team.version,targetUserId:'colleague'});
  team=await store.acceptTransfer('colleague',{operationId:randomUUID(),spaceId:team.id,expectedVersion:team.version});
  await assert.rejects(store.acceptClassDetach('recipient',{operationId:randomUUID(),spaceId:classroom.id,expectedVersion:classroom.version,
    expectedTeacherVersion:team.version}),rejected('transfer_target'));
  classroom=await store.detachClass('colleague',{operationId:randomUUID(),spaceId:classroom.id,expectedVersion:classroom.version,
    expectedTeacherVersion:team.version,targetUserId:'recipient'});
  const acceptance={action:'acceptClassDetach' as const,operationId:randomUUID(),spaceId:classroom.id,expectedVersion:classroom.version,
    expectedTeacherVersion:team.version};
  const detached=await api.submit(acceptance,'recipient',signal);
  classroom=await store.get('recipient',classroom.id);
  assert.deepEqual(await api.operation(acceptance.operationId,'recipient',signal),detached);
  assert.equal(classroom.teacherSpaceId,null);assert.equal(classroom.managerUserId,'recipient');
  assert.deepEqual(await store.withResource('recipient',resource,a=>Promise.resolve(a.scope)),original);
  for(const person of ['manager','colleague','former','creator'])await assert.rejects(store.withResource(person,resource,async()=>true),rejected('space_access_denied'));
  await assert.rejects(store.acceptInvitation('late',{operationId:randomUUID(),token:oldInvite.token}),rejected('invitation_revoked'));
  assert.equal((await store.teacherClassesPage('colleague',team.id)).items.length,0);
  await control(false);
  const restored=prepareFirebaseRestore(options,{restoreId:randomUUID(),targetDatabaseId:'class-teachers-isolated',sourceGeneration:generation,
    documents:snapshot,liveDocuments:documents(),erasures:[],erasureDescriptors:new Map(),photoDescriptors:new Map(),
    authUsers:['creator','manager','colleague','recipient','former','late'].map(userId=>({userId,email:userId+'@example.test',disabled:false,emailVerified:true}))});
  fake.records.clear();for(const row of restored.records)fake.records.set(row.path,row.data);
  generation=restored.generation;await control(true);
  const restoredScope=await store.withResource('recipient',resource,async a=>a.scope);
  assert.equal(restoredScope.ownerUserId,original.ownerUserId);
  assert.equal(restoredScope.storageEpoch,restored.newEpochByWorkspace.get(classroom.id));
  for(const person of ['creator','former','colleague'])await assert.rejects(store.withResource(person,resource,async()=>true),rejected('space_access_denied'));
  await t.test('teacher spaces reject private family sharing and its reading paths',async()=>{
    const personal=await authority.createChild({userId:'manager',operationId:randomUUID(),displayName:'Private child'});
    const parent=await store.get('manager',team.id);
    await assert.rejects(store.share('manager',{operationId:randomUUID(),spaceId:parent.id,expectedVersion:parent.version,
      childId:personal.child.id,modules:['care']}),rejected('family_space_required'));
    await assert.rejects(store.sharesPage('manager',parent.id),rejected('family_space_required'));
    await assert.rejects(store.withResource('manager',{spaceId:parent.id,childId:personal.child.id,module:'care',mode:'read'},async()=>true),rejected('family_space_required'));
  });
});
