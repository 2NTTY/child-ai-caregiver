import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreSharingStore } from '../server/firestore-sharing.ts';
import { createFirestoreChatStore } from '../server/firestore-chat.ts';
import { createFirestoreAccountExport } from '../server/firestore-account-export.ts';
import { createFirebaseRequestHandler } from '../server/firebase-app.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';

test('mixed messages are account-private, idempotent and lose disclosure when class access ends', async () => {
  const { database } = serialFirestoreFixture();
  const options = { database, cipher: createStorageCipher(Buffer.alloc(32, 70)), namespace:'test_mixed', projectId:'demo-mixed',
    serverClock: () => Date.parse('2026-11-11T00:00:00Z') };
  const authority = createFirestoreAuthority(options), sharing = createFirestoreSharingStore(options);
  await authority.initializeControl({ generation:randomUUID(), enabled:true });
  for (const userId of ['owner','colleague']) {
    const email = userId+'@example.test';
    await authority.issueInvitation({email, expiresAt:'2026-11-15T00:00:00Z',operationId:randomUUID()});
    await authority.admitIdentity({userId,email,emailVerified:true});
    await authority.acknowledge({userId,policyVersion:SERVICE_POLICY_VERSION,operationId:randomUUID()});
  }
  const origin='https://example.test';
  let actor='owner', expireOnRead=0;
  const server = () => createFirebaseRequestHandler({ authority, chat:createFirestoreChatStore(options),
    auth:{getSession:async()=>expireOnRead>0 && --expireOnRead===0 ? null : {user:{id:actor}},
      handler:async()=>new Response(null,{status:404})},publicOrigin:origin,mailConfigured:true });
  let handle=server();
  const call = (path,body) => handle(new Request(origin+'/api/account/mixed-chats'+path,{ method:body?'POST':'GET',
    headers:{origin,'content-type':'application/json','x-expected-user-id':actor}, ...(body ? {body:JSON.stringify(body)} : {}) }));
  let classroom=await sharing.create(actor,{kind:'class',name:'Class',operationId:randomUUID()});
  const childIds=[];
  for (const name of ['同名','同名']) {
    const added=await sharing.addClassChild(actor,{spaceId:classroom.id,expectedVersion:classroom.version,displayName:name,operationId:randomUUID()});
    classroom=added.space; childIds.push(added.child.id);
  }
  const invitation=await sharing.invite('owner',{spaceId:classroom.id,expectedVersion:classroom.version,operationId:randomUUID(),
    email:'colleague@example.test',role:'viewer',expiresAt:'2099-11-15T00:00:00Z'});
  classroom=await sharing.acceptInvitation('colleague',{token:invitation.token,operationId:randomUUID()});
  actor='colleague';
  const scope={kind:'class',spaceId:classroom.id,spaceVersion:classroom.version,teacherSpaceVersion:null};
  const selection={scope,childIds,operationId:randomUUID()};
  const created=await call('',selection);
  assert.equal(created.status,201);
  const {room}=await created.json(), path='/'+room.id;
  assert.deepEqual((await (await call('',selection)).json()).room,room);
  assert.equal((await call('',{...selection,childIds:childIds.slice(0,1)})).status,409);
  const input={text:'這是我對兩個孩子的私人問題',expectedVersion:1,operationId:randomUUID()};
  expireOnRead=2;
  const lostReceipt=await call(path+'/messages',input);
  assert.equal(lostReceipt.status,503);
  assert.equal((await lostReceipt.json()).error.code,'operation_result_unknown');
  const sent=await call(path+'/messages',input);
  assert.equal(sent.status,201);
  const {message}=await sent.json();
  assert.equal((await (await call(path+'/messages',input)).json()).message.id,message.id);
  assert.equal((await call(path+'/messages',{...input,text:'另一問題'})).status,409);
  assert.equal((await call(path+'/messages',{...input,operationId:randomUUID()})).status,409);
  handle=server();
  const history=await (await call(path)).json();
  assert.deepEqual(history.messages.map(m=>m.text),[input.text]);
  assert.deepEqual((await (await call('')).json()).rooms.map(r=>r.id),[room.id]);
  const personal=[];
  for (const name of ['兄','弟']) personal.push((await authority.createChild({userId:actor,displayName:name,operationId:randomUUID()})).child.id);
  const both=await (await call('',{operationId:randomUUID(),scope:{kind:'personal'},childIds:personal})).json();
  assert.equal((await call('/'+both.room.id+'/messages',{...input,operationId:randomUUID()})).status,201);
  const exporter=createFirestoreAccountExport({...options,photos:{async content(){throw Error('unexpected photo');}}});
  assert.deepEqual((await createFirestoreChatStore(options).listForUser(actor,personal[0])).messages,[]);
  assert.deepEqual((await exporter.page(actor,{section:'chat', childId:personal[0]})).items,[]);
  actor='owner';
  assert.deepEqual((await (await call('')).json()).rooms,[]);
  assert.equal((await call(path)).status,404);
  await sharing.updateMember(actor,{operationId:randomUUID(),spaceId:classroom.id,expectedVersion:classroom.version,
    targetUserId:'colleague',role:null});
  actor='colleague';
  const revoked=await call(path);
  assert.notEqual(revoked.status,200);
  assert.ok(!(await revoked.text()).includes(input.text));
  assert.deepEqual((await (await call('')).json()).rooms.map(r=>r.id),[both.room.id]);
  assert.equal((await call(path+'/messages',input)).status,403);
});
