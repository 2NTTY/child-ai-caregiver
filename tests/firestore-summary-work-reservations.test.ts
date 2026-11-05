import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { privateSummaryRootFixture as fixture } from './helpers/private-summary-root.ts';
import { readAiConfig } from '../server/ai-config.ts';
import { agentBudgetFingerprint } from '../server/agent-budget.ts';
import { privateSummaryReservationSchema, summaryReservationId } from '../server/private-summary-work.ts';
import type { SummaryPartPlan } from '../server/private-summary-work.ts';

async function withPart(callback: (p: Awaited<ReturnType<typeof setup>>, reference: string) => Promise<void>) {
  const p = await setup();
  await p.f.withWorkLease(p.work.id, reference => callback(p, reference));
}
async function setup() {
  const f = await fixture(); await f.barrier(); const started = await f.store().start('owner', f.childId, { kind: 'next_fresh' });
  if (started.kind !== 'created') throw new Error('Expected work'); await f.saveProfile(started.work.grantRecordId);
  return { f, work: started.work };
}
async function bind(p: Awaited<ReturnType<typeof setup>>, reference: string) {
  const { f, work } = p, claimed = await f.store().claimPart('owner', f.childId, work.id, reference); assert.equal(claimed.decision, 'execute');
  const context = f.context(claimed.claim);
  await f.store().bindRootContext(claimed.claim.scope, claimed.claim.runId, claimed.attempt.id, context);
  const requestFingerprint = agentBudgetFingerprint({ syntheticFullRequest: f.message.text });
  const plan: SummaryPartPlan = { binding: claimed.attempt.binding, manifestHash: work.manifestHash,
    range: { unitIndex: 0, startUtf16: 0, endUtf16: f.message.text.length, metadataOnly: false },
    priorAccumulatorHash: null, requestFingerprint, outputTextLimit: 500 };
  const config = readAiConfig(f.profile.env), modelAttemptKey = 'synthetic-original-model';
  const input = { scope: claimed.claim.scope, runId: claimed.claim.runId, attemptId: claimed.attempt.id, plan, modelAttemptKey,
    originalDailyRequest: { kind: 'model' as const, rootRunId: claimed.claim.runId, attemptKey: modelAttemptKey,
      bindingFingerprint: agentBudgetFingerprint(context), requestFingerprint, userId: 'owner', childId: f.childId,
      model: f.grant.model, deadlineAtMs: context.binding.deadlineAtMs, userLimit: config.dailyUserAttempts, globalLimit: config.dailyGlobalAttempts } };
  return { ...p, claimed, context, input };
}

test('T2 atomically fixes one plan, original model key and daily request while cumulative work usage is charged once', async () => {
  await withPart(async (p, reference) => {
    const { f, work, claimed, context, input } = await bind(p, reference);
    await assert.rejects(f.build({ ...f.policy, validateDailyRequest: undefined }).reservePart(input), { code: 'private_summary_daily_policy_missing' });
    f.fake.retry();
    assert.equal(await f.store().reservePart(input), 'execute');
    const attempt = await f.store().readAttempt('owner', f.childId, claimed.attempt.id), state = await f.store().readState('owner', f.childId, work.id);
    assert.equal(attempt.state, 'reserved'); assert.equal(attempt.successorSchedule, null, 'Final ranges do not require successor policy'); assert.deepEqual(attempt.plan, input.plan); assert.deepEqual(attempt.rootContext, context);
    assert.equal(attempt.modelReservationId, summaryReservationId(work.id, input.modelAttemptKey, 'model'));
    assert.deepEqual(state.usage.used, { modelCalls: 1, toolCalls: 0 }); assert.equal(state.usage.revision, 2);
    await f.authority.runTransaction('owner', f.childId, async b => {
      const id = attempt.modelReservationId!; const reservation = f.data.open('private-summary-reservation', id, b.scope, privateSummaryReservationSchema,
        await b.transaction.get(f.data.ref('private_summary_usage', 'private-summary-reservation', id)));
      assert.equal(reservation.kind, 'model'); if (reservation.kind !== 'model') throw new Error('Expected model');
      assert.deepEqual(reservation.originalDailyRequest, input.originalDailyRequest); assert.equal(reservation.grantRecordId, work.grantRecordId);
    });
    const before = JSON.stringify([...f.fake.records]); assert.equal(await f.store().reservePart(input), 'lookup'); assert.equal(JSON.stringify([...f.fake.records]), before);
    await assert.rejects(f.store().reservePart({ ...input, modelAttemptKey: input.modelAttemptKey + ':retry:1',
      originalDailyRequest: { ...input.originalDailyRequest, attemptKey: input.modelAttemptKey + ':retry:1' } }));
    await assert.rejects(f.store().reservePart({ ...input, plan: { ...input.plan, outputTextLimit: 501 } }));
    await f.saveProfile(work.grantRecordId, { ...f.profile, env: { ...f.profile.env, AI_DAILY_USER_ATTEMPTS: String(input.originalDailyRequest.userLimit + 1) } });
    assert.equal(await f.store().reservePart(input), 'lookup', 'A repeated reservation compares its original daily limits, never today’s profile');
    await assert.rejects(f.store().reservePart({ ...input, originalDailyRequest: { ...input.originalDailyRequest, userLimit: input.originalDailyRequest.userLimit + 1 } }));
    await assert.rejects(f.root.read(context), { code: 'root_not_found' });
    assert.equal(await f.daily.read(input.originalDailyRequest), null);
  });
});

