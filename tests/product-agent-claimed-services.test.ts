import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { FinishReason } from '@google/genai';
import type { Pool } from 'pg';
import type { AgentRunInput, AgentScope } from '../server/agent-runtime.ts';
import { createProductAgentStore as createSqlProductAgentStore, type AgentRunClaim } from '../server/product-agent-store.ts';
import type { AgentModelProvider } from '../server/agent-model-gateway.ts';
import type { ProductAgentServicePorts } from '../server/product-agent-services.ts';
import type { RootBudgetContext, DurableRootBudget } from '../server/durable-root-budget.ts';
import type { DurableAiUsage } from '../server/durable-ai-usage.ts';
import type { ProductAgentResult } from '../src/shared/product-agent.ts';
import type { DocumentChange, FamilyDocument } from '../src/shared/family-documents.ts';
import { readAiConfig } from '../server/ai-config.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { loadAgentPrompt } from '../server/agent-prompt.ts';
import { FirestoreSessionService } from '../server/firestore-session-service.ts';
import { FirestoreRootBudget } from '../server/firestore-root-budget.ts';
import { FirestoreAiUsage } from '../server/firestore-ai-usage.ts';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';

const childId = '1ebcb39d-a2db-4b8c-a432-7ffcb3de5808';
const documentId = '11111111-1111-4111-8111-111111111111';
const cipher = createStorageCipher(Buffer.alloc(32, 67));
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
interface Entry { messageId: string; text: string; document: boolean; claim: AgentRunClaim; claimed: boolean; calls: number; saved: ProductAgentResult | null; }

