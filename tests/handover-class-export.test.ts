import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreSharingStore } from '../server/firestore-sharing.ts';
import { createFirestoreCareStore } from '../server/firestore-care.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirestorePrivateInstructions } from '../server/firestore-private-instructions.ts';
import { createFirestoreFamilyDocumentStore } from '../server/firestore-family-documents.ts';
import { createFirestoreCareSummary } from '../server/firestore-care-summary.ts';
import { createFirestoreMemoryStore } from '../server/firestore-memory.ts';
import { createFirestoreChatStore } from '../server/firestore-chat.ts';
import { firestoreConcernSchema } from '../server/firestore-concerns.ts';
import { firestoreDocumentConcernEventSchema } from '../server/firestore-document-sources.ts';
import { createFirestoreGrowthStore, firestoreGrowthSchema } from '../server/firestore-growth.ts';
import { FirestoreDomainData } from '../server/firestore-domain-data.ts';
import { createFirestoreAccountExport } from '../server/firestore-account-export.ts';
import { createFirestoreRestoreCodec } from '../server/firestore-restore-codec.ts';
import { createFirebaseHandoverObjects } from '../server/firebase-handover-objects.ts';
import { createHandoverService } from '../server/handover-service.ts';
import { createFirebaseWorkerServices } from '../server/firebase-worker-services.ts';
import { openHandoverArchive } from '../server/handover-archive.ts';
import { writePersonalHandoverPackage } from '../server/handover-export.ts';
import { openHandoverImport, type HandoverImportRow } from '../server/handover-import.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import type { HandoverClassExportCommand } from '../src/shared/handover-jobs.ts';

