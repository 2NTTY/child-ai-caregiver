import type { ChatFileMessageReference } from './chat-files.ts';
import type { PhotoMessageReference } from './photos.ts';
import type { VoiceMessageReference } from './voice.ts';
import type { OfficialHelpId } from './agent-feedback.ts';
export const chatModes = ["assistant", "chat_only"] as const;
export type ChatMode = (typeof chatModes)[number];

export function isChatMode(value: unknown): value is ChatMode {
  return value === "assistant" || value === "chat_only";
}

export function resolveChatMode(mode?: ChatMode | null): ChatMode {
  return mode === "chat_only" ? "chat_only" : "assistant";
}

export const CHAT_MODE_COPY = {
  assistantLabel: "助手",
  chatOnlyLabel: "只是聊天",
  chatOnlyBanner: "目前為「只是聊天」：保留主聊天上下文與搜尋問答，不建立正式記錄、待辦、檔案或待確認卡片。",
  switchToAssistantLabel: "切換回助手模式",
  inflightAssistantToChatOnlyNotice: "已切換為「只是聊天」（後續新訊息生效）。先前在助手模式已發出的處理仍在運行，不會假稱已撤回；如需中止請按「停止回覆」並核對原結果。",
  inflightChatOnlyToAssistantNotice: "已切換為「助手」（後續新訊息生效）。先前在「只是聊天」發出的回覆仍按原模式完成，不會自動補做操作。",
} as const;

export interface ChatSendOptions {
  discussion?: true;
  pageContext?: import('./chat-page-context.ts').ChatPageContext;
  chatMode?: ChatMode;
}

export interface ChatMessage {
  id: string;
  childId: string;
  authorUserId: string | null;
  role: "user" | "model";
  text: string;
  inReplyTo: string | null;
  /** Origin mode recorded when the turn was created; absent defaults to "assistant". */
  chatMode?: ChatMode;
  discussion?: true;
  /** A discussion explicitly requested after this model message was delivered. */
  discussionOf?: string;
  /** A server-initiated message in the existing private conversation. */
  proactive?: true;
  /** Display-only projection from the authenticated proactive receipt. */
  proactiveUnread?: boolean;
  createdAt: string;
  agentRunId?: string;
  officialHelp?: OfficialHelpId[];
  pageContext?: import('./chat-page-context.ts').ChatPageContext;
  voice?: VoiceMessageReference;
  file?: ChatFileMessageReference;
  photo?: PhotoMessageReference;
}
export interface ChatPage {
  messages: ChatMessage[];
  limit: number;
  nextCursor?: string | null;
}

/** Read-only projection of the original run; never permission to start or repeat it. */
export interface ChatReplyState {
  messageId: string;
  runId: string;
  status: "running" | "completed" | "stopped" | "unknown";
  stopReason: string | null;
}
