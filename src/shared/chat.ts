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
