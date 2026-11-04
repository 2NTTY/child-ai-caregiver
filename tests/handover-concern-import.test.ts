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
import { createFirestoreConcernStore } from '../server/firestore-concerns.ts';
import { createFirestoreAccountExport } from '../server/firestore-account-export.ts';
import { createFirebaseHandoverObjects } from '../server/firebase-handover-objects.ts';
import { createHandoverUploadService } from '../server/handover-upload-service.ts';
import { createHandoverImportService } from '../server/handover-import-service.ts';
import { createFirebaseWorkerServices } from '../server/firebase-worker-services.ts';
import { createFirestoreRestoreCodec } from '../server/firestore-restore-codec.ts';
import { openHandoverArchive, writeHandoverArchive } from '../server/handover-archive.ts';
import { writePersonalHandoverPackage } from '../server/handover-export.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { HANDOVER_SECTIONS, type HandoverHeader } from '../src/shared/handover.ts';
import { emptyCareDetails } from '../src/shared/care.ts';

test('concern packages import after linked resources and retain source history through export and another handover', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'handover-concern-import-')), controller = new AbortController();
  try {
    const fixture = serialFirestoreFixture(), cipher = createStorageCipher(Buffer.alloc(32, 101));
    const options = { database: fixture.database, cipher, projectId: 'demo-concern-import', namespace: 'unit_concern_import' };
    const authority = createFirestoreAuthority(options), care = createFirestoreCareStore(options), concerns = createFirestoreConcernStore(options);
    const codec = createFirestoreRestoreCodec(options);
    await authority.initializeControl({ enabled: true, generation: randomUUID() });
    async function admit(userId: string) {
      const email = userId + '@example.test';
      await authority.issueInvitation({ email, operationId: randomUUID(), expiresAt: new Date(Date.now() + 3600000).toISOString() });
      await authority.admitIdentity({ userId, email, emailVerified: true });
      await authority.acknowledge({ userId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
      return (await authority.createChild({ userId, operationId: randomUUID(), displayName: userId })).child.id;
    }
    const sourceChild = await admit('source'), childId = await admit('recipient');
    const copiedChild = (await authority.createChild({ userId: 'recipient', operationId: randomUUID(), displayName: 'Onward child' })).child.id;
    const sourceRecord = await care.create('source', sourceChild, { text: 'Original linked observation', details: emptyCareDetails(), source: 'Source parent' }); assert.ok(sourceRecord);
    const at = new Date().toISOString(), concernId = randomUUID(), taskId = randomUUID(), foreignRun = randomUUID(), foreignAttention = randomUUID();
    const task = { id: taskId, childId: sourceChild, version: 1, title: 'Completed source task', details: '', kind: 'ordinary', assigneeUserId: 'source',
      createdBy: 'source', createdAt: at, updatedAt: at, occurrence: { id: randomUUID(), dueAt: at, timeZone: 'Asia/Hong_Kong', state: 'completed', terminalBasisVersion: null } };
    const sourceFollowUp = { id: randomUUID(), at: new Date(Date.now() + 3600000).toISOString(), state: 'completed', runId: foreignRun };
    const head = (version: number) => ({ id: concernId, childId: sourceChild, version, title: 'Source concern', reason: `Source context ${version}`,
      status: 'following', createdAt: at, updatedAt: at, archivedAt: null, attentionIds: [foreignAttention], eventCount: version, followUp: sourceFollowUp });
    const events = Array.from({ length: 4 }, (_, index) => ({ id: randomUUID(), concernId, childId: sourceChild, sequence: index + 1, at,
      kind: 'observation', title: 'Source observation', text: `Source event ${index + 1}`, sourceLabel: 'Source history', actorUserId: 'source',
      recordId: sourceRecord.id, taskId, attentionId: foreignAttention, attentionVersion: 2, runId: foreignRun }));
    const modules: HandoverHeader['selection']['modules'] = ['care', 'tasks', 'concerns'], scopeVersion = 'a'.repeat(64);
    async function sourcePackage(version: number) {
      const values: Record<string, object[]> = { concerns: [head(version)], concern_history: [
        { ...head(1), followUp: { ...sourceFollowUp, state: 'pending', runId: null } }, ...(version > 2 ? [head(2)] : [])],
        concern_events: events.slice(0, version), care: [sourceRecord!], care_history: [], tasks: [task], task_history: [] };
      // Archive order deliberately puts concerns before both linked current resources.
      const pages = [{ section: 'children', childId: null as string | null, items: [{ id: sourceChild, displayName: 'Source' }] },
        ...[...HANDOVER_SECTIONS.concerns, ...HANDOVER_SECTIONS.tasks, ...HANDOVER_SECTIONS.care].map(section => ({ section, childId: sourceChild, items: values[section] }))];
      async function* entries() {
        for (const [index, page] of pages.entries()) yield { path: `data/${index}.json`, mediaType: 'application/json', content: Buffer.from(JSON.stringify({ ...page, scopeVersion })) };
        yield { path: 'summary.md', mediaType: 'text/markdown', content: Buffer.from('Synthetic concern package') };
      }
      return writeHandoverArchive({ directory, header: { format: 'yuyoufang-data', version: 1, packageId: randomUUID(), packageVersion: 1, createdAt: at,
        purpose: 'handover', source: { serverId: 'https://source.test', accountId: 'source' }, selection: { childIds: [sourceChild], modules, period: null } },
        entries: entries(), coverage: () => pages.map(page => ({ section: page.section, childId: page.childId, items: page.items.length, scopeVersion, complete: true as const })) });
    }
    const stored = new Map<string, { body: Buffer; metadata: any }>();
    const objects = createFirebaseHandoverObjects({ config: { projectId: options.projectId, namespace: options.namespace, bucketName: 'synthetic-concern-packages' }, files: cipher.files,
      bucket: { async metadata(name) { return stored.get(name)?.metadata ?? null; },
        createWrite(name, settings) { const chunks: Buffer[] = []; return new Writable({ write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); },
          final(done) { const body = Buffer.concat(chunks); stored.set(name, { body, metadata: { name, bucket: 'synthetic-concern-packages', generation: '11111111111111111',
            size: String(body.length), metadata: settings.metadata?.metadata } }); done(); } }); },
        readPinned(name) { return Readable.from([stored.get(name)!.body]); }, async removePinned(name) { stored.delete(name); } } });
    const uploads = createHandoverUploadService({ ...options, objects }), service = createHandoverImportService({ ...options, uploads });
    const deliveries: any[] = []; let lastDelivery: any;
    const worker = createFirebaseWorkerServices({ ...options, config: { ...options, taskWorkerEnabled: true }, authority, handoverImports: service,
      currentAuth: async () => ({ disabled: false, emailVerified: true, email: 'recipient@example.test' }) } as any,
      { taskName: () => 'unused', enqueue: async () => { throw Error('Unexpected notification'); }, probe: async () => { throw Error('Unexpected notification'); } },
      { async enqueue(value) { deliveries.push(value); return { state: 'confirmed' }; }, async probe() { return { state: 'confirmed' }; } }, controller);
    async function stage(path: string, source: string, destination = childId) {
      const bytes = await readFile(path), uploadId = randomUUID();
      await uploads.create('recipient', { opId: uploadId, filename: 'concerns.zip', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
      const uploaded = await uploads.receive('recipient', uploadId, Readable.from([bytes]), controller.signal);
      assert.equal(uploaded.preview!.integrity, 'missing_proof');
      return { opId: randomUUID(), uploadId, expectedUploadVersion: uploaded.version, acceptedManifestSha256: uploaded.preview!.manifestSha256,
        targets: [{ sourceChildId: source, target: { childId: destination, spaceId: null }, sections: modules }], resolutions: [] };
    }
    async function run(command: Awaited<ReturnType<typeof stage>>) {
      const queued = await service.create('recipient', command, controller.signal); assert.equal(queued.state, 'queued', queued.error ?? JSON.stringify(queued));
      await worker.background.dispatch();
      const delivery = deliveries.splice(0).find(value => { const row = [...fixture.records].find(([path, metadata]) => path.includes('_background_work/') && metadata.id === value.id);
        return row && (codec.decode({ path: row[0], data: row[1] }).value as any).resourceId === command.opId; });
      assert.ok(delivery); lastDelivery = delivery; await worker.background.process(delivery);
      const result = await service.get('recipient', command.opId); assert.equal(result.state, 'completed', result.error ?? JSON.stringify(result)); return result;
    }
    const firstCommand = await stage((await sourcePackage(2)).path, sourceChild), first = await run(firstCommand);
    assert.equal(first.processedItems, 6); assert.equal(first.counts.created, 6);
    const results = await service.results('recipient', firstCommand.opId, { sourceChildId: sourceChild, module: 'concerns' });
    assert.equal(results.complete, true); assert.equal(results.items.length, 4);
    const local = results.items.find(item => item.sourceSection === null)!.recordedResource!;
    const localCare = (await service.results('recipient', firstCommand.opId, { sourceChildId: sourceChild, module: 'care' })).items[0].recordedResource!;
    const localTask = (await service.results('recipient', firstCommand.opId, { sourceChildId: sourceChild, module: 'tasks' })).items[0].recordedResource!;
    const current = await concerns.get('recipient', childId, local.id); assert.ok(current); assert.notEqual(current.id, concernId);
    assert.deepEqual(current.events.map(event => event.text), ['Source event 1', 'Source event 2']);
    for (const event of current.events) { assert.equal(event.recordId, localCare.id); assert.equal(event.taskId, localTask.id);
      assert.equal(event.actorUserId, 'source'); assert.match(event.sourceLabel, /匯入/); assert.equal(event.runId, undefined); assert.equal(event.attentionId, undefined); }
    assert.equal(current.followUp!.state, 'completed'); assert.equal(current.followUp!.runId, null);
    const concernWork = () => [...fixture.records].filter(([path]) => path.includes('_background_work/')).map(([path, value]) => codec.decode({ path, data: value }).value as any).filter(value => value.kind === 'concern');
    assert.equal(concernWork().length, 0, 'source current and historical follow-ups cannot replay old work');
    const history = await service.history('recipient', { childId, module: 'concerns', resourceId: local.id });
    assert.equal(history.items.length, 3); assert.ok(history.items.some(item => item.evidence.source.current.source.section === 'concern_events'));
    assert.ok(history.items.some(item => item.evidence.value.eventCount === 1));
    await worker.background.process(lastDelivery);
    assert.deepEqual(await service.history('recipient', { childId, module: 'concerns', resourceId: local.id }), history, 'redelivering the original worker cannot replay source history');
    assert.deepEqual(await service.create('recipient', firstCommand, controller.signal), first);
    const repeat = await run({ ...firstCommand, opId: randomUUID() }); assert.equal(repeat.counts.skipped, 6); assert.equal(concernWork().length, 0);
    await assert.rejects(service.history('source', { childId, module: 'concerns', resourceId: local.id }));
    const exporter = createFirestoreAccountExport({ ...options, photos: { async content() { throw Error('Unexpected photo'); } } });
    async function exported(section: string) {
      const rows: any[] = []; let cursor: string | undefined, basis: string | undefined;
      do { const page = await exporter.page('recipient', { section, childId, ...(cursor ? { cursor, scopeVersion: basis } : {}) });
        rows.push(...page.items); cursor = page.nextCursor ?? undefined; basis = page.scopeVersion; } while (cursor); return rows;
    }
    const historyExport = [...await exported('concern_history'), ...await exported('concern_events')].filter(row => row.format === 'yuyoufang-source-revision:1');
    assert.equal(historyExport.length, 3);
    const onward = await writePersonalHandoverPackage({ directory, exporter, ownerUserId: 'recipient', serverId: 'https://recipient.test', packageId: randomUUID(),
      createdAt: at, purpose: 'handover', selection: { childIds: [childId], modules, period: null } });
    const copiedCommand = await stage(onward.path, childId, copiedChild); await run(copiedCommand);
    const copiedResult = await service.results('recipient', copiedCommand.opId, { sourceChildId: childId, module: 'concerns' });
    const copiedId = copiedResult.items.find(item => item.sourceSection === null)!.recordedResource!.id;
    const copied = await concerns.get('recipient', copiedChild, copiedId); assert.ok(copied); assert.deepEqual(copied.events.map(event => event.text), current.events.map(event => event.text));
    const copiedHistory = await service.history('recipient', { childId: copiedChild, module: 'concerns', resourceId: copiedId });
    for (const original of historyExport) assert.ok(copiedHistory.items.some(item => JSON.stringify(item.evidence) === JSON.stringify(original.evidence)), 'onward export retains the original source evidence');
    assert.equal(concernWork().length, 0);
    const updatedCommand = await stage((await sourcePackage(3)).path, sourceChild); await run(updatedCommand);
    const updated = await concerns.get('recipient', childId, local.id); assert.ok(updated); assert.equal(updated.version, 2); assert.equal(updated.events.length, 3);
    const authorityVersion = (await concerns.list('recipient', childId)).authorityVersion;
    const changed = await concerns.change('recipient', childId, local.id, { action: 'append', expectedVersion: 2, authorityVersion,
      text: 'Recipient local observation', observedAt: at, links: { recordId: null, taskId: null, attentionId: null } }, randomUUID());
    const conflictingCommand = await stage((await sourcePackage(4)).path, sourceChild); const conflicted = await run(conflictingCommand);
    assert.ok(conflicted.counts.conflict > 0);
    const conflict = (await service.results('recipient', conflictingCommand.opId, { sourceChildId: sourceChild, module: 'concerns' })).items.find(item => item.sourceSection === null);
    assert.equal(conflict!.reason, 'target_changed'); assert.equal(conflict!.currentResource!.version, changed.version);
    assert.equal((await concerns.get('recipient', childId, local.id))!.events.at(-1)!.text, 'Recipient local observation'); assert.equal(concernWork().length, 0);
  } finally { controller.abort(); await rm(directory, { recursive: true, force: true }); }
});

