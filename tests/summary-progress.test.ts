import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Firestore } from '@google-cloud/firestore';
import { FinishReason } from '@google/genai';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { createFirestoreChatStore, firestoreChatMessageSchema } from '../server/firestore-chat.ts';
import { createFirestoreCareStore } from '../server/firestore-care.ts';
import { createFirestoreMemoryStore, firestoreMemoryRecoverySchemas, summaryProgressSchema } from '../server/firestore-memory.ts';
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
  splitMessageIntoSafeChunks,
  surrogateSafeIndex,
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

test('REQ-005 §4.1: oversized 10k quotes progresses via multi-part segmentation across rounds without stalling', async () => {
  const h = createHarness();
  const { child } = await h.bootstrapUserAndChild();
  const quotes10000 = '"'.repeat(10000);
  const message = await h.chat.createUserMessageForUser(h.owner, child.id, quotes10000);
  await h.chat.createUserMessageForUser(h.owner, child.id, 'Later fresh message');

  // Progress rounds until all parts complete
  let roundIndex = 0;
  while (true) {
    const round = await runMaintenance(h, child.id);
    assert.equal(round.result.state, 'completed');
    assert.equal(round.requests.length, 1);
    assert.ok(agentRequestCharacters(round.requests[0]) <= 32000, `Request size ${agentRequestCharacters(round.requests[0])} must be <= 32000`);

    const payload = JSON.parse(round.requests[0].contents[0].parts![0].text!);
    assert.equal(payload.sourceMessages[0].id, message!.id);
    assert.ok(payload.sourceMessages[0].text.length <= 5000, 'Chunk must not exceed raw ceiling');
    assert.ok(payload.sourceMessages[0].text.length >= 1, 'Chunk must make progress');

    const progress = await h.authority.runTransaction(h.owner, child.id, async b => {
      const row = await b.transaction.get(h.data.ref('conversation_summary_heads', 'conversation-summary-progress', JSON.stringify([h.owner, child.id])));
      return row.exists ? h.data.open('conversation-summary-progress', JSON.stringify([h.owner, child.id]), b.scope, summaryProgressSchema, row) : null;
    });

    if (!progress) {
      const head = await h.authority.runTransaction(h.owner, child.id, async b => {
        const row = await b.transaction.get(h.data.ref('conversation_summary_heads', 'conversation-summary-head', JSON.stringify([h.owner, child.id])));
        return h.data.open('conversation-summary-head', JSON.stringify([h.owner, child.id]), b.scope, firestoreMemoryRecoverySchemas.summary, row);
      });
      assert.notEqual(head?.lastSortKey, '0'.repeat(19), 'Watermark must advance past completed message');
      assert.equal((head?.batch as any)?.part, undefined, 'Head batch must NEVER contain part (master strict schema compatible)');
      break;
    }

    assert.equal(progress.messageId, message!.id);
    assert.equal(progress.index, roundIndex);
    roundIndex++;
    assert.ok(roundIndex <= 5, 'Multi-part quotes progression must complete within 5 rounds');
  }

  // Next batch should now move on to the later message!
  const nextPrep = await h.memory.prepareMaintenance(h.owner, child.id);
  assert.ok(nextPrep);
  assert.equal(nextPrep.messages[0].text, 'Later fresh message');
});

test('REQ-005 §4.1: surrogate-safe splitting preserves surrogate pairs and prevents mid-pair cut mutation', () => {
  // 1. General multi-emoji integrity
  const emoji = '😀';
  const emojiText = emoji.repeat(3000);
  const msg = { id: 'emoji-msg', text: emojiText };
  const chunks = splitMessageIntoSafeChunks(msg, 5000);
  assert.equal(chunks.length, 2);
  for (const chunk of chunks) {
    assert.doesNotMatch(chunk.text!, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u);
  }
  const reconstructed = chunks.map(c => c.text).join('');
  assert.equal(reconstructed, emojiText);

  // 2. Mutation guard: emoji placed precisely across the 5000-character boundary
  // 4999 'a's followed by 😀 (\uD83D\uDE00, 2 code units: \uD83D at 4999, \uDE00 at 5000)
  const boundaryText = 'a'.repeat(4999) + '😀' + 'b'.repeat(200);
  assert.equal(surrogateSafeIndex(boundaryText, 5000), 4999, 'surrogateSafeIndex must back up when index falls inside pair');
  const boundaryMsg = { id: 'boundary-msg', text: boundaryText };
  const boundaryChunks = splitMessageIntoSafeChunks(boundaryMsg, 5000);
  assert.equal(boundaryChunks[0].text!.length, 4999, 'Chunk 0 must end before the surrogate pair at 4999');
  assert.equal(boundaryChunks[0].text!.endsWith('a'), true);
  assert.equal(boundaryChunks[1].text!.startsWith('😀'), true, 'Chunk 1 must start with intact emoji');
  assert.doesNotMatch(boundaryChunks[0].text!, /[\uD800-\uDBFF]$/, 'Chunk 0 must not end with orphaned high surrogate');
  assert.doesNotMatch(boundaryChunks[1].text!, /^[\uDC00-\uDFFF]/, 'Chunk 1 must not start with orphaned low surrogate');
});

test('REQ-005 §4.1: repairing an earlier batch does not inherit part progress from head into repair revision', async () => {
  const h = createHarness();
  const { child } = await h.bootstrapUserAndChild();

  // 1. Create a fact dependency and an early message (Batch 1)
  const values = { key: 'Synthetic dependency', content: 'Initial value', source: { kind: 'manual' as const, description: 'owner' }, validUntil: null };
  const candidate = await h.memory.createFact(h.owner, child.id, { values, intendedVisibility: 'private' });
  const fact = await h.memory.confirmFact(h.owner, child.id, candidate!.id, { expectedVersion: 1, confirm: true, confirmShared: false });
  const earlyMsg = await h.chat.createUserMessageForUser(h.owner, child.id, 'Early message to be summarized first');

  // Summarize Batch 1
  const prep1 = (await h.memory.prepareSummary(h.owner, child.id))!;
  const saved1 = await h.memory.saveSummary(h.owner, child.id, {
    previousVersion: prep1.previousVersion,
    basis: prep1.basis,
    text: 'Batch 1 summary',
    coveredMessageIds: [earlyMsg!.id],
  });
  assert.ok(saved1);

  // 2. Add an oversized message (Batch 2) and save Part 0 to head
  const quotes10000 = '"'.repeat(10000);
  const bigMsg = await h.chat.createUserMessageForUser(h.owner, child.id, quotes10000);
  const prep2 = (await h.memory.prepareSummary(h.owner, child.id))!;
  const chunks = splitMessageIntoSafeChunks(bigMsg!);
  await h.memory.saveSummary(h.owner, child.id, {
    previousVersion: prep2.previousVersion,
    basis: prep2.basis,
    text: 'Part 0 summary for Batch 2',
    coveredMessageIds: [bigMsg!.id],
    part: {
      messageId: bigMsg!.id,
      index: 0,
      total: chunks.length,
      isLast: false,
      sourceHash: chunks[0].sourceHash,
      startOffset: chunks[0].startOffset,
      endOffset: chunks[0].endOffset,
    },
  });

  // Verify progress doc has active part for Batch 2 (head remains untouched)
  await h.authority.runTransaction(h.owner, child.id, async b => {
    const row = await b.transaction.get(h.data.ref('conversation_summary_heads', 'conversation-summary-progress', JSON.stringify([h.owner, child.id])));
    const progress = h.data.open('conversation-summary-progress', JSON.stringify([h.owner, child.id]), b.scope, summaryProgressSchema, row);
    assert.equal(progress?.messageId, bigMsg!.id);
    assert.equal(progress?.index, 0);
  });

  // 3. Invalidate Batch 1 by revising the fact
  await h.memory.reviseFact(h.owner, child.id, fact!.id, {
    expectedVersion: 2,
    confirm: true,
    confirmShared: false,
    values: { ...values, content: 'Revised value triggering repair' },
    reason: 'Correction',
  });

  // 4. Perform repair of Batch 1
  const prepRepair = (await h.memory.prepareMaintenance(h.owner, child.id))!;
  assert.equal(prepRepair.repairOf, saved1.id);

  const repairSaved = await h.memory.saveSummary(h.owner, child.id, {
    previousVersion: prepRepair.previousVersion,
    basis: prepRepair.basis,
    text: 'Repaired Batch 1 summary',
    coveredMessageIds: [earlyMsg!.id],
    repairOf: saved1.id,
  });
  assert.ok(repairSaved);

  // 5. CRITICAL MUTATION GUARD: The repair revision in conversation_summaries must NEVER inherit part!
  await h.authority.runTransaction(h.owner, child.id, async b => {
    const row = await b.transaction.get(h.data.ref('conversation_summaries', 'conversation-summary', repairSaved.id));
    const revision = h.data.open('conversation-summary', repairSaved.id, b.scope, firestoreMemoryRecoverySchemas.summary, row);
    assert.equal((revision?.batch as any)?.part, undefined, 'Repair revision in conversation_summaries must NEVER inherit part!');
  });

  // 6. The progress doc MUST STILL preserve its active part for Batch 2 so work on Batch 2 resumes seamlessly
  const nextBatch = await h.memory.prepareMaintenance(h.owner, child.id);
  assert.ok(nextBatch);
  assert.equal(nextBatch.part?.messageId, bigMsg!.id);
  assert.equal(nextBatch.part?.index, 1, 'prepareMaintenance must still resume Batch 2 Part 1 after repair');
});

