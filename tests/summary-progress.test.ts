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
import { createFirestoreMemoryStore } from '../server/firestore-memory.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirestoreProductAgent } from '../server/firestore-product-agent.ts';
import { FirestoreDomainData } from '../server/firestore-domain-data.ts';
import { readContextBasis, settleSummaryRequest } from '../server/firestore-context-basis.ts';
import {
  createFirestoreBackgroundQueue,
  prepareFirestoreBackgroundWork,
  readFirestoreBackgroundClaim,
  firestoreBackgroundReference,
  type FirestoreBackgroundDelivery,
} from '../server/firestore-background-work.ts';
import { readAiConfig } from '../server/ai-config.ts';
import { agentRequestCharacters } from '../server/agent-model-gateway.ts';
import { AGENT_LIMITS } from '../server/agent-budget.ts';
import {
  selectSummaryBatchMessages,
  SUMMARY_BATCH_TARGET_CHARS,
} from '../server/summary-window-helper.ts';

function createHarness(owner = 'owner') {
  const fake = firestoreDomainFixture();
  function query(raw: any): any {
    return new Proxy(raw, {
      get(target, key) {
        if (key === 'get') return () => fake.database.runTransaction(tx => tx.get(target));
        const value = target[key];
        return typeof value === 'function' ? (...args: any[]) => {
          const result = value(...args);
          return result?.query ? query(result) : result?.path ? { ...result, id: result.path.split('/').at(-1) } : result;
        } : value;
      }
    });
  }
  const database = { ...fake.database, collection: (path: string) => query(fake.database.collection(path)) } as Firestore;
  const options = { database, cipher: createStorageCipher(Buffer.alloc(32, 88)), projectId: 'synthetic-progress', namespace: 'unit_progress' };
  const authority = createFirestoreAuthority(options);
  const data = new FirestoreDomainData(options);
  const chat = createFirestoreChatStore(options);
  const care = createFirestoreCareStore(options);
  const memory = createFirestoreMemoryStore({ ...options, chat, care });
  const online = createFirestoreOnlineStore({ ...options, mutations: [chat.mutation, care.mutation, memory.mutation] });

  let capturedGeneration = '';
  async function bootstrapUserAndChild() {
    capturedGeneration = randomUUID();
    await authority.initializeControl({ generation: capturedGeneration, enabled: true });
    await authority.issueInvitation({ email: 'owner@example.test', operationId: randomUUID(), expiresAt: new Date(Date.now() + 60000).toISOString() });
    await authority.admitIdentity({ userId: owner, email: 'owner@example.test', emailVerified: true });
    await authority.acknowledge({ userId: owner, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
    const { child } = await authority.createChild({ userId: owner, displayName: '測試孩子', operationId: randomUUID() });
    return { child };
  }

  return { owner, authority, data, chat, care, memory, online, options, getGeneration: () => capturedGeneration, bootstrapUserAndChild };
}

// ----------------------------------------------------------------------------
// Test 1: Bounded first-item accommodation on 7,000 emoji (14,000 UTF-16 code units)
// ----------------------------------------------------------------------------
test('Test 1 (7,000 emoji): prepareMaintenance does not stall on 14k UTF-16 message and provides bounded accommodation', async () => {
  const h = createHarness();
  const { child } = await h.bootstrapUserAndChild();
  const emojiText = '😀'.repeat(7000); // 7,000 code points, 14,000 UTF-16 units
  assert.equal([...emojiText].length, 7000);
  assert.equal(emojiText.length, 14000);

  const msg = await h.chat.createUserMessageForUser('owner', child.id, emojiText);
  assert.ok(msg);

  const batch = await h.memory.prepareMaintenance('owner', child.id);
  assert.ok(batch, 'Maintenance batch must not be null');
  assert.equal(batch.unavailableReason, undefined, 'Must not stall with message_requires_continuation');
  assert.equal(batch.messages.length, 1, 'Should accommodate the bounded first message');
  assert.equal(batch.messages[0].id, msg.id);
});

// ----------------------------------------------------------------------------
// Test 2: Watermark advancement verification after saving summary of long message
// ----------------------------------------------------------------------------
test('Test 2 (watermark advancement): saving summary of long message advances watermark pointer cleanly', async () => {
  const h = createHarness();
  const { child } = await h.bootstrapUserAndChild();
  const emojiText = '😀'.repeat(7000);
  const msg = await h.chat.createUserMessageForUser('owner', child.id, emojiText);

  const batch = (await h.memory.prepareMaintenance('owner', child.id))!;
  assert.ok(batch);

  // Save the summary covering this 7,000 emoji message
  const saved = await h.memory.saveSummary('owner', child.id, {
    previousVersion: batch.previousVersion,
    basis: batch.basis,
    text: '已總結 7,000 emoji 之長訊息內容',
    coveredMessageIds: [msg!.id],
  });
  assert.ok(saved);
  assert.equal(saved.version, 1);
  assert.equal(saved.coveredMessageIds[0], msg!.id);

  // Subsequent prepareMaintenance must see no remaining uncovered messages
  const nextBatch = await h.memory.prepareMaintenance('owner', child.id);
  assert.equal(nextBatch, null, 'Watermark must advance: long message should not be re-queried');

  // Add a new small message and verify it is queried from the new watermark
  const nextMsg = await h.chat.createUserMessageForUser('owner', child.id, '新訊息');
  const followUpBatch = await h.memory.prepareMaintenance('owner', child.id);
  assert.ok(followUpBatch);
  assert.equal(followUpBatch.messages.length, 1);
  assert.equal(followUpBatch.messages[0].id, nextMsg!.id);
});

test('single-message selection leaves actual request admission to the Runner without dropping the source', () => {
  for (const length of [5300, 5400, 5500, 5900, 10000]) {
    const message = { id: `quotes-${length}`, text: '"'.repeat(length) };
    const selected = selectSummaryBatchMessages([message]);
    assert.deepEqual(selected.messages, [message]);
    assert.equal(selected.moreUncovered, false);
  }
});

test('normal accumulation obeys the exact raw JSON target without ballooning multi-message batches', () => {
  const rawMessages = Array.from({ length: 30 }, (_, index) => ({ id: `msg-${index}`, role: 'user', text: 'X'.repeat(1000) }));
  const selected = selectSummaryBatchMessages(rawMessages);
  assert.ok(JSON.stringify(selected.messages).length <= SUMMARY_BATCH_TARGET_CHARS);
  assert.ok(JSON.stringify([...selected.messages, rawMessages[selected.messages.length]]).length > SUMMARY_BATCH_TARGET_CHARS);
  assert.equal(selected.moreUncovered, true);
  const first = { id: 'long-first', text: '😀'.repeat(7000) };
  assert.deepEqual(selectSummaryBatchMessages([first, ...rawMessages]).messages, [first]);
});

// ----------------------------------------------------------------------------
// Test 5: Real request measurement using createFirestoreProductAgent + maintainSummary
// ----------------------------------------------------------------------------
test('Test 5 (real request measurement): end-to-end maintainSummary request with full instructions and tools stays <= 32k Gateway limit', async () => {
  const h = createHarness();
  const { child } = await h.bootstrapUserAndChild();
  const generation = h.getGeneration();

  // Create 7,000 emoji message (14,000 UTF-16 code units)
  const emojiText = '😀'.repeat(7000);
  const msg = await h.chat.createUserMessageForUser('owner', child.id, emojiText);
  assert.ok(msg);

  let capturedRequest: any = null;
  const authorizeWorker = async (b: any, reference: string, recipe: string) => {
    const job = await readFirestoreBackgroundClaim(h.data, b, reference), current = await readContextBasis(h.data, b);
    return !!job && job.kind === 'memory-refresh' && recipe === 'memory-refresh' && String(current.value.summaryRequest) === job.basis;
  };

  const product = await createFirestoreProductAgent({
    ...h.options,
    chat: h.chat,
    care: h.care,
    memory: h.memory,
    online: h.online,
    authorizeWorker,
    config: readAiConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: h.options.projectId }),
    platformProvider: {
      async generate(request) {
        capturedRequest = request;
        return {
          content: {
            role: 'model',
            parts: [{ functionCall: { id: 'summary', name: 'stage_private_summary', args: { text: '成功總結長訊息' } } }],
          },
          finishReason: FinishReason.STOP,
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
        };
      },
    },
  });

  const deliveries: FirestoreBackgroundDelivery[] = [];
  const queue = createFirestoreBackgroundQueue({
    ...h.options,
    enabled: true,
    readControl: async () => ({ enabled: true, generation }),
    transport: { enqueue: async item => { deliveries.push(item); return { state: 'confirmed' }; }, probe: async () => ({ state: 'confirmed' }) },
    execute: async (job, signal) => {
      const result = await product.maintainSummary({
        userId: 'owner',
        childId: child.id,
        reference: firestoreBackgroundReference(job),
        authorize: async () => true,
        signal,
      });
      assert.equal(result.state, 'completed', JSON.stringify(result));
      return { state: result.state };
    },
  });

  const workId = await h.authority.runTransaction('owner', child.id, async b => {
    const current = await readContextBasis(h.data, b);
    const work = await prepareFirestoreBackgroundWork(
      h.data,
      b.transaction,
      { kind: 'memory-refresh', scope: b.scope, resourceId: child.id, basis: String(current.value.summaryRequest), generation: b.generation, authorizationVersion: b.authorizationVersion },
      new Date(Date.now() - 1000).toISOString()
    );
    work.commit();
    return work.id;
  });

  await queue.dispatch();
  const delivery = deliveries.find(item => item.id === workId)!;
  assert.ok(delivery);
  const processResult = await queue.process(delivery);
  assert.equal(processResult.state, 'completed');

  // Verify real request characters measured directly from platformProvider.generate
  assert.ok(capturedRequest, 'Must have captured real LLM request');
  const realChars = agentRequestCharacters(capturedRequest);

  // Must be strictly within 32k Gateway limit
  assert.ok(realChars <= AGENT_LIMITS.inputCharacters, `Real request (${realChars}) must not exceed Gateway limit (${AGENT_LIMITS.inputCharacters})`);
});

