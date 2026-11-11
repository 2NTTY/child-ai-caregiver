import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreSharingStore } from '../server/firestore-sharing.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirebaseRequestHandler } from '../server/firebase-app.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { assistantTaskContextPageSchema } from '../src/shared/assistant-task-context.ts';

test('selected class tasks come from the ordinary task store and stay within the current selection', async () => {
  const { database } = serialFirestoreFixture();
  const options = { database, cipher: createStorageCipher(Buffer.alloc(32, 72)), namespace:'test_scope', projectId:'demo-scope',
    serverClock: () => Date.parse('2026-11-11T00:00:00Z') };
  const authority = createFirestoreAuthority(options), sharing = createFirestoreSharingStore(options), online = createFirestoreOnlineStore(options);
  await authority.initializeControl({ generation:randomUUID(), enabled:true });
  for (const userId of ['teacher','other']) {
    const email = userId+'@example.test';
    await authority.issueInvitation({email, expiresAt:'2026-11-15T00:00:00Z',operationId:randomUUID()});
    await authority.admitIdentity({userId,email,emailVerified:true});
    await authority.acknowledge({userId,policyVersion:SERVICE_POLICY_VERSION,operationId:randomUUID()});
  }
  let actor='teacher';
  const origin='https://example.test', session=async()=>({user:{id:actor}});
  const handle=createFirebaseRequestHandler({authority, online, auth:{getSession:session,handler:async()=>new Response(null,{status:404})},publicOrigin:origin,mailConfigured:true});
  const query=(scope,targets)=>handle(new Request(origin+'/api/assistant/task-context',{method:'POST',headers:{
    origin,'content-type':'application/json','x-expected-user-id':actor},body:JSON.stringify({scope,targets})}));
  let classroom=await sharing.create(actor,{kind:'class',name:'同班',operationId:randomUUID()});
  const children=[];
  for(const name of ['同名','同名']) {
    const created=await sharing.addClassChild(actor,{spaceId:classroom.id,expectedVersion:classroom.version,displayName:name,operationId:randomUUID()});
    classroom=created.space; children.push(created.child.id);
  }
  const scope={kind:'class',spaceId:classroom.id,spaceVersion:classroom.version,teacherSpaceVersion:null};
  const targets=children.map(childId=>({childId}));
  const personal=(await authority.createChild({userId:actor,operationId:randomUUID(),displayName:'私人'})).child.id;
  const first=await query(scope,targets);
  assert.equal(first.status,200);
  assert.deepEqual((await first.json()).children.map(c=>[c.childId,c.tasks]),children.map(id=>[id,[]]));
  async function add(title) {
    const path='/api/children/'+children[0]+'/tasks',payload={confirm:true,values:{title,details:'private detail',kind:'appointment',
      assigneeUserId:actor,dueAt:'2026-11-17T03:00:00Z',timeZone:'Asia/Hong_Kong'}};
    const command={path,payload,sharing:{spaceId:classroom.id}};
    const context=await online.context(actor,command);
    await online.submit(actor,{...command,sharing:{...command.sharing,expectedBasis:context.sharingBasis},operation:{
      workspaceId:context.workspaceId,storageEpoch:context.storageEpoch,deviceId:randomUUID(),opId:randomUUID()}});
  }
  for(let i=0;i<9;i++) await add('Appointment '+i);
  const page=assistantTaskContextPageSchema.parse(await (await query(scope,targets)).json());
  const pupil=page.children[0];
  assert.equal(pupil.tasks.length,8); assert.ok(pupil.nextCursor);
  assert.equal(page.children[1].tasks.length,0);
  assert.ok(pupil.tasks.every(t=>!('details' in t) && !('createdBy' in t)));
  const next=await query(scope,[{...targets[0],cursor:pupil.nextCursor}]);
  assert.equal(next.status,200); const rest=(await next.json()).children[0];
  assert.equal(rest.nextCursor,null); assert.equal(rest.tasks.length,1);
  assert.ok(!pupil.tasks.some(t=>t.id===rest.tasks[0].id));
  const single=await online.tasks.forSharedSpace(classroom.id).list(actor,children[0]);
  assert.deepEqual([...pupil.tasks,...rest.tasks].map(t=>[t.id,t.version]),single.items.map(t=>[t.id,t.version]));
  assert.equal((await query({...scope, spaceVersion:scope.spaceVersion-1},targets)).status,409);
  assert.equal((await query(scope,[{...targets[1],cursor:pupil.nextCursor}])).status,409);
  assert.equal((await query({kind:'personal'},[{childId:personal}])).status,200);
  assert.notEqual((await query({kind:'personal'},targets)).status,200);
  assert.notEqual((await query(scope,[targets[0],{childId:personal}])).status,200);
  await add('Changed after page');
  assert.equal((await query(scope,[{...targets[0],cursor:pupil.nextCursor}])).status,409);
  actor='other';
  assert.equal((await query(scope,targets)).status,403);
  assert.notEqual((await query({kind:'personal'},[{childId:personal}])).status,200);
});
