import { port, host, projectId, connections, blocked } from './firestore-session-emulator-guard.mjs';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
const { Firestore } = await import('@google-cloud/firestore');
const { FirestoreWorkContinuationRecovery } = await import('../server/firestore-work-continuation-recovery.ts');
const { createAgentWorkContinuationProcessor } = await import('../server/agent-work-continuation-worker.ts');
const { workRecoveryFixture } = await import('./helpers/firestore-work-recovery.ts');
globalThis.fetch = () => { blocked.push({ kind: 'fetch' }); throw new Error('Fetch forbidden in emulator probe'); };
const database = new Firestore({ projectId, host: '127.0.0.1', port, ssl: false, ignoreUndefinedProperties: false });
const fixtures = [], results = [];
let forbidden = 0;
function consumer(service) {
  return createAgentWorkContinuationProcessor({ mode: 'recover', store: service,
    agent: { background() { forbidden++; throw new Error('Model/new claim forbidden'); } },
    pool: { query() { forbidden++; throw new Error('SQL forbidden'); } } });
}
async function fixture() {
  const f = workRecoveryFixture(database, projectId, `recovery_${randomBytes(8).toString('hex')}`);
  fixtures.push(f); await f.seed(); return f;
}
try {
  const completed = await fixture(), originalReceipt = completed.rows.run.resultEncrypted;
  const first = consumer(completed.service), second = consumer(new FirestoreWorkContinuationRecovery(completed.options));
  await Promise.all([first.process(completed.job, completed.job.jobId), second.process(completed.job, completed.job.jobId)]);
  assert.equal((await completed.read('event')).state, 'completed');
  assert.equal((await completed.read('workspace')).changeSeq, '8');
  assert.equal((await completed.read('run')).resultEncrypted, originalReceipt);
  assert.equal((await completed.read('change')).changeSeq, '8');
  await consumer(new FirestoreWorkContinuationRecovery(completed.options)).process(completed.job, completed.job.jobId);
  assert.equal((await completed.read('workspace')).changeSeq, '8');
  results.push({ name: 'native transaction concurrent consumers and reconstructed replay retain one terminal change and original ciphertext', passed: true });

  const expired = await fixture(); expired.rows.run.state = 'running'; expired.rows.run.resultEncrypted = null; await expired.write('run');
  await assert.rejects(consumer(expired.service).process(expired.job, expired.job.jobId), /work_continuation_run_pending/);
  assert.equal((await expired.read('event')).state, 'queued');
  expired.setNow(expired.rows.run.expiresAtMs);
  let loseReply = true;
  const lostReplyDatabase = { collection: database.collection.bind(database), async runTransaction(callback, options) {
    const committed = await database.runTransaction(callback, options);
    if (loseReply) { loseReply = false; throw new Error('Synthetic lost acknowledgement after native commit'); }
    return committed;
  } };
  await assert.rejects(consumer(new FirestoreWorkContinuationRecovery({ ...expired.options, database: lostReplyDatabase }))
    .process(expired.job, expired.job.jobId), /Synthetic lost acknowledgement/);
  await consumer(new FirestoreWorkContinuationRecovery(expired.options)).process(expired.job, expired.job.jobId);
  const originalRun = await expired.read('run');
  assert.equal(originalRun.state, 'unknown'); assert.equal(originalRun.stopReason, 'interrupted'); assert.equal(originalRun.resultEncrypted, null);
  assert.equal((await expired.read('event')).state, 'unknown'); assert.equal((await expired.read('workspace')).changeSeq, '8');
  results.push({ name: 'native pending then expired original run and deliberately lost commit acknowledgement recover without execution', passed: true });

  const cancelled = await fixture(); cancelled.cancelWork(); await cancelled.write('work'); await cancelled.write('followup');
  await consumer(cancelled.service).process(cancelled.job, cancelled.job.jobId);
  assert.equal((await cancelled.read('event')).state, 'cancelled');
  assert.equal((await cancelled.read('run')).state, 'completed');
  assert.equal((await cancelled.read('run')).resultEncrypted, cancelled.rows.run.resultEncrypted);
  results.push({ name: 'native current cancellation settles event only and preserves prior completed run receipt', passed: true });
  assert.equal(forbidden, 0); assert.equal(blocked.length, 0);
} finally {
  for (const f of fixtures) {
    const batch = database.batch(); for (const kind of [...Object.keys(f.rows), 'change']) batch.delete(f.ref(kind)); await batch.commit();
  }
  await database.terminate();
  const summary = { projectId, host, sdkVersion: '9.3.1', results, syntheticSeedOnly: true, networkConnections: connections.length,
    blocked, forbiddenSqlOrProviderCalls: forbidden, productionBootstrap: false, realCloudAcceptance: false,
    limits: ['Callback invalidation races were synthetic-only; this script does not claim cloud contention semantics.',
      'Lost acknowledgement was injected after an actual emulator transaction commit.',
      'Authority creation, new run claim, scheduler, account/device migration and production writers remain unimplemented.'] };
  if (process.argv[3]) await writeFile(process.argv[3], JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary));
}
