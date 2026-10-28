import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreSharingStore } from '../server/firestore-sharing.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirestoreTaskWorker, firestoreNotificationPreferencesSchema, firestoreTaskNotificationOutboxSchema,
  type FirestoreTaskDelivery } from '../server/firestore-task-worker.ts';
import { FirestoreDomainData, firestoreReminderOutboxId, firestoreReminderOutboxSchema } from '../server/firestore-domain-data.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';
import type { CareTask } from '../src/shared/tasks.ts';
import { createFirestoreRestoreCodec } from '../server/firestore-restore-codec.ts';
import { assertFirestoreRestoreContent } from '../server/firestore-restore-content.ts';

test('class reminders use the assignee account and stop after membership changes without synthetic identities', async () => {
  const fake = serialFirestoreFixture(), at = Date.parse('2026-10-28T04:00:00Z');
  const options = { database: fake.database, cipher: createStorageCipher(Buffer.alloc(32, 44)),
    projectId:'demo-class-reminder', namespace:'class_reminder', serverClock:()=>at };
  const authority=createFirestoreAuthority(options), sharing=createFirestoreSharingStore(options), data=new FirestoreDomainData(options);
  const generation=randomUUID(); await authority.initializeControl({generation,enabled:true});
  for(const userId of ['manager','teacher']) {
    await authority.issueInvitation({email:userId+'@example.test',expiresAt:'2026-11-28T00:00:00Z',operationId:randomUUID()});
    await authority.admitIdentity({userId,email:userId+'@example.test',emailVerified:true});
    await authority.acknowledge({userId,policyVersion:SERVICE_POLICY_VERSION,operationId:randomUUID()});
  }
  const authCalls:string[]=[];
  const worker=createFirestoreTaskWorker({...options,enabled:true,currentAuth:async userId=>{
    assert.ok(!userId.startsWith('space:'),'storage identities never reach Firebase Auth'); authCalls.push(userId);
    return {userId,disabled:false,emailVerified:true,email:userId+'@example.test'};
  }});
  const online=createFirestoreOnlineStore({...options,reminders:worker});
  let classroom=await sharing.create('manager',{kind:'class',name:'Class reminders',operationId:randomUUID()});
  const added=await sharing.addClassChild('manager',{spaceId:classroom.id,expectedVersion:classroom.version,displayName:'Learner',operationId:randomUUID()});
  classroom=added.space; const childId=added.child.id;
  const invitation=await sharing.invite('manager',{spaceId:classroom.id,expectedVersion:classroom.version,
    email:'teacher@example.test',role:'caregiver',expiresAt:'2026-11-28T00:00:00Z',operationId:randomUUID()});
  classroom=await sharing.acceptInvitation('teacher',{token:invitation.token,operationId:randomUUID()});
  const selection={spaceId:classroom.id,childId,module:'tasks' as const,mode:'read' as const};
  const page=await online.tasks.forSharedSpace!(classroom.id).list('teacher',childId);
  assert.deepEqual(page.eligibleAssignees,[{userId:'teacher',name:'本人'}]);
  async function command(userId:string,path:string,payload:unknown){
    const input={path,payload,sharing:{spaceId:classroom.id}}, context=await online.context(userId,input);
    const submission={...input,sharing:{...input.sharing,expectedBasis:context.sharingBasis},operation:{
      workspaceId:context.workspaceId,storageEpoch:context.storageEpoch,deviceId:randomUUID(),opId:randomUUID()}};
    const receipt=await online.submit(userId,submission); assert.deepEqual(await online.submit(userId,submission),receipt); return receipt;
  }
  async function createTask(){return (await command('teacher',`/api/children/${childId}/tasks`,{confirm:true,values:{
    title:'Class appointment',details:'',kind:'appointment',assigneeUserId:'teacher',dueAt:'2026-10-28T03:00:00Z',timeZone:'Asia/Hong_Kong'}})).result as {task:CareTask};}
  async function jobFor(task:CareTask):Promise<FirestoreTaskDelivery>{return sharing.withResource('teacher',selection,async access=>({kind:'task-reminder',
    scope:{...access.scope},taskId:task.id,taskVersion:task.version,occurrenceId:task.occurrence.id,scheduledAt:task.occurrence.dueAt,
    authorizationVersion:access.binding.authorizationVersion,generation}));}
  const first=(await createTask()).task, job=await jobFor(first);
  assert.equal('classAssignment' in first,false,'internal membership proof stays out of the public task');
  assert.deepEqual(await worker.dispatchTransaction(job,'enqueue',async binding=>({actor:binding.actorUserId,owner:binding.scope.ownerUserId})),
    {state:'ready',value:{actor:'teacher',owner:'space:'+classroom.id}});
  await authority.runTransaction('teacher',null,async b=>{
    const preferences={timeZone:'Asia/Hong_Kong',quietStart:'11:00',quietEnd:'13:00',allowAppointmentDuringQuiet:false,version:1};
    b.transaction.set(data.ref('notification_preferences','notification-preferences','teacher'),{
      ...data.tags(b.scope),...data.seal('notification-preferences','teacher',b.scope,firestoreNotificationPreferencesSchema,preferences)});
  });
  const quiet=await worker.process(job); assert.equal(quiet.state,'deferred'); assert.equal(quiet.receipt,null);
  await authority.runTransaction('teacher',null,async b=>b.transaction.delete(data.ref('notification_preferences','notification-preferences','teacher')));
  // The deferred work retains its due time, so process it only after that saved deadline.
  const workId=firestoreReminderOutboxId(first.id,first.version);
  const work=await options.database.runTransaction(async tx=>data.open('task-reminder-outbox',workId,job.scope,firestoreReminderOutboxSchema,
    await tx.get(data.ref('task_outbox','task-reminder-outbox',workId))));
  options.serverClock=()=>Date.parse(work.dueAt)+1;
  const later=createFirestoreTaskWorker({...options,enabled:true,currentAuth:async userId=>{
    assert.equal(userId,'teacher');return {userId,disabled:false,emailVerified:true,email:userId+'@example.test'};
  }});
  const delivered=await later.process({...job,scheduledAt:work.dueAt}); assert.equal(delivered.state,'processed'); assert.ok(delivered.receipt);
  assert.deepEqual(await later.process({...job,scheduledAt:work.dueAt}),delivered);
  const notification=await options.database.runTransaction(async tx=>data.open('task-notification-outbox',delivered.receipt!.id,job.scope,
    firestoreTaskNotificationOutboxSchema,await tx.get(data.ref('notification_outbox','task-notification-outbox',delivered.receipt!.id))));
  assert.equal(notification.recipientUserId,'teacher'); assert.equal(notification.state,'pending','receipt is not external delivery');
  const codec=createFirestoreRestoreCodec(options);
  const restoreRows=[...fake.records].map(([path,value])=>codec.decode({path,data:value}));
  assertFirestoreRestoreContent(restoreRows);
  const tampered=structuredClone(restoreRows);
  (tampered.find(row=>row.context.kind==='task-notification-outbox')!.value as {recipientUserId:string}).recipientUserId='manager';
  assert.throws(()=>assertFirestoreRestoreContent(tampered),'restore cannot redirect another member\'s reminder');
  assert.equal((await online.tasks.forSharedSpace!(classroom.id).list('manager',childId)).reminders?.length,1);
  const second=(await createTask()).task, secondJob=await jobFor(second), claim=await later.claim(secondJob);
  assert.equal(claim.state,'claimed');
  await sharing.leave('teacher',{spaceId:classroom.id,expectedVersion:classroom.version,operationId:randomUUID()});
  if(claim.state==='claimed') await assert.rejects(later.complete(secondJob,claim.lease));
  assert.equal((await online.tasks.forSharedSpace!(classroom.id).list('manager',childId)).reminders?.length,1);
  classroom={...classroom,version:(await sharing.spaceView('manager',classroom.id)).version};
  const rejoin=await sharing.invite('manager',{spaceId:classroom.id,expectedVersion:classroom.version,
    email:'teacher@example.test',role:'caregiver',expiresAt:'2026-11-28T00:00:00Z',operationId:randomUUID()});
  await sharing.acceptInvitation('teacher',{token:rejoin.token,operationId:randomUUID()});
  if(claim.state==='claimed') await assert.rejects(later.complete(secondJob,claim.lease),(error:unknown)=>(error as {code?:string}).code==='task_assignee_changed');
  await command('manager',`/api/children/${childId}/tasks/${second.id}/change`,{confirm:true,expectedVersion:second.version,action:'complete',note:''});
  assert.equal((await online.tasks.forSharedSpace!(classroom.id).get('manager',childId,second.id))?.occurrence.state,'completed');
  assert.ok(authCalls.length>0);
});
