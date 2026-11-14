import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { FinishReason } from '@google/genai';
import { readAiConfig } from '../server/ai-config.ts';
import { createAgentRuntime } from '../server/agent-runtime.ts';
import { createEmbeddingGateway } from '../server/embedding-gateway.ts';
import { createKnowledgeRetriever } from '../server/knowledge-retriever.ts';
import { createProductAgent } from '../server/product-agent.ts';
import { agentProgressSchema, reconcileAgentProgress, type AgentProgress } from '../src/shared/agent-feedback.ts';
import { ChatController } from '../src/client/chat-controller.ts';
import { ChatApiError, type ChatApi } from '../src/client/chat-api.ts';
import type { ChatMessage, ChatReplyState } from '../src/shared/chat.ts';
import type { ProductAgentResult } from '../src/shared/product-agent.ts';

test('reconcileAgentProgress deduplicates frames, blocks mismatched runIds, and prevents reviewing/active phase regression', () => {
  const runId = randomUUID();
  const otherRunId = randomUUID();
  const messageId = randomUUID();

  const s1 = reconcileAgentProgress(null, { runId, messageId, phase: 'started' });
  assert.equal(s1.phase, 'started');
  assert.deepEqual(s1.cards, []);

  const s1Dup = reconcileAgentProgress(s1, { runId, messageId, phase: 'started' });
  assert.equal(s1Dup, s1, 'duplicate progress frame must return identical state reference');

  const s2 = reconcileAgentProgress(s1, { runId, messageId, phase: 'searching' });
  assert.equal(s2.phase, 'searching');

  const lateStarted = reconcileAgentProgress(s2, { runId, messageId, phase: 'started' });
  assert.equal(lateStarted, s2, 'late started frame must not regress searching back to started');

  const lateModel = reconcileAgentProgress(s2, { runId, messageId, phase: 'model' });
  assert.equal(lateModel, s2, 'late model frame must not regress active searching phase');

  const wrongRun = reconcileAgentProgress(s2, { runId: otherRunId, messageId, phase: 'reviewing' });
  assert.equal(wrongRun, s2, 'progress frame from a mismatched runId must be ignored');

  const toolEnd = reconcileAgentProgress(s2, { runId, messageId, phase: 'tool_finished' });
  assert.equal(toolEnd.phase, 'tool_finished');

  const lateSearchingAfterToolEnd = reconcileAgentProgress(toolEnd, { runId, messageId, phase: 'searching' });
  assert.equal(lateSearchingAfterToolEnd, toolEnd, 'late searching frame must not regress tool_finished');

  const lateModelAfterToolEnd = reconcileAgentProgress(toolEnd, { runId, messageId, phase: 'model' });
  assert.equal(lateModelAfterToolEnd, toolEnd, 'late model frame must not regress tool_finished');

  const s3 = reconcileAgentProgress(toolEnd, { runId, messageId, phase: 'reviewing' });
  assert.equal(s3.phase, 'reviewing');

  const lateToolEnd = reconcileAgentProgress(s3, { runId, messageId, phase: 'tool_finished' });
  assert.equal(lateToolEnd, s3, 'out-of-order tool_finished frame must not regress reviewing phase');

  const helpDuringReview = reconcileAgentProgress(s3, {
    runId,
    messageId,
    phase: 'help',
    card: 'medical-consult-hk-v1',
  });
  assert.equal(helpDuringReview.phase, 'reviewing', 'reviewing phase stays active when help card arrives');
  assert.deepEqual(helpDuringReview.cards, ['medical-consult-hk-v1']);

  const duplicateHelp = reconcileAgentProgress(helpDuringReview, {
    runId,
    messageId,
    phase: 'help',
    card: 'medical-consult-hk-v1',
  });
  assert.equal(duplicateHelp, helpDuringReview, 'duplicate help card frame is ignored');
});

