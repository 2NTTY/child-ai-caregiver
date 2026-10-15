import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Firestore } from '@google-cloud/firestore';
import { FinishReason } from '@google/genai';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { createFirestoreChatStore } from '../server/firestore-chat.ts';
import { createFirestoreCareStore } from '../server/firestore-care.ts';
import { createFirestoreMemoryStore, firestoreMemoryRecoverySchemas } from '../server/firestore-memory.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirestoreProductAgent } from '../server/firestore-product-agent.ts';
import { FirestoreDomainData } from '../server/firestore-domain-data.ts';
import { readContextBasis, settleSummaryRequest } from '../server/firestore-context-basis.ts';
import { createFirestoreBackgroundQueue, prepareFirestoreBackgroundWork, readFirestoreBackgroundClaim,
  firestoreBackgroundReference, type FirestoreBackgroundDelivery } from '../server/firestore-background-work.ts';
import { readAiConfig } from '../server/ai-config.ts';
import { selectRecentConversation } from '../server/agent-context-window.ts';

test('summary batches reuse unaffected history, repair through one claimed Runner and never disclose an erased source', async () => {
  const fake = firestoreDomainFixture();
  function query(raw: any): any { return new Proxy(raw, { get(target, key) {
    if (key === 'get') return () => fake.database.runTransaction(tx => tx.get(target));
    const value = target[key]; return typeof value === 'function' ? (...args: any[]) => {
      const result = value(...args); return result?.query ? query(result) : result?.path ? { ...result, id: result.path.split('/').at(-1) } : result;
    } : value;
  } }); }
  const database = { ...fake.database, collection: (path: string) => query(fake.database.collection(path)) } as Firestore;
  const options = { database, cipher: createStorageCipher(Buffer.alloc(32, 77)), projectId: 'synthetic-summary', namespace: 'unit_summary' };
  const authority = createFirestoreAuthority(options), data = new FirestoreDomainData(options), generation = randomUUID();
  await authority.initializeControl({ generation, enabled: true });
  await authority.issueInvitation({ email: 'owner@example.test', operationId: randomUUID(), expiresAt: new Date(Date.now() + 60000).toISOString() });
  await authority.admitIdentity({ userId: 'owner', email: 'owner@example.test', emailVerified: true });
  await authority.acknowledge({ userId: 'owner', operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  const { child } = await authority.createChild({ userId: 'owner', displayName: '合成孩子', operationId: randomUUID() });
  const chat = createFirestoreChatStore(options), care = createFirestoreCareStore(options), memory = createFirestoreMemoryStore({ ...options, chat, care });
  const online = createFirestoreOnlineStore({ ...options, mutations: [chat.mutation, care.mutation, memory.mutation] });
  await chat.createUserMessageForUser('owner', child.id, '2024 年曾去海邊。');
  async function save(text: string) {
    const input = (await memory.prepareSummary('owner', child.id))!;
    return (await memory.saveSummary('owner', child.id, { previousVersion: input.previousVersion, basis: input.basis, text,
      coveredMessageIds: input.messages.map(message => message.id) }))!;
  }
  const first = await save('2024 年家長提及曾去海邊，屬歷史陳述。');
  const values = { key: '閱讀偏好', content: '先看圖畫', source: { kind: 'manual' as const, description: '本人核對' }, validUntil: null };
  const candidate = await memory.createFact('owner', child.id, { values, intendedVisibility: 'private' });
  const fact = await memory.confirmFact('owner', child.id, candidate!.id, { expectedVersion: 1, confirm: true, confirmShared: false });
  await chat.createUserMessageForUser('owner', child.id, '2025 年喜歡先看圖畫。');
  const second = await save('2025 年家長提及先看圖畫。');
  // An unrelated new topic changes the legacy global basis, not either batch source set.
  await memory.createTopic('owner', child.id, { title: '旅行', note: '', visibility: 'private', confirmShared: false });
  let initial = await memory.initialConversationSummary('owner', child.id);
  assert.ok(initial!.summary.text.includes('海邊')); assert.ok(initial!.summary.text.includes('圖畫'));
  await authority.runTransaction('owner', child.id, async b => {
    const row = await b.transaction.get(data.ref('conversation_summaries', 'conversation-summary', first.id));
    const saved = data.open('conversation-summary', first.id, b.scope, firestoreMemoryRecoverySchemas.summary, row);
    assert.equal(await memory.readSummaryRevision(b, { ...saved, batch: { ...saved.batch!, sourceCoverageComplete: false } }), null,
      'Partial dependency discovery must fall back to the full source basis');
  });
  await memory.reviseFact('owner', child.id, fact!.id, { expectedVersion: 2, confirm: true, confirmShared: false,
    values: { ...values, content: '現在改為先聽故事' }, reason: '本人更正' });
  initial = await memory.initialConversationSummary('owner', child.id);
  assert.ok(initial!.summary.text.includes('海邊')); assert.ok(!initial!.summary.text.includes('圖畫'));
  const repair = await memory.prepareMaintenance('owner', child.id);
  assert.equal(repair!.repairOf, second.id); assert.equal(repair!.messages.length, 1);
  assert.ok(JSON.stringify(repair!.currentSources).includes('先聽故事'));
  assert.equal((await memory.prepareSummary('owner', child.id))!.messages.length, 0, 'Correction never rewinds the append cursor');
  let calls = 0;
  const authorizeWorker = async (b: any, reference: string, recipe: string) => {
    const job = await readFirestoreBackgroundClaim(data, b, reference), current = await readContextBasis(data, b);
    return !!job && job.kind === 'memory-refresh' && recipe === 'memory-refresh' && String(current.value.summaryRequest) === job.basis;
  };
  const product = await createFirestoreProductAgent({ ...options, chat, care, memory, online, authorizeWorker,
    config: readAiConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: options.projectId }), platformProvider: { async generate(request) {
      calls++; assert.equal(calls, 1, 'Exactly one generation for this batch');
      assert.ok(JSON.stringify(request.contents).includes('先聽故事'));
      return { content: { role: 'model', parts: [{ functionCall: { id: 'summary', name: 'stage_private_summary',
        args: { text: '2025 年曾提及圖畫，現在本人更正為先聽故事；舊說法不再代表目前偏好。' } } }] },
        finishReason: FinishReason.STOP, usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } };
    } } });
  const deliveries: FirestoreBackgroundDelivery[] = [];
  const queue = createFirestoreBackgroundQueue({ ...options, enabled: true, readControl: async () => ({ enabled: true, generation }),
    transport: { enqueue: async item => { deliveries.push(item); return { state: 'confirmed' }; }, probe: async () => ({ state: 'confirmed' }) },
    execute: async (job, signal) => {
      const result = await product.maintainSummary({ userId: 'owner', childId: child.id, reference: firestoreBackgroundReference(job), authorize: async () => true, signal });
      assert.equal(result.state, 'completed', JSON.stringify(result)); assert.equal(result.more, false); return { state: result.state };
    } });
  const id = await authority.runTransaction('owner', child.id, async b => {
    const current = await readContextBasis(data, b);
    const work = await prepareFirestoreBackgroundWork(data, b.transaction, { kind: 'memory-refresh', scope: b.scope,
      resourceId: child.id, basis: String(current.value.summaryRequest), generation: b.generation, authorizationVersion: b.authorizationVersion }, new Date(Date.now() - 1000).toISOString());
    work.commit(); return work.id;
  });
  await queue.dispatch(); const delivery = deliveries.find(item => item.id === id)!;
  assert.equal((await queue.process(delivery)).state, 'completed');
  assert.equal((await queue.process(delivery)).state, 'completed'); assert.equal(calls, 1);
  const reconnected = createFirestoreMemoryStore({ ...options, chat: createFirestoreChatStore(options), care: createFirestoreCareStore(options) });
  initial = await reconnected.initialConversationSummary('owner', child.id);
  assert.ok(initial!.summary.text.includes('海邊')); assert.ok(initial!.summary.text.includes('先聽故事'));
  assert.equal((await reconnected.prepareMaintenance('owner', child.id)), null);
  const firstRow = fake.records.get(data.ref('conversation_summaries', 'conversation-summary', first.id).path)!;
  assert.equal(firstRow.recordVersion, first.version, 'Unrelated batch is not rewritten');
  await memory.delete('owner', child.id, 'facts', fact!.id, 3);
  initial = await memory.initialConversationSummary('owner', child.id);
  assert.ok(initial!.summary.text.includes('海邊')); assert.ok(!initial!.summary.text.includes('先聽故事'));
  assert.equal(await memory.prepareMaintenance('owner', child.id), null, 'Erased facts are not regenerated from old chat');
  await authority.runTransaction('owner', child.id, async b => {
    const row = await b.transaction.get(data.ref('conversation_summary_heads', 'conversation-summary-head', JSON.stringify(['owner', child.id])));
    const saved = data.open('conversation-summary-head', JSON.stringify(['owner', child.id]), b.scope, firestoreMemoryRecoverySchemas.summary, row);
    assert.equal(await memory.readSummaryRevision(b, saved), null, 'The export/history reader uses the same validity gate');
  });
  await authority.runTransaction('owner', child.id, async b => {
    const state = await readContextBasis(data, b);
    await settleSummaryRequest(data, b, state.value.summaryRequest! - 1, 'unknown');
  });
  await chat.createUserMessageForUser('owner', child.id, '新增訊息不解除未知整理結果的屏障。');
  await authority.runTransaction('owner', child.id, async b => { assert.equal((await readContextBasis(data, b)).value.summaryBlocked, true); });
  const messages = Array.from({ length: 200 }, (_, index) => ({ id: String(index), role: 'user', text: '合成長文'.repeat(600) }));
  const selected = selectRecentConversation(messages, 199);
  assert.ok(selected.messages.length <= 6); assert.ok(selected.coverage.characters <= 14000);
  assert.equal(selected.messages.at(-1)!.id, '199'); assert.equal(selected.coverage.complete, false);
  assert.equal(selected.messages[0].text, messages[0].text, 'Whole messages, no hidden truncation');
});
