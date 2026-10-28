import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Timestamp } from '@google-cloud/firestore';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreSharingStore } from '../server/firestore-sharing.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';
import { createFirestoreRestoreCodec } from '../server/firestore-restore-codec.ts';
import { prepareFirebaseRestore } from '../server/firestore-restore.ts';
import { setFirebaseBackupControl } from '../server/firestore-backup.ts';
import { createFirestoreCareStore } from '../server/firestore-care.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { FirestoreDomainData, firestoreDomainHash } from '../server/firestore-domain-data.ts';
import { firestoreChatFileRowSchema } from '../server/firestore-chat-files.ts';
import { firebaseErasureIntentHash, type FirebaseErasureIntent } from '../server/firebase-erasure-journal.ts';

const rejected = (code: string) => (error: unknown) => (error as {code?: string}).code === code;
async function setup() {
  const fake = serialFirestoreFixture(), now = Date.parse('2026-10-28T08:00:00Z');
  const database={...fake.database,databaseId:'synthetic-class',collection(path:string){
    const collection=fake.database.collection(path);
    return {...collection,doc(id:string){const ref=collection.doc(id);return {...ref,async get(){
      const snapshot=await fake.database.runTransaction(tx=>tx.get(ref),{readOnly:true});
      return {...snapshot,updateTime:Timestamp.fromMillis(now)};
    }};}};
  }} as typeof fake.database;
  const options = {database,
    cipher:createStorageCipher(Buffer.alloc(32, 42)), projectId:'demo-class-storage', namespace:'class_storage', serverClock:()=>now};
  const authority = createFirestoreAuthority(options), sharing = createFirestoreSharingStore(options);
  let generation=randomUUID();
  await authority.initializeControl({generation, enabled:true});
  async function control(enabled:boolean){const next=randomUUID();
    await setFirebaseBackupControl(options,{expectedGeneration:generation,generation:next,enabled});generation=next;return next;}
  for (const userId of ['teacher', 'successor', 'outsider']) {
    await authority.issueInvitation({email:userId+'@example.test', expiresAt:'2026-10-30T08:00:00Z', operationId:randomUUID()});
    await authority.admitIdentity({userId, email:userId+'@example.test', emailVerified:true});
    await authority.acknowledge({userId, policyVersion:SERVICE_POLICY_VERSION, operationId:randomUUID()});
  }
  const documents = () => [...fake.records].map(([path,data])=>({path,data:structuredClone(data)}));
  return {fake, options, authority, sharing, documents, control};
}

