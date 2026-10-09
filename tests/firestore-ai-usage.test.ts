import assert from 'node:assert/strict';
import test from 'node:test';
import { agentBudgetFingerprint } from '../server/agent-budget.ts';
import { FirestoreAiUsage, type FirestoreAiUsageOptions } from '../server/firestore-ai-usage.ts';
import { DurableAiUsageError, type DurableAiUsageRecord, type DurableAiUsageRequest } from '../server/durable-ai-usage.ts';
import { firestoreUsageFixture } from './helpers/firestore-ai-usage.ts';

const now = Date.parse('2026-10-09T12:00:00Z');
const request = (patch: Partial<DurableAiUsageRequest> = {}): DurableAiUsageRequest => ({ rootRunId: 'synthetic-root',
  attemptKey: 'model:original-step', bindingFingerprint: agentBudgetFingerprint('original-bound-scope'),
  requestFingerprint: agentBudgetFingerprint('synthetic-original-request'), userId: 'synthetic-user', childId: 'synthetic-child',
  model: 'synthetic-model', deadlineAtMs: now + 90000, userLimit: 20, globalLimit: 100, ...patch });
const known: DurableAiUsageRecord = { outcome: 'succeeded', inputTokens: 12, outputTokens: 3, cachedTokens: 4, durationMs: 25 };
const code = (value: string) => (error: unknown) => error instanceof DurableAiUsageError && error.code === value;

test('daily usage constructor is inert, requires trusted configuration and never owns client lifecycle', async () => {
  const f = firestoreUsageFixture();
  assert.deepEqual(f.transactions, []); assert.equal(f.records.size, 0);
  for (const patch of [{ database: undefined }, { cipher: undefined }, { projectId: '' }, { projectId: ' unsafe ' },
    { namespace: 'bad/path' }, { billingSource: 'external' }, { serverClock: 1 }])
    assert.throws(() => new FirestoreAiUsage({ ...f.options, ...patch } as unknown as FirestoreAiUsageOptions), code('invalid_configuration'));
  assert.equal('close' in f.service, false); assert.equal('delete' in f.service, false);
  assert.equal((await f.service.getForUser('synthetic-user')).attempts, 0); assert.equal(f.records.size, 0);
  await assert.rejects(f.service.reserve(request({ userLimit: 1001 })), code('invalid_request'));
  await assert.rejects(f.service.reserve(request({ globalLimit: 10001 })), code('invalid_request'));
});

test('concurrent same-attempt reservations issue one grant across instances and discarded transaction callbacks', async () => {
  const f = firestoreUsageFixture(), restarted = new FirestoreAiUsage(f.options), input = request(); f.retryCallback();
  const results = await Promise.all([f.service.reserve(input), restarted.reserve(input)]);
  assert.deepEqual(results.map(result => result.decision).sort(), ['execute', 'lookup']);
  assert.equal((await restarted.getForUser(input.userId)).attempts, 1); assert.equal(f.records.size, 3);
  assert.deepEqual(await restarted.read(input), { day: '2026-10-09', reservedAtMs: now, record: null });
  assert.ok(f.transactions.every(tx => tx.reads <= 3 && tx.writes <= 3));
  const encoded = JSON.stringify([...f.records]);
  for (const secret of [input.userId, input.childId, input.rootRunId, input.model, input.requestFingerprint]) assert.equal(encoded.includes(secret), false);
});

test('the original attempt binds scope, model, payload, limits and billing rather than silently rebinding', async () => {
  const f = firestoreUsageFixture(), input = request(); await f.service.reserve(input);
  for (const patch of [{ userId: 'other' }, { childId: 'other' }, { model: 'other' }, { bindingFingerprint: 'a'.repeat(64) },
    { requestFingerprint: 'b'.repeat(64) }, { userLimit: 21 }, { globalLimit: 101 }, { deadlineAtMs: now + 90001 }]) {
    await assert.rejects(f.service.reserve(request(patch)), code('attempt_conflict'));
    await assert.rejects(f.service.read(request(patch)), code('attempt_conflict'));
    await assert.rejects(f.service.record(request(patch), known), code('attempt_conflict'));
  }
  const personal = new FirestoreAiUsage({ ...f.options, billingSource: 'personal' });
  await assert.rejects(personal.reserve(input), code('attempt_conflict'));
  assert.equal((await f.service.getForUser(input.userId)).attempts, 1);
  assert.equal((await personal.getForUser(input.userId)).attempts, 0);
});

