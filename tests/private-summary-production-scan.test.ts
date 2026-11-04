import test from 'node:test';
import assert from 'node:assert/strict';
import { FinishReason } from '@google/genai';
import { privateSummaryPolicyFixture } from './helpers/private-summary-policy.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirestoreProductAgent } from '../server/firestore-product-agent.ts';
import { createFirebaseWorkerServices } from '../server/firebase-worker-services.ts';
import { privateSummaryCutoverId, privateSummaryCutoverSchema, privateSummaryInventoryGenesis,
  privateSummaryScanId, privateSummaryScanSchema, privateSummarySuppressedSourceId, privateSummarySuppressedSourceSchema } from '../server/private-summary-scan.ts';
import { prepareFirestoreBackgroundWork, readFirestoreBackgroundClaim, firestoreBackgroundWorkSchema } from '../server/firestore-background-work.ts';
import { readContextBasis } from '../server/firestore-context-basis.ts';
import { summaryLineageKeyForTarget, summaryLineageRecordSchema } from '../server/private-summary-work.ts';
import { FirestoreRootBudget } from '../server/firestore-root-budget.ts';
import { readAiConfig } from '../server/ai-config.ts';

// These tests exercise the real composer, authenticated worker routing, canonical scope
// lease, and encrypted saves. Only the provider and admission policy are synthetic.
async function fixture() {
  const f = await privateSummaryPolicyFixture('Oldest synthetic source');
  await f.authority.runTransaction('owner', f.childId, async b => {
    const id = privateSummaryCutoverId(b.scope), value = privateSummaryCutoverSchema.parse({
      format: 'private-summary-cutover/v1', id, scope: b.scope, authorizationVersion: b.authorizationVersion,
      workerGeneration: b.generation, version: 1, inventoryVersion: 1, phase: 'complete', entryFenceVersion: 'private-summary-entry/v1',
      upperCaptured: true, upperRunDocumentId: null, afterRunDocumentId: null, inspectedRuns: 0, unresolvedMappedRuns: 0, unmappedRuns: 0,
      inventoryHash: privateSummaryInventoryGenesis(b.scope, b.authorizationVersion, b.generation, 1), exhausted: true, restoreId: null,
    });
    b.transaction.set(f.data.ref('private_summary_scans', 'private-summary-cutover', id),
      { ...f.data.tags(b.scope), ...f.data.seal('private-summary-cutover', id, b.scope, privateSummaryCutoverSchema, value, 1) });
  });
  const calls: unknown[] = [];
  let failProvider = false;
  let removePointer: string | null = null;
  const product = await createFirestoreProductAgent({ ...f.options, chat: f.chat, care: f.care, memory: f.memory,
    online: createFirestoreOnlineStore(f.options), config: readAiConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: f.options.projectId }),
    summaryWorkPolicy: f.policy,
    async authorizeWorker(b, reference, recipe) {
      const job = await readFirestoreBackgroundClaim(f.data, b, reference);
      return job?.kind === 'memory-refresh' && recipe === 'memory-refresh';
    },
    platformProvider: { async generate(request) {
      calls.push(request.contents);
      if (removePointer) f.fake.records.delete(removePointer);
      if (failProvider) throw new Error('Synthetic provider outcome is unknown');
      return { content: { role: 'model', parts: [{ functionCall: { id: 'stage', name: 'stage_private_summary',
        args: { text: `Synthetic completed route batch ${calls.length}` } } }] }, finishReason: FinishReason.STOP,
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } };
    } } });
  const unavailable = async (): Promise<never> => { throw new Error('No external transport in synthetic acceptance'); };
  const runtime = { database: f.options.database, cipher: f.options.cipher, authority: f.authority, product,
    config: { projectId: f.options.projectId, namespace: f.options.namespace, taskWorkerEnabled: true },
    async currentAuth() { return { disabled: false, emailVerified: true, email: 'owner@example.test' }; },
  } as unknown as Parameters<typeof createFirebaseWorkerServices>[0];
  const worker = createFirebaseWorkerServices(runtime, { taskName() { return 'synthetic-only'; }, enqueue: unavailable, probe: unavailable },
    { enqueue: unavailable, probe: unavailable }, new AbortController());
  let lastDelivery: { kind: 'product-work'; id: string; generation: string; dispatchRevision: number; scheduledAt: string } | null = null;
  const context = () => f.authority.runTransaction('owner', f.childId, async b => (await readContextBasis(f.data, b)).value);
  const scan = () => f.authority.runTransaction('owner', f.childId, async b => {
    const id = privateSummaryScanId(b.scope), row = await b.transaction.get(f.data.ref('private_summary_scans', 'private-summary-scan', id));
    return row.exists ? f.data.open('private-summary-scan', id, b.scope, privateSummaryScanSchema, row) : null;
  });
  async function execute() {
    const dueAt = new Date(Date.now() - 1000).toISOString();
    const id = await f.authority.runTransaction('owner', f.childId, async b => {
      const current = await readContextBasis(f.data, b);
      assert.equal(current.value.summaryPending, true, 'Do not fabricate a new request after premature clear');
      const job = await prepareFirestoreBackgroundWork(f.data, b.transaction, { kind: 'memory-refresh', scope: b.scope,
        resourceId: f.childId, basis: String(current.value.summaryRequest), generation: b.generation,
        authorizationVersion: b.authorizationVersion }, dueAt);
      job.commit(); return job.id;
    });
    const before = calls.length;
    lastDelivery = { kind: 'product-work', id, generation: f.generation, dispatchRevision: 1, scheduledAt: dueAt };
    await worker.background.process(lastDelivery);
    assert.ok(calls.length - before <= 1, 'A scope job selects at most one summary or part');
    return f.authority.runTransaction('owner', f.childId, async b => f.data.open('background-work', id, b.scope,
      firestoreBackgroundWorkSchema, await b.transaction.get(f.data.ref('background_work', 'background-work', id))));
  }
  const values = { key: 'Synthetic preference', content: 'Original synthetic preference',
    source: { kind: 'manual' as const, description: 'Synthetic fixture only' }, validUntil: null };
  async function fact(key: string) {
    const created = await f.memory.createFact('owner', f.childId, { values: { ...values, key }, intendedVisibility: 'private' });
    assert.ok(created);
    const confirmed = await f.memory.confirmFact('owner', f.childId, created.id, { expectedVersion: 1, confirm: true, confirmShared: false });
    assert.ok(confirmed); return confirmed;
  }
  const seededBatches: { id: string; version: number; path: string; record: unknown }[] = [];
  async function batches(blockNewer = false) {
    const oldFact = await fact('Oldest repair dependency');
    const oldest = await f.saveAll('Original oldest batch');
    await f.memory.reviseFact('owner', f.childId, oldFact.id, { expectedVersion: 2, confirm: true, confirmShared: false,
      values: { ...values, key: oldFact.key, content: 'Corrected synthetic preference' }, reason: 'Synthetic correction' });
    const blocker = blockNewer ? await fact('Newer removable dependency') : null;
    for (let i = 0; i < 6; i++) {
      await f.chat.createUserMessageForUser('owner', f.childId, `Newer source ${i}`);
      const saved = await f.saveAll(`Newer valid batch ${i}`);
      const path = f.data.ref('conversation_summaries', 'conversation-summary', saved.id).path;
      seededBatches.push({ id: saved.id, version: saved.version, path, record: structuredClone(f.fake.records.get(path)) });
    }
    if (blocker) await f.memory.delete('owner', f.childId, 'facts', blocker.id, 2);
    assert.equal([...f.fake.records].filter(([path, row]) => path.includes('_conversation_summaries/') && row.currentBatch).length, 7);
    return oldest;
  }
  const current = (id: string) => f.fake.records.get(f.data.ref('conversation_summaries', 'conversation-summary', id).path)?.currentBatch === true;
  return { ...f, product, calls, context, scan, execute, batches, seededBatches, current, redeliver: () => { assert.ok(lastDelivery); return worker.background.process(lastDelivery); }, failProvider: (value = true) => { failProvider = value; }, losePointer: (path: string) => { removePointer = path; } };
}

