import { z } from 'zod';

export const highWatermarkPolicySchema = z.object({
  thresholdRatio: z.number().finite().positive().max(1),
  windowSize: z.number().int().min(1).max(100),
  minHighRuns: z.number().int().min(1).max(100),
  consecutiveHighStreak: z.number().int().min(1).max(100),
  repeatedSignatureStreak: z.number().int().min(2).max(100),
}).strict().refine(p => p.minHighRuns <= p.windowSize && p.consecutiveHighStreak <= p.windowSize);

export const budgetAlertKeySchema = z.object({ id: z.uuid(), category: z.enum(['interactive', 'background']) }).strict();
export const budgetAlertSchema = budgetAlertKeySchema.extend({
  openedAt: z.iso.datetime(), policyVersion: z.number().int().nonnegative(), policy: highWatermarkPolicySchema,
  recommendedAction: z.enum(['review_soft_ratio', 'tighten_or_compact', 'stop_loop_early']),
  windowCount: z.number().int().min(1).max(100), highWatermarkCount: z.number().int().min(0).max(100),
  triggeredDimensions: z.array(z.enum(['modelCalls', 'toolCalls', 'queryEmbeddings'])).max(3),
  delivery: z.enum(['not_sent', 'unknown', 'accepted', 'rejected']), receivedAt: z.iso.datetime().nullable(),
}).strict();
export type BudgetAlert = z.infer<typeof budgetAlertSchema>;
