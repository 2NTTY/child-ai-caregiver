import test from 'node:test';
import assert from 'node:assert/strict';
import { FinishReason } from '@google/genai';
import { privateSummaryPolicyFixture } from './helpers/private-summary-policy.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirestoreProductAgent } from '../server/firestore-product-agent.ts';
import { createFirebaseWorkerServices } from '../server/firebase-worker-services.ts';
import { privateSummaryCutoverId, privateSummaryCutoverSchema, privateSummaryInventoryGenesis } from '../server/private-summary-scan.ts';
import { prepareFirestoreBackgroundWork, readFirestoreBackgroundClaim, firestoreBackgroundWorkSchema } from '../server/firestore-background-work.ts';
import { readContextBasis } from '../server/firestore-context-basis.ts';
import { readAiConfig } from '../server/ai-config.ts';
import { agentBudgetFingerprint, AGENT_LIMITS } from '../server/agent-budget.ts';
import { agentRequestCharacters } from '../server/agent-model-gateway.ts';
import { loadAgentPrompt } from '../server/agent-prompt.ts';
import { summaryPartBackgroundIdentity, summaryLineageRecordSchema } from '../server/private-summary-work.ts';
import { firestoreDomainHash } from '../server/firestore-domain-data.ts';
import { FirestoreRootBudget } from '../server/firestore-root-budget.ts';
import type { SummaryWorkPolicyPort } from '../server/firestore-private-summary-work.ts';

