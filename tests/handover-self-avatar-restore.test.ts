import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable, Writable } from 'node:stream';
import sharp from 'sharp';
import { z } from 'zod';
import { avatarDomainFixture } from './helpers/avatar-memory.ts';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';
import { avatarReserveResultSchema } from '../src/shared/avatars.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { createFirestoreAccountExport } from '../server/firestore-account-export.ts';
import { createFirebaseHandoverObjects } from '../server/firebase-handover-objects.ts';
import { createHandoverUploadService } from '../server/handover-upload-service.ts';
import { createHandoverImportService } from '../server/handover-import-service.ts';
import { createFirestoreBackgroundQueue } from '../server/firestore-background-work.ts';
import { createFirestoreRestoreCodec } from '../server/firestore-restore-codec.ts';
import { handleFirebaseAccountData } from '../server/firebase-account-data-api.ts';
import { writePersonalHandoverPackage } from '../server/handover-export.ts';
import { avatarBinding } from '../server/avatar-data.ts';
import { makeImportProvenance } from '../server/handover-provenance.ts';
import type { ImportProvenance } from '../src/shared/import-provenance.ts';

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const comparisonSchema = z.object({ uploadId: z.uuid(), manifestSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  backupVersion: z.number().int().nonnegative(), localVersion: z.number().int().nonnegative().nullable(),
  state: z.enum(['empty_backup', 'unchanged', 'missing', 'different', 'deleted']) }).strict();

