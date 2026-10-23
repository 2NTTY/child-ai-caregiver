import { randomUUID } from 'node:crypto';
import { avatarTargetSchema, avatarCommitInputSchema, avatarRemoveInputSchema, type AvatarTarget } from '../src/shared/avatars.ts';
import type { OnlineSubmission, OnlineReceipt } from '../src/shared/online.ts';
import { avatarBinding, avatarHeadRecordSchema, type AvatarBinding } from './avatar-data.ts';
import { assertAvatarHeadWritable, avatarPublicState, AVATAR_PENDING_SCAN_LIMIT } from './avatar-policy.ts';
import { createFirestoreAvatarData } from './firestore-avatar-data.ts';
import { prepareAvatarReservation } from './avatar-reservations.ts';
import { createAvatarUploads, type AvatarRun } from './avatar-uploads.ts';
import { avatarPath, type FirebaseAvatarApiPort } from './firebase-avatar-api.ts';
import { createFirestoreAuthority, FirestoreAuthorityError, type FirestoreAuthorityOptions, type FirestoreAuthorityTransaction } from './firestore-authority.ts';
import { createFirestoreOnlineReceipts, isFirestoreOnlinePending } from './firestore-online-receipts.ts';
import { onlineSubmissionSchema } from './online-routing.ts';
import { domainParse, domainReject, firestoreDomainHash, FirestoreDomainError } from './firestore-domain-data.ts';
import { firebaseAvatarErasureIntentSchema, firebaseErasureDescriptorSchema, firebaseErasureIntentHash, type FirebaseErasureJournal } from './firebase-erasure-journal.ts';
import { AvatarObjectError, type AvatarObjects } from './firebase-avatar-objects.ts';
import type { AvatarCodec } from './avatar-codec.ts';
import type { AvatarConfig } from './avatar-config.ts';

