import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { ApiError, FinishReason } from '@google/genai';
import { InMemorySessionService } from '@google/adk';
import { AgentBudget, agentBudgetFingerprint } from '../server/agent-budget.ts';
import { createAgentRuntime } from '../server/agent-runtime.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreAdmin } from '../server/firestore-admin.ts';
import { createFirestoreModelRouting } from '../server/firestore-model-routing.ts';
import { FirestoreRootBudget } from '../server/firestore-root-budget.ts';
import { FirestoreAiUsage } from '../server/firestore-ai-usage.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { readAiConfig } from '../server/ai-config.ts';
import { loadAgentPrompt } from '../server/agent-prompt.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import type { DurableAiUsage, DurableAiUsageRequest } from '../server/durable-ai-usage.ts';
import type { RootBudgetContext, DurableRootBudget, BudgetAttempt } from '../server/durable-root-budget.ts';
import type { AgentModelProvider } from '../server/agent-model-gateway.ts';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';
import { firestoreUsageFixture } from './helpers/firestore-ai-usage.ts';

type Boundary = 'admission' | 'retry' | 'root-refresh' | 'daily-refresh' | 'revoke' | 'revoke-refresh' | 'root-lost-reply' | 'daily-lost-reply' | 'retry-tighten';
async function runtimeBoundary(mode: Boundary, ratio: number | undefined) {
  const f = firestoreDomainFixture();
  const options = { database: f.database, cipher: createStorageCipher(Buffer.alloc(32, 31)),
    projectId: 'synthetic-policy-preparation', namespace: 'policy_preparation' };
  const authority = createFirestoreAuthority(options);
  await authority.initializeControl({ generation: randomUUID(), enabled: true });
  await authority.issueInvitation({ email: 'owner@example.test', expiresAt: new Date(Date.now() + 60_000).toISOString(), operationId: randomUUID() });
  await authority.admitIdentity({ userId: 'owner', email: 'owner@example.test', emailVerified: true });
  await authority.acknowledge({ userId: 'owner', operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  const config = readAiConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: options.projectId });
  const admin = createFirestoreAdmin(options, config);
  async function change(next: number | undefined, enabled = true, maxModelCalls = 6) {
    const p = await admin.readPolicy();
    await admin.submit('admin-1', { opId: randomUUID(), kind: 'policy', expectedVersion: p.version, values: {
      enabled, model: p.model, dailyUserAttempts: p.dailyUserAttempts, dailyGlobalAttempts: p.dailyGlobalAttempts,
      personalDailyGlobalAttempts: p.personalDailyGlobalAttempts, maxModelCalls, maxQueryEmbeddings: 3,
      maxToolCalls: 16, maxRunSeconds: 180, modelRequestSeconds: 45, maxModelRetries: 1, softBudgetRatio: 0.4,
      roleSoftBudgetRatios: next === undefined ? {} : { interactive: next },
    } });
  }
  await change(0.8);
  const routing = createFirestoreModelRouting(options, config), selected = await routing.resolve('owner', 'interactive');
  const u = firestoreUsageFixture(Date.now()), root = new FirestoreRootBudget({ ...u.options, namespace: 'policy_root' });
  const daily = new FirestoreAiUsage(u.options), requests: DurableAiUsageRequest[] = [], sent: string[] = [], ratios: number[] = [];
  const beforeCounts: number[] = [];
  let reservations = 0, rootRefreshes = 0, dailyRefreshes = 0;
  const rootAdapter: DurableRootBudget = {
    open: c => root.open(c), read: c => root.read(c), reserve: (c, a) => root.reserve(c, a),
    settle: (c, a, s) => root.settle(c, a, s), stop: c => root.stop(c),
    async prepareModelDispatch(...args) {
      const result = await root.prepareModelDispatch(...args);
      if (++rootRefreshes === 1) {
        if (mode === 'root-refresh') await change(0.31);
        if (mode === 'revoke-refresh') await change(ratio, false);
        if (mode === 'root-lost-reply') throw new Error('Synthetic committed preparation reply lost');
      }
      return result;
    },
  };
  const dailyAdapter: DurableAiUsage = {
    billingSource: daily.billingSource, read: r => daily.read(r), record: (r, s) => daily.record(r, s), getForUser: id => daily.getForUser(id),
    async reserve(request) {
      requests.push(structuredClone(request));
      const admitted = await daily.reserve(request);
      reservations++;
      if (reservations === 1 && mode !== 'retry' && mode !== 'retry-tighten') await change(ratio, mode !== 'revoke');
      if (reservations === 2 && mode === 'retry-tighten') await change(ratio, true, 1);
      return admitted;
    },
    async prepareModelDispatch(...args) {
      const result = await daily.prepareModelDispatch(...args);
      if (++dailyRefreshes === 1) {
        if (mode === 'daily-refresh') await change(0.37);
        if (mode === 'daily-lost-reply') throw new Error('Synthetic committed preparation reply lost');
      }
      return result;
    },
  };
  const prompt = await loadAgentPrompt('product-interactive', 'tool_cycle', ['run', 'scope', 'conversation', 'context', 'evidence', 'capabilities']);
  const runId = randomUUID(), reference = randomUUID();
  const context: RootBudgetContext = { generation: 1, binding: { rootRunId: runId, ownerId: 'owner', workspaceId: 'workspace',
    childId: 'child', authorizationVersion: '1', storageEpoch: 'epoch', trigger: { kind: 'interactive', reference },
    workflowVersion: 'synthetic-workflow', promptPackVersion: prompt.packVersion, settingsVersion: 'fixed-settings',
    billingVersion: 'fixed-platform', limits: { modelCalls: 6, toolCalls: 16, queryEmbeddings: 3 }, deadlineAtMs: Date.now() + 90_000 } };
  const provider: AgentModelProvider = { async generate(request) {
    const metadata = JSON.parse(String(request.config?.systemInstruction).split('Server runtime metadata:\n')[1]!.split('\n')[0]!);
    ratios.push(metadata.budget.softBudgetRatio); beforeCounts.push(metadata.budget.usedBeforeThisCall.modelCalls);
    sent.push(agentBudgetFingerprint({ model: selected.config.model, contents: request.contents, config: request.config }));
    if ((mode === 'retry' || mode === 'retry-tighten') && sent.length === 1) { if (mode === 'retry') await change(ratio); throw new ApiError({ status: 503, message: 'Synthetic policy-change retry' }); }
    return { content: { role: 'model', parts: [{ text: 'Synthetic completed answer' }] }, finishReason: FinishReason.STOP };
  } };
  const runtime = createAgentRuntime({ config: selected.config, provider, nativeSessionService: new InMemorySessionService(),
    usage: { reserve: async () => { throw new Error('Legacy reservation forbidden'); }, record: async () => { throw new Error('Legacy accounting forbidden'); } },
    durableBudget: { adapter: rootAdapter, context, dailyUsage: dailyAdapter, runLimits: selected.runLimits } });
  const result = await runtime.run({ runId, scope: { userId: 'owner', childId: 'child', workspaceId: 'workspace', authorizationVersion: '1', dataVersion: '1' },
    recipeId: 'p1-chat', trigger: { kind: 'interactive', reference }, messages: [{ role: 'user', text: 'Synthetic policy preparation boundary' }], tools: [],
    authorize: selected.authorize, roleSoftBudgetRatios: selected.roleSoftBudgetRatios, readPolicyTransition: selected.readPolicyTransition });
  const ledger = await root.read(context), usage = await daily.getForUser('owner');
  assert.deepEqual(ledger.used, result.counts);
  assert.equal(usage.attempts, reservations);
  assert.equal(ledger.attempts.length, reservations);
  assert.equal(new Set(requests.map(r => r.attemptKey)).size, requests.length);
  if (mode === 'retry-tighten') {
    assert.equal(sent.length, 1); assert.equal(result.status, 'stopped'); assert.equal(result.stopReason, 'model_limit');
    assert.equal(result.counts.modelCalls, 2, 'Lowered hard limit cannot refund admitted attempts or dispatch a second provider call');
  } else if (mode === 'revoke' || mode === 'revoke-refresh' || mode === 'root-lost-reply' || mode === 'daily-lost-reply') {
    assert.equal(sent.length, 0); assert.notEqual(result.status, 'completed');
    assert.equal(result.counts.modelCalls, 1, 'Unknown/revoked admission is not refunded or replayed');
  } else {
    assert.equal(result.status, 'completed', JSON.stringify(result));
    const view = await routing.view('owner');
    assert.equal(ratios.at(-1), view.effective!.softBudgetRatio);
    assert.deepEqual(beforeCounts, mode === 'retry' ? [0, 1] : [0]);
    assert.equal(sent.length, mode === 'retry' ? 2 : 1);
    for (let i = 0; i < sent.length; i++) {
      const original = requests[i]!, saved = ledger.attempts.find(a => a.key === original.attemptKey)!;
      assert.equal(saved.fingerprint, original.requestFingerprint, 'Original intent fingerprint is immutable');
      assert.equal(saved.preparedFingerprint ?? saved.fingerprint, sent[i], 'Root binds the exact dispatched payload');
      const receipt = await daily.read(original);
      assert.equal(receipt!.preparedFingerprint ?? original.requestFingerprint, sent[i], 'Daily ledger binds the same payload');
    }
  }
}
for (const ratio of [0.05, 0.23, undefined]) {
  test(`admission transparently refreshes current role ratio ${ratio ?? 'cleared'}`, () => runtimeBoundary('admission', ratio));
  test(`technical retry transparently refreshes current role ratio ${ratio ?? 'cleared'}`, () => runtimeBoundary('retry', ratio));
}
for (const mode of ['root-refresh', 'daily-refresh', 'revoke', 'revoke-refresh', 'root-lost-reply', 'daily-lost-reply', 'retry-tighten'] as const)
  test(`mutable-policy preparation boundary: ${mode}`, () => runtimeBoundary(mode, 0.23));

