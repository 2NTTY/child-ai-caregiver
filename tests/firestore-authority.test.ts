import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { openRecoveryEnvelope } from '../server/firestore-recovery-envelope.ts';
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
  for (const [path, envelope] of f.fake.records) {
    if (path.startsWith(f.options.namespace + '/')) {
      assert.deepEqual(Object.keys(envelope).sort(), envelope.recovery
        ? ['ciphertext', 'format', 'recovery', 'version'] : ['ciphertext', 'format', 'version']);
      if (envelope.recovery) {
        assert.deepEqual(Object.keys(envelope.recovery).sort(), ['ciphertext', 'format', 'version']);
        openRecoveryEnvelope({ ...f.options, envelope: { family: 'authority', version: envelope.version, ciphertext: envelope.ciphertext }, locator: envelope.recovery });
      }
    }
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

test('native authority binding prepares without writes and atomically commits or rolls back the domain, receipt, and change', async () => {
  const f = fixture(); await f.initialize(); await f.identity(); const child = await f.child();
  const before = [...f.fake.records.entries()], failure = new Error('Synthetic domain commit failure');
  const domain = f.database.collection('synthetic_domain').doc('record'), receipt = f.database.collection('synthetic_domain').doc('receipt');
  const operationId = randomUUID();
  await assert.rejects(f.service.runTransaction('synthetic-owner', child.child.id, async binding => {
    assert.equal(binding.scope.childId, child.child.id); assert.equal(binding.authorizationVersion, '1'); assert.equal(binding.generation, f.generation);
    const prepared = await binding.prepareChange(operationId, 'care', false);
    assert.equal(prepared.changeSeq, '2'); assert.deepEqual([...f.fake.records.entries()], before);
    assert.equal((await binding.transaction.get(domain)).exists, false); assert.equal((await binding.transaction.get(receipt)).exists, false);
    prepared.commit(); binding.transaction.create(domain, { version: 1 }); binding.transaction.create(receipt, { changeSeq: prepared.changeSeq }); throw failure;
  }), error => error === failure);
  assert.deepEqual([...f.fake.records.entries()], before);
  await f.service.runTransaction('synthetic-owner', child.child.id, async binding => {
    const prepared = await binding.prepareChange(operationId, 'care', false);
    await binding.transaction.get(domain); await binding.transaction.get(receipt);
    prepared.commit(); binding.transaction.create(domain, { version: 1 }); binding.transaction.create(receipt, { changeSeq: prepared.changeSeq });
  });
  assert.deepEqual(f.fake.records.get(domain.path), { version: 1 }); assert.deepEqual(f.fake.records.get(receipt.path), { changeSeq: '2' });
  assert.equal(f.open('workspace', child.scope.workspaceId, child.scope).changeSeq, '2');
});

test('native binding rejects duplicate preparation and commits, closes escaped closures, and does not write for reads', async () => {
  const f = fixture(); await f.initialize(); await f.identity(); const child = await f.child(), before = [...f.fake.records.entries()];
  await f.service.runTransaction('synthetic-owner', child.child.id, async binding => { assert.equal(Object.isFrozen(binding.scope), true); });
  assert.deepEqual([...f.fake.records.entries()], before);
  let escapedCommit!: () => void;
  await f.service.runTransaction('synthetic-owner', child.child.id, async binding => {
    const prepared = await binding.prepareChange(randomUUID(), 'chat', false); escapedCommit = prepared.commit;
    await assert.rejects(binding.prepareChange(randomUUID(), 'chat', false), rejected('transaction_change_conflict', 409));
    prepared.commit(); assert.throws(prepared.commit, rejected('transaction_change_conflict', 409));
  });
  const committed = [...f.fake.records.entries()]; assert.throws(escapedCommit, rejected('transaction_closed', 409));
  assert.deepEqual([...f.fake.records.entries()], committed);
  await f.service.runTransaction('synthetic-owner', null, async binding => {
    assert.equal(binding.scope.childId, '00000000-0000-0000-0000-000000000000');
    const prepared = await binding.prepareChildCreation({ operationId: randomUUID(), displayName: '準備孩子' });
    await assert.rejects(binding.prepareChange(randomUUID(), 'preferences', false), rejected('transaction_change_conflict', 409));
    assert.deepEqual([...f.fake.records.entries()], committed);
    prepared.commit(); assert.throws(prepared.commit, rejected('transaction_change_conflict', 409));
  });
  await f.service.runTransaction('synthetic-owner', child.child.id, async binding => {
    await assert.rejects(binding.prepareChildCreation({ operationId: randomUUID(), displayName: '錯誤孩子範圍' }), rejected('transaction_child_scope', 409));
  });
});

test('native callback retries get new bindings while revoked authority and cross-owner child scope reject all effects', async () => {
  const f = fixture(); await f.initialize(); await f.identity(); const child = await f.child();
  const operationId = randomUUID(); let staleCommit: (() => void) | undefined, callbacks = 0;
  f.retry();
  await f.service.runTransaction('synthetic-owner', child.child.id, async binding => {
    callbacks++;
    if (staleCommit) assert.throws(staleCommit, rejected('transaction_closed', 409));
    const prepared = await binding.prepareChange(operationId, 'memory', false); staleCommit = prepared.commit; prepared.commit();
  });
  assert.equal(callbacks, 2); assert.equal(f.open('workspace', child.scope.workspaceId, child.scope).changeSeq, '2');
  await f.identity('another-owner', 'another@example.test'); await f.service.acknowledge({ userId: 'another-owner', operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  const beforeCross = [...f.fake.records.entries()];
  await assert.rejects(f.service.runTransaction('another-owner', child.child.id, async () => { throw new Error('Cross-owner callback must not execute'); }), rejected('invalid_document', 500));
  assert.deepEqual([...f.fake.records.entries()], beforeCross);
  let attempts = 0;
  f.retry(async () => { await f.service.setAccountState({ userId: 'synthetic-owner', operationId: randomUUID(), state: 'revoked' }); });
  const domain = f.database.collection('synthetic_domain').doc('revoked');
  await assert.rejects(f.service.runTransaction('synthetic-owner', child.child.id, async binding => {
    attempts++; const prepared = await binding.prepareChange(randomUUID(), 'care', false); await binding.transaction.get(domain);
    prepared.commit(); binding.transaction.create(domain, { version: 1 });
  }), rejected('account_inactive', 403));
  assert.equal(attempts, 1); assert.equal(f.fake.records.has(domain.path), false);
  assert.equal(f.open('workspace', child.scope.workspaceId, child.scope).changeSeq, '2');
});

test('native child preparation composes with an outer domain receipt and preserves the original sequence on replay', async () => {
  const f = fixture(); await f.initialize(); await f.identity();
  await f.service.acknowledge({ userId: 'synthetic-owner', operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  const operationId = randomUUID(), outer = f.database.collection('synthetic_domain').doc('child_receipt'), before = [...f.fake.records.entries()];
  const raw = { operationId, displayName: '同交易孩子' }, failure = new Error('Synthetic outer receipt failure');
  await assert.rejects(f.service.runTransaction('synthetic-owner', null, async binding => {
    const child = await binding.prepareChildCreation(raw); assert.deepEqual([...f.fake.records.entries()], before);
    await binding.transaction.get(outer); child.commit(); binding.transaction.create(outer, { childId: child.result.child.id, changeSeq: child.changeSeq }); throw failure;
  }), error => error === failure);
  assert.deepEqual([...f.fake.records.entries()], before);
  const created = await f.service.runTransaction('synthetic-owner', null, async binding => {
    const child = await binding.prepareChildCreation(raw); await binding.transaction.get(outer);
    child.commit(); binding.transaction.create(outer, { childId: child.result.child.id, changeSeq: child.changeSeq }); return child;
  });
  assert.equal(created.changeSeq, '1'); assert.equal(f.fake.records.get(outer.path).childId, created.result.child.id);
  await f.service.runTransaction('synthetic-owner', created.result.child.id, async binding => { const change = await binding.prepareChange(randomUUID(), 'care', false); change.commit(); });
  const afterLaterChange = [...f.fake.records.entries()];
  const replay = await f.service.runTransaction('synthetic-owner', null, async binding => { const child = await binding.prepareChildCreation(raw); child.commit(); return child; });
  assert.deepEqual(replay.result, created.result); assert.equal(replay.changeSeq, '1');
  assert.deepEqual([...f.fake.records.entries()], afterLaterChange);
  assert.deepEqual(await f.service.createChild({ userId: 'synthetic-owner', ...raw }), created.result);
});

test('legacy child receipt sequences come only from the original authenticated marker and fail closed when missing', async () => {
  const f = fixture(); await f.initialize(); await f.identity();
  await f.service.acknowledge({ userId: 'synthetic-owner', operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  const raw = { userId: 'synthetic-owner', operationId: randomUUID(), displayName: '舊格式孩子' }, child = await f.service.createChild(raw);
  await f.service.runTransaction(raw.userId, child.child.id, async binding => { const change = await binding.prepareChange(randomUUID(), 'chat', false); change.commit(); });
  const key = JSON.stringify([raw.userId, null, raw.operationId]);
  const path = f.database.collection(f.options.namespace).doc(workRecoveryDocumentId('authority-operation' as WorkRecoveryKind, key)).path;
  const envelope = f.fake.records.get(path), aad = JSON.stringify(['yuban-work-recovery', 2, f.options.projectId, f.options.namespace, 'authority-operation', key, { ownerUserId: raw.userId }]);
  const legacy = JSON.parse(f.options.cipher.decrypt(envelope.ciphertext, aad)); delete legacy.changeSeq;
  f.fake.records.set(path, { ...envelope, ciphertext: f.options.cipher.encrypt(JSON.stringify(legacy), aad) });
  const before = [...f.fake.records.entries()];
  const replay = await f.service.runTransaction(raw.userId, null, async binding => { const prepared = await binding.prepareChildCreation({ operationId: raw.operationId, displayName: raw.displayName }); prepared.commit(); return prepared; });
  assert.equal(replay.changeSeq, '1'); assert.deepEqual(replay.result, child); assert.deepEqual([...f.fake.records.entries()], before);
  const wrongOwner = structuredClone(legacy); wrongOwner.result.scope.ownerUserId = 'another-owner';
  f.fake.records.set(path, { ...envelope, ciphertext: f.options.cipher.encrypt(JSON.stringify(wrongOwner), aad) });
  const corrupt = [...f.fake.records.entries()];
  await assert.rejects(f.service.createChild(raw), rejected('receipt_binding', 403));
  assert.deepEqual([...f.fake.records.entries()], corrupt);
  f.fake.records.set(path, { ...envelope, ciphertext: f.options.cipher.encrypt(JSON.stringify(legacy), aad) });
  const markerId = JSON.stringify([child.scope.workspaceId, child.scope.storageEpoch, child.scope.ownerUserId, child.scope.childId, raw.operationId, 'authority']);
  const markerPath = f.database.collection(f.options.namespace).doc(workRecoveryDocumentId('change', markerId)).path;
  f.fake.records.delete(markerPath); const missing = [...f.fake.records.entries()];
  await assert.rejects(f.service.createChild(raw), rejected('receipt_sequence_missing', 409));
  assert.deepEqual([...f.fake.records.entries()], missing);
});



test('readChild uses current canonical workspace/epoch, creation projections and deferred child-scoped change', async () => {
  const f = fixture(); await f.initialize(); await f.identity(); const created = await f.child();
  await f.service.runTransaction('synthetic-owner', null, async binding => {
    assert.deepEqual(await binding.readChild(created.child.id), created.child);
    assert.equal(await binding.readChild(randomUUID()), null);
    const before = [...f.fake.records];
    const prepared = await binding.prepareChange(randomUUID(), 'tasks', false, created.child.id);
    assert.deepEqual([...f.fake.records], before); prepared.commit();
  });
  assert.equal([...f.fake.records.keys()].filter(path => path.startsWith(f.options.namespace + '_children/')).length, 1);
  await f.service.runTransaction('synthetic-owner', created.child.id, async binding => {
    await assert.rejects(binding.prepareChange(randomUUID(), 'tasks', false, randomUUID()), rejected('transaction_child_scope', 409));
  });
  await f.identity('another-owner', 'another@example.test'); await f.service.acknowledge({ userId: 'another-owner', operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  await assert.rejects(f.service.runTransaction('another-owner', null, binding => binding.readChild(created.child.id)));
});


test('canonical writers preserve ordinary reads and record authenticated recovery bindings without original request input', async () => {
  const f = fixture(); await f.initialize(); await f.identity(); const child = await f.child();
  let recovered = 0;
  for (const [path, envelope] of f.fake.records) {
    if (!path.startsWith(f.options.namespace + '/')) continue;
    assert.ok(envelope.recovery, 'every canonical writer records its encrypted recovery locator');
    const opened = openRecoveryEnvelope({ ...f.options, envelope: { family: 'authority', version: envelope.version, ciphertext: envelope.ciphertext }, locator: envelope.recovery });
    const id = createHash('sha256').update(JSON.stringify([opened.context.kind, opened.context.id])).digest('hex');
    assert.equal(path, f.options.namespace + '/' + id);
    assert.equal(typeof opened.value, 'object'); recovered++;
  }
  assert.ok(recovered >= 8);
  assert.deepEqual((await f.service.readScope('synthetic-owner', child.child.id)).scope, child.scope);
  assert.equal((await f.service.accountStatus('synthetic-owner')).user?.acknowledged, true);
});
