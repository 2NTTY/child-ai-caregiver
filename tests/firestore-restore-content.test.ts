import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { FieldValue, VectorValue, type DocumentData, type DocumentReference, type Firestore, type Transaction } from '@google-cloud/firestore';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirestoreFamilyDocumentStore, firestoreFamilyDocumentSchemas } from '../server/firestore-family-documents.ts';
import { FirestoreFamilyDocumentSnapshots, firestoreFamilyDocumentSnapshotSchemas } from '../server/firestore-family-document-snapshots.ts';
import { createFirestoreTaskWorker, firestoreTaskReminderSchema, firestoreTaskReminderBatchSchema, firestoreTaskNotificationOutboxSchema } from '../server/firestore-task-worker.ts';
import { firestoreReminderOutboxSchema, firestoreTaskSchema, firestoreTaskRevisionSchema } from '../server/firestore-domain-data.ts';
import { createFirestoreKnowledgeStore, firestoreKnowledgeSchemas } from '../server/firestore-knowledge.ts';
import { embeddingDocument, knowledgeHash, sourceVersionHash, parseKnowledgeSource } from '../server/knowledge-inputs.ts';
import type { KnowledgeReviewAssessment } from '../server/knowledge-review-assessment.ts';
import { createFirestoreRestoreCodec, FirestoreRestoreCodecError, type FirestoreRestoreDecoded, type FirestoreRestoreValue } from '../server/firestore-restore-codec.ts';
import { assertFirestoreRestoreContent } from '../server/firestore-restore-content.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { KNOWLEDGE_EMBEDDING, type KnowledgeSourceInput } from '../src/shared/knowledge.ts';
import type { CareTask } from '../src/shared/tasks.ts';
import type { DocumentSnapshot } from '../src/shared/family-documents.ts';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';

const projectId = 'synthetic-restore-content', namespace = 'synthetic_restore_content', uid = 'synthetic-owner';
const rejects = (code: string) => (error: unknown) => error instanceof FirestoreRestoreCodecError && error.code === code && error.status === 409;
const find = (records: readonly FirestoreRestoreDecoded[], kind: string, predicate = (_row: FirestoreRestoreDecoded) => true) => {
  const record = records.find(row => row.context.kind === kind && predicate(row)); assert.ok(record, `Missing synthetic ${kind}`); return record;
};
const replace = (records: readonly FirestoreRestoreDecoded[], old: FirestoreRestoreDecoded, value: FirestoreRestoreValue) =>
  records.map(record => record === old ? { ...record, value } : record);
const remove = (records: readonly FirestoreRestoreDecoded[], old: FirestoreRestoreDecoded) => records.filter(record => record !== old);