// ----------------------------------------------------------------------------
// Test 6: Repair input preserves complete original messages, including oversized work
// ----------------------------------------------------------------------------
test('repairInput retains long original messages and exposes oversized pending repairs', async () => {
  const h = createHarness();
  const { child } = await h.bootstrapUserAndChild();

  // --- Part A: 14k UTF-16 repair succeeds ---
  const values = { key: '作息偏好', content: '早睡早起', source: { kind: 'manual' as const, description: '家長' }, validUntil: null };
  const candidate = await h.memory.createFact('owner', child.id, { values, intendedVisibility: 'private' });
  const fact = await h.memory.confirmFact('owner', child.id, candidate!.id, { expectedVersion: 1, confirm: true, confirmShared: false });

  const emojiText = '😀'.repeat(7000);
  const msg = await h.chat.createUserMessageForUser('owner', child.id, emojiText);

  const input = (await h.memory.prepareSummary('owner', child.id))!;
  const saved = (await h.memory.saveSummary('owner', child.id, {
    previousVersion: input.previousVersion,
    basis: input.basis,
    text: '初始摘要記錄長訊息',
    coveredMessageIds: [msg!.id],
  }))!;
  assert.ok(saved);

  await h.memory.reviseFact('owner', child.id, fact!.id, {
    expectedVersion: 2,
    confirm: true,
    confirmShared: false,
    values: { ...values, content: '晚睡早起' },
    reason: '更正',
  });

  const repair = await h.memory.prepareMaintenance('owner', child.id);
  assert.ok(repair, 'repairInput must not return null for 14k UTF-16 content');
  assert.equal(repair.repairOf, saved.id);
  assert.equal(repair.messages.length, 1);
  assert.equal(repair.messages[0].id, msg!.id);

  // --- Part B: escape-heavy invalidated batch stays pending ---
  // Save the repair summary to advance watermark, then create a new escape-heavy scenario.
  await h.memory.saveSummary('owner', child.id, {
    previousVersion: repair.previousVersion,
    basis: repair.basis,
    text: '更正後摘要',
    coveredMessageIds: [msg!.id],
    repairOf: saved.id,
  });

  // Create a second fact + escape-heavy message, save summary, then invalidate
  const values2 = { key: '飲食偏好', content: '先喝水', source: { kind: 'manual' as const, description: '家長' }, validUntil: null };
  const candidate2 = await h.memory.createFact('owner', child.id, { values: values2, intendedVisibility: 'private' });
  const fact2 = await h.memory.confirmFact('owner', child.id, candidate2!.id, { expectedVersion: 1, confirm: true, confirmShared: false });

  const quotesText = '"'.repeat(5900); // payload ~23.9k > 21.5k ceiling
  const quoteMsg = await h.chat.createUserMessageForUser('owner', child.id, quotesText);
  assert.ok(quoteMsg);

  const input2 = (await h.memory.prepareSummary('owner', child.id))!;
  // prepareSummary returns the raw message; save a summary covering it
  const saved2 = (await h.memory.saveSummary('owner', child.id, {
    previousVersion: input2.previousVersion,
    basis: input2.basis,
    text: '摘要含引號長訊息',
    coveredMessageIds: [quoteMsg!.id],
  }))!;
  assert.ok(saved2);

  // Revise the second fact to invalidate the batch containing 5,900 quotes
  await h.memory.reviseFact('owner', child.id, fact2!.id, {
    expectedVersion: 2,
    confirm: true,
    confirmShared: false,
    values: { ...values2, content: '現在改為先喝茶' },
    reason: '更正',
  });

  // Size is decided using the complete Runner request; pending work is never reported as empty.
  const pending = await h.memory.prepareMaintenance('owner', child.id);
  assert.ok(pending);
  assert.equal(pending.repairOf, saved2.id);
  assert.equal(pending.messages[0].text, quotesText);
});

