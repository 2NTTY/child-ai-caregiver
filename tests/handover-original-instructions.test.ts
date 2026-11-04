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
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirestoreAgentRuns } from '../server/firestore-agent-runs.ts';
import { createFirestoreAgentProposals } from '../server/firestore-agent-proposals.ts';
import { createFirestoreAgentActions } from '../server/firestore-agent-actions.ts';
import { createFirestoreContentErasure, contentErasureSchema } from '../server/firestore-content-erasure.ts';
import { createFirebaseErasureJournal, privateInstructionErasureOperationId } from '../server/firebase-erasure-journal.ts';
import type { FirebasePhotoBucketPort } from '../server/firebase-photo-objects.ts';
import { createFirestoreAccountExport } from '../server/firestore-account-export.ts';
import { createFirestoreRestoreCodec } from '../server/firestore-restore-codec.ts';
import { assertFirestoreRestoreContent } from '../server/firestore-restore-content.ts';
import { handoverImportItemId, handoverImportMappingId, handoverImportMappingMetadata, handoverImportMappingSchema,
  type HandoverImportMapping } from '../server/handover-import-records.ts';
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
    const codec = createFirestoreRestoreCodec(options);
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
    const revivable = await native('parent', 'EXPLICITLY_REVIVABLE_BACKUP_NOTE', 'revivable-instruction');
    const blocked = await native('parent', 'BLOCKED_REVIVAL_BACKUP_NOTE', 'blocked-revival');
    const care = createFirestoreCareStore(options), chat = createFirestoreChatStore(options);
    const memory = createFirestoreMemoryStore({ ...options, care, chat }), online = createFirestoreOnlineStore(options);
    const runs = createFirestoreAgentRuns({ ...options, chat, memory });
    const actions = createFirestoreAgentActions({ runs, care, online, proposals: createFirestoreAgentProposals({ runs, chat, memory, online }) });
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
    const journalObjects = new Map<string, { bytes: Buffer; metadata: Record<string, unknown> }>();
    const journalBucket = 'independent-original-instruction-journal';
    const bucket: FirebasePhotoBucketPort = {
      async writeNew(name, bytes, settings) {
        if (journalObjects.has(name)) throw Object.assign(new Error('Already journaled'), { code: 412 });
        const metadata = { name, bucket: journalBucket, generation: '1', size: String(bytes.length), metadata: settings.metadata!.metadata };
        journalObjects.set(name, { bytes: Buffer.from(bytes), metadata }); return metadata;
      },
      async metadata(name) {
        const row = journalObjects.get(name); if (!row) throw Object.assign(new Error('Missing journal'), { code: 404 });
        return structuredClone(row.metadata);
      },
      readPinned(name, generation) {
        let sent = false;
        return new Readable({ read() { if (sent) return; sent = true;
          this.emit('response', { statusCode: 206, headers: { 'x-goog-generation': generation } });
          this.push(journalObjects.get(name)!.bytes); this.push(null);
        } });
      },
    };
    const journal = createFirebaseErasureJournal({ config: { projectId: options.projectId, namespace: options.namespace, bucketName: journalBucket },
      cipher: createStorageCipher(Buffer.alloc(32, 196)), bucket });
    const cleanup = createFirestoreContentErasure({ ...options, journal });
    async function permanentlyDelete(note: AgentPrivateNote) {
      const command = { operationId: randomUUID(), expectedVersion: note.version, confirmDelete: true as const };
      assert.equal(await actions.deleteNote('parent', childId, note.id, command), true);
      assert.equal(await actions.deleteNote('parent', childId, note.id, command), true);
      const jobs = (await data.collection('content_erasures').get()).docs.filter(row =>
        contentErasureSchema.parse(codec.decode({ path: row.ref.path, data: row.data()! }).value).intent.assetId === note.id);
      assert.equal(jobs.length, 1);
      const ref = jobs[0]!.ref;
      for (let page = 0; page < 8; page++) {
        const row = await options.database.runTransaction(tx => tx.get(ref));
        const current = contentErasureSchema.parse(codec.decode({ path: row.ref.path, data: row.data()! }).value);
        if (current.stage === 'done') { assert.ok(current.journal); await journal.read(current.intent, current.journal); return; }
        await cleanup.advance(row);
      }
      assert.fail('The native instruction deletion journal must finish before comparison');
    }
    await permanentlyDelete(revivable); await permanentlyDelete(blocked);
    assert.equal(journalObjects.size, 2);
    const keyBlocker = await native('parent', 'KEEP_CURRENT_NOTE_WITH_REUSED_KEY', blocked.memoryKey!);
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
    assert.equal(comparison.items.length, 4); assert.equal(comparison.nextCursor, null);
    assert.equal(byId.get(original.id)?.state, 'local_newer'); assert.equal(byId.get(original.id)?.localVersion, later.version);
    assert.equal(byId.get(original.id)?.targetId, original.id);
    assert.equal(byId.get(missing.id)?.state, 'unavailable'); assert.equal(byId.get(missing.id)?.localVersion, null);
    for (const note of [revivable, blocked]) {
      assert.equal(byId.get(note.id)?.state, 'deleted', 'A completed native deletion barrier distinguishes an explicitly restorable backup from legacy absence');
      assert.equal(byId.get(note.id)?.localVersion, note.version + 1);
    }
    assert.doesNotMatch(JSON.stringify(comparison), /PRIVATE_INSTRUCTION|DIFFERENT_NOTE/u);
    assert.deepEqual([...fixture.records], before, 'Comparing cannot replace a newer note or create work');
    assert.equal((await read('parent', original.id))!.text, later.text);
    await assert.rejects(service.compareOriginal('other', request, controller.signal));
    await assert.rejects(service.compareOriginal('parent', { ...request, childId: otherChild }, controller.signal));
    const base = { uploadId, expectedUploadVersion: upload.version, acceptedManifestSha256: comparison.manifestSha256,
      restoreOriginal: true, resolutionOnly: true,
      targets: [{ sourceChildId: childId, target: { childId, spaceId: null }, sections: ['memory'] }] };
    await assert.rejects(service.create('parent', { ...base, opId: randomUUID(), resolutions: [] }, controller.signal));
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

    const mapping = await authority.runTransaction('parent', childId, async b => {
      const source = { serverId, accountId: 'parent', childId, section: 'instructions' as const, resourceId: original.id };
      const id = handoverImportMappingId(b.scope, source, true), ref = data.ref('handover_import_mappings', 'handover-import-mapping', id);
      const row = await b.transaction.get(ref); assert.equal(row.exists, true, 'The real restore worker must have written the original mapping');
      return { scope: b.scope, record: { path: ref.path, data: row.data()! },
        value: data.open('handover-import-mapping', id, b.scope, handoverImportMappingSchema, row) };
    });
    function encodedMapping(value: HandoverImportMapping) {
      const id = handoverImportMappingId(mapping.scope, value.source, value.restoreOriginal);
      return { path: data.ref('handover_import_mappings', 'handover-import-mapping', id).path,
        data: { ...data.tags(mapping.scope), ...handoverImportMappingMetadata(value),
          ...data.seal('handover-import-mapping', id, mapping.scope, handoverImportMappingSchema, value, value.revision) } };
    }
    function roundTrip(record: { path: string; data: unknown }) {
      const decoded = codec.decode(record), epoch = randomUUID();
      const transformed = codec.transform(decoded, { generation: randomUUID(),
        newEpochByWorkspace: new Map([[mapping.scope.workspaceId, epoch]]), photoDescriptors: new Map() });
      const reopened = codec.decode(transformed);
      assert.ok(reopened.context.family === 'domain');
      assert.equal(reopened.context.scope.storageEpoch, epoch);
      assert.notEqual(reopened.context.scope.storageEpoch, mapping.scope.storageEpoch);
      return handoverImportMappingSchema.parse(reopened.value);
    }
    const legacyCare = handoverImportMappingSchema.parse({ ...mapping.value, source: { ...mapping.value.source, section: 'care' } });
    assert.deepEqual(roundTrip(encodedMapping(legacyCare)), legacyCare, 'An existing enabled original-mapping partition remains compatible');
    for (const invalid of [
      { ...mapping.value, source: { ...mapping.value.source, accountId: 'other' } },
      { ...mapping.value, source: { ...mapping.value.source, childId: otherChild } },
      { ...mapping.value, source: { ...mapping.value.source, section: 'memory_facts' } },
      { ...mapping.value, target: { ...mapping.value.target, id: foreign.id } },
    ]) {
      assert.throws(() => codec.decode(encodedMapping(handoverImportMappingSchema.parse(invalid))), { code: 'restore_binding' },
        'Encryption alone does not authorize a foreign source, disabled original partition or substituted target');
    }
    const restoredMapping = roundTrip(mapping.record);
    assert.deepEqual(restoredMapping, mapping.value, 'Original instruction mappings survive encrypted restore and epoch rebinding without losing their source or operation');
    assert.equal(restoredMapping.operationId, mapping.value.operationId);
    assert.equal(restoredMapping.source.resourceId, original.id);
    assert.deepEqual(restoredMapping.target, { id: original.id, version: restored.version });
    const receiptPath = data.ref('handover_import_items', 'handover-import-item',
      handoverImportItemId(mapping.scope, restoredMapping.operationId)).path;
    const receiptRow = codec.decode({ path: receiptPath, data: fixture.records.get(receiptPath)! });
    assert.doesNotThrow(() => assertFirestoreRestoreContent([codec.decode(mapping.record), receiptRow]));
    const changedHash = encodedMapping({ ...restoredMapping, sourceHash: '0'.repeat(64) });
    assert.throws(() => assertFirestoreRestoreContent([codec.decode(changedHash), receiptRow]), { code: 'restore_content_binding' });

    const revivalCommand = { ...base, opId: randomUUID(), resolutions: [
      ...[revivable, blocked].map(note => ({ sourceChildId: childId, section: 'instructions', resourceId: note.id,
        resolution: { mode: 'restore_deleted', targetId: note.id, expectedVersion: byId.get(note.id)!.localVersion! } })),
      { sourceChildId: childId, section: 'instructions', resourceId: missing.id,
        resolution: { mode: 'restore_deleted', targetId: missing.id, expectedVersion: missing.version } },
    ] };
    const revivalDone = await execute(revivalCommand);
    assert.deepEqual(revivalDone.counts, { created: 1, updated: 0, skipped: 0, conflict: 2 });
    const revivalResults = await service.results('parent', revivalCommand.opId, { sourceChildId: childId, module: 'memory' });
    const revivalResult = revivalResults.items.find(item => item.sourceResourceId === revivable.id)!;
    assert.equal(revivalResult.outcome, 'created'); assert.ok(revivalResult.recordedResource);
    const revivedId = revivalResult.recordedResource.id;
    assert.notEqual(revivedId, revivable.id);
    const revived = await read('parent', revivedId); assert.ok(revived);
    assert.equal(revived.text, revivable.text); assert.equal(revived.provenance, 'imported_source'); assert.equal(revived.sourceMessageId, null);
    assert.equal(revived.importedFrom!.current.source.resourceId, revivable.id);
    assert.equal(revived.importedFrom!.current.packageId, packageId);
    assert.equal(await read('parent', revivable.id), null); assert.equal(await read('parent', blocked.id), null);
    assert.deepEqual(await read('parent', keyBlocker.id), keyBlocker);
    assert.equal(revivalResults.items.find(item => item.sourceResourceId === blocked.id)?.outcome, 'conflict');
    assert.equal(revivalResults.items.find(item => item.sourceResourceId === blocked.id)?.reason, 'instruction_key_conflict');
    assert.equal(revivalResults.items.find(item => item.sourceResourceId === missing.id)?.reason, 'original_unavailable');
    assert.deepEqual(await service.create('parent', revivalCommand, controller.signal), revivalDone);
    const revivedByKey = await actions.notesByKeys!('parent', childId, [revivable.memoryKey!]);
    assert.deepEqual(revivedByKey.items.map(item => item.id), [revivedId]);
    const afterRevival = await service.compareOriginal('parent', request, controller.signal);
    assert.equal(afterRevival.items.find(item => item.id === revivable.id)?.targetId, revivedId);
    assert.equal(afterRevival.items.find(item => item.id === revivable.id)?.state, 'unchanged');
    assert.equal(afterRevival.items.find(item => item.id === missing.id)?.state, 'unavailable');
    const changedRevived = await authority.runTransaction('parent', childId, async b => {
      const prepared = await notes.prepareWrite(b, randomUUID(), { ...revived, version: revived.version + 1,
        text: 'LATER_LOCAL_REVIVED_NOTE', updatedAt: new Date().toISOString() }, revived);
      prepared.commit(); return prepared.value;
    });
    const mappedComparison = await service.compareOriginal('parent', request, controller.signal);
    assert.equal(mappedComparison.items.find(item => item.id === revivable.id)?.targetId, revivedId);
    assert.equal(mappedComparison.items.find(item => item.id === revivable.id)?.localVersion, changedRevived.version);
    assert.equal(mappedComparison.items.find(item => item.id === revivable.id)?.state, 'local_newer');
    const mappedCommand = { ...base, opId: randomUUID(), resolutions: [{ sourceChildId: childId, section: 'instructions', resourceId: revivable.id,
      useRestoredTarget: true, resolution: { mode: 'replace_current', targetId: revivedId, expectedVersion: changedRevived.version } }] };
    const mappedDone = await execute(mappedCommand);
    assert.deepEqual(mappedDone.counts, { created: 0, updated: 1, skipped: 0, conflict: 0 });
    const reupdated = await read('parent', revivedId); assert.ok(reupdated);
    assert.equal(reupdated.version, changedRevived.version + 1); assert.equal(reupdated.text, revivable.text);
    assert.equal(await read('parent', revivable.id), null); assert.deepEqual(await read('parent', keyBlocker.id), keyBlocker);
    assert.deepEqual(await service.create('parent', mappedCommand, controller.signal), mappedDone);
    assert.deepEqual(await read('parent', revivedId), reupdated);
    const forgedMappedCommand = { ...mappedCommand, opId: randomUUID(), resolutions: [{ ...mappedCommand.resolutions[0],
      resolution: { mode: 'replace_current', targetId: keyBlocker.id, expectedVersion: keyBlocker.version } }] };
    const forgedMappedDone = await execute(forgedMappedCommand);
    assert.deepEqual(forgedMappedDone.counts, { created: 0, updated: 0, skipped: 0, conflict: 1 });
    const forgedResults = await service.results('parent', forgedMappedCommand.opId, { sourceChildId: childId, module: 'memory' });
    assert.equal(forgedResults.items[0]?.reason, 'target_version_conflict');
    assert.deepEqual(await read('parent', keyBlocker.id), keyBlocker);
    assert.deepEqual(await read('parent', revivedId), reupdated);
    const redirected = await authority.runTransaction('parent', childId, async b => {
      const source = { serverId, accountId: 'parent', childId, section: 'instructions' as const, resourceId: revivable.id };
      const id = handoverImportMappingId(b.scope, source, true), ref = data.ref('handover_import_mappings', 'handover-import-mapping', id);
      const row = await b.transaction.get(ref); assert.equal(row.exists, true);
      return { scope: b.scope, record: { path: ref.path, data: row.data()! },
        value: data.open('handover-import-mapping', id, b.scope, handoverImportMappingSchema, row) };
    });
    assert.deepEqual(redirected.value.target, { id: revivedId, version: reupdated.version });
    assert.equal(redirected.value.source.resourceId, revivable.id);
    assert.deepEqual(roundTrip(redirected.record), redirected.value);
    const redirectedReceiptPath = data.ref('handover_import_items', 'handover-import-item',
      handoverImportItemId(redirected.scope, redirected.value.operationId)).path;
    const proofPath = data.ref('content_erasures', 'content-erasure', privateInstructionErasureOperationId(redirected.scope, revivable.id)).path;
    const redirectedReceipt = codec.decode({ path: redirectedReceiptPath, data: fixture.records.get(redirectedReceiptPath)! });
    const proofRow = codec.decode({ path: proofPath, data: fixture.records.get(proofPath)! });
    const proof = contentErasureSchema.parse(proofRow.value);
    assert.equal(proof.stage, 'done'); assert.ok(proof.journal);
    assert.equal(proof.intent.content?.kind, 'private_instruction');
    assert.equal(redirected.value.retiredInstructionOpId, proof.intent.content && 'sourceOperationId' in proof.intent.content
      ? proof.intent.content.sourceOperationId : undefined);
    const redirectedRow = codec.decode(redirected.record), graph = [redirectedRow, redirectedReceipt, proofRow];
    assert.doesNotThrow(() => assertFirestoreRestoreContent(graph));
    const graphTransform = { generation: randomUUID(), newEpochByWorkspace: new Map([[redirected.scope.workspaceId, randomUUID()]]), photoDescriptors: new Map() };
    const reopenedGraph = graph.map(row => codec.decode(codec.transform(row, graphTransform)));
    assert.doesNotThrow(() => assertFirestoreRestoreContent(reopenedGraph), 'The redirected mapping, latest receipt and original deletion proof remain bound after epoch restoration');
    assert.throws(() => assertFirestoreRestoreContent([redirectedRow, redirectedReceipt]), { code: 'restore_content_missing' });
    const changedMarker = codec.decode(encodedMapping({ ...redirected.value, retiredInstructionOpId: randomUUID() }));
    assert.throws(() => assertFirestoreRestoreContent([changedMarker, redirectedReceipt, proofRow]), { code: 'restore_content_binding' });
    const { retiredInstructionOpId: _marker, ...withoutMarker } = redirected.value;
    assert.throws(() => codec.decode(encodedMapping(withoutMarker)), { code: 'restore_binding' });
  } finally { controller.abort(); await rm(directory, { recursive: true, force: true }); }
});
