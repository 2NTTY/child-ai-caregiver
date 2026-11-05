import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { privateSummaryRootFixture as fixture } from './helpers/private-summary-root.ts';

async function start(f: Awaited<ReturnType<typeof fixture>>) {
  await f.barrier(); const started = await f.store().start('owner', f.childId, { kind: 'next_fresh' });
  assert.equal(started.kind, 'created'); if (started.kind !== 'created') throw new Error('Expected work'); return started.work;
}

test('root binding requires an actual persisted profile and stores the exact original binder context once without opening budgets', async () => {
  const f = await fixture(), work = await start(f);
  await f.withWorkLease(work.id, async reference => {
    const claimed = await f.store().claimPart('owner', f.childId, work.id, reference); assert.equal(claimed.decision, 'execute');
    const original = f.context(claimed.claim), bind = () => f.store().bindRootContext(claimed.claim.scope, claimed.claim.runId, claimed.attempt.id, original);
    await assert.rejects(bind());
    await f.saveProfile(work.grantRecordId);
    await assert.rejects(f.build({ resolveInitial: f.policy.resolveInitial, readLegacyAdmission: f.policy.readLegacyAdmission })
      .bindRootContext(claimed.claim.scope, claimed.claim.runId, claimed.attempt.id, original));
    f.fake.retry(); await bind();
    assert.deepEqual((await f.store().readAttempt('owner', f.childId, claimed.attempt.id)).rootContext, original);
    const snapshot = JSON.stringify([...f.fake.records]); await bind(); assert.equal(JSON.stringify([...f.fake.records]), snapshot);
    await assert.rejects(f.root.read(original), { code: 'root_not_found' });
    assert.equal([...f.fake.records.keys()].some(key => key.startsWith('synthetic_summary_daily/')), false);
  });
});

test('root binding validates original scope, full worker/config suffixes, limits and deadline rather than matching prefixes', async () => {
  const f = await fixture(), work = await start(f); await f.saveProfile(work.grantRecordId);
  await f.withWorkLease(work.id, async reference => {
    const claimed = await f.store().claimPart('owner', f.childId, work.id, reference); assert.equal(claimed.decision, 'execute');
    const original = f.context(claimed.claim), binding = original.binding;
    const bad = [ { ...original, generation: original.generation + 1 },
      ...[{ rootRunId: randomUUID() }, { ownerId: 'another' }, { childId: randomUUID() }, { authorizationVersion: '999' },
        { storageEpoch: randomUUID() }, { workflowVersion: f.profile.workflowVersion }, { settingsVersion: f.profile.settingsVersion },
        { billingVersion: 'other' }, { promptPackVersion: 'other' }, { trigger: { kind: 'worker', reference: randomUUID() } },
        { deadlineAtMs: Date.parse(claimed.claim.expiresAt) + 1 }, { limits: { ...binding.limits, modelCalls: binding.limits.modelCalls + 1 } }]
        .map(change => ({ ...original, binding: { ...binding, ...change } })) ];
    for (const context of bad) await assert.rejects(f.store().bindRootContext(claimed.claim.scope, claimed.claim.runId, claimed.attempt.id, context));
    assert.equal((await f.store().readAttempt('owner', f.childId, claimed.attempt.id)).rootContext, null);
    await f.chat.createUserMessageForUser('owner', f.childId, 'Unrelated appended message does not reset original binding');
    await f.store().bindRootContext(claimed.claim.scope, claimed.claim.runId, claimed.attempt.id, original);
    await assert.rejects(f.store().bindRootContext({ ...claimed.claim.scope, authorizationVersion: '999' }, claimed.claim.runId, claimed.attempt.id, original));
    await assert.rejects(f.store().bindRootContext(claimed.claim.scope, claimed.claim.runId, claimed.attempt.id,
      { ...original, binding: { ...binding, deadlineAtMs: binding.deadlineAtMs - 1 } }));
  });
});

test('root-context bind abort and lost acknowledgement recover only the original immutable context', async () => {
  const f = await fixture(), work = await start(f); await f.saveProfile(work.grantRecordId);
  await f.withWorkLease(work.id, async reference => {
    const claimed = await f.store().claimPart('owner', f.childId, work.id, reference); assert.equal(claimed.decision, 'execute');
    const original = f.context(claimed.claim), bind = () => f.store().bindRootContext(claimed.claim.scope, claimed.claim.runId, claimed.attempt.id, original);
    const before = JSON.stringify([...f.fake.records]); f.fake.failCommit(); await assert.rejects(bind(), /Synthetic transaction commit failed/u);
    assert.equal(JSON.stringify([...f.fake.records]), before);
    f.fake.loseReply(); await assert.rejects(bind(), /Synthetic lost commit acknowledgement/u);
    assert.deepEqual((await f.store().readAttempt('owner', f.childId, claimed.attempt.id)).rootContext, original);
    const after = JSON.stringify([...f.fake.records]); await bind(); assert.equal(JSON.stringify([...f.fake.records]), after);
    await f.saveProfile(work.grantRecordId, { ...f.profile, billingVersion: 'revoked-profile-version' });
    await assert.rejects(bind());
  });
});
