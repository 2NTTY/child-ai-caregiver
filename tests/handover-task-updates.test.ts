import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirestoreHandoverImportItems } from '../server/firestore-handover-import-items.ts';
import { FirestoreDomainData, firestoreReminderOutboxId, firestoreReminderOutboxSchema, sealFirestoreReminderOutbox } from '../server/firestore-domain-data.ts';
import { createFirestoreRestoreCodec } from '../server/firestore-restore-codec.ts';
import { createTaskApi } from '../src/client/task-api.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { taskChangeSchema, type CareTask } from '../src/shared/tasks.ts';
import { taskActionLabels } from '../frontend/src/task-view-model.ts';
import type { HandoverImportRow } from '../server/handover-import.ts';

test('task source updates retain local identity, conflict protection, history and unknown-delivery barriers', async () => {
  const fake = serialFirestoreFixture(), options = { database: fake.database, cipher: createStorageCipher(Buffer.alloc(32, 82)),
    projectId: 'synthetic-import-task', namespace: 'unit_import_task' };
  const authority = createFirestoreAuthority(options), online = createFirestoreOnlineStore(options), data = new FirestoreDomainData(options);
  await authority.initializeControl({ enabled: true, generation: randomUUID() });
  await authority.issueInvitation({ email: 'recipient@example.test', operationId: randomUUID(), expiresAt: new Date(Date.now() + 3600000).toISOString() });
  await authority.admitIdentity({ userId: 'recipient', email: 'recipient@example.test', emailVerified: true });
  await authority.acknowledge({ userId: 'recipient', operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  const childId = (await authority.createChild({ userId: 'recipient', operationId: randomUUID(), displayName: 'Learner' })).child.id;
  const source: CareTask = { id: randomUUID(), childId: randomUUID(), version: 1, title: 'Source task', details: '', kind: 'ordinary',
    assigneeUserId: 'source', createdBy: 'source', createdAt: '2026-10-20T01:00:00Z', updatedAt: '2026-10-20T01:00:00Z',
    occurrence: { id: randomUUID(), dueAt: '2026-12-01T01:00:00Z', timeZone: 'Asia/Hong_Kong', state: 'scheduled', terminalBasisVersion: null } };
  const row = (version: number, state: CareTask['occurrence']['state'] = 'scheduled'): HandoverImportRow => ({ section: 'tasks', childId: source.childId,
    value: { ...source, version, title: `Source task ${version}`, details: `Details ${version}`,
      occurrence: { ...source.occurrence, dueAt: '2026-12-02T01:00:00Z', state } },
    source: { serverId: 'https://source.test', accountId: 'source', packageId: randomUUID(), packageVersion: 1,
      manifestSha256: 'a'.repeat(64), path: 'data/1.json', rowIndex: 0 } });
  const items = createFirestoreHandoverImportItems(options);
  const command = (version: number, state?: CareTask['occurrence']['state']) => ({ opId: randomUUID(), batchId: randomUUID(),
    target: { childId, spaceId: null }, row: row(version, state), integrity: 'trusted' as const, resolution: { mode: 'preserve' as const } });
  const first = await items.apply('recipient', command(1)), id = first.resource!.id;
  const original = (await online.tasks.get('recipient', childId, id))!;
  const secondCommand = command(2), second = await items.apply('recipient', secondCommand);
  assert.equal(second.outcome, 'updated'); assert.deepEqual(second.resource, { id, version: 2 });
  const updated = (await online.tasks.get('recipient', childId, id))!;
  assert.equal(updated.occurrence.id, original.occurrence.id); assert.equal(updated.createdAt, original.createdAt);
  assert.equal(updated.title, 'Source task 2'); assert.equal(updated.details, 'Details 2');
  assert.equal(updated.importedFrom!.current.source.resourceVersion, 2);
  const outboxes = () => [...fake.records.values()].filter(value => value.taskId === id && typeof value.state === 'string');
  assert.deepEqual(outboxes().map(value => value.state).sort(), ['cancelled', 'pending']);
  assert.deepEqual(await items.apply('recipient', secondCommand), second); assert.equal(outboxes().length, 2);
  await authority.runTransaction('recipient', childId, async b => {
    const change = await online.prepareTask(b, childId, id, { action: 'complete', expectedVersion: 2, confirm: true, note: '' }, randomUUID());
    change.commit();
  });
  const thirdCommand = command(3), blocked = await items.apply('recipient', thirdCommand);
  assert.equal(blocked.reason, 'target_changed'); assert.equal((await online.tasks.get('recipient', childId, id))!.occurrence.state, 'completed');
  const stale = await items.apply('recipient', { ...thirdCommand, opId: randomUUID(),
    resolution: { mode: 'replace_current', targetId: id, expectedVersion: 2 } });
  assert.equal(stale.reason, 'target_version_conflict');
  const replaced = await items.apply('recipient', { ...thirdCommand, opId: randomUUID(),
    resolution: { mode: 'replace_current', targetId: id, expectedVersion: 3 } });
  assert.deepEqual(replaced.resource, { id, version: 4 });
  const reopened = (await online.tasks.get('recipient', childId, id))!;
  assert.equal(reopened.occurrence.id, original.occurrence.id); assert.equal(reopened.occurrence.terminalBasisVersion, null);
  await authority.runTransaction('recipient', childId, async b => {
    const outboxId = firestoreReminderOutboxId(id, 4), ref = data.ref('task_outbox', 'task-reminder-outbox', outboxId);
    const value = data.open('task-reminder-outbox', outboxId, b.scope, firestoreReminderOutboxSchema, await b.transaction.get(ref));
    b.transaction.set(ref, sealFirestoreReminderOutbox(data, b.scope, { ...value, state: 'unknown', lease: null }));
  });
  const count = outboxes().length;
  const fourth = await items.apply('recipient', command(4));
  assert.equal(fourth.outcome, 'updated'); assert.equal(outboxes().length, count, 'new source cannot bypass an unknown local delivery');
  const terminal = await items.apply('recipient', command(5, 'cancelled'));
  assert.equal(terminal.outcome, 'updated'); assert.equal(outboxes().length, count, 'terminal source cannot enqueue a reminder');
  const history = (await online.tasks.history('recipient', childId, id))!;
  assert.equal(history.revisions[0].action, 'import'); assert.equal(history.revisions[0].basisVersion, 5);
  const client = createTaskApi('', (async () => Response.json(history)) as typeof fetch);
  assert.deepEqual(await client.history(childId, id, null, new AbortController().signal), history);
  assert.equal(taskActionLabels[history.revisions[0].action], '匯入更新');
  assert.equal(taskChangeSchema.safeParse({ action: 'import', expectedVersion: 6, confirm: true }).success, false);
  const codec = createFirestoreRestoreCodec(options);
  for (const [path, value] of fake.records) if (path.includes('_task_revisions/')) assert.ok(codec.decode({ path, data: value }));
});
