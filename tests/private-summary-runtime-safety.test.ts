import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { nativeSettlementWindow, NativeSettlementTimeout } from '../server/agent-native-settlement.ts';
import { setPrivateSummarySequence } from './helpers/private-summary-sequence.ts';
import { setImmediate as nextTurn } from 'node:timers/promises';
import type { AppendEventRequest, Session } from '@google/adk';
import { FinishReason } from '@google/genai';
import { privateSummaryRootFixture } from './helpers/private-summary-root.ts';
import { createFirestorePrivateSummaryWork } from '../server/firestore-private-summary-work.ts';
import { createPrivateSummaryPartMaintenance } from '../server/private-summary-part-maintenance.ts';
import { createPrivateSummaryTerminalVerifier } from '../server/private-summary-terminal.ts';
import { createAgentRuntime, NATIVE_SESSION_CLEANUP_TIMEOUT_MS, type AgentInitialTextInput } from '../server/agent-runtime.ts';
import { claimedRunAssembly } from '../server/agent-run-assembly.ts';
import { FirestoreSessionService } from '../server/firestore-session-service.ts';
import { loadAgentPrompt } from '../server/agent-prompt.ts';
import { readAiConfig } from '../server/ai-config.ts';
import { privateSummaryWorkSchema, summaryAttemptId } from '../server/private-summary-work.ts';

