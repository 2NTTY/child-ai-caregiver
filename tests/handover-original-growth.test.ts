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
import { FirestoreDomainData } from '../server/firestore-domain-data.ts';
import { createFirestoreCareStore } from '../server/firestore-care.ts';
import { createFirestoreChatStore } from '../server/firestore-chat.ts';
import { createFirestoreMemoryStore } from '../server/firestore-memory.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirestoreGrowthStore, firestoreGrowthSchema, firestoreGrowthTopicSchema, growthTopicResourceId } from '../server/firestore-growth.ts';
import { createFirestoreAccountExport } from '../server/firestore-account-export.ts';
import { createFirebaseHandoverObjects } from '../server/firebase-handover-objects.ts';
import { createHandoverUploadService } from '../server/handover-upload-service.ts';
import { createHandoverImportService } from '../server/handover-import-service.ts';
import { createFirestoreBackgroundQueue } from '../server/firestore-background-work.ts';
import { createFirestoreRestoreCodec } from '../server/firestore-restore-codec.ts';
import { writePersonalHandoverPackage } from '../server/handover-export.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import type { GrowthTopicId } from '../src/shared/growth.ts';

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

test('signed own growth backups restore native notes and fixed topic suppression without reverting terminal decisions or replaying tasks', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'handover-original-growth-')), controller = new AbortController();
  try {
    const fixture = serialFirestoreFixture(), options = { database: fixture.database, cipher: createStorageCipher(Buffer.alloc(32, 201)),
      projectId: 'synthetic-own-growth', namespace: 'original_growth' };
    const authority = createFirestoreAuthority(options), data = new FirestoreDomainData(options), codec = createFirestoreRestoreCodec(options);
    await authority.initializeControl({ enabled: true, generation: randomUUID() });
    await authority.issueInvitation({ email: 'parent@example.test', operationId: randomUUID(), expiresAt: new Date(Date.now() + 3600000).toISOString() });
    await authority.admitIdentity({ userId: 'parent', email: 'parent@example.test', emailVerified: true });
    await authority.acknowledge({ userId: 'parent', operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
    const childId = (await authority.createChild({ userId: 'parent', operationId: randomUUID(), displayName: 'Original growth' })).child.id;
    const care = createFirestoreCareStore(options), memory = createFirestoreMemoryStore({ ...options, care, chat: createFirestoreChatStore(options) });
    const growth = createFirestoreGrowthStore({ ...options, care, memory, online: createFirestoreOnlineStore(options) });
    const at = new Date().toISOString();
    // Native rows reuse the existing growth-domain fixture. Knowledge/model admission is outside this restoration test.
    function attention(state: 'accepted' | 'proposed', note: string) {
      return firestoreGrowthSchema.parse({ item: { id: randomUUID(), childId, topicId: 'toddler_play', version: 2, state,
        title: 'Native growth item', kind: 'arrange', whyNow: 'Native reason', advice: 'Native source advice', limits: 'Native limits',
        basis: { stage: 'native-stage', ruleRevision: 'native-rule', sourceHash: 'b'.repeat(64), values: {} },
        evidence: { profileVersion: 0, facts: [] }, source: { sourceId: 'native-source', versionId: randomUUID(), chunkId: randomUUID(),
          contentHash: 'b'.repeat(64), url: 'https://example.test/source', title: 'Native source', section: 'one', checkedAt: at, excerpt: 'Native source text' },
        sourceAvailable: true, createdAt: at, updatedAt: at, snoozeUntil: null, previousId: null, newReason: 'Native reason',
        taskId: null, taskState: null, lastAction: state === 'accepted' ? 'accept' : 'propose', actorUserId: 'parent', note },
        lastRequest: state === 'accepted' ? { authorityVersion: 'old-authority', expectedVersion: 1, confirm: true, action: 'accept', task: { kind: 'create',
          values: { title: 'DO_NOT_REPLAY_OLD_TASK', details: 'Historical consent only', kind: 'ordinary', assigneeUserId: 'parent', dueAt: at, timeZone: 'Asia/Hong_Kong' } } } : null });
    }
    async function saveAttention(saved: ReturnType<typeof firestoreGrowthSchema.parse>) {
      await authority.runTransaction('parent', childId, async b => {
        const item = saved.item, revisionId = JSON.stringify([item.id, item.version]), change = await b.prepareChange(randomUUID(), 'growth', false);
        const tags = { ...data.tags(b.scope), attentionId: item.id, createdAt: item.createdAt, entityVersion: item.version };
        change.commit();
        b.transaction.set(data.ref('growth_attention', 'growth-attention', item.id), { ...tags,
          ...data.seal('growth-attention', item.id, b.scope, firestoreGrowthSchema, saved, item.version) });
        b.transaction.create(data.ref('growth_revisions', 'growth-revision', revisionId), { ...tags,
          ...data.seal('growth-revision', revisionId, b.scope, firestoreGrowthSchema, saved, item.version) });
      });
    }
    async function saveTopic(topicId: GrowthTopicId, disabled: boolean, version: number) {
      const value = firestoreGrowthTopicSchema.parse({ topicId, version, disabled, actor: 'parent', at,
        request: { authorityVersion: 'old-authority', expectedVersion: version - 1, confirm: true, action: 'set_enabled', enabled: !disabled } });
      await authority.runTransaction('parent', childId, async b => {
        const id = JSON.stringify([childId, topicId]), revisionId = JSON.stringify([childId, topicId, version]);
        const change = await b.prepareChange(randomUUID(), 'growth', false); change.commit();
        b.transaction.set(data.ref('growth_topics', 'growth-topic', id), { ...data.tags(b.scope),
          ...data.seal('growth-topic', id, b.scope, firestoreGrowthTopicSchema, value, version) });
        b.transaction.create(data.ref('growth_topic_revisions', 'growth-topic-revision', revisionId), { ...data.tags(b.scope),
          ...data.seal('growth-topic-revision', revisionId, b.scope, firestoreGrowthTopicSchema, value, version) });
      }); return value;
    }
    const sameState = attention('accepted', 'BACKUP_NOTE'), active = attention('proposed', 'BACKUP_ACTIVE'), missing = attention('accepted', 'BACKUP_MISSING');
    for (const value of [sameState, active, missing]) await saveAttention(value);
    await saveTopic('solid_food', false, 2); await saveTopic('school_vision', true, 2);
    const keys = generateKeyPairSync('ed25519'), serverId = 'https://original-growth.example.test';
    const exporter = createFirestoreAccountExport({ ...options, photos: { async content() { throw Error('No attachment in this backup'); } } });
    const archive = await writePersonalHandoverPackage({ directory, exporter, ownerUserId: 'parent', serverId,
      packageId: randomUUID(), createdAt: at, purpose: 'backup', signingKey: keys.privateKey,
      selection: { childIds: [childId], modules: ['growth'], period: null } });
    const laterSame = { ...sameState, item: { ...sameState.item, version: 3, note: 'LATER_NOTE' } };
    const terminal = { ...active, item: { ...active.item, version: 3, state: 'accepted' as const, note: 'KEEP_TERMINAL', lastAction: 'accept' } };
    await saveAttention(laterSame); await saveAttention(terminal);
    const suppressed = await saveTopic('solid_food', true, 3); await saveTopic('school_vision', false, 3);
    await authority.runTransaction('parent', childId, async b => { b.transaction.delete(data.ref('growth_attention', 'growth-attention', missing.item.id)); });
    const stored = new Map<string, { body: Buffer; metadata: unknown }>();
    const objects = createFirebaseHandoverObjects({ config: { projectId: options.projectId, namespace: options.namespace, bucketName: 'synthetic-growth-backups' },
      files: options.cipher.files, bucket: { async metadata(name) { return stored.get(name)?.metadata ?? null; },
        createWrite(name, settings) { const chunks: Buffer[] = []; return new Writable({ write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); },
          final(done) { const body = Buffer.concat(chunks); stored.set(name, { body, metadata: { name, bucket: 'synthetic-growth-backups', generation: '11111111111111111',
            size: String(body.length), metadata: settings.metadata?.metadata } }); done(); } }); },
        readPinned(name) { return Readable.from([stored.get(name)!.body]); }, async removePinned(name) { stored.delete(name); } } });
    const keyId = hash(keys.publicKey.export({ type: 'spki', format: 'der' }));
    const uploads = createHandoverUploadService({ ...options, objects, trustedKeys: new Map([[keyId, { key: keys.publicKey, serverId }]]) });
    const imports = createHandoverImportService({ ...options, uploads, originalBackup: { serverId, async matchesIssuedBackup() { return false; } } });
    const bytes = await readFile(archive.path), uploadId = randomUUID();
    await uploads.create('parent', { opId: uploadId, filename: 'own-growth.zip', bytes: bytes.length, sha256: hash(bytes) });
    const uploaded = await uploads.receive('parent', uploadId, Readable.from([bytes]), controller.signal);
    assert.equal(uploaded.state, 'ready', uploaded.error ?? JSON.stringify(uploaded)); assert.equal(uploaded.preview!.integrity, 'trusted');
    const request = { uploadId, expectedUploadVersion: uploaded.version, childId, module: 'growth', includeRestoreTarget: true };
    const beforeCompare = structuredClone([...fixture.records]);
    const comparison = await imports.compareOriginal('parent', request, controller.signal);
    const compared = [...comparison.items]; let cursor = comparison.nextCursor;
    for (let page = 0; cursor && page < 10; page++) {
      const next = await imports.compareOriginal('parent', { ...request, cursor }, controller.signal); compared.push(...next.items); cursor = next.nextCursor;
    }
    assert.equal(cursor, null); assert.deepEqual([...fixture.records], beforeCompare);
    const byId = new Map(compared.map(item => [item.id, item]));
    assert.equal(byId.get(sameState.item.id)?.resourceSection, 'growth_attention');
    assert.equal(byId.get(sameState.item.id)?.targetId, sameState.item.id); assert.equal(byId.get(sameState.item.id)?.localVersion, 3);
    assert.ok(byId.get(sameState.item.id)?.changedFields.includes('note'));
    assert.equal(byId.get(active.item.id)?.growth?.blocked, 'growth_terminal_state');
    assert.equal(byId.get(growthTopicResourceId(childId, 'solid_food'))?.growth?.blocked, 'growth_topic_disabled');
    assert.equal(byId.get(missing.item.id)?.growth?.blocked, 'original_unavailable');
    for (const topicId of ['solid_food', 'school_vision'] as const) {
      const id = growthTopicResourceId(childId, topicId); assert.equal(byId.get(id)?.resourceSection, 'growth_topics');
      assert.equal(byId.get(id)?.targetId, id); assert.equal(byId.get(id)?.backupVersion, 2); assert.equal(byId.get(id)?.localVersion, 3);
    }
    assert.equal(byId.get(missing.item.id)?.state, 'unavailable'); assert.equal(byId.get(missing.item.id)?.localVersion, null);
    assert.doesNotMatch(JSON.stringify(compared), /BACKUP_|LATER_NOTE|KEEP_TERMINAL/u);
    const command = { opId: randomUUID(), uploadId, expectedUploadVersion: uploaded.version, acceptedManifestSha256: comparison.manifestSha256,
      restoreOriginal: true, resolutionOnly: true, targets: [{ sourceChildId: childId, target: { childId, spaceId: null }, sections: ['growth'] }],
      resolutions: [
        ...[sameState.item, active.item, missing.item].map(item => ({ sourceChildId: childId, section: 'growth_attention', resourceId: item.id,
          resolution: { mode: 'replace_current', targetId: item.id, expectedVersion: byId.get(item.id)?.localVersion ?? item.version } })),
        ...(['solid_food', 'school_vision'] as const).map(topicId => ({ sourceChildId: childId, section: 'growth_topics', resourceId: growthTopicResourceId(childId, topicId),
          resolution: { mode: 'replace_current', targetId: growthTopicResourceId(childId, topicId), expectedVersion: 3 } })),
      ] };
    const tasksBefore = [...fixture.records].filter(([path]) => path.includes('_tasks/'));
    const started = await imports.create('parent', command, controller.signal); assert.equal(started.state, 'queued');
    const work = [...fixture.records].filter(([path]) => path.includes('_background_work/'))
      .map(([path, data]) => codec.decode({ path, data }).value as { id: string; kind: string; resourceId: string; generation: string; dispatchRevision: number; dueAt: string })
      .find(row => row.kind === 'handover-import' && row.resourceId === started.id); assert.ok(work);
    const queue = createFirestoreBackgroundQueue({ ...options, enabled: true, readControl: tx => authority.readControl(tx),
      transport: { async enqueue() { throw Error('No external queue'); }, async probe() { throw Error('Unexpected queue probe'); } },
      execute: (job, signal) => imports.process(job, signal) });
    const delivery = { kind: 'product-work' as const, id: work.id, generation: work.generation, dispatchRevision: work.dispatchRevision, scheduledAt: work.dueAt };
    assert.equal((await queue.process(delivery)).state, 'completed');
    const done = await imports.get('parent', command.opId); assert.equal(done.state, 'completed', done.error ?? JSON.stringify(done));
    assert.deepEqual(done.counts, { created: 0, updated: 2, skipped: 0, conflict: 3 });
    const sameAfter = await authority.runTransaction('parent', childId, b => growth.readImportAttention(b, sameState.item.id)); assert.ok(sameAfter);
    assert.equal(sameAfter.item.id, sameState.item.id); assert.equal(sameAfter.item.version, 4); assert.equal(sameAfter.item.state, 'accepted'); assert.equal(sameAfter.item.note, sameState.item.note);
    assert.deepEqual(sameAfter.item.source, sameState.item.source); assert.deepEqual(sameAfter.item.evidence, sameState.item.evidence);
    assert.deepEqual(await authority.runTransaction('parent', childId, b => growth.readImportAttention(b, active.item.id)), terminal);
    assert.deepEqual(await authority.runTransaction('parent', childId, b => growth.readImportTopic(b, 'solid_food')), suppressed);
    const disabled = await authority.runTransaction('parent', childId, b => growth.readImportTopic(b, 'school_vision')); assert.ok(disabled);
    assert.equal(disabled.disabled, true); assert.equal(disabled.version, 4);
    assert.equal(sameAfter.lastRequest, null);
    assert.equal(await authority.runTransaction('parent', childId, b => growth.readImportAttention(b, missing.item.id)), null);
    assert.deepEqual([...fixture.records].filter(([path]) => path.includes('_tasks/')), tasksBefore);
    const results = await imports.results('parent', command.opId, { sourceChildId: childId, module: 'growth' });
    assert.equal(results.complete, true);
    assert.equal(results.items.find(item => item.sourceResourceId === sameState.item.id)?.recordedResource?.id, sameState.item.id);
    assert.equal(results.items.find(item => item.sourceResourceId === growthTopicResourceId(childId, 'school_vision'))?.recordedResource?.id, growthTopicResourceId(childId, 'school_vision'));
    assert.equal(results.items.find(item => item.sourceResourceId === missing.item.id)?.reason, 'original_unavailable');
    const workKinds = [...fixture.records].filter(([path]) => path.includes('_background_work/'))
      .map(([path, data]) => (codec.decode({ path, data }).value as { kind: string }).kind);
    assert.equal(workKinds.includes('growth'), false, 'Historical acceptance cannot restart growth delivery');
    assert.equal(workKinds.some(kind => ['voice-transcription', 'push', 'native-push', 'telegram', 'contact'].includes(kind)), false);
    const beforeReplay = structuredClone([...fixture.records]);
    assert.deepEqual(await imports.create('parent', command, controller.signal), done);
    assert.equal((await queue.process(delivery)).state, 'completed'); assert.deepEqual([...fixture.records], beforeReplay);
  } finally { controller.abort(); await rm(directory, { recursive: true, force: true }); }
});