test('a concern week copies only selected events and cannot replace a full chain or another week', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'handover-concern-week-')), controller = new AbortController();
  try {
    const fixture = serialFirestoreFixture(), cipher = createStorageCipher(Buffer.alloc(32, 102));
    const options = { database: fixture.database, cipher, projectId: 'demo-concern-week', namespace: 'unit_concern_week' };
    const authority = createFirestoreAuthority(options), concerns = createFirestoreConcernStore(options), codec = createFirestoreRestoreCodec(options);
    await authority.initializeControl({ enabled: true, generation: randomUUID() });
    async function admit(userId: string) {
      const email = userId + '@example.test';
      await authority.issueInvitation({ email, operationId: randomUUID(), expiresAt: new Date(Date.now() + 3600000).toISOString() });
      await authority.admitIdentity({ userId, email, emailVerified: true });
      await authority.acknowledge({ userId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
      return (await authority.createChild({ userId, operationId: randomUUID(), displayName: userId })).child.id;
    }
    const sourceChild = await admit('source'), childId = await admit('recipient');
    const week = { from: '2026-11-01T00:00:00+08:00', to: '2026-11-07T23:59:59.999+08:00' };
    const otherWeek = { from: '2026-12-01T00:00:00+08:00', to: '2026-12-07T23:59:59.999+08:00' };
    const links = { recordId: null, taskId: null, attentionId: null };
    let source = await concerns.create('source', sourceChild, { title: 'Cross-month concern', reason: 'SECRET_PARENT_REASON',
      observation: 'SECRET_BEFORE_WEEK', observedAt: '2026-10-31T23:59:59.999+08:00', links,
      followUpAt: new Date(Date.now() + 86400000).toISOString() }, randomUUID());
    for (const [at, text] of [[week.from, 'First selected observation'], ['2026-11-04T12:00:00+08:00', 'Middle selected observation'],
      [week.to, 'Last selected observation'], ['2026-11-08T00:00:00+08:00', 'SECRET_AFTER_WEEK'],
      [otherWeek.from, 'Other week observation']] as const) {
      source = await concerns.change('source', sourceChild, source.id, { action: 'append', expectedVersion: source.version,
        authorityVersion: (await concerns.list('source', sourceChild)).authorityVersion, observedAt: at, text, links }, randomUUID());
    }
    const exporter = createFirestoreAccountExport({ ...options, photos: { async content() { throw Error('Unexpected photo'); } } });
    const stored = new Map<string, { body: Buffer; metadata: any }>();
    const objects = createFirebaseHandoverObjects({ config: { projectId: options.projectId, namespace: options.namespace, bucketName: 'synthetic-concern-week' }, files: cipher.files,
      bucket: { async metadata(name) { return stored.get(name)?.metadata ?? null; },
        createWrite(name, settings) { const chunks: Buffer[] = []; return new Writable({ write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); },
          final(done) { const body = Buffer.concat(chunks); stored.set(name, { body, metadata: { name, bucket: 'synthetic-concern-week', generation: '11111111111111111',
            size: String(body.length), metadata: settings.metadata?.metadata } }); done(); } }); },
        readPinned(name) { return Readable.from([stored.get(name)!.body]); }, async removePinned(name) { stored.delete(name); } } });
    const uploads = createHandoverUploadService({ ...options, objects }), service = createHandoverImportService({ ...options, uploads });
    const deliveries: any[] = [];
    const worker = createFirebaseWorkerServices({ ...options, config: { ...options, taskWorkerEnabled: true }, authority, handoverImports: service,
      currentAuth: async () => ({ disabled: false, emailVerified: true, email: 'recipient@example.test' }) } as any,
      { taskName: () => 'unused', enqueue: async () => { throw Error('Unexpected notification'); }, probe: async () => { throw Error('Unexpected notification'); } },
      { async enqueue(value) { deliveries.push(value); return { state: 'confirmed' }; }, async probe() { return { state: 'confirmed' }; } }, controller);
    async function packageFor(period: HandoverHeader['selection']['period']) {
      return writePersonalHandoverPackage({ directory, exporter, ownerUserId: 'source', serverId: 'https://source.test', packageId: randomUUID(),
        createdAt: new Date().toISOString(), purpose: 'handover', selection: { childIds: [sourceChild], modules: ['concerns'], period } });
    }
    async function importPackage(path: string) {
      const bytes = await readFile(path), uploadId = randomUUID(), opId = randomUUID();
      await uploads.create('recipient', { opId: uploadId, filename: 'concern-week.zip', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
      const uploaded = await uploads.receive('recipient', uploadId, Readable.from([bytes]), controller.signal);
      const command = { opId, uploadId, expectedUploadVersion: uploaded.version, acceptedManifestSha256: uploaded.preview!.manifestSha256,
        targets: [{ sourceChildId: sourceChild, target: { childId, spaceId: null }, sections: ['concerns'] }], resolutions: [] };
      const queued = await service.create('recipient', command, controller.signal);
      assert.equal(queued.state, 'queued', queued.error ?? JSON.stringify(queued));
      // Importing full source history can put more than one 12-item dispatch batch ahead of this job.
      const pending = [...fixture.records].filter(([path, data]) => path.includes('_background_work/')
        && data.state === 'pending' && ['pending', 'sending'].includes(data.dispatch)).length;
      const dispatched: Awaited<ReturnType<typeof worker.background.dispatch>>[] = [];
      let delivery: (typeof deliveries)[number] | undefined;
      for (let batch = 0; batch < Math.max(1, Math.ceil(pending / 12)) && !delivery; batch++) {
        dispatched.push(await worker.background.dispatch());
        delivery = deliveries.splice(0).find(value => {
          const row = [...fixture.records].find(([path, metadata]) => path.includes('_background_work/') && metadata.id === value.id);
          return row && (codec.decode({ path: row[0], data: row[1] }).value as any).resourceId === opId;
        });
      }
      assert.ok(delivery, JSON.stringify({ pending, dispatched })); await worker.background.process(delivery);
      const result = await service.get('recipient', opId);
      assert.equal(result.state, 'completed', result.error ?? JSON.stringify(result));
      const results = await service.results('recipient', opId, { sourceChildId: sourceChild, module: 'concerns' });
      const current = results.items.find(item => item.sourceSection === null)!;
      assert.ok(current.recordedResource);
      const reopened = await concerns.get('recipient', childId, current.recordedResource.id); assert.ok(reopened);
      return { result, reopened };
    }
    const full = await importPackage((await packageFor(null)).path), fullSnapshot = structuredClone(full.reopened);
    assert.deepEqual(full.reopened.events.map(event => event.text), source.events.map(event => event.text));
    async function assertOnlyWeek(path: string, expected: string[], forbidden: string[]) {
      const archive = await openHandoverArchive({ path });
      try {
        const contents = (await Promise.all(archive.manifest.entries.map(async entry =>
          (await archive.readEntry(entry.path, 4 * 1024 * 1024)).toString('utf8')))).join('\n');
        for (const text of expected) assert.ok(contents.includes(text), `Selected event missing: ${text}`);
        for (const text of forbidden) assert.ok(!contents.includes(text), `Unselected content leaked: ${text}`);
      } finally { await archive.close(); }
    }
    const expected = ['First selected observation', 'Middle selected observation', 'Last selected observation'];
    const forbidden = ['SECRET_PARENT_REASON', 'SECRET_BEFORE_WEEK', 'SECRET_AFTER_WEEK', 'Other week observation'];
    const firstArchive = await packageFor(week); await assertOnlyWeek(firstArchive.path, expected, forbidden);
    const first = await importPackage(firstArchive.path);
    assert.notEqual(first.reopened.id, full.reopened.id);
    assert.deepEqual(first.reopened.events.map(event => event.text), expected);
    assert.equal(first.reopened.historyComplete, true);
    assert.ok(!first.reopened.followUp || !['pending', 'queued'].includes(first.reopened.followUp.state));
    const history = await service.history('recipient', { childId, module: 'concerns', resourceId: first.reopened.id });
    assert.ok(JSON.stringify(history).includes(source.id), 'period history retains the original concern source reference');
    for (const text of forbidden) assert.ok(!JSON.stringify({ concern: first.reopened, history }).includes(text), `Reopened source leaked: ${text}`);
    const sliceSnapshot = structuredClone(first.reopened);
    const repeated = await importPackage((await packageFor({ from: '2026-10-31T16:00:00Z', to: '2026-11-07T15:59:59.999Z' })).path);
    assert.equal(repeated.reopened.id, first.reopened.id, 'equivalent instants identify the same slice across new packages');
    assert.deepEqual(repeated.reopened, sliceSnapshot);
    const onward = await writePersonalHandoverPackage({ directory, exporter, ownerUserId: 'recipient',
      serverId: 'https://recipient.test', packageId: randomUUID(), createdAt: new Date().toISOString(),
      purpose: 'handover', selection: { childIds: [childId], modules: ['concerns'], period: week } });
    const onwardArchive = await openHandoverArchive({ path: onward.path });
    try {
      const heads = [];
      for (const entry of onwardArchive.manifest.entries.filter(entry => entry.path.startsWith('data/'))) {
        const page = JSON.parse((await onwardArchive.readEntry(entry.path, 4 * 1024 * 1024)).toString('utf8'));
        if (page.section === 'concerns') heads.push(...page.items);
      }
      const twiceSelected = heads.find(head => head.periodSource?.concernId === first.reopened.id);
      assert.ok(twiceSelected);
      assert.ok(JSON.stringify(twiceSelected.importedFrom).includes(source.id), 'a second dated handover still identifies the original concern');
    } finally { await onwardArchive.close(); }
    const secondArchive = await packageFor(otherWeek);
    await assertOnlyWeek(secondArchive.path, ['Other week observation'], [...expected, ...forbidden.slice(0, 3)]);
    const second = await importPackage(secondArchive.path);
    assert.notEqual(second.reopened.id, full.reopened.id); assert.notEqual(second.reopened.id, first.reopened.id);
    assert.deepEqual(second.reopened.events.map(event => event.text), ['Other week observation']);
    assert.equal(second.reopened.historyComplete, true);
    assert.ok(!second.reopened.followUp || !['pending', 'queued'].includes(second.reopened.followUp.state));
    assert.deepEqual(await concerns.get('recipient', childId, full.reopened.id), fullSnapshot);
    assert.deepEqual(await concerns.get('recipient', childId, first.reopened.id), sliceSnapshot);
    const sliceIds = new Set([first.reopened.id, second.reopened.id]);
    const sliceFollowups = [...fixture.records].filter(([path]) => path.includes('_background_work/'))
      .map(([path, data]) => codec.decode({ path, data }).value as any).filter(work => work.kind === 'concern' && sliceIds.has(work.resourceId));
    assert.equal(sliceFollowups.length, 0, 'imported period slices never schedule source follow-up work');
  } finally { controller.abort(); await rm(directory, { recursive: true, force: true }); }
});
