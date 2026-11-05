import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { FinishReason } from '@google/genai';
import { privateSummaryPolicyFixture } from './helpers/private-summary-policy.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirestoreProductAgent } from '../server/firestore-product-agent.ts';
import { privateSummaryCutoverId, privateSummaryCutoverSchema, privateSummaryInventoryGenesis } from '../server/private-summary-scan.ts';
import { createFirestoreBackgroundQueue, prepareFirestoreBackgroundWork, firestoreBackgroundReference, readFirestoreBackgroundClaim, firestoreBackgroundWorkSchema } from '../server/firestore-background-work.ts';
import { readContextBasis } from '../server/firestore-context-basis.ts';
import { readAiConfig } from '../server/ai-config.ts';
import { createFirebaseWorkerServices } from '../server/firebase-worker-services.ts';

async function fixture(phase: 'complete' | 'restore_suspended' | 'dormant', sourceText = 'First short source', expectedFastLineages = 2) {
  const f = await privateSummaryPolicyFixture(sourceText);
  await f.chat.createUserMessageForUser('owner', f.childId, 'Second short source');
  if (phase !== 'dormant') await f.authority.runTransaction('owner', f.childId, async b => {
    const id = privateSummaryCutoverId(b.scope), value = privateSummaryCutoverSchema.parse({
      format: 'private-summary-cutover/v1', id, scope: b.scope, authorizationVersion: b.authorizationVersion,
      workerGeneration: b.generation, version: 1, inventoryVersion: 1, phase, entryFenceVersion: 'private-summary-entry/v1',
      upperCaptured: phase === 'complete', upperRunDocumentId: null, afterRunDocumentId: null,
      inspectedRuns: 0, unresolvedMappedRuns: 0, unmappedRuns: 0,
      inventoryHash: privateSummaryInventoryGenesis(b.scope, b.authorizationVersion, b.generation, 1),
      exhausted: phase === 'complete', restoreId: phase === 'restore_suspended' ? randomUUID() : null,
    });
    b.transaction.set(f.data.ref('private_summary_scans', 'private-summary-cutover', id),
      { ...f.data.tags(b.scope), ...f.data.seal('private-summary-cutover', id, b.scope, privateSummaryCutoverSchema, value, 1) });
  });
  let calls = 0;
  const product = await createFirestoreProductAgent({ ...f.options, chat: f.chat, care: f.care, memory: f.memory,
    online: createFirestoreOnlineStore(f.options), config: readAiConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: f.options.projectId }),
    summaryWorkPolicy: phase === 'dormant' ? undefined : f.policy,
    async authorizeWorker(b, reference, recipe) {
      const job = await readFirestoreBackgroundClaim(f.data, b, reference);
      return job?.kind === 'memory-refresh' && recipe === 'memory-refresh';
    },
    platformProvider: { async generate(request) {
      calls++;
      if (phase === 'complete') assert.equal([...f.fake.records.keys()].filter(path => path.includes('_private_summary_works/')).length, expectedFastLineages,
        'Every whole message is lineaged before the actual provider call');
      const payloads = request.contents.flatMap(content => content.parts ?? []).flatMap(part => {
        if (typeof part.text !== 'string') return [];
        try { const value = JSON.parse(part.text); return Array.isArray(value.sourceMessages) ? [value] : []; } catch { return []; }
      });
      assert.equal(payloads.length, 1); assert.equal(payloads[0].sourceMessages[0].text, sourceText, 'Fast never slices the supplied original message');
      return { content: { role: 'model', parts: [{ functionCall: { id: 'stage', name: 'stage_private_summary', args: { text: 'One complete short batch' } } }] },
        finishReason: FinishReason.STOP, usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } };
    } } });
  async function execute() {
    const dueAt = new Date(Date.now() - 1000).toISOString();
    const id = await f.authority.runTransaction('owner', f.childId, async b => {
      const current = await readContextBasis(f.data, b), job = await prepareFirestoreBackgroundWork(f.data, b.transaction,
        { kind: 'memory-refresh', scope: b.scope, resourceId: f.childId, basis: String(current.value.summaryRequest),
          generation: b.generation, authorizationVersion: b.authorizationVersion }, dueAt);
      job.commit(); return job.id;
    });
    let result: Awaited<ReturnType<typeof product.maintainSummary>> | undefined, failure: unknown;
    const queue = createFirestoreBackgroundQueue({ ...f.options, enabled: true, readControl: tx => f.authority.readControl(tx),
      transport: { async enqueue() { throw new Error('No external queue'); }, async probe() { throw new Error('No external queue'); } },
      async execute(job, signal) {
        try { result = await product.maintainSummary({ userId: 'owner', childId: f.childId,
          reference: firestoreBackgroundReference(job), authorize: async () => true, signal }); }
        catch (error) { failure = error; throw error; }
        return { state: result.state };
      } });
    await queue.process({ kind: 'product-work', id, generation: f.generation, dispatchRevision: 1, scheduledAt: dueAt });
    if (failure) throw failure; return result;
  }
  const unavailable = async (): Promise<never> => { throw new Error('No external transport'); };
  const runtime = { database: f.options.database, cipher: f.options.cipher, authority: f.authority, product,
    config: { projectId: f.options.projectId, namespace: f.options.namespace, taskWorkerEnabled: true },
    knowledgeRefresh: { async jobs() { return []; } },
    async currentAuth() { return { disabled: false, emailVerified: true, email: 'owner@example.test' }; },
  } as unknown as Parameters<typeof createFirebaseWorkerServices>[0];
  const worker = createFirebaseWorkerServices(runtime, { taskName() { return 'synthetic-only'; }, enqueue: unavailable, probe: unavailable },
    { enqueue: unavailable, probe: unavailable }, new AbortController());
  async function executeActual() {
    const dueAt = new Date(Date.now() - 1000).toISOString();
    const id = await f.authority.runTransaction('owner', f.childId, async b => {
      const current = await readContextBasis(f.data, b), job = await prepareFirestoreBackgroundWork(f.data, b.transaction,
        { kind: 'memory-refresh', scope: b.scope, resourceId: f.childId, basis: String(current.value.summaryRequest),
          generation: b.generation, authorizationVersion: b.authorizationVersion }, dueAt);
      job.commit(); return job.id;
    });
    await worker.background.process({ kind: 'product-work', id, generation: f.generation, dispatchRevision: 1, scheduledAt: dueAt });
    return f.authority.runTransaction('owner', f.childId, async b => f.data.open('background-work', id, b.scope,
      firestoreBackgroundWorkSchema, await b.transaction.get(f.data.ref('background_work', 'background-work', id))));
  }
  return { ...f, product, execute, executeActual, worker, calls: () => calls };
}

