import { agentStopMessage } from '../../../../src/shared/agent-stop-message';
import { CHAT_DELIVERY_REVIEW_INCOMPLETE_TEXT } from '../../../../src/shared/chat-delivery-review';
import { DATA_COMPOSE_REVIEW_INCOMPLETE_TEXT } from '../../../../src/shared/data-compose';

// These paragraphs were saved by the reply API. Preserve any accompanying
// confirmation question or operation result when displaying older messages.
const placeholders = new Set([
  CHAT_DELIVERY_REVIEW_INCOMPLETE_TEXT, DATA_COMPOSE_REVIEW_INCOMPLETE_TEXT,
  'Agent 暫未能完成回覆；原訊息仍已保存。請查看運行狀態及未完成事項。',
  'Agent 未完成文字回覆，但已保存待你核對的候選；尚未確認的事項不代表已執行。請查看來源與待確認事項。',
  '這次 Agent 運行中斷，結果未知；沒有自動重新執行。請查核原運行結果。',
]);

const reasons = new Map([
  [agentStopMessage('delivery_review_incomplete'), '回覆核對未完成'],
  [agentStopMessage('delivery_review_no_sources'), '找不到足夠資料核對這個回答'],
  [agentStopMessage('delivery_review_rejected'), '回覆未通過核對'],
  [agentStopMessage('delivery_review_budget'), '本次模型用量已用盡，未能完成核對'],
  [agentStopMessage('invalid_response'), '模型沒有交回有效答案'],
]);

export function compactStopReason(label: string) {
  return reasons.get(label) ?? label;
}

export function failedReplyContent(text: string) {
  return text.split('\n\n').filter(paragraph => !placeholders.has(paragraph)).join('\n\n');
}

export function failedChatReply(text: string, runLabel?: string | null) {
  const saved = /^這次回覆未完成：([^\n]+)。(?:\n\n|$)/u.exec(text);
  const reason = runLabel ?? saved?.[1];
  if (!reason) return null;
  return { reason: compactStopReason(reason), body: failedReplyContent(saved ? text.slice(saved[0].length) : text) };
}
