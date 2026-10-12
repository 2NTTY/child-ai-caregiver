import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { newOfflineLedger, openLedger, sha256 } from '../scripts/lib/chat-intent-probe-guards.mjs';
import { DOCUMENT_BATCH, offlineLegacyFingerprint } from '../scripts/lib/chat-document-batch-guards.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { FinishReason } from '@google/genai';
import type { Pool } from 'pg';
import type { AgentScope } from '../server/agent-runtime.ts';
import type { AgentRunClaim } from '../server/product-agent-store.ts';
import type { AgentModelProvider } from '../server/agent-model-gateway.ts';
import type { ProductAgentServicePorts } from '../server/product-agent-services.ts';
import type { ProductAgentResult } from '../src/shared/product-agent.ts';
import type { DocumentChange, FamilyDocument } from '../src/shared/family-documents.ts';
import { saveAgentWorkSchema, type AgentWork, type SaveAgentWork } from '../src/shared/agent-work.ts';
import { readAiConfig } from '../server/ai-config.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { loadAgentPrompt } from '../server/agent-prompt.ts';
import { FirestoreSessionService } from '../server/firestore-session-service.ts';
import { FirestoreRootBudget } from '../server/firestore-root-budget.ts';
import { FirestoreAiUsage } from '../server/firestore-ai-usage.ts';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';
import * as productModelModule from '../server/agent-model-gateway.ts';
import { createOfflineDocumentBatchConsumer } from '../scripts/lib/chat-document-batch-consumer.mjs';

const childId = '1ebcb39d-a2db-4b8c-a432-7ffcb3de5808';
const userId = 'synthetic-parent';
const documentIds = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
const cipher = createStorageCipher(Buffer.alloc(32, 72));
type Entry = { messageId: string; text: string; claim: AgentRunClaim; claimed: boolean; calls: number; saved: ProductAgentResult | null };
type AgentModelRequest = Parameters<AgentModelProvider['generate']>[0];
type Call = { id: string; name: string; args: Record<string, unknown> };

