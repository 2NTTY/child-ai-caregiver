import { avatarBinding, avatarHeadId, avatarCleanupId, avatarHeadRecordSchema, avatarUploadRecordSchema, avatarCleanupRecordSchema,
  sameAvatarBinding, type AvatarHeadRecord, type AvatarCleanupRecord, type AvatarBinding } from './avatar-data.ts';
import { erasureCoversAvatar, firebaseErasureDescriptorSchema, firebaseErasureIntentHash,
  type FirebaseErasureIntent, type FirebaseErasureDescriptor } from './firebase-erasure-journal.ts';
import { avatarObjectAddress } from './firebase-avatar-objects.ts';
import type { FirebaseBackupDocument } from './firestore-backup.ts';
import { canonical } from './firestore-session-codec.ts';
import { FirestoreDomainData } from './firestore-domain-data.ts';
import { sealAvatarRestoreRecord, restoredAvatarBinding, restoredAvatarDescriptor } from './firestore-restore-avatar-codec.ts';
import type { FirestoreRestoreCodec, FirestoreRestoreDecoded, FirestoreRestoreTransform } from './firestore-restore-codec.ts';

function check(value: unknown, code = 'restore_avatar_relation'): asserts value {
  if (!value) throw Object.assign(new Error('Avatar recovery rejected'), { code, status: 409 });
}
function covered(intent: FirebaseErasureIntent, value: AvatarCleanupRecord) {
  return erasureCoversAvatar(intent, { scope: value.binding.scope, targetKind: value.binding.target.kind, targetId: value.binding.targetId,
    committedVersion: value.committedVersion, expectedVersion: value.expectedVersion });
}
function keyed<T>(values: readonly T[], key: (value: T) => string): Map<string, T> {
  const result = new Map<string, T>(); for (const value of values) { const id = key(value); check(!result.has(id)); result.set(id, value); } return result;
}
/** Paused-source planner: independent journal wins over both snapshot and live rows. No object IO occurs here. */
export function replayAvatarLifecycle(data: FirestoreDomainData, codec: FirestoreRestoreCodec, records: FirestoreRestoreDecoded[],
  live: readonly FirestoreRestoreDecoded[], journal: readonly FirebaseErasureIntent[], proofs: ReadonlyMap<string, FirebaseErasureDescriptor>, removed: ReadonlySet<string>) {
  const scopeErased = (value: AvatarCleanupRecord | AvatarHeadRecord) => journal.some(intent =>
    ['account-delete', 'child-delete'].includes(intent.type) && erasureCoversAvatar(intent, { scope: value.binding.scope,
      targetKind: value.binding.target.kind, targetId: value.binding.targetId, committedVersion: null }));
  const heads = keyed(records.filter(record => record.context.kind === 'avatar-head' && !removed.has(record.path))
    .map(record => ({ record, value: avatarHeadRecordSchema.parse(record.value) })), row => avatarHeadId(row.value.binding));
  const cleanups = keyed(records.filter(record => record.context.kind === 'avatar-cleanup' && !removed.has(record.path))
    .map(record => ({ record, value: avatarCleanupRecordSchema.parse(record.value) })), row => avatarCleanupId(row.value.binding, row.value.assetId));
  // Keep *all* live original-object obligations, including objects created after the chosen snapshot and prior restore epochs.
  for (const record of live.filter(value => value.context.kind === 'avatar-cleanup')) {
    const value = avatarCleanupRecordSchema.parse(record.value); if (scopeErased(value)) continue;
    const id = avatarCleanupId(value.binding, value.assetId), prior = cleanups.get(id);
    if (prior) { check(prior.value.uploadId === value.uploadId && prior.value.expectedVersion === value.expectedVersion
      && (prior.value.preparedAsset === null || canonical(prior.value.preparedAsset) === canonical(value.preparedAsset))
      && (prior.value.descriptor === null || canonical(prior.value.descriptor) === canonical(value.descriptor)), 'restore_cleanup_evidence_changed');
      records.splice(records.indexOf(prior.record), 1); }
    records.push(record); cleanups.set(id, { record, value });
  }
  for (const { value } of heads.values()) if (value.removal) check(journal.some(intent => canonical(intent) === canonical(value.removal!.intent)), 'restore_erasure_missing');
  const avatarIntents = journal.filter(intent => intent.type === 'avatar-delete').sort((a, b) =>
    a.type === 'avatar-delete' && b.type === 'avatar-delete' ? a.avatar.throughVersion - b.avatar.throughVersion : 0);
  for (const intent of avatarIntents) {
    if (intent.type !== 'avatar-delete') continue;
    const target = intent.avatar.targetKind === 'self' ? { kind: 'self' as const } : { kind: 'child' as const, childId: intent.avatar.targetId };
    const binding = avatarBinding(intent.scope, target), id = avatarHeadId(binding), prior = heads.get(id);
    const source = prior?.value ?? avatarHeadRecordSchema.parse({ binding, version: 0, descriptor: null, updatedAt: null,
      reservationNonce: intent.operationId, erasedThroughVersion: null, removal: null });
    if (scopeErased(source)) continue;
    // A workspace absent from the selected snapshot is not recreated merely to host an avatar tombstone.
    if (!records.some(record => record.context.kind === 'workspace' && record.context.id === binding.scope.workspaceId)) continue;
    const proof = firebaseErasureDescriptorSchema.parse(proofs.get(firebaseErasureIntentHash(intent)));
    check(proof.intentSha256 === firebaseErasureIntentHash(intent), 'restore_erasure_missing');
    const erased = source.version <= intent.avatar.throughVersion;
    const value = avatarHeadRecordSchema.parse({ ...source, version: erased ? intent.avatar.throughVersion + 1 : source.version,
      descriptor: erased ? null : source.descriptor, updatedAt: erased ? intent.at : source.updatedAt,
      erasedThroughVersion: Math.max(source.erasedThroughVersion ?? 0, intent.avatar.throughVersion),
      removal: { intent, journal: proof, expectedVersion: intent.avatar.throughVersion, state: 'confirmed' } });
    const record = codec.decode(sealAvatarRestoreRecord(data, 'avatar-head', value));
    if (prior) records.splice(records.indexOf(prior.record), 1);
    records.push(record); heads.set(id, { record, value });
  }
  for (const { record, value } of cleanups.values()) {
    const intent = journal.find(item => covered(item, value));
    const reason = intent ? 'erasure' : value.reason === 'staging' ? value.committedVersion === null ? 'expired' : 'superseded' : value.reason;
    // A paused source cannot newly pass the durable prepared-before-write transaction. No marker means no external write.
    const untouched = value.preparedAsset === null && value.descriptor === null;
    record.value = avatarCleanupRecordSchema.parse({ ...value, reason, state: untouched ? 'complete' : value.state === 'complete' ? 'complete'
      : value.descriptor ? 'known' : 'unresolved', attempt: 0, nextAttemptAt: intent?.at ?? value.nextAttemptAt });
  }
}
/** Exact current head/upload/normalized-object responsibility, never a care/photo/model reference. */
export function assertRestoredAvatarRelations(records: readonly FirestoreRestoreDecoded[], restored = false) {
  const cleanups = keyed(records.filter(row => row.context.kind === 'avatar-cleanup').map(row => avatarCleanupRecordSchema.parse(row.value)),
    row => avatarCleanupId(row.binding, row.assetId));
  const uploads = keyed(records.filter(row => row.context.kind === 'avatar-upload').map(row => avatarUploadRecordSchema.parse(row.value)), row => row.id);
  const heads = keyed(records.filter(row => row.context.kind === 'avatar-head').map(row => avatarHeadRecordSchema.parse(row.value)), row => avatarHeadId(row.binding));
  for (const head of heads.values()) {
    check(head.removal?.state !== 'pending', 'restore_erasure_missing');
    if (!head.descriptor) continue;
    const cleanup = cleanups.get(avatarCleanupId(head.binding, head.descriptor.asset.id)); check(cleanup, 'restore_cleanup_evidence_missing');
    check(sameAvatarBinding(cleanup.objectBinding, head.binding) && canonical(cleanup.descriptor) === canonical(head.descriptor)
      && cleanup.committedVersion === head.version && (!restored || cleanup.state === 'known' && cleanup.reason === 'staging'));
    const upload = uploads.get(cleanup.uploadId); check(upload && sameAvatarBinding(upload.binding, head.binding) && upload.state === 'committed'
      && upload.assetId === head.descriptor.asset.id && upload.committedVersion === head.version && canonical(upload.descriptor) === canonical(head.descriptor));
  }
  for (const upload of uploads.values()) if (restored) check(upload.state === 'expired' || upload.state === 'committed');
}
/** Add the new epoch responsibility without replacing/deleting any prior immutable-object cleanup row. */
export function restoredAvatarCleanupRecords(data: FirestoreDomainData, records: readonly FirestoreRestoreDecoded[], input: FirestoreRestoreTransform) {
  const originals = keyed(records.filter(row => row.context.kind === 'avatar-cleanup').map(row => avatarCleanupRecordSchema.parse(row.value)),
    row => avatarCleanupId(row.binding, row.assetId));
  return records.filter(row => row.context.kind === 'avatar-head').flatMap(record => {
    const head = avatarHeadRecordSchema.parse(record.value); if (!head.descriptor) return [];
    const old = originals.get(avatarCleanupId(head.binding, head.descriptor.asset.id)); check(old, 'restore_cleanup_evidence_missing');
    const binding = restoredAvatarBinding(head.binding, input), descriptor = restoredAvatarDescriptor(data, binding, head.descriptor, input);
    return [sealAvatarRestoreRecord(data, 'avatar-cleanup', { ...old, binding, objectBinding: binding, descriptor, preparedAsset: descriptor.asset,
      committedVersion: head.version, writeLease: null, reason: 'staging', state: 'known', attempt: 0, nextAttemptAt: head.updatedAt })];
  });
}

