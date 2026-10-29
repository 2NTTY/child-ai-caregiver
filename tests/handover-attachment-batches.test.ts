import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreChatFilesStore } from '../server/firestore-chat-files.ts';
import { createFirestoreHandoverImportBatches } from '../server/firestore-handover-import-batches.ts';
import { createFirestoreBackgroundQueue } from '../server/firestore-background-work.ts';
import { createFirestoreRestoreCodec } from '../server/firestore-restore-codec.ts';
import { chatFileObjectAddress, type ChatFileObjects, type ChatFileObjectDescriptor } from '../server/firebase-chat-file-objects.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import type { HandoverImportRow } from '../server/handover-import.ts';
import { avatarDomainFixture } from './helpers/avatar-memory.ts';
import { createFirestoreHandoverImportItems } from '../server/firestore-handover-import-items.ts';
import { createFirestoreVoiceStore } from '../server/firestore-voice.ts';
import { createFirestoreVoiceTranscripts } from '../server/firestore-voice-transcripts.ts';
import { voiceObjectAddress, type VoiceObjects, type VoiceObjectDescriptor } from '../server/firebase-voice-objects.ts';
import { voiceAttachmentPageSchema } from '../src/shared/voice.ts';
import { chatFileAttachmentPageSchema } from '../src/shared/chat-files.ts';
import { createFirestoreSharingStore } from '../server/firestore-sharing.ts';
import { voiceTranscriptViewSchema } from '../src/shared/voice-transcript.ts';
import { createHandoverAttachments } from '../server/firestore-handover-attachments.ts';
import type { FirestoreAuthorityTransaction } from '../server/firestore-authority.ts';
import type { ImportProvenance } from '../src/shared/import-provenance.ts';

test('a restored import resumes the original attachment reservation across storage epochs', async () => {
  const ids: string[] = [], scope = { ownerUserId: 'recipient', workspaceId: randomUUID(), childId: randomUUID(), storageEpoch: randomUUID() };
  const files = { async prepareImportReservation(_binding: unknown, input: { opId: string }) {
    ids.push(input.opId); return { value: { version: 1 }, commit() {} };
  } } as unknown as ReturnType<typeof createFirestoreChatFilesStore>;
  const bridge = createHandoverAttachments({ files }), bytes = Buffer.from('File'), sha256 = createHash('sha256').update(bytes).digest('hex');
  const sourceId = randomUUID(), stage = { batchId: randomUUID(), operationId: randomUUID(), actorUserId: 'recipient', sourceHash: 'a'.repeat(64) };
  const sourceChildId = randomUUID();
  const row: HandoverImportRow = { section: 'files', childId: sourceChildId, source: { serverId: 'source', accountId: 'parent', packageId: randomUUID(),
    packageVersion: 1, manifestSha256: 'a'.repeat(64), path: 'data/file.json', rowIndex: 0 }, value: { id: sourceId, childId: sourceChildId,
    version: 2, state: 'ready', createdAt: new Date().toISOString(), fileName: 'original.txt', mimeType: 'text/plain', bytes: bytes.length, sha256, messageId: null } };
  const content = { section: 'files' as const, sourceId, sourceVersion: 2, attachmentPath: 'attachments/file', mimeType: 'text/plain', bytes: bytes.length, sha256, content: bytes };
  for (const storageEpoch of [scope.storageEpoch, randomUUID()]) await bridge.prepare(
    { scope: { ...scope, storageEpoch }, actorUserId: 'recipient' } as FirestoreAuthorityTransaction,
    row, content, stage, {} as ImportProvenance, 0, false);
  assert.equal(ids.length, 2); assert.equal(ids[1], ids[0]);
});

