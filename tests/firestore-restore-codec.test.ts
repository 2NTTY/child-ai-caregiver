import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { FieldValue, VectorValue, type DocumentSnapshot } from '@google-cloud/firestore';
import { z } from 'zod';
import { createFirestoreRestoreCodec, type FirestoreRestoreTransform } from '../server/firestore-restore-codec.ts';
import { originalRestoreScopeKinds } from '../server/firestore-restore-operation-records.ts';
import { createFirestoreAuthority, firestoreAuthoritySchemas } from '../server/firestore-authority.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirestoreFamilyDocumentStore, firestoreFamilyDocumentSchemas } from '../server/firestore-family-documents.ts';
import { FirestoreDomainData, firestoreDomainHash, firestoreTaskSchema, firestoreReminderOutboxSchema,
  sealFirestoreReminderOutbox, FIRESTORE_TASK_DISPATCH_SCOPE } from '../server/firestore-domain-data.ts';
import { firestoreOnlineConfirmedSchema, firestoreOnlineErasureBarrierSchema } from '../server/firestore-online-receipts.ts';
import { createFirestorePhotoStore, firestorePhotoSchemas } from '../server/firestore-photos.ts';
import { firestoreTaskReminderSchema, firestoreTaskReminderBatchSchema, firestoreTaskNotificationOutboxSchema,
  firestoreTaskReminderId, firestoreTaskReminderBatchId } from '../server/firestore-task-worker.ts';
import { firestoreTaskDispatchScanSchema, firestoreTaskDispatchObservationSchema } from '../server/firestore-task-dispatcher.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { sealRecoveryLocator } from '../server/firestore-recovery-envelope.ts';
import { workRecoveryAad, type WorkRecoveryScope } from '../server/firestore-work-continuation-recovery.ts';
import { canonicalJson } from '../server/online-routing.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { KNOWLEDGE_EMBEDDING } from '../src/shared/knowledge.ts';
import { knowledgeHash, sourceVersionHash, parseKnowledgeSource, embeddingDocument } from '../server/knowledge-inputs.ts';
import { firebaseErasureIntentHash } from '../server/firebase-erasure-journal.ts';
import type { FirebasePhotoObjectDescriptor } from '../server/firebase-photo-objects.ts';
import { firestoreChatFileRowSchema } from '../server/firestore-chat-files.ts';
import { firestoreVoiceRowSchema } from '../server/firestore-voice.ts';
import { chatFileObjectAddress } from '../server/firebase-chat-file-objects.ts';
import { voiceObjectAddress } from '../server/firebase-voice-objects.ts';
import type { ImportProvenance } from '../src/shared/import-provenance.ts';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';

const NIL = '00000000-0000-0000-0000-000000000000', projectId = 'synthetic-restore-project', namespace = 'synthetic_restore';
const at = '2026-10-11T12:00:00.000Z', digest = 'a'.repeat(64);
const scope: WorkRecoveryScope = { ownerUserId: 'synthetic-owner', workspaceId: randomUUID(), childId: randomUUID(), storageEpoch: randomUUID() };
const newEpoch = randomUUID(), nextScope = { ...scope, storageEpoch: newEpoch }, generation = randomUUID();
const ownerScope = { ...scope, childId: NIL };
const errors = (code: string) => (error: unknown) => error instanceof Error && 'code' in error && error.code === code;
const snapshot = (raw: unknown) => ({ exists: true, data: () => raw }) as DocumentSnapshot;
function fixture() {
  const fake = firestoreDomainFixture(), options = { database: fake.database, cipher: createStorageCipher(Buffer.alloc(32, 74)), projectId, namespace };
  return { fake, options, data: new FirestoreDomainData(options), codec: createFirestoreRestoreCodec(options) };
}
function input(current: WorkRecoveryScope = scope): FirestoreRestoreTransform {
  return { newEpochByWorkspace: new Map([[current.workspaceId, newEpoch]]), generation, photoDescriptors: new Map() };
}
function record<T>(data: FirestoreDomainData, suffix: string, kind: string, id: string, current: WorkRecoveryScope,
  schema: z.ZodType<T>, value: T, version = 1) {
  return { path: namespace + '_' + suffix + '/' + firestoreDomainHash([kind, id]), data: data.seal(kind, id, current, schema, value, version) };
}
function authorityRecord(f: ReturnType<typeof fixture>, kind: 'control' | 'workspace' | 'child' | 'work', id: string, current: WorkRecoveryScope, value: unknown) {
  const aad = workRecoveryAad(projectId, namespace, kind, id, current), ciphertext = f.options.cipher.encrypt(canonicalJson(value), aad);
  return { path: namespace + '/' + firestoreDomainHash([kind, id]), data: { format: 'yuban-work-recovery', version: 1, ciphertext,
    recovery: sealRecoveryLocator({ ...f.options, ciphertext, context: { family: 'authority', kind, id, scope: current, envelopeVersion: 1, aad } }) } };
}

