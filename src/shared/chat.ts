import type { OfficialHelpId } from './agent-feedback.ts';
export interface ChatMessage {
  id: string;
  childId: string;
  authorUserId: string | null;
  role: "user" | "model";
  text: string;
  inReplyTo: string | null;
  createdAt: string;
  agentRunId?: string;
  officialHelp?: OfficialHelpId[];
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
