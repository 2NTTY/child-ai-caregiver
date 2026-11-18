import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { FinishReason } from '@google/genai';
import {
  AGENT_PROGRESS_LABELS,
  AGENT_PROGRESS_MAX_SOURCES,
  AGENT_PROGRESS_SOURCE_DISCLAIMER,
  AGENT_PROGRESS_SOURCE_STAGE_LABELS,
  agentProgressSchema,
  agentProgressSourceSchema,
  formatProgressSourceDateText,
  mergeAgentProgressSources,
  toAgentProgressSource,
  type AgentProgress,
} from '../src/shared/agent-feedback.ts';
import { agentFeedbackStream } from '../server/agent-feedback-stream.ts';
import { readAgentFeedback } from '../src/client/agent-feedback-reader.ts';
import { createProductAgentTools } from '../server/product-agent-tools.ts';
import { AgentBudget } from '../server/agent-budget.ts';
import { ChatController } from '../src/client/chat-controller.ts';
import { createChatApi } from '../src/client/chat-api.ts';
import { handleChatRequest } from '../server/chat-api.ts';
import { handleProductAgentRequest } from '../server/product-agent-api.ts';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreChatStore } from '../server/firestore-chat.ts';
import { createFirestoreCareStore } from '../server/firestore-care.ts';
import { createFirestoreMemoryStore } from '../server/firestore-memory.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirestoreProductAgent } from '../server/firestore-product-agent.ts';
import { readAiConfig } from '../server/ai-config.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import type { Firestore } from '@google-cloud/firestore';
import type { KnowledgeEvidence } from '../src/shared/knowledge.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

const sampleChunk: KnowledgeEvidence = {
  chunkId: '11111111-2222-4333-8444-555555555555',
  sourceId: 'fhs-fever-2026',
  versionId: '22222222-3333-4444-8555-666666666666',
  versionHash: 'a'.repeat(64),
  contentHash: 'b'.repeat(64),
  key: 'fever-care',
  section: '發燒護理要點',
  title: '衛生署家庭健康服務：嬰幼兒發燒護理',
  publisher: '衛生署家庭健康服務',
  url: 'https://www.fhs.gov.hk/tc_chi/health_info/child/fever.html',
  classification: 'official_guidance',
  sourcePublishedAt: '2026-05-01T00:00:00.000Z',
  sourceUpdatedAt: '2026-09-15T00:00:00.000Z',
  sourceDateText: '2026年9月修訂',
  fetchedAt: '2026-10-15T00:00:00.000Z',
  checkedAt: '2026-10-15T00:00:00.000Z',
  reviewState: 'reviewed',
  sourceExcerpt: '量度體溫並觀察精神反應，保持室內空氣流通。',
  text: '量度體溫並觀察精神反應，保持室內空氣流通。',
  keywords: ['發燒', '體溫'],
  applicability: {
    region: 'HK',
    ageBasis: 'actual',
    minAgeMonths: 3,
    maxAgeMonths: 36,
    topics: ['fever'],
    conditions: [],
  },
  applicabilityStatus: 'applicable',
};

