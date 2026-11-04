import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { summaryRestoreFastFixture } from './helpers/summary-restore-fast.ts';
import { firestoreAgentRunSchema } from '../server/firestore-agent-runs.ts';
import { privateSummaryWorkSchema, privateSummaryUsageSchema, summaryLineageRecordSchema } from '../server/private-summary-work.ts';
import { privateSummaryCutoverSchema } from '../server/private-summary-scan.ts';
import { firestoreUsageRecoverySchemas } from '../server/firestore-ai-usage.ts';
import { agentBudgetFingerprint } from '../server/agent-budget.ts';
import { canonical } from '../server/firestore-session-codec.ts';

const rejected = (error: unknown) => error instanceof Error && 'code' in error && String(error.code).startsWith('restore_summary_');

test('restore merges an actual provisional fast probe into its selected prefix and preserves the original bound root', async () => {
  const f = await summaryRestoreFastFixture('selected'), result = f.restore(f.probe, f.current), records = f.domain(result.records);
  const original = f.run(), restored = firestoreAgentRunSchema.parse(records.find(row => row.context.kind === 'agent-run' && row.context.id === original.id)!.value);
  assert.deepEqual(restored.summaryFast, original.summaryFast); assert.equal(restored.storageEpoch, original.storageEpoch);
  assert.equal(restored.state, 'unknown'); assert.equal(f.rootValue(result.records).status, 'stopped');
  const lineages = records.filter(row => row.context.kind === 'private-summary-lineage').map(row => summaryLineageRecordSchema.parse(row.value));
  assert.equal(lineages.length, f.candidate.messages.length);
  for (const pointer of lineages) {
    assert.equal(pointer.owner.kind, 'legacy_fast'); if (pointer.owner.kind !== 'legacy_fast') throw new Error('Expected original fast owner');
    assert.deepEqual(pointer.owner.coveredMessageIds, original.summaryFast!.selected!.coveredMessageIds);
    assert.equal(pointer.scope.storageEpoch, original.storageEpoch);
  }
  const guards = records.filter(row => row.context.kind === 'private-summary-cutover')
    .map(row => privateSummaryCutoverSchema.parse(row.value)).filter(row => row.scope.storageEpoch !== original.storageEpoch);
  assert.equal(guards.length, 1); assert.equal(guards[0].phase, 'restore_suspended');
});

test('restore merges a verified no-dispatch history without treating its original certificate as a new transfer permit', async () => {
  const f = await summaryRestoreFastFixture('certificate'), result = f.restore(f.probe, f.current), records = f.domain(result.records);
  const restored = firestoreAgentRunSchema.parse(records.find(row => row.context.kind === 'agent-run' && row.context.id === f.claim.runId)!.value);
  assert.deepEqual(restored.summaryFast, f.run().summaryFast); assert.equal(restored.state, 'stopped');
  assert.equal(restored.storageEpoch, f.scope.storageEpoch); assert.equal(restored.summaryFast!.transferredToWorkId, null);
  assert.equal(f.rootValue(result.records).status, 'stopped'); assert.deepEqual(f.rootValue(result.records).attempts, []);
  assert.equal(records.some(row => row.context.kind === 'private-summary-work' || row.context.kind === 'private-summary-grant'), false);
  assert.equal(records.filter(row => row.context.kind === 'private-summary-cutover' && privateSummaryCutoverSchema.parse(row.value).phase === 'restore_suspended').length, 1);
});

test('restore retains the original fast run and zero root after its unique work transfer even though the work has no original-run field', async () => {
  const f = await summaryRestoreFastFixture('transferred'), result = f.restore(), records = f.domain(result.records), original = f.run();
  const restored = firestoreAgentRunSchema.parse(records.find(row => row.context.kind === 'agent-run' && row.context.id === original.id)!.value);
  assert.deepEqual(restored.summaryFast, original.summaryFast); assert.equal(restored.storageEpoch, original.storageEpoch);
  const work = privateSummaryWorkSchema.parse(records.find(row => row.context.kind === 'private-summary-work')!.value);
  assert.equal(work.id, original.summaryFast!.transferredToWorkId); assert.equal(work.state, 'restore_suspended');
  const usage = privateSummaryUsageSchema.parse(records.find(row => row.context.kind === 'private-summary-usage')!.value);
  assert.equal(usage.workId, work.id); assert.deepEqual(usage.used, { modelCalls: 0, toolCalls: 0 });
  assert.equal(f.rootValue(result.records).status, 'stopped'); assert.equal(f.rootValue(result.records).attempts.length, 0);
  assert.equal(result.records.some(row => row.path.startsWith(f.options.namespace + '_adk/')), false);
});

test('restore rejects changes to the immutable source, pinned root, certificate or unique transferred work identity', async () => {
  const f = await summaryRestoreFastFixture('transferred'), original = f.run();
  const changes = [
    { ...original.summaryFast!, manifestHash: 'a'.repeat(64) },
    { ...original.summaryFast!, rootContext: { ...original.summaryFast!.rootContext!, generation: original.summaryFast!.rootContext!.generation + 1 } },
    { ...original.summaryFast!, noDispatch: { evidenceId: 'b'.repeat(64) } },
    { ...original.summaryFast!, transferredToWorkId: randomUUID() },
  ];
  for (const summaryFast of changes) {
    const live = structuredClone(f.current); f.replaceRun(live, { ...original, summaryFast });
    assert.throws(() => f.restore(f.current, live), rejected);
  }
});