test('class child storage survives manager departure without a synthetic login account', async () => {
  const f = await setup();
  const create = {operationId:randomUUID(), name:'Independent class', kind:'class' as const};
  let classroom = await f.sharing.create('teacher', create);
  const add = {operationId:randomUUID(), spaceId:classroom.id, expectedVersion:classroom.version, displayName:'Learner'};
  const enrolled = await f.sharing.addClassChild('teacher', add);
  assert.deepEqual(await f.sharing.addClassChild('teacher', add), enrolled, 'original operation does not add another child');
  classroom = enrolled.space;
  const childId = enrolled.child.id, request = {spaceId:classroom.id, childId, module:'care' as const, mode:'read' as const};
  const original = await f.sharing.withResource('teacher', request, async a=>({scope:a.scope, child:await a.binding.readChild(childId)}));
  assert.equal(original.scope.ownerUserId, 'space:'+classroom.id);
  assert.equal(original.scope.workspaceId, classroom.id);
  assert.equal(original.child?.displayName,'Learner');
  const care=createFirestoreCareStore(f.options), online=createFirestoreOnlineStore({...f.options,mutations:[care.mutation]});
  const command={path:'/api/children/'+childId+'/records',payload:{text:'Class-owned note'},sharing:{spaceId:classroom.id}};
  const context=await online.context('teacher',command);
  const submission={...command,sharing:{...command.sharing,expectedBasis:context.sharingBasis},operation:{
    workspaceId:context.workspaceId,storageEpoch:context.storageEpoch,opId:randomUUID(),deviceId:randomUUID()}};
  const receipt=await online.submit('teacher',submission),record=(receipt.result as {record:{id:string}}).record;
  assert.deepEqual(await online.submit('teacher',submission),receipt);
  const codec = createFirestoreRestoreCodec(f.options);
  const decoded = f.documents().map(row=>codec.decode(row));
  assert.equal(decoded.filter(row=>row.context.kind==='account').length,3, 'a storage identity is not an Auth account');
  await assert.rejects(f.sharing.withResource('outsider', request, async a=>a.scope), rejected('space_access_denied'));
  const invitation = await f.sharing.invite('teacher',{spaceId:classroom.id,expectedVersion:classroom.version,operationId:randomUUID(),
    email:'successor@example.test',role:'caregiver',expiresAt:'2026-10-30T08:00:00Z'});
  classroom = await f.sharing.acceptInvitation('successor',{token:invitation.token,operationId:randomUUID()});
  await assert.rejects(f.authority.runTransaction('teacher',null,async b=>b.prepareErasure(randomUUID(),'account')),
    rejected('space_transfer_or_dissolve_required'));
  classroom = await f.sharing.proposeTransfer('teacher',{spaceId:classroom.id,expectedVersion:classroom.version,targetUserId:'successor',operationId:randomUUID()});
  classroom = await f.sharing.acceptTransfer('successor',{spaceId:classroom.id,expectedVersion:classroom.version,operationId:randomUUID()});
  await f.sharing.leave('teacher',{spaceId:classroom.id,expectedVersion:classroom.version,operationId:randomUUID()});
  await f.authority.runTransaction('teacher',null,async b=>{const pending=await b.prepareErasure(randomUUID(),'account');pending.commit();});
  assert.deepEqual(await f.sharing.withResource('successor',request,async a=>({scope:a.scope,child:await a.binding.readChild(childId)})),original);
  assert.equal((await care.forSharedSpace(classroom.id).get('successor',childId,record.id))?.text,'Class-owned note');
  await assert.rejects(f.sharing.withResource('teacher',request,async a=>a.scope),rejected('account_inactive'));
});

test('class restore retains current ownership and rebinds the class workspace without reviving old membership', async () => {
  const f=await setup();
  let classroom=await f.sharing.create('teacher',{operationId:randomUUID(),name:'Restore class',kind:'class'});
  const added=await f.sharing.addClassChild('teacher',{operationId:randomUUID(),spaceId:classroom.id,expectedVersion:classroom.version,displayName:'Learner'});
  classroom=added.space;
  await f.control(false);const snapshot=f.documents();await f.control(true);
  const invitation=await f.sharing.invite('teacher',{operationId:randomUUID(),spaceId:classroom.id,expectedVersion:classroom.version,
    email:'successor@example.test',role:'caregiver',expiresAt:'2026-10-30T08:00:00Z'});
  classroom=await f.sharing.acceptInvitation('successor',{token:invitation.token,operationId:randomUUID()});
  classroom=await f.sharing.proposeTransfer('teacher',{operationId:randomUUID(),spaceId:classroom.id,expectedVersion:classroom.version,targetUserId:'successor'});
  classroom=await f.sharing.acceptTransfer('successor',{operationId:randomUUID(),spaceId:classroom.id,expectedVersion:classroom.version});
  await f.sharing.leave('teacher',{operationId:randomUUID(),spaceId:classroom.id,expectedVersion:classroom.version});
  const generation=await f.control(false);
  const restored=prepareFirebaseRestore(f.options,{restoreId:randomUUID(),targetDatabaseId:'class-isolated-target',sourceGeneration:generation,
    documents:snapshot,liveDocuments:f.documents(),erasures:[],erasureDescriptors:new Map(),photoDescriptors:new Map(),
    authUsers:['teacher','successor','outsider'].map(userId=>({userId,email:userId+'@example.test',disabled:false,emailVerified:true}))});
  f.fake.records.clear();for(const row of restored.records)f.fake.records.set(row.path,row.data);
  await setFirebaseBackupControl(f.options,{expectedGeneration:restored.generation,generation:randomUUID(),enabled:true});
  const request={spaceId:classroom.id,childId:added.child.id,module:'care' as const,mode:'read' as const};
  const scope=await f.sharing.withResource('successor',request,async a=>a.scope);
  assert.equal(scope.ownerUserId,'space:'+classroom.id);
  assert.equal(scope.storageEpoch,restored.newEpochByWorkspace.get(classroom.id));
  await assert.rejects(f.sharing.withResource('teacher',request,async a=>a.scope),rejected('space_access_denied'));
});

