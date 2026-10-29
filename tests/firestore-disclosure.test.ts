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
import { createFirestoreFamilyDocumentStore } from '../server/firestore-family-documents.ts';
import { createFirestoreAccountExport } from '../server/firestore-account-export.ts';
import { createFirestoreContentErasure } from '../server/firestore-content-erasure.ts';
import { createFirestoreOnlineReceipts } from '../server/firestore-online-receipts.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { FirestoreDomainData } from '../server/firestore-domain-data.ts';
import { erasureCoversPhoto, firebaseErasureIntentHash, type FirebaseErasureIntent, type FirebaseErasureDescriptor } from '../server/firebase-erasure-journal.ts';
import { setFirebaseBackupControl } from '../server/firestore-backup.ts';
import { prepareFirebaseRestore } from '../server/firestore-restore.ts';

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
  const online = createFirestoreOnlineStore({ ...options, mutations: [care.mutation, memory.mutation] });
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
  const cleanup = createFirestoreContentErasure({ ...options, journal: {
    async writeOnce(intent) { const hash = firebaseErasureIntentHash(intent); intents.push(intent);
      const descriptor: FirebaseErasureDescriptor = { objectName: 'erasures/v1/' + hash, generation: '1', cipherSha256: hash, intentSha256: hash, bytes: 512, format: 'yuban-erasure-journal/v1' };
      descriptors.set(hash, descriptor); return descriptor; },
    async read(intent) { return intent; },
  } });
  for (const job of (await data.collection('content_erasures').get()).docs) { await cleanup.advance(job); await cleanup.advance(await database.runTransaction(tx => tx.get(job.ref))); }
  assert.equal((await data.collection('care_revisions').get()).size, 0);
  assert.equal((await data.collection('memory_fact_revisions').get()).size, 0);
  for (const intent of intents) assert.equal(erasureCoversPhoto(intent, intent.scope, intent.assetId), false);
  await pause(false);
  const restored = prepareFirebaseRestore(options, { restoreId: randomUUID(), targetDatabaseId: 'isolated', sourceGeneration: generation,
    documents: backup, liveDocuments: [...f.records].map(([path, value]) => ({ path, data: structuredClone(value) })),
    authUsers: ['parent', 'peer'].map(userId => ({ userId, email: userId + '@example.test', emailVerified: true, disabled: false })),
    erasures: intents, erasureDescriptors: descriptors, photoDescriptors: new Map() });
  f.records.clear(); for (const item of restored.records) f.records.set(item.path, item.data);
  generation = restored.generation; await pause(true);
  assert.equal(await care.get('parent', childId, careId), null);
  assert.equal((await care.profile('parent', childId))!.data, null);
  assert.equal((await online.lookup('parent', record.command.operation.opId) as any).result, null);
  for (const section of ['care_history', 'memory_fact_history', 'memory_topic_history'])
    assert.deepEqual((await exporter.page('parent', { section, childId })).items, []);
  assert.equal((await docs.get('parent', childId, document.id))!.current, null);
});
