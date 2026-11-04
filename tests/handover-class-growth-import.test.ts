import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreSharingStore } from '../server/firestore-sharing.ts';
import { createFirestoreCareStore } from '../server/firestore-care.ts';
import { createFirestoreChatStore } from '../server/firestore-chat.ts';
import { createFirestoreMemoryStore } from '../server/firestore-memory.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirestoreGrowthStore, growthTopicResourceId } from '../server/firestore-growth.ts';
import { FirestoreDomainData } from '../server/firestore-domain-data.ts';
import { growthImportPending } from '../server/firestore-growth-import-guard.ts';
import { createFirestoreRestoreCodec } from '../server/firestore-restore-codec.ts';
import { firestoreBackgroundWorkSchema } from '../server/firestore-background-work.ts';
import { createFirebaseHandoverObjects } from '../server/firebase-handover-objects.ts';
import { createHandoverUploadService } from '../server/handover-upload-service.ts';
import { createHandoverImportService } from '../server/handover-import-service.ts';
import { createFirebaseWorkerServices } from '../server/firebase-worker-services.ts';
import { writeHandoverArchive } from '../server/handover-archive.ts';
import { handleHandoverImport } from '../server/firebase-handover-import-api.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import type { HandoverImportCommand } from '../src/shared/handover-imports.ts';

