import assert from 'node:assert/strict';
import test from 'node:test';
import { summaryWorkGrantSchema, summaryGrantRecordSchema, summaryLineageRecordSchema,
  summaryGrantRecordId } from '../server/private-summary-work.ts';

const workId = '00000000-0000-4000-8000-000000000001';
const grantId = '00000000-0000-4000-8000-000000000002';
const childId = '00000000-0000-4000-8000-000000000003';
const generation = '00000000-0000-4000-8000-000000000004';
const grant = { grantId, revision: 1, policyVersion: 'synthetic-policy-v1', settingsVersion: 'synthetic-settings-v1',
  promptPackVersion: 'synthetic-pack-v1', billingSource: 'platform' as const, billingVersion: 'synthetic-billing-v1',
  model: 'synthetic-model', limits: { modelCalls: 3, toolCalls: 3 }, workDeadlineAt: null, retryPolicyVersion: 'synthetic-retry-v1' };
const scope = { ownerUserId: 'synthetic-owner', workspaceId: workId, childId, storageEpoch: grantId };

test('persisted work grants require every policy binding and an explicit bounded or absent deadline', () => {
  assert.deepEqual(summaryWorkGrantSchema.parse(grant), grant);
  assert.equal(summaryWorkGrantSchema.safeParse({ ...grant, workDeadlineAt: '2026-11-05T00:00:00.000Z' }).success, true);
  for (const bad of [{ ...grant, workDeadlineAt: undefined }, { ...grant, policyVersion: '' },
    { ...grant, revision: 0 }, { ...grant, limits: { modelCalls: 0.5, toolCalls: 3 } },
    { ...grant, limits: { modelCalls: Number.MAX_SAFE_INTEGER + 1, toolCalls: 3 } },
    { ...grant, billingSource: 'unbound' }, { ...grant, guessedDefault: true }]) {
    assert.equal(summaryWorkGrantSchema.safeParse(bad).success, false);
  }
  // No new work ceiling is inferred from the existing per-dispatch budget.
  assert.equal(summaryWorkGrantSchema.safeParse({ ...grant, limits: { modelCalls: 0, toolCalls: 0 } }).success, true);
});

test('immutable grant record identity is the original work, grant ID and revision, never a resettable content hash', () => {
  const id = summaryGrantRecordId(workId, grant);
  assert.match(id, /^[a-f0-9]{64}$/u);
  assert.equal(summaryGrantRecordId(workId, { ...grant, limits: { modelCalls: 4, toolCalls: 3 } }), id);
  assert.notEqual(summaryGrantRecordId(childId, grant), id);
  assert.notEqual(summaryGrantRecordId(workId, { ...grant, revision: 2 }), id);
  const record = { format: 'private-summary-grant/v1', id, workId, grant, renewal: null };
  assert.deepEqual(summaryGrantRecordSchema.parse(record), record);
  assert.equal(summaryGrantRecordSchema.safeParse({ ...record, id: 'f'.repeat(64) }).success, false);
  assert.equal(summaryGrantRecordSchema.safeParse({ ...record, extra: true }).success, false);
});

test('lineage owners preserve complete fast coverage and never treat an unproven accounting flag as evidence', () => {
  const base = { format: 'private-summary-lineage/v1', id: 'a'.repeat(64), scope,
    authorizationVersion: '1', workerGeneration: generation, version: 1 };
  const work = { ...base, owner: { kind: 'work', workId } };
  const fast = { ...base, owner: { kind: 'legacy_fast', runId: workId, triggerReference: grantId,
    coveredMessageIds: [childId], accounting: { state: 'unresolved' } } };
  assert.deepEqual(summaryLineageRecordSchema.parse(work), work);
  assert.deepEqual(summaryLineageRecordSchema.parse(fast), fast);
  for (const bad of [{ ...base, owner: { ...fast.owner, coveredMessageIds: [] } },
    { ...base, owner: { ...fast.owner, coveredMessageIds: [childId, childId] } },
    { ...base, owner: { ...fast.owner, accounting: { state: 'no_dispatch', verified: true } } },
    { ...base, owner: { ...fast.owner, accounting: { state: 'transferred', workId } } },
    { ...work, workerGeneration: 1 }, { ...work, scope: { ...scope, ownerUserId: '' } },
    { ...work, owner: { kind: 'work', workId, runId: grantId } }]) {
    assert.equal(summaryLineageRecordSchema.safeParse(bad).success, false);
  }
  assert.equal(summaryLineageRecordSchema.safeParse({ ...base, owner: { ...fast.owner,
    accounting: { state: 'no_dispatch', evidenceId: 'b'.repeat(64) } } }).success, true);
  // The codec only validates the reference. The transaction must reread its authoritative evidence.
});