async function harness(mode: 'commit_failure' | 'ack_loss' | 'cleanup_failure' | 'transport_unknown' | 'source_changed' | 'revoked' | 'over_limit' | 'mixed_parts' | 'missing_id' | 'response_append_crash' | 'stop_hang' | 'commit_hang' | 'effect_hang' | 'normal' | 'pre_stop_loss' | 'pre_stop_loss_unknown' | 'pre_stop_failure' | 'pre_stop_timeout' | 'equal_timestamps', options: { deadlineMs?: number; sequence?: string; observeFits?: (fits: (value: AgentInitialTextInput) => boolean, continuationFits?: (value: AgentInitialTextInput) => boolean) => void } = {}) {
  const f = await privateSummaryRootFixture('A complete synthetic source with a current declared preference.');
  const transactionErrors: string[] = [];
  // Observe the actual synthetic transaction boundary without changing results,
  // retries, stored data or production exceptions.
  f.options.database.runTransaction = new Proxy(f.options.database.runTransaction, {
    apply(target, receiver, args) {
      return Promise.resolve(Reflect.apply(target, receiver, args)).catch((error: unknown) => {
        transactionErrors.push(String((error as { code?: unknown })?.code ?? error)); throw error;
      });
    },
  });
  const values = { key: 'Preference', content: 'Original', source: { kind: 'manual' as const, description: 'Synthetic' }, validUntil: null };
  const candidate = (await f.memory.createFact('owner', f.childId, { values, intendedVisibility: 'private' }))!;
  const fact = (await f.memory.confirmFact('owner', f.childId, candidate.id,
    { expectedVersion: candidate.version, confirm: true, confirmShared: false }))!;
  const prompt = await loadAgentPrompt('memory-refresh', 'tool_cycle', ['run', 'scope', 'conversation', 'context', 'evidence', 'capabilities', 'outputContract']);
  f.grant.promptPackVersion = prompt.packVersion; f.profile.promptPackVersion = prompt.packVersion;
  let cleanups = 0, calls = 0, finishCalls = 0, stops = 0;
  const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
  const settlementEntered = deferred(), releaseSettlement = deferred(), settlementFinished = deferred();
  const stop = f.root.stop.bind(f.root);
  f.root.stop = async context => {
    stops++;
    if (['pre_stop_loss', 'pre_stop_loss_unknown', 'pre_stop_failure', 'pre_stop_timeout'].includes(mode) && (stops === 1 || mode === 'pre_stop_failure'))
      throw new Error('Synthetic loss before the original root stop commits');
    if (mode === 'stop_hang' || mode === 'pre_stop_timeout' && stops === 2) {
      settlementEntered.resolve(); await releaseSettlement.promise;
      try { return await stop(context); } finally { settlementFinished.resolve(); }
    }
    return stop(context);
  };
  class Sessions extends FirestoreSessionService {
    override async appendEvent(input: AppendEventRequest) {
      if (mode === 'equal_timestamps') input.event.id = input.event.author === 'user' ? 'z-marker'
        : input.event.content?.role === 'model' ? 'm-model' : 'a-response';
      if (mode === 'response_append_crash' && input.event.content?.parts?.some(part => part.functionResponse))
        throw new Error('Synthetic crash after the native model call persisted, before its response append');
      return super.appendEvent(input);
    }
    override async cleanupCreatedSession(session: Session) {
      cleanups++;
      if (mode === 'cleanup_failure') throw new Error('Synthetic cleanup failure after a known receipt');
      return super.cleanupCreatedSession(session);
    }
  }
  const sessions = new Sessions({ ...f.options, namespace: 'synthetic_summary_session' });
  const verifier = createPrivateSummaryTerminalVerifier({ root: f.root, daily: f.daily, sessions });
  const build = () => createFirestorePrivateSummaryWork({ ...f.options, memory: f.memory, runs: f.runs, policy: f.policy, terminalVerifier: verifier });
  const work = build(); await f.barrier();
  const started = await work.start('owner', f.childId, { kind: 'next_fresh' });
  assert.equal(started.kind, 'created'); if (started.kind !== 'created') throw new Error('Expected original work');
  await f.saveProfile(started.work.grantRecordId);
  if (options.sequence) setPrivateSummarySequence(f, started.work.scope.workspaceId, options.sequence);
  const attemptId = summaryAttemptId({ workId: started.work.id, sourceRevision: 1, step: 0, attempt: 0 });
  let beforeFinish: Awaited<ReturnType<typeof work.readAttempt>> | null = null;
  const readEffect = work.readEffect;
  if (mode === 'effect_hang') work.readEffect = async (...args) => {
    settlementEntered.resolve(); await releaseSettlement.promise;
    try { return await readEffect(...args); } finally { settlementFinished.resolve(); }
  };
  const finish = work.finishPart;
  work.finishPart = async input => {
    finishCalls++; beforeFinish = await work.readAttempt('owner', f.childId, attemptId);
    if (mode === 'commit_failure') f.fake.failCommit();
    if (mode === 'ack_loss') f.fake.loseReply();
    if (mode === 'source_changed') await f.memory.reviseFact('owner', f.childId, fact.id, { expectedVersion: fact.version,
      confirm: true, confirmShared: false, values: { ...values, content: 'Changed after the real native stage' }, reason: 'Synthetic correction' });
    if (mode === 'revoked') await f.authority.setAccountState({ userId: 'owner', operationId: randomUUID(), state: 'revoked' });
    if (mode === 'effect_hang') throw new Error('Synthetic lost finish outcome before receipt lookup');
    if (mode === 'commit_hang') {
      settlementEntered.resolve(); await releaseSettlement.promise;
      try { return await finish(input); } finally { settlementFinished.resolve(); }
    }
    return finish(input);
  };
  const config = readAiConfig(f.profile.env);
  const assembly = claimedRunAssembly(config, { nativeSessionService: sessions, rootBudget: f.root, dailyUsage: f.daily,
    profile: { ...f.profile, config } }, null, false, false, true);
  const runtime = createAgentRuntime({ ...assembly, config, usage: { async reserve() { throw new Error('Legacy quota'); }, async record() { throw new Error('Legacy quota'); } },
    provider: { async generate(request) {
      calls++;
      if (mode === 'transport_unknown' || mode === 'pre_stop_loss_unknown') throw new Error('Synthetic transport stopped without a durable provider result');
      const payload = JSON.parse(request.contents[0].parts![0].text!);
      return { content: { role: 'model', parts: [...(mode === 'mixed_parts' ? [{ text: 'Synthetic thought', thought: true }, { text: 'Staging the fold.' }] : []), { functionCall: { ...(mode === 'missing_id' ? {} : { id: 'native-stage' }), name: 'stage_private_summary',
        args: { text: mode === 'over_limit' ? 'x'.repeat(payload.outputTextLimit + 1) : 'A synthetic completed technical summary.' } } }] },
        finishReason: FinishReason.STOP, usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } };
    } } });
  const maintain = createPrivateSummaryPartMaintenance({ ...f.options, memory: f.memory, work, root: f.root, runtime: {
    run(input) { return runtime.run({ ...input, ...(options.deadlineMs === undefined ? {} : { deadlineMs: options.deadlineMs }),
      fitInitialInput(fits, continuationFits?: (value: AgentInitialTextInput) => boolean) {
        options.observeFits?.(fits, continuationFits);
        return input.fitInitialInput!(fits, continuationFits);
      } }); },
  } });
  let reference = '';
  const run = async () => {
    let result: Awaited<ReturnType<typeof maintain>> | undefined;
    await f.withWorkLease(started.work.id, async ref => { reference = ref;
      result = await maintain({ userId: 'owner', childId: f.childId, workId: started.work.id, reference, authorize: async () => true }); });
    assert.ok(result); return result;
  };
  const replay = () => maintain({ userId: 'owner', childId: f.childId, workId: started.work.id, reference, authorize: async () => true });
  const native = async () => {
    const attempt = beforeFinish ?? await work.readAttempt('owner', f.childId, attemptId);
    return sessions.getSession({ appName: 'yuban_hk', userId: 'owner', sessionId: attempt.runId });
  };
  return { ...f, transactionErrors, sessions, work, build, started: started.work, attemptId, run, replay, native,
    counts: () => ({ calls, finishCalls, cleanups, stops }), beforeFinish: () => beforeFinish, settlementEntered, releaseSettlement, settlementFinished };
}

