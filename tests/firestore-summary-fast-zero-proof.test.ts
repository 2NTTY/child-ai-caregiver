import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvent } from '@google/adk';
import type { FirestoreSessionService } from '../server/firestore-session-service.ts';
import { FirestoreRootBudget } from '../server/firestore-root-budget.ts';
import { randomUUID } from 'node:crypto';
import * as terminal from '../server/private-summary-terminal.ts';
import { privateSummaryFastFixture } from './helpers/private-summary-fast.ts';
import type { BudgetAttempt } from '../server/durable-root-budget.ts';

async function fixture() {
  const f = await privateSummaryFastFixture();
  const candidate = (await f.memory.prepareMaintenance('owner', f.childId))!;
  let runId = '', context: ReturnType<typeof f.context>;
  await f.withScopeLease(async reference => {
    const claim = await f.authority.runTransaction('owner', f.childId, async b => {
      const result = await f.runs.prepareFastProbeClaim(b, { reference, candidate, candidateRunId: randomUUID() });
      assert.equal(result.kind, 'claimed'); if (result.kind !== 'claimed') throw new Error('Expected probe');
      result.commit(); return result.claim;
    });
    runId = claim.runId; context = f.context(claim);
    await f.build().bindFastRoot('owner', f.childId, runId, context);
  });
  async function verify(root = f.root, sessions: Pick<FirestoreSessionService, 'readSessionEvidenceInTransaction'> = f.sessions) {
    const factory = (terminal as unknown as { createPrivateSummaryFastNoDispatchVerifier?: (...args: any[]) => any }).createPrivateSummaryFastNoDispatchVerifier;
    assert.equal(typeof factory, 'function');
    const verifier = factory!({ root, sessions });
    return f.authority.runTransaction('owner', f.childId, async b => verifier.verify(b, await f.runs.read(b, runId)));
  }
  return { ...f, runId, context: context!, verify };
}

test('the original stopped zero-admission root proves no dispatch without recreating a native session', async () => {
  const f = await fixture(); await f.root.open(f.context); await f.root.stop(f.context);
  const first = await f.verify(); assert.equal(first.kind, 'verified');
  const before = JSON.stringify([...f.fake.records]); assert.deepEqual(await f.verify(), first);
  assert.equal(JSON.stringify([...f.fake.records]), before);
  assert.equal([...f.fake.records.keys()].some(path => path.includes('synthetic_summary_session')), false);
});

test('missing and merely active roots are never accepted as zero-dispatch evidence', async () => {
  const f = await fixture(); assert.equal((await f.verify()).kind, 'blocked');
  await f.root.open(f.context); assert.equal((await f.verify()).kind, 'blocked');
});

for (const kind of ['model', 'tool_batch', 'embedding'] as const) test(`an original ${kind} admission blocks zero-dispatch even after stop`, async () => {
  const f = await fixture(); await f.root.open(f.context);
  await f.root.reserve(f.context, { kind, key: 'original-admission', fingerprint: 'a'.repeat(64), units: 1 } as BudgetAttempt);
  await f.root.stop(f.context); assert.equal((await f.verify()).kind, 'blocked');
});

test('an expired but unstopped original root is not a zero-dispatch certificate', async () => {
  const f = await fixture(); await f.root.open(f.context);
  const expired = new FirestoreRootBudget({ ...f.options, namespace: 'synthetic_summary_root', serverClock: () => f.context.binding.deadlineAtMs + 1 });
  assert.equal((await f.verify(expired)).kind, 'blocked');
});

test('native model evidence contradicts and blocks an otherwise empty stopped root', async () => {
  const f = await fixture(); await f.root.open(f.context); await f.root.stop(f.context);
  const session = await f.sessions.createSession({ appName: 'yuban_hk', userId: 'owner', sessionId: f.runId });
  await f.sessions.appendEvent({ session, event: createEvent({ id: randomUUID(), invocationId: f.runId, timestamp: Date.now() / 1000,
    author: 'yuban_agent', content: { role: 'model', parts: [{ text: 'A model response exists' }] }, turnComplete: true }) });
  assert.equal((await f.verify()).kind, 'blocked');
});