async function privateRecords() {
  const fake = firestoreDomainFixture(), generation = randomUUID();
  const options = { database: fake.database, cipher: createStorageCipher(Buffer.alloc(32, 92)), projectId, namespace,
    serverClock: () => Date.parse('2026-10-11T04:00:00Z') };
  const authority = createFirestoreAuthority(options), online = createFirestoreOnlineStore(options), documents = createFirestoreFamilyDocumentStore(options);
  await authority.initializeControl({ enabled: true, generation });
  await authority.issueInvitation({ email: 'owner@example.test', expiresAt: '2027-01-01T00:00:00Z', operationId: randomUUID() });
  await authority.admitIdentity({ userId: uid, email: 'owner@example.test', emailVerified: true });
  await authority.acknowledge({ userId: uid, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  const child = (await authority.createChild({ userId: uid, operationId: randomUUID(), displayName: '合成恢復孩子' })).child;
  async function command(path: string, payload: unknown) {
    return online.submit(uid, { path, payload, operation: { ...await online.context(uid, { path, payload }), opId: randomUUID(), deviceId: randomUUID() } });
  }
  const receipt = await command(`/api/children/${child.id}/tasks`, { confirm: true, values: { title: 'Synthetic task', details: 'Synthetic task source',
    kind: 'appointment', assigneeUserId: uid, dueAt: '2026-10-11T03:00:00Z', timeZone: 'Asia/Hong_Kong' } });
  const task = (receipt.result as { task: CareTask }).task, binding = await authority.readScope(uid, child.id);
  const worker = createFirestoreTaskWorker({ ...options, enabled: true, async currentAuth(userId) {
    return { userId, disabled: false, emailVerified: true, email: 'owner@example.test' };
  } });
  assert.equal((await worker.process({ kind: 'task-reminder', scope: binding.scope, taskId: task.id, taskVersion: task.version,
    occurrenceId: task.occurrence.id, authorizationVersion: binding.authorizationVersion, generation, scheduledAt: task.occurrence.dueAt })).state, 'processed');
  let document = (await documents.create(uid, child.id, { kind: 'preparation', purpose: 'appointment', title: 'Synthetic preparation', eventDate: '2026-10-15',
    period: { from: '2026-10-01', to: '2026-10-31' } }, randomUUID()))!;
  const originalSnapshotId = document.current!.id;
  for (let i = 0; i < 11; i++) {
    document = (await documents.change(uid, child.id, document.id, { action: 'patch', expectedVersion: document.version,
      authorityVersion: (await documents.describe(uid, child.id, document.id))!.authorityVersion, confirmShared: true,
      edits: [{ op: 'set_metadata', title: `Synthetic history ${i}` }] }, randomUUID()))!;
  }
  assert.equal(document.history.length, 10); assert.equal(document.history.some(snapshot => snapshot.id === originalSnapshotId), false);
  // The native formatter writes a retained multi-chunk snapshot without adding it to the current ten-item index.
  const extra: DocumentSnapshot = { ...document.current!, id: randomUUID(), version: 1, summary: '記🙂'.repeat(12000) };
  const snapshots = new FirestoreFamilyDocumentSnapshots(options), prepared = snapshots.prepare(binding.scope, document.id, extra);
  assert.ok(prepared.manifest.count > 1);
  await fake.database.runTransaction(async tx => { prepared.commit(tx); });
  await command(`/api/children/${child.id}/tasks/${task.id}/change`, { confirm: true, action: 'reschedule', expectedVersion: 1,
    dueAt: '2026-10-12T03:00:00Z', timeZone: 'Asia/Hong_Kong', assigneeUserId: uid, note: 'Synthetic reschedule' });
  const codec = createFirestoreRestoreCodec(options), records = [...fake.records].map(([path, data]) => codec.decode({ path, data }));
  return { records, codec, options, binding, documentId: document.id, originalSnapshotId, extra };
}

function vectorMemory() {
  const fake = firestoreDomainFixture();
  const encode = (value: unknown): unknown => value instanceof VectorValue ? { syntheticVector: value.toArray() }
    : Array.isArray(value) ? value.map(encode) : value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)])) : value;
  const decode = (value: unknown): unknown => {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(decode);
    const row = value as Record<string, unknown>;
    if (Object.keys(row).length === 1 && Array.isArray(row.syntheticVector)) return FieldValue.vector(row.syntheticVector);
    return Object.fromEntries(Object.entries(row).map(([key, item]) => [key, decode(item)]));
  };
  const database = { collection: (path: string) => fake.database.collection(path),
    runTransaction<T>(operation: (tx: Transaction) => Promise<T>) {
      return fake.database.runTransaction(tx => operation({
        get: async (target: DocumentReference) => { const snapshot = await tx.get(target);
          return { ...snapshot, data: () => decode(snapshot.data()), get: (field: string) => decode(snapshot.get(field)) }; },
        getAll: async (...targets: DocumentReference[]) => (await tx.getAll(...targets)).map(snapshot =>
          ({ ...snapshot, data: () => decode(snapshot.data()), get: (field: string) => decode(snapshot.get(field)) })),
        create: (ref: DocumentReference, value: DocumentData) => tx.create(ref, encode(value) as DocumentData),
        set: (ref: DocumentReference, value: DocumentData) => tx.set(ref, encode(value) as DocumentData),
      } as unknown as Transaction));
    } } as unknown as Firestore;
  return { fake, database, decode };
}
async function publicRecords(codec: ReturnType<typeof createFirestoreRestoreCodec>) {
  const memory = vectorMemory(), store = createFirestoreKnowledgeStore({ database: memory.database, projectId, namespace, sourceIds: ['synthetic-guidance'] });
  const input: KnowledgeSourceInput = { sourceId: 'synthetic-guidance', url: 'https://www.fhs.gov.hk/synthetic-guidance', title: 'Synthetic guidance',
    publisher: 'Synthetic publisher', classification: 'official_guidance', sourcePublishedAt: null, sourceUpdatedAt: null,
    fetchedAt: '2026-01-01T00:00:00Z', validUntil: '2026-02-01T00:00:00Z', termsUrl: 'https://www.fhs.gov.hk/terms',
    chunks: ['first', 'second'].map(key => ({ key, section: `Synthetic ${key}`, sourceExcerpt: 'Synthetic original excerpt',
      originalText: 'Synthetic original excerpt and original body', text: `Synthetic ${key} guidance`, keywords: ['synthetic'],
      applicability: { region: 'HK', ageBasis: 'any', minAgeMonths: null, maxAgeMonths: null, topics: ['care'], conditions: [] } })) };
  const review: KnowledgeReviewAssessment = { comparedVersionId: null, comparedHash: null, observationHash: null,
    changes: input.chunks.map(chunk => ({ key: chunk.key, oldQuote: null, newQuote: chunk.sourceExcerpt, meaning: 'new', explanation: 'Synthetic manual comparison' })),
    checks: { age: 'Reviewed', numbersAndUnits: 'Reviewed', timing: 'Reviewed', conditions: 'Reviewed', exceptions: 'Reviewed', prohibitions: 'Reviewed', withdrawal: 'Reviewed' },
    questions: [{ query: 'Synthetic question', expectedKeys: ['first', 'second'], reason: 'Synthetic coverage check' }],
    growthRuleImpact: 'none', growthRuleReason: 'Synthetic review found no growth rule change', decision: 'approve' };
  // Publish while the selected edition is valid, then restore at the real date after its validity window.
  const clock = mock.method(Date, 'now', () => Date.parse('2026-01-15T00:00:00Z'));
  let publishedId: string;
  try {
    const imported = await store.importSource(input); publishedId = imported.versionId;
    await store.review(imported.versionId, imported.hash, 'synthetic-operator', review);
    await store.publish(imported.versionId, imported.hash, input.chunks.map(chunk => ({ chunkKey: chunk.key,
      inputHash: embeddingDocument(input.title, chunk.section, chunk.text).hash, ...KNOWLEDGE_EMBEDDING,
      values: [1, ...Array(KNOWLEDGE_EMBEDDING.dimensions - 1).fill(0)] })));
    await store.importSource({ ...input, chunks: input.chunks.map(chunk => ({ ...chunk, text: chunk.text + ' draft revision' })) });
  } finally { clock.mock.restore(); }
  const records = [...memory.fake.records].map(([path, data]) => codec.decode({ path, data: memory.decode(data) }));
  return { records, publishedId };
}
let baselinePromise: Promise<Awaited<ReturnType<typeof fixture>>> | undefined;
async function fixture() { const privateData = await privateRecords(), publicData = await publicRecords(privateData.codec);
  return { ...privateData, ...publicData, records: [...privateData.records, ...publicData.records] }; }