for (const blocked of [false, true]) test(`production persistent scan reaches old repair behind six ${blocked ? 'blocked' : 'valid'} batches despite new chat`, async () => {
  const f = await fixture(), oldest = await f.batches(blocked);
  for (let step = 0; step < 8 && f.current(oldest.id); step++) {
    await f.chat.createUserMessageForUser('owner', f.childId, `Continuous fresh arrival ${step}`);
    const before = f.calls.length;
    assert.equal((await f.execute()).state, 'completed');
    const scan = await f.scan();
    assert.ok(scan, 'Actual production routing must persist a scan, not repeatedly inspect the newest four');
    if (f.current(oldest.id)) assert.equal((await f.context()).summaryPending, true, 'An unresolved old repair cannot clear pending');
    if (f.calls.length > before) {
      const wasRepair = JSON.stringify(f.calls.at(-1)).includes('Oldest synthetic source');
      assert.equal(scan.prefer, wasRepair ? 'fresh' : 'repair', 'Only the actual committed lane changes preference');
    }
  }
  assert.equal(f.current(oldest.id), false, 'Oldest repair must be replaced within bounded persisted pages even with continuous fresh arrivals');
  assert.ok(f.calls.some(value => JSON.stringify(value).includes('Corrected synthetic preference')));
  if (blocked) {
    // An authoritative suppression observation resolves this scan candidate, not
    // its historical coverage. Drain any fresh message left by choosing repair.
    const grants = f.resolutions();
    const headPath = [...f.fake.records.keys()].find(path => path.includes('_conversation_summary_heads/'))!;
    for (let step = 0; step < 10 && (await f.context()).summaryPending; step++) {
      const before = f.calls.length, preference = (await f.scan())!.prefer;
      const head = structuredClone(f.fake.records.get(headPath));
      await f.execute();
      const scan = (await f.scan())!;
      if (scan.cycle.state !== 'complete') assert.equal((await f.context()).summaryPending, true, 'Incomplete pages cannot clear pending');
      if (f.calls.length === before) {
        assert.equal(scan.prefer, preference, 'Suppression is not committed summary progress');
        assert.deepEqual(f.fake.records.get(headPath), head, 'Suppression cannot advance the head, watermark or coverage');
      }
    }
    const scan = (await f.scan())!;
    assert.equal(scan.cycle.state, 'complete'); assert.equal(scan.cycle.hasUnresolvedRepair, false);
    assert.equal((await f.context()).summaryPending, false, 'A full authoritative suppression pass may settle pending');
    await f.authority.runTransaction('owner', f.childId, async b => {
      const head = await f.memory.readSummaryScanHead(b);
      assert.equal(head.freshCaughtUp, true); assert.equal(head.basis, scan.cycle.sourceBasis);
      for (const saved of f.seededBatches) {
        const target = { kind: 'repair_batch' as const, summaryId: saved.id };
        const source = await f.memory.readFastSource(b, target);
        assert.equal(source.kind, 'suppressed', 'The actual source is re-read, never inferred from a marker');
        if (source.kind !== 'suppressed') throw new Error('Expected suppressed source');
        const id = privateSummarySuppressedSourceId(b.scope, target);
        const marker = f.data.open('private-summary-suppressed-source', id, b.scope, privateSummarySuppressedSourceSchema,
          await b.transaction.get(f.data.ref('private_summary_scans', 'private-summary-suppressed-source', id)));
        assert.deepEqual(marker.target, target); assert.equal(marker.sourceVersion, saved.version);
        assert.equal(marker.sourceBasis, head.basis); assert.equal(marker.sourceBasis, source.observation?.sourceBasis);
        assert.equal(marker.reason, source.reason); assert.equal(marker.reason, 'dependency_suppressed');
        assert.deepEqual(marker.scope, b.scope); assert.equal(marker.authorizationVersion, b.authorizationVersion);
        assert.equal(marker.workerGeneration, b.generation);
        assert.deepEqual(f.fake.records.get(saved.path), saved.record, 'Suppression does not rewrite existing batch coverage');
        assert.equal(f.current(saved.id), true);
      }
    });
    assert.equal(f.resolutions(), grants);
    assert.ok(f.calls.every(call => !JSON.stringify(call).includes('Newer source')), 'Erased-source batch text never regenerates');
    const initial = await f.memory.initialConversationSummary('owner', f.childId);
    assert.ok(!initial?.summary.text.includes('Newer valid batch'), 'Invalidated historical batches remain hidden');
    const calls = f.calls.length;
    await f.redeliver();
    assert.equal(f.calls.length, calls); assert.equal((await f.context()).summaryPending, false);
  }
});

