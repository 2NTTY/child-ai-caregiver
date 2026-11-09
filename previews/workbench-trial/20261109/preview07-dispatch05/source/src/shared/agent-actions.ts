import { z } from "zod";
import { taskDueAtSchema, taskTimeZoneSchema } from "./tasks.ts";
import { contactBindingSchema } from "./contact.ts";
import type { ContactBinding } from "./contact.ts";

export const ordinaryRecordKinds = ["note", "feeding", "sleep", "diaper"] as const;
const text = (max: number) => z.string().min(1).max(max).refine(value => value.trim().length > 0);
const version = z.number().int().min(0).max(2147483646);
export const agentPolicyUpdateSchema = z.object({
  operationId: z.uuid(), expectedVersion: version,
  recordKinds: z.array(z.enum(ordinaryRecordKinds)).max(4).refine(values => new Set(values).size === values.length),
  allowPrivateNotes: z.boolean(), allowSelfTasks: z.boolean(),
  allowRecordCorrections: z.boolean().default(false),
  reminderConsentVersion: version.nullable(), reminderBindings: z.array(contactBindingSchema).max(2),
  confirm: z.literal(true), confirmShared: z.boolean(),
}).strict().refine(value => !value.recordKinds.length && !value.allowSelfTasks && !value.allowRecordCorrections || value.confirmShared)
  .refine(value => value.reminderBindings.length === 0 ? value.reminderConsentVersion === null
    : value.allowSelfTasks && value.reminderConsentVersion !== null);
export type AgentPolicyUpdate = z.infer<typeof agentPolicyUpdateSchema>;
export interface AgentOperationPolicy {
  version: number; effective: boolean; recordKinds: (typeof ordinaryRecordKinds)[number][];
  allowPrivateNotes: boolean; allowSelfTasks: boolean;
  allowRecordCorrections: boolean;
  reminderConsentVersion: number | null; reminderBindings: ContactBinding[];
}
const evidence = { sourceQuote: text(2000), sourceBasis: z.literal("voice_interpretation").optional(), expectedPolicyVersion: version,
  sourceMessages: z.array(z.object({ messageId: z.uuid(), quote: text(2000) }).strict()).max(6)
    .refine(items => new Set(items.map(item => item.messageId)).size === items.length).optional() };
const ordinaryDetails = z.object({ kind: z.enum(ordinaryRecordKinds),
  quantity: z.object({ rawValue: text(100), unit: text(50), precision: z.enum(["exact", "approximate"]) }).strict().nullable(),
  eventTime: z.object({ rawText: z.string().max(300), at: z.iso.datetime({ offset: true }).nullable()
    .describe("原文有明確時刻才填 ISO 時間；只有今天、日期、最近或未指定時刻時必須 null，不用 Server 現在時刻補填。"),
    timeZone: taskTimeZoneSchema, precision: z.enum(["exact", "approximate", "unknown"]) }).strict()
    .refine(value => value.precision === "exact" ? value.at !== null && Boolean(value.rawText.trim()) : value.at === null),
}).strict();
/** These actions express user statements and ordinary instructions, never diagnoses or inferred facts. */
export const agentDirectActionSchema = z.discriminatedUnion("kind", [
  z.object({ ...evidence, kind: z.literal("save_record"), text: text(2000), details: ordinaryDetails,
    quantityEvidence: text(200).nullable().optional().describe("當前原文或 sourceMessages 已引用原文的逐字數量片語；未提供填 null，不含日期或時鐘，不換算、不求和") }).strict(),
  z.object({ ...evidence, kind: z.literal("revise_record"), recordId: z.uuid(), expectedVersion: version,
    text: text(2000), details: ordinaryDetails, reason: text(1000), quantityEvidence: text(200).nullable().optional()
      .describe("當前原文或 sourceMessages 已引用原文的逐字數量片語；未提供填 null，不含日期或時鐘，不換算、不求和") }).strict(),
  z.object({ ...evidence, kind: z.literal("save_private_note"), title: text(100), text: text(2000), memoryKey: text(100).optional() }).strict(),
  z.object({ ...evidence, kind: z.literal("revise_private_note"), noteId: z.uuid(), expectedVersion: version,
    title: text(100), text: text(2000), memoryKey: text(100).optional() }).strict(),
  z.object({ ...evidence, kind: z.literal("create_self_task"), title: text(160), details: z.string().max(2000),
    dueAt: taskDueAtSchema, timeZone: taskTimeZoneSchema }).strict(),
  z.object({ ...evidence, kind: z.literal("change_self_task"), taskId: z.uuid(), expectedVersion: version,
    action: z.enum(["complete", "cancel", "reschedule"]), note: text(1000),
    dueAt: taskDueAtSchema.nullable(), timeZone: taskTimeZoneSchema.nullable() }).strict()
    .refine(value => value.action === "reschedule" ? value.dueAt !== null && value.timeZone !== null
      : value.dueAt === null && value.timeZone === null),
]);
export type AgentDirectAction = z.infer<typeof agentDirectActionSchema>;
export const agentActionToolNames: Record<AgentDirectAction["kind"], string> = {
  save_record: "save_ordinary_record", revise_record: "revise_ordinary_record", save_private_note: "save_private_instruction",
  revise_private_note: "revise_private_instruction", create_self_task: "create_ordinary_reminder",
  change_self_task: "change_ordinary_reminder",
};
export interface AgentPrivateNote {
  id: string; childId: string; version: number; title: string; text: string;
  sourceMessageId: string; createdAt: string; updatedAt: string;
  provenance: "user_statement";
  memoryKey?: string;
}
export interface AgentActionReceipt {
  sourceBasis?: "voice_interpretation";
  id: string; runId: string; kind: AgentDirectAction["kind"];
  resource: { kind: "care_record" | "private_note" | "task"; id: string; version: number };
  state: "saved" | "updated" | "scheduled" | "completed" | "cancelled";
  notification: "not_authorized" | "authorized_for_due_event";
  channels: ContactBinding["channel"][];
  createdAt: string;
  memoryOutcome?: "created" | "updated" | "duplicate";
  quantityGrounding?: { status: "source_supported" | "removed" | "absent" | "unchanged" };
}
