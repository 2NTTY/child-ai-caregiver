import { z } from "zod";

/** Server policy id for chat-delivery semantic review. Not the knowledge publish assessment. */
export const CHAT_DELIVERY_REVIEW_POLICY_VERSION = "p3-m01-chat-delivery-review/1";

/**
 * Shown when a substantive draft cannot become a formal reply.
 * It does not repeat the unreviewed claim.
 */
export const CHAT_DELIVERY_REVIEW_INCOMPLETE_TEXT = "這則內容尚未通過獨立核對，未成為正式回覆。已保存的操作仍以收據為準。";

export const chatDeliveryReviewDecisionSchema = z.enum(["pass", "revise", "insufficient_evidence"]);
export type ChatDeliveryReviewDecision = z.infer<typeof chatDeliveryReviewDecisionSchema>;

const hash = z.string().regex(/^[a-f0-9]{64}$/u);
export const chatDeliverySourceVersionSchema = z.object({
  citationId: z.string().min(1).max(80),
  version: z.string().min(1).max(80),
  contentHash: hash,
}).strict();
export type ChatDeliverySourceVersion = z.infer<typeof chatDeliverySourceVersionSchema>;

/** Persisted binding. No excerpt, issue quote, or private evidence body. */
export const chatDeliveryReviewBindingSchema = z.object({
  draftHash: hash,
  sourceVersions: z.array(chatDeliverySourceVersionSchema).max(12),
  scope: z.object({
    userId: z.string().min(1).max(128),
    workspaceId: z.string().min(1).max(128),
    childId: z.string().min(1).max(128),
    authorizationVersion: z.string().min(1).max(128),
    dataVersion: z.string().min(1).max(128),
  }).strict(),
  visibility: z.enum(["private", "family"]),
  decision: chatDeliveryReviewDecisionSchema,
  model: z.string().min(1).max(128),
  promptVersion: z.string().min(1).max(32),
  policyVersion: z.string().min(1).max(80),
}).strict();
export type ChatDeliveryReviewBinding = z.infer<typeof chatDeliveryReviewBindingSchema>;