test('restore derives attachment import cleanup indexes from sealed publication state', () => {
  const f = fixture(), bucketName = 'synthetic-private';
  const stage = { batchId: randomUUID(), operationId: randomUUID(), actorUserId: scope.ownerUserId, sourceHash: digest };
  const provenance = (section: 'files' | 'voices' | 'photos'): ImportProvenance => ({ current: {
    source: { serverId: 'source', accountId: 'source-parent', childId: randomUUID(), section, resourceId: randomUUID(), resourceVersion: 1,
      authorUserId: null, createdAt: at, confirmedBy: null, confirmedAt: null, confirmationBasis: null, assigneeUserId: null },
    sourceHash: digest, packageId: randomUUID(), packageVersion: 1, manifestSha256: digest, integrity: 'trusted', importedBy: scope.ownerUserId, importedAt: at,
  }, previous: [] });
  for (const section of ['files', 'voices', 'photos'] as const) {
    const id = randomUUID(), mimeType = section === 'voices' ? 'audio/wav' : section === 'photos' ? 'image/png' : 'text/plain';
    const address = (current: WorkRecoveryScope) => section === 'photos'
      ? 'photos/v1/' + createHash('sha256').update(JSON.stringify(['yuban-photo-object', 1, projectId, namespace, current])).digest('hex') + '/' + id
      : (section === 'voices' ? voiceObjectAddress : chatFileObjectAddress)({ projectId, namespace, bucketName }, current, id).objectName;
    const descriptor = { objectName: address(scope), generation: '1', cipherSha256: digest, sha256: digest, bytes: 20, mimeType,
      ...(section === 'voices' ? { durationMs: 1000 } : {}) };
    const kind = section === 'photos' ? 'photo' : section === 'voices' ? 'voice-asset' : 'chat-file-asset';
    const suffix = section === 'photos' ? 'photos' : section === 'voices' ? 'voice_assets' : 'chat_file_assets';
    const schema = section === 'photos' ? firestorePhotoSchemas.photo : section === 'voices' ? firestoreVoiceRowSchema : firestoreChatFileRowSchema;
    for (const published of [false, true]) {
      const row = schema.parse({ id, scope, version: 1, createdAt: at, state: published ? 'ready' : 'reserved',
        metadata: { fileName: 'import.bin', mimeType, bytes: 20, sha256: digest, ...(section === 'photos' ? { source: 'Imported source' } : {}) },
        descriptor, upload: null, deletion: null, importStage: stage, ...(published ? { importedFrom: provenance(section) } : {}),
        ...(section === 'photos' ? { reservationOperationId: stage.operationId } : { updatedAt: at, fingerprint: digest, objectScope: scope, messageId: null }),
      });
      const original = record(f.data, suffix, kind, id, scope, schema as z.ZodType<unknown>, row);
      const replacement = { ...descriptor, objectName: address(nextScope) };
      const target = { ...input(), photoDescriptors: new Map(section === 'photos' ? [[id, replacement as FirebasePhotoObjectDescriptor]] : []),
        ...(section === 'voices' ? { voiceObjectBucketName: bucketName, voiceDescriptors: new Map([[id, { ...replacement, mimeType: 'audio/wav' as const, durationMs: 1000 }]]) } : {}),
        ...(section === 'files' ? { chatFileObjectBucketName: bucketName, chatFileDescriptors: new Map([[id, replacement]]) } : {}),
      };
      const changed = f.codec.transform(f.codec.decode(original), target);
      if (section === 'photos') assert.equal(changed.data.importPending, !published);
      else assert.equal(changed.data.cleanupState, published ? null : 'unlinked');
      // Query metadata is never trusted when rebuilding maintenance indexes.
      assert.doesNotThrow(() => f.codec.decode(changed));
      const forged = { ...original, data: { ...original.data, ...(section === 'photos' ? { importPending: published } : { cleanupState: published ? 'unlinked' : null }) } };
      const again = f.codec.transform(f.codec.decode(forged), target);
      assert.equal(again.data[section === 'photos' ? 'importPending' : 'cleanupState'], section === 'photos' ? !published : published ? null : 'unlinked');
    }
  }
});

