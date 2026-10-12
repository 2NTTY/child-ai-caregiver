import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { Timestamp, type DocumentSnapshot, type Firestore } from '@google-cloud/firestore';
import { z } from 'zod';
import { createFirestoreAuthority, firestoreAuthoritySchemas } from '../server/firestore-authority.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirestorePhotoStore, firestorePhotoSchemas } from '../server/firestore-photos.ts';
import { FirestoreDomainData, firestoreReminderOutboxSchema } from '../server/firestore-domain-data.ts';
import { FirestoreDeviceSessions } from '../server/firestore-device-sessions.ts';
import { createFirestoreRestoreCodec, type FirestoreRestoreDecoded } from '../server/firestore-restore-codec.ts';
import { prepareFirebaseRestore, firebaseRestoreEpoch, firebaseRestoreGeneration, type FirebaseRestoreInput } from '../server/firestore-restore.ts';
import { setFirebaseBackupControl, type FirebaseBackupDocument } from '../server/firestore-backup.ts';
import { firestoreOnlineConfirmedSchema, firestoreOnlineErasureBarrierSchema } from '../server/firestore-online-receipts.ts';
import { firebaseErasureIntentHash, type FirebaseErasureIntent, type FirebaseErasureDescriptor } from '../server/firebase-erasure-journal.ts';
import { FirebasePhotoObjectError, type FirebasePhotoObjectDescriptor, type FirebasePhotoObjects } from '../server/firebase-photo-objects.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import type { OnlineSubmission } from '../src/shared/online.ts';
import type { PhotoMetadata } from '../src/shared/photos.ts';
import type { WorkRecoveryScope } from '../server/firestore-work-continuation-recovery.ts';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';

const OWNER = 'synthetic-restore-owner', EMAIL = 'synthetic-restore@example.test';
const AT = '2026-10-11T12:00:00.000Z', TARGET = 'synthetic-target-db';
const PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(4), Buffer.from('IHDR'), Buffer.alloc(8)]);
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const META: PhotoMetadata = { fileName: 'synthetic.png', source: 'synthetic-restore-test', mimeType: 'image/png', bytes: PNG.length, sha256: hash(PNG) };
const rejected = (code: string) => (error: unknown) => error instanceof Error && 'code' in error && error.code === code;

