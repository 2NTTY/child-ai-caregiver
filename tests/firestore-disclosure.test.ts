import test from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp, type Firestore } from '@google-cloud/firestore';
import { randomUUID } from 'node:crypto';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirestoreCareStore } from '../server/firestore-care.ts';
import { createFirestoreChatStore } from '../server/firestore-chat.ts';
import { createFirestoreMemoryStore } from '../server/firestore-memory.ts';
import { createFirestoreSharedInputStore } from '../server/firestore-shared-inputs.ts';
import { createFirestoreFamilyDocumentStore } from '../server/firestore-family-documents.ts';
import { createFirestoreAccountExport } from '../server/firestore-account-export.ts';
import { createFirestoreContentErasure, contentErasureSchema } from '../server/firestore-content-erasure.ts';
import { createFirestoreOnlineReceipts } from '../server/firestore-online-receipts.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { emptyCareDetails } from '../src/shared/care.ts';
import { FirestoreDomainData } from '../server/firestore-domain-data.ts';
import { erasureCoversPhoto, firebaseErasureIntentHash, type FirebaseErasureIntent, type FirebaseErasureDescriptor } from '../server/firebase-erasure-journal.ts';
import { setFirebaseBackupControl } from '../server/firestore-backup.ts';
import { prepareFirebaseRestore } from '../server/firestore-restore.ts';
import { createFirestoreRestoreCodec } from '../server/firestore-restore-codec.ts';

