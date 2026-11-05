import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { privateSummaryFixture } from './private-summary-work.ts';
import { createFirestorePrivateSummaryWork, summaryPartBackgroundIdentity, type SummaryWorkPolicyPort } from '../../server/firestore-private-summary-work.ts';
import { FirestoreDomainData, firestoreDomainHash } from '../../server/firestore-domain-data.ts';
import { summaryLineageKey, summaryManifestHash, type SummaryWorkGrant } from '../../server/private-summary-work.ts';
import { createFirestoreAgentRuns } from '../../server/firestore-agent-runs.ts';
import type { AgentRunClaim } from '../../server/product-agent-store.ts';
import { createFirestoreBackgroundQueue, prepareFirestoreBackgroundWork, readFirestoreBackgroundClaim, firestoreBackgroundReference, firestoreBackgroundWorkSchema } from '../../server/firestore-background-work.ts';
import { workRecoveryScopeSchema } from '../../server/firestore-work-continuation-recovery.ts';

// Fixture-only cutover evidence for this fresh synthetic namespace. Production has no reader.
const inventorySchema = z.object({ entries: z.array(z.never()), cutover: z.string(), pages: z.tuple([z.literal(0)]),
  cursor: z.null(), scope: workRecoveryScopeSchema }).strict();
const barrierSchema = z.object({ id: z.string(), version: z.number().int().positive(), scope: workRecoveryScopeSchema,
  authorizationVersion: z.string(), workerGeneration: z.uuid(), inventoryHash: z.string(), cutover: z.string(),
  status: z.enum(['complete', 'incomplete', 'unmapped_legacy']), fence: z.enum(['active', 'absent']) }).strict();