function fixture() {
  const fake = firestoreDomainFixture(), projectId = 'synthetic-restore-project', namespace = 'unit_restore';
  // Add only public snapshot/readback capabilities required by the real operator pause port.
  // The serial transaction/query harness remains synthetic; no native export or cloud concurrency is tested.
  const database = {
    projectId, databaseId: 'synthetic-source-db',
    collection(path: string) {
      const collection = fake.database.collection(path);
      return { ...collection, doc(id: string) {
        const ref = collection.doc(id);
        return { ...ref, async get() { return { exists: fake.records.has(ref.path), ref,
          data: () => structuredClone(fake.records.get(ref.path)), updateTime: Timestamp.fromDate(new Date(AT)) }; } };
      } };
    },
    runTransaction: fake.database.runTransaction.bind(fake.database),
  } as unknown as Firestore;
  const options = { database, cipher: createStorageCipher(Buffer.alloc(32, 79)), projectId, namespace, serverClock: () => Date.parse(AT) };
  const authority = createFirestoreAuthority(options), data = new FirestoreDomainData(options), codec = createFirestoreRestoreCodec(options);
  const stored = new Map<string, FirebasePhotoObjectDescriptor>();
  const intents = new Map<string, FirebaseErasureIntent>(), erasureDescriptors = new Map<string, FirebaseErasureDescriptor>();
  let generation = randomUUID(), loseObjectReply = false, pauseOnJournal = false;
  function objectName(scope: WorkRecoveryScope, id: string) {
    const full = { ownerUserId: scope.ownerUserId, workspaceId: scope.workspaceId, childId: scope.childId, storageEpoch: scope.storageEpoch };
    return 'photos/v1/' + hash(JSON.stringify(['yuban-photo-object', 1, projectId, namespace, full])) + '/' + id;
  }
  const objects: Pick<FirebasePhotoObjects, 'write' | 'recover' | 'read'> = {
    async write(scope, id, input) {
      const objectNameValue = objectName(scope, id), bytes = Buffer.from(input.base64, 'base64');
      const descriptor: FirebasePhotoObjectDescriptor = { objectName: objectNameValue, generation: '1', cipherSha256: hash(objectNameValue),
        sha256: hash(bytes), bytes: bytes.length, mimeType: input.mimeType };
      assert.equal(stored.has(objectNameValue), false); stored.set(objectNameValue, descriptor);
      if (loseObjectReply) { loseObjectReply = false; throw new FirebasePhotoObjectError('photo_object_unavailable', 503); }
      return descriptor;
    },
    async recover(scope, id) { const descriptor = stored.get(objectName(scope, id)); assert.ok(descriptor); return descriptor; },
    async read(scope, id, descriptor) { assert.deepEqual(stored.get(objectName(scope, id)), descriptor);
      return { buffer: PNG, base64: PNG.toString('base64'), mimeType: descriptor.mimeType }; },
  };
  async function switchControl(enabled: boolean) {
    const next = randomUUID();
    await setFirebaseBackupControl(options, { expectedGeneration: generation, generation: next, enabled });
    generation = next;
  }
  const photos = createFirestorePhotoStore({ ...options, objects, journal: { async writeOnce(intent) {
    const intentSha256 = firebaseErasureIntentHash(intent), prior = intents.get(intentSha256);
    if (prior) assert.deepEqual(prior, intent); else intents.set(intentSha256, structuredClone(intent));
    const descriptor: FirebaseErasureDescriptor = { objectName: 'erasures/v1/' + hash(JSON.stringify([projectId, namespace, intent.scope.ownerUserId, intent.operationId])),
      generation: '1', cipherSha256: hash(intentSha256), intentSha256, bytes: 512, format: 'yuban-erasure-journal/v1' };
    erasureDescriptors.set(intentSha256, descriptor);
    // Pause after the append-only journal commits, before the photo writer's final transaction.
    if (pauseOnJournal) { pauseOnJournal = false; await switchControl(false); }
    return descriptor;
  } } });
  const online = createFirestoreOnlineStore({ ...options, photos });
  async function command(path: string, payload: unknown): Promise<OnlineSubmission> {
    return { path, payload, operation: { ...await online.context(OWNER, { path, payload }), opId: randomUUID(), deviceId: randomUUID() } };
  }
  function documents(): FirebaseBackupDocument[] { return [...fake.records].map(([path, value]) => ({ path, data: structuredClone(value) })); }
  function decoded(documents: readonly FirebaseBackupDocument[]) {
    return documents.filter(row => !row.path.startsWith(namespace + '_sessions/')).map(row => codec.decode(row));
  }
  function row(kind: string, id: string): FirestoreRestoreDecoded {
    const record = decoded(documents()).find(record => record.context.kind === kind && record.context.id === id);
    assert.ok(record); return record;
  }
  async function initialize() {
    await authority.initializeControl({ generation, enabled: true });
    await authority.issueInvitation({ email: EMAIL, expiresAt: '2030-01-01T00:00:00.000Z', operationId: randomUUID() });
    await authority.admitIdentity({ userId: OWNER, email: EMAIL, emailVerified: true });
    await authority.acknowledge({ userId: OWNER, policyVersion: SERVICE_POLICY_VERSION, operationId: randomUUID() });
    const create = await command('/api/children', { displayName: '合成還原孩子' }), receipt = await online.submit(OWNER, create);
    const childId = z.object({ child: z.object({ id: z.uuid() }) }).parse(receipt.result).child.id;
    const binding = await authority.readScope(OWNER, childId);
    await online.submit(OWNER, await command('/api/children/' + childId + '/tasks', { confirm: true, values: {
      title: 'Synthetic restore task', details: 'Synthetic task source', kind: 'ordinary', assigneeUserId: OWNER,
      dueAt: '2026-10-12T12:00:00.000Z', timeZone: 'Asia/Hong_Kong' } }));
    await new FirestoreDeviceSessions({ ...options, namespace: namespace + '_sessions' }).issue({ userId: OWNER, sessionHash: '1'.repeat(64),
      expiresAtMs: Date.parse(AT) + 86_400_000, authTimeSeconds: Date.parse(AT) / 1000 });
    return binding;
  }
  async function reserve(childId: string) {
    const submission = await command('/api/children/' + childId + '/photos', META), receipt = await online.submit(OWNER, submission);
    const id = z.object({ photo: z.object({ id: z.uuid() }) }).parse(receipt.result).photo.id;
    return { id, submission, receipt };
  }
  async function ready(childId: string) { const reserved = await reserve(childId);
    await photos.upload(OWNER, childId, reserved.id, PNG.toString('base64'));
    return { ...reserved, row: firestorePhotoSchemas.photo.parse(row('photo', reserved.id).value) };
  }
  function descriptors(restoreId: string, values: readonly z.infer<typeof firestorePhotoSchemas.photo>[]) {
    const replacements = new Map<string, FirebasePhotoObjectDescriptor>();
    for (const value of values) {
      assert.ok(value.descriptor);
      const scope = { ...value.scope, storageEpoch: firebaseRestoreEpoch(projectId, TARGET, restoreId, value.scope.workspaceId) };
      const objectNameValue = objectName(scope, value.id);
      replacements.set(value.id, { ...value.descriptor, objectName: objectNameValue, generation: '2', cipherSha256: hash(objectNameValue) });
    }
    return replacements;
  }
  function input(snapshot: FirebaseBackupDocument[], restoreId: string, photoDescriptors: ReadonlyMap<string, FirebasePhotoObjectDescriptor>,
    disabled = false): FirebaseRestoreInput {
    return { restoreId, targetDatabaseId: TARGET, sourceGeneration: generation, documents: snapshot, liveDocuments: documents(),
      authUsers: [{ userId: OWNER, email: EMAIL, emailVerified: true, disabled }],
      erasures: [...intents.values()].map(value => structuredClone(value)), erasureDescriptors: new Map(erasureDescriptors), photoDescriptors };
  }
  return { fake, options, authority, data, codec, photos, online, command, documents, decoded, row, initialize, reserve, ready,
    descriptors, input, switchControl, intents, erasureDescriptors, objectName,
    loseObject: () => { loseObjectReply = true; }, pauseAfterJournal: () => { pauseOnJournal = true; } };
}
function find(records: readonly FirestoreRestoreDecoded[], kind: string, id?: string): FirestoreRestoreDecoded {
  const record = records.find(row => row.context.kind === kind && (id === undefined || row.context.id === id));
  assert.ok(record, 'Expected restored ' + kind); return record;
}
function confirmed(records: readonly FirestoreRestoreDecoded[], operationId: string) {
  return firestoreOnlineConfirmedSchema.parse(find(records, 'online-receipt', JSON.stringify([OWNER, operationId])).value);
}
function assertNoMutation(f: ReturnType<typeof fixture>, source: readonly [string, unknown][], input: FirebaseRestoreInput, original: FirebaseRestoreInput) {
  assert.deepEqual([...f.fake.records], source); assert.deepEqual(input, original);
}