// ----------------------------------------------------------------------------
// Test 7: Near-ceiling real request measurement (~30.9k <= 32k Gateway limit)
// ----------------------------------------------------------------------------
test('Test 7 (near-ceiling real request): 5,300 quotes stays within 32k Gateway limit through real maintainSummary path', async () => {
  const h = createHarness();
  const { child } = await h.bootstrapUserAndChild();
  const generation = h.getGeneration();

  // Create 5,300 quotes message (payload ~21.3k, real request ~30.9k <= 32k)
  const quotes5300 = '"'.repeat(5300);
  const msg = await h.chat.createUserMessageForUser('owner', child.id, quotes5300);
  assert.ok(msg);

  let capturedRequest: any = null;
  const authorizeWorker = async (b: any, reference: string, recipe: string) => {
    const job = await readFirestoreBackgroundClaim(h.data, b, reference), current = await readContextBasis(h.data, b);
    return !!job && job.kind === 'memory-refresh' && recipe === 'memory-refresh' && String(current.value.summaryRequest) === job.basis;
  };

  const product = await createFirestoreProductAgent({
    ...h.options,
    chat: h.chat,
    care: h.care,
    memory: h.memory,
    online: h.online,
    authorizeWorker,
    config: readAiConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: h.options.projectId }),
    platformProvider: {
      async generate(request) {
        capturedRequest = request;
        return {
          content: {
            role: 'model',
            parts: [{ functionCall: { id: 'summary', name: 'stage_private_summary', args: { text: '成功總結高跳脫長訊息' } } }],
          },
          finishReason: FinishReason.STOP,
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
        };
      },
    },
  });

  const deliveries: FirestoreBackgroundDelivery[] = [];
  const queue = createFirestoreBackgroundQueue({
    ...h.options,
    enabled: true,
    readControl: async () => ({ enabled: true, generation }),
    transport: { enqueue: async item => { deliveries.push(item); return { state: 'confirmed' }; }, probe: async () => ({ state: 'confirmed' }) },
    execute: async (job, signal) => {
      const result = await product.maintainSummary({
        userId: 'owner',
        childId: child.id,
        reference: firestoreBackgroundReference(job),
        authorize: async () => true,
        signal,
      });
      assert.equal(result.state, 'completed', JSON.stringify(result));
      return { state: result.state };
    },
  });

  const workId = await h.authority.runTransaction('owner', child.id, async b => {
    const current = await readContextBasis(h.data, b);
    const work = await prepareFirestoreBackgroundWork(
      h.data,
      b.transaction,
      { kind: 'memory-refresh', scope: b.scope, resourceId: child.id, basis: String(current.value.summaryRequest), generation: b.generation, authorizationVersion: b.authorizationVersion },
      new Date(Date.now() - 1000).toISOString()
    );
    work.commit();
    return work.id;
  });

  await queue.dispatch();
  const delivery = deliveries.find(item => item.id === workId)!;
  assert.ok(delivery);
  const processResult = await queue.process(delivery);
  assert.equal(processResult.state, 'completed');

  assert.ok(capturedRequest, 'Must have captured real LLM request');
  const realChars = agentRequestCharacters(capturedRequest);

  // Assert it stays strictly within the Gateway 32k limit
  assert.ok(realChars <= AGENT_LIMITS.inputCharacters, `Near-ceiling request (${realChars}) must not exceed Gateway limit (${AGENT_LIMITS.inputCharacters})`);
});