test('REQ-005 §4.1 (probe test): 6,000 \\u0001 escape-heavy message progresses via multi-part without permanent input_limit', async () => {
  const h = createHarness();
  const { child } = await h.bootstrapUserAndChild();
  const u0001Text = '\u0001'.repeat(6000);
  const msg = await h.chat.createUserMessageForUser(h.owner, child.id, u0001Text);
  await h.chat.createUserMessageForUser(h.owner, child.id, 'Subsequent normal message');

  // Round 1: Must NOT stall with input_limit; must complete part 0 within 32k request ceiling
  const round1 = await runMaintenance(h, child.id);
  assert.equal(round1.result.state, 'completed', `Round 1 state: ${JSON.stringify(round1.result)}`);
  assert.equal(round1.requests.length, 1);
  assert.ok(agentRequestCharacters(round1.requests[0]) <= 32000, `Request size ${agentRequestCharacters(round1.requests[0])} must be <= 32000`);

  // Progress until all parts finish
  let roundCount = 2;
  while (true) {
    const next = await runMaintenance(h, child.id);
    assert.equal(next.result.state, 'completed');
    assert.ok(agentRequestCharacters(next.requests[0]) <= 32000);
    const prep = await h.memory.prepareMaintenance(h.owner, child.id);
    if (!prep?.part) {
      assert.equal(prep?.messages[0].text, 'Subsequent normal message', 'Watermark must advance to subsequent message after all parts finish');
      break;
    }
    roundCount++;
    assert.ok(roundCount <= 10, 'Multi-part progression must complete within 10 rounds');
  }
});

test('REQ-005 §4.1: server rejects inconsistent isLast or index beyond total in summary parts', async () => {
  const h = createHarness();
  const { child } = await h.bootstrapUserAndChild();
  const quotes10000 = '"'.repeat(10000);
  const bigMsg = await h.chat.createUserMessageForUser(h.owner, child.id, quotes10000);
  const prep = (await h.memory.prepareSummary(h.owner, child.id))!;
  const chunks = splitMessageIntoSafeChunks(bigMsg!);

  // 1. isLast: true when index is 0 and total is > 1
  await assert.rejects(
    () => h.memory.saveSummary(h.owner, child.id, {
      previousVersion: prep.previousVersion,
      basis: prep.basis,
      text: 'Part 0 summary',
      coveredMessageIds: [bigMsg!.id],
      part: {
        messageId: bigMsg!.id,
        index: 0,
        total: chunks.length,
        isLast: true, // Invalid!
        sourceHash: chunks[0].sourceHash,
        startOffset: chunks[0].startOffset,
        endOffset: chunks[0].endOffset,
      },
    }),
    { code: 'summary_coverage_changed' },
  );

  // 2. index >= total
  await assert.rejects(
    () => h.memory.saveSummary(h.owner, child.id, {
      previousVersion: prep.previousVersion,
      basis: prep.basis,
      text: 'Part overflow summary',
      coveredMessageIds: [bigMsg!.id],
      part: {
        messageId: bigMsg!.id,
        index: chunks.length, // Invalid!
        total: chunks.length,
        isLast: true,
      },
    }),
    { code: 'summary_coverage_changed' },
  );
});

test('REQ-005 §4.1: server enforces contiguous offsets and message bounds across parts', async () => {
  const h = createHarness();
  const { child } = await h.bootstrapUserAndChild();
  const quotes10000 = '"'.repeat(10000);
  const bigMsg = await h.chat.createUserMessageForUser(h.owner, child.id, quotes10000);
  const prep = (await h.memory.prepareSummary(h.owner, child.id))!;
  const chunks = splitMessageIntoSafeChunks(bigMsg!);

  // 1. Non-zero start offset on part 0
  await assert.rejects(
    () => h.memory.saveSummary(h.owner, child.id, {
      previousVersion: prep.previousVersion,
      basis: prep.basis,
      text: 'Part 0 invalid start',
      coveredMessageIds: [bigMsg!.id],
      part: {
        messageId: bigMsg!.id,
        index: 0,
        total: chunks.length,
        isLast: false,
        sourceHash: chunks[0].sourceHash,
        startOffset: 10, // Invalid! Must start at 0
        endOffset: chunks[0].endOffset,
      },
    }),
    { code: 'summary_coverage_changed' },
  );

  // 2. endOffset beyond message length
  await assert.rejects(
    () => h.memory.saveSummary(h.owner, child.id, {
      previousVersion: prep.previousVersion,
      basis: prep.basis,
      text: 'Part 0 overflow',
      coveredMessageIds: [bigMsg!.id],
      part: {
        messageId: bigMsg!.id,
        index: 0,
        total: chunks.length,
        isLast: false,
        sourceHash: chunks[0].sourceHash,
        startOffset: 0,
        endOffset: quotes10000.length + 500, // Invalid!
      },
    }),
    { code: 'summary_coverage_changed' },
  );

  // 3. Save legitimate Part 0
  await h.memory.saveSummary(h.owner, child.id, {
    previousVersion: prep.previousVersion,
    basis: prep.basis,
    text: 'Legit Part 0',
    coveredMessageIds: [bigMsg!.id],
    part: {
      messageId: bigMsg!.id,
      index: 0,
      total: chunks.length,
      isLast: false,
      sourceHash: chunks[0].sourceHash,
      startOffset: chunks[0].startOffset,
      endOffset: chunks[0].endOffset,
    },
  });

  // 4. Save Part 1 with a gap (startOffset > prev endOffset)
  const prepPart1 = (await h.memory.prepareSummary(h.owner, child.id))!;
  await assert.rejects(
    () => h.memory.saveSummary(h.owner, child.id, {
      previousVersion: prepPart1.previousVersion,
      basis: prepPart1.basis,
      text: 'Part 1 with gap',
      coveredMessageIds: [bigMsg!.id],
      part: {
        messageId: bigMsg!.id,
        index: 1,
        total: chunks.length,
        isLast: chunks.length === 2,
        sourceHash: chunks[0].sourceHash,
        startOffset: (chunks[0].endOffset ?? 0) + 10, // Gap!
        endOffset: chunks[1].endOffset,
      },
    }),
    { code: 'summary_coverage_changed' },
  );
});

