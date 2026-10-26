import { createChatFileApi } from '../src/client/chat-file-api.ts';
import { createVoiceApi } from '../src/client/voice-api.ts';
import { createPhotoApi, PhotoApiError } from '../src/client/photo-api.ts';
import { createFirestorePhotoStore, firestorePhotoSchemas } from '../server/firestore-photos.ts';
import { createHash } from 'node:crypto';
import { createFirestoreChatFilesStore, firestoreChatFileRowSchema } from '../server/firestore-chat-files.ts';
import { createFirestoreVoiceStore, firestoreVoiceRowSchema } from '../server/firestore-voice.ts';
import { createFirestoreVoiceTranscripts, prepareVoiceTranscription } from '../server/firestore-voice-transcripts.ts';
import { firestoreDomainHash } from '../server/firestore-domain-data.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Timestamp } from '@google-cloud/firestore';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreSharingStore } from '../server/firestore-sharing.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';
import { setFirebaseBackupControl } from '../server/firestore-backup.ts';
import { prepareFirebaseRestore } from '../server/firestore-restore.ts';
import { createFirestoreRestoreCodec } from '../server/firestore-restore-codec.ts';
import { sharedSpaceSchema, resourceShareSchema, sharedMembershipSchema, sharingErasedBy } from '../server/firestore-sharing-records.ts';
import { createFirestoreCareStore, firestoreCareStorageSchema } from '../server/firestore-care.ts';
import { FirestoreDomainData, firestoreTaskStorageSchema } from '../server/firestore-domain-data.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirebaseRequestHandler } from '../server/firebase-app.ts';
import { createOnlineTransport } from '../src/client/online-transport.ts';
import type { FirebaseAuthPort } from '../server/firebase-auth.ts';
import { createCareApi } from '../src/client/care-api.ts';
import { createTaskApi } from '../src/client/task-api.ts';
import { createMemoryApi } from '../src/client/memory-api.ts';
import { createFirestoreMemoryStore, firestoreFactStorageSchema } from '../server/firestore-memory.ts';
import { createFirestoreChatStore } from '../server/firestore-chat.ts';
import { createFirestoreFamilyDocumentStore, firestoreFamilyDocumentSchemas } from '../server/firestore-family-documents.ts';
import { createFamilyDocumentsApi } from '../src/client/family-documents-api.ts';
import { prepareFirestoreBackgroundWork, firestoreBackgroundWorkSchema } from '../server/firestore-background-work.ts';
import { createFirestoreTaskWorker } from '../server/firestore-task-worker.ts';
import { replayContentErasures } from '../server/firestore-restore-content-erasure.ts';
import type { FirebaseErasureIntent } from '../server/firebase-erasure-journal.ts';
import { firebaseErasureIntentHash } from '../server/firebase-erasure-journal.ts';
import { createFirestoreOnlineReceipts } from '../server/firestore-online-receipts.ts';
import { createFirestoreContentErasure } from '../server/firestore-content-erasure.ts';
import type { OnlineSubmission } from '../src/shared/online.ts';

async function fixture() {
  const fake = serialFirestoreFixture(), now = Date.parse('2026-10-27T04:00:00Z');
  const database = { ...fake.database, databaseId: 'synthetic-source', collection(path: string) {
    const collection = fake.database.collection(path);
    return { ...collection, doc(id: string) {
      const ref = collection.doc(id);
      return { ...ref, id, async get() {
        const snapshot = await fake.database.runTransaction(tx => tx.get(ref), { readOnly: true });
        return { ...snapshot, updateTime: Timestamp.fromMillis(now) };
      } };
    } };
  } } as typeof fake.database;
  const options = { database, cipher: createStorageCipher(Buffer.alloc(32, 71)),
    projectId: 'demo-sharing-test', namespace: 'sharing_test', serverClock: () => now };
  const authority = createFirestoreAuthority(options), sharing = createFirestoreSharingStore(options);
  let generation = randomUUID();
  await authority.initializeControl({ generation, enabled: true });
  for (const userId of ['parent', 'carer', 'viewer']) {
    const email = userId + '@example.test';
    await authority.issueInvitation({ email, expiresAt: new Date(now + 86_400_000).toISOString(), operationId: randomUUID() });
    await authority.admitIdentity({ userId, email, emailVerified: true });
    await authority.acknowledge({ userId, policyVersion: SERVICE_POLICY_VERSION, operationId: randomUUID() });
  }
  const child = await authority.createChild({ userId: 'parent', operationId: randomUUID(), displayName: 'Test child' });
  const create = { operationId: randomUUID(), name: 'Test family', kind: 'family' as const };
  let space = await sharing.create('parent', create);
  assert.deepEqual(await sharing.create('parent', create), space, 'original create returns its receipt');
  async function join(userId: string, role: 'caregiver' | 'viewer') {
    const invitation = await sharing.invite('parent', { spaceId: space.id, expectedVersion: space.version,
      operationId: randomUUID(), email: userId + '@example.test', role, expiresAt: new Date(now + 86_400_000).toISOString() });
    space = await sharing.acceptInvitation(userId, { token: invitation.token, operationId: randomUUID() });
  }
  await join('carer', 'caregiver'); await join('viewer', 'viewer');
  async function control(enabled: boolean) {
    const next = randomUUID();
    await setFirebaseBackupControl(options, { expectedGeneration: generation, generation: next, enabled });
    generation = next; return next;
  }
  const documents = () => [...fake.records].map(([path, data]) => ({ path, data: structuredClone(data) }));
  return { fake, options, authority, sharing, child, space, control, documents };
}
const code = (expected: string) => (error: unknown) => (error as { code?: string }).code === expected;

test('shared change cursors observe other members without exposing private history and reset on new authority', async () => {
  const f=await fixture(),childId=f.child.child.id,care=createFirestoreCareStore(f.options);
  let actor='viewer';
  await f.sharing.share('parent',{spaceId:f.space.id,childId,modules:['care','documents','memory'],expectedVersion:f.space.version,operationId:randomUUID()});
  const online=createFirestoreOnlineStore({...f.options,mutations:[care.mutation]});
  const auth={async getSession(options:{returnHeaders?:boolean}){const session={user:{id:actor,email:actor+'@example.test'}};
    return options.returnHeaders?{response:session,headers:new Headers()}:session;},async handler(){return new Response(null,{status:404});},
    async assertRecentReauthentication(){return {user:{id:actor,email:actor+'@example.test'}};},fromNodeHeaders(){return new Headers();}} as FirebaseAuthPort;
  const handler=createFirebaseRequestHandler({authority:f.authority,auth,publicOrigin:'https://app.example.test',mailConfigured:false,online});
  const selection={spaceId:f.space.id,childId,module:'care'};
  const read=async(cursor?:string,module='care')=>handler(new Request('https://app.example.test/api/online/shared-changes?'+new URLSearchParams({...selection,module,...(cursor?{cursor}:{})}),
    {headers:{'x-expected-user-id':actor}}));
  const first=await read();assert.equal(first.status,200);
  let page=await first.json();assert.equal(page.changed,true);assert.equal(page.hasMore,false);
  assert.deepEqual(Object.keys(page).sort(),['changed','childId','cursor','hasMore','module','spaceId']);
  const initialCursor=page.cursor;
  const documentCursor=(await(await read(undefined,'documents')).json()).cursor;
  const memoryCursor=(await(await read(undefined,'memory')).json()).cursor;
  const save=async(userId:string,text:string,sharing?:{spaceId:string})=>{
    const command={path:'/api/children/'+childId+'/records',payload:{text},...(sharing?{sharing}:{})},context=await online.context(userId,command);
    return online.submit(userId,{...command,...(sharing?{sharing:{...sharing,expectedBasis:context.sharingBasis!}}:{}),
      operation:{workspaceId:context.workspaceId,storageEpoch:context.storageEpoch,opId:randomUUID(),deviceId:randomUUID()}});
  };
  await save('parent','Source record');
  assert.equal((await(await read(documentCursor,'documents')).json()).changed,true,'document source changes invalidate an already read snapshot');
  assert.equal((await(await read(memoryCursor,'memory')).json()).changed,true,'source record changes invalidate dependent memory');
  page=await (await read(page.cursor)).json();assert.equal(page.changed,true,'source owner updates invalidate a viewer without changing the viewer workspace');
  await save('carer','Shared carer record',{spaceId:f.space.id});
  page=await (await read(page.cursor)).json();assert.equal(page.changed,true,'another member uses the same source feed');
  await f.authority.runTransaction('parent',childId,async b=>(await b.prepareChange(randomUUID(),'chat',false)).commit());
  page=await (await read(page.cursor)).json();assert.equal(page.changed,false,'an unshared private chat change is not a care event');
  const other=await f.authority.createChild({userId:'parent',displayName:'Other private child',operationId:randomUUID()});
  await f.authority.runTransaction('parent',other.child.id,async b=>(await b.prepareChange(randomUUID(),'care',false)).commit());
  page=await (await read(page.cursor)).json();assert.equal(page.changed,false,'another child is excluded at query time');
  for(let i=0;i<101;i++)await f.authority.runTransaction('parent',childId,async b=>(await b.prepareChange(randomUUID(),'care',false)).commit());
  page=await (await read(page.cursor)).json();assert.equal(page.changed,true);assert.equal(page.hasMore,true);
  page=await (await read(page.cursor)).json();assert.equal(page.changed,true);assert.equal(page.hasMore,false);
  page=await (await read(page.cursor)).json();assert.equal(page.changed,false);
  actor='carer';assert.equal((await read(initialCursor)).status,400,'another actor cannot reuse the cursor');actor='viewer';
  let space=await f.sharing.get('parent',f.space.id);
  space=await f.sharing.unshare('parent',{spaceId:space.id,childId,expectedVersion:space.version,operationId:randomUUID()});
  assert.equal((await read(page.cursor)).status,403);
  await f.sharing.share('parent',{spaceId:space.id,childId,modules:['care'],expectedVersion:space.version,operationId:randomUUID()});
  page=await (await read(page.cursor)).json();assert.equal(page.changed,true,'a new sharing basis resets the old cursor');assert.equal(page.hasMore,false);
});