async function runMaintenance(h: ReturnType<typeof createHarness>, childId: string, onGenerate?: () => Promise<void>) {
  const requests: import('@google/adk').LlmRequest[] = [];
  const authorizeWorker = async (binding: any, reference: string, recipe: string) => {
    const job = await readFirestoreBackgroundClaim(h.data, binding, reference);
    const current = await readContextBasis(h.data, binding);
    return !!job && job.kind === 'memory-refresh' && recipe === 'memory-refresh'
      && String(current.value.summaryRequest) === job.basis;
  };
  const product = await createFirestoreProductAgent({ ...h.options, chat: h.chat, care: h.care, memory: h.memory,
    online: h.online, authorizeWorker, config: readAiConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: h.options.projectId }),
    platformProvider: { async generate(request) {
      requests.push(structuredClone({ ...request, toolsDict: {} }));
      await onGenerate?.();
      return { content: { role: 'model', parts: [{ functionCall: { id: 'summary', name: 'stage_private_summary',
        args: { text: 'Synthetic complete batch summary' } } }] }, finishReason: FinishReason.STOP,
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } };
    } },
  });
  const priorRuns = new Set((await product.store.backgroundRuns(h.owner, childId) ?? []).map(run => run.runId));
  const deliveries: FirestoreBackgroundDelivery[] = [];
  let maintenance: Awaited<ReturnType<typeof product.maintainSummary>> | undefined;
  const queue = createFirestoreBackgroundQueue({ ...h.options, enabled: true,
    readControl: async () => ({ enabled: true, generation: h.getGeneration() }),
    transport: { enqueue: async item => { deliveries.push(item); return { state: 'confirmed' }; }, probe: async () => ({ state: 'confirmed' }) },
    execute: async (job, signal) => {
      maintenance = await product.maintainSummary({ userId: h.owner, childId, reference: firestoreBackgroundReference(job),
        authorize: async () => true, signal });
      await h.authority.runTransaction(h.owner, childId, async binding => {
        await settleSummaryRequest(h.data, binding, Number(job.basis), maintenance!.state === 'unknown' ? 'unknown'
          : maintenance!.state === 'completed' ? ('more' in maintenance! && maintenance!.more ? 'more' : 'complete') : 'deferred',
          firestoreBackgroundReference(job));
      });
      return { state: maintenance.state };
    },
  });
  const workId = await h.authority.runTransaction(h.owner, childId, async binding => {
    const current = await readContextBasis(h.data, binding);
    const work = await prepareFirestoreBackgroundWork(h.data, binding.transaction, { kind: 'memory-refresh', scope: binding.scope,
      resourceId: childId, basis: String(current.value.summaryRequest), generation: binding.generation,
      authorizationVersion: binding.authorizationVersion }, new Date(Date.now() - 1000).toISOString());
    work.commit(); return work.id;
  });
  await queue.dispatch();
  const delivery = deliveries.find(item => item.id === workId);
  assert.ok(delivery);
  await queue.process(delivery);
  assert.ok(maintenance);
  const runs = await product.store.backgroundRuns(h.owner, childId);
  assert.ok(runs);
  const added = runs.filter(run => !priorRuns.has(run.runId));
  assert.equal(added.length, 1);
  const stored = await product.store.get(h.owner, childId, added[0].runId);
  assert.ok(stored);
  return { result: maintenance, requests, stored };
}