export interface FirestoreAvatarsOptions extends FirestoreAuthorityOptions {
  config: AvatarConfig; codec: Pick<AvatarCodec, 'normalize'>; objects: AvatarObjects;
  journal: Pick<FirebaseErasureJournal, 'writeOnce' | 'read'>;
}
/** Complete domain assembly is gated separately on lifecycle adapters; this factory never enables itself. */
export function createFirestoreAvatarStore(options: FirestoreAvatarsOptions): FirebaseAvatarApiPort & {
  submitOnline(userId: string, submission: OnlineSubmission): Promise<OnlineReceipt>;
} {
  const authority = createFirestoreAuthority(options), store = createFirestoreAvatarData(options), receipts = createFirestoreOnlineReceipts(options);
  const { config, objects, journal } = options;
  const now = () => { const value = (options.serverClock ?? Date.now)();
    if (!Number.isSafeInteger(value) || value < 0 || value > 253402271909999) domainReject('avatar_unavailable', 503); return value; };
  async function guard<T>(task: () => Promise<T>): Promise<T> {
    try { return await task(); } catch (error) {
      if (error instanceof FirestoreDomainError || error instanceof FirestoreAuthorityError && error.status < 500) throw error;
      if (error instanceof AvatarObjectError) domainReject(error.code, 503);
      domainReject('avatar_unavailable', 503);
    }
  }
  const run: AvatarRun = (userId, rawTarget, task) => {
    const target = domainParse(avatarTargetSchema, rawTarget);
    return authority.runTransaction(userId, target.kind === 'child' ? target.childId : null,
      binding => task(binding, avatarBinding(binding.scope, target)));
  };
  const uploads = createAvatarUploads({ run, store, config, codec: options.codec, objects, now });
  async function requireOnlinePrior(binding: FirestoreAuthorityTransaction, submission: OnlineSubmission) {
    const prior = await receipts.read(binding, submission.operation.opId);
    if (prior) receipts.assertSame(binding, prior, submission); else receipts.assertCurrent(binding, submission);
    return prior;
  }
  async function commit(userId: string, target: AvatarTarget, submission: OnlineSubmission): Promise<OnlineReceipt> {
    const input = domainParse(avatarCommitInputSchema, submission.payload);
    return run(userId, target, async (authority, binding) => {
      const prior = await requireOnlinePrior(authority, submission);
      if (prior) {
        if (isFirestoreOnlinePending(prior)) domainReject('operation_conflict');
        return await receipts.disclose(authority, prior) as OnlineReceipt;
      }
      const head = await store.head(authority, binding), upload = await store.upload(authority, binding, input.uploadId);
      assertAvatarHeadWritable(head, input.expectedVersion);
      if (!upload || upload.actorUserId !== userId) domainReject('not_found', 404);
      if (upload.expectedVersion !== input.expectedVersion) domainReject('avatar_version_conflict');
      if (upload.state === 'expired' || Date.parse(upload.expiresAt) <= now()) domainReject('avatar_upload_expired', 410);
      if (upload.state !== 'ready' || !upload.descriptor) domainReject('avatar_upload_not_ready');
      const staging = await store.cleanup(authority, binding, upload.assetId);
      const old = head.descriptor ? await store.cleanup(authority, binding, head.descriptor.asset.id) : null;
      if (!staging || staging.reason !== 'staging' || staging.state !== 'known'
        || firestoreDomainHash(staging.descriptor) !== firestoreDomainHash(upload.descriptor)
        || head.descriptor && (!old || old.committedVersion !== head.version || firestoreDomainHash(old.descriptor) !== firestoreDomainHash(head.descriptor)))
        domainReject('avatar_integrity_failed', 503);
      const version = head.version + 1, at = new Date(now()).toISOString();
      const next = avatarHeadRecordSchema.parse({ ...head, version, descriptor: upload.descriptor, updatedAt: at, removal: null });
      const result = { avatar: avatarPublicState(next, true), cleanupPending: old !== null };
      const receipt = receipts.prepareConfirmed(authority, submission, { childId: target.kind === 'self' ? null : target.childId,
        changeSeq: authority.changeSeq, statusCode: 200, result });
      const headWrite = store.prepareHead(authority, next), uploadWrite = store.prepareUpload(authority, { ...upload, state: 'committed', committedVersion: version });
      const stageWrite = store.prepareCleanup(authority, { ...staging, committedVersion: version });
      const oldWrite = old ? store.prepareCleanup(authority, { ...old, reason: 'superseded', nextAttemptAt: at }) : null;
      headWrite(); uploadWrite(); stageWrite(); oldWrite?.(); receipt.commit(); return receipt.receipt;
    });
  }
  async function remove(userId: string, target: AvatarTarget, submission: OnlineSubmission): Promise<OnlineReceipt> {
    const input = domainParse(avatarRemoveInputSchema, submission.payload), candidateAssetId = randomUUID();
    const first = await run(userId, target, async (authority, binding) => {
      const prior = await requireOnlinePrior(authority, submission);
      if (prior && !isFirestoreOnlinePending(prior)) return { receipt: await receipts.disclose(authority, prior) as OnlineReceipt };
      const head = await store.head(authority, binding);
      if (prior) {
        if (head.removal?.state !== 'pending' || head.removal.intent.operationId !== submission.operation.opId
          || head.removal.expectedVersion !== input.expectedVersion) domainReject('avatar_unavailable', 503);
        return { intent: head.removal.intent };
      }
      assertAvatarHeadWritable(head, input.expectedVersion);
      const intent = firebaseAvatarErasureIntentSchema.parse({ type: 'avatar-delete', scope: binding.scope,
        assetId: head.descriptor?.asset.id ?? candidateAssetId, operationId: submission.operation.opId, at: new Date(now()).toISOString(),
        avatar: { targetKind: target.kind, targetId: binding.targetId, throughVersion: head.version } });
      const pending = receipts.preparePending(authority, submission, target.kind === 'self' ? null : target.childId);
      const headWrite = store.prepareHead(authority, { ...head, removal: { intent, journal: null, expectedVersion: head.version, state: 'pending' } });
      headWrite(); pending.commit(); return { intent };
    });
    if ('receipt' in first) return first.receipt!;
    // Independent journal durability is required before the public tombstone/confirmed receipt.
    const proof = domainParse(firebaseErasureDescriptorSchema, await journal.writeOnce(first.intent!), 'avatar_integrity_failed', 503);
    if (proof.intentSha256 !== firebaseErasureIntentHash(first.intent!)) domainReject('avatar_integrity_failed', 503);
    return run(userId, target, async (authority, binding) => {
      const prior = await requireOnlinePrior(authority, submission);
      if (!prior) domainReject('avatar_integrity_failed', 503);
      if (!isFirestoreOnlinePending(prior)) return await receipts.disclose(authority, prior) as OnlineReceipt;
      const head = await store.head(authority, binding);
      if (head.version !== input.expectedVersion || head.removal?.state !== 'pending'
        || firestoreDomainHash(head.removal.intent) !== firestoreDomainHash(first.intent)) domainReject('avatar_unavailable', 503);
      const pending = await store.pending(authority, binding, userId);
      if (pending.length >= AVATAR_PENDING_SCAN_LIMIT) domainReject('avatar_integrity_failed', 503);
      const old = head.descriptor ? await store.cleanup(authority, binding, head.descriptor.asset.id) : null;
      if (head.descriptor && (!old || old.committedVersion !== head.version
        || firestoreDomainHash(old.descriptor) !== firestoreDomainHash(head.descriptor))) domainReject('avatar_integrity_failed', 503);
      const writes: (() => unknown)[] = []; let cleanupPending = old !== null;
      for (const upload of pending) {
        const cleanup = await store.cleanup(authority, binding, upload.assetId);
        if (!cleanup || cleanup.uploadId !== upload.id || upload.expectedVersion > head.version) domainReject('avatar_integrity_failed', 503);
        const untouched = upload.preparedAsset === null && cleanup.preparedAsset === null && cleanup.descriptor === null;
        const state = untouched ? 'complete' : cleanup.descriptor ? 'known' : 'unresolved';
        cleanupPending ||= state !== 'complete';
        writes.push(store.prepareUpload(authority, { ...upload, state: 'rejected', lease: null, errorCode: 'avatar_version_conflict' }),
          store.prepareCleanup(authority, { ...cleanup, reason: 'removed', state, nextAttemptAt: new Date(now()).toISOString() }));
      }
      const next = avatarHeadRecordSchema.parse({ ...head, version: head.version + 1, descriptor: null, updatedAt: new Date(now()).toISOString(),
        erasedThroughVersion: head.version, removal: { ...head.removal, state: 'confirmed', journal: proof } });
      const receipt = receipts.prepareConfirmed(authority, submission, { childId: target.kind === 'self' ? null : target.childId,
        changeSeq: authority.changeSeq, statusCode: 200, result: { avatar: avatarPublicState(next, true), cleanupPending } }, true);
      const headWrite = store.prepareHead(authority, next);
      const oldWrite = old ? store.prepareCleanup(authority, { ...old, reason: 'removed', nextAttemptAt: new Date(now()).toISOString() }) : null;
      for (const write of writes) write(); oldWrite?.(); headWrite(); receipt.commit(); return receipt.receipt;
    });
  }
  return {
    retryAfterSeconds: config.admission.retryAfterSeconds,
    read(userId, target) { return guard(() => run(userId, target, async (authority, binding) => ({
      avatar: avatarPublicState(await store.head(authority, binding), config.writesEnabled), policy: config.policy,
    }))); },
    uploadStatus(userId, target, uploadId) { return guard(() => uploads.status(userId, target, uploadId)); },
    uploadAdmission(userId, target, uploadId) { return guard(async () => {
      const admission = await uploads.admission(userId, target, uploadId);
      return { ...admission, upload: (bytes, signal) => guard(() => admission.upload(bytes, signal)) };
    }); },
    content(userId, target, assetId, version) { return guard(async () => {
      const before = await run(userId, target, async (authority, binding) => {
        const head = await store.head(authority, binding); avatarPublicState(head, true);
        if (!head.descriptor) domainReject('not_found', 404);
        if (head.version !== version || head.descriptor.asset.id !== assetId) domainReject('avatar_version_conflict');
        return { binding, descriptor: head.descriptor, authorizationVersion: authority.authorizationVersion,
          childAccessVersion: authority.childAccessVersion, generation: authority.generation };
      });
      const buffer = await objects.read(before.binding, before.descriptor);
      try {
        await run(userId, target, async (authority, binding) => {
          const head = await store.head(authority, binding); avatarPublicState(head, true);
          if (head.version !== version || firestoreDomainHash(head.descriptor) !== firestoreDomainHash(before.descriptor)
            || firestoreDomainHash(binding) !== firestoreDomainHash(before.binding) || authority.authorizationVersion !== before.authorizationVersion
            || authority.childAccessVersion !== before.childAccessVersion || authority.generation !== before.generation)
            domainReject('avatar_version_conflict');
        });
        return { buffer };
      } catch (error) { buffer.fill(0); throw error; }
    }); },
    submitOnline(userId, raw) { return guard(async () => {
      const submission = domainParse(onlineSubmissionSchema, raw), route = avatarPath(submission.path);
      if (!route || !['uploads', 'commit', 'remove'].includes(route.action)) domainReject('not_found', 404);
      if (!config.writesEnabled) domainReject('avatar_unavailable', 503);
      if (route.action === 'commit') return commit(userId, route.target, submission);
      if (route.action === 'remove') return remove(userId, route.target, submission);
      const ids = { uploadId: randomUUID(), assetId: randomUUID() };
      return run(userId, route.target, async (authority, binding) => {
        const prior = await requireOnlinePrior(authority, submission);
        if (prior) {
          if (isFirestoreOnlinePending(prior)) domainReject('operation_conflict');
          return await receipts.disclose(authority, prior) as OnlineReceipt;
        }
        const plan = await prepareAvatarReservation(store, authority, binding, submission.payload, submission.operation.opId, config, now(), ids);
        const receipt = receipts.prepareConfirmed(authority, submission, { childId: route.target.kind === 'self' ? null : route.target.childId,
          changeSeq: authority.changeSeq, statusCode: 201, result: plan.result });
        plan.commit(); receipt.commit(); return receipt.receipt;
      });
    }); },
  };
}