test('T2 rejects gaps, changed source identity, split Unicode scalars and forged original-daily bindings before spending', async () => {
  await withPart(async (p, reference) => {
    const { f, work, input } = await bind(p, reference), emoji = f.message.text.indexOf('👩');
    const badPlans = [ { ...input.plan, manifestHash: 'f'.repeat(64) }, { ...input.plan, priorAccumulatorHash: 'f'.repeat(64) },
      ...[{ startUtf16: 1 }, { endUtf16: emoji + 1 }, { unitIndex: 1 }, { endUtf16: f.message.text.length + 1 },
        { metadataOnly: true, endUtf16: 0 }].map(change => ({ ...input.plan, range: { ...input.plan.range, ...change } })) ];
    for (const plan of badPlans) await assert.rejects(f.store().reservePart({ ...input, plan }));
    for (const change of [{ rootRunId: randomUUID() }, { attemptKey: 'another' }, { bindingFingerprint: 'f'.repeat(64) },
      { requestFingerprint: 'e'.repeat(64) }, { userId: 'other' }, { childId: randomUUID() }, { model: 'other' },
      { deadlineAtMs: input.originalDailyRequest.deadlineAtMs + 1 }, { userLimit: input.originalDailyRequest.userLimit + 1 },
      { globalLimit: input.originalDailyRequest.globalLimit + 1 }, { kind: 'embedding' as const }])
      await assert.rejects(f.store().reservePart({ ...input, originalDailyRequest: { ...input.originalDailyRequest, ...change } }));
    assert.deepEqual((await f.store().readState('owner', f.childId, work.id)).usage.used, { modelCalls: 0, toolCalls: 0 });
    await f.chat.createUserMessageForUser('owner', f.childId, 'Appended unrelated full source');
    assert.equal(await f.store().reservePart(input), 'execute');
  });
});

test('T2 failed commit grants nothing and lost acknowledgement retains a single non-refundable reservation', async () => {
  await withPart(async (p, reference) => {
    const { f, work, input } = await bind(p, reference), before = JSON.stringify([...f.fake.records]);
    f.fake.failCommit(); await assert.rejects(f.store().reservePart(input), /Synthetic transaction commit failed/u);
    assert.equal(JSON.stringify([...f.fake.records]), before);
    let execute = false; f.fake.loseReply();
    await assert.rejects((async () => { execute = await f.store().reservePart(input) === 'execute'; })(), /Synthetic lost commit acknowledgement/u);
    assert.equal(execute, false); assert.equal(await f.store().reservePart(input), 'lookup');
    assert.deepEqual((await f.store().readState('owner', f.childId, work.id)).usage.used, { modelCalls: 1, toolCalls: 0 });
  });
});

