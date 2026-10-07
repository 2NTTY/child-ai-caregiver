import type { TaskAssigneeView, TaskState, TaskValues } from "./task-view-model";
import type { ConcernChange, ConcernValues } from "../../src/shared/concerns";
import { CONCERN_EVENT_LIMIT } from "../../src/shared/concerns.ts";

// Display projections of ce87370 growth.ts/GrowthPanel; the existing API remains authoritative.
export type GrowthTopicId = "solid_food" | "toddler_play" | "preschool_development" | "school_vision";
export type GrowthState = "proposed" | "snoozed" | "accepted" | "dismissed" | "inapplicable";
export type GrowthFactRef = { id: string; version: number };
export type GrowthSource = { sourceId: string; versionId: string; chunkId: string; contentHash: string; url: string; title: string; section: string; checkedAt: string; excerpt: string };
export type GrowthAttention = {
  id: string; childId: string; topicId: GrowthTopicId; version: number; state: GrowthState;
  title: string; kind: "observe" | "arrange" | "consult"; whyNow: string; advice: string; limits: string;
  basis: { stage: string; ruleRevision: string; sourceHash: string; values: Record<string,string> };
  evidence: { profileVersion: number; facts: GrowthFactRef[] }; source: GrowthSource; sourceAvailable: boolean;
  createdAt: string; updatedAt: string; snoozeUntil: string | null; previousId: string | null; newReason: string;
  taskId: string | null; taskState: TaskState | null; lastAction: string; actorUserId: string | null; note: string;
};
export type GrowthInput = { key: string; label: string; choices: {value:string;label:string}[]; value: string | null; conflict: boolean; factRefs: GrowthFactRef[] };
export type GrowthTopic = { id:GrowthTopicId;title:string;version:number;disabled:boolean;inputs:GrowthInput[] };
// Optional authorized concern projection. This is not a MemoryTopic or a new server contract.
export type GrowthConcernEvent = {
  id: string; at: string; kind: "agent_proposal" | "observation" | "pending_record" | "confirmed_action";
  title: string; text: string; sourceLabel: string;
  recordId?: string; taskId?: string;
  attentionId?: string; attentionVersion?: number;
};
export type GrowthConcern = {
  id: string; childId: string; title: string; reason: string; status: "proposed" | "following" | "closed";
  version: number; archivedAt: string | null;
  statusBeforeArchive?: "proposed" | "following";
  attentionIds: string[]; events: GrowthConcernEvent[]; historyComplete: boolean;
  followUp?: { id: string; at: string; state: "pending" | "queued" | "completed" | "stopped" | "unknown" | "cancelled"; runId: string | null } | null;
  measurement?: {label: string; points: {id: string; at: string; value: string; unit: string; sourceRecordId: string}[]};
};
export type GrowthConcernProjection = {state: "ready" | "loading" | "error" | "unavailable"; items: GrowthConcern[]; label: string};
// Optional read-only archive projection. Generation and export need their own formal ports.
// Source records remain owned by their existing domains; an archive is not a confirmed fact.
export type GrowthArchiveSource = {
  id: string; label: string; version: number; state: "available" | "invalidated";
  kind: "profile" | "record" | "fact" | "task" | "concern" | "attention"; recordId?: string; attentionId?: string;
  excerpt: string; timeLabel: string;
};
export type GrowthReportDomain = "profile" | "body_life" | "abilities_interests" | "concerns" | "changes_support";
export type GrowthArchiveEntry = {
  id: string; title?: string; text: string; timeLabel?: string;
  status: "confirmed_record" | "agent_summary" | "source_summary" | "unverified"; sourceIds: string[];
  // Optional reading classification supplied by the report adapter, not an assessment.
  reportDomain?: GrowthReportDomain;
};
export type GrowthArchiveSection = {
  id: "overview" | "changes" | "moments" | "observations";
  title: string; entries: GrowthArchiveEntry[];
};
export type GrowthArchiveSnapshot = {
  id: string; version: number; title?: string; ageLabel: string; periodLabel: string; generatedAt: string;
  sourceBasisVersion: string; coverageNote: string;
  revisionChanges: {id: string; text: string; sourceIds: string[]}[];
  sections: GrowthArchiveSection[]; sources: GrowthArchiveSource[];
};
export type GrowthArchivePeriod = {
  id: string; kind: "year" | "quarter" | "range"; year: number; quarter?: 1 | 2 | 3 | 4; from?: string; to?: string;
  label: string; snapshotId: string; snapshotVersion: number; currentAnnual: boolean;
  coverage: "partial" | "complete"; coverageLabel: string;
};
export type GrowthArchiveProjection = {
  scopeKey: string; childId: string; authorityVersion: string;
  state: "unavailable" | "loading" | "not_generated" | "generating" | "ready" | "needs_update" | "insufficient" | "error" | "invalidated";
  label: string; snapshot: GrowthArchiveSnapshot | null;
  // Only currently authorized, available snapshots and their period references belong here.
  // Several partial period views may refer to one snapshot; period labels do not prove coverage.
  periods?: GrowthArchivePeriod[]; history?: GrowthArchiveSnapshot[];
};
export type GrowthPage = { archive?: GrowthArchiveProjection; concerns?: GrowthConcernProjection; authorityVersion:string;items:GrowthAttention[];historyHasMore:boolean;topics:GrowthTopic[];notices:string[];eligibleAssignees:TaskAssigneeView[];canManage:boolean };
type Basis = {authorityVersion:string;expectedVersion:number;confirm:true};
export type GrowthDecision = Basis & ({action:"accept";task:{kind:"none"}|{kind:"create";values:TaskValues}|{kind:"existing";id:string;expectedVersion:number}}|{action:"snooze";until:string}|{action:"dismiss";note:string});
export type GrowthTopicDecision = Basis & ({action:"set_enabled";enabled:boolean}|{action:"confirm_context";expectedFacts:GrowthFactRef[];values:Record<string,string>;confirmShared:true});
export type GrowthConcernDecision = Basis & { action: "archive" | "restore" };
export type GrowthConcernUpdate = Extract<ConcernChange, { action: "append" | "schedule_followup" }>;
export type GrowthAttempt = {kind:"item";id:string;body:string;label:string;input:GrowthDecision;assigneeLabel?:string}|{kind:"topic";id:GrowthTopicId;body:string;label:string;input:GrowthTopicDecision;summary?:string[]}|{kind:"concern";id:string;body:string;label:string;input:GrowthConcernDecision}
  | {kind:"concern_create";id:"new";body:string;label:string;input:ConcernValues;authorityVersion:string}
  | {kind:"concern_update";id:string;body:string;label:string;input:GrowthConcernUpdate};
