import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createEvent } from '@google/adk';
import { privateSummaryTerminalFixture as fixture } from './helpers/private-summary-terminal.ts';
import { FirestoreRootBudget } from '../server/firestore-root-budget.ts';
import type { SummaryTerminalVerifier } from '../server/firestore-private-summary-work.ts';

async function pending(partial = false) {
  const f = await fixture(); let value: Awaited<ReturnType<typeof f.part>> | undefined;
  await f.withWorkLease(f.work.id, async reference => { value = await f.part(f.work, reference, partial ? 4 : undefined); });
  const p = value!, input = { scope: p.input.scope, runId: p.input.runId, attemptId: p.input.attemptId };
  return { f, p, input };
}

test('cold recovery derives the exact original result from persisted native evidence without caller result or a new lease', async () => {
  const { f, p, input } = await pending(); await f.root.stop(p.context);
  await f.authority.runTransaction('owner', f.childId, async b => assert.equal((await f.runs.read(b, input.runId)).result, null));
  const originalUsage = (await f.build().readState('owner', f.childId, f.work.id)).usage;
  const result = await f.build().recoverTerminal(input); assert.equal(result.state, 'settled'); assert.equal(result.receipt?.kind, 'published');
  await f.authority.runTransaction('owner', f.childId, async b => assert.deepEqual((await f.runs.read(b, input.runId)).result, p.result));
  assert.deepEqual((await f.build().readState('owner', f.childId, f.work.id)).usage, originalUsage); assert.equal(f.resolutions(), 1);
  await f.sessions.deleteSession(p.key); const before = JSON.stringify([...f.fake.records]);
  assert.deepEqual(await f.build({ terminalVerifier: undefined }).recoverTerminal(input), result);
  assert.equal(JSON.stringify([...f.fake.records]), before);
});

test('cold recovery of a partial outcome survives transaction retries and lost acknowledgement without duplicate progress or outbox', async () => {
  const { f, p, input } = await pending(true); await f.root.stop(p.context);
  const before = JSON.stringify([...f.fake.records]); f.fake.failCommit();
  await assert.rejects(f.build().recoverTerminal(input), /Synthetic transaction commit failed/u); assert.equal(JSON.stringify([...f.fake.records]), before);
  f.fake.retry(); f.fake.loseReply(); await assert.rejects(f.build().recoverTerminal(input), /Synthetic lost commit acknowledgement/u);
  const result = await f.build().recoverTerminal(input); assert.equal(result.state, 'settled'); assert.equal(result.receipt?.kind, 'part_committed');
  const state = await f.build().readState('owner', f.childId, f.work.id); assert.equal(state.work.chain.committedParts, 1);
  assert.deepEqual(state.usage.used, { modelCalls: 1, toolCalls: 1 }); assert.equal((await f.memory.prepareSummary('owner', f.childId))!.previousVersion, 0);
  const sealed = JSON.stringify([...f.fake.records]); assert.deepEqual(await f.build().recoverTerminal(input), result);
  assert.equal(JSON.stringify([...f.fake.records]), sealed);
});

test('active or merely expired roots and incomplete native evidence remain unresolved without any domain write', async () => {
  const { f, p, input } = await pending();
  const initial = JSON.stringify([...f.fake.records]);
  assert.deepEqual(await f.build().recoverTerminal(input), { state: 'unknown', receipt: null }); assert.equal(JSON.stringify([...f.fake.records]), initial);
  const late = new FirestoreRootBudget({ ...f.options, namespace: 'synthetic_summary_root', serverClock: () => p.context.binding.deadlineAtMs + 1 });
  assert.equal((await late.read(p.context)).status, 'expired');
  const original = f.root.readInTransaction.bind(f.root);
  f.root.readInTransaction = late.readInTransaction.bind(late);
  assert.deepEqual(await f.build().recoverTerminal(input), { state: 'unknown', receipt: null }); assert.equal(JSON.stringify([...f.fake.records]), initial);
  f.root.readInTransaction = original; await f.root.stop(p.context);
  await f.sessions.appendEvent({ session: p.session, event: createEvent({ ...p.events[1], id: randomUUID(), timestamp: p.events[2].timestamp + 1 }) });
  const duplicate = JSON.stringify([...f.fake.records]);
  assert.deepEqual(await f.build().recoverTerminal(input), { state: 'unknown', receipt: null }); assert.equal(JSON.stringify([...f.fake.records]), duplicate);
});

test('recovery does not manufacture a caller-result parameter for the trusted verifier and cannot settle canceled runs', async () => {
  const { f, p, input } = await pending(); await f.root.stop(p.context);
  let reads = 0;
  const verifier: SummaryTerminalVerifier = { async verify(b, evidence) {
    assert.equal('result' in evidence, false, 'The verifier must only consume authoritative stored evidence'); reads++;
    return f.verifier.verify(b, evidence);
  } };
  const result = await f.build({ terminalVerifier: verifier }).recoverTerminal(input); assert.equal(result.state, 'settled'); assert.equal(reads, 1);
  const other = await pending(); await other.f.root.stop(other.p.context);
  await other.f.authority.runTransaction('owner', other.f.childId, async b => {
    const run = await other.f.runs.read(b, other.input.runId); other.f.runs.write(b, { ...run, state: 'stopped', stopReason: 'cancelled' });
  });
  const before = JSON.stringify([...other.f.fake.records]);
  assert.deepEqual(await other.f.build().recoverTerminal(other.input), { state: 'blocked', receipt: null });
  assert.equal(JSON.stringify([...other.f.fake.records]), before);
});