import { summarySourceRevisionSchema, privateSummaryWorkSchema, privateSummaryAttemptSchema, privateSummaryUsageSchema,
  privateSummaryReservationSchema, summaryPartPlanSchema, summaryEffectReceiptSchema,
  summaryRevisionId, summaryAttemptId, summaryReservationId, summaryChainGenesis, summaryManifestHash } from '../server/private-summary-work.ts';
import { agentBudgetFingerprint } from '../server/agent-budget.ts';
import { summarySourceRetirementSchema, summaryRetirementId } from '../server/private-summary-work.ts';
import { firestoreAgentRunSchema } from '../server/firestore-agent-runs.ts';
import { firestoreDomainHash } from '../server/firestore-domain-data.ts';
const runId = '00000000-0000-4000-8000-000000000005';
const triggerReference = '00000000-0000-4000-8000-000000000006';
const manifest = { format: 'private-summary-manifest/v1' as const, kind: 'fresh_message' as const, mode: 'private' as const,
  coveredMessageIds: [childId] as [string], appendAfterSortKey: null, repairOf: null, sourceBasis: 'a'.repeat(64),
  sourceCoverageComplete: true, dependencies: [], units: [{ kind: 'chat_text' as const, messageId: childId,
    sortKey: '0000000000000000001', messageHash: 'b'.repeat(64), utf16Length: 3 }] };
function state() {
  const manifestHash = summaryManifestHash(manifest), sourceRevisionId = summaryRevisionId(workId, 1);
  const grantRecordId = summaryGrantRecordId(workId, grant);
  const revision = { format: 'private-summary-source-revision/v1', id: sourceRevisionId, workId, sourceRevision: 1,
    scope, authorizationVersion: '1', workerGeneration: generation, manifest, manifestHash, createdAt: '2026-11-04T00:00:00.000Z' };
  const work = { format: 'private-summary-work/v1', id: workId, lineageKey: 'c'.repeat(64), scope,
    authorizationVersion: '1', workerGeneration: generation, version: 1, sourceRevision: 1, sourceRevisionId, manifestHash,
    grant, grantRecordId, state: 'ready', chain: { committedParts: 0, next: { unitIndex: 0, offsetUtf16: 0 },
      accumulatorHash: null, digest: summaryChainGenesis(workId, 1, manifestHash) }, nextAttempt: 0,
    accumulator: null, activeAttemptId: null, finalReceipt: null, completionWake: null, lastRetirementId: null };
  const binding = { workId, sourceRevision: 1, step: 0, attempt: 0 };
  const attempt = { format: 'private-summary-attempt/v1', id: summaryAttemptId(binding), binding, runId, triggerReference,
    state: 'claimed', plan: null, sourceRevisionId, chainLink: null, receipt: null, resultText: null,
    contentState: 'present', erasureIntentId: null, noDispatchReason: null, grantRecordId, rootContext: null, modelReservationId: null, successorSchedule: null, retirementId: null };
  const usage = { format: 'private-summary-usage/v1', workId, grant, grantRecordId, used: { modelCalls: 0, toolCalls: 0 }, revision: 1, unresolvedRetiredCount: 0 };
  return { revision, work, attempt, usage };
}
function reserved() {
  const value = state(), originalAttemptKey = 'model:synthetic-original-key';
  const context = { generation: 1, binding: { rootRunId: runId, ownerId: scope.ownerUserId, workspaceId: scope.workspaceId,
    childId, authorizationVersion: '1', storageEpoch: scope.storageEpoch, trigger: { kind: 'worker', reference: triggerReference },
    workflowVersion: 'synthetic-workflow', promptPackVersion: grant.promptPackVersion,
    settingsVersion: 'synthetic-settings:original-fingerprint', billingVersion: grant.billingVersion,
    limits: { modelCalls: 1, toolCalls: 3, queryEmbeddings: 1 }, deadlineAtMs: 1793836890000 } };
  const plan = { binding: value.attempt.binding, manifestHash: value.revision.manifestHash,
    range: { unitIndex: 0, startUtf16: 0, endUtf16: 2, metadataOnly: false }, priorAccumulatorHash: null,
    requestFingerprint: 'd'.repeat(64), outputTextLimit: 100 };
  const reservation = { format: 'private-summary-reservation/v1', workId,
    reservationId: summaryReservationId(workId, originalAttemptKey, 'model'), attemptId: value.attempt.id, runId,
    grantRevision: 1, grantRecordId: value.work.grantRecordId, kind: 'model', units: 1, originalAttemptKey,
    requestFingerprint: plan.requestFingerprint, originalDailyRequest: { kind: 'model', rootRunId: runId, attemptKey: originalAttemptKey,
      bindingFingerprint: agentBudgetFingerprint(context), requestFingerprint: plan.requestFingerprint,
      userId: scope.ownerUserId, childId, model: grant.model, deadlineAtMs: context.binding.deadlineAtMs, userLimit: 10, globalLimit: 100 } };
  return { ...value, context, plan, reservation, attempt: { ...value.attempt, state: 'reserved', plan, rootContext: context,
    modelReservationId: reservation.reservationId, successorSchedule: { binding: { ...value.attempt.binding, step: 1, attempt: 0 }, dueAt: '2026-11-04T00:00:00.000Z' } } };
}