test('imported voice transcripts remain readable without replaying transcription and follow a later local message link', async () => {
  const f = await avatarDomainFixture(), childId = (await f.authority.createChild({ userId: f.owner, operationId: randomUUID(), displayName: 'Voice recipient' })).child.id;
  const sharing = createFirestoreSharingStore(f.options), family = await sharing.create(f.owner,{ operationId: randomUUID(), name: 'Shared imports', kind: 'family' });
  await sharing.share(f.owner,{ operationId: randomUUID(), spaceId: family.id, expectedVersion: family.version, childId, modules: ['attachments'] });
  const content = Buffer.from('Synthetic voice bytes'), sha256 = createHash('sha256').update(content).digest('hex');
  const objects = new Map<string, VoiceObjectDescriptor>();
  const port: VoiceObjects = {
    address: (scope, id) => voiceObjectAddress({ ...f.options, bucketName: 'synthetic-private' }, scope, id).objectName,
    async write(scope, id, base64, mimeType) { assert.equal(base64, content.toString('base64')); const objectName = this.address(scope, id);
      assert.equal(mimeType, 'audio/wav');
      const descriptor = { objectName, generation: '1', cipherSha256: 'b'.repeat(64), sha256, bytes: content.length, mimeType: 'audio/wav' as const, durationMs: 1000 };
      objects.set(objectName, descriptor); return descriptor; },
    async inspect(scope, id) { return objects.get(this.address(scope, id)) ?? null; },
    async read(scope, id, descriptor) { assert.deepEqual(descriptor, objects.get(this.address(scope, id)));
      return { descriptor, buffer: Buffer.from(content), base64: content.toString('base64') }; },
    async remove() { throw Error('Unexpected cleanup'); },
  };
  const voices = createFirestoreVoiceStore({ ...f.options, objects: port, journal: f.journal });
  const transcripts = createFirestoreVoiceTranscripts({ ...f.options, voices });
  const items = createFirestoreHandoverImportItems({ ...f.options, attachments: { voices, transcripts } });
  const sourceChildId = randomUUID(), sourceId = randomUUID(), messageId = randomUUID(), at = new Date().toISOString();
  const source = { serverId: 'source', accountId: 'parent', packageId: randomUUID(), packageVersion: 1, manifestSha256: 'c'.repeat(64), path: 'data/voice.json', rowIndex: 0 };
  const value = { id: sourceId, childId: sourceChildId, version: 3, createdAt: at, state: 'ready', fileName: 'voice.wav',
    mimeType: 'audio/wav', bytes: content.length, sha256, durationMs: 1000, messageId };
  const common = { batchId: randomUUID(), target: { childId, spaceId: family.id }, integrity: 'trusted' as const, resolution: { mode: 'preserve' as const } };
  const imported = await items.apply(f.owner, { ...common, opId: randomUUID(), row: { section: 'voices', childId: sourceChildId, source, value },
    attachmentContent: { section: 'voices', sourceId, sourceVersion: 3, attachmentPath: 'attachments/voice.bin',
      mimeType: value.mimeType, bytes: content.length, sha256, content } });
  const transcript = { voice: { id: sourceId, version: 3, mimeType: value.mimeType, bytes: content.length, sha256, durationMs: 1000 },
    messageId, version: 2, state: 'available', automatic: true, updatedAt: at, reason: null, retryAt: null,
    content: { complete: true, segments: [{ text: 'A retained transcript.', startMs: 0, endMs: 1000, unclear: false }] } };
  const command = { ...common, opId: randomUUID(), row: { section: 'voice_transcripts', childId: sourceChildId,
    source: { ...source, path: 'data/transcript.json' }, value: transcript } };
  const saved = await items.apply(f.owner, command); assert.equal(saved.outcome, 'created'); assert.deepEqual(await items.apply(f.owner, command), saved);
  assert.equal((await voices.list(f.owner,childId)).items.length,0);
  const library = voiceAttachmentPageSchema.parse(await voices.list(f.owner,childId,{ includeImported: true }));
  assert.equal(library.items.length,1); assert.equal(library.items[0].messageId,null);
  assert.equal((await voices.forSharedSpace({spaceId:family.id}).list(f.owner,childId,{ includeImported:true })).items.length,1);
  assert.equal(voiceTranscriptViewSchema.parse(await transcripts.forSharedSpace({spaceId:family.id}).get(f.owner,childId,imported.resource!.id)).messageId,null);
  const read = await transcripts.get(f.owner, childId, imported.resource!.id);
  assert.equal(read.messageId, null); assert.deepEqual(read.content, transcript.content); assert.equal(read.state, 'available');
  assert.equal((await items.apply(f.owner, { ...command, opId: randomUUID() })).reason, 'attachment_supplement_already_imported');
  await assert.rejects(items.apply(f.owner, { ...command, opId: randomUUID(), row: { ...command.row,
    value: { ...transcript, content: { complete: true, segments: [{ text: 'Too late', startMs: 0, endMs: 1100, unclear: false }] } } } }), { code: 'invalid_voice_timestamps' });
  const localMessage = randomUUID();
  await f.authority.runTransaction(f.owner, childId, async b => {
    const linked = await voices.prepareLink(b, imported.resource!.id, imported.resource!.version, localMessage); linked.commit();
  });
  const linked = await transcripts.get(f.owner, childId, imported.resource!.id);
  assert.equal(linked.messageId, localMessage); assert.deepEqual(linked.content, transcript.content);
  const duplicate = await items.apply(f.owner, { ...common, opId: randomUUID(), row: { section: 'voices', childId: sourceChildId, source, value },
    attachmentContent: { section: 'voices', sourceId, sourceVersion: 3, attachmentPath: 'attachments/voice.bin', mimeType: value.mimeType, bytes: content.length, sha256, content } });
  assert.equal(duplicate.reason, 'already_imported'); assert.equal(duplicate.resource!.version, imported.resource!.version + 1);
  assert.equal((await items.apply(f.owner, { ...command, opId: randomUUID() })).reason, 'attachment_supplement_already_imported');
  assert.equal(objects.size, 1);
  const decoded = createFirestoreRestoreCodec(f.options);
  const jobs = [...f.fake.records].filter(([path]) => path.includes('_background_work/')).map(([path, data]) => decoded.decode({ path, data }).value as any);
  assert.equal(jobs.some(job => job.kind === 'voice-transcription'), false);

});