test('a failed true T4 commit retains native evidence and a fresh store recovers without generating again', async () => {
  const h = await harness('commit_failure'), result = await h.run();
  assert.equal(result.state, 'unknown'); assert.equal(result.receipt, null);
  assert.equal(h.counts().cleanups, 0); assert.ok(await h.native());
  const before = await h.work.readState('owner', h.childId, h.started.id);
  assert.deepEqual(before.work.chain, h.started.chain); assert.equal((await h.memory.summary('owner', h.childId))!.summary, null);
  const attempt = h.beforeFinish()!;
  const recovered = await h.build().recoverTerminal({ scope: await h.authority.runTransaction('owner', h.childId, async b => h.runs.current(b)),
    runId: attempt.runId, attemptId: attempt.id });
  assert.equal(recovered.state, 'settled'); assert.equal(recovered.receipt?.kind, 'published');
  assert.equal(h.counts().calls, 1); assert.equal((await h.work.readState('owner', h.childId, h.started.id)).work.chain.committedParts, 1);
});

test('a lost true T4 acknowledgement reads its original receipt before cleanup and never advances twice', async () => {
  const h = await harness('ack_loss'), result = await h.run();
  assert.equal(result.state, 'completed'); assert.equal(result.receipt?.kind, 'published');
  assert.equal(await h.native(), undefined); assert.equal(h.counts().cleanups, 1);
  const before = JSON.stringify([...h.fake.records]); assert.deepEqual(await h.replay(), result);
  assert.equal(JSON.stringify([...h.fake.records]), before); assert.equal(h.counts().calls, 1);
});

test('cleanup failure cannot downgrade a true committed coverage receipt', async () => {
  const h = await harness('cleanup_failure'), result = await h.run();
  assert.equal(result.state, 'completed'); assert.equal(result.receipt?.kind, 'published');
  assert.ok(await h.native()); assert.equal(h.counts().cleanups, 1);
  assert.deepEqual(await h.replay(), result); assert.equal(h.counts().calls, 1);
});

test('an unpersisted provider outcome remains unknown with the same charged work and is never regenerated', async () => {
  const h = await harness('transport_unknown'), result = await h.run();
  assert.equal(result.state, 'unknown'); assert.equal(result.receipt, null); assert.ok(await h.native());
  assert.equal(h.counts().cleanups, 0); assert.deepEqual(await h.replay(), result); assert.equal(h.counts().calls, 1);
  const state = await h.work.readState('owner', h.childId, h.started.id);
  assert.deepEqual(state.work.chain, h.started.chain); assert.deepEqual(state.usage.used, { modelCalls: 1, toolCalls: 0 });
});