/** Union every authenticated copy obligation, not merely still-visible heads. No Storage side effects. */
export function mergeAvatarCopyResponsibilities(data: FirestoreDomainData, codec: FirestoreRestoreCodec,
  records: FirebaseBackupDocument[], raw: readonly AvatarCleanupRecord[], options: {
    bucketName: string; epochFor(binding: AvatarBinding): string; erasures: readonly FirebaseErasureIntent[];
  }) {
  const decoded = records.filter(record => ['avatar_heads', 'avatar_cleanup'].some(suffix =>
    record.path.startsWith(data.options.namespace + '_' + suffix + '/'))).map(record => codec.decode(record));
  const heads = decoded.filter(row => row.context.kind === 'avatar-head').map(row => avatarHeadRecordSchema.parse(row.value));
  const known = keyed(decoded.filter(row => row.context.kind === 'avatar-cleanup').map(record => ({ record,
    value: avatarCleanupRecordSchema.parse(record.value) })), row => avatarCleanupId(row.value.binding, row.value.assetId));
  const supplied = keyed(raw.map(value => avatarCleanupRecordSchema.parse(value)), row => avatarCleanupId(row.binding, row.assetId));
  for (const [id, copy] of supplied) {
    check(copy.state === 'known' && copy.descriptor && copy.writeLease === null && copy.committedVersion !== null
      && copy.expectedVersion + 1 === copy.committedVersion && copy.binding.scope.storageEpoch === options.epochFor(copy.binding)
      && copy.descriptor.objectName === avatarObjectAddress({ projectId: data.options.projectId, namespace: data.options.namespace,
        bucketName: options.bucketName }, copy.objectBinding, copy.assetId).objectName, 'restore_avatar_copy_handoff');
    const current = heads.find(head => sameAvatarBinding(head.binding, copy.binding) && head.version === copy.committedVersion
      && canonical(head.descriptor) === canonical(copy.descriptor));
    const erased = options.erasures.some(intent => covered(intent, copy));
    check(!current || !erased, 'restore_avatar_copy_erased_current');
    const value = avatarCleanupRecordSchema.parse({ ...copy, reason: current ? 'staging' : erased ? 'erasure' : 'superseded' });
    const prior = known.get(id);
    if (prior) {
      check(sameAvatarBinding(prior.value.binding, value.binding) && sameAvatarBinding(prior.value.objectBinding, value.objectBinding)
        && prior.value.assetId === value.assetId && prior.value.uploadId === value.uploadId && prior.value.expectedVersion === value.expectedVersion
        && prior.value.committedVersion === value.committedVersion && canonical(prior.value.descriptor) === canonical(value.descriptor)
        && prior.value.state === 'known' && prior.value.reason === value.reason, 'restore_avatar_copy_handoff');
      continue;
    }
    records.push(sealAvatarRestoreRecord(data, 'avatar-cleanup', value));
  }
}