test('source revision and work codecs retain immutable source, worker generation and grant identities', () => {
  const { revision, work, usage } = state();
  assert.deepEqual(summarySourceRevisionSchema.parse(revision), revision);
  assert.deepEqual(privateSummaryWorkSchema.parse(work), work);
  assert.deepEqual(privateSummaryUsageSchema.parse(usage), usage);
  for (const change of [{ id: 'e'.repeat(64) }, { manifestHash: 'e'.repeat(64) }, { workerGeneration: undefined }]) {
    assert.equal(summarySourceRevisionSchema.safeParse({ ...revision, ...change }).success, false);
  }
  for (const change of [{ sourceRevisionId: 'e'.repeat(64) }, { grantRecordId: 'e'.repeat(64) }, { workerGeneration: undefined },
    { chain: { ...work.chain, digest: 'e'.repeat(64) } }]) {
    assert.equal(privateSummaryWorkSchema.safeParse({ ...work, ...change }).success, false);
  }
  assert.equal(privateSummaryUsageSchema.safeParse({ ...usage, grantRecordId: 'e'.repeat(64) }).success, false);
  // A later lower grant cannot erase already-consumed usage. Admission, not decode, decides exhaustion.
  assert.equal(privateSummaryUsageSchema.safeParse({ ...usage, used: { modelCalls: 4, toolCalls: 3 } }).success, true);
});

test('attempt records pin their grant and source before root binding and cannot substitute another plan', () => {
  const initial = state().attempt, value = reserved();
  assert.deepEqual(privateSummaryAttemptSchema.parse(initial), initial);
  assert.deepEqual(summaryPartPlanSchema.parse(value.plan), value.plan);
  assert.deepEqual(privateSummaryAttemptSchema.parse(value.attempt), value.attempt);
  for (const change of [{ grantRecordId: undefined }, { id: triggerReference }, { sourceRevisionId: 'e'.repeat(64) },
    { plan: { ...value.plan, binding: { ...value.plan.binding, attempt: 1 } } }, { rootContext: null }, { modelReservationId: null }]) {
    assert.equal(privateSummaryAttemptSchema.safeParse({ ...value.attempt, ...change }).success, false);
  }
  assert.equal(privateSummaryAttemptSchema.safeParse({ ...initial, resultText: 'uncommitted text' }).success, false);
  assert.equal(privateSummaryAttemptSchema.safeParse({ ...initial, contentState: 'erased' }).success, false);
});

