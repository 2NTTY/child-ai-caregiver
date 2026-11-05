import assert from 'node:assert/strict';
import test from 'node:test';
import { privateSummaryFixture } from './helpers/private-summary-work.ts';

async function fixture() {
  const f = await privateSummaryFixture();
  const module = await import('../server/firestore-private-summary-scan.ts').catch(() => null);
  assert.equal(typeof module?.createFirestorePrivateSummaryScan, 'function', 'Persistent scan implementation is required');
  const scanner = module!.createFirestorePrivateSummaryScan({ ...f.options, memory: f.memory, pageSize: 2 });
  const names = () => { for (const [path, value] of f.fake.records) if (value.format === 'yuban-firestore-domain') value.__name__ = path.split('/').at(-1); };
  const run = async (visitors = {}) => {
    names(); return f.authority.runTransaction('owner', f.childId, async b => {
      const prepared = await scanner.prepare(b, { readFresh: async () => null, readRepair: async () => ({ kind: 'resolved' as const }),
        readWork: async () => null, ...visitors }); prepared.commit(); return prepared;
    });
  };
  const clear = () => f.authority.runTransaction('owner', f.childId, async b => {
    const { readContextBasis } = await import('../server/firestore-context-basis.ts');
    const { FirestoreDomainData } = await import('../server/firestore-domain-data.ts');
    const request = (await readContextBasis(new FirestoreDomainData(f.options), b)).value.summaryRequest ?? 0;
    const result = await scanner.prepareClearPending(b, request); result.commit(); return result.canClear;
  });
  const batch = async () => { await f.chat.createUserMessageForUser('owner', f.childId, 'Synthetic scan source'); return f.saveAll(); };
  return { ...f, scanner, names, run, clear, batch };
}

test('persistent repair scan reaches beyond the old four-batch window through valid and blocked pages', async () => {
  const f = await fixture(), ids: string[] = [];
  for (let i = 0; i < 6; i++) ids.push((await f.batch()).id);
  const seen: string[] = [];
  const visitors = { readRepair: async (id: string) => { seen.push(id); return { kind: 'resolved' as const }; } };
  let result = await f.run(visitors);
  assert.equal(result.scan.cycle.state, 'scanning');
  for (let i = 0; i < 3; i++) result = await f.run(visitors);
  assert.equal(result.scan.cycle.state, 'complete');
  assert.deepEqual(new Set(seen), new Set(ids)); assert.equal(seen.length, ids.length);
});

test('new chat and context changes do not restart an unfinished cycle or replace its upper bound', async () => {
  const f = await fixture(); for (let i = 0; i < 5; i++) await f.batch();
  const first = await f.run(); await f.batch();
  await f.memory.createTopic('owner', f.childId, { title: 'Changed basis', note: '', visibility: 'private', confirmShared: false });
  const second = await f.run();
  assert.equal(second.scan.cycle.number, first.scan.cycle.number);
  assert.equal(second.scan.cycleUpperSortKey, first.scan.cycleUpperSortKey);
  assert.equal(second.scan.cycle.sourceBasis, first.scan.cycle.sourceBasis);
  await f.run(); assert.equal(await f.clear(), false);
});

test('repair selection passes blocked first candidate, selects at most one, and resumes after selected cursor', async () => {
  const f = await fixture(); for (let i = 0; i < 4; i++) await f.batch();
  const seen: string[] = [];
  const first = await f.run({ readRepair: async (id: string) => { seen.push(id); return seen.length === 2 ? { kind: 'candidate' as const, value: id } : { kind: 'blocked' as const }; } });
  assert.equal(first.selected, seen[1]); assert.equal(first.scan.repairAfterId, seen[1]);
  const next: string[] = []; await f.run({ readRepair: async (id: string) => { next.push(id); return { kind: 'resolved' as const }; } });
  assert.equal(next.length, 2); assert.ok(next.every(id => !seen.includes(id)));
});

test('pending clears only after a complete same-basis scan with fresh caught up', async () => {
  const f = await fixture(); await f.chat.createUserMessageForUser('owner', f.childId, 'Still uncovered');
  await f.run(); assert.equal(await f.clear(), false);
  await f.saveAll(); await f.run(); assert.equal(await f.clear(), true);
});