for (const quotes of [5400, 5500]) test(`real worker preserves baseline progress for ${quotes} quotes without a calibrated reserve`, async () => {
  const h = createHarness();
  const { child } = await h.bootstrapUserAndChild();
  const original = await h.chat.createUserMessageForUser('owner', child.id, '"'.repeat(quotes));
  const { result, requests } = await runMaintenance(h, child.id);
  assert.equal(result.state, 'completed', JSON.stringify(result));
  assert.equal(requests.length, 1);
  assert.ok(agentRequestCharacters(requests[0]) <= 32000);
  const metadata = JSON.parse(String(requests[0].config?.systemInstruction).split('Server runtime metadata:\n')[1]);
  assert.deepEqual(Object.keys(metadata.budget).sort(), ['usedBeforeThisCall', 'remaining', 'phase',
    'reserveForFinish', 'reserveForDeliveryReview', 'softRemaining'].sort());
  assert.deepEqual(metadata.budget.usedBeforeThisCall, { modelCalls: 0, toolCalls: 0, queryEmbeddings: 0 });
  assert.equal(metadata.budget.remaining.modelCallsIncludingThisCall, metadata.limits.modelCalls);
  assert.deepEqual(metadata.budget.reserveForFinish, { modelCalls: 1, toolCalls: 1 });
  assert.deepEqual(metadata.budget.reserveForDeliveryReview, { modelCalls: 0 });
  assert.equal(metadata.budget.phase, 'finish');
  assert.ok(metadata.budget.softRemaining.modelCalls > 0);
  const supplied = JSON.parse(requests[0].contents[0].parts![0].text!);
  assert.deepEqual(supplied.sourceMessages.map((message: any) => message.id), [original!.id]);
  assert.equal(supplied.sourceMessages[0].text, '"'.repeat(quotes));
  assert.equal(await h.memory.prepareMaintenance('owner', child.id), null);
  const next = await h.chat.createUserMessageForUser('owner', child.id, 'Next uncovered source');
  assert.deepEqual((await h.memory.prepareMaintenance('owner', child.id))!.messages.map(message => message.id), [next!.id]);
});

