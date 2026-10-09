import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { InMemorySessionService } from '@google/adk';
import { FinishReason } from '@google/genai';
import { z } from 'zod';
import { createAgentRuntime, type AgentRunInput } from '../server/agent-runtime.ts';
import { readAiConfig } from '../server/ai-config.ts';
import { FirestoreRootBudget } from '../server/firestore-root-budget.ts';
import { FirestoreAiUsage } from '../server/firestore-ai-usage.ts';
import type { DurableAiUsage, DurableAiUsageRequest } from '../server/durable-ai-usage.ts';
import type { RootBudgetContext } from '../server/durable-root-budget.ts';
import { loadAgentPrompt } from '../server/agent-prompt.ts';
import { firestoreUsageFixture } from './helpers/firestore-ai-usage.ts';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve };
}
async function fixture(userLimit = 20) {
  const f = firestoreUsageFixture(Date.now()), requests: DurableAiUsageRequest[] = [];
  const config = readAiConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: 'synthetic-project', AI_DAILY_USER_ATTEMPTS: String(userLimit) });
  const prompt = await loadAgentPrompt('p1-chat', 'tool_cycle', ['run', 'scope', 'conversation', 'capabilities']);
  const context: RootBudgetContext = { generation: 1, binding: { rootRunId: 'synthetic-root', ownerId: 'synthetic-user',
    workspaceId: 'synthetic-workspace', childId: 'synthetic-child', authorizationVersion: '9007199254740993', storageEpoch: 'synthetic-epoch',
    trigger: { kind: 'interactive', reference: 'synthetic-message' }, workflowVersion: 'synthetic-workflow', promptPackVersion: prompt.packVersion,
    settingsVersion: 'fixed-settings', billingVersion: 'fixed-platform', limits: { modelCalls: 4, toolCalls: 8, queryEmbeddings: 2 }, deadlineAtMs: Date.now() + 90000 } };
  const root = new FirestoreRootBudget({ ...f.options, namespace: 'synthetic_root_budget' });
  const service = f.service;
  const daily: DurableAiUsage = { billingSource: service.billingSource,
    reserve: async request => { requests.push(structuredClone(request)); return service.reserve(request); },
    record: (request, record) => service.record(request, record), read: request => service.read(request),
    getForUser: userId => service.getForUser(userId) };
  const input: AgentRunInput = { runId: context.binding.rootRunId,
    scope: { userId: context.binding.ownerId, workspaceId: context.binding.workspaceId, childId: context.binding.childId,
      authorizationVersion: context.binding.authorizationVersion, dataVersion: 'synthetic-epoch:1' },
    trigger: { kind: 'interactive', reference: 'synthetic-message' }, recipeId: 'p1-chat',
    messages: [{ role: 'user', text: 'Synthetic original request' }], authorize: async () => true, tools: [] };
  let providers = 0;
  const success = { content: { role: 'model', parts: [{ text: 'Synthetic response' }] }, finishReason: FinishReason.STOP,
    usageMetadata: { promptTokenCount: 10, totalTokenCount: 15, cachedContentTokenCount: 2 } };
  const options = { config, nativeSessionService: new InMemorySessionService(),
    durableBudget: { adapter: root, context, dailyUsage: daily },
    usage: { reserve: async () => { throw new Error('Legacy SQL quota must not be called'); },
      record: async () => { throw new Error('Legacy SQL accounting must not be called'); } },
    provider: { generate: async () => { providers++; return success; } } };
  return { f, root, daily, requests, context, input, options, success, providerCalls: () => providers };
}

test('actual Runner uses the injected daily adapter and re-created runtimes cannot replay the original model attempt', async () => {
  const s = await fixture();
  const first = await createAgentRuntime(s.options).run(s.input);
  assert.equal(first.status, 'completed', JSON.stringify(first)); assert.equal(s.providerCalls(), 1);
  assert.deepEqual(first.counts, { modelCalls: 1, toolCalls: 0, queryEmbeddings: 0 });
  assert.equal(s.requests.length, 1); assert.equal(s.requests[0].rootRunId, s.input.runId);
  assert.equal(s.requests[0].userLimit, s.options.config.dailyUserAttempts);
  assert.deepEqual(await s.daily.getForUser(s.input.scope.userId), { day: new Date().toISOString().slice(0, 10), attempts: 1,
    inputTokens: 10, outputTokens: 5, cachedTokens: 2, unknownUsageAttempts: 0, billingSource: 'platform' });
  const second = await createAgentRuntime({ ...s.options, nativeSessionService: new InMemorySessionService(),
    durableBudget: { ...s.options.durableBudget, adapter: new FirestoreRootBudget({ ...s.f.options, namespace: 'synthetic_root_budget' }),
      dailyUsage: new FirestoreAiUsage(s.f.options) } }).run(s.input);
  assert.equal(second.status, 'stopped'); assert.equal(second.stopReason, 'unavailable');
  assert.equal(s.providerCalls(), 1); assert.equal((await s.daily.getForUser(s.input.scope.userId)).attempts, 1);
  assert.equal((await s.root.read(s.context)).used.modelCalls, 1);
});