test('production scan does not clear an incomplete pass and finally clears the exact request after all sources validate', async () => {
  const f = await fixture(), oldest = await f.batches();
  const before = await f.context();
  assert.equal((await f.execute()).state, 'completed');
  assert.equal(f.calls.length, 0, 'Newest four valid batches do not dispatch a model');
  assert.equal((await f.context()).summaryPending, true, 'First page is not a proof of full coverage');
  assert.equal((await f.scan())?.cycle.state, 'scanning');
  let lastRequest = (await f.context()).summaryRequest;
  for (let step = 0; step < 10 && (await f.context()).summaryPending; step++) {
    lastRequest = (await f.context()).summaryRequest;
    await f.execute();
  }
  assert.equal(f.current(oldest.id), false);
  const final = await f.context(), scan = await f.scan();
  assert.equal(final.summaryPending, false);
  assert.ok(final.summaryRequest! >= before.summaryRequest!);
  assert.equal(final.summaryRequest, lastRequest, 'Clear settles precisely the request that was scanned');
  assert.equal(scan?.cycle.state, 'complete');
  assert.equal(scan?.cycle.hasUnresolvedRepair, false);
  assert.equal(f.calls.length, 1, 'Only the invalid old batch needs a provider');
  const count = f.calls.length;
  // A redelivery of the already-completed canonical job cannot dispatch or increment the settled request.
  await f.redeliver();
  const after = await f.context();
  assert.equal(after.summaryRequest, final.summaryRequest); assert.equal(after.summaryPending, false);
  assert.equal(f.calls.length, count);
});

