import { z } from 'zod';
import { PERSONAL_MODEL, PERSONAL_RUN_LIMITS } from './model-settings.ts';
import { AGENT_RUN_LIMITS } from './agent-run-limits.ts';

const tools = z.number().int().min(AGENT_RUN_LIMITS.toolCalls.min).max(AGENT_RUN_LIMITS.toolCalls.max);
const seconds = z.number().int().min(AGENT_RUN_LIMITS.deadlineSeconds.min).max(AGENT_RUN_LIMITS.deadlineSeconds.max);

const requestSeconds = z.number().int().min(AGENT_RUN_LIMITS.modelRequestSeconds.min).max(AGENT_RUN_LIMITS.modelRequestSeconds.max);
const retries = z.number().int().min(AGENT_RUN_LIMITS.modelRetries.min).max(AGENT_RUN_LIMITS.modelRetries.max);

export const platformPolicyValuesSchema = z.object({
  enabled: z.boolean(), model: z.literal(PERSONAL_MODEL),
  dailyUserAttempts: z.number().int().min(1).max(1000), dailyGlobalAttempts: z.number().int().min(1).max(10000),
  personalDailyGlobalAttempts: z.number().int().min(1).max(10000),
  maxModelCalls: z.number().int().min(1).max(PERSONAL_RUN_LIMITS.modelCalls.max),
  maxQueryEmbeddings: z.number().int().min(1).max(PERSONAL_RUN_LIMITS.queryEmbeddings.max),
  // Optional on commands so legacy operation fingerprints and clients remain compatible.
  maxToolCalls: tools.optional(), maxRunSeconds: seconds.optional(),
  modelRequestSeconds: requestSeconds.optional(), maxModelRetries: retries.optional(),
}).strict();
// Missing fields in stored policies/receipts retain their historical effective values.
// New installations supply the current defaults explicitly in the Server bootstrap.
export const platformPolicySchema = platformPolicyValuesSchema.extend({
  modelRequestSeconds: requestSeconds.default(30),
  maxModelRetries: retries.default(0),
  maxToolCalls: tools.default(AGENT_RUN_LIMITS.toolCalls.default),
  maxRunSeconds: seconds.default(90), version: z.number().int().nonnegative(), updatedAt: z.iso.datetime().nullable() });
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
const knowledgeCheckStatus = z.enum(['changed', 'unchanged', 'failed', 'unavailable', 'superseded']);
const knowledgeWatchId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/u);
const knowledgeCheckedAt = z.iso.datetime({ offset: true });
export const adminKnowledgeStatusSchema = z.object({
  watches: z.array(z.object({ id: knowledgeWatchId, publisher: z.string().min(1).max(160), url: z.url(), kind: z.enum(['page', 'rss', 'pdf']),
    registration: z.enum(['not_registered', 'enabled', 'disabled', 'definition_changed']), lastAttemptAt: knowledgeCheckedAt.nullable(),
    lastSuccessfulCheckAt: knowledgeCheckedAt.nullable(), lastStatus: knowledgeCheckStatus.nullable() }).strict()).max(32),
  checks: z.array(z.object({ jobId: z.uuid(), watchId: knowledgeWatchId, checkedAt: knowledgeCheckedAt,
    state: z.enum(['running', 'recorded', 'unknown']), status: knowledgeCheckStatus.nullable(), attempts: z.number().int().min(1).max(2),
    itemCount: z.number().int().min(0).max(50), changedCount: z.number().int().min(0).max(50),
    failureCode: z.enum(['network', 'timeout', 'response', 'parse']).nullable(), httpStatus: z.union([z.literal(404), z.literal(410)]).nullable() }).strict()).max(20),
  nextCursor: z.string().min(1).max(2048).nullable(),
}).strict();
export type AdminKnowledgeStatus = z.infer<typeof adminKnowledgeStatusSchema>;
