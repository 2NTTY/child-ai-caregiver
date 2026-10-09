import { port, host, projectId, connections, blocked } from './firestore-session-emulator-guard.mjs';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
const { Firestore } = await import('@google-cloud/firestore');
const { BaseSessionService } = await import('@google/adk');
const { z } = await import('zod');
const { createAgentRuntime } = await import('../server/agent-runtime.ts');
const { agentBudgetFingerprint } = await import('../server/agent-budget.ts');
const { readAiConfig } = await import('../server/ai-config.ts');
const { createKnowledgeRetriever } = await import('../server/knowledge-retriever.ts');
const { FirestoreRootBudget } = await import('../server/firestore-root-budget.ts');
const { FirestoreSessionService } = await import('../server/firestore-session-service.ts');
const { createStorageCipher } = await import('../server/storage-crypto.ts');
const { nativeSessionProductFixture } = await import('./helpers/native-session-product.ts');
const config = readAiConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: 'synthetic-project' });
const scope = { userId: 'synthetic-native-user', childId: '1ebcb39d-a2db-4b8c-a432-7ffcb3de5808', workspaceId: 'synthetic-workspace', authorizationVersion: '1', dataVersion: 'epoch:1' };
const trigger = { kind: 'interactive', reference: '7de5a0e8-e106-4485-b7d2-3b572741da39' };
const database = new Firestore({ projectId, host: '127.0.0.1', port, ssl: false });
const suffix = randomUUID().replaceAll('-', ''), budgetNamespace = `runtime_budget_${suffix}`, sessionNamespace = `runtime_session_${suffix}`;
const storage = { database, projectId, cipher: createStorageCipher(Buffer.alloc(32, 52)) };
const budgets = new FirestoreRootBudget({ ...storage, namespace: budgetNamespace });
const sessions = new FirestoreSessionService({ ...storage, namespace: sessionNamespace });
const output = process.argv[3]; assert.ok(output);
const results = [], summary = { projectId, host, results, blocked, realProviders: 0, syntheticOnly: true, resume: false, sqlEffectFencing: false };
function context(runId = randomUUID(), patch = {}) { return { generation: 1, binding: { rootRunId: runId, ownerId: scope.userId, workspaceId: scope.workspaceId,
  childId: scope.childId, authorizationVersion: scope.authorizationVersion, storageEpoch: 'synthetic-epoch-1', trigger,
  workflowVersion: 'single-runtime-fixture-v1', promptPackVersion: '0.1.37', settingsVersion: 'fixed-synthetic-config-v1', billingVersion: 'fixed-synthetic-billing-v1',
  limits: { modelCalls: 4, toolCalls: 8, queryEmbeddings: 2 }, deadlineAtMs: Date.now() + 90_000, ...patch } }; }
