import test from 'node:test';
import assert from 'node:assert/strict';
import { FIREBASE_BACKUP_COLLECTION_SUFFIXES } from '../server/firestore-backup.ts';
import { privateSummaryUsageSchema } from '../server/private-summary-work.ts';
import { summaryRestoreFixture } from './helpers/summary-restore-fixture.ts';

const rejected = (error: unknown) => error instanceof Error && 'code' in error && String(error.code).startsWith('restore_');
test('private summary backup suffixes preserve the upstream handover and knowledge suffix order', () => {
  const suffixes = FIREBASE_BACKUP_COLLECTION_SUFFIXES;
  assert.deepEqual(suffixes.slice(suffixes.indexOf('_handover_source_history') + 1), [
    '_knowledge_index_batches', '_knowledge_index_receipts', '_knowledge_transfers',
    '_private_summary_works', '_private_summary_revisions', '_private_summary_attempts', '_private_summary_scans', '_private_summary_usage']);
});
test('private summary restore codec authenticates locators, schemas, record versions and outer projections', () => {
  const f = summaryRestoreFixture();
  for (const row of f.baseRows()) assert.ok(f.codec.decode(row));
  const row = f.workRow();
  assert.throws(() => f.codec.decode({ ...row, data: { ...row.data, epochTag: 'forged' } }), rejected);
  assert.throws(() => f.codec.decode({ ...row, data: { ...row.data, completionWakeState: 'queued' } }), rejected);
  assert.throws(() => f.codec.decode({ ...row, data: { ...row.data, sourceBasis: 'a'.repeat(64) } }), rejected);
});
test('restore unions original immutable reservation identities across disjoint spent branches', async () => {
  const { mergePrivateSummaryUsage } = await import('../server/firestore-restore-private-summary.ts');
  const f = summaryRestoreFixture(), left = f.attempt(0), right = f.attempt(1);
  const snapshot = f.usageRows([left.reservation]), current = f.usageRows([right.reservation], 3);
  const merged = mergePrivateSummaryUsage(snapshot.map(row => f.codec.decode(row)), current.map(row => f.codec.decode(row)));
  const head = merged.find(row => row.context.kind === 'private-summary-usage');
  assert.ok(head); assert.deepEqual(privateSummaryUsageSchema.parse(head.value).used, { modelCalls: 2, toolCalls: 0 });
  assert.equal(merged.filter(row => row.context.kind === 'private-summary-reservation').length, 2);
});
test('restore rejects immutable reservation conflicts rather than taking the lower spent branch', async () => {
  const { mergePrivateSummaryUsage } = await import('../server/firestore-restore-private-summary.ts');
  const f = summaryRestoreFixture(), a = f.attempt(0), snapshot = f.usageRows([a.reservation]);
  const changed = { ...a.reservation, requestFingerprint: 'c'.repeat(64), originalDailyRequest: {
    ...a.reservation.originalDailyRequest, requestFingerprint: 'c'.repeat(64) } };
  assert.throws(() => mergePrivateSummaryUsage(snapshot.map(row => f.codec.decode(row)), f.usageRows([changed], 3).map(row => f.codec.decode(row))), rejected);
});

function committedGraph() {
  const f = summaryRestoreFixture(), a = f.committed();
  const records = [...f.baseRows().filter(row => !row.path.includes('_private_summary_usage/') && row.path !== f.workRow().path),
    f.workRow(a.currentWork), ...a.rows(), ...f.usageRows([a.reservation])].map(row => f.codec.decode(row));
  return { f, a, records };
}
test('restore reconstructs the committed chain and rejects a missing predecessor link', async () => {
  const { assertPrivateSummaryRestoreRelations } = await import('../server/firestore-restore-private-summary.ts');
  const { f, a, records } = committedGraph();
  assert.equal(assertPrivateSummaryRestoreRelations(records).size, 1);
  assert.throws(() => assertPrivateSummaryRestoreRelations([...records.filter(row => row.context.id !== a.value.id && row.context.id !== a.run.id
      && !row.path.includes('_private_summary_usage/')), ...f.usageRows().map(row => f.codec.decode(row))]),
    error => error instanceof Error && 'code' in error && error.code === 'restore_summary_chain');
});
test('restore rejects a validly encrypted fork at the same revision step', async () => {
  const { assertPrivateSummaryRestoreRelations } = await import('../server/firestore-restore-private-summary.ts');
  const { f, a, records } = committedGraph(), fork = f.committed(0, null, f.work.chain.digest, 1);
  const rows = [...records.filter(row => !row.path.includes('_private_summary_usage/')), ...fork.rows().map(row => f.codec.decode(row)),
    ...f.usageRows([a.reservation, fork.reservation]).map(row => f.codec.decode(row))];
  assert.throws(() => assertPrivateSummaryRestoreRelations(rows),
    error => error instanceof Error && 'code' in error && error.code === 'restore_summary_chain');
  assert.ok(a.value.chainLink);
});
test('restore rejects a source manifest or work head that disagrees with authenticated attempt links', async () => {
  const { assertPrivateSummaryRestoreRelations } = await import('../server/firestore-restore-private-summary.ts');
  const { f, records } = committedGraph(), head = records.find(row => row.context.kind === 'private-summary-work')!;
  head.value = { ...f.work, state: 'unknown' };
  assert.throws(() => assertPrivateSummaryRestoreRelations(records), rejected);
});
test('restore recomputes mutable equal-revision heads from different tool reservation units', async () => {
  const { mergePrivateSummaryUsage } = await import('../server/firestore-restore-private-summary.ts');
  const { summaryReservationId } = await import('../server/private-summary-work.ts');
  const f = summaryRestoreFixture();
  const tool = (attemptNumber: number, units: number) => {
    const a = f.attempt(0, attemptNumber), originalAttemptKey = a.reservation.originalAttemptKey + ':tool-batch';
    return { format: 'private-summary-reservation/v1' as const, workId: f.work.id,
      reservationId: summaryReservationId(f.work.id, originalAttemptKey, 'tool'), attemptId: a.value.id, runId: a.run.id,
      grantRevision: 1, grantRecordId: f.grantRecord.id, originalAttemptKey, requestFingerprint: 'd'.repeat(64), kind: 'tool' as const, units };
  };
  const merged = mergePrivateSummaryUsage(f.usageRows([tool(0, 1)], 2).map(row => f.codec.decode(row)),
    f.usageRows([tool(1, 2)], 2).map(row => f.codec.decode(row)));
  assert.deepEqual(privateSummaryUsageSchema.parse(merged.find(row => row.context.kind === 'private-summary-usage')!.value).used,
    { modelCalls: 0, toolCalls: 3 });
});

