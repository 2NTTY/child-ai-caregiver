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
import { writeHandoverArchive } from '../server/handover-archive.ts';
import { createFirestoreSharedInputStore, sharedInputImportSchema } from '../server/firestore-shared-inputs.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { HANDOVER_SECTIONS } from '../src/shared/handover.ts';
import { createFirestoreAccountExport } from '../server/firestore-account-export.ts';

test('private sources traverse the real import worker with retained history, conflicts and deletion visibility', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'handover-sources-'));
  const fixture = serialFirestoreFixture(), cipher = createStorageCipher(Buffer.alloc(32, 97));
  const options = { database: fixture.database, cipher, projectId: 'demo-sources-pipeline', namespace: 'unit_sources_pipeline' };
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
  const store = createFirestoreSharedInputStore(options);
  const source = await authority.runTransaction('source', sourceChild, async b => {
    const prepared = await store.prepareCreate(b, randomUUID(), { kind: 'personal_source', sourceLabel: 'Original material',
      sourceUrl: 'https://example.test/reference', sourceNotes: 'Original note', sourceDateText: null, text: 'Original paragraph' },
    { intention: 'Reference', purpose: 'answer_reference', nature: 'external_material', timeScope: 'long_reference',
      validityText: '', enabled: true, modelExcerpt: 'Original paragraph' }); prepared.commit(); return prepared.value;
  });
  const exporter = createFirestoreAccountExport({ ...options, photos: { async content() { throw Error('Unused photo port'); } } });
  const at = new Date().toISOString();
  async function exported(owner: string, child: string, section: 'private_sources' | 'private_source_history') {
    let page = await exporter.page(owner, { childId: child, section }); const items = [...page.items];
    while (page.nextCursor) { page = await exporter.page(owner, { childId: child, section, cursor: page.nextCursor, scopeVersion: page.scopeVersion }); items.push(...page.items); }
    return items;
  }
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
    const values = { private_sources: await exported('source', sourceChild, 'private_sources'),
      private_source_history: await exported('source', sourceChild, 'private_source_history') };
    assert.equal(values.private_source_history.length, 1);
    const scopeVersion = 'a'.repeat(64), pages = [{ section: 'children', childId: null, items: [{ id: sourceChild, displayName: 'Source' }] },
      ...[...HANDOVER_SECTIONS.sources].reverse().map(section => ({ section, childId: sourceChild, items: values[section] }))];
    async function* entries() { for (let i = 0; i < pages.length; i++) yield { path: `data/${i}.json`, mediaType: 'application/json',
      content: Buffer.from(JSON.stringify({ ...pages[i], scopeVersion })) }; yield { path: 'summary.md', mediaType: 'text/markdown', content: Buffer.from('Test') }; }
    const archive = await writeHandoverArchive({ directory, header: { format: 'yuyoufang-data', version: 1, packageId: randomUUID(), packageVersion: 1,
      createdAt: at, purpose: 'backup', source: { serverId: 'https://source.test', accountId: 'source' },
      selection: { childIds: [sourceChild], modules: ['sources'], period: null } }, entries: entries(),
      coverage: () => pages.map(page => ({ section: page.section, childId: page.childId, items: page.items.length, scopeVersion, complete: true as const })) });
    const bytes = await readFile(archive.path), uploadId = randomUUID();
    await uploads.create('recipient', { opId: uploadId, filename: 'sources.zip', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    const uploaded = await uploads.receive('recipient', uploadId, Readable.from([bytes]), controller.signal);
    const command = { opId: randomUUID(), uploadId, expectedUploadVersion: uploaded.version, acceptedManifestSha256: uploaded.preview!.manifestSha256,
      targets: [{ sourceChildId: sourceChild, target: { childId, spaceId: null }, sections: ['sources'] }], resolutions: [] };
    const started = await service.create('recipient', command, controller.signal); assert.equal(started.state, 'queued');
    const done = await run(command.opId); assert.equal(done.processedItems, 2); assert.equal(done.counts.created, 2);
    assert.deepEqual(await service.create('recipient', command, controller.signal), done, 'the original operation only returns its saved batch');
    const results = await service.results('recipient', command.opId, { sourceChildId: sourceChild, module: 'sources' });
    assert.equal(results.items.length, 2); assert.equal(results.complete, true);
    const item = results.items.find(row => !row.sourceSection)!; assert.equal(item.resourceSection, 'private_sources');
    const localId = item.recordedResource!.id, local = await createFirestoreSharedInputStore(options).get('recipient', childId, localId);
    assert.equal(local?.text, source.text); assert.equal(local?.management?.modelExcerpt, null); assert.notEqual(localId, source.id);
    const history = await service.history('recipient', { childId, module: 'private_sources', resourceId: localId });
    assert.equal(history.items.length, 1); assert.deepEqual(history.items[0].evidence.value, values.private_source_history[0]);
    assert.equal(history.items[0].evidence.source.current.source.resourceId, source.id);
    assert.equal(history.items[0].evidence.source.current.source.resourceVersion, source.version);
    const copies = (await exported('recipient', childId, 'private_sources')).map(row => sharedInputImportSchema.parse(row));
    assert.equal(copies[0].importedFrom!.current.source.resourceId, source.id);
    assert.ok((await exported('recipient', childId, 'private_source_history')).some((row: any) => row.format === 'yuyoufang-source-revision:1'));
    for (const [path, data] of fixture.records) if (path.includes('_handover_source_history/')) codec.decode({ path, data });
    await assert.rejects(service.history('other', { childId, module: 'private_sources', resourceId: localId }));
    await assert.rejects(service.create('recipient', { ...command, opId: randomUUID(), targets: [{ ...command.targets[0], target: { childId, spaceId: randomUUID() } }] }, controller.signal),
      { code: 'private_scope_unavailable' });
    const repeated = { ...command, opId: randomUUID() }; await service.create('recipient', repeated, controller.signal);
    assert.equal((await run(repeated.opId)).counts.skipped, 2);
    const edited = await store.manage('recipient', childId, localId, { expectedVersion: local!.version,
      management: { ...local!.management!, intention: 'Local change' }, content: null, reason: 'Local edit' }); assert.ok(edited);
    const changed = { ...command, opId: randomUUID() }; await service.create('recipient', changed, controller.signal);
    assert.equal((await run(changed.opId)).counts.conflict, 1);
    const conflict = (await service.results('recipient', changed.opId, { sourceChildId: sourceChild, module: 'sources' })).items.find(row => row.availableResolution)!;
    assert.equal(conflict.availableResolution, 'replace_current'); assert.equal(conflict.currentResource!.version, edited.version);
    const resolve = { ...command, opId: randomUUID(), resolutionOnly: true, resolutions: [{ sourceChildId: sourceChild, section: 'private_sources', resourceId: source.id,
      resolution: { mode: 'replace_current', targetId: localId, expectedVersion: edited.version } }] };
    await service.create('recipient', resolve, controller.signal); assert.equal((await run(resolve.opId)).counts.updated, 1);
    const updated = await store.get('recipient', childId, localId); assert.equal(updated?.version, edited.version + 1);
    await store.delete('recipient', childId, localId, updated!.version);
    assert.equal((await service.history('recipient', { childId, module: 'private_sources', resourceId: localId })).items.length, 0);
    assert.equal((await exported('recipient', childId, 'private_source_history')).length, 0);
    const deleted = { ...command, opId: randomUUID() }; await service.create('recipient', deleted, controller.signal);
    assert.equal((await run(deleted.opId)).counts.conflict, 2);
    const restoreResult = (await service.results('recipient', deleted.opId, { sourceChildId: sourceChild, module: 'sources' })).items.find(row => !row.sourceSection)!;
    assert.equal(restoreResult.availableResolution, 'restore_deleted'); assert.equal(restoreResult.currentResource!.version, updated!.version + 1);
    const restore = { ...resolve, opId: randomUUID(), resolutions: [{ ...resolve.resolutions[0], resolution: { mode: 'restore_deleted', targetId: localId, expectedVersion: updated!.version + 1 } }] };
    await service.create('recipient', restore, controller.signal); assert.equal((await run(restore.opId)).counts.created, 1);
    const restored = (await service.results('recipient', restore.opId, { sourceChildId: sourceChild, module: 'sources' })).items[0].recordedResource!;
    assert.notEqual(restored.id, localId);
    assert.equal((await authority.runTransaction('recipient', childId, b => store.readImportState(b, localId))).value, null);
  } finally { controller.abort(); await rm(directory, { recursive: true, force: true }); }
});
