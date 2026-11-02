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
import { readContextBasis } from '../server/firestore-context-basis.ts';
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
  estimateSummaryPayloadCharacters,
  SUMMARY_BATCH_TARGET_CHARS,
  SUMMARY_GATEWAY_RESERVE_CHARS,
  SUMMARY_SAFE_REQUEST_CEILING,
} from '../server/summary-window-helper.ts';

function createHarness() {
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
    await authority.admitIdentity({ userId: 'owner', email: 'owner@example.test', emailVerified: true });
    await authority.acknowledge({ userId: 'owner', operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
    const { child } = await authority.createChild({ userId: 'owner', displayName: '測試孩子', operationId: randomUUID() });
    return { child };
  }

  return { authority, data, chat, care, memory, online, options, getGeneration: () => capturedGeneration, bootstrapUserAndChild };
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

// ----------------------------------------------------------------------------
// Test 3: Escape-heavy single messages (5,300 quotes admitted, 5,900 and 10,000 quotes continuation)
// ----------------------------------------------------------------------------
test('Test 3 (escape-heavy single messages): 5,300 quotes admitted within 21.5k ceiling, 5,900+ return continuation', async () => {
  const h = createHarness();
  const { child } = await h.bootstrapUserAndChild();

  // 1. 5,300 quotes: payload is ~21,306 <= 21,500 ceiling, admitted without regression
  const quotes5300 = '"'.repeat(5300);
  const estimated5300 = estimateSummaryPayloadCharacters([{ id: 'msg-5300', text: quotes5300 }]);
  assert.ok(estimated5300 <= SUMMARY_SAFE_REQUEST_CEILING, `5,300 quotes payload (${estimated5300}) must be within ceiling (${SUMMARY_SAFE_REQUEST_CEILING})`);

  const msg5300 = await h.chat.createUserMessageForUser('owner', child.id, quotes5300);
  assert.ok(msg5300);

  const batch5300 = await h.memory.prepareMaintenance('owner', child.id);
  assert.ok(batch5300);
  assert.equal(batch5300.messages.length, 1, '5,300 quotes must be admitted within safe ceiling');
  assert.equal(batch5300.unavailableReason, undefined);

  // 2. 5,900 quotes: raw JSON is ~11.8k <= 12,000, but double-escaped payload is ~23.9k > 21,500
  const quotes5900 = '"'.repeat(5900);
  const estimated5900 = estimateSummaryPayloadCharacters([{ id: 'msg-5900', text: quotes5900 }]);
  assert.ok(estimated5900 > SUMMARY_SAFE_REQUEST_CEILING, `5,900 quotes payload (${estimated5900}) must exceed safe ceiling (${SUMMARY_SAFE_REQUEST_CEILING})`);

  const selected5900 = selectSummaryBatchMessages([{ id: 'msg-5900', text: quotes5900 }]);
  assert.equal(selected5900.messages.length, 0);
  assert.equal(selected5900.requiresContinuation, true);

  // 3. 10,000 quotes: double-escaped payload is ~40k > 32k Gateway limit
  const quotes10000 = '"'.repeat(10000);
  const estimated10000 = estimateSummaryPayloadCharacters([{ id: 'msg-10000', text: quotes10000 }]);
  assert.ok(estimated10000 > AGENT_LIMITS.inputCharacters, `10,000 quotes payload (${estimated10000}) exceeds gateway limit`);

  const selected10000 = selectSummaryBatchMessages([{ id: 'mock-10000', text: quotes10000 }]);
  assert.equal(selected10000.messages.length, 0);
  assert.equal(selected10000.requiresContinuation, true);
});

// ----------------------------------------------------------------------------
// Test 4: Multi-message accumulation caps and escape prevention (3 x 1,900 quotes)
// ----------------------------------------------------------------------------
test('Test 4 (multi-message cap & escape safety): accumulation stops at ~12k raw JSON and protects against escape expansion', () => {
  // Case A: 30 messages of 1,000 characters each stops at 12k raw JSON
  const rawMessages = Array.from({ length: 30 }, (_, index) => ({
    id: `msg-${index}`,
    role: 'user',
    text: 'X'.repeat(1000),
  }));

  const selected = selectSummaryBatchMessages(rawMessages, SUMMARY_BATCH_TARGET_CHARS, SUMMARY_SAFE_REQUEST_CEILING);
  const totalJsonChars = JSON.stringify(selected.messages).length;
  assert.ok(totalJsonChars <= SUMMARY_BATCH_TARGET_CHARS + 1100, `Batch size (${totalJsonChars}) must not balloon beyond target (~12k)`);
  assert.ok(selected.messages.length >= 10 && selected.messages.length <= 12, `Expected ~10-12 messages of 1k text to fit in 12k target, got ${selected.messages.length}`);
  assert.equal(selected.moreUncovered, true);
  assert.equal(selected.requiresContinuation, false);

  // Case B: 3 messages of 1,900 double quotes each
  // Raw JSON would be ~11.4k <= 12,000, but double-escaped payload for 3 messages would be ~22.8k > 21.5k ceiling.
  // Must stop at 2 messages to prevent payload exceeding 21.5k ceiling.
  const raw3x1900 = Array.from({ length: 3 }, (_, index) => ({
    id: `quote-${index}`,
    text: '"'.repeat(1900),
  }));
  const selected3x1900 = selectSummaryBatchMessages(raw3x1900);
  assert.equal(selected3x1900.messages.length, 2, 'Batch must stop at 2 messages to prevent exceeding 21.5k ceiling');
  const payload2 = estimateSummaryPayloadCharacters(selected3x1900.messages);
  assert.ok(payload2 <= SUMMARY_SAFE_REQUEST_CEILING, `Payload for 2 messages (${payload2}) must be <= ${SUMMARY_SAFE_REQUEST_CEILING}`);
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
// Test 6: Repair path with 14k UTF-16 content & escape-heavy repair skipping
// ----------------------------------------------------------------------------
test('Test 6 (repairInput): 14k UTF-16 repair succeeds; escape-heavy invalidated batch is skipped by prepareMaintenance', async () => {
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

  // --- Part B: escape-heavy invalidated batch is skipped ---
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

  // prepareMaintenance should skip the oversized repair batch (returns null)
  // because repairInput returns null when estimateSummaryPayloadCharacters > ceiling
  const skipped = await h.memory.prepareMaintenance('owner', child.id);
  assert.equal(skipped, null, 'Escape-heavy invalidated batch must be skipped (repairInput returns null when payload exceeds ceiling)');
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