test('restore requires a certified fast root to exist, match the original binding, have stopped before certification and contain no admissions', async () => {
  const f = await summaryRestoreFastFixture('certificate');
  const missing = f.current.filter(row => row.path !== f.rootPath);
  assert.throws(() => f.restore(missing), rejected);
  for (const value of [
    { ...f.rootValue(), status: 'active' as const },
    { ...f.rootValue(), generation: f.rootValue().generation + 1 },
    { ...f.rootValue(), used: { modelCalls: 1, toolCalls: 0, queryEmbeddings: 0 }, attempts: [
      { request: { kind: 'model' as const, key: 'original-model', fingerprint: 'c'.repeat(64), units: 1 as const }, outcome: { status: 'unknown' as const } }] },
  ]) {
    const invalid = structuredClone(f.current); f.replaceRoot(invalid, value);
    assert.throws(() => f.restore(invalid), rejected);
  }
  const invalidCertificate = structuredClone(f.current), original = f.run(), evidenceId = 'd'.repeat(64);
  f.replaceRun(invalidCertificate, { ...original, summaryFast: { ...original.summaryFast!, noDispatch: { evidenceId } } });
  for (const row of f.domain(invalidCertificate).filter(row => row.context.kind === 'private-summary-lineage')) {
    const pointer = summaryLineageRecordSchema.parse(row.value);
    assert.equal(pointer.owner.kind, 'legacy_fast'); if (pointer.owner.kind !== 'legacy_fast') throw new Error('Expected original pointer');
    f.replaceLineage(invalidCertificate, { ...pointer, owner: { ...pointer.owner, accounting: { state: 'no_dispatch', evidenceId } } });
  }
  assert.throws(() => f.restore(invalidCertificate), rejected);
  const dailyConflict = structuredClone(f.current), collection = f.options.namespace + '_ai_usage';
  const request = { rootRunId: f.claim.runId, attemptKey: 'original-model', bindingFingerprint: agentBudgetFingerprint(f.context),
    requestFingerprint: 'e'.repeat(64), userId: 'owner', childId: f.childId, model: 'synthetic-model',
    deadlineAtMs: f.context.binding.deadlineAtMs, userLimit: 10, globalLimit: 10 };
  const id = 'attempt_' + createHash('sha256').update(canonical([request.rootRunId, request.attemptKey])).digest('hex');
  const value = firestoreUsageRecoverySchemas.attempt.parse({ request, billingSource: 'platform', day: '2026-11-04', reservedAtMs: 1, record: null });
  dailyConflict.push({ path: collection + '/' + id, data: { format: 'yuban-ai-daily-usage', version: 1,
    ciphertext: f.options.cipher.encrypt(canonical(value), canonical(['yuban-ai-daily-usage', 1, f.options.projectId, collection, id])) } });
  for (const userId of [null, 'owner']) {
    const counterId = 'daily_' + createHash('sha256').update(canonical(['platform', value.day, userId])).digest('hex');
    const counter = firestoreUsageRecoverySchemas.counter.parse({ attempts: 1, inputTokens: 0, outputTokens: 0, cachedTokens: 0, known: 0 });
    dailyConflict.push({ path: collection + '/' + counterId, data: { format: 'yuban-ai-daily-usage', version: 1,
      ciphertext: f.options.cipher.encrypt(canonical(counter), canonical(['yuban-ai-daily-usage', 1, f.options.projectId, collection, counterId])) } });
  }
  assert.throws(() => f.restore(dailyConflict), rejected);
});

test('a post-snapshot zero transfer keeps the original dormant pointer and consumed-run marker across repeated restore without reviving work content', async () => {
  const f = await summaryRestoreFastFixture('transferred'), original = f.run(), snapshot = f.certificate!;
  const pointer = summaryLineageRecordSchema.parse(f.domain(snapshot).find(row => row.context.kind === 'private-summary-lineage')!.value);
  const first = f.restore(snapshot, f.current);
  for (const result of [first, f.restore(first.records, first.records, first.generation, randomUUID())]) {
    const records = f.domain(result.records);
    const restoredPointer = summaryLineageRecordSchema.parse(records.find(row => row.context.kind === 'private-summary-lineage')!.value);
    assert.deepEqual(restoredPointer, pointer);
    const restoredRun = firestoreAgentRunSchema.parse(records.find(row => row.context.kind === 'agent-run' && row.context.id === original.id)!.value);
    assert.deepEqual(restoredRun.summaryFast, original.summaryFast); assert.equal(restoredRun.storageEpoch, original.storageEpoch);
    assert.equal(records.some(row => ['private-summary-work', 'private-summary-revision', 'private-summary-attempt'].includes(row.context.kind)), false);
    const usage = records.filter(row => row.context.kind === 'private-summary-usage').map(row => privateSummaryUsageSchema.parse(row.value));
    assert.equal(usage.length, 1); assert.equal(usage[0].workId, original.summaryFast!.transferredToWorkId);
    assert.equal(records.filter(row => row.context.kind === 'private-summary-grant').length, 1);
    assert.equal(f.rootValue(result.records).status, 'stopped'); assert.deepEqual(f.rootValue(result.records).attempts, []);
    const guards = records.filter(row => row.context.kind === 'private-summary-cutover' && privateSummaryCutoverSchema.parse(row.value).scope.storageEpoch === result.newEpochByWorkspace.get(f.scope.workspaceId))
      .map(row => privateSummaryCutoverSchema.parse(row.value));
    assert.equal(guards.length, 1); assert.equal(guards[0].phase, 'restore_suspended');
  }
});
