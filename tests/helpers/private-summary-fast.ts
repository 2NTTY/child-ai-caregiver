import assert from 'node:assert/strict';
import { privateSummaryRootFixture } from './private-summary-root.ts';
import { privateSummaryCutoverId, privateSummaryCutoverSchema, privateSummaryInventoryGenesis } from '../../server/private-summary-scan.ts';
import { createFirestoreBackgroundQueue, prepareFirestoreBackgroundWork, firestoreBackgroundReference } from '../../server/firestore-background-work.ts';

export async function privateSummaryFastFixture(sourceText?: string, activateInitially = true) {
  const f = await privateSummaryRootFixture(sourceText);
  await f.barrier();
  async function activate() { await f.authority.runTransaction('owner', f.childId, async b => {
    const id = privateSummaryCutoverId(b.scope), value = privateSummaryCutoverSchema.parse({
      format: 'private-summary-cutover/v1', id, scope: b.scope, authorizationVersion: b.authorizationVersion,
      workerGeneration: b.generation, version: 1, inventoryVersion: 1, phase: 'complete', entryFenceVersion: 'private-summary-entry/v1',
      upperCaptured: true, upperRunDocumentId: null, afterRunDocumentId: null, inspectedRuns: 0, unresolvedMappedRuns: 0,
      unmappedRuns: 0, inventoryHash: privateSummaryInventoryGenesis(b.scope, b.authorizationVersion, b.generation, 1), exhausted: true, restoreId: null,
    });
    b.transaction.set(f.data.ref('private_summary_scans', 'private-summary-cutover', id),
      { ...f.data.tags(b.scope), ...f.data.seal('private-summary-cutover', id, b.scope, privateSummaryCutoverSchema, value, 1) });
  }); }
  if (activateInitially) await activate();
  let ordinal = 0;
  async function withScopeLease(callback: (reference: string) => Promise<void>, identity?: { resourceId?: string; basis?: string }) {
    const dueAt = new Date(Date.now() - 1000).toISOString(), basis = String(++ordinal);
    const id = await f.authority.runTransaction('owner', f.childId, async b => {
      const job = await prepareFirestoreBackgroundWork(f.data, b.transaction, { kind: 'memory-refresh', scope: b.scope,
        resourceId: identity?.resourceId ?? f.childId, basis: identity?.basis ?? basis, generation: b.generation, authorizationVersion: b.authorizationVersion }, dueAt);
      job.commit(); return job.id;
    });
    let failure: unknown, executed = false;
    const queue = createFirestoreBackgroundQueue({ ...f.options, enabled: true, readControl: tx => f.authority.readControl(tx),
      transport: { async enqueue() { throw new Error('No external queue'); }, async probe() { throw new Error('No external queue'); } },
      async execute(job) {
        executed = true;
        try { await callback(firestoreBackgroundReference(job)); } catch (error) { failure = error; }
        return { state: 'completed' };
      } });
    await queue.process({ kind: 'product-work', id, generation: f.generation, dispatchRevision: 1, scheduledAt: dueAt });
    assert.equal(executed, true); if (failure) throw failure;
  }
  return { ...f, activate, withScopeLease };
}
