import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';
import { avatarMemoryBucket } from './helpers/avatar-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { FirestoreDomainData } from '../server/firestore-domain-data.ts';
import { createFirestoreAccountExport } from '../server/firestore-account-export.ts';
import { createFirestoreRestoreCodec } from '../server/firestore-restore-codec.ts';
import { assertFirestoreRestoreContent } from '../server/firestore-restore-content.ts';
import { handoverImportItemId, handoverImportMappingId, handoverImportMappingSchema } from '../server/handover-import-records.ts';
import { createFirebaseHandoverObjects } from '../server/firebase-handover-objects.ts';
import { createHandoverUploadService } from '../server/handover-upload-service.ts';
import { createHandoverImportService } from '../server/handover-import-service.ts';
import { createFirebaseWorkerServices } from '../server/firebase-worker-services.ts';
import { writePersonalHandoverPackage } from '../server/handover-export.ts';
import { createChatFileObjects } from '../server/firebase-chat-file-objects.ts';
import { createVoiceObjects } from '../server/firebase-voice-objects.ts';
import { createFirebasePhotoObjects } from '../server/firebase-photo-objects.ts';
import { createAvatarObjects } from '../server/firebase-avatar-objects.ts';
import { createFirebaseErasureJournal } from '../server/firebase-erasure-journal.ts';
import { createFirestoreChatFilesStore } from '../server/firestore-chat-files.ts';
import { createFirestoreVoiceStore, firestoreVoiceRowSchema } from '../server/firestore-voice.ts';
import { createFirestoreVoiceTranscripts, firestoreVoiceTranscriptSchema } from '../server/firestore-voice-transcripts.ts';
import { createFirestorePhotoStore } from '../server/firestore-photos.ts';
import { createFirestoreAvatarStore } from '../server/firestore-avatars.ts';
import { readAvatarConfig } from '../server/avatar-config.ts';
import { originalBackupComparisonQuerySchema, originalBackupComparisonSchema } from '../src/shared/handover-imports.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