test('a true native terminal superseded by source change is not reported as queue progress or published coverage', async () => {
  const h = await harness('source_changed'), result = await h.run();
  assert.equal(result.state, 'stopped'); assert.equal(result.receipt?.kind, 'superseded');
  if (result.receipt?.kind !== 'superseded') throw new Error('Expected known superseded receipt');
  assert.equal(result.receipt.reason, 'source_changed');
  const state = await h.work.readState('owner', h.childId, h.started.id);
  assert.equal(state.work.state, 'invalidated'); assert.deepEqual(state.work.chain, h.started.chain);
  assert.equal(state.work.finalReceipt, null); assert.equal(state.work.completionWake, null);
  assert.equal((await h.memory.summary('owner', h.childId))!.summary, null);
});

test('revocation after a true native terminal blocks domain settlement while original accounting and evidence remain', async () => {
  const h = await harness('revoked'); await assert.rejects(h.run(), { code: 'account_inactive' });
  assert.equal(h.counts().cleanups, 0); assert.ok(await h.native());
  const before = h.beforeFinish()!; assert.ok(before.rootContext);
  assert.deepEqual((await h.root.read(before.rootContext)).used, { modelCalls: 1, toolCalls: 1, queryEmbeddings: 0 });
  const row = h.fake.records.get(h.data.ref('private_summary_works', 'private-summary-work', h.started.id).path);
  const work = h.data.open('private-summary-work', h.started.id, h.started.scope, privateSummaryWorkSchema,
    { exists: true, data: () => row } as never);
  assert.equal(work.finalReceipt, null); assert.deepEqual(work.chain, h.started.chain);
});

test('the real stage validator refuses output above the pinned part limit without another provider or false coverage', async () => {
  const h = await harness('over_limit'), result = await h.run();
  assert.equal(result.state, 'unknown'); assert.equal(result.receipt, null); assert.equal(h.counts().calls, 1);
  assert.equal(h.counts().cleanups, 0); assert.equal((await h.memory.summary('owner', h.childId))!.summary, null);
  assert.deepEqual((await h.work.readState('owner', h.childId, h.started.id)).work.chain, h.started.chain);
});

for (const mode of ['mixed_parts', 'missing_id'] as const) test(`a true native terminal accepts normal provider shape ${mode} without weakening its batch identity`, async () => {
  const h = await harness(mode), result = await h.run();
  assert.equal(result.state, 'completed'); assert.equal(result.receipt?.kind, 'published');
  assert.equal(h.counts().calls, 1); assert.equal(h.counts().cleanups, 1);
  const state = await h.work.readState('owner', h.childId, h.started.id);
  assert.deepEqual(state.usage.used, { modelCalls: 1, toolCalls: 1 });
  assert.equal(state.work.chain.committedParts, 1);
  assert.deepEqual(await h.replay(), result); assert.equal(h.counts().calls, 1);
});

test('coordinator replay recovers a failed T4 from the original native receipt without another provider', async () => {
  const h = await harness('commit_failure'), first = await h.run();
  assert.equal(first.state, 'unknown'); assert.equal(h.counts().cleanups, 0); assert.ok(await h.native());
  const replay = await h.replay();
  assert.equal(replay.state, 'completed'); assert.equal(replay.receipt?.kind, 'published');
  assert.equal(h.counts().calls, 1); assert.equal(h.counts().finishCalls, 1);
  assert.equal((await h.work.readState('owner', h.childId, h.started.id)).work.chain.committedParts, 1);
  const before = JSON.stringify([...h.fake.records]); assert.deepEqual(await h.replay(), replay);
  assert.equal(JSON.stringify([...h.fake.records]), before);
});

