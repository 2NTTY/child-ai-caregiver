import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';
import { avatarMemoryBucket } from './helpers/avatar-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreSharingStore } from '../server/firestore-sharing.ts';
import { createChatFileObjects } from '../server/firebase-chat-file-objects.ts';
import { createFirestoreChatFilesStore } from '../server/firestore-chat-files.ts';
import { createFirestoreHandoverImportItems } from '../server/firestore-handover-import-items.ts';
import { createFirestoreAccountExport } from '../server/firestore-account-export.ts';
import { createFirebaseHandoverObjects } from '../server/firebase-handover-objects.ts';
import { createHandoverService } from '../server/handover-service.ts';
import { createFirebaseWorkerServices } from '../server/firebase-worker-services.ts';
import { createFirestoreRestoreCodec } from '../server/firestore-restore-codec.ts';
import { openHandoverImport } from '../server/handover-import.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import type { HandoverClassExportCommand } from '../src/shared/handover-jobs.ts';

test('class attachment preview stays metadata-only and explicit original selection reaches the actor-owned worker ZIP', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'handover-class-file-')), controller = new AbortController();
  try {
    const fixture = serialFirestoreFixture(), cipher = createStorageCipher(Buffer.alloc(32, 107));
    const options = { database: fixture.database, cipher, projectId: 'demo-class-file', namespace: 'unit_class_file' };
    const authority = createFirestoreAuthority(options), sharing = createFirestoreSharingStore(options);
    await authority.initializeControl({ enabled: true, generation: randomUUID() });
    const expiresAt = new Date(Date.now() + 3600000).toISOString();
    for (const userId of ['manager', 'teacher']) {
      const email = userId + '@example.test';
      await authority.issueInvitation({ email, operationId: randomUUID(), expiresAt });
      await authority.admitIdentity({ userId, email, emailVerified: true });
      await authority.acknowledge({ userId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
    }
    let room = await sharing.create('manager', { operationId: randomUUID(), name: 'Class files', kind: 'class' });
    const learner = await sharing.addClassChild('manager', { operationId: randomUUID(), spaceId: room.id, expectedVersion: room.version, displayName: 'Selected learner' });
    const other = await sharing.addClassChild('manager', { operationId: randomUUID(), spaceId: room.id, expectedVersion: learner.space.version, displayName: 'SECRET_OTHER_LEARNER' });
    const invitation = await sharing.invite('manager', { operationId: randomUUID(), spaceId: room.id, expectedVersion: other.space.version,
      email: 'teacher@example.test', role: 'viewer', expiresAt });
    room = await sharing.acceptInvitation('teacher', { operationId: randomUUID(), token: invitation.token });
    const bucket = avatarMemoryBucket('synthetic-class-files'), rawObjects = createChatFileObjects({
      config: { projectId: options.projectId, namespace: options.namespace, bucketName: 'synthetic-class-files' }, cipher, bucket: bucket.port });
    let fileReads = 0;
    const unused = async (): Promise<never> => { throw Error('Unexpected unused media or erasure call'); };
    const files = createFirestoreChatFilesStore({ ...options, journal: { writeOnce: unused, read: unused },
      objects: { ...rawObjects, async read(...args: Parameters<typeof rawObjects.read>) { fileReads++; return rawObjects.read(...args); } } });
    const items = createFirestoreHandoverImportItems({ ...options, attachments: { files } });
    const sourceChild = randomUUID(), privateMessageId = randomUUID(), originalBytes = Buffer.from('Original class file\n\u0000\u00ff');
    async function importFile(childId: string, fileName: string, bytes: Buffer) {
      const id = randomUUID(), sha256 = createHash('sha256').update(bytes).digest('hex');
      const imported = await items.apply('manager', { opId: randomUUID(), batchId: randomUUID(), target: { childId, spaceId: room.id },
        integrity: 'trusted', resolution: { mode: 'preserve' }, row: { section: 'files', childId: sourceChild,
          value: { id, childId: sourceChild, version: 2, state: 'ready', createdAt: '2020-01-01T00:00:00Z',
            fileName, mimeType: 'text/plain', bytes: bytes.length, sha256, messageId: privateMessageId },
          source: { serverId: 'https://original.test', accountId: 'original-parent', packageId: randomUUID(), packageVersion: 1,
            manifestSha256: 'a'.repeat(64), path: 'data/files.json', rowIndex: 0 } },
        attachmentContent: { section: 'files', sourceId: id, sourceVersion: 2, attachmentPath: 'attachments/file.bin',
          mimeType: 'text/plain', bytes: bytes.length, sha256, content: bytes } });
      assert.equal(imported.outcome, 'created'); assert.ok(imported.resource); return imported.resource;
    }
    const selectedFile = await importFile(learner.child.id, 'Selected original.txt', originalBytes);
    const otherFile = await importFile(other.child.id, 'SECRET_OTHER_FILE.txt', Buffer.from('SECRET_OTHER_BYTES'));
    const local = await files.forSharedSpace({ spaceId: room.id }).get('teacher', learner.child.id, selectedFile.id);
    assert.equal(local.messageId, null); assert.ok(local.createdAt);
    const day = (instant: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(instant));
    const laterDay = day(new Date(Date.parse(local.createdAt) + 7 * 86400000).toISOString());
    const period = { from: laterDay + 'T00:00:00+08:00', to: laterDay + 'T23:59:59.999+08:00' };
    const stored = new Map<string, { body: Buffer; metadata: any }>();
    const objects = createFirebaseHandoverObjects({ config: { projectId: options.projectId, namespace: options.namespace, bucketName: 'synthetic-class-packages' }, files: cipher.files,
      bucket: { async metadata(name) { return stored.get(name)?.metadata ?? null; },
        createWrite(name, settings) { const parts: Buffer[] = []; return new Writable({ write(chunk, _encoding, done) { parts.push(Buffer.from(chunk)); done(); },
          final(done) { const body = Buffer.concat(parts); stored.set(name, { body, metadata: { name, bucket: 'synthetic-class-packages', generation: '11111111111111111',
            size: String(body.length), metadata: settings.metadata?.metadata } }); done(); } }); },
        readPinned(name) { return Readable.from([stored.get(name)!.body]); }, async removePinned(name) { stored.delete(name); } } });
    // Only ordinary file bodies are exercised; touching another advertised media reader fails this scenario.
    const unusedShared = () => ({ content: unused });
    const exporter = createFirestoreAccountExport({ ...options, files,
      photos: { content: unused, readMetadata: unused, forSharedSpace: unusedShared },
      voices: { content: unused, readMetadata: unused, forSharedSpace: unusedShared },
      transcripts: { readIn: unused, readForSharedExport: unused }, avatars: { content: unused, forSharedSpace: unusedShared } });
    const service = createHandoverService({ ...options, exporter, objects, serverId: 'https://class.test', spoolRoot: directory });
    assert.ok(service.capabilities(true).classModules.includes('attachments'));
    const command: HandoverClassExportCommand = { opId: randomUUID(), purpose: 'handover', source: { kind: 'class', spaceId: room.id },
      selection: { childIds: [learner.child.id], modules: ['attachments'], period } };
    const beforePreview = fileReads;
    const query = { childId: learner.child.id, section: 'files' as const, period, source: command.source, opId: command.opId };
    const preview = await service.preview('teacher', query);
    assert.equal(fileReads, beforePreview, 'class preview never reads attachment storage bodies');
    assert.equal(preview.nextCursor, null); assert.equal(preview.items.length, 1);
    const item = preview.items[0];
    assert.equal(item.id, selectedFile.id); assert.equal(item.title, 'Selected original.txt');
    assert.equal(item.from, day(local.createdAt)); assert.equal(item.to, day(local.createdAt));
    assert.equal(item.reason, 'outside'); assert.equal(item.defaultIncluded, false); assert.equal(item.canInclude, true);
    assert.doesNotMatch(JSON.stringify(preview), /SECRET_|messageId|base64/);
    const avatar = await service.preview('teacher', { ...query, section: 'child_avatar', scopeVersion: preview.scopeVersion });
    assert.equal(avatar.avatarVersion, 0); assert.deepEqual(avatar.items, []);
    assert.equal(fileReads, beforePreview);
    const { section, childId, id, version, snapshotId, snapshotVersion } = item;
    command.documentReview = { scopeVersion: preview.scopeVersion, choices: [{ section, childId, id, version, snapshotId, snapshotVersion, include: true }],
      avatarVersions: [{ childId: learner.child.id, version: avatar.avatarVersion! }] };
    await assert.rejects(service.create('teacher', { ...command, documentReview: { ...command.documentReview,
      avatarVersions: [{ childId: learner.child.id, version: avatar.avatarVersion! + 1 }] } }),
    (error: any) => error.code === 'export_scope_changed', 'a stale class avatar review cannot enqueue an export');
    const queued = await service.create('teacher', command); assert.equal(queued.state, 'queued');
    assert.equal(queued.id, query.opId, 'preview and export retain the original operation');
    const deliveries: any[] = [], codec = createFirestoreRestoreCodec(options);
    const worker = createFirebaseWorkerServices({ ...options, authority, handover: service, config: { ...options, taskWorkerEnabled: true },
      currentAuth: async () => ({ disabled: false, emailVerified: true, email: 'teacher@example.test' }) } as any,
    { taskName: () => 'unused', enqueue: unused, probe: unused },
    { async enqueue(value) { deliveries.push(value); return { state: 'confirmed' }; }, async probe() { return { state: 'confirmed' }; } }, controller);
    await worker.background.dispatch();
    const delivery = deliveries.find(value => {
      const row = [...fixture.records].find(([path, data]) => path.includes('_background_work/') && data.id === value.id);
      return row && (codec.decode({ path: row[0], data: row[1] }).value as any).resourceId === command.opId;
    });
    assert.ok(delivery); await worker.background.process(delivery);
    const ready = await service.get('teacher', command.opId); assert.equal(ready.state, 'ready', ready.error ?? JSON.stringify(ready));
    const downloaded = await service.download('teacher', command.opId);
    try {
      const reader = await openHandoverImport({ path: downloaded.path });
      try {
        assert.equal(reader.manifest.source.accountId, 'space:' + room.id);
        const page = await reader.readPage({ selection: { childIds: [learner.child.id], modules: ['attachments'] }, acknowledgedManifestSha256: reader.manifestSha256, limit: 100 });
        const files = page.rows.filter(row => row.section === 'files'); assert.deepEqual(files.map(row => row.value.id), [selectedFile.id]);
        const original = await reader.readAttachmentContent(files[0], reader.manifestSha256); assert.ok(original); assert.deepEqual(original.content, originalBytes);
        assert.ok(!JSON.stringify(page.rows).includes(otherFile.id)); assert.ok(!JSON.stringify(page.rows).includes(privateMessageId));
        assert.doesNotMatch(JSON.stringify(page.rows), /SECRET_|base64/);
      } finally { await reader.close(); }
    } finally { await downloaded.dispose(); }
    const current = await sharing.get('manager', room.id);
    await sharing.updateMember('manager', { operationId: randomUUID(), spaceId: room.id, expectedVersion: current.version, targetUserId: 'teacher', role: null });
    await assert.rejects(service.download('teacher', command.opId), 'revocation blocks the already-ready class file package');
    assert.equal(stored.size, 1, 'revocation does not need a replacement export');
  } finally { controller.abort(); await rm(directory, { recursive: true, force: true }); }
});
