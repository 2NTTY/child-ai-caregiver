export interface ChatMessage {
  id: string;
  childId: string;
  authorUserId: string | null;
  role: "user" | "model";
  text: string;
  inReplyTo: string | null;
  createdAt: string;
}
export interface ChatPage {
  messages: ChatMessage[];
  limit: number;
}