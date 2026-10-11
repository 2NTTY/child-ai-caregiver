import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { protos } from '@google-cloud/tasks';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirebaseTaskDelivery, type FirebaseTasksTransport } from '../server/firebase-task-delivery.ts';
import { createFirestoreTaskDispatcher, firestoreTaskDispatchObservationSchema, firestoreTaskDispatchScanSchema, FIRESTORE_TASK_DISPATCH_SCAN_LEASE_MS } from '../server/firestore-task-dispatcher.ts';
import { FirestoreDomainData, FIRESTORE_TASK_DISPATCH_SCOPE, firestoreDomainHash, firestoreReminderOutboxId, firestoreReminderOutboxSchema, sealFirestoreReminderOutbox,
  type FirestoreReminderOutbox } from '../server/firestore-domain-data.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import type { CareTask } from '../src/shared/tasks.ts';
import type { FirestoreTaskDelivery } from '../server/firestore-task-worker.ts';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';

type Task = protos.google.cloud.tasks.v2.ITask;
const config = { projectId: 'synthetic-task-project', region: 'asia-east2', queue: 'f02-reminders', workerUrl: 'https://worker.example.invalid/internal/task-reminders',
  audience: 'https://worker.example.invalid', serviceAccountEmail: 'f02-tasks@synthetic-task-project.iam.gserviceaccount.com' };