export type GrowthPending = {attempt:GrowthAttempt;reviewed:boolean;reconfirm:boolean};
export type GrowthConcernChange = { scopeKey: string; authorityVersion: string; id: string; version: number; action: "archive" | "restore" };
export type GrowthViewModel = {
  scopeKey:string;childId:string;childName:string;dataLabel:string;online:boolean;access:"editable"|"read_only"|"lost";load:"ready"|"loading"|"error";
  page:GrowthPage|null;busy:boolean;locked:boolean;pending:GrowthPending|null;originalConsent:boolean;
  operation:"none"|"saving"|"saved"|"failed"|"unknown"|"conflict";notice:string;
  dirty:boolean;discardAsked:boolean;epoch:number;resetCounts:Record<string,number>;refreshPending:boolean;missingTargets:readonly string[];
  lastConcernChange?: GrowthConcernChange | null;
};
export type GrowthActions = {
  refresh():void;markDirty(key:string):void;askDiscard():void;discardDrafts():void;setOriginalConsent(value:boolean):void;retryOriginal():void;
  decide(item:GrowthAttention,input:GrowthDecision):void;updateTopic(topic:GrowthTopic,input:GrowthTopicDecision):void;
  archiveConcern(id: string, expectedVersion: number, authorityVersion: string): void;
  restoreConcern(id: string, expectedVersion: number, authorityVersion: string): void;
  createConcern?(input: ConcernValues, authorityVersion: string, confirmShared: true): void;
  updateConcern?(id: string, input: GrowthConcernUpdate, confirmShared: true): void;
};
export const growthStateLabels:Record<GrowthState,string>={proposed:"待確認",snoozed:"已延後",accepted:"已接受",dismissed:"已關閉",inapplicable:"目前不適用"};
export const growthKindLabels={observe:"觀察",arrange:"安排",consult:"諮詢"};
export const growthRefreshNotice = "已重新讀取";
export const growthConcernAtCapacity = (concern: GrowthConcern) => concern.events.length >= CONCERN_EVENT_LIMIT;
export const growthConcernArchiveReachesCapacity = (concern: GrowthConcern) => concern.events.length + 1 >= CONCERN_EVENT_LIMIT;
export const growthConcernCanRestore = (concern: GrowthConcern) => concern.status === "closed"
  && !growthConcernAtCapacity(concern) && (concern.statusBeforeArchive === "proposed" || concern.statusBeforeArchive === "following");
