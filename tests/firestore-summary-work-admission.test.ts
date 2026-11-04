import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { privateSummaryPolicyFixture as fixture } from './helpers/private-summary-policy.ts';
import { createFirestorePrivateSummaryWork } from '../server/firestore-private-summary-work.ts';
import { firestoreDomainHash } from '../server/firestore-domain-data.ts';
import { summaryLineageKey, summaryManifestHash } from '../server/private-summary-work.ts';
import { createFirestoreBackgroundQueue, firestoreBackgroundReference, firestoreBackgroundWorkSchema, prepareFirestoreBackgroundWork } from '../server/firestore-background-work.ts';
import { readContextBasis } from '../server/firestore-context-basis.ts';

test('T0 requires an explicit grant and a transaction-verified complete fenced legacy inventory', async () => {
  const f = await fixture(), start = () => f.build().start('owner', f.childId, { kind: 'next_fresh' });
  const noPolicy = createFirestorePrivateSummaryWork({ ...f.options, memory: f.memory });
  assert.deepEqual(await noPolicy.start('owner', f.childId, { kind: 'next_fresh' }), { kind: 'blocked', reason: 'policy_missing' });
  assert.deepEqual(await start(), { kind: 'blocked', reason: 'legacy_missing' });
  for (const [change, reason] of [ [{ status: 'incomplete' }, 'legacy_incomplete'], [{ fence: 'absent' }, 'legacy_unfenced'],
    [{ status: 'unmapped_legacy' }, 'legacy_unmapped_legacy'], [{ workerGeneration: randomUUID() }, 'legacy_stale'] ] as const) {
    await f.barrier(change); assert.deepEqual(await start(), { kind: 'blocked', reason });
  }
  assert.equal([...f.fake.records.keys()].some(key => key.includes('_private_summary_')), false);
  assert.equal(f.resolutions(), 0, 'No fresh grant is resolved before the migration gate');
});

test('T0 atomically creates immutable source, lineage, grant, zero usage and deterministic step-zero outbox', async () => {
  const f = await fixture(); await f.barrier(); f.fake.retry();
  const store = f.build(), result = await store.start('owner', f.childId, { kind: 'next_fresh' });
  assert.equal(result.kind, 'created'); if (result.kind !== 'created') throw new Error('Expected newly committed work');
  const state = await store.readState('owner', f.childId, result.work.id);
  assert.deepEqual(state.work, result.work);
  assert.equal(state.work.lineageKey, summaryLineageKey(state.work.scope, state.revision.manifest));
  assert.equal(state.work.manifestHash, summaryManifestHash(state.revision.manifest));
  assert.deepEqual(state.revision.manifest.coveredMessageIds, [f.message.id]);
  assert.deepEqual(state.grant.grant, f.grant); assert.deepEqual(state.usage.used, { modelCalls: 0, toolCalls: 0 });
  assert.equal(state.work.workerGeneration, f.generation); assert.equal(state.revision.workerGeneration, f.generation);
  assert.equal(state.work.chain.committedParts, 0); assert.equal(state.work.state, 'ready');
  const rows = [...f.fake.records];
  assert.equal(rows.filter(([key]) => key.includes('_private_summary_works/')).length, 2);
  assert.equal(rows.filter(([key]) => key.includes('_private_summary_revisions/')).length, 1);
  assert.equal(rows.filter(([key]) => key.includes('_private_summary_usage/')).length, 2);
  await f.authority.runTransaction('owner', f.childId, async b => {
    const identity = { kind: 'memory-refresh', scope: b.scope, resourceId: state.work.id,
      basis: `summary-part:v1:${state.work.id}:1:0:0`, generation: b.generation, authorizationVersion: b.authorizationVersion };
    const id = firestoreDomainHash(['product-work', identity]);
    const row = await b.transaction.get(f.data.ref('background_work', 'background-work', id));
    assert.equal(row.exists, true, 'Ready work and its exact step-zero wake are atomic');
    const job = f.data.open('background-work', id, b.scope, firestoreBackgroundWorkSchema, row);
    assert.equal(job.basis, identity.basis); assert.equal(job.resourceId, state.work.id); assert.equal(job.state, 'pending');
  });
  assert.equal(rows.filter(([key]) => key.includes('_private_summary_')).every(([, row]) => !JSON.stringify(row).includes(f.message.text)), true);
  const before = JSON.stringify(rows), resolved = f.resolutions();
  const duplicate = await f.build().start('owner', f.childId, { kind: 'next_fresh' });
  assert.equal(duplicate.kind, 'lookup'); if (duplicate.kind !== 'lookup') throw new Error('Expected original work');
  assert.deepEqual(duplicate.work, state.work); assert.equal(f.resolutions(), resolved);
  assert.equal(JSON.stringify([...f.fake.records]), before, 'Lookup cannot create a new wake, revision or grant');
});