export async function privateSummaryPolicyFixture(sourceText = 'Synthetic full original text 👩‍👩‍👧‍👦', ownerUserId = 'owner') {
  const f = await privateSummaryFixture(ownerUserId), data = new FirestoreDomainData(f.options);
  const grant: SummaryWorkGrant = { grantId: randomUUID(), revision: 1, policyVersion: 'synthetic-policy',
    settingsVersion: 'synthetic-settings', promptPackVersion: 'synthetic-prompts', billingSource: 'platform',
    billingVersion: 'synthetic-billing', model: 'synthetic-model', retryPolicyVersion: 'synthetic-no-retry',
    limits: { modelCalls: 8, toolCalls: 8 }, workDeadlineAt: null };
  let resolutions = 0;
  const policy: SummaryWorkPolicyPort = {
    async resolveInitial() { resolutions++; return { grant, dueAt: new Date().toISOString() }; },
    async readLegacyAdmission(b, input) {
      const id = firestoreDomainHash(['synthetic-barrier', b.scope]);
      const row = await b.transaction.get(data.ref('test_summary_barriers', 'test-barrier', id));
      if (!row.exists) return { kind: 'blocked', reason: 'missing' };
      const barrier = data.open('test-barrier', id, b.scope, barrierSchema, row);
      const snapshot = await b.transaction.get(data.ref('test_summary_barriers', 'test-inventory', id));
      if (!snapshot.exists || barrier.status === 'incomplete') return { kind: 'blocked', reason: 'incomplete' };
      if (barrier.status === 'unmapped_legacy') return { kind: 'blocked', reason: 'unmapped_legacy' };
      const inventory = data.open('test-inventory', id, b.scope, inventorySchema, snapshot);
      if (barrier.fence !== 'active') return { kind: 'blocked', reason: 'unfenced' };
      if (barrier.authorizationVersion !== b.authorizationVersion || barrier.workerGeneration !== b.generation
        || firestoreDomainHash(barrier.scope) !== firestoreDomainHash(b.scope)
        || firestoreDomainHash(inventory.scope) !== firestoreDomainHash(b.scope)
        || inventory.cutover !== barrier.cutover || firestoreDomainHash(inventory) !== barrier.inventoryHash)
        return { kind: 'blocked', reason: 'stale' };
      return { kind: 'admitted', barrierId: id, barrierVersion: barrier.version, scope: b.scope,
        authorizationVersion: b.authorizationVersion, workerGeneration: b.generation, ...input, inventoryHash: barrier.inventoryHash };
    },
  };
  const runs = createFirestoreAgentRuns({ ...f.options, chat: f.chat, memory: f.memory,
    async authorizeWorker(b, reference, recipeId) {
      const job = await readFirestoreBackgroundClaim(data, b, reference);
      return job?.kind === 'memory-refresh' && job.resourceId === b.scope.childId && recipeId === 'memory-refresh';
    } });
  const build = (custom: SummaryWorkPolicyPort | undefined = policy) => createFirestorePrivateSummaryWork({ ...f.options, memory: f.memory, policy: custom, runs });
  async function withFastRun(callback: (claim: AgentRunClaim) => Promise<void>) {
    const basis = 'synthetic-fast:' + randomUUID(), dueAt = new Date(Date.now() - 1000).toISOString();
    const id = await f.authority.runTransaction(ownerUserId, f.childId, async b => {
      const prepared = await prepareFirestoreBackgroundWork(data, b.transaction, { kind: 'memory-refresh', scope: b.scope,
        resourceId: b.scope.childId, basis, generation: b.generation, authorizationVersion: b.authorizationVersion }, dueAt);
      prepared.commit(); return prepared.id;
    });
    let failure: unknown, executed = false;
    const queue = createFirestoreBackgroundQueue({ ...f.options, enabled: true, readControl: tx => f.authority.readControl(tx),
      transport: { async enqueue() { throw new Error('No external queue'); }, async probe() { throw new Error('No external queue'); } },
      async execute(job) {
        executed = true;
        try { await callback(await runs.claim(ownerUserId, f.childId, { kind: 'worker', reference: firestoreBackgroundReference(job) }, 'memory-refresh')); }
        catch (error) { failure = error; }
        return { state: 'completed' };
      } });
    await queue.process({ kind: 'product-work', id, generation: f.generation, dispatchRevision: 1, scheduledAt: dueAt });
    assert.equal(executed, true, 'The actual synthetic queue must acquire the canonical live lease');
    if (failure) throw failure;
  }
  async function withWorkLease(workId: string, callback: (reference: string) => Promise<void>) {
    const state = await build().readState(ownerUserId, f.childId, workId), identity = summaryPartBackgroundIdentity(state.work);
    const id = firestoreDomainHash(['product-work', identity]);
    const job = await f.authority.runTransaction(ownerUserId, f.childId, async b => data.open('background-work', id, b.scope,
      firestoreBackgroundWorkSchema, await b.transaction.get(data.ref('background_work', 'background-work', id))));
    let failure: unknown, executed = false;
    const queue = createFirestoreBackgroundQueue({ ...f.options, enabled: true, readControl: tx => f.authority.readControl(tx),
      transport: { async enqueue() { throw new Error('No external queue'); }, async probe() { throw new Error('No external queue'); } },
      async execute(current) {
        executed = true;
        try { await callback(firestoreBackgroundReference(current)); } catch (error) { failure = error; }
        return { state: 'completed' };
      } });
    try { await queue.process({ kind: 'product-work', id, generation: job.generation, dispatchRevision: job.dispatchRevision, scheduledAt: job.dueAt }); }
    catch (error) { if (failure) throw failure; throw error; }
    assert.equal(executed, true); if (failure) throw failure;
  }
  async function barrier(change: Partial<z.infer<typeof barrierSchema>> = {}) {
    await f.authority.runTransaction(ownerUserId, f.childId, async b => {
      const id = firestoreDomainHash(['synthetic-barrier', b.scope]), cutover = 'synthetic-before-any-run';
      const inventory = { entries: [], cutover, pages: [0] as [0], cursor: null, scope: b.scope };
      const value = { id, version: 1, scope: b.scope, authorizationVersion: b.authorizationVersion,
        workerGeneration: b.generation, inventoryHash: firestoreDomainHash(inventory), cutover,
        status: 'complete' as const, fence: 'active' as const, ...change };
      b.transaction.set(data.ref('test_summary_barriers', 'test-inventory', id), data.seal('test-inventory', id, b.scope, inventorySchema, inventory));
      b.transaction.set(data.ref('test_summary_barriers', 'test-barrier', id), data.seal('test-barrier', id, b.scope, barrierSchema, value));
    });
  }
  const message = (await f.chat.createUserMessageForUser(ownerUserId, f.childId, sourceText))!;
  return { ...f, data, message, policy, grant, build, barrier, runs, withFastRun, withWorkLease, resolutions: () => resolutions };
}

