import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatController } from '../src/client/chat-controller.ts';
import { ChatApiError, type ChatApi } from '../src/client/chat-api.ts';
import type { ChatMessage, ChatReplyState } from '../src/shared/chat.ts';

const childId = 'child-1';
const owner = 'parent-1';
const runId = 'synthetic-run';
const question: ChatMessage = {
  id: 'question', childId, authorUserId: owner, role: 'user', text: 'Synthetic question',
  inReplyTo: null, createdAt: '2026-11-19T00:00:00Z',
};
const answer: ChatMessage = {
  ...question, id: 'answer', role: 'model', authorUserId: null, text: 'Synthetic approved answer',
  inReplyTo: question.id, agentRunId: runId,
};
const original = (status: ChatReplyState['status']): ChatReplyState =>
  ({ messageId: question.id, runId, status, stopReason: null });

async function failedTurn(prepare?: (api: ChatApi, history: ChatMessage[]) => void, voice?: Parameters<ChatController['send']>[0]) {
  const history: ChatMessage[] = [];
  let runs = 0;
  const api: ChatApi = {
    getSession: async () => ({ id: owner, name: 'Parent', email: 'p@example.test' }),
    listMessages: async () => ({ messages: [...history], limit: 20 }),
    saveMessage: async () => { history.push(question); return question; },
    getOriginalReply: async () => null,
    requestReply: async (_child, messageId, _signal, _user, progress) => {
      runs++;
      progress?.({ messageId, runId, sequence: 1, phase: 'help', card: 'emergency-hk-v1' });
      progress?.({ messageId, runId, sequence: 2, phase: 'reading', sources: [{
        stage: 'read', chunkId: 'source-chunk', sourceId: 'official-source', title: 'Synthetic reference',
        excerpt: 'Synthetic excerpt', section: 'Overview', publisher: 'Example', url: null,
        fetchedAt: null, sourceUpdatedAt: null,
      }] });
      throw new Error('Synthetic interruption');
    },
    getStatus: async () => true,
    getUsage: async () => ({ day: '2026-11-19', attempts: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, unknownUsageAttempts: 0 }),
  };
  prepare?.(api, history);
  const ctrl = new ChatController(api);
  const loaded = new Promise<void>(resolve => {
    const off = ctrl.subscribe(() => {
      if (!ctrl.getSnapshot().loadedAt || ctrl.getSnapshot().loading) return;
      off();
      resolve();
    });
  });
  ctrl.syncContext(owner, true, childId);
  await loaded;
  ctrl.setText(question.text);
  await ctrl.send(voice);
  const feedback = ctrl.getSnapshot().feedback;
  if (!prepare) {
    assert.deepEqual(feedback?.cards, ['emergency-hk-v1']);
    assert.equal(feedback?.sources[0]?.chunkId, 'source-chunk');
  }
  return { api, ctrl, feedback, history, runs: () => runs };
}

test('retrying the same saved turn retains both kinds of feedback throughout read-only checks', async () => {
  const { api, ctrl, feedback, history, runs } = await failedTurn();
  try {
    for (const status of ['running', 'stopped', 'unknown', 'unavailable'] as const) {
      api.getOriginalReply = async () => {
        if (status === 'unavailable') throw new Error('Synthetic read failure');
        return original(status);
      };
      const observed: Array<ReturnType<ChatController['getSnapshot']>['feedback']> = [];
      const off = ctrl.subscribe(() => observed.push(ctrl.getSnapshot().feedback));
      await ctrl.requestReply(question.id);
      off();
      assert.ok(observed.length > 0);
      assert.ok(observed.every(snapshot => snapshot === feedback), status + ': feedback must not disappear even temporarily');
      assert.equal(runs(), 1, status + ': checking the original must not execute another run');
    }
    api.getOriginalReply = async () => null;
    api.requestReply = async (_child, messageId, _signal, _user, progress) => {
      progress?.({ messageId, runId: 'replacement-run', phase: 'help', card: 'medical-consult-hk-v1' });
      throw new Error('Synthetic replacement run interruption');
    };
    await ctrl.requestReply(question.id);
    assert.equal(ctrl.getSnapshot().feedback?.runId, 'replacement-run', 'a genuinely different run can publish its own help');
    assert.deepEqual(ctrl.getSnapshot().feedback?.cards, ['medical-consult-hk-v1']);
    history.push({ ...question, id: 'newer-question' });
    await ctrl.reloadMessages();
    assert.equal(ctrl.getSnapshot().feedback, null, 'a newer authoritative turn supersedes old feedback');
    assert.equal(ctrl.getSnapshot().drafts[childId].phase, 'draft', 'a superseded failed turn must not lock the composer');
    assert.equal(ctrl.getSnapshot().drafts[childId].savedUserMessageId, null);
    assert.equal(ctrl.getSnapshot().drafts[childId].text, '');
    ctrl.setText('Different unsent draft');
    await ctrl.requestReply(question.id);
    const historicalFeedback = ctrl.getSnapshot().feedback;
    assert.equal(historicalFeedback?.runId, 'replacement-run');
    await ctrl.reloadMessages();
    assert.equal(ctrl.getSnapshot().feedback, historicalFeedback, 'already-visible newer rows do not supersede an explicit historical retry');
    ctrl.dismissRetainedFeedback('different-message');
    assert.equal(ctrl.getSnapshot().feedback, historicalFeedback, 'a stale dismissal must not clear another turn');
    ctrl.dismissRetainedFeedback(question.id);
    assert.equal(ctrl.getSnapshot().feedback, null);
    assert.equal(ctrl.getSnapshot().drafts[childId].text, 'Different unsent draft');
    await ctrl.requestReply(question.id);
    history.push({ ...question, id: 'new-after-historical-retry' });
    await ctrl.reloadMessages();
    assert.equal(ctrl.getSnapshot().feedback, null, 'a genuinely new user turn still supersedes a historical retry');
    assert.equal(ctrl.getSnapshot().drafts[childId].text, 'Different unsent draft');
  } finally { ctrl.dispose(); }
});