test('production selection without a saved summary never flips lane and unknown outcome keeps pending', async () => {
  const f = await fixture();
  f.failProvider();
  await f.execute();
  assert.equal(f.calls.length, 1);
  assert.equal((await f.scan())?.prefer, 'fresh', 'Selection alone is not committed progress');
  const context = await f.context();
  assert.equal(context.summaryPending, true); assert.equal(context.summaryBlocked, false, 'Complete selected mapping transfers only the scope fence');
  assert.equal((await f.memory.summary('owner', f.childId))!.summary, null);
});


test('production unknown fresh lineage stays fenced while another repair makes progress without a new grant', async () => {
  const f = await fixture(), oldest = await f.batches();
  const fresh = await f.chat.createUserMessageForUser('owner', f.childId, 'Fresh unknown source must never be dispatched twice');
  assert.ok(fresh);
  const secondFresh = await f.chat.createUserMessageForUser('owner', f.childId, 'Second unknown prefix source also remains fenced');
  assert.ok(secondFresh);
  f.failProvider();
  assert.equal((await f.execute()).state, 'completed', 'Mapped unknown execution yields a scope hint, not coverage');
  assert.equal(f.calls.length, 1);
  assert.ok(JSON.stringify(f.calls[0]).includes(fresh.text));
  const runIds = [...f.fake.records].filter(([path]) => path.includes('_agent_runs/'))
    .map(([, row]) => row.runId).filter((id): id is string => typeof id === 'string');
  const originals = await Promise.all(runIds.map(id => f.authority.runTransaction('owner', f.childId, b => f.product.runs.read(b, id))));
  const original = originals.find(run => run.summaryFast);
  assert.ok(original?.summaryFast, 'The failed actual provider retains its original fast identity');
  assert.ok(original.summaryFast.rootContext); assert.ok(original.summaryFast.selected);
  assert.deepEqual(original.summaryFast.selected.coveredMessageIds, [fresh.id, secondFresh.id]);
  const pointerSnapshots = await f.authority.runTransaction('owner', f.childId, async b => {
    return Promise.all(original.summaryFast!.selected!.coveredMessageIds.map(async messageId => {
      const id = summaryLineageKeyForTarget(b.scope, { kind: 'fresh_message', messageId });
      const ref = f.data.ref('private_summary_works', 'private-summary-lineage', id);
      const pointer = f.data.open('private-summary-lineage', id, b.scope, summaryLineageRecordSchema, await b.transaction.get(ref));
      assert.equal(pointer.owner.kind, 'legacy_fast');
      if (pointer.owner.kind !== 'legacy_fast') throw new Error('Expected original fast fence');
      assert.equal(pointer.owner.runId, original.id); assert.equal(pointer.owner.accounting.state, 'unresolved');
      assert.deepEqual(pointer.owner.coveredMessageIds, original.summaryFast!.selected!.coveredMessageIds);
      return { path: ref.path, record: structuredClone(f.fake.records.get(ref.path)) };
    }));
  });
  const root = new FirestoreRootBudget({ ...f.options, namespace: f.options.namespace + '_root_budget' });
  const originalRoot = await root.read(original.summaryFast.rootContext);
  const grants = f.resolutions();
  f.failProvider(false);
  for (let step = 0; step < 8 && f.current(oldest.id); step++) {
    await f.execute();
    assert.equal((await f.context()).summaryPending, true, 'Unknown original source is not full coverage');
  }
  assert.equal(f.current(oldest.id), false, 'Unknown fresh source must not become a global barrier for unrelated repair');
  assert.equal(f.calls.filter(call => JSON.stringify(call).includes(fresh.text)).length, 1,
    'Original unknown source cannot acquire another provider call through the scanner');
  assert.equal(f.calls.filter(call => JSON.stringify(call).includes(secondFresh.text)).length, 1, 'Every selected prefix source retains the same fence');
  assert.equal(f.calls.length, 2, 'Only the original unknown fast call and independent repair may dispatch');
  assert.equal(f.resolutions(), grants, 'Recovery cannot resolve a new grant for the unknown source');
  const retained = await f.authority.runTransaction('owner', f.childId, b => f.product.runs.read(b, original.id));
  assert.equal(retained.id, original.id);
  assert.deepEqual(retained, original, 'Other repair cannot rewrite the unknown run or original result');
  assert.deepEqual(await root.read(original.summaryFast.rootContext), originalRoot, 'Other repair cannot reopen or reset the original root or usage');
  for (const pointer of pointerSnapshots) assert.deepEqual(f.fake.records.get(pointer.path), pointer.record, 'Every original selected lineage stays fenced');
});


