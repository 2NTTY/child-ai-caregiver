import test from 'node:test';
import assert from 'node:assert/strict';
import { createFirebaseWorkerServices } from '../server/firebase-worker-services.ts';
import { privateSummaryPolicyFixture } from './helpers/private-summary-policy.ts';
import { summaryPartBackgroundIdentity } from '../server/private-summary-work.ts';
import { firestoreDomainHash } from '../server/firestore-domain-data.ts';
import { privateSummaryCutoverSchema, privateSummaryCutoverId, privateSummaryInventoryGenesis } from '../server/private-summary-scan.ts';
import { firestoreBackgroundWorkSchema, prepareFirestoreBackgroundWork } from '../server/firestore-background-work.ts';
import { readContextBasis } from '../server/firestore-context-basis.ts';

async function fixture() {
  const f = await privateSummaryPolicyFixture();
  await f.barrier();
  await f.authority.runTransaction('owner', f.childId, async b => {
    const id = privateSummaryCutoverId(b.scope), value = privateSummaryCutoverSchema.parse({
      format: 'private-summary-cutover/v1', id, scope: b.scope, authorizationVersion: b.authorizationVersion,
      workerGeneration: b.generation, version: 1, inventoryVersion: 1, phase: 'complete', entryFenceVersion: 'private-summary-entry/v1',
      upperCaptured: true, upperRunDocumentId: null, afterRunDocumentId: null, inspectedRuns: 0, unresolvedMappedRuns: 0,
      unmappedRuns: 0, inventoryHash: privateSummaryInventoryGenesis(b.scope, b.authorizationVersion, b.generation, 1), exhausted: true, restoreId: null,
    });
    b.transaction.set(f.data.ref('private_summary_scans', 'private-summary-cutover', id),
      { ...f.data.tags(b.scope), ...f.data.seal('private-summary-cutover', id, b.scope, privateSummaryCutoverSchema, value, 1) });
  });
  let parts = 0, legacy = 0;
  const runtime = { ...f.options, config: { ...f.options, taskWorkerEnabled: true }, authority: f.authority,
    async currentAuth() { return { disabled: false, emailVerified: true, email: 'owner@example.test' }; },
    product: { summaryWork: f.build(), async maintainSummaryPart(input: { authorize(): Promise<boolean> }) {
      assert.equal(await input.authorize(), true); parts++; return { state: 'completed', receipt: null };
    }, async maintainSummary() { legacy++; return { state: 'completed', more: false }; } },
    knowledgeRefresh: { async jobs() { return []; } }, reminders: {}, photos: {}, erasures: {}, erasureCleanup: {},
  };
  const unusedDelivery = { taskName() { throw new Error('No external queue'); },
    async enqueue() { throw new Error('No external queue'); }, async probe() { throw new Error('No external queue'); } };
  const services = createFirebaseWorkerServices(runtime as never, unusedDelivery, unusedDelivery, new AbortController());
  const process = async (id: string) => {
    const job = await f.authority.runTransaction('owner', f.childId, async b => f.data.open('background-work', id, b.scope,
      firestoreBackgroundWorkSchema, await b.transaction.get(f.data.ref('background_work', 'background-work', id))));
    return services.background.process({ kind: 'product-work', id, generation: job.generation,
      dispatchRevision: job.dispatchRevision, scheduledAt: job.dueAt });
  };
  return { ...f, process, parts: () => parts, legacy: () => legacy };
}

test('the actual worker sends a canonical part lease to the durable consumer without numeric scope settlement', async () => {
  const f = await fixture(), started = await f.build().start('owner', f.childId, { kind: 'next_fresh' });
  if (started.kind !== 'created') throw new Error('Expected work');
  const before = await f.authority.runTransaction('owner', f.childId, b => readContextBasis(f.data, b));
  await f.process(firestoreDomainHash(['product-work', summaryPartBackgroundIdentity(started.work)]));
  assert.equal(f.parts(), 1); assert.equal(f.legacy(), 0);
  const after = await f.authority.runTransaction('owner', f.childId, b => readContextBasis(f.data, b));
  assert.deepEqual(after.value, before.value);
});

test('completion is only a scope scan hint and never becomes a model permit or a numeric basis', async () => {
  const f = await fixture();
  const before = await f.authority.runTransaction('owner', f.childId, b => readContextBasis(f.data, b));
  const id = await f.authority.runTransaction('owner', f.childId, async b => {
    const job = await prepareFirestoreBackgroundWork(f.data, b.transaction, { kind: 'memory-refresh', scope: b.scope,
      resourceId: b.scope.childId, basis: 'summary-completion:v1:' + 'a'.repeat(64),
      generation: b.generation, authorizationVersion: b.authorizationVersion }, new Date().toISOString());
    job.commit(); return job.id;
  });
  await f.process(id);
  const after = await f.authority.runTransaction('owner', f.childId, b => readContextBasis(f.data, b));
  assert.equal(f.parts(), 0); assert.equal(f.legacy(), 0);
  assert.equal(after.value.summaryPending, true);
  assert.equal(after.value.summaryRequest, before.value.summaryRequest! + 1);
});
