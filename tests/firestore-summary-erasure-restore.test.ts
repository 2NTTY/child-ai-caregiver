import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { replayContentErasures } from '../server/firestore-restore-content-erasure.ts';
import { privateSummaryAttemptSchema, privateSummaryWorkSchema, privateSummaryUsageSchema, summaryCompletionWakeId } from '../server/private-summary-work.ts';
import { firestoreDomainHash } from '../server/firestore-domain-data.ts';
import type { createFirestoreRestoreCodec } from '../server/firestore-restore-codec.ts';
import { summaryErasureFixture } from './helpers/summary-erasure-fixture.ts';

const unusedCodec = {} as ReturnType<typeof createFirestoreRestoreCodec>;

test('journal replay erases every matching historical source revision without erasing a newer dependency or refunding usage', async () => {
  const f = await summaryErasureFixture(), old = f.seed(1), current = f.seed(2);
  const usage = f.store('private_summary_usage', 'private-summary-usage', f.work.id, privateSummaryUsageSchema,
    { format: 'private-summary-usage/v1', workId: f.work.id, grant: f.work.grant, grantRecordId: f.work.grantRecordId,
      used: { modelCalls: 7, toolCalls: 6 }, revision: 9, unresolvedRetiredCount: 0 });
  const rows = [f.workRow, ...old.rows, ...current.rows, usage], beforeRevision = structuredClone(old.rows[0]), beforeUsage = structuredClone(usage);
  const removed = replayContentErasures(f.data, unusedCodec, rows, [], [f.intent], new Map());
  assert.equal(removed.size, 0);
  const erased = privateSummaryAttemptSchema.parse(old.rows[1].value);
  assert.equal(erased.resultText, null);
  assert.equal(erased.contentState, 'erased');
  assert.equal(erased.erasureIntentId, f.intent.operationId);
  assert.deepEqual(erased.receipt, old.value.receipt);
  assert.deepEqual(erased.chainLink, old.value.chainLink);
  assert.deepEqual(old.rows[0], beforeRevision, 'The immutable dependency and hash evidence is retained');
  assert.deepEqual(usage, beforeUsage);
  assert.equal(privateSummaryAttemptSchema.parse(current.rows[1].value).resultText, current.originalText);
  assert.deepEqual(privateSummaryWorkSchema.parse(f.workRow.value), f.work, 'Only the current revision owns the accumulator');
});

test('journal replay clears a matching accumulator and preserves an unresolved attempt across epochs', async () => {
  const f = await summaryErasureFixture(), unknown = f.seed(2, 'unknown');
  const rows = [f.workRow, ...unknown.rows], intent = { ...f.intent, scope: { ...f.scope, storageEpoch: randomUUID() }, content: { kind: 'fact' as const, throughVersion: 2 } };
  replayContentErasures(f.data, unusedCodec, rows, [], [intent], new Map());
  const work = privateSummaryWorkSchema.parse(f.workRow.value), attempt = privateSummaryAttemptSchema.parse(unknown.rows[1].value);
  assert.equal(work.accumulator, null);
  assert.equal(work.state, 'invalidated');
  assert.equal(attempt.state, 'unknown');
  assert.equal(attempt.receipt, null);
  assert.equal(attempt.contentState, 'erased');
  assert.equal(attempt.erasureIntentId, intent.operationId);
});

test('replaying a later deletion preserves the original redaction receipt instead of replacing it', async () => {
  const f = await summaryErasureFixture(), old = f.seed(1), rows = [f.workRow, ...old.rows];
  const first = { ...old.value, contentState: 'erased' as const, resultText: null, erasureIntentId: randomUUID() };
  old.rows[1].value = privateSummaryAttemptSchema.parse(first);
  replayContentErasures(f.data, unusedCodec, rows, [], [f.intent], new Map());
  assert.equal(privateSummaryAttemptSchema.parse(old.rows[1].value).erasureIntentId, first.erasureIntentId);
});

test('journal redaction does not relax restore suspension or unresolved work and retains the decoded AAD version', async () => {
  for (const state of ['restore_suspended', 'unknown'] as const) {
    const f = await summaryErasureFixture(2), current = f.seed(2);
    f.workRow.value = privateSummaryWorkSchema.parse({ ...f.work, state });
    replayContentErasures(f.data, unusedCodec, [f.workRow, ...current.rows], [], [f.intent], new Map());
    const work = privateSummaryWorkSchema.parse(f.workRow.value);
    assert.equal(work.state, state);
    assert.equal(work.accumulator, null);
    assert.equal(work.version, f.work.version);
    assert.equal('recordVersion' in f.workRow.context ? f.workRow.context.recordVersion : undefined, f.work.version);
  }
});

test('completed work loses its erased accumulator and wake while retaining its original publication receipt', async () => {
  const f = await summaryErasureFixture(2), current = f.seed(2);
  const receipt = { kind: 'published' as const, workId: f.work.id, sourceRevision: 2, attemptId: current.value.id,
    summaryId: randomUUID(), summaryVersion: 1, coveredMessageIds: current.revision.manifest.coveredMessageIds, repairOf: null };
  f.workRow.value = privateSummaryWorkSchema.parse({ ...f.work, state: 'completed', finalReceipt: receipt,
    completionWake: { id: summaryCompletionWakeId(f.work.id, current.value.id), receiptHash: firestoreDomainHash(receipt), scheduling: { kind: 'pending_schedule' } } });
  replayContentErasures(f.data, unusedCodec, [f.workRow, ...current.rows], [], [f.intent], new Map());
  const work = privateSummaryWorkSchema.parse(f.workRow.value);
  assert.equal(work.accumulator, null);
  assert.equal(work.completionWake, null);
  assert.deepEqual(work.finalReceipt, receipt);
});
