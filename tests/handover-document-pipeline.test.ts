import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirebaseHandoverObjects } from '../server/firebase-handover-objects.ts';
import { createHandoverUploadService } from '../server/handover-upload-service.ts';
import { createHandoverImportService } from '../server/handover-import-service.ts';
import { createFirebaseWorkerServices } from '../server/firebase-worker-services.ts';
import { createFirestoreRestoreCodec } from '../server/firestore-restore-codec.ts';
import { assertFirestoreRestoreContent } from '../server/firestore-restore-content.ts';
import { writePersonalHandoverPackage } from '../server/handover-export.ts';
import { createFirestoreFamilyDocumentStore } from '../server/firestore-family-documents.ts';
import { createFirestoreCareStore } from '../server/firestore-care.ts';
import { createFirestoreCareSummary } from '../server/firestore-care-summary.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirestoreAccountExport } from '../server/firestore-account-export.ts';
import { parseHistoryRow } from '../server/handover-source-history.ts';
import { createFirestoreHandoverImportItems } from '../server/firestore-handover-import-items.ts';
import { createFirestoreSharingStore } from '../server/firestore-sharing.ts';
import { handleFamilyDocumentRequest } from '../server/family-document-api.ts';
import { createFamilyDocumentsApi, parseFamilyDocumentSnapshot } from '../src/client/family-documents-api.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';

