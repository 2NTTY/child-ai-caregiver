import type { ChildProfile } from "./care.ts";
import type { ChatMessage } from "./chat.ts";
import type { ImportProvenance } from "./import-provenance.ts";

export type MemoryVisibility = "private" | "family";
export type FactStatus = "candidate" | "confirmed" | "inactive";
export type LocalFactSource = { kind: "manual"; description: string }
  | { kind: "care_record"; description: string; recordId: string; version: number }
  | { kind: "private_chat"; description: string; messageId?: string };
export type FactSource = LocalFactSource | { kind: "imported"; description: string;
  original: LocalFactSource; sourceState: "current" | "changed" };
export interface FactValues { key: string; content: string; source: FactSource; validUntil: string | null }
export interface MemoryFact extends FactValues {
  id: string; childId: string; visibility: MemoryVisibility; intendedVisibility: MemoryVisibility;
  status: FactStatus; version: number; createdBy: string; confirmedBy: string | null; confirmedAt: string | null;
  reason: string; applicable: boolean; sourceState: "current" | "changed";
  importedFrom?: ImportProvenance; confirmationBasis?: "imported_source";
}
export type TopicStatus = "pending" | "answered" | "snoozed" | "resolved";
export interface MemoryTopic {
  id: string; childId: string; visibility: MemoryVisibility; title: string; note: string;
  status: TopicStatus; version: number; updatedBy: string; updatedAt: string;
  resumeAfter: string | null; reopenReason: string | null; reopenedFrom: string | null; mayAsk: boolean;
  importedFrom?: ImportProvenance;
}
export interface MemoryPage<T> { items: T[]; nextAfterId: string | null }
export interface FactCreate { values: FactValues; intendedVisibility: MemoryVisibility }
export interface SharedFactCreate extends FactCreate { intendedVisibility: 'family'; confirm: true; confirmShared: true }
export interface FactConfirm { expectedVersion: number; confirm: true; confirmShared: boolean }
export interface FactRevise extends FactConfirm { values: FactValues; reason: string }
export interface MemoryDelete { expectedVersion: number; confirmDelete: true }
export interface FactDeactivate { expectedVersion: number; reason: string }
export interface TopicCreate { title: string; note: string; visibility: MemoryVisibility; confirmShared: boolean }
export interface TopicChange { expectedVersion: number; status: TopicStatus; note: string; resumeAfter: string | null }
export interface TopicReopen { expectedVersion: number; reason: string }
export interface ConversationSummary {
  id: string; childId: string; version: number; text: string; createdAt: string;
  previousId: string | null; coveredMessageIds: string[]; lastCoveredMessageId: string;
  /** Imported history keeps source message IDs; it never advances local summary coverage. */
  coverageScope?: 'imported_source'; importedFrom?: ImportProvenance;
}
export interface SummaryInput { previous: ConversationSummary | null; previousVersion: number; basis: string; messages: ChatMessage[]; moreUncovered: boolean; summaryMode?: "isolated_batch"; repairOf?: string; currentSources?: unknown[]; unavailableReason?: "fact_metadata_pending" | "message_requires_continuation" }
export interface MemoryView {
  profile: ChildProfile; facts: MemoryFact[]; topics: MemoryTopic[]; summary: ConversationSummary | null;
}
export interface MemoryContext extends MemoryView {
  recentMessages: ChatMessage[]; truncated: { facts: boolean; topics: boolean; messages: boolean };
  conflictingKeys: string[];
  profileApplicable: boolean;
  unavailableFactKeys: string[];
  nextFactsAfterId?: string | null; nextTopicsAfterId?: string | null; summaryUnavailable?: "fact_metadata_pending" | "message_requires_continuation" | null;
}