const baseline = () => baselinePromise ??= fixture();

test('native content retains unlisted document history, historical task sources, expired publication, draft editions and original vectors across epoch restore', async () => {
  const f = await baseline(), currentTask = firestoreTaskSchema.parse(find(f.records, 'task').value);
  assert.equal(currentTask.version, 2); assert.ok(find(f.records, 'task-revision', row => row.context.id === JSON.stringify([currentTask.id, 1])));
  assert.ok(find(f.records, 'document-snapshot', row => row.context.id === f.originalSnapshotId));
  const publicChunk = find(f.records, 'knowledge-chunk', row => firestoreKnowledgeSchemas.chunk.parse(row.value).versionId === f.publishedId);
  const vector = firestoreKnowledgeSchemas.chunk.parse(publicChunk.value).embedding; assert.ok(vector instanceof VectorValue);
  const before = f.records.map(record => ({ ...record, context: { ...record.context } }));
  assertFirestoreRestoreContent(f.records); assert.deepEqual(f.records, before);
  assert.equal(firestoreKnowledgeSchemas.chunk.parse(publicChunk.value).embedding, vector);
  const input = { newEpochByWorkspace: new Map([[f.binding.scope.workspaceId, randomUUID()]]), generation: randomUUID(), photoDescriptors: new Map() };
  const restored = f.records.map(record => { const transformed = f.codec.transform(record, input); return f.codec.decode({ path: transformed.path, data: transformed.data }); });
  assertFirestoreRestoreContent(restored);
});