test('coordinator replay parses a persisted native stage call after a crash before response append, without replaying any handler', async () => {
  const h = await harness('response_append_crash'), first = await h.run();
  assert.equal(first.state, 'unknown'); assert.equal(first.receipt, null); assert.equal(h.counts().cleanups, 0);
  const session = await h.native(); assert.ok(session); assert.equal(session.events.length, 2);
  assert.equal(session.events[1].content?.parts?.filter(part => part.functionCall).length, 1);
  assert.ok(!session.events.some(event => event.content?.parts?.some(part => part.functionResponse)));
  const replay = await h.replay();
  assert.equal(replay.state, 'completed'); assert.equal(replay.receipt?.kind, 'published');
  assert.equal(h.counts().calls, 1); assert.equal(h.counts().finishCalls, 1);
  const state = await h.work.readState('owner', h.childId, h.started.id);
  assert.equal(state.work.chain.committedParts, 1); assert.deepEqual(state.usage.used, { modelCalls: 1, toolCalls: 1 });
  assert.equal((await h.native())!.events.length, 2, 'Recovery must not append a fabricated tool response');
  assert.deepEqual(await h.replay(), replay); assert.equal(h.counts().calls, 1);
});

for (const mode of ['stop_hang', 'commit_hang', 'effect_hang'] as const) test(`private settlement waiting is bounded at ${mode} and late completion grants no cleanup or replay`, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = await harness(mode); let returned = false;
  const pending = h.run().then(result => { returned = true; return result; });
  try {
    await h.settlementEntered.promise;
    t.mock.timers.tick(NATIVE_SESSION_CLEANUP_TIMEOUT_MS); await nextTurn();
    assert.equal(returned, true, 'Original settlement waiting bound must release the caller without awaiting the database');
    const result = await pending;
    assert.equal(result.state, 'unknown'); assert.equal(result.receipt, null);
    assert.equal(h.counts().calls, 1); assert.equal(h.counts().cleanups, 0); assert.ok(await h.native());
    h.releaseSettlement.resolve(); await h.settlementFinished.promise; await nextTurn();
    assert.equal(h.counts().cleanups, 0, 'A late acknowledgement cannot acquire native cleanup authority');
    assert.ok(await h.native());
    if (mode === 'stop_hang') {
      assert.equal(h.counts().finishCalls, 0, 'A late stop must not continue the timed-out settlement chain');
      assert.equal(await h.work.readEffect('owner', h.childId, h.attemptId), null);
    }
    if (mode === 'commit_hang') {
      assert.equal((await h.work.readEffect('owner', h.childId, h.attemptId))?.kind, 'published');
      assert.equal((await h.replay()).receipt?.kind, 'published'); assert.equal(h.counts().calls, 1);
    }
  } finally {
    h.releaseSettlement.resolve(); await pending;
  }
});

for (const variation of ['phase', 'time-and-sequence'] as const) test(`continuation capacity covers actual future native metadata growth: ${variation}`, async () => {
  let boundary: AgentInitialTextInput | undefined, currentFits = false, futureFits = false, nextActualFits = true;
  const first = await harness('normal', { deadlineMs: variation === 'phase' ? 90_000 : 9_000, observeFits(fits, continuationFits) {
    let low = 1, high = 32_000, maximum = 0;
    while (low <= high) { const middle = low + Math.floor((high - low) / 2);
      if (fits({ text: 'x'.repeat(middle) })) { maximum = middle; low = middle + 1; } else high = middle - 1; }
    boundary = { text: 'x'.repeat(maximum) }; currentFits = fits(boundary);
    // The pre-fix continuation contract uses the same current-request fit callback.
    futureFits = (continuationFits ?? fits)(boundary);
  } });
  assert.equal((await first.run()).state, 'completed'); assert.ok(boundary); assert.equal(currentFits, true);
  const second = await harness('normal', { deadlineMs: 15_000, ...(variation === 'time-and-sequence' ? { sequence: '9000000000000000000' } : {}),
    observeFits(fits) { nextActualFits = fits(boundary!); } });
  assert.equal((await second.run()).state, 'completed');
  assert.equal(nextActualFits, false, 'The real next native finish envelope is larger at the exact current-request boundary');
  assert.equal(futureFits, false, 'Continuation proof must reject a payload that the real next native request cannot admit');
  assert.equal(first.counts().calls, 1); assert.equal(second.counts().calls, 1);
});