test('a completed original whose answer appears on the second page read clears feedback on this reload', async () => {
  const { api, ctrl, runs } = await failedTurn();
  try {
    let reads = 0;
    api.listMessages = async () => ({ messages: ++reads === 1 ? [question] : [question, answer], limit: 20 });
    api.getOriginalReply = async () => original('completed');
    api.getReplyState = async () => 'completed';
    await ctrl.reloadMessages();
    assert.equal(reads, 2);
    assert.equal(ctrl.getSnapshot().messages.at(-1)?.id, answer.id);
    assert.equal(ctrl.getSnapshot().feedback, null, 'use the refreshed authoritative page, not its stale predecessor');
    assert.equal(runs(), 1);
  } finally { ctrl.dispose(); }
});

test('starting a fresh draft dismisses only the failed turn without removing history or rerunning it', async () => {
  const { api, ctrl, runs } = await failedTurn();
  try {
    api.getOriginalReply = async () => original('stopped');
    await ctrl.reloadMessages();
    assert.equal(ctrl.getSnapshot().remoteReply?.status, 'stopped');
    ctrl.startNewMessage();
    const snapshot = ctrl.getSnapshot();
    assert.equal(snapshot.drafts[childId].phase, 'draft');
    assert.equal(snapshot.drafts[childId].dismissedHelpMessageId, question.id);
    assert.equal(snapshot.feedback, null);
    assert.equal(snapshot.replyError, null);
    assert.equal(snapshot.remoteReply, null);
    assert.deepEqual(snapshot.messages.map(item => item.id), [question.id]);
    ctrl.setText('New synthetic draft');
    await ctrl.reloadMessages();
    assert.equal(ctrl.getSnapshot().drafts[childId].dismissedHelpMessageId, question.id);
    assert.equal(ctrl.getSnapshot().replyError, null, 'background reconciliation must not restore the dismissed terminal error');
    await ctrl.requestReply(question.id);
    assert.equal(ctrl.getSnapshot().drafts[childId].dismissedHelpMessageId, undefined, 'explicit retry reselects the old turn');
    assert.equal(ctrl.getSnapshot().remoteReply?.status, 'stopped');
    assert.equal(runs(), 1);
  } finally { ctrl.dispose(); }
});

test('a persisted incomplete answer stays dismissible on delivery, read-only retry and history reconciliation', async () => {
  for (const mode of ['delivered', 'recovered'] as const) {
    let posts = 0;
    const { api, ctrl, history } = await failedTurn((api, history) => {
      api.getReplyState = async () => 'stopped';
      api.requestReply = async (_c, messageId, _signal, _user, progress) => {
        posts++;
        progress?.({ messageId, runId, phase: 'help', card: 'emergency-hk-v1' });
        const row = { ...answer, text: '這次回覆未完成：已取消。' };
        history.push(row);
        if (mode === 'recovered') throw new ChatApiError(503, 'ai_unavailable');
        return row;
      };
    });
    try {
      assert.equal(ctrl.getSnapshot().drafts[childId].phase, 'reply_failed', mode);
      assert.equal(ctrl.getSnapshot().drafts[childId].savedUserMessageId, question.id);
      let reads = 0;
      api.listMessages = async () => { reads++; return { messages: [...history], limit: 20 }; };
      await ctrl.requestReply(question.id);
      assert.ok(reads > 0, 'the recovery control must re-read persisted history');
      assert.equal(posts, 1, 'never execute another run for an existing reply');
      assert.equal(ctrl.getSnapshot().drafts[childId].phase, 'reply_failed');
      assert.deepEqual(ctrl.getSnapshot().feedback?.cards, ['emergency-hk-v1']);
      // A foreground check can finish after the user has explicitly moved on.
      history[history.findIndex(row => row.role === 'model')] = answer;
      let markStarted!: () => void;
      let finishRead!: (reply: ChatReplyState) => void;
      const checking = new Promise<void>(resolve => { markStarted = resolve; });
      api.getOriginalReply = async () => {
        markStarted();
        return new Promise<ChatReplyState>(resolve => { finishRead = resolve; });
      };
      const pendingReload = ctrl.reloadMessages();
      await checking;
      ctrl.startNewMessage();
      ctrl.setText('A different draft');
      finishRead(original('completed'));
      await pendingReload;
      assert.equal(ctrl.getSnapshot().drafts[childId].text, 'A different draft');
      assert.equal(ctrl.getSnapshot().drafts[childId].dismissedHelpMessageId, question.id);
      assert.equal(ctrl.getSnapshot().feedback, null);
      assert.equal(ctrl.getSnapshot().replyError, null);
      assert.deepEqual(ctrl.getSnapshot().messages.map(m => m.id), [question.id, answer.id]);
    } finally { ctrl.dispose(); }
  }
});

