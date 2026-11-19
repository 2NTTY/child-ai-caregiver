import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatController } from '../src/client/chat-controller.ts';
import type { ChatApi } from '../src/client/chat-api.ts';
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

async function failedTurn() {
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
  await ctrl.send();
  const feedback = ctrl.getSnapshot().feedback;
  assert.deepEqual(feedback?.cards, ['emergency-hk-v1']);
  assert.equal(feedback?.sources[0]?.chunkId, 'source-chunk');
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