test('F07 restores a private conversation and receipt while invalidating interrupted execution and confirmation', async () => {
  const { createFirestoreChatStore } = await import('../server/firestore-chat.ts');
  const { createFirestoreCareStore } = await import('../server/firestore-care.ts');
  const { createFirestoreMemoryStore } = await import('../server/firestore-memory.ts');
  const { createFirestoreAgentRuns } = await import('../server/firestore-agent-runs.ts');
  const { createFirestoreAgentProposals } = await import('../server/firestore-agent-proposals.ts');
  const { createFirestoreAgentActions } = await import('../server/firestore-agent-actions.ts');
  const f = fixture(), binding = await f.initialize(), childId = binding.scope.childId;
  const chat = createFirestoreChatStore(f.options), care = createFirestoreCareStore(f.options);
  const memory = createFirestoreMemoryStore({ ...f.options, chat, care });
  const online = createFirestoreOnlineStore({ ...f.options, mutations: [chat.mutation, care.mutation, memory.mutation] });
  const runs = createFirestoreAgentRuns({ ...f.options, chat, memory });
  const proposals = createFirestoreAgentProposals({ runs, chat, memory, online });
  const actions = createFirestoreAgentActions({ runs, proposals, care, online });
  const policy = await actions.savePolicy(OWNER, childId, { operationId: randomUUID(), expectedVersion: 0,
    recordKinds: [], allowPrivateNotes: true, allowRecordCorrections: false, allowSelfTasks: false,
    reminderConsentVersion: null, reminderBindings: [], confirm: true, confirmShared: false });
  const message = await chat.createUserMessageForUser(OWNER, childId, '記住明天整理健康手冊。');
  assert.ok(message && policy);
  const run = await runs.claim(OWNER, childId, { kind: 'interactive', reference: message.id }, 'product-interactive');
  const receipt = await actions.execute(run.scope, run.runId, 'save-note', { kind: 'save_private_note',
    sourceQuote: message.text, expectedPolicyVersion: policy.version, title: '整理手冊', text: message.text });
  assert.ok(receipt);
  const pending = await proposals.propose(run.scope, run.runId, 'task-candidate', { kind: 'task_create', values: {
    title: '整理手冊', details: '', kind: 'ordinary', assigneeUserId: OWNER,
    dueAt: new Date(Date.now() + 3600000).toISOString(), timeZone: 'Asia/Hong_Kong' } });
  await f.switchControl(false);
  for (const row of f.documents().filter(row => !row.path.startsWith(f.options.namespace + '_sessions/'))) {
    try { f.codec.decode(row); } catch (cause) { throw new Error('Restore fixture collection: ' + row.path.split('/')[0], { cause }); }
  }
  const output = prepareFirebaseRestore(f.options, f.input(f.documents(), randomUUID(), new Map()));
  assert.equal(output.records.some(row => row.path.startsWith(f.options.namespace + '_sessions/')), false);
  f.fake.records.clear(); for (const row of output.records) f.fake.records.set(row.path, row.data);
  // Operator-only reopening is separate from preparation. This does not execute a model or a worker.
  await setFirebaseBackupControl(f.options, { expectedGeneration: output.generation, generation: randomUUID(), enabled: true });
  const latest = await f.authority.readScope(OWNER, childId);
  await f.authority.runTransaction(OWNER, childId, async b => {
    assert.equal((await chat.readMessage(b, childId, message.id))?.text, message.text);
    assert.equal((await actions.readNote(b, receipt.resource.id))?.text, message.text);
    assert.equal((await actions.readReceipts(b, run.runId))[0]?.receipt.id, receipt.id);
    assert.equal((await runs.read(b, run.runId)).state, 'unknown');
    assert.equal((await actions.readPolicy(b)).effective, false);
  });
  assert.notEqual(latest.scope.storageEpoch, binding.scope.storageEpoch);
  assert.equal(await runs.authorize(run.scope, run.runId), false);
  const restored = f.decoded(f.documents());
  const candidate = find(restored, 'agent-proposal', pending.id).value as { proposal: { status: string } };
  assert.equal(candidate.proposal.status, 'expired');
});