test('discarded prepare has no writes and transaction retry advances only one page', async () => {
  const f = await fixture(); for (let i = 0; i < 5; i++) await f.batch(); f.names();
  const before = JSON.stringify([...f.fake.records]);
  await f.authority.runTransaction('owner', f.childId, b => f.scanner.prepare(b,
    { readFresh: async () => null, readRepair: async () => ({ kind: 'resolved' as const }), readWork: async () => null }));
  assert.equal(JSON.stringify([...f.fake.records]), before);
  f.fake.retry(); const result = await f.run(); assert.equal(result.scan.cycle.number, 1);
  const ids: string[] = []; await f.run({ readRepair: async (id: string) => { ids.push(id); return { kind: 'resolved' as const }; } });
  assert.equal(ids.length, 2);
});

test('work pages verify projections and block pending clearance even after fresh coverage', async () => {
  const { privateSummaryPolicyFixture } = await import('./helpers/private-summary-policy.ts');
  const f = await privateSummaryPolicyFixture(); await f.barrier();
  const module = await import('../server/firestore-private-summary-scan.ts').catch(() => null);
  assert.equal(typeof module?.createFirestorePrivateSummaryScan, 'function', 'Persistent scan implementation is required');
  const scanner = module!.createFirestorePrivateSummaryScan({ ...f.options, memory: f.memory, pageSize: 2 });
  const started = await f.build().start('owner', f.childId, { kind: 'next_fresh' });
  assert.equal(started.kind, 'created'); if (started.kind !== 'created') throw new Error('Expected work');
  await f.saveAll();
  for (const [path, value] of f.fake.records) if (value.format === 'yuban-firestore-domain') value.__name__ = path.split('/').at(-1);
  const seen: string[] = [];
  for (let i = 0; i < 2; i++) await f.authority.runTransaction('owner', f.childId, async b => {
    const prepared = await scanner.prepare(b, { readFresh: async () => null, readRepair: async () => ({ kind: 'resolved' as const }),
      readWork: async work => { seen.push(work.id); return null; } }); prepared.commit();
  });
  assert.deepEqual(seen, [], 'Fresh works must not become repair-lane candidates');
  await f.authority.runTransaction('owner', f.childId, async b => {
    const clear = await scanner.prepareClearPending(b, 2); assert.equal(clear.canClear, false);
  });
  const row = f.fake.records.get(f.data.ref('private_summary_works', 'private-summary-work', started.work.id).path)!;
  row.workState = 'completed';
  await assert.rejects(() => f.authority.runTransaction('owner', f.childId, b => scanner.prepare(b,
    { readFresh: async () => null, readRepair: async () => ({ kind: 'resolved' as const }), readWork: async () => null })),
  (error: { code?: string }) => error.code === 'private_summary_work_projection');
  row.workState = started.work.state; row.version = 2;
  await assert.rejects(() => f.authority.runTransaction('owner', f.childId, b => scanner.prepare(b,
    { readFresh: async () => null, readRepair: async () => ({ kind: 'resolved' as const }), readWork: async () => null })),
  (error: { code?: string }) => error.code === 'private_summary_scan_binding');
  row.version = 1;
  const { summarySourceRevisionSchema } = await import('../server/private-summary-work.ts');
  await f.authority.runTransaction('owner', f.childId, async b => {
    const ref = f.data.ref('private_summary_revisions', 'private-summary-revision', started.work.sourceRevisionId);
    const snapshot = await b.transaction.get(ref);
    const revision = f.data.open('private-summary-revision', started.work.sourceRevisionId, b.scope, summarySourceRevisionSchema, snapshot);
    b.transaction.set(ref, { ...snapshot.data(), ...f.data.seal('private-summary-revision', revision.id, b.scope, summarySourceRevisionSchema, revision, 2) });
  });
  await assert.rejects(() => f.authority.runTransaction('owner', f.childId, b => scanner.prepare(b,
    { readFresh: async () => null, readRepair: async () => ({ kind: 'resolved' as const }), readWork: async () => null })),
  (error: { code?: string }) => error.code === 'private_summary_scan_binding');
});

