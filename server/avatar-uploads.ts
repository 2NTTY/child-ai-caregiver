import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AvatarTarget, AvatarUpload } from '../src/shared/avatars.ts';
import { avatarUploadRecordSchema, sameAvatarBinding, type AvatarBinding, type AvatarUploadRecord, type AvatarObjectDescriptor } from './avatar-data.ts';
import { assertAvatarHeadWritable, assertAvatarInput, assertPreparedAvatar, avatarPublicUpload, expireAvatarUpload } from './avatar-policy.ts';
import { holdAvatarPipeline } from './avatar-response-deadline.ts';
import { createAvatarIngress } from './avatar-ingress.ts';
import { AvatarCodecError } from './avatar-codec-error.ts';
import type { AvatarCodec } from './avatar-codec.ts';
import type { AvatarConfig } from './avatar-config.ts';
import type { AvatarObjects } from './firebase-avatar-objects.ts';
import type { FirestoreAvatarData } from './firestore-avatar-data.ts';
import type { FirestoreAuthorityTransaction } from './firestore-authority.ts';
import type { FirebaseAvatarUploadAdmission } from './firebase-avatar-api.ts';
import { domainParse, domainReject, firestoreDomainHash } from './firestore-domain-data.ts';

export type AvatarRun = <T>(userId: string, target: AvatarTarget,
  task: (authority: FirestoreAuthorityTransaction, binding: AvatarBinding) => Promise<T>) => Promise<T>;
