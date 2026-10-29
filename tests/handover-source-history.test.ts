import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreCareStore } from '../server/firestore-care.ts';
import { createFirestoreHandoverImportItems } from '../server/firestore-handover-import-items.ts';
import { createFirestoreAccountExport } from '../server/firestore-account-export.ts';
import { createFirestoreContentErasure } from '../server/firestore-content-erasure.ts';
import { createFirestoreRestoreCodec } from '../server/firestore-restore-codec.ts';
import { replayContentErasures } from '../server/firestore-restore-content-erasure.ts';
import { FirestoreDomainData } from '../server/firestore-domain-data.ts';
import { firebaseErasureIntentHash } from '../server/firebase-erasure-journal.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { emptyCareDetails } from '../src/shared/care.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirestoreSharingStore } from '../server/firestore-sharing.ts';

test('source histories remain separate, round-trip, and follow current deletion and restore barriers', async () => {
  const fixture = serialFirestoreFixture(), options = { database: fixture.database, cipher: createStorageCipher(Buffer.alloc(32, 83)),
    projectId: 'demo-source-history', namespace: 'unit_source_history' };
  const authority = createFirestoreAuthority(options), care = createFirestoreCareStore(options), items = createFirestoreHandoverImportItems(options);
  const codec = createFirestoreRestoreCodec(options), data = new FirestoreDomainData(options);
  const exporter = createFirestoreAccountExport({ ...options, photos: { async content() { throw new Error('No photos'); } } });
  await authority.initializeControl({ enabled: true, generation: randomUUID() });
  async function admit(userId: string) {
    const email = userId + '@example.test';
    await authority.issueInvitation({ email, operationId: randomUUID(), expiresAt: new Date(Date.now() + 3600000).toISOString() });
    await authority.admitIdentity({ userId, email, emailVerified: true });
    await authority.acknowledge({ userId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
    return (await authority.createChild({ userId, operationId: randomUUID(), displayName: userId })).child.id;
  }
  const sourceChild = await admit('source'), childId = await admit('recipient'), nextChild = await admit('next');
  const original = (await care.create('source', sourceChild, { text: 'Original source value', details: emptyCareDetails(), source: 'Parent statement' }))!;
  const latest = (await care.revise('source', sourceChild, original.id, { text: 'Current source value', details: original.details, source: original.source }, 1, 'Correction'))!;
  const origin = { serverId: 'https://source.test', accountId: 'source', packageId: randomUUID(), packageVersion: 1,
    manifestSha256: 'a'.repeat(64), path: 'data/1.json', rowIndex: 0 };
  const command = { opId: randomUUID(), batchId: randomUUID(), target: { childId, spaceId: null }, integrity: 'trusted' as const,
    resolution: { mode: 'preserve' as const }, row: { section: 'care', childId: sourceChild, value: { ...latest }, source: origin } };
  const imported = await items.apply('recipient', command); assert.ok(imported.resource);
  const historyCommand = { ...command, opId: randomUUID(), row: { ...command.row, section: 'care_history', value: { ...original }, source: { ...origin, path: 'data/2.json' } } };
  const history = await items.apply('recipient', historyCommand);
  assert.equal(history.outcome, 'created');
  assert.equal((await care.get('recipient', childId, imported.resource.id))!.text, latest.text);
  assert.equal((await care.history('recipient', childId, imported.resource.id))!.revisions.length, 1, 'source history is not a forged local edit');
  assert.deepEqual(await items.apply('recipient', historyCommand), history);
  assert.equal((await items.apply('recipient', { ...historyCommand, opId: randomUUID() })).reason, 'history_already_imported');
  assert.equal((await items.apply('recipient', { ...historyCommand, opId: randomUUID(), row: { ...historyCommand.row,
    value: { ...original, text: 'Same source version with different content' } } })).reason, 'source_history_conflict');
  await assert.rejects(items.apply('next', { ...historyCommand, opId: randomUUID() }));
  async function exported(owner: string, child: string) {
    const rows: any[] = []; let cursor: string | undefined, scopeVersion: string | undefined;
    do { const page = await exporter.page(owner, { section: 'care_history', childId: child, ...(cursor ? { cursor, scopeVersion } : {}) });
      rows.push(...page.items); cursor = page.nextCursor ?? undefined; scopeVersion = page.scopeVersion;
    } while (cursor);
    return rows;
  }
  const archiveHistory = await exported('recipient', childId), retained = archiveHistory.find(row => row.format === 'yuyoufang-source-revision:1');
  assert.ok(retained); assert.equal(retained.evidence.value.text, original.text);
  assert.equal(retained.evidence.source.current.source.confirmedBy, 'source');
  const current = (await care.get('recipient', childId, imported.resource.id))!;
  const onward = { ...origin, accountId: 'recipient', packageId: randomUUID(), manifestSha256: 'b'.repeat(64) };
  const nextCommand = { ...command, opId: randomUUID(), target: { childId: nextChild, spaceId: null }, row: { section: 'care', childId,
    value: { ...current }, source: onward } };
  const nextImport = await items.apply('next', nextCommand);
  await items.apply('next', { ...nextCommand, opId: randomUUID(), row: { ...nextCommand.row, section: 'care_history', value: retained,
    source: { ...onward, path: 'data/2.json' } } });
  const onwardHistory = (await exported('next', nextChild)).find(row => row.format === 'yuyoufang-source-revision:1');
  assert.deepEqual(onwardHistory.evidence, retained.evidence, 'original evidence is retained across handovers');
  assert.equal(onwardHistory.resource.id, nextImport.resource!.id);
  const saved = [...fixture.records].filter(([path]) => path.includes('_handover_source_history/'));
  assert.equal(saved.length, 2);
  const snapshot = [...fixture.records].map(([path, data]) => codec.decode({ path, data }));
  await care.delete('recipient', childId, imported.resource.id, imported.resource.version);
  assert.equal((await exported('recipient', childId)).length, 0, 'deletion masks history before physical cleanup');
  assert.equal((await items.apply('recipient', { ...historyCommand, opId: randomUUID() })).reason, 'target_deleted');
  const journalEntries: any[] = [], journal = { async writeOnce(intent: any) { journalEntries.push(intent); return {
    objectName: 'erasures/v1/' + 'a'.repeat(64), generation: '1', cipherSha256: 'b'.repeat(64),
    intentSha256: firebaseErasureIntentHash(intent), bytes: 256, format: 'yuban-erasure-journal/v1' as const }; },
    async read(intent: any) { return intent; } };
  const erasure = createFirestoreContentErasure({ ...options, journal });
  const path = [...fixture.records.keys()].find(key => key.includes('_content_erasures/'))!;
  const [collection, documentId] = path.split('/');
  for (let pass = 0; pass < 4; pass++) await erasure.advance(await fixture.database.collection(collection).doc(documentId).get());
  assert.equal([...fixture.records.keys()].filter(key => key.includes('_handover_source_history/')).length, 1, 'only the deleted target history is physically removed');
  const live = [...fixture.records].map(([path, data]) => codec.decode({ path, data }));
  const removed = replayContentErasures(data, codec, snapshot, live, journalEntries, fixture.records);
  assert.equal(saved.filter(([path]) => removed.has(path)).length, 1, 'the independent deletion barrier removes source history from old snapshots');

  const profile = (await care.saveProfile('source', sourceChild, { age: { kind: 'unknown' }, dueDate: null, gestationalWeeksRaw: null,
    region: 'Hong Kong', language: null, allergies: null, specialNeeds: null, preferences: null, source: 'Original profile', validUntil: null }, 0, 'First profile'))!;
  const profileCommand = { ...command, opId: randomUUID(), row: { ...command.row, section: 'profile', value: { ...profile } } };
  const importedProfile = await items.apply('recipient', profileCommand);
  await items.apply('recipient', { ...profileCommand, opId: randomUUID(), row: { ...profileCommand.row, section: 'profile_history' } });
  assert.equal((await items.history('recipient', { childId, module: 'profile', resourceId: childId })).items.length, 1);
  await care.deleteProfile('recipient', childId, importedProfile.resource!.version);
  await care.saveProfile('recipient', childId, { ...profile.data!, source: 'New local profile' }, importedProfile.resource!.version + 1, 'New profile');
  assert.equal((await items.history('recipient', { childId, module: 'profile', resourceId: childId })).items.length, 0, 'new profile does not restore erased history');

  const task = { id: randomUUID(), childId: sourceChild, version: 2, title: 'Completed source task', details: '', kind: 'ordinary',
    assigneeUserId: 'source', createdBy: 'source', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    occurrence: { id: randomUUID(), dueAt: '2026-12-01T01:00:00Z', timeZone: 'Asia/Hong_Kong', state: 'completed', terminalBasisVersion: null } };
  const taskCommand = { ...command, opId: randomUUID(), row: { ...command.row, section: 'tasks', value: task } };
  const importedTask = await items.apply('recipient', taskCommand);
  const oldTask = { ...task, version: 1, occurrence: { ...task.occurrence, state: 'scheduled' } };
  const outboxes = [...fixture.records].filter(([key]) => key.includes('_task_outbox/'));
  await items.apply('recipient', { ...taskCommand, opId: randomUUID(), row: { ...taskCommand.row, section: 'task_history',
    value: { task: oldTask, action: 'create', actorUserId: 'source', basisVersion: 0, note: 'Original actor and time', at: task.createdAt } } });
  assert.equal((await createFirestoreOnlineStore(options).tasks.get('recipient', childId, importedTask.resource!.id))!.occurrence.state, 'completed');
  assert.deepEqual([...fixture.records].filter(([key]) => key.includes('_task_outbox/')), outboxes, 'historical scheduled tasks do not create reminders');
  const taskHistory = await items.history('recipient', { childId, module: 'tasks', resourceId: importedTask.resource!.id });
  assert.equal(taskHistory.items[0].evidence.value.actorUserId, 'source');
  assert.equal(taskHistory.items[0].evidence.value.note, 'Original actor and time');

  const sharing = createFirestoreSharingStore(options);
  const classroom = await sharing.create('recipient', { operationId: randomUUID(), name: 'Independent class', kind: 'class' });
  const learner = await sharing.addClassChild('recipient', { operationId: randomUUID(), spaceId: classroom.id, expectedVersion: classroom.version, displayName: 'Learner' });
  const classCommand = { ...command, opId: randomUUID(), target: { childId: learner.child.id, spaceId: classroom.id } };
  const classRecord = await items.apply('recipient', classCommand);
  await items.apply('recipient', { ...historyCommand, opId: randomUUID(), target: classCommand.target });
  const classQuery = { ...classCommand.target, module: 'care', resourceId: classRecord.resource!.id };
  assert.equal((await items.history('recipient', classQuery)).items.length, 1, 'the same source reader supports class authority');
  await assert.rejects(items.history('next', classQuery));
  for (const [path, body] of fixture.records) if (path.includes('_handover_source_history/')) {
    const decoded = codec.decode({ path, data: body }); if (decoded.context.family !== 'domain') throw Error('Expected domain');
    const restored = codec.decode(codec.transform(decoded, { newEpochByWorkspace: new Map([[decoded.context.scope.workspaceId, randomUUID()]]), generation: randomUUID(), photoDescriptors: new Map() }));
    assert.deepEqual(restored.value, decoded.value, 'epoch rebinding preserves source evidence and new local target');
  }
});