test('T0 commit failure leaves no partial work and lost acknowledgement is recovered from the same lineage', async () => {
  const f = await fixture(); await f.barrier(); const before = JSON.stringify([...f.fake.records]);
  f.fake.failCommit(); await assert.rejects(f.build().start('owner', f.childId, { kind: 'next_fresh' }));
  assert.equal(JSON.stringify([...f.fake.records]), before);
  f.fake.loseReply(); await assert.rejects(f.build().start('owner', f.childId, { kind: 'next_fresh' }));
  const committed = JSON.stringify([...f.fake.records]), count = f.resolutions();
  const recovered = await f.build().start('owner', f.childId, { kind: 'next_fresh' });
  assert.equal(recovered.kind, 'lookup'); assert.equal(f.resolutions(), count);
  assert.equal(JSON.stringify([...f.fake.records]), committed);
});

test('new chat and incidental source-basis changes cannot replace the original work or reset its grant', async () => {
  const f = await fixture(); await f.barrier(); const first = await f.build().start('owner', f.childId, { kind: 'next_fresh' });
  assert.equal(first.kind, 'created'); if (first.kind !== 'created') throw new Error('Expected created work');
  await f.chat.createUserMessageForUser('owner', f.childId, 'A later synthetic message');
  await f.memory.createTopic('owner', f.childId, { title: 'Unrelated synthetic topic', note: 'New context', visibility: 'private', confirmShared: false });
  const count = f.resolutions(), again = await f.build().start('owner', f.childId, { kind: 'next_fresh' });
  assert.equal(again.kind, 'lookup'); if (again.kind !== 'lookup') throw new Error('Expected original work');
  assert.deepEqual(again.work, first.work); assert.equal(f.resolutions(), count);
});

test('lookup returns the original work and account before full source validation can suppress a changed source', async () => {
  const f = await fixture(); await f.barrier();
  const first = await f.build().start('owner', f.childId, { kind: 'next_fresh' });
  assert.equal(first.kind, 'created'); if (first.kind !== 'created') throw new Error('Expected created work');
  let sourceReads = 0;
  const store = createFirestorePrivateSummaryWork({ ...f.options, policy: f.policy, memory: { ...f.memory,
    async selectSource() { sourceReads++; return { kind: 'suppressed', reason: 'dependency_suppressed' }; } } });
  const count = f.resolutions(), result = await store.start('owner', f.childId, { kind: 'next_fresh' });
  assert.equal(result.kind, 'lookup'); if (result.kind !== 'lookup') throw new Error('Expected original work before source refresh');
  assert.deepEqual(result.work, first.work); assert.equal(sourceReads, 0); assert.equal(f.resolutions(), count);
});

