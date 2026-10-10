import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { FirestoreWorkContinuationRecovery } from '../server/firestore-work-continuation-recovery.ts';
import { createAgentWorkContinuationProcessor } from '../server/agent-work-continuation-worker.ts';
import { firestoreUsageFixture } from './helpers/firestore-ai-usage.ts';
import { workRecoveryFixture } from './helpers/firestore-work-recovery.ts';

async function setup() { const fake = firestoreUsageFixture(), fixture = workRecoveryFixture(fake.database); await fixture.seed(); return { fake, ...fixture }; }
function processor(service: FirestoreWorkContinuationRecovery) {
  return createAgentWorkContinuationProcessor({ mode: 'recover', store: service });
}

test('real recovery consumer preserves the original receipt, retries discarded callbacks, and replays without another change', async () => {
  const f = await setup(), receipt = f.rows.run.resultEncrypted, transactionsBeforeRecovery = f.fake.transactions.length;
  f.fake.retryCallback(); await processor(f.service).process(f.job, f.job.jobId);
  assert.equal((await f.read('event')).state, 'completed');
  assert.equal((await f.read('workspace')).changeSeq, '8');
  assert.equal((await f.read('change')).suppressWorkWake, true);
  assert.equal((await f.read('run')).resultEncrypted, receipt);
  assert.deepEqual(await new FirestoreWorkContinuationRecovery(f.options).recoverBackground(f.job), { state: 'already_terminal', runId: f.rows.run.id });
  assert.equal((await f.read('workspace')).changeSeq, '8');
  assert.ok(f.fake.transactions.slice(transactionsBeforeRecovery).every(tx => tx.writes <= 4 && tx.reads <= 18));
});

test('pending original run cannot execute, and lost expiry commit remains unknown after reconstruction', async () => {
  const f = await setup(); f.rows.run.state = 'running'; f.rows.run.resultEncrypted = null; await f.write('run');
  const pending = processor(f.service);
  await assert.rejects(pending.process(f.job, f.job.jobId), /work_continuation_run_pending/);
  assert.equal((await f.read('event')).state, 'queued'); assert.equal((await f.read('workspace')).changeSeq, '7');
  f.setNow(f.rows.run.expiresAtMs); f.fake.loseReply();
  await assert.rejects(pending.process(f.job, f.job.jobId), /Synthetic lost commit reply/);
  await processor(new FirestoreWorkContinuationRecovery(f.options)).process(f.job, f.job.jobId);
  const run = await f.read('run');
  assert.equal(run.state, 'unknown'); assert.equal(run.stopReason, 'interrupted'); assert.equal(run.resultEncrypted, null);
  assert.equal((await f.read('event')).state, 'unknown'); assert.equal((await f.read('workspace')).changeSeq, '8');
  assert.deepEqual(f.fake.records.size, 10);
});

test('transaction replay rechecks revocation, restored epoch and cancelled work without rewriting original receipts', async () => {
  for (const change of ['revocation', 'epoch', 'cancel'] as const) {
    const f = await setup(), original = f.fake.database.runTransaction.bind(f.fake.database);
    let first = true;
    const database = { collection: f.fake.database.collection.bind(f.fake.database), runTransaction: (callback: any, options: any) =>
      original(async tx => { const result = await callback(tx);
        if (first) { first = false;
          if (change === 'revocation') { f.rows.account.invitationLive = false; f.fake.records.set(f.ref('account').path, f.seal('account', f.rows.account)); }
          if (change === 'epoch') { f.rows.workspace.storageEpoch = randomUUID(); f.fake.records.set(f.ref('workspace').path, f.seal('workspace', f.rows.workspace)); }
          if (change === 'cancel') { f.cancelWork(); for (const kind of ['work', 'followup'] as const) f.fake.records.set(f.ref(kind).path, f.seal(kind, f.rows[kind])); }
        }
        return result;
      }, options) } as any;
    f.fake.retryCallback(); const service = new FirestoreWorkContinuationRecovery({ ...f.options, database });
    if (change === 'cancel') {
      await processor(service).process(f.job, f.job.jobId);
      assert.equal((await f.read('event')).state, 'cancelled'); assert.equal((await f.read('workspace')).changeSeq, '8');
    } else {
      await assert.rejects(processor(service).process(f.job, f.job.jobId), /work_recovery_authority/);
      assert.equal((await f.read('event')).state, 'queued'); assert.equal((await f.read('workspace')).changeSeq, '7');
      assert.equal(await f.read('change'), null);
    }
    assert.equal((await f.read('run')).resultEncrypted, f.rows.run.resultEncrypted);
    assert.equal((await f.read('run')).state, 'completed');
  }
});

