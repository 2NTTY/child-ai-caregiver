import { z } from "zod";
import { taskChangeSchema, taskValuesSchema } from "./tasks.ts";
import type { KnowledgeEvidence } from "./knowledge.ts";
import { sharedInputCreateSchema, sourceManagementSchema, sourceManagementChangeSchema } from "./shared-inputs.ts";
import { concernValuesSchema, concernChangeSchema } from "./concerns.ts";
import { documentPatchSchema } from "./family-documents.ts";
import type { ChatDeliveryReviewBinding } from "./chat-delivery-review.ts";
import { ordinaryRecordDetailsSchema } from "./agent-actions.ts";

const text = (max: number) => z.string().min(1).max(max).refine(value => value.trim().length > 0);
const version = z.number().int().min(1).max(2147483646);
export const agentProposalSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("care_record_create"), text: text(2000), details: ordinaryRecordDetailsSchema,
    sourceQuote: text(2000), sourceBasis: z.literal("voice_interpretation").optional(),
    quantityEvidence: text(200).nullable().optional() }).strict(),
  z.object({ kind: z.literal("care_record_revise"), recordId: z.uuid(), expectedVersion: version, text: text(2000),
    details: ordinaryRecordDetailsSchema, reason: text(1000), sourceQuote: text(2000),
    sourceBasis: z.literal("voice_interpretation").optional(), quantityEvidence: text(200).nullable().optional(),
    previousText: text(2000).optional() }).strict(),
  z.object({ kind: z.literal("private_note_create"), title: text(100), text: text(2000),
    memoryKey: text(100).optional(), sourceQuote: text(2000) }).strict(),
  z.object({ kind: z.literal("private_note_revise"), noteId: z.uuid(), expectedVersion: version, title: text(100),
    text: text(2000), memoryKey: text(100).optional(), sourceQuote: text(2000),
    previousTitle: text(100).optional(), previousText: text(2000).optional() }).strict(),
  z.object({ kind: z.literal("family_document_change"), documentId: z.uuid(), change: documentPatchSchema }).strict()
    .refine(value => JSON.stringify(value).length <= 6000, "Document candidate exceeds the complete confirmation limit"),
  z.object({ kind: z.literal("concern_create"), values: concernValuesSchema }).strict(),
  z.object({ kind: z.literal("concern_change"), concernId: z.uuid(), change: concernChangeSchema }).strict(),
  z.object({kind:z.literal("private_source_create"),input:sharedInputCreateSchema.options[0],management:sourceManagementSchema}).strict(),
  z.object({kind:z.literal("private_source_change"),inputId:z.uuid(),change:sourceManagementChangeSchema}).strict(),
  z.object({ kind: z.literal("task_create"), values: taskValuesSchema }).strict(),
  z.object({ kind: z.literal("task_change"), taskId: z.uuid(), change: taskChangeSchema }).strict(),
  z.object({ kind: z.literal("memory_fact_revise"), factId: z.uuid(), expectedVersion: z.number().int().min(1).max(2147483646),
    key: text(100), content: text(2000), validUntil: z.iso.datetime({ offset: true }).nullable(), sourceMessageId: z.uuid(), reason: text(500) }).strict(),
  z.object({ kind: z.literal("memory_fact_deactivate"), factId: z.uuid(), expectedVersion: z.number().int().min(1).max(2147483646), reason: text(500) }).strict(),
  z.object({ kind: z.literal("memory_fact"), key: text(100), content: text(2000),
    intendedVisibility: z.enum(["private", "family"]), validUntil: z.iso.datetime({ offset: true }).nullable(), sourceMessageId: z.uuid().optional() }).strict(),
]);
export type AgentProposalValue = z.infer<typeof agentProposalSchema>;
export const agentProposalEditSchema = z.object({
  expectedVersion: z.number().int().positive(),
  value: agentProposalSchema,
}).strict();
export type AgentProposalEdit = z.infer<typeof agentProposalEditSchema>;
export function proposalTargetKey(value: AgentProposalValue): string {
  switch (value.kind) {
    case "care_record_create": return "care_record:create";
    case "care_record_revise": return `care_record:revise:${value.recordId}`;
    case "private_note_create": return "private_note:create";
    case "private_note_revise": return `private_note:revise:${value.noteId}`;
    case "family_document_change": return `family_document:change:${value.documentId}`;
    case "concern_create": return "concern:create";
    case "concern_change": return `concern:change:${value.concernId}`;
    case "private_source_create": return "private_source:create";
    case "private_source_change": return `private_source:change:${value.inputId}`;
    case "task_create": return "task:create";
    case "task_change": return `task:change:${value.taskId}`;
    case "memory_fact": return "memory_fact:create";
    case "memory_fact_revise": return `memory_fact:revise:${value.factId}`;
    case "memory_fact_deactivate": return `memory_fact:deactivate:${value.factId}`;
  }
}
export const agentDecisionSchema = z.object({
  expectedVersion: z.number().int().positive(), decision: z.enum(["accept", "dismiss"]),
  confirmShared: z.boolean(),
}).strict();
export type AgentDecision = z.infer<typeof agentDecisionSchema>;
export interface AgentProposal {
  id: string; runId: string; childId: string; version: number;
  status: "pending" | "accepted" | "dismissed" | "expired";
  createdAt: string; expiresAt: string; value: AgentProposalValue; targetLabel: string | null; targetVisibility?: "private" | "family"; contentState?: "ready" | "invalidated";
  result: { kind: "task" | "memory_fact" | "private_source" | "concern" | "family_document" | "care_record" | "private_note"; id: string; version: number } | null;
}
export interface AgentPendingPage {
  proposals: AgentProposal[];
  nextCursor: string | null;
}
export const agentPendingPageSchema = z.object({
  proposals: z.array(z.object({
    id: z.uuid(), runId: z.uuid(), childId: z.uuid(), version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    status: z.enum(["pending", "expired"]), createdAt: z.iso.datetime({ offset: true }), expiresAt: z.iso.datetime({ offset: true }),
    value: agentProposalSchema, targetLabel: z.string().nullable(), targetVisibility: z.enum(["private", "family"]).optional(), contentState: z.enum(["ready", "invalidated"]).optional(), result: z.null(),
  })).max(20),
  nextCursor: z.string().regex(/^[A-Za-z0-9_-]{1,1024}$/).nullable(),
}).strict();
const answerKind = z.enum(["public_information", "caregiving", "safety_help", "clarification", "operation", "record_restatement", "private_reference"]);
const answerParagraph = z.object({ kind: answerKind.optional(), text: text(1800), citationIds: z.array(z.string().min(1).max(80)).max(6) }).strict();
export const MAX_ANSWER_PARAGRAPHS = 6;
export const agentAnswerSchema = z.object({
  kind: z.enum([...answerKind.options, "mixed"]),
  paragraphs: z.array(answerParagraph).min(1).max(MAX_ANSWER_PARAGRAPHS),
}).strict().refine(value => value.kind !== "mixed" || value.paragraphs.every(p => p.kind !== undefined), "Mixed paragraphs require individual kinds");
/** Only worker entry points expose this schema; empty interactive answers remain invalid. */
export const agentBackgroundAnswerSchema = z.object({
  kind: z.enum([...answerKind.options, "mixed", "no_action"]),
  paragraphs: z.array(answerParagraph).max(MAX_ANSWER_PARAGRAPHS),
}).strict().refine(value => value.kind === "no_action" ? value.paragraphs.length === 0
  : agentAnswerSchema.safeParse({ kind: value.kind, paragraphs: value.paragraphs }).success,
  "No-action is empty; other answers require valid paragraphs");