test('shared photo deletion keeps source quotas and completes its journal after revocation', async () => {
  const f=await fixture(), childId=f.child.child.id, data=new FirestoreDomainData(f.options);
  const scope=await f.authority.runTransaction('parent',childId,async b=>b.scope);
  let journalUnavailable=true, removed=0;
  const intents=new Map<string,FirebaseErasureIntent>();
  const journal={async writeOnce(intent:FirebaseErasureIntent){
    if(journalUnavailable) throw Error('Journal unavailable');
    const key=JSON.stringify([intent.scope.ownerUserId,intent.operationId]), previous=intents.get(key);
    if(previous)assert.deepEqual(previous,intent,'each distinct erasure keeps a unique source operation');
    intents.set(key,intent);
    return {objectName:'erasures/v1/'+firebaseErasureIntentHash(intent),generation:'1',cipherSha256:'d'.repeat(64),intentSha256:firebaseErasureIntentHash(intent),bytes:1,format:'yuban-erasure-journal/v1' as const};
  },async read(intent:FirebaseErasureIntent,proof:{intentSha256:string}){assert.equal(proof.intentSha256,firebaseErasureIntentHash(intent));return intent;}};
  const photos=createFirestorePhotoStore({...f.options,journal,objects:{write:async()=>{throw Error('No upload');},recover:async()=>{throw Error('No upload');},
    read:async()=>{throw Error('No download');},remove:async(actualScope,id)=>{assert.deepEqual(actualScope,scope);assert.equal(id,photo.id);removed++;}}});
  const metadata={fileName:'shared.png',source:'camera' as const,mimeType:'image/png' as const,bytes:24,sha256:'a'.repeat(64)};
  const photo=await photos.reserve('parent',childId,randomUUID(),metadata);
  const ref=data.ref('photos','photo',photo.id), snapshot=await ref.get();
  const row=data.open('photo',photo.id,scope,firestorePhotoSchemas.photo,snapshot);
  const objectName='photos/v1/'+createHash('sha256').update(JSON.stringify(['yuban-photo-object',1,f.options.projectId,f.options.namespace,scope])).digest('hex')+'/'+photo.id;
  const care=createFirestoreCareStore(f.options), parentOnline=createFirestoreOnlineStore({...f.options,mutations:[care.mutation]});
  const recordCommand={path:'/api/children/'+childId+'/records',payload:{text:'Extracted photo note'}};
  const parentContext=await parentOnline.context('parent',recordCommand);
  const {record}=(await parentOnline.submit('parent',{...recordCommand,operation:{...parentContext,opId:randomUUID(),deviceId:randomUUID()}})).result as {record:{id:string}};
  const ready={...row,version:2,state:'ready',recordId:record.id,descriptor:{objectName,generation:'1',cipherSha256:'c'.repeat(64),...metadata}};
  const descriptor={objectName,generation:'1',cipherSha256:'c'.repeat(64),sha256:metadata.sha256,bytes:24,mimeType:'image/png'};
  f.fake.records.set(ref.path,{...snapshot.data(),...data.seal('photo',photo.id,scope,firestorePhotoSchemas.photo,{...ready,descriptor} as any,2)});
  await f.sharing.share('parent',{spaceId:f.space.id,childId,modules:['attachments'],expectedVersion:f.space.version,operationId:randomUUID()});
  const online=createFirestoreOnlineStore({...f.options,photos}), command={path:'/api/children/'+childId+'/photos/'+photo.id+'/delete',payload:{expectedVersion:2,confirmDelete:true},sharing:{spaceId:f.space.id}};
  const context=await online.context('carer',command);
  await assert.rejects(online.submit('carer',{...command,payload:{...command.payload,expectedVersion:1},sharing:{...command.sharing,expectedBasis:context.sharingBasis!},
    operation:{workspaceId:context.workspaceId,storageEpoch:context.storageEpoch,opId:randomUUID(),deviceId:randomUUID()}}),code('version_conflict'));
  await assert.rejects(online.context('viewer',command),code('read_only'));
  const auth={async getSession(options:{returnHeaders?:boolean}){const session={user:{id:'carer',email:'carer@example.test'}};
    return options.returnHeaders?{response:session,headers:new Headers()}:session;},async handler(){return new Response(null,{status:404});},
    async assertRecentReauthentication(){return {user:{id:'carer',email:'carer@example.test'}};},fromNodeHeaders(){return new Headers();}} as FirebaseAuthPort;
  const handler=createFirebaseRequestHandler({authority:f.authority,auth,publicOrigin:'https://app.example.test',mailConfigured:false,online,photos});
  let submitted:OnlineSubmission|undefined;
  const client=createPhotoApi('https://app.example.test',async(input,init)=>{
    if(String(input).endsWith('/online/submit'))submitted=JSON.parse(String(init?.body)) as OnlineSubmission;
    const headers=new Headers(init?.headers);headers.set('Origin','https://app.example.test');return handler(new Request(input,{...init,headers}));
  },undefined,{spaceId:f.space.id});
  const signal=new AbortController().signal, view=(await client.photos(childId,signal,'carer')).photos[0];
  assert.equal(view.canManage,true);assert.equal(view.recordId,null);
  await assert.rejects(client.delete(view,signal,'carer'),(error:unknown)=>error instanceof PhotoApiError&&error.status===503);
  assert.ok(submitted);const submission=submitted,opId=submission.operation.opId;
  assert.deepEqual(await online.lookup('carer',opId),{state:'unconfirmed'});
  assert.equal(await care.get('parent',childId,record.id),null,'deletion immediately invalidates the original extracted record');
  const pending=data.open('photo',photo.id,scope,firestorePhotoSchemas.photo,await ref.get());
  assert.equal(pending.state,'deleting');assert.equal(pending.deletion!.actorUserId,'carer');
  assert.notEqual(pending.deletion!.intent.operationId,opId);
  const cleanupRef=data.ref('photo_cleanup','photo-cleanup',photo.id);
  assert.ok((await cleanupRef.get()).exists,'the existing maintenance scan can discover accepted cleanup before the journal returns');
  const quota=()=>firestorePhotoSchemas.globalQuota.parse(createFirestoreRestoreCodec(f.options).decode(
    f.documents().find(row=>row.path===data.ref('photo_quota','photo-global-quota','global').path)!).value);
  assert.deepEqual(quota(),{activeBytes:0,activeCount:0,cleanupBytes:24,cleanupCount:1});
  journalUnavailable=false;
  const erasures=createFirestoreContentErasure({...f.options,journal});
  const erasureSnapshot=await f.options.database.runTransaction(tx=>tx.get(data.collection('content_erasures').limit(1)));
  const erasure=erasureSnapshot.docs[0];
  await erasures.advance(erasure);
  const sourceGeneration=await f.control(false), pendingDocuments=f.documents();
  const proof=await journal.writeOnce(pending.deletion!.intent);
  const restored=prepareFirebaseRestore(f.options,{restoreId:randomUUID(),targetDatabaseId:'synthetic-target',sourceGeneration,
    documents:pendingDocuments,liveDocuments:pendingDocuments,erasures:[...intents.values()],
    erasureDescriptors:new Map([[proof.intentSha256,proof]]),photoDescriptors:new Map(),
    authUsers:['parent','carer','viewer'].map(userId=>({userId,email:userId+'@example.test',emailVerified:true,disabled:false}))});
  const codec=createFirestoreRestoreCodec(f.options), restoredPhoto=restored.records.map(row=>codec.decode(row)).find(row=>row.context.kind==='photo'&&row.context.id===photo.id)!;
  assert.equal(firestorePhotoSchemas.photo.parse(restoredPhoto.value).deletion!.actorUserId,'carer');
  await f.control(true);
  let space=await f.sharing.get('parent',f.space.id);
  await f.sharing.share('parent',{spaceId:space.id,childId,modules:['care'],expectedVersion:space.version,operationId:randomUUID()});
  journalUnavailable=false;
  assert.deepEqual(await photos.cleanupDeleted(scope,photo.id,pending.deletion!.intent.operationId),{state:'complete'});
  assert.equal(removed,1);assert.equal((await cleanupRef.get()).exists,false);
  assert.deepEqual(quota(),{activeBytes:0,activeCount:0,cleanupBytes:0,cleanupCount:0});
  const result=await online.lookup('carer',opId);assert.equal(result.state,'confirmed');assert.equal((result as any).result,null,'revoked callers get no source details');
  space=await f.sharing.get('parent',f.space.id);
  await f.sharing.share('parent',{spaceId:space.id,childId,modules:['attachments'],expectedVersion:space.version,operationId:randomUUID()});
  assert.deepEqual((await online.submit('carer',submission) as any).result,{deleted:true,cleanupPending:true});
  assert.equal((await client.reconcilePending(signal,'carer'))?.state,'confirmed','the real client recovers the same accepted operation');
  assert.deepEqual(await photos.cleanupDeleted(scope,photo.id,pending.deletion!.intent.operationId),{state:'complete'});
  assert.equal(removed,1);
  const replacement=await photos.reserve('parent',childId,randomUUID(),metadata);assert.ok(replacement.id,'source quota remains usable');
  f.fake.records.clear();for(const row of restored.records)f.fake.records.set(row.path,row.data);
  assert.deepEqual(await photos.cleanupDeleted(scope,photo.id,pending.deletion!.intent.operationId),{state:'complete'},'restored pending cleanup reaches the real consumer');
  await setFirebaseBackupControl(f.options,{expectedGeneration:restored.generation,generation:randomUUID(),enabled:true});
  const restoredReceipt=await online.lookup('carer',opId);
  assert.equal(restoredReceipt.state,'confirmed');assert.equal((restoredReceipt as any).result,null,'restored receipt does not try to disclose the old storage epoch');
});

