import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreCareStore } from '../server/firestore-care.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirestoreSharingStore } from '../server/firestore-sharing.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { emptyCareDetails } from '../src/shared/care.ts';
import { makeImportProvenance } from '../server/handover-provenance.ts';
import type { HandoverImportRow } from '../server/handover-import.ts';
import { createCareApi } from '../src/client/care-api.ts';
import { createContactApi } from '../src/client/contact-api.ts';
import type { CareTask } from '../src/shared/tasks.ts';
import { createFirestoreRestoreCodec } from '../server/firestore-restore-codec.ts';

test('import preparation retains source confirmation and uses ordinary transactions and reminder states', async () => {
  const fake = serialFirestoreFixture(), options = { database: fake.database, cipher: createStorageCipher(Buffer.alloc(32, 93)),
    projectId: 'synthetic-provenance', namespace: 'unit_provenance', serverClock: () => Date.parse('2026-10-29T01:00:00Z') };
  const authority = createFirestoreAuthority(options), care = createFirestoreCareStore(options), online = createFirestoreOnlineStore(options);
  await authority.initializeControl({ enabled: true, generation: randomUUID() });
  async function admit(userId: string) {
    await authority.issueInvitation({ email: `${userId}@example.test`, operationId: randomUUID(), expiresAt: '2026-10-30T01:00:00Z' });
    await authority.admitIdentity({ userId, email: `${userId}@example.test`, emailVerified: true });
    await authority.acknowledge({ userId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
    return (await authority.createChild({ userId, operationId: randomUUID(), displayName: userId })).child.id;
  }
  const childId = await admit('recipient'), sourceChildId = await admit('source');
  const sourceRecord = await care.create('source', sourceChildId, { text: '約六個月', details: emptyCareDetails(), source: '家長原話' }, 'preauthorized_user_statement');
  assert.ok(sourceRecord);
  const sourceProfile = await care.saveProfile('source', sourceChildId, { age: { kind: 'unknown' }, dueDate: null, gestationalWeeksRaw: null,
    region: null, language: null, allergies: null, specialNeeds: null, preferences: null, source: '原資料', validUntil: null }, 0, '來源核對');
  const source = { serverId: 'https://source.test', accountId: 'source', packageId: randomUUID(), packageVersion: 1,
    manifestSha256: 'a'.repeat(64), path: 'data/1.json', rowIndex: 0 };
  const row = (section: string, value: unknown): HandoverImportRow => ({ section, childId: sourceChildId,
    source, value: structuredClone(value) as Record<string, unknown> });
  const careRow = row('care', sourceRecord);
  const imported = await authority.runTransaction('recipient', childId, async binding => {
    const prepared = await care.prepareImportedRecord(binding, randomUUID(), careRow, 'missing_proof');
    prepared.commit(); return prepared.value;
  });
  const read = (await care.get('recipient', childId, imported.id))!;
  assert.equal(read.confirmedBy, 'source'); assert.equal(read.confirmedAt, sourceRecord.confirmedAt);
  assert.equal(read.confirmationBasis, 'imported_source');
  assert.equal(read.importedFrom!.current.source.confirmationBasis, 'preauthorized_user_statement');
  assert.equal(read.importedFrom!.current.importedBy, 'recipient');
  assert.equal(read.importedFrom!.current.integrity, 'missing_proof');
  assert.equal(read.childId, childId); assert.notEqual(read.id, sourceRecord.id);
  const changed = await care.revise('recipient', childId, read.id, { text: '現在七個月', details: read.details, source: '本人更正' }, read.version, '更正');
  assert.ok(changed);
  assert.equal(changed.confirmedBy, 'recipient'); assert.equal(changed.confirmationBasis, 'explicit');
  assert.deepEqual(changed.importedFrom, read.importedFrom, 'local edits retain provenance without retaining external confirmation');
  const nextLink = makeImportProvenance({ ...row('care', changed), childId: changed.childId }, 'trusted', 'third-recipient', '2026-10-29T02:00:00Z');
  assert.equal(nextLink.previous.length, 1); assert.deepEqual(nextLink.previous[0], read.importedFrom!.current);
  const profile = await authority.runTransaction('recipient', childId, async binding => {
    const prepared = await care.prepareImportedProfile(binding, randomUUID(), row('profile', sourceProfile), 'trusted', 0);
    prepared.commit(); return prepared.value;
  });
  assert.equal(profile.confirmedBy, 'source'); assert.equal(profile.confirmationBasis, 'imported_source');
  const api = createCareApi('', (async url => Response.json(String(url).endsWith('/profile') ? { profile }
    : { records: [read], nextCursor: null, scanned: 1, limit: 50 })) as typeof fetch);
  assert.equal((await api.getProfile(childId, new AbortController().signal)).importedFrom!.current.importedBy, 'recipient');
  assert.equal((await api.search(childId, {}, new AbortController().signal, 'recipient')).records[0].confirmationBasis, 'imported_source');
  await assert.rejects(authority.runTransaction('recipient', childId, b => care.prepareImportedProfile(b, randomUUID(), row('profile', sourceProfile), 'trusted', 0)),
    (e: any) => e.code === 'version_conflict');
  await assert.rejects(authority.runTransaction('source', childId, b => care.prepareImportedRecord(b, randomUUID(), careRow, 'trusted')));

  // Class access still uses the existing grant/actor binding; external confirmation is not local authority.
  const sharing = createFirestoreSharingStore(options), classroom = await sharing.create('recipient', { operationId: randomUUID(), name: 'Class', kind: 'class' });
  const member = await sharing.addClassChild('recipient', { operationId: randomUUID(), spaceId: classroom.id, expectedVersion: classroom.version, displayName: 'Learner' });
  const request = { spaceId: classroom.id, childId: member.child.id, module: 'care' as const, mode: 'write' as const };
  const classRecord = await sharing.withResource('recipient', request, async a => {
    const prepared = await care.prepareImportedRecord(a.binding, randomUUID(), careRow, 'trusted'); prepared.commit(); return prepared.value;
  });
  assert.equal((await care.forSharedSpace(classroom.id).get('recipient', member.child.id, classRecord.id))!.confirmedBy, 'source');

  const sourceTask = { id: randomUUID(), childId: sourceChildId, version: 4, title: '源待辦', details: '內容', kind: 'ordinary',
    assigneeUserId: 'source', createdBy: 'source', createdAt: '2026-10-20T01:00:00Z', updatedAt: '2026-10-28T01:00:00Z',
    occurrence: { id: randomUUID(), dueAt: '2026-11-01T01:00:00Z', timeZone: 'Asia/Hong_Kong', state: 'completed', terminalBasisVersion: 3 } };
  const importedTasks: CareTask[] = [];
  for (const state of ['completed', 'scheduled'] as const) {
    const taskRow = row('tasks', { ...sourceTask, occurrence: { ...sourceTask.occurrence, state } });
    const task = await authority.runTransaction('recipient', childId, async binding => {
      const prepared = await online.prepareImportedTask(binding, childId, randomUUID(), taskRow, 'trusted'); prepared.commit(); return prepared.task;
    });
    assert.equal(task.assigneeUserId, 'recipient'); assert.equal(task.occurrence.state, state);
    assert.notEqual(task.occurrence.id, sourceTask.occurrence.id);
    assert.equal(task.importedFrom!.current.source.assigneeUserId, 'source');
    const outbox = [...fake.records].filter(([path, value]) => path.includes('_task_outbox/') && value.taskId === task.id);
    assert.equal(outbox.length, state === 'scheduled' ? 1 : 0, 'terminal imports never create a temporary live reminder');
    assert.equal((await online.tasks.get('recipient', childId, task.id))!.importedFrom!.current.source.resourceVersion, 4);
    importedTasks.push(task);
  }
  const contact = createContactApi('', (async () => Response.json({ canManage: true, workerEnabled: true,
    consent: { userId: 'recipient', version: 0, enabled: false, allowBackup: false, bindings: [] },
    availableBindings: [], recipients: [], tasks: importedTasks, tasksHaveMore: false, grants: [], requests: [], historyLimited: false,
  })) as typeof fetch);
  assert.equal((await contact.page(childId, new AbortController().signal, 'recipient')).tasks[0].importedFrom!.current.source.resourceVersion, 4);
  const codec = createFirestoreRestoreCodec(options);
  for (const [path, data] of fake.records) if (/_(care_records|care_revisions|child_profiles|profile_revisions|tasks|task_revisions)\//u.test(path))
    assert.ok(codec.decode({ path, data }), 'the actual restore decoder accepts the new source/actor attribution');
});