test('a signed personal backup restores the same child avatar bytes without replacing the account avatar or granting another target', async () => {
  for (const hasBackupLineage of [false, true]) {
  const directory = await mkdtemp(join(tmpdir(), 'handover-child-avatar-original-'));
  try {
    let normalizations = 0;
    const images: Buffer[] = [];
    const f = await avatarDomainFixture({ fixture: serialFirestoreFixture(), codec: { async normalize(_owner, _input, _mime, _crop, recipe) {
      const buffer = await sharp({ create: { width: recipe.outputSize, height: recipe.outputSize, channels: 3,
        background: normalizations++ === 0 ? '#b82d2d' : '#245db8' } }).jpeg({ quality: 85 }).toBuffer();
      images.push(Buffer.from(buffer));
      return { buffer, bytes: buffer.length, sha256: hash(buffer), mimeType: 'image/jpeg', width: recipe.outputSize, height: recipe.outputSize };
    } } });
    const childId = (await f.authority.createChild({ userId: f.owner, operationId: randomUUID(), displayName: 'Original avatar child' })).child.id;
    const otherChildId = (await f.authority.createChild({ userId: f.owner, operationId: randomUUID(), displayName: 'Unselected avatar child' })).child.id;
    const target = { kind: 'child' as const, childId }, otherTarget = { kind: 'child' as const, childId: otherChildId };
    for (const selected of [f.target, target]) {
      const reservation = avatarReserveResultSchema.parse((await f.online.submit(f.owner, f.reserve(0, selected))).result).upload;
      await f.upload(reservation.id, selected);
      await f.online.submit(f.owner, f.submission('commit', { uploadId: reservation.id, expectedVersion: 0 }, selected));
    }
    const account = (await f.avatars.read(f.owner, f.target)).avatar, original = (await f.avatars.read(f.owner, target)).avatar;
    assert.ok(account.asset); assert.ok(original.asset); assert.notEqual(original.asset.sha256, account.asset.sha256);
    function lineage(label: string) {
      const sourceChildId = randomUUID();
      return makeImportProvenance({ section: 'child_avatar', childId: sourceChildId,
        value: { ...original, target: { kind: 'child', childId: sourceChildId } }, source: {
          serverId: `https://${label}.example.test`, accountId: label, packageId: randomUUID(), packageVersion: 1,
          manifestSha256: 'a'.repeat(64), path: 'data/child-avatar.json', rowIndex: 0 } }, 'trusted', f.owner, new Date(f.now()).toISOString());
    }
    async function setLineage(importedFrom: ImportProvenance) {
      await f.authority.runTransaction(f.owner, childId, async b => {
        const head = await f.data.head(b, avatarBinding(b.scope, target));
        f.data.prepareHead(b, { ...head, importedFrom })();
      });
    }
    const backupLineage = hasBackupLineage ? lineage('original-backup-picture') : undefined;
    if (backupLineage) await setLineage(backupLineage);
    const serverId = 'https://child-avatar.example.test', keys = generateKeyPairSync('ed25519');
    const exporter = createFirestoreAccountExport({ ...f.options, avatars: f.avatars,
      photos: { async content() { throw Error('No ordinary photos in this backup'); } } });
    const archive = await writePersonalHandoverPackage({ directory, exporter, ownerUserId: f.owner, serverId,
      packageId: randomUUID(), createdAt: new Date(f.now()).toISOString(), purpose: 'backup', signingKey: keys.privateKey,
      selection: { childIds: [childId], modules: ['attachments'], period: null, accountAvatar: { version: account.version } } });
    const bytes = await readFile(archive.path), stored = new Map<string, { body: Buffer; metadata: any }>();
    const objects = createFirebaseHandoverObjects({ config: { projectId: f.options.projectId, namespace: f.options.namespace,
      bucketName: 'synthetic-child-avatar-backups' }, files: f.options.cipher.files, bucket: {
      async metadata(name) { return stored.get(name)?.metadata ?? null; },
      createWrite(name, settings) {
        const chunks: Buffer[] = [];
        return new Writable({ write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); }, final(done) {
          const body = Buffer.concat(chunks);
          stored.set(name, { body, metadata: { name, bucket: 'synthetic-child-avatar-backups', generation: '11111111111111111',
            size: String(body.length), metadata: settings.metadata?.metadata } }); done();
        } });
      }, readPinned(name) { return Readable.from([stored.get(name)!.body]); }, async removePinned(name) { stored.delete(name); },
    } });
    const keyId = hash(keys.publicKey.export({ type: 'spki', format: 'der' }));
    const uploads = createHandoverUploadService({ ...f.options, objects, trustedKeys: new Map([[keyId, { key: keys.publicKey, serverId }]]) });
    const service = createHandoverImportService({ ...f.options, uploads, originalBackup: { serverId, async matchesIssuedBackup() { return false; } },
      attachments: { avatars: { store: f.avatars, policy: f.config.policy } } });
    async function upload(owner: string) {
      const uploadId = randomUUID();
      await uploads.create(owner, { opId: uploadId, filename: 'child-avatar.zip', bytes: bytes.length, sha256: hash(bytes) });
      const ready = await uploads.receive(owner, uploadId, Readable.from([bytes]), new AbortController().signal);
      assert.equal(ready.state, 'ready', ready.error ?? JSON.stringify(ready));
      return { uploadId, expectedUploadVersion: ready.version };
    }
    const request = await upload(f.owner);
    async function compare(input = request, owner = f.owner) {
      const response = await handleFirebaseAccountData(new Request(serverId + '/api/account/package-imports/compare-original', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-expected-user-id': owner },
        body: JSON.stringify({ ...input, childId, module: 'attachments', includeRestoreTarget: true }),
      }), { getSession: async () => ({ user: { id: owner } }) } as any, { packageImports: service } as any, req => req.json());
      assert.ok(response); assert.equal(response.status, 200);
      const page = await response.json();
      assert.equal(page.module, 'attachments'); assert.equal(page.items.length, 1); assert.equal(page.nextCursor, null);
      assert.equal(page.items[0].resourceSection, 'child_avatar'); assert.equal(page.items[0].id, childId); assert.equal(page.items[0].targetId, childId);
      return page;
    }
    const initial = await compare(); assert.equal(initial.items[0].state, 'unchanged');
    const replacedLineage = lineage('later-replaced-picture');
    await setLineage(replacedLineage);
    await f.online.submit(f.owner, f.submission('remove', { expectedVersion: original.version, confirmRemove: true }, target));
    assert.equal((await f.avatars.read(f.owner, target)).avatar.asset, null);
    await assert.rejects(f.avatars.content(f.owner, target, original.asset.id, original.version), { code: 'not_found', status: 404 });
    const beforeCompare = structuredClone([...f.fake.records]), deleted = await compare();
    assert.equal(deleted.items[0].state, 'deleted'); assert.equal(deleted.items[0].backupVersion, original.version);
    assert.equal(deleted.items[0].localVersion, original.version + 1); assert.deepEqual([...f.fake.records], beforeCompare);
    const command = { ...request, opId: randomUUID(), restoreOriginal: true, resolutionOnly: true, acceptedManifestSha256: initial.manifestSha256,
      targets: [{ sourceChildId: childId, target: { childId, spaceId: null }, sections: ['attachments'] }],
      resolutions: [{ sourceChildId: childId, section: 'child_avatar', resourceId: childId,
        resolution: { mode: 'restore_deleted', targetId: childId, expectedVersion: deleted.items[0].localVersion } }] };
    await assert.rejects(service.create(f.owner, { ...command, opId: randomUUID(), targets: [{ ...command.targets[0],
      target: { childId: otherChildId, spaceId: null } }] }, new AbortController().signal), { code: 'invalid_input' });
    const other = 'another-child-avatar-owner', email = 'another-child-avatar-owner@example.test';
    await f.authority.issueInvitation({ email, operationId: randomUUID(), expiresAt: new Date(f.now() + 86400000).toISOString() });
    await f.authority.admitIdentity({ userId: other, email, emailVerified: true });
    await f.authority.acknowledge({ userId: other, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
    const foreign = await upload(other);
    await assert.rejects(compare(foreign, other), { code: 'package_original_unverified', status: 403 });
    await assert.rejects(service.create(other, { ...command, ...foreign, opId: randomUUID() }, new AbortController().signal),
      { code: 'package_original_unverified', status: 403 });
    const started = await service.create(f.owner, command, new AbortController().signal), codec = createFirestoreRestoreCodec(f.options);
    const queue = createFirestoreBackgroundQueue({ ...f.options, enabled: true, readControl: tx => f.authority.readControl(tx),
      transport: { async enqueue() { throw Error('No external queue in this synthetic execution'); }, async probe() { throw Error('Unexpected queue probe'); } },
      execute: (work, signal) => service.process(work, signal) });
    const work = [...f.fake.records].filter(([path]) => path.includes('_background_work/'))
      .map(([path, data]) => codec.decode({ path, data }).value as any).find(row => row.kind === 'handover-import' && row.resourceId === started.id);
    assert.ok(work);
    assert.equal((await queue.process({ kind: 'product-work', id: work.id, generation: work.generation,
      dispatchRevision: work.dispatchRevision, scheduledAt: work.dueAt })).state, 'completed');
    const done = await service.get(f.owner, started.id); assert.equal(done.state, 'completed', done.error ?? JSON.stringify(done));
    assert.equal(done.totalItems, 1); assert.equal(done.processedItems, 1); assert.equal(done.counts.conflict, 0);
    assert.equal(done.counts.created + done.counts.updated, 1);
    const restored = (await f.avatars.read(f.owner, target)).avatar; assert.ok(restored.asset);
    assert.equal(restored.target.kind, 'child'); assert.equal(restored.version, deleted.items[0].localVersion + 1);
    assert.equal(restored.asset.sha256, original.asset.sha256);
    const restoredHead = await f.authority.runTransaction(f.owner, childId, b => f.data.head(b, avatarBinding(b.scope, target)));
    assert.deepEqual(restoredHead.importedFrom, backupLineage,
      'Restoring the original picture uses only its backup lineage, never the overwritten picture lineage');
    const content = await f.avatars.content(f.owner, target, restored.asset.id, restored.version);
    try { assert.deepEqual(content.buffer, images[1]); } finally { content.buffer.fill(0); }
    assert.equal(normalizations, 2, 'Already normalized original JPEG bytes must not pass through the ordinary copy encoder');
    assert.deepEqual((await f.avatars.read(f.owner, f.target)).avatar, account);
    assert.equal((await f.avatars.read(f.owner, otherTarget)).avatar.version, 0);
    assert.equal((await compare()).items[0].state, 'unchanged');
    const writes = f.bucket.writes(), beforeReplay = structuredClone([...f.fake.records]);
    assert.deepEqual(await service.create(f.owner, command, new AbortController().signal), done);
    assert.deepEqual([...f.fake.records], beforeReplay); assert.equal(f.bucket.writes(), writes);
    assert.equal((await f.avatars.read(f.owner, target)).avatar.version, restored.version);
  } finally { await rm(directory, { recursive: true, force: true }); }
  }
});

