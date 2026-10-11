import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Firestore } from '@google-cloud/firestore';
import { createFirestoreAuthority, FirestoreAuthorityError, type FirestoreAuthorityScope } from '../server/firestore-authority.ts';
import { FirestoreWorkContinuationStore } from '../server/firestore-work-continuation-store.ts';
import { workRecoveryAad, workRecoveryDocumentId, type WorkRecoveryKind, type WorkRecoveryScope } from '../server/firestore-work-continuation-recovery.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import type { AgentWorkValues } from '../src/shared/agent-work.ts';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';

function fixture() {
  const fake = serialFirestoreFixture(), original = fake.database.runTransaction.bind(fake.database);
  let discarded = false, lost = false, onRetry: (() => Promise<void>) | undefined;
  const discardedResults: unknown[] = [];
  const database = { collection: fake.database.collection.bind(fake.database),
    async runTransaction(callback: any, options: any) {
      if (discarded) {
        discarded = false; const sentinel = new Error('Synthetic discarded callback');
        await assert.rejects(original(async tx => { discardedResults.push(await callback(tx)); throw sentinel; }, options), error => error === sentinel);
        const hook = onRetry; onRetry = undefined; await hook?.();
      }
      const result = await original(callback, options);
      if (lost) { lost = false; throw new Error('Synthetic lost commit acknowledgement'); }
      return result;
    } } as unknown as Firestore;
  let now = Date.parse('2026-10-11T10:00:00Z');
  const options = { database, cipher: createStorageCipher(Buffer.alloc(32, 91)), projectId: 'synthetic-authority-project',
    namespace: 'synthetic_canonical_authority', serverClock: () => now };
  const service = createFirestoreAuthority(options), generation = randomUUID();
  const values = (): AgentWorkValues => ({ goal: 'Private synthetic follow-up', focus: '', questions: [], sourceMessageIds: [],
    resources: [], pending: [], status: 'active', followUp: { reason: 'Synthetic due', dueAt: new Date(now - 1000).toISOString(), watchResources: false, knowledgeSourceIds: [] } });
  const open = (kind: WorkRecoveryKind, id: string, scope: WorkRecoveryScope) => {
    const envelope = fake.records.get(database.collection(options.namespace).doc(workRecoveryDocumentId(kind, id)).path);
    return envelope && JSON.parse(options.cipher.decrypt(envelope.ciphertext, workRecoveryAad(options.projectId, options.namespace, kind, id, scope)));
  };
  async function initialize() { await service.initializeControl({ generation, enabled: true }); }
  async function identity(userId = 'synthetic-owner', email = 'owner@example.test', emailVerified = true) {
    await service.issueInvitation({ email, expiresAt: new Date(now + 100_000).toISOString(), operationId: randomUUID() });
    return service.admitIdentity({ userId, email, emailVerified });
  }
  async function child(userId = 'synthetic-owner') {
    await service.acknowledge({ userId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
    return service.createChild({ userId, operationId: randomUUID(), displayName: '合成孩子' });
  }
  async function prepared() {
    await initialize(); await identity(); const created = await child();
    const scope: FirestoreAuthorityScope = { ...created.scope, authorizationVersion: created.authorizationVersion };
    const work = await service.saveWork({ scope, operationId: randomUUID(), expectedVersion: 0, values: values() });
    const continuation = new FirestoreWorkContinuationStore({ ...options, scope: created.scope });
    const job = await continuation.enqueueDue({ workerGeneration: generation, workIds: [work.id] }); assert.ok(job);
    const admission = await continuation.beginBackground(job); assert.equal(admission.decision, 'execute');
    if (admission.decision !== 'execute') throw new Error('Synthetic execution claim missing');
    return { created, scope, work, continuation, job, admission };
  }
  return { fake, database, options, service, generation, values, open, initialize, identity, child, prepared, discardedResults,
    retry(hook?: () => Promise<void>) { discarded = true; onRetry = hook; }, loseReply() { lost = true; }, setNow(value: number) { now = value; }, now: () => now };
}
const rejected = (code: string, status?: number) => (error: unknown) => error instanceof FirestoreAuthorityError
  && error.code === code && (status === undefined || error.status === status)
  && !error.message.includes('Private') && !error.message.includes('@');

test('empty canonical authority admits identity and consent, creates child/work, and feeds the real due consumer without seeding', async () => {
  const f = fixture(); assert.equal(f.fake.records.size, 0); await f.initialize();
  assert.deepEqual(await f.service.accountStatus(null), { enabled: true, registration: 'invite', policyVersion: SERVICE_POLICY_VERSION,
    notice: (await f.service.accountStatus(null)).notice, user: null });
  await assert.rejects(f.service.initializeControl({ generation: randomUUID(), enabled: true }), rejected('control_conflict', 409));
  await assert.rejects(f.service.initializeControl({ generation: f.generation, enabled: false }), rejected('control_conflict', 409));
  const invitation = { email: 'OWNER@example.test', expiresAt: new Date(f.now() + 100_000).toISOString(), operationId: randomUUID() };
  await f.service.issueInvitation(invitation); const count = f.fake.records.size;
  await f.service.assertCanRegister('owner@example.test'); assert.equal(f.fake.records.size, count);
  const pending = await f.service.admitIdentity({ userId: 'synthetic-owner', email: invitation.email, emailVerified: false });
  await f.service.assertSessionAdmission('synthetic-owner');
  assert.equal((await f.service.accountStatus('synthetic-owner')).user?.acknowledged, false);
  await assert.rejects(f.service.acknowledge({ userId: 'synthetic-owner', operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION }), rejected('email_not_verified', 403));
  await assert.rejects(f.service.createChild({ userId: 'synthetic-owner', operationId: randomUUID(), displayName: '合成孩子' }), rejected('account_not_ready', 403));
  const admitted = await f.service.admitIdentity({ userId: 'synthetic-owner', email: 'owner@example.test', emailVerified: true });
  assert.equal(admitted.workspaceId, pending.workspaceId); assert.equal(admitted.storageEpoch, pending.storageEpoch);
  await assert.rejects(f.service.acknowledge({ userId: 'synthetic-owner', operationId: randomUUID(), policyVersion: 'old-policy' }), rejected('invalid_input', 400));
  const created = await f.child(), scope = { ...created.scope, authorizationVersion: created.authorizationVersion };
  assert.equal(created.child.displayName, '合成孩子'); assert.equal(created.child.accessRole, 'owner');
  assert.deepEqual(await f.service.readScope('synthetic-owner', created.child.id), { scope: created.scope, authorizationVersion: '1' });
  const work = await f.service.saveWork({ scope, operationId: randomUUID(), expectedVersion: 0, values: f.values() });
  assert.equal(work.version, 1); assert.equal(work.createdAt, work.updatedAt);
  assert.equal(f.open('workspace', scope.workspaceId, created.scope).changeSeq, '2');
  assert.equal(f.fake.records.has(f.database.collection(f.options.namespace).doc(workRecoveryDocumentId('run', work.id)).path), false);
  const continuation = new FirestoreWorkContinuationStore({ ...f.options, scope: created.scope });
  const job = await continuation.enqueueDue({ workerGeneration: f.generation, workIds: [work.id] }); assert.ok(job);
  const admission = await continuation.beginBackground(job); assert.equal(admission.decision, 'execute');
  if (admission.decision !== 'execute') throw new Error('Synthetic execution claim missing');
  assert.equal(await continuation.authorizeBackground(job, admission.claim), true);
  assert.equal((await continuation.readWork(job, admission.claim, work.id))?.items[0]?.goal, work.goal);
  assert.deepEqual(await continuation.beginBackground(job), { decision: 'lookup', runId: admission.claim.runId });
  for (const envelope of f.fake.records.values()) {
    assert.deepEqual(Object.keys(envelope).sort(), ['ciphertext', 'format', 'version']);
    assert.equal(JSON.stringify(envelope).includes('合成孩子'), false); assert.equal(JSON.stringify(envelope).includes('owner@example'), false);
  }
});

test('operation receipts preserve original child/work results and reject different payload or action without writes', async () => {
  const f = fixture(); await f.initialize(); await f.identity();
  await f.service.acknowledge({ userId: 'synthetic-owner', operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  const create = { userId: 'synthetic-owner', operationId: randomUUID(), displayName: '  同一孩子  ' };
  const created = await f.service.createChild(create), size = f.fake.records.size;
  assert.deepEqual(await f.service.createChild(create), created); assert.equal(f.fake.records.size, size);
  await assert.rejects(f.service.createChild({ ...create, displayName: '另一孩子' }), rejected('operation_conflict', 409));
  const scope = { ...created.scope, authorizationVersion: created.authorizationVersion };
  const save = { scope, operationId: randomUUID(), expectedVersion: 0, values: f.values() }, first = await f.service.saveWork(save);
  assert.deepEqual(await f.service.saveWork(save), first);
  const before = [...f.fake.records.entries()];
  await assert.rejects(f.service.saveWork({ ...save, values: { ...save.values, goal: 'Different private request' } }), rejected('operation_conflict', 409));
  await assert.rejects(f.service.cancelWork({ scope, operationId: save.operationId, workId: first.id, expectedVersion: 1 }), rejected('operation_conflict', 409));
  assert.deepEqual([...f.fake.records.entries()], before);
  const update = await f.service.saveWork({ scope, operationId: randomUUID(), workId: first.id, expectedVersion: 1, values: { ...f.values(), focus: 'Updated' } });
  assert.equal(update.version, 2); assert.equal(update.createdAt, first.createdAt);
  await assert.rejects(f.service.saveWork({ scope, operationId: randomUUID(), workId: first.id, expectedVersion: 1, values: f.values() }), rejected('version_conflict', 409));
  assert.deepEqual(await f.service.saveWork(save), first);
  assert.equal(f.open('work', first.id, created.scope).version, 2);
});

test('owner and child scoped operation identities isolate identical operation IDs and reject cross-owner reads/writes', async () => {
  const f = fixture(); await f.initialize(); await f.identity(); await f.identity('second-owner', 'second@example.test');
  const first = await f.child(), second = await f.child('second-owner');
  const operationId = randomUUID(), firstScope = { ...first.scope, authorizationVersion: first.authorizationVersion };
  const secondScope = { ...second.scope, authorizationVersion: second.authorizationVersion };
  const a = await f.service.saveWork({ scope: firstScope, operationId, expectedVersion: 0, values: f.values() });
  const b = await f.service.saveWork({ scope: secondScope, operationId, expectedVersion: 0, values: f.values() });
  assert.notEqual(a.id, b.id);
  const another = await f.service.createChild({ userId: 'synthetic-owner', operationId: randomUUID(), displayName: '另一合成孩子' });
  const c = await f.service.saveWork({ scope: { ...another.scope, authorizationVersion: another.authorizationVersion }, operationId, expectedVersion: 0, values: f.values() });
  assert.notEqual(a.id, c.id);
  const before = [...f.fake.records.entries()];
  await assert.rejects(f.service.readScope('second-owner', first.child.id), rejected('invalid_document', 500));
  await assert.rejects(f.service.saveWork({ scope: { ...firstScope, ownerUserId: 'second-owner' }, operationId: randomUUID(), expectedVersion: 0, values: f.values() }), rejected('scope_changed', 409));
  await assert.rejects(f.service.saveWork({ scope: secondScope, operationId: randomUUID(), workId: a.id, expectedVersion: 1, values: f.values() }), rejected('invalid_document', 500));
  assert.deepEqual([...f.fake.records.entries()], before);
});

test('revoking a consumed invitation immediately closes canonical account and the in-flight consumer', async () => {
  const f = fixture(), p = await f.prepared(); assert.equal(await p.continuation.authorizeBackground(p.job, p.admission.claim), true);
  const input = { email: 'owner@example.test', operationId: randomUUID() };
  const revoked = await f.service.revokeInvitation(input), count = f.fake.records.size;
  assert.deepEqual(await f.service.revokeInvitation(input), revoked); assert.equal(f.fake.records.size, count);
  assert.equal(f.open('account', 'synthetic-owner', p.created.scope).admitted, false);
  await assert.rejects(p.continuation.authorizeBackground(p.job, p.admission.claim), /work_continuation_authority/);
  await assert.rejects(f.service.assertSessionAdmission('synthetic-owner'), rejected('account_inactive', 403));
  await assert.rejects(f.service.saveWork({ scope: p.scope, operationId: randomUUID(), expectedVersion: 0, values: f.values() }), rejected('account_inactive', 403));
  await assert.rejects(f.service.admitIdentity({ userId: 'synthetic-owner', email: 'owner@example.test', emailVerified: true }), rejected('account_inactive', 403));
  await assert.rejects(f.service.issueInvitation({ email: 'owner@example.test', operationId: randomUUID(), expiresAt: new Date(f.now() + 100_000).toISOString() }), rejected('invitation_closed', 403));
});

test('cancelled work closes follow-up immediately and preserves the original receipt without reopening the work', async () => {
  const f = fixture(), p = await f.prepared();
  const input = { scope: p.scope, operationId: randomUUID(), workId: p.work.id, expectedVersion: 1 };
  const cancelled = await f.service.cancelWork(input); assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.version, 2);
  const count = f.fake.records.size; assert.deepEqual(await f.service.cancelWork(input), cancelled); assert.equal(f.fake.records.size, count);
  assert.equal(f.open('followup', p.work.id, p.created.scope).enabled, false);
  assert.equal(await p.continuation.authorizeBackground(p.job, p.admission.claim), false);
  assert.equal(await p.continuation.readWork(p.job, p.admission.claim, p.work.id), null);
  assert.deepEqual(await p.continuation.recoverBackground(p.job), { state: 'settled', runId: p.admission.claim.runId });
  await assert.rejects(f.service.saveWork({ scope: p.scope, operationId: randomUUID(), workId: p.work.id, expectedVersion: 2, values: f.values() }), rejected('work_cancelled', 409));
});

test('trusted lifecycle closure has no active recovery path and fences the existing consumer', async () => {
  for (const state of ['revoked', 'deleting', 'deleted'] as const) {
    const f = fixture(), p = await f.prepared(), input = { userId: 'synthetic-owner', operationId: randomUUID(), state };
    assert.deepEqual(await f.service.setAccountState(input), { state }); assert.deepEqual(await f.service.setAccountState(input), { state });
    await assert.rejects(p.continuation.authorizeBackground(p.job, p.admission.claim), /work_continuation_authority/);
    await assert.rejects(f.service.admitIdentity({ userId: 'synthetic-owner', email: 'replacement@example.test', emailVerified: true }), rejected('account_inactive', 403));
    assert.equal(f.open('account', 'synthetic-owner', p.created.scope).invitationLive, false);
  }
});

test('discarded callbacks never expose tentative effects and recheck invitation revocation before admission', async () => {
  const f = fixture(); await f.initialize();
  f.retry(); await f.service.issueInvitation({ email: 'owner@example.test', operationId: randomUUID(), expiresAt: new Date(f.now() + 100_000).toISOString() });
  f.retry(); const admitted = await f.service.admitIdentity({ userId: 'synthetic-owner', email: 'owner@example.test', emailVerified: true });
  assert.deepEqual(f.discardedResults.at(-1), admitted);
  await f.service.acknowledge({ userId: 'synthetic-owner', operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  f.retry(); const created = await f.service.createChild({ userId: 'synthetic-owner', operationId: randomUUID(), displayName: '合成孩子' });
  assert.deepEqual(f.discardedResults.at(-1), created);
  const scope = { ...created.scope, authorizationVersion: created.authorizationVersion };
  f.retry(); const work = await f.service.saveWork({ scope, operationId: randomUUID(), expectedVersion: 0, values: f.values() });
  assert.deepEqual(f.discardedResults.at(-1), work); assert.equal(f.open('workspace', scope.workspaceId, created.scope).changeSeq, '2');
  await f.service.issueInvitation({ email: 'race@example.test', operationId: randomUUID(), expiresAt: new Date(f.now() + 100_000).toISOString() });
  f.retry(async () => { await f.service.revokeInvitation({ email: 'race@example.test', operationId: randomUUID() }); });
  await assert.rejects(f.service.admitIdentity({ userId: 'race-owner', email: 'race@example.test', emailVerified: true }), rejected('invitation_unavailable', 403));
  assert.equal(f.fake.records.has(f.database.collection(f.options.namespace).doc(workRecoveryDocumentId('account', 'race-owner')).path), false);
});

test('lost commit acknowledgements recover original identity, child/work/cancellation results with no duplicate effects', async () => {
  const f = fixture(); f.loseReply(); await assert.rejects(f.initialize(), /Synthetic lost commit acknowledgement/); await f.initialize();
  const invitation = { email: 'owner@example.test', expiresAt: new Date(f.now() + 100_000).toISOString(), operationId: randomUUID() };
  f.loseReply(); await assert.rejects(f.service.issueInvitation(invitation), /Synthetic lost commit acknowledgement/); await f.service.issueInvitation(invitation);
  const identity = { userId: 'synthetic-owner', email: invitation.email, emailVerified: true };
  f.loseReply(); await assert.rejects(f.service.admitIdentity(identity), /Synthetic lost commit acknowledgement/);
  const beforeIdentity = f.fake.records.size, admitted = await f.service.admitIdentity(identity); assert.equal(f.fake.records.size, beforeIdentity);
  await f.service.acknowledge({ userId: identity.userId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  const childInput = { userId: identity.userId, operationId: randomUUID(), displayName: '合成孩子' };
  f.loseReply(); await assert.rejects(f.service.createChild(childInput), /Synthetic lost commit acknowledgement/);
  const count = f.fake.records.size, created = await f.service.createChild(childInput); assert.equal(f.fake.records.size, count);
  assert.equal(created.scope.workspaceId, admitted.workspaceId);
  const scope = { ...created.scope, authorizationVersion: created.authorizationVersion };
  const save = { scope, operationId: randomUUID(), expectedVersion: 0, values: f.values() };
  f.loseReply(); await assert.rejects(f.service.saveWork(save), /Synthetic lost commit acknowledgement/);
  const countAfterSave = f.fake.records.size, work = await f.service.saveWork(save); assert.equal(f.fake.records.size, countAfterSave);
  assert.equal(f.open('workspace', scope.workspaceId, created.scope).changeSeq, '2');
  const cancel = { scope, operationId: randomUUID(), workId: work.id, expectedVersion: 1 };
  f.loseReply(); await assert.rejects(f.service.cancelWork(cancel), /Synthetic lost commit acknowledgement/);
  const countAfterCancel = f.fake.records.size, cancelled = await f.service.cancelWork(cancel); assert.equal(f.fake.records.size, countAfterCancel);
  assert.equal(cancelled.version, 2); assert.equal(f.open('workspace', scope.workspaceId, created.scope).changeSeq, '3');
});

test('email changes cannot consume a second invitation and unsupported references/watch features are explicit zero-write failures', async () => {
  const f = fixture(); await f.initialize(); await f.identity();
  await f.service.issueInvitation({ email: 'replacement@example.test', operationId: randomUUID(), expiresAt: new Date(f.now() + 100_000).toISOString() });
  await assert.rejects(f.service.admitIdentity({ userId: 'synthetic-owner', email: 'replacement@example.test', emailVerified: true }), rejected('identity_email_changed', 403));
  await f.service.assertCanRegister('replacement@example.test');
  const created = await f.child(), scope = { ...created.scope, authorizationVersion: created.authorizationVersion }, base = f.values();
  const unsupported: AgentWorkValues[] = [
    { ...base, sourceMessageIds: [randomUUID()] }, { ...base, resources: [{ kind: 'memory_fact', id: randomUUID(), version: 1 }] },
    { ...base, pending: [{ runId: randomUUID(), proposalId: randomUUID(), version: 1 }] },
    { ...base, followUp: { ...base.followUp!, watchResources: true } },
    { ...base, followUp: { ...base.followUp!, knowledgeSourceIds: ['synthetic-source'] } }, { ...base, followUp: null },
  ];
  const before = [...f.fake.records.entries()];
  for (const values of unsupported)
    await assert.rejects(f.service.saveWork({ scope, operationId: randomUUID(), expectedVersion: 0, values }), rejected('unsupported_work', 422));
  await assert.rejects(f.service.saveWork({ scope: { ...scope, authorizationVersion: '2' }, operationId: randomUUID(), expectedVersion: 0, values: base }), rejected('scope_changed', 409));
  await assert.rejects(f.service.saveWork({ scope: { ...scope, storageEpoch: randomUUID() }, operationId: randomUUID(), expectedVersion: 0, values: base }), rejected('scope_changed', 409));
  assert.deepEqual([...f.fake.records.entries()], before);
});

test('trusted current verification synchronizes the canonical account and fences business writes without reopening inactive identities', async () => {
  const f = fixture(); await f.initialize(); await f.identity(); const created = await f.child();
  const scope = { ...created.scope, authorizationVersion: created.authorizationVersion };
  const work = await f.service.saveWork({ scope, operationId: randomUUID(), expectedVersion: 0, values: f.values() });
  assert.equal((await f.service.accountStatus('synthetic-owner')).user?.emailVerified, true);
  const beforeSync = [...f.fake.records.entries()], accountPath = f.database.collection(f.options.namespace).doc(workRecoveryDocumentId('account', 'synthetic-owner')).path;
  await f.service.assertSessionAdmission('synthetic-owner', { email: ' OWNER@example.test ', emailVerified: false });
  assert.equal((await f.service.accountStatus('synthetic-owner')).user?.emailVerified, false);
  assert.deepEqual([...f.fake.records.entries()].filter(([path]) => path !== accountPath), beforeSync.filter(([path]) => path !== accountPath));
  await f.service.assertSessionAdmission('synthetic-owner');
  const whileUnverified = [...f.fake.records.entries()];
  await f.service.assertSessionAdmission('synthetic-owner', { email: 'owner@example.test', emailVerified: false });
  await assert.rejects(f.service.acknowledge({ userId: 'synthetic-owner', operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION }), rejected('email_not_verified', 403));
  await assert.rejects(f.service.createChild({ userId: 'synthetic-owner', operationId: randomUUID(), displayName: '拒絕未驗身份' }), rejected('account_not_ready', 403));
  await assert.rejects(f.service.saveWork({ scope, operationId: randomUUID(), workId: work.id, expectedVersion: 1, values: f.values() }), rejected('account_not_ready', 403));
  assert.deepEqual([...f.fake.records.entries()], whileUnverified);
  await assert.rejects(f.service.assertSessionAdmission('synthetic-owner', { email: 'replacement@example.test', emailVerified: true }), rejected('identity_email_changed', 403));
  assert.deepEqual([...f.fake.records.entries()], whileUnverified);
  await f.service.assertSessionAdmission('synthetic-owner', { email: 'owner@example.test', emailVerified: true });
  assert.equal((await f.service.accountStatus('synthetic-owner')).user?.emailVerified, true);
  const resumed = await f.service.saveWork({ scope, operationId: randomUUID(), workId: work.id, expectedVersion: 1, values: f.values() });
  assert.equal(resumed.version, 2);
  for (const state of ['revoked', 'deleted'] as const) {
    await f.service.setAccountState({ userId: 'synthetic-owner', operationId: randomUUID(), state });
    const closed = [...f.fake.records.entries()];
    await assert.rejects(f.service.assertSessionAdmission('synthetic-owner', { email: 'owner@example.test', emailVerified: true }), rejected('account_inactive', 403));
    assert.deepEqual([...f.fake.records.entries()], closed);
  }
  const empty = fixture(); await empty.initialize(); const unadmitted = [...empty.fake.records.entries()];
  await assert.rejects(empty.service.assertSessionAdmission('unknown-owner', { email: 'unknown@example.test', emailVerified: true }), rejected('not_found', 404));
  assert.deepEqual([...empty.fake.records.entries()], unadmitted);
});
