import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentBudget, AgentStopped, agentBudgetFingerprint } from '../server/agent-budget.ts';
import { FirestoreAiUsage } from '../server/firestore-ai-usage.ts';
import { DurableAiUsageError, type DurableAiUsageRequest, type DurableEmbeddingUsageRecord } from '../server/durable-ai-usage.ts';
import { FirestoreRootBudget } from '../server/firestore-root-budget.ts';
import { createEmbeddingGateway } from '../server/embedding-gateway.ts';
import { createKnowledgeRetriever } from '../server/knowledge-retriever.ts';
import { readAiConfig } from '../server/ai-config.ts';
import type { RootBudgetContext } from '../server/durable-root-budget.ts';
import { firestoreUsageFixture } from './helpers/firestore-ai-usage.ts';

const now = Date.parse('2026-10-09T12:00:00Z');
const request = (patch: Partial<DurableAiUsageRequest> = {}): DurableAiUsageRequest => ({ kind: 'model', rootRunId: 'synthetic-root',
  attemptKey: 'model:original-step', bindingFingerprint: agentBudgetFingerprint('original-bound-scope'), requestFingerprint: agentBudgetFingerprint('synthetic-original-request'),
  userId: 'synthetic-user', childId: 'synthetic-child', model: 'synthetic-model', deadlineAtMs: now + 90000, userLimit: 3, globalLimit: 3, ...patch });
const modelRecord = { kind: 'model' as const, outcome: 'succeeded' as const, inputTokens: 12, outputTokens: 3, cachedTokens: 4, durationMs: 25 };
const embeddingRecord: DurableEmbeddingUsageRecord = { kind: 'embedding', outcome: 'succeeded', inputTokens: 4, billableCharacters: 12, durationMs: 10 };
const code = (value: string) => (error: unknown) => error instanceof DurableAiUsageError && error.code === value;
const embeddingRequest = (patch: Partial<DurableAiUsageRequest> = {}) => request({ kind: 'embedding', attemptKey: 'embedding:original-call', model: 'gemini-embedding-001', ...patch });

test('shared daily kinds use the same counters without invented token fields and reject crossed records or attempt identities', async () => {
  const f = firestoreUsageFixture(), model = request(), embedding = embeddingRequest(), partial = embeddingRequest({ attemptKey: 'embedding:partial' });
  await f.service.reserve(model); await f.service.record(model, modelRecord);
  await f.service.reserve(embedding); await f.service.record(embedding, embeddingRecord);
  await f.service.reserve(partial); await f.service.record(partial, { ...embeddingRecord, inputTokens: null, billableCharacters: 999 });
  assert.deepEqual(await f.service.getForUser(model.userId), { day: '2026-10-09', attempts: 3, inputTokens: 16, outputTokens: 3, cachedTokens: 4,
    unknownUsageAttempts: 1, billingSource: 'platform' });
  assert.equal((await f.service.read(embedding))?.kind, 'embedding');
  assert.deepEqual((await f.service.read(embedding))?.record, embeddingRecord);
  const before = structuredClone([...f.records]);
  for (const kind of ['model', 'embedding'] as const) assert.equal((await f.service.reserve(request({ kind, attemptKey: `${kind}:next` }))).decision, 'quota_exceeded');
  await assert.rejects(f.service.reserve({ ...model, kind: 'embedding' }), code('attempt_conflict'));
  await assert.rejects(f.service.read({ ...embedding, kind: 'model' }), code('attempt_conflict'));
  await assert.rejects(f.service.record(model, embeddingRecord), code('record_kind_conflict'));
  await assert.rejects(f.service.record(embedding, modelRecord), code('record_kind_conflict'));
  await assert.rejects(f.service.record({ ...embedding, kind: 'model' }, modelRecord), code('attempt_conflict'));
  assert.deepEqual([...f.records], before);
});

test('legacy model lookup and idempotent accounting preserve original request payloads and ciphertext without kind normalization', async () => {
  const f = firestoreUsageFixture(), { kind: _kind, ...legacy } = request(), { kind: _recordKind, ...legacyRecord } = modelRecord;
  await f.service.reserve(legacy); await f.service.record(legacy, legacyRecord);
  const before = structuredClone([...f.records]), original = await f.service.read(legacy);
  assert.deepEqual(original, { day: '2026-10-09', reservedAtMs: now, record: legacyRecord });
  const restarted = new FirestoreAiUsage(f.options);
  assert.deepEqual(await restarted.read(request()), original);
  assert.deepEqual(await restarted.reserve(request()), { decision: 'lookup', receipt: original });
  assert.deepEqual(await restarted.record(request(), modelRecord), original);
  assert.deepEqual([...f.records], before);
  const pending = { ...legacy, attemptKey: 'model:pending' }; await restarted.reserve(pending);
  await restarted.record({ ...pending, kind: 'model' }, modelRecord);
  assert.equal((await restarted.read(pending))?.record?.kind, 'model');
  const stored = [...f.records].find(([path]) => path.endsWith('attempt_' + agentBudgetFingerprint([pending.rootRunId, pending.attemptKey])))!;
  const envelope = stored[1] as { ciphertext: string };
  const aad = JSON.stringify(['yuban-ai-daily-usage', 1, f.options.projectId, f.options.namespace, stored[0].split('/').at(-1)]);
  assert.equal(Object.hasOwn(JSON.parse(f.options.cipher.decrypt(envelope.ciphertext, aad)).request, 'kind'), false);
});