async function fixture() {
  const fake = firestoreDomainFixture(), clock = { at: Date.parse('2026-10-11T04:00:00Z'), disabled: false, loseReservationReply: false };
  const options = { database: fake.database, cipher: createStorageCipher(Buffer.alloc(32, 87)), projectId: config.projectId, namespace: 'synthetic_dispatch',
    serverClock: () => clock.at, enabled: true, async currentAuth(userId: string) {
      if (clock.loseReservationReply) { clock.loseReservationReply = false; fake.loseReply(); }
      return { userId, disabled: clock.disabled, emailVerified: true, email: 'owner@example.test' };
    } };
  const data = new FirestoreDomainData(options), authority = createFirestoreAuthority(options), online = createFirestoreOnlineStore(options), uid = 'synthetic-owner', generation = randomUUID();
  await authority.initializeControl({ generation, enabled: true });
  await authority.issueInvitation({ email: 'owner@example.test', expiresAt: '2027-01-01T00:00:00Z', operationId: randomUUID() });
  await authority.admitIdentity({ userId: uid, email: 'owner@example.test', emailVerified: true });
  await authority.acknowledge({ userId: uid, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  const command = async (path: string, payload: unknown) => online.submit(uid, { path, payload,
    operation: { ...await online.context(uid, { path, payload }), deviceId: randomUUID(), opId: randomUUID() } });
  const child = await command('/api/children', { displayName: 'Synthetic child' }), childId = (child.result as any).child.id;
  const binding = await authority.readScope(uid, childId);
  async function addTask(dueAt = '2026-10-11T03:00:00Z') {
    const receipt = await command(`/api/children/${childId}/tasks`, { confirm: true, values: { title: 'Private reminder title', details: 'Private reminder details',
      kind: 'appointment', assigneeUserId: uid, dueAt, timeZone: 'Asia/Hong_Kong' } });
    const task = (receipt.result as { task: CareTask }).task, id = firestoreReminderOutboxId(task.id, task.version), ref = data.ref('task_outbox', 'task-reminder-outbox', id);
    const work = data.open('task-reminder-outbox', id, binding.scope, firestoreReminderOutboxSchema, { exists: true, data: () => fake.records.get(ref.path) } as any);
    fake.records.set(ref.path, sealFirestoreReminderOutbox(data, binding.scope, work));
    const job: FirestoreTaskDelivery = { kind: 'task-reminder', scope: binding.scope, taskId: task.id, taskVersion: task.version, occurrenceId: task.occurrence.id,
      authorizationVersion: binding.authorizationVersion, generation, scheduledAt: task.occurrence.dueAt };
    return { task, job, ref, work: () => data.open('task-reminder-outbox', id, binding.scope, firestoreReminderOutboxSchema,
      { exists: true, data: () => fake.records.get(ref.path) } as any), setWork(change: Partial<FirestoreReminderOutbox>) {
      const original = data.open('task-reminder-outbox', id, binding.scope, firestoreReminderOutboxSchema, { exists: true, data: () => fake.records.get(ref.path) } as any);
      fake.records.set(ref.path, sealFirestoreReminderOutbox(data, binding.scope, { ...original, ...change }));
    } };
  }
  const first = await addTask(), tasks = new Map<string, Task>(), calls = { create: 0, get: 0 }, behavior = { uncertain: false, hold: null as Promise<void> | null };
  const transport: FirebaseTasksTransport = {
    async create(request) {
      calls.create++; const task = request.task!, ledger = data.ref('task_dispatches', 'task-dispatch-observation', task.name!);
      assert.equal(fake.records.has(ledger.path), true, 'Observation must commit before the Cloud Tasks call');
      if (behavior.hold) await behavior.hold;
      if (behavior.uncertain) throw { code: 4, message: 'Private uncertain reply' };
      tasks.set(task.name!, task); return task;
    },
    async get(request) { calls.get++; const task = tasks.get(request.name!); if (!task) throw { code: 5 }; return task; },
  };
  const delivery = createFirebaseTaskDelivery({ ...config, transport }), dispatcher = createFirestoreTaskDispatcher({ ...options, delivery });
  const observation = () => { const name = delivery.taskName(first.job), ref = data.ref('task_dispatches', 'task-dispatch-observation', name);
    return data.open('task-dispatch-observation', name, binding.scope, firestoreTaskDispatchObservationSchema, { exists: true, data: () => fake.records.get(ref.path) } as any); };
  const scan = () => {
    const ref=data.ref('task_dispatches','task-dispatch-scan','current');
    return data.open('task-dispatch-scan','current',FIRESTORE_TASK_DISPATCH_SCOPE,firestoreTaskDispatchScanSchema,
      {exists:fake.records.has(ref.path),ref:{path:ref.path},data:()=>fake.records.get(ref.path)} as any);
  };
  return { fake, options, data, authority, uid, clock, first, addTask, tasks, calls, behavior, delivery, dispatcher, observation, scan };
}

test('corrupted encrypted routing is rejected without enqueue or plaintext family identity', async () => {
  const f = await fixture(), raw = f.fake.records.get(f.first.ref.path), encoded = JSON.stringify(raw);
  for (const privateValue of ['Private reminder title', 'Private reminder details', 'owner@example.test', f.uid]) assert.equal(encoded.includes(privateValue), false);
  f.fake.records.set(f.first.ref.path, { ...raw, dispatchRouting: { ...raw.dispatchRouting, ciphertext: 'corrupted' } });
  const before = [...f.fake.records], page = await f.dispatcher.dispatch();
  assert.equal(page.rejected, 1); assert.equal(page.scanned, 1); assert.equal(f.calls.create, 0); assert.equal(f.calls.get, 0); assert.deepEqual([...f.fake.records], before);
});

test('concurrent and repeated dispatch share the original task identity and persist evidence before a call', async () => {
  const f = await fixture(); let release!: () => void, entered!: () => void;
  const created = new Promise<void>(resolve => { entered = resolve; });
  f.behavior.hold = new Promise<void>(resolve => { release = resolve; });
  const originalCreate = f.delivery.enqueue;
  f.delivery.enqueue = async job => { entered(); return originalCreate(job); };
  const first = f.dispatcher.dispatch(); await created;
  const duplicate = await f.dispatcher.dispatch(); assert.equal(duplicate.busy, 1); assert.equal(f.calls.create, 1);
  release(); assert.equal((await first).confirmed, 1); const confirmedAt = f.observation().confirmedAt;
  assert.equal((await f.dispatcher.dispatch()).confirmed, 1); assert.equal(f.calls.create, 1); assert.equal(f.calls.get, 1);
  assert.equal(f.tasks.size, 1); assert.equal(f.observation().taskName, f.delivery.taskName(f.first.job)); assert.equal(f.observation().confirmedAt, confirmedAt);
  assert.equal(f.first.work().attempts, 0); assert.equal(f.first.work().failures, 0);
});

test('current Auth denial and canonical revocation stop dispatch, while failed and unknown work remain untouched', async () => {
  const f = await fixture(); f.clock.disabled = true; const denied = [...f.fake.records];
  assert.equal((await f.dispatcher.dispatch()).skipped, 1); assert.equal(f.calls.create, 0); assert.deepEqual([...f.fake.records], denied);
  f.clock.disabled = false; await f.authority.revokeInvitation({ email: 'owner@example.test', operationId: randomUUID() }); const revoked = [...f.fake.records];
  assert.equal((await f.dispatcher.dispatch()).skipped, 1); assert.equal(f.calls.create, 0); assert.deepEqual([...f.fake.records], revoked);
  for (const state of ['failed', 'unknown'] as const) {
    const blocked = await fixture(); blocked.first.setWork({ state, failures: state === 'failed' ? 3 : 0, lease: null }); const before = [...blocked.fake.records];
    assert.equal((await blocked.dispatcher.dispatch()).scanned, 0); assert.equal(blocked.calls.create, 0); assert.deepEqual([...blocked.fake.records], before);
  }
});

test('unknown enqueue and missing previously confirmed tasks require attention without recreation or resetting a receipt', async () => {
  const f = await fixture(); f.behavior.uncertain = true;
  assert.equal((await f.dispatcher.dispatch()).unknown, 1); assert.equal((await f.dispatcher.dispatch()).unknown, 1);
  assert.equal((await f.dispatcher.dispatch()).needsAttention, 1); const before = [...f.fake.records];
  assert.equal((await f.dispatcher.dispatch()).needsAttention, 1); assert.equal(f.calls.create, 1); assert.equal(f.calls.get, 3);
  assert.equal(f.observation().unresolved, 3); assert.equal(f.observation().state, 'needs_attention'); assert.deepEqual([...f.fake.records], before);
  const confirmed = await fixture(); assert.equal((await confirmed.dispatcher.dispatch()).confirmed, 1); const receipt = confirmed.observation().confirmedAt;
  confirmed.tasks.clear(); await confirmed.dispatcher.dispatch(); await confirmed.dispatcher.dispatch();
  assert.equal((await confirmed.dispatcher.dispatch()).needsAttention, 1); assert.equal(confirmed.calls.create, 1); assert.equal(confirmed.observation().confirmedAt, receipt);
  assert.equal(confirmed.first.work().state, 'pending'); assert.equal(confirmed.first.work().failures, 0);
  const lost = await fixture(); lost.clock.loseReservationReply = true;
  assert.equal((await lost.dispatcher.dispatch()).unknown, 1); assert.equal(lost.observation().state, 'dispatching'); assert.equal(lost.calls.create, 0);
  lost.clock.at += 31_000; assert.equal((await lost.dispatcher.dispatch()).unknown, 1); assert.equal(lost.calls.create, 0); assert.equal(lost.calls.get, 1);
  assert.equal((await lost.dispatcher.dispatch()).needsAttention, 1); assert.equal(lost.calls.create, 0); assert.equal(lost.observation().unresolved, 3);
});

test('one global page handles at most 25 candidates and a cursor continues the fixed scan without truncation', async () => {
  const f = await fixture(); for (let index = 1; index < 26; index++) await f.addTask();
  const first = await f.dispatcher.dispatch(); assert.equal(first.scanned, 25); assert.equal(first.confirmed, 25); assert.equal(first.hasMore, true); assert.ok(first.nextCursor);
  const second = await f.dispatcher.dispatch(first.nextCursor); assert.equal(second.scanned, 1); assert.equal(second.confirmed, 1); assert.equal(second.hasMore, false);
  assert.equal(f.calls.create, 26); assert.equal(f.tasks.size, 26);
  await assert.rejects(f.dispatcher.dispatch('bad+cursor'), (error: any) => error.code === 'invalid_cursor');
});

test('scheduled calls without a caller cursor pass 25 permanently blocked candidates and reach pending and leased tails', async () => {
  for (const lane of ['pending','leased'] as const) {
    const f=await fixture(), entries=[f.first];
    for(let index=1;index<26;index++) entries.push(await f.addTask());
    entries.sort((left,right)=>left.ref.path.localeCompare(right.ref.path));
    const tail=entries[25];
    if(lane==='leased')tail.setWork({state:'leased',lease:{token:randomUUID(),generation:tail.job.generation,until:'2026-10-11T03:59:00.000Z'}});
    for(const entry of entries.slice(0,25)) {
      const taskName=f.delivery.taskName(entry.job),ref=f.data.ref('task_dispatches','task-dispatch-observation',taskName),at=new Date(f.clock.at).toISOString();
      const observation={taskName,jobHash:firestoreDomainHash(entry.job),scheduledAt:entry.job.scheduledAt,state:'needs_attention' as const,
        calls:1,unresolved:3,confirmedAt:null,createdAt:at,updatedAt:at,lease:null};
      f.fake.records.set(ref.path,{...f.data.tags(entry.job.scope),...f.data.seal('task-dispatch-observation',taskName,entry.job.scope,
        firestoreTaskDispatchObservationSchema,observation,entry.job.taskVersion)});
    }
    const first=await f.dispatcher.dispatchScheduled();assert.equal(first.scanned,25);assert.equal(first.needsAttention,25);assert.equal(first.hasMore,true);
    const second=await f.dispatcher.dispatchScheduled();assert.equal(second.scanned,1);assert.equal(second.confirmed,1);
    assert.equal(f.tasks.size,1);assert.equal(f.tasks.has(f.delivery.taskName(tail.job)),true);
    assert.equal(f.calls.create,1);
  }
});
test('parallel scheduled claims are busy without scanning or calling Tasks and release the encrypted scan lease after completion', async () => {
  const f=await fixture();let entered!:()=>void,release!:()=>void;
  const started=new Promise<void>(resolve=>entered=resolve);f.behavior.hold=new Promise<void>(resolve=>release=resolve);
  const enqueue=f.delivery.enqueue;f.delivery.enqueue=async job=>{entered();return enqueue(job);};
  const first=f.dispatcher.dispatchScheduled();await started;
  const claimed=f.scan();assert.equal(claimed.revision,1);assert.ok(claimed.lease);assert.equal(claimed.cursor?.at,new Date(f.clock.at).toISOString());
  const second=await f.dispatcher.dispatchScheduled();assert.equal(second.busy,1);assert.equal(second.scanned,0);assert.equal(f.calls.create,1);
  assert.deepEqual(f.scan(),claimed);release();assert.equal((await first).confirmed,1);
  assert.equal(f.scan().lease,null);assert.equal(f.scan().cursor,null);assert.equal(f.scan().revision,2);assert.equal(f.tasks.size,1);
  const disabled=createFirestoreTaskDispatcher({...f.options,enabled:false,delivery:f.delivery}),before=[...f.fake.records];
  assert.equal((await disabled.dispatchScheduled()).state,'disabled');assert.deepEqual([...f.fake.records],before);
});

test('a lost scan claim reply retries the same cutoff after expiry without replacing the original task identity', async () => {
  const f=await fixture();f.fake.loseReply();
  await assert.rejects(f.dispatcher.dispatchScheduled(),/Synthetic lost commit acknowledgement/u);
  const claimed=f.scan();assert.equal(claimed.revision,1);assert.ok(claimed.lease);assert.equal(f.calls.create,0);
  assert.equal((await f.dispatcher.dispatchScheduled()).busy,1);assert.deepEqual(f.scan(),claimed);
  const later=await f.addTask('2026-10-11T04:00:30Z');
  f.clock.at+=FIRESTORE_TASK_DISPATCH_SCAN_LEASE_MS+1;
  const recovered=await f.dispatcher.dispatchScheduled();assert.equal(recovered.scanned,1);assert.equal(recovered.confirmed,1);
  assert.equal(f.tasks.has(f.delivery.taskName(f.first.job)),true);assert.equal(f.tasks.has(f.delivery.taskName(later.job)),false);
  assert.equal(f.calls.create,1);assert.equal(f.scan().cursor,null);assert.equal(f.scan().lease,null);
  await f.dispatcher.dispatchScheduled();assert.equal(f.calls.create,2);assert.equal(f.tasks.size,2);
});

test('an expired scan lease cannot settle over a later claimant or overwrite its completed cycle cursor', async () => {
  const f=await fixture();for(let index=1;index<26;index++)await f.addTask();
  let release!:()=>void,entered!:()=>void;const started=new Promise<void>(resolve=>entered=resolve);
  f.behavior.hold=new Promise<void>(resolve=>release=resolve);
  const enqueue=f.delivery.enqueue;f.delivery.enqueue=async job=>{entered();return enqueue(job);};
  const first=f.dispatcher.dispatchScheduled(),denied=assert.rejects(first,(error:any)=>error.code==='dispatch_scan_changed'&&error.status===503);
  await started;const stale=f.scan();assert.ok(stale.lease);f.clock.at+=FIRESTORE_TASK_DISPATCH_SCAN_LEASE_MS+1;
  const retry=await f.dispatcher.dispatchScheduled();assert.equal(retry.scanned,25);assert.ok(retry.nextCursor);
  f.behavior.hold=null;const tail=await f.dispatcher.dispatchScheduled();assert.equal(tail.scanned,1);assert.equal(tail.confirmed,1);
  const completed=f.scan();assert.equal(completed.cursor,null);assert.equal(completed.lease,null);assert.equal(completed.revision,5);
  release();await denied;assert.deepEqual(f.scan(),completed);
  assert.equal(f.calls.create,26);assert.equal(f.tasks.size,26);
});

test('a scan settlement failure retains the page and a later expiry only probes its durable Tasks observation', async () => {
  const f=await fixture(),encrypt=f.options.cipher.encrypt;
  let fail=true;
  f.options.cipher.encrypt=(text,context)=>{
    if(fail&&context.includes('"task-dispatch-scan"')&&JSON.parse(text).lease===null)throw new Error('Synthetic scan settlement failure');
    return encrypt(text,context);
  };
  await assert.rejects(f.dispatcher.dispatchScheduled(),/Synthetic scan settlement failure/u);
  const original=f.scan();assert.ok(original.lease);assert.equal(original.cursor?.time,null);assert.equal(f.calls.create,1);
  assert.equal((await f.dispatcher.dispatchScheduled()).busy,1);
  fail=false;f.clock.at+=FIRESTORE_TASK_DISPATCH_SCAN_LEASE_MS+1;
  assert.equal((await f.dispatcher.dispatchScheduled()).confirmed,1);assert.equal(f.calls.create,1);assert.equal(f.calls.get,1);
  assert.equal(f.tasks.size,1);assert.equal(f.scan().cursor,null);assert.equal(f.scan().lease,null);
});