test('repair pagination uses document identity to distinguish equal sort keys', async () => {
  const f = await fixture(); const summaries: Awaited<ReturnType<typeof f.batch>>[] = [];
  for (let i = 0; i < 5; i++) summaries.push(await f.batch());
  const { FirestoreDomainData } = await import('../server/firestore-domain-data.ts');
  const { firestoreSavedSummarySchema } = await import('../server/firestore-memory.ts');
  const data = new FirestoreDomainData(f.options);
  await f.authority.runTransaction('owner', f.childId, async b => {
    const updates = [];
    for (const summary of summaries) {
      const ref = data.ref('conversation_summaries', 'conversation-summary', summary.id), row = await b.transaction.get(ref);
      const saved = data.open('conversation-summary', summary.id, b.scope, firestoreSavedSummarySchema, row);
      saved.batch!.lastMessageSortKey = '0000000000000000001'; saved.lastSortKey = '0000000000000000001';
      updates.push({ ref, envelope: { ...row.data(), lastMessageSortKey: saved.batch!.lastMessageSortKey,
        ...data.seal('conversation-summary', summary.id, b.scope, firestoreSavedSummarySchema, saved, saved.summary.version) } });
    }
    for (const update of updates) b.transaction.set(update.ref, update.envelope);
  });
  const seen: string[] = []; for (let i = 0; i < 3; i++) await f.run({ readRepair: async (id: string) => { seen.push(id); return { kind: 'resolved' as const }; } });
  assert.equal(seen.length, 5); assert.deepEqual(new Set(seen), new Set(summaries.map(item => item.id)));
});

test('selection alone preserves preference, while an explicit committed-progress hook stores the opposite lane', async () => {
  const f = await fixture(); await f.batch();
  const selected = await f.run({ readFresh: async () => 'fresh-candidate' });
  assert.equal(selected.selected, 'fresh-candidate'); assert.equal(selected.scan.prefer, 'fresh');
  await f.authority.runTransaction('owner', f.childId, async b => { const commit = await f.scanner.prepareProgress(b, 'fresh'); commit(); });
  const next = await f.run(); assert.equal(next.scan.prefer, 'repair');
  await f.authority.runTransaction('owner', f.childId, async b => { const commit = await f.scanner.prepareProgress(b, 'fresh'); commit(); });
  assert.equal((await f.run()).scan.prefer, 'repair', 'Repeated same-lane progress is opposite assignment, not a blind toggle');
});

test('pending clearance preserves an existing unknown-outcome summary block', async () => {
  const f = await fixture(); await f.batch(); await f.run();
  const { FirestoreDomainData } = await import('../server/firestore-domain-data.ts');
  const { readContextBasis, firestoreContextRecoverySchema } = await import('../server/firestore-context-basis.ts');
  const data = new FirestoreDomainData(f.options);
  await f.authority.runTransaction('owner', f.childId, async b => {
    const context = await readContextBasis(data, b), value = { ...context.value, summaryBlocked: true, summaryPending: true };
    b.transaction.set(context.ref, { ...data.tags(b.scope), summaryPending: true,
      ...data.seal('context-version', context.id, b.scope, firestoreContextRecoverySchema, value) });
  });
  assert.equal(await f.clear(), false);
});

test('a blocked repair without a work body remains pending across later valid pages and fresh completion', async () => {
  const f = await fixture(); for (let i = 0; i < 5; i++) await f.batch();
  let inspected = 0;
  const visitors = { readRepair: async () => ({ kind: ++inspected === 1 ? 'blocked' as const : 'resolved' as const }) };
  await f.run(visitors); await f.run(visitors); const last = await f.run(visitors);
  assert.equal(last.scan.cycle.state, 'complete'); assert.equal(last.scan.cycle.hasUnresolvedRepair, true);
  assert.equal(await f.clear(), false);
  for (let i = 0; i < 3; i++) await f.run();
  assert.equal(await f.clear(), true, 'A later complete cycle revalidates all sources before clearing');
});

test('a lost commit acknowledgement resumes from the durable page cursor without counting a new cycle', async () => {
  const f = await fixture(); for (let i = 0; i < 5; i++) await f.batch();
  const seen: string[] = [], visitors = { readRepair: async (id: string) => { seen.push(id); return { kind: 'resolved' as const }; } };
  f.fake.loseReply(); await assert.rejects(() => f.run(visitors), /lost commit acknowledgement/u);
  const result = await f.run(visitors);
  assert.equal(result.scan.cycle.number, 1); assert.equal(seen.length, 4); assert.equal(new Set(seen).size, 4);
});