test('embedding replay after a lost acknowledgement and UTC rollover only reads or settles the original attempt', async () => {
  const midnight = Date.parse('2026-10-09T23:59:59Z'), f = firestoreUsageFixture(midnight), input = embeddingRequest({ deadlineAtMs: midnight + 90000 });
  f.loseReply(); await assert.rejects(f.service.reserve(input), /Synthetic lost commit reply/u);
  f.setNow(midnight + 100000); const restarted = new FirestoreAiUsage(f.options);
  assert.deepEqual(await restarted.read(input), { kind: 'embedding', day: '2026-10-09', reservedAtMs: midnight, record: null });
  assert.equal((await restarted.reserve(input)).decision, 'lookup'); assert.equal((await restarted.getForUser(input.userId)).attempts, 0);
  f.loseReply(); await assert.rejects(restarted.record(input, embeddingRecord), /Synthetic lost commit reply/u);
  assert.deepEqual((await restarted.record(input, embeddingRecord)).record, embeddingRecord);
  assert.equal((await restarted.getForUser(input.userId)).inputTokens, 0);
  await assert.rejects(restarted.record(input, { ...embeddingRecord, inputTokens: 99 }), code('record_conflict'));
  f.setNow(midnight);
  assert.deepEqual(await restarted.getForUser(input.userId), { day: '2026-10-09', attempts: 1, inputTokens: 4, outputTokens: 0, cachedTokens: 0,
    unknownUsageAttempts: 0, billingSource: 'platform' });
});


test('durable authority failures never become provider keyword degradation', async () => {
  for (const mode of ['before-provider-auth', 'root', 'after-provider-auth', 'provider']) {
    const f = firestoreUsageFixture(Date.now());
    const context: RootBudgetContext = { generation: 1, binding: { rootRunId: '00000000-0000-4000-8000-000000000001', ownerId: 'synthetic-user',
      workspaceId: 'synthetic-workspace', childId: 'synthetic-child', authorizationVersion: '1', storageEpoch: 'synthetic-epoch',
      trigger: { kind: 'interactive', reference: 'synthetic-message' }, workflowVersion: 'synthetic-workflow', promptPackVersion: 'synthetic-pack',
      settingsVersion: 'synthetic-settings', billingVersion: 'synthetic-platform', limits: { modelCalls: 4, toolCalls: 8, queryEmbeddings: 2 }, deadlineAtMs: Date.now() + 90000 } };
    const root = new FirestoreRootBudget({ ...f.options, namespace: 'synthetic_root' }), budget = new AgentBudget(undefined, 90000, context.binding.deadlineAtMs);
    let providers = 0, sql = 0, candidates = 0, authorizations = 0, reserved = false;
    const reserve = f.service.reserve.bind(f.service), read = root.read.bind(root);
    f.service.reserve = async input => { const result = await reserve(input); reserved = true; return result; };
    root.read = async input => { if (mode === 'root' && reserved) throw new Error('Synthetic root store unavailable'); return read(input); };
    await budget.initializeDurable({ adapter: root, context, dailyUsage: f.service });
    const authorize = async () => {
      authorizations++;
      if (mode === 'before-provider-auth' && authorizations === 3 || mode === 'after-provider-auth' && authorizations === 4)
        throw new Error('Synthetic authorization store unavailable');
      return true;
    };
    const gateway = createEmbeddingGateway({ config: readAiConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: 'synthetic-project' }),
      usage: { reserve: async () => { sql++; throw new Error('SQL forbidden'); }, record: async () => { sql++; throw new Error('SQL forbidden'); } },
      provider: { embed: async () => { providers++; if (mode === 'provider') throw new Error('Synthetic provider unavailable');
        return { values: [1, ...Array<number>(1023).fill(0)], inputTokens: 4, billableCharacters: 12 }; } } });
    const run = createKnowledgeRetriever({ candidates: async () => { candidates++; return []; } }, gateway)
      .createRun({ actor: { kind: 'query_embedding', actorId: context.binding.ownerId, operationId: context.binding.rootRunId }, budget, authorize });
    try {
      const search = () => run.search('合成知識', { region: 'HK', classification: 'official_guidance', age: null, topics: [] }, 'embedding:original-call');
      if (mode === 'provider') assert.equal((await search()).mode, 'keyword_degraded');
      else await assert.rejects(search(), (error: unknown) => error instanceof AgentStopped && error.reason === 'unavailable', mode);
      assert.equal(providers, mode === 'provider' || mode === 'after-provider-auth' ? 1 : 0, mode);
      assert.equal(candidates, mode === 'provider' ? 1 : 0, mode); assert.equal(sql, 0, mode);
      assert.equal((await f.service.getForUser(context.binding.ownerId)).attempts, 1, mode);
    } finally { budget.close(); }
  }
});