for (const phase of ['dormant', 'complete'] as const)
test(`the production ${phase} path keeps multiple short messages in one complete fast call`, async () => {
  const f = await fixture(phase), result = await f.execute();
  assert.equal(result?.state, 'completed', JSON.stringify(result));
  assert.equal(f.calls(), 1);
  assert.equal((await f.memory.prepareMaintenance('owner', f.childId)), null);
});

test('a restored scope is stopped by the production entry before a run or provider can be created', async () => {
  const f = await fixture('restore_suspended');
  const result = await f.product.maintainSummary({ userId: 'owner', childId: f.childId, reference: randomUUID(), authorize: async () => true });
  assert.equal(result.state, 'stopped'); assert.equal(f.calls(), 0);
  assert.equal([...f.fake.records.keys()].some(path => path.includes('_agent_runs/')), false);
});

test('the actual fixed-candidate Runner transfers an unfit first message only after stopping its original zero-admission root', async () => {
  const f = await fixture('complete', '\u0001'.repeat(10000));
  const result = await f.execute();
  assert.equal(result?.state, 'completed'); assert.equal(result?.more, true); assert.equal(f.calls(), 0);
  const source = await f.authority.runTransaction('owner', f.childId, b => f.memory.selectSource(b, { kind: 'next_fresh' }));
  assert.equal(source.kind, 'eligible');
  const workRows = [...f.fake.records.keys()].filter(path => path.includes('_private_summary_works/'));
  assert.equal(workRows.length, 2, 'One original lineage and exactly one durable work exist after zero-dispatch transition');
  const work = await f.product.summaryWork.start('owner', f.childId, { kind: 'next_fresh' });
  assert.equal(work.kind, 'lookup');
  if (work.kind !== 'lookup') throw new Error('Expected original work');
  assert.equal(work.work.state, 'ready'); assert.equal(work.work.chain.committedParts, 0);
});

test('a 7000-emoji source that fits stays one whole-message fast prefix instead of forcing a slow call', async () => {
  const f = await fixture('complete', '😀'.repeat(7000), 1), result = await f.execute();
  assert.equal(result?.state, 'completed'); assert.equal(result?.more, true); assert.equal(f.calls(), 1);
  const next = await f.memory.prepareMaintenance('owner', f.childId);
  assert.equal(next?.messages.length, 1); assert.equal(next?.messages[0].text, 'Second short source');
});

