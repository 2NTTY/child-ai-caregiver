import { z } from "zod";
import type { FactSource, LocalFactSource, MemoryFact, MemoryTopic } from "../../src/shared/memory";

// Presentation-only data and local preview actions. These are not HTTP contracts.
export type MemoryRole = "owner" | "caregiver" | "viewer";
export type MemoryVisibility = "private" | "family";
export type FactStatus = "candidate" | "confirmed" | "inactive";
export type TopicStatus = "pending" | "answered" | "snoozed" | "resolved";
export type FactSourceView = FactSource;
export interface MemoryFactView {
  id: string; childId: string; key: string; content: string; source: FactSourceView;
  validUntil: string | null; visibility: MemoryVisibility; intendedVisibility: MemoryVisibility;
  status: FactStatus; version: number; authorSelf: boolean; reason: string;
  applicable: boolean; confirmedBy: string | null; confirmedAt: string | null; sourceState: "current" | "changed";
  importedFrom?: MemoryFact["importedFrom"]; confirmationBasis?: MemoryFact["confirmationBasis"];
}
export interface MemoryTopicView {
  id: string; childId: string; title: string; note: string; visibility: MemoryVisibility;
  status: TopicStatus; mayAsk: boolean; version: number; authorSelf: boolean; updatedAt: string;
  resumeAfter: string | null; reopenReason: string | null; reopenedFrom: string | null;
  importedFrom?: MemoryTopic["importedFrom"];
}
export interface MemorySummaryView {
  id: string; version: number; text: string; createdAt: string; previousId: string | null;
  coveredMessageIds: string[]; lastCoveredMessageId: string;
}
export interface MemorySourceChoice {
  id: string; label: string; kind: LocalFactSource["kind"]; current: boolean;
  recordId?: string; version?: number; messageId?: string;
}
export interface MemoryPreviewData {
  facts: MemoryFactView[]; topics: MemoryTopicView[]; summary: MemorySummaryView | null;
  factVersions: Record<string, MemoryFactView[]>; topicVersions: Record<string, MemoryTopicView[]>;
}
export interface FactDraft {
  key: string; content: string; sourceChoice: string; sourceDescription: string;
  validUntil: string; intendedVisibility: MemoryVisibility; reason: string;
}
export interface TopicDraft {
  title: string; note: string; visibility: MemoryVisibility; status: TopicStatus;
  resumeAfter: string; reason: string;
}
export type FactEditorMode = "create" | "revise" | "confirm" | "deactivate" | "delete";
export type TopicEditorMode = "create" | "change" | "reopen" | "delete";
export type MemoryEditor = { kind: "fact"; mode: FactEditorMode; basis: MemoryFactView | null }
  | { kind: "topic"; mode: TopicEditorMode; basis: MemoryTopicView | null };
export type MemoryPreviewWrite =
  | { kind: "create_fact"; draft: FactDraft }
  | { kind: "revise_fact"; basis: MemoryFactView; draft: FactDraft; sharedConfirmed: boolean }
  | { kind: "confirm_fact"; basis: MemoryFactView; sharedConfirmed: boolean }
  | { kind: "deactivate_fact"; basis: MemoryFactView; reason: string }
  | { kind: "delete_fact"; basis: MemoryFactView }
  | { kind: "create_topic"; draft: TopicDraft; sharedConfirmed: boolean }
  | { kind: "change_topic"; basis: MemoryTopicView; draft: TopicDraft }
  | { kind: "reopen_topic"; basis: MemoryTopicView; reason: string }
  | { kind: "delete_topic"; basis: MemoryTopicView };
export interface MemoryPreviewWriteContext {
  childId: string; role: MemoryRole; actorId: string; sources: MemorySourceChoice[]; nextId: string; now: number;
}

