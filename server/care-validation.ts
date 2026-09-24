import { z } from "zod";
import { CARE_KINDS } from "../src/shared/care.ts";

// Do not trim source values or silently coerce approximate values into numbers.
const text = (max: number) => z.string().max(max).refine(value => !/[\u0000\uD800-\uDFFF]/u.test(value));
const required = (max: number) => text(max).refine(value => value.trim().length > 0);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
const timestamp = z.iso.datetime({ offset: true });
const zone = z.string().max(100).refine(value => { try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; } });
export const versionSchema = z.number().int().min(0).max(2147483646);
export const careValuesSchema = z.object({
  text: required(10000), source: required(500),
  details: z.object({ kind: z.enum(CARE_KINDS),
    quantity: z.object({ rawValue: required(100), unit: required(50), precision: z.enum(["exact", "approximate"]) }).strict().nullable(),
    eventTime: z.object({ rawText: text(300), at: timestamp.nullable(), timeZone: zone, precision: z.enum(["exact", "approximate", "unknown"]) }).strict()
      .refine(value => value.precision === "exact" ? value.at !== null && value.rawText.trim().length > 0 : value.at === null),
  }).strict(),
}).strict();
export const profileDataSchema = z.object({
  age: z.discriminatedUnion("kind", [z.object({ kind: z.literal("unknown") }).strict(),
    z.object({ kind: z.literal("birth_date"), date }).strict(),
    z.object({ kind: z.literal("approximate"), rawValue: required(100), unit: z.enum(["days", "weeks", "months", "years"]), asOf: date }).strict()]),
  dueDate: date.nullable(), gestationalWeeksRaw: required(100).nullable(), region: required(200).nullable(),
  language: required(200).nullable(), allergies: required(2000).nullable(), specialNeeds: required(2000).nullable(),
  preferences: required(2000).nullable(), source: required(500), validUntil: date.nullable(),
}).strict();
export const careCreateSchema = careValuesSchema.extend({ confirmShared: z.literal(true) });
export const careReviseSchema = careValuesSchema.extend({ confirmShared: z.literal(true), expectedVersion: versionSchema, reason: required(500) });
export const profileSaveSchema = z.object({ data: profileDataSchema, confirmShared: z.literal(true), expectedVersion: versionSchema, reason: required(500) }).strict();
export const deleteCareSchema = z.object({ expectedVersion: versionSchema, confirmDelete: z.literal(true) }).strict();
export const careSearchSchema = z.object({ query: text(200).optional(), kind: z.enum(CARE_KINDS).optional(),
  cursor: z.object({ createdAt: timestamp, id: z.uuid() }).strict().optional() }).strict();