// ----------------------------------------------------------------------------
// Test 24: Schema Rollback Compatibility (Master Strict Schema Verification)
// ----------------------------------------------------------------------------
test('REQ-005 §4.1: schema rollback compatibility - master strict schema parses conversation-summary-head cleanly mid-progress and upon completion', async () => {
  const h = createHarness();
  const { child } = await h.bootstrapUserAndChild();
  const quotes10000 = '"'.repeat(10000);
  const bigMsg = await h.chat.createUserMessageForUser(h.owner, child.id, quotes10000);
  const prep = (await h.memory.prepareSummary(h.owner, child.id))!;
  const chunks = splitMessageIntoSafeChunks(bigMsg!);

  // Step 1: Save mid-progress slice (Part 0 of N)
  await h.memory.saveSummary(h.owner, child.id, {
    previousVersion: prep.previousVersion,
    basis: prep.basis,
    text: 'Intermediate Part 0 Summary',
    coveredMessageIds: [bigMsg!.id],
    part: {
      messageId: bigMsg!.id,
      index: 0,
      total: chunks.length,
      isLast: false,
      sourceHash: chunks[0].sourceHash,
      startOffset: chunks[0].startOffset,
      endOffset: chunks[0].endOffset,
    },
  });

  // Step 2: Simulate Master reading conversation-summary-head
  // Master's savedSummarySchema has NO 'part' field and is strictly .strict().
  // Because in-flight progress is isolated to conversation-summary-progress, head is untouched (null or previous).
  await h.authority.runTransaction(h.owner, child.id, async b => {
    const headRow = await b.transaction.get(h.data.ref('conversation_summary_heads', 'conversation-summary-head', JSON.stringify([h.owner, child.id])));
    if (headRow.exists) {
      const parsed = firestoreMemoryRecoverySchemas.summary.parse(h.data.open('conversation-summary-head', JSON.stringify([h.owner, child.id]), b.scope, firestoreMemoryRecoverySchemas.summary, headRow));
      assert.equal((parsed.batch as any)?.part, undefined, 'Head must never contain unknown part field for master');
    }
    // Master never reads conversation-summary-progress
    const progressRow = await b.transaction.get(h.data.ref('conversation_summary_heads', 'conversation-summary-progress', JSON.stringify([h.owner, child.id])));
    assert.ok(progressRow.exists, 'Progress doc must exist during mid-flight');
  });

  // Step 3: Complete progression through remaining parts
  for (let i = 1; i < chunks.length; i++) {
    const nextPrep = (await h.memory.prepareSummary(h.owner, child.id))!;
    const isLast = i === chunks.length - 1;
    await h.memory.saveSummary(h.owner, child.id, {
      previousVersion: nextPrep.previousVersion,
      basis: nextPrep.basis,
      text: `Part ${i} cumulative summary`,
      coveredMessageIds: [bigMsg!.id],
      part: {
        messageId: bigMsg!.id,
        index: i,
        total: chunks.length,
        isLast,
        sourceHash: chunks[i].sourceHash,
        startOffset: chunks[i].startOffset,
        endOffset: chunks[i].endOffset,
      },
    });
  }

  // Step 4: After completion, verify head is parseable by master's strict schema with ZERO error
  await h.authority.runTransaction(h.owner, child.id, async b => {
    const headRow = await b.transaction.get(h.data.ref('conversation_summary_heads', 'conversation-summary-head', JSON.stringify([h.owner, child.id])));
    assert.ok(headRow.exists);
    const parsedHead = firestoreMemoryRecoverySchemas.summary.parse(h.data.open('conversation-summary-head', JSON.stringify([h.owner, child.id]), b.scope, firestoreMemoryRecoverySchemas.summary, headRow));
    assert.ok(parsedHead);
    assert.equal((parsedHead.batch as any)?.part, undefined, 'Final committed head must have NO part field');
    assert.equal(parsedHead.summary.version, 1);

    // Progress doc must be atomically deleted
    const progressRow = await b.transaction.get(h.data.ref('conversation_summary_heads', 'conversation-summary-progress', JSON.stringify([h.owner, child.id])));
    assert.equal(progressRow.exists, false, 'Progress doc must be deleted on completion');
  });
});

// ----------------------------------------------------------------------------
// Test 25: Semantic Retention via Incremental Cumulative Rollup
// ----------------------------------------------------------------------------
test('REQ-005 §4.1: cumulative rollup retains earlier slice summaries into final projected summary without semantic amnesia', async () => {
  const h = createHarness();
  const { child } = await h.bootstrapUserAndChild();

  // Create two distinct topics within one oversized message (~10k chars)
  const topic1 = 'Topic1: 今日小明整跌咗水樽，喊咗好耐。';
  const topic2 = 'Topic2: 晏晝同小美一齊玩積木好開心，食晒成碗飯。';
  const filler1 = '"'.repeat(4500);
  const filler2 = '"'.repeat(4500);
  const oversizedText = `${topic1} ${filler1}\n\n${topic2} ${filler2}`;

  const msg = await h.chat.createUserMessageForUser(h.owner, child.id, oversizedText);
  assert.ok(msg);

  // Platform provider records prompt payloads across rounds and simulates LLM accumulating synthesis
  const seenPayloads: any[] = [];
  let roundNum = 0;
  const product = await createFirestoreProductAgent({
    ...h.options,
    chat: h.chat,
    care: h.care,
    memory: h.memory,
    online: h.online,
    authorizeWorker: async () => true,
    config: readAiConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: h.options.projectId }),
    platformProvider: {
      async generate(request) {
        const textPayload = JSON.parse(request.contents[0].parts![0].text!);
        seenPayloads.push(textPayload);
        roundNum++;
        const prevText = textPayload.previousAccumulatedSummary || textPayload.instruction || '';
        const summaryText = roundNum === 1
          ? '第一段摘要：記錄咗小明跌水樽喊嘅事。'
          : `累積完整摘要：先前摘要（${prevText.includes('跌水樽') ? '包含跌水樽' : '缺'}）+ 晏晝同小美玩積木開心食晒飯。`;
        return {
          content: { role: 'model', parts: [{ functionCall: { id: 'summary', name: 'stage_private_summary', args: { text: summaryText } } }] },
          finishReason: FinishReason.STOP,
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
        };
      },
    },
  });

  // Run maintainSummary rounds until all slices finish
  let maintainResult = await product.maintainSummary({ userId: h.owner, childId: child.id, reference: randomUUID(), authorize: async () => true });
  assert.equal(maintainResult.state, 'completed');
  assert.equal(maintainResult.more, true, 'Round 1 must indicate more work pending');

  let maintainResult2 = await product.maintainSummary({ userId: h.owner, childId: child.id, reference: randomUUID(), authorize: async () => true });
  assert.equal(maintainResult2.state, 'completed');

  // Verify that the second round payload explicitly contained the previous accumulated summary
  assert.ok(seenPayloads.length >= 2, 'Must have at least 2 model rounds');
  assert.ok(
    seenPayloads[1].instruction.includes('previousAccumulatedSummary') ||
    seenPayloads[1].instruction.includes('previous accumulated summary'),
    'Round 2 instruction must refer to previousAccumulatedSummary'
  );
  assert.ok(
    seenPayloads[1].previousAccumulatedSummary?.includes('跌水樽'),
    'Round 2 previousAccumulatedSummary must contain earlier slice summary text'
  );

  // Verify initialConversationSummary projects the complete accumulated summary
  const projected = await h.memory.initialConversationSummary(h.owner, child.id);
  assert.ok(projected, 'Must have projected summary');
  assert.ok(projected.summary.text.includes('包含跌水樽'), 'Projected summary must retain earlier slice content (Zero Amnesia)');
  assert.ok(projected.summary.text.includes('玩積木'), 'Projected summary must include final slice content');
  assert.equal(projected.summary.lastCoveredMessageId, msg!.id);
});