test('production unknown prefix missing its second lineage mapping retains the global fence', async () => {
  const f = await fixture();
  const second = await f.chat.createUserMessageForUser('owner', f.childId, 'Second selected message with missing mapping');
  assert.ok(second);
  const path = await f.authority.runTransaction('owner', f.childId, async b =>
    f.data.ref('private_summary_works', 'private-summary-lineage', summaryLineageKeyForTarget(b.scope,
      { kind: 'fresh_message', messageId: second.id })).path);
  f.losePointer(path); f.failProvider();
  const job = await f.execute();
  const context = await f.context();
  const runIds = [...f.fake.records].filter(([path]) => path.includes('_agent_runs/'))
    .map(([, row]) => row.runId).filter((id): id is string => typeof id === 'string');
  const runs = await Promise.all(runIds.map(id => f.authority.runTransaction('owner', f.childId, b => f.product.runs.read(b, id))));
  assert.equal(job.state, 'unknown', 'Incomplete mapping may not acknowledge a scope hint: ' + JSON.stringify({
    job, context, runs: runs.map(run => ({ id: run.id, state: run.state, stopReason: run.stopReason,
      result: run.result, selected: run.summaryFast?.selected, root: !!run.summaryFast?.rootContext })) }));
  assert.equal(context.summaryPending, true); assert.equal(context.summaryBlocked, true);
  assert.equal(f.calls.length, 1); assert.ok(JSON.stringify(f.calls[0]).includes(second.text));
  assert.equal((await f.scan())?.prefer, 'fresh');
  await f.redeliver();
  assert.equal(f.calls.length, 1); assert.equal(f.resolutions(), 0);
  assert.equal((await f.context()).summaryBlocked, true);
});

