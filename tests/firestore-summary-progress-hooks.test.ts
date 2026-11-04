import assert from 'node:assert/strict';
import test from 'node:test';
import { privateSummaryPolicyFixture as fixture } from './helpers/private-summary-policy.ts';
import { privateSummaryTerminalFixture as terminalFixture } from './helpers/private-summary-terminal.ts';
import { createFirestorePrivateSummaryScan } from '../server/firestore-private-summary-scan.ts';
import { privateSummaryScanId, privateSummaryScanSchema } from '../server/private-summary-scan.ts';

type Fixture = Awaited<ReturnType<typeof fixture>>;
type Lane = 'fresh' | 'repair';

async function readScan(f: Pick<Fixture, 'authority' | 'data' | 'childId'>) {
  return f.authority.runTransaction('owner', f.childId, async b => {
    const id = privateSummaryScanId(b.scope);
    return f.data.open('private-summary-scan', id, b.scope, privateSummaryScanSchema,
      await b.transaction.get(f.data.ref('private_summary_scans', 'private-summary-scan', id)));
  });
}

async function prepareScan(f: Pick<Fixture, 'authority' | 'options' | 'memory' | 'data' | 'childId'>, lane: Lane) {
  const scanner = createFirestorePrivateSummaryScan({ ...f.options, memory: f.memory });
  await f.authority.runTransaction('owner', f.childId, async b => {
    const prepared = await scanner.prepare(b, { readFresh: async () => 'candidate',
      readRepair: async () => ({ kind: 'resolved' }), readWork: async () => null });
    prepared.commit();
  });
  if (lane === 'repair') await f.authority.runTransaction('owner', f.childId, async b => {
    const commit = await scanner.prepareProgress(b, 'fresh'); commit();
  });
  return readScan(f);
}

async function coveredWork(lane: Lane) {
  const f = await fixture();
  let target: { kind: 'next_fresh' } | { kind: 'repair_batch'; summaryId: string } = { kind: 'next_fresh' };
  if (lane === 'repair') {
    const values = { key: 'Synthetic progress dependency', content: 'Original',
      source: { kind: 'manual' as const, description: 'Synthetic progress fixture' }, validUntil: null };
    const candidate = (await f.memory.createFact('owner', f.childId, { values, intendedVisibility: 'private' }))!;
    const fact = (await f.memory.confirmFact('owner', f.childId, candidate.id,
      { expectedVersion: candidate.version, confirm: true, confirmShared: false }))!;
    const saved = await f.saveAll();
    await f.memory.reviseFact('owner', f.childId, fact.id, { expectedVersion: fact.version, confirm: true,
      confirmShared: false, values: { ...values, content: 'Corrected' }, reason: 'Synthetic correction' });
    target = { kind: 'repair_batch', summaryId: saved.id };
  }
  await f.barrier(); const started = await f.build().start('owner', f.childId, target);
  assert.equal(started.kind, 'created'); if (started.kind !== 'created') throw new Error('Expected original work');
  if (target.kind === 'next_fresh') await f.saveAll();
  else {
    const head = (await f.memory.prepareSummary('owner', f.childId))!;
    await f.memory.saveSummary('owner', f.childId, { previousVersion: head.previousVersion, basis: head.basis,
      coveredMessageIds: [f.message.id], repairOf: target.summaryId, text: 'Authoritative repair coverage' });
  }
  const scope = await f.authority.runTransaction('owner', f.childId, async b => f.runs.current(b));
  return { f, work: started.work, input: { scope, workId: started.work.id, expectedVersion: started.work.version } };
}

for (const lane of ['fresh', 'repair'] as const) {
  test(`administrative ${lane} coverage advances the opposite lane atomically and lookup never rewrites scan progress`, async () => {
    const { f, work, input } = await coveredWork(lane), beforeScan = await prepareScan(f, lane);
    const before = JSON.stringify([...f.fake.records]);
    f.fake.failCommit(); await assert.rejects(f.build().refreshSource(input), /Synthetic transaction commit failed/u);
    assert.equal(JSON.stringify([...f.fake.records]), before);
    f.fake.retry(); f.fake.loseReply();
    await assert.rejects(f.build().refreshSource(input), /Synthetic lost commit acknowledgement/u);
    const current = await f.build().readState('owner', f.childId, work.id);
    assert.equal(current.work.state, 'completed'); assert.equal(current.work.finalReceipt?.kind, 'superseded');
    assert.deepEqual(await readScan(f), { ...beforeScan, version: beforeScan.version + 1, prefer: lane === 'fresh' ? 'repair' : 'fresh' });
    const committed = JSON.stringify([...f.fake.records]);
    assert.deepEqual(await f.build().refreshSource(input), { kind: 'lookup', work: current.work });
    assert.equal(JSON.stringify([...f.fake.records]), committed);
  });

  test(`claimed ${lane} coverage advances the original source lane once and repeated claim is read-only`, async () => {
    const { f, work } = await coveredWork(lane), beforeScan = await prepareScan(f, lane);
    await f.withWorkLease(work.id, async reference => {
      f.fake.retry(); const result = await f.build().claimPart('owner', f.childId, work.id, reference);
      assert.equal(result.decision, 'lookup');
      assert.equal(result.attempt.receipt?.kind, 'superseded');
      assert.deepEqual(await readScan(f), { ...beforeScan, version: beforeScan.version + 1, prefer: lane === 'fresh' ? 'repair' : 'fresh' });
      const committed = JSON.stringify([...f.fake.records]);
      const duplicate = await f.build().claimPart('owner', f.childId, work.id, reference);
      assert.equal(duplicate.decision, 'lookup');
      assert.deepEqual(duplicate.attempt, result.attempt); assert.equal(duplicate.claim.runId, result.claim.runId);
      assert.equal(JSON.stringify([...f.fake.records]), committed);
    });
  });
}

for (const outcome of ['part_committed', 'published', 'already_covered', 'no_effect'] as const) {
  test(`settled ${outcome} changes scan preference only for new authoritative progress`, async () => {
    const f = await terminalFixture();
    await f.withWorkLease(f.work.id, async reference => {
      const part = await f.part(f.work, reference, outcome === 'part_committed' ? 4 : undefined,
        outcome === 'no_effect' ? 'failure' : 'terminal');
      await f.root.stop(part.context);
      if (outcome === 'already_covered') await f.saveAll();
      const beforeScan = await prepareScan(f, 'fresh'), before = JSON.stringify([...f.fake.records]);
      f.fake.failCommit(); await assert.rejects(f.build().finishPart(part.finish), /Synthetic transaction commit failed/u);
      assert.equal(JSON.stringify([...f.fake.records]), before);
      f.fake.retry(); const receipt = await f.build().finishPart(part.finish);
      assert.equal(receipt.kind, outcome === 'already_covered' ? 'superseded' : outcome);
      assert.deepEqual(await readScan(f), outcome === 'no_effect' ? beforeScan
        : { ...beforeScan, version: beforeScan.version + 1, prefer: 'repair' });
      const committed = JSON.stringify([...f.fake.records]);
      assert.deepEqual(await f.build().finishPart(part.finish), receipt);
      assert.equal(JSON.stringify([...f.fake.records]), committed);
    });
  });
}