test('avatar import uses the child head version and one original operation without copying upload authority', async () => {
  const f = await avatarDomainFixture(), sourceChildId = randomUUID();
  const childId = (await f.authority.createChild({ userId: f.owner, operationId: randomUUID(), displayName: 'Avatar recipient' })).child.id;
  const items = createFirestoreHandoverImportItems({ ...f.options, attachments: { avatars: { store: f.avatars, policy: f.config.policy } } });
  const bytes = Buffer.from([255, 216, 255, 224, 0, 2, 255, 217]), sha256 = createHash('sha256').update(bytes).digest('hex');
  const value = { target: { kind: 'child', childId: sourceChildId }, version: 2, updatedAt: new Date().toISOString(),
    asset: { id: randomUUID(), mimeType: 'image/jpeg', bytes: bytes.length, sha256, width: 512, height: 512 } };
  const row: HandoverImportRow = { section: 'child_avatar', childId: sourceChildId, value, source: { serverId: 'source', accountId: 'parent',
    packageId: randomUUID(), packageVersion: 1, manifestSha256: 'a'.repeat(64), path: 'data/avatar.json', rowIndex: 0 } };
  const command = { opId: randomUUID(), batchId: randomUUID(), target: { childId, spaceId: null }, row, integrity: 'trusted' as const,
    resolution: { mode: 'preserve' as const }, attachmentContent: { section: row.section, sourceId: sourceChildId, sourceVersion: 2,
      attachmentPath: 'attachments/avatar.bin', mimeType: 'image/jpeg', bytes: bytes.length, sha256, content: bytes } };
  const imported = await items.apply(f.owner, command); assert.equal(imported.outcome, 'created');
  assert.equal(imported.resource!.id, childId); assert.equal(imported.resource!.version, 1); assert.notEqual(imported.changeSeq, null);
  assert.deepEqual(await items.apply(f.owner, command), imported); assert.equal(f.bucket.writes(), 1);
  const body = await items.apply(f.owner,{ ...command,opId:randomUUID(),attachmentContent:undefined,row:{ ...row,section:'child_avatar_content',
    value:{ target:value.target,version:value.version,asset:value.asset,attachmentPath:'attachments/avatar.bin',mimeType:'image/jpeg',bytes:bytes.length,sha256 } } });
  assert.equal(body.reason,'attachment_content_index');
  const duplicate = await items.apply(f.owner, { ...command, opId: randomUUID() }); assert.equal(duplicate.reason, 'already_imported');
  assert.equal(f.bucket.writes(), 1);
  const avatar = (await f.avatars.read(f.owner, { kind: 'child', childId })).avatar;
  assert.ok(avatar.asset); assert.notEqual(avatar.asset.id, value.asset.id);
  await f.avatars.submitOnline(f.owner, f.submission('remove', { expectedVersion: avatar.version, confirmRemove: true }, { kind: 'child', childId }));
  const conflict = await items.apply(f.owner, { ...command, opId: randomUUID() }); assert.equal(conflict.reason, 'target_deleted');
  const empty = await items.apply(f.owner, { ...command, opId: randomUUID(), attachmentContent: null,
    row: { ...row, value: { ...value, version: 0, asset: null, updatedAt: null } } });
  assert.equal(empty.reason, 'attachment_not_available'); assert.equal(f.bucket.writes(), 1);
});

