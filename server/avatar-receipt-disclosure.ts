import type { FirestoreAuthorityTransaction } from './firestore-authority.ts';
import { FirestoreDomainData, domainParse, domainReject, firestoreDomainHash } from './firestore-domain-data.ts';
import { avatarBinding, avatarHeadId, avatarHeadRecordSchema, avatarUploadRecordSchema, AVATAR_NIL, sameAvatarBinding } from './avatar-data.ts';
import { avatarMutationResultSchema, avatarReserveResultSchema, sameAvatarTarget } from '../src/shared/avatars.ts';
import { avatarPath } from './firebase-avatar-api.ts';

/** Historical receipts are evidence, not an alternate route around current avatar authority or erasure. */
export async function discloseAvatarReceipt(data: FirestoreDomainData, authority: FirestoreAuthorityTransaction,
  path: string, result: unknown): Promise<unknown | null> {
  const route = avatarPath(path);
  if (!route || !['uploads', 'commit', 'remove'].includes(route.action)) domainReject('avatar_integrity_failed', 503);
  if (result === null) return null;
  if (route.target.kind === 'child' && !await authority.readChild(route.target.childId)) return null;
  const binding = avatarBinding({ ...authority.scope, childId: route.target.kind === 'self' ? AVATAR_NIL : route.target.childId }, route.target);
  const id = avatarHeadId(binding), headSnapshot = await authority.transaction.get(data.ref('avatar_heads', 'avatar-head', id));
  if (!headSnapshot.exists) return null;
  const head = data.open('avatar-head', id, binding.scope, avatarHeadRecordSchema, headSnapshot);
  if (!sameAvatarBinding(head.binding, binding)) domainReject('avatar_integrity_failed', 503);
  if (head.removal?.state === 'pending') return null;
  if (route.action === 'uploads') {
    const original = domainParse(avatarReserveResultSchema, result, 'avatar_integrity_failed', 503);
    if (!sameAvatarTarget(original.upload.target, binding.target) || original.upload.state !== 'reserved') domainReject('avatar_integrity_failed', 503);
    const uploadId = original.upload.id, snapshot = await authority.transaction.get(data.ref('avatar_uploads', 'avatar-upload', uploadId));
    if (!snapshot.exists) return null;
    const upload = data.open('avatar-upload', uploadId, binding.scope, avatarUploadRecordSchema, snapshot);
    if (!sameAvatarBinding(upload.binding, binding) || upload.actorUserId !== authority.scope.ownerUserId || upload.id !== uploadId)
      return null;
    if (['expired', 'rejected', 'committed'].includes(upload.state) || upload.expectedVersion !== head.version
      || upload.expectedVersion !== original.upload.expectedVersion || upload.policyId !== original.upload.policyId
      || Date.parse(upload.expiresAt) <= Date.now()) return null;
    return original;
  }
  const original = domainParse(avatarMutationResultSchema, result, 'avatar_integrity_failed', 503);
  if (original.avatar.version !== head.version || firestoreDomainHash(original.avatar.target) !== firestoreDomainHash(binding.target)
    || firestoreDomainHash(original.avatar.asset) !== firestoreDomainHash(head.descriptor?.asset ?? null)) return null;
  return original;
}
