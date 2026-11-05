import assert from 'node:assert/strict';
import test from 'node:test';
import type { LlmRequest, AppendEventRequest, Session } from '@google/adk';
import { FinishReason } from '@google/genai';
import { privateSummaryRootFixture } from './helpers/private-summary-root.ts';
import { createFirestorePrivateSummaryWork } from '../server/firestore-private-summary-work.ts';
import { createPrivateSummaryPartMaintenance } from '../server/private-summary-part-maintenance.ts';
import { createPrivateSummaryTerminalVerifier } from '../server/private-summary-terminal.ts';
import { createAgentRuntime } from '../server/agent-runtime.ts';
import { claimedRunAssembly } from '../server/agent-run-assembly.ts';
import { FirestoreRootBudget } from '../server/firestore-root-budget.ts';
import { FirestoreAiUsage } from '../server/firestore-ai-usage.ts';
import { FirestoreSessionService } from '../server/firestore-session-service.ts';
import { agentRequestCharacters, AgentGatewayModel } from '../server/agent-model-gateway.ts';
import { AGENT_LIMITS } from '../server/agent-budget.ts';
import { loadAgentPrompt } from '../server/agent-prompt.ts';
import { readAiConfig } from '../server/ai-config.ts';
import { setPrivateSummarySequence } from './helpers/private-summary-sequence.ts';
import { summaryAttemptId } from '../server/private-summary-work.ts';

