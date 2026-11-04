import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { privateSummaryFastFixture } from './helpers/private-summary-fast.ts';
import type { AgentRunClaim } from '../server/product-agent-store.ts';
import type { RootBudgetContext } from '../server/durable-root-budget.ts';

async function fixture() {
  const f = await privateSummaryFastFixture();
  const candidate = (await f.memory.prepareMaintenance('owner', f.childId))!;
  const withProbe = (callback: (claim: AgentRunClaim) => Promise<void>) => f.withScopeLease(async reference => {
    const claim = await f.authority.runTransaction('owner', f.childId, async b => {
      const result = await f.runs.prepareFastProbeClaim(b, { reference, candidate, candidateRunId: randomUUID() });
      assert.equal(result.kind, 'claimed'); if (result.kind !== 'claimed') throw new Error('Expected original probe');
      result.commit(); return result.claim;
    });
    await callback(claim);
  });
  const bind = (claim: AgentRunClaim, context = f.context(claim)) => {
    const service = f.build() as unknown as { bindFastRoot?: (userId: string, childId: string, runId: string, context: RootBudgetContext) => Promise<void> };
    assert.equal(typeof service.bindFastRoot, 'function');
    return service.bindFastRoot!('owner', f.childId, claim.runId, context);
  };
  return { ...f, withProbe, bind };
}

test('the original fast root context is durably bound before root initialization and an equal retry is read-only', async () => {
  const f = await fixture();
  await f.withProbe(async claim => {
    const context = f.context(claim); await f.bind(claim, context);
    const run = await f.authority.runTransaction('owner', f.childId, b => f.runs.read(b, claim.runId));
    assert.deepEqual(run.summaryFast?.rootContext, context);
    await assert.rejects(f.root.read(context), { code: 'root_not_found' });
    const before = JSON.stringify([...f.fake.records]); await f.bind(claim, context);
    assert.equal(JSON.stringify([...f.fake.records]), before);
  });
});

test('fast root binding rejects another original account or changed immutable profile', async () => {
  const f = await fixture();
  await f.withProbe(async claim => {
    const context = f.context(claim);
    await assert.rejects(async () => f.bind(claim, { ...context, binding: { ...context.binding, rootRunId: randomUUID() } }));
    await f.bind(claim, context);
    await assert.rejects(async () => f.bind(claim, { ...context, binding: { ...context.binding, settingsVersion: 'changed' } }));
    const run = await f.authority.runTransaction('owner', f.childId, b => f.runs.read(b, claim.runId));
    assert.deepEqual(run.summaryFast?.rootContext, context);
  });
});

test('failed binding commits and revoked source cannot initialize or replace the original fast root', async () => {
  const f = await fixture();
  await f.withProbe(async claim => {
    f.fake.failCommit(); await assert.rejects(async () => f.bind(claim));
    const run = await f.authority.runTransaction('owner', f.childId, b => f.runs.read(b, claim.runId));
    assert.equal(run.summaryFast?.rootContext, null);
    await f.chat.createUserMessageForUser('owner', f.childId, 'Changed source revision');
    await assert.rejects(async () => f.bind(claim), { code: 'agent_scope_changed' });
    await assert.rejects(f.root.read(f.context(claim)), { code: 'root_not_found' });
  });
});
