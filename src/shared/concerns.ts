import { z } from "zod";

export const CONCERN_EVENT_LIMIT = 200;
export const CONCERN_STORED_EVENT_LIMIT = CONCERN_EVENT_LIMIT + 2;

const text = (max: number) => z.string().trim().min(1).max(max);
const version = z.number().int().min(1).max(2147483646);
export const concernLinksSchema = z.object({
  recordId: z.uuid().nullable(), taskId: z.uuid().nullable(), attentionId: z.uuid().nullable(),
}).strict();
export const concernValuesSchema = z.object({
  title: text(160), reason: text(2000), observation: text(2000),
  observedAt: z.iso.datetime({ offset: true }), links: concernLinksSchema,
  followUpAt: z.iso.datetime({ offset: true }).nullable(),
}).strict();
export const concernChangeSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("append"), expectedVersion: version, authorityVersion: text(100),
    text: text(2000), observedAt: z.iso.datetime({ offset: true }), links: concernLinksSchema }).strict(),
  z.object({ action: z.literal("archive"), expectedVersion: version, authorityVersion: text(100), confirm: z.literal(true) }).strict(),
  z.object({ action: z.literal("restore"), expectedVersion: version, authorityVersion: text(100), confirm: z.literal(true) }).strict(),
  z.object({ action: z.literal("schedule_followup"), expectedVersion: version, authorityVersion: text(100),
    followUpAt: z.iso.datetime({ offset: true }).nullable() }).strict(),
]);
export type ConcernValues = z.infer<typeof concernValuesSchema>;
export type ConcernChange = z.infer<typeof concernChangeSchema>;
export interface ConcernEvent {
  id: string; at: string; kind: "observation" | "confirmed_action"; title: string; text: string; sourceLabel: string;
  actorUserId: string; recordId?: string; taskId?: string; attentionId?: string; attentionVersion?: number; runId?: string;
}
export interface Concern {
  id: string; childId: string; title: string; reason: string; status: "following" | "closed"; version: number;
  createdAt: string; updatedAt: string; archivedAt: string | null; statusBeforeArchive?: "following";
  attentionIds: string[]; events: ConcernEvent[]; historyComplete: boolean;
  followUp: { id: string; at: string; state: "pending" | "queued" | "completed" | "stopped" | "unknown" | "cancelled"; runId: string | null } | null;
}
export interface ConcernPage { authorityVersion: string; items: Concern[]; canManage: boolean }