test('restore authenticates actual canonical/domain writers, rebinds epochs and IDs, and preserves original operation fingerprints/results', async () => {
  const f = fixture(), authority = createFirestoreAuthority(f.options), online = createFirestoreOnlineStore(f.options);
  await authority.initializeControl({ generation: randomUUID(), enabled: true });
  await authority.issueInvitation({ email: 'synthetic@example.test', expiresAt: '2030-01-01T00:00:00Z', operationId: randomUUID() });
  const identity = await authority.admitIdentity({ userId: 'synthetic-owner', email: 'synthetic@example.test', emailVerified: true });
  await authority.acknowledge({ userId: 'synthetic-owner', policyVersion: SERVICE_POLICY_VERSION, operationId: randomUUID() });
  const child = await authority.createChild({ userId: 'synthetic-owner', displayName: '合成還原孩子', operationId: randomUUID() });
  const path = '/api/children/' + child.child.id + '/tasks', payload = { confirm: true, values: { title: 'Private original task', details: 'Private untruncated body',
    kind: 'ordinary', assigneeUserId: 'synthetic-owner', dueAt: '2030-01-01T12:00:00Z', timeZone: 'Asia/Hong_Kong' } };
  await online.submit('synthetic-owner', { path, payload, operation: { ...await online.context('synthetic-owner', { path, payload }), opId: randomUUID(), deviceId: randomUUID() } });
  await createFirestoreFamilyDocumentStore(f.options).create('synthetic-owner', child.child.id, { kind: 'preparation', purpose: 'appointment',
    title: 'Private document', eventDate: '2026-10-15', period: { from: '2026-10-01', to: '2026-10-31' } }, randomUUID());
  const target = { ...input(), newEpochByWorkspace: new Map([[identity.workspaceId, newEpoch]]) };
  let checked = 0;
  for (const [originalPath, raw] of f.fake.records) {
    const decoded = f.codec.decode({ path: originalPath, data: raw }), transformed = f.codec.transform(decoded, target);
    const reopened = f.codec.decode({ path: transformed.path, data: transformed.data });
    assert.equal(transformed.oldPath, originalPath); checked++;
    if (decoded.context.family !== 'knowledge' && reopened.context.family !== 'knowledge') {
      assert.equal(reopened.context.scope.storageEpoch,
        originalRestoreScopeKinds.has(decoded.context.kind) ? decoded.context.scope.storageEpoch : decoded.context.scope.storageEpoch === NIL ? NIL : newEpoch,
        decoded.context.kind);
      if (decoded.context.kind === 'control') assert.deepEqual(reopened.value, { enabled: false, generation });
      if (decoded.context.kind === 'workspace') {
        const before = firestoreAuthoritySchemas.workspace.parse(decoded.value), after = firestoreAuthoritySchemas.workspace.parse(reopened.value);
        assert.equal(after.accessVersion, (BigInt(before.accessVersion) + 1n).toString()); assert.equal(after.changeSeq, before.changeSeq);
      }
      if (decoded.context.kind === 'change' || decoded.context.kind === 'change-projection') assert.notEqual(transformed.path, originalPath);
      if (decoded.context.kind === 'authority-operation') assert.deepEqual(reopened.value, decoded.value);
      if (decoded.context.kind === 'family-document') {
        const document = firestoreFamilyDocumentSchemas.metadata.parse(decoded.value);
        assert.equal(transformed.data.autoRefresh, document.autoRefresh);
        assert.throws(() => f.codec.decode({ path: originalPath, data: { ...raw, autoRefresh: !document.autoRefresh } }), errors('restore_binding'));
        const { autoRefresh: _oldProjection, ...legacy } = raw;
        assert.deepEqual(f.codec.decode({ path: originalPath, data: legacy }).value, decoded.value);
      }
      if (decoded.context.kind === 'online-receipt') {
        const before = firestoreOnlineConfirmedSchema.parse(decoded.value), after = firestoreOnlineConfirmedSchema.parse(reopened.value);
        assert.equal(after.fingerprint, before.fingerprint); assert.deepEqual(after.operation, before.operation);
        assert.deepEqual(after.result, before.result); assert.equal(after.restoredFromEpoch, identity.storageEpoch);
        assert.equal(transformed.data.epochTag, f.data.tags({ ...child.scope, storageEpoch: newEpoch, childId: NIL }).epochTag);
      }
      if (decoded.context.kind === 'task') {
        const value = firestoreTaskSchema.parse(decoded.value), oldScope = decoded.context.scope;
        assert.deepEqual(f.data.open('task', decoded.context.id, reopened.context.scope, firestoreTaskSchema, snapshot(transformed.data)), value);
        assert.throws(() => f.data.open('task', decoded.context.id, oldScope, firestoreTaskSchema, snapshot(transformed.data)), errors('invalid_document'));
      }
    }
  }
  assert.ok(checked >= 15);
  const workspace = f.codec.decode(authorityRecord(f, 'workspace', scope.workspaceId, scope, { id: scope.workspaceId, ownerUserId: scope.ownerUserId,
    storageEpoch: scope.storageEpoch, accessVersion: '9223372036854775807', changeSeq: '0', status: 'active' }));
  assert.throws(() => f.codec.transform(workspace, input()), errors('restore_version_exhausted'));
  assert.throws(() => f.codec.transform(workspace, { ...input(), newEpochByWorkspace: new Map() }), errors('restore_epoch_missing'));
});