test('missing or invalid authorities, claims and receipts fail closed with no SQL/provider fallback', async () => {
  for (const defect of ['missing_claim', 'wrong_run', 'missing_receipt', 'wrong_receipt', 'bad_ciphertext', 'missing_work', 'consent', 'deleted_child', 'future_due', 'foreign_namespace'] as const) {
    const f = await setup(); let forbidden = 0;
    if (defect === 'missing_claim') f.fake.records.delete(f.ref('claim').path);
    if (defect === 'wrong_run') { f.rows.run.triggerReference = randomUUID(); await f.write('run'); }
    if (defect === 'missing_receipt') { f.rows.run.resultEncrypted = null; await f.write('run'); }
    if (defect === 'wrong_receipt') {
      f.rows.run.resultEncrypted = f.options.cipher.encrypt(JSON.stringify({ ...f.original, runId: randomUUID() }),
        `agent-run:${f.scope.childId}:${f.scope.ownerUserId}:${f.rows.run.id}`); await f.write('run');
    }
    if (defect === 'bad_ciphertext') { f.rows.event.payloadEncrypted = 'corrupt'; await f.write('event'); }
    if (defect === 'missing_work') f.fake.records.delete(f.ref('work').path);
    if (defect === 'consent') { f.rows.account.acknowledgementVersion = 'old'; await f.write('account'); }
    if (defect === 'deleted_child') { f.rows.child.status = 'deleting'; await f.write('child'); }
    if (defect === 'future_due') {
      const dueAt = new Date(f.now() + 1000).toISOString(); f.values.followUp.dueAt = dueAt; f.rows.followup.dueAt = dueAt;
      f.rows.work.payloadEncrypted = f.options.cipher.encrypt(JSON.stringify(f.values),
        `agent-work:${f.scope.childId}:${f.scope.ownerUserId}:${f.rows.work.id}:1`); await f.write('work'); await f.write('followup');
    }
    let service = f.service;
    if (defect === 'foreign_namespace') {
      const ns = 'other_namespace'; for (const [path, value] of [...f.fake.records]) f.fake.records.set(path.replace(f.options.namespace, ns), value);
      service = new FirestoreWorkContinuationRecovery({ ...f.options, namespace: ns });
    }
    const before = new Map(f.fake.records);
    const consumer = createAgentWorkContinuationProcessor({ mode: 'recover', store: service,
      agent: { background: () => { forbidden++; throw new Error('provider forbidden'); } },
      pool: { query: () => { forbidden++; throw new Error('SQL forbidden'); } } } as any);
    await assert.rejects(consumer.process(f.job, f.job.jobId), /work_recovery_/);
    assert.deepEqual(f.fake.records, before, defect); assert.equal(forbidden, 0);
  }
});

test('unsupported non-due constituents and a failed commit never leave partial terminal writes', async () => {
  const f = await setup();
  f.fake.failCommit(); await assert.rejects(processor(f.service).process(f.job, f.job.jobId), /Synthetic failed commit/);
  assert.equal((await f.read('event')).state, 'queued'); assert.equal((await f.read('workspace')).changeSeq, '7'); assert.equal(await f.read('change'), null);
  f.rows.event.payloadEncrypted = f.options.cipher.encrypt(JSON.stringify({ works: [{ workId: f.rows.work.id, workVersion: 1,
    changes: { due: false, resources: [], knowledge: [] } }] }), `agent-work-continuation:${f.scope.childId}:${f.scope.ownerUserId}:${f.job.eventId}`);
  await f.write('event');
  await assert.rejects(processor(f.service).process(f.job, f.job.jobId), /work_recovery_invalid_document/);
  assert.equal((await f.read('event')).state, 'queued'); assert.equal(await f.read('change'), null);
});
