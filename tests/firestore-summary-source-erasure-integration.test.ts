import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Timestamp, type Firestore } from '@google-cloud/firestore';
import { contentErasureSchema, createFirestoreContentErasure, privateInstructionDeletionProof } from '../server/firestore-content-erasure.ts';
import { createFirestoreRestoreCodec } from '../server/firestore-restore-codec.ts';
import { prepareFirebaseRestore } from '../server/firestore-restore.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirestoreCareStore } from '../server/firestore-care.ts';
import { createFirestoreSharedInputStore } from '../server/firestore-shared-inputs.ts';
import { FirestoreDomainData } from '../server/firestore-domain-data.ts';
import { FirestoreSessionService } from '../server/firestore-session-service.ts';
import { createFirestoreErasureStore } from '../server/firestore-erasure.ts';
import { createFirestoreErasureCleanup } from '../server/firestore-erasure-cleanup.ts';
import { setFirebaseBackupControl, FIREBASE_BACKUP_COLLECTION_SUFFIXES } from '../server/firestore-backup.ts';
import { privateSourceErasureOperationId, privateInstructionErasureOperationId, firebaseErasureIntentHash, type FirebaseErasureIntent, type FirebaseErasureDescriptor } from '../server/firebase-erasure-journal.ts';
import { privateSummaryWorkSchema, privateSummaryAttemptSchema, summarySourceRevisionSchema, summaryManifestHash } from '../server/private-summary-work.ts';
import { preparePrivateSummaryRevisionErasure, privateSummaryRevisionErasedBy } from '../server/firestore-private-summary-erasure.ts';
import { createFirestorePrivateInstructions } from '../server/firestore-private-instructions.ts';
import { createFirestoreChatStore } from '../server/firestore-chat.ts';
import { createFirestoreMemoryStore } from '../server/firestore-memory.ts';
import { createFirestoreAgentRuns } from '../server/firestore-agent-runs.ts';
import { createFirestoreAgentProposals } from '../server/firestore-agent-proposals.ts';
import { createFirestoreAgentActions } from '../server/firestore-agent-actions.ts';
import { firestoreAgentActionSavedSchema } from '../server/firestore-private-note-receipt.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';
import { summaryErasureFixture } from './helpers/summary-erasure-fixture.ts';

test('a restored content job keeps its original journal and erases retained old-epoch summary work', async () => {
  const f = await summaryErasureFixture(2), original = f.seed(2), codec = createFirestoreRestoreCodec(f.options);
  const job = { intent: f.intent, journal: f.descriptor, stage: 'done' as const, after: null };
  const saved = f.store('content_erasures', 'content-erasure', f.intent.operationId, contentErasureSchema, job, f.scope, { stage: job.stage });
  const epoch = randomUUID(), restored = codec.transform(codec.decode({ path: saved.path, data: f.fake.records.get(saved.path) }),
    { generation: randomUUID(), newEpochByWorkspace: new Map([[f.scope.workspaceId, epoch]]), photoDescriptors: new Map() });
  f.fake.records.set(restored.path, restored.data);
  const restoredJob = codec.decode(restored); assert.ok(restoredJob.context.family === 'domain');
  assert.equal(restoredJob.context.scope.storageEpoch, epoch);
  let reads = 0;
  const cleanup = createFirestoreContentErasure({ ...f.options, summarySessions: new FirestoreSessionService({ ...f.options, namespace: 'synthetic_restored_summary_native' }),
    journal: { async writeOnce() { throw Error('An original proof must not be written into the restored epoch'); },
      async read(intent, descriptor) { reads++; assert.deepEqual(intent, f.intent); assert.deepEqual(descriptor, f.descriptor); return f.intent; } } });
  const ref = f.data.ref('content_erasures', 'content-erasure', f.intent.operationId);
  for (let page = 0; page < 3; page++) await cleanup.advance(await ref.get());
  const completed = contentErasureSchema.parse(codec.decode({ path: ref.path, data: f.fake.records.get(ref.path) }).value);
  assert.equal(completed.stage, 'done'); assert.equal(completed.privateSummaryComplete, true);
  assert.deepEqual(completed.intent, f.intent); assert.deepEqual(completed.journal, f.descriptor); assert.ok(reads >= 2);
  const work = f.data.open('private-summary-work', f.work.id, f.scope, privateSummaryWorkSchema,
    await f.data.ref('private_summary_works', 'private-summary-work', f.work.id).get());
  assert.equal(work.accumulator, null); assert.equal(work.state, 'invalidated');
  const attempt = f.data.open('private-summary-attempt', original.value.id, f.scope, privateSummaryAttemptSchema,
    await f.data.ref('private_summary_attempts', 'private-summary-attempt', original.value.id).get());
  assert.equal(attempt.resultText, null); assert.equal(attempt.contentState, 'erased');
});