test('restore fences leased/unknown work, preserves stable reminder identities and barriers, and resets only the dispatch scan', () => {
  const f = fixture(), taskId = randomUUID(), occurrenceId = randomUUID(), id = JSON.stringify([taskId, 4]);
  for (const state of ['leased', 'unknown'] as const) {
    const work = firestoreReminderOutboxSchema.parse({ ...scope, taskId, occurrenceId, taskVersion: 4, dueAt: at,
      authorizationVersion: '7', generation: randomUUID(), state, attempts: 2, failures: 1,
      lease: state === 'leased' ? { token: randomUUID(), generation: randomUUID(), until: at } : null });
    const decoded = f.codec.decode({ path: namespace + '_task_outbox/' + firestoreDomainHash(['task-reminder-outbox', id]),
      data: sealFirestoreReminderOutbox(f.data, scope, work) });
    const changed = f.codec.transform(decoded, input()), restored = firestoreReminderOutboxSchema.parse(f.codec.decode({ path: changed.path, data: changed.data }).value);
    assert.equal(restored.state, 'unknown'); assert.equal(restored.lease, null); assert.equal(restored.attempts, 2);
    assert.equal(restored.authorizationVersion, '8'); assert.equal(restored.generation, generation); assert.equal(restored.storageEpoch, newEpoch);
    assert.equal(changed.data.dispatchId, firestoreDomainHash(['task-reminder-outbox', id]));
  }
  const reminderId = firestoreTaskReminderId(scope, occurrenceId, 'initial'), batchId = firestoreTaskReminderBatchId(ownerScope, 'ordinary', 'synthetic-batch');
  assert.equal(firestoreTaskReminderId(nextScope, occurrenceId, 'initial'), reminderId);
  const reminder = { id: reminderId, batchId, taskId, occurrenceId, taskVersion: 4, phase: 'initial' as const, createdAt: at };
  const reminderChanged = f.codec.transform(f.codec.decode(record(f.data, 'task_reminders', 'task-reminder', reminderId, scope, firestoreTaskReminderSchema, reminder, 4)), input());
  assert.deepEqual(f.codec.decode({ path: reminderChanged.path, data: reminderChanged.data }).value, reminder);
  const batch = { id: batchId, recipientUserId: scope.ownerUserId, category: 'ordinary' as const, key: 'synthetic-batch', state: 'sealed' as const, createdAt: at };
  const batchChanged = f.codec.transform(f.codec.decode(record(f.data, 'task_reminder_batches', 'task-reminder-batch', batchId, ownerScope, firestoreTaskReminderBatchSchema, batch)), input());
  assert.deepEqual(f.codec.decode({ path: batchChanged.path, data: batchChanged.data }).value, batch);
  const notification = { id: reminderId, reminderId, taskId, occurrenceId, taskVersion: 4, recipientUserId: scope.ownerUserId, createdAt: at, state: 'leased' as const };
  const notificationChanged = f.codec.transform(f.codec.decode(record(f.data, 'notification_outbox', 'task-notification-outbox', reminderId, scope, firestoreTaskNotificationOutboxSchema, notification, 4)), input());
  assert.equal(firestoreTaskNotificationOutboxSchema.parse(f.codec.decode({ path: notificationChanged.path, data: notificationChanged.data }).value).state, 'unknown');
  const barrier = { state: 'erasure_barrier' as const, ownerUserId: scope.ownerUserId, operationId: randomUUID(), childId: scope.childId, assetId: randomUUID(), intentSha256: digest };
  const barrierId = JSON.stringify([scope.ownerUserId, barrier.operationId]), barrierChanged = f.codec.transform(f.codec.decode(record(f.data, 'online_operations', 'online-receipt',
    barrierId, ownerScope, firestoreOnlineErasureBarrierSchema, barrier)), input());
  assert.deepEqual(f.codec.decode({ path: barrierChanged.path, data: barrierChanged.data }).value, barrier);
  const scan = { revision: 2, cursor: { version: 1 as const, lane: 'pending' as const, at, time: at, id: digest }, lease: { token: randomUUID(), until: at } };
  const scanChanged = f.codec.transform(f.codec.decode(record(f.data, 'task_dispatches', 'task-dispatch-scan', 'current', FIRESTORE_TASK_DISPATCH_SCOPE,
    firestoreTaskDispatchScanSchema, scan, 2)), input());
  assert.deepEqual(f.codec.decode({ path: scanChanged.path, data: scanChanged.data }).value, { revision: 3, cursor: null, lease: null });
  const observation = { taskName: 'projects/synthetic/locations/hk/queues/synthetic/tasks/original', jobHash: digest, scheduledAt: at, state: 'unknown' as const,
    calls: 1, unresolved: 1, confirmedAt: null, createdAt: at, updatedAt: at, lease: null };
  const observed = f.codec.transform(f.codec.decode(record(f.data, 'task_dispatches', 'task-dispatch-observation', observation.taskName, scope,
    firestoreTaskDispatchObservationSchema, observation, 4)), input());
  assert.deepEqual(f.codec.decode({ path: observed.path, data: observed.data }).value, observation);
});