test('F07 excludes an erased child and original receipt payloads from an older backup', async () => {
  const { firestoreScopeErasureSchema } = await import('../server/firestore-erasure.ts');
  const f=fixture(), binding=await f.initialize(), childId=binding.scope.childId;
  await f.switchControl(false);const snapshot=f.documents();await f.switchControl(true);
  const operationId=randomUUID(), intent:FirebaseErasureIntent={type:'child-delete',scope:binding.scope,assetId:childId,operationId,at:AT};
  f.intents.set(firebaseErasureIntentHash(intent),intent);
  await f.authority.runTransaction(OWNER,null,async b=>{const barrier=await b.prepareErasure(operationId,'child',childId);barrier.commit();});
  await f.authority.finishErasure(binding.scope,'child');
  // F04 covers real erasure. This fixture supplies its completed evidence to the pure restoration function.
  const nil='00000000-0000-0000-0000-000000000000',scope={ownerUserId:OWNER,workspaceId:nil,childId:nil,storageEpoch:nil};
  const id=JSON.stringify([OWNER,operationId]),saved=firestoreScopeErasureSchema.parse({intent,authorizationVersion:binding.authorizationVersion,
    generation:randomUUID(),state:'completed',journal:null,receiptToken:null,expiresAt:null,blockedAt:AT,scopeVersion:'1',childCount:1,cleanup:{stage:'done',cursor:null}});
  f.fake.records.set(f.data.ref('erasures','scope-erasure',id).path,{...f.data.tags(scope),operationId,state:'completed',
    ...f.data.seal('scope-erasure',id,scope,firestoreScopeErasureSchema,saved)});
  await f.switchControl(false);
  const restored=f.decoded(prepareFirebaseRestore(f.options,f.input(snapshot,randomUUID(),new Map())).records);
  assert.equal(firestoreAuthoritySchemas.child.parse(find(restored,'child',childId).value).status,'deleted');
  assert.equal(restored.some(row=>['child-projection','authority-child-detail','task','task-revision'].includes(row.context.kind)),false);
  assert.equal(JSON.stringify(restored.map(row=>row.value)).includes('合成還原孩子'),false);
});