for (const mode of ['pre_stop_loss', 'pre_stop_loss_unknown'] as const) test(`original-deadline replay freezes a pre-stop loss without interfering with a live run: ${mode}`, async t => {
  t.mock.timers.enable({ apis: ['Date'] });
  const h = await harness(mode), first = await h.run();
  assert.equal(first.state, 'unknown'); assert.equal(first.receipt, null); assert.equal(h.counts().stops, 1);
  const attempt = await h.work.readAttempt('owner', h.childId, h.attemptId); assert.ok(attempt.rootContext);
  assert.equal((await h.root.read(attempt.rootContext)).status, 'active');
  if (mode === 'pre_stop_loss') assert.equal((await h.native())!.events.length, 3);
  assert.deepEqual(await h.replay(), first); assert.equal(h.counts().stops, 1, 'Live original root must not be frozen by a duplicate');
  t.mock.timers.tick(attempt.rootContext.binding.deadlineAtMs - Date.now() + 1);
  assert.equal((await h.root.read(attempt.rootContext)).status, 'expired');
  const replay = await h.replay();
  assert.equal(h.counts().stops, 2, 'Expired original root must be frozen rather than permanently abandoned');
  assert.equal((await h.root.read(attempt.rootContext)).status, 'stopped');
  assert.equal(replay.state, mode === 'pre_stop_loss' ? 'completed' : 'unknown', JSON.stringify({ replay, transactionErrors: h.transactionErrors, attempt, root: await h.root.read(attempt.rootContext), events: (await h.native())?.events }));
  assert.equal(replay.receipt?.kind ?? null, mode === 'pre_stop_loss' ? 'published' : null);
  assert.equal(h.counts().calls, 1); assert.equal(h.counts().cleanups, 0); assert.ok(await h.native());
  const state = await h.work.readState('owner', h.childId, h.started.id);
  assert.equal(state.work.grantRecordId, h.started.grantRecordId);
  assert.deepEqual(state.usage.used, { modelCalls: 1, toolCalls: mode === 'pre_stop_loss' ? 1 : 0 });
  assert.equal(state.work.chain.committedParts, mode === 'pre_stop_loss' ? 1 : 0);
});

test('a rejection observed beyond the absolute settlement window remains timeout even before its timer callback runs', async t => {
  let now = 100;
  t.mock.method(performance, 'now', () => now);
  const settle = nativeSettlementWindow();
  const lateAuthorityError = Object.assign(new Error('Synthetic late authority result'), { code: 'account_inactive' });
  await assert.rejects(settle(async () => { now += NATIVE_SESSION_CLEANUP_TIMEOUT_MS + 1; throw lateAuthorityError; }), NativeSettlementTimeout);
  let executed = false;
  await assert.rejects(settle(async () => { executed = true; }), NativeSettlementTimeout);
  assert.equal(executed, false);
});

for (const invalid of ['marker', 'response-id', 'response-name', 'duplicate', 'multiple-terminal', 'batch-args', 'time-order'] as const)
test(`the production terminal parser rejects ${invalid} evidence and preserves original pending accounting`, async () => {
  const h = await harness('commit_failure'); assert.equal((await h.run()).state, 'unknown');
  const read = h.sessions.readSessionEvidenceInTransaction.bind(h.sessions);
  let duplicateRole = false;
  h.sessions.readSessionEvidenceInTransaction = async (...args) => {
    const snapshot = await read(...args); if (!snapshot) return snapshot;
    const altered = structuredClone(snapshot), events = [...altered.events];
    const user = events.find(event => event.author === 'user')!, model = events.find(event => event.content?.role === 'model')!;
    const response = events.find(event => event.author === 'yuban_agent' && event.content?.role === 'user')!;
    if (invalid === 'marker') user.content!.parts![0].text += ' altered';
    if (invalid === 'response-id') response.content!.parts![0].functionResponse!.id = 'wrong-native-id';
    if (invalid === 'response-name') response.content!.parts![0].functionResponse!.name = 'other_terminal';
    if (invalid === 'duplicate') {
      const extra = { ...structuredClone(model), id: randomUUID() };
      if (duplicateRole) events[events.indexOf(response)] = extra; else events.push(extra);
    }
    if (invalid === 'multiple-terminal') model.content!.parts!.push({ functionCall: { id: 'another', name: 'stage_private_summary', args: { text: 'Another' } } });
    if (invalid === 'batch-args') model.content!.parts![0].functionCall!.args = { text: 'Not the original reserved batch' };
    if (invalid === 'time-order') user.timestamp = model.timestamp + 1;
    return { ...altered, events };
  };
  const before = JSON.stringify([...h.fake.records]), replay = await h.replay();
  assert.equal(replay.state, 'unknown'); assert.equal(replay.receipt, null);
  assert.equal(JSON.stringify([...h.fake.records]), before);
  assert.equal(h.counts().calls, 1); assert.equal(h.counts().cleanups, 0);
  if (invalid === 'duplicate') {
    duplicateRole = true;
    assert.deepEqual(await h.replay(), { state: 'unknown', receipt: null });
    assert.equal(JSON.stringify([...h.fake.records]), before);
  }
});

