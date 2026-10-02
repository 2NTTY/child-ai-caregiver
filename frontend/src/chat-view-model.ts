// Display projections only. Formal source payloads remain owned by the existing APIs.
export interface ChatCitationView {
  id: string; title: string; section: string; publisher: string; excerpt: string;
  classification: "official_guidance" | "recent_information" | "synthetic";
  versionId: string; versionHash: string; checkedAt: string; fetchedAt: string;
  lastSuccessfulCheckAt: string | null; sourceDate: string | null; validUntil: string | null;
  applicabilityLabel: string; internalOnly: boolean; url: string | null;
}

export type ChatReplyPhase = "thinking" | "streaming" | "complete" | "stopped" | "failed" | "unknown" | "awaiting_confirmation";
export interface ChatActivityView {
  id: string; label: string; state: "running" | "succeeded" | "failed" | "unknown" | "pending";
  summary?: string;
}
// Public display summaries only; no provider reasoning, raw tool arguments or transport events.
export interface ChatMessageView {
  id: string; role: "user" | "assistant"; text: string;
  phase?: ChatReplyPhase; note?: string; activities?: readonly ChatActivityView[];
  sources?: readonly ChatCitationView[];
}