test('an oversized repair stays hidden and reports input_limit instead of successful empty maintenance', async () => {
  const h = createHarness();
  const { child } = await h.bootstrapUserAndChild();
  const values = { key: 'Synthetic source', content: 'old', source: { kind: 'manual' as const, description: 'owner' }, validUntil: null };
  const candidate = await h.memory.createFact('owner', child.id, { values, intendedVisibility: 'private' });
  const fact = await h.memory.confirmFact('owner', child.id, candidate!.id, { expectedVersion: 1, confirm: true, confirmShared: false });
  const message = await h.chat.createUserMessageForUser('owner', child.id, '"'.repeat(5900));
  const prepared = (await h.memory.prepareSummary('owner', child.id))!;
  const saved = (await h.memory.saveSummary('owner', child.id, { previousVersion: prepared.previousVersion, basis: prepared.basis,
    text: 'Obsolete synthetic summary', coveredMessageIds: [message!.id] }))!;
  await h.memory.reviseFact('owner', child.id, fact!.id, { expectedVersion: 2, confirm: true, confirmShared: false,
    values: { ...values, content: 'new' }, reason: 'Correction' });
  const { result, requests } = await runMaintenance(h, child.id);
  assert.equal(result.state, 'stopped');
  assert.equal('stopReason' in result ? result.stopReason : undefined, 'input_limit');
  assert.equal(requests.length, 0);
  assert.equal((await h.memory.prepareMaintenance('owner', child.id))!.repairOf, saved.id);
  assert.equal((await h.memory.summary('owner', child.id))!.summary, null);
});


test('actual request fitting keeps an ordered prefix and advances only the supplied coverage', async () => {
  const h = createHarness();
  const { child } = await h.bootstrapUserAndChild();
  for (let index = 0; index < 3; index++) await h.chat.createUserMessageForUser('owner', child.id, '"'.repeat(1850));
  const pending = (await h.memory.prepareSummary('owner', child.id))!.messages;
  assert.equal((await h.memory.prepareMaintenance('owner', child.id))!.messages.length, 3);
  const { result, requests, stored } = await runMaintenance(h, child.id);
  assert.equal(result.state, 'completed', JSON.stringify(result));
  assert.equal(requests.length, 1);
  assert.ok(agentRequestCharacters(requests[0]) <= 32000);
  const supplied = JSON.parse(requests[0].contents[0].parts![0].text!);
  const context = JSON.parse(requests[0].contents[0].parts![1].text!.split('\n').slice(1).join('\n'));
  assert.deepEqual(supplied.sourceMessages, pending.slice(0, 2));
  assert.deepEqual(context.coverage.messageIds, pending.slice(0, 2).map(message => message.id));
  assert.equal(context.coverage.moreUncovered, true);
  assert.deepEqual(stored.counts, { modelCalls: 1, toolCalls: 1, queryEmbeddings: 0 });
  assert.deepEqual((await h.memory.summary('owner', child.id))!.summary!.coveredMessageIds, context.coverage.messageIds);
  assert.deepEqual((await h.memory.prepareMaintenance('owner', child.id))!.messages, pending.slice(2));
});