// ----------------------------------------------------------------------------
// Test 26: Anti-Bypass Validation - Offsets and Source Hash Mandatory for total > 1
// ----------------------------------------------------------------------------
test('REQ-005 §4.1: server strictly requires startOffset, endOffset, and sourceHash when total > 1', async () => {
  const h = createHarness();
  const { child } = await h.bootstrapUserAndChild();
  const quotes10000 = '"'.repeat(10000);
  const bigMsg = await h.chat.createUserMessageForUser(h.owner, child.id, quotes10000);
  const prep = (await h.memory.prepareSummary(h.owner, child.id))!;
  const chunks = splitMessageIntoSafeChunks(bigMsg!);

  // 1. Missing startOffset when total > 1
  await assert.rejects(
    () => h.memory.saveSummary(h.owner, child.id, {
      previousVersion: prep.previousVersion,
      basis: prep.basis,
      text: 'Part 0 missing startOffset',
      coveredMessageIds: [bigMsg!.id],
      part: {
        messageId: bigMsg!.id,
        index: 0,
        total: chunks.length,
        isLast: false,
        sourceHash: chunks[0].sourceHash,
        endOffset: chunks[0].endOffset,
      },
    }),
    { code: 'summary_coverage_changed' },
  );

  // 2. Missing endOffset when total > 1
  await assert.rejects(
    () => h.memory.saveSummary(h.owner, child.id, {
      previousVersion: prep.previousVersion,
      basis: prep.basis,
      text: 'Part 0 missing endOffset',
      coveredMessageIds: [bigMsg!.id],
      part: {
        messageId: bigMsg!.id,
        index: 0,
        total: chunks.length,
        isLast: false,
        sourceHash: chunks[0].sourceHash,
        startOffset: 0,
      },
    }),
    { code: 'summary_coverage_changed' },
  );

  // 3. Missing sourceHash when total > 1
  await assert.rejects(
    () => h.memory.saveSummary(h.owner, child.id, {
      previousVersion: prep.previousVersion,
      basis: prep.basis,
      text: 'Part 0 missing sourceHash',
      coveredMessageIds: [bigMsg!.id],
      part: {
        messageId: bigMsg!.id,
        index: 0,
        total: chunks.length,
        isLast: false,
        startOffset: 0,
        endOffset: chunks[0].endOffset,
      },
    }),
    { code: 'summary_coverage_changed' },
  );

  // 4. startOffset >= endOffset
  await assert.rejects(
    () => h.memory.saveSummary(h.owner, child.id, {
      previousVersion: prep.previousVersion,
      basis: prep.basis,
      text: 'Part 0 start >= end',
      coveredMessageIds: [bigMsg!.id],
      part: {
        messageId: bigMsg!.id,
        index: 0,
        total: chunks.length,
        isLast: false,
        sourceHash: chunks[0].sourceHash,
        startOffset: 100,
        endOffset: 100,
      },
    }),
    { code: 'summary_coverage_changed' },
  );

  // 5. Client offsets diverge from server splitMessageIntoSafeChunks boundaries
  await assert.rejects(
    () => h.memory.saveSummary(h.owner, child.id, {
      previousVersion: prep.previousVersion,
      basis: prep.basis,
      text: 'Part 0 mismatched bounds',
      coveredMessageIds: [bigMsg!.id],
      part: {
        messageId: bigMsg!.id,
        index: 0,
        total: chunks.length,
        isLast: false,
        sourceHash: chunks[0].sourceHash,
        startOffset: 0,
        endOffset: 50, // Server expects chunks[0].endOffset (~5000)
      },
    }),
    { code: 'summary_coverage_changed' },
  );
});

// ----------------------------------------------------------------------------
// Test 27: Anti-Bypass Guard G1 - Forged sourceHash on server chunk
// ----------------------------------------------------------------------------
test('REQ-005 §4.1: server rejects forged sourceHash mismatching server chunk hash on initial part', async () => {
  const h = createHarness();
  const { child } = await h.bootstrapUserAndChild();
  const quotes10000 = '"'.repeat(10000);
  const bigMsg = await h.chat.createUserMessageForUser(h.owner, child.id, quotes10000);
  const prep = (await h.memory.prepareSummary(h.owner, child.id))!;
  const chunks = splitMessageIntoSafeChunks(bigMsg!);

  const forgedHash = 'e'.repeat(64);
  await assert.rejects(
    () => h.memory.saveSummary(h.owner, child.id, {
      previousVersion: prep.previousVersion,
      basis: prep.basis,
      text: 'Part 0 summary forged hash',
      coveredMessageIds: [bigMsg!.id],
      part: {
        messageId: bigMsg!.id,
        index: 0,
        total: chunks.length,
        isLast: false,
        sourceHash: forgedHash,
        startOffset: chunks[0].startOffset,
        endOffset: chunks[0].endOffset,
      },
    }),
    { code: 'summary_coverage_changed' },
  );
});

// ----------------------------------------------------------------------------
// Test 28: Anti-Bypass Guard G2 - Missing progress record when index > 0
// ----------------------------------------------------------------------------
test('REQ-005 §4.1: server rejects subsequent part index when no progress record exists in Firestore', async () => {
  const h = createHarness();
  const { child } = await h.bootstrapUserAndChild();
  const quotes10000 = '"'.repeat(10000);
  const bigMsg = await h.chat.createUserMessageForUser(h.owner, child.id, quotes10000);
  const prep = (await h.memory.prepareSummary(h.owner, child.id))!;
  const chunks = splitMessageIntoSafeChunks(bigMsg!);

  // Directly attempt to save index 1 without having saved index 0 in progress
  await assert.rejects(
    () => h.memory.saveSummary(h.owner, child.id, {
      previousVersion: prep.previousVersion,
      basis: prep.basis,
      text: 'Part 1 uninitiated progress summary',
      coveredMessageIds: [bigMsg!.id],
      part: {
        messageId: bigMsg!.id,
        index: 1,
        total: chunks.length,
        isLast: false,
        sourceHash: chunks[1].sourceHash,
        startOffset: chunks[1].startOffset,
        endOffset: chunks[1].endOffset,
      },
    }),
    { code: 'summary_coverage_changed' },
  );
});

