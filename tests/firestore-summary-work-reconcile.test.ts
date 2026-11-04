import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { privateSummaryPolicyFixture as fixture } from './helpers/private-summary-policy.ts';
import { createFirestorePrivateSummaryWork } from '../server/firestore-private-summary-work.ts';
import { firestoreAgentRunSchema } from '../server/firestore-agent-runs.ts';

const start = async (f: Awaited<ReturnType<typeof fixture>>) => {
  await f.barrier(); const result = await f.build().start('owner', f.childId, { kind: 'next_fresh' });
  assert.equal(result.kind, 'created'); if (result.kind !== 'created') throw new Error('Expected work'); return result.work;
};

test('ready work atomically reconciles authoritative interactive coverage without granting execution or inventing fragment progress', async () => {
  const f = await fixture(), work = await start(f); await f.saveAll();
  await f.withWorkLease(work.id, async reference => {
    await assert.rejects(f.build().claimPart('owner', f.childId, work.id, randomUUID()));
    const before = await f.build().readState('owner', f.childId, work.id); f.fake.retry();
    const reconciled = await f.build().claimPart('owner', f.childId, work.id, reference);
    assert.equal(reconciled.decision, 'lookup'); assert.equal(reconciled.claim.state, 'completed');
    assert.equal(reconciled.attempt.state, 'committed');
    assert.deepEqual(reconciled.attempt.receipt, { kind: 'superseded', reason: 'already_covered', workId: work.id,
      sourceRevision: 1, attemptId: reconciled.attempt.id });
    for (const field of ['plan', 'rootContext', 'modelReservationId', 'resultText', 'chainLink'] as const) assert.equal(reconciled.attempt[field], null);
    const after = await f.build().readState('owner', f.childId, work.id);
    assert.equal(after.work.state, 'completed'); assert.equal(after.work.activeAttemptId, null);
    assert.deepEqual(after.work.finalReceipt, reconciled.attempt.receipt);
    assert.deepEqual(after.work.chain, before.work.chain); assert.deepEqual(after.work.accumulator, before.work.accumulator);
    assert.deepEqual(after.usage, before.usage); assert.deepEqual(after.grant, before.grant); assert.deepEqual(after.revision, before.revision);
    await f.authority.runTransaction('owner', f.childId, async b => {
      const run = await f.runs.read(b, reconciled.claim.runId);
      assert.equal(run.state, 'completed'); assert.equal(run.result?.outcome, 'no_action'); assert.equal(run.result?.countsKnown, true);
      assert.deepEqual(run.result?.counts, { modelCalls: 0, toolCalls: 0, queryEmbeddings: 0 }); assert.deepEqual(run.result?.tools, []);
      assert.deepEqual(run.summaryEffect, reconciled.attempt.receipt);
      assert.equal(firestoreAgentRunSchema.safeParse({ ...run, summaryEffect: { ...run.summaryEffect!, attemptId: randomUUID() } }).success, false);
      assert.equal(firestoreAgentRunSchema.safeParse({ ...run, state: 'running' }).success, false);
      const { summaryWork: _binding, ...missingBinding } = run;
      assert.equal(firestoreAgentRunSchema.safeParse(missingBinding).success, false);
    });
    const sealed = JSON.stringify([...f.fake.records]);
    const duplicate = await f.build().claimPart('owner', f.childId, work.id, reference);
    assert.equal(duplicate.decision, 'lookup'); assert.deepEqual(duplicate.attempt, reconciled.attempt);
    assert.equal(duplicate.claim.runId, reconciled.claim.runId); assert.equal(JSON.stringify([...f.fake.records]), sealed);
    assert.equal([...f.fake.records.keys()].some(key => /root_budget|ai_usage/u.test(key)), false);
  });
});