test('restore applies current revocation and journal erasure without restoring sessions or post-backup child authority', async () => {
  const f = fixture(), binding = await f.initialize(), erased = await f.ready(binding.scope.childId), survivor = await f.ready(binding.scope.childId);
  await f.switchControl(false); const snapshot = f.documents(); await f.switchControl(true);
  const deleteInput = await f.command('/api/children/' + binding.scope.childId + '/photos/' + erased.id + '/delete',
    { expectedVersion: erased.row.version, confirmDelete: true });
  await f.online.submit(OWNER, deleteInput);
  const laterChild = await f.authority.createChild({ userId: OWNER, operationId: randomUUID(), displayName: '快照後合成孩子' });
  const laterPhoto = await f.ready(laterChild.scope.childId);
  const laterDelete = await f.command('/api/children/' + laterChild.scope.childId + '/photos/' + laterPhoto.id + '/delete',
    { expectedVersion: laterPhoto.row.version, confirmDelete: true });
  await f.online.submit(OWNER, laterDelete);
  await f.authority.revokeInvitation({ email: EMAIL, operationId: randomUUID() });
  await f.switchControl(false);
  const restoreId = randomUUID(), input = f.input(snapshot, restoreId, f.descriptors(restoreId, [survivor.row]), true);
  const original = structuredClone(input), source = structuredClone([...f.fake.records]);
  const originalReserve = confirmed(f.decoded(snapshot), erased.submission.operation.opId);
  const output = prepareFirebaseRestore(f.options, input), restored = f.decoded(output.records);
  const nextEpoch = firebaseRestoreEpoch(f.options.projectId, TARGET, restoreId, binding.scope.workspaceId);
  assert.equal(output.newEpochByWorkspace.get(binding.scope.workspaceId), nextEpoch); assert.notEqual(nextEpoch, binding.scope.storageEpoch);
  assert.equal(output.generation, firebaseRestoreGeneration(f.options.projectId, TARGET, restoreId));
  assert.deepEqual(firestoreAuthoritySchemas.control.parse(find(restored, 'control').value), { enabled: false, generation: output.generation });
  const account = firestoreAuthoritySchemas.account.parse(find(restored, 'account', OWNER).value);
  assert.equal(account.admitted, false); assert.equal(account.invitationLive, false); assert.equal(account.emailVerified, false);
  assert.equal(firestoreAuthoritySchemas.identity.parse(find(restored, 'authority-identity', OWNER).value).state, 'revoked');
  assert.equal(firestoreAuthoritySchemas.invitation.parse(find(restored, 'authority-invitation', EMAIL).value).state, 'revoked');
  assert.equal(restored.some(row => row.context.kind === 'child' && row.context.id === laterChild.scope.childId), false);
  assert.equal(restored.filter(row => row.context.kind === 'photo').length, 1);
  assert.equal(restored.some(row => row.context.kind === 'photo' && row.context.id === erased.id), false);
  const reserve = confirmed(restored, erased.submission.operation.opId);
  assert.equal(reserve.result, null); assert.equal(reserve.fingerprint, originalReserve.fingerprint);
  assert.deepEqual(reserve.operation, originalReserve.operation); assert.equal(reserve.restoredFromEpoch, binding.scope.storageEpoch);
  for (const [id, submission] of [[erased.id, deleteInput], [laterPhoto.id, laterDelete]] as const) {
    const barrierRecord = find(restored, 'online-receipt', JSON.stringify([OWNER, submission.operation.opId]));
    const barrier = firestoreOnlineErasureBarrierSchema.parse(barrierRecord.value);
    assert.equal(barrier.assetId, id); assert.equal(barrier.state, 'erasure_barrier');
    assert.equal(firestoreOnlineConfirmedSchema.safeParse(barrierRecord.value).success, false);
    const cleanup = find(restored, 'photo-cleanup', id), oldCleanup = input.liveDocuments.find(row => row.path === cleanup.path);
    assert.ok(oldCleanup); assert.deepEqual(output.records.find(row => row.path === cleanup.path)?.data, oldCleanup.data);
    assert.equal(firestorePhotoSchemas.cleanup.parse(cleanup.value).scope.storageEpoch, binding.scope.storageEpoch);
  }
  const quota = firestorePhotoSchemas.globalQuota.parse(find(restored, 'photo-global-quota').value);
  assert.deepEqual(quota, { activeBytes: PNG.length, activeCount: 1, cleanupBytes: PNG.length * 2, cleanupCount: 2 });
  assert.deepEqual(firestorePhotoSchemas.childQuota.parse(find(restored, 'photo-child-quota').value), { bytes: PNG.length, count: 1 });
  const survivorRecord = find(restored, 'photo', survivor.id), survivorValue = firestorePhotoSchemas.photo.parse(survivorRecord.value);
  assert.equal(survivorValue.scope.storageEpoch, nextEpoch); assert.deepEqual(survivorValue.descriptor, input.photoDescriptors.get(survivor.id));
  const rawSurvivor = output.records.find(row => row.path === survivorRecord.path); assert.ok(rawSurvivor);
  assert.throws(() => f.data.open('photo', survivor.id, binding.scope, firestorePhotoSchemas.photo,
    { exists: true, data: () => rawSurvivor.data } as DocumentSnapshot));
  const sessions = snapshot.filter(row => row.path.startsWith(f.options.namespace + '_sessions/')); assert.equal(sessions.length, 2);
  for (const session of sessions) assert.equal(output.removePaths.includes(session.path), true);
  assert.equal(output.records.some(row => row.path.startsWith(f.options.namespace + '_sessions/')), false);
  const reminder = firestoreReminderOutboxSchema.parse(find(restored, 'task-reminder-outbox').value);
  assert.equal(reminder.storageEpoch, nextEpoch); assert.equal(reminder.generation, output.generation); assert.equal(reminder.authorizationVersion, '2');
  for (const value of [output.journalHash, output.authHash, output.authorityHash]) assert.match(value, /^[a-f0-9]{64}$/u);
  assert.throws(() => prepareFirebaseRestore(f.options, { ...input, erasures: [], erasureDescriptors: new Map() }), rejected('restore_erasure_missing'));
  assertNoMutation(f, source, input, original);
});

