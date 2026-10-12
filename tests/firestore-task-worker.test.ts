import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirestoreTaskWorker, firestoreNotificationPreferencesSchema, firestoreTaskNotificationOutboxSchema,
  firestoreTaskReminderBatchSchema, firestoreTaskReminderId, firestoreTaskReminderBatchId, firestoreTaskStableScope,
  type FirestoreTaskDelivery, type FirestoreTaskClaim } from '../server/firestore-task-worker.ts';
import { FirestoreDomainData, firestoreReminderOutboxId, firestoreReminderOutboxSchema, type FirestoreReminderOutbox } from '../server/firestore-domain-data.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '../src/shared/family.ts';
import type { CareTask } from '../src/shared/tasks.ts';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';

async function fixture(kind: 'ordinary' | 'appointment' = 'appointment', enabled = true) {
  const fake = firestoreDomainFixture(), clock = { at: Date.parse('2026-10-11T04:00:00Z'), disabled: false, verified: true, authCalls: 0, email: 'owner@example.test' as string | null };
  const options = { database: fake.database, cipher: createStorageCipher(Buffer.alloc(32, 89)), projectId: 'synthetic-task-project', namespace: 'synthetic_tasks', serverClock: () => clock.at };
  const authority = createFirestoreAuthority(options), online = createFirestoreOnlineStore(options), data = new FirestoreDomainData(options), uid = 'synthetic-owner';
  const generation = randomUUID(); await authority.initializeControl({ generation, enabled: true });
  await authority.issueInvitation({ email: 'owner@example.test', expiresAt: '2027-01-01T00:00:00Z', operationId: randomUUID() });
  await authority.admitIdentity({ userId: uid, email: 'owner@example.test', emailVerified: true });
  await authority.acknowledge({ userId: uid, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  async function command(path: string, payload: unknown) {
    const operation = { ...await online.context(uid, { path, payload }), deviceId: randomUUID(), opId: randomUUID() };
    return online.submit(uid, { path, payload, operation });
  }
  const childReceipt = await command('/api/children', { displayName: 'Synthetic child' }), childId = (childReceipt.result as any).child.id;
  const taskReceipt = await command(`/api/children/${childId}/tasks`, { confirm: true, values: { title: 'Private task title', details: 'Private task details', kind,
    assigneeUserId: uid, dueAt: '2026-10-11T03:00:00Z', timeZone: 'Asia/Hong_Kong' } });
  const task = (taskReceipt.result as { task: CareTask }).task, binding = await authority.readScope(uid, childId);
  const job: FirestoreTaskDelivery = { kind: 'task-reminder', scope: binding.scope, taskId: task.id, taskVersion: task.version,
    occurrenceId: task.occurrence.id, authorizationVersion: binding.authorizationVersion, generation, scheduledAt: task.occurrence.dueAt };
  const worker = createFirestoreTaskWorker({ ...options, enabled, async currentAuth(userId) { clock.authCalls++; return { userId, disabled: clock.disabled, emailVerified: clock.verified, email: clock.email }; } });
  const workRef = data.ref('task_outbox', 'task-reminder-outbox', firestoreReminderOutboxId(task.id, task.version));
  function work() { const raw = fake.records.get(workRef.path); return data.open('task-reminder-outbox', firestoreReminderOutboxId(task.id, task.version), binding.scope,
    firestoreReminderOutboxSchema, { exists: true, data: () => raw } as any); }
  function setWork(change: Partial<FirestoreReminderOutbox>) {
    const changed = { ...work(), ...change };
    fake.records.set(workRef.path, { ...fake.records.get(workRef.path), state: changed.state, dueAt: changed.dueAt, leaseUntil: changed.lease?.until ?? null,
      ...data.seal('task-reminder-outbox', firestoreReminderOutboxId(task.id, task.version), binding.scope, firestoreReminderOutboxSchema, changed, task.version) });
  }
  async function view() { return authority.runTransaction(uid, childId, tx => worker.view(tx, [task.id])); }
  return { fake, options, authority, online, data, uid, clock, worker, task, job, work, setWork, command, view };
}
const lease = (value: FirestoreTaskClaim) => { assert.equal(value.state, 'claimed'); if (value.state !== 'claimed') throw new Error('Expected claim'); return value.lease; };

test('reminder identity survives an epoch restore while owner, workspace and child identities remain isolated', async () => {
  const f = await fixture(), scope = f.job.scope, restored = { ...scope, storageEpoch: randomUUID() };
  for (const phase of ['initial', 'follow_up'] as const) {
    const original = firestoreTaskReminderId(scope, f.job.occurrenceId, phase);
    assert.equal(firestoreTaskReminderId(restored, f.job.occurrenceId, phase), original);
    assert.notEqual(firestoreTaskReminderId({ ...scope, ownerUserId: 'other-owner' }, f.job.occurrenceId, phase), original);
    assert.notEqual(firestoreTaskReminderId({ ...scope, workspaceId: randomUUID() }, f.job.occurrenceId, phase), original);
    assert.notEqual(firestoreTaskReminderId({ ...scope, childId: randomUUID() }, f.job.occurrenceId, phase), original);
  }
  assert.deepEqual(firestoreTaskStableScope(restored), { ownerUserId: scope.ownerUserId, workspaceId: scope.workspaceId, childId: scope.childId });
  for (const category of ['ordinary', 'appointment'] as const) {
    const key = category === 'ordinary' ? '2026-10-11' : f.job.occurrenceId, original = firestoreTaskReminderBatchId(scope, category, key);
    assert.equal(firestoreTaskReminderBatchId(restored, category, key), original);
    assert.notEqual(firestoreTaskReminderBatchId({ ...scope, ownerUserId: 'other-owner' }, category, key), original);
    assert.notEqual(firestoreTaskReminderBatchId({ ...scope, childId: randomUUID() }, category, key), original);
  }
});

test('native-shaped claims, atomic reminders and notification intents replay one original receipt without external delivery', async () => {
  const f = await fixture(), claimed = lease(await f.worker.claim(f.job));
  assert.equal(f.work().attempts, 1); assert.equal(f.work().state, 'leased');
  assert.equal((await f.worker.claim(f.job)).state, 'busy');
  const beforeCompletion = [...f.fake.records]; f.fake.retry(); f.fake.loseReply();
  await assert.rejects(f.worker.complete(f.job, claimed), /Synthetic lost commit acknowledgement/u);
  const completed = [...f.fake.records], replay = await f.worker.process(f.job);
  assert.equal(replay.state, 'processed'); assert.equal(replay.receipt?.phase, 'initial'); assert.equal(f.work().lease, null);
  assert.notDeepEqual(completed, beforeCompletion); assert.deepEqual([...f.fake.records], completed);
  assert.equal([...f.fake.records.keys()].filter(path => path.startsWith(f.options.namespace + '_task_reminders/')).length, 1);
  assert.equal([...f.fake.records.keys()].filter(path => path.startsWith(f.options.namespace + '_notification_outbox/')).length, 1);
  const snapshot = await f.view(); assert.deepEqual(snapshot.reminders, [replay.receipt]); assert.equal(snapshot.work[0].status, 'processed'); assert.equal(snapshot.workerEnabled, true);
  const batch = [...f.fake.records].find(([path]) => path.startsWith(f.options.namespace + '_task_reminder_batches/'))!;
  const scope = { ...f.job.scope, childId: '00000000-0000-0000-0000-000000000000' };
  const receipt = f.data.open('task-reminder-batch', replay.receipt!.batchId, scope, firestoreTaskReminderBatchSchema, { exists: true, data: () => batch[1] } as any);
  assert.equal(receipt.id, firestoreTaskReminderBatchId(scope, receipt.category, receipt.key));
  assert.equal(receipt.state, 'open'); assert.ok(f.clock.authCalls >= 4);
  for (const raw of f.fake.records.values()) { assert.equal(JSON.stringify(raw).includes('Private task'), false); assert.equal(JSON.stringify(raw).includes(f.uid), false); }
});

test('expired leases are reclaimed under the same generation, stale completion has no effect, and three actual failures stop work', async () => {
  const f = await fixture(), old = lease(await f.worker.claim(f.job));
  f.clock.at += 30_001; const next = lease(await f.worker.claim(f.job));
  assert.notEqual(next.token, old.token); assert.equal(next.generation, old.generation); assert.equal(f.work().attempts, 2); assert.equal(f.work().failures, 1);
  const committed = [...f.fake.records]; assert.equal((await f.worker.complete(f.job, old)).state, 'stale'); assert.deepEqual([...f.fake.records], committed);
  assert.equal((await f.worker.complete(f.job, next)).state, 'processed'); assert.equal((await f.view()).work[0].failures, 1);
  const exhausted = await fixture();
  for (let attempt = 1; attempt <= 3; attempt++) { lease(await exhausted.worker.claim(exhausted.job)); assert.equal(exhausted.work().attempts, attempt);
    assert.equal(exhausted.work().failures, attempt - 1); exhausted.clock.at += 30_001; }
  assert.equal((await exhausted.worker.claim(exhausted.job)).state, 'failed'); assert.equal(exhausted.work().state, 'failed');
  assert.equal(exhausted.work().failures, 3); const failed = [...exhausted.fake.records];
  assert.equal((await exhausted.worker.claim(exhausted.job)).state, 'failed'); assert.deepEqual([...exhausted.fake.records], failed);
  assert.equal([...exhausted.fake.records.keys()].some(path => path.startsWith(exhausted.options.namespace + '_task_reminders/')), false);
});

test('cancellation, canonical revocation, live Auth denial and unknown work fence completion without effects', async () => {
  const f = await fixture(), claimed = lease(await f.worker.claim(f.job));
  await f.command(`/api/children/${f.job.scope.childId}/tasks/${f.task.id}/change`, { confirm: true, action: 'cancel', expectedVersion: 1, note: 'Cancel' });
  const cancelled = [...f.fake.records]; assert.equal((await f.worker.complete(f.job, claimed)).state, 'stopped'); assert.deepEqual([...f.fake.records], cancelled);
  const revoked = await fixture(), revokedLease = lease(await revoked.worker.claim(revoked.job));
  await revoked.authority.revokeInvitation({ email: 'owner@example.test', operationId: randomUUID() }); const revokedRecords = [...revoked.fake.records];
  await assert.rejects(revoked.worker.complete(revoked.job, revokedLease), (error: any) => error.status === 403); assert.deepEqual([...revoked.fake.records], revokedRecords);
  const denied = await fixture(), deniedLease = lease(await denied.worker.claim(denied.job)); denied.clock.disabled = true;
  const deniedRecords = [...denied.fake.records];
  await assert.rejects(denied.worker.complete(denied.job, deniedLease), (error: any) => error.code === 'task_auth_denied');
  await assert.rejects(denied.worker.claim(denied.job), (error: any) => error.code === 'task_auth_denied'); assert.deepEqual([...denied.fake.records], deniedRecords);
  const unknown = await fixture(); unknown.setWork({ state: 'unknown', attempts: 1, lease: null }); const unknownRecords = [...unknown.fake.records];
  assert.equal((await unknown.worker.process(unknown.job)).state, 'unknown'); assert.deepEqual([...unknown.fake.records], unknownRecords);
});

test('a verified current Auth identity must still match the canonical email before claim, completion or dispatch', async () => {
  for (const email of ['changed@example.test', null, 'invalid email']) {
    const f = await fixture(), before = [...f.fake.records]; f.clock.email = email;
    await assert.rejects(f.worker.claim(f.job), (error: any) => error.status === 403 && error.code === 'task_auth_denied');
    await assert.rejects(f.worker.dispatchTransaction(f.job, 'enqueue', async () => { throw Error('Must not reach dispatch'); }), (error: any) => error.status === 403);
    await assert.rejects(f.worker.due(f.uid, f.job.scope.childId), (error: any) => error.status === 403);
    assert.deepEqual([...f.fake.records], before);
  }
  const claimed = await fixture(), original = lease(await claimed.worker.claim(claimed.job)), before = [...claimed.fake.records];
  claimed.clock.email = 'changed@example.test';
  await assert.rejects(claimed.worker.complete(claimed.job, original), (error: any) => error.status === 403 && error.code === 'task_auth_denied');
  assert.deepEqual([...claimed.fake.records], before);
});

test('saved preferences defer quiet hours and ordinary reminders retain the original follow-up policy', async () => {
  const f = await fixture('ordinary'); f.clock.at = Date.parse('2026-10-11T15:00:00Z');
  const scope = { ...f.job.scope, childId: '00000000-0000-0000-0000-000000000000' }, preference = { ...DEFAULT_NOTIFICATION_PREFERENCES, version: 1 };
  const ref = f.data.ref('notification_preferences', 'notification-preferences', f.uid);
  f.fake.records.set(ref.path, { ...f.data.tags(scope), ...f.data.seal('notification-preferences', f.uid, scope, firestoreNotificationPreferencesSchema, preference, preference.version) });
  const quiet = await f.worker.process(f.job); assert.equal(quiet.state, 'deferred'); assert.equal(quiet.receipt, null);
  assert.equal(quiet.nextAt, '2026-10-12T00:00:00.000Z'); assert.equal(f.work().state, 'pending'); assert.equal(f.work().lease, null);
  f.clock.at = Date.parse(quiet.nextAt!); const initial = await f.worker.process({ ...f.job, scheduledAt: quiet.nextAt! });
  assert.equal(initial.state, 'deferred'); assert.equal(initial.receipt?.phase, 'initial'); assert.ok(Date.parse(initial.nextAt!) > f.clock.at);
  const original = initial.receipt; assert.equal((await f.worker.process(f.job)).state, 'not_due');
  f.clock.at = Date.parse(initial.nextAt!); const followUp = await f.worker.process({ ...f.job, scheduledAt: initial.nextAt! });
  assert.equal(followUp.state, 'processed'); assert.equal(followUp.receipt?.phase, 'follow_up'); assert.equal(f.work().attempts, 3);
  assert.equal(f.work().failures, 0);
  assert.deepEqual((await f.view()).reminders, [original, followUp.receipt]);
});

test('more than three normal policy deferrals remain claimable and old outboxes default only a missing failures field', async () => {
  const f = await fixture(), scope = { ...f.job.scope, childId: '00000000-0000-0000-0000-000000000000' };
  const ref = f.data.ref('notification_preferences', 'notification-preferences', f.uid);
  for (let check = 0; check < 4; check++) {
    const preference = { ...DEFAULT_NOTIFICATION_PREFERENCES, quietStart: `${12 + check}:00`, quietEnd: `${13 + check}:00`, version: check + 1 };
    f.fake.records.set(ref.path, { ...f.data.tags(scope), ...f.data.seal('notification-preferences', f.uid, scope, firestoreNotificationPreferencesSchema, preference, preference.version) });
    const deferred = await f.worker.process(f.job); assert.equal(deferred.state, 'deferred'); assert.equal(deferred.receipt, null);
    assert.equal(f.work().attempts, check + 1); assert.equal(f.work().failures, 0); f.clock.at = Date.parse(deferred.nextAt!);
  }
  const completed = await f.worker.process(f.job); assert.equal(completed.state, 'processed'); assert.equal(f.work().attempts, 5); assert.equal(f.work().failures, 0);
  const { failures: _, ...old } = f.work(); assert.equal(firestoreReminderOutboxSchema.parse(old).failures, 0);
  for (const failures of [null, '0', -1, 4, 0.5]) assert.equal(firestoreReminderOutboxSchema.safeParse({ ...old, failures }).success, false);
});

test('invalid saved preferences and unknown notification delivery fail closed instead of inventing defaults or another reminder', async () => {
  const f = await fixture(), scope = { ...f.job.scope, childId: '00000000-0000-0000-0000-000000000000' };
  const ref = f.data.ref('notification_preferences', 'notification-preferences', f.uid); f.fake.records.set(ref.path, { ...f.data.tags(scope), format: 'invalid' });
  const claimed = lease(await f.worker.claim(f.job)), before = [...f.fake.records];
  await assert.rejects(f.worker.complete(f.job, claimed), (error: any) => error.code === 'invalid_document'); assert.deepEqual([...f.fake.records], before);
  const unknown = await fixture('ordinary'), initial = await unknown.worker.process(unknown.job); assert.ok(initial.receipt);
  const notificationRef = unknown.data.ref('notification_outbox', 'task-notification-outbox', initial.receipt!.id), raw = unknown.fake.records.get(notificationRef.path);
  const notification = unknown.data.open('task-notification-outbox', initial.receipt!.id, unknown.job.scope, firestoreTaskNotificationOutboxSchema, { exists: true, data: () => raw } as any);
  unknown.fake.records.set(notificationRef.path, { ...raw, state: 'unknown', ...unknown.data.seal('task-notification-outbox', notification.id, unknown.job.scope,
    firestoreTaskNotificationOutboxSchema, { ...notification, state: 'unknown' }, notification.taskVersion) });
  unknown.clock.at = Date.parse(initial.nextAt!); assert.equal((await unknown.worker.process(unknown.job)).state, 'unknown'); assert.equal(unknown.work().state, 'unknown');
  assert.equal([...unknown.fake.records.keys()].filter(path => path.startsWith(unknown.options.namespace + '_task_reminders/')).length, 1);
});

test('due queries and views remain inside canonical owner scope, while worker configuration must explicitly enable work', async () => {
  const f = await fixture(); assert.deepEqual(await f.worker.due(f.uid, f.job.scope.childId), [f.job]);
  const claimed = lease(await f.worker.claim(f.job)); assert.deepEqual(await f.worker.due(f.uid, f.job.scope.childId), []);
  f.clock.at = Date.parse(claimed.until) + 1; assert.deepEqual(await f.worker.due(f.uid, f.job.scope.childId), [f.job]);
  const disabled = await fixture('appointment', false), before = [...disabled.fake.records];
  assert.equal((await disabled.worker.process(disabled.job)).state, 'disabled'); assert.deepEqual(await disabled.worker.due(disabled.uid, disabled.job.scope.childId), []);
  assert.equal((await disabled.view()).workerEnabled, false); assert.deepEqual([...disabled.fake.records], before);
  await assert.rejects(f.worker.claim({ ...f.job, generation: randomUUID() }), (error: any) => error.code === 'task_scope_changed');
  await assert.rejects(f.worker.claim({ ...f.job, scope: { ...f.job.scope, storageEpoch: randomUUID() } }), (error: any) => error.code === 'task_scope_changed');
});
