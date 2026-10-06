import { z } from "zod";
import { taskChangeSchema, taskValuesSchema } from "./tasks.ts";
import type { KnowledgeEvidence } from "./knowledge.ts";
import { sharedInputCreateSchema, sourceManagementSchema, sourceManagementChangeSchema } from "./shared-inputs.ts";

const text = (max: number) => z.string().min(1).max(max).refine(value => value.trim().length > 0);
export const agentProposalSchema = z.discriminatedUnion("kind", [
  z.object({kind:z.literal("private_source_create"),input:sharedInputCreateSchema.options[0],management:sourceManagementSchema}).strict(),
  z.object({kind:z.literal("private_source_change"),inputId:z.uuid(),change:sourceManagementChangeSchema}).strict(),
  z.object({ kind: z.literal("task_create"), values: taskValuesSchema }).strict(),
  z.object({ kind: z.literal("task_change"), taskId: z.uuid(), change: taskChangeSchema }).strict(),
  z.object({ kind: z.literal("memory_fact"), key: text(100), content: text(2000),
    intendedVisibility: z.enum(["private", "family"]), validUntil: z.iso.datetime({ offset: true }).nullable() }).strict(),
]);
export type AgentProposalValue = z.infer<typeof agentProposalSchema>;
export const agentDecisionSchema = z.object({
  expectedVersion: z.number().int().positive(), decision: z.enum(["accept", "dismiss"]),
  confirmShared: z.boolean(),
}).strict();
export type AgentDecision = z.infer<typeof agentDecisionSchema>;
export interface AgentProposal {
  id: string; runId: string; childId: string; version: number;
  status: "pending" | "accepted" | "dismissed" | "expired";
  createdAt: string; expiresAt: string; value: AgentProposalValue; targetLabel: string | null;
  result: { kind: "task" | "memory_fact" | "private_source"; id: string; version: number } | null;
}
export interface AgentPendingPage {
  proposals: AgentProposal[];
  nextCursor: string | null;
}
export const agentPendingPageSchema = z.object({
  proposals: z.array(z.object({
    id: z.uuid(), runId: z.uuid(), childId: z.uuid(), version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    status: z.enum(["pending", "expired"]), createdAt: z.iso.datetime({ offset: true }), expiresAt: z.iso.datetime({ offset: true }),
    value: agentProposalSchema, targetLabel: z.string().nullable(), result: z.null(),
  })).max(20),
  nextCursor: z.string().regex(/^[A-Za-z0-9_-]{1,1024}$/).nullable(),
}).strict();
export const agentAnswerSchema = z.object({
  kind: z.enum(["caregiving", "safety_help", "clarification", "operation", "record_restatement", "private_reference"]),
  paragraphs: z.array(z.object({ text: text(1800), citationIds: z.array(z.string().min(1).max(80)).max(6) }).strict()).min(1).max(6),
}).strict();
export type AgentAnswer = z.infer<typeof agentAnswerSchema>;
export const privateSourceCitationSchema=z.object({citationId:z.string().max(80),inputId:z.uuid(),version:z.number().int().min(1),
  label:z.string().max(200),excerpt:z.string().max(6000),sha256:z.string().regex(/^[a-f0-9]{64}$/u),
  nature:z.enum(["unspecified","external_material","claimed_official","personal_observation"])}).strict();
export type PrivateSourceCitation=z.infer<typeof privateSourceCitationSchema>;
export interface AgentPresentation {
  text: string;
  citations: KnowledgeEvidence[];
  privateSourceCitations?:PrivateSourceCitation[];
  retrievalMode: "vector_keyword" | "keyword_degraded" | "not_used";
}
export interface ProductAgentResult extends AgentPresentation {
  runId: string;
  provenance: { packVersion: string; recipeId: string; model: string } | null;
  status: "running" | "completed" | "stopped" | "unknown";
  stopReason: string | null;
  tools: { name: string; status: "succeeded" | "rejected" | "conflict" | "failed" | "unknown"; reference?: string }[];
  /** False when an interrupted run never persisted its counters. */
  countsKnown?: boolean;
  counts: { modelCalls: number; toolCalls: number; queryEmbeddings: number };
  proposals: AgentProposal[];
}
