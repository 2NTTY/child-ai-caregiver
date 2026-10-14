import { z } from "zod";

/** P3-M03 independent background knowledge maintenance. Not a chat search submodel. */
export const BACKGROUND_KNOWLEDGE_ROLE_ID = "background-knowledge-maintenance";
export const BACKGROUND_KNOWLEDGE_POLICY_VERSION = "p3-m03-background-knowledge/1";

/**
 * First-round allowlist only. Broader SOURCE_WATCHES stay registered for S10 refresh
 * but are out of scope for this M03 runner until a later expansion review.
 */
export const M03_INITIAL_WATCH_IDS = ["fhs-solid-food", "fhs-feeding-booklet-en"] as const;
export type M03InitialWatchId = (typeof M03_INITIAL_WATCH_IDS)[number];

export const backgroundKnowledgeReviewKindSchema = z.enum([
  "programmatic_stub",
  "model_review",
]);
export type BackgroundKnowledgeReviewKind = z.infer<typeof backgroundKnowledgeReviewKindSchema>;

export const backgroundKnowledgeDecisionSchema = z.enum([
  "approve_candidate",
  "hold_candidate",
  "reject_out_of_scope",
  "unchanged",
  "fetch_failed",
  "unavailable",
]);
export type BackgroundKnowledgeDecision = z.infer<typeof backgroundKnowledgeDecisionSchema>;

export const backgroundKnowledgePublishModeSchema = z.enum([
  "dry_run",
  "live",
]);
export type BackgroundKnowledgePublishMode = z.infer<typeof backgroundKnowledgePublishModeSchema>;

const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const watchId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/u);

/** Persisted review evidence. Never claims clinical validity or human expert review. */
export const backgroundKnowledgeReviewBindingSchema = z.object({
  watchId,
  observationHash: hash,
  previousObservationHash: hash.nullable(),
  decision: backgroundKnowledgeDecisionSchema,
  reviewKind: backgroundKnowledgeReviewKindSchema,
  policyVersion: z.string().min(1).max(80),
  /** Explicit: programmatic stub is not a model pass. */
  modelReviewCompleted: z.literal(false),
  growthRuleImpact: z.enum(["none", "requires_review"]),
  notes: z.array(z.string().trim().min(1).max(240)).max(8),
}).strict();
export type BackgroundKnowledgeReviewBinding = z.infer<typeof backgroundKnowledgeReviewBindingSchema>;

export const backgroundKnowledgeWorkBudgetSchema = z.object({
  /** Logical work units for one durable maintenance job identity. Restart must not zero this. */
  usedUnits: z.number().int().min(0).max(10_000),
  maxUnits: z.number().int().min(1).max(10_000),
  modelCalls: z.number().int().min(0).max(100),
  maxModelCalls: z.number().int().min(0).max(100),
}).strict();
export type BackgroundKnowledgeWorkBudget = z.infer<typeof backgroundKnowledgeWorkBudgetSchema>;

export const backgroundKnowledgeRunRequestSchema = z.object({
  watchId,
  /** Stable job / operation fingerprint so redelivery does not double-count effects. */
  operationFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  workerGeneration: z.uuid(),
  publishMode: backgroundKnowledgePublishModeSchema.default("dry_run"),
}).strict();
export type BackgroundKnowledgeRunRequest = z.infer<typeof backgroundKnowledgeRunRequestSchema>;

export const backgroundKnowledgeRunResultSchema = z.object({
  status: z.enum([
    "not_enabled",
    "rejected",
    "unchanged",
    "candidate_held",
    "dry_run_ready",
    "published",
    "fetch_failed",
    "unavailable",
    "budget_exhausted",
    "already_recorded",
  ]),
  code: z.string().min(1).max(80).optional(),
  watchId: watchId.optional(),
  observationHash: hash.nullable().optional(),
  review: backgroundKnowledgeReviewBindingSchema.nullable().optional(),
  publishMode: backgroundKnowledgePublishModeSchema.optional(),
  budget: backgroundKnowledgeWorkBudgetSchema.optional(),
  /** True only when a formal knowledge batch pointer was switched. Dry-run stays false. */
  published: z.boolean(),
}).strict();
export type BackgroundKnowledgeRunResult = z.infer<typeof backgroundKnowledgeRunResultSchema>;