// A constructor-only synthetic policy exercises the actual production composer and worker.
// It is deliberately not a production policy or a model/transport integration test.
test('production scope zero-dispatch transfers once, actual part workers publish full coverage, and completion wakes without a new grant', async () => {
  const original = '\u0001'.repeat(10000), userId = 'owner';
  const f = await privateSummaryPolicyFixture(original, userId);
  const dueAt = new Date(Date.now() - 1000).toISOString();
  const prompt = await loadAgentPrompt('memory-refresh', 'tool_cycle',
    ['run', 'scope', 'conversation', 'context', 'evidence', 'capabilities', 'outputContract']);
  const config = readAiConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: f.options.projectId });
  let resolutions = 0;
  const fixtureFailures: string[] = [];
  function observe<T>(action: () => T): T {
    try { return action(); } catch (error) { fixtureFailures.push(String(error)); throw error; }
  }
  // Fixed before admission. Every durable part spends this same cumulative allowance.
  f.grant.limits = { modelCalls: 32, toolCalls: 32 };
  f.grant.promptPackVersion = prompt.packVersion;
  f.grant.billingVersion = 'platform:v1';
  let selected: Awaited<ReturnType<Awaited<ReturnType<typeof createFirestoreProductAgent>>['routing']['resolve']>>;
  const policy: SummaryWorkPolicyPort = {
    ...f.policy,
    async resolveInitial() { resolutions++; return { grant: f.grant, dueAt }; },
    async resolveNextPartDueAt() { return { kind: 'due', dueAt }; },
    async resolveWakeDueAt() { return { kind: 'due', dueAt }; },
    async validateRootBinding(b, input) { return observe(() => {
      assert.deepEqual(input.grantRecord.grant, f.grant);
      assert.equal(input.context.binding.ownerId, b.scope.ownerUserId);
      assert.equal(input.context.binding.rootRunId, input.run.id);
      assert.equal(input.context.binding.workflowVersion, 'firestore-product-v1:worker:' + b.generation);
      assert.equal(input.context.binding.settingsVersion, 'firestore:' + selected.settingsVersion + ':' + agentBudgetFingerprint(selected.config));
      assert.equal(input.context.binding.promptPackVersion, f.grant.promptPackVersion);
      assert.equal(input.context.binding.billingVersion, f.grant.billingVersion);
      assert.equal(input.context.binding.limits.modelCalls, 1);
      return { kind: 'matched', grantRecordId: input.grantRecord.id, contextFingerprint: agentBudgetFingerprint(input.context) } as const;
    }); },
    async validateDailyRequest(b, input) {
      const proof = await policy.validateRootBinding!(b, input);
      assert.equal(proof.kind, 'matched');
      if (proof.kind !== 'matched') return proof;
      assert.equal(input.request.userId, userId);
      assert.equal(input.request.rootRunId, input.run.id);
      assert.equal(input.request.userLimit, selected.config.dailyUserAttempts);
      assert.equal(input.request.globalLimit, selected.config.dailyGlobalAttempts);
      return { ...proof, dailyRequestHash: agentBudgetFingerprint(input.request) };
    },
  };
  await f.authority.runTransaction(userId, f.childId, async b => {
    const id = privateSummaryCutoverId(b.scope), value = privateSummaryCutoverSchema.parse({
      format: 'private-summary-cutover/v1', id, scope: b.scope, authorizationVersion: b.authorizationVersion,
      workerGeneration: b.generation, version: 1, inventoryVersion: 1, phase: 'complete', entryFenceVersion: 'private-summary-entry/v1',
      upperCaptured: true, upperRunDocumentId: null, afterRunDocumentId: null, inspectedRuns: 0, unresolvedMappedRuns: 0, unmappedRuns: 0,
      inventoryHash: privateSummaryInventoryGenesis(b.scope, b.authorizationVersion, b.generation, 1), exhausted: true, restoreId: null,
    });
    b.transaction.set(f.data.ref('private_summary_scans', 'private-summary-cutover', id),
      { ...f.data.tags(b.scope), ...f.data.seal('private-summary-cutover', id, b.scope, privateSummaryCutoverSchema, value, 1) });
  });
  const fragments: { text: string; range: { startUtf16: number; endUtf16: number }; accumulator: string | null }[] = [];
  let priorOutput: string | null = null;
  const product = await createFirestoreProductAgent({ ...f.options, chat: f.chat, care: f.care, memory: f.memory,
    online: createFirestoreOnlineStore(f.options), config, summaryWorkPolicy: policy,
    async authorizeWorker(b, reference, recipe) {
      const job = await readFirestoreBackgroundClaim(f.data, b, reference);
      return job?.kind === 'memory-refresh' && recipe === 'memory-refresh';
    },
    platformProvider: { async generate(request) { return observe(() => {
      assert.ok(agentRequestCharacters(request) <= AGENT_LIMITS.inputCharacters);
      const payloads = request.contents.flatMap(content => content.parts ?? []).flatMap(part => {
        if (typeof part.text !== 'string') return [];
        try { const parsed = JSON.parse(part.text); return parsed.purpose === 'private_summary_part/v1' ? [parsed] : []; } catch { return []; }
      });
      assert.equal(payloads.length, 1, 'Actual provider request must contain exactly one fitted part');
      const payload = payloads[0];
      assert.equal(payload.purpose, 'private_summary_part/v1', 'The oversized fast source must never reach a provider');
      assert.equal(payload.fragment.text, original.slice(payload.fragment.range.startUtf16, payload.fragment.range.endUtf16));
      assert.equal(payload.fragment.accumulator, priorOutput);
      fragments.push(payload.fragment);
      priorOutput = `Synthetic cumulative fold ${fragments.length}`;
      assert.ok(priorOutput.length <= payload.outputTextLimit);
      return { content: { role: 'model', parts: [{ functionCall: { id: `synthetic-part-${fragments.length}`,
        name: 'stage_private_summary', args: { text: priorOutput } } }] }, finishReason: FinishReason.STOP,
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } };
    }); } },
  });
  selected = await product.routing.resolve(userId, 'worker');
  f.grant.model = selected.config.model;
  f.grant.settingsVersion = 'firestore:' + selected.settingsVersion;
  const unavailable = async (): Promise<never> => { throw new Error('External transport is forbidden in this synthetic test'); };
  // Only dependencies consumed by the memory-refresh route are supplied. No replacement
  // execute callback: scope, part, and completion all enter createFirebaseWorkerServices.
  const runtime = { database: f.options.database, cipher: f.options.cipher, authority: f.authority, product,
    config: { projectId: f.options.projectId, namespace: f.options.namespace, taskWorkerEnabled: true },
    async currentAuth() { return { disabled: false, emailVerified: true, email: 'owner@example.test' }; },
  } as unknown as Parameters<typeof createFirebaseWorkerServices>[0];
  const worker = createFirebaseWorkerServices(runtime, { taskName() { return 'synthetic-only'; }, enqueue: unavailable, probe: unavailable },
    { enqueue: unavailable, probe: unavailable }, new AbortController());
  async function readJob(id: string) {
    return f.authority.runTransaction(userId, f.childId, async b => f.data.open('background-work', id, b.scope,
      firestoreBackgroundWorkSchema, await b.transaction.get(f.data.ref('background_work', 'background-work', id))));
  }
  async function process(id: string) {
    const job = await readJob(id);
    await worker.background.process({ kind: 'product-work', id, generation: job.generation,
      dispatchRevision: job.dispatchRevision, scheduledAt: job.dueAt });
    assert.equal((await readJob(id)).state, 'completed', `Actual worker job did not complete: ${job.basis}; fixture failures: ${fixtureFailures.join("; ")}`);
  }
  const scopeId = await f.authority.runTransaction(userId, f.childId, async b => {
    const current = await readContextBasis(f.data, b);
    assert.equal(current.value.summaryPending, true);
    const job = await prepareFirestoreBackgroundWork(f.data, b.transaction, { kind: 'memory-refresh', scope: b.scope,
      resourceId: f.childId, basis: String(current.value.summaryRequest), generation: b.generation,
      authorizationVersion: b.authorizationVersion }, dueAt);
    job.commit(); return job.id;
  });
  await process(scopeId);
  assert.equal(fragments.length, 0, 'Actual scope Runner certified zero provider dispatch');
  const lookup = await product.summaryWork.start(userId, f.childId, { kind: 'next_fresh' });
  assert.equal(lookup.kind, 'lookup');
  if (lookup.kind !== 'lookup') throw new Error('The scope worker failed to create the original durable work');
  const initial = await product.summaryWork.readState(userId, f.childId, lookup.work.id);
  assert.equal(initial.work.state, 'ready');
  assert.deepEqual(initial.usage.used, { modelCalls: 0, toolCalls: 0 });
  assert.equal(initial.work.chain.committedParts, 0);
  const lineage = await f.authority.runTransaction(userId, f.childId, async b => f.data.open('private-summary-lineage', initial.work.lineageKey, b.scope,
    summaryLineageRecordSchema, await b.transaction.get(f.data.ref('private_summary_works', 'private-summary-lineage', initial.work.lineageKey))));
  assert.equal(lineage.owner.kind, 'work');
  assert.equal([...f.fake.records.keys()].filter(path => path.includes('_private_summary_works/')).length, 2);
  // Capture the original scope root from actual persisted run records, before any part exists.
  const scopeRuns = await f.authority.runTransaction(userId, f.childId, async b => {
    const rows = await b.transaction.get(f.options.database.collection(f.options.namespace + '_agent_runs'));
    return rows.docs.flatMap(row => {
      const id = row.get('runId');
      return typeof id === 'string' ? [id] : [];
    });
  });
  // Canonical run IDs are also retained in the transfer receipt (not a replacement run).
  const fastRuns = await Promise.all(scopeRuns.map(id => f.authority.runTransaction(userId, f.childId, b => product.runs.read(b, id))));
  const fast = fastRuns.find(run => run.summaryFast);
  assert.ok(fast?.summaryFast?.rootContext, 'Original zero-dispatch root remains readable');
  assert.equal(fast.state, 'stopped'); assert.equal(fast.stopReason, 'input_limit');
  assert.ok(fast.summaryFast.noDispatch);
  assert.equal(fast.summaryFast.transferredToWorkId, initial.work.id);
  const root = new FirestoreRootBudget({ ...f.options, namespace: f.options.namespace + '_root_budget' });
  const originalRoot = await root.read(fast.summaryFast.rootContext);
  assert.equal(originalRoot.status, 'stopped');
  assert.deepEqual(originalRoot.used, { modelCalls: 0, toolCalls: 0, queryEmbeddings: 0 });
  for (let step = 0; step < f.grant.limits.modelCalls; step++) {
    const prior = await product.summaryWork.readState(userId, f.childId, initial.work.id);
    if (prior.work.state === 'completed') break;
    assert.equal((await f.memory.summary(userId, f.childId))!.summary, null, 'Partial folds must not publish a head');
    await process(firestoreDomainHash(['product-work', summaryPartBackgroundIdentity(prior.work)]));
    const next = await product.summaryWork.readState(userId, f.childId, initial.work.id);
    assert.equal(next.work.id, initial.work.id);
    assert.equal(next.work.lineageKey, initial.work.lineageKey);
    assert.equal(next.work.grantRecordId, initial.work.grantRecordId);
    assert.deepEqual(next.grant, initial.grant);
    assert.deepEqual(next.usage.used, { modelCalls: step + 1, toolCalls: step + 1 });
    assert.equal(next.work.chain.committedParts, step + 1);
    assert.deepEqual(await root.read(fast.summaryFast.rootContext), originalRoot, 'Continuation must not reopen/reset the capacity probe root');
  }
  const final = await product.summaryWork.readState(userId, f.childId, initial.work.id);
  assert.equal(final.work.state, 'completed'); assert.equal(final.work.finalReceipt?.kind, 'published');
  assert.ok(fragments.length > 1, 'This must be a genuine multipart execution');
  assert.equal(fragments.map(fragment => fragment.text).join(''), original);
  assert.equal(fragments[0].range.startUtf16, 0);
  for (let index = 1; index < fragments.length; index++) assert.equal(fragments[index].range.startUtf16, fragments[index - 1].range.endUtf16);
  assert.equal(fragments.at(-1)!.range.endUtf16, original.length);
  const summary = (await f.memory.summary(userId, f.childId))!.summary!;
  assert.ok(summary); assert.equal(summary.version, 1); assert.equal(summary.text, priorOutput);
  assert.deepEqual(summary.coveredMessageIds, [f.message.id]); assert.equal(summary.lastCoveredMessageId, f.message.id);
  assert.deepEqual(summary.sourcePeriod, { from: f.message.createdAt, to: f.message.createdAt });
  assert.equal(await f.memory.prepareMaintenance(userId, f.childId), null);
  assert.equal(resolutions, 1);
  const wake = final.work.completionWake;
  assert.equal(wake?.scheduling.kind, 'queued');
  if (wake?.scheduling.kind !== 'queued') throw new Error('Expected canonical completion wake');
  const beforeWake = await f.authority.runTransaction(userId, f.childId, b => readContextBasis(f.data, b));
  await process(wake.scheduling.jobId);
  const afterWake = await f.authority.runTransaction(userId, f.childId, b => readContextBasis(f.data, b));
  assert.equal(afterWake.value.summaryRequest, beforeWake.value.summaryRequest! + 1);
  assert.equal(afterWake.value.summaryPending, true, 'Completion routes a scope hint, not fake coverage acknowledgement');
  assert.equal(resolutions, 1, 'Completion hint may not resolve a fresh grant');
  assert.deepEqual(await product.summaryWork.readState(userId, f.childId, initial.work.id), final);
  assert.deepEqual((await f.memory.summary(userId, f.childId))!.summary, summary);
});