for (const output of ['short', 'maximum-escaped', 'maximum-escaped-future-metadata'] as const)
test(`D01 actual Runner drains durable fragments across new instances with ${output} accumulator and publishes only complete coverage`, async t => {
  const original = ('"\\\u0001😀\n').repeat(2000);
  assert.equal([...original].length, 10000);
  const f = await privateSummaryRootFixture(original);
  const availableInputs = ['run', 'scope', 'conversation', 'context', 'evidence', 'capabilities', 'outputContract'];
  const prompt = await loadAgentPrompt('memory-refresh', 'tool_cycle', availableInputs);
  f.grant.promptPackVersion = prompt.packVersion; f.profile.promptPackVersion = prompt.packVersion;
  const dueAt = new Date(Date.now() - 1000).toISOString();
  const policy = { ...f.policy, async resolveNextPartDueAt() { return { kind: 'due' as const, dueAt }; } };
  await f.barrier();
  const initial = createFirestorePrivateSummaryWork({ ...f.options, memory: f.memory, runs: f.runs, policy });
  const started = await initial.start('owner', f.childId, { kind: 'next_fresh' });
  assert.equal(started.kind, 'created'); if (started.kind !== 'created') throw new Error('Expected original work');
  await f.saveProfile(started.work.grantRecordId);
  const requests: LlmRequest[] = [], fragments: { text: string; range: { startUtf16: number; endUtf16: number }; accumulator: string | null }[] = [];
  let cleanups = 0, nativeModelEvents = 0;
  const finishErrors: string[] = [], runtimeResults: unknown[] = [];
  const fitChecks: unknown[] = [], gatewaySizes: number[] = [];
  const generate = AgentGatewayModel.prototype.generateContentAsync;
  AgentGatewayModel.prototype.generateContentAsync = async function* (request) {
    gatewaySizes.push(agentRequestCharacters(request)); yield* generate.call(this, request);
  };
  t.after(() => { AgentGatewayModel.prototype.generateContentAsync = generate; });
  for (let step = 0; step < f.grant.limits.modelCalls; step++) {
    if (output === 'maximum-escaped-future-metadata' && step === 1)
      setPrivateSummarySequence(f, started.work.scope.workspaceId, '9000000000000000000');
    const prior = await initial.readState('owner', f.childId, started.work.id);
    if (prior.work.state === 'completed') break;
    const attemptId = summaryAttemptId({ workId: prior.work.id, sourceRevision: prior.work.sourceRevision,
      step: prior.work.chain.committedParts, attempt: prior.work.nextAttempt });
    const root = new FirestoreRootBudget({ ...f.options, namespace: 'synthetic_summary_root' });
    const daily = new FirestoreAiUsage({ ...f.options, namespace: 'synthetic_summary_daily', billingSource: 'platform' });
    let work!: ReturnType<typeof createFirestorePrivateSummaryWork>;
    class ObservedSessions extends FirestoreSessionService {
      override async appendEvent(request: AppendEventRequest) {
        const event = await super.appendEvent(request);
        if (request.event.content?.role === 'model') nativeModelEvents++;
        return event;
      }
      override async cleanupCreatedSession(session: Session) {
        assert.ok(await work.readEffect('owner', f.childId, attemptId), 'Native evidence must survive until the original effect is committed');
        cleanups++; return super.cleanupCreatedSession(session);
      }
    }
    const sessions = new ObservedSessions({ ...f.options, namespace: 'synthetic_summary_session' });
    work = createFirestorePrivateSummaryWork({ ...f.options, memory: f.memory, runs: f.runs, policy,
      terminalVerifier: createPrivateSummaryTerminalVerifier({ root, daily, sessions }) });
    const finish = work.finishPart;
    work.finishPart = async input => { try { return await finish(input); } catch (error) {
      finishErrors.push(error instanceof Error ? String((error as Error & { code?: string }).code ?? error.message) : String(error)); throw error;
    } };
    const config = readAiConfig(f.profile.env);
    const assembly = claimedRunAssembly(config, { nativeSessionService: sessions, rootBudget: root, dailyUsage: daily,
      profile: { ...f.profile, config } }, null, false, false, true);
    const runtime = createAgentRuntime({ ...assembly, config, usage: {
      async reserve() { throw new Error('Legacy quota path is forbidden'); }, async record() { throw new Error('Legacy quota path is forbidden'); },
    }, provider: { async generate(request) {
      assert.ok(agentRequestCharacters(request) <= AGENT_LIMITS.inputCharacters, 'Measure the complete actual outgoing request');
      requests.push(structuredClone({ ...request, toolsDict: {} }));
      if (output === 'maximum-escaped-future-metadata' && step > 0) {
        assert.equal(request.config?.toolConfig?.functionCallingConfig?.mode, 'ANY', 'Real future run enters native finish shape');
        assert.match(JSON.stringify(request.config?.systemInstruction), /900000000000000000/,
          'The real provider request carries the current nineteen-digit authority sequence');
      }
      const payload = JSON.parse(request.contents[0].parts![0].text!);
      fragments.push(payload.fragment);
      assert.equal(payload.fragment.text.isWellFormed(), true);
      assert.equal(payload.fragment.text, original.slice(payload.fragment.range.startUtf16, payload.fragment.range.endUtf16));
      assert.equal(payload.fragment.accumulator, prior.work.accumulator?.text ?? null);
      const attempt = await work.readAttempt('owner', f.childId, attemptId);
      assert.equal(attempt.plan!.range.startUtf16, payload.fragment.range.startUtf16);
      const native = await sessions.getSession({ appName: 'yuban_hk', userId: 'owner', sessionId: attempt.runId });
      assert.ok(native);
      assert.ok(JSON.stringify(native.events).length < 2000, 'Only the fixed marker, never the unsegmented source, is initially persisted');
      assert.ok(!JSON.stringify(native.events).includes(original));
      return { content: { role: 'model', parts: [{ functionCall: { id: `stage-${step}`, name: 'stage_private_summary',
        args: { text: output !== 'short' ? '\u0001'.repeat(payload.outputTextLimit) : `Synthetic fold ${step}` } } }] }, finishReason: FinishReason.STOP,
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } };
    } } });
    const maintain = createPrivateSummaryPartMaintenance({ ...f.options, memory: f.memory, work, root,
      runtime: { async run(input) {
        const fit = input.fitInitialInput!;
        const result = await runtime.run({ ...input, ...(output === 'maximum-escaped-future-metadata'
          ? { deadlineMs: step === 0 ? 90_000 : step === 1 ? 9_000 : 15_000 } : {}), fitInitialInput: (fits, continuationFits) => fit(candidate => {
          const accepted = fits(candidate); fitChecks.push({ length: candidate.text.length, accepted }); return accepted;
        }, continuationFits) }); runtimeResults.push(result); return result;
      } } });
    await f.withWorkLease(prior.work.id, async reference => {
      const result = await maintain({ userId: 'owner', childId: f.childId, workId: prior.work.id, reference, authorize: async () => true });
      const observedAttempt = await work.readAttempt('owner', f.childId, attemptId);
      const observedRoot = observedAttempt.rootContext ? await root.read(observedAttempt.rootContext) : null;
      const observedNative = await sessions.getSession({ appName: 'yuban_hk', userId: 'owner', sessionId: observedAttempt.runId });
      assert.equal(result.state, 'completed', JSON.stringify({ result, requests: requests.length, attempt: observedAttempt,
        root: observedRoot, events: observedNative?.events, finishErrors, runtimeResults, fitChecks, gatewaySizes }));
      assert.ok(result.receipt);
      const current = await work.readState('owner', f.childId, prior.work.id);
      assert.equal(current.work.grantRecordId, started.work.grantRecordId);
      assert.deepEqual(current.usage.used, { modelCalls: step + 1, toolCalls: step + 1 });
      assert.equal(current.work.chain.committedParts, step + 1);
      if (result.receipt.kind === 'part_committed') assert.equal((await f.memory.summary('owner', f.childId))!.summary, null);
    });
  }
  const final = await initial.readState('owner', f.childId, started.work.id);
  assert.equal(final.work.state, 'completed'); assert.equal(final.work.finalReceipt?.kind, 'published');
  assert.ok(requests.length > 1, 'The legal escaped source must genuinely require durable continuation');
  if (output === 'maximum-escaped-future-metadata') assert.ok(requests.length > 2, 'Persisted maximum output must survive both phase and time-digit growth');
  assert.equal(fragments.map(value => value.text).join(''), original);
  assert.equal(fragments[0].range.startUtf16, 0);
  for (let index = 1; index < fragments.length; index++) assert.equal(fragments[index].range.startUtf16, fragments[index - 1].range.endUtf16);
  assert.equal(fragments.at(-1)!.range.endUtf16, original.length);
  assert.equal(f.resolutions(), 1); assert.equal(cleanups, requests.length); assert.equal(nativeModelEvents, requests.length);
  assert.deepEqual((await f.memory.summary('owner', f.childId))!.summary!.coveredMessageIds, [f.message.id]);
  assert.equal(await f.memory.prepareMaintenance('owner', f.childId), null);
});
