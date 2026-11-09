import type { MemoryFactView, MemorySummaryView } from "./memory-view-model";
import type { AgentWork } from "../../src/shared/agent-work";
import type { PersonalLibraryItem } from "../../src/shared/personal-library";
import type { HistoryMessageRead } from "./history-view-model";

// Frontend read projections, not new HTTP contracts or separate memory databases.
// The host supplies snapshots from the same authorized domain owners used by Agent and history.
export type MemoryReadProjection<T> = {
  readonly scopeKey: string;
  readonly asOf: string | null;
} & ({ readonly state: "ready" | "stale"; readonly revision: string; readonly data: T }
  | { readonly state: "loading" | "unavailable" | "error"; readonly revision: null; readonly data: null });

export interface ShortTermContextView {
  readonly runId?: string;
  readonly works?: readonly AgentWork[];
  readonly hasMoreWorks?: boolean;
  readonly messageRead?: MemoryReadProjection<HistoryMessageRead>;
  // Persistent work and its linked original messages; never claims to expose internal model context.
  readonly messages: readonly { readonly id: string; readonly role: "user" | "assistant"; readonly text: string }[];
}
export interface LongTermMemoryView {
  readonly childId: string;
  readonly facts: readonly Readonly<MemoryFactView>[];
  readonly hasMoreFacts: boolean;
  readonly summary: Readonly<MemorySummaryView> | null;
  readonly histories: Readonly<Record<string, {
    readonly factVersion: number;
    readonly state: "ready" | "loading" | "unavailable" | "error";
    readonly items: readonly Readonly<MemoryFactView>[];
    readonly hasMore: boolean;
  }>>;
}

// Field names retain KnowledgeEvidence metadata from src/shared/knowledge.ts at 65f8cf3.
// Publisher identity, editorial review and freshness are separate; none proves a claim true.
export interface KnowledgeReferenceView {
  readonly sourceId: string; readonly versionId: string; readonly chunkId: string;
  readonly versionHash: string; readonly contentHash: string;
  readonly title: string; readonly publisher: string; readonly url: string;
  readonly classification: "official_guidance" | "recent_information";
  readonly section: string; readonly sourceExcerpt: string;
  readonly sourcePublishedAt: string | null; readonly sourceUpdatedAt: string | null;
  readonly sourceDateText?: string | null; readonly validUntil?: string | null;
  readonly fetchedAt: string; readonly checkedAt: string; readonly lastSuccessfulCheckAt?: string | null;
  readonly usageScope?: "public_noncommercial" | "internal_noncommercial";
  readonly reviewState: "reviewed";
  readonly applicability: {
    readonly region: string; readonly ageBasis: "actual" | "corrected" | "any";
    readonly minAgeMonths: number | null; readonly maxAgeMonths: number | null;
    readonly maxAgeMonthsExclusive?: boolean;
    readonly topics: readonly string[]; readonly conditions: readonly string[];
  };
}
export interface KnowledgeReferencesView {
  readonly audience: "public" | "internal";
  readonly items: readonly KnowledgeReferenceView[];
  readonly catalog?: readonly PersonalLibraryItem[];
  readonly hasMore: boolean;
}
export interface MemoryReferenceModel {
  readonly scopeKey: string;
  readonly childId: string;
  readonly childName: string;
  readonly access: "active" | "revoked";
  readonly online: boolean;
  readonly dataLabel?: string;
  // Required ports: absent live-context or knowledge adapters must say unavailable.
  readonly shortTerm: MemoryReadProjection<ShortTermContextView>;
  readonly longTerm: MemoryReadProjection<LongTermMemoryView>;
  readonly references: MemoryReadProjection<KnowledgeReferencesView>;
}
export interface MemoryReferenceWorkspaceValue {
  readonly scopeKey: string;
  readonly model: MemoryReferenceModel;
  readonly reads?: {
    loadMoreFacts?(): void;
    readFactHistory?(factId: string, expectedVersion: number): void;
    loadMoreFactHistory?(factId: string, expectedVersion: number): void;
    loadMoreReferences?(): void;
    loadMoreWork?(): void;
    readWorkMessage?(id: string): void;
    loadMoreWorkMessage?(): void;
    closeWorkMessage?(): void;
    refreshContext?(): void;
    readonly workBusy?: boolean;
    readonly messageBusy?: boolean;
    readonly referencesBusy?: boolean;
  };
}

export interface MemoryConfirmerDisplay {
  readonly scopeKey: string;
  readonly childId: string;
  readonly userId: string;
  readonly members: readonly { readonly userId: string; readonly name: string }[];
}

export function memoryConfirmerLabel(confirmedBy: string | null, display?: MemoryConfirmerDisplay): string {
  if (confirmedBy === null) return "尚未確認";
  if (display?.userId === confirmedBy) return "你";
  return display?.members.find(member => member.userId === confirmedBy)?.name?.trim() || "名稱未提供";
}

export function memoryReferenceScopeMatches(scopeKey: string, value: MemoryReferenceWorkspaceValue | null): value is MemoryReferenceWorkspaceValue {
  if (!value || !scopeKey || value.scopeKey !== scopeKey || value.model.scopeKey !== scopeKey || value.model.access !== "active") return false;
  const { shortTerm, longTerm, references, childId } = value.model;
  return !!childId && [shortTerm, longTerm, references].every(read => read.scopeKey === scopeKey)
    && (!longTerm.data || longTerm.data.childId === childId);
}
export function visibleMemoryFacts(model: MemoryReferenceModel): readonly Readonly<MemoryFactView>[] {
  return model.longTerm.data?.facts.filter(fact => fact.childId === model.childId) ?? [];
}
export function visibleMemoryHistory(model: MemoryReferenceModel, fact: Readonly<MemoryFactView>): readonly Readonly<MemoryFactView>[] {
  const history = model.longTerm.data?.histories[fact.id];
  if (history?.state !== "ready" || history.factVersion !== fact.version) return [];
  return history.items.filter(item => item.id === fact.id && item.childId === model.childId && item.version <= fact.version);
}
export function visibleKnowledgeReferences(read: MemoryReadProjection<KnowledgeReferencesView>): readonly KnowledgeReferenceView[] {
  return read.data?.items.filter(item => item.usageScope === "public_noncommercial"
    || read.data?.audience === "internal" && item.usageScope === "internal_noncommercial") ?? [];
}
export function memoryDateLabel(value: string | null | undefined): string {
  if (!value) return "未提供";
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) || !Number.isFinite(Date.parse(value))) return value;
  return `${new Date(value).toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })}`;
}
export function memoryClarificationQuestion(childName: string, fact: Readonly<MemoryFactView>): string {
  return `我想核對${childName}的記憶「${fact.key}」：${fact.content}\n請先與我釐清疑問，並對照原來源及版本 ${fact.version}；不要直接更改記憶。`;
}
