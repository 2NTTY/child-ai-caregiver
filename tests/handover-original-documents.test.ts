import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable, Writable } from 'node:stream';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreCareStore } from '../server/firestore-care.ts';
import { createFirestoreCareSummary } from '../server/firestore-care-summary.ts';
import { createFirestoreFamilyDocumentStore } from '../server/firestore-family-documents.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirestoreAccountExport } from '../server/firestore-account-export.ts';
import { createFirebaseHandoverObjects } from '../server/firebase-handover-objects.ts';
import { createHandoverUploadService } from '../server/handover-upload-service.ts';
import { createHandoverImportService } from '../server/handover-import-service.ts';
import { createFirestoreRestoreCodec } from '../server/firestore-restore-codec.ts';
import { createFirebaseWorkerServices } from '../server/firebase-worker-services.ts';
import { writePersonalHandoverPackage } from '../server/handover-export.ts';
import type { CareTask } from '../src/shared/tasks.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

test('signed own document backups restore both original document kinds once and retain later history without reviving stale appointment evidence', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'handover-original-documents-'));
  const stop = new AbortController();
  try {
    const fixture = serialFirestoreFixture(), cipher = createStorageCipher(Buffer.alloc(32, 119));
    const options = { database: fixture.database, cipher, projectId: 'synthetic-original-documents', namespace: 'original_documents' };
    const authority = createFirestoreAuthority(options), documents = createFirestoreFamilyDocumentStore(options);
    const summary = createFirestoreCareSummary(options, createFirestoreCareStore(options));
    const online = createFirestoreOnlineStore({ ...options, mutations: [summary.mutation] });
    await authority.initializeControl({ enabled: true, generation: randomUUID() });
    for (const userId of ['parent', 'other']) {
      const email = userId + '@example.test';
      await authority.issueInvitation({ email, operationId: randomUUID(), expiresAt: new Date(Date.now() + 3600000).toISOString() });
      await authority.admitIdentity({ userId, email, emailVerified: true });
      await authority.acknowledge({ userId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
    }
    const childId = (await authority.createChild({ userId: 'parent', operationId: randomUUID(), displayName: 'Original child' })).child.id;
    const otherChild = (await authority.createChild({ userId: 'other', operationId: randomUUID(), displayName: 'Other child' })).child.id;
    const original = (await documents.create('parent', childId, { kind: 'preparation', purpose: 'appointment',
      title: 'BACKUP_DOCUMENT_TITLE', eventDate: null, period: { from: '2026-10-01', to: '2026-10-31' } }, randomUUID()))!;
    assert.ok(original.current);
    const period = { startDay: '2026-10-30', period: 'day' as const, timeZone: 'Asia/Hong_Kong' };
    async function submit(path: string, payload: unknown) {
      return online.submit('parent', { path, payload, operation: {
        ...await online.context('parent', { path, payload }), opId: randomUUID(), deviceId: randomUUID() } });
    }
    async function savePreparation(question: string, appointmentTaskId: string | null = null) {
      const report = await summary.get('parent', childId, period);
      await submit(`/api/children/${childId}/visit-preparation`, { confirmShared: true,
        expectedVersion: report.preparation.version, basisVersion: report.basisVersion,
        questions: [question], checklist: [{ text: 'Bring original notes', done: true }], reviewed: true, appointmentTaskId, period });
      return (await summary.get('parent', childId, period)).preparation;
    }
    const originalPreparation = await savePreparation('BACKUP_PREPARATION_QUESTION');
    const exporter = createFirestoreAccountExport({ ...options, photos: { async content() { throw Error('Unexpected photo read'); } } });
    const stored = new Map<string, { body: Buffer; metadata: unknown }>();
    const objects = createFirebaseHandoverObjects({ config: { projectId: options.projectId, namespace: options.namespace, bucketName: 'synthetic-original-documents' }, files: cipher.files,
      bucket: { async metadata(name) { return stored.get(name)?.metadata ?? null; },
        createWrite(name, settings) { const parts: Buffer[] = []; return new Writable({
          write(chunk, _encoding, done) { parts.push(Buffer.from(chunk)); done(); },
          final(done) { const body = Buffer.concat(parts); stored.set(name, { body, metadata: { name, bucket: 'synthetic-original-documents',
            generation: '11111111111111111', size: String(body.length), metadata: settings.metadata?.metadata } }); done(); } }); },
        readPinned(name) { return Readable.from([stored.get(name)!.body]); }, async removePinned(name) { stored.delete(name); } } });
    const serverId = 'https://original-documents.example.test', keys = generateKeyPairSync('ed25519');
    const keyId = hash(keys.publicKey.export({ type: 'spki', format: 'der' }));
    const uploads = createHandoverUploadService({ ...options, objects, trustedKeys: new Map([[keyId, { key: keys.publicKey, serverId }]]) });
    const service = createHandoverImportService({ ...options, uploads,
      originalBackup: { serverId, async matchesIssuedBackup() { return false; } } });
    async function stage() {
      const archive = await writePersonalHandoverPackage({ exporter, directory, ownerUserId: 'parent', serverId,
        packageId: randomUUID(), createdAt: new Date().toISOString(), purpose: 'backup', signingKey: keys.privateKey,
        selection: { childIds: [childId], modules: ['documents'], period: null } });
      const bytes = await readFile(archive.path), uploadId = randomUUID();
      await uploads.create('parent', { opId: uploadId, filename: 'own-documents.zip', bytes: bytes.length, sha256: hash(bytes) });
      const uploaded = await uploads.receive('parent', uploadId, Readable.from([bytes]), stop.signal);
      assert.equal(uploaded.state, 'ready', uploaded.error ?? JSON.stringify(uploaded));
      assert.equal(uploaded.preview!.integrity, 'trusted');
      return { uploadId, expectedUploadVersion: uploaded.version, childId, module: 'documents', includeRestoreTarget: true };
    }
    type Delivery = Parameters<ReturnType<typeof createFirebaseWorkerServices>['background']['process']>[0];
    const deliveries: Delivery[] = [], codec = createFirestoreRestoreCodec(options);
    const runtime = { ...options, config: { ...options, taskWorkerEnabled: true }, authority, handoverImports: service,
      currentAuth: async () => ({ disabled: false, emailVerified: true, email: 'parent@example.test' }) };
    const worker = createFirebaseWorkerServices(runtime as unknown as Parameters<typeof createFirebaseWorkerServices>[0],
      { taskName: () => 'unused', enqueue: async () => { throw Error('Unexpected reminder'); }, probe: async () => { throw Error('Unexpected reminder'); } },
      { async enqueue(value) { deliveries.push(value); return { state: 'confirmed' }; }, async probe() { return { state: 'confirmed' }; } }, stop);
    async function run(id: string) {
      const work = [...fixture.records].filter(([path]) => path.includes('_background_work/'))
        .map(([path, data]) => codec.decode({ path, data }).value as { kind: string; resourceId: string; id: string })
        .find(row => row.kind === 'handover-import' && row.resourceId === id);
      assert.ok(work);
      for (let page = 0; page < 3 && !deliveries.some(row => row.id === work.id); page++) await worker.background.dispatch();
      const delivery = deliveries.find(row => row.id === work.id);
      assert.ok(delivery, 'The registered dispatcher must enqueue the original document restore');
      assert.equal((await worker.background.process(delivery)).state, 'completed');
      const done = await service.get('parent', id); assert.equal(done.state, 'completed', done.error ?? JSON.stringify(done));
      return done;
    }
    const request = await stage();
    const laterDocument = (await documents.change('parent', childId, original.id, { action: 'patch', expectedVersion: original.version,
      authorityVersion: (await documents.describe('parent', childId, original.id))!.authorityVersion, confirmShared: true,
      edits: [{ op: 'set_metadata', title: 'LATER_LOCAL_DOCUMENT_TITLE' }] }, randomUUID()))!;
    const laterPreparation = await savePreparation('LATER_LOCAL_PREPARATION_QUESTION');
    const beforeComparison = structuredClone([...fixture.records]);
    const page = await service.compareOriginal('parent', request, stop.signal);
    assert.deepEqual(page.items.map(item => Reflect.get(item, 'resourceSection')).sort(), ['documents', 'visit_preparation']);
    assert.equal(page.nextCursor, null);
    const documentItem = page.items.find(item => Reflect.get(item, 'resourceSection') === 'documents')!;
    const preparationItem = page.items.find(item => Reflect.get(item, 'resourceSection') === 'visit_preparation')!;
    assert.equal(documentItem.id, original.id); assert.equal(documentItem.targetId, original.id);
    assert.equal(preparationItem.id, childId); assert.equal(preparationItem.targetId, childId);
    assert.equal(documentItem.backupVersion, original.version); assert.equal(documentItem.localVersion, laterDocument.version);
    assert.equal(preparationItem.backupVersion, originalPreparation.version); assert.equal(preparationItem.localVersion, laterPreparation.version);
    assert.equal(documentItem.state, 'local_newer'); assert.equal(preparationItem.state, 'local_newer');
    assert.ok(!/BACKUP_|LATER_LOCAL_/u.test(JSON.stringify(page)), 'Comparison exposes states and identities without document or preparation bodies');
    assert.deepEqual([...fixture.records], beforeComparison, 'Comparison cannot write receipts, work, mappings or revisions');
    await assert.rejects(service.compareOriginal('other', request, stop.signal));
    const command = { opId: randomUUID(), uploadId: request.uploadId, expectedUploadVersion: request.expectedUploadVersion,
      acceptedManifestSha256: page.manifestSha256, restoreOriginal: true, resolutionOnly: true,
      targets: [{ sourceChildId: childId, target: { childId, spaceId: null }, sections: ['documents'] }],
      resolutions: page.items.map(item => ({ sourceChildId: childId, section: Reflect.get(item, 'resourceSection'), resourceId: item.id,
        resolution: { mode: 'replace_current', targetId: item.targetId, expectedVersion: item.localVersion } })) };
    await assert.rejects(service.create('parent', { ...command, opId: randomUUID(),
      targets: [{ ...command.targets[0], target: { childId: otherChild, spaceId: null } }] }, stop.signal), { code: 'invalid_input' });
    assert.equal((await service.create('parent', command, stop.signal)).state, 'queued');
    const done = await run(command.opId); assert.deepEqual(done.counts, { created: 0, updated: 2, skipped: 0, conflict: 0 });
    const restoredDocument = (await documents.get('parent', childId, original.id))!;
    const restoredPreparation = (await summary.get('parent', childId, period)).preparation;
    assert.equal(restoredDocument.id, original.id); assert.equal(restoredDocument.version, laterDocument.version + 1);
    assert.equal(restoredDocument.current!.title, original.current.title);
    assert.ok(restoredDocument.history.some(snapshot => snapshot.id === laterDocument.current!.id && snapshot.title === 'LATER_LOCAL_DOCUMENT_TITLE'));
    assert.equal(restoredPreparation.version, laterPreparation.version + 1);
    assert.deepEqual(restoredPreparation.questions, originalPreparation.questions);
    const history = await exporter.page('parent', { section: 'visit_preparation_history', childId });
    assert.ok(JSON.stringify(history.items).includes('LATER_LOCAL_PREPARATION_QUESTION'));
    assert.deepEqual(await service.create('parent', command, stop.signal), done);
    assert.equal((await documents.get('parent', childId, original.id))!.version, restoredDocument.version);
    assert.equal((await summary.get('parent', childId, period)).preparation.version, restoredPreparation.version);
    assert.deepEqual((await exporter.page('parent', { section: 'visit_preparation_history', childId })).items, history.items);
    const results = await service.results('parent', command.opId, { sourceChildId: childId, module: 'documents' });
    assert.deepEqual(results.items.map(item => item.resourceSection).sort(), ['documents', 'visit_preparation']);
    assert.ok(results.items.every(item => item.outcome === 'updated' && item.recordedResource?.id === (item.resourceSection === 'documents' ? original.id : childId)));

    const task = ((await submit(`/api/children/${childId}/tasks`, { confirm: true, values: { title: 'Appointment link',
      details: '', kind: 'appointment', assigneeUserId: 'parent', dueAt: '2026-10-30T09:00:00Z', timeZone: 'Asia/Hong_Kong' } })).result as { task: CareTask }).task;
    await savePreparation('SECRET_OLD_APPOINTMENT_QUESTION', task.id);
    const linkedRequest = await stage();
    const currentPreparation = await savePreparation('Current safe question', task.id);
    const linkedPage = await service.compareOriginal('parent', linkedRequest, stop.signal);
    const linked = linkedPage.items.find(item => Reflect.get(item, 'resourceSection') === 'visit_preparation')!;
    assert.ok(linked?.targetId); assert.ok(!JSON.stringify(linkedPage).includes('SECRET_OLD_APPOINTMENT_QUESTION'));
    const linkedCommand = { ...command, opId: randomUUID(), uploadId: linkedRequest.uploadId,
      expectedUploadVersion: linkedRequest.expectedUploadVersion, acceptedManifestSha256: linkedPage.manifestSha256,
      resolutions: [{ sourceChildId: childId, section: 'visit_preparation', resourceId: childId,
        resolution: { mode: 'replace_current', targetId: childId, expectedVersion: currentPreparation.version } }] };
    await service.create('parent', linkedCommand, stop.signal);
    await submit(`/api/children/${childId}/tasks/${task.id}/change`, { confirm: true, action: 'complete', expectedVersion: task.version, note: '' });
    const conflicted = await run(linkedCommand.opId);
    assert.deepEqual(conflicted.counts, { created: 0, updated: 0, skipped: 0, conflict: 1 });
    const current = (await summary.get('parent', childId, period)).preparation;
    assert.equal(current.version, currentPreparation.version); assert.deepEqual(current.questions, ['Current safe question']);
    const conflict = await service.results('parent', linkedCommand.opId, { sourceChildId: childId, module: 'documents' });
    assert.equal(conflict.items.length, 1); assert.equal(conflict.items[0].outcome, 'conflict');
    assert.ok(!JSON.stringify(conflict).includes('SECRET_OLD_APPOINTMENT_QUESTION'), 'A stale link cannot disclose the backup preparation in a result DTO');
  } finally { stop.abort(); await rm(directory, { recursive: true, force: true }); }
});