export type AgentAnswer = z.infer<typeof agentAnswerSchema>;
export const proactiveNextCheckSchema = z.object({at:z.iso.datetime({offset:true}),reason:text(240)}).strict();
export const privateSourceCitationSchema=z.object({citationId:z.string().max(80),inputId:z.uuid(),version:z.number().int().min(1),
  label:z.string().max(200),excerpt:z.string().max(6000),sha256:z.string().regex(/^[a-f0-9]{64}$/u),
  nature:z.enum(["unspecified","external_material","claimed_official","personal_observation"])}).strict();
export type PrivateSourceCitation=z.infer<typeof privateSourceCitationSchema>;
export interface AgentPresentation {
  discussion?: import('./chat-discussion.ts').DiscussionTranscript;
  sourceCardReadings?: import('./source-card-reading.ts').SourceReading[];
  text: string;
  /** Persisted worker outcome, not a chat message or a completed care task. */
  outcome?: "no_action";
  citations: KnowledgeEvidence[];
  privateSourceCitations?:PrivateSourceCitation[];
  liveCitations?: import('./live-source-citation.ts').LiveSourceCitation[];
  retrievalMode: "vector_keyword" | "keyword_degraded" | "not_used";
}
export interface ProductAgentResult extends AgentPresentation {
  nextCheck?:z.infer<typeof proactiveNextCheckSchema>;
  runId: string;
  provenance: { packVersion: string; recipeId: string; model: string } | null;
  status: "running" | "completed" | "stopped" | "unknown";
  stopReason: string | null;
  tools: { name: string; status: "succeeded" | "rejected" | "conflict" | "failed" | "unknown"; reference?: string }[];
  /** False when an interrupted run never persisted its counters. */
  countsKnown?: boolean;
  counts: { modelCalls: number; toolCalls: number; queryEmbeddings: number };
  proposals: AgentProposal[];
  /** Ephemeral run-bound specialist draft previews; never auto-saved as a formal document. */
  specialistArtifacts?: import("./specialist-artifact.ts").SpecialistArtifactSummary[];
  /** Present only after an independent pass that still matches this draft. */
  deliveryReview?: ChatDeliveryReviewBinding;
}