test('a capacity certificate with a late commit acknowledgement is not overwritten by ordinary finish', async () => {
  const f = await fixture('complete', '\u0001'.repeat(10000));
  const original = f.product.summaryWork.commitFastNoDispatch;
  let release!: () => void, settle!: (value: Awaited<ReturnType<typeof original>>) => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const settled = new Promise<Awaited<ReturnType<typeof original>>>(resolve => { settle = resolve; });
  let originalRunId = '';
  f.product.summaryWork.commitFastNoDispatch = async (...args) => {
    if (args[3] !== 'commit') return original(...args);
    originalRunId = args[2]; await gate;
    const value = await original(...args); settle(value); return value;
  };
  let result: Awaited<ReturnType<typeof f.execute>>, before: string | undefined;
  try {
    result = await f.execute(); assert.ok(originalRunId);
    before = (await f.authority.runTransaction('owner', f.childId, b => f.product.runs.read(b, originalRunId))).state;
  } finally { release(); }
  const late = await settled;
  assert.equal(result?.state, 'unknown', JSON.stringify({ result, before, late }));
  assert.equal(before, 'running', 'An unconfirmed settlement retains its original execution identity');
  assert.equal(late.kind, 'verified'); assert.equal(f.calls(), 0);
  assert.ok((await f.authority.runTransaction('owner', f.childId, b => f.product.runs.read(b, originalRunId))).summaryFast?.noDispatch);
});

test('a failed original root binding stops the actual runtime before root open or provider admission', async () => {
  const f = await fixture('complete');
  f.product.summaryWork.bindFastRoot = async () => { throw new Error('Synthetic binding persistence failed'); };
  const result = await f.execute(); assert.equal(result?.state, 'unknown'); assert.equal(f.calls(), 0);
  assert.equal([...f.fake.records.keys()].some(path => path.startsWith(f.options.namespace + '_root_budget/')), false);
});

test('the actual unknown scope job is unblocked only after its late capacity certificate, then transfers the original lineage once', async t => {
  const f = await fixture('complete', '\u0001'.repeat(10000)), original = f.product.summaryWork.commitFastNoDispatch;
  let release!: () => void, settle!: (value: Awaited<ReturnType<typeof original>>) => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const settled = new Promise<Awaited<ReturnType<typeof original>>>(resolve => { settle = resolve; });
  let runId = '';
  f.product.summaryWork.commitFastNoDispatch = async (...args) => {
    if (args[3] !== 'commit') return original(...args);
    runId = args[2]; await gate; const value = await original(...args); settle(value); return value;
  };
  try {
    const job = await f.executeActual(); assert.equal(job.state, 'unknown');
    const before = await f.authority.runTransaction('owner', f.childId, b => readContextBasis(f.data, b));
    assert.equal(before.value.summaryBlocked, true); assert.ok(before.value.summaryBlockedReference);
  } finally { release(); }
  assert.equal((await settled).kind, 'verified'); assert.equal(f.calls(), 0);
  const originalRun = await f.authority.runTransaction('owner', f.childId, b => f.product.runs.read(b, runId));
  assert.ok(originalRun.summaryFast?.noDispatch);
  // The serial domain fixture exposes reads through transactions. Supply the equivalent
  // direct query read used by the real maintenance scheduler, without replacing its routing.
  function gettable<T extends object>(query: T): T {
    return new Proxy(query, { get(target, name, receiver) {
      if (name === 'get') return () => f.options.database.runTransaction(tx => tx.get(target as never));
      const value = Reflect.get(target, name, receiver);
      if (typeof value === 'function' && ['where', 'orderBy', 'limit', 'startAfter'].includes(String(name)))
        return (...args: unknown[]) => gettable(value.apply(target, args));
      return value;
    } });
  }
  const collection = f.options.database.collection.bind(f.options.database);
  f.options.database.collection = path => gettable(collection(path));
  t.mock.timers.enable({ apis: ['Date'], now: new Date(Date.now() + 301000) });
  await f.worker.maintenance.tick();
  const after = await f.authority.runTransaction('owner', f.childId, b => readContextBasis(f.data, b));
  assert.equal(after.value.summaryBlocked, false, 'A verified persisted capacity outcome wakes only the same scope scan');
  assert.equal((await f.executeActual()).state, 'completed'); assert.equal(f.calls(), 0);
  const result = await f.product.summaryWork.start('owner', f.childId, { kind: 'next_fresh' });
  assert.equal(result.kind, 'lookup');
  if (result.kind !== 'lookup') throw new Error('Expected the original transferred work');
  assert.equal(result.work.lineageKey, originalRun.summaryFast!.lineageKey);
  assert.equal((await f.authority.runTransaction('owner', f.childId, b => f.product.runs.read(b, runId))).summaryFast!.transferredToWorkId, result.work.id);
  assert.equal([...f.fake.records.keys()].filter(path => path.includes('_private_summary_works/')).length, 2);
});
