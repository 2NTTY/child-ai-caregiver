import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { avatarDomainFixture } from './helpers/avatar-memory.ts';
import { avatarMaintenanceFixture } from './helpers/avatar-maintenance-memory.ts';
import { avatarReserveResultSchema } from '../src/shared/avatars.ts';
import { FirestoreDomainData, FIRESTORE_TASK_DISPATCH_SCOPE } from '../server/firestore-domain-data.ts';
import { createFirestoreBackgroundQueue, prepareFirestoreBackgroundWork, prepareObjectCleanupWake,
  type FirestoreBackgroundDelivery } from '../server/firestore-background-work.ts';
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }

test('real maintenance→queue: prepared retention defers, current stays protected, later supersede/remove wakes exact pinned cleanup', async t => {
  for (const action of ['supersede', 'remove'] as const) {
    const f = await avatarDomainFixture(), clock = t.mock.method(Date, 'now', f.now);
    const m = avatarMaintenanceFixture(f), entered = deferred(), finish = deferred(), write = f.bucket.port.writeNew;
    f.bucket.port.writeNew = async (...args) => { entered.resolve(); await finish.promise; return write(...args); };
    const one = avatarReserveResultSchema.parse((await f.online.submit(f.owner, f.reserve())).result).upload;
    const uploading = f.upload(one.id); await entered.promise;
    f.advance(f.config.admission.totalTimeoutMs + 1); await m.maintenance.tick(); await m.queue.dispatch();
    assert.equal(m.deliveries.length, 1); const originalJob = m.deliveries[0];
    assert.equal((await m.queue.process(originalJob)).state, 'pending');
    assert.equal(f.bucket.removes(), 0);
    finish.resolve(); await uploading; await f.online.submit(f.owner, f.submission('commit', { uploadId: one.id, expectedVersion: 0 }));
    f.advance(f.config.admission.uploadTtlMs + 1); await m.queue.dispatch();
    assert.equal(m.deliveries.length, 2); assert.equal(m.deliveries[1].id, originalJob.id);
    assert.equal((await m.queue.process(m.deliveries[1])).state, 'completed'); assert.equal(f.bucket.removes(), 0);
    await m.maintenance.tick(); await m.queue.dispatch(); assert.equal(m.deliveries.length, 2, 'Current staging cannot self-wake');
    if (action === 'supersede') {
      const two = avatarReserveResultSchema.parse((await f.online.submit(f.owner, f.reserve(1))).result).upload;
      await f.upload(two.id); await f.online.submit(f.owner, f.submission('commit', { uploadId: two.id, expectedVersion: 1 }));
    } else await f.online.submit(f.owner, f.submission('remove', { expectedVersion: 1, confirmRemove: true }));
    f.advance(60001); await m.maintenance.tick(); await m.queue.dispatch();
    assert.equal(m.deliveries.length, 3); const awakened = m.deliveries[2];
    assert.equal(awakened.id, originalJob.id); assert.ok(awakened.dispatchRevision > m.deliveries[1].dispatchRevision);
    assert.equal((await m.queue.process(awakened)).state, 'completed'); assert.equal(f.bucket.removes(), 1);
    assert.equal((await m.queue.process(awakened)).state, 'completed'); assert.equal(f.bucket.removes(), 1);
    f.advance(60001); await m.maintenance.tick(); await m.queue.dispatch(); assert.equal(m.deliveries.length, 3, 'Complete obligation does not requeue');
    assert.equal(f.bucket.records.size, action === 'supersede' ? 1 : 0); clock.mock.restore();
  }
});

test('avatar completed wake is evidence-gated/idempotent; non-avatar default and opt-in rejection stay isolated', async t => {
  const f = await avatarDomainFixture(); t.mock.method(Date, 'now', f.now); avatarMaintenanceFixture(f);
  const data = new FirestoreDomainData(f.options), deliveries: FirestoreBackgroundDelivery[] = []; let effects = 0;
  const queue = createFirestoreBackgroundQueue({ ...f.options, enabled: true, readControl: tx => f.authority.readControl(tx),
    transport: { async enqueue(job) { deliveries.push(job); return { state: 'confirmed' }; }, async probe() { throw new Error('No uncertain transport'); } },
    async execute() { effects++; return { state: 'completed' }; } });
  for (const kind of ['avatar-cleanup', 'photo-cleanup', 'voice-cleanup', 'file-cleanup'] as const) {
    const identity = { kind, scope: FIRESTORE_TASK_DISPATCH_SCOPE, resourceId: randomUUID(), basis: 'synthetic-cleanup', generation: f.generation, authorizationVersion: '0' };
    await f.options.database.runTransaction(async tx => { const work = await prepareFirestoreBackgroundWork(data, tx, identity, new Date(f.now() - 1).toISOString()); work.commit(); });
    await queue.dispatch(); const first = deliveries.at(-1)!; await queue.process(first); const count = deliveries.length;
    await f.options.database.runTransaction(async tx => (await prepareObjectCleanupWake(data, tx, identity, 'descriptor:reason:version'))());
    await queue.dispatch(); assert.equal(deliveries.length, count, 'Default never reopens completed work');
    if (kind !== 'avatar-cleanup') {
      await assert.rejects(f.options.database.runTransaction(async tx => (await prepareObjectCleanupWake(data, tx, identity, 'different', { avatarLifecycle: true }))()));
      await queue.dispatch(); assert.equal(deliveries.length, count); continue;
    }
    f.fake.retry();
    await f.options.database.runTransaction(async tx => (await prepareObjectCleanupWake(data, tx, identity, 'descriptor:reason:version', { avatarLifecycle: true }))());
    await queue.dispatch(); assert.equal(deliveries.length, count + 1); assert.equal(deliveries.at(-1)!.id, first.id);
    const next = deliveries.at(-1)!; await queue.process(next); const effectCount = effects;
    await queue.process(next); assert.equal(effects, effectCount);
    await f.options.database.runTransaction(async tx => (await prepareObjectCleanupWake(data, tx, identity, 'descriptor:reason:version', { avatarLifecycle: true }))());
    await queue.dispatch(); assert.equal(deliveries.length, count + 1, 'Identical evidence cannot loop');
  }
});
