import type { ChatFileMessageReference } from './chat-files.ts';
import type { PhotoMessageReference } from './photos.ts';
import type { VoiceMessageReference } from './voice.ts';
import type { OfficialHelpId } from './agent-feedback.ts';
export interface ChatSendOptions {
  discussion?: true;
  pageContext?: import('./chat-page-context.ts').ChatPageContext;
}

export interface ChatMessage {
  id: string;
  childId: string;
  authorUserId: string | null;
  role: "user" | "model";
  text: string;
  inReplyTo: string | null;
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
