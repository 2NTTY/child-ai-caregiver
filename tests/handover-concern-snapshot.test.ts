import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreConcernStore, firestoreConcernSchema } from '../server/firestore-concerns.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import type { HandoverImportRow } from '../server/handover-import.ts';
import { FirestoreDomainData } from '../server/firestore-domain-data.ts';
import { firestoreDocumentConcernEventSchema } from '../server/firestore-document-sources.ts';
import { createFirestoreRestoreCodec } from '../server/firestore-restore-codec.ts';
import { firestoreBackgroundWorkSchema } from '../server/firestore-background-work.ts';

test('imported concern snapshots preserve source evidence while replacing only the selected local timeline', async () => {
  const fixture = serialFirestoreFixture(), options = { database: fixture.database, cipher: createStorageCipher(Buffer.alloc(32, 95)),
    projectId: 'synthetic-concern-snapshot', namespace: 'unit_concern_snapshot' };
  const authority = createFirestoreAuthority(options), concerns = createFirestoreConcernStore(options), data = new FirestoreDomainData(options);
  const codec = createFirestoreRestoreCodec(options);
  const jobs = () => [...fixture.records].filter(([path]) => path.includes('_background_work/'))
    .map(([path, value]) => firestoreBackgroundWorkSchema.parse(codec.decode({ path, data: value }).value)).filter(value => value.kind === 'concern');
  await authority.initializeControl({ enabled: true, generation: randomUUID() });
  await authority.issueInvitation({ email: 'recipient@example.test', operationId: randomUUID(), expiresAt: new Date(Date.now() + 3600000).toISOString() });
  await authority.admitIdentity({ userId: 'recipient', email: 'recipient@example.test', emailVerified: true });
  await authority.acknowledge({ userId: 'recipient', operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  const childId = (await authority.createChild({ userId: 'recipient', operationId: randomUUID(), displayName: 'Recipient' })).child.id;
  const at = new Date().toISOString(), future = new Date(Date.now() + 3600000).toISOString(), nativeOp = randomUUID();
  const values = { title: 'Local concern', reason: 'Local context', observation: 'Native observation', observedAt: at,
    links: { recordId: null, taskId: null, attentionId: null }, followUpAt: null };
  const native = await concerns.create('recipient', childId, values, nativeOp);
  const sourceChild = randomUUID(), sourceId = randomUUID(), sourceTimeline = randomUUID(), sourceEventId = randomUUID();
  const sourceFollowUp = randomUUID(), sourceRun = randomUUID(), foreignRecord = randomUUID(), foreignTask = randomUUID(), foreignAttention = randomUUID();
  const row: HandoverImportRow = { section: 'concerns', childId: sourceChild, value: { id: sourceId, childId: sourceChild, version: 1,
    title: 'Imported concern', reason: 'Imported source context', status: 'following', createdAt: at, updatedAt: at, archivedAt: null,
    timelineId: sourceTimeline, attentionIds: [foreignAttention], eventCount: 1, followUp: { id: sourceFollowUp, at: future, state: 'pending', runId: null } },
    source: { serverId: 'https://source.test', accountId: 'source', packageId: randomUUID(), packageVersion: 1,
      manifestSha256: 'a'.repeat(64), path: 'data/concerns.json', rowIndex: 0 } };
  const events = [{ id: sourceEventId, concernId: sourceId, childId: sourceChild, sequence: 1, timelineId: sourceTimeline,
    at, kind: 'observation', title: 'Original source observation', text: 'Original retained source words', sourceLabel: 'Source observation',
    actorUserId: 'source-author', recordId: foreignRecord, taskId: foreignTask, attentionId: foreignAttention, attentionVersion: 3, runId: sourceRun }];
  const persist = (source: HandoverImportRow, sourceEvents: unknown[], expected?: { id: string; expectedVersion: number }) => authority.runTransaction('recipient', childId, async binding => {
    const prepared = await concerns.prepareImportedSnapshot(binding, randomUUID(), source, 'trusted', sourceEvents, expected);
    prepared.commit(); return prepared.value;
  });
  const saved = await persist(row, events, { id: native.id, expectedVersion: 1 });
  assert.equal(saved.id, native.id); assert.notEqual(saved.id, sourceId);
  const current = await concerns.get('recipient', childId, saved.id); assert.ok(current);
  assert.equal(current.title, 'Imported concern'); assert.equal(current.status, 'following');
  assert.equal(current.events[0].text, events[0].text);
  assert.equal(current.version, 2); assert.notEqual(current.events[0].id, sourceEventId); assert.equal(current.events[0].actorUserId, 'source-author');
  assert.match(current.events[0].sourceLabel, /匯入/);
  assert.deepEqual(current.attentionIds, []); assert.equal('importedFrom' in current, false); assert.equal('timelineId' in current, false);
  assert.equal('importedFrom' in current.events[0], false);
  for (const key of ['recordId', 'taskId', 'attentionId', 'attentionVersion', 'runId']) assert.equal(key in current.events[0], false);
  for (const foreign of [sourceId, sourceChild, sourceTimeline, sourceEventId, sourceFollowUp, sourceRun, foreignRecord, foreignTask, foreignAttention])
    assert.equal(JSON.stringify(current).includes(foreign), false, 'foreign identity stays in authenticated source provenance');
  const firstHead = await authority.runTransaction('recipient', childId, async binding => {
    const head = await concerns.head(binding, saved.id); assert.ok(head); assert.ok(head.timelineId); assert.notEqual(head.timelineId, sourceTimeline);
    assert.equal(head.importedFrom!.current.source.resourceId, sourceId);
    assert.deepEqual(head.importedFrom!.current.source.concern!.attentionIds, [foreignAttention]);
    const snapshot = await binding.transaction.get(data.ref('concern_events', 'concern-event', current.events[0].id));
    const event = data.open('concern-event', current.events[0].id, binding.scope, firestoreDocumentConcernEventSchema, snapshot);
    const origin = event.importedFrom!.current.source;
    assert.equal(origin.authorUserId, 'source-author'); assert.equal(origin.resourceId, sourceEventId);
    assert.equal(origin.concernEvent!.runId, sourceRun); assert.equal(origin.concernEvent!.recordId, foreignRecord);
    assert.equal(origin.concernEvent!.taskId, foreignTask); assert.equal(origin.concernEvent!.attentionId, foreignAttention);
    assert.equal(origin.concernEvent!.sequence, 1); assert.equal(origin.concernEvent!.sourceLabel, events[0].sourceLabel);
    return head;
  });
  assert.ok(current.followUp); assert.equal(current.followUp.state, 'pending'); assert.equal(current.followUp.runId, null); assert.notEqual(current.followUp.id, sourceFollowUp);
  const pending = jobs(); assert.equal(pending.length, 1); assert.equal(pending[0].basis, current.followUp.id);
  assert.equal(pending[0].resourceId, saved.id); assert.equal(pending[0].scope.ownerUserId, 'recipient'); assert.equal(pending[0].scope.childId, childId);
  await assert.rejects(persist(row, events, { id: saved.id, expectedVersion: 1 }), { code: 'concern_changed' });
  const secondRow = { ...row, value: { ...row.value, version: 2, reason: 'Second source context',
    followUp: { id: sourceFollowUp, at: future, state: 'completed', runId: sourceRun } } };
  const secondEvents = [{ ...events[0], text: 'Second source snapshot words' }];
  const updated = await persist(secondRow, secondEvents, { id: saved.id, expectedVersion: 2 });
  assert.equal(updated.id, saved.id); assert.equal(updated.version, 3); assert.equal(updated.events[0].text, secondEvents[0].text);
  assert.equal(updated.followUp!.state, 'completed'); assert.equal(updated.followUp!.runId, null); assert.equal(jobs().length, 1);
  const secondHead = await authority.runTransaction('recipient', childId, async binding => {
    const head = await concerns.head(binding, saved.id); assert.ok(head); assert.notEqual(head.timelineId, firstHead.timelineId);
    const previous = await concerns.head(binding, saved.id, 2); assert.ok(previous); assert.equal(previous.timelineId, firstHead.timelineId);
    assert.equal(previous.importedFrom!.current.source.resourceVersion, 1); return head;
  });
  const authorityVersion = (await concerns.list('recipient', childId)).authorityVersion;
  const appended = await concerns.change('recipient', childId, saved.id, { action: 'append', expectedVersion: 3, authorityVersion,
    text: 'Local observation after import', observedAt: at, links: values.links }, randomUUID());
  assert.deepEqual(appended.events.map(event => event.text), [secondEvents[0].text, 'Local observation after import']);
  await authority.runTransaction('recipient', childId, async binding => {
    const head = await concerns.head(binding, saved.id); assert.ok(head); assert.equal(head.timelineId, secondHead.timelineId);
    assert.deepEqual(head.importedFrom, secondHead.importedFrom);
    const snapshot = await binding.transaction.get(data.ref('concern_events', 'concern-event', current.events[0].id));
    const first = data.open('concern-event', current.events[0].id, binding.scope, firestoreDocumentConcernEventSchema, snapshot);
    assert.equal(first.text, events[0].text, 'the older imported snapshot remains immutable');
  });
  const original = await concerns.create('recipient', childId, values, nativeOp);
  assert.equal(original.version, 1); assert.deepEqual(original.events, native.events);
  for (const state of ['closed', 'unknown'] as const) {
    const id = randomUUID(), terminalRow = { ...row, value: { ...row.value, id, status: state === 'closed' ? 'closed' : 'following',
      archivedAt: state === 'closed' ? at : null, followUp: { id: sourceFollowUp, at: future, state: state === 'closed' ? 'pending' : 'unknown', runId: sourceRun } } };
    const result = await persist(terminalRow, [{ ...events[0], id: randomUUID(), concernId: id }]);
    assert.equal(result.status, state === 'closed' ? 'closed' : 'following');
    assert.equal(result.followUp!.state, state === 'closed' ? 'cancelled' : 'unknown'); assert.equal(result.followUp!.runId, null);
    assert.equal(jobs().length, 1, 'terminal source states must not create another follow-up execution');
  }
  const epoch = randomUUID();
  for (const [path, metadata] of [...fixture.records].filter(([path]) => /_concerns\/|_concern_revisions\/|_concern_events\//u.test(path))) {
    const decoded = codec.decode({ path, data: metadata });
    if (decoded.context.family !== 'domain') throw Error('Expected private domain');
    const schema = decoded.context.kind === 'concern-event' ? firestoreDocumentConcernEventSchema : firestoreConcernSchema;
    const source = schema.parse(decoded.value).importedFrom;
    const rotated = codec.transform(decoded, { newEpochByWorkspace: new Map([[decoded.context.scope.workspaceId, epoch]]), generation: randomUUID(), photoDescriptors: new Map() });
    assert.deepEqual(schema.parse(codec.decode(rotated).value).importedFrom, source, 'restore preserves the original encrypted source evidence');
  }
});
