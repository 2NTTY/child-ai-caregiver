import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { FirestoreDeviceSessions } from '../server/firestore-device-sessions.ts';
import { createFirestoreNativePush } from '../server/firestore-native-push.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirestoreContact, firestoreContactGrantSchema, firestoreContactRequestSchema } from '../server/firestore-contact.ts';
import { FirestoreDomainData } from '../server/firestore-domain-data.ts';
import { firestoreBackgroundWorkSchema, prepareFirestoreBackgroundWork } from '../server/firestore-background-work.ts';
import { createFirestoreTaskWorker } from '../server/firestore-task-worker.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import type { NativePushBinding } from '../src/shared/native-push.ts';
import type { CareTask } from '../src/shared/tasks.ts';
import type { NativePushGateway, NativePushSender, NativePushSendResult } from '../server/native-push-gateway.ts';

async function fixture(platform: 'ios' | 'android', kind: 'test' | 'care') {
  const fake = firestoreDomainFixture(), options = { database: fake.database, cipher: createStorageCipher(Buffer.alloc(32, 74)),
    projectId: 'synthetic-push-expiration', namespace: 'push_expiration' };
  const authority = createFirestoreAuthority(options), data = new FirestoreDomainData(options), userId = 'parent';
  const generation = randomUUID();
  await authority.initializeControl({ generation, enabled: true });
  await authority.issueInvitation({ email: 'parent@example.test', expiresAt: new Date(Date.now() + 60_000).toISOString(), operationId: randomUUID() });
  await authority.admitIdentity({ userId, email: 'parent@example.test', emailVerified: true });
  await authority.acknowledge({ userId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  const sessions = new FirestoreDeviceSessions({ ...options, namespace: 'push_expiration_sessions' });
  const session = { userId, sessionHash: 'a'.repeat(64) };
  await sessions.issue({ ...session, expiresAtMs: Date.now() + 86400_000, authTimeSeconds: Math.floor(Date.now() / 1000) });
  const token = platform === 'ios' ? 'ab'.repeat(32) : 'synthetic-android-registration-token';
  let calls = 0, afterAuthorization = async () => {}, outcome: NativePushSendResult = { status: 'rejected', reason: 'subscription_expired',
    providerStatus: platform === 'ios' ? 410 : 404, ...(platform === 'ios' ? { apnsInvalidatedAt: Date.now() } : {}) };
  const send: NativePushSender['send'] = async (sent, reference, _signal, authorized) => {
    assert.equal(sent, token); assert.equal(reference.kind, kind); assert.equal(await authorized(), true);
    calls++; await afterAuthorization(); return outcome;
  };
  const unused: NativePushSender['send'] = async () => { throw Error('Wrong native provider'); };
  const gateway: NativePushGateway = { available: platform === 'android', send: platform === 'android' ? send : unused,
    apns: { available: platform === 'ios', binding: { topic: 'org.yuyoufang.app', environment: 'production' }, send: platform === 'ios' ? send : unused } };
  const currentAuth = async () => ({ disabled: false, emailVerified: true });
  const store = createFirestoreNativePush({ ...options, sessions, gateway, currentAuth });
  const contact = createFirestoreContact({ ...options, nativePush: store, nativePushGateway: gateway,
    push: {} as any, telegram: {} as any, pushGateway: { publicKey: null } as any, telegramGateway: {} as any,
    telegramBotId: null, growth: { taskAllowedIn: async () => true }, runs: () => { throw Error('No Agent in this fixture'); }, currentAuth });
  const online = createFirestoreOnlineStore({ ...options, mutations: [store.mutation, contact.mutation] });
  const submit = async (path: string, payload: unknown) => {
    const operation = { ...await online.context(userId, { path, payload }), deviceId: randomUUID(), opId: randomUUID() };
    return (await online.submit(userId, { path, payload, operation }, { nativeSession: session })).result as any;
  };
  const path = platform === 'ios' ? '/api/native-push/v2/subscriptions' : '/api/native-push/subscriptions';
  const input = { token, label: 'Synthetic device', ...(platform === 'ios' ? { platform } : {}) };
  const original: NativePushBinding = (await submit(path, input)).binding;
  const refresh = async () => (await submit(path, { ...input, bindingId: original.id,
    expectedVersion: original.version, expectedTokenRevision: original.tokenRevision })).binding as NativePushBinding;
  let resourceId: string, childId: string | null = null;
  if (kind === 'test') resourceId = (await submit(`${path}/${original.id}/test`, { expectedVersion: original.version, confirmImmediate: true })).delivery.id;
  else {
    childId = (await authority.createChild({ userId, displayName: 'Synthetic child', operationId: randomUUID() })).child.id;
    const task: CareTask = (await submit(`/api/children/${childId}/tasks`, { confirm: true, values: {
      title: 'Synthetic appointment', details: '', kind: 'appointment', assigneeUserId: userId,
      dueAt: new Date(Date.now() - 60_000).toISOString(), timeZone: 'UTC' } })).task;
    const scope = await authority.readScope(userId, childId);
    const worker = createFirestoreTaskWorker({ ...options, enabled: true,
      currentAuth: async () => ({ userId, email: 'parent@example.test', disabled: false, emailVerified: true }) });
    const reminder = (await worker.process({ kind: 'task-reminder', scope: scope.scope, taskId: task.id, taskVersion: task.version,
      occurrenceId: task.occurrence.id, authorizationVersion: scope.authorizationVersion, generation,
      scheduledAt: task.occurrence.dueAt })).receipt;
    assert.ok(reminder);
    await submit(`/api/children/${childId}/contact/consent`, { expectedVersion: 0, enabled: true, allowBackup: false, confirm: true,
      bindings: [{ channel: 'native_push', bindingId: original.id, bindingVersion: original.version }] });
    await submit(`/api/children/${childId}/contact/tasks/${task.id}/authorization`, { expectedVersion: 0, expectedTaskVersion: task.version,
      enabled: true, allowFollowUp: false, allowFallback: false, backupUserId: null, confirm: true,
      validUntil: new Date(Date.now() + 86400_000).toISOString(), content: 'generic_notice', trigger: 'task_due' });
    resourceId = reminder.id;
    // Seed only the previously authorized Agent request; eligibility and both completion transactions are real stores.
    await authority.runTransaction(userId, childId, async b => {
      const grant = data.open('contact-grant', task.id, b.scope, firestoreContactGrantSchema,
        await b.transaction.get(data.ref('contact_grants', 'contact-grant', task.id)));
      const at = new Date().toISOString(), runId = randomUUID();
      const value = firestoreContactRequestSchema.parse({ request: { id: resourceId, taskId: task.id, taskVersion: task.version,
        occurrenceId: task.occurrence.id, phase: 'initial', state: 'pending', reason: null, nextAt: at, groupedTo: null, createdAt: at, attempts: [] },
        grant, generation: b.generation, authorizationVersion: b.authorizationVersion, runId,
        reminderId: resourceId, batchId: reminder.batchId, callbackHash: null });
      const job = await prepareFirestoreBackgroundWork(data, b.transaction, { kind: 'contact', scope: b.scope, resourceId, basis: resourceId,
        generation: b.generation, authorizationVersion: b.authorizationVersion }, at);
      b.transaction.create(data.ref('contact_requests', 'contact-request', resourceId), { ...data.tags(b.scope),
        requestId: resourceId, runId, taskId: task.id, createdAt: at, attemptIds: [], unresolved: false,
        ...data.seal('contact-request', resourceId, b.scope, firestoreContactRequestSchema, value) });
      job.commit();
    });
  }
  const job = await authority.runTransaction(userId, childId, async b => {
    let query = data.collection('background_work');
    for (const [key, value] of Object.entries(data.tags(b.scope))) query = query.where(key, '==', value);
    const rows = await b.transaction.get(query.limit(20));
    for (const row of rows.docs) {
      const job = data.open('background-work', row.get('id'), b.scope, firestoreBackgroundWorkSchema, row);
      if (job.resourceId === resourceId && job.kind === (kind === 'care' ? 'contact' : 'native-push')) return job;
    }
    throw Error('Missing delivery job');
  });
  return { original, refresh, data, fake, async run() {
    const process = kind === 'care' ? contact.process : store.process;
    assert.equal((await process(job, new AbortController().signal)).state, 'completed');
    assert.equal((await process(job, new AbortController().signal)).state, 'completed');
    assert.equal(calls, 1, 'Terminal receipt must not re-send');
    const status = await store.status(userId, session, 2);
    const receipt = kind === 'care' ? (await contact.page(userId, childId!)).requests[0].attempts[0] : status.deliveries[0];
    assert.equal(receipt.status, 'rejected'); assert.equal(receipt.reason, outcome.reason);
    assert.equal(receipt.providerStatus, outcome.providerStatus);
    assert.equal('apnsInvalidatedAt' in receipt, false, 'Internal metadata must not change strict public receipt schemas');
    return status.bindings[0];
  }, setOutcome(value: NativePushSendResult) { outcome = value; }, onSend(fn: () => Promise<void>) { afterAuthorization = fn; } };
}

for (const kind of ['test', 'care'] as const) {
  test(`${kind} APNs completion preserves a successful same-token registration racing a 410`, async t => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-24T04:00:00Z') });
    const f = await fixture('ios', kind);
    f.onSend(async () => {
      const refreshed = await f.refresh();
      assert.equal(refreshed.version, f.original.version);
      assert.equal(refreshed.tokenRevision, f.original.tokenRevision + 1);
      assert.equal(refreshed.updatedAt, f.original.updatedAt, 'Revision CAS must work even within the same millisecond');
    });
    const binding = await f.run();
    assert.equal(binding.status, 'active'); assert.equal(binding.tokenRevision, f.original.tokenRevision + 1);
    assert.equal([...f.fake.records.keys()].filter(path => path.includes('native_push_tokens/')).length, 1);
  });
  test(`${kind} APNs completion ignores invalidation older than registration but expires the current invalid token`, async t => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-24T04:00:00Z') });
    const old = await fixture('ios', kind);
    old.setOutcome({ status: 'rejected', reason: 'subscription_expired', providerStatus: 410, apnsInvalidatedAt: Date.now() - 1 });
    assert.equal((await old.run()).status, 'active');
    const current = await fixture('ios', kind), binding = await current.run();
    assert.equal(binding.status, 'expired'); assert.equal(binding.version, current.original.version + 1);
    assert.equal([...current.fake.records.keys()].filter(path => path.includes('native_push_tokens/')).length, 0);
  });
  test(`${kind} APNs completion cannot invalidate from missing receipt metadata`, async t => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-24T04:00:00Z') });
    const f = await fixture('ios', kind);
    f.setOutcome({ status: 'rejected', reason: 'subscription_expired', providerStatus: 410 });
    assert.equal((await f.run()).status, 'active');
  });
  test(`${kind} FCM expiration remains compatible without APNs receipt metadata`, async t => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-24T04:00:00Z') });
    const f = await fixture('android', kind);
    assert.equal((await f.run()).status, 'expired');
  });
}