test('two native model steps each charge once while a tool batch uses only the root tool allowance', async () => {
  const s = await fixture(); let models = 0, effects = 0;
  const result = await createAgentRuntime({ ...s.options, provider: { generate: async () => {
    models++;
    return models === 1 ? { ...s.success, content: { role: 'model', parts: [{ functionCall: { id: 'synthetic-call', name: 'read_context', args: {} } }] } } : s.success;
  } } }).run({ ...s.input, tools: [{ name: 'read_context', description: 'Read synthetic context', parameters: z.object({}),
    authorize: async () => true, execute: async () => { effects++; return { status: 'succeeded', reference: 'synthetic-reference' }; } }] });
  assert.equal(result.status, 'completed', JSON.stringify(result)); assert.equal(models, 2); assert.equal(effects, 1);
  assert.deepEqual(result.counts, { modelCalls: 2, toolCalls: 1, queryEmbeddings: 0 });
  assert.equal(new Set(s.requests.map(request => request.attemptKey)).size, 2);
  assert.equal((await s.daily.getForUser(s.input.scope.userId)).attempts, 2);
  assert.equal((await s.daily.getForUser(s.input.scope.userId)).inputTokens, 20);
});

test('daily quota rejection preserves the consumed root attempt and never dispatches or records a provider call', async () => {
  const s = await fixture(1), reserve = s.daily.reserve;
  s.daily.reserve = async request => {
    await s.f.service.reserve({ ...request, rootRunId: 'earlier-synthetic-root' });
    return reserve(request);
  };
  const result = await createAgentRuntime(s.options).run(s.input);
  assert.equal(result.stopReason, 'quota_exceeded'); assert.equal(s.providerCalls(), 0);
  assert.equal((await s.root.read(s.context)).used.modelCalls, 1);
  assert.equal((await s.daily.getForUser(s.input.scope.userId)).attempts, 1);
  assert.equal(await s.daily.read(s.requests[0]), null);
});

for (const mode of ['lost-reply', 'lookup'] as const) test(`daily ${mode} stops provider dispatch without a new attempt or legacy fallback`, async () => {
  const s = await fixture(), reserve = s.daily.reserve;
  s.daily.reserve = async request => {
    if (mode === 'lost-reply') s.f.loseReply();
    else await s.f.service.reserve(request);
    return reserve(request);
  };
  const result = await createAgentRuntime(s.options).run(s.input);
  assert.equal(result.status, 'stopped'); assert.equal(result.stopReason, 'unavailable'); assert.equal(s.providerCalls(), 0);
  assert.equal((await s.root.read(s.context)).used.modelCalls, 1);
  assert.equal((await s.daily.getForUser(s.input.scope.userId)).unknownUsageAttempts, 1);
  assert.equal((await s.daily.read(s.requests[0]))?.record, null);
});

test('cancellation during a provider request preserves unknown accounting and ignores the late successful result', async () => {
  const s = await fixture(), entered = deferred(), released = deferred(), recorded = deferred(), cancellation = new AbortController();
  let providers = 0; const record = s.daily.record;
  s.daily.record = async (request, result) => { const value = await record(request, result); recorded.resolve(); return value; };
  const running = createAgentRuntime({ ...s.options, provider: { generate: async () => {
    providers++; entered.resolve(); await released.promise; return s.success;
  } } }).run({ ...s.input, signal: cancellation.signal });
  await entered.promise; cancellation.abort();
  const result = await running; await recorded.promise;
  assert.equal(result.stopReason, 'cancelled'); assert.equal(result.text, null);
  const receipt = await s.daily.read(s.requests[0]); assert.equal(receipt?.record?.outcome, 'timeout');
  assert.equal(receipt?.record?.inputTokens, null); assert.equal((await s.daily.getForUser(s.input.scope.userId)).unknownUsageAttempts, 1);
  released.resolve(); await nextTurn();
  assert.deepEqual(await s.daily.read(s.requests[0]), receipt); assert.equal(providers, 1);
  assert.equal((await s.root.read(s.context)).used.modelCalls, 1);
});

test('root binding rejection happens before daily admission and provider dispatch', async () => {
  const s = await fixture();
  const result = await createAgentRuntime(s.options).run({ ...s.input, scope: { ...s.input.scope, authorizationVersion: '9007199254740992' } });
  assert.equal(result.stopReason, 'unavailable'); assert.equal(s.providerCalls(), 0); assert.equal(s.requests.length, 0);
  assert.equal(s.f.records.size, 0);
});