test('fast admission atomically owns every actual source lineage and a repeated admission is lookup only', async () => {
  const f = await fixture(); await f.barrier();
  const second = (await f.chat.createUserMessageForUser('owner', f.childId, 'Second fast source'))!;
  const target = { kind: 'fresh_prefix' as const, firstMessageId: f.message.id, messageCount: 2 };
  await f.withFastRun(async claim => {
    const source = await f.authority.runTransaction('owner', f.childId, b => f.memory.readFastSource(b, target));
    assert.equal(source.kind, 'eligible'); if (source.kind !== 'eligible') throw new Error('Expected full prefix');
    const input = { runId: claim.runId, reference: claim.trigger!.reference, target, expectedSourceHash: source.sourceHash };
    const before = JSON.stringify([...f.fake.records]);
    await f.authority.runTransaction('owner', f.childId, async b => {
      const prepared = await f.build().prepareFastAdmission(b, input);
      assert.equal(prepared.kind, 'prepared');
      await f.runs.read(b, claim.runId); // No writes during prepare.
    });
    assert.equal(JSON.stringify([...f.fake.records]), before);
    f.fake.retry();
    await f.authority.runTransaction('owner', f.childId, async b => {
      const prepared = await f.build().prepareFastAdmission(b, input);
      assert.equal(prepared.kind, 'prepared');
      assert.deepEqual(prepared.coveredMessageIds, [f.message.id, second.id]); prepared.commit();
    });
    const owned = JSON.stringify([...f.fake.records]);
    await f.authority.runTransaction('owner', f.childId, async b => {
      const repeated = await f.build().prepareFastAdmission(b, input);
      assert.equal(repeated.kind, 'lookup'); repeated.commit();
    });
    assert.equal(JSON.stringify([...f.fake.records]), owned);
    assert.deepEqual(await f.build().start('owner', f.childId, { kind: 'next_fresh' }), { kind: 'blocked', reason: 'legacy_active' });
    assert.equal([...f.fake.records.keys()].filter(key => key.includes('_private_summary_works/')).length, 2);
    assert.equal([...f.fake.records.keys()].filter(key => key.includes('_private_summary_usage/')).length, 0);
  });
});

test('slow work wins the same lineage CAS and fast admission cannot bypass missing migration evidence', async () => {
  const f = await fixture(); await f.barrier();
  const target = { kind: 'fresh_prefix' as const, firstMessageId: f.message.id, messageCount: 1 };
  await f.withFastRun(async claim => {
    const source = await f.authority.runTransaction('owner', f.childId, b => f.memory.readFastSource(b, target));
    if (source.kind !== 'eligible') throw new Error('Expected original source');
    const input = { runId: claim.runId, reference: claim.trigger!.reference, target, expectedSourceHash: source.sourceHash };
    // This run was claimed after the synthetic fenced cutover; losing its persisted barrier must still block admission.
    await f.authority.runTransaction('owner', f.childId, async b => {
      const id = firestoreDomainHash(['synthetic-barrier', b.scope]);
      b.transaction.delete(f.data.ref('test_summary_barriers', 'test-barrier', id));
    });
    const missing = await f.authority.runTransaction('owner', f.childId, b => f.build().prepareFastAdmission(b, input));
    assert.deepEqual(missing, { kind: 'blocked', reason: 'legacy_missing' });
    await f.barrier(); const work = await f.build().start('owner', f.childId, { kind: 'next_fresh' });
    assert.equal(work.kind, 'created'); const before = JSON.stringify([...f.fake.records]);
    const raced = await f.authority.runTransaction('owner', f.childId, b => f.build().prepareFastAdmission(b, input));
    assert.deepEqual(raced, { kind: 'blocked', reason: 'lineage_owned' }); assert.equal(JSON.stringify([...f.fake.records]), before);
  });
});

test('fast admission rejects another run and the source hash that was not actually fitted', async () => {
  const f = await fixture(); await f.barrier();
  const target = { kind: 'fresh_prefix' as const, firstMessageId: f.message.id, messageCount: 1 };
  await f.withFastRun(async claim => {
    const before = JSON.stringify([...f.fake.records]);
    const input = { runId: claim.runId, reference: claim.trigger!.reference, target, expectedSourceHash: 'a'.repeat(64) };
    const stale = await f.authority.runTransaction('owner', f.childId, b => f.build().prepareFastAdmission(b, input));
    assert.deepEqual(stale, { kind: 'blocked', reason: 'source_changed' });
    await assert.rejects(f.authority.runTransaction('owner', f.childId,
      b => f.build().prepareFastAdmission(b, { ...input, runId: randomUUID() })));
    assert.equal(JSON.stringify([...f.fake.records]), before);
  });
});

