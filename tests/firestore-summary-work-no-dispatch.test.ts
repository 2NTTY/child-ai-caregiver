import assert from 'node:assert/strict';
import test from 'node:test';
import { privateSummaryTerminalFixture as fixture } from './helpers/private-summary-terminal.ts';

test('a claimed attempt is terminal-fenced before any model reservation and its zero-dispatch receipt survives lookup', async () => {
  const f = await fixture();
  await f.withWorkLease(f.work.id, async reference => {
    const claimed = await f.build().claimPart('owner', f.childId, f.work.id, reference); assert.equal(claimed.decision, 'execute');
    const input = { scope: claimed.claim.scope, runId: claimed.claim.runId, attemptId: claimed.attempt.id };
    assert.equal(await f.build().readEffect('owner', f.childId, input.attemptId), null);
    assert.deepEqual(await f.build({ terminalVerifier: undefined }).recoverTerminal(input), { state: 'blocked', receipt: null });
    const result = await f.build().recoverTerminal(input); assert.equal(result.state, 'settled');
    assert.deepEqual(result.receipt, { kind: 'no_effect', dispatchOutcome: 'not_dispatched', stopReason: 'unavailable',
      workId: f.work.id, sourceRevision: 1, attemptId: claimed.attempt.id });
    const attempt = await f.build().readAttempt('owner', f.childId, claimed.attempt.id);
    assert.equal(attempt.noDispatchReason, 'unavailable'); assert.equal(attempt.rootContext, null); assert.equal(attempt.modelReservationId, null);
    assert.deepEqual(await f.build().readEffect('owner', f.childId, attempt.id), result.receipt);
    await assert.rejects(f.build().readEffect('unrelated-user', f.childId, attempt.id));
    await assert.rejects(f.build().bindRootContext(input.scope, input.runId, input.attemptId, f.context(claimed.claim)));
    const state = await f.build().readState('owner', f.childId, f.work.id);
    assert.equal(state.work.state, 'failed'); assert.deepEqual(state.usage.used, { modelCalls: 0, toolCalls: 0 });
    await f.authority.runTransaction('owner', f.childId, async b => assert.equal((await f.runs.read(b, input.runId)).result?.provenance, null));
  });
});

test('a claimed zero-dispatch fence and T2 reservation cannot both grant progress in either serial race order', async () => {
  for (const first of ['fence', 'reserve'] as const) {
    const f = await fixture();
    await f.withWorkLease(f.work.id, async reference => {
      const p = await f.claim(f.work, reference), input = { scope: p.input.scope, runId: p.input.runId, attemptId: p.input.attemptId };
      await f.root.open(p.context);
      const operations = first === 'fence' ? [() => f.build().recoverTerminal(input), () => f.build().reservePart(p.input)]
        : [() => f.build().reservePart(p.input), () => f.build().recoverTerminal(input)];
      const results = await Promise.allSettled(operations.map(operation => operation()));
      const state = await f.build().readState('owner', f.childId, f.work.id), attempt = await f.build().readAttempt('owner', f.childId, input.attemptId);
      if (first === 'fence') {
        assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].status, 'rejected');
        assert.equal(attempt.state, 'not_dispatched'); assert.equal(attempt.noDispatchReason, 'unavailable');
        assert.equal(state.usage.used.modelCalls, 0);
      } else {
        assert.deepEqual(results[0], { status: 'fulfilled', value: 'execute' });
        assert.deepEqual(results[1], { status: 'fulfilled', value: { state: 'unknown', receipt: null } });
        assert.equal(attempt.state, 'reserved'); assert.equal(state.usage.used.modelCalls, 1);
      }
      assert.deepEqual((await f.root.read(p.context)).used, { modelCalls: 0, toolCalls: 0, queryEmbeddings: 0 });
    });
  }
});

test('only an original stopped root with no model admission proves reserved no-dispatch; missing daily after root admission remains unknown', async () => {
  for (const state of ['before-root-model', 'after-root-model', 'after-daily-reserve'] as const) {
    const f = await fixture();
    await f.withWorkLease(f.work.id, async reference => {
      const p = await f.claim(f.work, reference); await f.build().reservePart(p.input); await f.root.open(p.context);
      if (state !== 'before-root-model') await f.root.reserve(p.context,
        { key: p.input.modelAttemptKey, kind: 'model', units: 1, fingerprint: p.input.plan.requestFingerprint });
      if (state === 'after-daily-reserve') await f.daily.reserve(p.input.originalDailyRequest);
      await f.root.stop(p.context); const input = { scope: p.input.scope, runId: p.input.runId, attemptId: p.input.attemptId };
      const result = await f.build().recoverTerminal(input);
      if (state === 'before-root-model') {
        assert.equal(result.state, 'settled'); assert.equal(result.receipt?.kind, 'no_effect');
        assert.equal((await f.build().readAttempt('owner', f.childId, input.attemptId)).noDispatchReason, 'unavailable');
      } else {
        assert.deepEqual(result, { state: 'unknown', receipt: null });
        assert.equal((await f.build().readAttempt('owner', f.childId, input.attemptId)).state, 'reserved');
      }
      assert.deepEqual((await f.build().readState('owner', f.childId, f.work.id)).usage.used, { modelCalls: 1, toolCalls: 0 }, 'The original work reservation is never refunded');
    });
  }
});

test('authority revalidation accepts its already charged last budget unit but rejects changed coverage and terminal execution', async () => {
  const f = await fixture(async f => { f.grant.limits = { modelCalls: 1, toolCalls: 1 }; });
  await f.withWorkLease(f.work.id, async reference => {
    const p = await f.part(f.work, reference);
    assert.deepEqual((await f.build().readState('owner', f.childId, f.work.id)).usage.used, { modelCalls: 1, toolCalls: 1 });
    assert.equal(await f.build().authorizePart(p.input.scope, p.input.runId, p.input.attemptId), true,
      'Revalidation is not a second reservation or a provider permit');
    await f.saveAll();
    assert.equal(await f.build().authorizePart(p.input.scope, p.input.runId, p.input.attemptId), false);
    await f.root.stop(p.context); await f.build().finishPart(p.finish);
    assert.equal(await f.build().authorizePart(p.input.scope, p.input.runId, p.input.attemptId), false);
  });
});
