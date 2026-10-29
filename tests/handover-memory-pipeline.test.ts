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
import { createFirestoreCareStore } from '../server/firestore-care.ts';
import { createFirestoreChatStore } from '../server/firestore-chat.ts';
import { createFirestoreMemoryStore } from '../server/firestore-memory.ts';
import { createFirestorePrivateInstructions } from '../server/firestore-private-instructions.ts';
import { createFirebaseHandoverObjects } from '../server/firebase-handover-objects.ts';
import { createHandoverUploadService } from '../server/handover-upload-service.ts';
import { createHandoverImportService } from '../server/handover-import-service.ts';
import { createFirebaseWorkerServices } from '../server/firebase-worker-services.ts';
import { createFirestoreRestoreCodec } from '../server/firestore-restore-codec.ts';
import { writeHandoverArchive } from '../server/handover-archive.ts';
import { FirestoreDomainData } from '../server/firestore-domain-data.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { HANDOVER_SECTIONS } from '../src/shared/handover.ts';
import { createFirestoreAccountExport } from '../server/firestore-account-export.ts';
import { createFirestoreContentErasure } from '../server/firestore-content-erasure.ts';
import { replayContentErasures } from '../server/firestore-restore-content-erasure.ts';
import { firebaseErasureIntentHash, type FirebaseErasureIntent } from '../server/firebase-erasure-journal.ts';

