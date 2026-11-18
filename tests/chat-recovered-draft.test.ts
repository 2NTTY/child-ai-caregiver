import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ChatController } from '../src/client/chat-controller.ts';
import { ChatApiError, type ChatApi } from '../src/client/chat-api.ts';
import type { ChatMessage } from '../src/shared/chat.ts';

async function fixture(recovered: 'matching' | 'missing' | 'unrelated') {
  const userId = 'synthetic-owner';
  const childId = randomUUID(), messageId = randomUUID(), runId = randomUUID();
  const message: ChatMessage = { id: messageId, childId, authorUserId: userId, role: 'user', text: '第一個問題', inReplyTo: null, createdAt: '2026-11-18T00:00:00Z' };
  const reply: ChatMessage = { id: randomUUID(), childId, authorUserId: null, role: 'model', text: '已保存的答案', inReplyTo: recovered === 'unrelated' ? randomUUID() : messageId, agentRunId: runId, createdAt: '2026-11-18T00:00:01Z' };
  let recovery = false, recoveryLists = 0, saves = 0, requests = 0;
  const api: ChatApi = {
    getSession: async () => ({ id: userId, name: 'Synthetic', email: 'synthetic@example.test' }),
    getStatus: async () => true,
    getUsage: async () => ({ day: '2026-11-18', attempts: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, unknownUsageAttempts: 0 }),
    listMessages: async () => ({ messages: recovery ? (++recoveryLists === 1 || recovered === 'missing' ? [message] : [message, reply]) : [], nextCursor: null, limit: 30 }),
    saveMessage: async (_child, text) => { saves++; return { ...message, id: saves === 1 ? messageId : randomUUID(), text }; },
    requestReply: async (_child, id) => {
      requests++;
      if (requests === 1) throw new ChatApiError(0);
      return { ...reply, id: randomUUID(), inReplyTo: id };
    },
    getOriginalReply: async () => recovery ? { messageId, runId, status: 'completed', stopReason: null } : null,
  };
  const controller = new ChatController(api);
  const loaded = new Promise<void>(resolve => {
    const unsubscribe = controller.subscribe(() => {
      if (controller.getSnapshot().loadedAt && !controller.getSnapshot().loading) { unsubscribe(); resolve(); }
    });
  });
  controller.syncContext(userId, true, childId);
  await loaded;
  controller.setText(message.text);
  await controller.send();
  assert.equal(controller.getSnapshot().drafts[childId].phase, 'reply_failed');
  recovery = true;
  await controller.reloadMessages();
  return { controller, childId, messageId, reply, calls: () => ({ saves, requests, recoveryLists }) };
}

test('second reload page matching saved reply clears failed draft and permits a new send without replaying the old request', async t => {
  const { controller, childId, messageId, reply, calls } = await fixture('matching');
  t.after(() => controller.dispose());
  assert.deepEqual(calls(), { saves: 1, requests: 1, recoveryLists: 2 });
  const state = controller.getSnapshot();
  assert.ok(state.messages.some(item => item.id === reply.id && item.inReplyTo === messageId));
  assert.equal(state.remoteReply, null);
  assert.equal(state.replyError, null);
  assert.equal(state.drafts[childId].phase, 'draft');
  assert.equal(state.drafts[childId].savedUserMessageId, null);
  assert.equal(state.drafts[childId].text, '');
  controller.setText('第二個問題');
  assert.equal(controller.getSnapshot().drafts[childId].text, '第二個問題');
  await controller.send();
  assert.equal(calls().saves, 2);
  assert.equal(calls().requests, 2);
});

for (const result of ['missing', 'unrelated'] as const) {
  test(`completed original run with ${result} reply does not clear the saved failed draft`, async t => {
    const { controller, childId, messageId, calls } = await fixture(result);
    t.after(() => controller.dispose());
    assert.deepEqual(calls(), { saves: 1, requests: 1, recoveryLists: 2 });
    assert.equal(controller.getSnapshot().drafts[childId].phase, 'reply_failed');
    assert.equal(controller.getSnapshot().drafts[childId].savedUserMessageId, messageId);
    assert.equal(controller.getSnapshot().drafts[childId].text, '第一個問題');
  });
}