test('ChatController preserves remoteReply=running on same-device SSE disconnect and recovers via refreshOriginalReply without re-executing', async () => {
  const userId = 'owner-1';
  const childId = randomUUID();
  const messageId = randomUUID();
  const runId = randomUUID();
  const replyId = randomUUID();

  const userMessage: ChatMessage = {
    id: messageId,
    childId,
    authorUserId: userId,
    role: 'user',
    text: 'BB發燒點處理？',
    inReplyTo: null,
    createdAt: '2026-11-10T01:00:00.000Z',
  };
  const modelReply: ChatMessage = {
    id: replyId,
    childId,
    authorUserId: null,
    role: 'model',
    text: '已核對官方來源回覆。',
    inReplyTo: messageId,
    agentRunId: runId,
    officialHelp: [],
    createdAt: '2026-11-10T01:00:05.000Z',
  };

  let serverSettled = false;
  let requestReplyCalls = 0;

  const api: ChatApi = {
    getSession: async () => ({ id: userId, name: 'Owner', email: 'owner@example.test' }),
    getStatus: async () => true,
    getUsage: async () => ({ day: '2026-11-10', attempts: 1, inputTokens: 10, outputTokens: 10, cachedTokens: 0, unknownUsageAttempts: 0 }),
    listMessages: async () => ({
      messages: serverSettled ? [userMessage, modelReply] : [userMessage],
      nextCursor: null,
      limit: 30,
    }),
    saveMessage: async () => userMessage,
    requestReply: async (_cId, _mId, _signal, _uId, onProgress) => {
      requestReplyCalls++;
      onProgress?.({ runId, messageId, phase: 'started' });
      onProgress?.({ runId, messageId, phase: 'reviewing' });
      onProgress?.({ runId, messageId, phase: 'tool_finished' });
      throw new ChatApiError(0, null, '連線中斷');
    },
    getReplyState: async () => (serverSettled ? 'completed' : 'running'),
    getOriginalReply: async (): Promise<ChatReplyState | null> =>
      requestReplyCalls > 0
        ? {
            messageId,
            runId,
            status: serverSettled ? 'completed' : 'running',
            stopReason: null,
          }
        : null,
  };

  const controller = new ChatController(api);
  try {
    controller.syncContext(userId, true, childId);
    await new Promise(r => setTimeout(r, 20));

    const phasesSeen: AgentProgress['phase'][] = [];
    const unsub = controller.subscribe(() => {
      const phase = controller.getSnapshot().feedback?.phase;
      if (phase && phasesSeen.at(-1) !== phase) phasesSeen.push(phase);
    });

    await controller.requestReply(messageId);
    unsub();

    assert.deepEqual(
      phasesSeen,
      ['started', 'reviewing'],
      'out-of-order tool_finished after reviewing must not regress controller feedback phase',
    );
    assert.equal(requestReplyCalls, 1);

    const afterDisconnect = controller.getSnapshot();
    assert.equal(afterDisconnect.busy, null);
    assert.equal(afterDisconnect.remoteReply?.status, 'running', 'same-device SSE disconnect must preserve remoteReply.status=running');
    assert.equal(afterDisconnect.remoteReply?.runId, runId);
    assert.equal(afterDisconnect.messages.find(m => m.id === messageId)?.agentRunId, runId);
    assert.match(afterDisconnect.replyError ?? '', /原運行仍在處理/);

    serverSettled = true;
    await controller.refreshOriginalReply();

    const afterRecovery = controller.getSnapshot();
    assert.equal(requestReplyCalls, 1, 'foreground recovery must never POST another requestReply');
    assert.equal(afterRecovery.remoteReply, null, 'stale remoteReply must be cleared once completed reply loads');
    assert.equal(afterRecovery.replyError, null, 'stale replyError must be cleared once completed reply loads');
    assert.ok(afterRecovery.messages.some(m => m.id === replyId && m.inReplyTo === messageId));
  } finally {
    controller.dispose();
  }
});