test('restore requires rebound photo descriptors, preserves deletion evidence/cleanup envelopes, and rebuilds epoch-derived quota IDs', () => {
  const f = fixture(), photoId = randomUUID(), operationId = randomUUID();
  const descriptor: FirebasePhotoObjectDescriptor = { objectName: 'photos/v1/original/' + photoId, generation: '1', cipherSha256: digest,
    sha256: digest, bytes: 42, mimeType: 'image/png' };
  const scopeHash = createHash('sha256').update(JSON.stringify(['yuban-photo-object', 1, projectId, namespace, nextScope])).digest('hex');
  const nextDescriptor = { ...descriptor, objectName: 'photos/v1/' + scopeHash + '/' + photoId, generation: '2', cipherSha256: 'b'.repeat(64) };
  const intent = { scope, assetId: photoId, operationId, at, type: 'photo-delete' as const }, fingerprint = firestoreDomainHash(['delete', photoId, 1]);
  const journal = { objectName: 'erasures/v1/' + digest, generation: '1', cipherSha256: digest, intentSha256: firebaseErasureIntentHash(intent), bytes: 120, format: 'yuban-erasure-journal/v1' as const };
  const row = { id: photoId, scope, reservationOperationId: randomUUID(), createdAt: at, version: 2, state: 'deleting' as const,
    metadata: { fileName: 'synthetic.png', mimeType: 'image/png' as const, bytes: 42, sha256: digest, source: 'synthetic' }, descriptor, upload: null,
    deletion: { intent, fingerprint, expectedVersion: 1, journal } };
  const decoded = f.codec.decode(record(f.data, 'photos', 'photo', photoId, scope, firestorePhotoSchemas.photo, row, 2));
  assert.throws(() => f.codec.transform(decoded, input()), errors('restore_photo_descriptor_missing'));
  const changed = f.codec.transform(decoded, { ...input(), photoDescriptors: new Map([[photoId, nextDescriptor]]) });
  const restored = firestorePhotoSchemas.photo.parse(f.codec.decode({ path: changed.path, data: changed.data }).value);
  assert.deepEqual(restored.descriptor, nextDescriptor); assert.deepEqual(restored.deletion, row.deletion);
  assert.equal(restored.scope.storageEpoch, newEpoch); assert.equal(changed.data.scopeTag, firestoreDomainHash([projectId, namespace, 'photo-scope', nextScope]));
  assert.throws(() => f.codec.transform(decoded, { ...input(), photoDescriptors: new Map([[photoId, { ...nextDescriptor, sha256: 'c'.repeat(64) }]]) }), errors('restore_binding'));
  const upload = { id: randomUUID(), reservationOperationId: row.reservationOperationId, sha256: digest, bytes: 42, mimeType: 'image/png' as const,
    authorizationVersion: '1', generation: randomUUID(), startedAt: at };
  const unfinished = f.codec.decode(record(f.data, 'photos', 'photo', photoId, scope, firestorePhotoSchemas.photo, { ...row, upload }, 2));
  assert.throws(() => f.codec.transform(unfinished, input()), errors('restore_unsettled_upload'));
  const cleanup = { scope, photoId, operationId, state: 'known' as const, uploadStarted: false, upload: null,
    sha256: digest, bytes: 42, mimeType: 'image/png' as const, descriptor, journal };
  const oldCleanup = record(f.data, 'photo_cleanup', 'photo-cleanup', photoId, scope, firestorePhotoSchemas.cleanup, cleanup);
  const cleanupChanged = f.codec.transform(f.codec.decode(oldCleanup), input());
  assert.equal(cleanupChanged.path, oldCleanup.path); assert.equal(cleanupChanged.data.ciphertext, oldCleanup.data.ciphertext);
  assert.deepEqual(f.codec.decode({ path: cleanupChanged.path, data: cleanupChanged.data }).value, cleanup);
  const quotaId = firestoreDomainHash([projectId, namespace, 'photo-scope', scope]);
  const quota = f.codec.transform(f.codec.decode(record(f.data, 'photo_quota', 'photo-child-quota', quotaId, scope, firestorePhotoSchemas.childQuota, { bytes: 42, count: 1 })), input());
  const expectedId = firestoreDomainHash([projectId, namespace, 'photo-scope', nextScope]);
  assert.equal(quota.path, namespace + '_photo_quota/' + firestoreDomainHash(['photo-child-quota', expectedId]));
  assert.equal(quota.data.scopeTag, expectedId);
});