for (const scenario of [
  { name: '10k quotes', owner: 'owner', text: '"'.repeat(10000) },
  { name: 'schema-maximum escaped owner metadata', owner: '\u0001'.repeat(256), text: '"'.repeat(4853) },
]) test(`oversized ${scenario.name} stops before model reservation without advancing or skipping coverage`, async () => {
  const h = createHarness(scenario.owner);
  const { child } = await h.bootstrapUserAndChild();
  const message = await h.chat.createUserMessageForUser(h.owner, child.id, scenario.text);
  await h.chat.createUserMessageForUser(h.owner, child.id, 'Later source must not be skipped to');
  const { result, requests, stored } = await runMaintenance(h, child.id);
  assert.equal(result.state, 'stopped');
  assert.equal('stopReason' in result ? result.stopReason : undefined, 'input_limit');
  assert.equal(requests.length, 0);
  assert.deepEqual(stored.counts, { modelCalls: 0, toolCalls: 0, queryEmbeddings: 0 });
  assert.equal((await h.memory.summary(h.owner, child.id))!.summary, null);
  assert.equal((await h.memory.prepareMaintenance(h.owner, child.id))!.messages[0].id, message!.id);
});


test('an oversized repair cannot starve another repair or fresh coverage across worker restarts', async () => {
  const h = createHarness();
  const { child } = await h.bootstrapUserAndChild();
  const values = { key: 'Shared dependency', content: 'old', source: { kind: 'manual' as const, description: 'owner' }, validUntil: null };
  const candidate = await h.memory.createFact('owner', child.id, { values, intendedVisibility: 'private' });
  const fact = await h.memory.confirmFact('owner', child.id, candidate!.id, { expectedVersion: 1, confirm: true, confirmShared: false });
  async function saveMessage(text: string) {
    const message = await h.chat.createUserMessageForUser('owner', child.id, text);
    const input = (await h.memory.prepareSummary('owner', child.id))!;
    const summary = (await h.memory.saveSummary('owner', child.id, { previousVersion: input.previousVersion, basis: input.basis,
      text: 'Synthetic old batch', coveredMessageIds: [message!.id] }))!;
    return { message: message!, summary };
  }
  const small = await saveMessage('Earlier repairable source');
  const oversized = await saveMessage('"'.repeat(5900));
  await h.memory.reviseFact('owner', child.id, fact!.id, { expectedVersion: 2, confirm: true, confirmShared: false,
    values: { ...values, content: 'new' }, reason: 'Correction' });
  const fresh = await h.chat.createUserMessageForUser('owner', child.id, 'Fresh source must advance');
  const repaired = await runMaintenance(h, child.id);
  assert.equal(repaired.result.state, 'completed', JSON.stringify(repaired.result));
  assert.equal(repaired.requests.length, 1);
  assert.deepEqual(JSON.parse(repaired.requests[0].contents[0].parts![0].text!).sourceMessages.map((message: any) => message.id), [small.message.id]);
  assert.equal((await h.memory.prepareSummary('owner', child.id))!.messages[0].id, fresh!.id, 'Repair does not rewind the append watermark');

  // A new store and a new claimed worker reconstruct choices from persistent state.
  h.memory = createFirestoreMemoryStore({ ...h.options, chat: h.chat, care: h.care });
  const advanced = await runMaintenance(h, child.id);
  assert.equal(advanced.result.state, 'completed', JSON.stringify(advanced.result));
  assert.equal('more' in advanced.result && advanced.result.more, true, 'The unprocessed repair remains pending');
  assert.equal(advanced.requests.length, 1);
  assert.deepEqual(JSON.parse(advanced.requests[0].contents[0].parts![0].text!).sourceMessages.map((message: any) => message.id), [fresh!.id]);
  assert.equal((await h.memory.prepareSummary('owner', child.id))!.messages.length, 0);
  assert.deepEqual((await h.memory.summary('owner', child.id))!.summary!.coveredMessageIds, [fresh!.id]);

  h.memory = createFirestoreMemoryStore({ ...h.options, chat: h.chat, care: h.care });
  const pending = await runMaintenance(h, child.id);
  assert.equal(pending.result.state, 'stopped');
  assert.equal('stopReason' in pending.result ? pending.result.stopReason : undefined, 'input_limit');
  assert.equal(pending.requests.length, 0);
  assert.equal((await h.memory.prepareMaintenance('owner', child.id))!.repairOf, oversized.summary.id);
  const state = await h.authority.runTransaction('owner', child.id, binding => readContextBasis(h.data, binding));
  assert.equal(state.value.summaryPending, true, 'Exhausting fit candidates must not clear the persistent pending marker');
});