// ----------------------------------------------------------------------------
// Test 29: Anti-Bypass Guard G3 - Non-consecutive part index skipping intermediate chunks
// ----------------------------------------------------------------------------
test('REQ-005 §4.1: server rejects non-consecutive part index skipping intermediate chunks', async () => {
  const h = createHarness();
  const { child } = await h.bootstrapUserAndChild();
  const quotes10000 = '"'.repeat(10000);
  const bigMsg = await h.chat.createUserMessageForUser(h.owner, child.id, quotes10000);
  const chunks = splitMessageIntoSafeChunks(bigMsg!);
  assert.equal(chunks.length, 3);

  const prep = (await h.memory.prepareSummary(h.owner, child.id))!;
  await h.memory.saveSummary(h.owner, child.id, {
    previousVersion: prep.previousVersion,
    basis: prep.basis,
    text: 'Part 0 summary',
    coveredMessageIds: [bigMsg!.id],
    part: {
      messageId: bigMsg!.id,
      index: 0,
      total: 3,
      isLast: false,
      sourceHash: chunks[0].sourceHash,
      startOffset: chunks[0].startOffset,
      endOffset: chunks[0].endOffset,
    },
  });

  // Align Firestore progress endOffset with chunk 2 startOffset so that offset continuity check is satisfied,
  // purely isolating the index continuity check (G3: prevPart.index + 1 !== input.part.index).
  const progressDocId = JSON.stringify([h.owner, child.id]);
  await h.authority.runTransaction('owner', child.id, async binding => {
    const docRef = h.data.ref('conversation_summary_heads', 'conversation-summary-progress', progressDocId);
    const sealed = {
      ...h.data.tags(binding.scope),
      ...h.data.seal('conversation-summary-progress', progressDocId, binding.scope, summaryProgressSchema, {
        messageId: bigMsg!.id,
        index: 0,
        total: 3,
        startOffset: chunks[0].startOffset,
        endOffset: chunks[2].startOffset,
        sourceHash: chunks[0].sourceHash,
        cumulativeSummary: 'Part 0 summary',
        updatedAt: new Date().toISOString(),
      }),
    };
    binding.transaction.set(docRef, sealed);
  });

  const prep2 = (await h.memory.prepareSummary(h.owner, child.id))!;
  // Attempt to skip part 1 and save part 2 directly (index: 2 when previous was 0)
  await assert.rejects(
    () => h.memory.saveSummary(h.owner, child.id, {
      previousVersion: prep2.previousVersion,
      basis: prep2.basis,
      text: 'Part 2 skip index summary',
      coveredMessageIds: [bigMsg!.id],
      part: {
        messageId: bigMsg!.id,
        index: 2,
        total: 3,
        isLast: true,
        sourceHash: chunks[2].sourceHash,
        startOffset: chunks[2].startOffset,
        endOffset: chunks[2].endOffset,
      },
    }),
    { code: 'summary_coverage_changed' },
  );
});

// ----------------------------------------------------------------------------
// Test 30: Anti-Bypass Guard G4 - Message edit mid-progress purges progress
// ----------------------------------------------------------------------------
test('REQ-005 §4.1: editing chat message text mid-progress purges stale progress document and restarts from index 0', async () => {
  const h = createHarness();
  const { child } = await h.bootstrapUserAndChild();
  const quotes10000 = '"'.repeat(10000);
  const bigMsg = await h.chat.createUserMessageForUser(h.owner, child.id, quotes10000);
  const prep = (await h.memory.prepareSummary(h.owner, child.id))!;
  const chunks = splitMessageIntoSafeChunks(bigMsg!);

  // Save part 0
  await h.memory.saveSummary(h.owner, child.id, {
    previousVersion: prep.previousVersion,
    basis: prep.basis,
    text: 'Part 0 summary',
    coveredMessageIds: [bigMsg!.id],
    part: {
      messageId: bigMsg!.id,
      index: 0,
      total: chunks.length,
      isLast: false,
      sourceHash: chunks[0].sourceHash,
      startOffset: chunks[0].startOffset,
      endOffset: chunks[0].endOffset,
    },
  });

  const prepBefore = (await h.memory.prepareSummary(h.owner, child.id))!;
  assert.equal(prepBefore.part?.index, 0);

  // Edit message in Firestore to have different text
  await h.authority.runTransaction(h.owner, child.id, async binding => {
    const docRef = h.data.ref('chat_messages', 'chat-message', bigMsg!.id);
    const existing = await binding.transaction.get(docRef);
    const sealed = {
      ...h.data.tags(binding.scope),
      messageId: bigMsg!.id,
      createdAt: bigMsg!.createdAt,
      sortKey: existing.get('sortKey'),
      ...h.data.seal('chat-message', bigMsg!.id, binding.scope, firestoreChatMessageSchema, {
        id: bigMsg!.id,
        childId: child.id,
        authorUserId: h.owner,
        role: 'user',
        text: '\\'.repeat(10000),
        createdAt: bigMsg!.createdAt,
        inReplyTo: null,
      }),
    };
    binding.transaction.set(docRef, sealed);
  });

  // Calling prepareSummary now detects hash mismatch, purges progress, and leaves part undefined
  const prepAfter = (await h.memory.prepareSummary(h.owner, child.id))!;
  assert.equal(prepAfter.part, undefined);
});

// ----------------------------------------------------------------------------
// Test 31: Anti-Bypass Guard G5 - endOffset mismatch against server safe chunk
// ----------------------------------------------------------------------------
test('REQ-005 §4.1: server strictly rejects part with endOffset diverging from server safe chunk boundary', async () => {
  const h = createHarness();
  const { child } = await h.bootstrapUserAndChild();
  const quotes10000 = '"'.repeat(10000);
  const bigMsg = await h.chat.createUserMessageForUser(h.owner, child.id, quotes10000);
  const prep = (await h.memory.prepareSummary(h.owner, child.id))!;
  const chunks = splitMessageIntoSafeChunks(bigMsg!);

  // Client provides divergent endOffset (e.g. 50 instead of chunks[0].endOffset ~5000)
  await assert.rejects(
    () => h.memory.saveSummary(h.owner, child.id, {
      previousVersion: prep.previousVersion,
      basis: prep.basis,
      text: 'Part 0 divergent endOffset',
      coveredMessageIds: [bigMsg!.id],
      part: {
        messageId: bigMsg!.id,
        index: 0,
        total: chunks.length,
        isLast: false,
        sourceHash: chunks[0].sourceHash,
        startOffset: chunks[0].startOffset,
        endOffset: 50,
      },
    }),
    { code: 'summary_coverage_changed' },
  );
});

// ----------------------------------------------------------------------------
// Test 32: Anti-Bypass Guard G6 - Reject forged total
// ----------------------------------------------------------------------------
test('REQ-005 §4.1: server rejects forged total mismatching server-computed chunk count', async () => {
  const h = createHarness();
  const { child } = await h.bootstrapUserAndChild();
  const quotes10000 = '"'.repeat(10000);
  const bigMsg = await h.chat.createUserMessageForUser(h.owner, child.id, quotes10000);
  const prep = (await h.memory.prepareSummary(h.owner, child.id))!;
  const chunks = splitMessageIntoSafeChunks(bigMsg!);

  await assert.rejects(
    () => h.memory.saveSummary(h.owner, child.id, {
      previousVersion: prep.previousVersion,
      basis: prep.basis,
      text: 'Part 0 forged total summary',
      coveredMessageIds: [bigMsg!.id],
      part: {
        messageId: bigMsg!.id,
        index: 0,
        total: chunks.length + 5,
        isLast: false,
        sourceHash: chunks[0].sourceHash,
        startOffset: chunks[0].startOffset,
        endOffset: chunks[0].endOffset,
      },
    }),
    { code: 'summary_coverage_changed' },
  );
});

