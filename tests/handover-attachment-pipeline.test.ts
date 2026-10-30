import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';
import { avatarMemoryBucket } from './helpers/avatar-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirebaseHandoverObjects } from '../server/firebase-handover-objects.ts';
import { createHandoverUploadService } from '../server/handover-upload-service.ts';
import { createHandoverImportService } from '../server/handover-import-service.ts';
import { createFirebaseWorkerServices } from '../server/firebase-worker-services.ts';
import { createFirestoreRestoreCodec } from '../server/firestore-restore-codec.ts';
import { createChatFileObjects } from '../server/firebase-chat-file-objects.ts';
import { createVoiceObjects } from '../server/firebase-voice-objects.ts';
import { createAvatarObjects } from '../server/firebase-avatar-objects.ts';
import { createFirebaseErasureJournal } from '../server/firebase-erasure-journal.ts';
import { createFirestoreChatFilesStore } from '../server/firestore-chat-files.ts';
import { createFirestoreVoiceStore } from '../server/firestore-voice.ts';
import { createFirestoreVoiceTranscripts } from '../server/firestore-voice-transcripts.ts';
import { createFirestoreChatStore } from '../server/firestore-chat.ts';
import { createFirestoreAvatarStore } from '../server/firestore-avatars.ts';
import { readAvatarConfig } from '../server/avatar-config.ts';
import { createFirestoreSharingStore } from '../server/firestore-sharing.ts';
import { writeHandoverArchive } from '../server/handover-archive.ts';
import { HANDOVER_SECTIONS } from '../src/shared/handover.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';

