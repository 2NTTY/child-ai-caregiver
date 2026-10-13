import { z } from 'zod';
import { PERSONAL_MODEL, PERSONAL_RUN_LIMITS } from './model-settings.ts';

export const platformPolicyValuesSchema = z.object({
  enabled: z.boolean(), model: z.literal(PERSONAL_MODEL),
  dailyUserAttempts: z.number().int().min(1).max(1000), dailyGlobalAttempts: z.number().int().min(1).max(10000),
  personalDailyGlobalAttempts: z.number().int().min(1).max(10000),
  maxModelCalls: z.number().int().min(1).max(PERSONAL_RUN_LIMITS.modelCalls.max),
  maxQueryEmbeddings: z.number().int().min(1).max(PERSONAL_RUN_LIMITS.queryEmbeddings.max),
}).strict();
export const platformPolicySchema = platformPolicyValuesSchema.extend({ version: z.number().int().nonnegative(), updatedAt: z.iso.datetime().nullable() });
export type PlatformPolicy = z.infer<typeof platformPolicySchema>;
const operation = { opId: z.uuid() }, address = z.email().max(320).transform(value => value.toLowerCase());
export const adminCommandSchema = z.discriminatedUnion('kind', [
  z.object({ ...operation, kind: z.literal('policy'), expectedVersion: z.number().int().nonnegative(), values: platformPolicyValuesSchema }).strict(),
  z.object({ ...operation, kind: z.literal('invite'), email: address, expiresAt: z.iso.datetime({ offset: true }) }).strict(),
  z.object({ ...operation, kind: z.literal('revoke'), email: address }).strict(),
]);
export type AdminCommand = z.infer<typeof adminCommandSchema>;
export const adminInvitationSchema = z.object({ email: z.email(), expiresAt: z.iso.datetime({ offset: true }),
  state: z.enum(['issued', 'consumed', 'revoked']) }).strict();
export type AdminInvitation = z.infer<typeof adminInvitationSchema>;
export const adminReceiptSchema = z.object({ opId: z.uuid(), actorId: z.string().min(1), at: z.iso.datetime(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/), command: adminCommandSchema,
  before: z.union([platformPolicySchema, adminInvitationSchema]).nullable(),
  result: z.union([platformPolicySchema, adminInvitationSchema]),
}).strict();
export type AdminReceipt = z.infer<typeof adminReceiptSchema>;
export interface AdminPage<T> { items: T[]; nextCursor: string | null }
export interface AdminUsage { day: string; attempts: number; inputTokens: number; outputTokens: number; cachedTokens: number; unknownUsageAttempts: number }
export interface AdminOverview { policy: PlatformPolicy; platformConfigured: boolean; serverEnabled: boolean; toolCalls: number; deadlineMs: number; outputTokens: number; inputCharacters: number }
