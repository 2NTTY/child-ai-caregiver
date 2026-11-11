import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable, Writable } from 'node:stream';
import sharp from 'sharp';
import { avatarDomainFixture } from './helpers/avatar-memory.ts';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';
import { avatarReserveResultSchema } from '../src/shared/avatars.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import type { NotificationPreferences } from '../src/shared/family.ts';
import { createFirestoreAccountExport } from '../server/firestore-account-export.ts';
import { createFirebaseHandoverObjects } from '../server/firebase-handover-objects.ts';
import { createHandoverUploadService } from '../server/handover-upload-service.ts';
import { createHandoverImportService } from '../server/handover-import-service.ts';
import { createFirestoreBackgroundQueue } from '../server/firestore-background-work.ts';
import { createFirestoreRestoreCodec } from '../server/firestore-restore-codec.ts';
import { writePersonalHandoverPackage } from '../server/handover-export.ts';

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

test('signed childless account backups restore notification preferences with version consent and one operation, alone or beside an avatar', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'handover-account-preferences-')), controller = new AbortController();
  try {
    const f = await avatarDomainFixture({ fixture: serialFirestoreFixture(), codec: { async normalize(_owner, _input, _mime, _crop, recipe) {
      const buffer = await sharp({ create: { width: recipe.outputSize, height: recipe.outputSize, channels: 3, background: '#56789a' } })
        .jpeg({ quality: 85 }).toBuffer();
      return { buffer, bytes: buffer.length, sha256: hash(buffer), mimeType: 'image/jpeg', width: recipe.outputSize, height: recipe.outputSize };
    } } });
    const valuesA = { timeZone: 'Asia/Hong_Kong', quietStart: '21:30', quietEnd: '07:15', allowAppointmentDuringQuiet: true };
    const valuesB = { timeZone: 'UTC', quietStart: '23:00', quietEnd: '06:00', allowAppointmentDuringQuiet: false };
    async function writePreferences(values: Omit<NotificationPreferences, 'version'>, expectedVersion: number) {
      const receipt = await f.online.submit(f.owner, { path: '/api/notification-preferences', payload: { ...values, expectedVersion },
        operation: { opId: randomUUID(), deviceId: randomUUID(), workspaceId: f.scope.workspaceId, storageEpoch: f.scope.storageEpoch } });
      assert.equal(receipt.statusCode, 200);
      const saved = await f.online.notificationPreferences!(f.owner);
      assert.deepEqual(saved, { ...values, version: expectedVersion + 1 }); return saved;
    }
    assert.deepEqual((await f.online.children.list(f.owner)).children, []);
    const noAvatar = (await f.avatars.read(f.owner, f.target)).avatar;
    assert.equal(noAvatar.version, 0); assert.equal(noAvatar.asset, null);
    const original = await writePreferences(valuesA, 0);
    const serverId = 'https://account-preferences.example.test', keys = generateKeyPairSync('ed25519');
    const exporter = createFirestoreAccountExport({ ...f.options, avatars: f.avatars,
      photos: { async content() { throw Error('No child media in this childless backup'); } } });
    async function archive(preferencesVersion: number, avatarVersion?: number) {
      const written = await writePersonalHandoverPackage({ directory, exporter, ownerUserId: f.owner, serverId,
        packageId: randomUUID(), createdAt: new Date(f.now()).toISOString(), purpose: 'backup', signingKey: keys.privateKey,
        selection: { childIds: [], modules: [], period: null, notificationPreferences: { version: preferencesVersion },
          ...(avatarVersion === undefined ? {} : { accountAvatar: { version: avatarVersion } }) } });
      return readFile(written.path);
    }
    const bytes = await archive(original.version);
    const later = await writePreferences(valuesB, original.version);
    const stored = new Map<string, { body: Buffer; metadata: unknown }>();
    const objects = createFirebaseHandoverObjects({ config: { projectId: f.options.projectId, namespace: f.options.namespace,
      bucketName: 'synthetic-preference-backups' }, files: f.options.cipher.files, bucket: {
      async metadata(name) { return stored.get(name)?.metadata ?? null; },
      createWrite(name, settings) {
        const chunks: Buffer[] = [];
        return new Writable({ write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); }, final(done) {
          const body = Buffer.concat(chunks);
          stored.set(name, { body, metadata: { name, bucket: 'synthetic-preference-backups', generation: '11111111111111111',
            size: String(body.length), metadata: settings.metadata?.metadata } }); done();
        } });
      }, readPinned(name) { return Readable.from([stored.get(name)!.body]); }, async removePinned(name) { stored.delete(name); },
    } });
    const keyId = hash(keys.publicKey.export({ type: 'spki', format: 'der' }));
    const uploads = createHandoverUploadService({ ...f.options, objects, trustedKeys: new Map([[keyId, { key: keys.publicKey, serverId }]]) });
    const imports = createHandoverImportService({ ...f.options, uploads, originalBackup: { serverId, async matchesIssuedBackup() { return false; } },
      attachments: { avatars: { store: f.avatars, policy: f.config.policy } } });
    async function upload(owner: string, body: Buffer) {
      const uploadId = randomUUID();
      await uploads.create(owner, { opId: uploadId, filename: 'own-preferences.zip', bytes: body.length, sha256: hash(body) });
      const ready = await uploads.receive(owner, uploadId, Readable.from([body]), controller.signal);
      assert.equal(ready.state, 'ready', ready.error ?? JSON.stringify(ready)); assert.equal(ready.preview!.integrity, 'trusted');
      assert.deepEqual(ready.preview!.header.selection.childIds, []); assert.deepEqual(ready.preview!.header.selection.modules, []);
      return { uploadId, expectedUploadVersion: ready.version };
    }
    const request = await upload(f.owner, bytes), beforeCompare = structuredClone([...f.fake.records]);
    const comparison = await imports.compareNotificationPreferences(f.owner, request, controller.signal);
    assert.equal(comparison.uploadId, request.uploadId); assert.match(comparison.manifestSha256, /^[a-f0-9]{64}$/u);
    assert.equal(comparison.state, 'different'); assert.equal(comparison.backupVersion, original.version); assert.equal(comparison.localVersion, later.version);
    assert.deepEqual(comparison.backup, original); assert.deepEqual(comparison.current, later);
    assert.deepEqual([...f.fake.records], beforeCompare, 'Comparing preferences cannot write revisions, receipts or jobs');
    const base = { ...request, acceptedManifestSha256: comparison.manifestSha256, restoreOriginal: true, resolutionOnly: true, targets: [], resolutions: [],
      notificationPreferences: { expectedVersion: comparison.localVersion } };
    const codec = createFirestoreRestoreCodec(f.options);
    const queue = createFirestoreBackgroundQueue({ ...f.options, enabled: true, readControl: tx => f.authority.readControl(tx),
      transport: { async enqueue() { throw Error('No external queue in this synthetic execution'); }, async probe() { throw Error('Unexpected queue probe'); } },
      execute: (work, signal) => imports.process(work, signal) });
    async function process(id: string) {
      const work = [...f.fake.records].filter(([path]) => path.includes('_background_work/'))
        .map(([path, data]) => codec.decode({ path, data }).value as { id: string; kind: string; resourceId: string; generation: string; dispatchRevision: number; dueAt: string })
        .find(row => row.kind === 'handover-import' && row.resourceId === id); assert.ok(work);
      const delivery = { kind: 'product-work' as const, id: work.id, generation: work.generation, dispatchRevision: work.dispatchRevision, scheduledAt: work.dueAt };
      assert.equal((await queue.process(delivery)).state, 'completed');
      const done = await imports.get(f.owner, id); assert.equal(done.state, 'completed', done.error ?? JSON.stringify(done));
      const settled = structuredClone([...f.fake.records]);
      assert.equal((await queue.process(delivery)).state, 'completed');
      assert.deepEqual([...f.fake.records], settled, 'The completed worker delivery cannot write preferences again');
      return done;
    }
    const command = { ...base, opId: randomUUID() };
    const started = await imports.create(f.owner, command, controller.signal); assert.equal(started.state, 'queued');
    const done = await process(started.id);
    assert.equal(done.totalItems, 1); assert.equal(done.processedItems, 1); assert.deepEqual(done.counts, { created: 0, updated: 1, skipped: 0, conflict: 0 });
    const restored = await f.online.notificationPreferences!(f.owner);
    assert.deepEqual(restored, { ...valuesA, version: later.version + 1 });
    assert.deepEqual((await f.avatars.read(f.owner, f.target)).avatar, noAvatar);
    const beforeReplay = structuredClone([...f.fake.records]);
    assert.deepEqual(await imports.create(f.owner, command, controller.signal), done);
    assert.deepEqual([...f.fake.records], beforeReplay, 'Replaying the same opId cannot write another preference version or receipt');
    const unchanged = await imports.compareNotificationPreferences(f.owner, request, controller.signal);
    assert.equal(unchanged.state, 'unchanged'); assert.deepEqual(unchanged.current, restored);
    const stale = await imports.create(f.owner, { ...base, opId: randomUUID() }, controller.signal);
    const conflicted = await process(stale.id);
    assert.deepEqual(conflicted.counts, { created: 0, updated: 0, skipped: 0, conflict: 1 });
    assert.deepEqual(await f.online.notificationPreferences!(f.owner), restored, 'A version changed since comparison cannot be overwritten');

    const other = 'other-preferences-owner', email = 'other-preferences-owner@example.test';
    await f.authority.issueInvitation({ email, operationId: randomUUID(), expiresAt: new Date(f.now() + 86400000).toISOString() });
    await f.authority.admitIdentity({ userId: other, email, emailVerified: true });
    await f.authority.acknowledge({ userId: other, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
    const foreign = await upload(other, bytes), otherPreferences = await f.online.notificationPreferences!(other), beforeForeign = structuredClone([...f.fake.records]);
    await assert.rejects(imports.compareNotificationPreferences(other, foreign, controller.signal), { code: 'package_original_unverified', status: 403 });
    await assert.rejects(imports.create(other, { ...base, ...foreign, opId: randomUUID(), notificationPreferences: { expectedVersion: otherPreferences.version } }, controller.signal),
      { code: 'package_original_unverified', status: 403 });
    assert.deepEqual([...f.fake.records], beforeForeign); assert.deepEqual(await f.online.notificationPreferences!(other), otherPreferences);

    // Both account phases must run: restoring an avatar cannot finish a batch before its preferences.
    const reserved = avatarReserveResultSchema.parse((await f.online.submit(f.owner, f.reserve())).result).upload;
    await f.upload(reserved.id); await f.online.submit(f.owner, f.submission('commit', { uploadId: reserved.id, expectedVersion: 0 }));
    const originalAvatar = (await f.avatars.read(f.owner, f.target)).avatar; assert.ok(originalAvatar.asset);
    const combinedBytes = await archive(restored.version, originalAvatar.version);
    const combinedLater = await writePreferences(valuesB, restored.version);
    await f.online.submit(f.owner, f.submission('remove', { expectedVersion: originalAvatar.version, confirmRemove: true }));
    const deletedAvatar = (await f.avatars.read(f.owner, f.target)).avatar;
    const combinedRequest = await upload(f.owner, combinedBytes);
    const combinedComparison = await imports.compareNotificationPreferences(f.owner, combinedRequest, controller.signal);
    assert.equal(combinedComparison.state, 'different'); assert.deepEqual(combinedComparison.backup, restored); assert.deepEqual(combinedComparison.current, combinedLater);
    const combinedCommand = { ...combinedRequest, opId: randomUUID(), acceptedManifestSha256: combinedComparison.manifestSha256,
      restoreOriginal: true, resolutionOnly: true, targets: [], resolutions: [], notificationPreferences: { expectedVersion: combinedLater.version },
      accountAvatar: { expectedVersion: deletedAvatar.version, mode: 'restore_deleted' } };
    const combinedStarted = await imports.create(f.owner, combinedCommand, controller.signal), combinedDone = await process(combinedStarted.id);
    assert.equal(combinedDone.totalItems, 2); assert.equal(combinedDone.processedItems, 2); assert.equal(combinedDone.counts.conflict, 0);
    assert.equal(combinedDone.counts.created + combinedDone.counts.updated, 2);
    assert.deepEqual(await f.online.notificationPreferences!(f.owner), { ...valuesA, version: combinedLater.version + 1 });
    const combinedAvatar = (await f.avatars.read(f.owner, f.target)).avatar;
    assert.equal(combinedAvatar.version, deletedAvatar.version + 1); assert.equal(combinedAvatar.asset?.sha256, originalAvatar.asset.sha256);
    assert.deepEqual((await f.online.children.list(f.owner)).children, []);
    const beforeCombinedReplay = structuredClone([...f.fake.records]), writes = f.bucket.writes();
    assert.deepEqual(await imports.create(f.owner, combinedCommand, controller.signal), combinedDone);
    assert.deepEqual([...f.fake.records], beforeCombinedReplay); assert.equal(f.bucket.writes(), writes);
    const workKinds = [...f.fake.records].filter(([path]) => path.includes('_background_work/'))
      .map(([path, data]) => (codec.decode({ path, data }).value as { kind: string }).kind);
    assert.ok(workKinds.every(kind => ['handover-import', 'handover-upload-cleanup', 'avatar-cleanup'].includes(kind)),
      'Preference restoration cannot enqueue model or notification work: ' + JSON.stringify(workKinds));
  } finally { controller.abort(); await rm(directory, { recursive: true, force: true }); }
});