// ----------------------------------------------------------------------------
// Test 33: Anti-Bypass Guard G7 - Reject startOffset mismatch
// ----------------------------------------------------------------------------
test('REQ-005 §4.1: server rejects startOffset mismatching server-computed chunk startOffset', async () => {
  const h = createHarness();
  const { child } = await h.bootstrapUserAndChild();
  const quotes10000 = '"'.repeat(10000);
  const bigMsg = await h.chat.createUserMessageForUser(h.owner, child.id, quotes10000);
  const prep = (await h.memory.prepareSummary(h.owner, child.id))!;
  const chunks = splitMessageIntoSafeChunks(bigMsg!);

  await assert.rejects(
    () => h.memory.saveSummary(h.owner, child.id, {
      previousVersion: prep.previousVersion,
      basis: prep.basis,
      text: 'Part 0 startOffset mismatch',
      coveredMessageIds: [bigMsg!.id],
      part: {
        messageId: bigMsg!.id,
        index: 0,
        total: chunks.length,
        isLast: false,
        sourceHash: chunks[0].sourceHash,
        startOffset: 123,
        endOffset: chunks[0].endOffset,
      },
    }),
    { code: 'summary_coverage_changed' },
  );
});

// ----------------------------------------------------------------------------
// Test 34: Anti-Bypass Guard G8 - Reject repair carrying part
// ----------------------------------------------------------------------------
test('REQ-005 §4.1: server strictly rejects repair summary write carrying illegal part payload', async () => {
  const h = createHarness();
  const { child } = await h.bootstrapUserAndChild();

  const values = { key: 'Synthetic dependency', content: 'Initial value', source: { kind: 'manual' as const, description: 'owner' }, validUntil: null };
  const candidate = await h.memory.createFact(h.owner, child.id, { values, intendedVisibility: 'private' });
  const fact = await h.memory.confirmFact(h.owner, child.id, candidate!.id, { expectedVersion: 1, confirm: true, confirmShared: false });

  const msg1 = await h.chat.createUserMessageForUser(h.owner, child.id, 'Original message to repair');
  const prep1 = (await h.memory.prepareSummary(h.owner, child.id))!;
  await h.memory.saveSummary(h.owner, child.id, {
    previousVersion: prep1.previousVersion,
    basis: prep1.basis,
    text: 'Initial summary',
    coveredMessageIds: [msg1!.id],
  });

  // Invalidate fact to trigger repair
  await h.memory.reviseFact(h.owner, child.id, fact!.id, {
    expectedVersion: 2,
    confirm: true,
    confirmShared: false,
    values: { ...values, content: 'Updated value that invalidates batch' },
    reason: 'Correction',
  });

  const prepRepair = await h.memory.prepareMaintenance(h.owner, child.id);
  assert.ok(prepRepair?.repairOf);

  // Split repair message into completely legitimate chunk
  const chunks = splitMessageIntoSafeChunks(prepRepair.messages[0]);
  const legitPart = {
    messageId: prepRepair.messages[0].id,
    index: 0,
    total: chunks.length,
    isLast: true,
    sourceHash: chunks[0].sourceHash,
    startOffset: chunks[0].startOffset,
    endOffset: chunks[0].endOffset,
  };

  await assert.rejects(
    () => h.memory.saveSummary(h.owner, child.id, {
      previousVersion: prepRepair.previousVersion,
      basis: prepRepair.basis,
      text: 'Repair illegally carrying part',
      coveredMessageIds: prepRepair.messages.map(m => m.id),
      repairOf: prepRepair.repairOf,
      part: legitPart,
    }),
    { code: 'summary_coverage_changed' },
  );
});

// ----------------------------------------------------------------------------
// Test 35: Continuity check - Mid-progress partitioning/constant change resets progress
// ----------------------------------------------------------------------------
test('REQ-005 §4.1: server purges progress and restarts from part 0 when partitioning total changes mid-progress', async () => {
  const h = createHarness();
  const { child } = await h.bootstrapUserAndChild();
  const quotes10000 = '"'.repeat(10000);
  const bigMsg = await h.chat.createUserMessageForUser(h.owner, child.id, quotes10000);
  const prep = (await h.memory.prepareSummary(h.owner, child.id))!;
  const chunks = splitMessageIntoSafeChunks(bigMsg!);

  // Save part 0 legitimately
  await h.memory.saveSummary(h.owner, child.id, {
    previousVersion: prep.previousVersion,
    basis: prep.basis,
    text: 'Part 0 summary',
    coveredMessageIds: [bigMsg!.id],
    part: {
      messageId: bigMsg!.id,
      index: 0,
      total: chunks.length,
      isLast: false,
      sourceHash: chunks[0].sourceHash,
      startOffset: chunks[0].startOffset,
      endOffset: chunks[0].endOffset,
    },
  });

  // Verify progress exists with total === chunks.length
  const prepProgress = (await h.memory.prepareSummary(h.owner, child.id))!;
  assert.equal(prepProgress.part?.index, 0);
  assert.equal(prepProgress.part?.total, chunks.length);

  // Simulate constant/partitioning change by mutating progress record total in Firestore
  const progressDocId = JSON.stringify([h.owner, child.id]);
  await h.authority.runTransaction('owner', child.id, async binding => {
    const docRef = h.data.ref('conversation_summary_heads', 'conversation-summary-progress', progressDocId);
    const sealed = {
      ...h.data.tags(binding.scope),
      ...h.data.seal('conversation-summary-progress', progressDocId, binding.scope, summaryProgressSchema, {
        messageId: bigMsg!.id,
        index: 0,
        total: chunks.length + 2,
        startOffset: chunks[0].startOffset,
        endOffset: chunks[0].endOffset,
        sourceHash: chunks[0].sourceHash,
        cumulativeSummary: 'Part 0 summary',
        updatedAt: new Date().toISOString(),
      }),
    };
    binding.transaction.set(docRef, sealed);
  });

  // Next prepareSummary detects progress.total !== chunks.length, purges progress doc, leaving part undefined
  const prepRestart = (await h.memory.prepareSummary(h.owner, child.id))!;
  assert.equal(prepRestart.part, undefined, 'Must purge stale progress and leave part undefined for clean restart');

  // Verify progress document in Firestore was deleted
  await h.authority.runTransaction('owner', child.id, async binding => {
    const docRef = h.data.ref('conversation_summary_heads', 'conversation-summary-progress', progressDocId);
    const row = await binding.transaction.get(docRef);
    assert.equal(row.exists, false, 'Progress doc must be purged when total changed');
  });

  // Re-save part 0 legitimately to test saveSummary continuity validation
  await h.memory.saveSummary(h.owner, child.id, {
    previousVersion: prepRestart.previousVersion,
    basis: prepRestart.basis,
    text: 'Part 0 renewed',
    coveredMessageIds: [bigMsg!.id],
    part: {
      messageId: bigMsg!.id,
      index: 0,
      total: chunks.length,
      isLast: false,
      sourceHash: chunks[0].sourceHash,
      startOffset: chunks[0].startOffset,
      endOffset: chunks[0].endOffset,
    },
  });

  // Verify saving index 1 with total mismatching prevPart rejects in saveSummary
  await assert.rejects(
    () => h.memory.saveSummary(h.owner, child.id, {
      previousVersion: prepRestart.previousVersion,
      basis: prepRestart.basis,
      text: 'Part 1 mismatched total',
      coveredMessageIds: [bigMsg!.id],
      part: {
        messageId: bigMsg!.id,
        index: 1,
        total: chunks.length + 1,
        isLast: false,
        sourceHash: chunks[1].sourceHash,
        startOffset: chunks[1].startOffset,
        endOffset: chunks[1].endOffset,
      },
    }),
    (err: any) => err.code === 'summary_coverage_changed',
  );

  // Verify saving index 1 with startOffset not matching prevPart.endOffset rejects in saveSummary
  await assert.rejects(
    () => h.memory.saveSummary(h.owner, child.id, {
      previousVersion: prepRestart.previousVersion,
      basis: prepRestart.basis,
      text: 'Part 1 offset gap',
      coveredMessageIds: [bigMsg!.id],
      part: {
        messageId: bigMsg!.id,
        index: 1,
        total: chunks.length,
        isLast: false,
        sourceHash: chunks[1].sourceHash,
        startOffset: chunks[1].startOffset + 50,
        endOffset: chunks[1].endOffset,
      },
    }),
    (err: any) => err.code === 'summary_coverage_changed',
  );
});

