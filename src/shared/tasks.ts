import { z } from "zod";
import type { ImportProvenance } from './import-provenance.ts';

const text = (maximum: number) => z.string().max(maximum).refine(value => value.trim().length > 0);
export const taskTimeZoneSchema = z.string().max(100).refine(value => {
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return true; } catch { return false; }
});
export const taskDueAtSchema = z.iso.datetime({ offset: true }).refine(value => {
  const time = Date.parse(value);
  return time >= Date.UTC(2000, 0, 1) && time < Date.UTC(2101, 0, 1);
});
export const taskValuesSchema = z.object({
  title: text(160), details: z.string().max(2000), kind: z.enum(["ordinary", "appointment"]),
  assigneeUserId: z.string().min(1).max(128), dueAt: taskDueAtSchema, timeZone: taskTimeZoneSchema,
}).strict();
export const taskCreateSchema = z.object({ values: taskValuesSchema, confirm: z.literal(true) }).strict();
const changeBasis = { expectedVersion: z.number().int().positive().max(2147483646), confirm: z.literal(true) };
export const taskChangeSchema = z.discriminatedUnion("action", [
  z.object({ ...changeBasis, action: z.literal("reschedule"), dueAt: taskDueAtSchema, timeZone: taskTimeZoneSchema,
    assigneeUserId: z.string().min(1).max(128), note: text(1000) }).strict(),
  z.object({ ...changeBasis, action: z.literal("complete"), note: z.string().max(1000) }).strict(),
  z.object({ ...changeBasis, action: z.literal("cancel"), note: text(1000) }).strict(),
  z.object({ ...changeBasis, action: z.literal("resolve"), outcome: z.enum(["completed", "cancelled"]), note: text(1000) }).strict(),
]);
export type TaskValues = z.infer<typeof taskValuesSchema>;
export type TaskCreate = z.infer<typeof taskCreateSchema>;
export type TaskChange = z.infer<typeof taskChangeSchema>;
export type TaskState = "scheduled" | "completed" | "cancelled" | "needs_review";
export interface TaskOccurrence {
  id: string; dueAt: string; timeZone: string; state: TaskState;
  // Only an opposing terminal operation from this exact basis may record a conflict.
  terminalBasisVersion: number | null;
}
export interface CareTask {
  importedFrom?: ImportProvenance;
  id: string; childId: string; version: number; title: string; details: string;
  kind: TaskValues["kind"]; assigneeUserId: string; createdBy: string; createdAt: string; updatedAt: string;
  occurrence: TaskOccurrence;
}
export interface TaskRevision {
  task: CareTask; action: "create" | TaskChange["action"]; actorUserId: string;
  basisVersion: number; note: string; at: string;
}
export interface TaskAssignee { userId: string; name: string }
export interface TaskReminder {
  id: string; batchId: string; taskId: string; occurrenceId: string; taskVersion: number;
  phase: "initial" | "follow_up"; createdAt: string;
}
export interface TaskWorkState {
  taskId: string; taskVersion: number; status: "pending" | "processed" | "stopped" | "failed" | "unknown";
  nextAt: string; failures: number;
}
export interface TaskPage {
  items: CareTask[]; eligibleAssignees: TaskAssignee[]; nextAfterId: string | null;
  reminders?: TaskReminder[]; work?: TaskWorkState[]; workerEnabled?: boolean;
}
export interface TaskHistory { revisions: TaskRevision[]; nextBeforeVersion: number | null }
