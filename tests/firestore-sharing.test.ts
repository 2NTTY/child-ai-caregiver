import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Timestamp } from '@google-cloud/firestore';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreSharingStore } from '../server/firestore-sharing.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';
import { setFirebaseBackupControl } from '../server/firestore-backup.ts';
import { prepareFirebaseRestore } from '../server/firestore-restore.ts';
import { createFirestoreRestoreCodec } from '../server/firestore-restore-codec.ts';
import { sharedSpaceSchema, resourceShareSchema, sharedMembershipSchema, sharingErasedBy } from '../server/firestore-sharing-records.ts';
import { createFirestoreCareStore, firestoreCareStorageSchema } from '../server/firestore-care.ts';
import { FirestoreDomainData, firestoreTaskStorageSchema } from '../server/firestore-domain-data.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirebaseRequestHandler } from '../server/firebase-app.ts';
import { createOnlineTransport } from '../src/client/online-transport.ts';
import type { FirebaseAuthPort } from '../server/firebase-auth.ts';
import { createCareApi } from '../src/client/care-api.ts';
import { createTaskApi } from '../src/client/task-api.ts';
import { createMemoryApi } from '../src/client/memory-api.ts';
import { createFirestoreMemoryStore, firestoreFactStorageSchema } from '../server/firestore-memory.ts';
import { createFirestoreChatStore } from '../server/firestore-chat.ts';
import { createFirestoreTaskWorker } from '../server/firestore-task-worker.ts';
import { replayContentErasures } from '../server/firestore-restore-content-erasure.ts';
import type { FirebaseErasureIntent } from '../server/firebase-erasure-journal.ts';

async function fixture() {
  const fake = serialFirestoreFixture(), now = Date.parse('2026-10-27T04:00:00Z');
  const database = { ...fake.database, databaseId: 'synthetic-source', collection(path: string) {
    const collection = fake.database.collection(path);
    return { ...collection, doc(id: string) {
      const ref = collection.doc(id);
      return { ...ref, async get() {
        const snapshot = await fake.database.runTransaction(tx => tx.get(ref), { readOnly: true });
        return { ...snapshot, updateTime: Timestamp.fromMillis(now) };
      } };
    } };
  } } as typeof fake.database;
  const options = { database, cipher: createStorageCipher(Buffer.alloc(32, 71)),
    projectId: 'demo-sharing-test', namespace: 'sharing_test', serverClock: () => now };
  const authority = createFirestoreAuthority(options), sharing = createFirestoreSharingStore(options);
  let generation = randomUUID();
  await authority.initializeControl({ generation, enabled: true });
  for (const userId of ['parent', 'carer', 'viewer']) {
    const email = userId + '@example.test';
    await authority.issueInvitation({ email, expiresAt: new Date(now + 86_400_000).toISOString(), operationId: randomUUID() });
    await authority.admitIdentity({ userId, email, emailVerified: true });
    await authority.acknowledge({ userId, policyVersion: SERVICE_POLICY_VERSION, operationId: randomUUID() });
  }
  const child = await authority.createChild({ userId: 'parent', operationId: randomUUID(), displayName: 'Test child' });
  const create = { operationId: randomUUID(), name: 'Test family', kind: 'family' as const };
  let space = await sharing.create('parent', create);
  assert.deepEqual(await sharing.create('parent', create), space, 'original create returns its receipt');
  async function join(userId: string, role: 'caregiver' | 'viewer') {
    const invitation = await sharing.invite('parent', { spaceId: space.id, expectedVersion: space.version,
      operationId: randomUUID(), email: userId + '@example.test', role, expiresAt: new Date(now + 86_400_000).toISOString() });
    space = await sharing.acceptInvitation(userId, { token: invitation.token, operationId: randomUUID() });
  }
  await join('carer', 'caregiver'); await join('viewer', 'viewer');
  async function control(enabled: boolean) {
    const next = randomUUID();
    await setFirebaseBackupControl(options, { expectedGeneration: generation, generation: next, enabled });
    generation = next; return next;
  }
  const documents = () => [...fake.records].map(([path, data]) => ({ path, data: structuredClone(data) }));
  return { fake, options, authority, sharing, child, space, control, documents };
}
const code = (expected: string) => (error: unknown) => (error as { code?: string }).code === expected;

