import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreCareStore } from '../server/firestore-care.ts';
import { createFirestoreChatStore } from '../server/firestore-chat.ts';
import { createFirestoreMemoryStore } from '../server/firestore-memory.ts';
import { createFirestoreRestoreCodec } from '../server/firestore-restore-codec.ts';
import { createFirestoreAccountExport } from '../server/firestore-account-export.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { emptyCareDetails } from '../src/shared/care.ts';
import type { HandoverImportRow } from '../server/handover-import.ts';

test('imported memory keeps external evidence and confirmation without borrowing local source authority', async () => {
  const fixture = serialFirestoreFixture(), options = { database: fixture.database, cipher: createStorageCipher(Buffer.alloc(32, 94)),
    projectId: 'demo-memory-import', namespace: 'unit_memory_import' };
  const authority = createFirestoreAuthority(options), care = createFirestoreCareStore(options);
  const memory = createFirestoreMemoryStore({ ...options, care, chat: createFirestoreChatStore(options) });
  await authority.initializeControl({ enabled: true, generation: randomUUID() });
  async function admit(userId: string) {
    const email = userId + '@example.test';
    await authority.issueInvitation({ email, operationId: randomUUID(), expiresAt: new Date(Date.now() + 3600000).toISOString() });
    await authority.admitIdentity({ userId, email, emailVerified: true });
    await authority.acknowledge({ userId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
    return (await authority.createChild({ userId, operationId: randomUUID(), displayName: userId })).child.id;
  }
  const sourceChild = await admit('source'), childId = await admit('recipient');
  const originalRecord = await care.create('source', sourceChild, { text: '喜歡先休息', details: emptyCareDetails(), source: '本人交代' });
  assert.ok(originalRecord);
  const candidate = await memory.createFact('source', sourceChild, { intendedVisibility: 'private', values: { key: 'rest', content: '喜歡先休息',
    validUntil: null, source: { kind: 'care_record', recordId: originalRecord.id, version: originalRecord.version, description: '原照護記錄' } } });
  assert.ok(candidate);
  const original = await memory.confirmFact('source', sourceChild, candidate.id, { expectedVersion: candidate.version, confirm: true, confirmShared: false });
  assert.ok(original);
  const row = (section: string, value: object): HandoverImportRow => ({ section, childId: sourceChild, value: { ...value },
    source: { serverId: 'https://source.test', accountId: 'source', packageId: randomUUID(), packageVersion: 1, manifestSha256: 'b'.repeat(64), path: 'data/1.json', rowIndex: 0 } });
  const imported = await authority.runTransaction('recipient', childId, async b => {
    const prepared = await memory.prepareImportedFact(b, randomUUID(), row('memory_facts', original), 'trusted');
    prepared.commit(); return prepared.value;
  });
  assert.equal(imported.status, 'confirmed'); assert.equal(imported.confirmedBy, 'source');
  assert.equal(imported.confirmationBasis, 'imported_source'); assert.equal(imported.createdBy, 'recipient');
  assert.equal(imported.source.kind, 'imported'); assert.equal(imported.applicable, true);
  assert.equal(imported.importedFrom?.current.source.resourceId, original.id);
  assert.equal((await memory.getFact('recipient', childId, imported.id))?.source.kind, 'imported');
  await assert.rejects(memory.createFact('recipient', childId, { intendedVisibility: 'private', values: {
    key: 'forged', content: 'Cannot invent an imported source', validUntil: null, source: imported.source } }), { code: 'imported_source_not_retained' });
  const revised = await memory.reviseFact('recipient', childId, imported.id, { expectedVersion: imported.version, confirm: true, confirmShared: false,
    values: { key: imported.key, content: '本人補充', source: imported.source, validUntil: null }, reason: '本人更正' });
  assert.ok(revised);
  assert.equal(revised.confirmedBy, 'recipient'); assert.equal(revised.confirmationBasis, undefined);
  assert.ok(revised.importedFrom);
  await assert.rejects(authority.runTransaction('recipient', childId, b => memory.prepareImportedFact(b, randomUUID(), row('memory_facts', original), 'trusted',
    { id: imported.id, expectedVersion: imported.version })), { code: 'version_conflict' });
  await memory.delete('recipient', childId, 'facts', imported.id, revised.version);
  const deleted = await authority.runTransaction('recipient', childId, b => memory.readImportState(b, 'facts', imported.id));
  assert.equal(deleted.value, null); assert.equal(deleted.version, revised.version + 1);
  const unconfirmed = await authority.runTransaction('recipient', childId, async b => {
    const prepared = await memory.prepareImportedFact(b, randomUUID(), row('memory_facts', candidate), 'missing_proof'); prepared.commit(); return prepared.value;
  });
  assert.equal(unconfirmed.status, 'candidate'); assert.equal(unconfirmed.confirmedBy, null); assert.equal(unconfirmed.applicable, false);
  await assert.rejects(authority.runTransaction('recipient', childId, b => memory.prepareImportedFact(b, randomUUID(),
    row('memory_facts', { ...candidate, visibility: 'family' }), 'trusted')), { code: 'invalid_package_data' });
  const topic = await memory.createTopic('source', sourceChild, { title: '已處理事情', note: '舊情況', visibility: 'private', confirmShared: false });
  assert.ok(topic);
  const terminal = await memory.changeTopic('source', sourceChild, topic.id, { expectedVersion: topic.version, status: 'resolved', note: topic.note, resumeAfter: null });
  assert.ok(terminal);
  const importedTopic = await authority.runTransaction('recipient', childId, async b => {
    const prepared = await memory.prepareImportedTopic(b, randomUUID(), row('memory_topics', terminal), 'trusted'); prepared.commit(); return prepared.value;
  });
  assert.equal(importedTopic.status, 'resolved'); assert.equal(importedTopic.mayAsk, false);
  assert.equal(importedTopic.importedFrom?.current.source.authorUserId, 'source');
  await assert.rejects(authority.runTransaction('recipient', childId, b => memory.prepareImportedTopic(b, randomUUID(), row('memory_topics', topic), 'trusted',
    { id: importedTopic.id, expectedVersion: importedTopic.version })), { code: 'terminal_topic' });
  await care.delete('source', sourceChild, originalRecord.id, originalRecord.version);
  const exporter = createFirestoreAccountExport({ ...options, photos: { async content() { throw Error('Unused photo port'); } } });
  const exported = await exporter.page('source', { section: 'memory_facts', childId: sourceChild });
  const stale = exported.items.find(item => (item as { id?: string }).id === original.id) as typeof original;
  assert.equal(stale.sourceState, 'changed'); assert.equal(stale.applicable, false);
  const codec = createFirestoreRestoreCodec(options);
  for (const [path, data] of fixture.records) if (path.includes('_memory_facts/') || path.includes('_memory_topics/')) codec.decode({ path, data });
});
