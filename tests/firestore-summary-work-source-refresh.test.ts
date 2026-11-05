import assert from 'node:assert/strict';
import test from 'node:test';
import { privateSummaryPolicyFixture as fixture } from './helpers/private-summary-policy.ts';
import { createFirestorePrivateSummaryWork } from '../server/firestore-private-summary-work.ts';
import { firestoreDomainHash } from '../server/firestore-domain-data.ts';
import { summaryPartBackgroundIdentity, summarySourceRevisionSchema, summaryRevisionId } from '../server/private-summary-work.ts';
import { firestoreBackgroundWorkSchema } from '../server/firestore-background-work.ts';

const values = (content: string) => ({ key: 'Original pending preference', content,
  source: { kind: 'manual' as const, description: 'Synthetic R1 fixture' }, validUntil: null });
async function pending() {
  const f = await fixture(); f.grant.workDeadlineAt = new Date(Date.now() + 60000).toISOString();
  f.policy.resolveSourceRevisionDueAt = async () => ({ kind: 'due', dueAt: '2026-11-04T00:00:00.000Z' });
  const candidate = (await f.memory.createFact('owner', f.childId, { values: values('Original preference'), intendedVisibility: 'private' }))!;
  const fact = (await f.memory.confirmFact('owner', f.childId, candidate.id,
    { expectedVersion: candidate.version, confirm: true, confirmShared: false }))!;
  await f.barrier(); const store = f.build(), started = await store.start('owner', f.childId, { kind: 'next_fresh' });
  assert.equal(started.kind, 'created'); if (started.kind !== 'created') throw new Error('Expected original work');
  const state = await store.readState('owner', f.childId, started.work.id);
  const scope = await f.authority.runTransaction('owner', f.childId, async b => f.runs.current(b));
  const input = { scope, workId: state.work.id, expectedVersion: state.work.version };
  const change = () => f.memory.reviseFact('owner', f.childId, fact.id, { expectedVersion: fact.version,
    confirm: true, confirmShared: false, values: values('Current corrected preference'), reason: 'Actual synthetic correction' });
  return { ...f, store, state, input, change };
}

test('R1 ignores incidental source requests and complete-graph basis changes without changing revision, grant or outbox', async () => {
  const f = await pending();
  await f.chat.createUserMessageForUser('owner', f.childId, 'Later append does not reset original work');
  await f.memory.createTopic('owner', f.childId, { title: 'Unrelated topic', note: '', visibility: 'private', confirmShared: false });
  const before = JSON.stringify([...f.fake.records]);
  assert.deepEqual(await f.store.refreshSource(f.input), { kind: 'unchanged', work: f.state.work });
  assert.equal(JSON.stringify([...f.fake.records]), before); assert.equal(f.resolutions(), 1);
});

test('R1 creates the next immutable same-lineage source and step-zero outbox atomically while preserving original account history', async () => {
  const f = await pending(); await f.change(); const result = await f.store.refreshSource(f.input);
  assert.equal(result.kind, 'refreshed');
  const current = await f.store.readState('owner', f.childId, f.state.work.id);
  assert.equal(current.work.id, f.state.work.id); assert.equal(current.work.lineageKey, f.state.work.lineageKey);
  assert.equal(current.work.sourceRevision, 2); assert.equal(current.work.sourceRevisionId, summaryRevisionId(f.state.work.id, 2));
  assert.equal(current.work.state, 'ready'); assert.equal(current.work.activeAttemptId, null);
  assert.equal(current.work.chain.committedParts, 0); assert.equal(current.work.nextAttempt, 0); assert.equal(current.work.accumulator, null);
  assert.deepEqual(current.usage, f.state.usage); assert.deepEqual(current.grant, f.state.grant);
  assert.deepEqual(current.revision.manifest.coveredMessageIds, [f.message.id]);
  assert.equal(current.revision.manifest.units[1].kind, 'correction_json');
  await f.authority.runTransaction('owner', f.childId, async b => {
    const row = await b.transaction.get(f.data.ref('private_summary_revisions', 'private-summary-revision', f.state.revision.id));
    assert.deepEqual(f.data.open('private-summary-revision', f.state.revision.id, b.scope, summarySourceRevisionSchema, row), f.state.revision);
    const identity = summaryPartBackgroundIdentity(current.work), id = firestoreDomainHash(['product-work', identity]);
    const job = f.data.open('background-work', id, b.scope, firestoreBackgroundWorkSchema,
      await b.transaction.get(f.data.ref('background_work', 'background-work', id)));
    assert.equal(job.basis, `summary-part:v1:${current.work.id}:2:0:0`); assert.equal(job.state, 'pending');
    assert.equal(job.dueAt, '2026-11-04T00:00:00.000Z');
  });
  const lookup = await f.store.start('owner', f.childId, { kind: 'next_fresh' });
  assert.equal(lookup.kind, 'lookup'); assert.equal(f.resolutions(), 1);
});

test('R1 failed commit, callback retry and lost acknowledgement never leave ready without outbox or create multiple source revisions', async () => {
  const f = await pending(); await f.change(); const before = JSON.stringify([...f.fake.records]);
  f.fake.failCommit(); await assert.rejects(f.store.refreshSource(f.input), /Synthetic transaction commit failed/u);
  assert.equal(JSON.stringify([...f.fake.records]), before);
  f.fake.retry(); f.fake.loseReply(); await assert.rejects(f.store.refreshSource(f.input), /Synthetic lost commit acknowledgement/u);
  const current = await f.store.readState('owner', f.childId, f.state.work.id), committed = JSON.stringify([...f.fake.records]);
  assert.equal(current.work.sourceRevision, 2); assert.equal(current.work.state, 'ready');
  assert.deepEqual(await f.build().refreshSource(f.input), { kind: 'lookup', work: current.work });
  assert.equal(JSON.stringify([...f.fake.records]), committed); assert.deepEqual(current.usage, f.state.usage);
});

