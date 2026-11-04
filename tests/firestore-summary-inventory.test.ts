import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { privateSummaryFixture } from './helpers/private-summary-work.ts';
import { FirestoreDomainData } from '../server/firestore-domain-data.ts';
import { firestoreAgentRunSchema, firestoreAgentClaimSchema } from '../server/firestore-agent-runs.ts';
import { summaryLineageRecordSchema, summaryLineageKeyForTarget } from '../server/private-summary-work.ts';

async function fixture(pageSize = 2) {
  const f = await privateSummaryFixture(), data = new FirestoreDomainData(f.options);
  const module = await import('../server/firestore-private-summary-inventory.ts').catch(() => null);
  assert.equal(typeof module?.createFirestorePrivateSummaryInventory, 'function', 'Persistent legacy inventory writer is required');
  const fenceRef = data.collection('synthetic_fences').doc('only');
  // Synthetic authority source is read on EVERY callback; no installed flag is accepted by advance.
  await f.options.database.runTransaction(async tx => { tx.set(fenceRef, { active: true }); });
  const readEntryFence = async (b: any) => (await b.transaction.get(fenceRef)).get('active')
    ? { scope: b.scope, authorizationVersion: b.authorizationVersion, workerGeneration: b.generation,
      entryFenceVersion: 'private-summary-entry/v1' as const } : null;
  const inventory = module!.createFirestorePrivateSummaryInventory({ ...f.options, pageSize, readEntryFence });
  const run = () => { for (const [path, row] of f.fake.records) if (path.includes('_agent_runs/')) row.__name__ = path.split('/').at(-1);
    return f.authority.runTransaction('owner', f.childId, b => inventory.advance(b)); };
  const read = () => f.authority.runTransaction('owner', f.childId, b => inventory.read(b));
  async function add(options: { summary?: boolean; oldEpoch?: boolean; fast?: boolean; missingPointer?: boolean } = {}) {
    return f.authority.runTransaction('owner', f.childId, async b => {
      const scope = { ...b.scope, ...(options.oldEpoch ? { storageEpoch: randomUUID() } : {}) };
      const id = randomUUID(), reference = randomUUID(), messageId = randomUUID();
      const target = { kind: 'fresh_message' as const, messageId }, key = summaryLineageKeyForTarget(scope, target);
      const value = firestoreAgentRunSchema.parse({ id, ...scope, authorizationVersion: b.authorizationVersion,
        dataVersion: scope.storageEpoch + ':0', trigger: { kind: 'worker', reference }, workerGeneration: b.generation,
        sourceMessageId: null, recipeId: options.summary || options.fast ? 'memory-refresh' : 'other', state: 'unknown', stopReason: null,
        createdAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-01-01T00:01:00.000Z', result: null,
        ...(options.fast ? { summaryFast: { format: 'private-summary-fast/v1', target, lineageKey: key,
          manifestHash: 'a'.repeat(64), candidate: { target: { kind: 'fresh_prefix', firstMessageId: messageId, messageCount: 1 },
            sourceHash: 'b'.repeat(64) }, rootContext: null, selected: { sourceHash: 'b'.repeat(64), coveredMessageIds: [messageId] },
          noDispatch: null, transferredToWorkId: null } } : {}) });
      const ref = data.ref('agent_runs', 'agent-run', id);
      b.transaction.set(ref, { ...data.tags(scope), runId: id, createdAt: value.createdAt, triggerKind: 'worker',
        ...data.seal('agent-run', id, scope, firestoreAgentRunSchema, value) });
      const claimId = JSON.stringify([scope.ownerUserId, scope.childId, 'worker', reference]);
      b.transaction.set(data.ref('agent_claims', 'agent-claim', claimId),
        { ...data.tags(scope), ...data.seal('agent-claim', claimId, scope, firestoreAgentClaimSchema, { runId: id }) });
      if (options.fast && !options.missingPointer) {
        const pointer = summaryLineageRecordSchema.parse({ format: 'private-summary-lineage/v1', id: key, scope,
          authorizationVersion: b.authorizationVersion, workerGeneration: b.generation, version: 2,
          owner: { kind: 'legacy_fast', runId: id, triggerReference: reference, coveredMessageIds: [messageId], accounting: { state: 'unresolved' } } });
        b.transaction.set(data.ref('private_summary_works', 'private-summary-lineage', key),
          { ...data.tags(scope), ...data.seal('private-summary-lineage', key, scope, summaryLineageRecordSchema, pointer, 2) });
      }
      return { id, documentId: ref.id, path: ref.path, key };
    });
  }
  return { ...f, data, module: module!, inventory, run, read, add, fenceRef };
}