for (const count of [7000, 10000]) test(`actual claimed worker advances a ${count}-emoji legal source intact`, async () => {
  const h = createHarness();
  const { child } = await h.bootstrapUserAndChild();
  const text = '😀'.repeat(count);
  const message = await h.chat.createUserMessageForUser(h.owner, child.id, text);
  const run = await runMaintenance(h, child.id);
  assert.equal(run.result.state, 'completed', JSON.stringify(run.result));
  assert.equal(run.requests.length, 1);
  assert.ok(agentRequestCharacters(run.requests[0]) <= 32000);
  const supplied = JSON.parse(run.requests[0].contents[0].parts![0].text!);
  assert.equal(supplied.sourceMessages[0].text, text);
  assert.deepEqual((await h.memory.summary(h.owner, child.id))!.summary!.coveredMessageIds, [message!.id]);
  assert.equal(await h.memory.prepareMaintenance(h.owner, child.id), null);
});

test('actual worker repairs a long original with all current correction data atomically', async () => {
  const h = createHarness();
  const { child } = await h.bootstrapUserAndChild();
  const values = { key: 'Synthetic preference', content: 'Old value', source: { kind: 'manual' as const, description: 'owner' }, validUntil: null };
  const candidate = await h.memory.createFact(h.owner, child.id, { values, intendedVisibility: 'private' });
  const fact = await h.memory.confirmFact(h.owner, child.id, candidate!.id, { expectedVersion: 1, confirm: true, confirmShared: false });
  const text = '😀'.repeat(7000);
  const message = await h.chat.createUserMessageForUser(h.owner, child.id, text);
  const batch = (await h.memory.prepareSummary(h.owner, child.id))!;
  const saved = (await h.memory.saveSummary(h.owner, child.id, { previousVersion: batch.previousVersion, basis: batch.basis,
    text: 'Synthetic obsolete summary', coveredMessageIds: [message!.id] }))!;
  await h.memory.reviseFact(h.owner, child.id, fact!.id, { expectedVersion: 2, confirm: true, confirmShared: false,
    values: { ...values, content: 'New value' }, reason: 'Synthetic correction' });
  const pending = (await h.memory.prepareMaintenance(h.owner, child.id))!;
  const run = await runMaintenance(h, child.id);
  assert.equal(run.result.state, 'completed', JSON.stringify(run.result));
  assert.equal(run.requests.length, 1);
  const supplied = JSON.parse(run.requests[0].contents[0].parts![0].text!);
  const context = JSON.parse(run.requests[0].contents[0].parts![1].text!.split('\n').slice(1).join('\n'));
  assert.deepEqual(supplied.sourceMessages, pending.messages);
  assert.deepEqual(context.currentSources, pending.currentSources);
  assert.equal(context.coverage.repairOf, saved.id);
  assert.equal(await h.memory.prepareMaintenance(h.owner, child.id), null);
});

test('source correction during fitted provider request does not persist a stale summary or clear pending', async () => {
  const h = createHarness();
  const { child } = await h.bootstrapUserAndChild();
  const values = { key: 'Synthetic dependency', content: 'Old value', source: { kind: 'manual' as const, description: 'owner' }, validUntil: null };
  const candidate = await h.memory.createFact(h.owner, child.id, { values, intendedVisibility: 'private' });
  const fact = await h.memory.confirmFact(h.owner, child.id, candidate!.id, { expectedVersion: 1, confirm: true, confirmShared: false });
  const original = await h.chat.createUserMessageForUser(h.owner, child.id, '"'.repeat(5500));
  const run = await runMaintenance(h, child.id, async () => {
    await h.memory.reviseFact(h.owner, child.id, fact!.id, { expectedVersion: 2, confirm: true, confirmShared: false,
      values: { ...values, content: 'New value after generation started' }, reason: 'Synthetic late correction' });
  });
  assert.equal(run.requests.length, 1);
  assert.equal(run.result.state, 'stopped', JSON.stringify(run.result));
  assert.equal((await h.memory.summary(h.owner, child.id))!.summary, null);
  assert.equal((await h.memory.prepareMaintenance(h.owner, child.id))!.messages[0].id, original!.id);
  const current = await h.authority.runTransaction(h.owner, child.id, binding => readContextBasis(h.data, binding));
  assert.equal(current.value.summaryPending, true);
});