function ledgerFixture() {
  const f = firestoreUsageFixture(Date.now());
  const root = new FirestoreRootBudget({ ...f.options, namespace: 'owner_root' });
  const context: RootBudgetContext = { generation: 1, binding: { rootRunId: randomUUID(), ownerId: 'owner', childId: 'child', workspaceId: 'workspace',
    authorizationVersion: 'auth-1', storageEpoch: 'epoch', trigger: { kind: 'interactive', reference: 'synthetic' }, workflowVersion: 'workflow',
    promptPackVersion: 'prompt', settingsVersion: 'settings', billingVersion: 'billing', limits: { modelCalls: 4, toolCalls: 8, queryEmbeddings: 2 }, deadlineAtMs: Date.now() + 90_000 } };
  const attempt: Extract<BudgetAttempt, { kind: 'model' }> = { kind: 'model', units: 1, key: 'synthetic-model', fingerprint: 'a'.repeat(64) };
  const request: DurableAiUsageRequest = { kind: 'model', rootRunId: context.binding.rootRunId, attemptKey: attempt.key,
    bindingFingerprint: agentBudgetFingerprint(context), requestFingerprint: attempt.fingerprint, userId: 'owner', childId: 'child', model: 'synthetic-model',
    deadlineAtMs: context.binding.deadlineAtMs, userLimit: 10, globalLimit: 100 };
  return { ...f, root, context, attempt, request };
}
test('preparation requires the original execute owner, CAS, active binding and unrecorded state without changing counters', async () => {
  const f = ledgerFixture(), daily = new FirestoreAiUsage(f.options);
  await f.root.open(f.context);
  const rootPermit = await f.root.reserve(f.context, f.attempt), dayPermit = await daily.reserve(f.request);
  assert.equal(dayPermit.decision, 'execute'); if (dayPermit.decision !== 'execute') throw new Error('Expected execute');
  assert.equal('preparationToken' in await f.root.reserve(f.context, f.attempt), false);
  assert.equal('preparationToken' in await daily.reserve(f.request), false);
  const next = 'b'.repeat(64), invalidOwner = 'c'.repeat(64);
  await assert.rejects(f.root.prepareModelDispatch(f.context, f.attempt, f.attempt.fingerprint, next, invalidOwner), { code: 'preparation_owner_conflict' });
  await assert.rejects(daily.prepareModelDispatch(f.request, f.request.requestFingerprint, next, invalidOwner), { code: 'preparation_owner_conflict' });
  await assert.rejects(f.root.prepareModelDispatch({ ...f.context, binding: { ...f.context.binding, childId: 'other-child' } }, f.attempt, f.attempt.fingerprint, next, rootPermit.preparationToken!));
  await assert.rejects(f.root.prepareModelDispatch(f.context, { ...f.attempt, fingerprint: invalidOwner }, f.attempt.fingerprint, next, rootPermit.preparationToken!), { code: 'attempt_conflict' });
  await assert.rejects(daily.prepareModelDispatch({ ...f.request, childId: 'other-child' }, f.request.requestFingerprint, next, dayPermit.preparationToken!));
  await assert.rejects(daily.prepareModelDispatch({ ...f.request, model: 'other-model' }, f.request.requestFingerprint, next, dayPermit.preparationToken!));
  await f.root.prepareModelDispatch(f.context, f.attempt, f.attempt.fingerprint, next, rootPermit.preparationToken!);
  await daily.prepareModelDispatch(f.request, f.request.requestFingerprint, next, dayPermit.preparationToken!);
  await assert.rejects(f.root.prepareModelDispatch(f.context, f.attempt, f.attempt.fingerprint, next, rootPermit.preparationToken!), { code: 'preparation_conflict' });
  await assert.rejects(daily.prepareModelDispatch(f.request, f.request.requestFingerprint, next, dayPermit.preparationToken!), { code: 'preparation_conflict' });
  assert.equal((await f.root.read(f.context)).used.modelCalls, 1); assert.equal((await daily.getForUser('owner')).attempts, 1);
  const encoded = JSON.stringify(await f.root.read(f.context));
  assert.equal(encoded.includes(rootPermit.preparationToken!), false);
  assert.equal(encoded.includes('preparationTokenHash'), false);
  await daily.record(f.request, { kind: 'model', outcome: 'succeeded', inputTokens: 1, outputTokens: 1, cachedTokens: 0, durationMs: 1 });
  await assert.rejects(daily.prepareModelDispatch(f.request, next, 'd'.repeat(64), dayPermit.preparationToken!), { code: 'record_conflict' });
  await f.root.stop(f.context);
  await assert.rejects(f.root.prepareModelDispatch(f.context, f.attempt, next, 'd'.repeat(64), rootPermit.preparationToken!), { code: 'root_stopped' });
});
test('runtime execute permit cannot be cloned, recovered, or used again after provider dispatch begins', async () => {
  const f = ledgerFixture(), budget = new AgentBudget(undefined, 90_000, f.context.binding.deadlineAtMs);
  try {
    await budget.initializeDurable({ adapter: f.root, context: f.context });
    await budget.admitModel({}, f.attempt);
    await assert.rejects(budget.prepareModelDispatch({ ...f.attempt }, f.attempt.fingerprint, 'b'.repeat(64)));
    await budget.prepareModelDispatch(f.attempt, f.attempt.fingerprint, 'b'.repeat(64));
    budget.beginModelDispatch(f.attempt);
    await assert.rejects(budget.prepareModelDispatch(f.attempt, 'b'.repeat(64), 'c'.repeat(64)));
    assert.throws(() => budget.beginModelDispatch(f.attempt));
    await assert.rejects(budget.admitModel({}, { ...f.attempt }));
    assert.equal((await f.root.read(f.context)).used.modelCalls, 1);
  } finally { budget.close(); }
});
