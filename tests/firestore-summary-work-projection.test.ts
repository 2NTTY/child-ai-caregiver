import test from 'node:test';
import assert from 'node:assert/strict';
import { privateSummaryPolicyFixture } from './helpers/private-summary-policy.ts';

test('work creation and claim rebuild authenticated state projections', async () => {
  const f = await privateSummaryPolicyFixture();
  await f.barrier();
  const service = f.build();
  const started = await service.start('owner', f.childId, { kind: 'next_fresh' });
  assert.equal(started.kind, 'created');
  if (started.kind !== 'created') throw new Error('Expected work');
  const projection = () => f.authority.runTransaction('owner', f.childId, async b => {
    const row = await b.transaction.get(f.data.ref('private_summary_works', 'private-summary-work', started.work.id));
    return { state: row.get('workState'), wake: row.get('completionWakeState'), version: row.get('recordVersion') };
  });
  assert.deepEqual(await projection(), { state: 'ready', wake: 'none', version: 1 });
  await f.withWorkLease(started.work.id, async reference => {
    const claim = await service.claimPart('owner', f.childId, started.work.id, reference);
    assert.equal(claim.decision, 'execute');
    const current = await service.readState('owner', f.childId, started.work.id);
    assert.deepEqual(await projection(), { state: 'executing', wake: 'none', version: current.work.version });
  });
});

test('a work-state query projection cannot hide an unfinished encrypted work', async () => {
  const f = await privateSummaryPolicyFixture();
  await f.barrier();
  const service = f.build();
  const started = await service.start('owner', f.childId, { kind: 'next_fresh' });
  assert.equal(started.kind, 'created');
  if (started.kind !== 'created') throw new Error('Expected work');
  await f.authority.runTransaction('owner', f.childId, async b => {
    const ref = f.data.ref('private_summary_works', 'private-summary-work', started.work.id);
    await b.transaction.get(ref);
    b.transaction.update(ref, { workState: 'completed' });
  });
  await assert.rejects(() => service.readState('owner', f.childId, started.work.id),
    (error: { code?: string }) => error.code === 'private_summary_work_projection');
});
