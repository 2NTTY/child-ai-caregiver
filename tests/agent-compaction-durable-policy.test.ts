import { z } from 'zod';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { FinishReason } from '@google/genai';
import { InMemorySessionService } from '@google/adk';
import { agentBudgetFingerprint } from '../server/agent-budget.ts';
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
import type { RootBudgetContext, DurableRootBudget } from '../server/durable-root-budget.ts';
import type { AgentModelProvider } from '../server/agent-model-gateway.ts';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';
import { firestoreUsageFixture } from './helpers/firestore-ai-usage.ts';

type Boundary = 'reserve-tighten' | 'reserve-revoke';
async function runtimeBoundary(mode: Boundary) {
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
      roleSoftBudgetRatios: next === undefined ? {} : { interactive: next, reviewer: next },
    } });
  }
  await change(0.8);
  const routing = createFirestoreModelRouting(options, config), selected = await routing.resolve('owner', 'interactive');
  const u = firestoreUsageFixture(Date.now()), root = new FirestoreRootBudget({ ...u.options, namespace: 'policy_root' });
  const daily = new FirestoreAiUsage(u.options), requests: DurableAiUsageRequest[] = [], sent: string[] = [];
  let reservations = 0;
  const rootAdapter: DurableRootBudget = {
    open: c => root.open(c), read: c => root.read(c), reserve: (c, a) => root.reserve(c, a),
    settle: (c, a, s) => root.settle(c, a, s), stop: c => root.stop(c),
    async prepareModelDispatch(...args) {
      const result = await root.prepareModelDispatch(...args);
      return result;
    },
  };
  const dailyAdapter: DurableAiUsage = {
    billingSource: daily.billingSource, read: r => daily.read(r), record: (r, s) => daily.record(r, s), getForUser: id => daily.getForUser(id),
    async reserve(request) {
      requests.push(structuredClone(request));
      const admitted = await daily.reserve(request);
      reservations++;
      if (reservations === 2) {
        await new Promise(resolve => setTimeout(resolve, 5));
        await change(0.8, !mode.endsWith('revoke'), mode.endsWith('tighten') ? 1 : 6);
      }
      return admitted;
    },
    prepareModelDispatch: (...args) => daily.prepareModelDispatch(...args),
  };
  const prompt = await loadAgentPrompt('product-interactive', 'tool_cycle', ['run', 'scope', 'conversation', 'context', 'evidence', 'capabilities']);
  const runId = randomUUID(), reference = randomUUID();
  const context: RootBudgetContext = { generation: 1, binding: { rootRunId: runId, ownerId: 'owner', workspaceId: 'workspace',
    childId: 'child', authorizationVersion: '1', storageEpoch: 'epoch', trigger: { kind: 'interactive', reference },
    workflowVersion: 'synthetic-workflow', promptPackVersion: prompt.packVersion, settingsVersion: 'fixed-settings',
    billingVersion: 'fixed-platform', limits: { modelCalls: 6, toolCalls: 16, queryEmbeddings: 3 }, deadlineAtMs: Date.now() + 90_000 } };
  const provider: AgentModelProvider = { async generate(request) {
    sent.push(agentBudgetFingerprint({ model: selected.config.model, contents: request.contents, config: request.config }));
    if (sent.length === 1) return { content: { role: 'model', parts: [{ functionCall: { id: 'call', name: 'read_context', args: {} } }] },
      finishReason: FinishReason.STOP, usageMetadata: { promptTokenCount: 240, totalTokenCount: 260 } };
    return { content: { role: 'model', parts: [{ text: 'Synthetic completed answer' }] }, finishReason: FinishReason.STOP };
  } };
  const runtime = createAgentRuntime({ config: selected.config, provider, nativeSessionService: new InMemorySessionService(),
    usage: { reserve: async () => { throw new Error('Legacy reservation forbidden'); }, record: async () => { throw new Error('Legacy accounting forbidden'); } },
    durableBudget: { adapter: rootAdapter, context, dailyUsage: dailyAdapter, runLimits: selected.runLimits } });
  const result = await runtime.run({ runId, scope: { userId: 'owner', childId: 'child', workspaceId: 'workspace', authorizationVersion: '1', dataVersion: '1' },
    recipeId: 'p1-chat', trigger: { kind: 'interactive', reference }, messages: [{ role: 'user', text: 'Synthetic policy preparation boundary' }], contextCompaction: { tokenThreshold: 80, eventRetentionSize: 1 },
    tools: [{ name: 'read_context', description: 'Read synthetic context', parameters: z.object({}), authorize: async () => true,
      execute: async () => ({ status: 'succeeded', data: { note: 'Synthetic result' } }) }],
    authorize: selected.authorize, roleSoftBudgetRatios: selected.roleSoftBudgetRatios, readPolicyTransition: selected.readPolicyTransition,

  });
  const ledger = await root.read(context), usage = await daily.getForUser('owner');
  assert.deepEqual(ledger.used, result.counts);
  assert.equal(usage.attempts, reservations);
  assert.equal(ledger.attempts.filter(a => a.kind === 'model').length, reservations);
  assert.equal(new Set(requests.map(r => r.attemptKey)).size, requests.length);
  assert.equal(reservations, 2, 'Compaction reaches durable daily admission');
  assert.equal(sent.length, 1, 'No stale compaction request reaches the provider');
  assert.equal(result.status, 'stopped');
  assert.equal(result.counts.modelCalls, 2, 'Committed reservations are not refunded or replayed');
  if (mode.endsWith('tighten')) assert.equal(result.stopReason, 'model_limit');
}
for (const mode of ['reserve-tighten', 'reserve-revoke'] as const)
  test(`compaction durable daily boundary: ${mode}`, () => runtimeBoundary(mode));