/** Synthetic domain persistence only. All capability loading, tool schemas, runtime and native ADK calls are real. */
function domainFixture(completeOnClarification = false) {
  const entries: Entry[] = [], messages: { id: string; role: 'user' | 'model'; text: string }[] = [];
  const works = new Map<string, AgentWork>(), workWrites: AgentWork[] = [];
  const ledger = new Map<string, { runId: string; documentId: string; savedVersion: number; toolName: 'change_family_document' }>();
  const documents = documentIds.map((id, index): FamilyDocument => ({
    id, childId, kind: 'preparation', purpose: index ? 'outing' : 'school', version: 3, status: 'active', archivedAt: null,
    autoRefresh: false, readState: 'ready', history: [], current: {
      id: randomUUID(), version: 2, generatedAt: '2026-10-09T00:00:00Z', sourceBasis: 'synthetic-basis',
      title: index ? '合成旅行準備' : '合成入學準備', summary: '合成文件；沒有家庭資料。', ageLabel: 'Unknown',
      period: { from: '2026-10-09', to: '2026-10-09' }, eventDate: null, coverageNote: 'Synthetic coverage', sources: [], changes: [],
      sections: [{ id: 'checklist', title: '物品', kind: 'checklist', domain: null, items: [
        { id: 'bag', text: '合成書包', sourceIds: [], checked: false },
        { id: 'bottle', text: '合成水樽', sourceIds: [], checked: false },
      ] }],
    },
  }));
  let documentWrites = 0, newConversation = false;
  const current = (id: string) => { const entry = entries.find(item => item.claim.runId === id); assert.ok(entry); return entry; };
  function add(text: string, fresh = false) {
    newConversation = fresh;
    const messageId = randomUUID(), entry: Entry = { messageId, text, claimed: false, calls: 0, saved: null,
      claim: { runId: randomUUID(), scope: { userId, childId, workspaceId: 'synthetic-workspace', authorizationVersion: '7', dataVersion: 'synthetic-epoch:1' },
        created: true, sourceMessageId: messageId, state: 'running', expiresAt: new Date(Date.now() + 80_000).toISOString(), storageEpoch: 'synthetic-epoch',
        trigger: { kind: 'interactive', reference: messageId }, recipeId: 'product-interactive' } };
    entries.push(entry); messages.push({ id: messageId, role: 'user', text }); return entry;
  }
  const checkScope = (scope: AgentScope, runId: string) => assert.deepEqual(scope, current(runId).claim.scope);
  const store = {
    claim: async (user: string, child: string, trigger: { reference: string }) => {
      assert.equal(user, userId); assert.equal(child, childId);
      const entry = entries.find(item => item.messageId === trigger.reference); assert.ok(entry);
      const created = !entry.claimed; entry.claimed = true; return structuredClone({ ...entry.claim, created });
    },
    authorize: async (scope: AgentScope, runId: string) => { checkScope(scope, runId); return current(runId).claim.state === 'running'; },
    readWork: async (user: string, child: string, input: { workId: string | null; cursor: string | null }) => {
      assert.equal(user, userId); assert.equal(child, childId); assert.equal(input.cursor, null);
      return { items: structuredClone([...works.values()].filter(item => !input.workId || item.id === input.workId)), nextCursor: null, complete: true };
    },
    saveWork: async (scope: AgentScope, runId: string, _callId: string, raw: SaveAgentWork) => {
      checkScope(scope, runId); const input = saveAgentWorkSchema.parse(raw), previous = input.workId ? works.get(input.workId) : null;
      assert.equal(input.expectedVersion, previous?.version ?? 0);
      for (const id of input.values.sourceMessageIds) assert.ok(entries.some(entry => entry.messageId === id));
      for (const ref of input.values.resources) assert.ok(documents.some(item => item.id === ref.id && item.version === ref.version));
      const now = new Date().toISOString(), value: AgentWork = { ...input.values, id: previous?.id ?? randomUUID(), childId,
        version: input.expectedVersion + 1, createdAt: previous?.createdAt ?? now, updatedAt: now };
      works.set(value.id, structuredClone(value)); workWrites.push(structuredClone(value)); return structuredClone(value);
    },
    writeDocument: async (scope: AgentScope, runId: string, opId: string, sourceQuote: string, mutation: { id: string; change: DocumentChange }) => {
      checkScope(scope, runId); assert.equal(sourceQuote, current(runId).text);
      const item = documents.find(item => item.id === mutation.id); assert.ok(item);
      assert.equal(item.id, documentIds[1], 'Clarification selects only the second listed document');
      const change = mutation.change; assert.equal(change.action, 'check_item'); if (change.action !== 'check_item') throw new Error('Unexpected mutation');
      assert.equal(change.expectedVersion, item.version); assert.equal(change.authorityVersion, 'synthetic-authority:' + item.version);
      const target = item.current!.sections.find(section => section.id === change.sectionId)?.items.find(value => value.id === change.itemId); assert.ok(target);
      assert.equal(target.checked, false); assert.equal(change.checked, true); assert.equal(ledger.has(opId), false);
      target.checked = change.checked; item.version++; documentWrites++;
      ledger.set(opId, { runId, documentId: item.id, savedVersion: item.version, toolName: 'change_family_document' });
      return structuredClone(item);
    },
    documentReceipts: async (_scope: AgentScope, runId: string) => ({ receipts: [...ledger].filter(([, value]) => value.runId === runId)
      .map(([operationId, value]) => ({ operationId, ...value })), unavailable: false, linked: [...ledger.values()].some(value => value.runId === runId) }),
    finish: async (_scope: AgentScope, result: ProductAgentResult) => {
      const entry = current(result.runId); entry.saved = structuredClone(result); entry.claim.state = result.status;
      messages.push({ id: randomUUID(), role: 'model', text: result.text }); return true;
    },
    get: async (_user: string, _child: string, runId: string) => structuredClone(current(runId).saved),
  };
  const memory = { context: async () => ({ profile: { childId, version: 0, data: null }, profileApplicable: false, facts: [], topics: [], summary: null,
    recentMessages: [], conflictingKeys: [], unavailableFactKeys: [], truncated: { facts: false, topics: false, messages: false } }) };
  const chat = { listForUser: async () => ({ messages: newConversation ? messages.filter(item => item.id === entries.at(-1)!.messageId) : messages }) };
  const documentStore = {
    list: async () => ({ items: structuredClone(documents), authorityVersion: 'synthetic-authority:3', hasMore: false, nextCursor: null }),
    describe: async (user: string, child: string, id: string) => {
      assert.equal(user, userId); assert.equal(child, childId); const item = documents.find(value => value.id === id); assert.ok(item);
      return { item: structuredClone(item), authorityVersion: 'synthetic-authority:' + item.version };
    },
  };
  const response = (request: AgentModelRequest, name: string): any => {
    const part = request.contents.flatMap(item => item.parts ?? []).filter(part => part.functionResponse?.name === name).at(-1);
    assert.ok(part?.functionResponse, `Missing real ${name} response`);
    const value = part.functionResponse.response; assert.equal(value?.status, 'succeeded', JSON.stringify(value)); return value?.data;
  };
  const provider: AgentModelProvider = { generate: async request => {
    const entry = entries.at(-1)!; const index = entries.length - 1, turn = completeOnClarification && index === 2 ? 3 : index, step = entry.calls++;
    assert.ok(step < (turn === 3 ? 3 : completeOnClarification && turn === 1 ? 5 : 4));
    const call = (name: string, args: Record<string, unknown>): Call => ({ id: `turn-${turn}-step-${step}-${name}`, name, args });
    const answer = (text: string) => call('present_answer', { kind: turn === 0 ? 'clarification' : 'operation', paragraphs: [{ text, citationIds: [] }] });
    let calls: Call[];
    if (step === 0) {
      assert.equal(Object.hasOwn(request.toolsDict, 'change_family_document'), false);
      if (turn === 3) {
        const serialized = JSON.stringify(request.contents);
        assert.equal(serialized.includes(entries[0].text), false); assert.equal(serialized.includes(documentIds[1]), false);
        assert.equal(serialized.includes([...works.keys()][0]), false, 'Fresh conversation starts without the original work ID');
      }
      calls = [...(turn === 0 ? [call('read_context', {})] : []), call('read_work', { workId: null, cursor: null }), call('load_capabilities', { capabilities: turn === 0 ? ['work', 'documents']
        : turn === 3 ? ['documents'] : turn === 1 ? ['work', 'documents', 'document_edit'] : ['work', 'documents'] })];
    } else if (step === 1) {
      const page = response(request, 'read_work').result;
      if (turn === 0) { assert.deepEqual(page.items, []); calls = [call('read_family_documents', { documentId: null })]; }
      else {
        assert.equal(page.items.length, 1); const work = page.items[0];
        assert.equal(work.version, turn); assert.equal(work.status, turn === 1 ? 'waiting' : turn === 2 ? 'active' : 'completed');
        const selected = work.resources[turn === 1 ? 1 : 0];
        calls = [call('read_family_documents', { documentId: selected.id })];
        if (turn === 1) {
          const { id, childId: _child, version, createdAt: _created, updatedAt: _updated, ...values } = work;
          // This saves only the resolved target and ongoing intent, before any document write can claim success.
          calls.push(call('save_work', { operationId: randomUUID(), workId: id, expectedVersion: version, values: {
            ...values, focus: '已選旅行準備；尚待核對版本並勾選書包。', questions: [], sourceMessageIds: [...work.sourceMessageIds, entry.messageId],
            resources: [selected], status: 'active', followUp: null,
          } }));
        }
      }
    } else if (turn === 0 && step === 2) {
      const listed = response(request, 'read_family_documents').items;
      assert.deepEqual(listed.map((item: any) => item.id), documentIds);
      calls = [call('save_work', { operationId: randomUUID(), workId: null, expectedVersion: 0, values: {
        goal: entry.text, focus: '待選明確文件後，只勾選書包。', questions: ['請選一、入學準備，或二、旅行準備？'],
        sourceMessageIds: [entry.messageId], resources: listed.map((item: any) => ({ kind: 'family_document', id: item.id, version: item.version })),
        pending: [], status: 'waiting', followUp: null,
      } })];
    } else if (turn === 0) {
      response(request, 'save_work'); calls = [answer('你指哪份準備單的書包？一、入學準備；二、旅行準備。')];
    } else if (turn === 3) {
      const read = response(request, 'read_family_documents'); assert.equal(read.document.version, 4);
      assert.equal(read.contentPartial, false); assert.deepEqual(read.snapshot.sections[0].items.map((item: any) => item.checked), [true, false]);
      calls = [answer(`已查回同一份${read.snapshot.title}第${read.document.version}版，書包已勾選，水樽仍未勾選。`)];
    } else if (turn === 1 && step === 2) {
      const read = response(request, 'read_family_documents'); assert.equal(read.contentPartial, false);
      const item = read.snapshot.sections[0].items[0];
      calls = [call('change_family_document', { sourceQuote: entry.text, documentId: read.document.id, change: {
        action: 'check_item', expectedVersion: read.document.version, authorityVersion: read.authorityVersion,
        sectionId: read.snapshot.sections[0].id, itemId: item.id, checked: true,
      } })];
    } else if (turn === 1 && completeOnClarification && step === 3) {
      const changed = response(request, 'change_family_document'), work = response(request, 'save_work').result;
      assert.equal(changed.document.id, documentIds[1]); assert.equal(changed.document.version, 4);
      assert.equal([...ledger.values()].filter(item => item.runId === entry.claim.runId && item.savedVersion === 4).length, 1);
      const { id, childId: _child, version, createdAt: _created, updatedAt: _updated, ...values } = work;
      calls = [call('save_work', { operationId: randomUUID(), workId: id, expectedVersion: version, values: {
        ...values, focus: '已按本輪原成功收據核對同一份文件保存結果。', questions: [],
        resources: [{ kind: 'family_document', id: changed.document.id, version: changed.document.version }], status: 'completed', followUp: null,
      } })];
    } else if (turn === 1 && completeOnClarification) {
      const work = response(request, 'save_work').result; assert.equal(work.status, 'completed');
      calls = [answer('已保存同一份旅行準備第4版，只勾選書包；這項文件整理工作已完成。')];
    } else if (turn === 1) {
      const changed = response(request, 'change_family_document'); assert.equal(changed.document.id, documentIds[1]); assert.equal(changed.document.version, 4);
      calls = [answer(`已保存同一份旅行準備第${changed.document.version}版，只勾選書包；工作進度仍待查回核對。`)];
    } else if (step === 2) {
      const read = response(request, 'read_family_documents'), work = response(request, 'read_work').result.items[0];
      assert.equal(read.document.version, 4); assert.equal(read.snapshot.sections[0].items[0].checked, true);
      const { id, childId: _child, version, createdAt: _created, updatedAt: _updated, ...values } = work;
      calls = [call('save_work', { operationId: randomUUID(), workId: id, expectedVersion: version, values: {
        ...values, focus: '額外查回輪已核對原文件保存結果。', questions: [], sourceMessageIds: [...work.sourceMessageIds, entry.messageId],
        resources: [{ kind: 'family_document', id: read.document.id, version: read.document.version }], status: 'completed', followUp: null,
      } })];
    } else {
      const saved = response(request, 'save_work').result; assert.equal(saved.status, 'completed');
      calls = [answer('已查回核對同一份旅行準備第4版，這項文件整理工作已完成；不代表照護工作完成。')];
    }
    for (const action of calls) assert.ok(Object.hasOwn(request.toolsDict, action.name), action.name);
    return { content: { role: 'model', parts: calls.map(functionCall => ({ functionCall })) }, finishReason: FinishReason.STOP,
      usageMetadata: { promptTokenCount: 10, totalTokenCount: 15 } };
  } };
  return { entries, add, store, memory, chat, documents: documentStore, provider, actualDocuments: documents, works, workWrites, ledger,
    tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) }, stats: () => ({ documentWrites, calls: entries.reduce((n, item) => n + item.calls, 0) }) };
}


