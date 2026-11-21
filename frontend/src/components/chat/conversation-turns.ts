import type { ChatMessage } from '../../../../src/shared/chat';

type Discussion = { question: ChatMessage; reply?: ChatMessage };

// A discussion created from an answer is rendered with that answer. If pagination has
// not reached the original yet, its saved discussion question remains a standalone section.
export function conversationTurns(messages: readonly ChatMessage[]) {
  const ids = new Set(messages.map(m => m.id));
  const discussions = new Map<string, Discussion>();
  const owners = new Map<string, Discussion>();
  for (const question of messages) {
    if (!question.discussionOf) continue;
    const discussion = { question };
    discussions.set(ids.has(question.discussionOf) ? question.discussionOf : question.id, discussion);
    owners.set(question.id, discussion);
  }
  const rows = messages.filter(message => {
    if (message.discussionOf) return !ids.has(message.discussionOf);
    const discussion = message.inReplyTo && owners.get(message.inReplyTo);
    if (!discussion) return true;
    discussion.reply = message;
    return false;
  });
  return { rows, discussions };
}
