import { randomUUID } from 'node:crypto';
import { avatarReserveInputSchema } from '../src/shared/avatars.ts';
import { avatarCleanupRecordSchema, avatarUploadRecordSchema, type AvatarBinding } from './avatar-data.ts';
import { avatarAdmissionPlan, assertAvatarHeadWritable, avatarPublicUpload } from './avatar-policy.ts';
import type { AvatarConfig } from './avatar-config.ts';
import type { FirestoreAvatarData } from './firestore-avatar-data.ts';
import type { FirestoreAuthorityTransaction } from './firestore-authority.ts';
import { domainParse, domainReject } from './firestore-domain-data.ts';
import { checkedAttachmentImportStage, type AttachmentImportStage } from './handover-attachment-stage.ts';

/** All reads precede all writes. The caller commits this plan with the existing online receipt. */
export async function prepareAvatarReservation(store: FirestoreAvatarData, authority: FirestoreAuthorityTransaction,
  binding: AvatarBinding, raw: unknown, operationId: string, config: AvatarConfig, now: number,
  ids: { uploadId: string; assetId: string }, importStage?: AttachmentImportStage) {
  if (!config.writesEnabled) domainReject('avatar_unavailable', 503);
  const input = domainParse(avatarReserveInputSchema, raw);
  if (importStage) checkedAttachmentImportStage(authority, importStage);
  if (input.policyId !== config.policy.policyId) domainReject('avatar_policy_changed');
  if (input.bytes > config.admission.maxInputBytes) domainReject('avatar_input_too_large', 413);
  if (input.crop.zoom > config.recipe.maxCropZoom) domainReject('avatar_invalid_image', 422);
  const head = await store.head(authority, binding);
  assertAvatarHeadWritable(head, input.expectedVersion);
  const rows = await store.pending(authority, binding, authority.actorUserId);
  const plan = avatarAdmissionPlan(rows, authority.actorUserId, head, now, config.admission.pendingPerActorTarget);
  if (plan.pending >= config.admission.pendingPerActorTarget) domainReject('avatar_busy', 429);
  const expiryWrites: (() => unknown)[] = [];
  for (const expired of plan.expired) {
    const cleanup = await store.cleanup(authority, binding, expired.assetId);
    if (!cleanup || cleanup.uploadId !== expired.id || cleanup.reason !== 'staging') domainReject('avatar_integrity_failed', 503);
    // Reserved with no prepared descriptor/lease proves no object write could have started.
    const neverWritten = cleanup.state === 'reserved' && cleanup.preparedAsset === null && cleanup.writeLease === null;
    expiryWrites.push(store.prepareUpload(authority, expired), store.prepareCleanup(authority, { ...cleanup, reason: 'expired',
      state: neverWritten ? 'complete' : cleanup.descriptor ? 'known' : 'unresolved', nextAttemptAt: new Date(now).toISOString() }));
  }
  const createdAt = new Date(now).toISOString(), expiresAt = new Date(now + config.admission.uploadTtlMs).toISOString();
  const upload = avatarUploadRecordSchema.parse({ id: ids.uploadId, assetId: ids.assetId, binding,
    actorUserId: authority.actorUserId, reservationOperationId: operationId, ...input, createdAt, expiresAt,
    ...(importStage ? { importStage } : {}),
    recipe: config.recipe, admission: config.admission, state: 'reserved', lease: null, preparedAsset: null, descriptor: null,
    committedVersion: null, errorCode: null });
  const cleanup = avatarCleanupRecordSchema.parse({ assetId: ids.assetId, uploadId: ids.uploadId, expectedVersion: input.expectedVersion, binding, objectBinding: binding,
    reason: 'staging', state: 'reserved', preparedAsset: null, descriptor: null, writeLease: null, committedVersion: null,
    attempt: 0, nextAttemptAt: expiresAt });
  // Every reserve touches the same head, so concurrent empty-query reads cannot both bypass the cap.
  // No public version, asset, updatedAt or child-change/background event is changed by this nonce.
  const headWrite = store.prepareHead(authority, { ...head, reservationNonce: randomUUID() });
  const uploadWrite = store.prepareUpload(authority, upload, true), cleanupWrite = store.prepareCleanup(authority, cleanup, true);
  return { result: { upload: avatarPublicUpload(upload) }, commit() {
    for (const write of expiryWrites) write(); headWrite(); uploadWrite(); cleanupWrite();
  } };
}
