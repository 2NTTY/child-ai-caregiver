import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createEvent } from '@google/adk';
import { privateSummaryRootFixture } from './private-summary-root.ts';
import { createFirestorePrivateSummaryWork, type SummaryTerminalVerifier, type SummaryWorkPolicyPort } from '../../server/firestore-private-summary-work.ts';
import { agentBudgetFingerprint } from '../../server/agent-budget.ts';
import { readAiConfig } from '../../server/ai-config.ts';
import type { SummaryPartPlan, PrivateSummaryWork } from '../../server/private-summary-work.ts';
import type { ProductAgentResult } from '../../src/shared/product-agent.ts';

/** Synthetic native events, but actual encrypted session/root/daily adapters and same-transaction reads.
 * This is deliberately not the P3 production parser or provider composition. */
export async function privateSummaryTerminalFixture(beforeStart?: (f: Awaited<ReturnType<typeof privateSummaryRootFixture>>) => Promise<void>) {
  const f = await privateSummaryRootFixture();
  const dueAt = new Date(Date.now() - 1000).toISOString();
  const policy: SummaryWorkPolicyPort = { ...f.policy, async resolveNextPartDueAt() { return { kind: 'due', dueAt }; } };
  const verifier: SummaryTerminalVerifier = { async verify(b, input) {
    const { attempt, run, modelReservation: model, toolReservation: tool, grantRecord } = input;
    if (attempt.state === 'claimed' && attempt.plan === null && attempt.modelReservationId === null && !model && !tool) {
      const originalRun = await f.runs.read(b, run.id);
      if (agentBudgetFingerprint(originalRun) !== agentBudgetFingerprint(run) || originalRun.result !== null) return { kind: 'unknown' };
      return { kind: 'no_effect', dispatchOutcome: 'not_dispatched', stopReason: 'unavailable',
        counts: { modelCalls: 0, toolCalls: 0, queryEmbeddings: 0 }, tools: [], evidenceHash: agentBudgetFingerprint({ work: input.work, attempt, run }) };
    }
    if (!attempt.rootContext || !attempt.plan || !model || model.kind !== 'model') return { kind: 'unknown' };
    const root = await f.root.readInTransaction(attempt.rootContext, b.transaction);
    const daily = await f.daily.readInTransaction(model.originalDailyRequest, b.transaction);
    const session = await f.sessions.readSessionEvidenceInTransaction({ appName: 'yuban_hk', userId: run.ownerUserId, sessionId: run.id }, b.transaction);
    if (f.daily.billingSource !== grantRecord.grant.billingSource) return { kind: 'unknown' };
    if (root.status === 'stopped' && root.attempts.length === 0 && !daily && !tool
      && (!session || session.events.every(event => event.author === 'user' && event.content?.role === 'user'))) {
      return { kind: 'no_effect', dispatchOutcome: 'not_dispatched', stopReason: 'unavailable', counts: root.used, tools: [],
        evidenceHash: agentBudgetFingerprint({ root, daily, session: session ?? null, attempt, model }) };
    }
    if (root.status !== 'stopped' || !daily?.record || daily.record.outcome !== 'succeeded' || !session
      || f.daily.billingSource !== grantRecord.grant.billingSource || root.used.queryEmbeddings !== 0) return { kind: 'unknown' };
    const events = session.events;
    if (![2, 3].includes(events.length) || events.some(event => event.partial || event.invocationId !== events[0].invocationId
      || event.branch !== events[0].branch) || new Set(events.map(event => event.id)).size !== events.length) return { kind: 'unknown' };
    const [user, response, output] = events;
    if (user.author !== 'user' || user.content?.role !== 'user' || response.author !== 'yuban_agent' || response.content?.role !== 'model') return { kind: 'unknown' };
    const modelKey = 'model:' + agentBudgetFingerprint([run.id, run.trigger, 'first-model']);
    if (model.originalAttemptKey !== modelKey || model.requestFingerprint !== agentBudgetFingerprint({ contents: [user.content] })) return { kind: 'unknown' };
    const evidenceHash = agentBudgetFingerprint({ root, daily, session, grantRecordId: attempt.grantRecordId, plan: attempt.plan });
    if (events.length === 2 && !tool && response.turnComplete === true && response.content.parts?.length === 1
      && typeof response.content.parts[0].text === 'string' && response.content.parts[0].text.trim()
      && root.attempts.length === 1 && root.used.modelCalls === 1 && root.used.toolCalls === 0
      && root.attempts[0].kind === 'model' && root.attempts[0].key === modelKey && root.attempts[0].fingerprint === model.requestFingerprint)
      return { kind: 'no_effect', dispatchOutcome: 'response_observed', stopReason: 'invalid_response', counts: root.used, tools: [], evidenceHash };
    if (events.length !== 3 || output.author !== 'yuban_agent' || output.content?.role !== 'user') return { kind: 'unknown' };
    const calls = response.content.parts?.map(part => part.functionCall);
    const answers = output.content.parts?.map(part => part.functionResponse);
    if (!calls || calls.length !== 1 || !calls[0] || !answers || answers.length !== 1 || !answers[0]
      || calls[0].id !== answers[0].id || calls[0].name !== answers[0].name || !tool || tool.kind !== 'tool') return { kind: 'unknown' };
    const batchHash = agentBudgetFingerprint({ calls, units: calls.length });
    if (tool.originalAttemptKey !== modelKey + ':tool-batch' || tool.requestFingerprint !== batchHash || tool.units !== calls.length
      || root.attempts.length !== 2 || root.used.modelCalls !== 1 || root.used.toolCalls !== calls.length
      || !root.attempts.some(entry => entry.kind === 'model' && entry.key === modelKey && entry.fingerprint === model.requestFingerprint && entry.units === 1)
      || !root.attempts.some(entry => entry.kind === 'tool_batch' && entry.key === tool.originalAttemptKey && entry.fingerprint === batchHash && entry.units === calls.length)) return { kind: 'unknown' };
    if (calls[0].name === 'stage_private_summary' && typeof calls[0].args?.text === 'string'
      && agentBudgetFingerprint(answers[0].response) === agentBudgetFingerprint({ status: 'succeeded', data: { staged: true, saved: false } }))
      return { kind: 'terminal', text: calls[0].args.text, counts: root.used, tools: [{ name: calls[0].name, status: 'succeeded' }], evidenceHash };
    return { kind: 'unknown' };
  } };
  const build = (custom: { terminalVerifier?: SummaryTerminalVerifier; policy?: SummaryWorkPolicyPort } = {}) =>
    createFirestorePrivateSummaryWork({ ...f.options, memory: f.memory, runs: f.runs, policy, terminalVerifier: verifier, ...custom });
  await beforeStart?.(f);
  await f.barrier(); const started = await build().start('owner', f.childId, { kind: 'next_fresh' });
  if (started.kind !== 'created') throw new Error('Expected created work'); await f.saveProfile(started.work.grantRecordId);
  async function claim(work: PrivateSummaryWork, reference: string, endUtf16 = f.message.text.length) {
    const claimed = await build().claimPart('owner', f.childId, work.id, reference); assert.equal(claimed.decision, 'execute');
    const context = f.context(claimed.claim); await build().bindRootContext(claimed.claim.scope, claimed.claim.runId, claimed.attempt.id, context);
    const content = { role: 'user', parts: [{ text: JSON.stringify({ source: f.message.text.slice(work.chain.next.offsetUtf16, endUtf16), accumulator: work.accumulator }) }] };
    const requestFingerprint = agentBudgetFingerprint({ contents: [content] });
    const plan: SummaryPartPlan = { binding: claimed.attempt.binding, manifestHash: work.manifestHash,
      range: { unitIndex: work.chain.next.unitIndex, startUtf16: work.chain.next.offsetUtf16, endUtf16, metadataOnly: false },
      priorAccumulatorHash: work.chain.accumulatorHash, requestFingerprint, outputTextLimit: 500 };
    const modelAttemptKey = 'model:' + agentBudgetFingerprint([claimed.claim.runId, claimed.claim.trigger, 'first-model']);
    const config = readAiConfig(f.profile.env), originalDailyRequest = { kind: 'model' as const, rootRunId: claimed.claim.runId,
      attemptKey: modelAttemptKey, bindingFingerprint: agentBudgetFingerprint(context), requestFingerprint, userId: 'owner', childId: f.childId,
      model: f.grant.model, deadlineAtMs: context.binding.deadlineAtMs, userLimit: config.dailyUserAttempts, globalLimit: config.dailyGlobalAttempts };
    const input = { scope: claimed.claim.scope, runId: claimed.claim.runId, attemptId: claimed.attempt.id, plan, modelAttemptKey, originalDailyRequest };
    return { input, claimed, context, content };
  }
  async function part(work: PrivateSummaryWork, reference: string, endUtf16 = f.message.text.length, observed: 'terminal' | 'failure' = 'terminal') {
    const { input, claimed, context, content } = await claim(work, reference, endUtf16);
    const { modelAttemptKey, originalDailyRequest } = input, requestFingerprint = input.plan.requestFingerprint;
    await build().reservePart(input); await f.root.open(context);
    await f.root.reserve(context, { kind: 'model', key: modelAttemptKey, fingerprint: requestFingerprint, units: 1 });
    await f.daily.reserve(originalDailyRequest);
    const text = 'Synthetic folded summary step ' + work.chain.committedParts;
    const call = { id: randomUUID(), name: 'stage_private_summary', args: { text } };
    const batchHash = agentBudgetFingerprint({ calls: [call], units: 1 });
    if (observed === 'terminal') {
      await build().reserveToolBatch({ scope: input.scope, runId: input.runId, attemptId: input.attemptId,
      toolBatchKey: modelAttemptKey + ':tool-batch', requestFingerprint: batchHash, units: 1 });
      await f.root.reserve(context, { kind: 'tool_batch', key: modelAttemptKey + ':tool-batch', fingerprint: batchHash, units: 1 });
    }
    await f.daily.record(originalDailyRequest, { outcome: 'succeeded', inputTokens: 12, outputTokens: 3, cachedTokens: 0, durationMs: 1 });
    const key = { appName: 'yuban_hk', userId: 'owner', sessionId: input.runId }, session = await f.sessions.createSession(key);
    const invocationId = randomUUID(), at = Date.now() / 1000;
    const events = [createEvent({ id: randomUUID(), invocationId, author: 'user', timestamp: at, content })];
    if (observed === 'terminal') {
      events.push(createEvent({ id: randomUUID(), invocationId, author: 'yuban_agent', timestamp: at + 1,
        content: { role: 'model', parts: [{ functionCall: call }] } }));
      events.push(createEvent({ id: randomUUID(), invocationId, author: 'yuban_agent', timestamp: at + 2,
        content: { role: 'user', parts: [{ functionResponse: { id: call.id, name: call.name,
          response: { status: 'succeeded', data: { staged: true, saved: false } } } }] } }));
    } else events.push(createEvent({ id: randomUUID(), invocationId, author: 'yuban_agent', timestamp: at + 1,
      turnComplete: true, content: { role: 'model', parts: [{ text: 'A complete ordinary model response without the required terminal tool.' }] } }));
    for (const event of events) await f.sessions.appendEvent({ session, event });
    const result: ProductAgentResult = { runId: input.runId, status: observed === 'terminal' ? 'completed' : 'stopped',
      stopReason: observed === 'terminal' ? null : 'invalid_response', ...(observed === 'terminal' ? { outcome: 'no_action' as const } : {}),
      provenance: { packVersion: f.grant.promptPackVersion, recipeId: 'memory-refresh', model: f.grant.model }, countsKnown: true,
      text: '', citations: [], privateSourceCitations: [], retrievalMode: 'not_used', proposals: [],
      tools: observed === 'terminal' ? [{ name: call.name, status: 'succeeded' }] : [], counts: { modelCalls: 1, toolCalls: observed === 'terminal' ? 1 : 0, queryEmbeddings: 0 } };
    return { input, claimed, context, key, session, events, result, text, finish: { scope: input.scope, runId: input.runId,
      attemptId: input.attemptId, result, text: observed === 'terminal' ? text : null } };
  }
  return { ...f, policy, verifier, build, work: started.work, claim, part, dueAt };
}