test('fixed offline consumer owns three real ProductAgent roots and adjudicates their terminal outcomes', async t => {
  type Domain = ReturnType<typeof domainFixture>;
  for (const [file, factory, key] of [
    ['product-agent-store', 'createProductAgentStore', 'store'], ['memory', 'createMemoryStore', 'memory'],
    ['chat', 'createChatStore', 'chat'], ['tasks', 'createTaskStore', 'tasks'], ['family-document-store', 'createFamilyDocumentStore', 'documents'],
    ['shared-input-store', 'createSharedInputStore', 'sources'], ['concern-store', 'createConcernStore', 'concerns'],
  ]) t.mock.module(`../server/${file}.ts`, { namedExports: { [factory]: (pool: { domain: Domain }) => (pool.domain as any)[key] ?? {} } });
  const { createProductAgentServices } = await import('../server/product-agent-services.ts');
  const domain = domainFixture(true), f = serialFirestoreFixture();
  const config = readAiConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: DOCUMENT_BATCH.project, AI_MAX_ATTEMPTS: '1' });
  const packVersion = (await loadAgentPrompt('product-interactive', 'tool_cycle', ['run', 'scope', 'conversation', 'context', 'evidence', 'capabilities'])).packVersion;
  const storage = { database: f.database, cipher, projectId: 'synthetic-project' };
  const daily = new FirestoreAiUsage({ ...storage, namespace: 'consumer_continuity_daily', billingSource: 'platform' });
  const rootBudget = new FirestoreRootBudget({ ...storage, namespace: 'consumer_continuity_roots' });
  const pool = { domain, query: async () => { throw new Error('Unexpected SQL fallback'); }, connect: async () => { throw new Error('Unexpected SQL'); } } as unknown as Pool;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'consumer-product-synthetic-'));
  const filename = path.join(directory, 'synthetic-ledger.json');
  fs.writeFileSync(filename, JSON.stringify({ ...newOfflineLedger(), offlineSimulationOnly: true }));
  for (const runId of ['historical_b_consumer', 'historical_c_consumer']) {
    const previous = openLedger(filename, { offline: true, runId, caseId: 'B' });
    for (let i = 0; i < 4; i++) { previous.reserve(); previous.response({ promptTokenCount: 10, totalTokenCount: 15 }); }
    previous.finish('completed'); previous.close();
  }
  let embeddingCalls = 0, wireCalls = 0;
  let countedWire: any;
  const consumer = createOfflineDocumentBatchConsumer({ config, productModelModule,
    checkpoint: { filename, batchId: 'product_consumer_synthetic',
      expectedLegacySha256: offlineLegacyFingerprint(JSON.parse(fs.readFileSync(filename, 'utf8'))),
      provenance: { testedSha: '04fb3f3ef7aa70cb63451b1229d8936241e389f1', legacyHarnessSha: 'f93dfb8f200c427867c4a02b803f4453681b0c75',
        candidateSha256: sha256(fs.readFileSync(new URL('../scripts/lib/chat-document-batch-consumer.mjs', import.meta.url))) } },
    synthetic: { count: async (wire: any) => { countedWire = wire; return 10; },
      generate: async (wire: any, context: any) => {
        assert.equal(wire, countedWire); assert.equal(Object.isFrozen(wire), true); wireCalls++;
        assert.equal(wire.url, `https://aiplatform.googleapis.com/v1/projects/${config.project}/locations/global/publishers/google/models/${config.model}:generateContent`);
        const body = JSON.parse(wire.body);
        assert.equal(body.generationConfig.candidateCount, 1); assert.equal(body.generationConfig.maxOutputTokens, 1024);
        assert.ok(body.systemInstruction.parts[0].text); assert.ok(body.tools[0].functionDeclarations.length > 0);
        const { contents, generationConfig, ...remaining } = body;
        return domain.provider.generate({ model: config.model, contents, config: { ...generationConfig, ...remaining }, toolsDict: context.toolsDict, liveConnectConfig: {} }, context.signal);
      } },
    execution: {
      inspect: () => ({ documents: domain.actualDocuments, works: [...domain.works.values()], documentWrites: domain.stats().documentWrites,
        receipts: [...domain.ledger].map(([operationId, receipt]) => ({ operationId, ...receipt })) }),
      runRoot: async (input: any, provider: AgentModelProvider) => {
        const persistence: NonNullable<ProductAgentServicePorts['claimedRunPersistence']> = {
          nativeSessionService: new FirestoreSessionService({ ...storage, namespace: 'consumer_continuity_sessions' }), rootBudget, dailyUsage: daily,
          profile: { config, billingSource: 'platform', workflowVersion: 'product-interactive-v1', promptPackVersion: packVersion,
            settingsVersion: 'fixed-profile-v1', billingVersion: 'platform-v1', runLimits: input.runLimits }, provider,
          embeddingProvider: { embed: async () => { embeddingCalls++; throw new Error('Embedding forbidden'); } },
        };
        const service = createProductAgentServices(pool, cipher, config, undefined, false, undefined, undefined, undefined, undefined, undefined,
          { publishedKnowledgeReader: { candidates: async () => [] }, claimedRunPersistence: persistence });
        const entry = domain.add(input.text, input.freshConversation);
        return service.agent.reply(userId, childId, entry.messageId, async () => true);
      },
    },
  });
  t.after(() => { consumer.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const result = await consumer.run();
  assert.equal(result.mode, 'offline-simulation'); assert.equal(result.results.length, 3);
  assert.equal(result.ledger.state, 'completed'); assert.deepEqual(result.ledger.rootCalls, [4, 5, 3]);
  assert.equal(result.ledger.historicalGenerationCalls, 20); assert.equal(embeddingCalls, 0);
  assert.equal(wireCalls, 12);
  assert.equal(domain.stats().documentWrites, 1); assert.equal((await daily.getForUser(userId)).attempts, 12);
  await assert.rejects(consumer.run(), /consumer_run_reused/);
});