test('an expired original freeze failure cannot publish known native text or invent a stopped-root receipt', async t => {
  t.mock.timers.enable({ apis: ['Date'] });
  const h = await harness('pre_stop_failure'); assert.equal((await h.run()).state, 'unknown');
  const attempt = await h.work.readAttempt('owner', h.childId, h.attemptId); assert.ok(attempt.rootContext);
  t.mock.timers.tick(attempt.rootContext.binding.deadlineAtMs - Date.now() + 1);
  await assert.rejects(h.replay(), /Synthetic loss before the original root stop commits/);
  assert.equal(h.counts().stops, 2); assert.equal((await h.root.read(attempt.rootContext)).status, 'expired');
  assert.equal(await h.work.readEffect('owner', h.childId, h.attemptId), null);
  assert.equal(h.counts().calls, 1); assert.equal(h.counts().cleanups, 0); assert.ok(await h.native());
});

test('expired-root recovery timeout cannot continue from a late successful freeze in the old waiting window', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  const h = await harness('pre_stop_timeout'); assert.equal((await h.run()).state, 'unknown');
  const attempt = await h.work.readAttempt('owner', h.childId, h.attemptId); assert.ok(attempt.rootContext);
  t.mock.timers.tick(attempt.rootContext.binding.deadlineAtMs - Date.now() + 1);
  const pending = h.replay();
  try {
    // Before the implementation exists the replay returns without ever attempting
    // the required freeze. Observe that directly instead of waiting on a missing call.
    await nextTurn();
    assert.equal(h.counts().stops, 2, 'Expired replay must enter the original freeze path');
    await h.settlementEntered.promise;
    t.mock.timers.tick(NATIVE_SESSION_CLEANUP_TIMEOUT_MS); await nextTurn();
    assert.deepEqual(await pending, { state: 'unknown', receipt: null });
    assert.equal(await h.work.readEffect('owner', h.childId, h.attemptId), null);
    h.releaseSettlement.resolve(); await h.settlementFinished.promise; await nextTurn();
    assert.equal((await h.root.read(attempt.rootContext)).status, 'stopped');
    assert.equal(await h.work.readEffect('owner', h.childId, h.attemptId), null, 'Late freeze cannot continue old recovery');
    assert.equal(h.counts().cleanups, 0); assert.equal(h.counts().calls, 1); assert.ok(await h.native());
    assert.equal((await h.replay()).receipt?.kind, 'published'); assert.equal(h.counts().calls, 1);
  } finally { h.releaseSettlement.resolve(); await pending; }
});

test('equal native timestamps use unique protocol identity rather than random event-id order', async t => {
  t.mock.timers.enable({ apis: ['Date'] });
  const h = await harness('equal_timestamps'), result = await h.run();
  assert.equal(result.state, 'completed'); assert.equal(result.receipt?.kind, 'published');
  assert.equal(h.counts().calls, 1); assert.equal(h.counts().cleanups, 1);
  assert.deepEqual(await h.replay(), result); assert.equal(h.counts().calls, 1);
});