function observingAdapter(onReserve) { return { open: c => budgets.open(c), read: c => budgets.read(c), reserve: (c, attempt) => onReserve(c, attempt), settle: (...args) => budgets.settle(...args), stop: c => budgets.stop(c) }; }
class ObservedSession extends BaseSessionService {
  created = 0; events = []; afterAppend;
  createSession(request) { this.created++; return sessions.createSession(request); }
  getSession(request) { return sessions.getSession(request); }
  listSessions(request) { return sessions.listSessions(request); }
  async appendEvent(request) { const result = await sessions.appendEvent(request); this.events.push(structuredClone(request.event)); await this.afterAppend?.(request); return result; }
  deleteSession(request) { return sessions.deleteSession(request); }
}
const textReply = () => ({ finishReason: 'STOP', content: { role: 'model', parts: [{ text: 'Synthetic completion' }] } });
const callsReply = calls => ({ finishReason: 'STOP', content: { role: 'model', parts: calls.map(functionCall => ({ functionCall, thoughtSignature: 'synthetic-signature' })) } });
function simple(c, { generate = textReply, tools = [], session = new ObservedSession(), adapter = budgets, input = {}, alterOptions } = {}) {
  let providers = 0, daily = 0;
  const options = { config: { ...config }, nativeSessionService: session, durableBudget: { adapter, context: c },
    usage: { reserve: async () => { daily++; return true; }, record: async () => {} }, provider: { generate: async request => { providers++; return generate(request, providers); } } };
  const runtime = createAgentRuntime(options); alterOptions?.(options);
  return { session, run: () => runtime.run({ runId: c.binding.rootRunId, scope, trigger, recipeId: 'p1-chat', messages: [{ role: 'user', text: 'Synthetic original request' }], tools, authorize: async () => true, ...input }),
    counts: () => ({ providers, daily }) };
}
const reserve = (c, attempt) => budgets.reserve(c, { fingerprint: agentBudgetFingerprint(attempt), ...attempt });
async function check(name, callback) {
  const start = Date.now();
  try { const detail = await callback(); results.push({ name, passed: true, milliseconds: Date.now() - start, ...detail }); }
  catch (error) { results.push({ name, passed: false, message: error.message, stack: error.stack }); throw error; }
  finally { await writeFile(output, JSON.stringify(summary, null, 2) + '\n'); }
}
try {
  await check('real product query, original document receipt and terminal presentation debit one persistent root', async () => {
    const c = context(), observed = new ObservedSession();
    const s = nativeSessionProductFixture(observed, c.binding.rootRunId, { durableBudget: { adapter: budgets, context: c }, searchKnowledge: true });
    const first = await s.reply(); assert.equal(first?.status, 'completed', JSON.stringify(first));
    assert.deepEqual(first.counts, { modelCalls: 4, toolCalls: 4, queryEmbeddings: 1 });
    const current = await budgets.read(c); assert.deepEqual(current.used, first.counts);
    assert.equal(s.observe().writes, 1); assert.equal(s.observe().embeddingCalls, 1); assert.equal(s.observe().embeddingReserves, 1); assert.equal(s.observe().dailyReserves, 4);
    assert.equal(current.attempts.filter(item => item.kind === 'model').length, 4);
    assert.equal(current.attempts.filter(item => item.kind === 'tool_batch').length, 4);
    const callEvent = observed.events.find(event => event.content?.parts?.some(part => part.functionCall?.id === 'knowledge-query'));
    assert.ok(callEvent?.id);
    assert.equal(current.attempts.find(item => item.kind === 'embedding').key, 'embedding:' + agentBudgetFingerprint([c.binding.rootRunId, callEvent.id, 'knowledge-query', 'query-embedding']));
    const modelAttempts = current.attempts.filter(item => item.kind === 'model');
    assert.equal(modelAttempts[0].key, 'model:' + agentBudgetFingerprint([c.binding.rootRunId, trigger, 'first-model']));
    const responses = observed.events.filter(event => event.content?.parts?.some(part => part.functionResponse));
    for (let i = 1; i < modelAttempts.length; i++) assert.equal(modelAttempts[i].key, 'model:' + agentBudgetFingerprint([c.binding.rootRunId, 'yuban_agent', null, responses[i - 1].id, 'next-model']));
    const fresh = simple(c); const replay = await fresh.run(); assert.equal(replay.stopReason, 'model_limit');
    assert.deepEqual(fresh.counts(), { providers: 0, daily: 0 }); assert.equal(fresh.session.created, 0);
    assert.deepEqual((await budgets.read(c)).used, current.used);
    return { counts: current.used, originalReceipt: s.observe().ledger[0].operationId, newRuntimeProviderCalls: 0, remainingZeroBeforeRunner: true };
  });
  await check('fresh runtime redelivery and committed lost admission acknowledgement never repeat provider or daily reserve', async () => {
    for (const lost of [false, true]) {
      const c = context(); let lostOnce = false;
      const adapter = observingAdapter(async (root, attempt) => { const value = await budgets.reserve(root, attempt);
        if (lost && !lostOnce) { lostOnce = true; throw new Error('Synthetic committed acknowledgement loss'); } return value; });
      const a = simple(c, { adapter }); const first = await a.run();
      assert.equal(first.status, lost ? 'stopped' : 'completed'); assert.equal(first.counts.modelCalls, 1);
      assert.deepEqual(a.counts(), { providers: lost ? 0 : 1, daily: lost ? 0 : 1 });
      const b = simple(c); const second = await b.run(); assert.equal(second.status, 'stopped'); assert.equal(second.stopReason, 'unavailable');
      assert.deepEqual(b.counts(), { providers: 0, daily: 0 }); assert.equal((await budgets.read(c)).used.modelCalls, 1);
    }
    return { newRuntimeInstances: 4, secondExecutions: 0 };
  });
  await check('scope, prompt pack, limits and fixed assembly mismatches refuse before storage or dispatch', async () => {
    for (const patch of [{ ownerId: 'other-owner' }, { promptPackVersion: 'other-pack' }, { limits: { modelCalls: 3, toolCalls: 8, queryEmbeddings: 2 } }]) {
      const c = context(undefined, patch), s = simple(c); const result = await s.run(); assert.equal(result.stopReason, 'unavailable');
      assert.deepEqual(s.counts(), { providers: 0, daily: 0 }); assert.equal(s.session.created, 0);
      await assert.rejects(budgets.read(c), { code: 'root_not_found' });
    }
    const c = context(), s = simple(c, { alterOptions: options => {
      options.resolve = async () => { throw new Error('Mutated dynamic route must not run'); };
      options.nativeSessionService = { createSession() { throw new Error('Mutated storage must not run'); } };
      options.config.enabled = false; options.provider = { generate: async () => { throw new Error('Mutated provider must not run'); } };
      options.durableBudget.context.binding.ownerId = 'mutated-owner';
    } });
    const result = await s.run(); assert.equal(result.status, 'completed', JSON.stringify(result)); assert.deepEqual(s.counts(), { providers: 1, daily: 1 });
    // The caller-owned object was not frozen; the runtime used its original copied binding.
    return { rejectedMismatches: 3, constructorMutationIgnored: true };
  });
  await check('missing first event and duplicate saved tool call anchors fail closed', async () => {
    const c = context(), missing = new ObservedSession();
    missing.afterAppend = ({ session, event }) => { if (event.author === 'user') session.events.splice(0); };
    const a = simple(c, { session: missing }); const first = await a.run(); assert.equal(first.status, 'stopped'); assert.deepEqual(a.counts(), { providers: 0, daily: 0 });
    const d = context(), duplicate = new ObservedSession(); let handled = 0;
    duplicate.afterAppend = ({ session, event }) => { if (event.content?.parts?.some(part => part.functionCall)) session.events.push(structuredClone(event)); };
    const tool = { name: 'search_knowledge', description: 'Synthetic query', parameters: z.object({ query: z.string() }), authorize: async () => true,
      execute: async () => { handled++; return { status: 'succeeded' }; } };
    const b = simple(d, { session: duplicate, tools: [tool], generate: () => callsReply([{ id: 'original-query', name: tool.name, args: { query: '合成準備' } }]) });
    assert.equal((await b.run()).status, 'stopped'); assert.equal(handled, 0); assert.equal((await budgets.read(d)).used.queryEmbeddings, 0);
    return { missingFirstProviderCalls: 0, duplicateAnchorHandlers: 0 };
  });
  await check('sequential same-query native batch reuses one admission and complete batch refusal runs no handler', async () => {
    const c = context(); let embeddings = 0, candidates = 0, handlers = 0;
    const retrieval = createKnowledgeRetriever({ candidates: async () => { candidates++; return []; } }, { embed: async () => { embeddings++; return [1]; } });
    const adapter = observingAdapter(async (root, attempt) => { if (attempt.kind === 'embedding') await new Promise(resolve => setTimeout(resolve, 5)); return budgets.reserve(root, attempt); });
    const s = simple(c, { adapter, generate: (_, index) => index === 1 ? callsReply(['query-a', 'query-b'].map(id => ({ id, name: 'search_knowledge', args: { query: '合成準備' } }))) : textReply(),
      tools: run => { const search = retrieval.createRun({ actor: { kind: 'query_embedding', actorId: scope.userId, operationId: c.binding.rootRunId }, budget: run.budget, authorize: async () => true });
        return [{ name: 'search_knowledge', description: 'Synthetic query', parameters: z.object({ query: z.string() }), authorize: async () => true,
          execute: async (args, context) => { handlers++; return { status: 'succeeded', data: { result: await search.search(args.query, { region: 'HK', classification: 'official_guidance', age: null, topics: [] }, context.queryEmbeddingAttemptKey) } }; } }]; } });
    const result = await s.run(); assert.equal(result.status, 'completed', JSON.stringify(result)); assert.equal(embeddings, 1); assert.equal(candidates, 2); assert.equal(handlers, 2);
    assert.deepEqual((await budgets.read(c)).used, { modelCalls: 2, toolCalls: 2, queryEmbeddings: 1 });
    const full = context(); await budgets.open(full); await reserve(full, { key: 'synthetic-prior-batch', kind: 'tool_batch', units: 7 });
    let writes = 0; const tool = { name: 'save_item', description: 'Synthetic effect', parameters: z.object({}), authorize: async () => true, execute: async () => { writes++; return { status: 'succeeded' }; } };
    const batch = simple(full, { tools: [tool], generate: () => callsReply(['a', 'b'].map(id => ({ id, name: 'save_item', args: {} }))) });
    const refusal = await batch.run(); assert.equal(refusal.stopReason, 'tool_limit'); assert.equal(writes, 0); assert.equal((await budgets.read(full)).used.toolCalls, 7);
    return { sequentialNativeHandlers: handlers, embeddingReservations: 1, insufficientBatchHandlers: writes };
  });
  await check('persisted stop, original expiry and cancelled committed document response preserve the domain receipt boundary', async () => {
    const remaining = context(); await budgets.open(remaining);
    for (let i = 0; i < 3; i++) await reserve(remaining, { key: `synthetic-prior-model-${i}`, kind: 'model', units: 1 });
    let finalized;
    const bounded = simple(remaining, { generate: () => callsReply([{ id: 'one-remaining-call', name: 'read_item', args: {} }]),
      tools: [{ name: 'read_item', description: 'Read one synthetic item', parameters: z.object({}), authorize: async () => true, execute: async () => ({ status: 'succeeded' }) }],
      input: { finalizeOnModelLimit: true, finalize: async (_, __, reason) => { finalized = reason; return 'Synthetic finalization'; } } });
    const boundedResult = await bounded.run(); assert.equal(boundedResult.status, 'completed', JSON.stringify(boundedResult));
    assert.equal(finalized, 'model_limit'); assert.equal(boundedResult.counts.modelCalls, 4); assert.equal(bounded.counts().providers, 1);
    const stopped = context(); await budgets.open(stopped); await budgets.stop(stopped);
    const a = simple(stopped); assert.equal((await a.run()).stopReason, 'unavailable'); assert.deepEqual(a.counts(), { providers: 0, daily: 0 });
    const expired = context(undefined, { deadlineAtMs: Date.now() - 1 }); const b = simple(expired); assert.equal((await b.run()).stopReason, 'deadline'); assert.deepEqual(b.counts(), { providers: 0, daily: 0 });
    const c = context(), observed = new ObservedSession(), controller = new AbortController();
    observed.afterAppend = ({ event }) => { if (event.content?.parts?.some(part => part.functionResponse?.name === 'change_family_document')) controller.abort(); };
    const s = nativeSessionProductFixture(observed, c.binding.rootRunId, { durableBudget: { adapter: budgets, context: c }, searchKnowledge: true });
    const result = await s.reply(controller.signal); assert.equal(result?.stopReason, 'cancelled'); assert.equal(s.observe().writes, 1); assert.equal(s.observe().calls, 3);
    assert.match(result.text, /文件操作已保存/); assert.equal(s.observe().ledger.length, 1);
    assert.deepEqual((await budgets.read(c)).used, { modelCalls: 3, toolCalls: 3, queryEmbeddings: 1 });
    return { postCancelProviderCalls: 0, domainReceiptWrites: 1, rollbackClaim: false };
  });
  assert.deepEqual(blocked, []);
} catch (error) { summary.failure = error.message; process.exitCode = 1; }
finally {
  try { await database.recursiveDelete(database.collection(sessionNamespace)); await database.recursiveDelete(database.collection(budgetNamespace)); summary.ownedSyntheticNamespacesDeleted = true; }
  catch (error) { summary.cleanupFailure = error.message; process.exitCode = 1; }
  await database.terminate(); summary.clientClosedByComposer = true; summary.connections = connections.length;
  await writeFile(output, JSON.stringify(summary, null, 2) + '\n');
}