test('T2b charges the original native batch key and actual units exactly once without reopening a model reservation', async () => {
  await withPart(async (p, reference) => {
    const { f, work, input } = await bind(p, reference); await f.store().reservePart(input);
    const batch = { scope: input.scope, runId: input.runId, attemptId: input.attemptId, toolBatchKey: input.modelAttemptKey + ':tool-batch',
      units: 2, requestFingerprint: agentBudgetFingerprint({ calls: [{ name: 'stage_private_summary', args: { text: 'Synthetic' } }, { name: 'invalid_tool', args: {} }], units: 2 }) };
    await assert.rejects(f.store().reserveToolBatch({ ...batch, toolBatchKey: 'another:tool-batch' }));
    await assert.rejects(f.store().reserveToolBatch({ ...batch, units: f.grant.limits.toolCalls + 1 }));
    assert.deepEqual((await f.store().readState('owner', f.childId, work.id)).usage.used, { modelCalls: 1, toolCalls: 0 });
    f.fake.retry(); assert.equal(await f.store().reserveToolBatch(batch), 'execute');
    assert.deepEqual((await f.store().readState('owner', f.childId, work.id)).usage.used, { modelCalls: 1, toolCalls: 2 });
    const before = JSON.stringify([...f.fake.records]); assert.equal(await f.store().reserveToolBatch(batch), 'lookup');
    assert.equal(JSON.stringify([...f.fake.records]), before);
    await assert.rejects(f.store().reserveToolBatch({ ...batch, units: 1 }));
    await assert.rejects(f.store().reserveToolBatch({ ...batch, requestFingerprint: 'f'.repeat(64) }));
  });
});

test('coverage gained before model admission rejects dispatch without a work reservation or quota refund fiction', async () => {
  await withPart(async (p, reference) => {
    const { f, work, input } = await bind(p, reference); await f.saveAll();
    await assert.rejects(f.store().reservePart(input), { code: 'private_summary_source_already_covered' });
    assert.deepEqual((await f.store().readState('owner', f.childId, work.id)).usage.used, { modelCalls: 0, toolCalls: 0 });
    assert.equal((await f.store().readAttempt('owner', f.childId, input.attemptId)).state, 'claimed');
  });
});

test('a nonfinal range fixes its original successor schedule before any model reservation and missing policy cannot strand paid progress', async () => {
  await withPart(async (p, reference) => {
    const { f, work, context, input } = await bind(p, reference);
    const partial = { ...input, plan: { ...input.plan, range: { ...input.plan.range, endUtf16: 4 } } };
    await f.root.open(context); // Existing original root metadata is allowed; no model/root/daily attempt is reserved.
    await assert.rejects(f.store().reservePart(partial), { code: 'private_summary_schedule_missing' });
    await assert.rejects(f.build({ ...f.policy, async resolveNextPartDueAt() { return { kind: 'blocked', reason: 'unavailable' }; } })
      .reservePart(partial), { code: 'private_summary_schedule_blocked' });
    assert.deepEqual((await f.store().readState('owner', f.childId, work.id)).usage.used, { modelCalls: 0, toolCalls: 0 });
    assert.deepEqual((await f.root.read(context)).used, { modelCalls: 0, toolCalls: 0, queryEmbeddings: 0 });
    assert.equal(await f.daily.read(input.originalDailyRequest), null);
    const dueAt = new Date(Date.now() + 1000).toISOString(); let resolutions = 0;
    const policy = { ...f.policy, async resolveNextPartDueAt() { resolutions++; return { kind: 'due' as const, dueAt }; } };
    f.fake.retry(); assert.equal(await f.build(policy).reservePart(partial), 'execute');
    const attempt = await f.store().readAttempt('owner', f.childId, input.attemptId);
    assert.deepEqual(attempt.successorSchedule,
      { binding: { ...input.plan.binding, step: input.plan.binding.step + 1, attempt: 0 }, dueAt });
    assert.equal(resolutions, 2);
    assert.equal(await f.build({ ...policy, async resolveNextPartDueAt() { throw new Error('Do not recompute the original due time'); } }).reservePart(partial), 'lookup');
    assert.equal((await f.store().readState('owner', f.childId, work.id)).usage.used.modelCalls, 1);
  });
});