test('reloadMessages immediately resolves a run that completed between listMessages and readOriginal without leaving a stale banner', async () => {
  const userId = 'owner-2';
  const childId = randomUUID();
  const messageId = randomUUID();
  const runId = randomUUID();
  const replyId = randomUUID();

  const userMessage: ChatMessage = {
    id: messageId,
    childId,
    authorUserId: userId,
    role: 'user',
    text: '請問幾時打疫苗？',
    inReplyTo: null,
    createdAt: '2026-11-10T02:00:00.000Z',
  };
  const modelReply: ChatMessage = {
    id: replyId,
    childId,
    authorUserId: null,
    role: 'model',
    text: '衛生署免疫接種時間表回覆。',
    inReplyTo: messageId,
    agentRunId: runId,
    officialHelp: [],
    createdAt: '2026-11-10T02:00:03.000Z',
  };

  let listCalls = 0;
  const api: ChatApi = {
    getSession: async () => ({ id: userId, name: 'Owner', email: 'owner@example.test' }),
    getStatus: async () => true,
    getUsage: async () => ({ day: '2026-11-10', attempts: 1, inputTokens: 10, outputTokens: 10, cachedTokens: 0, unknownUsageAttempts: 0 }),
    listMessages: async () => {
      listCalls++;
      return {
        messages: listCalls >= 2 ? [userMessage, modelReply] : [userMessage],
        nextCursor: null,
        limit: 30,
      };
    },
    saveMessage: async () => userMessage,
    requestReply: async () => modelReply,
    getOriginalReply: async (): Promise<ChatReplyState> => ({
      messageId,
      runId,
      status: 'completed',
      stopReason: null,
    }),
  };

  const controller = new ChatController(api);
  try {
    controller.syncContext(userId, true, childId);
    await new Promise(r => setTimeout(r, 30));

    const state = controller.getSnapshot();
    assert.equal(listCalls, 2, 'completed readOriginal triggers immediate message list refresh');
    assert.ok(state.messages.some(m => m.id === replyId));
    assert.equal(state.remoteReply, null, 'remoteReply must not stay stuck on completed');
    assert.equal(state.replyError, null, 'replyError must not stay stuck on 原運行已完成，正在核對已保存的回覆。');
  } finally {
    controller.dispose();
  }
});

test('chatScreen suppresses stale running indicators when a model reply message is already present', async () => {
  const screenCode = await readFile(new URL('../frontend/src/screens/chatScreen.tsx', import.meta.url), 'utf8');
  assert.match(screenCode, /remoteReplyStillRunning/);
  assert.match(screenCode, /effectiveRunStatus/);
  assert.match(screenCode, /run\?\.status === "running" && \(message\.role === "model" \|\| hasModelReply\) \? "completed" : run\?\.status/);
});