/** Synthetic business storage. SQL transaction/fencing authority remains covered by its existing tests. */
function domainFixture() {
  const entries: Entry[] = [], ledger = new Map<string, { runId: string; documentId: string; savedVersion: number; toolName: 'change_family_document' }>();
  const document: FamilyDocument = { id: documentId, childId, kind: 'preparation', purpose: 'school', version: 3, status: 'active',
    archivedAt: null, autoRefresh: false, readState: 'ready', history: [],
    current: { id: '22222222-2222-4222-8222-222222222222', version: 2, generatedAt: '2026-10-09T00:00:00Z', sourceBasis: 'synthetic-basis',
      title: 'Synthetic preparation', summary: 'Synthetic summary', ageLabel: 'Unknown', period: { from: '2026-10-09', to: '2026-10-09' }, eventDate: null,
      coverageNote: 'Synthetic coverage', sources: [], changes: [], sections: [{ id: 'checklist', title: 'Checklist', kind: 'checklist', domain: null,
        items: [{ id: 'bag', text: 'Synthetic bag', sourceIds: [], checked: false }] }] },
    manifest: { snapshotId: '22222222-2222-4222-8222-222222222222', snapshotVersion: 2, invalidated: false,
      sections: [{ id: 'checklist', kind: 'checklist', itemIds: ['bag'] }] } };
  const change: DocumentChange = { action: 'check_item', expectedVersion: 3, authorityVersion: 'synthetic-authority:6', sectionId: 'checklist', itemId: 'bag', checked: true };
  let afterCommit: (() => Promise<void>) | undefined, claimPatch: Partial<AgentRunClaim> = {}, failFinish = false, writes = 0, gets = 0;
  const entry = (id: string) => { const value = entries.find(item => item.claim.runId === id); assert.ok(value); return value; };
  function add(userId = 'synthetic-user', edit = false) {
    const messageId = randomUUID(), scope = { userId, childId, workspaceId: 'synthetic-workspace', authorizationVersion: '9007199254740993', dataVersion: 'synthetic-epoch:7' };
    const value: Entry = { messageId, text: `合成訊息 ${messageId}：請把準備單的書包勾選為已準備。`, document: edit, calls: 0, claimed: false, saved: null,
      claim: { runId: randomUUID(), scope, created: true, sourceMessageId: messageId, state: 'running', expiresAt: new Date(Date.now() + 65_000).toISOString(),
        storageEpoch: 'synthetic-epoch', trigger: { kind: 'interactive', reference: messageId }, recipeId: 'product-interactive' } };
    entries.push(value); return value;
  }
  function original(value: Entry): ProductAgentResult {
    if (value.saved) return structuredClone(value.saved);
    return { runId: value.claim.runId, status: value.claim.state, stopReason: value.claim.state === 'unknown' ? 'interrupted' : value.claim.state === 'stopped' ? 'cancelled' : null,
      provenance: null, text: '', citations: [], privateSourceCitations: [], retrievalMode: 'not_used', countsKnown: false,
      counts: { modelCalls: 0, toolCalls: 0, queryEmbeddings: 0 }, proposals: [],
      tools: [...ledger.values()].filter(item => item.runId === value.claim.runId).map(item => ({ name: item.toolName, status: 'succeeded', reference: item.documentId })) };
  }
  const store = {
    claim: async (user: string, child: string, trigger: { kind: string; reference: string }, recipe: string) => {
      const value = entries.find(item => item.messageId === trigger.reference); assert.ok(value);
      assert.equal(user, value.claim.scope.userId); assert.equal(child, childId); assert.equal(recipe, 'product-interactive');
      const created = !value.claimed; value.claimed = true;
      return structuredClone({ ...value.claim, created, ...claimPatch });
    },
    authorize: async (scope: AgentScope, id: string) => { const value = entry(id); return value.claim.state === 'running'
      && Date.parse(value.claim.expiresAt) > Date.now() && JSON.stringify(scope) === JSON.stringify(value.claim.scope); },
    writeDocument: async (scope: AgentScope, id: string, opId: string, quote: string, mutation: { id: string; change: DocumentChange }) => {
      const value = entry(id); assert.equal(await store.authorize(scope, id), true); assert.equal(quote, value.text);
      assert.deepEqual(mutation, { id: document.id, change });
      const hash = createHash('sha256').update(`family-document:${id}:check-bag`).digest('hex');
      assert.equal(opId, `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`);
      assert.equal(document.version, change.expectedVersion); assert.equal(ledger.has(opId), false);
      writes++; document.version++; document.current!.sections[0].items[0].checked = true;
      ledger.set(opId, { runId: id, documentId, savedVersion: document.version, toolName: 'change_family_document' });
      await afterCommit?.(); return structuredClone(document);
    },
    documentReceipts: async (_scope: AgentScope, id: string) => ({ receipts: [...ledger].filter(([, r]) => r.runId === id)
      .map(([operationId, value]) => ({ operationId, ...value })), unavailable: false, linked: [...ledger.values()].some(r => r.runId === id) }),
    finish: async (_scope: AgentScope, result: ProductAgentResult) => {
      const value = entry(result.runId);
      if (failFinish) { value.claim.state = 'unknown'; throw new Error('Synthetic lost finish acknowledgement'); }
      if (value.claim.state !== 'running') return false;
      value.saved = structuredClone(result); value.claim.state = result.status; return true;
    },
    get: async (_user: string, _child: string, id: string) => { gets++; return original(entry(id)); },
    readCancelled: async (_scope: AgentScope, id: string) => original(entry(id)),
    cancelReply: async (user: string, child: string, message: string) => { const value = entries.find(item => item.messageId === message)!;
      assert.equal(user, value.claim.scope.userId); assert.equal(child, childId); value.claim.state = 'stopped'; return true; },
  };
  const memory = { context: async () => ({ profile: { childId, version: 0, data: null }, profileApplicable: false, facts: [], topics: [], summary: null,
    recentMessages: [], conflictingKeys: [], unavailableFactKeys: [], truncated: { facts: false, topics: false, messages: false } }) };
  const chat = { listForUser: async (user: string) => ({ messages: entries.filter(item => item.claim.scope.userId === user).map(item => ({ id: item.messageId, role: 'user', text: item.text })) }) };
  const documents = { describe: async (_user: string, _child: string, id: string) => { assert.equal(id, documentId); return { item: structuredClone(document), authorityVersion: 'synthetic-authority:7' }; } };
  const provider: AgentModelProvider = { generate: async request => {
    const text = [...request.contents].reverse().flatMap(content => content.parts ?? []).find(part => entries.some(item => item.text === part.text))?.text;
    const value = entries.find(item => item.text === text); assert.ok(value); const index = value.calls++;
    assert.ok(index < (value.document ? 3 : 1));
    const functionCall = value.document && index === 0 ? { id: 'load-documents', name: 'load_capabilities', args: { capabilities: ['document_edit'] } }
      : value.document && index === 1 ? { id: 'check-bag', name: 'change_family_document', args: { sourceQuote: value.text, documentId, change } }
      : { id: 'answer', name: 'present_answer', args: { kind: value.document ? 'operation' : 'clarification', paragraphs: [{ text: '合成回覆。', citationIds: [] }] } };
    assert.ok(Object.hasOwn(request.toolsDict, functionCall.name));
    if (value.document && index === 0) assert.equal(Object.hasOwn(request.toolsDict, 'change_family_document'), false);
    if (index > 0) assert.ok(request.contents.some(content => content.parts?.some(part => part.functionResponse)));
    return { content: { role: 'model', parts: [{ functionCall }] }, finishReason: FinishReason.STOP,
      usageMetadata: { promptTokenCount: 10, totalTokenCount: 15 } };
  } };
  return { entries, add, store, memory, chat, documents, provider, document, ledger,
    tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) },
    onCommit: (fn: () => Promise<void>) => { afterCommit = fn; }, patchClaim: (patch: Partial<AgentRunClaim>) => { claimPatch = patch; },
    loseFinish: () => { failFinish = true; }, stats: () => ({ writes, gets, calls: entries.reduce((n, value) => n + value.calls, 0) }) };
}