test('immutable reservations retain the original daily request while tool batches cannot masquerade as model requests', () => {
  const { reservation } = reserved();
  assert.deepEqual(privateSummaryReservationSchema.parse(reservation), reservation);
  for (const change of [{ reservationId: 'e'.repeat(64) }, { grantRecordId: undefined }, { units: 2 },
    { originalDailyRequest: { ...reservation.originalDailyRequest, kind: 'embedding' } },
    { originalDailyRequest: { ...reservation.originalDailyRequest, attemptKey: 'new-model-key' } },
    { originalDailyRequest: { ...reservation.originalDailyRequest, requestFingerprint: 'e'.repeat(64) } },
    { originalDailyRequest: { ...reservation.originalDailyRequest, rootRunId: childId } }]) {
    assert.equal(privateSummaryReservationSchema.safeParse({ ...reservation, ...change }).success, false);
  }
  const { originalDailyRequest: _daily, ...common } = reservation;
  const key = reservation.originalAttemptKey + ':tool-batch';
  const tool = { ...common, kind: 'tool', units: 2, originalAttemptKey: key, reservationId: summaryReservationId(workId, key, 'tool') };
  assert.deepEqual(privateSummaryReservationSchema.parse(tool), tool);
  assert.equal(privateSummaryReservationSchema.safeParse({ ...tool, originalDailyRequest: reservation.originalDailyRequest }).success, false);
});

test('terminal receipts and redacted attempts keep source and attempt bindings without resurrecting result text', () => {
  const value = reserved(), receipt = { kind: 'part_committed', workId, sourceRevision: 1, step: 0,
    attemptId: value.attempt.id, next: { unitIndex: 0, offsetUtf16: 2 } };
  assert.deepEqual(summaryEffectReceiptSchema.parse(receipt), receipt);
  const committed = { ...value.attempt, state: 'committed', receipt, resultText: 'synthetic prior',
    chainLink: { predecessor: 'a'.repeat(64), next: 'b'.repeat(64), range: value.plan.range, outputHash: 'c'.repeat(64) } };
  assert.equal(privateSummaryAttemptSchema.safeParse({ ...committed, receipt: { ...receipt, attemptId: triggerReference } }).success, false);
  assert.equal(privateSummaryAttemptSchema.safeParse({ ...committed, contentState: 'erased', erasureIntentId: triggerReference }).success, false);
  assert.equal(privateSummaryAttemptSchema.safeParse({ ...committed, contentState: 'erased', erasureIntentId: triggerReference, resultText: null }).success, true);
  assert.equal(summaryEffectReceiptSchema.safeParse({ kind: 'published', workId, sourceRevision: 1,
    attemptId: value.attempt.id, summaryId: childId, summaryVersion: 1, coveredMessageIds: [], repairOf: null }).success, false);
});

test('a receipt cannot turn an unresolved or known-failed attempt into committed coverage', () => {
  const value = reserved(), receipt = { kind: 'part_committed', workId, sourceRevision: 1, step: 0,
    attemptId: value.attempt.id, next: { unitIndex: 0, offsetUtf16: 2 } };
  const terminal = { ...value.attempt, state: 'committed', receipt, resultText: null,
    contentState: 'erased', erasureIntentId: triggerReference,
    chainLink: { predecessor: 'a'.repeat(64), next: 'b'.repeat(64), range: value.plan.range, outputHash: 'c'.repeat(64) } };
  assert.equal(privateSummaryAttemptSchema.safeParse(terminal).success, true);
  for (const state of ['claimed', 'reserved', 'unknown', 'known_failed', 'not_dispatched']) {
    assert.equal(privateSummaryAttemptSchema.safeParse({ ...terminal, state }).success, false, state);
  }
  const failure = { ...value.attempt, state: 'committed', chainLink: null, receipt: { kind: 'no_effect', workId,
    sourceRevision: 1, attemptId: value.attempt.id, dispatchOutcome: 'response_observed', stopReason: 'invalid_tool' } };
  assert.equal(privateSummaryAttemptSchema.safeParse(failure).success, false);
  assert.equal(privateSummaryAttemptSchema.safeParse({ ...failure, state: 'known_failed' }).success, true);
});