test('synthetic document references retain the same ID as their snapshots for canonical queue bindings', async () => {
  const f = await fixture(), ref = f.data.ref('test_refs', 'test-ref', 'synthetic');
  assert.equal(ref.id, ref.path.split('/').at(-1));
  await f.options.database.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    assert.equal(snapshot.id, ref.id); assert.equal(snapshot.ref.id, ref.id);
  });
});

test('a grant with no remaining terminal-tool unit cannot create executable work or spend a model call', async () => {
  const f = await fixture(); await f.barrier();
  f.grant.limits.toolCalls = 0;
  const before = JSON.stringify([...f.fake.records]);
  assert.deepEqual(await f.build().start('owner', f.childId, { kind: 'next_fresh' }), { kind: 'blocked', reason: 'grant_exhausted' });
  assert.equal(JSON.stringify([...f.fake.records]), before);
  f.grant.limits.toolCalls = 8; f.grant.limits.modelCalls = 0;
  assert.deepEqual(await f.build().start('owner', f.childId, { kind: 'next_fresh' }), { kind: 'blocked', reason: 'grant_exhausted' });
  f.grant.limits.modelCalls = 8; f.grant.workDeadlineAt = new Date(Date.now() - 1000).toISOString();
  assert.deepEqual(await f.build().start('owner', f.childId, { kind: 'next_fresh' }), { kind: 'blocked', reason: 'grant_expired' });
  assert.equal(JSON.stringify([...f.fake.records]), before);
});

test('T1 atomically pins one attempt, original grant, canonical run and exact work job without extending duplicate claims', async () => {
  const f = await fixture(); await f.barrier(); const started = await f.build().start('owner', f.childId, { kind: 'next_fresh' });
  if (started.kind !== 'created') throw new Error('Expected work');
  await f.withWorkLease(started.work.id, async reference => {
    f.fake.retry(); const claimed = await f.build().claimPart('owner', f.childId, started.work.id, reference);
    assert.equal(claimed.decision, 'execute'); assert.equal(claimed.claim.created, true);
    assert.equal(claimed.attempt.grantRecordId, started.work.grantRecordId); assert.equal(claimed.attempt.rootContext, null);
    assert.equal(claimed.attempt.modelReservationId, null); assert.equal(claimed.attempt.state, 'claimed');
    const state = await f.build().readState('owner', f.childId, started.work.id);
    assert.equal(state.work.activeAttemptId, claimed.attempt.id); assert.equal(state.work.state, 'executing');
    assert.deepEqual(state.usage.used, { modelCalls: 0, toolCalls: 0 });
    assert.deepEqual(await f.build().readAttempt('owner', f.childId, claimed.attempt.id), claimed.attempt);
    await f.authority.runTransaction('owner', f.childId, async b => {
      const run = await f.runs.read(b, claimed.claim.runId);
      assert.deepEqual(run.summaryWork, claimed.attempt.binding); assert.equal(run.workerGeneration, f.generation);
      assert.equal(run.trigger.reference, reference);
    });
    const before = JSON.stringify([...f.fake.records]);
    const duplicate = await f.build().claimPart('owner', f.childId, started.work.id, reference);
    assert.equal(duplicate.decision, 'lookup'); assert.equal(duplicate.claim.runId, claimed.claim.runId);
    assert.equal(duplicate.claim.created, false); assert.equal(duplicate.claim.expiresAt, claimed.claim.expiresAt);
    assert.equal(JSON.stringify([...f.fake.records]), before);
    await assert.rejects(f.build().claimPart('owner', f.childId, started.work.id, randomUUID()));
  });
});