test('incomplete replies with no returned sources or help never claim a retained preview', async () => {
  const { ctrl } = await failedTurn((api, history) => {
    api.requestReply = async () => {
      const row = { ...answer, text: '這次回覆未完成：已取消。' };
      history.push(row);
      return row;
    };
  });
  try {
    assert.match(ctrl.getSnapshot().replyError ?? '', /未完成/);
    assert.doesNotMatch(ctrl.getSnapshot().replyError ?? '', /來源預覽|求助提示/);
  } finally { ctrl.dispose(); }
});

test('history does not unlock the saved draft on a normal-looking row until the original completes', async () => {
  const { api, ctrl, history, runs } = await failedTurn(undefined, { id: 'synthetic-voice', version: 1 });
  try {
    history.push(answer);
    api.getOriginalReply = async () => original('unknown');
    await ctrl.reloadMessages();
    assert.equal(ctrl.getSnapshot().drafts[childId].savedUserMessageId, question.id);
    assert.equal(ctrl.getSnapshot().drafts[childId].phase, 'reply_failed');
    assert.deepEqual(ctrl.getSnapshot().feedback?.cards, ['emergency-hk-v1']);
    history[history.indexOf(answer)] = { ...answer, agentRunId: undefined };
    api.getOriginalReply = async () => null;
    let runReads = 0;
    api.getReplyState = async () => { runReads++; return 'stopped'; };
    await ctrl.requestReply(question.id);
    assert.equal(runReads, 0, 'an untagged replacement row does not belong to the old SSE run');
    assert.equal(ctrl.getSnapshot().drafts[childId].phase, 'draft');
    assert.equal(ctrl.getSnapshot().drafts[childId].savedUserMessageId, null);
    assert.equal(ctrl.getSnapshot().drafts[childId].voice, undefined, 'do not resubmit the completed attachment');
    assert.equal(ctrl.getSnapshot().feedback, null);
    assert.equal(runs(), 1);
  } finally { ctrl.dispose(); }
});


test('history settles the latest model row, not an earlier result of the same turn', async () => {
  for (const latestIsComplete of [true, false]) {
    const { api, ctrl, history } = await failedTurn();
    try {
      const stopped = { ...answer, id: 'first-row', text: '聊天已保存，但這次回覆未完成。' };
      const done = { ...answer, id: 'second-row', text: 'Synthetic approved replacement answer', agentRunId: 'replacement' };
      api.getOriginalReply = async () => null;
      api.getReplyState = async (_child, id) => id === 'replacement' ? 'completed' : 'stopped';
      history.push(...(latestIsComplete ? [stopped, done] : [done, stopped]));
      await ctrl.reloadMessages();
      assert.equal(ctrl.getSnapshot().drafts[childId].phase, latestIsComplete ? 'draft' : 'reply_failed');
      assert.equal(ctrl.getSnapshot().drafts[childId].savedUserMessageId, latestIsComplete ? null : question.id);
    } finally { ctrl.dispose(); }
  }
});

test('a disconnected run checks the replacement row against its own run status', async () => {
  const observed: string[] = [];
  const { ctrl } = await failedTurn((api, history) => {
    api.requestReply = async (_child, messageId, _signal, _user, progress) => {
      progress?.({ messageId, runId, phase: 'help', card: 'emergency-hk-v1' });
      history.push({ ...answer, agentRunId: 'replacement-run' });
      throw new ChatApiError(503, 'ai_unavailable');
    };
    api.getReplyState = async (_child, id) => {
      observed.push(id);
      return id === 'replacement-run' ? 'unknown' : 'completed';
    };
  });
  try {
    const state = ctrl.getSnapshot();
    assert.deepEqual(observed, [runId, 'replacement-run']);
    assert.equal(state.messages.find(row => row.id === question.id)?.agentRunId, 'replacement-run');
    assert.equal(state.remoteReply?.runId, 'replacement-run');
    assert.equal(state.remoteReply?.status, 'unknown');
    assert.equal(state.feedback, null, 'the older run cannot donate its feedback to the replacement');
    assert.equal(state.drafts[childId].phase, 'reply_failed');
  } finally { ctrl.dispose(); }
});
