import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { privateSummaryFastFixture } from './helpers/private-summary-fast.ts';
import { createFirestorePrivateSummaryWork } from '../server/firestore-private-summary-work.ts';
import { createPrivateSummaryFastNoDispatchVerifier } from '../server/private-summary-terminal.ts';
import type { AgentRunClaim } from '../server/product-agent-store.ts';

async function fixture() {
  const f = await privateSummaryFastFixture();
  const candidate = (await f.memory.prepareMaintenance('owner', f.childId))!;
  const build = (policy = f.policy) => createFirestorePrivateSummaryWork({ ...f.options, memory: f.memory, runs: f.runs, policy,
    fastNoDispatchVerifier: createPrivateSummaryFastNoDispatchVerifier({ root: f.root, sessions: f.sessions }) });
  const service = build();
  let claim: AgentRunClaim;
  await f.withScopeLease(async reference => {
    claim = await f.authority.runTransaction('owner', f.childId, async b => {
      const result = await f.runs.prepareFastProbeClaim(b, { reference, candidate, candidateRunId: randomUUID() });
      assert.equal(result.kind, 'claimed'); if (result.kind !== 'claimed') throw new Error('Expected probe');
      result.commit(); return result.claim;
    });
    await service.bindFastRoot('owner', f.childId, claim.runId, f.context(claim));
  });
  const context = f.context(claim!);
  const certify = async (mode: 'commit' | 'lookup' = 'commit') => {
    const method = (service as unknown as { commitFastNoDispatch?: (...args: any[]) => Promise<any> }).commitFastNoDispatch;
    assert.equal(typeof method, 'function'); return method!('owner', f.childId, claim!.runId, mode);
  };
  const start = (reference?: string, store = service) => (store.start as (...args: any[]) => ReturnType<typeof store.start>)(
    'owner', f.childId, { kind: 'next_fresh' }, { reference });
  const read = () => f.authority.runTransaction('owner', f.childId, b => f.runs.read(b, claim!.runId));
  return { ...f, service, build, claim: claim!, context, certify, start, read, candidate };
}

test('the stopped original root and source commit a stable no-dispatch certificate after the execution lease has ended', async () => {
  const f = await fixture(); await f.root.open(f.context); await f.root.stop(f.context);
  const result = await f.certify(); assert.equal(result.kind, 'verified');
  const run = await f.read(); assert.equal(run.state, 'stopped'); assert.equal(run.stopReason, 'input_limit');
  assert.equal(run.summaryFast?.noDispatch?.evidenceId, result.evidenceId);
  assert.deepEqual(run.result?.counts, { modelCalls: 0, toolCalls: 0, queryEmbeddings: 0 });
  const before = JSON.stringify([...f.fake.records]); assert.deepEqual(await f.certify(), result);
  assert.equal(JSON.stringify([...f.fake.records]), before);
});

test('changed candidate content is not certified merely because its original root is empty', async () => {
  const f = await fixture(); await f.root.open(f.context); await f.root.stop(f.context);
  await f.chat.createUserMessageForUser('owner', f.childId, 'Changed original full candidate boundary');
  assert.equal((await f.certify()).kind, 'blocked'); assert.equal((await f.read()).summaryFast?.noDispatch, null);
});

test('lost certificate commit acknowledgement is recovered only from the original run and root', async () => {
  const f = await fixture(); await f.root.open(f.context); await f.root.stop(f.context);
  f.fake.loseReply(); await assert.rejects(f.certify(), /lost commit acknowledgement/u);
  const saved = await f.read(); assert.ok(saved.summaryFast?.noDispatch);
  const before = JSON.stringify([...f.fake.records]); assert.equal((await f.certify()).evidenceId, saved.summaryFast?.noDispatch?.evidenceId);
  assert.equal(JSON.stringify([...f.fake.records]), before);
});

test('T0 consumes the verified original account once and a duplicate never creates another work or grant', async () => {
  const f = await fixture(); await f.root.open(f.context); await f.root.stop(f.context); await f.certify();
  await f.withScopeLease(async reference => {
    const started = await f.start(reference); assert.equal(started.kind, 'created');
    if (started.kind !== 'created') throw new Error('Expected one transferred work');
    assert.equal((await f.read()).summaryFast?.transferredToWorkId, started.work.id);
    const before = JSON.stringify([...f.fake.records]), duplicate = await f.start(reference);
    assert.equal(duplicate.kind, 'lookup'); if (duplicate.kind !== 'lookup') throw new Error('Expected original work');
    assert.equal(duplicate.work.id, started.work.id); assert.equal(JSON.stringify([...f.fake.records]), before);
    assert.equal(f.resolutions(), 1);
  });
  await assert.rejects(f.root.reserve(f.context, { kind: 'model', key: 'late-provider', fingerprint: 'a'.repeat(64), units: 1 }), { code: 'root_stopped' });
});

test('T0 requires a current scope lease and a trusted grant and never substitutes changed source', async () => {
  const f = await fixture(); await f.root.open(f.context); await f.root.stop(f.context); await f.certify();
  assert.equal((await f.start()).kind, 'blocked'); assert.equal((await f.start(randomUUID())).kind, 'blocked');
  await f.withScopeLease(async reference => {
    const noGrant = f.build({ ...f.policy, resolveInitial: async () => null });
    assert.equal((await f.start(reference, noGrant)).kind, 'blocked');
    await f.chat.createUserMessageForUser('owner', f.childId, 'Changed source after certificate');
    assert.equal((await f.start(reference)).kind, 'blocked');
  });
  assert.equal((await f.read()).summaryFast?.transferredToWorkId, null);
});

test('lookup-only recovery cannot create a missing original no-dispatch certificate', async () => {
  const f = await fixture(); await f.root.open(f.context); await f.root.stop(f.context);
  const before = JSON.stringify([...f.fake.records]); assert.equal((await f.certify('lookup')).kind, 'blocked');
  assert.equal(JSON.stringify([...f.fake.records]), before);
  await f.certify(); assert.equal((await f.certify('lookup')).kind, 'verified');
});