test('every snapshot needs exact complete chunks, matching version/size/hash and a same-scope parent even outside the history index', async () => {
  const f = await baseline(), manifest = find(f.records, 'document-snapshot', row => row.context.id === f.extra.id);
  const value = firestoreFamilyDocumentSnapshotSchemas.manifest.parse(manifest.value);
  const chunk = find(f.records, 'document-snapshot-chunk', row => row.context.id === JSON.stringify([f.extra.id, 0]));
  assert.throws(() => assertFirestoreRestoreContent(remove(f.records, chunk)), rejects('restore_content_missing'));
  assert.throws(() => assertFirestoreRestoreContent(replace(f.records, manifest, { ...value, hash: '0'.repeat(64) })), rejects('restore_content_binding'));
  assert.throws(() => assertFirestoreRestoreContent([...f.records, chunk]), rejects('restore_content_duplicate'));
  assert.notEqual(chunk.context.family, 'knowledge'); if (chunk.context.family === 'knowledge') throw Error('Expected private chunk');
  const mismatched = { ...chunk, context: { ...chunk.context, recordVersion: 2 } };
  assert.throws(() => assertFirestoreRestoreContent(f.records.map(row => row === chunk ? mismatched : row)), rejects('restore_content_binding'));
  const extra = { ...chunk, context: { ...chunk.context, id: JSON.stringify([f.extra.id, value.count]) }, value: { index: value.count, text: 'extra' } };
  assert.throws(() => assertFirestoreRestoreContent([...f.records, extra]), rejects('restore_content_missing'));
  const metadata = find(f.records, 'family-document'); assert.notEqual(metadata.context.family, 'knowledge');
  if (metadata.context.family === 'knowledge') throw Error('Expected private metadata');
  const foreign = { ...metadata, context: { ...metadata.context, scope: { ...metadata.context.scope, childId: randomUUID() } } };
  assert.throws(() => assertFirestoreRestoreContent(f.records.map(row => row === metadata ? foreign : row)), rejects('restore_content_binding'));
});

test('task revisions and actual reminder/notification pairs bind historical versions and occurrences without requiring a pending reminder', async () => {
  const f = await baseline(), current = find(f.records, 'task'), task = firestoreTaskSchema.parse(current.value);
  const currentRevision = find(f.records, 'task-revision', row => row.context.id === JSON.stringify([task.id, task.version]));
  assert.throws(() => assertFirestoreRestoreContent(remove(f.records, currentRevision)), rejects('restore_content_missing'));
  const revision = firestoreTaskRevisionSchema.parse(currentRevision.value);
  assert.throws(() => assertFirestoreRestoreContent(replace(f.records, currentRevision, { ...revision, task: { ...revision.task, title: 'Divergent revision' } })), rejects('restore_content_binding'));
  const reminderRecord = find(f.records, 'task-reminder'), reminder = firestoreTaskReminderSchema.parse(reminderRecord.value);
  assert.equal(reminder.taskVersion, 1);
  assert.throws(() => assertFirestoreRestoreContent(replace(f.records, reminderRecord, { ...reminder, occurrenceId: randomUUID() })), rejects('restore_content_binding'));
  const notification = find(f.records, 'task-notification-outbox');
  assert.throws(() => assertFirestoreRestoreContent(remove(f.records, notification)), rejects('restore_content_missing'));
  const batchRecord = find(f.records, 'task-reminder-batch'), batch = firestoreTaskReminderBatchSchema.parse(batchRecord.value);
  assert.throws(() => assertFirestoreRestoreContent(replace(f.records, batchRecord, { ...batch, key: randomUUID() })), rejects('restore_content_binding'));
  const intent = firestoreTaskNotificationOutboxSchema.parse(notification.value);
  assert.throws(() => assertFirestoreRestoreContent(replace(f.records, notification, { ...intent, taskVersion: 2 })), rejects('restore_content_binding'));
  const pending = find(f.records, 'task-reminder-outbox', row => firestoreReminderOutboxSchema.parse(row.value).state === 'pending');
  const work = firestoreReminderOutboxSchema.parse(pending.value); assert.equal(work.taskVersion, 2);
  assert.throws(() => assertFirestoreRestoreContent(replace(f.records, pending, { ...work, taskVersion: 3 })), rejects('restore_content_missing'));
  assert.throws(() => assertFirestoreRestoreContent(remove(f.records, current)), rejects('restore_content_missing'));
});