export function createAvatarUploads(options: { run: AvatarRun; store: FirestoreAvatarData; codec: Pick<AvatarCodec, 'normalize'>;
  objects: Pick<AvatarObjects, 'write' | 'inspect'>; config: AvatarConfig; now(): number }) {
  const { run, store, codec, objects, config, now } = options, ingress = createAvatarIngress(config.admission);
  async function owned(authority: FirestoreAuthorityTransaction, binding: AvatarBinding, id: string) {
    domainParse(z.uuid(), id);
    const row = await store.upload(authority, binding, id);
    if (!row || row.actorUserId !== authority.scope.ownerUserId || !sameAvatarBinding(row.binding, binding)) domainReject('not_found', 404);
    return row;
  }
  function sameLease(row: AvatarUploadRecord, expected: AvatarUploadRecord, authority: FirestoreAuthorityTransaction) {
    if (!sameAvatarBinding(row.binding, expected.binding) || row.state !== 'processing' || !row.lease || !expected.lease
      || firestoreDomainHash(row.lease) !== firestoreDomainHash(expected.lease)
      || row.lease.authorizationVersion !== authority.authorizationVersion || row.lease.childAccessVersion !== authority.childAccessVersion
      || row.lease.generation !== authority.generation) domainReject('avatar_upload_not_ready');
  }
  async function expire(authority: FirestoreAuthorityTransaction, row: AvatarUploadRecord) {
    const current = expireAvatarUpload(row, now());
    if (current.state === row.state) return row;
    const cleanup = await store.cleanup(authority, row.binding, row.assetId);
    if (!cleanup || cleanup.uploadId !== row.id) domainReject('avatar_integrity_failed', 503);
    const untouched = cleanup.state === 'reserved' && cleanup.preparedAsset === null && cleanup.writeLease === null;
    const uploadWrite = store.prepareUpload(authority, current), cleanupWrite = store.prepareCleanup(authority, { ...cleanup, reason: 'expired',
      state: untouched ? 'complete' : cleanup.descriptor ? 'known' : 'unresolved', nextAttemptAt: new Date(now()).toISOString() });
    uploadWrite(); cleanupWrite(); return current;
  }
  async function finishStored(userId: string, target: AvatarTarget, expected: AvatarUploadRecord, descriptor: AvatarObjectDescriptor) {
    return run(userId, target, async (authority, binding) => {
      const row = await owned(authority, binding, expected.id), head = await store.head(authority, binding);
      const cleanup = await store.cleanup(authority, binding, row.assetId);
      if ((row.state === 'ready' || row.state === 'committed') && row.descriptor
        && head.removal?.state !== 'pending' && firestoreDomainHash(row.descriptor) === firestoreDomainHash(descriptor)) return row;
      sameLease(row, expected, authority); assertPreparedAvatar(row, descriptor.asset);
      if (!cleanup || cleanup.uploadId !== row.id || cleanup.state !== 'writing' && cleanup.state !== 'unresolved'
        || firestoreDomainHash(cleanup.preparedAsset) !== firestoreDomainHash(descriptor.asset)
        || firestoreDomainHash(cleanup.writeLease) !== firestoreDomainHash(row.lease)) domainReject('avatar_integrity_failed', 503);
      const expired = Date.parse(row.expiresAt) <= now(), stale = head.version !== row.expectedVersion || head.removal?.state === 'pending';
      const next = avatarUploadRecordSchema.parse({ ...row, state: expired ? 'expired' : stale ? 'rejected' : 'ready', lease: null, descriptor,
        errorCode: expired ? 'avatar_upload_expired' : stale ? 'avatar_version_conflict' : null });
      const uploadWrite = store.prepareUpload(authority, next), cleanupWrite = store.prepareCleanup(authority, { ...cleanup, descriptor,
        state: 'known', reason: expired ? 'expired' : stale ? 'rejected' : 'staging', nextAttemptAt: expired || stale ? new Date(now()).toISOString() : row.expiresAt });
      uploadWrite(); cleanupWrite(); return next;
    });
  }
  async function rejectBeforeWrite(userId: string, target: AvatarTarget, expected: AvatarUploadRecord, code: string) {
    await run(userId, target, async (authority, binding) => {
      const row = await owned(authority, binding, expected.id), cleanup = await store.cleanup(authority, binding, expected.assetId);
      sameLease(row, expected, authority);
      if (!cleanup || row.preparedAsset || row.descriptor || cleanup.preparedAsset || cleanup.descriptor || cleanup.state !== 'reserved'
        || cleanup.reason !== 'staging' || cleanup.uploadId !== row.id || cleanup.assetId !== row.assetId
        || !sameAvatarBinding(cleanup.objectBinding, row.binding) || firestoreDomainHash(cleanup.writeLease) !== firestoreDomainHash(row.lease)) return;
      // An uncertain prepared-transaction reply is not permission to retire an already prepared responsibility.
      const uploadWrite = store.prepareUpload(authority, { ...row, state: 'rejected', lease: null, errorCode: code });
      const cleanupWrite = store.prepareCleanup(authority, { ...cleanup, state: 'complete', reason: 'rejected', nextAttemptAt: new Date(now()).toISOString() });
      uploadWrite(); cleanupWrite();
    });
  }
  async function content(userId: string, target: AvatarTarget, uploadId: string, bytes: Buffer, signal: AbortSignal): Promise<AvatarUpload> {
    if (signal.aborted) domainReject('avatar_decode_limit', 422);
    const token = randomUUID();
    const first = await run(userId, target, async (authority, binding) => {
      const row = await owned(authority, binding, uploadId), head = await store.head(authority, binding);
      assertAvatarInput(row, bytes);
      if (row.state === 'committed') {
        if (head.version !== row.committedVersion || head.descriptor?.asset.id !== row.assetId || head.removal?.state === 'pending') domainReject('not_found', 404);
        return { row, decode: false };
      }
      assertAvatarHeadWritable(head, row.expectedVersion);
      if (row.state === 'ready' && Date.parse(row.expiresAt) > now()) return { row, decode: false };
      if (row.state === 'expired' || Date.parse(row.expiresAt) <= now()) domainReject('avatar_upload_expired', 410);
      if (row.state !== 'reserved') domainReject('avatar_upload_not_ready');
      const cleanup = await store.cleanup(authority, binding, row.assetId);
      if (!cleanup || cleanup.uploadId !== row.id || cleanup.state !== 'reserved' || cleanup.preparedAsset || cleanup.writeLease) domainReject('avatar_integrity_failed', 503);
      const lease = { token, authorizationVersion: authority.authorizationVersion, childAccessVersion: authority.childAccessVersion,
        generation: authority.generation, acquiredAt: new Date(now()).toISOString(),
        until: new Date(now() + config.admission.totalTimeoutMs).toISOString() };
      const next = avatarUploadRecordSchema.parse({ ...row, state: 'processing', lease });
      const uploadWrite = store.prepareUpload(authority, next), cleanupWrite = store.prepareCleanup(authority, { ...cleanup, writeLease: lease, nextAttemptAt: lease.until });
      uploadWrite(); cleanupWrite(); return { row: next, decode: true };
    });
    if (!first.decode) return avatarPublicUpload(first.row);
    let normalized: Awaited<ReturnType<AvatarCodec['normalize']>>;
    try { normalized = await codec.normalize(userId, bytes, first.row.mimeType, first.row.crop, first.row.recipe, signal); }
    catch (error) {
      const code = error instanceof AvatarCodecError ? error.code : 'avatar_unavailable';
      // Before the durable prepared marker, no external object write has been attempted.
      try { await rejectBeforeWrite(userId, target, first.row, code); } catch { /* Existing cleanup remains durable on revoked authority. */ }
      const status = code === 'avatar_busy' ? 429 : code === 'avatar_input_too_large' ? 413 : code === 'avatar_unsupported_format' ? 415
        : code === 'avatar_invalid_image' || code === 'avatar_decode_limit' ? 422 : 503;
      domainReject(code, status);
    }
    let writeStarted = false;
    try {
      const asset = { id: first.row.assetId, bytes: normalized.bytes, sha256: normalized.sha256, mimeType: normalized.mimeType,
        width: normalized.width, height: normalized.height };
      const prepared = await run(userId, target, async (authority, binding) => {
        const row = await owned(authority, binding, uploadId), head = await store.head(authority, binding), cleanup = await store.cleanup(authority, binding, row.assetId);
        sameLease(row, first.row, authority); assertAvatarHeadWritable(head, row.expectedVersion); assertPreparedAvatar(row, asset);
        if (signal.aborted) domainReject('avatar_decode_limit', 422);
        if (Date.parse(row.expiresAt) <= now()) domainReject('avatar_upload_expired', 410);
        if (!cleanup || cleanup.state !== 'reserved' || cleanup.reason !== 'staging' || cleanup.preparedAsset || cleanup.descriptor
          || row.preparedAsset || row.descriptor || cleanup.uploadId !== row.id || cleanup.assetId !== row.assetId
          || cleanup.expectedVersion !== row.expectedVersion || !sameAvatarBinding(cleanup.objectBinding, row.binding)
          || firestoreDomainHash(cleanup.writeLease) !== firestoreDomainHash(row.lease)) domainReject('avatar_integrity_failed', 503);
        const next = avatarUploadRecordSchema.parse({ ...row, preparedAsset: asset });
        const uploadWrite = store.prepareUpload(authority, next), cleanupWrite = store.prepareCleanup(authority, { ...cleanup, preparedAsset: asset, state: 'writing' });
        uploadWrite(); cleanupWrite(); return next;
      });
      // Storage write and its inspect recovery are never inside a retried transaction callback.
      // Once this prepared marker exists, uncertain outcomes remain processing until inspected, never re-decoded.
      writeStarted = true;
      const descriptor = await objects.write(prepared.binding, asset, normalized.buffer);
      return avatarPublicUpload(await finishStored(userId, target, prepared, descriptor));
    } catch (error) {
      if (!writeStarted) {
        try { await rejectBeforeWrite(userId, target, first.row, 'avatar_unavailable'); } catch { /* Durable cleanup remains. */ }
      }
      throw error;
    } finally { normalized.buffer.fill(0); }
  }
  return {
    async status(userId: string, target: AvatarTarget, uploadId: string): Promise<AvatarUpload> {
      const row = await run(userId, target, async (authority, binding) => {
        const row = await owned(authority, binding, uploadId), head = await store.head(authority, binding);
        if (head.removal?.state === 'pending') domainReject('avatar_unavailable', 503);
        if (row.state === 'committed' && (head.descriptor?.asset.id !== row.assetId || head.version !== row.committedVersion)) domainReject('not_found', 404);
        return expire(authority, row);
      });
      if (row.state === 'processing' && row.preparedAsset && row.lease && Date.parse(row.lease.until) <= now()) {
        const descriptor = await objects.inspect(row.binding, row.assetId, row.preparedAsset);
        if (descriptor) return avatarPublicUpload(await finishStored(userId, target, row, descriptor));
      }
      return avatarPublicUpload(row);
    },
    async admission(userId: string, target: AvatarTarget, uploadId: string): Promise<FirebaseAvatarUploadAdmission> {
      if (!config.writesEnabled) domainReject('avatar_unavailable', 503);
      const permit = ingress.acquire(userId);
      try {
        const row = await run(userId, target, async (authority, binding) => {
          const row = await owned(authority, binding, uploadId), head = await store.head(authority, binding);
          if (head.removal?.state === 'pending') domainReject('avatar_unavailable', 503);
          if (row.state === 'processing') domainReject('avatar_upload_not_ready');
          if (row.state === 'expired' || row.state !== 'committed' && Date.parse(row.expiresAt) <= now()) domainReject('avatar_upload_expired', 410);
          if (row.state === 'rejected') domainReject('avatar_upload_not_ready');
          if (row.state === 'committed' && (head.descriptor?.asset.id !== row.assetId || head.version !== row.committedVersion)) domainReject('not_found', 404);
          return row;
        });
        const pipeline = holdAvatarPipeline<AvatarUpload>(permit.release);
        return { maxBytes: row.bytes, totalTimeoutMs: config.admission.totalTimeoutMs, release: pipeline.release,
          upload(bytes, signal) { permit.consume(); return pipeline.execute(signal, () => content(userId, target, uploadId, bytes, signal)); } };
      } catch (error) { permit.release(); throw error; }
    },
    ingressState: ingress.state,
  };
}