test('a class handover uses its stable source, selected dated data and actor job authority through ready download', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'handover-class-')), controller = new AbortController();
  try {
    const fixture = serialFirestoreFixture(), options = { database: fixture.database, cipher: createStorageCipher(Buffer.alloc(32, 105)),
      projectId: 'demo-class-export', namespace: 'unit_class_export' };
    const authority = createFirestoreAuthority(options), sharing = createFirestoreSharingStore(options);
    await authority.initializeControl({ enabled: true, generation: randomUUID() });
    const expiresAt = new Date(Date.now() + 86400000).toISOString();
    for (const userId of ['manager', 'teacher', 'outsider']) {
      const email = userId + '@example.test';
      await authority.issueInvitation({ email, operationId: randomUUID(), expiresAt });
      await authority.admitIdentity({ userId, email, emailVerified: true });
      await authority.acknowledge({ userId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
    }
    let classroom = await sharing.create('manager', { operationId: randomUUID(), name: 'Class source', kind: 'class' });
    const selected = await sharing.addClassChild('manager', { operationId: randomUUID(), spaceId: classroom.id,
      expectedVersion: classroom.version, displayName: 'Selected learner' }); classroom = selected.space;
    const other = await sharing.addClassChild('manager', { operationId: randomUUID(), spaceId: classroom.id,
      expectedVersion: classroom.version, displayName: 'SECRET_OTHER_LEARNER' }); classroom = other.space;
    const invitation = await sharing.invite('manager', { operationId: randomUUID(), spaceId: classroom.id,
      expectedVersion: classroom.version, email: 'teacher@example.test', role: 'caregiver', expiresAt });
    classroom = await sharing.acceptInvitation('teacher', { operationId: randomUUID(), token: invitation.token });
    const personalChild = (await authority.createChild({ userId: 'teacher', operationId: randomUUID(), displayName: 'SECRET_PERSONAL_CHILD' })).child.id;
    const care = createFirestoreCareStore(options), chat = createFirestoreChatStore(options);
    const memory = createFirestoreMemoryStore({ ...options, care, chat });
    const online = createFirestoreOnlineStore({ ...options, mutations: [care.mutation, chat.mutation] });
    async function submit(childId: string, suffix: string, payload: unknown, shared = true) {
      const command = { path: `/api/children/${childId}/${suffix}`, payload, ...(shared ? { sharing: { spaceId: classroom.id } } : {}) };
      const context = await online.context('teacher', command);
      return online.submit('teacher', { ...command, ...(shared ? { sharing: { spaceId: classroom.id, expectedBasis: context.sharingBasis! } } : {}),
        operation: { workspaceId: context.workspaceId, storageEpoch: context.storageEpoch, opId: randomUUID(), deviceId: randomUUID() } });
    }
    const at = new Date().toISOString(), period = { from: new Date(Date.parse(at) - 60000).toISOString(),
      to: new Date(Date.parse(at) + 2 * 86400000).toISOString() };
    async function record(childId: string, text: string, eventAt = at, shared = true) {
      return ((await submit(childId, 'care', { confirmShared: true, text, source: 'Original observation',
        details: { kind: 'note', quantity: null, eventTime: { rawText: eventAt, at: eventAt, timeZone: 'Asia/Hong_Kong', precision: 'exact' } } }, shared)).result as any).record;
    }
    const included = await record(selected.child.id, 'Selected class observation');
    const earlier = await record(selected.child.id, 'SECRET_OUTSIDE_PERIOD', new Date(Date.parse(at) - 86400000).toISOString());
    await record(other.child.id, 'SECRET_OTHER_CHILD_RECORD');
    await record(personalChild, 'SECRET_PERSONAL_RECORD', at, false);
    const profile = ((await submit(selected.child.id, 'profile', { confirmShared: true, expectedVersion: 0, reason: 'Original confirmation',
      data: { age: { kind: 'unknown' }, dueDate: null, gestationalWeeksRaw: null, region: 'HK', language: null,
        allergies: null, specialNeeds: null, preferences: null, source: 'Class profile', validUntil: null } })).result as any).profile;
    const task = ((await submit(selected.child.id, 'tasks', { confirm: true, values: { title: 'Selected class appointment', details: '',
      kind: 'appointment', assigneeUserId: 'teacher', dueAt: new Date(Date.parse(at) + 86400000).toISOString(), timeZone: 'Asia/Hong_Kong' } })).result as any).task;
    const factValues = (content: string) => ({ key: content, content, validUntil: null,
      source: { kind: 'manual' as const, description: 'Original family statement' } });
    async function familyFact(childId: string, content: string, shared = true) {
      const save = async (binding: Parameters<typeof memory.prepareConfirmedFact>[0]) => {
        const prepared = await memory.prepareConfirmedFact(binding, { intendedVisibility: 'family', values: factValues(content) }, true, randomUUID());
        prepared.commit(); return prepared.value;
      };
      return shared ? sharing.withResource('teacher', { spaceId: classroom.id, childId, module: 'memory', mode: 'write' }, access => save(access.binding))
        : authority.runTransaction('teacher', childId, save);
    }
    const firstFact = await familyFact(selected.child.id, 'Original class family fact');
    const classFact = await sharing.withResource('teacher', { spaceId: classroom.id, childId: selected.child.id, module: 'memory', mode: 'write' }, async access => {
      const prepared = await memory.prepareFactChange(access.binding, 'revise', firstFact.id, { expectedVersion: firstFact.version,
        confirm: true, confirmShared: true, reason: 'Family correction', values: { ...factValues('Updated class family fact'), key: firstFact.key } }, randomUUID());
      prepared.commit(); return prepared.value;
    });
    await familyFact(other.child.id, 'SECRET_OTHER_FAMILY_FACT');
    await familyFact(personalChild, 'SECRET_PERSONAL_FAMILY_FACT', false);
    await memory.createFact('teacher', personalChild, { intendedVisibility: 'private', values: factValues('SECRET_PERSONAL_PRIVATE_FACT') });
    const privateMessage = ((await submit(personalChild, 'messages', { text: 'SECRET_PRIVATE_CHAT' }, false)).result as any).message;
    await authority.runTransaction('teacher', personalChild, async binding => {
      const sourceChild = randomUUID();
      const prepared = await memory.prepareImportedSummary(binding, randomUUID(), { section: 'summary_history', childId: sourceChild,
        value: { id: randomUUID(), childId: sourceChild, version: 1, text: 'SECRET_PRIVATE_SUMMARY', createdAt: at, previousId: null,
          coveredMessageIds: [privateMessage.id], lastCoveredMessageId: privateMessage.id, sourcePeriod: { from: at, to: at } },
        source: { serverId: 'https://original-summary.test', accountId: 'original-parent', packageId: randomUUID(), packageVersion: 1,
          manifestSha256: 'b'.repeat(64), path: 'data/summary.json', rowIndex: 0 } }, 'missing_proof');
      prepared.commit();
    });
    const notes = createFirestorePrivateInstructions(new FirestoreDomainData(options));
    await authority.runTransaction('teacher', personalChild, async binding => {
      const prepared = await notes.prepareWrite(binding, randomUUID(), { id: randomUUID(), childId: personalChild, version: 1,
        title: 'SECRET_PRIVATE_INSTRUCTION', text: 'SECRET_PRIVATE_BODY', sourceMessageId: randomUUID(), provenance: 'user_statement', createdAt: at, updatedAt: at }, null);
      prepared.commit();
    });
    const documents = createFirestoreFamilyDocumentStore(options), classDocuments = documents.forSharedSpace({ spaceId: classroom.id });
    const hkDay = (value: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong',
      year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
    const preparations = createFirestoreCareSummary(options, care);
    const preparationPeriod = { startDay: hkDay(new Date(Date.parse(at) + 86400000).toISOString()),
      period: 'day' as const, timeZone: 'Asia/Hong_Kong' };
    const preparationSourceChild = randomUUID(), preparationSourcePackage = randomUUID();
    async function savePreparation(childId: string, question: string, expectedVersion: number, shared = true) {
      const row: HandoverImportRow = { section: 'visit_preparation', childId: preparationSourceChild,
        value: { childId: preparationSourceChild, version: expectedVersion + 1, appointmentTaskId: null,
          questions: [question], checklist: [{ text: 'Bring original notes', done: true }], reviewed: true, reviewedBasis: 'original-epoch:42',
          period: preparationPeriod, updatedBy: 'original-parent', updatedAt: at },
        source: { serverId: 'https://original-preparation.test', accountId: 'original-parent', packageId: preparationSourcePackage,
          packageVersion: 1, manifestSha256: 'a'.repeat(64), path: 'data/preparation.json', rowIndex: expectedVersion } };
      const save = async (binding: Parameters<typeof preparations.prepareImported>[0]) => {
        const prepared = await preparations.prepareImported(binding, randomUUID(), row, 'missing_proof', expectedVersion);
        prepared.commit();
      };
      // The shared summary form is not connected; seed through its existing import/domain adapter.
      if (shared) await sharing.withResource('teacher', { spaceId: classroom.id, childId, module: 'documents', mode: 'write' }, access => save(access.binding));
      else await authority.runTransaction('teacher', childId, save);
    }
    await savePreparation(selected.child.id, 'Original legacy visit question', 0);
    await savePreparation(selected.child.id, 'Updated legacy visit question', 1);
    await savePreparation(other.child.id, 'SECRET_OTHER_VISIT_PREPARATION', 0);
    await savePreparation(personalChild, 'SECRET_PERSONAL_VISIT_PREPARATION', 0, false);
    const savedPreparation = await sharing.withResource('teacher', { spaceId: classroom.id, childId: selected.child.id,
      module: 'documents', mode: 'read' }, async access => (await preparations.readImportState(access.binding)).value!);
    assert.deepEqual(savedPreparation.questions, ['Updated legacy visit question']);
    const documentRequest = { kind: 'preparation' as const, purpose: 'appointment' as const, title: 'Cross-period class document',
      eventDate: null, period: { from: hkDay(at), to: hkDay(new Date(Date.parse(at) + 3 * 86400000).toISOString()) } };
    let classDocument = (await classDocuments.create('teacher', selected.child.id, documentRequest, randomUUID()))!;
    await classDocuments.create('teacher', other.child.id, { ...documentRequest, title: 'SECRET_OTHER_DOCUMENT' }, randomUUID());
    await documents.create('teacher', personalChild, { ...documentRequest, title: 'SECRET_PERSONAL_DOCUMENT' }, randomUUID());
    const nativeData = new FirestoreDomainData(options);
    const growth = createFirestoreGrowthStore({ ...options, care, memory, online });
    // Seed existing encrypted storage formats: shared concern/growth mutation routes are still read-only.
    async function nativeRows(childId: string, write: (binding: Parameters<typeof memory.prepareConfirmedFact>[0]) => void, shared = true) {
      const save = async (binding: Parameters<typeof memory.prepareConfirmedFact>[0]) => {
        const change = await binding.prepareChange(randomUUID(), 'growth', false); write(binding); change.commit();
      };
      if (shared) await sharing.withResource('teacher', { spaceId: classroom.id, childId, module: 'growth', mode: 'write' }, access => save(access.binding));
      else await authority.runTransaction('teacher', childId, save);
    }
    async function concernRows(childId: string, title: string, observations: readonly (readonly [string, string])[], shared = true) {
      const id = randomUUID();
      await nativeRows(childId, binding => {
        const head = firestoreConcernSchema.parse({ id, childId, title, reason: 'SECRET_PARENT_CONCERN_REASON', status: 'following',
          version: observations.length, createdAt: at, updatedAt: at, archivedAt: null, attentionIds: [], eventCount: observations.length, followUp: null });
        const tags = { ...nativeData.tags(binding.scope), concernId: id, entityVersion: head.version, createdAt: at };
        binding.transaction.create(nativeData.ref('concerns', 'concern', id),
          { ...tags, ...nativeData.seal('concern', id, binding.scope, firestoreConcernSchema, head, head.version) });
        observations.forEach(([observedAt, text], index) => {
          const event = firestoreDocumentConcernEventSchema.parse({ id: randomUUID(), concernId: id, childId, sequence: index + 1,
            at: observedAt, kind: 'observation', title: 'Class observation', text, sourceLabel: 'Original class observation', actorUserId: 'teacher' });
          binding.transaction.create(nativeData.ref('concern_events', 'concern-event', event.id), { ...nativeData.tags(binding.scope),
            concernId: id, eventId: event.id, sequence: event.sequence,
            ...nativeData.seal('concern-event', event.id, binding.scope, firestoreDocumentConcernEventSchema, event) });
          const revision = { ...head, version: index + 1, eventCount: index + 1 }, key = JSON.stringify([id, revision.version]);
          binding.transaction.create(nativeData.ref('concern_revisions', 'concern-revision', key), { ...tags, entityVersion: revision.version,
            ...nativeData.seal('concern-revision', key, binding.scope, firestoreConcernSchema, revision, revision.version) });
        });
      }, shared);
      return id;
    }
    const concernId = await concernRows(selected.child.id, 'Cross-period class concern', [
      [new Date(Date.parse(period.from) - 1).toISOString(), 'SECRET_CONCERN_BEFORE'],
      [period.from, 'First selected class observation'], [period.to, 'Last selected class observation'],
      [new Date(Date.parse(period.to) + 1).toISOString(), 'SECRET_CONCERN_AFTER'],
    ]);
    await concernRows(other.child.id, 'SECRET_OTHER_CONCERN', [[at, 'SECRET_OTHER_CONCERN_OBSERVATION']]);
    await concernRows(personalChild, 'SECRET_PERSONAL_CONCERN', [[at, 'SECRET_PERSONAL_CONCERN_OBSERVATION']], false);
    async function growthRows(childId: string, title: string, selectedRefs = false, shared = true) {
      const item = { id: randomUUID(), childId, topicId: 'solid_food', version: 1, state: 'accepted', title, kind: 'arrange',
        whyNow: 'Original class reason', advice: 'Unverified stored advice', limits: 'Original limitations',
        basis: { stage: 'infant-solids', ruleRevision: 'synthetic-rule', sourceHash: 'c'.repeat(64),
          values: selectedRefs ? { preference: 'GROWTH_MEMORY_REFERENCE_VALUE' } : {} },
        evidence: { profileVersion: selectedRefs ? profile.version : 0, facts: selectedRefs ? [{ id: classFact.id, version: classFact.version }] : [] },
        source: { sourceId: 'unverified-class-source', versionId: randomUUID(), chunkId: randomUUID(), contentHash: 'c'.repeat(64),
          url: 'https://example.test/unverified', title: 'Unverified original source', section: 'one', checkedAt: at, excerpt: 'Original unverified evidence' },
        sourceAvailable: true, createdAt: at, updatedAt: at, snoozeUntil: null, previousId: null, newReason: 'Original reason',
        taskId: selectedRefs ? task.id : null, taskState: selectedRefs ? 'scheduled' : null, lastAction: 'accept', actorUserId: 'teacher', note: 'Original class outcome' };
      const saved = firestoreGrowthSchema.parse({ item, lastRequest: null });
      await nativeRows(childId, binding => {
        const tags = { ...nativeData.tags(binding.scope), attentionId: item.id, createdAt: at, entityVersion: 1 };
        binding.transaction.create(nativeData.ref('growth_attention', 'growth-attention', item.id),
          { ...tags, ...nativeData.seal('growth-attention', item.id, binding.scope, firestoreGrowthSchema, saved, 1) });
        const key = JSON.stringify([item.id, 1]);
        binding.transaction.create(nativeData.ref('growth_revisions', 'growth-revision', key),
          { ...tags, ...nativeData.seal('growth-revision', key, binding.scope, firestoreGrowthSchema, saved, 1) });
      }, shared);
      return saved.item;
    }
    const growthItem = await growthRows(selected.child.id, 'Class growth with referenced inputs', true);
    await growthRows(other.child.id, 'SECRET_OTHER_GROWTH');
    await growthRows(personalChild, 'SECRET_PERSONAL_GROWTH', false, false);
    const stored = new Map<string, { body: Buffer; metadata: unknown }>();
    const objects = createFirebaseHandoverObjects({ config: { projectId: options.projectId, namespace: options.namespace, bucketName: 'synthetic-class-packages' },
      files: options.cipher.files, bucket: { async metadata(name) { return stored.get(name)?.metadata ?? null; },
        createWrite(name, settings) { const parts: Buffer[] = []; return new Writable({ write(chunk, _encoding, done) { parts.push(Buffer.from(chunk)); done(); },
          final(done) { const body = Buffer.concat(parts); stored.set(name, { body, metadata: { name, bucket: 'synthetic-class-packages', generation: '1',
            size: String(body.length), metadata: settings.metadata?.metadata } }); done(); } }); },
        readPinned(name) { return Readable.from([stored.get(name)!.body]); }, async removePinned(name) { stored.delete(name); } } });
    const exporter = createFirestoreAccountExport({ ...options, growth, photos: { async content() { throw Error('Unexpected attachment read'); } } });
    const service = createHandoverService({ ...options, exporter, objects, serverId: 'https://class-source.test', spoolRoot: directory });
    assert.deepEqual(service.capabilities().classModules, ['profile', 'care', 'tasks', 'memory', 'concerns', 'growth'], 'shared concerns and growth are available without document-review negotiation');
    assert.deepEqual(service.capabilities(true).classModules, ['profile', 'care', 'tasks', 'documents', 'memory', 'concerns', 'growth'], 'document-aware callers additionally request document capabilities');
    const baseCommand: HandoverClassExportCommand = { opId: randomUUID(), purpose: 'handover', source: { kind: 'class', spaceId: classroom.id },
      selection: { childIds: [selected.child.id], modules: ['care', 'profile', 'tasks', 'documents', 'memory', 'concerns', 'growth'], period } };
    const withoutGrowth = createHandoverService({ ...options, objects, serverId: 'https://class-source.test',
      exporter: createFirestoreAccountExport({ ...options, photos: { async content() { throw Error('Unexpected attachment read'); } } }) });
    assert.ok(!withoutGrowth.capabilities(true).classModules.includes('growth'));
    await assert.rejects(withoutGrowth.create('teacher', baseCommand), (error: any) => error.code === 'package_class_source_unavailable');
    const previewQuery = { section: 'documents' as const, childId: selected.child.id, period, source: baseCommand.source, opId: baseCommand.opId };
    const preview = await service.preview('teacher', previewQuery), previewItem = preview.items.find(item => item.id === classDocument.id)!;
    assert.ok(previewItem); assert.equal(previewItem.reason, 'crosses'); assert.equal(previewItem.defaultIncluded, false); assert.equal(previewItem.canInclude, true);
    assert.deepEqual(preview.items.map(item => item.id), [classDocument.id]);
    assert.doesNotMatch(JSON.stringify(preview), /SECRET_|Selected class observation|Class profile/);
    await assert.rejects(service.preview('outsider', previewQuery), (error: any) => error.status === 403);
    await assert.rejects(service.preview('teacher', { ...previewQuery, childId: personalChild }), (error: any) => error.status === 403);
    const pin = ({ section, childId, id, version, snapshotId, snapshotVersion }: typeof previewItem) =>
      ({ section, childId, id, version, snapshotId, snapshotVersion, include: true });
    const stale = { ...baseCommand, documentReview: { scopeVersion: preview.scopeVersion, choices: [pin(previewItem)] } };
    classDocument = (await classDocuments.change('teacher', selected.child.id, classDocument.id, { action: 'patch', expectedVersion: classDocument.version,
      authorityVersion: (await classDocuments.describe('teacher', selected.child.id, classDocument.id))!.authorityVersion, confirmShared: true,
      edits: [{ op: 'set_metadata', summary: 'Current full class document body' }] }, randomUUID()))!;
    await assert.rejects(service.create('teacher', stale), (error: any) => error.code === 'export_scope_changed');
    const refreshed = await service.preview('teacher', previewQuery), currentItem = refreshed.items.find(item => item.id === classDocument.id)!;
    assert.equal(currentItem.version, classDocument.version); assert.notEqual(refreshed.scopeVersion, preview.scopeVersion);
    assert.equal(currentItem.snapshotId, classDocument.current!.id);
    const preparationPreviewQuery = { ...previewQuery, section: 'visit_preparation' as const };
    const preparationPreview = await service.preview('teacher', preparationPreviewQuery);
    assert.equal(preparationPreview.scopeVersion, refreshed.scopeVersion);
    assert.equal(preparationPreview.items.length, 1);
    assert.deepEqual({ ...preparationPreview.items[0] }, { section: 'visit_preparation', childId: selected.child.id,
      id: selected.child.id, version: savedPreparation.version, snapshotId: null, snapshotVersion: null, title: '到診準備單',
      from: preparationPeriod.startDay, to: preparationPeriod.startDay, reason: 'inside', defaultIncluded: true, canInclude: true });
    assert.doesNotMatch(JSON.stringify(preparationPreview), /SECRET_|Updated legacy visit question|Bring original notes/);
    await assert.rejects(service.preview('outsider', preparationPreviewQuery), (error: any) => error.status === 403);
    await assert.rejects(service.preview('teacher', { ...preparationPreviewQuery, childId: personalChild }), (error: any) => error.status === 403);
    const command = { ...baseCommand, documentReview: { scopeVersion: refreshed.scopeVersion, choices: [pin(currentItem)] } };
    const created = await service.create('teacher', command);
    assert.equal(created.state, 'queued'); assert.deepEqual(await service.create('teacher', command), created);
    await assert.rejects(service.create('outsider', { ...command, opId: randomUUID() }), (error: any) => error.status === 403);
    await assert.rejects(service.create('teacher', { ...command, opId: randomUUID(), selection: { ...command.selection, childIds: [personalChild] } }));
    await assert.rejects(service.get('outsider', created.id));
    const codec = createFirestoreRestoreCodec(options);
    const work = [...fixture.records].filter(([path]) => path.startsWith(options.namespace + '_background_work/'))
      .map(([path, data]) => codec.decode({ path, data }).value as any).find(value => value.kind === 'handover-export' && value.resourceId === created.id);
    assert.ok(work); assert.equal(work.scope.ownerUserId, 'teacher', 'the export claim belongs to the real actor rather than the class storage identity');
    const authCalls: string[] = [];
    const workers = createFirebaseWorkerServices({ ...options, config: { projectId: options.projectId, namespace: options.namespace, taskWorkerEnabled: true },
      authority, handover: service, currentAuth: async (userId: string) => { authCalls.push(userId); assert.equal(userId, 'teacher');
        return { disabled: false, emailVerified: true, email: 'teacher@example.test' }; } } as any,
      { taskName: () => 'unused', async enqueue() { throw Error('Unexpected notification'); }, async probe() { throw Error('Unexpected notification'); } },
      { async enqueue() { return { state: 'confirmed' }; }, async probe() { return { state: 'confirmed' }; } }, controller);
    assert.equal((await workers.background.process({ kind: 'product-work', id: work.id, generation: work.generation,
      dispatchRevision: work.dispatchRevision, scheduledAt: work.dueAt })).state, 'completed');
    assert.ok(authCalls.length > 0);
    const ready = await service.get('teacher', created.id); assert.equal(ready.state, 'ready', ready.error ?? JSON.stringify(ready));
    assert.deepEqual(await service.create('teacher', command), ready); assert.equal(stored.size, 1);
    const downloaded = await service.download('teacher', created.id);
    try {
      const recipient = await openHandoverImport({ path: downloaded.path });
      try {
        assert.deepEqual(recipient.manifest.selection, command.selection);
        const { include: _include, ...includedPin } = pin(currentItem);
        assert.deepEqual(recipient.manifest.periodExceptions, [includedPin]);
        const page = await recipient.readPage({ selection: { childIds: [selected.child.id], modules: ['documents', 'memory', 'concerns', 'growth'] },
          acknowledgedManifestSha256: recipient.manifestSha256, limit: 100 });
        const heads = page.rows.filter(row => row.section === 'documents');
        assert.deepEqual(heads.map(row => row.value.id), [classDocument.id]);
        assert.deepEqual((await recipient.readDocumentContent(heads[0], recipient.manifestSha256))!.snapshot, classDocument.current);
        assert.deepEqual(page.rows.filter(row => row.section === 'document_versions').map(row => row.value.snapshotId), [classDocument.current!.id],
          'manual selection exports the pinned current snapshot rather than the pre-preview revision');
        assert.deepEqual(page.rows.filter(row => row.section === 'visit_preparation').map(row => row.value), [savedPreparation]);
        const preparationHistory = page.rows.filter(row => row.section === 'visit_preparation_history').map(row => row.value)
          .sort((a, b) => Number(a.version) - Number(b.version));
        assert.deepEqual(preparationHistory.map(row => row.questions), [['Original legacy visit question'], ['Updated legacy visit question']]);
        assert.ok(preparationHistory.every(row => row.childId === selected.child.id
          && JSON.stringify(row.period) === JSON.stringify(preparationPeriod)));
        assert.deepEqual(page.rows.filter(row => row.section === 'memory_facts').map(row => row.value), [classFact]);
        const factHistory = page.rows.filter(row => row.section === 'memory_fact_history').map(row => row.value)
          .sort((a, b) => Number(a.version) - Number(b.version));
        assert.deepEqual(factHistory.map(row => row.content), ['Original class family fact', 'Updated class family fact']);
        assert.ok(factHistory.every(row => row.childId === selected.child.id && row.visibility === 'family'));
        assert.ok(page.rows.filter(row => row.section.startsWith('memory_')).every(row => row.source.accountId === 'space:' + classroom.id));
        assert.equal(page.rows.some(row => row.section === 'instructions' || row.section === 'summary_history'), false);
        const concernHeads = page.rows.filter(row => row.section === 'concerns'); assert.equal(concernHeads.length, 1);
        assert.equal((concernHeads[0].value.periodSource as any).concernId, concernId);
        assert.deepEqual((await recipient.readConcernEvents(concernHeads[0], recipient.manifestSha256)).map(event => event.text),
          ['First selected class observation', 'Last selected class observation']);
        const exportedGrowth = page.rows.filter(row => row.section === 'growth_attention' || row.section === 'growth_history');
        assert.equal(exportedGrowth.length, 2);
        assert.ok(exportedGrowth.every(row => (row.value.item as any).id === growthItem.id && (row.value.item as any).sourceAvailable === false),
          'a stored availability flag is not proof of a locally reviewed source');
      } finally { await recipient.close(); }
      const archive = await openHandoverArchive({ path: downloaded.path });
      try {
        assert.equal(archive.manifest.source.accountId, 'space:' + classroom.id);
        assert.equal(archive.manifest.source.serverId, 'https://class-source.test');
        assert.deepEqual(archive.manifest.selection, command.selection);
        const pages: { section: string; childId: string | null; items: any[] }[] = [];
        for (const entry of archive.manifest.entries.filter(entry => entry.path.startsWith('data/')))
          pages.push(JSON.parse((await archive.readEntry(entry.path, entry.bytes)).toString('utf8')));
        const rows = (section: string) => pages.filter(page => page.section === section).flatMap(page => page.items);
        assert.deepEqual(rows('children').map(row => row.id), [selected.child.id]);
        assert.deepEqual(rows('care').map(row => row.id), [included.id]);
        assert.deepEqual(rows('profile').map(row => row.data), [profile.data]);
        assert.deepEqual(rows('tasks').map(row => row.id), [task.id]);
        assert.deepEqual(rows('documents').map(row => row.id), [classDocument.id]);
        assert.deepEqual(rows('visit_preparation'), [savedPreparation]); assert.equal(rows('visit_preparation_history').length, 2);
        assert.deepEqual(rows('memory_facts'), [classFact]); assert.equal(rows('memory_fact_history').length, 2);
        assert.deepEqual(rows('instructions'), []); assert.deepEqual(rows('summary_history'), []); assert.deepEqual(rows('chat'), []);
        assert.deepEqual(rows('concern_events').sort((a, b) => a.sequence - b.sequence).map(row => row.text),
          ['First selected class observation', 'Last selected class observation']);
        assert.equal(rows('growth_attention').length, 1); assert.equal(rows('growth_attention')[0].item.sourceAvailable, false);
        assert.ok(pages.filter(page => page.section !== 'children').every(page => page.childId === selected.child.id));
        assert.doesNotMatch(JSON.stringify(pages), /SECRET_|createdViaShare|confirmedViaShare|changedViaShare|classAssignment/);
        assert.ok(!JSON.stringify(pages).includes(earlier.id));
        assert.ok(!JSON.stringify(pages).includes(personalChild)); assert.ok(!JSON.stringify(pages).includes(other.child.id));
      } finally { await archive.close(); }
    } finally { await downloaded.dispose(); }
    const growthOnlyCommand: HandoverClassExportCommand = { ...baseCommand, opId: randomUUID(),
      selection: { childIds: [selected.child.id], modules: ['growth'], period } };
    const growthOnly = await writePersonalHandoverPackage({ directory, exporter: exporter.forClass(growthOnlyCommand), ownerUserId: 'teacher',
      sourceAccountId: 'space:' + classroom.id, serverId: 'https://class-source.test', packageId: growthOnlyCommand.opId,
      createdAt: at, purpose: 'handover', selection: growthOnlyCommand.selection });
    const growthReader = await openHandoverImport({ path: growthOnly.path });
    try {
      const page = await growthReader.readPage({ selection: { childIds: growthOnlyCommand.selection.childIds, modules: growthOnlyCommand.selection.modules },
        acknowledgedManifestSha256: growthReader.manifestSha256, limit: 100 });
      const currentAndHistory = page.rows.filter(row => row.section === 'growth_attention' || row.section === 'growth_history');
      assert.equal(currentAndHistory.length, 2);
      for (const row of currentAndHistory) {
        const item = row.value.item as any;
        assert.equal(item.id, growthItem.id); assert.equal(item.taskId, null); assert.equal(item.taskState, null);
        assert.deepEqual(item.evidence, { profileVersion: 0, facts: [] }); assert.deepEqual(item.basis.values, {});
        assert.equal(item.sourceAvailable, false);
      }
      assert.doesNotMatch(JSON.stringify(page.rows), /SECRET_|GROWTH_MEMORY_REFERENCE_VALUE/);
      assert.ok(!JSON.stringify(page.rows).includes(classFact.id)); assert.ok(!JSON.stringify(page.rows).includes(task.id));
    } finally { await growthReader.close(); }
    await assert.rejects(service.download('outsider', created.id));
    const currentClass = await sharing.get('manager', classroom.id);
    await sharing.updateMember('manager', { operationId: randomUUID(), spaceId: classroom.id, expectedVersion: currentClass.version,
      targetUserId: 'teacher', role: null });
    await assert.rejects(service.download('teacher', created.id), 'losing membership blocks the already-ready package');
    await assert.rejects(service.preview('teacher', previewQuery), (error: any) => error.status === 403);
    await assert.rejects(service.preview('teacher', preparationPreviewQuery), (error: any) => error.status === 403);
    assert.equal(stored.size, 1, 'revocation blocks access to the existing object rather than requiring a new export');
  } finally { controller.abort(); await rm(directory, { recursive: true, force: true }); }
});
