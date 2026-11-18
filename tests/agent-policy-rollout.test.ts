import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { readAiConfig } from '../server/ai-config.ts';
import { createFirestoreAdmin } from '../server/firestore-admin.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreModelRouting } from '../server/firestore-model-routing.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { AGENT_HIGH_WATERMARK_DEFAULTS } from '../src/shared/agent-run-limits.ts';

function fixture() {
  const f = firestoreDomainFixture();
  const options = { database: f.database, cipher: createStorageCipher(Buffer.alloc(32, 16)), projectId: 'synthetic-rollout', namespace: 'rollout' };
  const config = readAiConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: options.projectId });
  const admin = createFirestoreAdmin(options, config);
  async function update(values: object) {
    const { version, updatedAt, ...prior } = await admin.readPolicy();
    await admin.submit('admin', { opId: randomUUID(), kind: 'policy', expectedVersion: version, values: { ...prior, ...values } });
    return version + 1;
  }
  return { f, options, config, admin, update };
}

test('two independent routed workers observe the same committed version across an in-flight barrier and fresh selection', async () => {
  const { options, config, update } = fixture();
  const authority = createFirestoreAuthority(options);
  await authority.initializeControl({ generation: randomUUID(), enabled: true });
  await authority.issueInvitation({ email: 'owner@example.test', expiresAt: new Date(Date.now() + 60_000).toISOString(), operationId: randomUUID() });
  await authority.admitIdentity({ userId: 'owner', email: 'owner@example.test', emailVerified: true });
  await authority.acknowledge({ userId: 'owner', operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  const workers = [createFirestoreModelRouting(options, config), createFirestoreModelRouting(options, config)];
  const initial = await Promise.all(workers.map(worker => worker.resolve('owner', 'worker')));
  const version = await update({ maxModelCalls: 1, roleSoftBudgetRatios: { background: 0.17 } });
  for (const selected of initial) {
    const change = await selected.readPolicyTransition();
    assert.equal(change?.policyVersion, version);
    assert.equal(change?.softBudgetSource, 'administrator');
    assert.equal(change?.enabled, true);
    assert.equal(change?.roleSoftBudgetRatios?.background, 0.17);
    assert.equal(change?.maxModelCalls, 1);
    assert.equal(await selected.readPolicyTransition(), null);
  }
  assert.equal((await workers[1].resolve('owner', 'worker')).policyVersion, version);
  const revoke = await update({ enabled: false });
  for (const selected of initial) {
    const change = await selected.readPolicyTransition();
    assert.equal(change?.policyVersion, revoke);
    assert.equal(change?.enabled, false);
  }
});

test('an uncertain external delivery is not replayed by transaction retries or a reconstructed worker', async () => {
  const { options, config, f, admin, update } = fixture();
  await update({ highWatermark: { ...AGENT_HIGH_WATERMARK_DEFAULTS, minHighRuns: 1 } });
  let sends = 0;
  const send = async () => { sends++; throw new Error('Synthetic transport acknowledgement lost'); };
  const sample = { sampleId: 'original', runCategory: 'background', usedModelCalls: 2, hardModelCalls: 2 };
  f.retry();
  await admin.budgetAlerts.record(sample, send);
  await createFirestoreAdmin(options, config).budgetAlerts.record(sample, send);
  const {items} = await admin.budgetAlerts.list();
  assert.equal(sends, 1);
  assert.equal(items.length, 1);
  assert.equal(items[0].delivery, 'unknown');
  assert.equal(items[0].receivedAt, null);
});

test('two workers share one durable incident, preserve unsent and acknowledge only an explicit receipt', async () => {
  const { options, config, admin, update } = fixture();
  const version = await update({ highWatermark: { ...AGENT_HIGH_WATERMARK_DEFAULTS, thresholdRatio: 0.5, windowSize: 2, consecutiveHighStreak: 2, minHighRuns: 2 } });
  const workerB = createFirestoreAdmin(options, config).budgetAlerts;
  const sample = (id: string, used: number) => ({ sampleId: id, runCategory: 'background', usedModelCalls: used, hardModelCalls: 4 });
  await Promise.all([admin.budgetAlerts.record(sample('first', 2)), workerB.record(sample('second', 2))]);
  await workerB.record(sample('second', 2));
  const {items} = await admin.budgetAlerts.list();
  assert.equal(items.length, 1);
  assert.equal(items[0].policyVersion, version);
  assert.equal(items[0].delivery, 'not_sent');
  assert.equal(items[0].receivedAt, null);
  const receipt = await admin.budgetAlerts.ack({ category: 'background', id: items[0].id });
  assert.ok(receipt.receivedAt);
  assert.deepEqual(await workerB.ack({ category: 'background', id: items[0].id }), receipt);
  await workerB.record(sample('low', 0));
  await workerB.record(sample('third', 2));
  await admin.budgetAlerts.record(sample('fourth', 2));
  assert.equal((await workerB.list()).items.length, 2);
  assert.equal((await workerB.list()).items.find(row => row.id === receipt.id)?.receivedAt, receipt.receivedAt);
});