test('reconcileAgentProgress advances causally across multi-round tool calls and rejects stale or mismatched frames (R2 F1)', () => {
  const runId = randomUUID();
  const wrongRunId = randomUUID();
  const messageId = randomUUID();

  assert.equal(agentProgressSchema.safeParse({ runId, messageId, phase: 'started', sequence: 1 }).success, true);
  assert.equal(agentProgressSchema.safeParse({ runId, messageId, phase: 'started', sequence: 0 }).success, false);

  const s1 = reconcileAgentProgress(null, { runId, messageId, phase: 'started', sequence: 1 });
  const s2 = reconcileAgentProgress(s1, { runId, messageId, phase: 'model', sequence: 2 });
  const s3 = reconcileAgentProgress(s2, { runId, messageId, phase: 'searching', sequence: 3 });
  const s4 = reconcileAgentProgress(s3, { runId, messageId, phase: 'tool_finished', sequence: 4 });
  assert.equal(s4.phase, 'tool_finished');

  // Round-2 retry on the same runId must advance past tool_finished rather than freezing at rank 3.
  const s5 = reconcileAgentProgress(s4, { runId, messageId, phase: 'model', sequence: 5 });
  assert.equal(s5.phase, 'model');
  assert.equal(s5.sequence, 5);

  // Stale lower-sequence tool_finished or searching must not regress round-2 model phase.
  assert.equal(reconcileAgentProgress(s5, { runId, messageId, phase: 'tool_finished', sequence: 4 }), s5);
  assert.equal(reconcileAgentProgress(s5, { runId, messageId, phase: 'searching', sequence: 3 }), s5);
  assert.equal(reconcileAgentProgress(s5, { runId, messageId, phase: 'model', sequence: 5 }), s5);

  const s6 = reconcileAgentProgress(s5, { runId, messageId, phase: 'reading', sequence: 6 });
  assert.equal(s6.phase, 'reading');

  // Help card arriving during an active phase keeps active phase while accumulating cards and advancing sequence.
  const s7Help = reconcileAgentProgress(s6, {
    runId,
    messageId,
    phase: 'help',
    card: 'medical-consult-hk-v1',
    sequence: 7,
  });
  assert.equal(s7Help.phase, 'reading');
  assert.equal(s7Help.sequence, 7);
  assert.deepEqual(s7Help.cards, ['medical-consult-hk-v1']);

  const s8 = reconcileAgentProgress(s7Help, { runId, messageId, phase: 'tool_finished', sequence: 8 });
  const s9 = reconcileAgentProgress(s8, { runId, messageId, phase: 'reviewing', sequence: 9 });
  assert.equal(s9.phase, 'reviewing');
  assert.equal(s9.sequence, 9);

  // Wrong runId and out-of-order lower-sequence frames never mutate reviewing state.
  assert.equal(reconcileAgentProgress(s9, { runId: wrongRunId, messageId, phase: 'started', sequence: 99 }), s9);
  assert.equal(reconcileAgentProgress(s9, { runId, messageId, phase: 'tool_finished', sequence: 8 }), s9);
});