test('agentProgressSchema strictly validates progressive source cards and rejects draft text or invented weight fields', () => {
  const runId = randomUUID();
  const messageId = randomUUID();
  const foundSource = toAgentProgressSource(sampleChunk, 'found');
  assert.ok(foundSource);
  assert.equal(foundSource.stage, 'found');
  assert.equal(foundSource.publisher, '衛生署家庭健康服務');
  assert.equal(foundSource.sourceDateText, '2026年9月修訂');
  assert.equal(foundSource.applicabilityStatus, undefined, 'pre-review progress source must not emit applicable status before delivery review');
  assert.equal(
    agentProgressSourceSchema.safeParse({ ...foundSource, applicabilityStatus: 'applicable' }).success,
    false,
    'unreviewed applicable status must be rejected by strict progress source schema',
  );
  assert.equal(AGENT_PROGRESS_SOURCE_STAGE_LABELS.found, '已找到官方來源');
  assert.equal(AGENT_PROGRESS_SOURCE_STAGE_LABELS.read, '已讀取官方來源上下文');
  assert.match(AGENT_PROGRESS_SOURCE_DISCLAIMER, /尚未完成適用性與獨立安全核對/);

  const validEvent = agentProgressSchema.parse({
    runId,
    messageId,
    phase: 'searching',
    sources: [foundSource],
  });
  assert.equal(validEvent.sources?.length, 1);

  assert.equal(
    agentProgressSourceSchema.safeParse({ ...foundSource, weight: 0.95 }).success,
    false,
    'invented source weight must be rejected by strict schema',
  );
  assert.equal(
    agentProgressSchema.safeParse({
      runId,
      messageId,
      phase: 'searching',
      sources: [foundSource],
      draftText: '未審核草稿',
    }).success,
    false,
    'unreviewed draft text must be rejected by strict schema',
  );
  assert.equal(
    agentProgressSchema.safeParse({
      runId,
      messageId,
      phase: 'reviewing',
      sources: [foundSource],
    }).success,
    false,
    'sources are only attached to searching/reading/tool_finished frames',
  );
  assert.equal(
    agentProgressSchema.safeParse({
      runId,
      messageId,
      phase: 'searching',
      sources: [],
    }).success,
    false,
    'empty sources array is rejected',
  );

  const internalSource = toAgentProgressSource({ ...sampleChunk, usageScope: 'internal_noncommercial' }, 'found');
  assert.ok(internalSource);
  assert.equal(internalSource.url, null, 'internal_noncommercial sources must not expose external URLs');

  const httpSource = toAgentProgressSource({ ...sampleChunk, url: 'http://www.fhs.gov.hk/insecure.html' }, 'found');
  assert.ok(httpSource);
  assert.equal(httpSource.url, null, 'non-HTTPS http:// URLs must be normalized to null');
  assert.equal(
    agentProgressSourceSchema.safeParse({ ...foundSource, url: 'http://www.fhs.gov.hk/insecure.html' }).success,
    false,
    'non-HTTPS URLs must be rejected by strict schema',
  );

  const undatedSource = toAgentProgressSource({
    ...sampleChunk,
    fetchedAt: undefined,
    sourceUpdatedAt: undefined,
    sourcePublishedAt: undefined,
    sourceDateText: undefined,
  }, 'found');
  assert.ok(undatedSource);
  assert.equal(undatedSource.fetchedAt, null, 'missing dates must not fabricate a 1970-01-01 fetchedAt timestamp');
  assert.equal(undatedSource.sourceUpdatedAt, null);
  assert.equal(formatProgressSourceDateText(undatedSource), null);

  const partialStub = toAgentProgressSource({ chunkId: 'stub-only' }, 'found');
  assert.equal(partialStub, null, 'partial test stubs without title/publisher safely return null');
});

test('mergeAgentProgressSources deduplicates by chunkId, preserves read metadata against late found, and caps at 6 keeping read sources', () => {
  const found = toAgentProgressSource(sampleChunk, 'found')!;
  const read = toAgentProgressSource(
    { ...sampleChunk, sourceExcerpt: '已讀取更完整上下文段落。', applicabilityStatus: 'conditional' },
    'read',
  )!;
  const second = toAgentProgressSource(
    {
      ...sampleChunk,
      chunkId: '33333333-4444-4555-8666-777777777777',
      title: '母嬰健康院：退燒護理須知',
    },
    'found',
  )!;

  const step1 = mergeAgentProgressSources([], [found]);
  assert.equal(step1.length, 1);
  assert.equal(step1[0]?.stage, 'found');

  const step2 = mergeAgentProgressSources(step1, [read, second]);
  assert.equal(step2.length, 2);
  assert.equal(step2[0]?.chunkId, sampleChunk.chunkId);
  assert.equal(step2[0]?.stage, 'read');
  assert.equal(step2[0]?.applicabilityStatus, 'conditional');
  assert.equal(step2[0]?.excerpt, '已讀取更完整上下文段落。');
  assert.equal(step2[1]?.chunkId, second.chunkId);
  assert.equal(step2[1]?.stage, 'found');

  const step3 = mergeAgentProgressSources(step2, [found]);
  assert.equal(step3[0]?.stage, 'read', 'read stage must never regress back to found');
  assert.equal(step3[0]?.excerpt, '已讀取更完整上下文段落。', 'late found payload must not overwrite read excerpt');
  assert.equal(step3[0]?.applicabilityStatus, 'conditional', 'late found payload must not overwrite read applicability');

  const excessFound = Array.from({ length: 7 }, (_, i) => toAgentProgressSource({
    ...sampleChunk,
    chunkId: `44444444-4444-4444-8444-00000000000${i}`,
    title: `來源 ${i}`,
  }, 'found')!);
  const lateRead = toAgentProgressSource({
    ...sampleChunk,
    chunkId: '55555555-5555-4555-8555-555555555555',
    title: '精讀官方來源',
  }, 'read')!;
  const capped = mergeAgentProgressSources(excessFound, [lateRead]);
  assert.equal(capped.length, AGENT_PROGRESS_MAX_SOURCES);
  assert.equal(capped[0]?.chunkId, lateRead.chunkId, 'read cards must be prioritized ahead of excess found cards within 6-card cap');
});

