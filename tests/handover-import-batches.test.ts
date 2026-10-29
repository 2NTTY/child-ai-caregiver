import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreCareStore } from '../server/firestore-care.ts';
import { createFirestoreHandoverImportBatches } from '../server/firestore-handover-import-batches.ts';
import { createFirestoreBackgroundQueue, type FirestoreBackgroundWork } from '../server/firestore-background-work.ts';
import { createFirestoreRestoreCodec } from '../server/firestore-restore-codec.ts';
import { createFirestoreSharingStore } from '../server/firestore-sharing.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { emptyCareDetails } from '../src/shared/care.ts';
import type { HandoverImportRow } from '../server/handover-import.ts';

test('durable import batches fence each domain commit, preserve partial results and resume only remaining rows', async () => {
  const fixture = serialFirestoreFixture(), options = { database: fixture.database, cipher: createStorageCipher(Buffer.alloc(32, 83)),
    projectId: 'synthetic-import-batch', namespace: 'unit_import_batch' };
  const authority = createFirestoreAuthority(options), care = createFirestoreCareStore(options);
  await authority.initializeControl({ enabled: true, generation: randomUUID() });
  async function admit(userId: string) {
    const email = `${userId}@example.test`;
    await authority.issueInvitation({ email, operationId: randomUUID(), expiresAt: new Date(Date.now() + 3600000).toISOString() });
    await authority.admitIdentity({ userId, email, emailVerified: true });
    await authority.acknowledge({ userId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
    return (await authority.createChild({ userId, operationId: randomUUID(), displayName: userId })).child.id;
  }
  const childId = await admit('recipient'), sourceChildId = await admit('source');
  const originals = await Promise.all(['First', 'Second'].map(text => care.create('source', sourceChildId, { text, details: emptyCareDetails(), source: 'Original account' })));
  const source = { serverId: 'https://source.test', accountId: 'source', packageId: randomUUID(), packageVersion: 1, manifestSha256: 'a'.repeat(64) };
  const row = (index: number): HandoverImportRow => ({ section: 'care', childId: sourceChildId, value: { ...originals[index] },
    source: { ...source, path: 'data/1.json', rowIndex: index } });
  let expiresDuringReads = false, expired = false, leaseUntil = 0;
  const originalTransaction = fixture.database.runTransaction.bind(fixture.database);
  const batches = createFirestoreHandoverImportBatches({ ...options, serverClock: () => expired ? leaseUntil : Date.now(),
    database: { ...fixture.database, runTransaction: (async (callback: any, transactionOptions: any) => originalTransaction(async tx => callback({ ...tx,
      get: async (target: any) => {
        const snapshot = await tx.get(target);
        if (expiresDuringReads && target.path.includes('_handover_import_items/')) expired = true;
        return snapshot;
      },
    }), transactionOptions)) as typeof fixture.database.runTransaction } as typeof fixture.database });
  const request = { opId: randomUUID(), uploadId: randomUUID(), source, integrity: 'trusted', acceptedManifestSha256: null,
    targets: [{ sourceChildId, target: { childId, spaceId: null }, sections: ['care'] }], totalItems: 2, resolutions: [] };
  const batch = await batches.create('recipient', request);
  assert.deepEqual(await batches.create('recipient', request), batch);
  await assert.rejects(batches.create('recipient', { ...request, totalItems: 3 }), (e: any) => e.code === 'operation_conflict');
  let oldWork: FirestoreBackgroundWork;
  const deliveries: any[] = [];
  const codec = createFirestoreRestoreCodec(options);
  const takeImportDelivery = () => {
    const selected = deliveries.splice(0).filter(delivery => {
      const record = [...fixture.records].find(([path, data]) => path.includes('_background_work/') && data.id === delivery.id)!;
      return (codec.decode({ path: record[0], data: record[1] }).value as any).kind === 'handover-import';
    });
    assert.equal(selected.length, 1); return selected[0];
  };
  let phase = 1;
  const queue = createFirestoreBackgroundQueue({ ...options, enabled: true, readControl: tx => authority.readControl(tx), transport: {
    async enqueue(value: unknown) { deliveries.push(value); return { state: 'confirmed' as const }; },
    async probe() { return { state: 'confirmed' as const }; },
  }, execute: async work => {
    assert.equal(work.kind, 'handover-import');
    const claimed = await batches.claim(work); assert.ok(claimed);
    if (phase === 1) {
      oldWork = work;
      leaseUntil = Date.parse(work.lease!.until); expiresDuringReads = true;
      await assert.rejects(batches.apply(work, { position: 0, cursor: null, row: row(0), nextCursor: 'second-row' }),
        (e: any) => e.code === 'import_claim_invalid');
      expiresDuringReads = false; expired = false;
      assert.equal((await batches.get('recipient', batch.id)).position, 0);
      assert.equal([...fixture.records.keys()].filter(path => path.includes('_handover_import_items/')).length, 0);
      const result = await batches.apply(work, { position: 0, cursor: null, row: row(0), nextCursor: 'second-row' });
      assert.equal(result.item.outcome, 'created'); assert.equal(result.batch.position, 1);
      await assert.rejects(batches.apply(work, { position: 0, cursor: null, row: row(0), nextCursor: 'second-row' }),
        (e: any) => e.code === 'import_cursor_changed');
      await assert.rejects(batches.apply(work, { position: 1, cursor: 'second-row', row: row(0), nextCursor: null }),
        (e: any) => e.code === 'import_cursor_changed');
      const current = await batches.get('recipient', batch.id);
      const cancel = { opId: randomUUID(), expectedVersion: current.version };
      await batches.cancel('recipient', batch.id, cancel);
      assert.equal((await batches.cancel('recipient', batch.id, cancel)).state, 'cancelled');
      await assert.rejects(batches.apply(work, { position: 1, cursor: 'second-row', row: row(1), nextCursor: null }),
        (e: any) => e.code === 'import_batch_stopped');
      return { state: 'stopped' as const };
    }
    assert.equal(claimed.position, 1);
    await assert.rejects(batches.apply(oldWork!, { position: 1, cursor: 'second-row', row: row(1), nextCursor: null }),
      (e: any) => e.code === 'import_claim_invalid');
    const result = await batches.apply(work, { position: 1, cursor: 'second-row', row: row(1), nextCursor: null });
    assert.equal(result.batch.state, 'completed'); assert.equal(result.batch.counts.created, 2);
    return { state: 'completed' as const };
  } });
  await queue.dispatch();
  assert.equal((await queue.process(takeImportDelivery())).state, 'stopped');
  const stopped = await batches.get('recipient', batch.id);
  assert.equal(stopped.position, 1); assert.equal(stopped.state, 'cancelled');
  await assert.rejects(batches.get('source', batch.id));
  const resume = { opId: randomUUID(), expectedVersion: stopped.version };
  await batches.resume('recipient', batch.id, resume);
  assert.equal((await batches.resume('recipient', batch.id, resume)).state, 'queued');
  phase = 2; await queue.dispatch();
  assert.equal((await queue.process(takeImportDelivery())).state, 'completed');
  const reconnected = createFirestoreHandoverImportBatches(options);
  assert.equal((await reconnected.get('recipient', batch.id)).state, 'completed');
  assert.equal([...fixture.records.keys()].filter(path => path.includes('_handover_import_items/')).length, 2);

  // The same fence uses the actor's batch while domain writes use the class's canonical data scope.
  const sharing = createFirestoreSharingStore(options);
  const classroom = await sharing.create('recipient', { operationId: randomUUID(), name: 'Class', kind: 'class' });
  const member = await sharing.addClassChild('recipient', { operationId: randomUUID(), spaceId: classroom.id, expectedVersion: classroom.version, displayName: 'Learner' });
  const classBatch = await batches.create('recipient', { ...request, opId: randomUUID(), totalItems: 1,
    targets: [{ sourceChildId, target: { childId: member.child.id, spaceId: classroom.id }, sections: ['care'] }] });
  const classQueue = createFirestoreBackgroundQueue({ ...options, enabled: true, readControl: tx => authority.readControl(tx),
    transport: { async enqueue(value) { deliveries.push(value); return { state: 'confirmed' as const }; }, async probe() { return { state: 'confirmed' as const }; } },
    execute: async work => {
      await batches.claim(work);
      const result = await batches.apply(work, { position: 0, cursor: null, row: row(0), nextCursor: null });
      assert.equal(result.batch.state, 'completed');
      assert.equal((await care.forSharedSpace(classroom.id).get('recipient', member.child.id, result.item.resource!.id))!.text, 'First');
      return { state: 'completed' as const };
    } });
  await classQueue.dispatch(); assert.equal((await classQueue.process(takeImportDelivery())).state, 'completed');
  assert.equal((await batches.get('recipient', classBatch.id)).position, 1);
  const epoch = randomUUID();
  for (const [path, data] of fixture.records) if (/_handover_import_(batches|controls)\//u.test(path)) {
    const decoded = codec.decode({ path, data }); assert.equal(decoded.context.family, 'domain');
    if (decoded.context.family !== 'domain') throw new Error('Expected private domain');
    const transformed = codec.transform(decoded, { newEpochByWorkspace: new Map([[decoded.context.scope.workspaceId, epoch]]),
      generation: randomUUID(), photoDescriptors: new Map() });
    const recovered = codec.decode(transformed);
    if (path.includes('_handover_import_batches/')) {
      assert.equal((recovered.value as any).state, 'interrupted'); assert.equal((recovered.value as any).claim, null);
      assert.equal((recovered.value as any).position, (decoded.value as any).position);
    }
  }
});
