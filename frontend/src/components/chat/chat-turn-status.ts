import { CHAT_REPLY_ERROR_COPY, type ChatDraft, type ChatState } from '../../../../src/client/chat-controller.ts';
import { AGENT_PROGRESS_LABELS } from '../../../../src/shared/agent-feedback.ts';

const replyNotices = new Map<string, string>([
  [CHAT_REPLY_ERROR_COPY.ai_disabled, 'AI 暫未開放，可稍後要求回覆。'],
  [CHAT_REPLY_ERROR_COPY.ai_busy, '助手忙碌，請稍後再試。'],
  [CHAT_REPLY_ERROR_COPY.ai_quota_exceeded, '今日 AI 用量已達上限。'],
  [CHAT_REPLY_ERROR_COPY.ai_timeout, '等候回覆逾時，可重試原訊息。'],
  [CHAT_REPLY_ERROR_COPY.ai_unavailable, '暫時無法回覆，可稍後再試。'],
  [CHAT_REPLY_ERROR_COPY.unknown, '回覆結果未確認，請查核原訊息。'],
]);

export function chatReplyActivity(chat: ChatState) {
  const remote = chat.remoteReply;
  const remoteRunning = remote?.status === 'running' &&
    !chat.messages.some(message => message.role === 'model' && message.inReplyTo === remote.messageId);
  const activeReplyId = chat.replyingMessageId ?? (remoteRunning ? remote.messageId : null);
  return {
    activeReplyId,
    replyRunning: chat.busy === 'reply' || remoteRunning,
    stopPending: chat.cancelling || !!activeReplyId && chat.cancelAcceptedFor === activeReplyId,
  };
}

export type TurnStatus = { kind: 'progress' | 'notice'; text: string };
type DisplayedFailure = { questionId: string; reason: string };

export function privateChatChildName(children: readonly { id: string; displayName: string }[], childId: string | undefined, explicitlyChosen = false) {
  if (children.length < 2 && !explicitlyChosen) return undefined;
  return children.find(child => child.id === childId)?.displayName;
}

export function chatTurnStatus(chat: ChatState, draft: ChatDraft | undefined, activity: ReturnType<typeof chatReplyActivity>,
  displayedFailure?: DisplayedFailure, showFeedback = true): TurnStatus | null {
  const { activeReplyId, replyRunning, stopPending } = activity;
  const progress = (text: string): TurnStatus => ({ kind: 'progress', text });
  const notice = (text: string): TurnStatus => ({ kind: 'notice', text: replyNotices.get(text) ?? text });
  if (draft?.notice && (draft.phase === 'checked' || draft.phase === 'save_unknown')) return notice(draft.notice);
  if (chat.busy === 'save') return null;
  if (replyRunning && chat.cancelNotice) return notice(chat.cancelNotice);
  if (replyRunning && stopPending) return progress('正在停止…');

  // A saved failure is already visible on its own message. Keep other errors actionable.
  const sameFailure = displayedFailure && (!chat.remoteReply || chat.remoteReply.messageId === displayedFailure.questionId)
    && (!chat.feedback || chat.feedback.messageId === displayedFailure.questionId)
    && (!activeReplyId || activeReplyId === displayedFailure.questionId);
  const replyError = chat.replyError;
  if (replyError && !(sameFailure && (replyError.startsWith('這次回覆未完成，') || replyError === displayedFailure.reason))) {
    return notice(replyError);
  }
  if (replyRunning) {
    const feedback = showFeedback && activeReplyId && chat.feedback?.messageId === activeReplyId ? chat.feedback : null;
    return progress(feedback && feedback.phase !== 'started' && feedback.phase !== 'model'
      ? AGENT_PROGRESS_LABELS[feedback.phase] : '正在回覆…');
  }
  if (draft?.notice && (draft.phase === 'draft' && draft.text.trim() ||
    draft.phase === 'reply_failed' && !(displayedFailure && draft.savedUserMessageId === displayedFailure.questionId))) {
    return notice(draft.notice);
  }
  return chat.cancelNotice ? notice(chat.cancelNotice) : null;
}