test('published and part receipts require a real plan and chain while superseded content is never retained', () => {
  const value = reserved(), base = { workId, sourceRevision: 1, attemptId: value.attempt.id };
  for (const receipt of [{ ...base, kind: 'part_committed', step: 0, next: { unitIndex: 0, offsetUtf16: 2 } },
    { ...base, kind: 'published', summaryId: childId, summaryVersion: 1, coveredMessageIds: [childId], repairOf: null }]) {
    assert.equal(privateSummaryAttemptSchema.safeParse({ ...value.attempt, state: 'committed', receipt, chainLink: null }).success, false);
  }
  assert.equal(privateSummaryAttemptSchema.safeParse({ ...value.attempt, state: 'committed',
    receipt: { ...base, kind: 'superseded', reason: 'source_changed' }, resultText: 'Rejected stale output' }).success, false);
});

test('known no-dispatch reason is tied to its no-effect receipt and cannot be invented on an unresolved attempt', () => {
  const value = reserved(), receipt = { kind: 'no_effect', workId, sourceRevision: 1, attemptId: value.attempt.id,
    dispatchOutcome: 'not_dispatched', stopReason: 'unavailable' };
  const terminal = { ...value.attempt, state: 'not_dispatched', receipt, noDispatchReason: 'unavailable' };
  assert.equal(privateSummaryAttemptSchema.safeParse(terminal).success, true);
  assert.equal(privateSummaryAttemptSchema.safeParse({ ...terminal, noDispatchReason: null }).success, false);
  assert.equal(privateSummaryAttemptSchema.safeParse({ ...terminal, noDispatchReason: 'deadline' }).success, false);
  assert.equal(privateSummaryAttemptSchema.safeParse({ ...value.attempt, noDispatchReason: 'unavailable' }).success, false);
});

