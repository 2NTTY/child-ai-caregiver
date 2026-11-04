import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { privateSummaryPolicyFixture } from './helpers/private-summary-policy.ts';

test('the work-bound background gate uses the original live lease and survives unrelated new chat', async () => {
  const f = await privateSummaryPolicyFixture();
  await f.barrier();
  const started = await f.build().start('owner', f.childId, { kind: 'next_fresh' });
  assert.equal(started.kind, 'created');
  if (started.kind !== 'created') throw new Error('Expected work');
  const service = f.build() as unknown as { authorizeBackgroundPart: (binding: unknown, reference: string) => Promise<boolean> };
  assert.equal(typeof service.authorizeBackgroundPart, 'function');
  await f.withWorkLease(started.work.id, async reference => {
    assert.notEqual(started.work.id, f.childId);
    assert.equal(await f.authority.runTransaction('owner', f.childId, b => service.authorizeBackgroundPart(b, reference)), true);
    await f.chat.createUserMessageForUser('owner', f.childId, 'Later unrelated source');
    assert.equal(await f.authority.runTransaction('owner', f.childId, b => service.authorizeBackgroundPart(b, reference)), true);
  });
});

test('a legacy child-resource lease or an absent reference cannot authorize a work-bound part', async () => {
  const f = await privateSummaryPolicyFixture();
  const service = f.build() as unknown as { authorizeBackgroundPart: (binding: unknown, reference: string) => Promise<boolean> };
  assert.equal(typeof service.authorizeBackgroundPart, 'function');
  assert.equal(await f.authority.runTransaction('owner', f.childId, b => service.authorizeBackgroundPart(b, randomUUID())), false);
  await f.withFastRun(async claim => {
    assert.equal(claim.trigger?.kind, 'worker');
    assert.equal(await f.authority.runTransaction('owner', f.childId,
      b => service.authorizeBackgroundPart(b, claim.trigger!.reference)), false);
  });
});