test('private source restore produces a journal-bound tombstone that cleanup can finish after reopening', async () => {
  const f = firestoreDomainFixture();
  const database = { ...f.database, collection(name: string) {
    const q = f.database.collection(name);
    return { ...q, doc(id: string) { const ref = q.doc(id); return { ...ref, async get() {
      const row = await f.database.runTransaction(tx => tx.get(ref)); return { ...row, updateTime: Timestamp.now() };
    } }; } };
  } } as unknown as Firestore;
  const options = { database, cipher: createStorageCipher(Buffer.alloc(32, 83)), projectId: 'synthetic-source-erasure', namespace: 'source_summary_erasure' };
  const authority = createFirestoreAuthority(options), data = new FirestoreDomainData(options), codec = createFirestoreRestoreCodec(options);
  let generation: string = randomUUID(); await authority.initializeControl({ enabled: true, generation });
  const owner = 'synthetic-source-owner', email = owner + '@example.test';
  await authority.issueInvitation({ email, expiresAt: '2030-01-01T00:00:00Z', operationId: randomUUID() });
  await authority.admitIdentity({ userId: owner, email, emailVerified: true });
  await authority.acknowledge({ userId: owner, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  const childId = (await authority.createChild({ userId: owner, operationId: randomUUID(), displayName: '合成還原' })).child.id;
  const sources = createFirestoreSharedInputStore(options), care = createFirestoreCareStore(options),
    online = createFirestoreOnlineStore({ ...options, mutations: [sources.mutation, care.mutation] });
  async function submit(path: string, payload: unknown) {
    path = '/api/children/' + childId + path;
    return online.submit(owner, { path, payload, operation: { ...await online.context(owner, { path, payload }), opId: randomUUID(), deviceId: randomUUID() } });
  }
  async function pause(enabled: boolean) { const next = randomUUID(); await setFirebaseBackupControl(options,
    { expectedGeneration: generation, generation: next, enabled }); generation = next; }
  const documents = () => [...f.records].map(([path, value]) => ({ path, data: structuredClone(value) }));
  const created = await submit('/inputs', { kind: 'personal_source', sourceLabel: 'Synthetic source', sourceUrl: null,
    sourceDateText: null, sourceNotes: '', text: 'Synthetic private source body' });
  const source = (created.result as { input: { id: string; version: number } }).input;
  const careCreated = await submit('/records', { text: 'Synthetic deleted care body' });
  const careRecord = (careCreated.result as { record: { id: string; version: number } }).record;
  await submit('/care/' + careRecord.id + '/delete', { expectedVersion: careRecord.version, confirmDelete: true });
  // The backup contains an unfinished care job whose independent journal has not committed yet.
  await pause(false); const backup = documents(); await pause(true);
  await submit('/inputs/' + source.id + '/delete', { expectedVersion: source.version, confirmDelete: true });
  const intents = new Map<string, FirebaseErasureIntent>(), descriptors = new Map<string, FirebaseErasureDescriptor>();
  let reads = 0;
  const cleanup = createFirestoreContentErasure({ ...options, journal: {
    async writeOnce(intent) { const hash = firebaseErasureIntentHash(intent); intents.set(hash, intent);
      const descriptor: FirebaseErasureDescriptor = { objectName: 'erasures/v1/' + hash, generation: '1', cipherSha256: hash,
        intentSha256: hash, bytes: 512, format: 'yuban-erasure-journal/v1' }; descriptors.set(hash, descriptor); return descriptor; },
    async read(intent, descriptor) { reads++; assert.deepEqual(descriptors.get(firebaseErasureIntentHash(intent)), descriptor);
      return intents.get(descriptor.intentSha256)!; },
  } });
  const jobs = await database.runTransaction(tx => tx.get(data.collection('content_erasures')));
  assert.equal(jobs.size, 2); for (const job of jobs.docs) await cleanup.advance(job);
  const originalIntent = [...intents.values()].find(intent => intent.content!.kind === 'private_source')!; assert.equal(originalIntent.content!.kind, 'private_source');
  await pause(false);
  const restored = prepareFirebaseRestore(options, { restoreId: randomUUID(), targetDatabaseId: 'synthetic-isolated', sourceGeneration: generation,
    documents: backup, liveDocuments: documents(), authUsers: [{ userId: owner, email, emailVerified: true, disabled: false }],
    erasures: [...intents.values()], erasureDescriptors: descriptors, photoDescriptors: new Map() });
  f.records.clear(); for (const item of restored.records) f.records.set(item.path, item.data);
  generation = restored.generation; await pause(true);
  const ref = data.ref('content_erasures', 'content-erasure', originalIntent.operationId);
  const before = codec.decode({ path: ref.path, data: f.records.get(ref.path) });
  assert.ok(before.context.family === 'domain'); assert.notEqual(before.context.scope.storageEpoch, originalIntent.scope.storageEpoch);
  const readsBefore = reads;
  await cleanup.advance(await ref.get()); await cleanup.advance(await ref.get());
  const completed = contentErasureSchema.parse(codec.decode({ path: ref.path, data: f.records.get(ref.path) }).value);
  assert.equal(completed.stage, 'done'); assert.equal(completed.privateSummaryComplete, true); assert.ok(reads > readsBefore);
  assert.deepEqual(completed.intent, originalIntent); assert.equal(intents.size, 2);
  const careIntent = [...intents.values()].find(intent => intent.content!.kind === 'care')!;
  const careRef = data.ref('content_erasures', 'content-erasure', careIntent.operationId);
  const restoredCare = contentErasureSchema.parse(codec.decode({ path: careRef.path, data: f.records.get(careRef.path) }).value);
  assert.deepEqual(restoredCare.journal, descriptors.get(firebaseErasureIntentHash(careIntent)), 'Restore must attach the original proof to a previously unjournaled job');
  for (let page = 0; page < 5; page++) await cleanup.advance(await careRef.get());
  const completedCare = contentErasureSchema.parse(codec.decode({ path: careRef.path, data: f.records.get(careRef.path) }).value);
  assert.equal(completedCare.stage, 'done'); assert.equal(completedCare.privateSummaryComplete, true);
  assert.deepEqual(completedCare.intent, careIntent); assert.equal(await care.get(owner, childId, careRecord.id), null);
  await assert.rejects(sources.get(owner, childId, source.id), { code: 'not_found' });
  const tombstone = await data.ref('shared_inputs', 'shared-input', source.id).get(); assert.equal(tombstone.get('live'), false);
  const prior = structuredClone([...f.records]); await cleanup.backfill(tombstone); assert.deepEqual([...f.records], prior);
});

test('restored job binding rejects foreign subjects, altered headers and unverified proofs without writes', async () => {
  for (const fault of ['owner', 'workspace', 'child', 'operation', 'path', 'stage', 'tag', 'missing-proof', 'proof-hash', 'journal-read', 'completed-journal-read'] as const) {
    const f = await summaryErasureFixture(), scope = { ...f.scope, storageEpoch: randomUUID() };
    if (fault === 'owner') scope.ownerUserId += '-other';
    if (fault === 'workspace') scope.workspaceId = randomUUID();
    if (fault === 'child') scope.childId = randomUUID();
    const descriptor = fault === 'missing-proof' ? null : { ...f.descriptor,
      ...(fault === 'proof-hash' ? { intentSha256: 'c'.repeat(64) } : {}) };
    const job = { intent: f.intent, journal: descriptor, stage: 'done' as const, after: null,
      ...(fault === 'completed-journal-read' ? { privateSummaryComplete: true as const } : {}) };
    const id = fault === 'operation' ? randomUUID() : f.intent.operationId;
    const saved = f.store('content_erasures', 'content-erasure', id, contentErasureSchema, job, scope,
      { stage: fault === 'stage' ? 'revisions' : job.stage });
    const ref = fault === 'path' ? f.data.ref('content_erasures', 'content-erasure', randomUUID()) : f.data.ref('content_erasures', 'content-erasure', id);
    if (fault === 'path') f.fake.records.set(ref.path, f.fake.records.get(saved.path));
    if (fault === 'tag') f.fake.records.set(ref.path, { ...f.fake.records.get(ref.path), childTag: 'invalid-tag' });
    const before = structuredClone([...f.fake.records]);
    const cleanup = createFirestoreContentErasure({ ...f.options, journal: {
      async writeOnce() { throw Error('Invalid restored jobs must not create journal entries'); },
      async read() { return fault === 'journal-read' || fault === 'completed-journal-read'
        ? { ...f.intent, at: '2026-11-03T00:00:00Z' } : f.intent; },
    } });
    await assert.rejects(cleanup.advance(await ref.get()), { code: 'erasure_binding' }, fault);
    assert.deepEqual([...f.fake.records], before, fault + ' must not mutate records or checkpoints');
  }
});


test('summary cleanup independently rechecks the persisted job stage before its transaction writes', async () => {
  const f = await summaryErasureFixture(2), current = f.seed(2), restoredScope = { ...f.scope, storageEpoch: randomUUID() };
  const job = { intent: f.intent, journal: f.descriptor, stage: 'summary_revisions' as const, after: null };
  f.store('content_erasures', 'content-erasure', f.intent.operationId, contentErasureSchema, job, restoredScope, { stage: 'done' });
  const before = structuredClone([...f.fake.records]);
  await assert.rejects(f.fake.database.runTransaction(async tx => {
    const write = await preparePrivateSummaryRevisionErasure(f.data, tx, f.intent.operationId, current.revision.id); write();
  }), { code: 'private_summary_erasure_binding' });
  assert.deepEqual([...f.fake.records], before);
});

test('a private source intent cannot substitute for the independent linked care deletion in summary lineage', async () => {
  const f = await summaryErasureFixture(2), original = f.revision(2);
  const manifest = { ...original.manifest, dependencies: [{ kind: 'care' as const, id: f.intent.assetId, version: 2, validUntil: null }] };
  const revision = summarySourceRevisionSchema.parse({ ...original, manifest, manifestHash: summaryManifestHash(manifest) });
  const sourceOperationId = randomUUID(), privateIntent: FirebaseErasureIntent = { ...f.intent,
    operationId: privateSourceErasureOperationId(f.scope, f.intent.assetId, 2, sourceOperationId),
    content: { kind: 'private_source', throughVersion: 2, sourceOperationId } };
  assert.equal(privateSummaryRevisionErasedBy(revision, privateIntent), false, 'Matching IDs must not conflate a private source with its care dependency');
  assert.equal(privateSummaryRevisionErasedBy(revision, { ...f.intent, operationId: sourceOperationId,
    content: { kind: 'care', throughVersion: 2 } }), true, 'The original care deletion remains the independent authority for summary redaction');
});


test('restore discards an unjournaled content job already covered by completed child erasure', async () => {
  const f = serialFirestoreFixture();
  const database = { ...f.database, collection(name: string) {
    const q = f.database.collection(name);
    return { ...q, doc(id: string) { const ref = q.doc(id); return { ...ref, async get() {
      const row = await f.database.runTransaction(tx => tx.get(ref)); return { ...row, updateTime: Timestamp.now() };
    } }; } };
  } } as unknown as Firestore;
  let now = Date.parse('2026-11-04T00:00:00Z');
  const options = { database, cipher: createStorageCipher(Buffer.alloc(32, 84)), projectId: 'synthetic-scope-erasure',
    namespace: 'scope_summary_erasure', serverClock: () => now };
  const authority = createFirestoreAuthority(options), data = new FirestoreDomainData(options), codec = createFirestoreRestoreCodec(options);
  const intents = new Map<string, FirebaseErasureIntent>(), descriptors = new Map<string, FirebaseErasureDescriptor>();
  const journal = {
    async writeOnce(intent: FirebaseErasureIntent) { const hash = firebaseErasureIntentHash(intent); intents.set(hash, intent);
      const descriptor: FirebaseErasureDescriptor = { objectName: 'erasures/v1/' + hash, generation: '1', cipherSha256: hash,
        intentSha256: hash, bytes: 512, format: 'yuban-erasure-journal/v1' }; descriptors.set(hash, descriptor); return descriptor; },
    async read(intent: FirebaseErasureIntent, descriptor: FirebaseErasureDescriptor) {
      assert.deepEqual(descriptors.get(firebaseErasureIntentHash(intent)), descriptor); return intents.get(descriptor.intentSha256)!;
    },
  };
  const erasures = createFirestoreErasureStore({ ...options, journal }), care = createFirestoreCareStore(options);
  const online = createFirestoreOnlineStore({ ...options, erasures, mutations: [care.mutation] });
  const cleaner = createFirestoreErasureCleanup({ ...options, journal, erasures,
    photos: { async eraseForScope() { throw Error('No synthetic photos'); } },
    async deleteAgentSession() { throw Error('No synthetic agent sessions'); },
    async eraseAgentUserPage() { throw Error('Child cleanup must not erase another account scope'); },
    async eraseDeviceSessions() { throw Error('Child cleanup must not erase device sessions'); },
    async eraseAuthUser() { throw Error('Child cleanup must not erase the account'); },
  });
  let generation: string = randomUUID(); await authority.initializeControl({ enabled: true, generation });
  const owner = 'synthetic-scope-owner', email = owner + '@example.test';
  await authority.issueInvitation({ email, expiresAt: '2030-01-01T00:00:00Z', operationId: randomUUID() });
  await authority.admitIdentity({ userId: owner, email, emailVerified: true });
  await authority.acknowledge({ userId: owner, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  const childId = (await authority.createChild({ userId: owner, operationId: randomUUID(), displayName: '合成刪除' })).child.id;
  async function submit(path: string, payload: unknown) {
    path = '/api/children/' + childId + path;
    const command = { path, payload, operation: { ...await online.context(owner, { path, payload }), opId: randomUUID(), deviceId: randomUUID() } };
    return { command, receipt: await online.submit(owner, command) };
  }
  async function pause(enabled: boolean) { const next = randomUUID(); await setFirebaseBackupControl(options,
    { expectedGeneration: generation, generation: next, enabled }); generation = next; }
  const documents = () => [...f.records].map(([path, value]) => ({ path, data: structuredClone(value) }));
  const created = await submit('/records', { text: 'Synthetic content covered by child erasure' });
  const record = (created.receipt.result as { record: { id: string; version: number } }).record;
  const deleted = await submit('/care/' + record.id + '/delete', { expectedVersion: record.version, confirmDelete: true });
  const contentRef = data.ref('content_erasures', 'content-erasure', deleted.command.operation.opId);
  const pending = contentErasureSchema.parse(codec.decode({ path: contentRef.path, data: f.records.get(contentRef.path) }).value);
  assert.equal(pending.journal, null); assert.equal(pending.stage, 'revisions');
  await pause(false); const backup = documents(); await pause(true);
  const childDeletion = await submit('/delete', { confirmChildId: childId });
  now += 121_000;
  let state = await cleaner.advance(owner, childDeletion.command.operation.opId);
  for (let page = 0; state.state !== 'completed' && page < FIREBASE_BACKUP_COLLECTION_SUFFIXES.length + 8; page++)
    state = await cleaner.advance(owner, childDeletion.command.operation.opId);
  assert.equal(state.state, 'completed'); assert.equal(f.records.has(contentRef.path), false);
  assert.equal(intents.size, 1); assert.equal([...intents.values()][0].type, 'child-delete');
  await pause(false);
  const input = { restoreId: randomUUID(), targetDatabaseId: 'synthetic-isolated', sourceGeneration: generation,
    documents: backup, liveDocuments: documents(), authUsers: [{ userId: owner, email, emailVerified: true, disabled: false }],
    erasures: [...intents.values()], erasureDescriptors: descriptors, photoDescriptors: new Map() };
  const before = structuredClone(input), restored = prepareFirebaseRestore(options, input);
  assert.equal(restored.records.some(row => row.path === contentRef.path), false, 'A scope-erased job is discarded without inventing its missing content proof');
  assert.equal(restored.records.some(row => row.path.startsWith(options.namespace + '_content_erasures/')), false);
  const child = restored.records.map(row => codec.decode(row)).find(row => row.context.kind === 'child' && row.context.id === childId);
  assert.ok(child); assert.equal((child.value as { status: string }).status, 'deleted');
  assert.deepEqual(input, before); assert.equal(intents.size, 1);
});


test('private instruction receipt cleanup finishes summary stages before exposing completed deletion proof', async () => {
  const f = await summaryErasureFixture(2), seeded = f.seed(2), codec = createFirestoreRestoreCodec(f.options);
  const sourceOperationId = randomUUID(), intent: FirebaseErasureIntent = { ...f.intent,
    operationId: privateInstructionErasureOperationId(f.scope, f.intent.assetId),
    content: { kind: 'private_instruction', throughVersion: 2, sourceOperationId } };
  const descriptor = { ...f.descriptor, intentSha256: firebaseErasureIntentHash(intent) };
  const originalWork = structuredClone(f.fake.records.get(f.workRow.path));
  const attemptRef = f.data.ref('private_summary_attempts', 'private-summary-attempt', seeded.value.id);
  const originalAttempt = structuredClone(f.fake.records.get(attemptRef.path));
  assert.equal(privateSummaryRevisionErasedBy(seeded.revision, intent), false,
    'A private instruction must not impersonate a fact dependency with the same UUID');
  const receiptId = randomUUID(), sourceMessageId = randomUUID();
  const saved = firestoreAgentActionSavedSchema.parse({ receipt: { id: receiptId, runId: randomUUID(), kind: 'save_private_note',
    resource: { kind: 'private_note', id: intent.assetId, version: 2 }, state: 'saved', notification: 'not_authorized', channels: [],
    sourceBasis: 'voice_interpretation', createdAt: intent.at }, hash: 'a'.repeat(64), sourceMessageId, sourceMessageIds: [sourceMessageId], policyVersion: 1,
    voiceEvidence: { kind: 'voice_interpretation', voiceId: randomUUID(), voiceVersion: 1, sha256: 'b'.repeat(64), sourceMessageId,
      interpretedQuote: 'Synthetic instruction evidence to erase' } });
  const receipt = f.store('agent_action_receipts', 'agent-action-receipt', receiptId, firestoreAgentActionSavedSchema, saved, f.scope,
    { receiptId, runId: saved.receipt.runId, createdAt: intent.at });
  const job = { intent, journal: descriptor, stage: 'receipts' as const, after: null };
  const initial = f.store('content_erasures', 'content-erasure', intent.operationId, contentErasureSchema, job, f.scope, { stage: job.stage });
  let reads = 0;
  const cleanup = createFirestoreContentErasure({ ...f.options, journal: {
    async writeOnce() { throw Error('The original instruction journal must not be replaced'); },
    async read(value, proof) { reads++; assert.deepEqual(value, intent); assert.deepEqual(proof, descriptor); return intent; },
  } });
  const ref = f.data.ref('content_erasures', 'content-erasure', intent.operationId);
  const current = () => contentErasureSchema.parse(codec.decode({ path: initial.path, data: f.fake.records.get(initial.path) }).value);
  await cleanup.advance(await ref.get());
  assert.equal(firestoreAgentActionSavedSchema.parse(codec.decode({ path: receipt.path, data: f.fake.records.get(receipt.path) }).value).voiceEvidence, undefined);
  assert.equal(privateInstructionDeletionProof(f.scope, intent.assetId, current()), null,
    'A completed deletion proof must not be exposed while summary cleanup remains unverified');
  assert.equal(current().stage, 'summary_revisions');
  for (let page = 0; page < 4 && !current().privateSummaryComplete; page++) await cleanup.advance(await ref.get());
  assert.equal(current().stage, 'done'); assert.equal(current().privateSummaryComplete, true);
  assert.deepEqual(privateInstructionDeletionProof(f.scope, intent.assetId, current()), { version: 3, operationId: sourceOperationId });
  assert.deepEqual(current().intent, intent); assert.deepEqual(current().journal, descriptor); assert.ok(reads >= 3);
  assert.deepEqual(f.fake.records.get(f.workRow.path), originalWork);
  assert.deepEqual(f.fake.records.get(attemptRef.path), originalAttempt);
});

test('private instruction restore reopens original deletion proof and completes cleanup without reissuing its intent', async () => {
  const f = serialFirestoreFixture();
  const database = { ...f.database, collection(name: string) {
    const q = f.database.collection(name);
    return { ...q, doc(id: string) { const ref = q.doc(id); return { ...ref, async get() {
      const row = await f.database.runTransaction(tx => tx.get(ref)); return { ...row, updateTime: Timestamp.now() };
    } }; } };
  } } as unknown as Firestore;
  const options = { database, cipher: createStorageCipher(Buffer.alloc(32, 85)), projectId: 'synthetic-instruction-restore', namespace: 'instruction_summary_erasure' };
  const authority = createFirestoreAuthority(options), data = new FirestoreDomainData(options), codec = createFirestoreRestoreCodec(options);
  let generation: string = randomUUID(); await authority.initializeControl({ enabled: true, generation });
  const owner = 'synthetic-instruction-owner', email = owner + '@example.test';
  await authority.issueInvitation({ email, expiresAt: '2030-01-01T00:00:00Z', operationId: randomUUID() });
  await authority.admitIdentity({ userId: owner, email, emailVerified: true });
  await authority.acknowledge({ userId: owner, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  const childId = (await authority.createChild({ userId: owner, operationId: randomUUID(), displayName: 'Synthetic instruction' })).child.id;
  const notes = createFirestorePrivateInstructions(data), note = { id: randomUUID(), childId, version: 1, title: 'Synthetic note',
    text: 'Synthetic erased instruction body', memoryKey: 'synthetic-note', sourceMessageId: randomUUID(), provenance: 'user_statement' as const,
    createdAt: '2026-11-04T00:00:00Z', updatedAt: '2026-11-04T00:00:00Z' };
  await authority.runTransaction(owner, childId, async b => { const write = await notes.prepareWrite(b, randomUUID(), note, null); write.commit(); });
  const care = createFirestoreCareStore(options), chat = createFirestoreChatStore(options), memory = createFirestoreMemoryStore({ ...options, care, chat });
  const online = createFirestoreOnlineStore(options), runs = createFirestoreAgentRuns({ ...options, chat, memory });
  const actions = createFirestoreAgentActions({ care, online, runs, proposals: createFirestoreAgentProposals({ runs, chat, memory, online }) });
  async function pause(enabled: boolean) { const next = randomUUID(); await setFirebaseBackupControl(options,
    { expectedGeneration: generation, generation: next, enabled }); generation = next; }
  const documents = () => [...f.records].map(([path, value]) => ({ path, data: structuredClone(value) }));
  await pause(false); const backup = documents(); await pause(true);
  const deletion = { operationId: randomUUID(), expectedVersion: 1, confirmDelete: true as const };
  assert.equal(await actions.deleteNote(owner, childId, note.id, deletion), true);
  const intents = new Map<string, FirebaseErasureIntent>(), descriptors = new Map<string, FirebaseErasureDescriptor>();
  let reads = 0;
  const cleanup = createFirestoreContentErasure({ ...options, journal: {
    async writeOnce(intent) { const hash = firebaseErasureIntentHash(intent); assert.equal(intents.size, 0); intents.set(hash, intent);
      const descriptor: FirebaseErasureDescriptor = { objectName: 'erasures/v1/' + hash, generation: '1', cipherSha256: hash,
        intentSha256: hash, bytes: 512, format: 'yuban-erasure-journal/v1' }; descriptors.set(hash, descriptor); return descriptor; },
    async read(intent, descriptor) { reads++; assert.deepEqual(descriptors.get(firebaseErasureIntentHash(intent)), descriptor); return intents.get(descriptor.intentSha256)!; },
  } });
  const jobs = await data.collection('content_erasures').get(); assert.equal(jobs.size, 1); await cleanup.advance(jobs.docs[0]);
  const originalIntent = [...intents.values()][0]; assert.equal(originalIntent.content!.kind, 'private_instruction');
  await pause(false);
  const input = { restoreId: randomUUID(), targetDatabaseId: 'synthetic-isolated', sourceGeneration: generation,
    documents: backup, liveDocuments: documents(), authUsers: [{ userId: owner, email, emailVerified: true, disabled: false }],
    erasures: [...intents.values()], erasureDescriptors: descriptors, photoDescriptors: new Map() };
  assert.throws(() => prepareFirebaseRestore(options, { ...input, erasures: [] }), { code: 'restore_content_journal_pending' });
  const restored = prepareFirebaseRestore(options, input);
  f.records.clear(); for (const item of restored.records) f.records.set(item.path, item.data);
  generation = restored.generation; await pause(true);
  const ref = data.ref('content_erasures', 'content-erasure', originalIntent.operationId);
  const decoded = codec.decode({ path: ref.path, data: f.records.get(ref.path) });
  assert.ok(decoded.context.family === 'domain'); assert.notEqual(decoded.context.scope.storageEpoch, originalIntent.scope.storageEpoch);
  const readsBefore = reads;
  for (let page = 0; page < 2; page++) await cleanup.advance(await ref.get());
  const completed = contentErasureSchema.parse(codec.decode({ path: ref.path, data: f.records.get(ref.path) }).value);
  assert.equal(completed.stage, 'done'); assert.equal(completed.privateSummaryComplete, true); assert.ok(reads > readsBefore);
  assert.deepEqual(completed.intent, originalIntent); assert.deepEqual(completed.journal, descriptors.get(firebaseErasureIntentHash(originalIntent)));
  assert.equal(intents.size, 1); assert.equal(await actions.deleteNote(owner, childId, note.id, deletion), true);
  const remaining = await actions.notes(owner, childId); assert.ok(remaining); assert.equal(remaining.items.length, 0);
  const restoredState = await authority.runTransaction(owner, childId, b => notes.readImportState(b, note.id));
  assert.deepEqual(restoredState, { value: null, version: 2 });
});