// The mapping was complete when maintenance classified the provider outcome. Lose
// only the second pointer after that check, before the actual worker settlement TX.
test('production final scope settlement rechecks the full unknown prefix mapping atomically', async () => {
  const f = await fixture();
  const second = await f.chat.createUserMessageForUser('owner', f.childId, 'Second mapping disappears after maintenance returns');
  assert.ok(second);
  const path = await f.authority.runTransaction('owner', f.childId, async b =>
    f.data.ref('private_summary_works', 'private-summary-lineage', summaryLineageKeyForTarget(b.scope,
      { kind: 'fresh_message', messageId: second.id })).path);
  const maintain = f.product.maintainSummary;
  const root = new FirestoreRootBudget({ ...f.options, namespace: f.options.namespace + '_root_budget' });
  let original: Awaited<ReturnType<typeof f.product.runs.read>> | undefined;
  let originalRoot: Awaited<ReturnType<typeof root.read>> | undefined;
  let crossedBoundary = false;
  f.product.maintainSummary = async input => {
    const result = await maintain(input);
    assert.equal(result.state, 'completed', 'A complete selected mapping reaches the scope handoff');
    assert.equal(result.more, true);
    const runIds = [...f.fake.records].filter(([key]) => key.includes('_agent_runs/'))
      .map(([, row]) => row.runId).filter((id): id is string => typeof id === 'string');
    const runs = await Promise.all(runIds.map(id => f.authority.runTransaction('owner', f.childId, b => f.product.runs.read(b, id))));
    original = runs.find(run => run.summaryFast);
    assert.ok(original?.summaryFast?.rootContext);
    assert.deepEqual(original.summaryFast.selected?.coveredMessageIds, [f.message.id, second.id]);
    originalRoot = await root.read(original.summaryFast.rootContext);
    assert.equal(f.fake.records.has(path), true, 'Second mapping exists through the maintenance proof');
    f.fake.records.delete(path);
    crossedBoundary = true;
    return result;
  };
  f.failProvider();
  const job = await f.execute(), context = await f.context();
  assert.equal(crossedBoundary, true);
  assert.equal(job.state, 'unknown', 'A stale maintenance proof cannot authorize final scope settlement: ' + JSON.stringify({ job, context }));
  assert.equal(context.summaryPending, true); assert.equal(context.summaryBlocked, true);
  assert.equal(f.calls.length, 1); assert.equal(f.resolutions(), 0);
  assert.ok(original?.summaryFast?.rootContext);
  const retained = await f.authority.runTransaction('owner', f.childId, b => f.product.runs.read(b, original!.id));
  assert.deepEqual(retained, original, 'Final fencing preserves the original run and result');
  assert.deepEqual(await root.read(original.summaryFast.rootContext), originalRoot, 'Final fencing preserves the original root and usage');
  await f.redeliver();
  assert.equal(f.calls.length, 1); assert.equal(f.resolutions(), 0);
  assert.equal((await f.context()).summaryBlocked, true);
});
