import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { Timestamp } from '@google-cloud/firestore';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreSharingStore } from '../server/firestore-sharing.ts';
import { createFirestoreErasureStore } from '../server/firestore-erasure.ts';
import { createFirestoreErasureCleanup } from '../server/firestore-erasure-cleanup.ts';
import { createFirestoreCareStore } from '../server/firestore-care.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirestoreRestoreCodec } from '../server/firestore-restore-codec.ts';
import { prepareFirebaseRestore } from '../server/firestore-restore.ts';
import { FIREBASE_BACKUP_COLLECTION_SUFFIXES, setFirebaseBackupControl } from '../server/firestore-backup.ts';
import { firebaseErasureIntentHash, type FirebaseErasureIntent, type FirebaseErasureDescriptor } from '../server/firebase-erasure-journal.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { createSharingApi } from '../src/client/sharing-api.ts';
import { handleSharingControlRequest } from '../server/sharing-control-api.ts';
import { FirestoreDomainData, firestoreDomainHash } from '../server/firestore-domain-data.ts';
import { createFirestoreChatFilesStore, firestoreChatFileRowSchema } from '../server/firestore-chat-files.ts';
import { chatFileObjectAddress, type ChatFileObjects } from '../server/firebase-chat-file-objects.ts';

const rejected=(code:string)=>(error:unknown)=>(error as {code?:string}).code===code;
test('class dissolution resumes one journal-backed cleanup and cannot revive data from an older backup',async()=>{
  const fake=serialFirestoreFixture();let now=Date.parse('2026-10-28T12:00:00Z');
  const database={...fake.database,databaseId:'class-erasure-source',collection(path:string){
    const collection=fake.database.collection(path);return {...collection,doc(id:string){const ref=collection.doc(id);return {...ref,async get(){
      const snapshot=await fake.database.runTransaction(tx=>tx.get(ref),{readOnly:true});return {...snapshot,updateTime:Timestamp.fromMillis(now)};
    }};}};
  }} as typeof fake.database;
  const options={database,cipher:createStorageCipher(Buffer.alloc(32,84)),projectId:'demo-class-erasure',namespace:'class_erasure',serverClock:()=>now};
  const intents=new Map<string,FirebaseErasureIntent>(),proofs=new Map<string,FirebaseErasureDescriptor>();let loseReply=true;
  const journal={async writeOnce(intent:FirebaseErasureIntent){
    const old=intents.get(intent.operationId);if(old)assert.deepEqual(old,intent);intents.set(intent.operationId,structuredClone(intent));
    const hash=firebaseErasureIntentHash(intent),proof={objectName:'erasures/v1/'+hash,generation:'1',cipherSha256:'a'.repeat(64),
      intentSha256:hash,bytes:128,format:'yuban-erasure-journal/v1' as const};proofs.set(hash,proof);
    if(loseReply){loseReply=false;throw Error('lost journal response');}return proof;
  },async read(intent:FirebaseErasureIntent,proof:FirebaseErasureDescriptor){assert.deepEqual(intents.get(intent.operationId),intent);
    assert.equal(proof.intentSha256,firebaseErasureIntentHash(intent));return intent;}};
  const authority=createFirestoreAuthority(options),erasures=createFirestoreErasureStore({...options,journal});
  const store=createFirestoreSharingStore({...options,classErasure:erasures}),care=createFirestoreCareStore(options);
  const online=createFirestoreOnlineStore({...options,mutations:[care.mutation]});
  const documents=()=>[...fake.records].map(([path,data])=>({path,data:structuredClone(data)}));
  let generation:string=randomUUID();await authority.initializeControl({generation,enabled:true});
  async function control(enabled:boolean){const next=randomUUID();await setFirebaseBackupControl(options,{expectedGeneration:generation,generation:next,enabled});generation=next;}
  for(const userId of ['manager','viewer','outsider']){
    await authority.issueInvitation({email:userId+'@example.test',expiresAt:'2026-10-30T00:00:00Z',operationId:randomUUID()});
    await authority.admitIdentity({userId,email:userId+'@example.test',emailVerified:true});
    await authority.acknowledge({userId,policyVersion:SERVICE_POLICY_VERSION,operationId:randomUUID()});
  }
  const api=createSharingApi('http://localhost',async(url,init)=>{
    const request=new Request(url,init),userId=request.headers.get('x-expected-user-id')!;
    try{return await handleSharingControlRequest(request,userId,store,async()=>true,request=>request.json());}
    catch(error){const e=error as {code?:string;status?:number};return Response.json({error:{code:e.code}},{status:e.status??500});}
  }),signal=new AbortController().signal;
  let classroom=await store.create('manager',{kind:'class',name:'Class to erase',operationId:randomUUID()});
  const enrol={spaceId:classroom.id,expectedVersion:classroom.version,operationId:randomUUID(),displayName:'Class learner'};
  const child=await store.addClassChild('manager',enrol);classroom=child.space;
  const scope=await store.withResource('manager',{spaceId:classroom.id,childId:child.child.id,module:'attachments',mode:'read'},async a=>a.scope);
  const data=new FirestoreDomainData(options),fileId=randomUUID(),bytes=Buffer.from('Class attachment'),sha256=createHash('sha256').update(bytes).digest('hex');
  let removedObjects=0;
  const address=(s:typeof scope,id:string)=>chatFileObjectAddress({...options,bucketName:'class-erasure-files'},s,id).objectName;
  const descriptor={objectName:address(scope,fileId),generation:'1',cipherSha256:'c'.repeat(64),sha256,bytes:bytes.length,mimeType:'text/plain'};
  const file={id:fileId,scope,objectScope:scope,version:1,createdAt:new Date(now).toISOString(),updatedAt:new Date(now).toISOString(),fingerprint:'b'.repeat(64),
    metadata:{fileName:'class.txt',mimeType:'text/plain',bytes:bytes.length,sha256},state:'ready' as const,upload:null,descriptor,messageId:null,deletion:null};
  fake.records.set(data.ref('chat_file_assets','chat-file-asset',fileId).path,{...data.tags(scope),scopeTag:firestoreDomainHash(['chat-file-scope',scope]),
    assetId:fileId,state:'ready',createdAt:file.createdAt,updatedAt:file.updatedAt,messageId:null,...data.seal('chat-file-asset',fileId,scope,firestoreChatFileRowSchema,file,1)});
  const objects:ChatFileObjects={address,async write(){assert.fail('no upload during cleanup');},async read(){assert.fail('no disclosure during cleanup');},
    async inspect(){return removedObjects?null:descriptor;},async remove(s,id,value){assert.deepEqual(s,scope);assert.equal(id,fileId);assert.deepEqual(value,descriptor);removedObjects++;}};
  const files=createFirestoreChatFilesStore({...options,objects,journal});
  const peer=await authority.createChild({userId:'manager',operationId:randomUUID(),displayName:'Personal learner'});
  async function note(childId:string,shared:boolean){const command={path:'/api/children/'+childId+'/records',payload:{text:shared?'Class note':'Personal note'},
    ...(shared?{sharing:{spaceId:classroom.id}}:{})},context=await online.context('manager',command);
    return online.submit('manager',{...command,...(shared?{sharing:{spaceId:classroom.id,expectedBasis:context.sharingBasis}}:{}),
      operation:{workspaceId:context.workspaceId,storageEpoch:context.storageEpoch,opId:randomUUID(),deviceId:randomUUID()}});}
  await note(child.child.id,true);const personal=await note(peer.child.id,false);
  const invitation=await store.invite('manager',{spaceId:classroom.id,expectedVersion:classroom.version,operationId:randomUUID(),
    email:'viewer@example.test',role:'viewer',expiresAt:'2026-10-30T00:00:00Z'});
  classroom=await store.acceptInvitation('viewer',{operationId:randomUUID(),token:invitation.token});
  const command={action:'dissolve' as const,spaceId:classroom.id,expectedVersion:classroom.version,operationId:randomUUID()};
  const {action,...direct}=command;
  await assert.rejects(store.dissolve('viewer',direct),rejected('space_manager_required'));
  await assert.rejects(store.dissolve('manager',{...direct,expectedVersion:1}),rejected('version_conflict'));
  await control(false);const backup=documents();await control(true);
  const accepted=await api.submit(command,'manager',signal);
  assert.equal(accepted.exit?.cleanupState,'pending');assert.equal(intents.size,0,'network IO is outside the admission transaction');
  await assert.rejects(store.classRosterPage('viewer',classroom.id),rejected('space_inactive'));
  assert.deepEqual(await api.submit(command,'manager',signal),accepted);
  const codec=createFirestoreRestoreCodec(options);
  const job=documents().map(row=>codec.decode(row)).find(row=>row.context.kind==='scope-erasure')!.value as any;
  assert.equal(job.intent.type,'class-delete');assert.equal(job.intent.scope.ownerUserId,'space:'+classroom.id);
  await assert.rejects(erasures.resumeRequested(job),/lost journal response/);
  await control(false);const pendingBackup=documents();await control(true);
  const resumed=createFirestoreErasureStore({...options,journal});await resumed.resumeRequested(job);
  assert.equal(intents.size,1);
  const cleaner=createFirestoreErasureCleanup({...options,journal,erasures:resumed,files,
    photos:{async eraseForScope(){assert.fail('no photo in this fixture');}},async deleteAgentSession(){},
    async eraseAgentUserPage(){assert.fail('class is not an Auth user');},async eraseDeviceSessions(){assert.fail('do not delete personal sessions');},
    async eraseAuthUser(){assert.fail('do not delete a member account');}});
  now+=121_000;let progress=await cleaner.advance(job.intent.scope.ownerUserId,job.intent.operationId);
  for(let n=0;progress.state!=='completed'&&n<FIREBASE_BACKUP_COLLECTION_SUFFIXES.length+8;n++)progress=await cleaner.advance(job.intent.scope.ownerUserId,job.intent.operationId);
  assert.equal(progress.state,'completed');
  assert.equal(removedObjects,1);assert.equal(fake.records.has(data.ref('chat_file_assets','chat-file-asset',fileId).path),false);
  assert.equal((await api.operation(command.operationId,'manager',signal))?.exit?.cleanupState,'completed');
  assert.equal((await store.controlOperation('manager',enrol.operationId))?.redacted,true);
  await assert.rejects(store.addClassChild('manager',enrol),rejected('operation_result_unavailable'));
  assert.equal((await care.get('manager',peer.child.id,(personal.result as any).record.id))?.text,'Personal note');
  const decoded=documents().map(row=>codec.decode(row));
  assert.equal((decoded.find(row=>row.context.kind==='child'&&row.context.id===child.child.id)!.value as any).status,'deleted');
  assert.equal(decoded.filter(row=>row.context.kind==='care-record'&&row.context.scope.ownerUserId==='space:'+classroom.id).length,0);
  assert.equal(decoded.filter(row=>['shared-membership','shared-invitation'].includes(row.context.kind)&&(row.value as any).spaceId===classroom.id).length,0);
  await control(false);
  const restored=prepareFirebaseRestore(options,{restoreId:randomUUID(),targetDatabaseId:'class-erasure-target',sourceGeneration:generation,
    documents:backup,liveDocuments:documents(),erasures:[...intents.values()],erasureDescriptors:proofs,photoDescriptors:new Map(),
    authUsers:['manager','viewer','outsider'].map(userId=>({userId,email:userId+'@example.test',disabled:false,emailVerified:true}))});
  const after=restored.records.map(row=>codec.decode(row));
  assert.equal(after.filter(row=>row.context.kind==='care-record'&&row.context.scope.ownerUserId==='space:'+classroom.id).length,0);
  assert.equal((after.find(row=>row.context.kind==='workspace'&&row.context.id===classroom.id)!.value as any).status,'deleted');
  assert.equal(after.filter(row=>row.context.kind==='account'&&(row.value as any).status==='active').length,3);
  assert.equal(after.some(row=>row.context.kind==='chat-file-asset'),false);
  fake.records.clear();for(const row of restored.records)fake.records.set(row.path,row.data);
  generation=restored.generation;await control(true);
  assert.equal((await api.operation(command.operationId,'manager',signal))?.exit?.cleanupState,'completed');
  assert.equal((await store.controlOperation('manager',enrol.operationId))?.redacted,true);
  await control(false);
  const fromPending=prepareFirebaseRestore(options,{restoreId:randomUUID(),targetDatabaseId:'class-erasure-pending-target',sourceGeneration:generation,
    documents:pendingBackup,liveDocuments:documents(),erasures:[...intents.values()],erasureDescriptors:proofs,photoDescriptors:new Map(),
    authUsers:['manager','viewer','outsider'].map(userId=>({userId,email:userId+'@example.test',disabled:false,emailVerified:true}))});
  assert.equal((fromPending.records.map(row=>codec.decode(row)).find(row=>row.context.kind==='scope-erasure')!.value as any).state,'completed');
  await control(true);
  let team=await store.create('outsider',{kind:'teachers',name:'Current team',operationId:randomUUID()});
  const join=await store.invite('outsider',{spaceId:team.id,expectedVersion:team.version,operationId:randomUUID(),
    email:'manager@example.test',role:'caregiver',expiresAt:'2026-10-30T00:00:00Z'});
  team=await store.acceptInvitation('manager',{operationId:randomUUID(),token:join.token});
  let attached=await store.create('manager',{kind:'class',name:'Attached class',operationId:randomUUID()});
  attached=await store.attachClass('manager',{spaceId:attached.id,expectedVersion:attached.version,teacherSpaceId:team.id,
    expectedTeacherVersion:team.version,operationId:randomUUID()});team=await store.get('outsider',team.id);
  const close={spaceId:attached.id,expectedVersion:attached.version,expectedTeacherVersion:team.version,operationId:randomUUID()};
  await assert.rejects(store.dissolve('manager',close),rejected('space_manager_required'));
  await assert.rejects(store.dissolve('outsider',{...close,expectedTeacherVersion:team.version-1}),rejected('version_conflict'));
  assert.equal((await api.submit({action:'dissolve',...close},'outsider',signal)).exit?.cleanupState,'pending');
  assert.equal((await store.get('outsider',team.id)).version,team.version+1);
  assert.equal((await store.teacherClassesPage('outsider',team.id)).items.length,0);
});