test('T1 never grants execution from an aborted callback or an unknown commit acknowledgement', async () => {
  const f = await fixture(); await f.barrier(); const started = await f.build().start('owner', f.childId, { kind: 'next_fresh' });
  if (started.kind !== 'created') throw new Error('Expected work');
  await f.withWorkLease(started.work.id, async reference => {
    const before = JSON.stringify([...f.fake.records]);
    f.fake.failCommit(); await assert.rejects(f.build().claimPart('owner', f.childId, started.work.id, reference), /Synthetic transaction commit failed/u);
    assert.equal(JSON.stringify([...f.fake.records]), before);
    let execute = false; f.fake.loseReply();
    await assert.rejects((async () => { execute = (await f.build().claimPart('owner', f.childId, started.work.id, reference)).decision === 'execute'; })(), /Synthetic lost commit acknowledgement/u);
    assert.equal(execute, false);
    const saved = await f.build().readState('owner', f.childId, started.work.id);
    assert.equal(saved.work.state, 'executing'); assert.notEqual(saved.work.activeAttemptId, null);
    const original = JSON.stringify([...f.fake.records]), recovered = await f.build().claimPart('owner', f.childId, started.work.id, reference);
    assert.equal(recovered.decision, 'lookup'); assert.equal(recovered.attempt.id, saved.work.activeAttemptId);
    assert.equal(JSON.stringify([...f.fake.records]), original);
  });
});

test('T1 keeps an immutable source across appended chat but rejects a different canonical leased job', async () => {
  const f = await fixture(); await f.barrier(); const started = await f.build().start('owner', f.childId, { kind: 'next_fresh' });
  if (started.kind !== 'created') throw new Error('Expected work');
  await f.chat.createUserMessageForUser('owner', f.childId, 'Appended after T0');
  // A live scope job is not a work-part permit. Acquire its real queue lease without
  // creating a legacy fast run, which active durable scopes intentionally forbid.
  const dueAt = new Date(Date.now() - 1000).toISOString();
  const wrongJobId = await f.authority.runTransaction('owner', f.childId, async b => {
    const current = await readContextBasis(f.data, b);
    const prepared = await prepareFirestoreBackgroundWork(f.data, b.transaction, { kind: 'memory-refresh', scope: b.scope,
      resourceId: b.scope.childId, basis: String(current.value.summaryRequest), generation: b.generation,
      authorizationVersion: b.authorizationVersion }, dueAt);
    prepared.commit(); return prepared.id;
  });
  let executed = false, failure: unknown;
  const queue = createFirestoreBackgroundQueue({ ...f.options, enabled: true, readControl: tx => f.authority.readControl(tx),
    transport: { async enqueue() { throw new Error('No external queue'); }, async probe() { throw new Error('No external queue'); } },
    async execute(job) {
      executed = true;
      try {
        const before = JSON.stringify([...f.fake.records]);
        await assert.rejects(f.build().claimPart('owner', f.childId, started.work.id, firestoreBackgroundReference(job)),
          error => error instanceof Error && 'code' in error && error.code === 'summary_work_lease');
        assert.equal(JSON.stringify([...f.fake.records]), before, 'Wrong live lease cannot create a run, attempt or usage');
      } catch (error) { failure = error; }
      return { state: 'completed' };
    } });
  await queue.process({ kind: 'product-work', id: wrongJobId, generation: f.generation, dispatchRevision: 1, scheduledAt: dueAt });
  assert.equal(executed, true, 'The rejection must occur under an actual canonical queue lease');
  if (failure) throw failure;
  await f.withWorkLease(started.work.id, async reference => {
    const result = await f.build().claimPart('owner', f.childId, started.work.id, reference);
    assert.equal(result.decision, 'execute');
    const state = await f.build().readState('owner', f.childId, started.work.id);
    assert.equal(state.work.manifestHash, started.work.manifestHash); assert.equal(state.work.sourceRevision, 1);
    assert.deepEqual(state.revision.manifest.coveredMessageIds, [f.message.id]);
  });
});