test('createProductAgent emits monotonically sequenced multi-round progress events that reconcile through reviewing', async () => {
  const userId = 'owner-progress-1';
  const childId = randomUUID();
  const messageId = randomUUID();
  const runId = randomUUID();
  const chunkId = randomUUID();
  const versionId = randomUUID();
  const scope = { userId, childId, workspaceId: 'workspace-hk', authorizationVersion: '1', dataVersion: 'epoch:1' };
  const chunk = {
    chunkId,
    sourceId: 'fhs-solid-food',
    versionId,
    versionHash: 'vh-1',
    contentHash: 'ch-1',
    key: 'starting-solids',
    url: 'https://www.fhs.gov.hk/tc_chi/health_info/child/30039.html',
    title: '嬰幼兒飲食－引進固體食物過渡期',
    publisher: '衞生署家庭健康服務',
    section: '約六個月大開始',
    classification: 'official_guidance' as const,
    sourceExcerpt: '約六個月時可開始加入固體食物。',
    originalText: '約六個月時可開始加入固體食物。',
    text: '衞生署指引指出，孩子約六個月時應開始加入固體食物。',
    keywords: ['加固', '固體食物'],
    applicability: { region: 'HK', ageBasis: 'actual' as const, minAgeMonths: 0, maxAgeMonths: 12, topics: ['feeding'], conditions: [] },
    sourcePublishedAt: null,
    sourceUpdatedAt: null,
    fetchedAt: '2026-01-01T00:00:00Z',
    checkedAt: '2026-01-01T00:00:00Z',
    reviewState: 'reviewed' as const,
    distance: 0.05,
  };
  const config = readAiConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: 'synthetic-project', AI_DAILY_USER_ATTEMPTS: '10', AI_DAILY_GLOBAL_ATTEMPTS: '50' });
  const gateway = createEmbeddingGateway({
    config,
    usage: { reserve: async () => true, record: async () => {} },
    provider: { embed: async () => ({ values: [1, ...Array<number>(1023).fill(0)], inputTokens: 4, billableCharacters: 12 }) },
  });
  const retriever = createKnowledgeRetriever({ candidates: async () => [chunk] }, gateway);

  let step = 0;
  let savedResult: ProductAgentResult | null = null;
  const runtime = createAgentRuntime({
    config,
    usage: { reserve: async () => true, record: async () => {} },
    provider: {
      generate: async request => {
        const promptText = request.contents.flatMap(content => content.parts ?? []).map(part => part.text ?? '').join('\n');
        if (promptText.includes('chat-delivery-review')) {
          const payload = JSON.parse(promptText.slice(promptText.indexOf('{'))) as { draftHash: string };
          return {
            content: { role: 'model', parts: [{ text: JSON.stringify({ draftHash: payload.draftHash, decision: 'pass', issues: [] }) }] },
            finishReason: FinishReason.STOP,
          };
        }
        const current = step++;
        if (current >= 3) {
          return { content: { role: 'model', parts: [{ text: 'done' }] }, finishReason: FinishReason.STOP };
        }
        const functionCall = current === 0
          ? { id: 'c1', name: 'search_knowledge', args: { query: 'BB幾時加固', classification: 'official_guidance' } }
          : current === 1
            ? { id: 'c2', name: 'read_context', args: {} }
            : { id: 'c3', name: 'present_answer', args: { kind: 'caregiving', paragraphs: [{ text: '約六個月時可開始加入固體食物。', citationIds: [chunkId] }] } };
        return { content: { role: 'model', parts: [{ functionCall }] }, finishReason: FinishReason.STOP };
      },
    },
  });

  const agent = createProductAgent({
    runtime,
    store: {
      claim: async () => ({ runId, scope, created: true, sourceMessageId: messageId, state: 'running', expiresAt: new Date(Date.now() + 90000).toISOString() }),
      authorize: async () => true,
      finish: async (_scope: unknown, result: ProductAgentResult) => { savedResult = result; return true; },
      get: async () => savedResult,
    } as any,
    memory: {
      context: async () => ({
        scope: { ...scope, visibility: 'private' as const },
        retrievalPolicy: { maxFacts: 20, maxNotes: 10 },
        profileApplicable: true,
        profile: { childId, version: 1, data: { age: { kind: 'months', exactMonths: 6, asOf: '2026-11-10' }, region: 'HK' } },
        facts: [],
        notes: [],
        pendingFacts: [],
        summary: null,
        truncated: { facts: false, notes: false, messages: false },
      }),
      listConfirmedFacts: async () => [],
    } as any,
    chat: { listForUser: async () => ({ messages: [{ id: messageId, role: 'user', text: 'BB幾時可以食固體食物？' }] }) } as any,
    tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) } as any,
    knowledge: retriever,
  });

  const events: AgentProgress[] = [];
  const result = await agent.reply(userId, childId, messageId, async () => true, undefined, event => {
    events.push(agentProgressSchema.parse(event));
  });
  assert.equal(result?.status, 'completed', `Unexpected stopReason=${result?.stopReason} text=${result?.text} phases=${events.map(e => e.phase).join(',')}`);
  assert.ok(events.length >= 10);
  for (let i = 0; i < events.length; i++) {
    assert.equal(events[i]!.sequence, i + 1, 'Progress event sequence must increment monotonically from 1');
  }
  const firstToolEndIndex = events.findIndex(e => e.phase === 'tool_finished');
  assert.ok(firstToolEndIndex > 0);
  assert.ok(events.slice(firstToolEndIndex + 1).some(e => e.phase === 'reading'), 'Round-2 reading must emit after first tool_finished');

  let reconciled: ReturnType<typeof reconcileAgentProgress> | null = null;
  const reconciledPhases: string[] = [];
  for (const event of events) {
    reconciled = reconcileAgentProgress(reconciled, event);
    reconciledPhases.push(reconciled.phase);
  }
  assert.equal(reconciledPhases.slice(firstToolEndIndex + 1).includes('reading'), true, 'Reconciled state must advance to reading after first tool_finished');
  assert.equal(reconciled?.phase, 'reviewing');

  // Replaying an earlier tool_finished event out of order never regresses reviewing.
  const stale = reconcileAgentProgress(reconciled, events[firstToolEndIndex]!);
  assert.equal(stale, reconciled);
});