test('zero-dispatch reconciliation survives callback abort and lost acknowledgement with one original receipt', async () => {
  const f = await fixture(), work = await start(f); await f.saveAll();
  await f.withWorkLease(work.id, async reference => {
    const before = JSON.stringify([...f.fake.records]); f.fake.failCommit();
    await assert.rejects(f.build().claimPart('owner', f.childId, work.id, reference), /Synthetic transaction commit failed/u);
    assert.equal(JSON.stringify([...f.fake.records]), before);
    let returned = false; f.fake.loseReply();
    await assert.rejects((async () => { await f.build().claimPart('owner', f.childId, work.id, reference); returned = true; })(), /Synthetic lost commit acknowledgement/u);
    assert.equal(returned, false);
    const state = await f.build().readState('owner', f.childId, work.id); assert.equal(state.work.state, 'completed');
    const result = await f.build().claimPart('owner', f.childId, work.id, reference);
    assert.equal(result.decision, 'lookup'); assert.deepEqual(result.attempt.receipt, state.work.finalReceipt);
    assert.equal([...f.fake.records.keys()].filter(key => key.includes('_agent_runs/')).length, 1);
  });
});

test('expired grant cannot prevent zero-dispatch coverage reconciliation and cannot reset its account', async () => {
  const f = await fixture(), deadline = Date.now() + 60000; f.grant.workDeadlineAt = new Date(deadline).toISOString();
  const work = await start(f); await f.saveAll();
  const store = createFirestorePrivateSummaryWork({ ...f.options, memory: f.memory, policy: f.policy, runs: f.runs, serverClock: () => deadline + 1 });
  await f.withWorkLease(work.id, async reference => {
    const result = await store.claimPart('owner', f.childId, work.id, reference);
    assert.equal(result.decision, 'lookup'); assert.equal(result.claim.state, 'completed');
    const state = await store.readState('owner', f.childId, work.id);
    assert.equal(state.grant.id, work.grantRecordId); assert.equal(f.resolutions(), 1); assert.deepEqual(state.usage.used, { modelCalls: 0, toolCalls: 0 });
  });
});

test('already active execution stays original lookup rather than acquiring a false zero-dispatch receipt', async () => {
  const f = await fixture(), work = await start(f);
  await f.withWorkLease(work.id, async reference => {
    const claimed = await f.build().claimPart('owner', f.childId, work.id, reference); assert.equal(claimed.decision, 'execute');
    await f.saveAll(); const result = await f.build().claimPart('owner', f.childId, work.id, reference);
    assert.equal(result.decision, 'lookup'); assert.deepEqual(result.attempt, claimed.attempt); assert.equal(result.attempt.receipt, null);
    assert.equal((await f.build().readState('owner', f.childId, work.id)).work.state, 'executing');
  });
});

test('source change and suppression before dispatch persist original-work state without a model claim or new grant', async () => {
  for (const mutation of ['revise', 'delete'] as const) {
    const f = await fixture(), values = { key: 'Synthetic preference', content: 'Original', source: { kind: 'manual' as const, description: 'Synthetic' }, validUntil: null };
    const candidate = (await f.memory.createFact('owner', f.childId, { values, intendedVisibility: 'private' }))!;
    const fact = (await f.memory.confirmFact('owner', f.childId, candidate.id, { expectedVersion: 1, confirm: true, confirmShared: false }))!;
    const work = await start(f), before = await f.build().readState('owner', f.childId, work.id);
    if (mutation === 'delete') await f.memory.delete('owner', f.childId, 'facts', fact.id, fact.version);
    else await f.memory.reviseFact('owner', f.childId, fact.id, { expectedVersion: fact.version, confirm: true,
      confirmShared: false, values: { ...values, content: 'Changed' }, reason: 'Synthetic change' });
    await f.withWorkLease(work.id, async reference => {
      const result = await f.build().claimPart('owner', f.childId, work.id, reference);
      assert.equal(result.decision, 'blocked');
      const after = await f.build().readState('owner', f.childId, work.id);
      assert.equal(after.work.state, mutation === 'delete' ? 'suppressed' : 'invalidated'); assert.equal(after.work.activeAttemptId, null);
      assert.deepEqual(after.grant, before.grant); assert.deepEqual(after.usage, before.usage); assert.deepEqual(after.revision, before.revision);
      assert.equal([...f.fake.records.keys()].some(key => key.includes('_agent_runs/')), false); assert.equal(f.resolutions(), 1);
    });
  }
});