test('shared memory keeps private candidates and source messages private across reads, writes, receipts and history', async () => {
  const f = await fixture(), childId = f.child.child.id;
  const care = createFirestoreCareStore(f.options), chat = createFirestoreChatStore(f.options);
  const memory = createFirestoreMemoryStore({ ...f.options, care, chat });
  const online = createFirestoreOnlineStore({ ...f.options, mutations: [chat.mutation, care.mutation, memory.mutation] });
  async function own(path: string, payload: Record<string, unknown>) {
    const context = await online.context('parent', { path, payload });
    return online.submit('parent', { path, payload, operation: { ...context, opId: randomUUID(), deviceId: randomUUID() } });
  }
  const message = (await own(`/api/children/${childId}/messages`, { text: 'Private original text' })).result as any;
  const input = { intendedVisibility: 'family' as const, values: { key: 'Food preference', content: 'Original shared fact', validUntil: null,
    source: { kind: 'private_chat' as const, description: 'Confirmed statement', messageId: message.message.id } } };
  const candidate = await memory.createFact('parent', childId, input); assert.ok(candidate);
  await memory.confirmFact('parent', childId, candidate.id, { expectedVersion: 1, confirm: true, confirmShared: true });
  const hidden = await memory.createFact('parent', childId, { ...input, values: { ...input.values, key: 'Private candidate' } }); assert.ok(hidden);
  await f.sharing.share('parent', { spaceId: f.space.id, childId, modules: ['memory'], expectedVersion: f.space.version, operationId: randomUUID() });
  const selected = memory.forSharedSpace(f.space.id);
  const facts = await selected.facts('carer', childId); assert.ok(facts);
  assert.equal(facts.items.length, 1); assert.equal('messageId' in facts.items[0].source, false);
  assert.equal((await selected.history('carer', childId, 'facts', candidate.id))?.revisions.length, 1);
  await assert.rejects(selected.reviseFact('carer', childId, candidate.id, { ...input, values: input.values, expectedVersion: 2, confirm: true, confirmShared: true, reason: 'Direct route' }), code('sharing_receipt_required'));
  const session = { user: { id: 'carer' } };
  const auth = { async handler() { return new Response(null, { status: 404 }); },
    async getSession(options: { returnHeaders?: boolean }) { return options.returnHeaders ? { response: session, headers: new Headers() } : session; },
    async assertRecentReauthentication() { return session; }, fromNodeHeaders() { return new Headers(); } } as FirebaseAuthPort;
  const handler = createFirebaseRequestHandler({ authority: f.authority, auth, publicOrigin: 'https://app.example.test', mailConfigured: false, online, memory });
  const submissions: any[] = [];
  const fetcher: typeof fetch = async (input, init) => { const headers = new Headers(init?.headers); headers.set('Origin', 'https://app.example.test');
    if (String(input).endsWith('/online/submit')) submissions.push(JSON.parse(String(init?.body)));
    return handler(new Request(input, { ...init, headers })); };
  const client = createMemoryApi('https://app.example.test', fetcher, { spaceId: f.space.id }), signal = new AbortController().signal;
  const revised = await client.reviseFact(childId, candidate.id, { expectedVersion: 2, confirm: true, confirmShared: true, reason: 'Shared correction',
    values: { ...input.values, content: 'Corrected shared fact', source: facts.items[0].source } }, signal, 'carer');
  assert.equal(revised.confirmedBy, 'carer'); assert.equal('messageId' in revised.source, false);
  assert.equal('confirmedViaShare' in revised, false);
  assert.equal((await memory.getFact('parent', childId, candidate.id))?.source.kind, 'private_chat');
  assert.equal((await client.factHistory(childId, candidate.id, null, signal)).revisions.length, 2);
  const manual = await client.createConfirmedFact!(childId, { intendedVisibility: 'family', confirm: true, confirmShared: true,
    values: { key: 'Shared manual', content: 'Explicit shared statement', validUntil: null, source: { kind: 'manual', description: 'Carer statement' } } }, signal, 'carer');
  assert.equal(manual.createdBy, 'carer');
  const originalSubmission = submissions.at(-1);
  assert.deepEqual((await online.lookup('carer', originalSubmission.operation.opId) as any).result, { fact: manual });
  assert.deepEqual((await online.submit('carer', originalSubmission)).result, { fact: manual });
  // A later owner correction may introduce a private source, even when a caregiver created the fact.
  await memory.reviseFact('parent', childId, manual.id, { expectedVersion: 1, confirm: true, confirmShared: true, reason: 'Owner source correction',
    values: { ...input.values, key: manual.key, content: manual.content } });
  assert.equal('messageId' in (await selected.getFact('carer', childId, manual.id))!.source, false);
  const topic = await client.createTopic(childId, { title: 'Shared follow-up', note: '', visibility: 'family', confirmShared: true }, signal, 'carer');
  const done = await client.changeTopic(childId, topic.id, { expectedVersion: 1, status: 'resolved', note: '', resumeAfter: null }, signal, 'carer');
  const doneSubmission = submissions.at(-1);
  assert.equal(done.mayAsk, false); assert.equal(done.updatedBy, 'carer');
  assert.deepEqual((await online.lookup('carer', doneSubmission.operation.opId) as any).result, { topic: done });
  assert.equal((await client.summary(childId, signal)), null);
  assert.equal((await client.facts(childId, null, signal)).items.some(fact => fact.id === hidden.id), false);
  const codec = createFirestoreRestoreCodec(f.options);
  for (const row of f.documents().filter(row => /_memory_(facts|fact_revisions|topics|topic_revisions)\//u.test(row.path))) codec.decode(row);
  const data = new FirestoreDomainData(f.options);
  const original = f.documents().find(row => row.path === data.ref('memory_facts', 'memory-fact', manual.id).path)!;
  const decoded = codec.decode(original), unsafe = { ...decoded.value as any }; delete unsafe.createdViaShare;
  assert.throws(() => codec.decode({ ...original, data: { ...original.data,
    ...data.seal('memory-fact', manual.id, f.child.scope, firestoreFactStorageSchema, unsafe, unsafe.version) } }), code('restore_binding'));
  await client.deleteFact(childId, manual.id, { expectedVersion: 2, confirmDelete: true }, signal, 'carer');
  assert.equal((await online.lookup('carer', originalSubmission.operation.opId) as any).result, null);
  assert.equal(await selected.history('carer', childId, 'facts', manual.id), null);
  const current = await f.sharing.get('parent', f.space.id);
  await f.sharing.unshare('parent', { spaceId: f.space.id, childId, expectedVersion: current.version, operationId: randomUUID() });
  assert.equal((await online.lookup('carer', doneSubmission.operation.opId) as any).result, null);
  assert.equal((await online.submit('carer', doneSubmission)).result, null);
  await assert.rejects(client.facts(childId, null, signal), { status: 403 });
  assert.equal((await memory.getFact('parent', childId, candidate.id))?.version, 3);
});

test('shared tasks keep one original, attributed revisions, owner reminder authority and revocable receipts', async () => {
  const f = await fixture(), childId = f.child.child.id, shared = { spaceId: f.space.id };
  await f.sharing.share('parent', { ...shared, childId, modules: ['tasks'], expectedVersion: f.space.version, operationId: randomUUID() });
  const worker = createFirestoreTaskWorker({ ...f.options, enabled: true,
    async currentAuth(userId) { return { userId, email: userId + '@example.test', disabled: false, emailVerified: true }; } });
  const online = createFirestoreOnlineStore({ ...f.options, reminders: worker });
  const command = { path: `/api/children/${childId}/tasks`, sharing: shared, payload: { confirm: true, values: {
    title: 'Shared appointment', details: '', kind: 'appointment', assigneeUserId: 'parent',
    dueAt: '2026-10-27T03:00:00Z', timeZone: 'Asia/Hong_Kong' } } };
  const context = await online.context('carer', command);
  const submitted = { ...command, sharing: { ...shared, expectedBasis: context.sharingBasis },
    operation: { workspaceId: context.workspaceId, storageEpoch: context.storageEpoch, opId: randomUUID(), deviceId: randomUUID() } };
  const receipt = await online.submit('carer', submitted), task = (receipt.result as any).task;
  assert.equal(task.createdBy, 'carer'); assert.equal(task.assigneeUserId, 'parent');
  assert.equal('createdViaShare' in task, false);
  assert.deepEqual(await online.lookup('carer', submitted.operation.opId), receipt);
  assert.deepEqual(await online.submit('carer', submitted), receipt);
  assert.equal((await online.tasks.get('parent', childId, task.id))?.id, task.id);
  await assert.rejects(online.tasks.get('carer', childId, task.id), code('binding'));
  await assert.rejects(online.context('viewer', command), code('read_only'));
  const selected = online.tasks.forSharedSpace!(f.space.id);
  assert.equal((await selected.list('viewer', childId)).items[0].id, task.id);
  assert.deepEqual((await selected.list('carer', childId)).eligibleAssignees.map(value => value.userId), ['parent']);
  const [job] = await worker.due('parent', childId);
  const claim = await worker.claim(job); assert.equal(claim.state, 'claimed');

  const session = { user: { id: 'carer' } };
  const auth = { async handler() { return new Response(null, { status: 404 }); },
    async getSession(options: { returnHeaders?: boolean }) { return options.returnHeaders ? { response: session, headers: new Headers() } : session; },
    async assertRecentReauthentication() { return session; }, fromNodeHeaders() { return new Headers(); } } as FirebaseAuthPort;
  const handler = createFirebaseRequestHandler({ authority: f.authority, auth, publicOrigin: 'https://app.example.test', mailConfigured: false, online });
  const fetcher: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers); headers.set('Origin', 'https://app.example.test');
    return handler(new Request(input, { ...init, headers }));
  };
  const client = createTaskApi('https://app.example.test', fetcher, shared), signal = new AbortController().signal;
  assert.equal((await client.tasks(childId, null, signal)).items[0].id, task.id);
  assert.equal((await client.task(childId, task.id, signal)).version, 1);
  const done = await client.changeTask(childId, task.id, { action: 'complete', expectedVersion: 1, confirm: true, note: '' }, signal, 'carer');
  assert.equal(done.occurrence.state, 'completed');
  assert.equal((await client.history(childId, task.id, null, signal)).revisions[0].actorUserId, 'carer');
  if (claim.state !== 'claimed') throw new Error('Expected an original reminder lease');
  assert.equal((await worker.complete(job, claim.lease)).state, 'stopped');
  assert.equal(f.documents().some(row => row.path.includes('_notification_outbox/')), false);
  assert.equal((await online.lookup('carer', submitted.operation.opId) as any).result.task.version, 1, 'original receipt does not claim the newer outcome');
  const codec = createFirestoreRestoreCodec(f.options);
  for (const row of f.documents().filter(value => /_(tasks|task_revisions)\//u.test(value.path))) {
    const decoded = codec.decode(row);
    assert.equal((decoded.value as any).task?.createdBy ?? (decoded.value as any).createdBy, 'carer');
  }
  const taskRow = f.documents().find(row => row.path.includes('_tasks/'))!, savedTask = codec.decode(taskRow).value as any;
  const withoutProof = { ...savedTask }; delete withoutProof.createdViaShare;
  const data = new FirestoreDomainData(f.options);
  assert.throws(() => codec.decode({ path: taskRow.path, data: { ...taskRow.data,
    ...data.seal('task', task.id, f.child.scope, firestoreTaskStorageSchema, withoutProof, savedTask.version) } }), code('restore_binding'));
  const current = await f.sharing.get('parent', f.space.id);
  await f.sharing.unshare('parent', { ...shared, childId, expectedVersion: current.version, operationId: randomUUID() });
  assert.equal((await online.lookup('carer', submitted.operation.opId) as any).result, null);
  assert.equal((await online.submit('carer', submitted)).result, null);
  await assert.rejects(selected.get('carer', childId, task.id), code('module_not_shared'));
  assert.equal((await online.tasks.get('parent', childId, task.id))?.occurrence.state, 'completed');
});

test('shared care uses the original domain, actor receipts, current grants and deletion barriers', async () => {
  const f = await fixture(), childId = f.child.child.id;
  await f.sharing.share('parent', { spaceId: f.space.id, childId, modules: ['care'],
    expectedVersion: f.space.version, operationId: randomUUID() });
  const care = createFirestoreCareStore(f.options), online = createFirestoreOnlineStore({ ...f.options, mutations: [care.mutation] });
  const command = { path: `/api/children/${childId}/records`, payload: { text: 'Shared original record' }, sharing: { spaceId: f.space.id } };
  const context = await online.context('carer', command);
  assert.ok(context.sharingBasis);
  const submission = { ...command, sharing: { ...command.sharing, expectedBasis: context.sharingBasis }, operation: {
    workspaceId: context.workspaceId, storageEpoch: context.storageEpoch, opId: randomUUID(), deviceId: randomUUID() } };
  const receipt = await online.submit('carer', submission), value = (receipt.result as any).record;
  assert.equal(value.authorUserId, 'carer'); assert.equal(value.confirmedBy, 'carer');
  assert.equal((await care.get('parent', childId, value.id))?.id, value.id);
  assert.deepEqual(await online.submit('carer', submission), receipt);
  assert.deepEqual(await online.lookup('carer', submission.operation.opId), receipt);
  const codec = createFirestoreRestoreCodec(f.options);
  const backupRows = f.documents().filter(row => /_(care_records|care_revisions)\//u.test(row.path));
  assert.equal(backupRows.length, 2);
  for (const row of backupRows) assert.equal((codec.decode(row).value as any).authorUserId, 'carer');
  const original = backupRows.find(row => row.path.includes('_care_records/'))!, decoded = codec.decode(original);
  const unsafe = { ...decoded.value as any }; delete unsafe.confirmedViaShare;
  const data = new FirestoreDomainData(f.options);
  assert.throws(() => codec.decode({ path: original.path, data: { ...original.data,
    ...data.seal('care-record', value.id, f.child.scope, firestoreCareStorageSchema, unsafe, 1) } }), code('restore_binding'),
    'non-owner attribution without a bound sharing proof still fails restore');
  assert.equal('createdViaShare' in value, false, 'internal attribution is not sent to clients');
  assert.equal((await care.forSharedSpace(f.space.id).listRecords('viewer', childId)).records[0].id, value.id);
  await assert.rejects(care.get('carer', childId, value.id), code('binding'));
  await assert.rejects(care.forSharedSpace(f.space.id).profile('carer', childId), code('module_not_shared'));
  await assert.rejects(online.context('viewer', command), code('read_only'));
  await assert.rejects(online.submit('carer', { ...submission, sharing: undefined }), code('operation_conflict'));
  await assert.rejects(online.submit('carer', { ...submission, operation: { ...submission.operation, opId: randomUUID() },
    sharing: { spaceId: f.space.id } }), code('sharing_precondition_required'));
  await assert.rejects(online.submit('carer', { ...submission, operation: { ...submission.operation, opId: randomUUID() },
    sharing: { ...submission.sharing, expectedBasis: { ...context.sharingBasis!, shareVersion: 100 } } }), code('sharing_scope_changed'));
  await f.sharing.withResource('carer', { spaceId: f.space.id, childId, module: 'care', mode: 'read' }, async access => {
    await assert.rejects(access.binding.readWork(randomUUID()), code('shared_private_scope'));
    await assert.rejects(access.binding.prepareChange(randomUUID(), 'care', false), code('read_only'));
  });
  // Shared Web/Android transport goes through production HTTP composition, not a custom test endpoint.
  const session = { user: { id: 'carer' } };
  const auth = { async handler() { return new Response(null, { status: 404 }); },
    async getSession(options: { returnHeaders?: boolean }) { return options.returnHeaders ? { response: session, headers: new Headers() } : session; },
    async assertRecentReauthentication() { return session; },
    fromNodeHeaders() { return new Headers(); } } as FirebaseAuthPort;
  const handler = createFirebaseRequestHandler({ authority: f.authority, auth, publicOrigin: 'https://app.example.test',
    mailConfigured: false, online, care });
  const fetcher: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers); headers.set('Origin', 'https://app.example.test');
    return handler(new Request(input, { ...init, headers }));
  };
  const transport = createOnlineTransport('https://app.example.test/api', fetcher);
  const viaClient = await transport.submit({ ...command, payload: { text: 'Written through the shared client' } }, new AbortController().signal, 'carer') as any;
  const response = await fetcher(`https://app.example.test/api/children/${childId}/records?spaceId=${f.space.id}`);
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control')?.includes('no-store'), true);
  assert.ok((await response.json()).records.some((r: any) => r.id === viaClient.record.id));
  const sharedVersion = await f.sharing.get('parent', f.space.id);
  await f.sharing.share('parent', { spaceId: f.space.id, childId, modules: ['care', 'profile'],
    expectedVersion: sharedVersion.version, operationId: randomUUID() });
  const careClient = createCareApi('https://app.example.test', fetcher, { spaceId: f.space.id });
  const profile = await careClient.saveProfile(childId, { age: { kind: 'unknown' }, dueDate: null, gestationalWeeksRaw: null,
    region: null, language: null, allergies: null, specialNeeds: null, preferences: null, source: 'Shared statement', validUntil: null },
    0, 'Initial shared profile', new AbortController().signal, 'carer');
  assert.equal(profile.confirmedBy, 'carer');
  assert.deepEqual(await careClient.getProfile(childId, new AbortController().signal), profile);
  await careClient.deleteProfile(childId, 1, new AbortController().signal, 'carer');
  await careClient.saveProfile(childId, profile.data!, 2, 'New profile after erasure', new AbortController().signal, 'carer');
  const profileBackup = f.documents().filter(row => /_(child_profiles|profile_revisions|content_erasures)\//u.test(row.path));
  const decodedProfiles = profileBackup.map(row => codec.decode(row));
  const journal = decodedProfiles.filter(row => row.context.kind === 'content-erasure').map(row => (row.value as { intent: FirebaseErasureIntent }).intent);
  const removed = replayContentErasures(data, codec, decodedProfiles, decodedProfiles, journal, new Map(profileBackup.map(row => [row.path, row.data])));
  assert.equal(removed.size, 1);
  const restoredProfile = decodedProfiles.find(row => row.context.kind === 'child-profile')!.value as any;
  assert.equal(restoredProfile.version, 3); assert.equal(restoredProfile.confirmedViaShare.actorUserId, 'carer');
  const parentContext = await online.context('parent', { path: `/api/children/${childId}/care/${value.id}/delete`, payload: {} });
  await online.submit('parent', { path: `/api/children/${childId}/care/${value.id}/delete`, payload: { expectedVersion: 1, confirmDelete: true },
    operation: { ...parentContext, opId: randomUUID(), deviceId: randomUUID() } });
  assert.equal((await online.lookup('carer', submission.operation.opId) as any).result, null);
  const current = await f.sharing.get('parent', f.space.id);
  await f.sharing.unshare('parent', { spaceId: f.space.id, childId, expectedVersion: current.version, operationId: randomUUID() });
  assert.equal((await online.submit('carer', submission)).result, null);
  await assert.rejects(care.forSharedSpace(f.space.id).listRecords('carer', childId), code('module_not_shared'));
  const beforeDissolve = await f.sharing.get('parent', f.space.id);
  await f.sharing.dissolve('parent', { spaceId: f.space.id, expectedVersion: beforeDissolve.version, operationId: randomUUID() });
  assert.equal((await online.lookup('carer', submission.operation.opId) as any).result, null, 'dissolution settles the original receipt without disclosing content');
});

test('sharing preserves original storage, restricts modules/roles, and rechecks revoked access in the same transaction', async () => {
  const f = await fixture();
  const command = { spaceId: f.space.id, childId: f.child.child.id, modules: ['tasks' as const],
    expectedVersion: f.space.version, operationId: randomUUID() };
  const share = await f.sharing.share('parent', command);
  assert.deepEqual(await f.sharing.share('parent', command), share);
  await assert.rejects(f.sharing.share('parent', { ...command, modules: ['memory'] }), code('operation_conflict'));
  const request = { spaceId: f.space.id, childId: f.child.child.id, module: 'tasks' as const, mode: 'write' as const };
  const access = await f.sharing.withResource('carer', request, async access => {
    assert.equal(access.actorUserId, 'carer');
    assert.deepEqual(access.scope, f.child.scope);
    assert.equal(access.role, 'caregiver');
    assert.equal(access.includePrivate, false);
    return access.basis;
  });
  await assert.rejects(f.authority.readScope('carer', f.child.child.id), code('binding'));
  await assert.rejects(f.sharing.withResource('carer', { ...request, module: 'memory' }, async () => assert.fail()), code('module_not_shared'));
  await assert.rejects(f.sharing.withResource('viewer', request, async () => assert.fail()), code('read_only'));
  await f.sharing.withResource('viewer', { ...request, mode: 'read' }, async a => assert.equal(a.role, 'viewer'));
  const current = await f.sharing.get('parent', f.space.id);
  await f.sharing.unshare('parent', { spaceId: f.space.id, childId: f.child.child.id,
    expectedVersion: current.version, operationId: randomUUID() });
  await assert.rejects(f.sharing.withResource('carer', { ...request, expectedBasis: access }, async () => assert.fail()), code('module_not_shared'));
  assert.deepEqual((await f.authority.readScope('parent', f.child.child.id)).scope, f.child.scope, 'unshare does not delete original');
});

test('management transfers only to the accepting member and survives the former manager leaving', async () => {
  const f = await fixture();
  const sharedCommand = { spaceId: f.space.id, childId: f.child.child.id, modules: ['tasks' as const],
    expectedVersion: f.space.version, operationId: randomUUID() };
  const shared = await f.sharing.share('parent', sharedCommand);
  const pending = await f.sharing.proposeTransfer('parent', { spaceId: f.space.id, targetUserId: 'carer',
    expectedVersion: shared.version, operationId: randomUUID() });
  await assert.rejects(f.sharing.acceptTransfer('viewer', { spaceId: f.space.id, expectedVersion: pending.version,
    operationId: randomUUID() }), code('transfer_target'));
  const transferred = await f.sharing.acceptTransfer('carer', { spaceId: f.space.id, expectedVersion: pending.version,
    operationId: randomUUID() });
  assert.equal(transferred.managerUserId, 'carer');
  assert.deepEqual(transferred.storageIdentity, f.space.storageIdentity);
  const leave = { spaceId: f.space.id, expectedVersion: transferred.version, operationId: randomUUID() };
  const left = await f.sharing.leave('parent', leave);
  assert.deepEqual(await f.sharing.leave('parent', leave), left);
  assert.deepEqual(Object.keys(left).sort(), ['spaceId', 'state', 'version']);
  assert.equal((await f.sharing.get('carer', f.space.id)).managerUserId, 'carer');
  await assert.rejects(f.sharing.get('parent', f.space.id), code('space_access_denied'));
  await assert.rejects(f.sharing.share('parent', sharedCommand), code('space_access_denied'));
  const current = await f.sharing.get('carer', f.space.id);
  await assert.rejects(f.sharing.leave('carer', { spaceId: f.space.id, expectedVersion: current.version,
    operationId: randomUUID() }), code('space_transfer_or_dissolve_required'));
  await assert.rejects(f.authority.runTransaction('carer', null, async b => {
    const change = await b.prepareErasure(randomUUID(), 'account'); change.commit();
  }), code('space_transfer_or_dissolve_required'));
  await f.authority.runTransaction('parent', null, async b => {
    const change = await b.prepareErasure(randomUUID(), 'account'); change.commit();
  });
  assert.equal((await f.sharing.get('carer', f.space.id)).id, f.space.id);
});

test('isolated restore keeps current transfer/revocation and rebinds source epochs without restoring private access', async () => {
  const f = await fixture();
  let space = await f.sharing.share('parent', { spaceId: f.space.id, childId: f.child.child.id, modules: ['tasks'],
    expectedVersion: f.space.version, operationId: randomUUID() });
  await f.control(false); const snapshot = f.documents(); await f.control(true);
  const laterCreate = { operationId: randomUUID(), name: 'Post-backup space', kind: 'family' as const };
  const laterSpace = await f.sharing.create('parent', laterCreate);
  await f.authority.issueInvitation({ email: 'later@example.test', expiresAt: '2026-10-28T04:00:00Z', operationId: randomUUID() });
  await f.authority.admitIdentity({ userId: 'later', email: 'later@example.test', emailVerified: true });
  await f.authority.acknowledge({ userId: 'later', operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  const invitation = await f.sharing.invite('parent', { spaceId: space.id, expectedVersion: space.version, operationId: randomUUID(),
    email: 'later@example.test', role: 'caregiver', expiresAt: '2026-10-28T04:00:00Z' });
  space = await f.sharing.acceptInvitation('later', { token: invitation.token, operationId: randomUUID() });
  space = await f.sharing.unshare('parent', { spaceId: space.id, childId: f.child.child.id, expectedVersion: space.version, operationId: randomUUID() });
  space = await f.sharing.proposeTransfer('parent', { spaceId: space.id, targetUserId: 'later', expectedVersion: space.version, operationId: randomUUID() });
  space = await f.sharing.acceptTransfer('later', { spaceId: space.id, expectedVersion: space.version, operationId: randomUUID() });
  await f.sharing.leave('parent', { spaceId: space.id, expectedVersion: space.version, operationId: randomUUID() });
  const generation = await f.control(false);
  const restored = prepareFirebaseRestore(f.options, { restoreId: randomUUID(), targetDatabaseId: 'synthetic-target', sourceGeneration: generation,
    documents: snapshot, liveDocuments: f.documents(), erasures: [], erasureDescriptors: new Map(), photoDescriptors: new Map(),
    authUsers: ['parent', 'carer', 'viewer', 'later'].map(userId => ({ userId, email: userId + '@example.test', disabled: false, emailVerified: true })) });
  const codec = createFirestoreRestoreCodec(f.options), decoded = restored.records.map(row => codec.decode(row));
  assert.equal(sharedSpaceSchema.parse(decoded.find(row => row.context.kind === 'shared-space' && row.context.id === space.id)!.value).managerUserId, 'later');
  assert.ok(decoded.some(row => row.context.kind === 'account' && row.context.id === 'later'));
  const grant = resourceShareSchema.parse(decoded.find(row => row.context.kind === 'resource-share')!.value);
  assert.equal(grant.state, 'revoked');
  assert.equal(grant.source.storageEpoch, restored.newEpochByWorkspace.get(f.child.scope.workspaceId));
  assert.equal(sharedMembershipSchema.parse(decoded.find(row => row.context.kind === 'shared-membership'
    && sharedMembershipSchema.parse(row.value).userId === 'parent' && sharedMembershipSchema.parse(row.value).spaceId === space.id)!.value).state, 'revoked');
  assert.equal(sharingErasedBy('resource-share', grant, f.child.scope, true), true);
  assert.equal(sharingErasedBy('shared-space', space, f.child.scope, true), false);
  f.fake.records.clear(); for (const row of restored.records) f.fake.records.set(row.path, row.data);
  await setFirebaseBackupControl(f.options, { expectedGeneration: restored.generation, generation: randomUUID(), enabled: true });
  const count = f.fake.records.size;
  assert.equal((await f.sharing.create('parent', laterCreate)).id, laterSpace.id, 'post-backup receipt prevents duplicate creation');
  assert.equal(f.fake.records.size, count);
});

test('an unused invitation cannot revive when management returns to the original manager', async () => {
  const f = await fixture();
  const left = await f.sharing.leave('viewer', { spaceId: f.space.id, expectedVersion: f.space.version, operationId: randomUUID() });
  const invitation = await f.sharing.invite('parent', { spaceId: f.space.id, expectedVersion: left.version,
    operationId: randomUUID(), email: 'viewer@example.test', role: 'viewer', expiresAt: '2026-10-28T04:00:00Z' });
  let space = invitation.space;
  for (const [from, to] of [['parent', 'carer'], ['carer', 'parent']]) {
    space = await f.sharing.proposeTransfer(from!, { spaceId: space.id, expectedVersion: space.version, targetUserId: to!, operationId: randomUUID() });
    space = await f.sharing.acceptTransfer(to!, { spaceId: space.id, expectedVersion: space.version, operationId: randomUUID() });
  }
  await assert.rejects(f.sharing.acceptInvitation('viewer', { token: invitation.token, operationId: randomUUID() }), code('invitation_revoked'));
});
