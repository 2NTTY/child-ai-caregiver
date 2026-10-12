import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirestoreOnlineReceipts, firestoreOnlineConfirmedSchema, firestoreOnlinePendingSchema, firestoreOnlineErasureBarrierSchema } from '../server/firestore-online-receipts.ts';
import { FirestoreDomainData, FirestoreDomainError, firestoreDomainHash } from '../server/firestore-domain-data.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { workRecoveryAad, workRecoveryDocumentId, workRecoverySchemas, type WorkRecoveryScope } from '../server/firestore-work-continuation-recovery.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import type { OnlineSubmission } from '../src/shared/online.ts';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';

const NIL = '00000000-0000-0000-0000-000000000000';
const rejected = (code: string) => (error: unknown) => error instanceof FirestoreDomainError && error.status === 409 && error.code === code;
async function fixture() {
  const fake = firestoreDomainFixture(), options = { database: fake.database, cipher: createStorageCipher(Buffer.alloc(32, 62)),
    projectId: 'synthetic-receipts-project', namespace: 'synthetic_receipts' }, userId = 'synthetic-owner';
  const authority = createFirestoreAuthority(options), receipts = createFirestoreOnlineReceipts(options), online = createFirestoreOnlineStore(options), data = new FirestoreDomainData(options);
  await authority.initializeControl({ enabled: true, generation: randomUUID() });
  async function admit(user = userId, email = 'owner@example.test') {
    await authority.issueInvitation({ email, expiresAt: new Date(Date.now() + 60_000).toISOString(), operationId: randomUUID() });
    await authority.admitIdentity({ userId: user, email, emailVerified: true });
    await authority.acknowledge({ userId: user, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  }
  await admit();
  const original = await authority.runTransaction(userId, null, async binding => {
    const submission: OnlineSubmission = { path: '/api/children', payload: { displayName: 'Original synthetic child' },
      operation: { workspaceId: binding.scope.workspaceId, storageEpoch: binding.scope.storageEpoch, opId: randomUUID(), deviceId: randomUUID() } };
    const confirmed = receipts.prepareConfirmed(binding, submission, { childId: null, changeSeq: binding.changeSeq, statusCode: 201, result: { original: 'Private original receipt' } });
    const pendingSubmission = { ...submission, operation: { ...submission.operation, opId: randomUUID() } };
    const pending = receipts.preparePending(binding, pendingSubmission, NIL);
    confirmed.commit(); pending.commit();
    return { submission, confirmed, pendingSubmission, pending, scope: binding.scope };
  });
  const idFor = (opId: string) => JSON.stringify([userId, opId]);
  async function restore() {
    const currentScope: WorkRecoveryScope = { ...original.scope, storageEpoch: randomUUID() };
    const workspaceRef = options.database.collection(options.namespace).doc(workRecoveryDocumentId('workspace', currentScope.workspaceId));
    const workspaceAad = workRecoveryAad(options.projectId, options.namespace, 'workspace', currentScope.workspaceId, currentScope);
    await options.database.runTransaction(async tx => {
      const snapshot = await tx.get(workspaceRef), raw = snapshot.data()!;
      const workspace = workRecoverySchemas.workspace.parse(JSON.parse(options.cipher.decrypt(raw.ciphertext, workspaceAad)));
      const confirmed = firestoreOnlineConfirmedSchema.parse({ ...original.confirmed.record, restoredFromEpoch: original.scope.storageEpoch });
      const pending = firestoreOnlinePendingSchema.parse({ ...original.pending.record, restoredFromEpoch: original.scope.storageEpoch });
      tx.set(workspaceRef, { ...raw, ciphertext: options.cipher.encrypt(JSON.stringify({ ...workspace, storageEpoch: currentScope.storageEpoch }), workspaceAad) });
      tx.set(data.ref('online_operations', 'online-receipt', idFor(confirmed.operation.opId)), { ...data.tags(currentScope), ...data.seal('online-receipt', idFor(confirmed.operation.opId), currentScope, firestoreOnlineConfirmedSchema, confirmed) });
      tx.set(data.ref('online_operations', 'online-receipt', idFor(pending.operation.opId)), { ...data.tags(currentScope), ...data.seal('online-receipt', idFor(pending.operation.opId), currentScope, firestoreOnlinePendingSchema, pending) });
    });
    return currentScope;
  }
  return { fake, options, userId, authority, receipts, online, data, original, idFor, restore, admit };
}

test('restored original receipts replay only their exact old submission and preserve privacy redaction and pending fences', async () => {
  const f = await fixture(), currentScope = await f.restore(), committed = [...f.fake.records];
  assert.deepEqual(await f.online.lookup(f.userId, f.original.submission.operation.opId), f.original.confirmed.receipt);
  assert.deepEqual(await f.online.submit(f.userId, f.original.submission), f.original.confirmed.receipt);
  await assert.rejects(f.online.submit(f.userId, { ...f.original.submission, operation: { ...f.original.submission.operation, storageEpoch: currentScope.storageEpoch } }), rejected('operation_conflict'));
  assert.deepEqual(await f.online.lookup(f.userId, f.original.pendingSubmission.operation.opId), { state: 'unconfirmed' });
  await assert.rejects(f.online.submit(f.userId, f.original.pendingSubmission), rejected('operation_conflict'));
  assert.deepEqual([...f.fake.records], committed);
  await f.admit('other-owner', 'other@example.test');
  assert.deepEqual(await f.online.lookup('other-owner', f.original.submission.operation.opId), { state: 'unconfirmed' });
  await assert.rejects(f.online.submit('other-owner', f.original.submission), rejected('storage_epoch_changed'));
  await f.authority.runTransaction(f.userId, null, async binding => {
    const record = await f.receipts.read(binding, f.original.submission.operation.opId); assert.ok(record);
    assert.equal(record.restoredFromEpoch, f.original.scope.storageEpoch);
    assert.equal('state' in record, false); if ('state' in record) throw new Error('Expected confirmed receipt');
    const normal = { ...f.original.submission, restoredFromEpoch: f.original.scope.storageEpoch,
      operation: { ...f.original.submission.operation, storageEpoch: currentScope.storageEpoch, opId: randomUUID() } };
    const prepared = f.receipts.prepareConfirmed(binding, normal, { childId: null, changeSeq: binding.changeSeq, statusCode: 201, result: null });
    assert.equal('restoredFromEpoch' in prepared.record, false);
    f.receipts.prepareRedaction(binding, record)();
  });
  const redacted = await f.online.lookup(f.userId, f.original.submission.operation.opId);
  assert.deepEqual(redacted, { ...f.original.confirmed.receipt, result: null }); assert.equal('restoredFromEpoch' in redacted, false);
  assert.deepEqual(await f.online.submit(f.userId, f.original.submission), redacted);
  await f.authority.runTransaction(f.userId, null, async binding => {
    const record = await f.receipts.read(binding, f.original.submission.operation.opId); assert.equal(record?.restoredFromEpoch, f.original.scope.storageEpoch);
  });
});

test('an erasure operation without a backed-up receipt cannot be disclosed as success or reused by a new command', async () => {
  const f = await fixture(), opId = randomUUID();
  const barrierSchema = firestoreOnlineErasureBarrierSchema;
  const submission = await f.authority.runTransaction(f.userId, null, async binding => {
    const id = f.idFor(opId), barrier = barrierSchema.parse({ state: 'erasure_barrier', ownerUserId: f.userId, operationId: opId,
      childId: randomUUID(), assetId: randomUUID(), intentSha256: firestoreDomainHash(['synthetic-erasure', opId]) });
    const command: OnlineSubmission = { path: '/api/children', payload: { displayName: 'Cannot reuse erasure operation' },
      operation: { workspaceId: binding.scope.workspaceId, storageEpoch: binding.scope.storageEpoch, opId, deviceId: randomUUID() } };
    assert.equal(await f.receipts.read(binding, opId), null);
    binding.transaction.create(f.data.ref('online_operations', 'online-receipt', id), { ...f.data.tags(binding.scope), ...f.data.seal('online-receipt', id, binding.scope, barrierSchema, barrier) });
    return command;
  });
  const before = [...f.fake.records];
  await assert.rejects(f.online.lookup(f.userId, opId), rejected('operation_erased'));
  await assert.rejects(f.online.submit(f.userId, submission), rejected('operation_erased')); assert.deepEqual([...f.fake.records], before);
});
