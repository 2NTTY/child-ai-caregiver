import assert from 'node:assert/strict';
import test from 'node:test';
import { createEvent } from '@google/adk';
import { randomUUID } from 'node:crypto';
import { privateSummaryTerminalFixture as fixture } from './helpers/private-summary-terminal.ts';
import { privateSummaryReservationSchema, summaryReservationId, summaryPartBackgroundIdentity } from '../server/private-summary-work.ts';
import { firestoreDomainHash } from '../server/firestore-domain-data.ts';
import { firestoreBackgroundWorkSchema } from '../server/firestore-background-work.ts';

async function withPart(callback: (f: Awaited<ReturnType<typeof fixture>>, p: Awaited<ReturnType<Awaited<ReturnType<typeof fixture>>['part']>>) => Promise<void>,
  partial = false, failure = false) {
  const f = await fixture();
  await f.withWorkLease(f.work.id, async reference => callback(f, await f.part(f.work, reference, partial ? 4 : undefined, failure ? 'failure' : 'terminal')));
}

test('terminal fixture verifies actual encrypted native/root/daily records in one transaction and an active root is not a stop', async () => {
  await withPart(async (f, p) => {
    // Do not nest an authority transaction: read view before the single evidence transaction.
    const state = await f.build().readState('owner', f.childId, f.work.id), attempt = await f.build().readAttempt('owner', f.childId, p.input.attemptId);
    const read = () => f.authority.runTransaction('owner', f.childId, async b => {
      const run = await f.runs.read(b, p.input.runId);
      const modelId = attempt.modelReservationId!, toolId = summaryReservationId(f.work.id, p.input.modelAttemptKey + ':tool-batch', 'tool');
      const modelReservation = f.data.open('private-summary-reservation', modelId, b.scope, privateSummaryReservationSchema,
        await b.transaction.get(f.data.ref('private_summary_usage', 'private-summary-reservation', modelId)));
      const toolReservation = f.data.open('private-summary-reservation', toolId, b.scope, privateSummaryReservationSchema,
        await b.transaction.get(f.data.ref('private_summary_usage', 'private-summary-reservation', toolId)));
      return f.verifier.verify(b, { ...state, grantRecord: state.grant, attempt, run, modelReservation, toolReservation });
    });
    assert.deepEqual(await read(), { kind: 'unknown' }); await f.root.stop(p.context);
    const proof = await read(); assert.equal(proof.kind, 'terminal'); if (proof.kind !== 'terminal') throw new Error('Expected actual native evidence');
    assert.equal(proof.text, p.text); assert.deepEqual(proof.counts, p.result.counts); assert.deepEqual(proof.tools, p.result.tools);
    await f.sessions.appendEvent({ session: p.session, event: createEvent({ ...p.events[1], id: randomUUID(), timestamp: p.events[2].timestamp + 1 }) });
    assert.deepEqual(await read(), { kind: 'unknown' }, 'Complete duplicate terminal history is rejected');
  });
});

test('ordinary run finish cannot bypass the durable summary receipt transaction', async () => {
  await withPart(async (f, p) => {
    const before = JSON.stringify([...f.fake.records]);
    await assert.rejects(f.runs.finish(p.input.scope, p.result), { code: 'summary_finish_required' });
    assert.equal(JSON.stringify([...f.fake.records]), before);
  });
});

test('T3 refuses missing or unfrozen evidence and rejects result projection or staged-text substitution', async () => {
  await withPart(async (f, p) => {
    await assert.rejects(f.build({ terminalVerifier: undefined }).finishPart(p.finish), { code: 'private_summary_terminal_missing' });
    await assert.rejects(f.build().finishPart(p.finish), { code: 'private_summary_terminal_unknown' });
    await f.root.stop(p.context); const before = JSON.stringify([...f.fake.records]);
    await assert.rejects(f.build().finishPart({ ...p.finish, text: 'caller replaced original native output' }), { code: 'private_summary_terminal_mismatch' });
    for (const result of [{ ...p.result, counts: { ...p.result.counts, modelCalls: 0 } }, { ...p.result, tools: [] },
      { ...p.result, provenance: { ...p.result.provenance!, model: 'wrong-model' } }])
      await assert.rejects(f.build().finishPart({ ...p.finish, result }), { code: 'private_summary_terminal_mismatch' });
    assert.equal(JSON.stringify([...f.fake.records]), before);
  });
});

test('T3 commits a contiguous part and original successor outbox atomically without claiming summary coverage', async () => {
  await withPart(async (f, p) => {
    await f.root.stop(p.context); f.fake.retry();
    const result = await f.build({ policy: { ...f.policy, async resolveNextPartDueAt() { throw new Error('Original schedule must be reused'); } } }).finishPart(p.finish);
    assert.deepEqual(result, { kind: 'part_committed', workId: f.work.id, sourceRevision: 1, attemptId: p.input.attemptId,
      step: 0, next: { unitIndex: 0, offsetUtf16: 4 } });
    const state = await f.build().readState('owner', f.childId, f.work.id), attempt = await f.build().readAttempt('owner', f.childId, p.input.attemptId);
    assert.equal(state.work.state, 'ready'); assert.equal(state.work.activeAttemptId, null); assert.equal(state.work.chain.committedParts, 1);
    assert.equal(state.work.accumulator!.text, p.text); assert.equal(state.work.chain.accumulatorHash, firestoreDomainHash(p.text));
    assert.equal(attempt.chainLink!.predecessor, f.work.chain.digest); assert.equal(attempt.chainLink!.next, state.work.chain.digest);
    assert.equal((await f.memory.prepareSummary('owner', f.childId))!.previousVersion, 0);
    await f.authority.runTransaction('owner', f.childId, async b => {
      const id = firestoreDomainHash(['product-work', summaryPartBackgroundIdentity(state.work)]);
      const job = f.data.open('background-work', id, b.scope, firestoreBackgroundWorkSchema,
        await b.transaction.get(f.data.ref('background_work', 'background-work', id)));
      assert.equal(job.dueAt, f.dueAt); assert.equal(job.basis, `summary-part:v1:${f.work.id}:1:1:0`);
      assert.deepEqual((await f.runs.read(b, p.input.runId)).summaryEffect, result);
    });
  }, true);
});

