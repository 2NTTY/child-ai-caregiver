import { z } from "zod";

/** Wire bounds only. Admission limits and recipe defaults belong to server/avatar-config.ts. */
export const AVATAR_VERSION_MAX = 2147483647;
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const positiveCount = count.min(1);
const version = z.number().int().min(0).max(AVATAR_VERSION_MAX);
const basisVersion = version.max(AVATAR_VERSION_MAX - 1);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const timestamp = z.iso.datetime({ offset: true });
const policyId = z.string().min(1).max(128).regex(/^[A-Za-z0-9_.:-]+$/u);

export const avatarTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("self") }).strict(),
  z.object({ kind: z.literal("child"), childId: z.uuid() }).strict(),
]);
export type AvatarTarget = z.infer<typeof avatarTargetSchema>;

export const avatarCropSchema = z.object({
  centerX: z.number().finite().min(0).max(1),
  centerY: z.number().finite().min(0).max(1),
  zoom: z.number().finite().min(1),
}).strict();
export type AvatarCrop = z.infer<typeof avatarCropSchema>;

export const avatarAssetSchema = z.object({
  id: z.uuid(), mimeType: z.literal("image/jpeg"), bytes: positiveCount, sha256,
  width: positiveCount, height: positiveCount,
}).strict().refine(value => value.width === value.height);
export type AvatarAsset = z.infer<typeof avatarAssetSchema>;

export const avatarStateSchema = z.object({
  target: avatarTargetSchema, version, asset: avatarAssetSchema.nullable(),
  updatedAt: timestamp.nullable(), canManage: z.boolean(),
}).strict().refine(value => value.version === 0
  ? value.asset === null && value.updatedAt === null
  : value.updatedAt !== null);
export type AvatarState = z.infer<typeof avatarStateSchema>;

export const avatarPolicySchema = z.object({
  policyId, acceptedMimeTypes: z.array(z.enum(["image/jpeg", "image/png"])).min(1).max(2),
  maxInputBytes: positiveCount, maxInputPixels: positiveCount, maxInputDimension: positiveCount,
  outputSize: positiveCount, maxOutputBytes: positiveCount, maxCropZoom: z.number().finite().min(1),
}).strict().refine(value => new Set(value.acceptedMimeTypes).size === value.acceptedMimeTypes.length);
export type AvatarPolicy = z.infer<typeof avatarPolicySchema>;

export const avatarReserveInputSchema = z.object({
  expectedVersion: basisVersion, policyId, mimeType: z.enum(["image/jpeg", "image/png"]),
  bytes: positiveCount, sha256, crop: avatarCropSchema,
}).strict();
export type AvatarReserveInput = z.infer<typeof avatarReserveInputSchema>;

/** A reserve must also be checked against the exact policy returned by this server. */
export function avatarReserveInputForPolicy(policy: AvatarPolicy) {
  const checked = avatarPolicySchema.parse(policy);
  return avatarReserveInputSchema.refine(value => value.policyId === checked.policyId
    && checked.acceptedMimeTypes.includes(value.mimeType) && value.bytes <= checked.maxInputBytes
    && value.crop.zoom <= checked.maxCropZoom);
}

export const avatarUploadSchema = z.object({
  id: z.uuid(), target: avatarTargetSchema, expectedVersion: basisVersion, policyId,
  state: z.enum(["reserved", "processing", "ready", "committed", "rejected", "expired"]),
  expiresAt: timestamp, normalized: avatarAssetSchema.nullable(),
  errorCode: z.string().min(1).max(80).regex(/^[a-z_]+$/u).nullable(),
}).strict().refine(value => value.state === "ready" || value.state === "committed"
  ? value.normalized !== null && value.errorCode === null
  : value.normalized === null);
export type AvatarUpload = z.infer<typeof avatarUploadSchema>;

export const avatarCommitInputSchema = z.object({ uploadId: z.uuid(), expectedVersion: basisVersion }).strict();
export type AvatarCommitInput = z.infer<typeof avatarCommitInputSchema>;
export const avatarRemoveInputSchema = z.object({ expectedVersion: basisVersion, confirmRemove: z.literal(true) }).strict();
export type AvatarRemoveInput = z.infer<typeof avatarRemoveInputSchema>;

export const avatarReadResultSchema = z.object({ avatar: avatarStateSchema, policy: avatarPolicySchema }).strict();
export type AvatarReadResult = z.infer<typeof avatarReadResultSchema>;
export const avatarReserveResultSchema = z.object({ upload: avatarUploadSchema }).strict();
export type AvatarReserveResult = z.infer<typeof avatarReserveResultSchema>;
export const avatarMutationResultSchema = z.object({ avatar: avatarStateSchema, cleanupPending: z.boolean() }).strict();
export type AvatarMutationResult = z.infer<typeof avatarMutationResultSchema>;

export const avatarContentInputSchema = z.object({ base64: z.string().min(4).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u) }).strict();
export const avatarContentQuerySchema = z.object({ assetId: z.uuid(), version: version.min(1) }).strict();

export const AVATAR_ERROR_CODES = Object.freeze([
  "avatar_policy_changed", "avatar_version_conflict", "avatar_upload_expired", "avatar_upload_not_ready",
  "avatar_input_too_large", "avatar_unsupported_format", "avatar_invalid_image", "avatar_decode_limit",
  "avatar_busy", "avatar_integrity_failed", "avatar_unavailable",
] as const);
export type AvatarErrorCode = typeof AVATAR_ERROR_CODES[number];

export function sameAvatarTarget(left: AvatarTarget, right: AvatarTarget): boolean {
  return left.kind === right.kind && (left.kind === "self" || right.kind === "child" && left.childId === right.childId);
}