test('restore charges known cleanup after journal success and pause before the photo delete final transaction', async () => {
  const f = fixture(), binding = await f.initialize(), photo = await f.ready(binding.scope.childId);
  await f.switchControl(false); const snapshot = f.documents(); await f.switchControl(true);
  const submission = await f.command('/api/children/' + binding.scope.childId + '/photos/' + photo.id + '/delete',
    { expectedVersion: photo.row.version, confirmDelete: true });
  f.pauseAfterJournal();
  await assert.rejects(f.online.submit(OWNER, submission), rejected('service_disabled'));
  const partial = firestorePhotoSchemas.photo.parse(f.row('photo', photo.id).value);
  assert.equal(partial.state, 'deleting'); assert.equal(partial.deletion?.journal, null);
  assert.equal(f.documents().some(row => row.path === f.data.ref('photo_cleanup', 'photo-cleanup', photo.id).path), false);
  const input = f.input(snapshot, randomUUID(), new Map()), original = structuredClone(input), source = structuredClone([...f.fake.records]);
  const output = prepareFirebaseRestore(f.options, input), restored = f.decoded(output.records);
  assert.equal(restored.some(row => row.context.kind === 'photo'), false);
  const cleanup = firestorePhotoSchemas.cleanup.parse(find(restored, 'photo-cleanup', photo.id).value);
  assert.equal(cleanup.state, 'known'); assert.deepEqual(cleanup.scope, photo.row.scope);
  assert.deepEqual(cleanup.descriptor, photo.row.descriptor); assert.deepEqual(cleanup.upload, photo.row.upload);
  assert.ok(partial.deletion);
  assert.deepEqual(cleanup.journal, input.erasureDescriptors.get(firebaseErasureIntentHash(partial.deletion.intent)));
  assert.deepEqual(firestorePhotoSchemas.globalQuota.parse(find(restored, 'photo-global-quota').value),
    { activeBytes: 0, activeCount: 0, cleanupBytes: PNG.length, cleanupCount: 1 });
  assert.deepEqual(firestorePhotoSchemas.childQuota.parse(find(restored, 'photo-child-quota').value), { bytes: 0, count: 0 });
  const barrier = firestoreOnlineErasureBarrierSchema.parse(find(restored, 'online-receipt', JSON.stringify([OWNER, submission.operation.opId])).value);
  assert.equal(barrier.assetId, photo.id); assert.equal(confirmed(restored, photo.submission.operation.opId).result, null);
  assertNoMutation(f, source, input, original);
});

