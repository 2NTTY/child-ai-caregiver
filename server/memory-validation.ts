import { z } from "zod";

const rawText = (max: number) => z.string().max(max).refine(value => !/[\u0000\uD800-\uDFFF]/u.test(value));
const text = (max: number) => rawText(max).refine(value => value.trim().length > 0);
const version = z.number().int().min(1).max(2147483646);
const visibility = z.enum(["private", "family"]);
const source = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("manual"), description: text(500) }).strict(),
  z.object({ kind: z.literal("care_record"), description: text(500), recordId: z.uuid(), version }).strict(),
  z.object({ kind: z.literal("private_chat"), description: text(500), messageId: z.uuid().optional() }).strict(),
]);
export const factValuesSchema = z.object({ key: text(100), content: text(4000), source,
  validUntil: z.iso.datetime({ offset: true }).nullable() }).strict();
export const factCreateSchema = z.object({ values: factValuesSchema, intendedVisibility: visibility }).strict();
export const sharedFactCreateSchema = factCreateSchema.extend({ intendedVisibility: z.literal('family'), confirm: z.literal(true), confirmShared: z.literal(true) });
export const factConfirmSchema = z.object({ expectedVersion: version, confirm: z.literal(true), confirmShared: z.boolean() }).strict();
export const factReviseSchema = factConfirmSchema.extend({ values: factValuesSchema, reason: text(500) }).strict();
export const factDeactivateSchema = z.object({ expectedVersion: version, reason: text(500) }).strict();
export const memoryDeleteSchema = z.object({ expectedVersion: version, confirmDelete: z.literal(true) }).strict();
export const topicCreateSchema = z.object({ title: text(200), note: rawText(2000), visibility, confirmShared: z.boolean() }).strict();
export const topicChangeSchema = z.object({ expectedVersion: version, status: z.enum(["pending", "answered", "snoozed", "resolved"]),
  note: rawText(2000), resumeAfter: z.iso.datetime({ offset: true }).nullable() }).strict().refine(value => (value.status === "snoozed") === (value.resumeAfter !== null));
export const topicReopenSchema = z.object({ expectedVersion: version, reason: text(500) }).strict();
export const summarySaveSchema = z.object({ previousVersion: z.number().int().nonnegative(), text: text(6000),
  basis: z.string().regex(/^[a-f0-9]{64}$/u), coveredMessageIds: z.array(z.uuid()).min(1).max(50), repairOf: z.uuid().optional() }).strict();
