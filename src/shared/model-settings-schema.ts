import { z } from 'zod';
import { PERSONAL_DAILY_LIMIT, PERSONAL_RUN_LIMITS } from './model-settings.ts';
import { SOFT_BUDGET_RATIO_RANGE } from './agent-run-limits.ts';

const bounded = (range: { min: number; max: number }) => z.number().int().min(range.min).max(range.max);
export const personalProviderSchema = z.enum(['gemini', 'vertex', 'openai-compatible']);
export const dailyMoneyBudgetSchema = z.object({ currency: z.string().regex(/^[A-Z]{3}$/u),
  micros: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict();
export const personalEmbeddingShape = {
  embeddingProvider: z.enum(['gemini', 'vertex']).optional(),
  embeddingProject: z.string().regex(/^(?:[a-z][a-z0-9-]{4,28}[a-z0-9]|[1-9][0-9]{5,19})$/u).optional(),
  embeddingLocation: z.string().min(2).max(63).regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u).optional(),
};
export const personalModelIdSchema = z.string().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/);
export const personalBaseUrlSchema = z.string().max(512).superRefine((value, ctx) => {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
      || url.port && url.port !== '443' || !url.hostname.includes('.') || /[%\\]/.test(value))
      throw new Error('invalid');
  } catch { ctx.addIssue({ code: 'custom', message: '請輸入公開 HTTPS API 地址，不含帳密、查詢參數或其他連接埠。' }); }
}).transform(value => value.replace(/\/+$/u, ''));
export const personalAdvancedShape = {
  softBudgetRatio: z.number().finite().min(SOFT_BUDGET_RATIO_RANGE.min).max(SOFT_BUDGET_RATIO_RANGE.max).optional(),
  maxToolCalls: bounded(PERSONAL_RUN_LIMITS.toolCalls).optional(),
  maxRunSeconds: bounded(PERSONAL_RUN_LIMITS.deadlineSeconds).optional(),
  modelRequestSeconds: bounded(PERSONAL_RUN_LIMITS.modelRequestSeconds).optional(),
  maxModelRetries: bounded(PERSONAL_RUN_LIMITS.modelRetries).optional(),
};
export const publicModelSettingsSchema = z.object({
  dailyMoneyBudget: dailyMoneyBudgetSchema.optional(),
  limitPolicyVersion: z.literal(2).optional(),
  version: z.number().int().nonnegative().max(2147483647), mode: z.enum(['platform', 'personal', 'disabled']),
  provider: personalProviderSchema, model: personalModelIdSchema, keyConfigured: z.boolean(), backgroundEnabled: z.boolean(),
  baseUrl: personalBaseUrlSchema.optional(), embeddingKeyConfigured: z.boolean().optional(), ...personalEmbeddingShape,
  dailyLimit: bounded(PERSONAL_DAILY_LIMIT), maxModelCalls: bounded(PERSONAL_RUN_LIMITS.modelCalls),
  maxQueryEmbeddings: bounded(PERSONAL_RUN_LIMITS.queryEmbeddings), ...personalAdvancedShape,
  updatedAt: z.iso.datetime({ offset: true }).nullable(),
}).strict();
export const modelSettingsOperationSchema = z.object({ opId: z.uuid(), settings: publicModelSettingsSchema }).strict();
const policyLimitSourceSchema = z.enum(['personal', 'administrator', 'system_default']);
export const effectiveModelLimitsSchema = z.object({
  policyVersion: z.number().int().nonnegative(), dailyLimit: z.number().int().positive(), dailyGlobalLimit: z.number().int().positive(),
  maxModelCalls: bounded(PERSONAL_RUN_LIMITS.modelCalls), maxQueryEmbeddings: bounded(PERSONAL_RUN_LIMITS.queryEmbeddings),
  maxToolCalls: bounded(PERSONAL_RUN_LIMITS.toolCalls), maxRunSeconds: bounded(PERSONAL_RUN_LIMITS.deadlineSeconds),
  modelRequestSeconds: bounded(PERSONAL_RUN_LIMITS.modelRequestSeconds), maxModelRetries: bounded(PERSONAL_RUN_LIMITS.modelRetries),
  cappedByAdministrator: z.array(z.enum(['maxModelCalls', 'maxQueryEmbeddings', 'maxToolCalls', 'maxRunSeconds', 'modelRequestSeconds', 'maxModelRetries'])).max(6),
  softBudgetRatio: z.number().finite().min(SOFT_BUDGET_RATIO_RANGE.min).max(SOFT_BUDGET_RATIO_RANGE.max).optional(),
  softTargets: z.object({
    modelCalls: z.number().int().positive(),
    toolCalls: z.number().int().positive(),
    queryEmbeddings: z.number().int().positive(),
  }).strict().optional(),
  limitSources: z.object({
    dailyLimit: policyLimitSourceSchema,
    maxModelCalls: policyLimitSourceSchema,
    maxQueryEmbeddings: policyLimitSourceSchema,
    maxToolCalls: policyLimitSourceSchema,
    maxRunSeconds: policyLimitSourceSchema,
    modelRequestSeconds: policyLimitSourceSchema,
    maxModelRetries: policyLimitSourceSchema,
    softBudgetRatio: policyLimitSourceSchema,
  }).strict().optional(),
}).strict();
export const modelCheckReasonSchema = z.enum(['invalid_key', 'region_unavailable', 'model_unavailable', 'quota_exceeded', 'timeout', 'unavailable', 'metadata_unsupported']);
export const personalModelCatalogSchema = z.object({
  version: z.number().int().nonnegative(), provider: personalProviderSchema, scope: z.literal('model_metadata_only'),
  status: z.enum(['not_checked', 'checked', 'unavailable']), reason: modelCheckReasonSchema.optional(), truncated: z.boolean(),
  embedding: z.object({ model: z.string().min(1).max(128), dimensions: z.literal(1024), status: z.enum(['not_checked', 'unsupported']) }).strict(),
  models: z.array(z.object({ id: personalModelIdSchema, provider: personalProviderSchema, label: z.string().min(1).max(100),
    availability: z.enum(['not_checked', 'listed']), capabilities: z.object({ tools: z.boolean(), image: z.boolean(), audio: z.boolean(), textStreaming: z.boolean() }).strict() }).strict()).max(20),
}).strict();