test('restore requires current Auth, copied ready descriptors and settled uploads from production writers', async () => {
  const f = fixture(), binding = await f.initialize(), photo = await f.ready(binding.scope.childId);
  await f.switchControl(false); const snapshot = f.documents(), restoreId = randomUUID();
  const input = f.input(snapshot, restoreId, f.descriptors(restoreId, [photo.row]));
  const original = structuredClone(input), source = structuredClone([...f.fake.records]);
  assert.throws(() => prepareFirebaseRestore(f.options, { ...input, authUsers: [] }), rejected('restore_auth_missing'));
  assert.throws(() => prepareFirebaseRestore(f.options, { ...input, photoDescriptors: new Map() }), rejected('restore_photo_descriptor_missing'));
  const output = prepareFirebaseRestore(f.options, input), restored = f.decoded(output.records);
  const ready = firestorePhotoSchemas.photo.parse(find(restored, 'photo', photo.id).value);
  assert.equal(ready.state, 'ready'); assert.equal(ready.upload?.generation, output.generation);
  assert.equal(ready.scope.storageEpoch, output.newEpochByWorkspace.get(binding.scope.workspaceId));
  const originalReceipt = confirmed(f.decoded(snapshot), photo.submission.operation.opId), restoredReceipt = confirmed(restored, photo.submission.operation.opId);
  assert.equal(restoredReceipt.fingerprint, originalReceipt.fingerprint); assert.deepEqual(restoredReceipt.result, originalReceipt.result);
  assert.deepEqual(restoredReceipt.operation, originalReceipt.operation); assertNoMutation(f, source, input, original);
  await f.switchControl(true); const pending = await f.reserve(binding.scope.childId); f.loseObject();
  await assert.rejects(f.photos.upload(OWNER, binding.scope.childId, pending.id, PNG.toString('base64')), rejected('photo_object_unavailable'));
  const pendingRow = firestorePhotoSchemas.photo.parse(f.row('photo', pending.id).value);
  assert.equal(pendingRow.state, 'reserved'); assert.ok(pendingRow.upload); assert.equal(pendingRow.descriptor, null);
  await f.switchControl(false); const pendingSnapshot = f.documents();
  const pendingInput = f.input(pendingSnapshot, restoreId, f.descriptors(restoreId, [photo.row]));
  const pendingOriginal = structuredClone(pendingInput), pendingSource = structuredClone([...f.fake.records]);
  assert.throws(() => prepareFirebaseRestore(f.options, pendingInput), rejected('restore_unsettled_upload'));
  assertNoMutation(f, pendingSource, pendingInput, pendingOriginal);
});

