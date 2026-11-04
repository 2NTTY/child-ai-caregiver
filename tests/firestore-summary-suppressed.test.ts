import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { FinishReason } from '@google/genai';
import { privateSummaryPolicyFixture } from './helpers/private-summary-policy.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirestoreProductAgent } from '../server/firestore-product-agent.ts';
import { createFirebaseWorkerServices } from '../server/firebase-worker-services.ts';
import { privateSummaryCutoverId, privateSummaryCutoverSchema, privateSummaryInventoryGenesis,
  privateSummaryScanId, privateSummaryScanSchema, privateSummarySuppressedSourceId, privateSummarySuppressedSourceSchema } from '../server/private-summary-scan.ts';
import { prepareFirestoreBackgroundWork, readFirestoreBackgroundClaim, firestoreBackgroundWorkSchema } from '../server/firestore-background-work.ts';
import { prepareContextChange, readContextBasis } from '../server/firestore-context-basis.ts';
import { summaryLineageKeyForTarget, summaryLineageRecordSchema } from '../server/private-summary-work.ts';
import { preparePrivateSummarySuppressedSource } from '../server/firestore-private-summary-suppressed.ts';
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
  const product = await createFirestoreProductAgent({ ...f.options, chat: f.chat, care: f.care, memory: f.memory,
    online: createFirestoreOnlineStore(f.options), config: readAiConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: f.options.projectId }),
    summaryWorkPolicy: f.policy,
    async authorizeWorker(b, reference, recipe) {
      const job = await readFirestoreBackgroundClaim(f.data, b, reference);
      return job?.kind === 'memory-refresh' && recipe === 'memory-refresh';
    },
    platformProvider: { async generate(request) {
      calls.push(request.contents);
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
  const current = (id: string) => f.fake.records.get(f.data.ref('conversation_summaries', 'conversation-summary', id).path)?.currentBatch === true;
  return { ...f, product, calls, context, scan, execute, fact, current, redeliver: () => { assert.ok(lastDelivery); return worker.background.process(lastDelivery); } };
}

async function suppressedRepair() {
  const f = await fixture(), dependency = await f.fact('Removable synthetic dependency');
  const summary = await f.saveAll('Original batch with suppressed dependency');
  const dependencyRef = f.data.ref('memory_facts', 'memory-fact', dependency.id);
  const original = structuredClone(f.fake.records.get(dependencyRef.path));
  await f.memory.delete('owner', f.childId, 'facts', dependency.id, dependency.version);
  const target = { kind: 'repair_batch' as const, summaryId: summary.id };
  const marker = () => f.authority.runTransaction('owner', f.childId, async b => {
    const id = privateSummarySuppressedSourceId(b.scope, target);
    const ref = f.data.ref('private_summary_scans', 'private-summary-suppressed-source', id);
    const row = await b.transaction.get(ref);
    return { ref, value: row.exists ? f.data.open('private-summary-suppressed-source', id, b.scope, privateSummarySuppressedSourceSchema, row) : null };
  });
  return { ...f, dependency, dependencyRef, original, summary, target, marker };
}

test('production suppressed repair records its exact observation and clears pending without changing coverage', async () => {
  const f = await suppressedRepair();
  const headPath = [...f.fake.records.keys()].find(path => path.includes('_conversation_summary_heads/'))!;
  const originalHead = structuredClone(f.fake.records.get(headPath));
  const request = (await f.context()).summaryRequest;
  await f.execute();
  const { value } = await f.marker();
  assert.ok(value, 'The actual production scan must persist an authoritative suppression observation');
  assert.deepEqual(value.target, f.target);
  assert.equal(value.sourceVersion, f.summary.version);
  assert.equal(value.reason, 'dependency_suppressed');
  assert.equal(value.sourceBasis, (await f.scan())!.cycle.sourceBasis);
  assert.equal((await f.scan())!.cycle.hasUnresolvedRepair, false);
  assert.equal((await f.context()).summaryPending, false);
  assert.equal((await f.context()).summaryRequest, request);
  assert.deepEqual(f.fake.records.get(headPath), originalHead, 'Suppression is not a replacement or coverage advancement');
  assert.equal(f.current(f.summary.id), true); assert.equal(f.calls.length, 0);
  const record = structuredClone(f.fake.records.get((await f.marker()).ref.path));
  await f.redeliver();
  assert.deepEqual(f.fake.records.get((await f.marker()).ref.path), record);
  assert.equal(f.calls.length, 0);
});

test('a stale suppression marker never skips a revived repair source', async () => {
  const f = await suppressedRepair();
  await f.execute();
  assert.ok((await f.marker()).value);
  await f.authority.runTransaction('owner', f.childId, async b => {
    const changed = await prepareContextChange(f.data, b);
    b.transaction.set(f.dependencyRef, f.original); changed();
  });
  // A newer confirmed dependency makes the original batch invalid but repairable.
  await f.memory.reviseFact('owner', f.childId, f.dependency.id, { expectedVersion: f.dependency.version,
    confirm: true, confirmShared: false, values: { key: f.dependency.key, content: 'Revived corrected synthetic preference',
      source: { kind: 'manual', description: 'Synthetic restore' }, validUntil: null }, reason: 'Synthetic corrected restore' });
  await f.execute();
  assert.equal(f.calls.length, 1, 'Current source is re-read even with the old marker present');
  assert.ok(JSON.stringify(f.calls[0]).includes('Revived corrected synthetic preference'));
  assert.equal(f.current(f.summary.id), false);
});

test('suppressed repair retains unresolved legacy ownership and pending state', async () => {
  const f = await suppressedRepair();
  const ref = await f.authority.runTransaction('owner', f.childId, async b => {
    const id = summaryLineageKeyForTarget(b.scope, { kind: 'repair_batch', repairOf: f.summary.id });
    const value = summaryLineageRecordSchema.parse({ format: 'private-summary-lineage/v1', id, scope: b.scope,
      authorizationVersion: b.authorizationVersion, workerGeneration: b.generation, version: 1,
      owner: { kind: 'legacy_fast', runId: randomUUID(), triggerReference: randomUUID(),
        coveredMessageIds: [f.message.id], accounting: { state: 'unresolved' } } });
    const ref = f.data.ref('private_summary_works', 'private-summary-lineage', id);
    b.transaction.set(ref, { ...f.data.tags(b.scope), ...f.data.seal('private-summary-lineage', id, b.scope, summaryLineageRecordSchema, value, value.version) });
    return ref;
  });
  const original = structuredClone(f.fake.records.get(ref.path));
  await f.execute();
  assert.equal((await f.marker()).value, null);
  assert.deepEqual(f.fake.records.get(ref.path), original);
  assert.equal((await f.scan())!.cycle.hasUnresolvedRepair, true);
  assert.equal((await f.context()).summaryPending, true); assert.equal(f.calls.length, 0);
});

// This focused transaction harness uses the same real gate, source reader, marker and scan.
// The fake only injects Firestore callback retries and acknowledgement loss.
async function scanSuppressed(f: Awaited<ReturnType<typeof suppressedRepair>>) {
  return f.authority.runTransaction('owner', f.childId, async b => {
    assert.equal((await f.product.summaryWork.readEntryGate(b)).kind, 'durable');
    const commits: (() => void)[] = [];
    const scan = await f.product.summaryScan.prepare(b, {
      async readFresh() { return null; }, async readWork() { return null; },
      async readRepair(summaryId) {
        const source = await f.memory.readFastSource(b, { kind: 'repair_batch', summaryId });
        assert.equal(source.kind, 'suppressed');
        if (source.kind !== 'suppressed') throw new Error('Expected suppressed current source');
        const prepared = await preparePrivateSummarySuppressedSource(f.data, b, source);
        if (prepared.kind === 'blocked') return { kind: 'blocked' as const };
        commits.push(prepared.commit); return { kind: 'resolved' as const };
      },
    });
    for (const commit of commits) commit();
    scan.commit(); return scan.scan;
  });
}

test('suppression and scan commit atomically while retry and lost acknowledgement preserve one marker version', async () => {
  const f = await suppressedRepair();
  f.fake.failCommit();
  await assert.rejects(scanSuppressed(f), /Synthetic transaction commit failed/);
  assert.equal((await f.marker()).value, null); assert.equal(await f.scan(), null);
  f.fake.retry();
  assert.equal((await scanSuppressed(f)).version, 1);
  const first = await f.marker(); assert.equal(first.value!.version, 1);
  const ciphertext = structuredClone(f.fake.records.get(first.ref.path));
  await scanSuppressed(f);
  assert.deepEqual(f.fake.records.get(first.ref.path), ciphertext, 'Same observation lookup must not encrypt or rewrite');
  await f.authority.runTransaction('owner', f.childId, async b => (await prepareContextChange(f.data, b))());
  f.fake.loseReply();
  await assert.rejects(scanSuppressed(f), /Synthetic lost commit acknowledgement/);
  const committed = await f.marker(); assert.equal(committed.value!.version, 2);
  assert.equal((await f.scan())!.cycle.sourceBasis, committed.value!.sourceBasis);
  const afterLostReply = structuredClone(f.fake.records.get(first.ref.path));
  await scanSuppressed(f);
  assert.deepEqual(f.fake.records.get(first.ref.path), afterLostReply, 'Lost ACK retry re-reads and looks up the committed observation');
});

test('fresh suppression never advances the watermark or skips the oldest uncovered message', async () => {
  const f = await fixture(), dependency = await f.fact('Expired fresh dependency');
  await f.memory.reviseFact('owner', f.childId, dependency.id, { expectedVersion: dependency.version, confirm: true,
    confirmShared: false, values: { key: dependency.key, content: dependency.content, source: dependency.source,
      validUntil: '2000-01-01T00:00:00.000Z' }, reason: 'Synthetic expiry' });
  await f.chat.createUserMessageForUser('owner', f.childId, 'Later fresh source must not jump the first');
  await f.execute();
  const first = await f.authority.runTransaction('owner', f.childId, async b => {
    const id = privateSummarySuppressedSourceId(b.scope, { kind: 'fresh_message', messageId: f.message.id });
    const row = await b.transaction.get(f.data.ref('private_summary_scans', 'private-summary-suppressed-source', id));
    return f.data.open('private-summary-suppressed-source', id, b.scope, privateSummarySuppressedSourceSchema, row);
  });
  assert.equal(first.sourceVersion, 1);
  assert.equal((await f.context()).summaryPending, true);
  assert.equal((await f.memory.prepareSummary('owner', f.childId))!.messages[0].id, f.message.id);
  assert.equal([...f.fake.records.keys()].some(path => path.includes('_conversation_summary_heads/')), false);
  assert.equal(f.calls.length, 0);
});

async function seedStaleMarker(f: Awaited<ReturnType<typeof suppressedRepair>>) {
  return f.authority.runTransaction('owner', f.childId, async b => {
    const source = await f.memory.readFastSource(b, f.target);
    assert.equal(source.kind, 'suppressed');
    if (source.kind !== 'suppressed' || !source.observation) throw new Error('Expected actual source observation');
    const id = privateSummarySuppressedSourceId(b.scope, f.target), ref = f.data.ref('private_summary_scans', 'private-summary-suppressed-source', id);
    const value = privateSummarySuppressedSourceSchema.parse({ format: 'private-summary-suppressed-source/v1', id,
      scope: b.scope, authorizationVersion: '0', workerGeneration: randomUUID(), version: 3,
      ...source.observation, reason: source.reason });
    b.transaction.set(ref, { ...f.data.tags(b.scope), ...f.data.seal('private-summary-suppressed-source', id, b.scope,
      privateSummarySuppressedSourceSchema, value, value.version) });
    return ref;
  });
}

test('current authority can replace a stale marker only after a new actual suppressed observation', async () => {
  const f = await suppressedRepair(); await seedStaleMarker(f);
  let reads = 0; const read = f.memory.readFastSource;
  f.memory.readFastSource = (...args) => { reads++; return read(...args); };
  await f.execute();
  const current = (await f.marker()).value!;
  assert.equal(current.version, 4); assert.equal(current.workerGeneration, f.generation);
  assert.notEqual(current.authorizationVersion, '0'); assert.equal(reads, 1);
  assert.equal((await f.context()).summaryPending, false); assert.equal(f.calls.length, 0);
});

for (const phase of ['blocked', 'restore_suspended'] as const) test(`a stale suppression marker cannot bypass ${phase} entry`, async () => {
  const f = await suppressedRepair(), ref = await seedStaleMarker(f);
  const original = structuredClone(f.fake.records.get(ref.path));
  await f.authority.runTransaction('owner', f.childId, async b => {
    const id = privateSummaryCutoverId(b.scope), ref = f.data.ref('private_summary_scans', 'private-summary-cutover', id);
    const old = f.data.open('private-summary-cutover', id, b.scope, privateSummaryCutoverSchema, await b.transaction.get(ref));
    const value = privateSummaryCutoverSchema.parse({ ...old, version: old.version + 1, phase,
      ...(phase === 'restore_suspended' ? { restoreId: randomUUID(), upperCaptured: false, exhausted: false } : {}) });
    b.transaction.set(ref, { ...f.data.tags(b.scope), ...f.data.seal('private-summary-cutover', id, b.scope,
      privateSummaryCutoverSchema, value, value.version) });
  });
  let reads = 0; const read = f.memory.readFastSource;
  f.memory.readFastSource = (...args) => { reads++; return read(...args); };
  await f.execute();
  assert.equal(reads, 0); assert.equal(f.calls.length, 0);
  assert.deepEqual(f.fake.records.get(ref.path), original);
  assert.equal(await f.scan(), null); assert.equal((await f.context()).summaryPending, true);
});

test('a missing target has no provable version and cannot create a suppression marker', async () => {
  const f = await fixture(), target = { kind: 'repair_batch' as const, summaryId: randomUUID() };
  await f.authority.runTransaction('owner', f.childId, async b => {
    const source = await f.memory.readFastSource(b, target);
    assert.equal(source.kind, 'suppressed');
    if (source.kind !== 'suppressed') throw new Error('Expected missing source');
    assert.equal(source.observation, undefined);
    assert.equal((await preparePrivateSummarySuppressedSource(f.data, b, source)).kind, 'blocked');
    const id = privateSummarySuppressedSourceId(b.scope, target);
    assert.equal((await b.transaction.get(f.data.ref('private_summary_scans', 'private-summary-suppressed-source', id))).exists, false);
  });
});

test('a marker body version mismatch rejects suppression before the scan cursor is committed', async () => {
  const f = await suppressedRepair(), ref = await seedStaleMarker(f);
  await f.authority.runTransaction('owner', f.childId, async b => {
    const id = privateSummarySuppressedSourceId(b.scope, f.target);
    const value = f.data.open('private-summary-suppressed-source', id, b.scope, privateSummarySuppressedSourceSchema, await b.transaction.get(ref));
    b.transaction.set(ref, { ...f.data.tags(b.scope), ...f.data.seal('private-summary-suppressed-source', id, b.scope,
      privateSummarySuppressedSourceSchema, value, value.version + 1) });
  });
  const original = structuredClone(f.fake.records.get(ref.path));
  await assert.rejects(scanSuppressed(f), { code: 'private_summary_scan_binding' });
  assert.deepEqual(f.fake.records.get(ref.path), original);
  assert.equal(await f.scan(), null); assert.equal((await f.context()).summaryPending, true);
});
