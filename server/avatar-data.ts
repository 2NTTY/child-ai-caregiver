import { firebaseAvatarErasureIntentSchema, firebaseErasureDescriptorSchema } from './firebase-erasure-journal.ts';
import { z } from 'zod';
import { AVATAR_VERSION_MAX, avatarAssetSchema, avatarCropSchema, avatarTargetSchema, type AvatarTarget } from '../src/shared/avatars.ts';
import { avatarAdmissionSchema, avatarRecipeSchema, avatarPolicyId } from './avatar-config.ts';
import { workRecoveryScopeSchema, type WorkRecoveryScope } from './firestore-work-continuation-recovery.ts';
import { firestoreDomainHash } from './firestore-domain-data.ts';

export const AVATAR_NIL = '00000000-0000-0000-0000-000000000000';
const uuid = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/u), at = z.iso.datetime({ offset: true });
const version = z.number().int().min(0).max(AVATAR_VERSION_MAX);
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const generation = z.string().regex(/^[1-9][0-9]{0,19}$/u).refine(value => BigInt(value) <= 18446744073709551615n);
export const avatarBindingSchema = z.object({ scope: workRecoveryScopeSchema, target: avatarTargetSchema,
  targetId: z.string().min(1).max(256) }).strict().refine(value => value.target.kind === 'self'
    ? value.scope.childId === AVATAR_NIL && value.targetId === value.scope.ownerUserId
    : value.scope.childId === value.target.childId && value.targetId === value.target.childId && value.scope.childId !== AVATAR_NIL);
export type AvatarBinding = z.infer<typeof avatarBindingSchema>;
export function avatarBinding(scope: WorkRecoveryScope, target: AvatarTarget): AvatarBinding {
  return avatarBindingSchema.parse({ scope, target, targetId: target.kind === 'self' ? scope.ownerUserId : target.childId });
}
export function avatarHeadId(binding: AvatarBinding): string {
  const value = avatarBindingSchema.parse(binding);
  return firestoreDomainHash(['avatar-head', value.scope.ownerUserId, value.scope.workspaceId, value.target.kind, value.targetId]);
}
/** One responsibility per immutable object address; never a finite array of prior restore epochs. */
export function avatarCleanupId(binding: AvatarBinding, assetId: string): string {
  return firestoreDomainHash(['avatar-cleanup', avatarBindingSchema.parse(binding), uuid.parse(assetId)]);
}
export function sameAvatarBinding(left: AvatarBinding, right: AvatarBinding): boolean {
  return firestoreDomainHash(avatarBindingSchema.parse(left)) === firestoreDomainHash(avatarBindingSchema.parse(right));
}
export const avatarObjectDescriptorSchema = z.object({
  format: z.literal('yuyoufang-avatar-object/v1'), asset: avatarAssetSchema,
  objectName: z.string().regex(/^avatars\/v1\/[a-f0-9]{64}\/[0-9a-f-]{36}$/u), generation, cipherSha256: hash,
}).strict();
export type AvatarObjectDescriptor = z.infer<typeof avatarObjectDescriptorSchema>;
export const avatarLeaseSchema = z.object({ token: uuid, authorizationVersion: z.string().min(1).max(30), childAccessVersion: z.string().min(1).max(30),
  generation: uuid, acquiredAt: at, until: at }).strict();
