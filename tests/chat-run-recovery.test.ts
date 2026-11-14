import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { reconcileAgentProgress, type AgentProgress } from '../src/shared/agent-feedback.ts';
import { ChatController } from '../src/client/chat-controller.ts';
import { ChatApiError, type ChatApi } from '../src/client/chat-api.ts';
import type { ChatMessage, ChatReplyState } from '../src/shared/chat.ts';

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
