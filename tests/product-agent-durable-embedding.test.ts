import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { FinishReason } from '@google/genai';
import type { Pool } from 'pg';
import type { AgentScope } from '../server/agent-runtime.ts';
import type { AgentRunClaim } from '../server/product-agent-store.ts';
import type { ProductAgentResult } from '../src/shared/product-agent.ts';
import type { ProductAgentServicePorts } from '../server/product-agent-services.ts';
import type { DurableAiUsage, DurableAiUsageRequest } from '../server/durable-ai-usage.ts';
import type { RootBudgetContext } from '../server/durable-root-budget.ts';
import { readAiConfig } from '../server/ai-config.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { loadAgentPrompt } from '../server/agent-prompt.ts';
import { FirestoreSessionService } from '../server/firestore-session-service.ts';
import { FirestoreRootBudget } from '../server/firestore-root-budget.ts';
import { FirestoreAiUsage } from '../server/firestore-ai-usage.ts';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';

const childId = '1ebcb39d-a2db-4b8c-a432-7ffcb3de5808';
const cipher = createStorageCipher(Buffer.alloc(32, 67));
interface Entry { messageId: string; text: string; claim: AgentRunClaim; claimed: boolean; saved: ProductAgentResult | null; }
/** The domain store is synthetic; real services, tools, Runner and Firestore adapters are exercised. */
function domainFixture() {
  const entries: Entry[] = [];
  const byRun = (id: string) => { const value = entries.find(item => item.claim.runId === id); assert.ok(value); return value; };
  const add = (userId = 'synthetic-user') => {
    const messageId = randomUUID(), value: Entry = { messageId, text: '請查合成知識資料。', claimed: false, saved: null,
      claim: { runId: randomUUID(), scope: { userId, childId, workspaceId: 'synthetic-workspace', authorizationVersion: '9007199254740993', dataVersion: 'synthetic-epoch:7' },
        created: true, sourceMessageId: messageId, state: 'running', expiresAt: new Date(Date.now() + 65_000).toISOString(),
        storageEpoch: 'synthetic-epoch', trigger: { kind: 'interactive', reference: messageId }, recipeId: 'product-interactive' } };
    entries.push(value); return value;
  };
  const store = {
    claim: async (_user: string, _child: string, trigger: { reference: string }) => {
      const value = entries.find(item => item.messageId === trigger.reference)!;
      const created = !value.claimed; value.claimed = true; return structuredClone({ ...value.claim, created });
    },
    authorize: async (scope: AgentScope, id: string) => { const value = byRun(id); return value.claim.state === 'running'
      && Date.parse(value.claim.expiresAt) > Date.now() && JSON.stringify(scope) === JSON.stringify(value.claim.scope); },
    finish: async (_scope: AgentScope, result: ProductAgentResult) => {
      const value = byRun(result.runId); if (value.claim.state !== 'running') return false;
      value.saved = structuredClone(result); value.claim.state = result.status; return true;
    },
    get: async (_user: string, _child: string, id: string) => byRun(id).saved,
    readCancelled: async (_scope: AgentScope, id: string) => byRun(id).saved,
    cancelReply: async (_user: string, _child: string, messageId: string) => {
      entries.find(value => value.messageId === messageId)!.claim.state = 'stopped'; return true;
    },
  };
  const memory = { context: async () => ({ profile: { childId, version: 0, data: null }, profileApplicable: false, facts: [], topics: [], summary: null,
    recentMessages: [], conflictingKeys: [], unavailableFactKeys: [], truncated: { facts: false, topics: false, messages: false } }) };
  const chat = { listForUser: async (user: string) => ({ messages: entries.filter(item => item.claim.scope.userId === user).map(item => ({ id: item.messageId, role: 'user', text: item.text })) }) };
  return { add, store, memory, chat };
}

