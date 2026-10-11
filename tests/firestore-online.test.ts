import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { FirestoreDomainData, firestoreReminderOutboxSchema, firestoreReminderOutboxId, type FirestoreReminderOutbox } from '../server/firestore-domain-data.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { workRecoveryDocumentId, workRecoveryAad, type WorkRecoveryScope } from '../server/firestore-work-continuation-recovery.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import type { OnlineSubmission, OnlineReceipt } from '../src/shared/online.ts';
import type { CareTask, TaskChange } from '../src/shared/tasks.ts';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';

function fixture() {
  const fake = firestoreDomainFixture(), cipher = createStorageCipher(Buffer.alloc(32, 73));
  const options = { database: fake.database, cipher, projectId: 'synthetic-online-project', namespace: 'synthetic_online_domain' };
  const authority = createFirestoreAuthority(options), online = createFirestoreOnlineStore(options), data = new FirestoreDomainData(options);
  async function identity(userId = 'synthetic-owner', email = 'owner@example.test') {
    await authority.issueInvitation({ email, expiresAt: new Date(Date.now() + 60_000).toISOString(), operationId: randomUUID() });
    const admission = await authority.admitIdentity({ userId, email, emailVerified: true });
    await authority.acknowledge({ userId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
    return admission;
  }
  async function command(path: string, payload: unknown, userId = 'synthetic-owner', opId: string = randomUUID()): Promise<OnlineSubmission> {
    return { path, payload, operation: { ...await online.context(userId, { path, payload }), opId, deviceId: randomUUID() } };
  }
  async function child(userId = 'synthetic-owner', opId?: string) {
    const input = await command('/api/children', { displayName: '私人合成孩子' }, userId, opId);
    const receipt = await online.submit(userId, input); return { input, receipt, child: (receipt.result as any).child };
  }
  const taskValues = (userId = 'synthetic-owner') => ({ title: 'Private synthetic task', details: 'Private task body', kind: 'ordinary' as const,
    assigneeUserId: userId, dueAt: '2026-10-12T12:00:00Z', timeZone: 'Asia/Hong_Kong' });
  async function task(childId: string, userId = 'synthetic-owner', opId?: string) {
    const input = await command(`/api/children/${childId}/tasks`, { confirm: true, values: taskValues(userId) }, userId, opId);
    const receipt = await online.submit(userId, input); return { input, receipt, task: (receipt.result as { task: CareTask }).task };
  }
  async function change(childId: string, task: CareTask, input: TaskChange) {
    const commandInput = await command(`/api/children/${childId}/tasks/${task.id}/change`, input);
    const receipt = await online.submit('synthetic-owner', commandInput); return { input: commandInput, receipt, task: (receipt.result as { task: CareTask }).task };
  }
  const jobs = async (childId: string): Promise<{ scope: WorkRecoveryScope; jobs: FirestoreReminderOutbox[] }> => {
    const binding = await authority.readScope('synthetic-owner', childId), rows = [...fake.records].filter(([path]) => path.startsWith(options.namespace + '_task_outbox/'));
    return { scope: binding.scope, jobs: rows.map(([, raw]) => data.open('task-reminder-outbox', firestoreReminderOutboxId(raw.taskId, raw.taskVersion),
      binding.scope, firestoreReminderOutboxSchema, { exists: true, data: () => raw } as any)) };
  };
  async function initialize() { await authority.initializeControl({ generation: randomUUID(), enabled: true }); }
  return { fake, options, authority, online, data, identity, command, child, task, taskValues, change, jobs, initialize };
}
const rejection = (code: string, status?: number) => (error: any) => error?.code === code && (status === undefined || error.status === status);

test('empty canonical admission creates online child/task, exact receipts, projections, queries and encrypted reminder intents', async () => {
  const f = fixture(); assert.equal(f.fake.records.size, 0); await f.initialize(); const admission = await f.identity();
  const spaces = await f.online.spaces('synthetic-owner'); assert.equal(spaces.length, 1);
  assert.equal(spaces[0].id, admission.workspaceId); assert.ok(Date.parse(spaces[0].createdAt));
  const child = await f.child(), task = await f.task(child.child.id), committed = [...f.fake.records];
  assert.equal(child.receipt.statusCode, 201); assert.equal(child.receipt.changeSeq, '1'); assert.equal(task.receipt.changeSeq, '2');
  assert.deepEqual(await f.online.submit('synthetic-owner', child.input), child.receipt);
  assert.deepEqual(await f.online.submit('synthetic-owner', task.input), task.receipt);
  assert.deepEqual(await f.online.lookup('synthetic-owner', task.input.operation.opId), task.receipt);
  assert.deepEqual(await f.online.lookup('synthetic-owner', randomUUID()), { state: 'unconfirmed' });
  assert.deepEqual([...f.fake.records], committed);
  assert.deepEqual(await f.online.children.list('synthetic-owner'), { children: [child.child], nextCursor: null });
  assert.deepEqual(await f.online.tasks.get('synthetic-owner', child.child.id, task.task.id), task.task);
  const page = await f.online.tasks.list('synthetic-owner', child.child.id);
  assert.deepEqual(page.items, [task.task]); assert.equal(page.nextAfterId, null); assert.equal(page.workerEnabled, false);
  assert.deepEqual((await f.online.tasks.history('synthetic-owner', child.child.id, task.task.id))?.revisions.map(row => row.action), ['create']);
  const changes = await f.online.changes('synthetic-owner', admission.workspaceId, admission.storageEpoch, '0');
  assert.deepEqual(changes.changes, [{ changeSeq: '1', kind: 'children', childId: child.child.id, deleted: false },
    { changeSeq: '2', kind: 'tasks', childId: child.child.id, deleted: false }]);
  assert.equal(changes.cursor, '2'); assert.equal(changes.hasMore, false);
  const { jobs } = await f.jobs(child.child.id); assert.equal(jobs.length, 1);
  assert.equal(jobs[0].state, 'pending'); assert.equal(jobs[0].attempts, 0); assert.equal(jobs[0].lease, null);
  assert.equal(jobs[0].taskId, task.task.id); assert.equal(jobs[0].authorizationVersion, '1');
  for (const value of f.fake.records.values()) {
    const encoded = JSON.stringify(value); assert.equal(encoded.includes('私人合成孩子'), false);
    assert.equal(encoded.includes('Private task body'), false); assert.equal(encoded.includes('owner@example'), false);
    assert.equal(encoded.includes('synthetic-owner'), false);
  }
});

test('caller-wide operation identity conflicts before any changed target read; same opId is isolated per owner', async () => {
  const f = fixture(); await f.initialize(); await f.identity(); const child = await f.child(); const committed = [...f.fake.records];
  for (const changed of [
    { ...child.input, payload: { displayName: 'Changed' } },
    { ...child.input, operation: { ...child.input.operation, deviceId: randomUUID() } },
    { ...child.input, path: `/api/children/${randomUUID()}/tasks`, payload: { confirm: true, values: f.taskValues() } },
  ]) await assert.rejects(f.online.submit('synthetic-owner', changed), rejection('operation_conflict', 409));
  assert.deepEqual([...f.fake.records], committed);
  await f.identity('another-owner', 'another@example.test'); const another = await f.child('another-owner', child.input.operation.opId);
  assert.notEqual(another.child.id, child.child.id); assert.notEqual(another.input.operation.workspaceId, child.input.operation.workspaceId);
  assert.deepEqual(await f.online.lookup('another-owner', child.input.operation.opId), another.receipt);
  await assert.rejects(f.online.tasks.get('another-owner', child.child.id, randomUUID()));
  const unsupported = await f.command('/api/notification-preferences', { confirm: true });
  const before = [...f.fake.records]; await assert.rejects(f.online.submit('synthetic-owner', unsupported), rejection('domain_not_ready', 503));
  assert.deepEqual([...f.fake.records], before);
});

test('task versions preserve original policy, revisions, cancellation and opposing terminal resolution', async () => {
  const f = fixture(); await f.initialize(); await f.identity(); const child = await f.child(), first = await f.task(child.child.id);
  const reschedule = await f.change(child.child.id, first.task, { confirm: true, action: 'reschedule', expectedVersion: 1,
    dueAt: '2026-10-13T12:00:00Z', timeZone: 'Asia/Hong_Kong', assigneeUserId: 'synthetic-owner', note: 'Move appointment' });
  assert.equal(reschedule.task.version, 2); assert.equal(reschedule.task.occurrence.id, first.task.occurrence.id);
  assert.deepEqual((await f.jobs(child.child.id)).jobs.map(job => job.state), ['cancelled', 'pending']);
  const stale = await f.command(`/api/children/${child.child.id}/tasks/${first.task.id}/change`,
    { confirm: true, action: 'complete', expectedVersion: 1, note: '' });
  const before = [...f.fake.records]; await assert.rejects(f.online.submit('synthetic-owner', stale), rejection('version_conflict', 409));
  assert.deepEqual([...f.fake.records], before);
  const cancelled = await f.change(child.child.id, reschedule.task, { confirm: true, action: 'cancel', expectedVersion: 2, note: 'Cancel task' });
  assert.equal(cancelled.task.occurrence.state, 'cancelled'); assert.equal(cancelled.task.version, 3);
  assert.deepEqual((await f.jobs(child.child.id)).jobs.map(job => job.state), ['cancelled', 'cancelled']);
  const opposing = await f.change(child.child.id, cancelled.task, { confirm: true, action: 'complete', expectedVersion: 2, note: '' });
  assert.equal(opposing.task.occurrence.state, 'needs_review');
  const resolved = await f.change(child.child.id, opposing.task, { confirm: true, action: 'resolve', expectedVersion: 4, outcome: 'completed', note: 'Confirmed outcome' });
  assert.equal(resolved.task.version, 5); assert.equal(resolved.task.occurrence.state, 'completed');
  assert.deepEqual((await f.online.tasks.history('synthetic-owner', child.child.id, first.task.id))?.revisions.map(row => row.action),
    ['resolve', 'complete', 'cancel', 'reschedule', 'create']);
  assert.deepEqual(await f.online.submit('synthetic-owner', first.input), first.receipt);
  assert.deepEqual(await f.online.submit('synthetic-owner', cancelled.input), cancelled.receipt);
});

test('unknown occurrence intent remains fenced across two reschedules without inventing another job', async () => {
  const f = fixture(); await f.initialize(); await f.identity(); const child = await f.child(), first = await f.task(child.child.id);
  const initial = await f.jobs(child.child.id), job = { ...initial.jobs[0], state: 'unknown' as const, attempts: 1 };
  const id = firestoreReminderOutboxId(job.taskId, job.taskVersion), ref = f.data.ref('task_outbox', 'task-reminder-outbox', id);
  // Synthetic worker state transition authenticates the original intent; it does not seed account/task authority.
  f.fake.records.set(ref.path, { ...f.fake.records.get(ref.path), state: 'unknown',
    ...f.data.seal('task-reminder-outbox', id, initial.scope, firestoreReminderOutboxSchema, job, job.taskVersion) });
  let current = first.task;
  for (let i = 0; i < 2; i++) current = (await f.change(child.child.id, current, { confirm: true, action: 'reschedule', expectedVersion: current.version,
    dueAt: '2026-10-14T12:00:00Z', timeZone: 'Asia/Hong_Kong', assigneeUserId: 'synthetic-owner', note: 'Change due date' })).task;
  assert.deepEqual((await f.jobs(child.child.id)).jobs, [job]); assert.equal(current.version, 3);
});

test('transaction failure and discarded callbacks preserve atomic child/task ledgers; commit loss replays original result', async () => {
  const f = fixture(); await f.initialize(); await f.identity(); const childInput = await f.command('/api/children', { displayName: 'Atomic child' });
  let before = [...f.fake.records]; f.fake.failCommit();
  await assert.rejects(f.online.submit('synthetic-owner', childInput), /Synthetic transaction commit failed/u);
  assert.deepEqual([...f.fake.records], before);
  f.fake.retry(); const childReceipt = await f.online.submit('synthetic-owner', childInput), childId = (childReceipt.result as any).child.id;
  assert.equal([...f.fake.records.keys()].filter(path => path.startsWith(f.options.namespace + '_children/')).length, 1);
  const taskInput = await f.command(`/api/children/${childId}/tasks`, { confirm: true, values: f.taskValues() });
  before = [...f.fake.records]; f.fake.failCommit();
  await assert.rejects(f.online.submit('synthetic-owner', taskInput), /Synthetic transaction commit failed/u);
  assert.deepEqual([...f.fake.records], before);
  f.fake.retry(); f.fake.loseReply(); await assert.rejects(f.online.submit('synthetic-owner', taskInput), /Synthetic lost commit acknowledgement/u);
  const original = await f.online.lookup('synthetic-owner', taskInput.operation.opId); assert.equal(original.state, 'confirmed');
  assert.deepEqual(await f.online.submit('synthetic-owner', taskInput), original);
  assert.equal([...f.fake.records.keys()].filter(path => path.startsWith(f.options.namespace + '_tasks/')).length, 1);
  assert.equal([...f.fake.records.keys()].filter(path => path.startsWith(f.options.namespace + '_task_revisions/')).length, 1);
  assert.equal([...f.fake.records.keys()].filter(path => path.startsWith(f.options.namespace + '_task_outbox/')).length, 1);
});

test('current canonical revocation and deletion redact or reject stored results without replaying a mutation', async () => {
  const f = fixture(); await f.initialize(); await f.identity(); const child = await f.child(), task = await f.task(child.child.id);
  const binding = await f.authority.readScope('synthetic-owner', child.child.id), ref = f.options.database.collection(f.options.namespace).doc(workRecoveryDocumentId('child', child.child.id));
  const raw = { id: child.child.id, workspaceId: binding.scope.workspaceId, status: 'deleted' };
  f.fake.records.set(ref.path, { format: 'yuban-work-recovery', version: 1,
    ciphertext: f.options.cipher.encrypt(JSON.stringify(raw), workRecoveryAad(f.options.projectId, f.options.namespace, 'child', child.child.id, binding.scope)) });
  const before = [...f.fake.records];
  assert.equal((await f.online.lookup('synthetic-owner', task.input.operation.opId) as OnlineReceipt).result, null);
  assert.equal((await f.online.submit('synthetic-owner', child.input)).result, null);
  assert.deepEqual(await f.online.children.list('synthetic-owner'), { children: [], nextCursor: null });
  assert.deepEqual([...f.fake.records], before);
  await f.authority.revokeInvitation({ email: 'owner@example.test', operationId: randomUUID() }); const revoked = [...f.fake.records];
  await assert.rejects(f.online.lookup('synthetic-owner', task.input.operation.opId), rejection('account_inactive', 403));
  await assert.rejects(f.online.submit('synthetic-owner', child.input), rejection('account_inactive', 403));
  assert.deepEqual([...f.fake.records], revoked);
});

test('children native-shaped pagination carries scope/epoch/changeSeq and never silently truncates', async () => {
  const f = fixture(); await f.initialize(); await f.identity();
  for (let i = 0; i < 51; i++) await f.authority.createChild({ userId: 'synthetic-owner', operationId: randomUUID(), displayName: 'Page child ' + i });
  const first = await f.online.children.list('synthetic-owner'); assert.equal(first.children.length, 50); assert.ok(first.nextCursor);
  const last = await f.online.children.list('synthetic-owner', first.nextCursor);
  assert.equal(last.children.length, 1); assert.equal(last.nextCursor, null);
  assert.equal(new Set([...first.children, ...last.children].map(child => child.id)).size, 51);
  await f.authority.createChild({ userId: 'synthetic-owner', operationId: randomUUID(), displayName: 'New child invalidates cursor' });
  await assert.rejects(f.online.children.list('synthetic-owner', first.nextCursor), rejection('cursor_changed', 409));
});
