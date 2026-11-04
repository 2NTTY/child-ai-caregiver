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
import { createFirestoreCareStore } from '../server/firestore-care.ts';
import { createFirestoreChatStore } from '../server/firestore-chat.ts';
import { createFirestoreMemoryStore } from '../server/firestore-memory.ts';
import { createFirestorePrivateInstructions } from '../server/firestore-private-instructions.ts';
import { createFirestoreAccountExport } from '../server/firestore-account-export.ts';
import { createFirestoreRestoreCodec } from '../server/firestore-restore-codec.ts';
import { assertFirestoreRestoreContent } from '../server/firestore-restore-content.ts';
import { handoverImportItemId, handoverImportMappingId, handoverImportMappingSchema } from '../server/handover-import-records.ts';
import { createFirebaseHandoverObjects } from '../server/firebase-handover-objects.ts';
import { createHandoverUploadService } from '../server/handover-upload-service.ts';
import { createHandoverImportService } from '../server/handover-import-service.ts';
import { createFirebaseWorkerServices } from '../server/firebase-worker-services.ts';
import { writePersonalHandoverPackage } from '../server/handover-export.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { emptyCareDetails } from '../src/shared/care.ts';

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

test('signed own memory backups preserve native evidence, candidates and terminal topics while restoring only proven originals once', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'handover-original-memory-')), controller = new AbortController();
  try {
    const fixture = serialFirestoreFixture(), options = { database: fixture.database, cipher: createStorageCipher(Buffer.alloc(32, 197)),
      projectId: 'synthetic-own-memory', namespace: 'original_memory' };
    const authority = createFirestoreAuthority(options), data = new FirestoreDomainData(options), codec = createFirestoreRestoreCodec(options);
    const care = createFirestoreCareStore(options), memory = createFirestoreMemoryStore({ ...options, care, chat: createFirestoreChatStore(options) });
    await authority.initializeControl({ enabled: true, generation: randomUUID() });
    const children = new Map<string, string>();
    for (const userId of ['parent', 'other']) {
      const email = userId + '@example.test';
      await authority.issueInvitation({ email, operationId: randomUUID(), expiresAt: new Date(Date.now() + 3600000).toISOString() });
      await authority.admitIdentity({ userId, email, emailVerified: true });
      await authority.acknowledge({ userId, policyVersion: SERVICE_POLICY_VERSION, operationId: randomUUID() });
      children.set(userId, (await authority.createChild({ userId, operationId: randomUUID(), displayName: userId })).child.id);
    }
    const childId = children.get('parent')!, otherChild = children.get('other')!;
    const record = await care.create('parent', childId, { text: 'ORIGINAL_NATIVE_CARE', source: '本人記錄', details: emptyCareDetails() }); assert.ok(record);
    const source = { kind: 'care_record' as const, recordId: record.id, version: record.version, description: '本人照護記錄' };
    const values = (key: string) => ({ key, content: 'BACKUP_' + key, validUntil: null, source });
    async function confirmed(key: string) {
      return authority.runTransaction('parent', childId, async b => {
        const prepared = await memory.prepareConfirmedFact(b, { intendedVisibility: 'private', values: values(key) }, false, randomUUID());
        prepared.commit(); return prepared.value;
      });
    }
    const fact = await confirmed('native-fact'), deletedFact = await confirmed('deleted-fact');
    const candidate = await memory.createFact('parent', childId, { intendedVisibility: 'private', values: values('candidate-fact') }); assert.ok(candidate);
    const missing = await memory.createFact('parent', childId, { intendedVisibility: 'private', values: values('legacy-missing') }); assert.ok(missing);
    async function topic(title: string) {
      const value = await memory.createTopic('parent', childId, { title, note: 'BACKUP_' + title, visibility: 'private', confirmShared: false }); assert.ok(value); return value;
    }
    const pending = await topic('pending-topic'), terminal = await topic('terminal-topic'), deletedTopic = await topic('deleted-topic');
    const foreign = await memory.createFact('other', otherChild, { intendedVisibility: 'private', values: { key: 'native-fact', content: 'OTHER_ACCOUNT_SECRET',
      validUntil: null, source: { kind: 'manual', description: 'Other owner' } } }); assert.ok(foreign);
    const instructions = createFirestorePrivateInstructions(data);
    const instruction = await authority.runTransaction('parent', childId, async b => {
      const at = new Date().toISOString(), value = { id: randomUUID(), childId, version: 1, title: 'Legacy instruction', text: 'LEGACY_INSTRUCTION',
        memoryKey: 'legacy-instruction', sourceMessageId: randomUUID(), provenance: 'user_statement' as const, createdAt: at, updatedAt: at };
      const prepared = await instructions.prepareWrite(b, randomUUID(), value, null); prepared.commit(); return prepared.value;
    });
    const serverId = 'https://original-memory.example.test', keys = generateKeyPairSync('ed25519'), packageId = randomUUID();
    const exporter = createFirestoreAccountExport({ ...options, photos: { async content() { throw Error('Unexpected attachment read'); } } });
    const archive = await writePersonalHandoverPackage({ exporter, directory, ownerUserId: 'parent', serverId, packageId, createdAt: new Date().toISOString(),
      purpose: 'backup', signingKey: keys.privateKey, selection: { childIds: [childId], modules: ['memory'], period: null } });
    const stored = new Map<string, { body: Buffer; metadata: unknown }>();
    const objects = createFirebaseHandoverObjects({ config: { projectId: options.projectId, namespace: options.namespace, bucketName: 'synthetic-original-memory' },
      files: options.cipher.files, bucket: { async metadata(name) { return stored.get(name)?.metadata ?? null; },
        createWrite(name, settings) { const chunks: Buffer[] = []; return new Writable({ write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); },
          final(done) { const body = Buffer.concat(chunks); stored.set(name, { body, metadata: { name, bucket: 'synthetic-original-memory',
            generation: '11111111111111111', size: String(body.length), metadata: settings.metadata?.metadata } }); done(); } }); },
        readPinned(name) { return Readable.from([stored.get(name)!.body]); }, async removePinned(name) { stored.delete(name); } } });
    const keyId = hash(keys.publicKey.export({ type: 'spki', format: 'der' }));
    const uploads = createHandoverUploadService({ ...options, objects, trustedKeys: new Map([[keyId, { key: keys.publicKey, serverId }]]) });
    const service = createHandoverImportService({ ...options, uploads, originalBackup: { serverId, async matchesIssuedBackup() { return false; } } });
    const bytes = await readFile(archive.path), uploadId = randomUUID();
    await uploads.create('parent', { opId: uploadId, filename: 'own-memory.zip', bytes: bytes.length, sha256: hash(bytes) });
    const upload = await uploads.receive('parent', uploadId, Readable.from([bytes]), controller.signal);
    assert.equal(upload.state, 'ready', upload.error ?? JSON.stringify(upload)); assert.equal(upload.preview!.integrity, 'trusted');
    const revise = (id: string, expectedVersion: number, key: string) => memory.reviseFact('parent', childId, id, { expectedVersion, confirm: true, confirmShared: false,
      values: { ...values(key), content: 'LATER_' + key }, reason: '本地更正' });
    const laterFact = await revise(fact.id, fact.version, fact.key), laterCandidate = await revise(candidate.id, candidate.version, candidate.key);
    assert.ok(laterFact); assert.ok(laterCandidate);
    const laterPending = await memory.changeTopic('parent', childId, pending.id, { expectedVersion: pending.version, status: 'pending', note: 'LATER_PENDING', resumeAfter: null }); assert.ok(laterPending);
    const resolved = await memory.changeTopic('parent', childId, terminal.id, { expectedVersion: terminal.version, status: 'resolved', note: 'KEEP_TERMINAL', resumeAfter: null }); assert.ok(resolved);
    await memory.delete('parent', childId, 'facts', deletedFact.id, deletedFact.version);
    await memory.delete('parent', childId, 'topics', deletedTopic.id, deletedTopic.version);
    await authority.runTransaction('parent', childId, async b => { b.transaction.delete(data.ref('memory_facts', 'memory-fact', missing.id)); });
    const sameName = await memory.createFact('parent', childId, { intendedVisibility: 'private', values: { ...values(missing.key), content: 'KEEP_SAME_NAME_NEW_ID' } }); assert.ok(sameName);
    const request = { uploadId, expectedUploadVersion: upload.version, childId, module: 'memory', includeRestoreTarget: true };
    const legacy = await service.compareOriginal('parent', request, controller.signal);
    assert.deepEqual(legacy.items.map(item => item.id), [instruction.id], 'Without opt-in the old memory comparison still exposes instructions only');
    const opted = { ...request, includeMemoryResources: true };
    const before = structuredClone([...fixture.records]);
    const comparison = await service.compareOriginal('parent', opted, controller.signal);
    const comparisonItems = [...comparison.items]; let cursor = comparison.nextCursor;
    for (let page = 0; cursor && page < 10; page++) {
      const next = await service.compareOriginal('parent', { ...opted, cursor }, controller.signal); comparisonItems.push(...next.items); cursor = next.nextCursor;
    }
    assert.equal(cursor, null); assert.equal(new Set(comparisonItems.map(item => JSON.stringify([item.resourceSection, item.id]))).size, 8);
    const byId = new Map(comparisonItems.map(item => [item.id, item]));
    assert.equal(byId.get(fact.id)?.resourceSection, 'memory_facts'); assert.equal(byId.get(pending.id)?.resourceSection, 'memory_topics');
    assert.equal(byId.get(fact.id)?.state, 'local_newer'); assert.equal(byId.get(candidate.id)?.state, 'local_newer');
    for (const value of [deletedFact, deletedTopic]) { assert.equal(byId.get(value.id)?.state, 'deleted'); assert.equal(byId.get(value.id)?.localVersion, value.version + 1); }
    assert.equal(byId.get(missing.id)?.state, 'unavailable'); assert.equal(byId.get(missing.id)?.localVersion, null);
    assert.deepEqual([...fixture.records], before); assert.doesNotMatch(JSON.stringify(comparisonItems), /BACKUP_|OTHER_ACCOUNT_SECRET/u);
    await assert.rejects(service.compareOriginal('other', opted, controller.signal));
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
      assert.equal((await worker.background.process(delivery)).state, 'completed');
      assert.deepEqual(await service.create('parent', command, controller.signal), done); return done;
    }
    const base = { uploadId, expectedUploadVersion: upload.version, acceptedManifestSha256: comparison.manifestSha256, restoreOriginal: true, resolutionOnly: true,
      targets: [{ sourceChildId: childId, target: { childId, spaceId: null }, sections: ['memory'] }] };
    const command = { ...base, opId: randomUUID(), resolutions: [
      ...[laterFact, laterCandidate].map(value => ({ sourceChildId: childId, section: 'memory_facts', resourceId: value.id,
        resolution: { mode: 'replace_current', targetId: value.id, expectedVersion: value.version } })),
      ...[laterPending, resolved].map(value => ({ sourceChildId: childId, section: 'memory_topics', resourceId: value.id,
        resolution: { mode: 'replace_current', targetId: value.id, expectedVersion: value.version } })),
      ...[{ value: deletedFact, section: 'memory_facts' }, { value: deletedTopic, section: 'memory_topics' }].map(({ value, section }) =>
        ({ sourceChildId: childId, section, resourceId: value.id, resolution: { mode: 'restore_deleted', targetId: value.id, expectedVersion: value.version + 1 } })),
      { sourceChildId: childId, section: 'memory_facts', resourceId: missing.id,
        resolution: { mode: 'restore_deleted', targetId: missing.id, expectedVersion: missing.version } },
    ] };
    await assert.rejects(service.create('other', command, controller.signal));
    const done = await execute(command); assert.deepEqual(done.counts, { created: 2, updated: 3, skipped: 0, conflict: 2 });
    const restoredFact = await memory.getFact('parent', childId, fact.id), restoredCandidate = await memory.getFact('parent', childId, candidate.id);
    assert.ok(restoredFact); assert.ok(restoredCandidate);
    assert.equal(restoredFact.version, laterFact.version + 1); assert.equal(restoredFact.content, fact.content);
    assert.deepEqual(restoredFact.source, source); assert.equal(restoredFact.confirmedBy, fact.confirmedBy); assert.equal(restoredFact.confirmedAt, fact.confirmedAt);
    assert.equal(restoredFact.confirmationBasis, 'imported_source'); assert.equal(restoredFact.applicable, true);
    assert.equal(restoredCandidate.version, laterCandidate.version + 1); assert.equal(restoredCandidate.status, 'candidate');
    assert.equal(restoredCandidate.confirmedBy, null); assert.equal(restoredCandidate.confirmedAt, null); assert.equal(restoredCandidate.applicable, false);
    const readTopic = (id: string) => authority.runTransaction('parent', childId, b => memory.readTopic(b, id));
    const restoredPending = await readTopic(pending.id); assert.ok(restoredPending);
    assert.equal(restoredPending.version, laterPending.version + 1); assert.equal(restoredPending.note, pending.note); assert.equal(restoredPending.status, 'pending');
    assert.deepEqual(await readTopic(terminal.id), resolved);
    const results = await service.results('parent', command.opId, { sourceChildId: childId, module: 'memory' });
    assert.equal(results.items.find(item => item.sourceResourceId === terminal.id)?.reason, 'terminal_topic');
    assert.equal(results.items.find(item => item.sourceResourceId === missing.id)?.reason, 'original_unavailable');
    assert.equal(await memory.getFact('parent', childId, missing.id), null); assert.deepEqual(await memory.getFact('parent', childId, sameName.id), sameName);
    assert.deepEqual(await memory.getFact('other', otherChild, foreign.id), foreign);
    const newFactId = results.items.find(item => item.sourceResourceId === deletedFact.id)?.recordedResource?.id;
    const newTopicId = results.items.find(item => item.sourceResourceId === deletedTopic.id)?.recordedResource?.id;
    assert.ok(newFactId); assert.ok(newTopicId); assert.notEqual(newFactId, deletedFact.id); assert.notEqual(newTopicId, deletedTopic.id);
    const revivedFact = await memory.getFact('parent', childId, newFactId), revivedTopic = await readTopic(newTopicId);
    assert.ok(revivedFact); assert.ok(revivedTopic); assert.deepEqual(revivedFact.source, source); assert.equal(revivedFact.content, deletedFact.content);
    assert.equal(revivedTopic.note, deletedTopic.note); assert.equal(revivedTopic.status, 'pending');
    assert.equal(await memory.getFact('parent', childId, deletedFact.id), null); assert.equal(await readTopic(deletedTopic.id), null);
    for (const [section, original, id] of [['memory_facts', deletedFact, newFactId], ['memory_topics', deletedTopic, newTopicId]] as const) {
      const mapping = await authority.runTransaction('parent', childId, async b => {
        const source = { serverId, accountId: 'parent', childId, section, resourceId: original.id };
        const mappingId = handoverImportMappingId(b.scope, source, true), ref = data.ref('handover_import_mappings', 'handover-import-mapping', mappingId);
        const row = await b.transaction.get(ref); assert.ok(row.exists);
        return { scope: b.scope, record: { path: ref.path, data: row.data()! }, value: data.open('handover-import-mapping', mappingId, b.scope, handoverImportMappingSchema, row) };
      });
      assert.equal(mapping.value.target.id, id);
      const receipt = data.ref('handover_import_items', 'handover-import-item', handoverImportItemId(mapping.scope, mapping.value.operationId));
      const tombstone = data.ref(section === 'memory_facts' ? 'memory_facts' : 'memory_topics', section === 'memory_facts' ? 'memory-fact' : 'memory-topic', original.id);
      const graph = [mapping.record, { path: receipt.path, data: fixture.records.get(receipt.path)! }, { path: tombstone.path, data: fixture.records.get(tombstone.path)! }].map(row => codec.decode(row));
      assert.doesNotThrow(() => assertFirestoreRestoreContent(graph));
      assert.throws(() => assertFirestoreRestoreContent(graph.slice(0, 2)));
      const transform = { generation: randomUUID(), newEpochByWorkspace: new Map([[mapping.scope.workspaceId, randomUUID()]]), photoDescriptors: new Map() };
      assert.doesNotThrow(() => assertFirestoreRestoreContent(graph.map(row => codec.decode(codec.transform(row, transform)))));
    }
    const changedNew = await revise(newFactId, revivedFact.version, revivedFact.key); assert.ok(changedNew);
    const mappedCommand = { ...base, opId: randomUUID(), resolutions: [{ sourceChildId: childId, section: 'memory_facts', resourceId: deletedFact.id,
      useRestoredTarget: true, resolution: { mode: 'replace_current', targetId: newFactId, expectedVersion: changedNew.version } }] };
    const mappedDone = await execute(mappedCommand); assert.deepEqual(mappedDone.counts, { created: 0, updated: 1, skipped: 0, conflict: 0 });
    assert.equal((await memory.getFact('parent', childId, newFactId))!.content, deletedFact.content);
    assert.equal(await memory.getFact('parent', childId, deletedFact.id), null);
    await care.revise('parent', childId, record.id, { text: 'CORRECTED_NATIVE_CARE', details: emptyCareDetails(), source: '本人更正' }, record.version, '更正來源');
    const invalidated = await memory.getFact('parent', childId, fact.id); assert.ok(invalidated);
    assert.deepEqual(invalidated.source, source); assert.equal(invalidated.sourceState, 'changed'); assert.equal(invalidated.applicable, false);
    assert.equal((await memory.getFact('parent', childId, newFactId))!.applicable, false);
  } finally { controller.abort(); await rm(directory, { recursive: true, force: true }); }
});