function stableUuid(value: unknown): string {
  const bytes = createHash('sha256').update(JSON.stringify(value)).digest().subarray(0, 16);
  bytes.writeUInt8((bytes.readUInt8(6) & 15) | 80, 6); bytes.writeUInt8((bytes.readUInt8(8) & 63) | 128, 8);
  const h = bytes.toString('hex'); return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
}

test('restore fails closed on unknown collections/kinds, mismatched paths, missing locators/tampering and preserves native public vectors', () => {
  const f = fixture(), child = authorityRecord(f, 'child', scope.childId, scope, { id: scope.childId, workspaceId: scope.workspaceId, status: 'active' });
  assert.throws(() => f.codec.decode({ ...child, path: 'unknown_collection/' + digest }), errors('unsupported_restore_domain'));
  assert.throws(() => f.codec.decode({ ...child, path: namespace + '/' + 'f'.repeat(64) }), errors('restore_binding'));
  assert.throws(() => f.codec.decode({ ...child, data: { ...child.data, recovery: undefined } }), errors('recovery_locator_missing'));
  assert.throws(() => f.codec.decode({ ...child, data: { ...child.data, ciphertext: child.data.ciphertext.slice(0, -1) + 'X' } }), errors('recovery_locator_ciphertext'));
  const work = authorityRecord(f, 'work', randomUUID(), scope, {});
  assert.throws(() => f.codec.decode(work), errors('unsupported_restore_domain'));
  const fakeChild = { id: scope.childId, workspaceId: randomUUID(), status: 'active' };
  assert.throws(() => f.codec.decode(authorityRecord(f, 'child', scope.childId, scope, fakeChild)), errors('restore_binding'));
  assert.throws(() => f.codec.decode({ ...child, data: { ...child.data, extra: 'untrusted' } }), errors('restore_record_invalid'));
  const document = parseKnowledgeSource({ sourceId: 'synthetic-guidance', url: 'https://www.fhs.gov.hk/synthetic-restore', title: 'Synthetic guidance',
    publisher: 'Synthetic publisher', classification: 'official_guidance', sourcePublishedAt: null, sourceUpdatedAt: null,
    fetchedAt: '2026-01-01T00:00:00Z', termsUrl: 'https://www.fhs.gov.hk/terms', chunks: [{ key: 'first', section: 'Synthetic section',
      sourceExcerpt: 'Synthetic excerpt', text: 'Synthetic body', keywords: ['synthetic'], applicability: { region: 'HK', ageBasis: 'any',
        minAgeMonths: null, maxAgeMonths: null, topics: ['care'], conditions: [] } }] });
  const versionHash = sourceVersionHash(document), versionId = stableUuid([projectId, namespace, 'version', document.sourceId, versionHash]);
  const chunkDocument = document.chunks[0]; assert.ok(chunkDocument);
  const chunkId = stableUuid([projectId, namespace, 'chunk', versionId, chunkDocument.key]), values = [1, ...Array(1023).fill(0)];
  const publicChunk = { schemaVersion: 1, projectId, namespace, sourceId: document.sourceId, versionId, chunkId, order: 1, document: chunkDocument,
    contentHash: knowledgeHash(chunkDocument), embeddingHash: embeddingDocument(document.title, chunkDocument.section, chunkDocument.text).hash,
    embedding: FieldValue.vector(values), vectorHash: knowledgeHash(values), ...KNOWLEDGE_EMBEDDING };
  const decodedChunk = f.codec.decode({ path: namespace + '_knowledge_chunks/' + chunkId, data: publicChunk });
  const preserved = f.codec.transform(decodedChunk, input());
  assert.equal(preserved.data.embedding, publicChunk.embedding); assert.ok(preserved.data.embedding instanceof VectorValue);
  assert.deepEqual(preserved.data.embedding.toArray(), values);
  assert.throws(() => f.codec.decode({ path: preserved.path, data: { ...publicChunk, embedding: { values } } }), errors('restore_record_invalid'));
  assert.throws(() => f.codec.decode({ path: preserved.path, data: { ...publicChunk, contentHash: 'b'.repeat(64) } }), errors('restore_binding'));
  const { chunks: sourceChunks, ...header } = document;
  const edition = { schemaVersion: 1, projectId, namespace, sourceId: document.sourceId, versionId, versionHash, header,
    chunks: [{ chunkId, key: chunkDocument.key, order: 1 }], reviewState: 'draft', checkedAt: null, publishedAt: null, review: null };
  const editionDecoded = f.codec.decode({ path: namespace + '_knowledge_versions/' + versionId, data: edition });
  assert.deepEqual(f.codec.transform(editionDecoded, input()).data, edition);
  const source = { schemaVersion: 1, projectId, namespace, sourceId: document.sourceId, url: document.url, activeVersionId: versionId,
    enabled: false, revision: '1', disabledReason: 'Synthetic withdrawn source' };
  const sourceDecoded = f.codec.decode({ path: namespace + '_knowledge_sources/' + document.sourceId, data: source });
  assert.deepEqual(f.codec.transform(sourceDecoded, input()).data, source);
});

