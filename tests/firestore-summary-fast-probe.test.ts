import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { privateSummaryFastFixture } from './helpers/private-summary-fast.ts';
import { createFirestoreAgentRuns } from '../server/firestore-agent-runs.ts';
import type { SummaryInput } from '../src/shared/memory.ts';
import { summaryLineageRecordSchema, summaryLineageKey, summaryManifestHash } from '../server/private-summary-work.ts';

async function fixture() {
  const f = await privateSummaryFastFixture();
  await f.chat.createUserMessageForUser('owner', f.childId, 'Second whole short source');
  const candidate = (await f.memory.prepareMaintenance('owner', f.childId))!;
  async function claim(reference: string, selected: SummaryInput = candidate) {
    return f.authority.runTransaction('owner', f.childId, async b => {
      const prepare = (f.runs as unknown as { prepareFastProbeClaim?: (...args: any[]) => Promise<any> }).prepareFastProbeClaim;
      assert.equal(typeof prepare, 'function');
      const result = await prepare!(b, { reference, candidate: selected, candidateRunId: randomUUID() });
      if (result.kind === 'claimed') result.commit();
      return result;
    });
  }
  return { ...f, candidate, claim };
}

test('an active fast probe atomically stores its original candidate and first fallback lineage before running', async () => {
  const f = await fixture();
  await f.withScopeLease(async reference => {
    const result = await f.claim(reference); assert.equal(result.kind, 'claimed');
    await f.authority.runTransaction('owner', f.childId, async b => {
      const run = await f.runs.read(b, result.claim.runId), source = await f.memory.selectSource(b, { kind: 'next_fresh' });
      assert.equal(source.kind, 'eligible'); if (source.kind !== 'eligible') throw new Error('Expected source');
      assert.equal(run.summaryFast?.manifestHash, summaryManifestHash(source.manifest));
      const key = summaryLineageKey(b.scope, source.manifest);
      assert.equal(run.summaryFast?.lineageKey, key); assert.equal(run.summaryFast?.rootContext, null);
      assert.equal(run.summaryFast?.selected, null); assert.equal(run.summaryFast?.candidate.target.kind, 'fresh_prefix');
      const row = await b.transaction.get(f.data.ref('private_summary_works', 'private-summary-lineage', key));
      const pointer = f.data.open('private-summary-lineage', key, b.scope, summaryLineageRecordSchema, row);
      assert.deepEqual(pointer.owner, { kind: 'legacy_fast', runId: run.id, triggerReference: reference,
        coveredMessageIds: [f.message.id], accounting: { state: 'unresolved' } });
    });
  });
});

test('a failed fast probe transaction leaves neither run nor pointer and duplicate delivery reuses one claim', async () => {
  const f = await fixture();
  await f.withScopeLease(async reference => {
    const before = JSON.stringify([...f.fake.records]); f.fake.failCommit();
    await assert.rejects(f.claim(reference)); assert.equal(JSON.stringify([...f.fake.records]), before);
    const first = await f.claim(reference), saved = JSON.stringify([...f.fake.records]), second = await f.claim(reference);
    assert.equal(first.kind, 'claimed'); assert.equal(second.claim.runId, first.claim.runId);
    assert.equal(second.claim.created, false); assert.equal(JSON.stringify([...f.fake.records]), saved);
  });
});

test('a later scope lease cannot create a second fast account for the same first source', async () => {
  const f = await fixture();
  await f.withScopeLease(async reference => assert.equal((await f.claim(reference)).kind, 'claimed'));
  const before = [...f.fake.records.keys()].filter(path => path.includes('_agent_runs/')).length;
  await f.withScopeLease(async reference => assert.equal((await f.claim(reference)).kind, 'blocked'));
  assert.equal([...f.fake.records.keys()].filter(path => path.includes('_agent_runs/')).length, before);
});

test('a fast probe rejects a caller payload different from the original complete candidate', async () => {
  const f = await fixture(), changed = structuredClone(f.candidate); changed.messages[0].text = 'Changed text';
  await f.withScopeLease(async reference => assert.equal((await f.claim(reference, changed)).kind, 'blocked'));
  assert.equal([...f.fake.records.keys()].some(path => path.includes('_agent_runs/')), false);
});

test('the ordinary active memory claim cannot bypass the required source binding', async () => {
  const f = await fixture();
  await f.withScopeLease(async reference => await assert.rejects(f.runs.claim('owner', f.childId,
    { kind: 'worker', reference }, 'memory-refresh'), { code: 'summary_fast_probe_required' }));
});

for (const invalid of ['part', 'wrong_resource', 'completion'] as const) test(`a live ${invalid} reference cannot admit a fast scope probe`, async () => {
  const f = await fixture();
  // The injected worker policy accepts both scope and part work. The probe must enforce its narrower own route.
  const runs = createFirestoreAgentRuns({ ...f.options, chat: f.chat, memory: f.memory, authorizeWorker: async () => true });
  const workId = randomUUID();
  const identity = invalid === 'part' ? { resourceId: workId, basis: `summary-part:v1:${workId}:1:0:0` }
    : invalid === 'completion' ? { basis: `summary-completion:v1:${'a'.repeat(64)}` } : { resourceId: randomUUID() };
  await f.withScopeLease(async reference => {
    const before = JSON.stringify([...f.fake.records]);
    const result = await f.authority.runTransaction('owner', f.childId, async b => {
      const prepared = await runs.prepareFastProbeClaim(b, { reference, candidate: f.candidate, candidateRunId: randomUUID() });
      if (prepared.kind === 'claimed') prepared.commit(); return prepared;
    });
    assert.equal(result.kind, 'blocked');
    assert.equal(JSON.stringify([...f.fake.records]), before);
  }, identity);
});