test('documents and visit preparation traverse the original package worker with full source history and receipts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'handover-documents-'));
  const fixture = serialFirestoreFixture(), cipher = createStorageCipher(Buffer.alloc(32, 98));
  const options = { database: fixture.database, cipher, projectId: 'demo-documents-pipeline', namespace: 'unit_documents_pipeline' };
  const authority = createFirestoreAuthority(options), codec = createFirestoreRestoreCodec(options);
  await authority.initializeControl({ enabled: true, generation: randomUUID() });
  async function admit(userId: string) {
    const email = userId + '@example.test';
    await authority.issueInvitation({ email, operationId: randomUUID(), expiresAt: new Date(Date.now() + 3600000).toISOString() });
    await authority.admitIdentity({ userId, email, emailVerified: true });
    await authority.acknowledge({ userId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
    return (await authority.createChild({ userId, operationId: randomUUID(), displayName: userId })).child.id;
  }
  const sourceChild = await admit('source'), childId = await admit('recipient'); await admit('other');
  const documents = createFirestoreFamilyDocumentStore(options), summary = createFirestoreCareSummary(options, createFirestoreCareStore(options));
  const online = createFirestoreOnlineStore({ ...options, mutations: [summary.mutation] });
  let original = (await documents.create('source', sourceChild, { kind: 'preparation', purpose: 'appointment', title: 'Original document',
    eventDate: null, period: { from: '2026-10-01', to: '2026-10-31' } }, randomUUID()))!;
  original = (await documents.change('source', sourceChild, original.id, { action: 'patch', expectedVersion: original.version,
    authorityVersion: (await documents.describe('source', sourceChild, original.id))!.authorityVersion, confirmShared: true,
    edits: [{ op: 'set_metadata', summary: 'Updated source document' }] }, randomUUID()))!;
  const period = { startDay: '2026-10-30', period: 'day' as const, timeZone: 'Asia/Hong_Kong' };
  for (const question of ['Original question', 'Updated question']) {
    const report = await summary.get('source', sourceChild, period), path = `/api/children/${sourceChild}/visit-preparation`;
    const payload = { confirmShared: true, expectedVersion: report.preparation.version, basisVersion: report.basisVersion,
      questions: [question], checklist: [{ text: 'Notes', done: true }], reviewed: true, appointmentTaskId: null, period };
    await online.submit('source', { path, payload, operation: { ...await online.context('source', { path, payload }), opId: randomUUID(), deviceId: randomUUID() } });
  }
  const exporter = createFirestoreAccountExport({ ...options, photos: { async content() { throw new Error('Unexpected photo read'); } } });
  const stored = new Map<string, { body: Buffer; metadata: any }>();
  const objects = createFirebaseHandoverObjects({ config: { projectId: options.projectId, namespace: options.namespace, bucketName: 'synthetic-import' }, files: cipher.files,
    bucket: { async metadata(name) { return stored.get(name)?.metadata ?? null; },
      createWrite(name, config) { const parts: Buffer[] = []; return new Writable({ write(chunk, _encoding, done) { parts.push(Buffer.from(chunk)); done(); },
        final(done) { const body = Buffer.concat(parts); stored.set(name, { body, metadata: { name, bucket: 'synthetic-import', generation: '11111111111111111',
          size: String(body.length), metadata: config.metadata?.metadata } }); done(); } }); },
      readPinned(name) { return Readable.from([stored.get(name)!.body]); }, async removePinned(name) { stored.delete(name); },
    } });
  const uploads = createHandoverUploadService({ ...options, objects }), service = createHandoverImportService({ ...options, uploads });
  const deliveries: any[] = [], controller = new AbortController();
  const worker = createFirebaseWorkerServices({ ...options, config: { ...options, taskWorkerEnabled: true }, authority, handoverImports: service,
    currentAuth: async () => ({ disabled: false, emailVerified: true, email: 'recipient@example.test' }) } as any,
    { taskName: () => 'unused', enqueue: async () => { throw new Error('Unexpected reminder'); }, probe: async () => { throw new Error('Unexpected reminder'); } },
    { async enqueue(value) { deliveries.push(value); return { state: 'confirmed' }; }, async probe() { return { state: 'confirmed' }; } }, controller);
  async function run(id: string) {
    await worker.background.dispatch();
    const delivery = deliveries.splice(0).find(value => {
      const row = [...fixture.records].find(([path, data]) => path.includes('_background_work/') && data.id === value.id);
      return row && (codec.decode({ path: row[0], data: row[1] }).value as any).resourceId === id;
    });
    assert.ok(delivery); await worker.background.process(delivery);
    const result = await service.get('recipient', id); assert.equal(result.state, 'completed', result.error ?? JSON.stringify(result));
    return result;
  }
  try {
    const archive = await writePersonalHandoverPackage({ exporter, directory, ownerUserId: 'source', serverId: 'https://source.test',
      packageId: randomUUID(), createdAt: new Date().toISOString(), purpose: 'backup', selection: { childIds: [sourceChild], modules: ['documents'], period: null } });
    const bytes = await readFile(archive.path), uploadId = randomUUID();
    await uploads.create('recipient', { opId: uploadId, filename: 'documents.zip', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    const uploaded = await uploads.receive('recipient', uploadId, Readable.from([bytes]), controller.signal);
    const command = { opId: randomUUID(), uploadId, expectedUploadVersion: uploaded.version, acceptedManifestSha256: uploaded.preview!.manifestSha256,
      targets: [{ sourceChildId: sourceChild, target: { childId, spaceId: null }, sections: ['documents'] }], resolutions: [] };
    assert.equal((await service.create('recipient', command, controller.signal)).state, 'queued');
    const done = await run(command.opId); assert.equal(done.processedItems, 8); assert.equal(done.counts.created, 6); assert.equal(done.counts.skipped, 2);
    assert.deepEqual(await service.create('recipient', command, controller.signal), done);
    const results = await service.results('recipient', command.opId, { sourceChildId: sourceChild, module: 'documents' });
    assert.equal(results.items.length, 8); assert.equal(results.complete, true);
    const localId = results.items.find(item => !item.sourceSection && item.resourceSection === 'documents')!.recordedResource!.id;
    const document = (await documents.get('recipient', childId, localId))!;
    assert.equal(document.version, 1); assert.equal(document.current!.summary, original.current!.summary);
    assert.notEqual(localId, original.id); assert.equal((await documents.listSourceVersions('recipient', childId, localId))!.items.length, 2);
    const preparation = (await summary.get('recipient', childId, period)).preparation;
    assert.deepEqual(preparation.questions, ['Updated question']); assert.equal(preparation.version, 1); assert.equal(preparation.reviewed, false);
    const history = await service.history('recipient', { childId, module: 'visit_preparation', resourceId: childId });
    assert.equal(history.items.length, 2); assert.equal(history.items[0].evidence.source.current.source.childId, sourceChild);
    const documentHistory = await service.history('recipient', { childId, module: 'documents', resourceId: localId });
    assert.equal(documentHistory.items.length, 2);
    const sourceSnapshot = documentHistory.items[0].evidence.value;
    const documentApi = createFamilyDocumentsApi('http://localhost', (async (url, init) => handleFamilyDocumentRequest(
      new Request(url, init), 'recipient', documents, async () => true)) as typeof fetch);
    const content = await documentApi.readContent(childId, localId, { snapshotId: sourceSnapshot.snapshotId as string,
      snapshotVersion: sourceSnapshot.snapshotVersion as number, offset: 0 }, controller.signal, 'recipient');
    assert.equal(content.invalidated, false); assert.equal(content.complete, true);
    assert.equal(parseFamilyDocumentSnapshot(JSON.parse(content.text), content.snapshotId, content.snapshotVersion).title, 'Original document');
    await assert.rejects(service.history('other', { childId, module: 'documents', resourceId: localId }));
    const repeated = { ...command, opId: randomUUID() }; await service.create('recipient', repeated, controller.signal);
    assert.equal((await run(repeated.opId)).counts.skipped, 8);
    const edited = (await documents.change('recipient', childId, localId, { action: 'patch', expectedVersion: 1,
      authorityVersion: (await documents.describe('recipient', childId, localId))!.authorityVersion, confirmShared: true,
      edits: [{ op: 'set_metadata', summary: 'Recipient edit' }] }, randomUUID()))!;
    const changed = { ...command, opId: randomUUID() }; await service.create('recipient', changed, controller.signal);
    assert.equal((await run(changed.opId)).counts.conflict, 1);
    const conflict = (await service.results('recipient', changed.opId, { sourceChildId: sourceChild, module: 'documents' })).items.find(item => item.availableResolution)!;
    assert.equal(conflict.availableResolution, 'replace_current'); assert.equal(conflict.currentResource!.version, edited.version);
    const resolve = { ...command, opId: randomUUID(), resolutionOnly: true, resolutions: [{ sourceChildId: sourceChild, section: 'documents', resourceId: original.id,
      resolution: { mode: 'replace_current', targetId: localId, expectedVersion: edited.version } }] };
    await service.create('recipient', resolve, controller.signal); assert.equal((await run(resolve.opId)).counts.updated, 1);
    assert.equal((await documents.get('recipient', childId, localId))!.current!.summary, original.current!.summary);
    const preparationRevisions: any[] = [];
    let cursor: string | undefined, scopeVersion: string | undefined;
    do {
      const page = await exporter.page('recipient', { section: 'visit_preparation_history', childId, ...(cursor ? { cursor, scopeVersion } : {}) });
      preparationRevisions.push(...page.items); cursor = page.nextCursor ?? undefined; scopeVersion = page.scopeVersion;
    } while (cursor);
    const importedRevisions = preparationRevisions.filter(item => item.format === 'yuyoufang-source-revision:1');
    assert.equal(importedRevisions.length, 2);
    assert.deepEqual(importedRevisions.map(item => item.evidence.value.questions[0]).sort(), ['Original question', 'Updated question']);
    const nextHop = parseHistoryRow({ section: 'visit_preparation_history', childId, value: importedRevisions[0],
      source: { serverId: 'https://recipient.test', accountId: 'recipient', packageId: randomUUID(), packageVersion: 1,
        manifestSha256: 'a'.repeat(64), path: 'data/preparation-history.json', rowIndex: 0 } },
      'visit_preparation', 'missing_proof', 'other');
    assert.equal(nextHop.parentId, childId);
    assert.deepEqual(nextHop.evidence, importedRevisions[0].evidence);
    const taskPath = `/api/children/${sourceChild}/tasks`, taskPayload = { confirm: true,
      values: { title: 'Source appointment', details: '', kind: 'appointment', assigneeUserId: 'source',
        dueAt: '2026-11-01T09:00:00Z', timeZone: 'Asia/Hong_Kong' } };
    const sourceTask = ((await online.submit('source', { path: taskPath, payload: taskPayload, operation: {
      ...await online.context('source', { path: taskPath, payload: taskPayload }), opId: randomUUID(), deviceId: randomUUID() } })).result as any).task;
    const items = createFirestoreHandoverImportItems(options), source = { serverId: 'https://source.test', accountId: 'source',
      packageId: randomUUID(), packageVersion: 1, manifestSha256: 'b'.repeat(64), path: 'data/import.json', rowIndex: 0 };
    const itemCommand = { opId: randomUUID(), batchId: randomUUID(), target: { childId, spaceId: null as string | null },
      row: { section: 'tasks', childId: sourceChild, value: sourceTask, source }, integrity: 'missing_proof' as const, resolution: { mode: 'preserve' as const } };
    const mappedTask = await items.apply('recipient', itemCommand);
    const sharing = createFirestoreSharingStore(options), family = await sharing.create('recipient', { operationId: randomUUID(), name: 'Documents only', kind: 'family' });
    await sharing.share('recipient', { operationId: randomUUID(), spaceId: family.id, expectedVersion: family.version, childId, modules: ['documents'] });
    const sourcePreparation = (await authority.runTransaction('source', sourceChild, b => summary.readImportState(b))).value!;
    const preparationRow = { section: 'visit_preparation', childId: sourceChild, source,
      value: { ...sourcePreparation, version: 3, appointmentTaskId: sourceTask.id } };
    await items.apply('recipient', { ...itemCommand, opId: randomUUID(), target: { childId, spaceId: family.id }, row: preparationRow });
    assert.equal((await summary.get('recipient', childId, period)).preparation.appointmentTaskId, null, 'document-only sharing cannot read or link tasks');
    await items.apply('recipient', { ...itemCommand, opId: randomUUID(), row: { ...preparationRow, value: { ...preparationRow.value, version: 4 } } });
    assert.equal((await summary.get('recipient', childId, period)).preparation.appointmentTaskId, mappedTask.resource!.id);
    assert.doesNotThrow(() => assertFirestoreRestoreContent([...fixture.records].map(([path, data]) => codec.decode({ path, data }))));
  } finally { controller.abort(); await rm(directory, { recursive: true, force: true }); }
});