export const factStatusLabels: Record<FactStatus, string> = { candidate: "待確認候選", confirmed: "已確認", inactive: "已停用" };
export const topicStatusLabels: Record<TopicStatus, string> = { pending: "待處理", answered: "已回答", snoozed: "已暫緩", resolved: "已解決" };
export const visibilityLabels: Record<MemoryVisibility, string> = { private: "本人", family: "家庭共享" };
export const roleLabels: Record<MemoryRole, string> = { owner: "家庭擁有人", caregiver: "照顧者", viewer: "唯讀成員" };
export const isTerminalTopic = (topic: Pick<MemoryTopicView, "status">) => topic.status === "answered" || topic.status === "resolved";
export function canManageMemory(role: MemoryRole, item: { visibility: MemoryVisibility; authorSelf: boolean }) {
  return item.visibility === "private" ? item.authorSelf : role !== "viewer";
}
export function factIsApplicable(fact: MemoryFactView) {
  return fact.applicable;
}
export function topicMayAsk(topic: MemoryTopicView) {
  return topic.mayAsk;
}
export function factUnavailableReason(fact: MemoryFactView) {
  if (fact.applicable) return "目前適用";
  if (fact.status === "candidate") return "候選未確認，不能作為適用事實";
  if (fact.status === "inactive") return "已停用，重新核對及確認前不適用";
  if (fact.sourceState === "changed") return "來源版本已更改，須先更正及重新核對";
  return "目前不適用；請核對 Server 的最新狀態及有效期";
}
export function factConfirmationLabel(fact: MemoryFactView) {
  if (!fact.confirmedBy && !fact.confirmedAt) return "尚未確認";
  return `確認者：${fact.confirmedBy ?? "未提供"} · 確認時間：${fact.confirmedAt ?? "未提供"}`;
}
export function factSourceLabel(source: FactSourceView): string {
  if (source.kind === "imported") return `匯入資料包：${source.description.trim() ? source.description : "未提供"} · 原來源 ${factSourceLabel(source.original)}`;
  const kind = source.kind === "manual" ? "手動描述" : source.kind === "care_record" ? "照顧記錄" : "私人聊天";
  return `${kind}：${source.description.trim() ? source.description : "未提供"}${source.kind === "care_record" ? ` · 來源版本 ${source.version}` : ""}`;
}

const requiredText = (max: number) => z.string().max(max, `最多 ${max} 字元`).refine(value => !!value.trim(), "請填寫內容");
const validDate = (value: string) => z.iso.datetime({ offset: true }).safeParse(value).success;
export function factDraftSchema(sources: MemorySourceChoice[], needsReason: boolean) {
  return z.object({ key: requiredText(100), content: requiredText(4000), sourceDescription: requiredText(500),
    sourceChoice: z.string(), validUntil: z.string(), intendedVisibility: z.enum(["private", "family"]), reason: z.string().max(500, "最多 500 字元")
  }).superRefine((draft, ctx) => {
    const source = sources.find(item => item.id === draft.sourceChoice);
    if (!source || !source.current) ctx.addIssue({ code: "custom", path: ["sourceChoice"], message: "請選擇目前可用的來源版本" });
    if (draft.validUntil && !validDate(draft.validUntil)) ctx.addIssue({ code: "custom", path: ["validUntil"], message: "請使用包含時區的 ISO 日期時間" });
    if (needsReason && !draft.reason.trim()) ctx.addIssue({ code: "custom", path: ["reason"], message: "請填寫更正原因" });
  });
}
export function topicDraftSchema(mode: TopicEditorMode, now = Date.now()) {
  return z.object({ title: requiredText(200), note: z.string().max(2000, "最多 2000 字元"), visibility: z.enum(["private", "family"]),
    status: z.enum(["pending", "answered", "snoozed", "resolved"]), resumeAfter: z.string(), reason: z.string().max(500, "最多 500 字元")
  }).superRefine((draft, ctx) => {
    if (mode === "change" && draft.status === "snoozed" && (!validDate(draft.resumeAfter) || Date.parse(draft.resumeAfter) <= now))
      ctx.addIssue({ code: "custom", path: ["resumeAfter"], message: "暫緩日期須為包含時區的未來時間" });
    if (mode === "reopen" && !draft.reason.trim()) ctx.addIssue({ code: "custom", path: ["reason"], message: "請填寫重開原因" });
  });
}
export function factDraftFrom(fact: MemoryFactView | null, sources: MemorySourceChoice[]): FactDraft {
  const choice = fact ? sources.find(item => item.kind === fact.source.kind && (fact.source.kind === "manual"
    || fact.source.kind === "care_record" && item.recordId === fact.source.recordId && item.version === fact.source.version
    || fact.source.kind === "private_chat" && !!fact.source.messageId && item.messageId === fact.source.messageId)) : null;
  return { key: fact?.key ?? "", content: fact?.content ?? "", sourceChoice: fact ? choice?.id ?? "unavailable" : "manual",
    sourceDescription: fact?.source.description ?? "", validUntil: fact?.validUntil ?? "", intendedVisibility: fact?.intendedVisibility ?? "private", reason: "" };
}
export function topicDraftFrom(topic: MemoryTopicView | null): TopicDraft {
  return { title: topic?.title ?? "", note: topic?.note ?? "", visibility: topic?.visibility ?? "private", status: topic?.status ?? "pending",
    resumeAfter: topic?.resumeAfter ?? "", reason: "" };
}
export function sourceFromDraft(draft: FactDraft, sources: MemorySourceChoice[]): FactSourceView {
  const choice = sources.find(item => item.id === draft.sourceChoice);
  if (!choice?.current) throw new Error("請重新選擇目前可用的資料來源。");
  if (choice.kind === "care_record" && choice.recordId && choice.version) return { kind: "care_record", recordId: choice.recordId, version: choice.version, description: draft.sourceDescription };
  if (choice.kind === "private_chat" && choice.messageId) return { kind: "private_chat", messageId: choice.messageId, description: draft.sourceDescription };
  if (choice.kind === "manual") return { kind: "manual", description: draft.sourceDescription };
  throw new Error("這個來源參照不可提交；請明確改用手動描述。");
}