test('new work and usage require explicit retirement state rather than interpreting missing recovery fields as empty', () => {
  const value = state(), work = { ...value.work, lastRetirementId: null }, usage = { ...value.usage, unresolvedRetiredCount: 0 };
  assert.deepEqual(privateSummaryWorkSchema.parse(work), work);
  assert.deepEqual(privateSummaryUsageSchema.parse(usage), usage);
  assert.equal(privateSummaryWorkSchema.safeParse({ ...work, lastRetirementId: undefined }).success, false);
  for (const count of [undefined, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(privateSummaryUsageSchema.safeParse({ ...usage, unresolvedRetiredCount: count }).success, false);
  }
  assert.equal(privateSummaryUsageSchema.safeParse({ ...usage, unresolvedRetiredCount: 2,
    used: { modelCalls: 8, toolCalls: 4 } }).success, true, 'A smaller grant must not erase historical debit');
});

test('retirement evidence is create-only identity-bound metadata and never raw source or an embedding grant', () => {
  const value = reserved(), id = summaryRetirementId(workId, value.attempt.id);
  assert.equal(id, firestoreDomainHash(['private-summary-source-retirement/v1', workId, value.attempt.id]));
  assert.notEqual(summaryRetirementId(childId, value.attempt.id), id);
  const record = { format: 'private-summary-source-retirement/v1', id, workId, attemptId: value.attempt.id, runId,
    scope, authorizationVersion: '1', workerGeneration: generation, sourceRevisionId: value.attempt.sourceRevisionId,
    manifestHash: 'd'.repeat(64), grantRecordId: value.attempt.grantRecordId,
    rootContextFingerprint: agentBudgetFingerprint(value.attempt.rootContext), stoppedRootHash: 'e'.repeat(64),
    frozenCounts: { modelCalls: 1, toolCalls: 0, queryEmbeddings: 0 }, modelReservationId: value.attempt.modelReservationId,
    toolReservationId: null, observedManifest: manifest, observedManifestHash: summaryManifestHash(manifest),
    policyVersion: grant.policyVersion, createdAt: '2026-11-04T00:00:00.000Z' };
  assert.deepEqual(summarySourceRetirementSchema.parse(record), record);
  for (const change of [{ id: 'a'.repeat(64) }, { attemptId: childId }, { observedManifestHash: 'c'.repeat(64) },
    { frozenCounts: { ...record.frozenCounts, queryEmbeddings: 1 } }, { modelReservationId: null },
    { sourceText: 'Private unbounded raw source' }, { verified: true }, { policyVersion: '' }]) {
    assert.equal(summarySourceRetirementSchema.safeParse({ ...record, ...change }).success, false);
  }
});

test('grant revisions preserve the complete prior usage snapshot and cannot default missing renewal evidence', () => {
  const value = state(), next = { ...grant, revision: 2 }, id = summaryGrantRecordId(workId, next);
  const renewal = { previousGrantRecordId: value.usage.grantRecordId, usageRevision: 2, used: { modelCalls: 3, toolCalls: 1 },
    unresolvedRetiredCount: 1, sourceRevisionId: value.revision.id, chainDigest: value.work.chain.digest,
    lastRetirementId: 'e'.repeat(64) };
  const record = { format: 'private-summary-grant/v1', id, workId, grant: next, renewal };
  assert.deepEqual(summaryGrantRecordSchema.parse(record), record);
  for (const change of [{ renewal: undefined }, { renewal: { ...renewal, previousGrantRecordId: id } },
    { renewal: { ...renewal, used: { modelCalls: -1, toolCalls: 0 } } },
    { renewal: { ...renewal, unresolvedRetiredCount: 1.5 } }, { renewal: { ...renewal, lastRetirementId: null } }]) {
    assert.equal(summaryGrantRecordSchema.safeParse({ ...record, ...change }).success, false);
  }
});

test('retired attempts remain unknown or source-superseded and cannot acquire committed coverage', () => {
  const value = reserved(), retirementId = firestoreDomainHash(['private-summary-source-retirement/v1', workId, value.attempt.id]);
  const retired = { ...value.attempt, retirementId, state: 'unknown' };
  assert.deepEqual(privateSummaryAttemptSchema.parse(retired), retired);
  for (const change of [{ retirementId: 'e'.repeat(64) }, { state: 'reserved' }, { state: 'claimed' },
    { plan: null, modelReservationId: null }, { retirementId: undefined }]) {
    assert.equal(privateSummaryAttemptSchema.safeParse({ ...retired, ...change }).success, false);
  }
  const base = { workId, sourceRevision: 1, attemptId: value.attempt.id };
  assert.equal(privateSummaryAttemptSchema.safeParse({ ...retired, state: 'committed',
    receipt: { ...base, kind: 'superseded', reason: 'source_changed' } }).success, true);
  assert.equal(privateSummaryAttemptSchema.safeParse({ ...retired, state: 'committed',
    receipt: { ...base, kind: 'superseded', reason: 'already_covered' } }).success, false);
});

test('durable summary runs require an explicit retirement pointer and cannot use a different attempt fence', () => {
  const value = reserved(), summaryRetirementId = firestoreDomainHash(['private-summary-source-retirement/v1', workId, value.attempt.id]);
  const run = { id: runId, childId, ownerUserId: scope.ownerUserId, workspaceId: scope.workspaceId,
    storageEpoch: scope.storageEpoch, authorizationVersion: '1', dataVersion: scope.storageEpoch + ':1',
    trigger: { kind: 'worker', reference: triggerReference }, workerGeneration: generation, summaryWork: value.attempt.binding,
    summaryRetirementId, sourceMessageId: null, recipeId: 'memory-refresh', state: 'unknown', stopReason: 'interrupted',
    createdAt: '2026-11-04T00:00:00.000Z', expiresAt: '2026-11-04T00:01:00.000Z', result: null };
  assert.deepEqual(firestoreAgentRunSchema.parse(run), run);
  for (const change of [{ summaryRetirementId: undefined }, { summaryRetirementId: 'e'.repeat(64) },
    { state: 'running' }, { summaryWork: undefined }]) {
    assert.equal(firestoreAgentRunSchema.safeParse({ ...run, ...change }).success, false);
  }
});