test('original document-operation snapshots and all task sources remain resolvable; unsupported source domains fail closed', async () => {
  const f = await baseline(), original = find(f.records, 'document-operation', row => firestoreFamilyDocumentSchemas.operation.parse(row.value).document.version === 1);
  const operation = firestoreFamilyDocumentSchemas.operation.parse(original.value);
  assert.equal(operation.document.currentId, f.originalSnapshotId);
  const manifest = find(f.records, 'document-snapshot', row => row.context.id === operation.document.currentId);
  assert.throws(() => assertFirestoreRestoreContent(remove(f.records, manifest)), rejects('restore_content_missing'));
  const task = firestoreTaskSchema.parse(find(f.records, 'task').value), oldRevision = find(f.records, 'task-revision', row => row.context.id === JSON.stringify([task.id, 1]));
  assert.throws(() => assertFirestoreRestoreContent(remove(f.records, oldRevision)), rejects('restore_content_missing'));
  const fake = firestoreDomainFixture(), snapshots = new FirestoreFamilyDocumentSnapshots({ ...f.options, database: fake.database });
  const changed = { ...f.extra, sources: f.extra.sources.map(source => ({ ...source, kind: 'record' as const })) };
  const prepared = snapshots.prepare(f.binding.scope, f.documentId, changed); await fake.database.runTransaction(async tx => { prepared.commit(tx); });
  const replacements = [...fake.records].map(([path, data]) => f.codec.decode({ path, data }));
  const corrupt = f.records.filter(row => row.context.kind !== 'document-snapshot' && row.context.kind !== 'document-snapshot-chunk'
    || row.context.id !== f.extra.id && !row.context.id.startsWith(JSON.stringify([f.extra.id]).slice(0, -1)));
  assert.throws(() => assertFirestoreRestoreContent([...corrupt, ...replacements]), rejects('unsupported_restore_domain'));
});

test('public source/version/chunk graph rejects missing, shared, orphaned and corrupted chunks and enforces the active publication', async () => {
  const f = await baseline(), versionRecord = find(f.records, 'knowledge-version', row => row.context.id === f.publishedId);
  const version = firestoreKnowledgeSchemas.version.parse(versionRecord.value), first = version.chunks[0], second = version.chunks[1];
  assert.ok(first); assert.ok(second);
  const chunkRecord = find(f.records, 'knowledge-chunk', row => row.context.id === first.chunkId);
  const chunk = firestoreKnowledgeSchemas.chunk.parse(chunkRecord.value);
  assert.throws(() => assertFirestoreRestoreContent(remove(f.records, chunkRecord)), rejects('restore_content_missing'));
  assert.throws(() => assertFirestoreRestoreContent(replace(f.records, versionRecord, { ...version, versionHash: '0'.repeat(64) })), rejects('restore_content_binding'));
  assert.throws(() => assertFirestoreRestoreContent(replace(f.records, chunkRecord, { ...chunk, embeddingHash: '0'.repeat(64) })), rejects('restore_content_binding'));
  const orphanId = randomUUID();
  assert.throws(() => assertFirestoreRestoreContent([...f.records, { ...chunkRecord, context: { ...chunkRecord.context, id: orphanId },
    value: { ...chunk, chunkId: orphanId } }]), rejects('restore_content_missing'));
  const duplicateKey = { ...version, chunks: [first, { ...first, order: 2 }] };
  assert.throws(() => assertFirestoreRestoreContent(replace(f.records, versionRecord, duplicateKey)), rejects('restore_content_binding'));
  assert.throws(() => assertFirestoreRestoreContent(replace(f.records, versionRecord, { ...version, reviewState: 'draft' })), rejects('restore_content_binding'));
  assert.throws(() => assertFirestoreRestoreContent(replace(f.records, chunkRecord, { ...chunk, embedding: null, vectorHash: null, model: null, dimensions: null, pipeline: null })), rejects('restore_content_binding'));
  const sourceRecord = find(f.records, 'knowledge-source'), source = firestoreKnowledgeSchemas.source.parse(sourceRecord.value);
  assert.throws(() => assertFirestoreRestoreContent(replace(f.records, sourceRecord, { ...source, activeVersionId: randomUUID() })), rejects('restore_content_missing'));
  const changedDocument = { ...chunk.document, text: chunk.document.text + ' changed after version hash' };
  const coherentChunk = { ...chunk, document: changedDocument, contentHash: knowledgeHash(changedDocument),
    embeddingHash: embeddingDocument(version.header.title, changedDocument.section, changedDocument.text).hash };
  const rebuilt = parseKnowledgeSource({ ...version.header, chunks: [changedDocument,
    firestoreKnowledgeSchemas.chunk.parse(find(f.records, 'knowledge-chunk', row => row.context.id === second.chunkId).value).document] });
  assert.notEqual(sourceVersionHash(rebuilt), version.versionHash);
  assert.throws(() => assertFirestoreRestoreContent(replace(f.records, chunkRecord, coherentChunk)), rejects('restore_content_binding'));
});
