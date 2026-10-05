import type { TaskAssigneeView, TaskState, TaskValues } from "./task-view-model";

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
};
export type GrowthConcern = {
  id: string; childId: string; title: string; reason: string; status: "proposed" | "following" | "closed";
  attentionIds: string[]; events: GrowthConcernEvent[]; historyComplete: boolean;
  measurement?: {label: string; points: {id: string; at: string; value: string; unit: string; sourceRecordId: string}[]};
};
export type GrowthConcernProjection = {state: "ready" | "loading" | "error" | "unavailable"; items: GrowthConcern[]; label: string};
export type GrowthPage = { concerns?: GrowthConcernProjection; authorityVersion:string;items:GrowthAttention[];historyHasMore:boolean;topics:GrowthTopic[];notices:string[];eligibleAssignees:TaskAssigneeView[];canManage:boolean };
type Basis = {authorityVersion:string;expectedVersion:number;confirm:true};
export type GrowthDecision = Basis & ({action:"accept";task:{kind:"none"}|{kind:"create";values:TaskValues}|{kind:"existing";id:string;expectedVersion:number}}|{action:"snooze";until:string}|{action:"dismiss";note:string});
export type GrowthTopicDecision = Basis & ({action:"set_enabled";enabled:boolean}|{action:"confirm_context";expectedFacts:GrowthFactRef[];values:Record<string,string>;confirmShared:true});
export type GrowthAttempt = {kind:"item";id:string;body:string;label:string;input:GrowthDecision;assigneeLabel?:string}|{kind:"topic";id:GrowthTopicId;body:string;label:string;input:GrowthTopicDecision;summary?:string[]};
export type GrowthPending = {attempt:GrowthAttempt;reviewed:boolean;reconfirm:boolean};
export type GrowthViewModel = {
  scopeKey:string;childName:string;dataLabel:string;online:boolean;access:"editable"|"read_only"|"lost";load:"ready"|"loading"|"error";
  page:GrowthPage|null;busy:boolean;locked:boolean;pending:GrowthPending|null;originalConsent:boolean;
  operation:"none"|"saving"|"saved"|"failed"|"unknown"|"conflict";notice:string;
  dirty:boolean;discardAsked:boolean;epoch:number;resetCounts:Record<string,number>;refreshPending:boolean;missingTargets:readonly string[];
};
export type GrowthActions = {
  refresh():void;markDirty(key:string):void;askDiscard():void;discardDrafts():void;setOriginalConsent(value:boolean):void;retryOriginal():void;
  decide(item:GrowthAttention,input:GrowthDecision):void;updateTopic(topic:GrowthTopic,input:GrowthTopicDecision):void;
};
export const growthStateLabels:Record<GrowthState,string>={proposed:"待確認",snoozed:"已延後",accepted:"已接受",dismissed:"已關閉",inapplicable:"目前不適用"};
export const growthKindLabels={observe:"觀察",arrange:"安排",consult:"諮詢"};
export const growthActionable=(item:GrowthAttention)=>item.sourceAvailable&&(item.state==="proposed"||item.state==="snoozed");
export const growthTime=(value:string)=>new Date(value).toLocaleString("zh-HK",{timeZone:"Asia/Hong_Kong",hour12:false});
export function growthSourceUrl(value:string){try{if(/[\u0000-\u0020\u007f]/.test(value))return null;const url=new URL(value);return url.protocol==="https:"&&url.hostname&&!url.username&&!url.password?url.href:null;}catch{return null;}}