test('createProductAgentTools emits found and read source progress events and respects SSE stream limits', async () => {
  const budget = new AgentBudget();
  const emitted: Array<{ stage: string; sources: NonNullable<AgentProgress['sources']> }> = [];
  const surface = createProductAgentTools({
    run: {
      scope: { userId: 'u1', workspaceId: 'w1', childId: 'c1', authorizationVersion: '1', dataVersion: '1' },
      runId: randomUUID(),
      budget,
    },
    authorize: async () => true,
    onKnowledgeSources: (sources: NonNullable<AgentProgress['sources']>, stage: 'found' | 'read') => {
      emitted.push({ stage, sources });
    },
    memory: {
      context: async () => ({
        profile: { childId: 'c1', version: 1, data: { birthDate: '2025-10-01' }, confirmedBy: 'u1', confirmedAt: '2026-10-01T00:00:00Z', reason: 'ok' },
        profileApplicable: true,
        facts: [],
        topics: [],
        summary: null,
        recentMessages: [],
        conflictingKeys: [],
        unavailableFactKeys: [],
        truncated: { facts: false, topics: false, messages: false },
      }),
    },
    tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) },
    store: { readHistory: async () => null },
    knowledge: {
      createRun: () => ({
        search: async () => ({ mode: 'vector_keyword' as const, degradationReason: null, chunks: [sampleChunk] }),
        readContext: async () => ({
          versionId: sampleChunk.versionId,
          anchorChunkId: sampleChunk.chunkId,
          chunks: [{
            ...sampleChunk,
            original: { text: '完整上下文內容', offset: 0, nextOffset: null, totalCharacters: 7, coverage: 'chunk_original' as const },
          }],
          start: { key: sampleChunk.key, offset: 0 },
          nextCursor: null,
          complete: true,
          coverage: 'same_version_chunks' as const,
        }),
      }),
    },
  } as unknown as Parameters<typeof createProductAgentTools>[0]);

  try {
    const searchTool = surface.tools.find(tool => tool.name === 'search_knowledge')!;
    const readTool = surface.tools.find(tool => tool.name === 'read_knowledge_context')!;

    const searchRes = await searchTool.execute(
      { query: '發燒護理', classification: 'official_guidance' },
      { scope: { userId: 'u1', workspaceId: 'w1', childId: 'c1', authorizationVersion: '1', dataVersion: '1' }, runId: randomUUID(), callId: 'c-search', signal: budget.signal },
    );
    assert.equal(searchRes.status, 'succeeded');
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0]?.stage, 'found');
    assert.equal(emitted[0]?.sources[0]?.chunkId, sampleChunk.chunkId);
    assert.equal(emitted[0]?.sources[0]?.stage, 'found');

    const readRes = await readTool.execute(
      { anchorChunkId: sampleChunk.chunkId, cursor: null },
      { scope: { userId: 'u1', workspaceId: 'w1', childId: 'c1', authorizationVersion: '1', dataVersion: '1' }, runId: randomUUID(), callId: 'c-read', signal: budget.signal },
    );
    assert.equal(readRes.status, 'succeeded');
    assert.equal(emitted.length, 2);
    assert.equal(emitted[1]?.stage, 'read');
    assert.equal(emitted[1]?.sources[0]?.chunkId, sampleChunk.chunkId);
    assert.equal(emitted[1]?.sources[0]?.stage, 'read');

    const runId = randomUUID();
    const messageId = randomUUID();
    const response = agentFeedbackStream(async publish => {
      for (let i = 0; i < 60; i++) {
        publish({
          runId,
          messageId,
          phase: i % 2 === 0 ? 'searching' : 'reading',
          sources: [toAgentProgressSource(sampleChunk, i % 2 === 0 ? 'found' : 'read')!],
        });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    }, async () => true);

    const received: AgentProgress[] = [];
    const final = await readAgentFeedback(response, event => received.push(event));
    assert.equal(final.status, 200);
    assert.equal(received.length, 48, 'agentFeedbackStream must cap total progress frames at 48');
  } finally {
    budget.close();
  }
});