test('shared file and voice deletion retain actor receipts and resume the original cleanup after revocation', async () => {
  const f = await fixture(), childId = f.child.child.id, data = new FirestoreDomainData(f.options);
  const scope = await f.authority.runTransaction('parent', childId, async b => b.scope);
  await f.sharing.share('parent', {spaceId:f.space.id, childId, modules:['attachments'], expectedVersion:f.space.version, operationId:randomUUID()});
  const selection = {spaceId:f.space.id}, receipts = createFirestoreOnlineReceipts(f.options), bytes = Buffer.from('test');
  let failJournal = true, removed = 0;
  const intents = new Map<string,FirebaseErasureIntent>();
  const journalKey = (intent:FirebaseErasureIntent) => JSON.stringify([intent.scope.ownerUserId,intent.operationId]);
  const journal = { async writeOnce(intent:FirebaseErasureIntent) {
    if (failJournal) throw Object.assign(Error('Journal unavailable'), {code:'journal_unavailable'});
    const hash=firebaseErasureIntentHash(intent), key=journalKey(intent), existing=intents.get(key);
    if (existing && firebaseErasureIntentHash(existing)!==hash) throw Object.assign(Error('Journal binding'),{code:'journal_binding'});
    intents.set(key,intent);
    return {objectName:'erasures/v1/'+hash,generation:'1',cipherSha256:'c'.repeat(64),intentSha256:hash,bytes:1,format:'yuban-erasure-journal/v1' as const};
  },async read(intent:FirebaseErasureIntent,proof:{intentSha256:string}) { assert.deepEqual(intents.get(journalKey(intent)),intent);assert.equal(proof.intentSha256,firebaseErasureIntentHash(intent)); return intent; } };
  for (const kind of ['file','voice'] as const) {
    const id=randomUUID(), draftId=randomUUID(), opId=randomUUID(), at='2026-10-27T04:00:00.000Z';
    const objectName=(assetId:string)=>(kind==='file'?'chat-file':'voice')+'/v1/'+'a'.repeat(64)+'/'+assetId;
    const descriptor={objectName:objectName(id),generation:'1',cipherSha256:'c'.repeat(64),sha256:createHash('sha256').update(bytes).digest('hex'),bytes:4,
      mimeType:kind==='file'?'text/plain':'audio/wav',...(kind==='voice'?{durationMs:1000}:{})};
    const schema=kind==='file'?firestoreChatFileRowSchema:firestoreVoiceRowSchema;
    const collection=kind==='file'?'chat_file_assets':'voice_assets', tag=kind==='file'?'chat-file-asset':'voice-asset';
    const row={id,scope,objectScope:scope,version:3,createdAt:at,updatedAt:at,fingerprint:'b'.repeat(64),
      metadata:{fileName:kind+'.test',mimeType:descriptor.mimeType,bytes:4,sha256:descriptor.sha256},state:'ready',upload:null,descriptor,messageId:randomUUID(),deletion:null};
    for (const source of [row,{...row,id:draftId,messageId:null,descriptor:{...descriptor,objectName:objectName(draftId)}}]) {
      f.fake.records.set(data.ref(collection,tag,source.id).path,{...data.tags(scope),scopeTag:firestoreDomainHash([kind==='file'?'chat-file-scope':'voice-scope',scope]),
        assetId:source.id,createdAt:at,updatedAt:at,state:'ready',messageId:source.messageId,...data.seal(tag,source.id,scope,schema as any,source,3)});
    }
    const objects={address:(_scope:unknown,assetId:string)=>objectName(assetId),write:async()=>{throw Error('No upload');},read:async()=>{throw Error('No download');},
      inspect:async()=>null,remove:async(actualScope:unknown,assetId:string,actual:unknown)=>{assert.deepEqual(actualScope,scope);assert.equal(assetId,id);assert.deepEqual(actual,descriptor);removed++;}};
    const files=createFirestoreChatFilesStore({...f.options,objects,journal}), voices=createFirestoreVoiceStore({...f.options,objects,journal});
    const store=kind==='file'?files:voices;
    const shared=store.forSharedSpace(selection);
    const view=await shared.get('carer',childId,id);
    assert.equal(typeof shared.delete,'function','the shared port exposes the original deletion workflow');
    await assert.rejects(shared.delete('viewer',childId,id,3,randomUUID()),code('read_only'));
    await assert.rejects(shared.delete('carer',childId,draftId,3,randomUUID()),code('not_found'));
    await assert.rejects(shared.delete('carer',childId,id,2,randomUUID()),code('version_conflict'));
    failJournal=true;
    await assert.rejects(shared.delete('carer',childId,id,3,opId),code('journal_unavailable'));
    const receipt=await f.authority.runTransaction('carer',null,b=>receipts.read(b,opId));
    assert.equal(receipt?.ownerUserId,'carer');assert.equal(receipt?.childId,null);
    assert.equal((receipt as any).result.accepted,true);assert.equal((receipt as any).result.deleted,undefined);
    assert.equal(await f.authority.runTransaction('parent',null,b=>receipts.read(b,opId)),null,'no receipt is filed under the source owner');
    const stored=()=>data.open(tag,id,scope,schema as any,{exists:true,get:()=>undefined,data:()=>f.fake.records.get(data.ref(collection,tag,id).path)} as any) as any;
    const deleting=stored();assert.equal(deleting.state,'deleting');assert.equal(deleting.deletion.actorUserId,'carer');
    assert.equal(deleting.deletion.attribution.resourceVersion,4);assert.equal(deleting.metadata,null);
    assert.equal(schema.safeParse({...deleting,deletion:{...deleting.deletion,actorUserId:'viewer'}}).success,false);
    await assert.rejects(shared.delete('parent',childId,id,3,opId),code('operation_conflict'));
    await assert.rejects(shared.get('viewer',childId,id),code('not_found'));
    let space=await f.sharing.get('parent',f.space.id);
    await f.sharing.share('parent',{spaceId:space.id,childId,modules:['care'],expectedVersion:space.version,operationId:randomUUID()});
    const lookup=await createFirestoreOnlineStore(f.options).lookup('carer',opId);
    assert.equal(lookup.state,'confirmed');assert.equal((lookup as any).result.accepted,true);
    assert.equal((lookup as any).result.deleted,undefined,'a receipt only confirms the durable deletion intent');
    failJournal=false;
    // The real journal key uses source owner + operation ID, not the intent hash.
    await journal.writeOnce({type:kind==='file'?'file-delete':'voice-delete',scope,assetId:randomUUID(),operationId:opId,at});
    assert.deepEqual(await store.cleanupDeleted(scope,id),{state:'complete'});
    assert.equal(stored().deletion.attribution.actorUserId,'carer');
    await assert.rejects(shared.delete('carer',childId,id,3,opId));
    space=await f.sharing.get('parent',f.space.id);
    await f.sharing.share('parent',{spaceId:space.id,childId,modules:['attachments'],expectedVersion:space.version,operationId:randomUUID()});
    assert.deepEqual(await shared.delete('carer',childId,id,3,opId),{operationId:opId,deleted:true,cleanupPending:false});
    await assert.rejects(shared.delete('carer',childId,id,4,opId),code('operation_conflict'));
    assert.deepEqual(await store.cleanupDeleted(scope,id),{state:'complete'});
    const auth={async getSession(options:{returnHeaders?:boolean}){const session={user:{id:'carer',email:'carer@example.test'}};
      return options.returnHeaders?{response:session,headers:new Headers()}:session;},async handler(){return new Response(null,{status:404});},
      async assertRecentReauthentication(){return {user:{id:'carer',email:'carer@example.test'}};},fromNodeHeaders(){return new Headers();}} as FirebaseAuthPort;
    const handler=createFirebaseRequestHandler({authority:f.authority,auth,publicOrigin:'https://app.example.test',mailConfigured:false,files,voice:voices});
    const fetcher:typeof fetch=async(input,init)=>{const headers=new Headers(init?.headers);headers.set('Origin','https://app.example.test');
      return handler(new Request(input,{...init,headers}));};
    const signal=new AbortController().signal;
    const clientResult=kind==='file'
      ? await createChatFileApi(fetcher,'https://app.example.test',undefined,selection).delete(view as any,opId,signal,'carer')
      : await createVoiceApi(fetcher,'https://app.example.test',undefined,selection).delete(view as any,opId,signal,'carer');
    assert.deepEqual(clientResult,{operationId:opId,deleted:true,cleanupPending:false},'the common client reaches the same deletion receipt through the real API');
  }
  assert.equal(removed,2,'one physical removal for each original asset');assert.equal(intents.size,4);
});