test('attachment batches publish bytes with mappings receipts and progress, and resume cancellation without another object', async () => {
  const fixture = serialFirestoreFixture(), options = { database: fixture.database, cipher: createStorageCipher(Buffer.alloc(32, 66)),
    projectId: 'demo-attachment-batch', namespace: 'unit_attachment_batch' };
  const authority = createFirestoreAuthority(options), codec = createFirestoreRestoreCodec(options);
  await authority.initializeControl({ generation: randomUUID(), enabled: true });
  const email = 'recipient@example.invalid';
  await authority.issueInvitation({ email, operationId: randomUUID(), expiresAt: new Date(Date.now() + 3600000).toISOString() });
  await authority.admitIdentity({ userId: 'recipient', email, emailVerified: true });
  await authority.acknowledge({ userId: 'recipient', operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  const childId = (await authority.createChild({ userId: 'recipient', operationId: randomUUID(), displayName: 'Imported media' })).child.id;
  const sourceChildId = randomUUID(), source = { serverId: 'https://source.invalid', accountId: 'source-parent', packageId: randomUUID(),
    packageVersion: 1, manifestSha256: 'a'.repeat(64) };
  const originals = [Buffer.from('First original'), Buffer.from('Second original')].map(content => {
    const id = randomUUID(), sha256 = createHash('sha256').update(content).digest('hex');
    const value = { id, childId: sourceChildId, version: 3, state: 'ready', createdAt: new Date().toISOString(),
      mimeType: 'text/plain', bytes: content.length, sha256, fileName: 'original.txt', messageId: null };
    return { value, content: { section: 'files', sourceId: id, sourceVersion: value.version, attachmentPath: `attachments/${id}`,
      mimeType: value.mimeType, bytes: content.length, sha256, content } };
  });
  const row = (index: number): HandoverImportRow => ({ section: 'files', childId: sourceChildId, value: originals[index].value,
    source: { ...source, path: 'data/files.json', rowIndex: index } });
  const stored = new Map<string, { bytes: Buffer; descriptor: ChatFileObjectDescriptor }>();
  let writes = 0, loseReply = true, afterWrite: (() => Promise<void>) | undefined;
  const objects: ChatFileObjects = {
    address: (scope, id) => chatFileObjectAddress({ ...options, bucketName: 'synthetic-private' }, scope, id).objectName,
    async write(scope, id, base64, mimeType) {
      const objectName = this.address(scope, id), bytes = Buffer.from(base64, 'base64'); assert.equal(stored.has(objectName), false); writes++;
      const descriptor = { objectName, generation: '1', cipherSha256: 'c'.repeat(64), sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, mimeType };
      stored.set(objectName, { bytes, descriptor }); await afterWrite?.();
      if (loseReply) { loseReply = false; throw Error('Synthetic lost object response'); } return descriptor;
    },
    async inspect(scope, id) { return stored.get(this.address(scope, id))?.descriptor ?? null; },
    async read(scope, id, descriptor) { const found = stored.get(this.address(scope, id))!; assert.deepEqual(descriptor, found.descriptor);
      return { descriptor, buffer: Buffer.from(found.bytes), base64: found.bytes.toString('base64') }; },
    async remove() { throw Error('No deletion in this batch scenario'); },
  };
  const unavailable = async (): Promise<never> => { throw Error('Unrelated external effect'); };
  const files = createFirestoreChatFilesStore({ ...options, objects, journal: { writeOnce: unavailable, read: unavailable } });
  const batches = createFirestoreHandoverImportBatches({ ...options, attachments: { files } });
  const request = { opId: randomUUID(), uploadId: randomUUID(), source, integrity: 'trusted', acceptedManifestSha256: null,
    targets: [{ sourceChildId, target: { childId, spaceId: null }, sections: ['attachments'] }], totalItems: 2, resolutions: [] };
  const batch = await batches.create('recipient', request);
  const records = (suffix: string) => [...fixture.records].filter(([path]) => path.includes(`_${suffix}/`));
  const deliveries: any[] = []; let phase = 1;
  const queue = createFirestoreBackgroundQueue({ ...options, enabled: true, readControl: tx => authority.readControl(tx),
    transport: { async enqueue(value) { deliveries.push(value); return { state: 'confirmed' }; }, probe: unavailable },
    async execute(work, signal) {
      assert.equal(work.kind, 'handover-import'); assert.ok(await batches.claim(work));
      const step = (index: number) => ({ position: index, cursor: index ? 'second' : null, nextCursor: index ? null : 'second',
        row: row(index), attachmentContent: originals[index].content });
      if (phase === 1) {
        await assert.rejects(batches.apply(work, step(0), signal), { code: 'chat_file_upload_unknown' });
        assert.equal((await batches.get('recipient', batch.id)).position, 0);
        assert.equal(records('handover_import_items').length, 0); assert.equal(records('handover_import_mappings').length, 0);
        const first = await batches.apply(work, step(0), signal);
        assert.equal(first.batch.position, 1); assert.equal(first.item.outcome, 'created'); assert.equal(writes, 1);
        assert.equal((await files.content('recipient', childId, first.item.resource!.id)).base64, originals[0].content.content.toString('base64'));
        await assert.rejects(batches.apply(work, step(0), signal), { code: 'import_cursor_changed' });
        afterWrite = async () => {
          const current = await batches.get('recipient', batch.id);
          await batches.cancel('recipient', batch.id, { opId: randomUUID(), expectedVersion: current.version });
        };
        await assert.rejects(batches.apply(work, step(1), signal), { code: 'import_batch_stopped' });
        assert.equal(records('handover_import_items').length, 1); assert.equal(records('handover_import_mappings').length, 1);
        const pending = records('chat_file_assets').map(([path, data]) => codec.decode({ path, data }).value as any).find(value => value.state === 'reserved');
        assert.ok(pending); await assert.rejects(files.content('recipient', childId, pending.id), { code: 'chat_file_not_available' });
        return { state: 'stopped' };
      }
      const final = await batches.apply(work, step(1), signal);
      assert.equal(final.batch.state, 'completed'); assert.equal(final.batch.counts.created, 2); assert.equal(writes, 2);
      return { state: 'completed' };
    },
  });
  async function deliver() {
    await queue.dispatch();
    const selected = deliveries.splice(0).filter(delivery => {
      const entry = records('background_work').find(([, value]) => value.id === delivery.id)!;
      return (codec.decode({ path: entry[0], data: entry[1] }).value as any).kind === 'handover-import';
    });
    assert.equal(selected.length, 1); return queue.process(selected[0]);
  }
  assert.equal((await deliver()).state, 'stopped');
  const stopped = await batches.get('recipient', batch.id); assert.equal(stopped.position, 1);
  await batches.resume('recipient', batch.id, { opId: randomUUID(), expectedVersion: stopped.version }); phase = 2; afterWrite = undefined;
  assert.equal((await deliver()).state, 'completed');
  assert.equal(records('handover_import_items').length, 2); assert.equal(records('handover_import_mappings').length, 2);
  assert.equal(records('chat_file_assets').length, 2); assert.equal(stored.size, 2);
  assert.equal((await files.list('recipient',childId)).items.length,0);
  assert.equal(chatFileAttachmentPageSchema.parse(await files.list('recipient',childId,{ includeImported: true })).items.length,2);
  await assert.rejects(batches.get('another-user', batch.id));
});
