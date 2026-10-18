import { z } from "zod";
import { voiceMessageReferenceSchema, type VoiceMessageReference } from "./voice.ts";
const text = (limit: number) => z.string().min(1).max(limit).refine(value => Boolean(value.trim()));
const version = z.number().int().min(1).max(2147483646);
export const workResourceSchema = z.object({
  kind: z.enum(["task", "memory_fact", "private_note", "private_source", "concern", "family_document", "care_record", "receipt"]),
  id: z.uuid(), version,
}).strict();
export const workPendingSchema = z.object({ runId: z.uuid(), proposalId: z.uuid(), version }).strict();
export const workFollowUpSchema = z.object({
  reason: text(500), dueAt: z.iso.datetime({ offset: true }).nullable(), watchResources: z.boolean(),
  knowledgeSourceIds: z.array(z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/)).max(4).refine(ids => new Set(ids).size === ids.length),
}).strict().refine(value => value.dueAt !== null || value.watchResources || value.knowledgeSourceIds.length > 0);
export const workContinuationSchema = z.object({
  eventId: z.uuid(), runId: z.uuid().nullable(), state: z.enum(["queued", "completed", "stopped", "unknown", "cancelled"]),
  createdAt: z.iso.datetime({ offset: true }),
}).strict();
export const agentWorkValuesSchema = z.object({
  goal: text(1000), focus: z.string().max(1000), questions: z.array(text(500)).max(6),
  sourceMessageIds: z.array(z.uuid()).max(6).refine(ids => new Set(ids).size === ids.length),
  resources: z.array(workResourceSchema).max(8),
  pending: z.array(workPendingSchema).max(8),
  status: z.enum(["active", "waiting", "completed", "cancelled"]),
  followUp: workFollowUpSchema.nullable().optional(),
}).strict();
export const saveAgentWorkSchema = z.object({
  operationId: z.uuid(), workId: z.uuid().nullable(), expectedVersion: z.number().int().min(0).max(2147483646),
  values: agentWorkValuesSchema,
}).strict().refine(value => value.workId ? value.expectedVersion > 0 : value.expectedVersion === 0);
export const readAgentWorkSchema = z.object({ workId: z.uuid().nullable(), cursor: z.string().max(2048).nullable() }).strict()
  .refine(value => !value.workId || value.cursor === null);
export const historySearchSchema = z.object({
  kind: z.enum(["message", "private_instruction", "memory_fact"]), query: z.string().max(200),
  cursor: z.string().max(2048).nullable(),
  createdFrom: z.iso.datetime({ offset: true }).optional(),
  createdBefore: z.iso.datetime({ offset: true }).optional(),
}).strict().refine(value => !value.createdFrom || !value.createdBefore || Date.parse(value.createdFrom) < Date.parse(value.createdBefore));
export const historyReadSchema = z.object({
  messageId: z.uuid(), offset: z.number().int().min(0).max(1000000), limit: z.number().int().min(1).max(4000),
  contentVersion: z.string().regex(/^[a-f0-9]{64}$/u).optional().describe("Echo the returned contentVersion when continuing a voice message; changed or deleted transcripts invalidate continuation."),
}).strict();
export const memoryFactReadSchema = z.object({ factId: z.uuid().nullable(), afterId: z.uuid().nullable(), keys: z.array(text(100)).min(1).max(4).optional() }).strict()
  .refine(value => (!value.factId || value.afterId === null) && (!value.keys || (value.factId === null && value.afterId === null)));
export const requestAgentConfirmationSchema = z.object({
  runId: z.uuid(), proposalId: z.uuid(), expectedVersion: version, workId: z.uuid().nullable(),
}).strict();
export type AgentWorkValues = z.infer<typeof agentWorkValuesSchema>;
export type SaveAgentWork = z.infer<typeof saveAgentWorkSchema>;
export type WorkResource = z.infer<typeof workResourceSchema>;
export interface AgentWork extends AgentWorkValues {
  id: string; childId: string; version: number; createdAt: string; updatedAt: string;
  latestFollowUp?: z.infer<typeof workContinuationSchema>;
}
export interface AgentWorkPage { items: AgentWork[]; nextCursor: string | null; complete: boolean }
export interface HistoryMatch {
  id: string; kind: z.infer<typeof historySearchSchema>["kind"]; version: number; createdAt: string;
  role: "user" | "model" | null; excerpt: string;
}
export interface AgentHistoryPage {
  matches: HistoryMatch[]; scanned: number; scanLimit: number; complete: boolean; nextCursor: string | null;
}
export interface AgentHistoryMessage {
  id: string; childId: string; role: "user" | "model"; version: 1; createdAt: string;
  text: string; offset: number; nextOffset: number | null; totalCharacters: number;
  contentVersion?: string; voice?: VoiceMessageReference;
}
export interface AgentConfirmation {
  id: string; proposalRunId: string; proposalId: string; proposalVersion: number; expiresAt: string; question: string;
}

export const agentWorkSchema = agentWorkValuesSchema.extend({ id: z.uuid(), childId: z.uuid(), version, createdAt: z.iso.datetime({ offset: true }), updatedAt: z.iso.datetime({ offset: true }), latestFollowUp: workContinuationSchema.optional() }).strict();
export const agentWorkPageSchema = z.object({ items: z.array(agentWorkSchema).max(10), nextCursor: z.string().max(2048).nullable(), complete: z.boolean() }).strict();
export const agentHistoryPageSchema = z.object({ matches: z.array(z.object({ id: z.uuid(), kind: historySearchSchema.shape.kind, version, createdAt: z.iso.datetime({ offset: true }), role: z.enum(["user", "model"]).nullable(), excerpt: z.string().max(400) }).strict()).max(10), scanned: z.number().int().min(0).max(100), scanLimit: z.literal(100), complete: z.boolean(), nextCursor: z.string().max(2048).nullable() }).strict();
export const agentHistoryMessageSchema = z.object({ id: z.uuid(), childId: z.uuid(), role: z.enum(["user", "model"]), version: z.literal(1), createdAt: z.iso.datetime({ offset: true }), text: z.string().max(4000), offset: z.number().int().min(0), nextOffset: z.number().int().min(0).nullable(), totalCharacters: z.number().int().min(0), contentVersion: z.string().regex(/^[a-f0-9]{64}$/u).optional(), voice: voiceMessageReferenceSchema.optional() }).strict();