test('T4 retains original work and cumulative usage across parts and chat appends, publishes whole coverage and a durable wake', async () => {
  const f = await fixture();
  await f.withWorkLease(f.work.id, async reference => {
    const p = await f.part(f.work, reference, 4); await f.root.stop(p.context); await f.build().finishPart(p.finish);
  });
  const prior = await f.build().readState('owner', f.childId, f.work.id);
  const appended = await f.chat.createUserMessageForUser('owner', f.childId, 'Later unrelated full message');
  await f.withWorkLease(f.work.id, async reference => {
    const p = await f.part(prior.work, reference); await f.root.stop(p.context); const receipt = await f.build().finishPart(p.finish);
    assert.equal(receipt.kind, 'published'); if (receipt.kind !== 'published') throw new Error('Expected whole coverage');
    assert.deepEqual(receipt.coveredMessageIds, [f.message.id]);
    const state = await f.build().readState('owner', f.childId, f.work.id);
    assert.equal(state.work.id, f.work.id); assert.equal(state.work.grantRecordId, f.work.grantRecordId); assert.equal(f.resolutions(), 1);
    assert.equal(state.work.chain.committedParts, 2); assert.equal(state.work.state, 'completed');
    assert.deepEqual(state.usage.used, { modelCalls: 2, toolCalls: 2 }); assert.deepEqual(state.work.finalReceipt, receipt);
    assert.equal(state.work.completionWake!.scheduling.kind, 'pending_schedule');
    const current = (await f.memory.prepareSummary('owner', f.childId))!;
    assert.equal(current.previousVersion, 1); assert.deepEqual(current.messages.map(message => message.id), [appended!.id]);
  });
});

test('T4 failed commit rolls back every effect and lost acknowledgement recovers the original receipt after session cleanup', async () => {
  await withPart(async (f, p) => {
    await f.root.stop(p.context); const before = JSON.stringify([...f.fake.records]);
    f.fake.failCommit(); await assert.rejects(f.build().finishPart(p.finish), /Synthetic transaction commit failed/u);
    assert.equal(JSON.stringify([...f.fake.records]), before);
    f.fake.retry(); f.fake.loseReply(); await assert.rejects(f.build().finishPart(p.finish), /Synthetic lost commit acknowledgement/u);
    const committed = await f.build().readAttempt('owner', f.childId, p.input.attemptId); assert.equal(committed.receipt!.kind, 'published');
    await f.sessions.deleteSession(p.key);
    const now = JSON.stringify([...f.fake.records]); assert.deepEqual(await f.build({ terminalVerifier: undefined }).finishPart(p.finish), committed.receipt);
    assert.equal(JSON.stringify([...f.fake.records]), now); assert.equal((await f.memory.prepareSummary('owner', f.childId))!.previousVersion, 1);
  });
});

test('known observed failure settles the original run without retry policy, coverage progress or quota refund', async () => {
  await withPart(async (f, p) => {
    await f.root.stop(p.context); const receipt = await f.build().finishPart(p.finish);
    assert.deepEqual(receipt, { kind: 'no_effect', workId: f.work.id, sourceRevision: 1, attemptId: p.input.attemptId,
      dispatchOutcome: 'response_observed', stopReason: 'invalid_response' });
    const state = await f.build().readState('owner', f.childId, f.work.id), attempt = await f.build().readAttempt('owner', f.childId, p.input.attemptId);
    assert.equal(state.work.state, 'failed'); assert.equal(state.work.activeAttemptId, null); assert.equal(state.work.nextAttempt, 0);
    assert.deepEqual(state.work.chain, f.work.chain); assert.deepEqual(state.usage.used, { modelCalls: 1, toolCalls: 0 });
    assert.equal(attempt.state, 'known_failed'); assert.equal(attempt.resultText, null); assert.equal(attempt.chainLink, null);
    assert.equal((await f.memory.prepareSummary('owner', f.childId))!.previousVersion, 0);
  }, false, true);
});

test('interactive whole coverage after a paid part supersedes without publishing stale output or pretending zero dispatch', async () => {
  await withPart(async (f, p) => {
    await f.root.stop(p.context); await f.saveAll('Interactive whole coverage');
    const receipt = await f.build().finishPart(p.finish);
    assert.deepEqual(receipt, { kind: 'superseded', reason: 'already_covered', workId: f.work.id, sourceRevision: 1, attemptId: p.input.attemptId });
    const state = await f.build().readState('owner', f.childId, f.work.id), attempt = await f.build().readAttempt('owner', f.childId, p.input.attemptId);
    assert.equal(state.work.state, 'completed'); assert.deepEqual(state.work.chain, f.work.chain);
    assert.equal(attempt.resultText, null); assert.equal(attempt.chainLink, null); assert.deepEqual(state.usage.used, { modelCalls: 1, toolCalls: 1 });
    assert.equal((await f.memory.prepareSummary('owner', f.childId))!.previousVersion, 1);
  });
});