test('R1 cannot clear an active claim, change authority or silently move the original grant after a source correction', async () => {
  const f = await pending();
  await f.withWorkLease(f.state.work.id, async reference => {
    const claim = await f.store.claimPart('owner', f.childId, f.state.work.id, reference);
    assert.ok(claim.decision !== 'blocked'); assert.equal(claim.decision, 'execute');
    await f.change(); const current = await f.store.readState('owner', f.childId, f.state.work.id), before = JSON.stringify([...f.fake.records]);
    assert.deepEqual(await f.store.refreshSource({ ...f.input, expectedVersion: current.work.version }),
      { kind: 'blocked', reason: 'active_attempt', work: current.work });
    await assert.rejects(f.store.refreshSource({ ...f.input, scope: { ...f.input.scope, authorizationVersion: '999' }, expectedVersion: current.work.version }));
    assert.equal(JSON.stringify([...f.fake.records]), before); assert.equal(current.work.activeAttemptId, claim.attempt.id);
    assert.deepEqual(current.usage, f.state.usage);
  });
});

test('R1 missing original schedule or expired grant preserves invalidated source history without a new ready revision', async () => {
  for (const reason of ['policy_missing', 'grant_expired'] as const) {
    const f = await pending(); await f.change();
    const store = reason === 'policy_missing' ? f.build({ ...f.policy, resolveSourceRevisionDueAt: undefined })
      : createFirestorePrivateSummaryWork({ ...f.options, memory: f.memory, runs: f.runs, policy: f.policy,
        serverClock: () => Date.parse(f.state.work.grant.workDeadlineAt!) + 1 });
    const result = await store.refreshSource(f.input); assert.equal(result.kind, 'blocked');
    if (result.kind !== 'blocked') throw new Error('Expected original policy block'); assert.equal(result.reason, reason);
    const current = await f.store.readState('owner', f.childId, f.state.work.id);
    assert.equal(current.work.state, 'invalidated'); assert.equal(current.work.sourceRevision, 1);
    assert.deepEqual(current.revision, f.state.revision); assert.deepEqual(current.grant, f.state.grant); assert.deepEqual(current.usage, f.state.usage);
  }
});

test('R1 authoritative whole coverage can commit a zero-dispatch administrative receipt without a lease or an executable grant', async () => {
  const f = await pending(); await f.change(); await f.saveAll();
  const store = createFirestorePrivateSummaryWork({ ...f.options, memory: f.memory, runs: f.runs,
    serverClock: () => Date.parse(f.state.work.grant.workDeadlineAt!) + 1 });
  const result = await store.refreshSource(f.input); assert.equal(result.kind, 'completed');
  const current = await f.store.readState('owner', f.childId, f.state.work.id), receipt = current.work.finalReceipt;
  assert.ok(receipt); assert.equal(receipt.kind, 'superseded');
  if (receipt.kind !== 'superseded') throw new Error('Expected authoritative coverage receipt'); assert.equal(receipt.reason, 'already_covered');
  assert.equal(current.work.state, 'completed'); assert.equal(current.work.activeAttemptId, null);
  assert.deepEqual(current.work.chain, f.state.work.chain); assert.deepEqual(current.usage, f.state.usage);
  assert.equal(current.work.completionWake?.scheduling.kind, 'pending_schedule', 'No wake resolver does not erase known completion');
  const attempt = await f.store.readAttempt('owner', f.childId, receipt.attemptId);
  assert.equal(attempt.state, 'committed'); assert.equal(attempt.plan, null); assert.equal(attempt.rootContext, null);
  assert.equal(attempt.modelReservationId, null); assert.equal(attempt.chainLink, null); assert.equal(attempt.resultText, null);
  await f.authority.runTransaction('owner', f.childId, async b => {
    const run = await f.runs.read(b, attempt.runId); assert.equal(run.state, 'completed');
    assert.deepEqual(run.summaryEffect, receipt); assert.deepEqual(run.result?.counts, { modelCalls: 0, toolCalls: 0, queryEmbeddings: 0 });
    assert.equal(run.result?.countsKnown, true); assert.deepEqual(run.result?.tools, []);
  });
});

test('R1 zero-dispatch administrative completion is atomic under discarded callbacks, failed commit and lost acknowledgement', async () => {
  const f = await pending(); await f.saveAll(); const before = JSON.stringify([...f.fake.records]);
  f.fake.failCommit(); await assert.rejects(f.store.refreshSource(f.input), /Synthetic transaction commit failed/u);
  assert.equal(JSON.stringify([...f.fake.records]), before);
  f.fake.retry(); f.fake.loseReply(); await assert.rejects(f.store.refreshSource(f.input), /Synthetic lost commit acknowledgement/u);
  const current = await f.store.readState('owner', f.childId, f.state.work.id), committed = JSON.stringify([...f.fake.records]);
  assert.equal(current.work.state, 'completed'); assert.ok(current.work.finalReceipt);
  assert.deepEqual(await f.build(undefined).refreshSource(f.input), { kind: 'lookup', work: current.work });
  assert.equal(JSON.stringify([...f.fake.records]), committed); assert.deepEqual(current.usage, f.state.usage);
});