async function readyPhoto(f: ReturnType<typeof fixture>) {
  const authority = createFirestoreAuthority(f.options);
  await authority.initializeControl({ generation: randomUUID(), enabled: true });
  await authority.issueInvitation({ email: 'synthetic-photo@example.test', expiresAt: '2030-01-01T00:00:00Z', operationId: randomUUID() });
  await authority.admitIdentity({ userId: 'synthetic-owner', email: 'synthetic-photo@example.test', emailVerified: true });
  await authority.acknowledge({ userId: 'synthetic-owner', policyVersion: SERVICE_POLICY_VERSION, operationId: randomUUID() });
  const binding = await authority.createChild({ userId: 'synthetic-owner', operationId: randomUUID(), displayName: '合成附件還原孩子' });
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(4), Buffer.from('IHDR'), Buffer.alloc(8)]);
  const bytesHash = createHash('sha256').update(png).digest('hex');
  const store = createFirestorePhotoStore({ ...f.options, serverClock: () => Date.parse(at), objects: {
    async write(current, id, value) {
      const scopeHash = createHash('sha256').update(JSON.stringify(['yuban-photo-object', 1, projectId, namespace, current])).digest('hex');
      return { objectName: 'photos/v1/' + scopeHash + '/' + id, generation: '1', cipherSha256: digest,
        sha256: bytesHash, bytes: png.length, mimeType: value.mimeType };
    },
    async recover() { throw new Error('Unexpected synthetic recovery'); },
    async read() { throw new Error('Unexpected synthetic object read'); },
  }, journal: { async writeOnce(intent) {
    return { objectName: 'erasures/v1/' + digest, generation: '1', cipherSha256: digest, intentSha256: firebaseErasureIntentHash(intent),
      bytes: 120, format: 'yuban-erasure-journal/v1' };
  } } });
  const photo = await store.reserve('synthetic-owner', binding.scope.childId, randomUUID(), {
    fileName: 'synthetic.png', mimeType: 'image/png', bytes: png.length, sha256: bytesHash, source: 'synthetic',
  });
  await store.upload('synthetic-owner', binding.scope.childId, photo.id, png.toString('base64'));
  const path = namespace + '_photos/' + firestoreDomainHash(['photo', photo.id]);
  const raw = f.fake.records.get(path);
  const row = f.data.open('photo', photo.id, binding.scope, firestorePhotoSchemas.photo, snapshot(raw));
  const restoredScope = { ...binding.scope, storageEpoch: newEpoch };
  const scopeHash = createHash('sha256').update(JSON.stringify(['yuban-photo-object', 1, projectId, namespace, restoredScope])).digest('hex');
  assert.ok(row.descriptor);
  const replacement = { ...row.descriptor, objectName: 'photos/v1/' + scopeHash + '/' + row.id, generation: '2', cipherSha256: 'b'.repeat(64) };
  const restoreInput = { ...input(binding.scope), photoDescriptors: new Map([[photo.id, replacement]]) };
  return { binding, photo, path, raw, row, store, replacement, restoreInput };
}

test('restore accepts completed ready uploads from the production photo writer and preserves upload evidence with new fencing', async () => {
  const f = fixture(), original = await readyPhoto(f);
  assert.equal(original.row.state, 'ready'); assert.ok(original.row.upload);
  const decoded = f.codec.decode({ path: original.path, data: original.raw });
  const changed = f.codec.transform(decoded, original.restoreInput);
  const restored = firestorePhotoSchemas.photo.parse(f.codec.decode({ path: changed.path, data: changed.data }).value);
  assert.deepEqual(restored.upload, { ...original.row.upload,
    authorizationVersion: (BigInt(original.row.upload.authorizationVersion) + 1n).toString(), generation });
  assert.deepEqual(restored.metadata, original.row.metadata); assert.deepEqual(restored.descriptor, original.replacement);
  assert.equal(restored.scope.storageEpoch, newEpoch);
  assert.throws(() => f.codec.transform(decoded, input(original.binding.scope)), errors('restore_photo_descriptor_missing'));
  for (const patch of [{ sha256: 'c'.repeat(64) }, { bytes: original.row.upload.bytes + 1 }, { mimeType: 'image/jpeg' }, { reservationOperationId: randomUUID() }]) {
    const malformed = firestorePhotoSchemas.photo.parse({ ...original.row, upload: { ...original.row.upload, ...patch } });
    assert.throws(() => f.codec.transform(f.codec.decode(record(f.data, 'photos', 'photo', malformed.id, malformed.scope,
      firestorePhotoSchemas.photo, malformed, malformed.version)), original.restoreInput), errors('restore_binding'));
  }
  const pending = firestorePhotoSchemas.photo.parse({ ...original.row, state: 'reserved', descriptor: null });
  assert.throws(() => f.codec.transform(f.codec.decode(record(f.data, 'photos', 'photo', pending.id, pending.scope,
    firestorePhotoSchemas.photo, pending, pending.version)), original.restoreInput), errors('restore_unsettled_upload'));
});