test('both user and global limits are atomic and platform/personal counters stay separate', async () => {
  const f = firestoreUsageFixture();
  const requests = Array.from({ length: 4 }, (_, i) => request({ rootRunId: `root-${i}`, userId: `user-${i}`, globalLimit: 2 }));
  const results = await Promise.all(requests.map(input => new FirestoreAiUsage(f.options).reserve(input)));
  assert.equal(results.filter(result => result.decision === 'execute').length, 2);
  assert.equal(results.filter(result => result.decision === 'quota_exceeded').length, 2);
  assert.equal(await f.service.read(requests[2]), null);
  assert.equal((await f.service.getForUser('user-2')).attempts, 0);
  const personal = new FirestoreAiUsage({ ...f.options, billingSource: 'personal' });
  const first = request({ rootRunId: 'personal-one', userLimit: 1 });
  assert.equal((await personal.reserve(first)).decision, 'execute');
  assert.equal((await personal.reserve({ ...first, attemptKey: 'second' })).decision, 'quota_exceeded');
  assert.equal((await personal.getForUser(first.userId)).attempts, 1);
  assert.equal((await f.service.getForUser(first.userId)).attempts, 0);
});

test('lost commit reply persists unknown accounting and can only be looked up after restart', async () => {
  const f = firestoreUsageFixture(), input = request(); f.loseReply();
  await assert.rejects(f.service.reserve(input), /Synthetic lost commit reply/);
  const restarted = new FirestoreAiUsage(f.options);
  assert.equal((await restarted.reserve(input)).decision, 'lookup');
  assert.equal((await restarted.read(input))?.record, null);
  assert.equal((await restarted.getForUser(input.userId)).unknownUsageAttempts, 1);
  const failed = firestoreUsageFixture(); failed.failCommit();
  await assert.rejects(failed.service.reserve(input), /Synthetic failed commit/);
  assert.equal(failed.records.size, 0); assert.equal(await failed.service.read(input), null);
});

test('cross-midnight retry cannot charge a new day and late records update only the original day', async () => {
  const midnight = Date.parse('2026-10-09T23:59:59Z'), f = firestoreUsageFixture(midnight);
  const input = request({ deadlineAtMs: midnight + 90000 }); await f.service.reserve(input);
  f.setNow(midnight + 100000);
  assert.equal((await f.service.reserve(input)).decision, 'lookup');
  assert.equal((await f.service.getForUser(input.userId)).attempts, 0);
  assert.equal((await f.service.record(input, known)).day, '2026-10-09');
  assert.equal((await f.service.getForUser(input.userId)).inputTokens, 0);
  await assert.rejects(f.service.reserve({ ...input, attemptKey: 'new-step' }), code('deadline_exceeded'));
  f.setNow(midnight);
  assert.deepEqual(await f.service.getForUser(input.userId), { day: '2026-10-09', attempts: 1,
    inputTokens: 12, outputTokens: 3, cachedTokens: 4, unknownUsageAttempts: 0, billingSource: 'platform' });
});

test('settlement is idempotent across lost replies/retries and conflicting late outcomes cannot overwrite it', async () => {
  const f = firestoreUsageFixture(), input = request(); await f.service.reserve(input);
  f.retryCallback(); f.loseReply();
  await assert.rejects(f.service.record(input, known), /Synthetic lost commit reply/);
  assert.deepEqual((await new FirestoreAiUsage(f.options).record(input, known)).record, known);
  assert.equal((await f.service.getForUser(input.userId)).inputTokens, 12);
  await assert.rejects(f.service.record(input, { ...known, inputTokens: 99 }), code('record_conflict'));
  await assert.rejects(f.service.record({ ...input, attemptKey: 'missing' }, known), code('attempt_not_found'));
  await assert.rejects(f.service.record(input, { ...known, inputTokens: -1 }), code('invalid_record'));
  assert.equal((await f.service.reserve(input)).decision, 'lookup');
});

test('unknown or partial token metadata never refunds quota or falsely counts as fully known', async () => {
  const f = firestoreUsageFixture(), a = request(), b = request({ attemptKey: 'second' });
  await f.service.reserve(a); await f.service.reserve(b);
  await f.service.record(a, { outcome: 'timeout', inputTokens: null, outputTokens: null, cachedTokens: null, durationMs: 100 });
  await f.service.record(b, { ...known, cachedTokens: null });
  assert.deepEqual(await f.service.getForUser(a.userId), { day: '2026-10-09', attempts: 2,
    inputTokens: 12, outputTokens: 3, cachedTokens: 0, unknownUsageAttempts: 2, billingSource: 'platform' });
  await assert.rejects(f.service.record(a, known), code('record_conflict'));
});

test('ciphertext copying, wrong project pairing and missing accounting state fail closed', async () => {
  const f = firestoreUsageFixture(), input = request(); await f.service.reserve(input);
  await assert.rejects(new FirestoreAiUsage({ ...f.options, projectId: 'different-project' }).read(input), code('ciphertext_rejected'));
  const keys = [...f.records.keys()], attemptKey = keys.find(key => key.includes('/attempt_'))!;
  const counter = keys.find(key => key.includes('/daily_'))!;
  const saved = f.records.get(attemptKey); f.records.set(attemptKey, f.records.get(counter));
  await assert.rejects(f.service.read(input), code('ciphertext_rejected')); f.records.set(attemptKey, saved);
  f.records.delete(counter);
  await assert.rejects(f.service.record(input, known), code('counter_not_found'));
  assert.equal((await f.service.read(input))?.record, null);
});