test('shared documents retain the original snapshot, bounded source selection and actor receipts', async () => {
  const f = await fixture(), childId = f.child.child.id;
  const care = createFirestoreCareStore(f.options), online = createFirestoreOnlineStore({ ...f.options, mutations: [care.mutation] });
  const cmd = { path: `/api/children/${childId}/records`, payload: { text: 'Owner record included only in the saved preparation' } };
  const ctx = await online.context('parent', cmd);
  const record = (await online.submit('parent', { ...cmd, operation: { ...ctx, deviceId: randomUUID(), opId: randomUUID() } })).result as any;
  const documents = createFirestoreFamilyDocumentStore(f.options);
  const request = { kind: 'preparation' as const, purpose: 'appointment' as const, title: 'Shared preparation',
    period: { from: '2026-01-01', to: '2026-12-31' }, eventDate: null };
  const original = (await documents.create('parent', childId, request, randomUUID()))!;
  await f.sharing.share('parent', { spaceId: f.space.id, childId, modules: ['documents'], expectedVersion: f.space.version, operationId: randomUUID() });
  const selected = documents.forSharedSpace({ spaceId: f.space.id });
  const view = (await selected.describe('carer', childId, original.id))!;
  assert.equal(view.item.current!.sources.some(s => s.resourceId === record.record.id), true);
  let actor = 'carer';
  const auth = { async getSession(options: { returnHeaders?: boolean }) { const session = { user: { id: actor, email: actor + '@example.test' } };
    return options.returnHeaders ? { response: session, headers: new Headers() } : session; },
    async handler() { return new Response(null, { status: 404 }); },
    async assertRecentReauthentication() { return { user: { id: actor, email: actor + '@example.test' } }; },
    fromNodeHeaders() { return new Headers(); } } as FirebaseAuthPort;
  const handler = createFirebaseRequestHandler({ authority: f.authority, auth, publicOrigin: 'https://app.example.test', mailConfigured: false, documents });
  const fetcher: typeof fetch = async (input, init) => { const headers = new Headers(init?.headers); headers.set('Origin', 'https://app.example.test');
    return handler(new Request(input, { ...init, headers })); };
  const client = createFamilyDocumentsApi('https://app.example.test', fetcher, { spaceId: f.space.id }), signal = new AbortController().signal;
  const ownNew = await client.create(childId, { ...request, title: 'Scoped preparation' }, signal, 'carer');
  assert.equal(ownNew.current!.sources.some(s => s.resourceId === record.record.id), false);
  assert.equal((await documents.get('parent', childId, ownNew.id))!.readState, 'ready');
  const opId = randomUUID(), change = { action: 'check_item' as const, expectedVersion: original.version, authorityVersion: view.authorityVersion,
    sectionId: 'checklist', itemId: 'template-0', checked: true };
  const updated = (await selected.change('carer', childId, original.id, change, opId))!;
  assert.equal(updated.current!.sections.find(s => s.id === 'checklist')!.items[0].checked, true);
  assert.deepEqual(await selected.change('carer', childId, original.id, change, opId), updated);
  assert.equal((await selected.operationReceipt!('carer', childId, opId))!.savedVersion, 2);
  assert.equal((await documents.get('parent', childId, original.id))!.version, 2);
  actor = 'viewer';
  assert.equal((await client.getPage(childId, signal, actor)).canManage, false);
  assert.equal((await client.readContent(childId, original.id, { snapshotId: updated.current!.id, snapshotVersion: 2, offset: 0 }, signal, actor)).snapshotVersion, 2);
  await assert.rejects(client.change(childId, original.id, { ...change, expectedVersion: 2 }, signal, actor), { status: 403, code: 'read_only' });
  await assert.rejects(selected.change('viewer', childId, original.id, { ...change, expectedVersion: 2 }, randomUUID()), code('read_only'));
  const codec = createFirestoreRestoreCodec(f.options);
  for (const row of f.documents().filter(row => /_(documents|document_operations|document_snapshots|document_snapshot_chunks)\//u.test(row.path))) codec.decode(row);
  const data = new FirestoreDomainData(f.options), receiptId = JSON.stringify(['carer', opId]);
  const receipt = f.documents().find(row => row.path === data.ref('document_operations', 'document-operation', receiptId).path)!;
  const forged = { ...codec.decode(receipt).value as any }; delete forged.changedViaShare;
  assert.throws(() => codec.decode({ ...receipt, data: { ...receipt.data,
    ...data.seal('document-operation', receiptId, f.child.scope, firestoreFamilyDocumentSchemas.operation, forged) } }), code('restore_binding'));
  await care.revise('parent', childId, record.record.id, { text: 'Corrected source', details: record.record.details, source: record.record.source }, 1, 'Correction');
  const rebind = updated.current!.sections.flatMap(section => section.items.filter(item => item.sourceIds.includes('record:' + record.record.id))
    .map(item => ({ op: 'upsert_item' as const, sectionId: section.id, itemId: item.id, text: 'Replacement wording', sourceIds: item.sourceIds })));
  assert.ok(rebind.length > 0);
  await assert.rejects(selected.change('carer', childId, original.id, { action: 'patch', expectedVersion: 2,
    authorityVersion: view.authorityVersion, confirmShared: true, edits: rebind }, randomUUID()), code('source_changed'));
  assert.equal((await selected.get('carer', childId, original.id))!.current, null);
  const redacted = (await selected.readContent('carer', childId, original.id, { snapshotId: updated.current!.id, snapshotVersion: 2, offset: 0 }))!;
  assert.equal(redacted.invalidated, true); assert.equal(redacted.text.includes(cmd.payload.text), false);
  assert.equal((await selected.operationReceipt!('carer', childId, opId))!.contentState, 'invalidated');
  const grant = await f.sharing.get('parent', f.space.id);
  await f.sharing.share('parent', { spaceId: f.space.id, childId, modules: ['documents', 'care'], expectedVersion: grant.version, operationId: randomUUID() });
  const patch = { action: 'patch' as const, expectedVersion: 2, authorityVersion: view.authorityVersion, confirmShared: true as const, edits: rebind };
  await assert.rejects(selected.change('carer', childId, original.id, patch, randomUUID()), code('document_changed'));
  patch.authorityVersion = (await selected.describe('carer', childId, original.id))!.authorityVersion;
  const rebound = (await selected.change('carer', childId, original.id, patch, randomUUID()))!;
  assert.equal(rebound.current!.sources.find(source => source.resourceId === record.record.id)!.text, 'Corrected source（發生時間未確認）');
  const current = await f.sharing.get('parent', f.space.id);
  await f.sharing.unshare('parent', { spaceId: f.space.id, childId, expectedVersion: current.version, operationId: randomUUID() });
  await assert.rejects(selected.get('carer', childId, original.id), code('module_not_shared'));
  await assert.rejects(client.getItem(childId, original.id, signal, 'viewer'), { status: 403, code: 'module_not_shared' });
});

test('shared document maintenance retains the original source selection and stops after revocation', async () => {
  const f = await fixture(), childId = f.child.child.id, data = new FirestoreDomainData(f.options);
  const care = createFirestoreCareStore(f.options), online = createFirestoreOnlineStore({ ...f.options, mutations: [care.mutation] });
  const command = { path: `/api/children/${childId}/records`, payload: { text: 'Do not include this unshared record' } };
  const context = await online.context('parent', command);
  await online.submit('parent', { ...command, operation: { ...context, opId: randomUUID(), deviceId: randomUUID() } });
  await f.sharing.share('parent', { spaceId: f.space.id, childId, modules: ['documents'], expectedVersion: f.space.version, operationId: randomUUID() });
  const documents = createFirestoreFamilyDocumentStore(f.options), selected = documents.forSharedSpace({ spaceId: f.space.id });
  const created = (await selected.create('carer', childId, { kind: 'growth_report', purpose: 'family', title: 'Bounded report',
    period: { from: '2026-01-01', to: '2026-12-31' }, eventDate: null }, randomUUID()))!;
  async function job() {
    const row = (await documents.get('parent', childId, created.id))!;
    const id = await f.authority.runTransaction('parent', childId, async b => {
      const work = await prepareFirestoreBackgroundWork(data, b.transaction, { kind: 'document-refresh', scope: b.scope,
        resourceId: row.id, basis: 'version:' + row.version, generation: b.generation, authorizationVersion: b.authorizationVersion }, new Date().toISOString());
      work.commit(); return work.id;
    });
    return f.authority.runTransaction('parent', childId, async b => data.open('background-work', id, b.scope, firestoreBackgroundWorkSchema,
      await b.transaction.get(data.ref('background_work', 'background-work', id))));
  }
  const firstJob = await job();
  assert.equal((await documents.processRefresh(firstJob)).state, 'completed');
  const afterFirst = (await documents.get('parent', childId, created.id))!;
  assert.equal((await documents.processRefresh(firstJob)).state, 'completed');
  assert.equal((await documents.get('parent', childId, created.id))!.version, afterFirst.version);
  for (let n = 0; n < 5 && (await documents.get('parent', childId, created.id))!.report?.phase === 'building'; n++)
    assert.equal((await documents.processRefresh(await job())).state, 'completed');
  const complete = (await selected.get('carer', childId, created.id))!;
  assert.equal(complete.report!.phase, 'complete');
  assert.equal(complete.current!.sources.some(source => source.kind === 'record'), false);
  assert.match(complete.current!.coverageNote, /未選模組/u);
  const codec = createFirestoreRestoreCodec(f.options);
  for (const row of f.documents().filter(row => /_(documents|document_operations)\//u.test(row.path))) codec.decode(row);
  const lastJob = await job(), space = await f.sharing.get('parent', f.space.id);
  await f.sharing.unshare('parent', { spaceId: f.space.id, childId, expectedVersion: space.version, operationId: randomUUID() });
  const before = f.documents();
  assert.equal((await documents.processRefresh(lastJob)).state, 'stopped');
  assert.deepEqual(f.documents(), before);
});

test('shared memory keeps private candidates and source messages private across reads, writes, receipts and history', async () => {
  const f = await fixture(), childId = f.child.child.id;
  const care = createFirestoreCareStore(f.options), chat = createFirestoreChatStore(f.options);
  const memory = createFirestoreMemoryStore({ ...f.options, care, chat });
  const online = createFirestoreOnlineStore({ ...f.options, mutations: [chat.mutation, care.mutation, memory.mutation] });
  async function own(path: string, payload: Record<string, unknown>) {
    const context = await online.context('parent', { path, payload });
    return online.submit('parent', { path, payload, operation: { ...context, opId: randomUUID(), deviceId: randomUUID() } });
  }
  const message = (await own(`/api/children/${childId}/messages`, { text: 'Private original text' })).result as any;
  const input = { intendedVisibility: 'family' as const, values: { key: 'Food preference', content: 'Original shared fact', validUntil: null,
    source: { kind: 'private_chat' as const, description: 'Confirmed statement', messageId: message.message.id } } };
  const candidate = await memory.createFact('parent', childId, input); assert.ok(candidate);
  await memory.confirmFact('parent', childId, candidate.id, { expectedVersion: 1, confirm: true, confirmShared: true });
  const hidden = await memory.createFact('parent', childId, { ...input, values: { ...input.values, key: 'Private candidate' } }); assert.ok(hidden);
  await f.sharing.share('parent', { spaceId: f.space.id, childId, modules: ['memory'], expectedVersion: f.space.version, operationId: randomUUID() });
  const selected = memory.forSharedSpace(f.space.id);
  const facts = await selected.facts('carer', childId); assert.ok(facts);
  assert.equal(facts.items.length, 1); assert.equal('messageId' in facts.items[0].source, false);
  assert.equal((await selected.history('carer', childId, 'facts', candidate.id))?.revisions.length, 1);
  await assert.rejects(selected.reviseFact('carer', childId, candidate.id, { ...input, values: input.values, expectedVersion: 2, confirm: true, confirmShared: true, reason: 'Direct route' }), code('sharing_receipt_required'));
  const session = { user: { id: 'carer' } };
  const auth = { async handler() { return new Response(null, { status: 404 }); },
    async getSession(options: { returnHeaders?: boolean }) { return options.returnHeaders ? { response: session, headers: new Headers() } : session; },
    async assertRecentReauthentication() { return session; }, fromNodeHeaders() { return new Headers(); } } as FirebaseAuthPort;
  const handler = createFirebaseRequestHandler({ authority: f.authority, auth, publicOrigin: 'https://app.example.test', mailConfigured: false, online, memory });
  const submissions: any[] = [];
  const fetcher: typeof fetch = async (input, init) => { const headers = new Headers(init?.headers); headers.set('Origin', 'https://app.example.test');
    if (String(input).endsWith('/online/submit')) submissions.push(JSON.parse(String(init?.body)));
    return handler(new Request(input, { ...init, headers })); };
  const client = createMemoryApi('https://app.example.test', fetcher, { spaceId: f.space.id }), signal = new AbortController().signal;
  const revised = await client.reviseFact(childId, candidate.id, { expectedVersion: 2, confirm: true, confirmShared: true, reason: 'Shared correction',
    values: { ...input.values, content: 'Corrected shared fact', source: facts.items[0].source } }, signal, 'carer');
  assert.equal(revised.confirmedBy, 'carer'); assert.equal('messageId' in revised.source, false);
  assert.equal('confirmedViaShare' in revised, false);
  assert.equal((await memory.getFact('parent', childId, candidate.id))?.source.kind, 'private_chat');
  assert.equal((await client.factHistory(childId, candidate.id, null, signal)).revisions.length, 2);
  const manual = await client.createConfirmedFact!(childId, { intendedVisibility: 'family', confirm: true, confirmShared: true,
    values: { key: 'Shared manual', content: 'Explicit shared statement', validUntil: null, source: { kind: 'manual', description: 'Carer statement' } } }, signal, 'carer');
  assert.equal(manual.createdBy, 'carer');
  const originalSubmission = submissions.at(-1);
  assert.deepEqual((await online.lookup('carer', originalSubmission.operation.opId) as any).result, { fact: manual });
  assert.deepEqual((await online.submit('carer', originalSubmission)).result, { fact: manual });
  // A later owner correction may introduce a private source, even when a caregiver created the fact.
  await memory.reviseFact('parent', childId, manual.id, { expectedVersion: 1, confirm: true, confirmShared: true, reason: 'Owner source correction',
    values: { ...input.values, key: manual.key, content: manual.content } });
  assert.equal('messageId' in (await selected.getFact('carer', childId, manual.id))!.source, false);
  const topic = await client.createTopic(childId, { title: 'Shared follow-up', note: '', visibility: 'family', confirmShared: true }, signal, 'carer');
  const done = await client.changeTopic(childId, topic.id, { expectedVersion: 1, status: 'resolved', note: '', resumeAfter: null }, signal, 'carer');
  const doneSubmission = submissions.at(-1);
  assert.equal(done.mayAsk, false); assert.equal(done.updatedBy, 'carer');
  assert.deepEqual((await online.lookup('carer', doneSubmission.operation.opId) as any).result, { topic: done });
  assert.equal((await client.summary(childId, signal)), null);
  assert.equal((await client.facts(childId, null, signal)).items.some(fact => fact.id === hidden.id), false);
  const codec = createFirestoreRestoreCodec(f.options);
  for (const row of f.documents().filter(row => /_memory_(facts|fact_revisions|topics|topic_revisions)\//u.test(row.path))) codec.decode(row);
  const data = new FirestoreDomainData(f.options);
  const original = f.documents().find(row => row.path === data.ref('memory_facts', 'memory-fact', manual.id).path)!;
  const decoded = codec.decode(original), unsafe = { ...decoded.value as any }; delete unsafe.createdViaShare;
  assert.throws(() => codec.decode({ ...original, data: { ...original.data,
    ...data.seal('memory-fact', manual.id, f.child.scope, firestoreFactStorageSchema, unsafe, unsafe.version) } }), code('restore_binding'));
  await client.deleteFact(childId, manual.id, { expectedVersion: 2, confirmDelete: true }, signal, 'carer');
  assert.equal((await online.lookup('carer', originalSubmission.operation.opId) as any).result, null);
  assert.equal(await selected.history('carer', childId, 'facts', manual.id), null);
  const current = await f.sharing.get('parent', f.space.id);
  await f.sharing.unshare('parent', { spaceId: f.space.id, childId, expectedVersion: current.version, operationId: randomUUID() });
  assert.equal((await online.lookup('carer', doneSubmission.operation.opId) as any).result, null);
  assert.equal((await online.submit('carer', doneSubmission)).result, null);
  await assert.rejects(client.facts(childId, null, signal), { status: 403 });
  assert.equal((await memory.getFact('parent', childId, candidate.id))?.version, 3);
});

test('shared tasks keep one original, attributed revisions, owner reminder authority and revocable receipts', async () => {
  const f = await fixture(), childId = f.child.child.id, shared = { spaceId: f.space.id };
  await f.sharing.share('parent', { ...shared, childId, modules: ['tasks'], expectedVersion: f.space.version, operationId: randomUUID() });
  const worker = createFirestoreTaskWorker({ ...f.options, enabled: true,
    async currentAuth(userId) { return { userId, email: userId + '@example.test', disabled: false, emailVerified: true }; } });
  const online = createFirestoreOnlineStore({ ...f.options, reminders: worker });
  const command = { path: `/api/children/${childId}/tasks`, sharing: shared, payload: { confirm: true, values: {
    title: 'Shared appointment', details: '', kind: 'appointment', assigneeUserId: 'parent',
    dueAt: '2026-10-27T03:00:00Z', timeZone: 'Asia/Hong_Kong' } } };
  const context = await online.context('carer', command);
  const submitted = { ...command, sharing: { ...shared, expectedBasis: context.sharingBasis },
    operation: { workspaceId: context.workspaceId, storageEpoch: context.storageEpoch, opId: randomUUID(), deviceId: randomUUID() } };
  const receipt = await online.submit('carer', submitted), task = (receipt.result as any).task;
  assert.equal(task.createdBy, 'carer'); assert.equal(task.assigneeUserId, 'parent');
  assert.equal('createdViaShare' in task, false);
  assert.deepEqual(await online.lookup('carer', submitted.operation.opId), receipt);
  assert.deepEqual(await online.submit('carer', submitted), receipt);
  assert.equal((await online.tasks.get('parent', childId, task.id))?.id, task.id);
  await assert.rejects(online.tasks.get('carer', childId, task.id), code('binding'));
  await assert.rejects(online.context('viewer', command), code('read_only'));
  const selected = online.tasks.forSharedSpace!(f.space.id);
  assert.equal((await selected.list('viewer', childId)).items[0].id, task.id);
  assert.deepEqual((await selected.list('carer', childId)).eligibleAssignees.map(value => value.userId), ['parent']);
  const [job] = await worker.due('parent', childId);
  const claim = await worker.claim(job); assert.equal(claim.state, 'claimed');

  const session = { user: { id: 'carer' } };
  const auth = { async handler() { return new Response(null, { status: 404 }); },
    async getSession(options: { returnHeaders?: boolean }) { return options.returnHeaders ? { response: session, headers: new Headers() } : session; },
    async assertRecentReauthentication() { return session; }, fromNodeHeaders() { return new Headers(); } } as FirebaseAuthPort;
  const handler = createFirebaseRequestHandler({ authority: f.authority, auth, publicOrigin: 'https://app.example.test', mailConfigured: false, online });
  const fetcher: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers); headers.set('Origin', 'https://app.example.test');
    return handler(new Request(input, { ...init, headers }));
  };
  const client = createTaskApi('https://app.example.test', fetcher, shared), signal = new AbortController().signal;
  assert.equal((await client.tasks(childId, null, signal)).items[0].id, task.id);
  assert.equal((await client.task(childId, task.id, signal)).version, 1);
  const done = await client.changeTask(childId, task.id, { action: 'complete', expectedVersion: 1, confirm: true, note: '' }, signal, 'carer');
  assert.equal(done.occurrence.state, 'completed');
  assert.equal((await client.history(childId, task.id, null, signal)).revisions[0].actorUserId, 'carer');
  if (claim.state !== 'claimed') throw new Error('Expected an original reminder lease');
  assert.equal((await worker.complete(job, claim.lease)).state, 'stopped');
  assert.equal(f.documents().some(row => row.path.includes('_notification_outbox/')), false);
  assert.equal((await online.lookup('carer', submitted.operation.opId) as any).result.task.version, 1, 'original receipt does not claim the newer outcome');
  const codec = createFirestoreRestoreCodec(f.options);
  for (const row of f.documents().filter(value => /_(tasks|task_revisions)\//u.test(value.path))) {
    const decoded = codec.decode(row);
    assert.equal((decoded.value as any).task?.createdBy ?? (decoded.value as any).createdBy, 'carer');
  }
  const taskRow = f.documents().find(row => row.path.includes('_tasks/'))!, savedTask = codec.decode(taskRow).value as any;
  const withoutProof = { ...savedTask }; delete withoutProof.createdViaShare;
  const data = new FirestoreDomainData(f.options);
  assert.throws(() => codec.decode({ path: taskRow.path, data: { ...taskRow.data,
    ...data.seal('task', task.id, f.child.scope, firestoreTaskStorageSchema, withoutProof, savedTask.version) } }), code('restore_binding'));
  const current = await f.sharing.get('parent', f.space.id);
  await f.sharing.unshare('parent', { ...shared, childId, expectedVersion: current.version, operationId: randomUUID() });
  assert.equal((await online.lookup('carer', submitted.operation.opId) as any).result, null);
  assert.equal((await online.submit('carer', submitted)).result, null);
  await assert.rejects(selected.get('carer', childId, task.id), code('module_not_shared'));
  assert.equal((await online.tasks.get('parent', childId, task.id))?.occurrence.state, 'completed');
});

test('shared care uses the original domain, actor receipts, current grants and deletion barriers', async () => {
  const f = await fixture(), childId = f.child.child.id;
  await f.sharing.share('parent', { spaceId: f.space.id, childId, modules: ['care'],
    expectedVersion: f.space.version, operationId: randomUUID() });
  const care = createFirestoreCareStore(f.options), online = createFirestoreOnlineStore({ ...f.options, mutations: [care.mutation] });
  const command = { path: `/api/children/${childId}/records`, payload: { text: 'Shared original record' }, sharing: { spaceId: f.space.id } };
  const context = await online.context('carer', command);
  assert.ok(context.sharingBasis);
  const submission = { ...command, sharing: { ...command.sharing, expectedBasis: context.sharingBasis }, operation: {
    workspaceId: context.workspaceId, storageEpoch: context.storageEpoch, opId: randomUUID(), deviceId: randomUUID() } };
  const receipt = await online.submit('carer', submission), value = (receipt.result as any).record;
  assert.equal(value.authorUserId, 'carer'); assert.equal(value.confirmedBy, 'carer');
  assert.equal((await care.get('parent', childId, value.id))?.id, value.id);
  assert.deepEqual(await online.submit('carer', submission), receipt);
  assert.deepEqual(await online.lookup('carer', submission.operation.opId), receipt);
  const codec = createFirestoreRestoreCodec(f.options);
  const backupRows = f.documents().filter(row => /_(care_records|care_revisions)\//u.test(row.path));
  assert.equal(backupRows.length, 2);
  for (const row of backupRows) assert.equal((codec.decode(row).value as any).authorUserId, 'carer');
  const original = backupRows.find(row => row.path.includes('_care_records/'))!, decoded = codec.decode(original);
  const unsafe = { ...decoded.value as any }; delete unsafe.confirmedViaShare;
  const data = new FirestoreDomainData(f.options);
  assert.throws(() => codec.decode({ path: original.path, data: { ...original.data,
    ...data.seal('care-record', value.id, f.child.scope, firestoreCareStorageSchema, unsafe, 1) } }), code('restore_binding'),
    'non-owner attribution without a bound sharing proof still fails restore');
  assert.equal('createdViaShare' in value, false, 'internal attribution is not sent to clients');
  assert.equal((await care.forSharedSpace(f.space.id).listRecords('viewer', childId)).records[0].id, value.id);
  await assert.rejects(care.get('carer', childId, value.id), code('binding'));
  await assert.rejects(care.forSharedSpace(f.space.id).profile('carer', childId), code('module_not_shared'));
  await assert.rejects(online.context('viewer', command), code('read_only'));
  await assert.rejects(online.submit('carer', { ...submission, sharing: undefined }), code('operation_conflict'));
  await assert.rejects(online.submit('carer', { ...submission, operation: { ...submission.operation, opId: randomUUID() },
    sharing: { spaceId: f.space.id } }), code('sharing_precondition_required'));
  await assert.rejects(online.submit('carer', { ...submission, operation: { ...submission.operation, opId: randomUUID() },
    sharing: { ...submission.sharing, expectedBasis: { ...context.sharingBasis!, shareVersion: 100 } } }), code('sharing_scope_changed'));
  await f.sharing.withResource('carer', { spaceId: f.space.id, childId, module: 'care', mode: 'read' }, async access => {
    await assert.rejects(access.binding.readWork(randomUUID()), code('shared_private_scope'));
    await assert.rejects(access.binding.prepareChange(randomUUID(), 'care', false), code('read_only'));
  });
  // Shared Web/Android transport goes through production HTTP composition, not a custom test endpoint.
  const session = { user: { id: 'carer' } };
  const auth = { async handler() { return new Response(null, { status: 404 }); },
    async getSession(options: { returnHeaders?: boolean }) { return options.returnHeaders ? { response: session, headers: new Headers() } : session; },
    async assertRecentReauthentication() { return session; },
    fromNodeHeaders() { return new Headers(); } } as FirebaseAuthPort;
  const handler = createFirebaseRequestHandler({ authority: f.authority, auth, publicOrigin: 'https://app.example.test',
    mailConfigured: false, online, care });
  const fetcher: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers); headers.set('Origin', 'https://app.example.test');
    return handler(new Request(input, { ...init, headers }));
  };
  const transport = createOnlineTransport('https://app.example.test/api', fetcher);
  const viaClient = await transport.submit({ ...command, payload: { text: 'Written through the shared client' } }, new AbortController().signal, 'carer') as any;
  const response = await fetcher(`https://app.example.test/api/children/${childId}/records?spaceId=${f.space.id}`);
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control')?.includes('no-store'), true);
  assert.ok((await response.json()).records.some((r: any) => r.id === viaClient.record.id));
  const sharedVersion = await f.sharing.get('parent', f.space.id);
  await f.sharing.share('parent', { spaceId: f.space.id, childId, modules: ['care', 'profile'],
    expectedVersion: sharedVersion.version, operationId: randomUUID() });
  const careClient = createCareApi('https://app.example.test', fetcher, { spaceId: f.space.id });
  const profile = await careClient.saveProfile(childId, { age: { kind: 'unknown' }, dueDate: null, gestationalWeeksRaw: null,
    region: null, language: null, allergies: null, specialNeeds: null, preferences: null, source: 'Shared statement', validUntil: null },
    0, 'Initial shared profile', new AbortController().signal, 'carer');
  assert.equal(profile.confirmedBy, 'carer');
  assert.deepEqual(await careClient.getProfile(childId, new AbortController().signal), profile);
  await careClient.deleteProfile(childId, 1, new AbortController().signal, 'carer');
  await careClient.saveProfile(childId, profile.data!, 2, 'New profile after erasure', new AbortController().signal, 'carer');
  const profileBackup = f.documents().filter(row => /_(child_profiles|profile_revisions|content_erasures)\//u.test(row.path));
  const decodedProfiles = profileBackup.map(row => codec.decode(row));
  const journal = decodedProfiles.filter(row => row.context.kind === 'content-erasure').map(row => (row.value as { intent: FirebaseErasureIntent }).intent);
  const removed = replayContentErasures(data, codec, decodedProfiles, decodedProfiles, journal, new Map(profileBackup.map(row => [row.path, row.data])));
  assert.equal(removed.size, 1);
  const restoredProfile = decodedProfiles.find(row => row.context.kind === 'child-profile')!.value as any;
  assert.equal(restoredProfile.version, 3); assert.equal(restoredProfile.confirmedViaShare.actorUserId, 'carer');
  const parentContext = await online.context('parent', { path: `/api/children/${childId}/care/${value.id}/delete`, payload: {} });
  await online.submit('parent', { path: `/api/children/${childId}/care/${value.id}/delete`, payload: { expectedVersion: 1, confirmDelete: true },
    operation: { ...parentContext, opId: randomUUID(), deviceId: randomUUID() } });
  assert.equal((await online.lookup('carer', submission.operation.opId) as any).result, null);
  const current = await f.sharing.get('parent', f.space.id);
  await f.sharing.unshare('parent', { spaceId: f.space.id, childId, expectedVersion: current.version, operationId: randomUUID() });
  assert.equal((await online.submit('carer', submission)).result, null);
  await assert.rejects(care.forSharedSpace(f.space.id).listRecords('carer', childId), code('module_not_shared'));
  const beforeDissolve = await f.sharing.get('parent', f.space.id);
  await f.sharing.dissolve('parent', { spaceId: f.space.id, expectedVersion: beforeDissolve.version, operationId: randomUUID() });
  assert.equal((await online.lookup('carer', submission.operation.opId) as any).result, null, 'dissolution settles the original receipt without disclosing content');
});

test('sharing preserves original storage, restricts modules/roles, and rechecks revoked access in the same transaction', async () => {
  const f = await fixture();
  const command = { spaceId: f.space.id, childId: f.child.child.id, modules: ['tasks' as const],
    expectedVersion: f.space.version, operationId: randomUUID() };
  const share = await f.sharing.share('parent', command);
  assert.deepEqual(await f.sharing.share('parent', command), share);
  await assert.rejects(f.sharing.share('parent', { ...command, modules: ['memory'] }), code('operation_conflict'));
  const request = { spaceId: f.space.id, childId: f.child.child.id, module: 'tasks' as const, mode: 'write' as const };
  const access = await f.sharing.withResource('carer', request, async access => {
    assert.equal(access.actorUserId, 'carer');
    assert.deepEqual(access.scope, f.child.scope);
    assert.equal(access.role, 'caregiver');
    assert.equal(access.includePrivate, false);
    return access.basis;
  });
  await assert.rejects(f.authority.readScope('carer', f.child.child.id), code('binding'));
  await assert.rejects(f.sharing.withResource('carer', { ...request, module: 'memory' }, async () => assert.fail()), code('module_not_shared'));
  await assert.rejects(f.sharing.withResource('viewer', request, async () => assert.fail()), code('read_only'));
  await f.sharing.withResource('viewer', { ...request, mode: 'read' }, async a => assert.equal(a.role, 'viewer'));
  const current = await f.sharing.get('parent', f.space.id);
  await f.sharing.unshare('parent', { spaceId: f.space.id, childId: f.child.child.id,
    expectedVersion: current.version, operationId: randomUUID() });
  await assert.rejects(f.sharing.withResource('carer', { ...request, expectedBasis: access }, async () => assert.fail()), code('module_not_shared'));
  assert.deepEqual((await f.authority.readScope('parent', f.child.child.id)).scope, f.child.scope, 'unshare does not delete original');
});

test('management transfers only to the accepting member and survives the former manager leaving', async () => {
  const f = await fixture();
  const sharedCommand = { spaceId: f.space.id, childId: f.child.child.id, modules: ['tasks' as const],
    expectedVersion: f.space.version, operationId: randomUUID() };
  const shared = await f.sharing.share('parent', sharedCommand);
  const pending = await f.sharing.proposeTransfer('parent', { spaceId: f.space.id, targetUserId: 'carer',
    expectedVersion: shared.version, operationId: randomUUID() });
  await assert.rejects(f.sharing.acceptTransfer('viewer', { spaceId: f.space.id, expectedVersion: pending.version,
    operationId: randomUUID() }), code('transfer_target'));
  const transferred = await f.sharing.acceptTransfer('carer', { spaceId: f.space.id, expectedVersion: pending.version,
    operationId: randomUUID() });
  assert.equal(transferred.managerUserId, 'carer');
  assert.deepEqual(transferred.storageIdentity, f.space.storageIdentity);
  const leave = { spaceId: f.space.id, expectedVersion: transferred.version, operationId: randomUUID() };
  const left = await f.sharing.leave('parent', leave);
  assert.deepEqual(await f.sharing.leave('parent', leave), left);
  assert.deepEqual(Object.keys(left).sort(), ['spaceId', 'state', 'version']);
  assert.equal((await f.sharing.get('carer', f.space.id)).managerUserId, 'carer');
  await assert.rejects(f.sharing.get('parent', f.space.id), code('space_access_denied'));
  await assert.rejects(f.sharing.share('parent', sharedCommand), code('space_access_denied'));
  const current = await f.sharing.get('carer', f.space.id);
  await assert.rejects(f.sharing.leave('carer', { spaceId: f.space.id, expectedVersion: current.version,
    operationId: randomUUID() }), code('space_transfer_or_dissolve_required'));
  await assert.rejects(f.authority.runTransaction('carer', null, async b => {
    const change = await b.prepareErasure(randomUUID(), 'account'); change.commit();
  }), code('space_transfer_or_dissolve_required'));
  await f.authority.runTransaction('parent', null, async b => {
    const change = await b.prepareErasure(randomUUID(), 'account'); change.commit();
  });
  assert.equal((await f.sharing.get('carer', f.space.id)).id, f.space.id);
});

test('isolated restore keeps current transfer/revocation and rebinds source epochs without restoring private access', async () => {
  const f = await fixture();
  let space = await f.sharing.share('parent', { spaceId: f.space.id, childId: f.child.child.id, modules: ['tasks'],
    expectedVersion: f.space.version, operationId: randomUUID() });
  await f.control(false); const snapshot = f.documents(); await f.control(true);
  const laterCreate = { operationId: randomUUID(), name: 'Post-backup space', kind: 'family' as const };
  const laterSpace = await f.sharing.create('parent', laterCreate);
  await f.authority.issueInvitation({ email: 'later@example.test', expiresAt: '2026-10-28T04:00:00Z', operationId: randomUUID() });
  await f.authority.admitIdentity({ userId: 'later', email: 'later@example.test', emailVerified: true });
  await f.authority.acknowledge({ userId: 'later', operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  const invitation = await f.sharing.invite('parent', { spaceId: space.id, expectedVersion: space.version, operationId: randomUUID(),
    email: 'later@example.test', role: 'caregiver', expiresAt: '2026-10-28T04:00:00Z' });
  space = await f.sharing.acceptInvitation('later', { token: invitation.token, operationId: randomUUID() });
  space = await f.sharing.unshare('parent', { spaceId: space.id, childId: f.child.child.id, expectedVersion: space.version, operationId: randomUUID() });
  space = await f.sharing.proposeTransfer('parent', { spaceId: space.id, targetUserId: 'later', expectedVersion: space.version, operationId: randomUUID() });
  space = await f.sharing.acceptTransfer('later', { spaceId: space.id, expectedVersion: space.version, operationId: randomUUID() });
  await f.sharing.leave('parent', { spaceId: space.id, expectedVersion: space.version, operationId: randomUUID() });
  const generation = await f.control(false);
  const restored = prepareFirebaseRestore(f.options, { restoreId: randomUUID(), targetDatabaseId: 'synthetic-target', sourceGeneration: generation,
    documents: snapshot, liveDocuments: f.documents(), erasures: [], erasureDescriptors: new Map(), photoDescriptors: new Map(),
    authUsers: ['parent', 'carer', 'viewer', 'later'].map(userId => ({ userId, email: userId + '@example.test', disabled: false, emailVerified: true })) });
  const codec = createFirestoreRestoreCodec(f.options), decoded = restored.records.map(row => codec.decode(row));
  assert.equal(sharedSpaceSchema.parse(decoded.find(row => row.context.kind === 'shared-space' && row.context.id === space.id)!.value).managerUserId, 'later');
  assert.ok(decoded.some(row => row.context.kind === 'account' && row.context.id === 'later'));
  const grant = resourceShareSchema.parse(decoded.find(row => row.context.kind === 'resource-share')!.value);
  assert.equal(grant.state, 'revoked');
  assert.equal(grant.source.storageEpoch, restored.newEpochByWorkspace.get(f.child.scope.workspaceId));
  assert.equal(sharedMembershipSchema.parse(decoded.find(row => row.context.kind === 'shared-membership'
    && sharedMembershipSchema.parse(row.value).userId === 'parent' && sharedMembershipSchema.parse(row.value).spaceId === space.id)!.value).state, 'revoked');
  assert.equal(sharingErasedBy('resource-share', grant, f.child.scope, true), true);
  assert.equal(sharingErasedBy('shared-space', space, f.child.scope, true), false);
  f.fake.records.clear(); for (const row of restored.records) f.fake.records.set(row.path, row.data);
  await setFirebaseBackupControl(f.options, { expectedGeneration: restored.generation, generation: randomUUID(), enabled: true });
  const count = f.fake.records.size;
  assert.equal((await f.sharing.create('parent', laterCreate)).id, laterSpace.id, 'post-backup receipt prevents duplicate creation');
  assert.equal(f.fake.records.size, count);
});

test('an unused invitation cannot revive when management returns to the original manager', async () => {
  const f = await fixture();
  const left = await f.sharing.leave('viewer', { spaceId: f.space.id, expectedVersion: f.space.version, operationId: randomUUID() });
  const invitation = await f.sharing.invite('parent', { spaceId: f.space.id, expectedVersion: left.version,
    operationId: randomUUID(), email: 'viewer@example.test', role: 'viewer', expiresAt: '2026-10-28T04:00:00Z' });
  let space = invitation.space;
  for (const [from, to] of [['parent', 'carer'], ['carer', 'parent']]) {
    space = await f.sharing.proposeTransfer(from!, { spaceId: space.id, expectedVersion: space.version, targetUserId: to!, operationId: randomUUID() });
    space = await f.sharing.acceptTransfer(to!, { spaceId: space.id, expectedVersion: space.version, operationId: randomUUID() });
  }
  await assert.rejects(f.sharing.acceptInvitation('viewer', { token: invitation.token, operationId: randomUUID() }), code('invitation_revoked'));
});


test('shared attachment reads preserve objects, hide private chat links and stop after access changes', async () => {
  const f = await fixture(), childId = f.child.child.id, data = new FirestoreDomainData(f.options);
  const scope = await f.authority.runTransaction('parent', childId, async b => b.scope);
  const bytes = Buffer.from('test'); let afterRead: (() => Promise<void>) | undefined;
  const objects = { address: () => 'unused', write: async () => { throw Error('No write'); }, inspect: async () => null,
    remove: async () => { throw Error('No object delete'); }, read: async (_scope: unknown, _id: string, descriptor: any) => {
      assert.deepEqual(_scope, scope); await afterRead?.(); return {buffer: bytes, base64: bytes.toString('base64'), descriptor};
    } };
  const journal = { writeOnce: async () => { throw Error('No journal writes'); }, read: async () => { throw Error('No journal reads'); } };
  const files = createFirestoreChatFilesStore({...f.options, objects, journal}), voices = createFirestoreVoiceStore({...f.options, objects, journal});
  const transcripts = createFirestoreVoiceTranscripts({...f.options, voices});
  const seed = (source: 'file' | 'voice', linked: boolean) => {
    const id = randomUUID(), messageId = linked ? randomUUID() : null, at = '2026-10-27T04:00:00.000Z';
    const kind = source === 'file' ? 'chat-file-asset' : 'voice-asset', collection = source === 'file' ? 'chat_file_assets' : 'voice_assets';
    const schema = source === 'file' ? firestoreChatFileRowSchema : firestoreVoiceRowSchema;
    const descriptor = {objectName: (source === 'file' ? 'chat-file' : 'voice')+'/v1/'+'a'.repeat(64)+'/'+id,
      generation:'1', cipherSha256:'c'.repeat(64),sha256:createHash('sha256').update(bytes).digest('hex'),bytes:4,mimeType:source==='file'?'text/plain':'audio/wav',...(source==='voice'?{durationMs:1000}:{})};
    const row = {id,scope,objectScope:scope,version:3,createdAt:at,updatedAt:at,fingerprint:'b'.repeat(64),
      metadata:{fileName:source+'.test',mimeType:descriptor.mimeType,bytes:4,sha256:createHash('sha256').update(bytes).digest('hex')},state:'ready',upload:null,descriptor,messageId,deletion:null};
    f.fake.records.set(data.ref(collection,kind,id).path,{...data.tags(scope),scopeTag:firestoreDomainHash([source==='file'?'chat-file-scope':'voice-scope',scope]),
      assetId:id,createdAt:at,updatedAt:at,state:'ready',messageId,...data.seal(kind,id,scope,schema as any,row,3)});
    return {id,row};
  };
  const file = seed('file',true), file2 = seed('file',true), draft = seed('file',false), voice = seed('voice',true);
  const reference = {id:voice.id,version:3,mimeType:'audio/wav' as const,bytes:4,sha256:createHash('sha256').update(bytes).digest('hex'),durationMs:1000};
  await f.authority.runTransaction('parent',childId,async b => { const commit=await prepareVoiceTranscription(data,b,reference,voice.row.messageId!);commit(); });
  await f.sharing.share('parent',{spaceId:f.space.id,childId,modules:['attachments'],expectedVersion:f.space.version,operationId:randomUUID()});
  const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(4),Buffer.from('IHDR'),Buffer.alloc(8)]),photoId=randomUUID();
  const photoMeta={fileName:'photo.png',source:'camera',mimeType:'image/png' as const,bytes:png.length,sha256:createHash('sha256').update(png).digest('hex')};
  const photoRow={id:photoId,scope,reservationOperationId:randomUUID(),createdAt:'2026-10-27T03:00:00.000Z',version:1,state:'ready',metadata:photoMeta,
    descriptor:{objectName:'photos/v1/'+photoId,generation:'1',cipherSha256:'c'.repeat(64),sha256:photoMeta.sha256,bytes:png.length,mimeType:'image/png'},upload:null,deletion:null,
    recordId:randomUUID(),extraction:{state:'available',runId:randomUUID(),draft:{text:'Private extracted draft',kind:'note',rawValue:null,unit:null,approximate:false,timeRaw:'',uncertainties:[]},
      stopReason:null,processedAt:'2026-10-27T03:00:00.000Z',model:'synthetic',expiresAt:null,authorizationVersion:'1',generation:randomUUID()}};
  f.fake.records.set(data.ref('photos','photo',photoId).path,{assetId:photoId,scopeTag:firestoreDomainHash([f.options.projectId,f.options.namespace,'photo-scope',scope]),
    sortKey:photoRow.createdAt+'/'+photoId,live:true,...data.seal('photo',photoId,scope,firestorePhotoSchemas.photo,photoRow as any,1)});
  const photos=createFirestorePhotoStore({...f.options,journal,objects:{write:async()=>{throw Error('No write');},recover:async()=>{throw Error('No recovery');},
    read:async(_scope,id,descriptor)=>{assert.deepEqual(_scope,scope);assert.equal(id,photoId);await afterRead?.();return {buffer:png,base64:png.toString('base64'),mimeType:descriptor.mimeType,descriptor};}}});
  const selection = {spaceId:f.space.id}, sharedFiles=files.forSharedSpace(selection),sharedVoices=voices.forSharedSpace(selection);
  const reservedId=randomUUID(), reservedPhoto={...photoRow,id:reservedId,state:'reserved',descriptor:null,createdAt:'2026-10-27T02:00:00.000Z'};
  f.fake.records.set(data.ref('photos','photo',reservedId).path,{assetId:reservedId,scopeTag:firestoreDomainHash([f.options.projectId,f.options.namespace,'photo-scope',scope]),
    sortKey:reservedPhoto.createdAt+'/'+reservedId,live:true,...data.seal('photo',reservedId,scope,firestorePhotoSchemas.photo,reservedPhoto as any,1)});
  const sharedPhotos=photos.forSharedSpace(selection),photoPage=await sharedPhotos.list('viewer',childId);
  assert.equal(photoPage.canCreate,false);assert.equal(photoPage.photos[0].canManage,false);
  assert.equal(photoPage.photos[0].recordId,null);assert.equal(photoPage.photos[0].extraction.draft,null);
  assert.deepEqual((await sharedPhotos.content('viewer',childId,photoId)).bytes,png);
  assert.ok((await photos.get('parent',childId,photoId)).extraction.draft);
  const emptyPhotoPage=await sharedPhotos.list('viewer',childId,{limit:1});
  assert.equal(emptyPhotoPage.photos.length,0);assert.equal(emptyPhotoPage.complete,false);assert.ok(emptyPhotoPage.nextCursor);
  assert.equal((await sharedPhotos.list('viewer',childId,{cursor:emptyPhotoPage.nextCursor})).photos.length,1);
  await assert.rejects(sharedPhotos.get('viewer',childId,reservedId),code('not_found'));
  const page=await sharedFiles.list('viewer',childId,{limit:1});
  assert.equal(page.items.length,1);assert.equal(page.items[0].messageId,null);assert.equal(page.items[0].sharedSpaceId,f.space.id);
  assert.ok(page.nextCursor);await assert.rejects(sharedFiles.list('carer',childId,{cursor:page.nextCursor}),code('attachment_scope_changed'));assert.equal((await sharedFiles.list('viewer',childId,{cursor:page.nextCursor})).items.length,1);
  assert.equal((await sharedFiles.get('carer',childId,file.id)).messageId,null);
  await assert.rejects(sharedFiles.get('carer',childId,draft.id),code('not_found'));
  assert.equal((await sharedFiles.content('viewer',childId,file.id)).buffer.toString(),'test');
  assert.equal((await sharedVoices.content('viewer',childId,voice.id)).attachment.messageId,null);
  assert.equal((await transcripts.forSharedSpace(selection).get('viewer',childId,voice.id)).messageId,null);
  assert.equal((await files.get('parent',childId,file.id)).messageId,file.row.messageId);
  await assert.rejects(files.get('carer',childId,file.id));
  let actor='viewer';
  const auth={async getSession(options:{returnHeaders?:boolean}){const session={user:{id:actor,email:actor+'@example.test'}};return options.returnHeaders?{response:session,headers:new Headers()}:session;},
    async handler(){return new Response(null,{status:404});},async assertRecentReauthentication(){return {user:{id:actor,email:actor+'@example.test'}};},fromNodeHeaders(){return new Headers();}} as FirebaseAuthPort;
  const handler=createFirebaseRequestHandler({authority:f.authority,auth,publicOrigin:'https://app.example.test',mailConfigured:false,files,voice:{...voices,transcripts},photos});
  const fetcher:typeof fetch=async(input,init)=>{const url=new URL(String(input));
    if(url.pathname.endsWith('/photos'))url.searchParams.set('limit','1');
    return handler(new Request(url,init));},signal=new AbortController().signal;
  const fileClient=createChatFileApi(fetcher,'https://app.example.test',undefined,selection),voiceClient=createVoiceApi(fetcher,'https://app.example.test',undefined,selection);
  const photoClient=createPhotoApi('https://app.example.test',fetcher,undefined,selection);
  const fileView=await fileClient.get(childId,file.id,signal,actor);
  assert.equal(fileView.sharedSpaceId,f.space.id);assert.equal(fileView.messageId,null);
  assert.equal((await fileClient.content(fileView,signal,actor)).bytes.length,4);
  assert.equal((await fileClient.list(childId,{limit:1},signal,actor)).items.length,1);
  const voiceView=await voiceClient.get(childId,voice.id,signal,actor);
  assert.equal((await voiceClient.content(voiceView,signal,actor)).bytes.length,4);
  assert.equal((await voiceClient.transcript(childId,voice.id,signal,actor)).messageId,null);
  const photoView=await photoClient.photo(childId,photoId,signal,actor);
  assert.equal((await photoClient.content(photoView,signal,actor)).size,png.length);
  assert.equal((await photoClient.photos(childId,signal,actor)).photos.length,1);
  // The viewer may read but cannot enter the newly connected shared deletion workflow.
  const denied=await handler(new Request('https://app.example.test/api/children/'+childId+'/files/'+file.id+'/delete?spaceId='+f.space.id,
    {method:'POST',headers:{'x-expected-user-id':actor,Origin:'https://app.example.test','Content-Type':'application/json'},body:JSON.stringify({expectedVersion:3,opId:randomUUID()})}));
  assert.equal(denied.status,403);assert.equal((await denied.json()).error.code,'read_only');
  // Grant generation is part of the fence even if access is revoked and re-granted during object I/O.
  const replaceShare=async(modules:('attachments'|'care')[])=>{
    const current=await f.sharing.get('parent',f.space.id);
    await f.sharing.share('parent',{spaceId:f.space.id,childId,modules,expectedVersion:current.version,operationId:randomUUID()});
  };
  afterRead=async()=>{await replaceShare(['care']);await replaceShare(['attachments']);};
  await assert.rejects(sharedFiles.content('viewer',childId,file.id),code('chat_file_changed'));
  await assert.rejects(sharedPhotos.content('viewer',childId,photoId),code('version_conflict'));
  afterRead=undefined;
  await assert.rejects(sharedFiles.list('viewer',childId,{cursor:page.nextCursor}),code('attachment_scope_changed'));
  afterRead=async()=>{
    const current=await f.sharing.get('parent',f.space.id);
    await f.sharing.share('parent',{spaceId:f.space.id,childId,modules:['care'],expectedVersion:current.version,operationId:randomUUID()});
  };
  await assert.rejects(sharedFiles.content('viewer',childId,file2.id));afterRead=undefined;
  await assert.rejects(sharedFiles.list('viewer',childId,{cursor:page.nextCursor}));
  await assert.rejects(transcripts.forSharedSpace(selection).get('viewer',childId,voice.id));
});