test('attachment rows traverse the original package worker before imported chat links with retained transcription', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'handover-attachments-')), controller = new AbortController();
  try {
    const fixture = serialFirestoreFixture(), cipher = createStorageCipher(Buffer.alloc(32, 99));
    const options = { database: fixture.database, cipher, projectId: 'demo-attachments-pipeline', namespace: 'unit_attachments_pipeline' };
    const authority = createFirestoreAuthority(options), codec = createFirestoreRestoreCodec(options);
    await authority.initializeControl({ enabled: true, generation: randomUUID() });
    await authority.issueInvitation({ email: 'recipient@example.test', operationId: randomUUID(), expiresAt: new Date(Date.now() + 3600000).toISOString() });
    await authority.admitIdentity({ userId: 'recipient', email: 'recipient@example.test', emailVerified: true });
    await authority.acknowledge({ userId: 'recipient', operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
    const childId = (await authority.createChild({ userId: 'recipient', operationId: randomUUID(), displayName: 'Recipient' })).child.id;
    const config = (bucketName: string) => ({ projectId: options.projectId, namespace: options.namespace, bucketName });
    const fileBucket = avatarMemoryBucket('synthetic-import-files'), voiceBucket = avatarMemoryBucket('synthetic-import-voices');
    const avatarBucket = avatarMemoryBucket('synthetic-import-avatars'), journalBucket = avatarMemoryBucket('synthetic-import-journal');
    const journal = createFirebaseErasureJournal({ config: config('synthetic-import-journal'), cipher, bucket: journalBucket.port });
    const files = createFirestoreChatFilesStore({ ...options, journal, objects: createChatFileObjects({ config: config('synthetic-import-files'), cipher, bucket: fileBucket.port }) });
    const voices = createFirestoreVoiceStore({ ...options, journal, objects: createVoiceObjects({ config: config('synthetic-import-voices'), cipher, bucket: voiceBucket.port }) });
    const transcripts = createFirestoreVoiceTranscripts({ ...options, voices });
    const avatarConfig = readAvatarConfig({ AVATAR_WRITES_ENABLED: 'true' });
    const avatars = createFirestoreAvatarStore({ ...options, journal, config: avatarConfig,
      objects: createAvatarObjects({ config: config('synthetic-import-avatars'), cipher, bucket: avatarBucket.port }),
      codec: { async normalize() { throw Error('An empty source avatar must not decode'); } } });
    // Same encrypted upload-object fixture as the document pipeline; only its external bucket is synthetic.
    const stored = new Map<string, { body: Buffer; metadata: any }>();
    const objects = createFirebaseHandoverObjects({ config: config('synthetic-import-packages'), files: cipher.files,
      bucket: { async metadata(name) { return stored.get(name)?.metadata ?? null; },
        createWrite(name, settings) { const parts: Buffer[] = []; return new Writable({ write(chunk, _encoding, done) { parts.push(Buffer.from(chunk)); done(); },
          final(done) { const body = Buffer.concat(parts); stored.set(name, { body, metadata: { name, bucket: 'synthetic-import-packages', generation: '11111111111111111',
            size: String(body.length), metadata: settings.metadata?.metadata } }); done(); } }); },
        readPinned(name) { return Readable.from([stored.get(name)!.body]); }, async removePinned(name) { stored.delete(name); },
      } });
    const uploads = createHandoverUploadService({ ...options, objects });
    const service = createHandoverImportService({ ...options, uploads, attachments: { files, voices, transcripts, avatars: { store: avatars, policy: avatarConfig.policy } } });
    const deliveries: any[] = [];
    const worker = createFirebaseWorkerServices({ ...options, config: { ...options, taskWorkerEnabled: true }, authority, handoverImports: service,
      currentAuth: async () => ({ disabled: false, emailVerified: true, email: 'recipient@example.test' }) } as any,
      { taskName: () => 'unused', enqueue: async () => { throw Error('Unexpected notification'); }, probe: async () => { throw Error('Unexpected notification'); } },
      { async enqueue(value) { deliveries.push(value); return { state: 'confirmed' }; }, async probe() { return { state: 'confirmed' }; } }, controller);
    const sourceChild = randomUUID(), fileId = randomUUID(), voiceId = randomUUID(), sourceMessageId = randomUUID(), at = new Date().toISOString();
    const fileBytes = Buffer.from('Original opaque file'), voiceBytes = Buffer.alloc(44 + 16000);
    // Reuse the valid one-second PCM fixture from voice-media; the real voice object port measures duration.
    voiceBytes.write('RIFF'); voiceBytes.writeUInt32LE(36 + 16000, 4); voiceBytes.write('WAVEfmt ', 8); voiceBytes.writeUInt32LE(16, 16);
    voiceBytes.writeUInt16LE(1, 20); voiceBytes.writeUInt16LE(1, 22); voiceBytes.writeUInt32LE(8000, 24); voiceBytes.writeUInt32LE(16000, 28);
    voiceBytes.writeUInt16LE(2, 32); voiceBytes.writeUInt16LE(16, 34); voiceBytes.write('data', 36); voiceBytes.writeUInt32LE(16000, 40);
    const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
    const file = { id: fileId, childId: sourceChild, version: 2, createdAt: at, state: 'ready', fileName: 'original.txt', mimeType: 'text/plain', bytes: fileBytes.length,
      sha256: hash(fileBytes), messageId: sourceMessageId };
    const voice = { id: voiceId, childId: sourceChild, version: 3, createdAt: at, state: 'ready', fileName: 'original.wav', mimeType: 'audio/wav', bytes: voiceBytes.length,
      sha256: hash(voiceBytes), durationMs: 1000, messageId: sourceMessageId };
    const transcript = { voice: { id: voiceId, version: voice.version, mimeType: voice.mimeType, bytes: voice.bytes, sha256: voice.sha256, durationMs: voice.durationMs },
      messageId: sourceMessageId, version: 2, state: 'available', automatic: true, updatedAt: at, reason: null, retryAt: null,
      content: { complete: true, segments: [{ text: 'Original heard words', startMs: 0, endMs: 1000, unclear: false }] } };
    const textMessage = { id: randomUUID(), childId: sourceChild, authorUserId: 'source', role: 'user', text: 'Original private statement', inReplyTo: null, createdAt: at };
    const fileMessage = { id: sourceMessageId, childId: sourceChild, authorUserId: 'source', role: 'user', text: 'Original private file', inReplyTo: null, createdAt: at,
      file: { id: fileId, version: file.version, mimeType: file.mimeType, bytes: file.bytes, sha256: file.sha256 } };
    const values: Record<string, object[]> = {
      files: [file], file_content: [{ fileId, version: file.version, attachmentPath: 'attachments/file.bin', mimeType: file.mimeType, bytes: file.bytes, sha256: file.sha256 }],
      voices: [voice], voice_content: [{ voiceId, version: voice.version, attachmentPath: 'attachments/voice.bin', mimeType: voice.mimeType, bytes: voice.bytes, sha256: voice.sha256 }],
      voice_transcripts: [transcript], child_avatar: [{ target: { kind: 'child', childId: sourceChild }, version: 0, asset: null, updatedAt: null }],
      photos: [], photo_content: [], child_avatar_content: [],
      chat: [textMessage, fileMessage], chat_imports: [],
    };
    const scopeVersion = 'a'.repeat(64), sections = [...HANDOVER_SECTIONS.attachments].sort((a, b) => Number(!a.endsWith('_content')) - Number(!b.endsWith('_content')));
    const pages = [{ section: 'children', childId: null as string | null, items: [{ id: sourceChild, displayName: 'Source child' }] },
      // Source chat precedes asset metadata in the archive; worker phases must still publish the assets first.
      ...HANDOVER_SECTIONS.chat.map(section => ({ section, childId: sourceChild, items: values[section] })),
      ...sections.map(section => ({ section, childId: sourceChild, items: values[section] }))];
    async function* entries() {
      yield { path: 'attachments/file.bin', mediaType: file.mimeType, content: fileBytes };
      yield { path: 'attachments/voice.bin', mediaType: voice.mimeType, content: voiceBytes };
      for (let index = 0; index < pages.length; index++) yield { path: `data/${index}.json`, mediaType: 'application/json', content: Buffer.from(JSON.stringify({ ...pages[index], scopeVersion })) };
      yield { path: 'summary.md', mediaType: 'text/markdown', content: Buffer.from('Synthetic attachment package') };
    }
    const archive = await writeHandoverArchive({ directory, header: { format: 'yuyoufang-data', version: 1, packageId: randomUUID(), packageVersion: 1,
      createdAt: at, purpose: 'handover', source: { serverId: 'https://source.test', accountId: 'source' }, selection: { childIds: [sourceChild], modules: ['attachments', 'chat'], period: null } },
      entries: entries(), coverage: () => pages.map(page => ({ section: page.section, childId: page.childId, items: page.items.length, scopeVersion, complete: true as const })) });
    const bytes = await readFile(archive.path), uploadId = randomUUID();
    await uploads.create('recipient', { opId: uploadId, filename: 'attachments.zip', bytes: bytes.length, sha256: hash(bytes) });
    const uploaded = await uploads.receive('recipient', uploadId, Readable.from([bytes]), controller.signal);
    assert.equal(uploaded.preview!.integrity, 'missing_proof');
    const command = { opId: randomUUID(), uploadId, expectedUploadVersion: uploaded.version, acceptedManifestSha256: uploaded.preview!.manifestSha256,
      targets: [{ sourceChildId: sourceChild, target: { childId, spaceId: null }, sections: ['attachments', 'chat'] }], resolutions: [] };
    const queued = await service.create('recipient', command, controller.signal); assert.equal(queued.state, 'queued', queued.error ?? undefined); assert.equal(queued.totalItems, 8);
    await worker.background.dispatch();
    const delivery = deliveries.find(value => {
      const row = [...fixture.records].find(([path, data]) => path.includes('_background_work/') && data.id === value.id);
      return row && (codec.decode({ path: row[0], data: row[1] }).value as any).resourceId === command.opId;
    });
    assert.ok(delivery, 'the original import queue delivery exists'); await worker.background.process(delivery);
    const done = await service.get('recipient', command.opId); assert.equal(done.state, 'completed', done.error ?? JSON.stringify(done));
    assert.equal(done.processedItems, 8); assert.deepEqual(done.counts, { created: 5, updated: 0, skipped: 3, conflict: 0 });
    const results = await service.results('recipient', command.opId, { sourceChildId: sourceChild, module: 'attachments' });
    assert.equal(results.complete, true); assert.equal(results.items.length, 6);
    const localFile = results.items.find(item => item.resourceSection === 'files' && item.sourceSection === null)!.recordedResource!.id;
    const localVoice = results.items.find(item => item.resourceSection === 'voices' && item.sourceSection === null)!.recordedResource!.id;
    assert.notEqual(localFile, fileId); assert.notEqual(localVoice, voiceId);
    assert.ok(results.items.some(item => item.resourceSection === 'files' && item.sourceSection === 'file_content'));
    assert.ok(results.items.some(item => item.resourceSection === 'voices' && item.sourceSection === 'voice_transcripts'));
    assert.equal((await files.content('recipient', childId, localFile)).base64, fileBytes.toString('base64'));
    assert.equal((await voices.content('recipient', childId, localVoice)).base64, voiceBytes.toString('base64'));
    const retained = await transcripts.get('recipient', childId, localVoice);
    assert.equal(retained.messageId, null); assert.equal(retained.state, 'available'); assert.deepEqual(retained.content, transcript.content);
    const chat = createFirestoreChatStore(options), importedChat = await chat.listImportedForUser('recipient', childId);
    assert.equal(importedChat.items.length, 2); assert.equal(importedChat.nextCursor, null);
    const importedText = importedChat.items.find(item => item.message.id === textMessage.id);
    const importedFile = importedChat.items.find(item => item.message.id === fileMessage.id);
    assert.ok(importedText); assert.deepEqual(importedText.message, textMessage); assert.equal(importedText.attachment, null);
    assert.ok(importedFile); assert.deepEqual(importedFile.message, fileMessage);
    assert.deepEqual(importedFile.attachment, { kind: 'files', resource: results.items.find(item => item.resourceSection === 'files' && item.sourceSection === null)!.recordedResource });
    assert.equal(importedFile.attachment!.resource.id, localFile); assert.notEqual(importedFile.attachment!.resource.id, fileId);
    assert.deepEqual((await chat.listForUser('recipient', childId)).messages, []);
    const chatResults = await service.results('recipient', command.opId, { sourceChildId: sourceChild, module: 'chat' });
    assert.equal(chatResults.complete, true); assert.equal(chatResults.items.length, 2);
    assert.equal(chatResults.items.find(item => item.sourceResourceId === sourceMessageId)!.recordedResource!.id, importedFile.id);
    const workKinds = [...fixture.records].filter(([path]) => path.includes('_background_work/')).map(([path, data]) => (codec.decode({ path, data }).value as any).kind);
    assert.equal(workKinds.includes('voice-transcription'), false);
    const writes = [fileBucket.writes(), voiceBucket.writes()]; assert.deepEqual(writes, [1, 1]);
    assert.deepEqual(await service.create('recipient', command, controller.signal), done); assert.deepEqual([fileBucket.writes(), voiceBucket.writes()], writes);
    assert.deepEqual(await chat.listImportedForUser('recipient', childId), importedChat, 'original batch receipt does not duplicate imported history or attachment links');
    assert.equal(avatarBucket.writes(), 0); assert.equal(journalBucket.writes(), 0);
    const sharing = createFirestoreSharingStore(options);
    const family = await sharing.create('recipient', { operationId: randomUUID(), name: 'Shared imported attachments', kind: 'family' });
    await sharing.share('recipient', { operationId: randomUUID(), spaceId: family.id, expectedVersion: family.version, childId, modules: ['attachments'] });
    const sharedFiles = files.forSharedSpace({ spaceId: family.id }), sharedVoices = voices.forSharedSpace({ spaceId: family.id });
    for (const [store, id, deletedCode] of [[sharedFiles, localFile, 'chat_file_deleted'], [sharedVoices, localVoice, 'voice_deleted']] as const) {
      const current = await store.get('recipient', childId, id); assert.equal(current.messageId, null);
      const operationId = randomUUID(), removed = await store.delete('recipient', childId, id, current.version, operationId);
      assert.equal(removed.deleted, true);
      const journalWrites = journalBucket.writes();
      assert.deepEqual(await store.delete('recipient', childId, id, current.version, operationId), removed, 'retry only returns the original deletion');
      assert.equal(journalBucket.writes(), journalWrites, 'original deletion retry must not write another erasure intent');
      await assert.rejects(store.content('recipient', childId, id), { code: deletedCode });
    }
    assert.equal(journalBucket.writes(), 2); assert.deepEqual([fileBucket.writes(), voiceBucket.writes()], writes);
  } finally { controller.abort(); await rm(directory, { recursive: true, force: true }); }
});