test('a signed childless personal backup restores only its owner avatar after explicit deletion consent and replays one operation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'handover-self-avatar-restore-'));
  try {
    let normalized: Buffer;
    const f = await avatarDomainFixture({ fixture: serialFirestoreFixture(), codec: { async normalize(_owner, _input, _mime, _crop, recipe) {
      normalized = await sharp({ create: { width: recipe.outputSize, height: recipe.outputSize, channels: 3,
        background: '#56789a' } }).jpeg({ quality: 85 }).toBuffer();
      return { buffer: Buffer.from(normalized), bytes: normalized.length, sha256: hash(normalized), mimeType: 'image/jpeg',
        width: recipe.outputSize, height: recipe.outputSize };
    } } });
    const other = 'other-avatar-parent', email = 'other-avatar-parent@example.test';
    await f.authority.issueInvitation({ email, operationId: randomUUID(), expiresAt: new Date(f.now() + 86400000).toISOString() });
    await f.authority.admitIdentity({ userId: other, email, emailVerified: true });
    await f.authority.acknowledge({ userId: other, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
    const reserved = avatarReserveResultSchema.parse((await f.online.submit(f.owner, f.reserve())).result).upload;
    await f.upload(reserved.id);
    await f.online.submit(f.owner, f.submission('commit', { uploadId: reserved.id, expectedVersion: 0 }));
    const original = (await f.avatars.read(f.owner, f.target)).avatar;
    assert.ok(original.asset);
    const serverId = 'https://self-avatar.example.test', keys = generateKeyPairSync('ed25519');
    const exporter = createFirestoreAccountExport({ ...f.options, avatars: f.avatars,
      photos: { async content() { throw Error('No child media in this childless backup'); } } });
    const archive = await writePersonalHandoverPackage({ directory, exporter, ownerUserId: f.owner, serverId,
      packageId: randomUUID(), createdAt: new Date(f.now()).toISOString(), purpose: 'backup', signingKey: keys.privateKey,
      selection: { childIds: [], modules: [], period: null, accountAvatar: { version: original.version } } });
    const bytes = await readFile(archive.path), stored = new Map<string, { body: Buffer; metadata: any }>();
    const objects = createFirebaseHandoverObjects({ config: { projectId: f.options.projectId, namespace: f.options.namespace,
      bucketName: 'synthetic-self-avatar-backups' }, files: f.options.cipher.files, bucket: {
      async metadata(name) { return stored.get(name)?.metadata ?? null; },
      createWrite(name, settings) {
        const chunks: Buffer[] = [];
        return new Writable({ write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); }, final(done) {
          const body = Buffer.concat(chunks);
          stored.set(name, { body, metadata: { name, bucket: 'synthetic-self-avatar-backups', generation: '11111111111111111',
            size: String(body.length), metadata: settings.metadata?.metadata } }); done();
        } });
      },
      readPinned(name) { return Readable.from([stored.get(name)!.body]); },
      async removePinned(name) { stored.delete(name); },
    } });
    const keyId = hash(keys.publicKey.export({ type: 'spki', format: 'der' }));
    const uploads = createHandoverUploadService({ ...f.options, objects,
      trustedKeys: new Map([[keyId, { key: keys.publicKey, serverId }]]) });
    const service = createHandoverImportService({ ...f.options, uploads, originalBackup: { serverId,
      async matchesIssuedBackup() { return false; } }, attachments: { avatars: { store: f.avatars, policy: f.config.policy } } });
    async function upload(owner: string) {
      const id = randomUUID();
      await uploads.create(owner, { opId: id, filename: 'own-avatar.zip', bytes: bytes.length, sha256: hash(bytes) });
      const ready = await uploads.receive(owner, id, Readable.from([bytes]), new AbortController().signal);
      assert.equal(ready.state, 'ready', ready.error ?? JSON.stringify(ready));
      return { uploadId: id, expectedUploadVersion: ready.version };
    }
    const request = await upload(f.owner);
    async function compare(input = request, owner = f.owner) {
      const response = await handleFirebaseAccountData(new Request(serverId + '/api/account/package-imports/compare-account-avatar', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-expected-user-id': owner,
          'x-handover-account-backup': '1' }, body: JSON.stringify(input),
      }), { getSession: async () => ({ user: { id: owner } }) } as any, { packageImports: service } as any, req => req.json());
      assert.ok(response); assert.equal(response.status, 200);
      return comparisonSchema.parse(await response.json());
    }
    const beforeCompare = structuredClone([...f.fake.records]);
    const initial = await compare();
    assert.equal(initial.state, 'unchanged');
    assert.equal(initial.backupVersion, original.version); assert.equal(initial.localVersion, original.version);
    assert.deepEqual([...f.fake.records], beforeCompare, 'Comparison must not create work, receipts or revisions');
    const foreign = await upload(other), beforeForeign = structuredClone([...f.fake.records]);
    await assert.rejects(compare(foreign, other), { code: 'package_original_unverified', status: 403 });
    assert.deepEqual([...f.fake.records], beforeForeign);

    await f.online.submit(f.owner, f.submission('remove', { expectedVersion: original.version, confirmRemove: true }));
    const deleted = await compare(); assert.equal(deleted.state, 'deleted');
    assert.equal(deleted.localVersion, original.version + 1);
    const command = (mode: 'replace_current' | 'restore_deleted') => ({ ...request, opId: randomUUID(),
      acceptedManifestSha256: initial.manifestSha256, restoreOriginal: true, resolutionOnly: true, targets: [], resolutions: [],
      accountAvatar: { expectedVersion: deleted.localVersion!, mode } });
    await assert.rejects(service.create(other, { ...command('replace_current'), ...foreign,
      accountAvatar: { expectedVersion: 0, mode: 'replace_current' } }, new AbortController().signal),
    { code: 'package_original_unverified', status: 403 });
    const codec = createFirestoreRestoreCodec(f.options);
    const queue = createFirestoreBackgroundQueue({ ...f.options, enabled: true,
      readControl: tx => f.authority.readControl(tx), transport: {
        async enqueue() { throw Error('No external queue in this synthetic execution'); },
        async probe() { throw Error('Unexpected queue probe'); },
      }, execute: (work, signal) => service.process(work, signal) });
    async function process(id: string) {
      const work = [...f.fake.records].filter(([path]) => path.includes('_background_work/'))
        .map(([path, data]) => codec.decode({ path, data }).value as any)
        .find(row => row.kind === 'handover-import' && row.resourceId === id);
      assert.ok(work);
      const delivery = { kind: 'product-work' as const, id: work.id, generation: work.generation,
        dispatchRevision: work.dispatchRevision, scheduledAt: work.dueAt };
      assert.equal((await queue.process(delivery)).state, 'completed');
      const result = await service.get(f.owner, id); assert.equal(result.state, 'completed', result.error ?? JSON.stringify(result));
      return result;
    }
    const refused = await service.create(f.owner, command('replace_current'), new AbortController().signal);
    const refusedResult = await process(refused.id);
    assert.equal(refusedResult.counts.conflict, 1); assert.equal(refusedResult.counts.updated, 0);
    assert.equal((await service.summary(f.owner, refused.id, true)).accountAvatar?.result?.outcome, 'conflict');
    assert.equal((await f.avatars.read(f.owner, f.target)).avatar.asset, null, 'Replacement cannot revive an explicitly removed image');
    const restore = command('restore_deleted'), started = await service.create(f.owner, restore, new AbortController().signal);
    const restoredBatch = await process(started.id), restored = (await f.avatars.read(f.owner, f.target)).avatar;
    assert.equal(restoredBatch.counts.conflict, 0);
    assert.equal(restoredBatch.processedItems, 1); assert.equal(restoredBatch.totalItems, 1);
    assert.equal(restored.version, deleted.localVersion! + 1); assert.ok(restored.asset);
    const summary = await service.summary(f.owner, started.id, true);
    assert.equal(summary.accountAvatar?.result?.backupVersion, original.version);
    assert.equal(summary.accountAvatar?.result?.localVersion, restored.version);
    assert.equal(summary.accountAvatar?.result?.assetId, restored.asset.id);
    assert.equal(restored.asset.sha256, original.asset.sha256);
    const content = await f.avatars.content(f.owner, f.target, restored.asset.id, restored.version);
    try { assert.deepEqual(content.buffer, normalized!); assert.equal(hash(content.buffer), original.asset.sha256); }
    finally { content.buffer.fill(0); }
    assert.equal((await compare()).state, 'unchanged', 'New local asset identity must retain the same backup content');
    const writes = f.bucket.writes(), beforeReplay = structuredClone([...f.fake.records]);
    assert.deepEqual(await service.create(f.owner, restore, new AbortController().signal), restoredBatch);
    assert.equal(f.bucket.writes(), writes);
    assert.equal((await f.avatars.read(f.owner, f.target)).avatar.version, restored.version);
    assert.deepEqual([...f.fake.records], beforeReplay, 'Replaying the same operation cannot publish another avatar or receipt');

    await f.online.submit(f.owner, f.submission('remove', { expectedVersion: restored.version, confirmRemove: true }));
    const basis = (await f.avatars.read(f.owner, f.target)).avatar.version;
    const competing = avatarReserveResultSchema.parse((await f.online.submit(f.owner, f.reserve(basis))).result).upload;
    const competingImage = await f.upload(competing.id);
    const writeNew = f.bucket.port.writeNew.bind(f.bucket.port);
    f.bucket.port.writeNew = async (...args) => {
      await writeNew(...args);
      await f.online.submit(f.owner, f.submission('commit', { uploadId: competing.id, expectedVersion: basis }));
    };
    const racing = await service.create(f.owner, { ...command('restore_deleted'),
      accountAvatar: { mode: 'restore_deleted', expectedVersion: basis } }, new AbortController().signal);
    assert.equal((await process(racing.id)).counts.conflict, 1);
    assert.equal((await f.avatars.read(f.owner, f.target)).avatar.asset?.id, competingImage.normalized!.id);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
