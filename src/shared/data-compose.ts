import { z } from "zod";
import { documentEditSchema } from "./family-documents.ts";
import { chatDeliveryReviewDecisionSchema } from "./chat-delivery-review.ts";

/**
 * Server policy id for family-document compose review.
 * Same decision family as chat-delivery review; not a generator skip switch.
 */
export const DATA_COMPOSE_REVIEW_POLICY_VERSION = "p3-m02-data-compose-review/1";

/** Shown when a composed draft cannot become a formal save. */
export const DATA_COMPOSE_REVIEW_INCOMPLETE_TEXT =
  "這份編製草稿尚未通過獨立核對，未成為正式保存。已保存的其他操作仍以收據為準。";

const hash = z.string().regex(/^[a-f0-9]{64}$/u);

/** Constrained parent-tool intent. No prompt paths, tool tables, or service identities. */
export const dataComposeIntentSchema = z.object({
  documentId: z.uuid(),
  expectedVersion: z.number().int().min(1),
  authorityVersion: z.string().min(1).max(128),
  intent: z.string().trim().min(1).max(500),
}).strict();
export type DataComposeIntent = z.infer<typeof dataComposeIntentSchema>;

/** Structured draft / patch. Not a formal save by itself. */
export const dataComposeDraftSchema = z.object({
  documentId: z.uuid(),
  expectedVersion: z.number().int().min(1),
  authorityVersion: z.string().min(1).max(128),
  edits: z.array(documentEditSchema).min(1).max(12),
  gaps: z.array(z.string().trim().min(1).max(240)).max(8).default([]),
  requiredConfirmations: z.array(z.enum(["parent_shared_document"])).max(4).default([]),
  coverageNote: z.string().max(500).optional(),
}).strict();
export type DataComposeDraft = z.infer<typeof dataComposeDraftSchema>;

/** Persisted binding. No draft body, issue quotes, or private evidence. */
export const dataComposeReviewBindingSchema = z.object({
  draftHash: hash,
  documentId: z.uuid(),
  expectedVersion: z.number().int().min(1),
  authorityVersion: z.string().min(1).max(128),
  scope: z.object({
    userId: z.string().min(1).max(128),
    workspaceId: z.string().min(1).max(128),
    childId: z.string().min(1).max(128),
    authorizationVersion: z.string().min(1).max(128),
    dataVersion: z.string().min(1).max(128),
  }).strict(),
  decision: chatDeliveryReviewDecisionSchema,
  model: z.string().min(1).max(128),
  promptVersion: z.string().min(1).max(32),
  policyVersion: z.string().min(1).max(80),
}).strict();
export type DataComposeReviewBinding = z.infer<typeof dataComposeReviewBindingSchema>;