test('a stored root binding mismatch propagates the integrity error instead of masquerading as missing evidence', async () => {
  const f = await fixture(); await f.root.open(f.context); await f.root.stop(f.context);
  await f.authority.runTransaction('owner', f.childId, async b => {
    const run = await f.runs.read(b, f.runId);
    f.runs.write(b, { ...run, summaryFast: { ...run.summaryFast!, rootContext: { ...f.context,
      binding: { ...f.context.binding, settingsVersion: 'wrong-original-profile' } } } });
  });
  await assert.rejects(f.verify(), { code: 'binding_conflict' });
});

async function localFitError(f: Awaited<ReturnType<typeof fixture>>, change: Record<string, unknown> = {}) {
  const session = await f.sessions.createSession({ appName: 'yuban_hk', userId: 'owner', sessionId: f.runId });
  const invocationId = 'synthetic-original-invocation', timestamp = Date.now();
  await f.sessions.appendEvent({ session, event: createEvent({ id: randomUUID(), invocationId, timestamp,
    author: 'user', content: { role: 'user', parts: [{ text: 'Synthetic complete original input' }] } }) });
  await f.sessions.appendEvent({ session, event: createEvent({ id: randomUUID(), invocationId, timestamp: timestamp + 1,
    author: 'yuban_agent', errorCode: 'UNKNOWN_ERROR', errorMessage: 'input_limit', ...change }) });
}

test('the exact content-free native error for a local capacity fit is consistent with an original stopped empty root', async () => {
  const f = await fixture(); await f.root.open(f.context); await f.root.stop(f.context); await localFitError(f);
  assert.equal((await f.verify()).kind, 'verified');
});

test('nearby native errors, effects, mismatched events and any admitted root cannot prove a local capacity stop', async () => {
  const changes = [
    { errorMessage: 'input_limit ' }, { errorCode: 'OTHER_ERROR' }, { content: { role: 'model', parts: [{ text: 'Output' }] } },
    { usageMetadata: { promptTokenCount: 1 } }, { partial: true }, { invocationId: 'another-invocation' }, { branch: 'another-branch' },
    { timestamp: 1 }, { actions: { stateDelta: { changed: true }, artifactDelta: {}, requestedAuthConfigs: {}, requestedToolConfirmations: {} } },
    { actions: { transferToAgent: 'another-agent', stateDelta: {}, artifactDelta: {}, requestedAuthConfigs: {}, requestedToolConfirmations: {} } },
    { longRunningToolIds: ['unexpected-tool'] },
  ];
  for (const change of changes) {
    const f = await fixture(); await f.root.open(f.context); await f.root.stop(f.context);
    // Native append intentionally does not persist partial events. Inject that malformed reader-visible shape explicitly.
    await localFitError(f, change.partial ? {} : change);
    const sessions = change.partial ? { async readSessionEvidenceInTransaction(...args: Parameters<FirestoreSessionService['readSessionEvidenceInTransaction']>) {
      const value = await f.sessions.readSessionEvidenceInTransaction(...args);
      return value ? { ...value, events: value.events.map(event => event.author === 'yuban_agent' ? { ...event, partial: true } : event) } : value;
    } } : f.sessions;
    assert.equal((await f.verify(f.root, sessions)).kind, 'blocked', JSON.stringify(change));
  }
  const f = await fixture(); await f.root.open(f.context);
  await f.root.reserve(f.context, { kind: 'model', key: 'actual-model-admission', fingerprint: 'a'.repeat(64), units: 1 });
  await f.root.stop(f.context); await localFitError(f); assert.equal((await f.verify()).kind, 'blocked');
});
