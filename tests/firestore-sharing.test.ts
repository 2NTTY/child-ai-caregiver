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
