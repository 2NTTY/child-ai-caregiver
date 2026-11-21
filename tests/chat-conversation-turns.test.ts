import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatMessage } from '../src/shared/chat.ts';
import { conversationTurns } from '../frontend/src/components/chat/conversation-turns.ts';

function row(id: string, changes: Partial<ChatMessage> = {}): ChatMessage {
  return { id, role: 'user', text: 'A question', authorUserId: 'parent', childId: 'child',
    inReplyTo: null, createdAt: '2026-11-21T00:00:00Z', ...changes };
}
const question = row('question');
const answer = row('answer', { role: 'model', inReplyTo: question.id });
const discussion = row('discussion', { text: '討論這個回答。', discussionOf: answer.id, discussion: true });
const summary = row('summary', { role: 'model', inReplyTo: discussion.id });

test('renders a saved discussion under its answer and preserves a parent who types the same words', () => {
  const ordinary = row('ordinary', { text: discussion.text });
  const result = conversationTurns([question, answer, discussion, summary, ordinary]);
  assert.deepEqual(result.rows, [question, answer, ordinary]);
  assert.deepEqual(result.discussions.get(answer.id), { question: discussion, reply: summary });
});

test('keeps a discussion readable before pagination brings in the original answer', () => {
  const first = conversationTurns([discussion, summary]);
  assert.deepEqual(first.rows, [discussion]);
  assert.equal(first.discussions.get(discussion.id)?.reply, summary);
  const pending = conversationTurns([answer, discussion]);
  assert.deepEqual(pending.rows, [answer]);
  assert.deepEqual(pending.discussions.get(answer.id), { question: discussion });
});
