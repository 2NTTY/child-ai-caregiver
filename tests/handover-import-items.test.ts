import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreCareStore } from '../server/firestore-care.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirestoreHandoverImportItems } from '../server/firestore-handover-import-items.ts';
import { createFirestoreRestoreCodec } from '../server/firestore-restore-codec.ts';
import { createFirestoreAccountExport } from '../server/firestore-account-export.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { emptyCareDetails } from '../src/shared/care.ts';
import type { HandoverImportRow } from '../server/handover-import.ts';

test('import item receipts commit with source mappings and preserve newer local changes and deletions', async () => {
  const fake = serialFirestoreFixture(), options = { database: fake.database, cipher: createStorageCipher(Buffer.alloc(32, 81)),
    projectId: 'synthetic-import-items', namespace: 'unit_import_items' };
  const authority = createFirestoreAuthority(options), care = createFirestoreCareStore(options), online = createFirestoreOnlineStore(options);
  await authority.initializeControl({ enabled: true, generation: randomUUID() });
  async function admit(userId: string) {
    await authority.issueInvitation({ email: `${userId}@example.test`, operationId: randomUUID(), expiresAt: new Date(Date.now() + 3600000).toISOString() });
    await authority.admitIdentity({ userId, email: `${userId}@example.test`, emailVerified: true });
    await authority.acknowledge({ userId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
    return (await authority.createChild({ userId, operationId: randomUUID(), displayName: userId })).child.id;
  }
  const childId = await admit('recipient'), sourceChildId = await admit('source');
  const source = (await care.create('source', sourceChildId, { text: '原有記錄', details: emptyCareDetails(), source: '原文' }))!;
  const row: HandoverImportRow = { section: 'care', childId: sourceChildId, value: { ...source },
    source: { serverId: 'https://source.test', accountId: 'source', packageId: randomUUID(), packageVersion: 1,
      manifestSha256: 'a'.repeat(64), path: 'data/1.json', rowIndex: 0 } };
  const items = createFirestoreHandoverImportItems(options);
  const command = { opId: randomUUID(), batchId: randomUUID(), target: { childId, spaceId: null }, row,
    integrity: 'trusted' as const, resolution: { mode: 'preserve' as const } };
  const first = await items.apply('recipient', command);
  assert.equal(first.outcome, 'created'); assert.ok(first.resource);
  assert.deepEqual(await items.apply('recipient', command), first);
  await assert.rejects(items.apply('recipient', { ...command, row: { ...row, value: { ...row.value, text: 'changed operation' } } }),
    (e: any) => e.code === 'operation_conflict');
  const replay = await items.apply('recipient', { ...command, opId: randomUUID(), batchId: randomUUID() });
  assert.equal(replay.outcome, 'skipped'); assert.equal(replay.reason, 'already_imported');
  const sourceV2 = { ...row, value: { ...row.value, version: 2, text: '來源第二版' } };
  const updated = await items.apply('recipient', { ...command, opId: randomUUID(), row: sourceV2 });
  assert.equal(updated.outcome, 'updated'); assert.equal(updated.resource!.id, first.resource.id);
  const local = (await care.get('recipient', childId, first.resource.id))!;
  await care.revise('recipient', childId, local.id, { text: '本人較新修改', details: local.details, source: local.source }, local.version, '本人更正');
  const sourceV3 = { ...row, value: { ...row.value, version: 3, text: '來源第三版' } };
  const conflicting = { ...command, opId: randomUUID(), row: sourceV3 };
  const conflict = await items.apply('recipient', conflicting);
  assert.equal(conflict.outcome, 'conflict'); assert.equal(conflict.reason, 'target_changed');
  assert.deepEqual(await items.apply('recipient', conflicting), conflict, 'conflicts are durable results too');
  assert.equal((await care.get('recipient', childId, local.id))!.text, '本人較新修改');
  const replaced = await items.apply('recipient', { ...conflicting, opId: randomUUID(),
    resolution: { mode: 'replace_current', targetId: local.id, expectedVersion: local.version + 1 } });
  assert.equal(replaced.outcome, 'updated');
  await care.delete('recipient', childId, local.id, replaced.resource!.version);
  const deleted = await items.apply('recipient', { ...command, opId: randomUUID(), row: sourceV3 });
  assert.equal(deleted.outcome, 'conflict'); assert.equal(deleted.reason, 'target_deleted');
  const restored = await items.apply('recipient', { ...command, opId: randomUUID(), row: sourceV3,
    resolution: { mode: 'restore_deleted', targetId: local.id, expectedVersion: replaced.resource!.version + 1 } });
  assert.equal(restored.outcome, 'created'); assert.notEqual(restored.resource!.id, local.id);
  assert.equal(await care.get('recipient', childId, local.id), null, 'old deletion barrier remains');
  await assert.rejects(items.apply('source', { ...command, opId: randomUUID() }));
  const misleading = await items.apply('recipient', { ...command, opId: randomUUID(), row: { ...sourceV3, value: { ...sourceV3.value, text: '同版本異內容' } } });
  assert.equal(misleading.reason, 'source_version_conflict');
  const profile = await care.profile('source', sourceChildId);
  const empty = await items.apply('recipient', { ...command, opId: randomUUID(), row: { ...row, section: 'profile', value: { ...profile } } });
  assert.equal(empty.reason, 'empty_profile');
  const sourceTask = { id: randomUUID(), childId: sourceChildId, version: 1, title: '已完成待辦', details: '', kind: 'ordinary',
    assigneeUserId: 'source', createdBy: 'source', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    occurrence: { id: randomUUID(), dueAt: '2026-12-01T01:00:00Z', timeZone: 'Asia/Hong_Kong', state: 'completed', terminalBasisVersion: null } };
  const taskCommand = { ...command, opId: randomUUID(), row: { ...row, section: 'tasks', value: sourceTask } };
  const task = await items.apply('recipient', taskCommand);
  assert.equal((await online.tasks.get('recipient', childId, task.resource!.id))!.occurrence.state, 'completed');
  assert.deepEqual(await items.apply('recipient', taskCommand), task);
  const reopened = createFirestoreHandoverImportItems(options);
  assert.deepEqual(await reopened.get('recipient', command.target, command.opId, 'care'), first);
  const exporter = createFirestoreAccountExport({ ...options, photos: { async content() { throw new Error('Unexpected attachment read'); } } });
  const exported = await exporter.page('recipient', { section: 'import_history', childId });
  assert.ok(exported.items.length > 0); assert.ok(exported.items.some((item: any) => item.source.packageId === row.source.packageId));
  const codec = createFirestoreRestoreCodec(options);
  const records = [...fake.records].filter(([path]) => /_handover_import_(items|mappings)\//u.test(path));
  assert.ok(records.length >= 9);
  const epoch = randomUUID();
  for (const [path, data] of records) {
    const decoded = codec.decode({ path, data });
    assert.equal(decoded.context.family, 'domain');
    if (decoded.context.family !== 'domain') throw new Error('Expected private domain');
    const transformed = codec.transform(decoded, { newEpochByWorkspace: new Map([[decoded.context.scope.workspaceId, epoch]]),
      generation: randomUUID(), photoDescriptors: new Map() });
    const checked = codec.decode(transformed);
    assert.equal(checked.context.family === 'domain' && checked.context.scope.storageEpoch, epoch);
    assert.deepEqual(checked.value, decoded.value, 'epoch rotation retains mapping and original-operation metadata');
  }
  assert.equal([...fake.records].filter(([path]) => path.includes('_task_outbox/')).length, 0);
});