test('class growth ZIP intake creates one shared learner and stable attention/topic resources without granting source execution', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'handover-class-growth-')), controller = new AbortController();
  try {
    const fixture = serialFirestoreFixture(), options = { database: fixture.database, cipher: createStorageCipher(Buffer.alloc(32, 194)),
      projectId: 'synthetic-class-growth', namespace: 'class_growth_import' };
    const authority = createFirestoreAuthority(options), sharing = createFirestoreSharingStore(options), care = createFirestoreCareStore(options);
    const chat = createFirestoreChatStore(options), memory = createFirestoreMemoryStore({ ...options, care, chat });
    const growth = createFirestoreGrowthStore({ ...options, care, memory, online: createFirestoreOnlineStore(options) });
    const codec = createFirestoreRestoreCodec(options);
    await authority.initializeControl({ enabled: true, generation: randomUUID() });
    const expiresAt = new Date(Date.now() + 86400000).toISOString();
    for (const userId of ['manager', 'teacher', 'viewer']) {
      const email = userId + '@example.test';
      await authority.issueInvitation({ email, expiresAt, operationId: randomUUID() });
      await authority.admitIdentity({ userId, email, emailVerified: true });
      await authority.acknowledge({ userId, policyVersion: SERVICE_POLICY_VERSION, operationId: randomUUID() });
    }
    let classroom = await sharing.create('manager', { operationId: randomUUID(), kind: 'class', name: 'Growth intake class' });
    for (const [userId, role] of [['teacher', 'caregiver'], ['viewer', 'viewer']] as const) {
      const invite = await sharing.invite('manager', { operationId: randomUUID(), spaceId: classroom.id,
        expectedVersion: classroom.version, email: userId + '@example.test', role, expiresAt });
      classroom = await sharing.acceptInvitation(userId, { operationId: randomUUID(), token: invite.token });
    }
    const at = new Date().toISOString(), sourceChild = randomUUID(), sourceAttention = randomUUID(), foreignTask = randomUUID(), foreignFact = randomUUID();
    // Existing native growth wire formats; current public knowledge is deliberately unavailable.
    const attention = { item: { id: sourceAttention, childId: sourceChild, topicId: 'solid_food', version: 2,
      state: 'accepted', title: 'Original class intake growth', kind: 'arrange', whyNow: 'Original reason', advice: 'Unverified advice', limits: 'Original limitations',
      basis: { stage: 'infant-solids', ruleRevision: 'source-rule', sourceHash: 'b'.repeat(64), values: {} },
      evidence: { profileVersion: 8, facts: [{ id: foreignFact, version: 2 }] },
      source: { sourceId: 'unverified-source', versionId: randomUUID(), chunkId: randomUUID(), contentHash: 'b'.repeat(64),
        url: 'https://example.test/source', title: 'Unverified original source', section: 'one', checkedAt: at, excerpt: 'Original evidence' },
      sourceAvailable: true, createdAt: at, updatedAt: at, snoozeUntil: null, previousId: randomUUID(), newReason: 'Original reason',
      taskId: foreignTask, taskState: 'completed', lastAction: 'accept', actorUserId: 'source-author', note: 'Original result' },
      lastRequest: { action: 'accept', authorityVersion: 'foreign-authority', expectedVersion: 1, confirm: true,
        task: { kind: 'existing', id: foreignTask, expectedVersion: 4 } } };
    const topic = { topicId: 'solid_food', version: 2, disabled: true, actor: 'source-author', at,
      request: { action: 'set_enabled', authorityVersion: 'foreign-authority', expectedVersion: 1, confirm: true, enabled: false } };
    const scopeVersion = 'a'.repeat(64), pages = [
      { section: 'children', childId: null as string | null, items: [{ id: sourceChild, displayName: 'Source learner' }] },
      { section: 'growth_attention', childId: sourceChild, items: [attention] },
      { section: 'growth_topics', childId: sourceChild, items: [topic] },
      { section: 'growth_history', childId: sourceChild, items: [{ ...attention, item: { ...attention.item, version: 1 } }] },
      { section: 'growth_topic_history', childId: sourceChild, items: [{ ...topic, version: 1, request: null }] },
    ];
    async function* entries() {
      for (const [index, page] of pages.entries()) yield { path: `data/${index}.json`, mediaType: 'application/json', content: Buffer.from(JSON.stringify({ ...page, scopeVersion })) };
      yield { path: 'summary.md', mediaType: 'text/markdown', content: Buffer.from('Synthetic class growth intake') };
    }
    const archive = await writeHandoverArchive({ directory, header: { format: 'yuyoufang-data', version: 1,
      packageId: randomUUID(), packageVersion: 1, createdAt: at, purpose: 'handover', source: { serverId: 'https://source.test', accountId: 'source-author' },
      selection: { childIds: [sourceChild], modules: ['growth'], period: null } }, entries: entries(),
      coverage: () => pages.map(page => ({ section: page.section, childId: page.childId, scopeVersion, items: page.items.length, complete: true as const })) });
    const stored = new Map<string, { body: Buffer; metadata: unknown }>();
    const objects = createFirebaseHandoverObjects({ config: { projectId: options.projectId, namespace: options.namespace, bucketName: 'synthetic-class-growth' }, files: options.cipher.files,
      bucket: { async metadata(name) { return stored.get(name)?.metadata ?? null; },
        createWrite(name, settings) { const parts: Buffer[] = []; return new Writable({ write(chunk, _encoding, done) { parts.push(Buffer.from(chunk)); done(); },
          final(done) { const body = Buffer.concat(parts); stored.set(name, { body, metadata: { name, bucket: 'synthetic-class-growth', generation: '11111111111111111',
            size: String(body.length), metadata: settings.metadata?.metadata } }); done(); } }); },
        readPinned(name) { return Readable.from([stored.get(name)!.body]); }, async removePinned(name) { stored.delete(name); } } });
    const uploads = createHandoverUploadService({ ...options, objects }), service = createHandoverImportService({ ...options, uploads });
    const bytes = await readFile(archive.path), uploadId = randomUUID();
    await uploads.create('teacher', { opId: uploadId, filename: 'class-growth.zip', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    const upload = await uploads.receive('teacher', uploadId, Readable.from([bytes]), controller.signal);
    assert.equal(upload.state, 'ready', upload.error ?? JSON.stringify(upload));
    const command: HandoverImportCommand = { opId: randomUUID(), uploadId, expectedUploadVersion: upload.version,
      acceptedManifestSha256: upload.preview!.manifestSha256,
      targets: [{ sourceChildId: sourceChild, target: { createInClassId: classroom.id }, sections: ['growth'] }], resolutions: [] };
    assert.deepEqual((await sharing.classRosterPage('manager', classroom.id)).items, []);
    const queued = await service.create('teacher', command, controller.signal);
    assert.equal(queued.state, 'queued', queued.error ?? JSON.stringify(queued));
    assert.deepEqual((await sharing.classRosterPage('manager', classroom.id)).items, [], 'The worker alone creates the new learner');
    const jobs = () => [...fixture.records].filter(([path]) => path.includes('_background_work/'))
      .map(([path, data]) => firestoreBackgroundWorkSchema.parse(codec.decode({ path, data }).value));
    const deliveries: unknown[] = [], modelActors: string[] = [];
    let notifications = 0;
    const worker = createFirebaseWorkerServices({ ...options, config: { ...options, taskWorkerEnabled: true }, authority, growth, handoverImports: service,
      currentAuth: async (userId: string) => ({ userId, disabled: userId !== 'teacher', emailVerified: userId === 'teacher', email: userId === 'teacher' ? 'teacher@example.test' : null }),
      product: { agent: { async background(input: { userId: string }) { modelActors.push(input.userId); throw Error('Unexpected background model'); } } } } as unknown as Parameters<typeof createFirebaseWorkerServices>[0],
      { taskName: () => 'unused', async enqueue() { notifications++; throw Error('Unexpected notification'); }, async probe() { throw Error('Unexpected notification'); } },
      { async enqueue(value) { deliveries.push(value); return { state: 'confirmed' }; }, async probe() { return { state: 'confirmed' }; } }, controller);
    async function execute(id: string) {
      const work = jobs().find(job => job.kind === 'handover-import' && job.resourceId === id); assert.ok(work);
      for (let page = 0; page < 8; page++) {
        await worker.background.dispatch();
        const delivery = deliveries.splice(0).find(value => (value as { id: string }).id === work.id);
        if (delivery) { await worker.background.process(delivery as Parameters<typeof worker.background.process>[0]); break; }
      }
      const complete = await service.get('teacher', id);
      assert.equal(complete.state, 'completed', complete.error ?? JSON.stringify(complete)); return complete;
    }
    const completed = await execute(command.opId), target = completed.targets[0].target;
    const roster = (await sharing.classRosterPage('manager', classroom.id)).items;
    assert.equal(roster.length, 1); assert.equal(roster[0].childId, target.childId); assert.equal(target.spaceId, classroom.id);
    const result = await service.results('teacher', command.opId, { sourceChildId: sourceChild, module: 'growth' });
    assert.equal(result.items.length, 4);
    const attentionResult = result.items.find(item => item.resourceSection === 'growth_attention' && !item.sourceSection)!.recordedResource!;
    const topicResult = result.items.find(item => item.resourceSection === 'growth_topics' && !item.sourceSection)!.recordedResource!;
    assert.equal(result.items.find(item => item.sourceSection === 'growth_history')?.reason, 'history_scope_unavailable');
    assert.equal(result.items.find(item => item.sourceSection === 'growth_topic_history')?.outcome, 'created');
    const sharedHistory = await service.history('viewer', { spaceId: classroom.id, childId: target.childId, module: 'growth_topics', resourceId: topicResult.id });
    assert.equal(sharedHistory.items.length, 1);
    assert.equal(topicResult.id, growthTopicResourceId(target.childId, 'solid_food'));
    const visible = await growth.forSharedSpace(classroom.id).list('viewer', target.childId);
    assert.equal(visible.items.length, 1); assert.equal(visible.items[0].id, attentionResult.id); assert.equal(visible.items[0].childId, target.childId);
    assert.equal(visible.items[0].sourceAvailable, false); assert.equal(visible.items[0].taskId, null); assert.equal(visible.items[0].previousId, null);
    assert.deepEqual(visible.items[0].evidence, { profileVersion: 0, facts: [] });
    assert.equal(visible.topics.find(item => item.id === 'solid_food')!.disabled, true);
    const existing: HandoverImportCommand = { ...command, opId: randomUUID(), targets: [{ ...command.targets[0], target }] };
    const pending = () => sharing.withResource('manager', { spaceId: classroom.id, childId: target.childId, module: 'growth', mode: 'read' },
      access => growthImportPending(new FirestoreDomainData(options), access.binding));
    await service.create('teacher', existing, controller.signal);
    assert.equal(await pending(), true);
    await execute(existing.opId);
    assert.equal(await pending(), false);
    assert.deepEqual(await service.create('teacher', command, controller.signal), completed);
    assert.equal((await sharing.classRosterPage('manager', classroom.id)).items.length, 1);
    assert.deepEqual((await growth.forSharedSpace(classroom.id).list('teacher', target.childId)).items.map(item => item.id), [attentionResult.id]);
    const replayed = await service.results('teacher', existing.opId, { sourceChildId: sourceChild, module: 'growth' });
    assert.ok(replayed.items.every(item => item.sourceSection === 'growth_history' ? item.reason === 'history_scope_unavailable' : item.outcome === 'skipped'));
    const viewerUploadId = randomUUID();
    await uploads.create('viewer', { opId: viewerUploadId, filename: 'growth.zip', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    const viewerUpload = await uploads.receive('viewer', viewerUploadId, Readable.from([bytes]), controller.signal);
    await assert.rejects(service.create('viewer', { ...existing, opId: randomUUID(), uploadId: viewerUploadId,
      expectedUploadVersion: viewerUpload.version }, controller.signal), (error: { status?: number }) => error.status === 403);
    const personalChild = (await authority.createChild({ userId: 'teacher', operationId: randomUUID(), displayName: 'Private child' })).child.id;
    let family = await sharing.create('teacher', { operationId: randomUUID(), kind: 'family', name: 'Family' });
    family = await sharing.share('teacher', { operationId: randomUUID(), spaceId: family.id, expectedVersion: family.version, childId: personalChild, modules: ['growth'] });
    await assert.rejects(service.create('teacher', { ...existing, opId: randomUUID(), targets: [{ ...existing.targets[0], target: { spaceId: family.id, childId: personalChild } }] }, controller.signal),
      (error: { status?: number }) => error.status === 403 || error.status === 409);
    await assert.rejects(sharing.withResource('teacher', { spaceId: classroom.id, childId: target.childId, module: 'care', mode: 'write' }, access =>
      growth.prepareImportedAttention(access.binding, randomUUID(), { section: 'growth_attention', childId: sourceChild, value: attention,
        source: { serverId: 'https://source.test', accountId: 'source-author', packageId: randomUUID(), packageVersion: 1,
          manifestSha256: 'a'.repeat(64), path: 'data/attention.json', rowIndex: 0 } }, 'trusted')));
    for (const job of jobs().filter(job => job.scope.ownerUserId === `space:${classroom.id}` && job.state === 'pending')) {
      assert.equal((await worker.background.process({ kind: 'product-work', id: job.id, generation: job.generation, dispatchRevision: job.dispatchRevision, scheduledAt: job.dueAt })).state, 'stopped');
    }
    assert.equal(jobs().some(job => ['growth', 'task-agent', 'push', 'native-push', 'contact', 'telegram'].includes(job.kind)), false);
    assert.equal([...fixture.records.keys()].some(path => /_(tasks|task_outbox|notification_outbox)\//u.test(path)), false);
    assert.deepEqual(modelActors, []); assert.equal(notifications, 0);
    for (const [feature, expected] of [[null, undefined], ['growth-extra other-growth', undefined], ['concerns, growth', true]] as const) {
      const headers = new Headers(); if (feature !== null) headers.set('x-handover-class-features', feature);
      const response = await handleHandoverImport(new Request('https://local.test/api/account/package-imports/capabilities', { headers }),
        'teacher', service, async () => { throw Error('Unexpected body'); }, async () => {});
      const capabilities = await response.json();
      assert.equal(capabilities.classGrowthImports, expected);
      if (feature === null) assert.deepEqual(capabilities, { classEnrolment: true });
    }
  } finally { controller.abort(); await rm(directory, { recursive: true, force: true }); }
});
