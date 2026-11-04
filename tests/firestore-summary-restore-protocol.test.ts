import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { restoreFirestoreUsage, assertPrivateSummaryProtocolEvidence } from '../server/firestore-restore-usage.ts';
import { canonical } from '../server/firestore-session-codec.ts';
import { summaryRestoreFixture } from './helpers/summary-restore-fixture.ts';
import type { FirebaseBackupDocument } from '../server/firestore-backup.ts';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

test('summary protocol restore rejects original root identities omitted by scalar-only reconciliation', () => {
  const f = summaryRestoreFixture(), a = f.attempt(), context = a.value.rootContext!;
  const collection = f.options.namespace + '_root_budget', path = collection + '/' + hash(a.run.id);
  const aad = JSON.stringify(['yuban-root-budget', 1, f.options.projectId, collection, a.run.id]);
  const root = (key: string): FirebaseBackupDocument => ({ path, data: { format: 'yuban-root-budget', version: 1,
    ciphertext: f.options.cipher.encrypt(canonical({ bindingFingerprint: hash(canonical(context.binding)), generation: context.generation,
      deadlineAtMs: context.binding.deadlineAtMs, limits: context.binding.limits, used: { modelCalls: 1, toolCalls: 0, queryEmbeddings: 0 },
      status: 'active', attempts: [{ request: { key, fingerprint: 'b'.repeat(64), kind: 'model', units: 1 }, outcome: { status: 'reserved' } }] }), aad) } });
  const snapshot = [root('original-a')], live = [root('original-b')];
  const result = restoreFirestoreUsage(f.options, snapshot, live, [a.run.id]);
  assert.throws(() => assertPrivateSummaryProtocolEvidence(f.options, snapshot, live, result, f.usageRows([a.reservation]).map(row => f.codec.decode(row))),
    error => error instanceof Error && 'code' in error && error.code === 'restore_summary_protocol_evidence');
});

test('summary protocol restore rejects a daily counter below its distinct original reservations', () => {
  const f = summaryRestoreFixture(), a = f.attempt(), b = f.attempt(1), collection = f.options.namespace + '_ai_usage', day = '2026-11-04';
  const seal = (id: string, value: unknown): FirebaseBackupDocument => ({ path: collection + '/' + id, data: {
    format: 'yuban-ai-daily-usage', version: 1, ciphertext: f.options.cipher.encrypt(canonical(value),
      canonical(['yuban-ai-daily-usage', 1, f.options.projectId, collection, id])) } });
  const counterId = (userId: string | null) => 'daily_' + hash(canonical(['platform', day, userId]));
  const branch = (request: typeof a.reservation.originalDailyRequest) => [
    seal('attempt_' + hash(canonical([request.rootRunId, request.attemptKey])), { request, billingSource: 'platform', day,
      reservedAtMs: Date.parse(f.at), record: null }),
    ...[null, f.scope.ownerUserId].map(user => seal(counterId(user), { attempts: 1, inputTokens: 0, outputTokens: 0, cachedTokens: 0, known: 0 })),
  ];
  const snapshot = branch(a.reservation.originalDailyRequest), live = branch(b.reservation.originalDailyRequest);
  const result = restoreFirestoreUsage(f.options, snapshot, live, []);
  assert.throws(() => assertPrivateSummaryProtocolEvidence(f.options, snapshot, live, result,
    f.usageRows([a.reservation, b.reservation]).map(row => f.codec.decode(row))),
    error => error instanceof Error && 'code' in error && error.code === 'restore_summary_protocol_evidence');
});
