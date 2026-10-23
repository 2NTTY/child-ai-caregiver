import { avatarBindingSchema, avatarHeadId, avatarCleanupId, avatarHeadRecordSchema, avatarUploadRecordSchema,
  avatarCleanupRecordSchema, avatarObjectDescriptorSchema, sameAvatarBinding, type AvatarBinding } from './avatar-data.ts';
import { avatarUploadPending } from './avatar-policy.ts';
import { avatarObjectAddress } from './firebase-avatar-objects.ts';
import { firebaseErasureIntentHash } from './firebase-erasure-journal.ts';
import { FirestoreDomainData, firestoreDomainHash } from './firestore-domain-data.ts';
import { canonical } from './firestore-session-codec.ts';
import type { FirestoreRecoveryContext } from './firestore-recovery-envelope.ts';
import type { FirestoreRestoreDecoded, FirestoreRestoreTransform } from './firestore-restore-codec.ts';

export const avatarRestoreSchemas = {
  'avatar-head': { suffix: 'avatar_heads', schema: avatarHeadRecordSchema },
  'avatar-upload': { suffix: 'avatar_uploads', schema: avatarUploadRecordSchema },
  'avatar-cleanup': { suffix: 'avatar_cleanup', schema: avatarCleanupRecordSchema },
} as const;
export type AvatarRestoreKind = keyof typeof avatarRestoreSchemas;
export const isAvatarRestoreKind = (kind: string): kind is AvatarRestoreKind => Object.hasOwn(avatarRestoreSchemas, kind);
function check(value: unknown, code = 'restore_avatar_binding'): asserts value {
  if (!value) throw Object.assign(new Error('Avatar recovery rejected'), { code, status: 409 });
}
export function avatarRestoreMetadata(data: FirestoreDomainData, kind: AvatarRestoreKind, raw: unknown) {
  const value = avatarRestoreSchemas[kind].schema.parse(raw), binding = value.binding;
  const metadata: Record<string, unknown> = { ...data.tags(binding.scope),
    targetTag: firestoreDomainHash(['avatar-target', data.options.projectId, data.options.namespace, avatarHeadId(binding)]) };
  if (kind === 'avatar-upload') { const row = avatarUploadRecordSchema.parse(value);
    Object.assign(metadata, { uploadId: row.id, actorTag: firestoreDomainHash(['avatar-actor', data.options.projectId, data.options.namespace, row.actorUserId]),
      pending: avatarUploadPending(row), expiresAt: row.expiresAt }); }
  if (kind === 'avatar-cleanup') { const row = avatarCleanupRecordSchema.parse(value);
    Object.assign(metadata, { assetId: row.assetId, complete: row.state === 'complete', nextAttemptAt: row.nextAttemptAt }); }
  return metadata;
}
export function assertAvatarRestoreBinding(data: FirestoreDomainData, context: FirestoreRecoveryContext, raw: unknown,
  metadata?: Record<string, unknown>) {
  check(isAvatarRestoreKind(context.kind)); const kind = context.kind, row = avatarRestoreSchemas[kind].schema.parse(raw);
  check(context.family === 'domain' && context.envelopeVersion === 1 && context.recordVersion === 1
    && canonical(row.binding.scope) === canonical(context.scope));
  const id = kind === 'avatar-head' ? avatarHeadId(row.binding) : kind === 'avatar-upload'
    ? avatarUploadRecordSchema.parse(row).id : avatarCleanupId(row.binding, avatarCleanupRecordSchema.parse(row).assetId);
  check(context.id === id);
  if (kind === 'avatar-head') { const head = avatarHeadRecordSchema.parse(row);
    if (head.removal?.journal) check(head.removal.journal.intentSha256 === firebaseErasureIntentHash(head.removal.intent)); }
  if (metadata) for (const [name, expected] of Object.entries(avatarRestoreMetadata(data, kind, row))) check(metadata[name] === expected);
}
export function sealAvatarRestoreRecord(data: FirestoreDomainData, kind: AvatarRestoreKind, raw: unknown) {
  const row = avatarRestoreSchemas[kind].schema.parse(raw), metadata = avatarRestoreMetadata(data, kind, row);
  if (kind === 'avatar-head') { const value = avatarHeadRecordSchema.parse(row), id = avatarHeadId(value.binding);
    return { path: data.ref('avatar_heads', kind, id).path, data: { ...metadata, ...data.seal(kind, id, value.binding.scope, avatarHeadRecordSchema, value) } }; }
  if (kind === 'avatar-upload') { const value = avatarUploadRecordSchema.parse(row);
    return { path: data.ref('avatar_uploads', kind, value.id).path, data: { ...metadata, ...data.seal(kind, value.id, value.binding.scope, avatarUploadRecordSchema, value) } }; }
  const value = avatarCleanupRecordSchema.parse(row), id = avatarCleanupId(value.binding, value.assetId);
  return { path: data.ref('avatar_cleanup', kind, id).path, data: { ...metadata, ...data.seal(kind, id, value.binding.scope, avatarCleanupRecordSchema, value) } };
}
export function restoredAvatarBinding(binding: AvatarBinding, input: FirestoreRestoreTransform): AvatarBinding {
  const epoch = input.newEpochByWorkspace.get(binding.scope.workspaceId); check(epoch && epoch !== binding.scope.storageEpoch, 'restore_epoch_missing');
  return avatarBindingSchema.parse({ ...binding, scope: { ...binding.scope, storageEpoch: epoch } });
}
export function restoredAvatarDescriptor(data: FirestoreDomainData, binding: AvatarBinding,
  original: NonNullable<ReturnType<typeof avatarHeadRecordSchema.parse>['descriptor']>, input: FirestoreRestoreTransform) {
  const descriptor = input.avatarDescriptors?.get(original.asset.id); check(descriptor && input.avatarObjectBucketName, 'restore_avatar_descriptor_missing');
  const checked = avatarObjectDescriptorSchema.parse(descriptor);
  check(canonical(checked.asset) === canonical(original.asset) && checked.objectName === avatarObjectAddress({ projectId: data.options.projectId,
    namespace: data.options.namespace, bucketName: input.avatarObjectBucketName! }, binding, checked.asset.id).objectName);
  return checked;
}
export function transformAvatarRestore(data: FirestoreDomainData, decoded: FirestoreRestoreDecoded, input: FirestoreRestoreTransform) {
  check(decoded.context.family === 'domain' && isAvatarRestoreKind(decoded.context.kind));
  assertAvatarRestoreBinding(data, decoded.context, decoded.value);
  const kind = decoded.context.kind;
  // Prior immutable object responsibilities keep original AAD/scope/key, including multiple restore epochs.
  if (kind === 'avatar-cleanup') return { oldPath: decoded.path, ...sealAvatarRestoreRecord(data, kind, decoded.value) };
  if (kind === 'avatar-head') {
    const row = avatarHeadRecordSchema.parse(decoded.value), binding = restoredAvatarBinding(row.binding, input);
    check(row.removal?.state !== 'pending', 'restore_erasure_missing');
    const descriptor = row.descriptor ? restoredAvatarDescriptor(data, binding, row.descriptor, input) : null;
    return { oldPath: decoded.path, ...sealAvatarRestoreRecord(data, kind, { ...row, binding, descriptor, reservationNonce: input.generation }) };
  }
  const row = avatarUploadRecordSchema.parse(decoded.value), binding = restoredAvatarBinding(row.binding, input);
  const current = row.state === 'committed' && row.descriptor && input.avatarDescriptors?.has(row.assetId);
  const descriptor = current ? restoredAvatarDescriptor(data, binding, row.descriptor!, input) : null;
  // No unfinished reservation/lease from the prior epoch can become committable after restore.
  const value = { ...row, binding, state: current ? 'committed' : 'expired', lease: null, descriptor,
    preparedAsset: descriptor?.asset ?? null, committedVersion: current ? row.committedVersion : null,
    errorCode: current ? null : 'avatar_upload_expired' };
  return { oldPath: decoded.path, ...sealAvatarRestoreRecord(data, kind, value) };
}
