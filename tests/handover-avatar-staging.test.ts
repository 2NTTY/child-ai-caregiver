import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { avatarDomainFixture } from './helpers/avatar-memory.ts';
import { avatarBinding } from '../server/avatar-data.ts';
import type { ImportProvenance } from '../src/shared/import-provenance.ts';

test('imported child avatars reuse normalization and cleanup, then publish atomically without old execution authority', async () => {
  const f = await avatarDomainFixture();
  const childId = (await f.authority.createChild({ userId: f.owner, operationId: randomUUID(), displayName: 'Imported avatar' })).child.id;
  const target = { kind: 'child' as const, childId }, ids = { uploadId: randomUUID(), assetId: randomUUID() };
  const stage = { batchId: randomUUID(), operationId: randomUUID(), actorUserId: f.owner, sourceHash: 'a'.repeat(64) };
  const raw = f.reserve(0, target).payload;
  const reserve = () => f.authority.runTransaction(f.owner, childId, async b => {
    const prepared = await f.avatars.prepareImportReservation(b, raw, ids, stage); prepared.commit(); return prepared.value;
  });
  const first = await reserve(); assert.deepEqual(await reserve(), first);
  await assert.rejects(f.avatars.uploadAdmission(f.owner, target, ids.uploadId), { code: 'avatar_import_pending' });
  f.bucket.lose(); f.bucket.unavailable(true);
  await assert.rejects(f.avatars.uploadImported(f.owner, childId, ids.uploadId, f.input, stage, new AbortController().signal), { code: 'avatar_unavailable' });
  f.bucket.unavailable(false); f.advance(f.config.admission.totalTimeoutMs + 1);
  const ready = await f.avatars.uploadImported(f.owner, childId, ids.uploadId, f.input, stage, new AbortController().signal);
  assert.equal(ready.state, 'ready'); assert.equal(f.decodes(), 1); assert.equal(f.bucket.writes(), 1);
  assert.equal((await f.avatars.read(f.owner, target)).avatar.asset, null);
  await assert.rejects(f.avatars.submitOnline(f.owner, f.submission('commit', { uploadId: ids.uploadId, expectedVersion: 0 }, target)), { code: 'avatar_import_pending' });
  const provenance: ImportProvenance = { current: { source: { serverId: 'source', accountId: 'source-parent', childId: randomUUID(), section: 'child_avatar', resourceId: randomUUID(), resourceVersion: 3,
    authorUserId: null, createdAt: null, confirmedBy: null, confirmedAt: null, confirmationBasis: null, assigneeUserId: null },
    sourceHash: stage.sourceHash, packageId: randomUUID(), packageVersion: 1, manifestSha256: 'b'.repeat(64), integrity: 'trusted', importedBy: f.owner,
    importedAt: new Date(f.now()).toISOString() }, previous: [] };
  const receipt = f.options.database.collection('synthetic_import_receipts').doc(stage.operationId);
  const publish = (rollback = false) => f.authority.runTransaction(f.owner, childId, async b => {
    const prepared = await f.avatars.prepareImportPublication(b, ids.uploadId, stage, provenance);
    prepared.commit(); b.transaction.set(receipt, { assetId: ids.assetId });
    if (rollback) throw Error('Synthetic import rollback'); return prepared.value;
  });
  await assert.rejects(publish(true), /Synthetic import rollback/u);
  assert.equal((await f.options.database.runTransaction(tx => tx.get(receipt))).exists, false);
  assert.equal((await f.avatars.read(f.owner, target)).avatar.asset, null);
  const published = await publish(); assert.equal(published.asset!.id, ids.assetId); assert.deepEqual(await publish(), published);
  const content = await f.avatars.content(f.owner, target, ids.assetId, published.version); assert.ok(content.buffer.length); content.buffer.fill(0);
  await assert.rejects(f.authority.runTransaction(f.owner, childId, b => f.avatars.prepareImportPublication(b, ids.uploadId, { ...stage, sourceHash: 'c'.repeat(64) }, provenance)), { code: 'operation_conflict' });
  await f.avatars.submitOnline(f.owner, f.submission('remove', { expectedVersion: published.version, confirmRemove: true }, target));
  const binding = await f.authority.runTransaction(f.owner, childId, b => Promise.resolve(avatarBinding(b.scope, target)));
  assert.equal((await f.cleanup.process(binding, ids.assetId)).state, 'complete'); assert.equal(f.bucket.records.size, 0);
  await assert.rejects(publish(), { code: 'avatar_version_conflict' });
});