test('claimed services share model and query embedding daily quota through the actual knowledge tool', async t => {
  type Domain = ReturnType<typeof domainFixture>;
  for (const [file, factory, key] of [
    ['product-agent-store', 'createProductAgentStore', 'store'], ['memory', 'createMemoryStore', 'memory'],
    ['chat', 'createChatStore', 'chat'], ['tasks', 'createTaskStore', 'tasks'],
    ['family-document-store', 'createFamilyDocumentStore', 'documents'],
    ['shared-input-store', 'createSharedInputStore', 'sources'], ['concern-store', 'createConcernStore', 'concerns'],
  ]) t.mock.module(`../server/${file}.ts`, { namedExports: { [factory]: (pool: { domain: Domain }) => (pool.domain as any)[key] ?? {} } });
  const { createProductAgentServices } = await import('../server/product-agent-services.ts');
  const pack = (await loadAgentPrompt('product-interactive', 'tool_cycle', ['run', 'scope', 'conversation', 'context', 'evidence', 'capabilities'])).packVersion;
  function fixture(userLimit = 20, globalLimit = 100) {
    const domain = domainFixture(), f = serialFirestoreFixture(), requests: DurableAiUsageRequest[] = [], contexts: RootBudgetContext[] = [];
    const config = readAiConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: 'synthetic-project', AI_DAILY_USER_ATTEMPTS: String(userLimit), AI_DAILY_GLOBAL_ATTEMPTS: String(globalLimit) });
    const storage = { database: f.database, cipher, projectId: 'synthetic-project' };
    let modelCalls = 0, embeddings = 0, sql = 0, candidates = 0;
    const root = new FirestoreRootBudget({ ...storage, namespace: 'synthetic_root_budget' });
    const daily = new FirestoreAiUsage({ ...storage, namespace: 'synthetic_daily_usage', billingSource: 'platform' });
    let reserve: DurableAiUsage['reserve'] = request => daily.reserve(request);
    const dailyUsage: DurableAiUsage = { billingSource: 'platform', reserve: request => { requests.push(structuredClone(request)); return reserve(request); },
      read: r => daily.read(r), record: (r, v) => daily.record(r, v), getForUser: u => daily.getForUser(u) };
    const persistence: NonNullable<ProductAgentServicePorts['claimedRunPersistence']> = {
      nativeSessionService: new FirestoreSessionService({ ...storage, namespace: 'synthetic_sessions' }), dailyUsage,
      rootBudget: { open: c => { contexts.push(structuredClone(c)); return root.open(c); }, read: c => root.read(c), reserve: (c, a) => root.reserve(c, a), settle: (c, a, r) => root.settle(c, a, r), stop: c => root.stop(c) },
      profile: { config: { ...config }, billingSource: 'platform', workflowVersion: 'product-interactive-v1', promptPackVersion: pack, settingsVersion: 'fixed-profile-v1', billingVersion: 'platform-v1' },
      embeddingProvider: { embed: async () => { embeddings++; return { values: [1, ...Array<number>(1023).fill(0)], inputTokens: 4, billableCharacters: 12 }; } },
      provider: { generate: async request => {
        const index = modelCalls++;
        const functionCalls = index % 2 === 0
          ? ['search-a', 'search-b'].map(id => ({ id, name: 'search_knowledge', args: { query: '合成知識', classification: 'official_guidance' } }))
          : [{ id: 'answer', name: 'present_answer', args: { kind: 'clarification', paragraphs: [{ text: '合成回覆。', citationIds: [] }] } }];
        assert.ok(functionCalls.every(call => Object.hasOwn(request.toolsDict, call.name)));
        return { content: { role: 'model', parts: functionCalls.map(functionCall => ({ functionCall })) }, finishReason: FinishReason.STOP,
          usageMetadata: { promptTokenCount: 10, totalTokenCount: 15, cachedContentTokenCount: 2 } };
      } },
    };
    const pool = { domain, query: async () => { sql++; throw new Error('No SQL quota fallback'); }, connect: async () => { sql++; throw new Error('No SQL quota fallback'); } } as unknown as Pool;
    const build = () => createProductAgentServices(pool, cipher, config, undefined, false, undefined, undefined, undefined, undefined, undefined,
      { publishedKnowledgeReader: { candidates: async () => { candidates++; return []; } }, claimedRunPersistence: persistence });
    return { domain, daily, requests, root, contexts, persistence, build, f, setReserve: (fn: typeof reserve) => { reserve = fn; }, stats: () => ({ modelCalls, embeddings, sql, candidates }) };
  }
  const reply = (service: ReturnType<typeof createProductAgentServices>, entry: Entry) => service.agent.reply(entry.claim.scope.userId, childId, entry.messageId, async () => true);

  await t.test('two same-query calls charge one embedding and combine it with both model attempts without SQL', async () => {
    const s = fixture(), entry = s.domain.add(), result = await reply(s.build(), entry);
    assert.equal(s.stats().sql, 0, 'query embeddings must share the injected durable daily quota');
    assert.equal(result?.status, 'completed', JSON.stringify(result));
    assert.deepEqual(s.stats(), { modelCalls: 2, embeddings: 1, sql: 0, candidates: 2 });
    assert.deepEqual(result?.counts, { modelCalls: 2, toolCalls: 3, queryEmbeddings: 1 });
    assert.deepEqual(s.requests.map(request => request.kind), ['model', 'embedding', 'model']);
    assert.ok(s.requests.every(request => request.attemptKey.startsWith(request.kind + ':')));
    assert.deepEqual(await s.daily.getForUser(entry.claim.scope.userId), { day: new Date().toISOString().slice(0, 10), attempts: 3,
      inputTokens: 24, outputTokens: 10, cachedTokens: 4, unknownUsageAttempts: 0, billingSource: 'platform' });
    assert.equal(JSON.stringify([...s.f.records]).includes('合成知識'), false);
  });
  await t.test('model and query attempts share both user and global limits before either provider can overspend', async () => {
    for (const [userLimit, globalLimit] of [[1, 100], [20, 1]]) {
      const s = fixture(userLimit, globalLimit), entry = s.domain.add(), result = await reply(s.build(), entry);
      assert.equal(result?.status, 'stopped');
      assert.deepEqual(s.stats(), { modelCalls: 1, embeddings: 0, sql: 0, candidates: 0 });
      assert.equal((await s.daily.getForUser(entry.claim.scope.userId)).attempts, 1);
      assert.equal(s.requests[1].kind, 'embedding');
      assert.equal((await s.root.read(s.contexts[0])).used.queryEmbeddings, 1);
    }
    const s = fixture(3), entry = s.domain.add(), first = await reply(s.build(), entry);
    assert.equal(first?.status, 'completed');
    const second = await reply(s.build(), s.domain.add());
    assert.equal(second?.status, 'stopped'); assert.equal(s.stats().modelCalls, 2); assert.equal(s.stats().embeddings, 1);
    assert.equal((await s.daily.getForUser(entry.claim.scope.userId)).attempts, 3);
    const before = s.stats(); assert.deepEqual(await reply(s.build(), entry), first); assert.deepEqual(s.stats(), before);
  });

  await t.test('embedding lookup and lost daily acknowledgement stop without SQL, provider, keyword fallback or replay', async () => {
    for (const mode of ['lookup', 'lost-reply']) {
      const s = fixture(), entry = s.domain.add();
      s.setReserve(async request => {
        if (request.kind === 'embedding') {
          await s.daily.reserve(request);
          if (mode === 'lost-reply') throw new Error('Synthetic lost daily acknowledgement');
        }
        return s.daily.reserve(request);
      });
      const result = await reply(s.build(), entry); assert.equal(result?.status, 'stopped');
      assert.deepEqual(s.stats(), { modelCalls: 1, embeddings: 0, sql: 0, candidates: 0 });
      assert.equal((await s.daily.getForUser(entry.claim.scope.userId)).attempts, 2);
      assert.equal((await s.daily.getForUser(entry.claim.scope.userId)).unknownUsageAttempts, 1);
      const original = await s.daily.read(s.requests.find(request => request.kind === 'embedding')!);
      assert.equal(original?.kind, 'embedding'); assert.equal(original?.record, null);
      const before = s.stats(); assert.deepEqual(await reply(s.build(), entry), result); assert.deepEqual(s.stats(), before);
      assert.deepEqual(await s.daily.read(s.requests.find(request => request.kind === 'embedding')!), original);
    }
  });

  await t.test('cancellation, revoked scope and deadline after daily reservation prevent embedding dispatch', async () => {
    for (const mode of ['cancelled', 'unauthorized', 'deadline']) {
      const s = fixture(), entry = s.domain.add(), cancellation = new AbortController(), realNow = Date.now;
      let expired = false;
      if (mode === 'deadline') Date.now = () => expired ? Date.parse(entry.claim.expiresAt) + 1 : realNow();
      try {
        s.setReserve(async request => {
          const result = await s.daily.reserve(request);
          if (request.kind === 'embedding') {
            if (mode === 'cancelled') cancellation.abort();
            if (mode === 'unauthorized') entry.claim.scope.authorizationVersion = 'revoked';
            if (mode === 'deadline') expired = true;
          }
          return result;
        });
        const result = await s.build().agent.reply(entry.claim.scope.userId, childId, entry.messageId, async () => true, cancellation.signal);
        assert.equal(result?.status, 'stopped', mode);
        assert.equal(s.stats().embeddings, 0, mode); assert.equal(s.stats().sql, 0, mode); assert.equal(s.stats().candidates, 0, mode);
        assert.equal((await s.daily.getForUser(entry.claim.scope.userId)).attempts, 2, mode);
        assert.equal((await s.root.read(s.contexts[0])).used.queryEmbeddings, 1, mode);
      } finally { Date.now = realNow; }
    }
  });

});
