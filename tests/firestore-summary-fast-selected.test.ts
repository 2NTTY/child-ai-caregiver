import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { privateSummaryFastFixture } from './helpers/private-summary-fast.ts';
import { summaryLineageRecordSchema } from '../server/private-summary-work.ts';
import type { AgentRunClaim } from '../server/product-agent-store.ts';

async function fixture() {
  const f = await privateSummaryFastFixture();
  await f.chat.createUserMessageForUser('owner', f.childId, 'Second short source');
  const candidate = (await f.memory.prepareMaintenance('owner', f.childId))!;
  const target = { kind: 'fresh_prefix' as const, firstMessageId: candidate.messages[0].id, messageCount: 2 };
  const fullSource = await f.authority.runTransaction('owner', f.childId, b => f.memory.readFastSource(b, target));
  if (fullSource.kind !== 'eligible') throw new Error('Expected complete prefix');
  async function withProbe(callback: (claim: AgentRunClaim) => Promise<void>) {
    await f.withScopeLease(async reference => {
      const result = await f.authority.runTransaction('owner', f.childId, async b => {
        const prepared = await f.runs.prepareFastProbeClaim(b, { reference, candidate, candidateRunId: randomUUID() });
        assert.equal(prepared.kind, 'claimed'); if (prepared.kind !== 'claimed') throw new Error('Expected probe');
        prepared.commit(); return prepared.claim;
      });
      await callback(result);
    });
  }
  const admit = (claim: AgentRunClaim, count = 2) => f.authority.runTransaction('owner', f.childId, async b => {
    const selectedTarget = { ...target, messageCount: count }, selected = await f.memory.readFastSource(b, selectedTarget);
    if (selected.kind !== 'eligible') throw new Error('Expected source');
    const result = await f.build().prepareFastAdmission(b, { runId: claim.runId, reference: claim.trigger!.reference,
      target: selectedTarget, expectedSourceHash: selected.sourceHash });
    if (result.kind !== 'blocked') result.commit(); return result;
  });
  return { ...f, target, fullSource, withProbe, admit };
}

test('a fitted complete prefix atomically expands only its original provisional pointer and binds selected once', async () => {
  const f = await fixture();
  await f.withProbe(async claim => {
    assert.equal([...f.fake.records.keys()].filter(path => path.includes('_private_summary_works/')).length, 1);
    assert.equal((await f.admit(claim)).kind, 'prepared');
    const run = await f.authority.runTransaction('owner', f.childId, b => f.runs.read(b, claim.runId));
    assert.deepEqual(run.summaryFast?.selected, { sourceHash: f.fullSource.sourceHash, coveredMessageIds: f.fullSource.input.messages.map(x => x.id) });
    assert.equal(run.summaryFast?.candidate.sourceHash, f.fullSource.sourceHash);
    assert.equal([...f.fake.records.keys()].filter(path => path.includes('_private_summary_works/')).length, 2);
    const before = JSON.stringify([...f.fake.records]); assert.equal((await f.admit(claim)).kind, 'lookup');
    assert.equal(JSON.stringify([...f.fake.records]), before);
  });
});

test('a smaller whole prefix keeps the original candidate identity and cannot later widen selected', async () => {
  const f = await fixture();
  await f.withProbe(async claim => {
    assert.equal((await f.admit(claim, 1)).kind, 'prepared');
    const run = await f.authority.runTransaction('owner', f.childId, b => f.runs.read(b, claim.runId));
    assert.equal(run.summaryFast?.candidate.sourceHash, f.fullSource.sourceHash);
    assert.notEqual(run.summaryFast?.selected?.sourceHash, run.summaryFast?.candidate.sourceHash);
    assert.deepEqual(run.summaryFast?.selected?.coveredMessageIds, [f.message.id]);
    assert.equal((await f.admit(claim, 2)).kind, 'blocked');
  });
});

test('a changed full candidate cannot be replaced with newer data under the original fast probe', async () => {
  const f = await fixture();
  await f.withProbe(async claim => {
    await f.chat.createUserMessageForUser('owner', f.childId, 'New data changes the original candidate');
    await assert.rejects(f.admit(claim), { code: 'agent_scope_changed' });
    const run = await f.authority.runTransaction('owner', f.childId, b => f.runs.read(b, claim.runId));
    assert.equal(run.summaryFast?.selected, null);
  });
});

test('a validly encrypted lineage cannot disagree with its authenticated record version', async () => {
  const f = await fixture();
  await f.withProbe(async claim => {
    await f.authority.runTransaction('owner', f.childId, async b => {
      const run = await f.runs.read(b, claim.runId), key = run.summaryFast!.lineageKey;
      const ref = f.data.ref('private_summary_works', 'private-summary-lineage', key);
      const value = f.data.open('private-summary-lineage', key, b.scope, summaryLineageRecordSchema, await b.transaction.get(ref));
      b.transaction.set(ref, { ...f.data.tags(b.scope), ...f.data.seal('private-summary-lineage', key, b.scope, summaryLineageRecordSchema, value, value.version + 1) });
    });
    await assert.rejects(f.admit(claim), { code: 'private_summary_binding' });
  });
});
