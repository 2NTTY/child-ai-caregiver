import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { privateSummaryPolicyFixture } from './helpers/private-summary-policy.ts';
import { createFirestorePrivateSummaryWork } from '../server/firestore-private-summary-work.ts';
import { privateSummaryCutoverSchema, privateSummaryCutoverId, privateSummaryInventoryGenesis } from '../server/private-summary-scan.ts';

test('a scope without any activation or durable history keeps its original whole-summary route', async () => {
  const f = await privateSummaryPolicyFixture();
  const service = createFirestorePrivateSummaryWork({ ...f.options, memory: f.memory, runs: f.runs }) as unknown as { readEntryGate: (binding: unknown) => Promise<unknown> };
  assert.equal(typeof service.readEntryGate, 'function');
  assert.deepEqual(await f.authority.runTransaction('owner', f.childId, b => service.readEntryGate(b)), { kind: 'legacy' });
});

test('durable history with a missing activation record never falls back to a fresh legacy run', async () => {
  const f = await privateSummaryPolicyFixture();
  await f.barrier();
  assert.equal((await f.build().start('owner', f.childId, { kind: 'next_fresh' })).kind, 'created');
  const service = createFirestorePrivateSummaryWork({ ...f.options, memory: f.memory, runs: f.runs }) as unknown as { readEntryGate: (binding: unknown) => Promise<unknown> };
  assert.equal(typeof service.readEntryGate, 'function');
  assert.deepEqual(await f.authority.runTransaction('owner', f.childId, b => service.readEntryGate(b)),
    { kind: 'blocked', reason: 'activation_missing' });
});

test('persistent cutover and restore gates cannot disappear when the current policy is unavailable', async () => {
  const f = await privateSummaryPolicyFixture();
  const service = createFirestorePrivateSummaryWork({ ...f.options, memory: f.memory, runs: f.runs }) as unknown as { readEntryGate: (binding: unknown) => Promise<unknown> };
  assert.equal(typeof service.readEntryGate, 'function');
  for (const phase of ['inventory', 'complete', 'restore_suspended'] as const) {
    await f.authority.runTransaction('owner', f.childId, async b => {
      const id = privateSummaryCutoverId(b.scope), value = privateSummaryCutoverSchema.parse({
        format: 'private-summary-cutover/v1', id, scope: b.scope, authorizationVersion: b.authorizationVersion,
        workerGeneration: b.generation, version: 1, inventoryVersion: 1, phase, entryFenceVersion: 'private-summary-entry/v1',
        upperCaptured: phase === 'complete', upperRunDocumentId: null, afterRunDocumentId: null,
        inspectedRuns: 0, unresolvedMappedRuns: 0, unmappedRuns: 0,
        inventoryHash: privateSummaryInventoryGenesis(b.scope, b.authorizationVersion, b.generation, 1),
        exhausted: phase === 'complete', restoreId: phase === 'restore_suspended' ? randomUUID() : null,
      });
      b.transaction.set(f.data.ref('private_summary_scans', 'private-summary-cutover', id),
        { ...f.data.tags(b.scope), ...f.data.seal('private-summary-cutover', id, b.scope, privateSummaryCutoverSchema, value, value.version) });
    });
    assert.deepEqual(await f.authority.runTransaction('owner', f.childId, b => service.readEntryGate(b)),
      { kind: 'blocked', reason: phase === 'complete' ? 'policy_missing' : phase });
  }
});

test('a self-consistent foreign cutover body cannot borrow the current scope envelope and locator', async () => {
  const f = await privateSummaryPolicyFixture();
  await f.authority.runTransaction('owner', f.childId, async b => {
    const id = privateSummaryCutoverId(b.scope), scope = { ...b.scope, childId: randomUUID() };
    const value = privateSummaryCutoverSchema.parse({ format: 'private-summary-cutover/v1', id: privateSummaryCutoverId(scope), scope,
      authorizationVersion: b.authorizationVersion, workerGeneration: b.generation, version: 1, inventoryVersion: 1,
      phase: 'complete', entryFenceVersion: 'private-summary-entry/v1', upperCaptured: true,
      upperRunDocumentId: null, afterRunDocumentId: null, inspectedRuns: 0, unresolvedMappedRuns: 0, unmappedRuns: 0,
      inventoryHash: privateSummaryInventoryGenesis(scope, b.authorizationVersion, b.generation, 1), exhausted: true, restoreId: null });
    b.transaction.set(f.data.ref('private_summary_scans', 'private-summary-cutover', id),
      { ...f.data.tags(b.scope), ...f.data.seal('private-summary-cutover', id, b.scope, privateSummaryCutoverSchema, value, value.version) });
  });
  await assert.rejects(f.authority.runTransaction('owner', f.childId, b => f.build().readEntryGate(b)),
    { code: 'private_summary_cutover_projection' });
});