test('restore rejects a conflicting live owner at an already retained lineage path', async () => {
  const { reconcilePrivateSummaryRestore } = await import('../server/firestore-restore-private-summary.ts');
  const { summaryLineageRecordSchema } = await import('../server/private-summary-work.ts');
  const { firestoreAgentRunSchema } = await import('../server/firestore-agent-runs.ts');
  const f = summaryRestoreFixture(), { summaryWork, summaryRetirementId, ...run } = f.attempt().run;
  const lineage = summaryLineageRecordSchema.parse({ ...f.lineage, owner: { kind: 'legacy_fast', runId: run.id,
    triggerReference: run.trigger.reference, coveredMessageIds: f.revision.manifest.coveredMessageIds,
    accounting: { state: 'unresolved' } } });
  const snapshot = f.baseRows().map(row => f.codec.decode(row));
  const live = [f.row('private-summary-lineage', lineage.id, summaryLineageRecordSchema, lineage),
    f.row('agent-run', run.id, firestoreAgentRunSchema, run), ...f.usageRows()].map(row => f.codec.decode(row));
  assert.throws(() => reconcilePrivateSummaryRestore(snapshot, live), error => error instanceof Error && 'code' in error
    && error.code === 'restore_summary_immutable_conflict');
});

test('restore codec accepts the selected fast writer lineage version and rejects a mismatched authenticated body version', async () => {
  const { privateSummaryFastFixture } = await import('./helpers/private-summary-fast.ts');
  const { createFirestoreRestoreCodec } = await import('../server/firestore-restore-codec.ts');
  const { summaryLineageRecordSchema } = await import('../server/private-summary-work.ts');
  const { randomUUID } = await import('node:crypto');
  const f = await privateSummaryFastFixture();
  await f.chat.createUserMessageForUser('owner', f.childId, 'Second synthetic source');
  const candidate = (await f.memory.prepareMaintenance('owner', f.childId))!;
  await f.withScopeLease(async reference => {
    const claim = await f.authority.runTransaction('owner', f.childId, async b => {
      const prepared = await f.runs.prepareFastProbeClaim(b, { reference, candidate, candidateRunId: randomUUID() });
      if (prepared.kind !== 'claimed') throw new Error('Expected a synthetic original fast probe');
      prepared.commit(); return prepared.claim;
    });
    await f.authority.runTransaction('owner', f.childId, async b => {
      const target = { kind: 'fresh_prefix' as const, firstMessageId: candidate.messages[0].id, messageCount: 2 };
      const selected = await f.memory.readFastSource(b, target);
      if (selected.kind !== 'eligible') throw new Error('Expected a complete synthetic source prefix');
      const admission = await f.build().prepareFastAdmission(b, { runId: claim.runId, reference, target, expectedSourceHash: selected.sourceHash });
      assert.equal(admission.kind, 'prepared'); if (admission.kind !== 'prepared') throw new Error('Expected selected admission');
      admission.commit();
    });
  });
  const saved = [...f.fake.records].find(([path, data]) => path.includes('_private_summary_works/') && data.recordVersion === 2)!;
  assert.ok(saved, 'The real selected writer must advance the original lineage version');
  const codec = createFirestoreRestoreCodec(f.options), decoded = codec.decode({ path: saved[0], data: saved[1] });
  const value = summaryLineageRecordSchema.parse(decoded.value);
  assert.ok(decoded.context.family === 'domain');
  assert.equal(value.version, 2); assert.equal(decoded.context.recordVersion, 2);
  const transformed = codec.transform(decoded, { newEpochByWorkspace: new Map(), generation: f.generation, photoDescriptors: new Map() });
  assert.equal(summaryLineageRecordSchema.parse(codec.decode(transformed).value).version, 2);
  assert.throws(() => codec.decode({ path: saved[0], data: { ...f.data.tags(value.scope),
    ...f.data.seal('private-summary-lineage', value.id, value.scope, summaryLineageRecordSchema, { ...value, version: 3 }, 2) } }), rejected);
});