test('SQL claim explicitly projects original storage epoch, trigger, recipe and absolute expiry without converting authority strings', async () => {
  const user = 'synthetic-parent', workspace = 'synthetic-workspace', message = randomUUID();
  const row = { id: randomUUID(), child_id: childId, owner_user_id: user, trigger_kind: 'interactive', trigger_reference: message,
    source_message_id: message, authorization_version: '9007199254740993', data_version: 'original-epoch:17', recipe_id: 'product-interactive',
    state: 'running', stop_reason: null, created_at: new Date(), expires_at: new Date(Date.now() + 30_000) };
  let inserted = false;
  const rows = (values: unknown[] = []) => ({ rows: values, rowCount: values.length });
  const query = async (sql: string) => {
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql) || sql.startsWith('SET LOCAL') || sql.startsWith("UPDATE agent_runs SET state='unknown'")) return rows();
    if (sql.startsWith('SELECT workspace_id FROM children')) return rows([{ workspace_id: workspace }]);
    if (sql.startsWith('SELECT owner_user_id, access_version')) return rows([{ owner_user_id: user, access_version: row.authorization_version }]);
    if (sql.startsWith('SELECT 1 FROM children') || sql.startsWith('SELECT 1 FROM chat_messages')) return rows([{}]);
    if (sql.startsWith('SELECT access_version::text')) return rows([{ access_version: row.authorization_version, storage_epoch: 'current-epoch', change_seq: '99' }]);
    if (sql.startsWith('INSERT INTO agent_runs')) { const fresh = !inserted; inserted = true; return rows(fresh ? [row] : []); }
    if (sql.startsWith('SELECT * FROM agent_runs')) return rows([row]);
    throw new Error('Unexpected synthetic SQL');
  };
  const pool = { query, connect: async () => ({ query, release() {} }) } as unknown as Pool;
  const store = createSqlProductAgentStore(pool, cipher);
  for (const created of [true, false]) {
    const claim = await store.claim(user, childId, { kind: 'interactive', reference: message }, 'product-interactive');
    assert.ok(claim); assert.equal(claim.created, created); assert.equal(claim.runId, row.id);
    assert.equal(claim.storageEpoch, 'original-epoch'); assert.equal(claim.scope.dataVersion, 'original-epoch:17');
    assert.equal(claim.scope.authorizationVersion, '9007199254740993'); assert.deepEqual(claim.trigger, { kind: 'interactive', reference: message });
    assert.equal(claim.recipeId, row.recipe_id); assert.equal(claim.expiresAt, row.expires_at.toISOString());
  }
});

