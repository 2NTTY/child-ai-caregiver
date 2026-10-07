import { z } from "zod";
import { taskValuesSchema } from "./tasks.ts";
import type { TaskAssignee, TaskState } from "./tasks.ts";
/** Exact notices shared by the read boundary and its compact empty-state presentation. */
export const GROWTH_KNOWLEDGE_NOTICES = {
  region: "尚未能把已確認地域轉為知識篩選；原地域資料已保留，沒有假定香港。現有關注仍可查閱，來源適用性尚未能確認。",
  age: "知識及成長規則目前只覆蓋 0–10 歲；原出生日期已保留，沒有套用其他年齡的來源。現有關注仍可查閱，來源適用性尚未能確認。",
} as const;
export const growthTopicSchema = z.enum(["solid_food", "toddler_play", "preschool_development", "school_vision"]);
export type GrowthTopicId = z.infer<typeof growthTopicSchema>;
export type GrowthState = "proposed" | "snoozed" | "accepted" | "dismissed" | "inapplicable";
export interface GrowthSource { sourceId: string; versionId: string; chunkId: string; contentHash: string; url: string; title: string; section: string; checkedAt: string; excerpt: string }
export interface GrowthBasis { stage: string; ruleRevision: string; sourceHash: string; values: Record<string, string> }
export interface GrowthAttention {
  id: string; childId: string; topicId: GrowthTopicId; version: number; state: GrowthState;
  title: string; kind: "observe" | "arrange" | "consult"; whyNow: string; advice: string; limits: string;
  basis: GrowthBasis; evidence: { profileVersion: number; facts: { id: string; version: number }[] };
  source: GrowthSource; sourceAvailable: boolean; createdAt: string; updatedAt: string; snoozeUntil: string | null;
  previousId: string | null; newReason: string; taskId: string | null; taskState: TaskState | null;
  lastAction: string; actorUserId: string | null; note: string;
}
export interface GrowthInput { key: string; label: string; choices: { value: string; label: string }[]; value: string | null; conflict: boolean; factRefs: { id: string; version: number }[] }
export interface GrowthTopic { id: GrowthTopicId; title: string; version: number; disabled: boolean; inputs: GrowthInput[] }
export interface GrowthPage { authorityVersion: string; items: GrowthAttention[]; historyHasMore: boolean; topics: GrowthTopic[]; notices: string[]; eligibleAssignees: TaskAssignee[]; canManage: boolean }
const basis = { authorityVersion: z.string().min(1).max(100), expectedVersion: z.number().int().positive().max(2147483646), confirm: z.literal(true) };
export const growthActionSchema = z.discriminatedUnion("action", [
  z.object({ ...basis, action: z.literal("accept"), task: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("none") }).strict(),
    z.object({ kind: z.literal("existing"), id: z.uuid(), expectedVersion: z.number().int().positive() }).strict(),
    z.object({ kind: z.literal("create"), values: taskValuesSchema }).strict(),
  ]) }).strict(),
  z.object({ ...basis, action: z.literal("snooze"), until: z.iso.datetime({ offset: true }) }).strict(),
  z.object({ ...basis, action: z.literal("dismiss"), note: z.string().max(1000) }).strict(),
]);
export type GrowthAction = z.infer<typeof growthActionSchema>;
export const growthTopicActionSchema = z.discriminatedUnion("action", [
  z.object({ ...basis, action: z.literal("set_enabled"), enabled: z.boolean() }).strict(),
  z.object({ ...basis, action: z.literal("confirm_context"), expectedFacts: z.array(z.object({ id: z.uuid(), version: z.number().int().positive() }).strict()).max(200), values: z.record(z.string().max(80), z.string().max(80)), confirmShared: z.literal(true) }).strict(),
]);
export type GrowthTopicAction = z.infer<typeof growthTopicActionSchema>;
