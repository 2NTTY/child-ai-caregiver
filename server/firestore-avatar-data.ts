import { openRecoveryEnvelope } from './firestore-recovery-envelope.ts';
import { randomUUID } from 'node:crypto';
import type { DocumentSnapshot } from '@google-cloud/firestore';
import type { FirestoreAuthorityTransaction } from './firestore-authority.ts';
import { FirestoreDomainData, domainReject, firestoreDomainHash, type FirestoreDomainOptions } from './firestore-domain-data.ts';
import { avatarBindingSchema, avatarHeadId, avatarCleanupId, avatarHeadRecordSchema, avatarUploadRecordSchema, avatarCleanupRecordSchema,
  sameAvatarBinding, type AvatarBinding, type AvatarHeadRecord, type AvatarUploadRecord, type AvatarCleanupRecord } from './avatar-data.ts';
import { AVATAR_PENDING_SCAN_LIMIT, avatarUploadPending } from './avatar-policy.ts';

/** Encrypted rows only; authority and state-machine callers retain responsibility for business admission. */
type AvatarTransaction = Pick<FirestoreAuthorityTransaction, 'transaction'>;
export function createFirestoreAvatarData(options: FirestoreDomainOptions) {
  const data = new FirestoreDomainData(options);
  const targetTag = (binding: AvatarBinding) => firestoreDomainHash(['avatar-target', options.projectId, options.namespace, avatarHeadId(binding)]);
  const actorTag = (actor: string) => firestoreDomainHash(['avatar-actor', options.projectId, options.namespace, actor]);
  function tags(binding: AvatarBinding) { return { ...data.tags(binding.scope), targetTag: targetTag(binding) }; }
  function assertTags(snapshot: DocumentSnapshot, binding: AvatarBinding) {
    for (const [key, value] of Object.entries(tags(binding))) if (snapshot.get(key) !== value) domainReject('avatar_integrity_failed', 503);
  }
  function openUpload(snapshot: DocumentSnapshot, binding: AvatarBinding, id: string) {
    assertTags(snapshot, binding);
    const value = data.open('avatar-upload', id, binding.scope, avatarUploadRecordSchema, snapshot);
    if (value.id !== id || !sameAvatarBinding(value.binding, binding) || snapshot.get('uploadId') !== id
      || snapshot.get('actorTag') !== actorTag(value.actorUserId) || snapshot.get('pending') !== avatarUploadPending(value)
      || snapshot.get('expiresAt') !== value.expiresAt) domainReject('avatar_integrity_failed', 503);
    return value;
  }
  return {
    data, tags,
    async head(authority: AvatarTransaction, bindingInput: AvatarBinding): Promise<AvatarHeadRecord> {
      const binding = avatarBindingSchema.parse(bindingInput), id = avatarHeadId(binding);
      const snapshot = await authority.transaction.get(data.ref('avatar_heads', 'avatar-head', id));
      if (!snapshot.exists) return avatarHeadRecordSchema.parse({ binding, version: 0, descriptor: null, updatedAt: null,
        reservationNonce: randomUUID(), erasedThroughVersion: null, removal: null });
      assertTags(snapshot, binding);
      const value = data.open('avatar-head', id, binding.scope, avatarHeadRecordSchema, snapshot);
      if (!sameAvatarBinding(value.binding, binding)) domainReject('avatar_integrity_failed', 503);
      return value;
    },
    async upload(authority: AvatarTransaction, binding: AvatarBinding, id: string): Promise<AvatarUploadRecord | null> {
      const snapshot = await authority.transaction.get(data.ref('avatar_uploads', 'avatar-upload', id));
      return snapshot.exists ? openUpload(snapshot, binding, id) : null;
    },
    async cleanup(authority: AvatarTransaction, binding: AvatarBinding, assetId: string): Promise<AvatarCleanupRecord | null> {
      const id = avatarCleanupId(binding, assetId), snapshot = await authority.transaction.get(data.ref('avatar_cleanup', 'avatar-cleanup', id));
      if (!snapshot.exists) return null;
      assertTags(snapshot, binding);
      const value = data.open('avatar-cleanup', id, binding.scope, avatarCleanupRecordSchema, snapshot);
      if (!sameAvatarBinding(value.binding, binding) || value.assetId !== assetId || snapshot.get('assetId') !== assetId
        || snapshot.get('complete') !== (value.state === 'complete') || snapshot.get('nextAttemptAt') !== value.nextAttemptAt)
        domainReject('avatar_integrity_failed', 503);
      return value;
    },
    /** Lifecycle-only read: head keys survive epoch rotation, but original object obligations retain their old binding. */
    async lifecycleHead(authority: AvatarTransaction, binding: AvatarBinding): Promise<AvatarHeadRecord | null> {
      const id = avatarHeadId(binding), snapshot = await authority.transaction.get(data.ref('avatar_heads', 'avatar-head', id));
      if (!snapshot.exists) return null;
      const body = snapshot.data()!, opened = openRecoveryEnvelope({ ...options, locator: body.recovery,
        envelope: { family: 'domain', version: body.version, recordVersion: body.recordVersion, ciphertext: body.ciphertext } });
      const value = avatarHeadRecordSchema.parse(opened.value);
      if (opened.context.kind !== 'avatar-head' || opened.context.id !== id || avatarHeadId(value.binding) !== id
        || !sameAvatarBinding({ ...value.binding, scope: opened.context.scope }, value.binding)) domainReject('avatar_integrity_failed', 503);
      assertTags(snapshot, value.binding); return value;
    },
    async lifecycleUpload(authority: AvatarTransaction, binding: AvatarBinding, id: string): Promise<AvatarUploadRecord | null> {
      const snapshot = await authority.transaction.get(data.ref('avatar_uploads', 'avatar-upload', id));
      if (!snapshot.exists) return null;
      const body = snapshot.data()!, opened = openRecoveryEnvelope({ ...options, locator: body.recovery,
        envelope: { family: 'domain', version: body.version, recordVersion: body.recordVersion, ciphertext: body.ciphertext } });
      const value = avatarUploadRecordSchema.parse(opened.value);
      if (opened.context.kind !== 'avatar-upload' || opened.context.id !== id || value.id !== id
        || avatarHeadId(value.binding) !== avatarHeadId(binding)) domainReject('avatar_integrity_failed', 503);
      // An old cleanup obligation must never terminalize a new-epoch upload row.
      return sameAvatarBinding(value.binding, binding) ? openUpload(snapshot, binding, id) : null;
    },
    async pending(authority: AvatarTransaction, binding: AvatarBinding, actor: string): Promise<AvatarUploadRecord[]> {
      const rows = await authority.transaction.get(data.collection('avatar_uploads').where('targetTag', '==', targetTag(binding))
        .where('epochTag', '==', data.tags(binding.scope).epochTag).where('actorTag', '==', actorTag(actor))
        .where('pending', '==', true).limit(AVATAR_PENDING_SCAN_LIMIT));
      return rows.docs.map(snapshot => openUpload(snapshot, binding, String(snapshot.get('uploadId'))));
    },
    prepareHead(authority: AvatarTransaction, rowInput: AvatarHeadRecord) {
      const row = avatarHeadRecordSchema.parse(rowInput), id = avatarHeadId(row.binding);
      const envelope = { ...tags(row.binding), ...data.seal('avatar-head', id, row.binding.scope, avatarHeadRecordSchema, row) };
      return () => authority.transaction.set(data.ref('avatar_heads', 'avatar-head', id), envelope);
    },
    prepareUpload(authority: AvatarTransaction, rowInput: AvatarUploadRecord, create = false) {
      const row = avatarUploadRecordSchema.parse(rowInput);
      const envelope = { ...tags(row.binding), uploadId: row.id, actorTag: actorTag(row.actorUserId), pending: avatarUploadPending(row), expiresAt: row.expiresAt,
        ...data.seal('avatar-upload', row.id, row.binding.scope, avatarUploadRecordSchema, row) };
      return () => {
        const ref = data.ref('avatar_uploads', 'avatar-upload', row.id);
        if (create) authority.transaction.create(ref, envelope); else authority.transaction.set(ref, envelope);
      };
    },
    prepareCleanup(authority: AvatarTransaction, rowInput: AvatarCleanupRecord, create = false) {
      const row = avatarCleanupRecordSchema.parse(rowInput), id = avatarCleanupId(row.binding, row.assetId);
      const envelope = { ...tags(row.binding), assetId: row.assetId, complete: row.state === 'complete', nextAttemptAt: row.nextAttemptAt,
        ...data.seal('avatar-cleanup', id, row.binding.scope, avatarCleanupRecordSchema, row) };
      return () => {
        const ref = data.ref('avatar_cleanup', 'avatar-cleanup', id);
        if (create) authority.transaction.create(ref, envelope); else authority.transaction.set(ref, envelope);
      };
    },
  };
}
export type FirestoreAvatarData = ReturnType<typeof createFirestoreAvatarData>;
