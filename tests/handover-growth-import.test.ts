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
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirestoreGrowthStore } from '../server/firestore-growth.ts';
import { createFirestoreConcernStore } from '../server/firestore-concerns.ts';
import { createFirebaseHandoverObjects } from '../server/firebase-handover-objects.ts';
import { createHandoverUploadService } from '../server/handover-upload-service.ts';
import { createHandoverImportService } from '../server/handover-import-service.ts';
import { createFirebaseWorkerServices } from '../server/firebase-worker-services.ts';
import { createFirestoreRestoreCodec } from '../server/firestore-restore-codec.ts';
import { createFirestoreAccountExport } from '../server/firestore-account-export.ts';
import { writeHandoverArchive } from '../server/handover-archive.ts';
import { openHandoverImport } from '../server/handover-import.ts';
import { writePersonalHandoverPackage } from '../server/handover-export.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import type { HandoverImportCommand } from '../src/shared/handover-imports.ts';
import { FirestoreDomainData } from '../server/firestore-domain-data.ts';
import { growthImportPending } from '../server/firestore-growth-import-guard.ts';
import { firestoreBackgroundWorkSchema } from '../server/firestore-background-work.ts';

test('growth packages preserve source outcomes and history while existing topic choices require explicit replacement', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'handover-growth-import-')), controller = new AbortController();
  try {
    const fixture = serialFirestoreFixture(), cipher = createStorageCipher(Buffer.alloc(32, 103));
    const options = { database: fixture.database, cipher, projectId: 'demo-growth-import', namespace: 'unit_growth_import' };
    const authority = createFirestoreAuthority(options), codec = createFirestoreRestoreCodec(options), care = createFirestoreCareStore(options);
    const data = new FirestoreDomainData(options);
    const pendingGrowth = (child: string) => authority.runTransaction('recipient', child, binding => growthImportPending(data, binding));
    const backgroundJobs = () => [...fixture.records].filter(([path]) => path.includes('_background_work/'))
      .map(([path, value]) => firestoreBackgroundWorkSchema.parse(codec.decode({ path, data: value }).value));
    const chat = createFirestoreChatStore(options), memory = createFirestoreMemoryStore({ ...options, care, chat });
    const growth = createFirestoreGrowthStore({ ...options, care, memory, online: createFirestoreOnlineStore(options) });
    const concerns = createFirestoreConcernStore(options);
    await authority.initializeControl({ enabled: true, generation: randomUUID() });
    await authority.issueInvitation({ email: 'recipient@example.test', operationId: randomUUID(), expiresAt: new Date(Date.now() + 3600000).toISOString() });
    await authority.admitIdentity({ userId: 'recipient', email: 'recipient@example.test', emailVerified: true });
    await authority.acknowledge({ userId: 'recipient', operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
    const childId = (await authority.createChild({ userId: 'recipient', operationId: randomUUID(), displayName: 'Recipient' })).child.id;
    const copiedChild = (await authority.createChild({ userId: 'recipient', operationId: randomUUID(), displayName: 'Onward' })).child.id;
    const at = new Date().toISOString(), sourceChild = randomUUID(), attentionId = randomUUID(), foreignTask = randomUUID();
    const sourceItem = { id: attentionId, childId: sourceChild, topicId: 'solid_food', version: 2, state: 'accepted', title: 'Source growth title', kind: 'arrange',
      whyNow: 'Original source reason', advice: 'Original source advice', limits: 'Original source limits',
      basis: { stage: 'infant-solids', ruleRevision: 'source-rule', sourceHash: 'b'.repeat(64), values: {} },
      evidence: { profileVersion: 8, facts: [{ id: randomUUID(), version: 2 }] },
      source: { sourceId: 'source-manual', versionId: randomUUID(), chunkId: randomUUID(), contentHash: 'b'.repeat(64), url: 'https://example.test/source',
        title: 'Original source', section: 'one', checkedAt: at, excerpt: 'Original source text' }, sourceAvailable: true,
      createdAt: at, updatedAt: at, snoozeUntil: null, previousId: randomUUID(), newReason: 'Original reason',
      taskId: foreignTask, taskState: 'completed', lastAction: 'accept', actorUserId: 'source-author', note: 'Source result 2' };
    const sourceTopic = { topicId: 'solid_food', version: 2, disabled: true, actor: 'source-author', at,
      request: { authorityVersion: 'foreign-authority', expectedVersion: 1, confirm: true, action: 'set_enabled', enabled: false } };
    const concernId = randomUUID(), concernEventId = randomUUID();
    const sourceConcern = { id: concernId, childId: sourceChild, version: 1, eventCount: 1, title: 'Source linked concern', reason: 'Source growth link',
      status: 'following', createdAt: at, updatedAt: at, archivedAt: null, attentionIds: [attentionId], followUp: null };
    const sourceConcernEvent = { id: concernEventId, concernId, childId: sourceChild, sequence: 1, at, kind: 'observation', title: 'Original growth observation',
      text: 'Source concern observation', sourceLabel: 'Source parent', actorUserId: 'source-author', taskId: foreignTask, attentionId, attentionVersion: 2 };
    const sourceTask = { id: foreignTask, childId: sourceChild, version: 1, title: 'Source completed task', details: '', kind: 'ordinary',
      assigneeUserId: 'source', createdBy: 'source', createdAt: at, updatedAt: at,
      occurrence: { id: randomUUID(), dueAt: at, timeZone: 'Asia/Hong_Kong', state: 'completed', terminalBasisVersion: null } };
    async function sourcePackage(version: number, legacyGrowth = false, malformedAttention = false) {
      const values: Record<string, object[]> = {
        growth_attention: [{ item: { ...sourceItem, version, note: malformedAttention ? 7 : `Source result ${version}` }, lastRequest: null }],
        growth_topics: [{ ...sourceTopic, version }],
        growth_history: [{ item: { ...sourceItem, version: 1, note: 'Original historical result' }, lastRequest: null }],
        growth_topic_history: [{ ...sourceTopic, version: 1 }],
        tasks: [sourceTask], task_history: [], concerns: [sourceConcern], concern_history: [], concern_events: [sourceConcernEvent],
      };
      const scopeVersion = 'a'.repeat(64), pages = [{ section: 'children', childId: null as string | null, items: [{ id: sourceChild, displayName: 'Source' }] },
        ...['concerns', 'concern_events', 'concern_history', 'growth_attention', 'growth_history', 'growth_topics', 'growth_topic_history', 'tasks', 'task_history']
          .filter(section => !legacyGrowth || !['growth_history', 'growth_topic_history'].includes(section))
          .map(section => ({ section, childId: sourceChild, items: values[section] }))];
      async function* entries() {
        for (const [index, page] of pages.entries()) yield { path: `data/${index}.json`, mediaType: 'application/json', content: Buffer.from(JSON.stringify({ ...page, scopeVersion })) };
        yield { path: 'summary.md', mediaType: 'text/markdown', content: Buffer.from('Synthetic growth package') };
      }
      return writeHandoverArchive({ directory, header: { format: 'yuyoufang-data', version: 1, packageId: randomUUID(), packageVersion: 1, createdAt: at,
        purpose: 'handover', source: { serverId: 'https://source.test', accountId: 'source' }, selection: { childIds: [sourceChild], modules: ['growth', 'tasks', 'concerns'], period: null } },
        entries: entries(), coverage: () => pages.map(page => ({ section: page.section, childId: page.childId, scopeVersion, items: page.items.length, complete: true as const })) });
    }
    const stored = new Map<string, { body: Buffer; metadata: any }>();
    const objects = createFirebaseHandoverObjects({ config: { projectId: options.projectId, namespace: options.namespace, bucketName: 'synthetic-growth-packages' }, files: cipher.files,
      bucket: { async metadata(name) { return stored.get(name)?.metadata ?? null; },
        createWrite(name, settings) { const chunks: Buffer[] = []; return new Writable({ write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); },
          final(done) { const body = Buffer.concat(chunks); stored.set(name, { body, metadata: { name, bucket: 'synthetic-growth-packages', generation: '11111111111111111',
            size: String(body.length), metadata: settings.metadata?.metadata } }); done(); } }); },
        readPinned(name) { return Readable.from([stored.get(name)!.body]); }, async removePinned(name) { stored.delete(name); } } });
    const uploads = createHandoverUploadService({ ...options, objects }), service = createHandoverImportService({ ...options, uploads });
    const deliveries: any[] = []; let checkedWorkerRace = false;
    const worker = createFirebaseWorkerServices({ ...options, config: { ...options, taskWorkerEnabled: true }, authority, handoverImports: service, growth,
      currentAuth: async () => ({ disabled: false, emailVerified: true, email: 'recipient@example.test' }) } as any,
      { taskName: () => 'unused', enqueue: async () => { throw Error('Unexpected reminder'); }, probe: async () => { throw Error('Unexpected reminder'); } },
      { async enqueue(value) { deliveries.push(value); return { state: 'confirmed' }; }, async probe() { return { state: 'confirmed' }; } }, controller);
    async function stage(path: string, source: string, target = childId): Promise<HandoverImportCommand> {
      const bytes = await readFile(path), uploadId = randomUUID();
      await uploads.create('recipient', { opId: uploadId, filename: 'growth.zip', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
      const uploaded = await uploads.receive('recipient', uploadId, Readable.from([bytes]), controller.signal);
      assert.equal(uploaded.state, 'ready', uploaded.error ?? JSON.stringify(uploaded)); assert.equal(uploaded.preview!.integrity, 'missing_proof');
      return { opId: randomUUID(), uploadId, expectedUploadVersion: uploaded.version, acceptedManifestSha256: uploaded.preview!.manifestSha256,
        targets: [{ sourceChildId: source, target: { childId: target, spaceId: null }, sections: ['growth', 'tasks', 'concerns'] }], resolutions: [] };
    }
    async function run(command: Awaited<ReturnType<typeof stage>>, expectedState: 'completed' | 'failed' = 'completed') {
      const started = await service.create('recipient', command, controller.signal); assert.equal(started.state, 'queued', started.error ?? JSON.stringify(started));
      const targetChild = started.targets[0].target.childId;
      assert.equal(await pendingGrowth(targetChild), true, 'queued imports fence growth evaluation for this exact target scope');
      const childChange = backgroundJobs().find(job => job.kind === 'child-change' && job.scope.childId === targetChild && job.state === 'pending');
      assert.ok(childChange);
      assert.equal((await growth.evaluate(childChange)).state, 'deferred', 'the original evaluation cannot race the snapshot import');
      await assert.rejects(growth.backgroundInput({ ...childChange, kind: 'growth' }), { code: 'growth_import_pending' });
      const importWork = backgroundJobs().find(job => job.kind === 'handover-import' && job.resourceId === command.opId)!;
      const ready: any[] = [];
      // The real dispatcher scans bounded pages; earlier synthetic child-change jobs stay unexecuted.
      for (let page = 0; page < 5; page++) {
        await worker.background.dispatch(); ready.push(...deliveries.splice(0));
        if (ready.some(value => value.id === importWork.id)) break;
      }
      if (!checkedWorkerRace) {
        const evaluation = ready.find(value => value.id === childChange.id); assert.ok(evaluation);
        assert.equal((await worker.background.process(evaluation)).state, 'pending', 'the original worker retains deferred child-change work');
        checkedWorkerRace = true;
      }
      const delivery = ready.find(value => value.id === importWork.id);
      assert.ok(delivery); await worker.background.process(delivery);
      const done = await service.get('recipient', command.opId); assert.equal(done.state, expectedState, done.error ?? JSON.stringify(done));
      assert.equal(await pendingGrowth(targetChild), false, 'terminal batches release the growth fence'); return done;
    }
    // Validate the same reader used by upload without retaining a redundant fifth cloud-upload fixture.
    const legacy = await openHandoverImport({ path: (await sourcePackage(2, true)).path, signal: controller.signal });
    try { assert.equal(legacy.manifest.coverage.some(row => row.section === 'growth_history'), false); }
    finally { await legacy.close(); }
    const firstCommand = await stage((await sourcePackage(2)).path, sourceChild);
    await assert.rejects(service.create('recipient', { ...firstCommand, opId: randomUUID(), targets: [{ ...firstCommand.targets[0],
      target: { childId, spaceId: randomUUID() } }] }, controller.signal), { code: 'shared_domain_read_only' });
    const first = await run(firstCommand);
    assert.equal(first.processedItems, 7); assert.equal(first.counts.created, 7);
    const results = await service.results('recipient', firstCommand.opId, { sourceChildId: sourceChild, module: 'growth' });
    assert.equal(results.items.length, 4); assert.equal(results.complete, true);
    const attention = results.items.find(item => item.resourceSection === 'growth_attention' && item.sourceSection === null)!.recordedResource!;
    const topic = results.items.find(item => item.resourceSection === 'growth_topics' && item.sourceSection === null)!.recordedResource!;
    const localTask = (await service.results('recipient', firstCommand.opId, { sourceChildId: sourceChild, module: 'tasks' })).items[0].recordedResource!;
    const localConcern = (await service.results('recipient', firstCommand.opId, { sourceChildId: sourceChild, module: 'concerns' })).items.find(item => item.sourceSection === null)!.recordedResource!;
    assert.notEqual(attention.id, attentionId);
    await authority.runTransaction('recipient', childId, async binding => {
      const saved = await growth.readImportAttention(binding, attention.id); assert.ok(saved);
      assert.equal(saved.item.version, attention.version); assert.equal(saved.item.state, 'accepted'); assert.equal(saved.item.actorUserId, 'source-author');
      assert.equal(saved.item.note, 'Source result 2'); assert.equal(saved.lastRequest, null); assert.equal(saved.item.taskId, localTask.id);
      assert.deepEqual(saved.item.evidence, { profileVersion: 0, facts: [] });
      assert.equal(saved.importedFrom!.current.source.growth!.taskId, foreignTask);
      const savedTopic = await growth.readImportTopic(binding, 'solid_food'); assert.ok(savedTopic);
      assert.equal(savedTopic.actor, 'source-author'); assert.equal(savedTopic.disabled, true); assert.equal(savedTopic.request, null);
    });
    const linked = await concerns.get('recipient', childId, localConcern.id); assert.ok(linked);
    assert.equal(linked.events[0].taskId, localTask.id); assert.equal(linked.events[0].attentionId, attention.id); assert.equal(linked.events[0].attentionVersion, attention.version);
    const attentionHistory = await service.history('recipient', { childId, module: 'growth_attention', resourceId: attention.id });
    const topicHistory = await service.history('recipient', { childId, module: 'growth_topics', resourceId: topic.id });
    await assert.rejects(service.history('recipient', { childId: randomUUID(), module: 'growth_attention', resourceId: attention.id }));
    assert.equal(attentionHistory.items.length, 1); assert.equal((attentionHistory.items[0].evidence.value.item as any).actorUserId, 'source-author');
    assert.equal(topicHistory.items.length, 1); assert.equal(topicHistory.items[0].evidence.value.actor, 'source-author');
    assert.deepEqual(await service.create('recipient', firstCommand, controller.signal), first);
    assert.equal((await run({ ...firstCommand, opId: randomUUID() })).counts.skipped, 7);
    const current = await growth.list('recipient', childId), currentTopic = current.topics.find(item => item.id === 'solid_food')!;
    const locallyEnabled = await growth.topic('recipient', childId, 'solid_food', { authorityVersion: current.authorityVersion,
      expectedVersion: currentTopic.version, confirm: true, action: 'set_enabled', enabled: true });
    const localTopic = locallyEnabled.topics.find(item => item.id === 'solid_food')!;
    const updateCommand = await stage((await sourcePackage(3)).path, sourceChild), updated = await run(updateCommand);
    assert.ok(updated.counts.updated >= 1); assert.ok(updated.counts.conflict >= 1);
    const updatedResults = await service.results('recipient', updateCommand.opId, { sourceChildId: sourceChild, module: 'growth' });
    const conflict = updatedResults.items.find(item => item.resourceSection === 'growth_topics' && item.sourceSection === null)!;
    assert.equal(conflict.reason, 'target_changed'); assert.equal(conflict.currentResource!.version, localTopic.version); assert.equal(conflict.availableResolution, 'replace_current');
    assert.equal((await growth.list('recipient', childId)).topics.find(item => item.id === 'solid_food')!.disabled, false);
    const resolvedCommand: HandoverImportCommand = { ...updateCommand, opId: randomUUID(), resolutionOnly: true, resolutions: [{ sourceChildId: sourceChild,
      section: 'growth_topics', resourceId: conflict.sourceResourceId, resolution: { mode: 'replace_current', targetId: topic.id, expectedVersion: localTopic.version } }] };
    const resolved = await run(resolvedCommand); assert.equal(resolved.processedItems, 1); assert.equal(resolved.counts.updated, 1);
    await authority.runTransaction('recipient', childId, async binding => {
      const saved = await growth.readImportAttention(binding, attention.id); assert.ok(saved); assert.equal(saved.item.version, 2); assert.equal(saved.item.note, 'Source result 3');
      const replaced = await growth.readImportTopic(binding, 'solid_food'); assert.ok(replaced); assert.equal(replaced.disabled, true); assert.equal(replaced.actor, 'source-author');
    });
    const exporter = createFirestoreAccountExport({ ...options, photos: { async content() { throw Error('Unexpected photo'); } } });
    async function exported(section: string) {
      const rows: any[] = []; let cursor: string | undefined, scopeVersion: string | undefined;
      do { const page = await exporter.page('recipient', { section, childId, ...(cursor ? { cursor, scopeVersion } : {}) });
        rows.push(...page.items); cursor = page.nextCursor ?? undefined; scopeVersion = page.scopeVersion; } while (cursor); return rows;
    }
    const sourceHistories = [...await exported('growth_history'), ...await exported('growth_topic_history')].filter(item => item.format === 'yuyoufang-source-revision:1');
    assert.equal(sourceHistories.length, 2);
    const onward = await writePersonalHandoverPackage({ directory, exporter, ownerUserId: 'recipient', serverId: 'https://recipient.test', packageId: randomUUID(),
      createdAt: at, purpose: 'handover', selection: { childIds: [childId], modules: ['growth', 'tasks', 'concerns'], period: null } });
    const onwardCommand = await stage(onward.path, childId, copiedChild); await run(onwardCommand);
    const onwardResults = await service.results('recipient', onwardCommand.opId, { sourceChildId: childId, module: 'growth' });
    for (const original of sourceHistories) {
      const resource = onwardResults.items.find(item => item.resourceSection === original.evidence.module && item.sourceSection === null)!.recordedResource!;
      const retained = await service.history('recipient', { childId: copiedChild, module: original.evidence.module, resourceId: resource.id });
      assert.ok(retained.items.some(item => JSON.stringify(item.evidence) === JSON.stringify(original.evidence)), 'another handover preserves the original source evidence');
    }
    const kinds = [...fixture.records].filter(([path]) => path.includes('_background_work/')).map(([path, value]) => (codec.decode({ path, data: value }).value as any).kind);
    assert.equal(kinds.includes('growth'), false, 'accepted source outcomes do not replay an old evaluation or decision');
    assert.equal(kinds.includes('task-agent'), false); assert.equal(kinds.includes('concern'), false);
    const cancelledCommand = { ...firstCommand, opId: randomUUID() }, queued = await service.create('recipient', cancelledCommand, controller.signal);
    assert.equal(queued.state, 'queued'); assert.equal(await pendingGrowth(childId), true);
    const pendingRecord = [...fixture.records].find(([path, value]) => path.includes('_handover_import_batches/') && value.batchId === queued.id);
    assert.ok(pendingRecord);
    const decoded = codec.decode({ path: pendingRecord[0], data: pendingRecord[1] });
    assert.equal((decoded.value as { state: string }).state, 'queued');
    const cancelled = await service.cancel('recipient', queued.id, { opId: randomUUID(), expectedVersion: queued.version });
    assert.equal(cancelled.state, 'cancelled'); assert.equal(await pendingGrowth(childId), false);
    const failedCommand = await stage((await sourcePackage(3, false, true)).path, sourceChild), failed = await run(failedCommand, 'failed');
    for (const id of [cancelled.id, failed.id]) {
      const metadata = [...fixture.records].find(([path, value]) => path.includes('_handover_import_batches/') && (codec.decode({ path, data: value }).value as any).id === id)?.[1];
      assert.ok(metadata); assert.deepEqual(metadata.growthImportScopes ?? [], [], 'cancelled or failed metadata cannot retain an active import scope');
    }
  } finally { controller.abort(); await rm(directory, { recursive: true, force: true }); }
});
