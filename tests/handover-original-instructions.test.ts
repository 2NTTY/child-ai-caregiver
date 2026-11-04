import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { FirestoreDomainData } from '../server/firestore-domain-data.ts';
import { createFirestorePrivateInstructions } from '../server/firestore-private-instructions.ts';
import { createFirestoreCareStore } from '../server/firestore-care.ts';
import { createFirestoreChatStore } from '../server/firestore-chat.ts';
import { createFirestoreMemoryStore } from '../server/firestore-memory.ts';
import { createFirestoreAccountExport } from '../server/firestore-account-export.ts';
import { createFirestoreRestoreCodec } from '../server/firestore-restore-codec.ts';
import { createFirebaseHandoverObjects } from '../server/firebase-handover-objects.ts';
import { createHandoverUploadService } from '../server/handover-upload-service.ts';
import { createHandoverImportService } from '../server/handover-import-service.ts';
import { createFirebaseWorkerServices } from '../server/firebase-worker-services.ts';
import { writePersonalHandoverPackage } from '../server/handover-export.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import type { AgentPrivateNote } from '../src/shared/agent-actions.ts';

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

test('signed own instruction backups restore only the pinned original once with backup lineage and never resurrect missing or foreign notes by name', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'handover-original-instructions-')), controller = new AbortController();
  try {
    const fixture = serialFirestoreFixture(), options = { database: fixture.database, cipher: createStorageCipher(Buffer.alloc(32, 195)),
      projectId: 'synthetic-own-instructions', namespace: 'original_instructions' };
    const authority = createFirestoreAuthority(options), data = new FirestoreDomainData(options), notes = createFirestorePrivateInstructions(data);
    await authority.initializeControl({ enabled: true, generation: randomUUID() });
    const children = new Map<string, string>();
    for (const userId of ['parent', 'other']) {
      const email = userId + '@example.test';
      await authority.issueInvitation({ email, operationId: randomUUID(), expiresAt: new Date(Date.now() + 3600000).toISOString() });
      await authority.admitIdentity({ userId, email, emailVerified: true });
      await authority.acknowledge({ userId, policyVersion: SERVICE_POLICY_VERSION, operationId: randomUUID() });
      children.set(userId, (await authority.createChild({ userId, operationId: randomUUID(), displayName: userId })).child.id);
    }
    const childId = children.get('parent')!, otherChild = children.get('other')!, at = new Date().toISOString();
    async function native(owner: string, text: string, memoryKey: string) {
      return authority.runTransaction(owner, children.get(owner)!, async b => {
        const value: AgentPrivateNote = { id: randomUUID(), childId: b.scope.childId, version: 1, title: 'Same private note title', text,
          memoryKey, sourceMessageId: randomUUID(), provenance: 'user_statement', createdAt: at, updatedAt: at };
        const prepared = await notes.prepareWrite(b, randomUUID(), value, null); prepared.commit(); return prepared.value;
      });
    }
    const foreign = await native('other', 'BACKUP_PRIVATE_INSTRUCTION', 'restored-instruction');
    const original = await authority.runTransaction('parent', childId, async b => {
      const prepared = await notes.prepareImported(b, randomUUID(), { section: 'instructions', childId: otherChild, value: { ...foreign },
        source: { serverId: 'https://old-source.example.test', accountId: 'other', packageId: randomUUID(), packageVersion: 1,
          manifestSha256: 'b'.repeat(64), path: 'data/instructions.json', rowIndex: 0 } }, 'trusted');
      prepared.commit(); return prepared.value;
    });
    const missing = await native('parent', 'DELETED_BACKUP_INSTRUCTION', 'deleted-instruction');
    const memory = createFirestoreMemoryStore({ ...options, care: createFirestoreCareStore(options), chat: createFirestoreChatStore(options) });
    const unrelatedFact = await authority.runTransaction('parent', childId, async b => {
      const prepared = await memory.prepareConfirmedFact(b, { intendedVisibility: 'family', values: {
        key: 'unrelated-memory-fact', content: 'UNSELECTED_MEMORY_FACT', validUntil: null,
        source: { kind: 'manual', description: 'Original statement outside instruction restore' } } }, true, randomUUID());
      prepared.commit(); return prepared.value;
    });
    const exporter = createFirestoreAccountExport({ ...options, photos: { async content() { throw Error('Unexpected attachment read'); } } });
    const serverId = 'https://original-instructions.example.test', keys = generateKeyPairSync('ed25519'), packageId = randomUUID();
    const keyId = hash(keys.publicKey.export({ type: 'spki', format: 'der' }));
    const archive = await writePersonalHandoverPackage({ exporter, directory, ownerUserId: 'parent', serverId, packageId,
      createdAt: at, purpose: 'backup', signingKey: keys.privateKey, selection: { childIds: [childId], modules: ['memory'], period: null } });
    const objectsByName = new Map<string, { body: Buffer; metadata: unknown }>();
    const objects = createFirebaseHandoverObjects({ config: { projectId: options.projectId, namespace: options.namespace, bucketName: 'synthetic-original-instructions' },
      files: options.cipher.files, bucket: { async metadata(name) { return objectsByName.get(name)?.metadata ?? null; },
        createWrite(name, settings) { const chunks: Buffer[] = []; return new Writable({ write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); },
          final(done) { const body = Buffer.concat(chunks); objectsByName.set(name, { body, metadata: { name, bucket: 'synthetic-original-instructions',
            generation: '11111111111111111', size: String(body.length), metadata: settings.metadata?.metadata } }); done(); } }); },
        readPinned(name) { return Readable.from([objectsByName.get(name)!.body]); }, async removePinned(name) { objectsByName.delete(name); } } });
    const uploads = createHandoverUploadService({ ...options, objects, trustedKeys: new Map([[keyId, { key: keys.publicKey, serverId }]]) });
    const service = createHandoverImportService({ ...options, uploads, originalBackup: { serverId, async matchesIssuedBackup() { return false; } } });
    const bytes = await readFile(archive.path), uploadId = randomUUID();
    await uploads.create('parent', { opId: uploadId, filename: 'own-instructions.zip', bytes: bytes.length, sha256: hash(bytes) });
    const upload = await uploads.receive('parent', uploadId, Readable.from([bytes]), controller.signal);
    assert.equal(upload.state, 'ready', upload.error ?? JSON.stringify(upload)); assert.equal(upload.preview!.integrity, 'trusted');
    const later = await authority.runTransaction('parent', childId, async b => {
      const previous = await notes.read(b, original.id); assert.ok(previous);
      const { importedFrom: _previousOrigin, ...ownPrevious } = previous;
      const prepared = await notes.prepareWrite(b, randomUUID(), { ...ownPrevious, version: previous.version + 1,
        text: 'LATER_LOCAL_PRIVATE_INSTRUCTION', updatedAt: new Date().toISOString(), provenance: 'user_statement', sourceMessageId: randomUUID() }, previous);
      prepared.commit(); return prepared.value;
    });
    // A legacy deletion has no native tombstone. Reusing its subject/title must not identify an original.
    await authority.runTransaction('parent', childId, async b => {
      b.transaction.delete(data.ref('private_instructions', 'private-instruction', missing.id));
      b.transaction.delete(data.ref('memory_keys', 'memory-key', notes.keyId(b, missing.memoryKey!)));
    });
    const sameName = await native('parent', 'CURRENT_DIFFERENT_NOTE_WITH_SAME_NAME', missing.memoryKey!);
    const read = (owner: string, id: string) => authority.runTransaction(owner, children.get(owner)!, b => notes.read(b, id));
    const request = { uploadId, expectedUploadVersion: upload.version, childId, module: 'memory', includeRestoreTarget: true };
    const before = structuredClone([...fixture.records]);
    const comparison = await service.compareOriginal('parent', request, controller.signal);
    const byId = new Map(comparison.items.map(item => [item.id, item]));
    assert.equal(comparison.items.length, 2); assert.equal(comparison.nextCursor, null);
    assert.equal(byId.get(original.id)?.state, 'local_newer'); assert.equal(byId.get(original.id)?.localVersion, later.version);
    assert.equal(byId.get(original.id)?.targetId, original.id);
    assert.equal(byId.get(missing.id)?.state, 'unavailable'); assert.equal(byId.get(missing.id)?.localVersion, null);
    assert.doesNotMatch(JSON.stringify(comparison), /PRIVATE_INSTRUCTION|DIFFERENT_NOTE/u);
    assert.deepEqual([...fixture.records], before, 'Comparing cannot replace a newer note or create work');
    assert.equal((await read('parent', original.id))!.text, later.text);
    await assert.rejects(service.compareOriginal('other', request, controller.signal));
    await assert.rejects(service.compareOriginal('parent', { ...request, childId: otherChild }, controller.signal));
    const base = { uploadId, expectedUploadVersion: upload.version, acceptedManifestSha256: comparison.manifestSha256,
      restoreOriginal: true, resolutionOnly: true,
      targets: [{ sourceChildId: childId, target: { childId, spaceId: null }, sections: ['memory'] }] };
    await assert.rejects(service.create('parent', { ...base, opId: randomUUID(), resolutions: [] }, controller.signal));
    const codec = createFirestoreRestoreCodec(options);
    type Delivery = Parameters<ReturnType<typeof createFirebaseWorkerServices>['background']['process']>[0];
    const deliveries: Delivery[] = [];
    const worker = createFirebaseWorkerServices({ ...options, config: { ...options, taskWorkerEnabled: true }, authority, handoverImports: service,
      currentAuth: async () => ({ disabled: false, emailVerified: true, email: 'parent@example.test' }) } as unknown as Parameters<typeof createFirebaseWorkerServices>[0],
      { taskName: () => 'unused', async enqueue() { throw Error('Unexpected notification'); }, async probe() { throw Error('Unexpected notification'); } },
      { async enqueue(value) { deliveries.push(value); return { state: 'confirmed' }; }, async probe() { return { state: 'confirmed' }; } }, controller);
    async function execute(command: object & { opId: string }) {
      assert.equal((await service.create('parent', command, controller.signal)).state, 'queued');
      const work = [...fixture.records].filter(([path]) => path.includes('_background_work/'))
        .map(([path, value]) => codec.decode({ path, data: value }).value as { kind: string; resourceId: string; id: string })
        .find(value => value.kind === 'handover-import' && value.resourceId === command.opId); assert.ok(work);
      for (let page = 0; page < 8 && !deliveries.some(value => value.id === work.id); page++) await worker.background.dispatch();
      const delivery = deliveries.find(value => value.id === work.id); assert.ok(delivery);
      assert.equal((await worker.background.process(delivery)).state, 'completed');
      const done = await service.get('parent', command.opId); assert.equal(done.state, 'completed', done.error ?? JSON.stringify(done));
      assert.equal((await worker.background.process(delivery)).state, 'completed'); return done;
    }
    const command = { ...base, opId: randomUUID(), resolutions: [
      { sourceChildId: childId, section: 'instructions', resourceId: original.id,
        resolution: { mode: 'replace_current', targetId: original.id, expectedVersion: later.version } },
      { sourceChildId: childId, section: 'instructions', resourceId: missing.id,
        resolution: { mode: 'replace_current', targetId: missing.id, expectedVersion: missing.version } },
    ] };
    await assert.rejects(service.create('parent', { ...command, opId: randomUUID(), resolutions: [{ ...command.resolutions[1],
      resolution: { mode: 'restore_deleted', targetId: missing.id, expectedVersion: missing.version } }] }, controller.signal), { code: 'invalid_input' });
    const done = await execute(command);
    assert.deepEqual(done.counts, { created: 0, updated: 1, skipped: 0, conflict: 1 });
    const restored = await read('parent', original.id); assert.ok(restored);
    assert.equal(restored.id, original.id); assert.equal(restored.childId, childId); assert.equal(restored.version, later.version + 1);
    assert.equal(restored.text, original.text); assert.equal(restored.provenance, 'imported_source'); assert.equal(restored.sourceMessageId, null);
    assert.equal(restored.importedFrom!.current.source.accountId, 'parent'); assert.equal(restored.importedFrom!.current.source.resourceId, original.id);
    assert.equal(restored.importedFrom!.current.source.resourceVersion, original.version);
    assert.equal(restored.importedFrom!.current.packageId, packageId);
    assert.deepEqual(restored.importedFrom!.previous.find(link => link.source.accountId === 'other' && link.source.resourceId === foreign.id), original.importedFrom!.current);
    assert.equal(await read('parent', missing.id), null); assert.deepEqual(await read('parent', sameName.id), sameName);
    assert.deepEqual(await read('other', foreign.id), foreign);
    assert.deepEqual(await service.create('parent', command, controller.signal), done);
    assert.deepEqual(await read('parent', original.id), restored);
    const items = await service.results('parent', command.opId, { sourceChildId: childId, module: 'memory' });
    const unavailable = items.items.find(item => item.sourceResourceId === missing.id);
    assert.equal(unavailable?.outcome, 'conflict'); assert.equal(unavailable?.reason, 'original_unavailable');
    assert.deepEqual((await authority.runTransaction('parent', childId, b => memory.readImportState(b, 'facts', unrelatedFact.id))).value, unrelatedFact);
    const finalComparison = await service.compareOriginal('parent', request, controller.signal);
    assert.equal(finalComparison.items.find(item => item.id === original.id)?.state, 'unchanged');
    assert.equal(finalComparison.items.find(item => item.id === missing.id)?.state, 'unavailable');
    const foreignTarget = { ...base, opId: randomUUID(), resolutions: [{ sourceChildId: childId, section: 'instructions', resourceId: original.id,
      resolution: { mode: 'replace_current', targetId: foreign.id, expectedVersion: foreign.version } }] };
    await assert.rejects(service.create('parent', foreignTarget, controller.signal), { code: 'invalid_input' });
    assert.deepEqual(await read('parent', original.id), restored); assert.deepEqual(await read('other', foreign.id), foreign);
  } finally { controller.abort(); await rm(directory, { recursive: true, force: true }); }
});