test('production without an actual fence reader remains blocked and does not capture upper', async () => {
  const f = await fixture(); const inventory = f.module.createFirestorePrivateSummaryInventory(f.options);
  assert.deepEqual(await f.authority.runTransaction('owner', f.childId, b => inventory.advance(b)), { kind: 'blocked', reason: 'entry_fence' });
  assert.equal(await f.read(), null);
});
test('empty fenced inventory reaches complete without issuing any run or grant', async () => {
  const f = await fixture(), result = await f.run(); assert.equal(result.kind, 'advanced');
  const row = await f.read(); assert.equal(row?.phase, 'complete'); assert.equal(row?.inspectedRuns, 0);
  assert.equal([...f.fake.records.keys()].filter(p => /private_summary_(works|usage)/.test(p)).length, 0);
});
test('continuous pages retain fixed upper and count all ordinary runs', async () => {
  const f = await fixture(); for (let i = 0; i < 5; i++) await f.add();
  await f.run(); const first = (await f.read())!; assert.equal(first.inspectedRuns, 2); assert.equal(first.exhausted, false);
  await f.run(); const second = (await f.read())!; assert.equal(second.inspectedRuns, 4);
  assert.equal(second.upperRunDocumentId, first.upperRunDocumentId); assert.notEqual(second.inventoryHash, first.inventoryHash);
  await f.run(); const end = (await f.read())!; assert.equal(end.phase, 'complete'); assert.equal(end.inspectedRuns, 5);
  assert.equal(end.afterRunDocumentId, end.upperRunDocumentId);
  await f.run(); assert.deepEqual(await f.read(), end);
});
test('unknown legacy run anywhere in the fixed inventory prevents complete', async () => {
  const f = await fixture(); await f.add({ summary: true }); for (let i = 0; i < 4; i++) await f.add();
  for (let i = 0; i < 3; i++) await f.run(); const end = (await f.read())!;
  assert.equal(end.phase, 'blocked'); assert.equal(end.unmappedRuns, 1); assert.equal(end.inspectedRuns, 5);
});
test('same transaction rechecks fence before each page and retry', async () => {
  const f = await fixture(); for (let i = 0; i < 3; i++) await f.add(); await f.run(); const before = await f.read();
  f.fake.retry(async () => { f.fake.records.set(f.fenceRef.path, { active: false }); });
  assert.deepEqual(await f.run(), { kind: 'blocked', reason: 'entry_fence' }); assert.deepEqual(await f.read(), before);
});
test('lost acknowledgement is recovered by reading original cursor and retry never doubles counts', async () => {
  const f = await fixture(); for (let i = 0; i < 5; i++) await f.add(); f.fake.loseReply();
  await assert.rejects(f.run(), /lost commit acknowledgement/); assert.equal((await f.read())?.inspectedRuns, 2);
  f.fake.retry(); await f.run(); assert.equal((await f.read())?.inspectedRuns, 4);
});
test('invalid row aborts page and leaves the original cursor untouched', async () => {
  const f = await fixture(); const a = await f.add(), b = await f.add();
  const last = [a, b].sort((x, y) => x.documentId.localeCompare(y.documentId)).at(-1)!;
  f.fake.records.get(last.path).runId = randomUUID(); await assert.rejects(f.run()); assert.equal(await f.read(), null);
});
test('cross-epoch summary remains unmapped without rewriting old lineage into current scope', async () => {
  const f = await fixture(); await f.add({ fast: true, oldEpoch: true });
  const pointers = [...f.fake.records].filter(([p]) => p.includes('_private_summary_works/'));
  await f.run(); assert.equal((await f.read())?.unmappedRuns, 1);
  assert.deepEqual([...f.fake.records].filter(([p]) => p.includes('_private_summary_works/')).map(([p, v]) => [p, v.ciphertext]), pointers.map(([p, v]) => [p, v.ciphertext]));
});
test('complete original fast ownership is mapped unresolved and never becomes a new grant', async () => {
  const f = await fixture(); await f.add({ fast: true }); await f.run(); const row = (await f.read())!;
  assert.equal(row.phase, 'complete'); assert.equal(row.unresolvedMappedRuns, 1); assert.equal(row.unmappedRuns, 0);
  assert.equal([...f.fake.records.keys()].filter(p => p.includes('_private_summary_usage/')).length, 0);
});
test('missing original fast pointer is unmapped instead of inventing lineage ownership', async () => {
  const f = await fixture(); await f.add({ fast: true, missingPointer: true }); await f.run();
  assert.equal((await f.read())?.unmappedRuns, 1);
  assert.equal([...f.fake.records.keys()].filter(p => p.includes('_private_summary_works/')).length, 0);
});