// One connected synthetic flow; no SDK network, model, notifications or real restore.
test('deleted content stays hidden in history, export, original receipts and isolated restore while valid history survives', async () => {
  const f = firestoreDomainFixture();
  const database = { ...f.database, collection(name: string) {
    const q = f.database.collection(name);
    return { ...q, get: () => f.database.runTransaction(tx => tx.get(q)), doc(id: string) {
      const ref = q.doc(id); return { ...ref, async get() {
        const row = await f.database.runTransaction(tx => tx.get(ref));
        return { ...row, updateTime: Timestamp.now() };
      } };
    } };
  } } as unknown as Firestore;
  const options = { database, cipher: createStorageCipher(Buffer.alloc(32, 32)),
    projectId: 'synthetic-disclosure', namespace: 'disclosure' };
  const authority = createFirestoreAuthority(options), data = new FirestoreDomainData(options);
  let generation: string = randomUUID(); await authority.initializeControl({ enabled: true, generation });
  async function pause(enabled: boolean) { const next = randomUUID(); await setFirebaseBackupControl(options, { expectedGeneration: generation, generation: next, enabled }); generation = next; }
  for (const userId of ['parent', 'peer']) {
    const email = userId + '@example.test'; await authority.issueInvitation({ email, expiresAt: new Date(Date.now() + 60000).toISOString(), operationId: randomUUID() });
    await authority.admitIdentity({ userId, email, emailVerified: true });
    await authority.acknowledge({ userId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  }
  const childId = (await authority.createChild({ userId: 'parent', operationId: randomUUID(), displayName: '合成' })).child.id;
  const base = '/api/children/' + childId, care = createFirestoreCareStore(options), chat = createFirestoreChatStore(options);
  const memory = createFirestoreMemoryStore({ ...options, care, chat }), docs = createFirestoreFamilyDocumentStore(options);
  const sources = createFirestoreSharedInputStore(options);
  const online = createFirestoreOnlineStore({ ...options, mutations: [care.mutation, memory.mutation, sources.mutation] });
  const exporter = createFirestoreAccountExport({ ...options, photos: { async content() { throw Error('No photos in this scenario'); } } });
  async function submit(path: string, payload: unknown) {
    const command = { path: base + path, payload, operation: { ...await online.context('parent', { path: base + path, payload }), opId: randomUUID(), deviceId: randomUUID() } };
    const receipt = await online.submit('parent', command); return { command, receipt, result: receipt.result as any };
  }
  const record = await submit('/records', { text: 'PRIVATE-OLD-CARE' });
  const careId = record.result.record.id;
  await submit('/care/' + careId + '/revise', { details: record.result.record.details, source: record.result.record.source,
    text: 'PRIVATE-NEW-CARE', expectedVersion: 1, reason: '更正', confirmShared: true });
  assert.equal((await exporter.page('parent', { section: 'care_history', childId })).items.length, 2);
  const profile = await submit('/profile', { expectedVersion: 0, confirmShared: true, reason: '核對', data: { age: { kind: 'unknown' }, dueDate: null,
    gestationalWeeksRaw: null, region: null, language: null, allergies: 'PRIVATE-ALLERGY', specialNeeds: null, preferences: null, source: '本人', validUntil: null } });
  const fact = await submit('/memory/facts', { values: { key: '合成', content: 'PRIVATE-FACT', source: { kind: 'manual', description: '本人' }, validUntil: null }, intendedVisibility: 'private' });
  const topic = await submit('/memory/topics', { title: 'PRIVATE-TOPIC', note: 'PRIVATE-NOTE', visibility: 'private', confirmShared: false });
  const privateContent = { kind: 'personal_source', sourceLabel: 'Private source to erase', sourceUrl: null,
    sourceDateText: null, sourceNotes: 'Private source notes', text: 'PRIVATE-SOURCE-OLD-BODY ' + 'old '.repeat(2000) };
  const privateSource = await submit('/inputs', privateContent);
  const privateId = privateSource.result.input.id;
  const management = { intention: 'PRIVATE-SOURCE-OLD-MANAGEMENT', purpose: 'answer_reference', nature: 'external_material',
    timeScope: 'long_reference', validityText: '', enabled: true, modelExcerpt: 'PRIVATE-SOURCE-OLD-BODY' };
  const managed = await submit('/inputs/' + privateId + '/manage', { expectedVersion: privateSource.result.input.version,
    management, content: null, reason: 'First private source management' });
  const revised = await submit('/inputs/' + privateId + '/manage', { expectedVersion: managed.result.input.version,
    management: { ...management, intention: 'PRIVATE-SOURCE-NEW-MANAGEMENT', modelExcerpt: null },
    content: { ...privateContent, text: 'PRIVATE-SOURCE-NEW-BODY ' + 'new '.repeat(2000) }, reason: 'Second private source management' });
  const confirmedSource = await submit('/inputs/' + privateId + '/confirm', { expectedVersion: revised.result.input.version,
    confirmShared: true, kind: 'reference', confirmChildFact: false,
    values: { text: 'PRIVATE-SOURCE-LINKED-CARE', source: 'Private reference', details: emptyCareDetails() } });
  const linkedCareId = confirmedSource.result.recordId;
  const retainedSource = await submit('/inputs', { ...privateContent, sourceLabel: 'Retained private source', text: 'VALID-SOURCE-BODY' });
  const retainedId = retainedSource.result.input.id;
  await submit('/inputs/' + retainedId + '/manage', { expectedVersion: retainedSource.result.input.version,
    management: { ...management, intention: 'VALID-SOURCE-MANAGEMENT', modelExcerpt: null }, content: null, reason: 'Retained source management' });
  assert.equal((await sources.managementHistory('parent', childId, privateId))!.revisions.length, 2);
  const document = (await docs.create('parent', childId, { kind: 'preparation', purpose: 'appointment', title: '合成', eventDate: '2026-10-15', period: { from: '2026-10-01', to: '2026-10-31' } }, randomUUID()))!;
  assert.ok((await exporter.page('parent', { section: 'document_content', childId })).items.length);
  await assert.rejects(exporter.page('peer', { section: 'care_history', childId }));
  await pause(false);
  const backup = [...f.records].map(([path, value]) => ({ path, data: structuredClone(value) }));
  await pause(true);
  // Old receipts from before pointer storage remain supported and must also redact.
  const ledger = createFirestoreOnlineReceipts(options);
  await authority.runTransaction('parent', null, async b => {
    const stored = await ledger.read(b, record.command.operation.opId); assert.ok(stored && !('state' in stored));
    const id = JSON.stringify(['parent', record.command.operation.opId]);
    const { firestoreOnlineRecordSchema } = await import('../server/firestore-online-receipts.ts');
    b.transaction.set(data.ref('online_operations', 'online-receipt', id), { ...data.tags(b.scope),
      ...data.seal('online-receipt', id, b.scope, firestoreOnlineRecordSchema, { ...stored, result: record.result }) });
  });
  for (const [path, expectedVersion] of [['/care/' + careId + '/delete', 2], ['/profile/delete', 1],
    ['/memory/facts/' + fact.result.fact.id + '/delete', 1], ['/memory/topics/' + topic.result.topic.id + '/delete', 1]] as const)
    await submit(path, { expectedVersion, confirmDelete: true });
  const sourceDeletion = await submit('/inputs/' + privateId + '/delete', { expectedVersion: confirmedSource.result.input.version, confirmDelete: true });
  await assert.rejects(sources.get('parent', childId, privateId), { code: 'not_found' });
  await assert.rejects(sources.managementHistory('parent', childId, privateId), { code: 'not_found' });
  assert.equal(await care.get('parent', childId, linkedCareId), null);
  assert.equal(await care.get('parent', childId, careId), null);
  assert.equal(await care.history('parent', childId, careId), null);
  for (const section of ['care_history', 'memory_fact_history', 'memory_topic_history']) assert.deepEqual((await exporter.page('parent', { section, childId })).items, []);
  assert.equal(JSON.stringify(await exporter.page('parent', { section: 'profile_history', childId })).includes('PRIVATE-ALLERGY'), false);
  for (const saved of [record, profile, fact, topic]) {
    assert.equal((await online.lookup('parent', saved.command.operation.opId) as any).result, null);
    assert.equal((await online.submit('parent', saved.command)).result, null);
  }
  assert.equal((await docs.get('parent', childId, document.id))!.current, null);
  assert.equal((await exporter.page('parent', { section: 'document_content', childId })).items.every((v: any) => v.snapshot === null && v.invalidated), true);
  const intents: FirebaseErasureIntent[] = [], descriptors = new Map<string, FirebaseErasureDescriptor>();
  let journalReads = 0;
  const cleanup = createFirestoreContentErasure({ ...options, journal: {
    async writeOnce(intent) { const hash = firebaseErasureIntentHash(intent); intents.push(intent);
      const descriptor: FirebaseErasureDescriptor = { objectName: 'erasures/v1/' + hash, generation: '1', cipherSha256: hash, intentSha256: hash, bytes: 512, format: 'yuban-erasure-journal/v1' };
      descriptors.set(hash, descriptor); return descriptor; },
    async read(intent) { journalReads++; return intent; },
  } });
  const codec = createFirestoreRestoreCodec(options);
  const sourceJobs = (await data.collection('content_erasures').get()).docs.filter(row => {
    const value = contentErasureSchema.parse(codec.decode({ path: row.ref.path, data: row.data()! }).value);
    return value.intent.content?.kind === 'private_source' && value.intent.assetId === privateId;
  });
  assert.equal(sourceJobs.length, 1);
  const sourceJob = sourceJobs[0], originalSourceIntent = contentErasureSchema.parse(codec.decode({ path: sourceJob.ref.path, data: sourceJob.data()! }).value).intent;
  // Simulate the pre-upgrade tombstone: its linked care cleanup exists, but the private-source job/journal never existed.
  f.records.delete(sourceJob.ref.path);
  assert.equal((await data.ref('content_erasures', 'content-erasure', sourceDeletion.command.operation.opId).get()).exists, true);
  for (const job of (await data.collection('content_erasures').get()).docs) { await cleanup.advance(job); await cleanup.advance(await database.runTransaction(tx => tx.get(job.ref))); }
  const planRestore = () => prepareFirebaseRestore(options, { restoreId: randomUUID(), targetDatabaseId: 'isolated', sourceGeneration: generation,
    documents: backup, liveDocuments: [...f.records].map(([path, value]) => ({ path, data: structuredClone(value) })),
    authUsers: ['parent', 'peer'].map(userId => ({ userId, email: userId + '@example.test', emailVerified: true, disabled: false })),
    erasures: intents, erasureDescriptors: descriptors, photoDescriptors: new Map() });
  await pause(false);
  assert.throws(planRestore, { code: 'restore_content_journal_pending' }, 'A legacy private-source tombstone cannot be resurrected merely because its job is absent');
  await pause(true);
  const legacyTombstone = await data.ref('shared_inputs', 'shared-input', privateId).get();
  await cleanup.backfill(legacyTombstone);
  const rebuilt = await database.runTransaction(tx => tx.get(sourceJob.ref));
  const rebuiltIntent = contentErasureSchema.parse(codec.decode({ path: rebuilt.ref.path, data: rebuilt.data()! }).value).intent;
  assert.equal(rebuilt.exists, true); assert.equal(rebuiltIntent.operationId, originalSourceIntent.operationId);
  assert.equal(rebuiltIntent.at, originalSourceIntent.at, 'Legacy backfill preserves the original deletion time');
  const rebuiltState = structuredClone([...f.records]);
  await cleanup.backfill(legacyTombstone);
  assert.deepEqual([...f.records], rebuiltState, 'The second legacy backfill must reuse exactly the same job, ID and timestamp');
  await cleanup.advance(rebuilt); await cleanup.advance(await database.runTransaction(tx => tx.get(rebuilt.ref)));
  assert.equal((await data.collection('care_revisions').get()).size, 0);
  assert.equal((await data.collection('memory_fact_revisions').get()).size, 0);
  const sourceIntents = intents.filter(intent => intent.type === 'content-delete'
    && intent.content?.kind === 'private_source' && intent.content.sourceOperationId === sourceDeletion.command.operation.opId
    && intent.assetId === privateId);
  assert.equal(sourceIntents.length, 1, 'A linked private source needs its own independent journal obligation linked to the original deletion operation');
  const careIntents = intents.filter(intent => intent.type === 'content-delete' && intent.content?.kind === 'care'
    && intent.operationId === sourceDeletion.command.operation.opId && intent.assetId === linkedCareId);
  assert.equal(careIntents.length, 1, 'The linked care record retains the original deletion operation for its journal obligation');
  assert.notEqual(sourceIntents[0].operationId, careIntents[0].operationId, 'Different erased resources must not share an owner-operation journal object key');
  for (const intent of intents) assert.equal(erasureCoversPhoto(intent, intent.scope, intent.assetId), false);
  await pause(false);
  const restored = planRestore();
  f.records.clear(); for (const item of restored.records) f.records.set(item.path, item.data);
  generation = restored.generation; await pause(true);
  assert.equal(await care.get('parent', childId, careId), null);
  assert.equal((await care.profile('parent', childId))!.data, null);
  assert.equal((await online.lookup('parent', record.command.operation.opId) as any).result, null);
  for (const section of ['care_history', 'memory_fact_history', 'memory_topic_history'])
    assert.deepEqual((await exporter.page('parent', { section, childId })).items, []);
  assert.equal((await docs.get('parent', childId, document.id))!.current, null);
  await assert.rejects(sources.get('parent', childId, privateId), { code: 'not_found' });
  await assert.rejects(sources.managementHistory('parent', childId, privateId), { code: 'not_found' });
  assert.equal(await care.get('parent', childId, linkedCareId), null);
  assert.equal((await sources.get('parent', childId, retainedId))!.text, 'VALID-SOURCE-BODY');
  assert.equal((await sources.managementHistory('parent', childId, retainedId))!.revisions[0].management?.intention, 'VALID-SOURCE-MANAGEMENT');
  assert.deepEqual((await sources.list('parent', childId))!.inputs.map(input => input.id), [retainedId]);
  const sourceExport = await exporter.page('parent', { section: 'private_sources', childId });
  const sourceHistory = await exporter.page('parent', { section: 'private_source_history', childId });
  assert.equal(JSON.stringify([sourceExport, sourceHistory]).includes('PRIVATE-SOURCE-'), false, 'Restored export must not disclose old private body or management evidence');
  assert.ok(JSON.stringify(sourceExport).includes('VALID-SOURCE-BODY'));
  assert.equal((await data.collection('shared_input_parts').get()).docs.some(row => row.get('entityId') === privateId), false);
  assert.equal((await data.collection('shared_input_management_revisions').get()).docs.some(row => row.get('entityId') === privateId), false);
  const restoredSourceTombstone = await data.ref('shared_inputs', 'shared-input', privateId).get();
  assert.equal(restoredSourceTombstone.exists, true); assert.equal(restoredSourceTombstone.get('live'), false);
  const beforeBackfill = structuredClone([...f.records]), oldJournal = structuredClone(intents), oldDescriptors = structuredClone([...descriptors]);
  const readsBeforeBackfill = journalReads;
  await cleanup.backfill(restoredSourceTombstone);
  assert.deepEqual([...f.records], beforeBackfill, 'Backfilling a replayed private source tombstone must not open another cleanup job');
  assert.deepEqual(intents, oldJournal); assert.deepEqual([...descriptors], oldDescriptors);
  assert.equal(journalReads, readsBeforeBackfill, 'A replayed tombstone must not touch the old-epoch journal again');
});