test('class asset erasure replays against class ownership instead of requiring a personal account', async()=>{
  const f=await setup(), classroom=await f.sharing.create('teacher',{operationId:randomUUID(),name:'File class',kind:'class'});
  const added=await f.sharing.addClassChild('teacher',{operationId:randomUUID(),spaceId:classroom.id,expectedVersion:classroom.version,displayName:'Learner'});
  const scope=await f.sharing.withResource('teacher',{spaceId:classroom.id,childId:added.child.id,module:'attachments',mode:'read'},async a=>a.scope);
  const data=new FirestoreDomainData(f.options),id=randomUUID(),at='2026-10-28T08:00:00Z';
  const metadata={fileName:'sample.txt',mimeType:'text/plain',bytes:1,sha256:'a'.repeat(64)};
  const row={id,scope,objectScope:scope,version:1,createdAt:at,updatedAt:at,fingerprint:'b'.repeat(64),metadata,
    state:'reserved' as const,upload:null,descriptor:null,messageId:null,deletion:null};
  const path=data.ref('chat_file_assets','chat-file-asset',id).path;
  f.fake.records.set(path,{...data.tags(scope),scopeTag:firestoreDomainHash(['chat-file-scope',scope]),assetId:id,state:row.state,
    createdAt:at,updatedAt:at,messageId:null,...data.seal('chat-file-asset',id,scope,firestoreChatFileRowSchema,row,1)});
  await f.control(false);const snapshot=f.documents();await f.control(true);
  const intent:FirebaseErasureIntent={type:'file-delete',scope,assetId:id,operationId:randomUUID(),at};
  const hash=firebaseErasureIntentHash(intent),proof={objectName:'erasures/v1/'+hash,generation:'1',cipherSha256:'c'.repeat(64),
    intentSha256:hash,bytes:1,format:'yuban-erasure-journal/v1' as const};
  const generation=await f.control(false);
  const restored=prepareFirebaseRestore(f.options,{restoreId:randomUUID(),targetDatabaseId:'class-file-target',sourceGeneration:generation,
    documents:snapshot,liveDocuments:f.documents(),erasures:[intent],erasureDescriptors:new Map([[hash,proof]]),photoDescriptors:new Map(),
    authUsers:['teacher','successor','outsider'].map(userId=>({userId,email:userId+'@example.test',disabled:false,emailVerified:true}))});
  const codec=createFirestoreRestoreCodec(f.options),decoded=restored.records.map(record=>codec.decode(record));
  const file=firestoreChatFileRowSchema.parse(decoded.find(record=>record.context.kind==='chat-file-asset')!.value);
  assert.equal(file.state,'deleted');assert.equal(file.metadata,null);assert.equal(file.deletion?.cleanup,'pending');
  assert.ok(decoded.some(record=>record.context.kind==='online-receipt' && (record.value as {state?:string}).state==='erasure_barrier'));
});

test('post-snapshot roster receipt cannot report a child absent after restore or create a duplicate',async()=>{
  const f=await setup(),classroom=await f.sharing.create('teacher',{operationId:randomUUID(),name:'Later roster',kind:'class'});
  await f.control(false);const snapshot=f.documents();await f.control(true);
  const request={operationId:randomUUID(),spaceId:classroom.id,expectedVersion:classroom.version,displayName:'Later learner'};
  await f.sharing.addClassChild('teacher',request);
  const generation=await f.control(false);
  const restored=prepareFirebaseRestore(f.options,{restoreId:randomUUID(),targetDatabaseId:'class-receipt-target',sourceGeneration:generation,
    documents:snapshot,liveDocuments:f.documents(),erasures:[],erasureDescriptors:new Map(),photoDescriptors:new Map(),
    authUsers:['teacher','successor','outsider'].map(userId=>({userId,email:userId+'@example.test',disabled:false,emailVerified:true}))});
  f.fake.records.clear();for(const row of restored.records)f.fake.records.set(row.path,row.data);
  await setFirebaseBackupControl(f.options,{expectedGeneration:restored.generation,generation:randomUUID(),enabled:true});
  const count=f.fake.records.size;
  await assert.rejects(f.sharing.addClassChild('teacher',request),rejected('operation_result_unavailable'));
  assert.equal(f.fake.records.size,count);
});