// ----------------------------------------------------------------------------
// Test 36: Guard check - Rejects when targetMsg not in unsummarized stream
// ----------------------------------------------------------------------------
test('REQ-005 §4.1: server strictly rejects part write when target message cannot be resolved in unsummarized stream', async () => {
  const h = createHarness();
  const { child } = await h.bootstrapUserAndChild();
  const prep = (await h.memory.prepareSummary(h.owner, child.id))!;
  const fakeMsgId = randomUUID();

  await assert.rejects(
    () => h.memory.saveSummary(h.owner, child.id, {
      previousVersion: prep.previousVersion,
      basis: prep.basis,
      text: 'Summary for non-existent unsummarized stream message',
      coveredMessageIds: [fakeMsgId],
      part: {
        messageId: fakeMsgId,
        index: 0,
        total: 2,
        isLast: false,
        sourceHash: '0000000000000000000000000000000000000000000000000000000000000000',
        startOffset: 0,
        endOffset: 50,
      },
    }),
    (err: any) => err.code === 'summary_coverage_changed',
  );
});

// ----------------------------------------------------------------------------
// Test 37: summaryInput messageId check - Purges progress when head message diverges
// ----------------------------------------------------------------------------
test('REQ-005 §4.1: server purges progress when head message ID does not match active progress messageId', async () => {
  const h = createHarness();
  const { child } = await h.bootstrapUserAndChild();
  const quotes10000 = '"'.repeat(10000);
  const bigMsg1 = await h.chat.createUserMessageForUser(h.owner, child.id, quotes10000);
  const prep = (await h.memory.prepareSummary(h.owner, child.id))!;
  const chunks = splitMessageIntoSafeChunks(bigMsg1!);

  // Save part 0 for message 1
  await h.memory.saveSummary(h.owner, child.id, {
    previousVersion: prep.previousVersion,
    basis: prep.basis,
    text: 'Part 0 of msg 1',
    coveredMessageIds: [bigMsg1!.id],
    part: {
      messageId: bigMsg1!.id,
      index: 0,
      total: chunks.length,
      isLast: false,
      sourceHash: chunks[0].sourceHash,
      startOffset: chunks[0].startOffset,
      endOffset: chunks[0].endOffset,
    },
  });

  // Mutate progress in Firestore to point to a different messageId
  const progressDocId = JSON.stringify([h.owner, child.id]);
  await h.authority.runTransaction('owner', child.id, async binding => {
    const docRef = h.data.ref('conversation_summary_heads', 'conversation-summary-progress', progressDocId);
    const sealed = {
      ...h.data.tags(binding.scope),
      ...h.data.seal('conversation-summary-progress', progressDocId, binding.scope, summaryProgressSchema, {
        messageId: randomUUID(),
        index: 0,
        total: chunks.length,
        startOffset: chunks[0].startOffset,
        endOffset: chunks[0].endOffset,
        sourceHash: chunks[0].sourceHash,
        cumulativeSummary: 'Part 0 of msg 1',
        updatedAt: new Date().toISOString(),
      }),
    };
    binding.transaction.set(docRef, sealed);
  });

  // Calling prepareSummary detects firstMsg.id !== progress.messageId, deletes progress, leaving part undefined
  const prepAfter = (await h.memory.prepareSummary(h.owner, child.id))!;
  assert.equal(prepAfter.part, undefined, 'Must purge stale progress and leave part undefined');

  // Verify progress doc was deleted in Firestore
  await h.authority.runTransaction('owner', child.id, async binding => {
    const docRef = h.data.ref('conversation_summary_heads', 'conversation-summary-progress', progressDocId);
    const row = await binding.transaction.get(docRef);
    assert.equal(row.exists, false, 'Stale progress doc must be purged from Firestore');
  });
});

// ----------------------------------------------------------------------------
// Test 38: sourcePeriod preservation upon final multipart head publication
// ----------------------------------------------------------------------------
test('REQ-005 §4.1: final multipart summary write preserves sourcePeriod on head record', async () => {
  const h = createHarness();
  const { child } = await h.bootstrapUserAndChild();
  const quotes10000 = '"'.repeat(10000);
  const bigMsg = await h.chat.createUserMessageForUser(h.owner, child.id, quotes10000);
  assert.ok(bigMsg);
  const chunks = splitMessageIntoSafeChunks(bigMsg);

  // Iterate through all chunks, saving parts sequentially
  let finalSaved: any = null;
  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1;
    const prepNext = (await h.memory.prepareSummary(h.owner, child.id))!;
    const res = await h.memory.saveSummary(h.owner, child.id, {
      previousVersion: prepNext.previousVersion,
      basis: prepNext.basis,
      text: `Part ${i} summary`,
      coveredMessageIds: [bigMsg.id],
      part: {
        messageId: bigMsg.id,
        index: i,
        total: chunks.length,
        isLast,
        sourceHash: chunks[i].sourceHash,
        startOffset: chunks[i].startOffset,
        endOffset: chunks[i].endOffset,
      },
    });

    if (!isLast) {
      // In-flight progress: head record must not be published yet
      const inFlightHead = await h.memory.initialConversationSummary(h.owner, child.id);
      assert.equal(inFlightHead, null, `Head must not exist during in-flight progress at part ${i}`);
    } else {
      finalSaved = res;
    }
  }

  // 1. Returned ConversationSummary from saveSummary must contain sourcePeriod
  assert.ok(finalSaved, 'Final save must return ConversationSummary');
  assert.ok(finalSaved.sourcePeriod, 'Returned value must contain sourcePeriod');
  assert.equal(finalSaved.sourcePeriod.from, bigMsg.createdAt);
  assert.equal(finalSaved.sourcePeriod.to, bigMsg.createdAt);

  // 2. Head summary via summary() API must contain sourcePeriod
  const summaryResult = await h.memory.summary(h.owner, child.id);
  assert.ok(summaryResult, 'Summary result must exist');
  const activeSummary = summaryResult.summary;
  assert.ok(activeSummary, 'Active summary must exist');
  assert.ok(activeSummary.sourcePeriod, 'Active summary must contain sourcePeriod');
  assert.equal(activeSummary.sourcePeriod.from, bigMsg.createdAt);
  assert.equal(activeSummary.sourcePeriod.to, bigMsg.createdAt);

  // 3. Stored conversation-summary-head document in Firestore must contain sourcePeriod
  const headDocId = JSON.stringify([h.owner, child.id]);
  await h.authority.runTransaction('owner', child.id, async b => {
    const headDoc = await b.transaction.get(h.data.ref('conversation_summary_heads', 'conversation-summary-head', headDocId));
    assert.equal(headDoc.exists, true, 'Head document must exist in Firestore');
    const headRecord = h.data.open('conversation-summary-head', headDocId, b.scope, firestoreMemoryRecoverySchemas.summary, headDoc);
    assert.deepEqual(headRecord.summary.sourcePeriod, { from: bigMsg.createdAt, to: bigMsg.createdAt });
  });

  // 4. Initial conversation summary projection resolves successfully
  const publishedHead = await h.memory.initialConversationSummary(h.owner, child.id);
  assert.ok(publishedHead, 'Published head must exist');
  assert.ok(publishedHead!.summary.text.includes(`Part ${chunks.length - 1} summary`), 'Published text must include final rollup');
});