export const avatarUploadRecordSchema = z.object({
  id: uuid, assetId: uuid, binding: avatarBindingSchema, actorUserId: z.string().min(1).max(256), reservationOperationId: uuid,
  expectedVersion: version.max(AVATAR_VERSION_MAX - 1), createdAt: at, expiresAt: at,
  mimeType: z.enum(['image/jpeg', 'image/png']), bytes: count.min(1), sha256: hash, crop: avatarCropSchema,
  policyId: z.string().min(1).max(128), recipe: avatarRecipeSchema, admission: avatarAdmissionSchema,
  state: z.enum(['reserved', 'processing', 'ready', 'committed', 'rejected', 'expired']), lease: avatarLeaseSchema.nullable(),
  preparedAsset: avatarAssetSchema.nullable(), descriptor: avatarObjectDescriptorSchema.nullable(), committedVersion: version.min(1).nullable(),
  errorCode: z.string().regex(/^[a-z_]{1,80}$/u).nullable(),
}).strict().refine(value => value.policyId === avatarPolicyId(value.recipe)
  && value.crop.zoom <= value.recipe.maxCropZoom && value.bytes <= value.admission.maxInputBytes
  && (value.preparedAsset === null || value.preparedAsset.id === value.assetId)
  && (value.descriptor === null || value.descriptor.asset.id === value.assetId
    && value.preparedAsset !== null && firestoreDomainHash(value.preparedAsset) === firestoreDomainHash(value.descriptor.asset))
  && Date.parse(value.expiresAt) > Date.parse(value.createdAt)
  && (value.state !== 'ready' && value.state !== 'committed' || value.descriptor !== null)
  && (value.state === 'processing') === (value.lease !== null)
  && (value.state === 'committed') === (value.committedVersion !== null)
  && (value.committedVersion === null || value.committedVersion === value.expectedVersion + 1)
  && (value.state !== 'ready' && value.state !== 'committed' || value.errorCode === null));
export type AvatarUploadRecord = z.infer<typeof avatarUploadRecordSchema>;

/** Original normalized scope remains pinned while a restored cleanup obligation is unresolved. */
export const avatarCleanupRecordSchema = z.object({
  assetId: uuid, uploadId: uuid, expectedVersion: version.max(AVATAR_VERSION_MAX - 1), binding: avatarBindingSchema, objectBinding: avatarBindingSchema,
  reason: z.enum(['staging', 'expired', 'rejected', 'superseded', 'removed', 'erasure']),
  state: z.enum(['reserved', 'writing', 'known', 'unresolved', 'complete']),
  preparedAsset: avatarAssetSchema.nullable(), descriptor: avatarObjectDescriptorSchema.nullable(), writeLease: avatarLeaseSchema.nullable(),
  committedVersion: version.min(1).nullable(), attempt: count, nextAttemptAt: at,
}).strict().refine(value => value.binding.target.kind === value.objectBinding.target.kind
  && value.binding.targetId === value.objectBinding.targetId
  && value.binding.scope.ownerUserId === value.objectBinding.scope.ownerUserId
  && value.binding.scope.workspaceId === value.objectBinding.scope.workspaceId
  && value.binding.scope.childId === value.objectBinding.scope.childId
  && value.binding.scope.storageEpoch === value.objectBinding.scope.storageEpoch
  && (value.preparedAsset === null || value.preparedAsset.id === value.assetId)
  && (value.descriptor === null || value.descriptor.asset.id === value.assetId
    && value.preparedAsset !== null && firestoreDomainHash(value.preparedAsset) === firestoreDomainHash(value.descriptor.asset)));
export type AvatarCleanupRecord = z.infer<typeof avatarCleanupRecordSchema>;


export const avatarHeadRecordSchema = z.object({
  binding: avatarBindingSchema, version, descriptor: avatarObjectDescriptorSchema.nullable(), updatedAt: at.nullable(),
  reservationNonce: uuid, erasedThroughVersion: version.nullable(),
  removal: z.object({ intent: firebaseAvatarErasureIntentSchema, journal: firebaseErasureDescriptorSchema.nullable(),
    expectedVersion: version.max(AVATAR_VERSION_MAX - 1), state: z.enum(['pending', 'confirmed']) }).strict().nullable(),
}).strict().refine(value => (value.version !== 0 || value.descriptor === null && value.updatedAt === null)
  && (value.version === 0 || value.updatedAt !== null)
  && (value.erasedThroughVersion === null || value.erasedThroughVersion < value.version)
  && (value.removal === null || value.removal.intent.avatar.targetKind === value.binding.target.kind
    && value.removal.intent.avatar.targetId === value.binding.targetId
    && value.removal.intent.scope.ownerUserId === value.binding.scope.ownerUserId
    && value.removal.intent.scope.workspaceId === value.binding.scope.workspaceId
    && value.removal.intent.scope.childId === value.binding.scope.childId
    && value.removal.intent.avatar.throughVersion === value.removal.expectedVersion
    && (value.removal.state === 'pending' ? value.removal.expectedVersion === value.version : value.removal.journal !== null)));
export type AvatarHeadRecord = z.infer<typeof avatarHeadRecordSchema>;
