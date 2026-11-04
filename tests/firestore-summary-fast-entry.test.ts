import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as entry from '../server/firestore-private-summary-cutover.ts';
import { privateSummaryFastFixture } from './helpers/private-summary-fast.ts';
import { createFirestorePrivateSummaryWork } from '../server/firestore-private-summary-work.ts';
import type { SummaryInput } from '../src/shared/memory.ts';
import type { AgentRunClaim } from '../server/product-agent-store.ts';

async function fixture() {
  const f = await privateSummaryFastFixture(undefined, false);
  const work = f.build();
  async function probe(reference: string) {
    const candidate = (await f.memory.prepareMaintenance('owner', f.childId))!;
    return f.authority.runTransaction('owner', f.childId, async b => {
      const result = await f.runs.prepareFastProbeClaim(b, { reference, candidate, candidateRunId: randomUUID() });
      if (result.kind === 'claimed') result.commit(); return result;
    });
  }
  const withProbe = (callback: (claim: AgentRunClaim) => Promise<void>) => f.withScopeLease(async reference => {
    const result = await probe(reference); assert.equal(result.kind, 'claimed');
    if (result.kind !== 'claimed') throw new Error('Expected original probe'); await callback(result.claim);
  });
  const authorize = (claim: AgentRunClaim, selected: SummaryInput | null, service = work) =>
    f.authority.runTransaction('owner', f.childId, b => {
      const authorizeEntry = (entry as unknown as { authorizePrivateSummaryFastEntry?: (...args: any[]) => Promise<boolean> }).authorizePrivateSummaryFastEntry;
      assert.equal(typeof authorizeEntry, 'function');
      return authorizeEntry!(f.data, b, { memory: f.memory, runs: f.runs, work: service },
        { runId: claim.runId, reference: claim.trigger!.reference, selected });
    });
  return { ...f, probe, withProbe, authorize, work };
}

test('fast admission binds the complete selected payload and rejects stale text before any permit', async () => {
  const f = await fixture(); await f.activate();
  const selected = (await f.memory.prepareMaintenance('owner', f.childId))!;
  await f.withProbe(async claim => {
    const changed = structuredClone(selected); changed.messages[0].text = 'Not the actual original';
    assert.equal(await f.authorize(claim, changed), false);
    assert.equal(await f.authorize(claim, selected), true);
    assert.equal(await f.authorize(claim, selected), true);
    const source = await f.authority.runTransaction('owner', f.childId, b => f.memory.readFastSource(b,
      { kind: 'fresh_prefix', firstMessageId: selected.messages[0].id, messageCount: 1 }));
    assert.equal(source.kind, 'eligible');
    if (source.kind !== 'eligible') throw new Error('Expected source');
    assert.ok(f.fake.records.has(f.data.ref('private_summary_works', 'private-summary-lineage', source.lineageKeys[0]).path));
  });
});

test('activation between fitting and admission cannot fall back when policy is missing', async () => {
  const f = await fixture(), selected = (await f.memory.prepareMaintenance('owner', f.childId))!;
  const noPolicy = createFirestorePrivateSummaryWork({ ...f.options, memory: f.memory, runs: f.runs });
  await f.withFastRun(async claim => {
    assert.equal(await f.authorize(claim, null, noPolicy), true);
    await f.activate();
    assert.equal(await f.authorize(claim, selected, noPolicy), false);
  });
});

test('a second fast run cannot take an already bound complete prefix', async () => {
  const f = await fixture(); await f.activate();
  const selected = (await f.memory.prepareMaintenance('owner', f.childId))!;
  await f.withProbe(async first => {
    assert.equal(await f.authorize(first, selected), true);
    await f.withScopeLease(async reference => assert.equal((await f.probe(reference)).kind, 'blocked'));
  });
});

test('the same fast run cannot widen its selected prefix after admission', async () => {
  const f = await fixture(); await f.chat.createUserMessageForUser('owner', f.childId, 'Second source'); await f.activate();
  const whole = (await f.memory.prepareMaintenance('owner', f.childId))!;
  const prefix = { ...whole, messages: whole.messages.slice(0, 1), moreUncovered: true };
  await f.withProbe(async claim => {
    assert.equal(await f.authorize(claim, prefix), true);
    assert.equal(await f.authorize(claim, whole), false);
  });
});

test('successful admission is not cached across source changes or a released worker lease', async () => {
  const f = await fixture(); await f.activate();
  const selected = (await f.memory.prepareMaintenance('owner', f.childId))!;
  let original: AgentRunClaim | undefined;
  await f.withProbe(async claim => {
    original = claim;
    assert.equal(await f.authorize(claim, selected), true);
    await f.chat.createUserMessageForUser('owner', f.childId, 'New source after selection');
    assert.equal(await f.authorize(claim, selected), false);
  });
  assert.equal(await f.authorize(original!, null), false);
});