test('one memory module imports all current resources and source history without advancing local summary coverage', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'handover-memory-'));
  const fixture = serialFirestoreFixture(), cipher = createStorageCipher(Buffer.alloc(32, 97));
  const options = { database: fixture.database, cipher, projectId: 'demo-memory-pipeline', namespace: 'unit_memory_pipeline' };
  const authority = createFirestoreAuthority(options), codec = createFirestoreRestoreCodec(options);
  const care = createFirestoreCareStore(options), memory = createFirestoreMemoryStore({ ...options, care, chat: createFirestoreChatStore(options) });
  const notes = createFirestorePrivateInstructions(new FirestoreDomainData(options));
  await authority.initializeControl({ enabled: true, generation: randomUUID() });
  async function admit(userId: string) {
    const email = userId + '@example.test';
    await authority.issueInvitation({ email, operationId: randomUUID(), expiresAt: new Date(Date.now() + 3600000).toISOString() });
    await authority.admitIdentity({ userId, email, emailVerified: true });
    await authority.acknowledge({ userId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
    return (await authority.createChild({ userId, operationId: randomUUID(), displayName: userId })).child.id;
  }
  const sourceChild = await admit('source'), childId = await admit('recipient'); await admit('other');
  const original = await memory.createFact('source', sourceChild, { intendedVisibility: 'private', values: { key: 'rest', content: '先休息',
    validUntil: null, source: { kind: 'manual', description: '本人交代' } } });
  assert.ok(original);
  const topic = await memory.createTopic('source', sourceChild, { title: '原事情', note: '原交代', visibility: 'private', confirmShared: false });
  assert.ok(topic);
  const at = new Date().toISOString(), messageId = randomUUID();
  const note = { id: randomUUID(), childId: sourceChild, version: 1, title: '私人交代', text: '本地新帳戶不得因此自動授權',
    sourceMessageId: messageId, createdAt: at, updatedAt: at, provenance: 'user_statement', memoryKey: 'private-note' };
  const summary = { id: randomUUID(), childId: sourceChild, version: 1, text: '來源時段摘要', createdAt: at,
    previousId: null, coveredMessageIds: [messageId], lastCoveredMessageId: messageId };
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
    const values: Record<string, object[]> = { memory_facts: [original], memory_fact_history: [original], memory_topics: [topic],
      memory_topic_history: [topic], instructions: [note], summary_history: [summary] };
    const scopeVersion = 'a'.repeat(64), pages = [{ section: 'children', childId: null, items: [{ id: sourceChild, displayName: 'Source' }] },
      ...HANDOVER_SECTIONS.memory.map(section => ({ section, childId: sourceChild, items: values[section] }))];
    async function* entries() { for (let i = 0; i < pages.length; i++) yield { path: `data/${i}.json`, mediaType: 'application/json',
      content: Buffer.from(JSON.stringify({ ...pages[i], scopeVersion })) }; yield { path: 'summary.md', mediaType: 'text/markdown', content: Buffer.from('Test') }; }
    const archive = await writeHandoverArchive({ directory, header: { format: 'yuyoufang-data', version: 1, packageId: randomUUID(), packageVersion: 1,
      createdAt: at, purpose: 'backup', source: { serverId: 'https://source.test', accountId: 'source' },
      selection: { childIds: [sourceChild], modules: ['memory'], period: null } }, entries: entries(),
      coverage: () => pages.map(page => ({ section: page.section, childId: page.childId, items: page.items.length, scopeVersion, complete: true as const })) });
    const bytes = await readFile(archive.path), uploadId = randomUUID();
    await uploads.create('recipient', { opId: uploadId, filename: 'memory.zip', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    const uploaded = await uploads.receive('recipient', uploadId, Readable.from([bytes]), controller.signal);
    const command = { opId: randomUUID(), uploadId, expectedUploadVersion: uploaded.version,
      acceptedManifestSha256: uploaded.preview!.manifestSha256,
      targets: [{ sourceChildId: sourceChild, target: { childId, spaceId: null }, sections: ['memory'] }], resolutions: [] };
    const started = await service.create('recipient', command, controller.signal);
    assert.equal(started.state, 'queued', started.error ?? 'Memory import did not start');
    const done = await run(command.opId); assert.equal(done.processedItems, 6); assert.equal(done.counts.created, 6);
    const results = await service.results('recipient', command.opId, { sourceChildId: sourceChild, module: 'memory' });
    assert.equal(results.items.length, 6); assert.equal(results.complete, true);
    const resource = (section: string) => results.items.find(row => row.resourceSection === section && !row.sourceSection)!.recordedResource!;
    const fact = await memory.getFact('recipient', childId, resource('memory_facts').id);
    assert.equal(fact?.status, 'candidate'); assert.equal(fact?.applicable, false);
    const importedNote = await authority.runTransaction('recipient', childId, b => notes.read(b, resource('instructions').id));
    assert.equal(importedNote?.sourceMessageId, null); assert.equal(importedNote?.provenance, 'imported_source');
    const importedSummary = await authority.runTransaction('recipient', childId, b => memory.readImportedSummary(b, resource('summary_history').id));
    assert.equal(importedSummary?.coverageScope, 'imported_source'); assert.deepEqual(importedSummary?.coveredMessageIds, [messageId]);
    const activeSummary = await memory.summary('recipient', childId); assert.ok(activeSummary);
    assert.equal(activeSummary.summary, null);
    for (const [path, data] of fixture.records) if (path.includes('_conversation_summaries/')) {
      assert.equal((codec.decode({ path, data }).value as any).summary.coverageScope, 'imported_source');
    }
    const history = await service.history('recipient', { childId, module: 'memory_facts', resourceId: fact!.id });
    assert.equal(history.items[0].evidence.value.content, original.content);
    const summaryHistory = await service.history('recipient', { childId, module: 'summary_history', resourceId: importedSummary!.id });
    assert.equal(summaryHistory.items[0].evidence.value.text, summary.text);
    assert.equal(summaryHistory.items[0].evidence.source.current.source.resourceId, summary.id);
    const exporter = createFirestoreAccountExport({ ...options, photos: { content: async () => { throw new Error('Unexpected photo export'); } } });
    let exported = await exporter.page('recipient', { childId, section: 'memory_fact_history' });
    const exportedItems = [...exported.items];
    while (exported.nextCursor) { exported = await exporter.page('recipient', { childId, section: 'memory_fact_history', cursor: exported.nextCursor, scopeVersion: exported.scopeVersion }); exportedItems.push(...exported.items); }
    assert.ok(exportedItems.some((value: any) => value.format === 'yuyoufang-source-revision:1'), 'another export retains imported source revisions');
    await assert.rejects(service.results('other', command.opId, { sourceChildId: sourceChild, module: 'memory' }));
    const repeated = { ...command, opId: randomUUID() }; await service.create('recipient', repeated, controller.signal);
    assert.equal((await run(repeated.opId)).counts.skipped, 6);
    const confirmed = await memory.confirmFact('recipient', childId, fact!.id, { expectedVersion: fact!.version, confirm: true, confirmShared: false });
    assert.ok(confirmed);
    const changed = { ...command, opId: randomUUID() }; await service.create('recipient', changed, controller.signal);
    assert.equal((await run(changed.opId)).counts.conflict, 1);
    const conflict = (await service.results('recipient', changed.opId, { sourceChildId: sourceChild, module: 'memory' })).items.find(row => row.availableResolution === 'replace_current');
    assert.equal(conflict?.resourceSection, 'memory_facts');
    const resolved = { ...command, opId: randomUUID(), resolutionOnly: true, resolutions: [{ sourceChildId: sourceChild,
      section: conflict!.resourceSection!, resourceId: original.id, resolution: { mode: 'replace_current', targetId: confirmed.id, expectedVersion: confirmed.version } }] };
    await service.create('recipient', resolved, controller.signal);
    const resolvedResult = await run(resolved.opId); assert.equal(resolvedResult.processedItems, 1); assert.equal(resolvedResult.counts.updated, 1);
    const latest = await memory.getFact('recipient', childId, fact!.id); assert.equal(latest?.status, 'candidate');
    const snapshot = [...fixture.records].map(([path, data]) => codec.decode({ path, data }));
    await memory.delete('recipient', childId, 'facts', fact!.id, latest!.version);
    assert.equal((await service.history('recipient', { childId, module: 'memory_facts', resourceId: fact!.id })).items.length, 0);
    const journalEntries: FirebaseErasureIntent[] = [], journal = { async writeOnce(intent: FirebaseErasureIntent) { journalEntries.push(intent); return {
      objectName: 'erasures/v1/' + 'a'.repeat(64), generation: '1', cipherSha256: 'b'.repeat(64),
      intentSha256: firebaseErasureIntentHash(intent), bytes: 256, format: 'yuban-erasure-journal/v1' as const }; }, async read(intent: FirebaseErasureIntent) { return intent; } };
    const erasure = createFirestoreContentErasure({ ...options, journal });
    const path = [...fixture.records.keys()].find(key => key.includes('_content_erasures/'))!;
    const [collection, documentId] = path.split('/');
    for (let pass = 0; pass < 4; pass++) await erasure.advance(await fixture.database.collection(collection).doc(documentId).get());
    const remaining = [...fixture.records].filter(([path]) => path.includes('_handover_source_history/'));
    assert.equal(remaining.length, 2, 'only the topic and summary source evidence remain');
    const live = [...fixture.records].map(([path, data]) => codec.decode({ path, data }));
    const removed = replayContentErasures(new FirestoreDomainData(options), codec, snapshot, live, journalEntries, fixture.records);
    assert.ok(snapshot.some(row => row.context.kind === 'handover-source-history' && removed.has(row.path)), 'restore removes the erased fact source revision');
    const link = importedSummary!.importedFrom!.current;
    const newerSummary = await authority.runTransaction('recipient', childId, async binding => {
      const prepared = await memory.prepareImportedSummary(binding, randomUUID(), { section: 'summary_history', childId: sourceChild,
        value: { ...summary, version: 2, text: '來源時段摘要修訂' }, source: { serverId: link.source.serverId,
          accountId: link.source.accountId, packageId: link.packageId, packageVersion: link.packageVersion,
          manifestSha256: link.manifestSha256, path: 'data/summary.json', rowIndex: 0 } }, link.integrity,
      { id: importedSummary!.id, expectedVersion: importedSummary!.version });
      prepared.commit(); return prepared.value;
    });
    assert.notEqual(newerSummary.id, importedSummary!.id);
    assert.equal(newerSummary.previousId, importedSummary!.id);
    assert.equal(newerSummary.version, 2);
    assert.equal((await authority.runTransaction('recipient', childId, b => memory.readImportedSummary(b, importedSummary!.id)))?.text, summary.text);
    assert.equal((await memory.summary('recipient', childId))?.summary, null, 'updating imported history still does not create a local summary head');
  } finally { controller.abort(); await rm(directory, { recursive: true, force: true }); }
});
