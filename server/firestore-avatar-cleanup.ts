import { createFirestoreAvatarData } from './firestore-avatar-data.ts';
import { avatarBindingSchema, avatarCleanupRecordSchema, sameAvatarBinding, type AvatarBinding, type AvatarCleanupRecord } from './avatar-data.ts';
import { AVATAR_CLEANUP_MAX_ATTEMPTS, AVATAR_CLEANUP_RETRY_MS } from './avatar-config.ts';
import { erasureCoversAvatar, firebaseErasureIntentHash, type FirebaseErasureIntent, type FirebaseErasureDescriptor, type FirebaseErasureJournal } from './firebase-erasure-journal.ts';
import { domainReject, firestoreDomainHash, type FirestoreDomainOptions } from './firestore-domain-data.ts';
import type { AvatarObjects } from './firebase-avatar-objects.ts';

type CleanupResult = { state: 'complete' | 'retained' | 'unknown'; nextAt?: string };
/** Trusted lifecycle port. No identity/client input grants physical deletion authority. */
export function createFirestoreAvatarCleanup(options: FirestoreDomainOptions & { objects: Pick<AvatarObjects, 'inspect' | 'remove'>;
  journal: Pick<FirebaseErasureJournal, 'read'>; serverClock?: () => number }) {
  const store = createFirestoreAvatarData(options), now = options.serverClock ?? Date.now;
  const same = (left: unknown, right: unknown) => firestoreDomainHash(left) === firestoreDomainHash(right);
  const nextAt = (attempt: number) => new Date(now() + AVATAR_CLEANUP_RETRY_MS * Math.max(1, attempt)).toISOString();
  function covered(intent: FirebaseErasureIntent, row: AvatarCleanupRecord, expectedVersion?: number) {
    return erasureCoversAvatar(intent, { scope: row.binding.scope, targetKind: row.binding.target.kind, targetId: row.binding.targetId,
      committedVersion: row.committedVersion, expectedVersion: expectedVersion ?? row.expectedVersion });
  }
  async function process(bindingInput: AvatarBinding, assetId: string, erasure?: FirebaseErasureIntent): Promise<CleanupResult> {
    const binding = avatarBindingSchema.parse(bindingInput);
    const first = await options.database.runTransaction(async tx => {
      const b = { transaction: tx }, row = await store.cleanup(b, binding, assetId);
      if (!row) return { result: { state: 'complete' as const } };
      const head = await store.lifecycleHead(b, binding), upload = await store.lifecycleUpload(b, binding, row.uploadId);
      if (row.state === 'complete') return { result: { state: 'complete' as const } };
      if (erasure && !covered(erasure, row, upload?.expectedVersion)) return { result: { state: 'retained' as const } };
      const current = Boolean(head?.descriptor && sameAvatarBinding(head.binding, row.objectBinding)
        && row.descriptor && same(head.descriptor, row.descriptor));
      if (current && !erasure) return { result: { state: 'retained' as const } };
      if (current && (!row.descriptor || !same(row.descriptor, head!.descriptor) || row.committedVersion !== head!.version)) domainReject('avatar_integrity_failed', 503);
      if (!erasure && row.reason === 'staging') {
        if (!upload) domainReject('avatar_integrity_failed', 503);
        if (upload.state === 'processing' && (upload.preparedAsset === null || row.preparedAsset === null)) {
          // Lease expiry permits a CAS attempt, not TTL-only release. Both rows are the same rows
          // the original worker must reread/prepare atomically before its first Storage I/O.
          if (!upload.lease || !row.writeLease || !same(upload.lease, row.writeLease)
            || upload.id !== row.uploadId || upload.assetId !== row.assetId || upload.expectedVersion !== row.expectedVersion
            || !sameAvatarBinding(upload.binding, row.objectBinding) || row.state !== 'reserved'
            || upload.preparedAsset !== null || upload.descriptor !== null || row.preparedAsset !== null || row.descriptor !== null
            || head?.descriptor?.asset.id === row.assetId && sameAvatarBinding(head.binding, row.objectBinding))
            domainReject('avatar_integrity_failed', 503);
          if (Date.parse(upload.lease.until) > now()) return { result: { state: 'retained' as const, nextAt: upload.lease.until } };
          const uploadWrite = store.prepareUpload(b, { ...upload, state: 'expired', lease: null, errorCode: 'avatar_upload_expired' });
          const cleanupWrite = store.prepareCleanup(b, { ...row, state: 'complete', reason: 'expired', writeLease: null,
            attempt: row.attempt + 1, nextAttemptAt: new Date(now()).toISOString() });
          uploadWrite(); cleanupWrite();
          // A lost transaction acknowledgement is not success: the caller must read back this original pair.
          // This does not touch process-local codec/ingress admission, which remains held until real close.
          return { result: { state: 'complete' as const } };
        }
        if (Date.parse(upload.expiresAt) > now()) return { result: { state: 'retained' as const, nextAt: upload.expiresAt } };
      }
      const untouched = row.preparedAsset === null && row.descriptor === null;
      const reason = erasure ? 'erasure' as const : row.reason === 'staging' ? 'expired' as const : row.reason;
      const next = avatarCleanupRecordSchema.parse({ ...row, reason, state: untouched ? 'complete' : row.descriptor ? 'known' : 'unresolved',
        attempt: row.attempt + 1, nextAttemptAt: nextAt(row.attempt + 1) });
      const writes = [store.prepareCleanup(b, next)];
      if (upload && upload.state !== 'committed' && (erasure || upload.state !== 'processing')) writes.push(store.prepareUpload(b,
        { ...upload, state: reason === 'expired' ? 'expired' : 'rejected', lease: null, errorCode: reason === 'expired' ? 'avatar_upload_expired' : 'avatar_version_conflict' }));
      for (const write of writes) write();
      return untouched ? { result: { state: 'complete' as const } } : { row: next };
    });
    if ('result' in first) return first.result!;
    let row = first.row!;
    if (!row.descriptor) {
      if (!row.preparedAsset) domainReject('avatar_integrity_failed', 503);
      const descriptor = await options.objects.inspect(row.objectBinding, row.assetId, row.preparedAsset);
      if (!descriptor) return { state: 'unknown', ...(row.attempt < AVATAR_CLEANUP_MAX_ATTEMPTS ? { nextAt: row.nextAttemptAt } : {}) };
      row = await options.database.runTransaction(async tx => {
        const b = { transaction: tx }, fresh = await store.cleanup(b, binding, row.assetId);
        if (!fresh || !same(fresh, row)) domainReject('avatar_upload_not_ready');
        const next = avatarCleanupRecordSchema.parse({ ...fresh, state: 'known', descriptor });
        store.prepareCleanup(b, next)(); return next;
      });
    }
    // Fresh head check immediately before deletion prevents stale cleanup from deleting a newly current image.
    await options.database.runTransaction(async tx => {
      const b = { transaction: tx }, current = await store.cleanup(b, binding, row.assetId), head = await store.lifecycleHead(b, binding);
      const upload = await store.lifecycleUpload(b, binding, row.uploadId);
      if (!current || !same(current, row)) domainReject('avatar_upload_not_ready');
      if (head?.descriptor && sameAvatarBinding(head.binding, row.objectBinding) && same(head.descriptor, row.descriptor) && (!erasure || !covered(erasure, row, upload?.expectedVersion))) domainReject('avatar_version_conflict');
      // An expired staged upload is made terminal before deleting its object, so a concurrent commit cannot use it.
      if (upload && ['reserved', 'processing', 'ready'].includes(upload.state)) store.prepareUpload(b,
        { ...upload, state: 'expired', lease: null, errorCode: 'avatar_upload_expired', preparedAsset: row.preparedAsset, descriptor: row.descriptor })();
    });
    await options.objects.remove(row.objectBinding, row.descriptor!);
    return options.database.runTransaction(async tx => {
      const b = { transaction: tx }, fresh = await store.cleanup(b, binding, row.assetId), head = await store.lifecycleHead(b, binding);
      if (!fresh || !same(fresh, row)) domainReject('avatar_upload_not_ready');
      if (head?.descriptor && sameAvatarBinding(head.binding, row.objectBinding) && same(head.descriptor, row.descriptor) && !erasure) domainReject('avatar_version_conflict');
      store.prepareCleanup(b, { ...fresh, state: 'complete' })();
      return { state: 'complete' as const };
    });
  }
  return {
    process,
    async eraseForScope(binding: AvatarBinding, assetId: string, intent: FirebaseErasureIntent, proof: FirebaseErasureDescriptor): Promise<boolean> {
      if (!['account-delete', 'child-delete', 'avatar-delete'].includes(intent.type)
        || proof.intentSha256 !== firebaseErasureIntentHash(intent) || !same(await options.journal.read(intent, proof), intent)) domainReject('avatar_integrity_failed', 503);
      const evidence = await options.database.runTransaction(tx => store.cleanup({ transaction: tx }, binding, assetId));
      if (!evidence) domainReject('avatar_integrity_failed', 503);
      const result = await process(binding, assetId, intent);
      return result.state === 'complete' || result.state === 'retained';
    },
  };
}
export type FirestoreAvatarCleanup = ReturnType<typeof createFirestoreAvatarCleanup>;