export type GrowthConcernTimelineEntry =
  | { kind: "event"; at: string; event: GrowthConcernEvent }
  | { kind: "attention_state"; at: string; item: GrowthAttention };
// Read-only composition by canonical relation, never title matching or a new event store.
export function growthConcernTimelineEntries(concern: GrowthConcern, page: GrowthPage): GrowthConcernTimelineEntry[] {
  const entries: GrowthConcernTimelineEntry[] = concern.events.map(event => ({ kind: "event", at: event.at, event }));
  for (const item of page.items) {
    if (item.childId !== concern.childId || !concern.attentionIds.includes(item.id) || item.state === "proposed") continue;
    if (concern.events.some(event => event.kind === "confirmed_action" && event.attentionId === item.id && event.attentionVersion === item.version)) continue;
    entries.push({ kind: "attention_state", at: item.updatedAt, item });
  }
  return entries.sort((a, b) => {
    const left = Date.parse(a.at), right = Date.parse(b.at);
    return Number.isNaN(left) ? Number.isNaN(right) ? 0 : 1 : Number.isNaN(right) ? -1 : left - right;
  });
}
export function growthArchivedConcerns(model: GrowthViewModel, searchText = "", dateRange: { from: string | null; to: string | null } = { from: null, to: null }): GrowthConcern[] {
  if (model.access === "lost" || model.page?.concerns?.state !== "ready") return [];
  const query = searchText.trim().toLocaleLowerCase("zh-HK");
  return model.page.concerns.items.filter(concern => {
    if (concern.childId !== model.childId || concern.status !== "closed") return false;
    if (query && ![concern.title, concern.reason, ...concern.events.flatMap(event => [event.title, event.text, event.sourceLabel])].join("\n").toLocaleLowerCase("zh-HK").includes(query)) return false;
    if (!dateRange.from && !dateRange.to) return true;
    if (!concern.archivedAt || Number.isNaN(Date.parse(concern.archivedAt))) return false;
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(concern.archivedAt));
    const value = (type: string) => parts.find(part => part.type === type)?.value ?? "";
    const day = `${value("year")}-${value("month")}-${value("day")}`;
    return (!dateRange.from || day >= dateRange.from) && (!dateRange.to || day <= dateRange.to);
  });
}
export const growthActionable=(item:GrowthAttention)=>item.sourceAvailable&&(item.state==="proposed"||item.state==="snoozed");
export const growthTime=(value:string)=>new Date(value).toLocaleString("zh-HK",{timeZone:"Asia/Hong_Kong",hour12:false});
export function growthConcernFollowUpLabel(concern: GrowthConcern): string | null {
  if (!concern.followUp) return null;
  const labels = { pending: "已安排", queued: "等候處理", completed: "已完成", stopped: "已停止", unknown: "結果待核對", cancelled: "已取消" };
  return `站內跟進：${growthTime(concern.followUp.at)} · ${labels[concern.followUp.state]}`;
}
export function growthSourceUrl(value:string){try{if(/[\u0000-\u0020\u007f]/.test(value))return null;const url=new URL(value);return url.protocol==="https:"&&url.hostname&&!url.username&&!url.password?url.href:null;}catch{return null;}}