test('signed original attachment backups retain immutable live assets and restore only proven deletions once without transcription', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'handover-original-attachments-')), controller = new AbortController();
  try {
    const fixture = serialFirestoreFixture(), cipher = createStorageCipher(Buffer.alloc(32, 199));
    const options = { database: fixture.database, cipher, projectId: 'synthetic-own-attachments', namespace: 'original_attachments' };
    const authority = createFirestoreAuthority(options), data = new FirestoreDomainData(options), codec = createFirestoreRestoreCodec(options);
    await authority.initializeControl({ enabled: true, generation: randomUUID() });
    await authority.issueInvitation({ email: 'parent@example.test', operationId: randomUUID(), expiresAt: new Date(Date.now() + 3600000).toISOString() });
    await authority.admitIdentity({ userId: 'parent', email: 'parent@example.test', emailVerified: true });
    await authority.acknowledge({ userId: 'parent', operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
    const childId = (await authority.createChild({ userId: 'parent', operationId: randomUUID(), displayName: 'Original attachments' })).child.id;
    const scope = await authority.runTransaction('parent', childId, b => Promise.resolve(b.scope));
    const config = (bucketName: string) => ({ projectId: options.projectId, namespace: options.namespace, bucketName });
    const fileBucket = avatarMemoryBucket('synthetic-original-files'), voiceBucket = avatarMemoryBucket('synthetic-original-voices');
    const photoBucket = avatarMemoryBucket('synthetic-original-photos'), journalBucket = avatarMemoryBucket('synthetic-original-journal');
    const avatarBucket = avatarMemoryBucket('synthetic-original-avatars');
    const journal = createFirebaseErasureJournal({ config: config('synthetic-original-journal'), cipher, bucket: journalBucket.port });
    const files = createFirestoreChatFilesStore({ ...options, journal,
      objects: createChatFileObjects({ config: config('synthetic-original-files'), cipher, bucket: fileBucket.port }) });
    const voices = createFirestoreVoiceStore({ ...options, journal,
      objects: createVoiceObjects({ config: config('synthetic-original-voices'), cipher, bucket: voiceBucket.port }) });
    const photos = createFirestorePhotoStore({ ...options, journal,
      objects: createFirebasePhotoObjects({ config: config('synthetic-original-photos'), cipher, bucket: photoBucket.port }) });
    const transcripts = createFirestoreVoiceTranscripts({ ...options, voices });
    const avatarConfig = readAvatarConfig({ AVATAR_WRITES_ENABLED: 'true' });
    const avatars = createFirestoreAvatarStore({ ...options, journal, config: avatarConfig,
      objects: createAvatarObjects({ config: config('synthetic-original-avatars'), cipher, bucket: avatarBucket.port }),
      codec: { async normalize() { throw Error('An empty source avatar must not decode'); } } });
    const fileBytes = Buffer.from('PRIVATE_ORIGINAL_FILE_BYTES');
    async function file(fileName: string) {
      const reserved = await files.reserve('parent', childId, { opId: randomUUID(), fileName, mimeType: 'text/plain', bytes: fileBytes.length, sha256: hash(fileBytes) });
      return files.upload('parent', childId, reserved.id, reserved.version, fileBytes.toString('base64'), controller.signal);
    }
    const live = await file('PRIVATE_LIVE_FILE.txt'), deleted = await file('PRIVATE_DELETED_FILE.txt');
    const missing = await file('PRIVATE_MISSING_FILE.txt'), unsettled = await file('PRIVATE_UNSETTLED_FILE.txt');
    // The same valid one-second PCM fixture used by the attachment pipeline.
    const voiceBytes = Buffer.alloc(44 + 16000);
    voiceBytes.write('RIFF'); voiceBytes.writeUInt32LE(36 + 16000, 4); voiceBytes.write('WAVEfmt ', 8); voiceBytes.writeUInt32LE(16, 16);
    voiceBytes.writeUInt16LE(1, 20); voiceBytes.writeUInt16LE(1, 22); voiceBytes.writeUInt32LE(8000, 24); voiceBytes.writeUInt32LE(16000, 28);
    voiceBytes.writeUInt16LE(2, 32); voiceBytes.writeUInt16LE(16, 34); voiceBytes.write('data', 36); voiceBytes.writeUInt32LE(16000, 40);
    const voiceReserved = await voices.reserve('parent', childId, { opId: randomUUID(), fileName: 'PRIVATE_ORIGINAL_VOICE.wav', mimeType: 'audio/wav', bytes: voiceBytes.length, sha256: hash(voiceBytes) });
    const voice = await voices.upload('parent', childId, voiceReserved.id, voiceReserved.version, voiceBytes.toString('base64'), controller.signal);
    // Seed an already completed native transcript; this test must never ask a model to produce it.
    const transcriptContent = { complete: true, segments: [{ text: 'PRIVATE_RETAINED_TRANSCRIPT', startMs: 0, endMs: 1000, unclear: false }] };
    await authority.runTransaction('parent', childId, async b => {
      const voiceRef = data.ref('voice_assets', 'voice-asset', voice.id), snapshot = await b.transaction.get(voiceRef);
      const original = data.open('voice-asset', voice.id, b.scope, firestoreVoiceRowSchema, snapshot), messageId = randomUUID();
      const value = { voice: { id: voice.id, version: voice.version, mimeType: 'audio/wav' as const, bytes: voiceBytes.length, sha256: hash(voiceBytes), durationMs: 1000 },
        messageId, version: 2, state: 'available' as const, automatic: true as const, updatedAt: new Date().toISOString(), reason: null, retryAt: null, content: transcriptContent };
      const row = { scope: b.scope, value, attempt: null, modelAttempted: true, quotaDeferrals: 0 };
      b.transaction.set(voiceRef, { ...snapshot.data(), ...data.seal('voice-asset', voice.id, b.scope, firestoreVoiceRowSchema, { ...original, messageId }, original.version) });
      b.transaction.create(data.ref('voice_transcripts', 'voice-transcript', voice.id), { ...data.tags(b.scope), assetId: voice.id, state: value.state, retryAt: null,
        ...data.seal('voice-transcript', voice.id, b.scope, firestoreVoiceTranscriptSchema, row, value.version) });
    });
    const photoBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+kv1sAAAAASUVORK5CYII=', 'base64');
    const photoReserved = await photos.reserve('parent', childId, randomUUID(), { fileName: 'PRIVATE_ORIGINAL_PHOTO.png', source: 'fixture', mimeType: 'image/png', bytes: photoBytes.length, sha256: hash(photoBytes) });
    const photo = await photos.upload('parent', childId, photoReserved.id, photoBytes.toString('base64'));
    const serverId = 'https://original-attachments.example.test', keys = generateKeyPairSync('ed25519');
    const exporter = createFirestoreAccountExport({ ...options, photos, files, voices, transcripts });
    const archive = await writePersonalHandoverPackage({ exporter, directory, ownerUserId: 'parent', serverId, packageId: randomUUID(), createdAt: new Date().toISOString(),
      purpose: 'backup', signingKey: keys.privateKey, selection: { childIds: [childId], modules: ['attachments'], period: null } });
    const stored = new Map<string, { body: Buffer; metadata: unknown }>();
    const objects = createFirebaseHandoverObjects({ config: config('synthetic-original-packages'), files: cipher.files,
      bucket: { async metadata(name) { return stored.get(name)?.metadata ?? null; },
        createWrite(name, settings) { const chunks: Buffer[] = []; return new Writable({ write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); },
          final(done) { const body = Buffer.concat(chunks); stored.set(name, { body, metadata: { name, bucket: 'synthetic-original-packages',
            generation: '11111111111111111', size: String(body.length), metadata: settings.metadata?.metadata } }); done(); } }); },
        readPinned(name) { return Readable.from([stored.get(name)!.body]); }, async removePinned(name) { stored.delete(name); } } });
    const keyId = hash(keys.publicKey.export({ type: 'spki', format: 'der' }));
    const uploads = createHandoverUploadService({ ...options, objects, trustedKeys: new Map([[keyId, { key: keys.publicKey, serverId }]]) });
    const service = createHandoverImportService({ ...options, uploads, originalBackup: { serverId, async matchesIssuedBackup() { return false; } },
      attachments: { files, voices, photos, transcripts, avatars: { store: avatars, policy: avatarConfig.policy } } });
    const bytes = await readFile(archive.path), uploadId = randomUUID();
    await uploads.create('parent', { opId: uploadId, filename: 'own-attachments.zip', bytes: bytes.length, sha256: hash(bytes) });
    const upload = await uploads.receive('parent', uploadId, Readable.from([bytes]), controller.signal);
    assert.equal(upload.state, 'ready', upload.error ?? JSON.stringify(upload)); assert.equal(upload.preview!.integrity, 'trusted');
    await files.delete('parent', childId, deleted.id, deleted.version, randomUUID());
    await voices.delete('parent', childId, voice.id, voice.version, randomUUID());
    const photoDeleteOp = randomUUID(); await photos.delete('parent', childId, photo.id, photo.version, photoDeleteOp);
    assert.equal((await files.cleanupDeleted(scope, deleted.id)).state, 'complete');
    assert.equal((await voices.cleanupDeleted(scope, voice.id)).state, 'complete');
    assert.equal((await photos.cleanupDeleted(scope, photo.id, photoDeleteOp)).state, 'complete');
    await authority.runTransaction('parent', childId, async b => { b.transaction.delete(data.ref('chat_file_assets', 'chat-file-asset', missing.id)); });
    journalBucket.unavailable(true);
    try { await assert.rejects(files.delete('parent', childId, unsettled.id, unsettled.version, randomUUID())); }
    finally { journalBucket.unavailable(false); }
    const rows = [
      { section: 'files' as const, value: deleted, suffix: 'chat_file_assets', kind: 'chat-file-asset', store: files, bucket: fileBucket, bytes: fileBytes },
      { section: 'voices' as const, value: voice, suffix: 'voice_assets', kind: 'voice-asset', store: voices, bucket: voiceBucket, bytes: voiceBytes },
      { section: 'photos' as const, value: photo, suffix: 'photos', kind: 'photo', store: photos, bucket: photoBucket, bytes: photoBytes },
    ];
    const actual = (suffix: string, kind: string, id: string) => {
      const path = data.ref(suffix, kind, id).path, raw = fixture.records.get(path); assert.ok(raw);
      return codec.decode({ path, data: raw }).value as { version: number; state: string };
    };
    const tombstones = new Map(rows.map(row => [row.value.id, actual(row.suffix, row.kind, row.value.id)]));
    for (const row of rows) assert.equal(tombstones.get(row.value.id)!.state, 'deleted');
    assert.equal(actual('chat_file_assets', 'chat-file-asset', unsettled.id).state, 'deleting');
    const request = originalBackupComparisonQuerySchema.parse({ uploadId, expectedUploadVersion: upload.version, childId, module: 'attachments',
      includeAttachmentResources: true, includeRestoreTarget: true });
    const beforeComparison = structuredClone([...fixture.records]);
    async function compare() {
      const first = originalBackupComparisonSchema.parse(await service.compareOriginal('parent', request, controller.signal));
      const items = [...first.items]; let cursor = first.nextCursor;
      for (let page = 0; cursor && page < 10; page++) {
        const next = originalBackupComparisonSchema.parse(await service.compareOriginal('parent', { ...request, cursor }, controller.signal));
        items.push(...next.items); cursor = next.nextCursor;
      }
      assert.equal(cursor, null); return { ...first, items };
    }
    const comparison = await compare(), byId = new Map(comparison.items.map(item => [item.id, item]));
    assert.equal(byId.get(live.id)?.state, 'unchanged');
    for (const row of rows) {
      assert.equal(byId.get(row.value.id)?.resourceSection, row.section);
      assert.equal(byId.get(row.value.id)?.state, 'deleted'); assert.equal(byId.get(row.value.id)?.localVersion, tombstones.get(row.value.id)!.version);
    }
    assert.equal(byId.get(missing.id)?.state, 'unavailable'); assert.equal(byId.get(missing.id)?.localVersion, null);
    assert.equal(byId.get(unsettled.id)?.state, 'unavailable');
    assert.deepEqual([...fixture.records], beforeComparison); assert.doesNotMatch(JSON.stringify(comparison), /PRIVATE_/u);
    type Delivery = Parameters<ReturnType<typeof createFirebaseWorkerServices>['background']['process']>[0];
    const deliveries: Delivery[] = [];
    const worker = createFirebaseWorkerServices({ ...options, config: { ...options, taskWorkerEnabled: true }, authority, handoverImports: service,
      currentAuth: async () => ({ disabled: false, emailVerified: true, email: 'parent@example.test' }) } as unknown as Parameters<typeof createFirebaseWorkerServices>[0],
      { taskName: () => 'unused', async enqueue() { throw Error('Unexpected notification'); }, async probe() { throw Error('Unexpected notification'); } },
      { async enqueue(value) { deliveries.push(value); return { state: 'confirmed' }; }, async probe() { return { state: 'confirmed' }; } }, controller);
    async function execute(command: object & { opId: string }) {
      assert.equal((await service.create('parent', command, controller.signal)).state, 'queued');
      const work = [...fixture.records].filter(([path]) => path.includes('_background_work/'))
        .map(([path, raw]) => codec.decode({ path, data: raw }).value as { kind: string; resourceId: string; id: string })
        .find(value => value.kind === 'handover-import' && value.resourceId === command.opId); assert.ok(work);
      for (let page = 0; page < 8 && !deliveries.some(value => value.id === work.id); page++) await worker.background.dispatch();
      const delivery = deliveries.find(value => value.id === work.id); assert.ok(delivery);
      assert.equal((await worker.background.process(delivery)).state, 'completed');
      const done = await service.get('parent', command.opId); assert.equal(done.state, 'completed', done.error ?? JSON.stringify(done));
      const written = [fileBucket.writes(), voiceBucket.writes(), photoBucket.writes(), journalBucket.writes()];
      assert.equal((await worker.background.process(delivery)).state, 'completed'); assert.deepEqual(await service.create('parent', command, controller.signal), done);
      assert.deepEqual([fileBucket.writes(), voiceBucket.writes(), photoBucket.writes(), journalBucket.writes()], written); return done;
    }
    const base = { uploadId, expectedUploadVersion: upload.version, acceptedManifestSha256: comparison.manifestSha256, restoreOriginal: true, resolutionOnly: true,
      targets: [{ sourceChildId: childId, target: { childId, spaceId: null }, sections: ['attachments'] }] };
    const deletedResolutions = rows.map(row => ({ sourceChildId: childId, section: row.section, resourceId: row.value.id,
      resolution: { mode: 'restore_deleted', targetId: row.value.id, expectedVersion: tombstones.get(row.value.id)!.version } }));
    const command = { ...base, opId: randomUUID(), resolutions: [
      ...deletedResolutions,
      { sourceChildId: childId, section: 'files', resourceId: live.id, resolution: { mode: 'replace_current', targetId: live.id, expectedVersion: live.version } },
      ...[missing, unsettled].map(value => ({ sourceChildId: childId, section: 'files', resourceId: value.id,
        resolution: { mode: 'restore_deleted', targetId: value.id, expectedVersion: byId.get(value.id)?.localVersion ?? value.version } })),
    ] };
    const writesBefore = [fileBucket.writes(), voiceBucket.writes(), photoBucket.writes()];
    const done = await execute(command);
    assert.deepEqual(await files.get('parent', childId, live.id), live);
    assert.equal((await files.content('parent', childId, live.id)).base64, fileBytes.toString('base64'));
    const results = await service.results('parent', command.opId, { sourceChildId: childId, module: 'attachments' });
    assert.equal(results.complete, true);
    assert.equal(results.items.find(item => item.sourceResourceId === live.id && item.sourceSection === null)?.outcome, 'skipped');
    assert.equal(done.counts.updated, 0); assert.equal(done.counts.conflict, 2);
    const newIds = new Map<string, string>();
    for (const row of rows) {
      const id = results.items.find(item => item.sourceResourceId === row.value.id && item.sourceSection === null)?.recordedResource?.id;
      assert.equal(results.items.find(item => item.sourceResourceId === row.value.id && item.sourceSection === null)?.outcome, 'created');
      assert.ok(id); assert.notEqual(id, row.value.id); newIds.set(row.value.id, id);
      assert.equal((await row.store.content('parent', childId, id)).base64, row.bytes.toString('base64'));
      assert.equal(actual(row.suffix, row.kind, row.value.id).state, 'deleted');
      await assert.rejects(row.store.content('parent', childId, row.value.id));
      assert.equal(row.bucket.writes(), writesBefore[rows.indexOf(row)] + 1);
    }
    const retained = await transcripts.get('parent', childId, newIds.get(voice.id)!);
    assert.equal(retained.messageId, null); assert.equal(retained.state, 'available'); assert.deepEqual(retained.content, transcriptContent);
    assert.equal(retained.voice.id, newIds.get(voice.id));
    assert.equal(results.items.find(item => item.sourceResourceId === voice.id && item.sourceSection === 'voice_transcripts')?.outcome, 'created');
    for (const value of [missing, unsettled]) {
      assert.equal(results.items.find(item => item.sourceResourceId === value.id)?.outcome, 'conflict');
      assert.equal(results.items.find(item => item.sourceResourceId === value.id)?.reason, 'original_unavailable');
    }
    assert.equal(fixture.records.has(data.ref('chat_file_assets', 'chat-file-asset', missing.id).path), false);
    assert.equal(actual('chat_file_assets', 'chat-file-asset', unsettled.id).state, 'deleting');
    const mapped = await compare(), mappedById = new Map(mapped.items.map(item => [item.id, item]));
    for (const row of rows) { assert.equal(mappedById.get(row.value.id)?.targetId, newIds.get(row.value.id)); assert.equal(mappedById.get(row.value.id)?.state, 'unchanged'); }
    const writes = [fileBucket.writes(), voiceBucket.writes(), photoBucket.writes(), journalBucket.writes()];
    const repeatedCommand = { ...base, opId: randomUUID(), resolutions: rows.map(row => ({ sourceChildId: childId, section: row.section, resourceId: row.value.id,
      useRestoredTarget: true, resolution: { mode: 'replace_current', targetId: newIds.get(row.value.id)!, expectedVersion: mappedById.get(row.value.id)!.localVersion } })) };
    const repeated = await execute(repeatedCommand);
    assert.equal(repeated.counts.created, 0); assert.equal(repeated.counts.updated, 0); assert.equal(repeated.counts.conflict, 0);
    const repeatedResults = await service.results('parent', repeatedCommand.opId, { sourceChildId: childId, module: 'attachments' });
    assert.equal(repeatedResults.complete, true); assert.ok(repeatedResults.items.length >= rows.length);
    for (const result of repeatedResults.items) assert.equal(result.outcome, 'skipped');
    assert.deepEqual([fileBucket.writes(), voiceBucket.writes(), photoBucket.writes(), journalBucket.writes()], writes);
    const workKinds = [...fixture.records].filter(([path]) => path.includes('_background_work/'))
      .map(([path, raw]) => (codec.decode({ path, data: raw }).value as { kind: string }).kind);
    assert.equal(workKinds.includes('voice-transcription'), false); assert.equal(avatarBucket.writes(), 0);
    for (const row of rows) {
      const mapping = await authority.runTransaction('parent', childId, async b => {
        const source = { serverId, accountId: 'parent', childId, section: row.section, resourceId: row.value.id };
        const id = handoverImportMappingId(b.scope, source, true), ref = data.ref('handover_import_mappings', 'handover-import-mapping', id);
        const snapshot = await b.transaction.get(ref); assert.ok(snapshot.exists);
        return { record: { path: ref.path, data: snapshot.data()! }, value: data.open('handover-import-mapping', id, b.scope, handoverImportMappingSchema, snapshot) };
      });
      const receipt = data.ref('handover_import_items', 'handover-import-item', handoverImportItemId(scope, mapping.value.operationId));
      const tombstone = data.ref(row.suffix, row.kind, row.value.id);
      const graph = [mapping.record, { path: receipt.path, data: fixture.records.get(receipt.path)! }, { path: tombstone.path, data: fixture.records.get(tombstone.path)! }].map(value => codec.decode(value));
      assert.doesNotThrow(() => assertFirestoreRestoreContent(graph));
      assert.throws(() => assertFirestoreRestoreContent(graph.slice(0, 2)));
      const transform = { generation: randomUUID(), newEpochByWorkspace: new Map([[scope.workspaceId, randomUUID()]]), photoDescriptors: new Map() };
      assert.doesNotThrow(() => assertFirestoreRestoreContent(graph.map(value => codec.decode(codec.transform(value, transform)))));
    }
  } finally { controller.abort(); await rm(directory, { recursive: true, force: true }); }
});