function previewFactApplicable(fact: MemoryFactView, now: number) {
  return fact.status === "confirmed" && fact.sourceState === "current" && (!fact.validUntil || Date.parse(fact.validUntil) > now);
}
function previewTopicMayAsk(topic: MemoryTopicView, now: number) {
  return topic.status === "pending" || topic.status === "snoozed" && !!topic.resumeAfter && Date.parse(topic.resumeAfter) <= now;
}

// Only simulates the established memory lifecycle in this mounted preview.
export function applyMemoryPreviewWrite(data: MemoryPreviewData, write: MemoryPreviewWrite, context: MemoryPreviewWriteContext): MemoryPreviewData {
  const { role, childId, now } = context;
  const next: MemoryPreviewData = { ...data, facts: [...data.facts], topics: [...data.topics], summary: null,
    factVersions: { ...data.factVersions }, topicVersions: { ...data.topicVersions } };
  const requireShared = (visibility: MemoryVisibility, checked = true) => {
    if (visibility === "family" && (role === "viewer" || !checked)) throw new Error("家庭共享須由有權成員明確核對及確認。");
  };
  const requireBasis = <T extends MemoryFactView | MemoryTopicView>(items: T[], basis: T): T => {
    const current = items.find(item => item.id === basis.id);
    if (!current || current.childId !== childId || current.version !== basis.version) throw new Error("版本已改變，請先比較最新版。");
    if (!canManageMemory(role, current)) throw new Error("目前角色不能修改這項記憶。");
    return current;
  };
  const putFact = (fact: MemoryFactView) => { next.facts = [fact, ...next.facts.filter(item => item.id !== fact.id)]; next.factVersions[fact.id] = [fact, ...(next.factVersions[fact.id] ?? [])]; };
  const putTopic = (topic: MemoryTopicView) => { next.topics = [topic, ...next.topics.filter(item => item.id !== topic.id)]; next.topicVersions[topic.id] = [topic, ...(next.topicVersions[topic.id] ?? [])]; };
  const requireUniqueFact = (id: string, value: string, visibility: MemoryVisibility) => {
    const key = (text: string) => text.normalize("NFKC").trim().toLocaleLowerCase("zh-HK");
    if (data.facts.some(item => item.id !== id && item.status === "confirmed" && item.visibility === visibility && key(item.key) === key(value)))
      throw new Error("同一範圍已有相同欄目的確認事實，請先更正欄目。");
  };
  if (write.kind === "create_fact") {
    const draft = factDraftSchema(context.sources, false).parse(write.draft); requireShared(draft.intendedVisibility);
    putFact({ id: context.nextId, childId, key: draft.key, content: draft.content, source: sourceFromDraft(draft, context.sources),
      validUntil: draft.validUntil || null, visibility: "private", intendedVisibility: draft.intendedVisibility, status: "candidate", version: 1,
      authorSelf: true, reason: "建立私人候選", applicable: false, confirmedBy: null, confirmedAt: null, sourceState: "current" });
  } else if (write.kind.endsWith("_fact") && "basis" in write && "key" in write.basis) {
    const fact = requireBasis(data.facts, write.basis);
    if (write.kind === "delete_fact") { next.facts = next.facts.filter(item => item.id !== fact.id); delete next.factVersions[fact.id]; }
    else if (write.kind === "revise_fact") {
      const draft = factDraftSchema(context.sources, true).parse(write.draft); requireShared(fact.visibility, write.sharedConfirmed);
      if (fact.status === "confirmed") requireUniqueFact(fact.id, draft.key, fact.visibility);
      const revised = { ...fact, key: draft.key, content: draft.content, source: sourceFromDraft(draft, context.sources), validUntil: draft.validUntil || null,
        reason: draft.reason, sourceState: "current" as const, version: fact.version + 1 };
      putFact({ ...revised, applicable: previewFactApplicable(revised, now) });
    } else if (write.kind === "confirm_fact") {
      if (fact.status === "confirmed" || fact.sourceState === "changed" || fact.validUntil && Date.parse(fact.validUntil) <= now) throw new Error("請先更正內容、來源或有效期，再確認這項事實。");
      requireShared(fact.intendedVisibility, write.sharedConfirmed);
      requireUniqueFact(fact.id, fact.key, fact.intendedVisibility);
      putFact({ ...fact, status: "confirmed", visibility: fact.intendedVisibility, applicable: true, confirmedBy: context.actorId,
        confirmedAt: new Date(now).toISOString(), reason: "明確確認事實", version: fact.version + 1 });
    } else if (write.kind === "deactivate_fact") {
      if (!write.reason.trim() || write.reason.length > 500 || fact.status === "inactive") throw new Error("請填寫停用原因並核對目前狀態。");
      putFact({ ...fact, status: "inactive", applicable: false, reason: write.reason, version: fact.version + 1 });
    }
  } else if (write.kind === "create_topic") {
    const draft = topicDraftSchema("create", now).parse(write.draft); requireShared(draft.visibility, write.sharedConfirmed);
    putTopic({ id: context.nextId, childId, title: draft.title, note: draft.note, visibility: draft.visibility, status: "pending", version: 1,
      mayAsk: true, authorSelf: true, updatedAt: new Date(now).toISOString(), resumeAfter: null, reopenedFrom: null, reopenReason: null });
  } else if ("basis" in write && "title" in write.basis) {
    const topic = requireBasis(data.topics, write.basis);
    if (write.kind === "delete_topic") { next.topics = next.topics.filter(item => item.id !== topic.id); delete next.topicVersions[topic.id]; }
    else if (write.kind === "change_topic") {
      if (isTerminalTopic(topic)) throw new Error("已回答或已解決話題須按原因重開；原終態保留。");
      const draft = topicDraftSchema("change", now).parse(write.draft);
      const changed = { ...topic, status: draft.status, note: draft.note, resumeAfter: draft.status === "snoozed" ? draft.resumeAfter : null,
        version: topic.version + 1, updatedAt: new Date(now).toISOString() };
      putTopic({ ...changed, mayAsk: previewTopicMayAsk(changed, now) });
    } else if (write.kind === "reopen_topic") {
      if (!isTerminalTopic(topic) || !write.reason.trim() || write.reason.length > 500 || data.topics.some(item => item.reopenedFrom === topic.id)) throw new Error("這項終態話題已重開，或仍缺少明確重開原因。");
      putTopic({ ...topic, id: context.nextId, version: 1, status: "pending", mayAsk: true, resumeAfter: null, reopenedFrom: topic.id,
        reopenReason: write.reason, updatedAt: new Date(now).toISOString(), authorSelf: true });
    }
  }
  return next;
}
