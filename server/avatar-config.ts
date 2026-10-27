import { createHash } from 'node:crypto';
import { z } from 'zod';
import { avatarPolicySchema, type AvatarPolicy } from '../src/shared/avatars.ts';

export const AVATAR_CODEC_VERSION = '0.35.5' as const;
export const AVATAR_PENDING_HARD_MAX = 8;
export const AVATAR_CLEANUP_RETRY_MS = 60_000;
export const AVATAR_CLEANUP_MAX_ATTEMPTS = 3;
const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const avatarRecipeSchema = z.object({
  format: z.literal('avatar-recipe/v1'), codec: z.literal('sharp'), codecVersion: z.literal(AVATAR_CODEC_VERSION),
  outputSize: positive.max(2048), maxOutputBytes: positive.max(4 * 1024 * 1024),
  quality: z.number().int().min(1).max(100), background: z.string().regex(/^#[0-9a-f]{6}$/u),
  maxCropZoom: z.number().finite().min(1).max(32), colourspace: z.literal('srgb'),
  chromaSubsampling: z.literal('4:2:0'), cropVersion: z.literal(1),
}).strict();
export type AvatarRecipe = z.infer<typeof avatarRecipeSchema>;
export const avatarAdmissionSchema = z.object({
  maxInputBytes: positive.max(32 * 1024 * 1024), maxInputPixels: positive.max(80_000_000),
  maxInputDimension: positive.max(32_768), maxDecodedBytes: positive.max(320_000_000),
  maxInputChannels: positive.max(4), decodeTimeoutMs: positive.max(30_000), totalTimeoutMs: positive.max(60_000),
  decodeConcurrency: positive.max(4), queueLimit: z.number().int().min(0).max(16),
  uploadTtlMs: positive.max(24 * 60 * 60 * 1000), pendingPerActorTarget: positive.max(AVATAR_PENDING_HARD_MAX),
  retryAfterSeconds: positive.max(60),
}).strict().refine(value => value.decodeTimeoutMs < value.totalTimeoutMs
  && value.maxDecodedBytes >= value.maxInputPixels * value.maxInputChannels);
export type AvatarAdmission = z.infer<typeof avatarAdmissionSchema>;
export interface AvatarConfig { writesEnabled: boolean; recipe: AvatarRecipe; admission: AvatarAdmission; policy: AvatarPolicy }

const DEFAULTS = Object.freeze({
  maxInputBytes: 8 * 1024 * 1024, maxInputPixels: 20_000_000, maxInputDimension: 12_000,
  maxInputChannels: 4, outputSize: 256, maxOutputBytes: 256 * 1024, maxCropZoom: 8, quality: 85,
  background: '#ffffff', decodeTimeoutMs: 10_000, totalTimeoutMs: 20_000, decodeConcurrency: 1,
  queueLimit: 4, uploadTtlMs: 30 * 60 * 1000, pendingPerActorTarget: 2, retryAfterSeconds: 2,
});
export function avatarPolicyId(recipeInput: AvatarRecipe): string {
  const recipe = avatarRecipeSchema.parse(recipeInput);
  return 'avatar-v1-' + createHash('sha256').update(JSON.stringify(recipe)).digest('hex');
}
export function readAvatarConfig(env: Record<string, string | undefined>): AvatarConfig {
  const number = (name: string, fallback: number) => {
    const text = env[name]; if (text === undefined) return fallback;
    if (!/^(?:0|[1-9][0-9]*)$/u.test(text)) throw new Error('Invalid avatar configuration');
    const value = Number(text); if (!Number.isSafeInteger(value)) throw new Error('Invalid avatar configuration'); return value;
  };
  if (env.AVATAR_WRITES_ENABLED !== undefined && !['true', 'false'].includes(env.AVATAR_WRITES_ENABLED)) throw new Error('Invalid avatar configuration');
  const recipe = avatarRecipeSchema.parse({ format: 'avatar-recipe/v1', codec: 'sharp', codecVersion: AVATAR_CODEC_VERSION,
    outputSize: number('AVATAR_OUTPUT_SIZE', DEFAULTS.outputSize), maxOutputBytes: number('AVATAR_MAX_OUTPUT_BYTES', DEFAULTS.maxOutputBytes),
    quality: number('AVATAR_JPEG_QUALITY', DEFAULTS.quality), background: env.AVATAR_BACKGROUND ?? DEFAULTS.background,
    maxCropZoom: number('AVATAR_MAX_CROP_ZOOM', DEFAULTS.maxCropZoom), colourspace: 'srgb', chromaSubsampling: '4:2:0', cropVersion: 1 });
  const maxInputPixels = number('AVATAR_MAX_INPUT_PIXELS', DEFAULTS.maxInputPixels);
  const admission = avatarAdmissionSchema.parse({ maxInputBytes: number('AVATAR_MAX_INPUT_BYTES', DEFAULTS.maxInputBytes),
    maxInputPixels, maxInputDimension: number('AVATAR_MAX_INPUT_DIMENSION', DEFAULTS.maxInputDimension),
    maxInputChannels: DEFAULTS.maxInputChannels, maxDecodedBytes: maxInputPixels * DEFAULTS.maxInputChannels,
    decodeTimeoutMs: number('AVATAR_DECODE_TIMEOUT_MS', DEFAULTS.decodeTimeoutMs), totalTimeoutMs: number('AVATAR_TOTAL_TIMEOUT_MS', DEFAULTS.totalTimeoutMs),
    decodeConcurrency: number('AVATAR_DECODE_CONCURRENCY', DEFAULTS.decodeConcurrency), queueLimit: number('AVATAR_QUEUE_LIMIT', DEFAULTS.queueLimit),
    uploadTtlMs: number('AVATAR_UPLOAD_TTL_MS', DEFAULTS.uploadTtlMs), pendingPerActorTarget: number('AVATAR_PENDING_PER_ACTOR_TARGET', DEFAULTS.pendingPerActorTarget),
    retryAfterSeconds: number('AVATAR_RETRY_AFTER_SECONDS', DEFAULTS.retryAfterSeconds) });
  const policy = avatarPolicySchema.parse({ policyId: avatarPolicyId(recipe), acceptedMimeTypes: ['image/jpeg', 'image/png'],
    maxInputBytes: admission.maxInputBytes, maxInputPixels: admission.maxInputPixels, maxInputDimension: admission.maxInputDimension,
    outputSize: recipe.outputSize, maxOutputBytes: recipe.maxOutputBytes, maxCropZoom: recipe.maxCropZoom });
  return Object.freeze({ writesEnabled: env.AVATAR_WRITES_ENABLED === 'true', recipe: Object.freeze(recipe), admission: Object.freeze(admission), policy: Object.freeze(policy) });
}

/** Request/page sizing only: never a total avatar or restore-job population cap. */
export const avatarRecoveryBatchSchema = z.object({
  scanPageSize: positive.max(500), handoffBatchSize: positive.max(80), handoffBatchBytes: positive.max(2 * 1024 * 1024),
}).strict();
export type AvatarRecoveryBatch = z.infer<typeof avatarRecoveryBatchSchema>;
export function readAvatarRecoveryBatchConfig(env: Record<string, string | undefined>): AvatarRecoveryBatch {
  const number = (name: string, fallback: number) => {
    const raw = env[name]; if (raw === undefined) return fallback;
    if (!/^[1-9][0-9]*$/u.test(raw) || !Number.isSafeInteger(Number(raw))) throw new Error('Invalid avatar recovery batch configuration');
    return Number(raw);
  };
  return avatarRecoveryBatchSchema.parse({ scanPageSize: number('AVATAR_RECOVERY_SCAN_PAGE_SIZE', 100),
    handoffBatchSize: number('AVATAR_RECOVERY_HANDOFF_BATCH_SIZE', 32),
    handoffBatchBytes: number('AVATAR_RECOVERY_HANDOFF_BATCH_BYTES', 512 * 1024) });
}