test('formal HTTP SSE streams progressive source cards and official help before final reply exists', { timeout: 10000 }, async () => {
  const fake = firestoreDomainFixture();
  function query(raw: any): any {
    return new Proxy(raw, {
      get(target, key) {
        if (key === 'get') return () => fake.database.runTransaction(tx => tx.get(target));
        const value = target[key];
        return typeof value === 'function'
          ? (...args: any[]) => {
              const result = value(...args);
              return result?.query ? query(result) : result?.path ? { ...result, id: result.path.split('/').at(-1) } : result;
            }
          : value;
      },
    });
  }
  const database = { ...fake.database, collection: (path: string) => query(fake.database.collection(path)) } as Firestore;
  const options = { database, projectId: 'synthetic-source-progress', namespace: 'unit_source_progress', cipher: createStorageCipher(Buffer.alloc(32, 66)) };
  const authority = createFirestoreAuthority(options);
  await authority.initializeControl({ generation: randomUUID(), enabled: true });
  await authority.issueInvitation({ email: 'owner@example.test', operationId: randomUUID(), expiresAt: new Date(Date.now() + 60000).toISOString() });
  await authority.admitIdentity({ userId: 'owner', email: 'owner@example.test', emailVerified: true });
  await authority.acknowledge({ userId: 'owner', operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  const { child } = await authority.createChild({ userId: 'owner', displayName: '合成孩子', operationId: randomUUID() });

  const gate = deferred<void>();
  const helpAndSourceSeen = deferred<void>();
  let step = 0;
  const chat = createFirestoreChatStore(options);
  const care = createFirestoreCareStore(options);
  const memory = createFirestoreMemoryStore({ ...options, chat, care });
  const online = createFirestoreOnlineStore({ ...options, mutations: [chat.mutation, care.mutation, memory.mutation] });
  const product = await createFirestoreProductAgent({
    ...options,
    chat,
    care,
    memory,
    online,
    config: readAiConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: options.projectId }),
    platformProvider: {
      async generate() {
        step++;
        if (step === 1) {
          return {
            content: {
              role: 'model',
              parts: [{ functionCall: { id: 'help-1', name: 'show_official_help', args: { card: 'medical-consult-hk-v1' } } }],
            },
            finishReason: FinishReason.STOP,
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
          };
        }
        await gate.promise;
        return {
          content: {
            role: 'model',
            parts: [{ functionCall: { id: 'ans-1', name: 'present_answer', args: { kind: 'clarification', paragraphs: [{ text: '請問寶寶目前幾多個月大？', citationIds: [] }] } } }],
          },
          finishReason: FinishReason.STOP,
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
        };
      },
    },
  });

  const origReply = product.agent.reply.bind(product.agent);
  product.agent.reply = async (userId, childId, messageId, isCurrentUser, signal, onProgress) => {
    return origReply(userId, childId, messageId, isCurrentUser, signal, event => {
      onProgress?.(event);
      if (event.phase === 'help') {
        onProgress?.({
          runId: event.runId,
          messageId: event.messageId,
          phase: 'searching',
          sources: [toAgentProgressSource(sampleChunk, 'found')!],
        });
        onProgress?.({
          runId: event.runId,
          messageId: event.messageId,
          phase: 'reading',
          sources: [toAgentProgressSource(sampleChunk, 'read')!],
        });
      }
    });
  };

  const origin = 'https://synthetic.local';
  const inMemoryFetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const headers = new Headers(init?.headers);
    if (!headers.has('origin')) headers.set('origin', origin);
    const request = new Request(url, {
      method: init?.method ?? 'GET',
      headers,
      body: init?.body,
    });
    if (new URL(request.url).pathname.endsWith('/messages')) return handleChatRequest(request, 'owner', chat);
    return handleProductAgentRequest(request, 'owner', { agent: product.agent, store: product.store, chat, isCurrentUser: async () => true });
  };
  const api = createChatApi(origin, async () => ({ id: 'owner', name: 'Owner', email: 'owner@example.test' }), inMemoryFetch);

  const controller = new ChatController({
    ...api,
    getStatus: async () => true,
    getUsage: async () => ({ day: '2026-10-16', attempts: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, unknownUsageAttempts: 0 }),
  });

  try {
    const userMsg = await chat.createUserMessageForUser('owner', child.id, 'BB發燒想問退燒護理同埋用藥問題');
    const ready = deferred<void>();
    const unsub = controller.subscribe(() => {
      if (!controller.getSnapshot().loading && controller.getSnapshot().messages.some(m => m.id === userMsg!.id)) ready.resolve();
    });
    controller.syncContext('owner', true, child.id);
    await ready.promise;
    unsub();

    const unsubProgress = controller.subscribe(() => {
      const fb = controller.getSnapshot().feedback;
      if (fb?.cards.includes('medical-consult-hk-v1') && fb?.sources.some(s => s.stage === 'read')) {
        helpAndSourceSeen.resolve();
      }
    });
    const replyPromise = controller.requestReply(userMsg!.id);
    await helpAndSourceSeen.promise;
    unsubProgress();

    const midSnapshot = controller.getSnapshot();
    assert.equal(midSnapshot.busy, 'reply');
    assert.deepEqual(midSnapshot.feedback?.cards, ['medical-consult-hk-v1']);
    assert.equal(midSnapshot.feedback?.sources.length, 1);
    assert.equal(midSnapshot.feedback?.sources[0]?.chunkId, sampleChunk.chunkId);
    assert.equal(midSnapshot.feedback?.sources[0]?.stage, 'read');
    assert.equal(midSnapshot.feedback?.sources[0]?.publisher, '衛生署家庭健康服務');
    assert.equal(
      (await chat.listForUser('owner', child.id))!.messages.filter(m => m.role === 'model').length,
      0,
      'progressive source cards and official help must be visible on controller feedback before final model message exists',
    );

    gate.resolve();
    await replyPromise;
    const finalSnapshot = controller.getSnapshot();
    assert.equal(finalSnapshot.busy, null);
    assert.equal(finalSnapshot.feedback, null);
    assert.ok(finalSnapshot.messages.some(m => m.inReplyTo === userMsg!.id));
  } finally {
    gate.resolve();
    controller.dispose();
  }
});

test('chatScreen and OfficialHelpCards wire progressive source cards with explicit non-approved disclaimer', async () => {
  const screenCode = await readFile(new URL('../frontend/src/screens/chatScreen.tsx', import.meta.url), 'utf8');
  const cardsCode = await readFile(new URL('../frontend/src/components/chat/OfficialHelpCards.tsx', import.meta.url), 'utf8');
  assert.match(screenCode, /ProgressSourceCards/);
  assert.match(screenCode, /chat\.busy === "reply" && chat\.feedback\?\.sources\.length/);
  assert.match(cardsCode, /testID="chat-progress-sources"/);
  assert.match(cardsCode, /AGENT_PROGRESS_SOURCE_DISCLAIMER/);
  assert.match(cardsCode, /AGENT_PROGRESS_SOURCE_STAGE_LABELS/);
  assert.match(cardsCode, /formatProgressSourceDateText/);
  assert.match(cardsCode, /dateText \? <Text/);
  assert.equal(AGENT_PROGRESS_LABELS.reviewing, '正在獨立核對回覆');
});