test('restore retains cleanup for a post-backup child after journal success without restoring its authority or photos', async () => {
  const f = fixture(), originalChild = await f.initialize();
  await f.switchControl(false); const snapshot = f.documents();
  const oldRecords = f.decoded(snapshot);
  assert.equal(oldRecords.some(row => row.context.kind === 'photo'), false);
  assert.equal(oldRecords.some(row => row.context.kind === 'photo-global-quota'), false);
  await f.switchControl(true);
  const laterChild = await f.authority.createChild({ userId: OWNER, operationId: randomUUID(), displayName: '快照後部分刪除孩子' });
  const photo = await f.ready(laterChild.scope.childId);
  const submission = await f.command('/api/children/' + laterChild.scope.childId + '/photos/' + photo.id + '/delete',
    { expectedVersion: photo.row.version, confirmDelete: true });
  f.pauseAfterJournal();
  await assert.rejects(f.online.submit(OWNER, submission), rejected('service_disabled'));
  const partial = firestorePhotoSchemas.photo.parse(f.row('photo', photo.id).value);
  assert.equal(partial.state, 'deleting'); assert.ok(partial.deletion); assert.equal(partial.deletion.journal, null);
  assert.equal(f.documents().some(row => row.path === f.data.ref('photo_cleanup', 'photo-cleanup', photo.id).path), false);
  const input = f.input(snapshot, randomUUID(), new Map()), original = structuredClone(input), source = structuredClone([...f.fake.records]);
  const output = prepareFirebaseRestore(f.options, input), restored = f.decoded(output.records);
  const children = restored.filter(row => row.context.kind === 'child');
  assert.deepEqual(children.map(row => firestoreAuthoritySchemas.child.parse(row.value).id), [originalChild.scope.childId]);
  assert.equal(restored.some(row => row.context.kind === 'authority-child-detail' && row.context.id === laterChild.scope.childId), false);
  assert.equal(restored.some(row => row.context.kind === 'child-projection' && row.context.id === laterChild.scope.childId), false);
  assert.equal(restored.some(row => row.context.kind === 'photo'), false);
  assert.equal(restored.some(row => row.context.kind === 'photo-child-quota'), false);
  const cleanup = firestorePhotoSchemas.cleanup.parse(find(restored, 'photo-cleanup', photo.id).value);
  assert.equal(cleanup.state, 'known'); assert.deepEqual(cleanup.scope, laterChild.scope);
  assert.deepEqual(cleanup.descriptor, photo.row.descriptor); assert.deepEqual(cleanup.upload, photo.row.upload);
  assert.deepEqual(cleanup.journal, input.erasureDescriptors.get(firebaseErasureIntentHash(partial.deletion.intent)));
  assert.deepEqual(firestorePhotoSchemas.globalQuota.parse(find(restored, 'photo-global-quota').value),
    { activeBytes: 0, activeCount: 0, cleanupBytes: PNG.length, cleanupCount: 1 });
  const barrier = firestoreOnlineErasureBarrierSchema.parse(find(restored, 'online-receipt', JSON.stringify([OWNER, submission.operation.opId])).value);
  assert.equal(barrier.childId, laterChild.scope.childId); assert.equal(barrier.assetId, photo.id);
  assert.equal(restored.filter(row => row.context.kind === 'account').length, 1);
  assert.equal(restored.filter(row => row.context.kind === 'workspace').length, 1);
  assertNoMutation(f, source, input, original);
});
