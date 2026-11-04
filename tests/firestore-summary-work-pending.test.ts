import test from 'node:test';
import assert from 'node:assert/strict';
import { privateSummaryPolicyFixture } from './helpers/private-summary-policy.ts';
import { readContextBasis, settleSummaryRequest } from '../server/firestore-context-basis.ts';

async function fixture() {
  const f = await privateSummaryPolicyFixture(); await f.barrier();
  await f.authority.runTransaction('owner', f.childId, async b => {
    const current = await readContextBasis(f.data, b);
    await settleSummaryRequest(f.data, b, current.value.summaryRequest!, 'complete');
  });
  const before = await f.authority.runTransaction('owner', f.childId, b => readContextBasis(f.data, b));
  assert.equal(before.value.summaryPending, false);
  return { ...f, before, read: () => f.authority.runTransaction('owner', f.childId, b => readContextBasis(f.data, b)) };
}

test('T0 atomically reasserts the existing pending document without changing coalesced source/request or timing', async () => {
  const f = await fixture(); const work = await f.build().start('owner', f.childId, { kind: 'next_fresh' });
  assert.equal(work.kind, 'created');
  assert.deepEqual((await f.read()).value, { ...f.before.value, summaryPending: true });
});

test('a failed T0 commits neither the pending marker nor a work/outbox and a retry preserves one original account', async () => {
  const f = await fixture(); f.fake.failCommit();
  await assert.rejects(f.build().start('owner', f.childId, { kind: 'next_fresh' }), /Synthetic transaction commit failed/);
  assert.deepEqual((await f.read()).value, f.before.value);
  assert.equal([...f.fake.records.keys()].some(path => path.includes('_private_summary_works/')), false);
  const first = await f.build().start('owner', f.childId, { kind: 'next_fresh' }); assert.equal(first.kind, 'created');
  const second = await f.build().start('owner', f.childId, { kind: 'next_fresh' }); assert.equal(second.kind, 'lookup');
  if (first.kind !== 'created' || second.kind !== 'lookup') throw new Error('Expected one original work');
  assert.equal(first.work.id, second.work.id);
  assert.deepEqual((await f.read()).value, { ...f.before.value, summaryPending: true });
});