test('restore decodes production deleted photo fingerprints separately from journal intent hashes and rejects tampering', async () => {
  const f = fixture(), original = await readyPhoto(f), operationId = randomUUID();
  await original.store.delete('synthetic-owner', original.binding.scope.childId, original.photo.id, original.row.version, operationId);
  const raw = f.fake.records.get(original.path);
  const row = f.data.open('photo', original.photo.id, original.binding.scope, firestorePhotoSchemas.photo, snapshot(raw));
  assert.equal(row.state, 'deleted'); assert.ok(row.deletion); assert.ok(row.deletion.journal); assert.ok(row.upload);
  assert.equal(row.deletion.fingerprint, firestoreDomainHash(['delete', row.id, row.deletion.expectedVersion]));
  assert.equal(row.deletion.journal.intentSha256, firebaseErasureIntentHash(row.deletion.intent));
  assert.notEqual(row.deletion.fingerprint, row.deletion.journal.intentSha256);
  const decoded = f.codec.decode({ path: original.path, data: raw });
  assert.throws(() => f.codec.transform(decoded, original.restoreInput), errors('restore_unsettled_upload'));
  const wrongVersion = firestorePhotoSchemas.photo.parse({ ...row, deletion: { ...row.deletion, expectedVersion: row.deletion.expectedVersion + 1 } });
  assert.throws(() => f.codec.decode(record(f.data, 'photos', 'photo', row.id, row.scope, firestorePhotoSchemas.photo, wrongVersion, row.version)), errors('restore_binding'));
  const wrongIntent = firestorePhotoSchemas.photo.parse({ ...row, deletion: { ...row.deletion, journal: { ...row.deletion.journal, intentSha256: 'c'.repeat(64) } } });
  assert.throws(() => f.codec.decode(record(f.data, 'photos', 'photo', row.id, row.scope, firestorePhotoSchemas.photo, wrongIntent, row.version)), errors('restore_binding'));
});

test('restore accepts production owner-level authority changes with null childId and keeps their original binding', async () => {
  const f = fixture(), authority = createFirestoreAuthority(f.options);
  await authority.initializeControl({ generation: randomUUID(), enabled: true });
  await authority.issueInvitation({ email: 'synthetic-owner-change@example.test', expiresAt: '2030-01-01T00:00:00Z', operationId: randomUUID() });
  const admitted = await authority.admitIdentity({ userId: 'synthetic-owner', email: 'synthetic-owner-change@example.test', emailVerified: true });
  await authority.acknowledge({ userId: 'synthetic-owner', policyVersion: SERVICE_POLICY_VERSION, operationId: randomUUID() });
  const operationId = randomUUID();
  await authority.runTransaction('synthetic-owner', null, async binding => { const prepared = await binding.prepareChange(operationId, 'preferences', false); prepared.commit(); });
  const oldId = JSON.stringify([admitted.workspaceId, admitted.storageEpoch, 'synthetic-owner', NIL, operationId, 'authority']);
  const path = namespace + '/' + firestoreDomainHash(['change', oldId]);
  const decoded = f.codec.decode({ path, data: f.fake.records.get(path) });
  const changed = f.codec.transform(decoded, { ...input(), newEpochByWorkspace: new Map([[admitted.workspaceId, newEpoch]]) });
  const expectedId = JSON.stringify([admitted.workspaceId, newEpoch, 'synthetic-owner', NIL, operationId, 'authority']);
  assert.equal(changed.path, namespace + '/' + firestoreDomainHash(['change', expectedId]));
  const reopened = f.codec.decode({ path: changed.path, data: changed.data });
  assert.ok('childId' in reopened.value); assert.equal(reopened.value.childId, null);
  assert.ok('storageEpoch' in reopened.value); assert.equal(reopened.value.storageEpoch, newEpoch);
});
