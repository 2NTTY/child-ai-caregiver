import { createHash } from 'node:crypto';
import { AVATAR_VERSION_MAX, avatarStateSchema, avatarUploadSchema, type AvatarAsset, type AvatarState, type AvatarUpload } from '../src/shared/avatars.ts';
import { avatarHeadRecordSchema, avatarUploadRecordSchema, sameAvatarBinding, type AvatarHeadRecord, type AvatarUploadRecord } from './avatar-data.ts';
import { AVATAR_PENDING_HARD_MAX } from './avatar-config.ts';
import { domainReject, firestoreDomainHash } from './firestore-domain-data.ts';

/** Fixed schema maximum bounds the query even when an operator lowers the active admission cap. */
export const AVATAR_PENDING_SCAN_LIMIT = AVATAR_PENDING_HARD_MAX + 1;
export function avatarUploadPending(row: AvatarUploadRecord): boolean {
  return row.state === 'reserved' || row.state === 'processing' || row.state === 'ready';
}
export function expireAvatarUpload(rowInput: AvatarUploadRecord, now: number): AvatarUploadRecord {
  const row = avatarUploadRecordSchema.parse(rowInput);
  // An unknown native/storage outcome is never reopened or freed by TTL. Recovery must establish its terminal outcome.
  if ((row.state === 'reserved' || row.state === 'ready') && Date.parse(row.expiresAt) <= now)
    return avatarUploadRecordSchema.parse({ ...row, state: 'expired', errorCode: 'avatar_upload_expired', lease: null });
  return row;
}
export function avatarAdmissionPlan(rows: readonly AvatarUploadRecord[], actorUserId: string,
  head: AvatarHeadRecord, now: number, cap: number): { expired: AvatarUploadRecord[]; pending: number } {
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isInteger(cap) || cap < 1 || cap > AVATAR_PENDING_HARD_MAX || rows.length >= AVATAR_PENDING_SCAN_LIMIT)
    domainReject('avatar_integrity_failed', 503);
  const seen = new Set<string>(), expired: AvatarUploadRecord[] = []; let pending = 0;
  for (const raw of rows) {
    const row = avatarUploadRecordSchema.parse(raw);
    if (!sameAvatarBinding(row.binding, head.binding) || row.actorUserId !== actorUserId || !avatarUploadPending(row) || seen.has(row.id))
      domainReject('avatar_integrity_failed', 503);
    seen.add(row.id);
    const current = expireAvatarUpload(row, now);
    if (current.state === 'expired') expired.push(current); else pending++;
  }
  // Caller may commit expiry maintenance before returning busy; it must never silently allow an extra reservation.
  return { expired, pending };
}
export function assertAvatarHeadWritable(head: AvatarHeadRecord, expectedVersion: number) {
  if (head.removal?.state === 'pending') domainReject('avatar_unavailable', 503);
  if (head.version !== expectedVersion || head.version >= AVATAR_VERSION_MAX) domainReject('avatar_version_conflict');
}
export function assertAvatarInput(row: AvatarUploadRecord, bytes: Buffer) {
  if (!Buffer.isBuffer(bytes) || bytes.length !== row.bytes || createHash('sha256').update(bytes).digest('hex') !== row.sha256)
    domainReject('avatar_integrity_failed', 503);
}
export function avatarPublicState(headInput: AvatarHeadRecord, canManage: boolean): AvatarState {
  const head = avatarHeadRecordSchema.parse(headInput);
  // Pending independent-journal work is not allowed to disclose the old image while deletion is uncertain.
  if (head.removal?.state === 'pending') domainReject('avatar_unavailable', 503);
  return avatarStateSchema.parse({ target: head.binding.target, version: head.version, asset: head.descriptor?.asset ?? null,
    updatedAt: head.updatedAt, canManage });
}
export function avatarPublicUpload(rowInput: AvatarUploadRecord): AvatarUpload {
  const row = avatarUploadRecordSchema.parse(rowInput);
  return avatarUploadSchema.parse({ id: row.id, target: row.binding.target, expectedVersion: row.expectedVersion, policyId: row.policyId,
    state: row.state, expiresAt: row.expiresAt, normalized: row.state === 'ready' || row.state === 'committed' ? row.descriptor!.asset : null,
    errorCode: row.errorCode });
}
export function assertPreparedAvatar(row: AvatarUploadRecord, asset: AvatarAsset) {
  if (asset.id !== row.assetId || asset.width !== row.recipe.outputSize || asset.height !== row.recipe.outputSize
    || asset.bytes > row.recipe.maxOutputBytes || asset.mimeType !== 'image/jpeg'
    || row.preparedAsset !== null && firestoreDomainHash(row.preparedAsset) !== firestoreDomainHash(asset))
    domainReject('avatar_integrity_failed', 503);
}