test('claimed services compose real ProductAgent, shared runtime, Runner and all three durable adapters', async t => {
  type Domain = ReturnType<typeof domainFixture>;
  for (const [file, factory, key] of [
    ['product-agent-store', 'createProductAgentStore', 'store'], ['memory', 'createMemoryStore', 'memory'],
    ['chat', 'createChatStore', 'chat'], ['tasks', 'createTaskStore', 'tasks'],
    ['family-document-store', 'createFamilyDocumentStore', 'documents'],
    ['shared-input-store', 'createSharedInputStore', 'sources'], ['concern-store', 'createConcernStore', 'concerns'],
  ]) t.mock.module(`../server/${file}.ts`, { namedExports: { [factory]: (pool: { domain: Domain }) => (pool.domain as any)[key] ?? {} } });
  const { createProductAgentServices } = await import('../server/product-agent-services.ts');
  const pack = (await loadAgentPrompt('product-interactive', 'tool_cycle', ['run', 'scope', 'conversation', 'context', 'evidence', 'capabilities'])).packVersion;
  function fixture() {
    const domain = domainFixture(), f = serialFirestoreFixture(), opens: RootBudgetContext[] = [];
    const config = readAiConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: 'synthetic-project' });
    const storage = { database: f.database, cipher, projectId: 'synthetic-project' };
    let creates = 0, dailyReserves = 0, sql = 0;
    const root = new FirestoreRootBudget({ ...storage, namespace: 'synthetic_root_budget' });
    const rootBudget: DurableRootBudget = { open: context => { opens.push(structuredClone(context)); return root.open(context); },
      read: c => root.read(c), reserve: (c, a) => root.reserve(c, a), settle: (c, a, r) => root.settle(c, a, r), stop: c => root.stop(c) };
    const daily = new FirestoreAiUsage({ ...storage, namespace: 'synthetic_daily_usage', billingSource: 'platform' });
    let reserve: DurableAiUsage['reserve'] = request => daily.reserve(request);
    const dailyUsage: DurableAiUsage = { billingSource: 'platform', reserve: request => { dailyReserves++; return reserve(request); },
      read: r => daily.read(r), record: (r, v) => daily.record(r, v), getForUser: u => daily.getForUser(u) };
    const nativeSessionService = new class extends FirestoreSessionService {
      override createSession(request: Parameters<FirestoreSessionService['createSession']>[0]) { creates++; return super.createSession(request); }
    }({ ...storage, namespace: 'synthetic_sessions' });
    const persistence: NonNullable<ProductAgentServicePorts['claimedRunPersistence']> = { nativeSessionService, rootBudget, dailyUsage,
      profile: { config: { ...config }, billingSource: 'platform', workflowVersion: 'product-interactive-v1', promptPackVersion: pack,
        settingsVersion: 'fixed-profile-v1', billingVersion: 'platform-v1' }, provider: domain.provider };
    const pool = { domain, query: async () => { sql++; throw new Error('No SQL quota fallback'); }, connect: async () => { sql++; throw new Error('No SQL quota fallback'); } } as unknown as Pool;
    const build = (override = persistence, routing?: any) => createProductAgentServices(pool, cipher, config, undefined, false, undefined, undefined, undefined, routing, undefined,
      { publishedKnowledgeReader: { candidates: async () => [] }, claimedRunPersistence: override });
    return { domain, config, opens, root, daily, persistence, build, f, setReserve: (fn: typeof reserve) => { reserve = fn; },
      stats: () => ({ creates, dailyReserves, sql, ...domain.stats() }) };
  }
  const reply = (service: ReturnType<typeof createProductAgentServices>, entry: Entry) => service.agent.reply(entry.claim.scope.userId, childId, entry.messageId, async () => true);
  const input = (entry: Entry): AgentRunInput => ({ runId: entry.claim.runId, scope: entry.claim.scope, claimedRun: structuredClone(entry.claim),
    deadlineAtMs: Date.parse(entry.claim.expiresAt), trigger: entry.claim.trigger!, recipeId: 'product-interactive',
    messages: [{ role: 'user', text: entry.text }], tools: [], authorize: async () => true });

  await t.test('two claimed roots accumulate daily attempts; same document/version/opId survives services reconstruction without replay', async () => {
    const s = fixture(), first = s.domain.add('synthetic-user', true), service = s.build();
    const result = await reply(service, first); assert.equal(result?.status, 'completed', JSON.stringify(result));
    assert.deepEqual(result?.counts, { modelCalls: 3, toolCalls: 3, queryEmbeddings: 0 });
    assert.equal(s.domain.document.id, documentId); assert.equal(s.domain.document.version, 4);
    assert.equal([...s.domain.ledger.values()][0].savedVersion, 4);
    const second = s.domain.add(), next = await reply(service, second); assert.equal(next?.status, 'completed', JSON.stringify(next));
    assert.equal(s.opens.length, 2); assert.notEqual(s.opens[0].binding.rootRunId, s.opens[1].binding.rootRunId);
    for (const [index, entry] of [first, second].entries()) {
      const context = s.opens[index]; assert.equal(context.generation, 1);
      assert.equal(context.binding.authorizationVersion, '9007199254740993'); assert.equal(context.binding.storageEpoch, 'synthetic-epoch');
      assert.equal(context.binding.deadlineAtMs, Date.parse(entry.claim.expiresAt)); assert.deepEqual(context.binding.trigger, entry.claim.trigger);
      assert.match(context.binding.settingsVersion, /^fixed-profile-v1:[a-f0-9]{64}$/u);
    }
    assert.equal((await s.daily.getForUser('synthetic-user')).attempts, 4); assert.equal(s.stats().sql, 0);
    const before = s.stats(), original = await reply(s.build(), first);
    assert.deepEqual(original, result); assert.deepEqual(s.stats(), { ...before, gets: before.gets + 1 });
  });

  await t.test('a previously claimed run lost before root open stays lookup-only without inventing a profile or generation', async () => {
    const s = fixture(), entry = s.domain.add(); entry.claimed = true; entry.claim.state = 'unknown';
    const result = await reply(s.build(), entry);
    assert.equal(result?.status, 'unknown'); assert.equal(result?.countsKnown, false);
    assert.equal(s.opens.length, 0); assert.deepEqual(s.stats(), { creates: 0, dailyReserves: 0, sql: 0, writes: 0, gets: 1, calls: 0 });
  });

  for (const mode of ['cancelled', 'lost-finish'] as const) await t.test(`${mode} after the document commit reads the original receipt without replay or completion`, async () => {
    const s = fixture(), entry = s.domain.add('synthetic-user', true), service = s.build();
    if (mode === 'cancelled') s.domain.onCommit(async () => { assert.equal(await service.agent.cancelReply(entry.claim.scope.userId, childId, entry.messageId, async () => true), true); });
    else s.domain.loseFinish();
    if (mode === 'lost-finish') await assert.rejects(reply(service, entry), /Synthetic lost finish/u);
    else assert.equal((await reply(service, entry))?.status, 'stopped');
    const before = s.stats(), original = await reply(s.build(), entry);
    assert.equal(original?.status, mode === 'cancelled' ? 'stopped' : 'unknown'); assert.equal(original?.countsKnown, false);
    assert.deepEqual(original?.tools, [{ name: 'change_family_document', status: 'succeeded', reference: documentId }]);
    assert.equal(s.domain.ledger.size, 1); assert.equal(s.domain.document.version, 4);
    assert.deepEqual(s.stats(), { ...before, gets: before.gets + 1 });
  });

  await t.test('claim identity, original scope/auth/epoch/expiry, recipe and profile are required before storage/provider dispatch', async () => {
    for (const field of ['scope', 'authorization', 'epoch', 'expired', 'invalid-expiry', 'source', 'recipe', 'worker', 'profile', 'created', 'state'] as const) {
      const s = fixture(), entry = s.domain.add(), service = s.build(), request = input(entry);
      if (field === 'scope') request.scope = { ...request.scope, childId: 'other-child' };
      if (field === 'authorization') request.scope = { ...request.scope, authorizationVersion: '9007199254740992' };
      if (field === 'epoch') request.claimedRun!.storageEpoch = 'other-epoch';
      if (field === 'expired') request.deadlineAtMs = Date.now() - 1;
      if (field === 'invalid-expiry') request.deadlineAtMs = NaN;
      if (field === 'source') request.claimedRun!.sourceMessageId = randomUUID();
      if (field === 'recipe') request.recipeId = 'p1-chat';
      if (field === 'worker') request.trigger = { kind: 'worker', reference: entry.messageId };
      if (field === 'created') request.claimedRun!.created = false;
      if (field === 'state') request.claimedRun!.state = 'unknown';
      const target = field === 'profile' ? s.build({ ...s.persistence, profile: { ...s.persistence.profile, promptPackVersion: 'wrong-pack' } }) : service;
      const result = await target.runtime.run(request);
      assert.equal(result.status, 'stopped', field); assert.equal(s.opens.length, 0, field); assert.equal(s.stats().creates, 0, field);
      assert.equal(s.stats().calls, 0, field); assert.equal(s.stats().dailyReserves, 0, field);
    }
    const s = fixture();
    assert.throws(() => s.build(s.persistence, { resolve: async () => { throw new Error('Never route'); } }), /Invalid claimed/u);
    assert.throws(() => s.build({ ...s.persistence, profile: { ...s.persistence.profile, config: { ...s.config, dailyUserAttempts: 21 } } }), /Invalid claimed/u);
    assert.throws(() => s.build({ ...s.persistence, dailyUsage: { ...s.persistence.dailyUsage, billingSource: 'personal' } }), /Invalid claimed/u);
    assert.throws(() => s.build({ ...s.persistence, profile: undefined } as any), /Invalid claimed/u);
    assert.deepEqual(s.stats(), { creates: 0, dailyReserves: 0, sql: 0, writes: 0, gets: 0, calls: 0 });
  });

  for (const mode of ['quota', 'unknown'] as const) await t.test(`daily ${mode} does not dispatch, refund root or fall back to SQL`, async () => {
    const s = fixture(), entry = s.domain.add(), service = s.build();
    s.setReserve(async request => { if (mode === 'quota') return { decision: 'quota_exceeded' }; await s.daily.reserve(request); throw new Error('Synthetic daily commit reply lost'); });
    const result = await reply(service, entry); assert.equal(result?.status, 'stopped');
    assert.equal(result?.stopReason, mode === 'quota' ? 'quota_exceeded' : 'unavailable');
    assert.equal(s.stats().calls, 0); assert.equal(s.stats().sql, 0); assert.equal((await s.root.read(s.opens[0])).used.modelCalls, 1);
    assert.equal((await s.daily.getForUser(entry.claim.scope.userId)).attempts, mode === 'quota' ? 0 : 1);
    const before = s.stats(); await reply(s.build(), entry); assert.deepEqual(s.stats(), { ...before, gets: before.gets + 1 });
  });

  await t.test('one shared services runtime rejects the same user and fifth concurrent user then releases every slot', async () => {
    const s = fixture(), entered = deferred(), release = deferred(); let active = 0;
    const underlying = s.domain.provider;
    s.persistence.provider = { generate: async (request, signal) => { if (++active === 4) entered.resolve(); await release.promise; return underlying.generate(request, signal); } };
    const service = s.build(), entries = Array.from({ length: 4 }, (_, i) => s.domain.add(`synthetic-user-${i}`));
    const pending = entries.map(entry => reply(service, entry)); await entered.promise;
    const duplicate = await reply(service, s.domain.add('synthetic-user-0')), fifth = await reply(service, s.domain.add('synthetic-user-4'));
    assert.equal(duplicate?.stopReason, 'unavailable'); assert.equal(fifth?.stopReason, 'unavailable'); assert.equal(s.opens.length, 4);
    release.resolve(); for (const result of await Promise.all(pending)) assert.equal(result?.status, 'completed', JSON.stringify(result));
    const next = await reply(service, s.domain.add('synthetic-user-0')); assert.equal(next?.status, 'completed', JSON.stringify(next));
    assert.equal(s.opens.length, 5); assert.equal(s.stats().calls, 5); assert.equal(s.stats().sql, 0);
  });

  await t.test('fixed configuration is captured once and a rejected profile releases the shared user slot', async () => {
    const s = fixture(), entry = s.domain.add(), service = s.build();
    s.config.dailyUserAttempts = 21; (s.persistence.profile.config as any).model = 'mutated-model';
    s.persistence.profile.promptPackVersion = 'mutated-pack';
    assert.equal((await reply(service, entry))?.status, 'completed'); assert.equal(s.opens[0].binding.promptPackVersion, pack);
    const next = s.domain.add(), invalid = input(next); invalid.claimedRun!.storageEpoch = 'other-epoch';
    assert.equal((await service.runtime.run(invalid)).stopReason, 'unavailable');
    assert.equal((await reply(service, next))?.status, 'completed');
  });
});