test('missing original claim never becomes mapped despite a matching fast pointer', async () => {
  const f = await fixture(); await f.add({ fast: true });
  for (const path of f.fake.records.keys()) if (path.includes('_agent_claims/')) f.fake.records.delete(path);
  await f.run(); assert.equal((await f.read())?.unmappedRuns, 1);
});
test('conflicting original pointer remains untouched and blocks the inventory', async () => {
  const f = await fixture(); const original = await f.add({ fast: true });
  await f.authority.runTransaction('owner', f.childId, async b => {
    const ref = f.data.ref('private_summary_works', 'private-summary-lineage', original.key), row = await b.transaction.get(ref);
    const pointer = f.data.open('private-summary-lineage', original.key, b.scope, summaryLineageRecordSchema, row);
    const changed = summaryLineageRecordSchema.parse({ ...pointer, owner: { ...pointer.owner, runId: randomUUID() } });
    b.transaction.set(ref, { ...f.data.tags(b.scope), ...f.data.seal('private-summary-lineage', changed.id, b.scope, summaryLineageRecordSchema, changed, changed.version) });
  });
  const before = f.fake.records.get(f.data.ref('private_summary_works', 'private-summary-lineage', original.key).path).ciphertext;
  await f.run(); assert.equal((await f.read())?.unmappedRuns, 1);
  assert.equal(f.fake.records.get(f.data.ref('private_summary_works', 'private-summary-lineage', original.key).path).ciphertext, before);
});

test('restore suspension and changed authorization cannot be restarted by inventory', async () => {
  const f = await fixture(); await f.run();
  const { privateSummaryCutoverSchema, privateSummaryInventoryGenesis } = await import('../server/private-summary-scan.ts');
  for (const restore of [false, true]) {
    await f.authority.runTransaction('owner', f.childId, async b => {
      const existing = (await f.inventory.read(b))!;
      const next = privateSummaryCutoverSchema.parse({ ...existing,
        authorizationVersion: restore ? b.authorizationVersion : '999',
        phase: restore ? 'restore_suspended' : 'inventory', upperCaptured: false, upperRunDocumentId: null,
        afterRunDocumentId: null, inspectedRuns: 0, unresolvedMappedRuns: 0, unmappedRuns: 0, exhausted: false,
        inventoryHash: privateSummaryInventoryGenesis(b.scope, restore ? b.authorizationVersion : '999', b.generation, 1),
        restoreId: restore ? randomUUID() : null });
      b.transaction.set(f.data.ref('private_summary_scans', 'private-summary-cutover', next.id),
        { ...f.data.tags(b.scope), ...f.data.seal('private-summary-cutover', next.id, b.scope, privateSummaryCutoverSchema, next, next.version) });
    });
    const before = await f.read(); assert.deepEqual(await f.run(), { kind: 'blocked', reason: restore ? 'restore_suspended' : 'stale' });
    assert.deepEqual(await f.read(), before);
  }
});

test('forged original claim projection cannot authorize a mapped classification', async () => {
  const f = await fixture(); await f.add({ fast: true });
  for (const [path, value] of f.fake.records) if (path.includes('_agent_claims/')) value.epochTag = 'foreign';
  await f.run(); assert.equal((await f.read())?.unmappedRuns, 1);
});