// ----------------------------------------------------------------------------
// Test 39: Anti-Bypass Guard G2 extension - Purges progress upon divergent total and rejects subsequent part
// ----------------------------------------------------------------------------
test('REQ-005 §4.1: server purges progress upon divergent total in Firestore and rejects subsequent part via G2', async () => {
  const h = createHarness();
  const { child } = await h.bootstrapUserAndChild();
  const quotes10000 = '"'.repeat(10000);
  const bigMsg = await h.chat.createUserMessageForUser(h.owner, child.id, quotes10000);
  const chunks = splitMessageIntoSafeChunks(bigMsg!);
  assert.equal(chunks.length, 3);

  const prep = (await h.memory.prepareSummary(h.owner, child.id))!;
  await h.memory.saveSummary(h.owner, child.id, {
    previousVersion: prep.previousVersion,
    basis: prep.basis,
    text: 'Part 0 summary',
    coveredMessageIds: [bigMsg!.id],
    part: {
      messageId: bigMsg!.id,
      index: 0,
      total: 3,
      isLast: false,
      sourceHash: chunks[0].sourceHash,
      startOffset: chunks[0].startOffset,
      endOffset: chunks[0].endOffset,
    },
  });

  // Tamper Firestore progress to have a divergent total (e.g. 4 instead of 3),
  // keeping index (0) and endOffset (chunks[0].endOffset) valid.
  const progressDocId = JSON.stringify([h.owner, child.id]);
  await h.authority.runTransaction('owner', child.id, async binding => {
    const docRef = h.data.ref('conversation_summary_heads', 'conversation-summary-progress', progressDocId);
    const sealed = {
      ...h.data.tags(binding.scope),
      ...h.data.seal('conversation-summary-progress', progressDocId, binding.scope, summaryProgressSchema, {
        messageId: bigMsg!.id,
        index: 0,
        total: 4,
        startOffset: chunks[0].startOffset,
        endOffset: chunks[0].endOffset,
        sourceHash: chunks[0].sourceHash,
        cumulativeSummary: 'Part 0 summary',
        updatedAt: new Date().toISOString(),
      }),
    };
    binding.transaction.set(docRef, sealed);
  });

  const prep2 = (await h.memory.prepareSummary(h.owner, child.id))!;
  // Client attempts to submit valid part 1 (total: 3) matching server chunk count,
  // but previous progress has total: 4. prevPart.total !== input.part.total must reject.
  await assert.rejects(
    () => h.memory.saveSummary(h.owner, child.id, {
      previousVersion: prep2.previousVersion,
      basis: prep2.basis,
      text: 'Part 1 with mismatched progress total',
      coveredMessageIds: [bigMsg!.id],
      part: {
        messageId: bigMsg!.id,
        index: 1,
        total: 3,
        isLast: false,
        sourceHash: chunks[1].sourceHash,
        startOffset: chunks[1].startOffset,
        endOffset: chunks[1].endOffset,
      },
    }),
    { code: 'summary_coverage_changed' },
  );
});

// ----------------------------------------------------------------------------
// Test 40: Guard check - Server strictly rejects part write when startOffset does not match progress endOffset
// ----------------------------------------------------------------------------
test('REQ-005 §4.1: server strictly rejects part write when startOffset diverges from previous progress endOffset', async () => {
  const h = createHarness();
  const { child } = await h.bootstrapUserAndChild();
  const quotes10000 = '"'.repeat(10000);
  const bigMsg = await h.chat.createUserMessageForUser(h.owner, child.id, quotes10000);
  const chunks = splitMessageIntoSafeChunks(bigMsg!);
  assert.equal(chunks.length, 3);

  const prep = (await h.memory.prepareSummary(h.owner, child.id))!;
  await h.memory.saveSummary(h.owner, child.id, {
    previousVersion: prep.previousVersion,
    basis: prep.basis,
    text: 'Part 0 summary',
    coveredMessageIds: [bigMsg!.id],
    part: {
      messageId: bigMsg!.id,
      index: 0,
      total: 3,
      isLast: false,
      sourceHash: chunks[0].sourceHash,
      startOffset: chunks[0].startOffset,
      endOffset: chunks[0].endOffset,
    },
  });

  // Tamper Firestore progress to have a corrupted endOffset (e.g. 99999),
  // keeping index (0) and total (3) valid.
  const progressDocId = JSON.stringify([h.owner, child.id]);
  await h.authority.runTransaction('owner', child.id, async binding => {
    const docRef = h.data.ref('conversation_summary_heads', 'conversation-summary-progress', progressDocId);
    const sealed = {
      ...h.data.tags(binding.scope),
      ...h.data.seal('conversation-summary-progress', progressDocId, binding.scope, summaryProgressSchema, {
        messageId: bigMsg!.id,
        index: 0,
        total: 3,
        startOffset: chunks[0].startOffset,
        endOffset: 99999,
        sourceHash: chunks[0].sourceHash,
        cumulativeSummary: 'Part 0 summary',
        updatedAt: new Date().toISOString(),
      }),
    };
    binding.transaction.set(docRef, sealed);
  });

  const prep2 = (await h.memory.prepareSummary(h.owner, child.id))!;
  // Client submits valid part 1 (startOffset matches expectedChunk.startOffset),
  // but previous progress endOffset is 99999. input.part.startOffset !== prevPart.endOffset must reject.
  await assert.rejects(
    () => h.memory.saveSummary(h.owner, child.id, {
      previousVersion: prep2.previousVersion,
      basis: prep2.basis,
      text: 'Part 1 with mismatched startOffset vs prevPart.endOffset',
      coveredMessageIds: [bigMsg!.id],
      part: {
        messageId: bigMsg!.id,
        index: 1,
        total: 3,
        isLast: false,
        sourceHash: chunks[1].sourceHash,
        startOffset: chunks[1].startOffset,
        endOffset: chunks[1].endOffset,
      },
    }),
    { code: 'summary_coverage_changed' },
  );
});
