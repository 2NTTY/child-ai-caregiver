import test from 'node:test';
import { z } from 'zod';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { privateSummaryFixture } from './helpers/private-summary-work.ts';
import { summaryRestoreFixture } from './helpers/summary-restore-fixture.ts';
import { createFirestoreRestoreCodec } from '../server/firestore-restore-codec.ts';
import { prepareFirebaseRestore } from '../server/firestore-restore.ts';
import { privateSummaryWorkSchema, privateSummaryUsageSchema, summarySourceRevisionSchema, summaryRevisionId, summaryChainGenesis, summaryLineageRecordSchema } from '../server/private-summary-work.ts';
import { firestoreAgentRunSchema } from '../server/firestore-agent-runs.ts';
import { firestoreBackgroundWorkSchema } from '../server/firestore-background-work.ts';
import { privateSummaryCutoverSchema, privateSummaryCutoverId } from '../server/private-summary-scan.ts';
import { canonical } from '../server/firestore-session-codec.ts';
import type { FirebaseBackupDocument } from '../server/firestore-backup.ts';

async function fixture() {
  const base = await privateSummaryFixture(), codec = createFirestoreRestoreCodec(base.options);
  const scope = await base.authority.runTransaction('owner', base.childId, async b => b.scope);
  const f = summaryRestoreFixture({ options: base.options, scope, generation: base.generation });
  const authority = [...base.fake.records].map(([path, data]) => ({ path, data }));
  const control = authority.find(row => codec.decode(row).context.kind === 'control')!;
  const paused = codec.transform(codec.decode(control), { newEpochByWorkspace: new Map(), generation: base.generation, photoDescriptors: new Map() });
  control.data = paused.data;
  const restoreId = randomUUID();
  const restore = (snapshot: FirebaseBackupDocument[], live = snapshot) => prepareFirebaseRestore(base.options, {
    restoreId, targetDatabaseId: 'synthetic-target-db', sourceGeneration: base.generation,
    documents: [...authority, ...snapshot], liveDocuments: [...authority, ...live],
    authUsers: [{ userId: 'owner', email: 'owner@example.test', disabled: false, emailVerified: true }], erasures: [],
    photoDescriptors: new Map(), erasureDescriptors: new Map() });
  return { ...f, base, codec, restore, restoreId };
}
test('restore suspends original work and creates a current-epoch persistent cutover guard', async () => {
  const f = await fixture(), result = f.restore(f.baseRows()), records = result.records.map(row => f.codec.decode(row));
  const work = records.find(row => row.context.kind === 'private-summary-work')!;
  assert.deepEqual(privateSummaryWorkSchema.parse(work.value).scope, f.scope);
  assert.equal(privateSummaryWorkSchema.parse(work.value).state, 'restore_suspended');
  const guards = records.filter(row => row.context.kind === 'private-summary-cutover');
  assert.equal(guards.length, 1);
  const guard = privateSummaryCutoverSchema.parse(guards[0]!.value);
  assert.equal(guard.phase, 'restore_suspended'); assert.equal(guard.restoreId, f.restoreId);
  assert.equal(guard.scope.storageEpoch, result.newEpochByWorkspace.get(f.scope.workspaceId));
  assert.equal(guard.id, privateSummaryCutoverId(guard.scope)); assert.equal(guard.workerGeneration, result.generation);
  assert.deepEqual(privateSummaryUsageSchema.parse(records.find(row => row.context.kind === 'private-summary-usage')!.value).used,
    { modelCalls: 0, toolCalls: 0 });
});
test('usage-only live work creates the new-epoch guard without recreating its domain body', async () => {
  const f = await fixture(), a = f.attempt(), result = f.restore([], f.usageRows([a.reservation]));
  const records = result.records.map(row => f.codec.decode(row));
  assert.equal(records.filter(row => row.context.kind === 'private-summary-work').length, 0);
  assert.equal(records.filter(row => row.context.kind === 'private-summary-cutover').length, 1);
  assert.deepEqual(privateSummaryUsageSchema.parse(records.find(row => row.context.kind === 'private-summary-usage')!.value).used,
    { modelCalls: 1, toolCalls: 0 });
});
test('original pending summary run and root stay fenced across restore', async () => {
  const f = await fixture(), a = f.attempt(), rootId = a.run.id;
  const collection = f.options.namespace + '_root_budget', path = collection + '/' + createHash('sha256').update(rootId).digest('hex');
  const aad = JSON.stringify(['yuban-root-budget', 1, f.options.projectId, collection, rootId]);
  const context = a.value.rootContext!;
  const root: FirebaseBackupDocument = { path, data: { format: 'yuban-root-budget', version: 1, ciphertext: f.options.cipher.encrypt(canonical({
    bindingFingerprint: createHash('sha256').update(canonical(context.binding)).digest('hex'), generation: context.generation,
    deadlineAtMs: context.binding.deadlineAtMs, limits: context.binding.limits,
    used: { modelCalls: 0, toolCalls: 0, queryEmbeddings: 0 }, status: 'active', attempts: [] }), aad) } };
  const work = { ...f.work, state: 'executing' as const, activeAttemptId: a.value.id, version: 2 };
  const source = [...f.baseRows().filter(row => !row.path.includes('_private_summary_usage/') && row.path !== f.workRow().path),
    f.workRow(work), ...a.rows(), ...f.usageRows([a.reservation]), root];
  const result = f.restore(source), records = result.records.filter(row => row.path !== root.path).map(row => f.codec.decode(row));
  const run = records.find(row => row.context.kind === 'agent-run' && row.context.id === a.run.id)!;
  assert.equal(firestoreAgentRunSchema.parse(run.value).state, 'unknown');
  assert.equal(firestoreAgentRunSchema.parse(run.value).storageEpoch, f.scope.storageEpoch);
  const restoredRoot = result.records.find(row => row.path === root.path)!;
  assert.ok(typeof restoredRoot.data.ciphertext === 'string');
  assert.equal(JSON.parse(f.options.cipher.decrypt(restoredRoot.data.ciphertext, aad)).status, 'stopped');
  assert.equal(result.records.some(row => row.path.startsWith(f.options.namespace + '_adk/')), false);
});
test('restore rejects a missing historical source revision even when its attempts are absent', async () => {
  const f = await fixture(), sourceRevision = 2, id = summaryRevisionId(f.work.id, sourceRevision);
  const revision = { ...f.revision, id, sourceRevision }, work = { ...f.work, sourceRevision, sourceRevisionId: id,
    chain: { ...f.work.chain, digest: summaryChainGenesis(f.work.id, sourceRevision, f.work.manifestHash) } };
  const source = [...f.baseRows().filter(row => row.path !== f.workRow().path && !row.path.includes('_private_summary_revisions/')),
    f.workRow(work), f.row('private-summary-revision', id, summarySourceRevisionSchema, revision)];
  const { assertPrivateSummaryRestoreRelations } = await import('../server/firestore-restore-private-summary.ts');
  assert.throws(() => assertPrivateSummaryRestoreRelations(source.map(row => f.codec.decode(row))), error => error instanceof Error && 'code' in error && error.code === 'restore_summary_revision_gap');
});

function dormantRows(f: Awaited<ReturnType<typeof fixture>>, accounting: { state: 'unresolved' } | { state: 'no_dispatch'; evidenceId: string }) {
  const candidate = f.attempt(), { summaryWork, summaryRetirementId, ...run } = candidate.run;
  const lineage = summaryLineageRecordSchema.parse({ ...f.lineage, owner: { kind: 'legacy_fast', runId: run.id,
    triggerReference: run.trigger.reference, coveredMessageIds: f.revision.manifest.coveredMessageIds, accounting } });
  return { run, lineage, rootContext: candidate.value.rootContext!, rows: [f.row('private-summary-lineage', lineage.id, summaryLineageRecordSchema, lineage),
    f.row('agent-run', run.id, firestoreAgentRunSchema, run)] };
}
test('dormant legacy no-dispatch evidence is preserved without creating a new work or omitting its current-epoch guard', async () => {
  const f = await fixture(), original = dormantRows(f, { state: 'no_dispatch', evidenceId: 'a'.repeat(64) });
  const result = f.restore(original.rows), records = result.records.map(row => f.codec.decode(row));
  const lineage = summaryLineageRecordSchema.parse(records.find(row => row.context.kind === 'private-summary-lineage')!.value);
  assert.deepEqual(lineage.owner, original.lineage.owner); assert.deepEqual(lineage.scope, f.scope);
  const run = firestoreAgentRunSchema.parse(records.find(row => row.context.kind === 'agent-run')!.value);
  assert.equal(run.storageEpoch, f.scope.storageEpoch); assert.equal(run.state, 'unknown');
  const guard = privateSummaryCutoverSchema.parse(records.find(row => row.context.kind === 'private-summary-cutover')!.value);
  assert.equal(guard.phase, 'restore_suspended'); assert.equal(guard.scope.storageEpoch, result.newEpochByWorkspace.get(f.scope.workspaceId));
  assert.equal(records.some(row => row.context.kind === 'private-summary-work'), false);
  const originalBackground = [...f.base.fake.records].map(([path, data]) => f.codec.decode({ path, data }))
    .filter(row => row.context.kind === 'background-work').map(row => row.context.id).sort();
  const background = records.filter(row => row.context.kind === 'background-work');
  assert.ok(originalBackground.length > 0, 'The bootstrap child-change work is a pre-existing unrelated job');
  assert.deepEqual(background.map(row => row.context.id).sort(), originalBackground);
  for (const row of background) {
    const value = firestoreBackgroundWorkSchema.parse(row.value);
    assert.equal(value.state, 'stopped'); assert.equal(value.lease, null); assert.equal(value.dispatchLease, null);
  }
});
test('dormant legacy pointers reject mismatched original authority and malformed evidence identifiers', async () => {
  const f = await fixture(), original = dormantRows(f, { state: 'unresolved' });
  const { assertPrivateSummaryRestoreRelations } = await import('../server/firestore-restore-private-summary.ts');
  const wrongGeneration = { ...original.run, workerGeneration: randomUUID() };
  assert.throws(() => assertPrivateSummaryRestoreRelations([original.rows[0]!, f.row('agent-run', wrongGeneration.id, firestoreAgentRunSchema, wrongGeneration)].map(row => f.codec.decode(row))),
    error => error instanceof Error && 'code' in error && error.code === 'restore_summary_binding');
  const badScope = { ...original.lineage, scope: { ...f.scope, storageEpoch: randomUUID() } };
  assert.throws(() => f.codec.decode(f.row('private-summary-lineage', badScope.id, z.unknown(), badScope)));
  const badEvidence = { ...original.lineage, owner: { ...original.lineage.owner, accounting: { state: 'no_dispatch', evidenceId: 'invalid-digest' } } };
  assert.throws(() => f.codec.decode(f.row('private-summary-lineage', badEvidence.id, z.unknown(), badEvidence)));
});


test('post-snapshot legacy-only history creates a deny gate without resurrecting its domain body', async () => {
  const f = await fixture(), original = dormantRows(f, { state: 'unresolved' }), context = original.rootContext;
  const collection = f.options.namespace + '_root_budget', path = collection + '/' + createHash('sha256').update(original.run.id).digest('hex');
  const aad = JSON.stringify(['yuban-root-budget', 1, f.options.projectId, collection, original.run.id]);
  const root: FirebaseBackupDocument = { path, data: { format: 'yuban-root-budget', version: 1,
    ciphertext: f.options.cipher.encrypt(canonical({ bindingFingerprint: createHash('sha256').update(canonical(context.binding)).digest('hex'),
      generation: context.generation, deadlineAtMs: context.binding.deadlineAtMs, limits: context.binding.limits,
      used: { modelCalls: 0, toolCalls: 0, queryEmbeddings: 0 }, status: 'active', attempts: [] }), aad) } };
  const result = f.restore([], [...original.rows, root]);
  const records = result.records.filter(row => row.path !== root.path).map(row => f.codec.decode(row));
  assert.equal(records.some(row => row.context.kind === 'private-summary-lineage' || row.context.kind === 'agent-run'), false);
  const restoredRoot = result.records.find(row => row.path === root.path)!;
  assert.ok(typeof restoredRoot.data.ciphertext === 'string');
  assert.equal(JSON.parse(f.options.cipher.decrypt(restoredRoot.data.ciphertext, aad)).status, 'stopped');
  const guards = records.filter(row => row.context.kind === 'private-summary-cutover');
  assert.equal(guards.length, 1);
  const guard = privateSummaryCutoverSchema.parse(guards[0]!.value);
  assert.equal(guard.phase, 'restore_suspended'); assert.equal(guard.restoreId, f.restoreId);
  assert.equal(guard.scope.storageEpoch, result.newEpochByWorkspace.get(f.scope.workspaceId));
});

test('legacy-only restore rejects original root attempt identities lost at an unchanged scalar count', async () => {
  const f = await fixture(), original = dormantRows(f, { state: 'unresolved' }), context = original.rootContext;
  const collection = f.options.namespace + '_root_budget', path = collection + '/' + createHash('sha256').update(original.run.id).digest('hex');
  const aad = JSON.stringify(['yuban-root-budget', 1, f.options.projectId, collection, original.run.id]);
  const root = (key: string): FirebaseBackupDocument => ({ path, data: { format: 'yuban-root-budget', version: 1,
    ciphertext: f.options.cipher.encrypt(canonical({ bindingFingerprint: createHash('sha256').update(canonical(context.binding)).digest('hex'),
      generation: context.generation, deadlineAtMs: context.binding.deadlineAtMs, limits: context.binding.limits,
      used: { modelCalls: 1, toolCalls: 0, queryEmbeddings: 0 }, status: 'active',
      attempts: [{ request: { key, fingerprint: 'b'.repeat(64), kind: 'model', units: 1 }, outcome: { status: 'reserved' } }] }), aad) } });
  const rejected = (error: unknown) => error instanceof Error && 'code' in error && error.code === 'restore_summary_protocol_evidence';
  assert.throws(() => f.restore([...original.rows, root('original-a')], [...original.rows, root('original-b')]), rejected);
  assert.throws(() => f.restore([root('original-a')], [...original.rows, root('original-b')]), rejected);
});

test('legacy-only restore rejects a daily counter below its distinct original attempts', async () => {
  const f = await fixture(), original = dormantRows(f, { state: 'unresolved' }), candidate = f.attempt();
  const collection = f.options.namespace + '_ai_usage', day = '2026-11-04';
  const seal = (id: string, value: unknown): FirebaseBackupDocument => ({ path: collection + '/' + id, data: {
    format: 'yuban-ai-daily-usage', version: 1, ciphertext: f.options.cipher.encrypt(canonical(value),
      canonical(['yuban-ai-daily-usage', 1, f.options.projectId, collection, id])) } });
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  const branch = (attemptKey: string) => {
    const request = { ...candidate.reservation.originalDailyRequest, rootRunId: original.run.id, attemptKey };
    return [seal('attempt_' + hash(canonical([request.rootRunId, request.attemptKey])), { request, billingSource: 'platform', day,
      reservedAtMs: Date.parse(f.at), record: null }), ...[null, f.scope.ownerUserId].map(userId =>
      seal('daily_' + hash(canonical(['platform', day, userId])), { attempts: 1, inputTokens: 0, outputTokens: 0, cachedTokens: 0, known: 0 }))];
  };
  assert.throws(() => f.restore([...original.rows, ...branch('original-a')], [...original.rows, ...branch('original-b')]),
    error => error instanceof Error && 'code' in error && error.code === 'restore_summary_protocol_evidence');
});

test('observed summary receipts require the original matching root and daily model evidence', async () => {
  const f = await fixture(), committed = f.terminal(), context = committed.value.rootContext!, reservation = committed.reservation;
  const source = [...f.baseRows().filter(row => !row.path.includes('_private_summary_usage/') && row.path !== f.workRow().path),
    f.workRow(committed.currentWork), ...committed.rows(), ...f.usageRows(committed.reservations)];
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  const collection = f.options.namespace + '_root_budget', path = collection + '/' + hash(committed.run.id);
  const aad = JSON.stringify(['yuban-root-budget', 1, f.options.projectId, collection, committed.run.id]);
  const root = (key = reservation.originalAttemptKey, outcome: { status: 'known'; reference: string } | { status: 'unknown' } = { status: 'known', reference: 'synthetic-response' }): FirebaseBackupDocument => ({ path, data: { format: 'yuban-root-budget', version: 1,
    ciphertext: f.options.cipher.encrypt(canonical({ bindingFingerprint: hash(canonical(context.binding)), generation: context.generation,
      deadlineAtMs: context.binding.deadlineAtMs, limits: context.binding.limits, used: { modelCalls: 1, toolCalls: 1, queryEmbeddings: 0 },
      status: 'stopped', attempts: [{ request: { key, fingerprint: reservation.requestFingerprint, kind: 'model', units: 1 },
        outcome }, { request: { key: committed.tool.originalAttemptKey, fingerprint: committed.tool.requestFingerprint, kind: 'tool_batch', units: 1 }, outcome }] }), aad) } });
  const dailyCollection = f.options.namespace + '_ai_usage', day = '2026-11-04';
  const daily = (request = reservation.originalDailyRequest, record: unknown = { kind: 'model', outcome: 'succeeded', inputTokens: 1, outputTokens: 1, cachedTokens: 0, durationMs: 1 }): FirebaseBackupDocument[] => {
    const seal = (id: string, value: unknown): FirebaseBackupDocument => ({ path: dailyCollection + '/' + id, data: {
      format: 'yuban-ai-daily-usage', version: 1, ciphertext: f.options.cipher.encrypt(canonical(value),
        canonical(['yuban-ai-daily-usage', 1, f.options.projectId, dailyCollection, id])) } });
    return [seal('attempt_' + hash(canonical([request.rootRunId, request.attemptKey])), { request, billingSource: 'platform', day,
      reservedAtMs: Date.parse(f.at), record }),
      ...[null, f.scope.ownerUserId].map(userId => seal('daily_' + hash(canonical(['platform', day, userId])),
        { attempts: 1, inputTokens: 1, outputTokens: 1, cachedTokens: 0, known: 1 }))];
  };
  const rejected = (error: unknown) => error instanceof Error && 'code' in error && error.code === 'restore_summary_protocol_evidence';
  assert.throws(() => f.restore(source), rejected);
  assert.throws(() => f.restore([...source, root()]), rejected);
  assert.throws(() => f.restore([...source, ...daily()]), rejected);
  assert.throws(() => f.restore([...source, root('different-original-key'), ...daily()]), rejected);
  assert.throws(() => f.restore([...source, root(), ...daily({ ...reservation.originalDailyRequest, requestFingerprint: 'c'.repeat(64) })]), rejected);
  assert.throws(() => f.restore([...source, root(), ...daily(undefined, null)]), rejected);
  assert.throws(() => f.restore([...source, root(), ...daily(undefined, { kind: 'model', outcome: 'unavailable', inputTokens: 1, outputTokens: 1, cachedTokens: 0, durationMs: 1 })]), rejected);
  assert.doesNotThrow(() => f.restore([...source, root(), ...daily()]));
  assert.doesNotThrow(() => f.restore([...source, root(undefined, { status: 'unknown' }), ...daily()]));
});

test('a post-execution superseded receipt cannot discard its original reserved protocol evidence', async () => {
  const f = await fixture(), a = f.terminal('superseded');
  const source = [...f.baseRows().filter(row => !row.path.includes('_private_summary_usage/') && row.path !== f.workRow().path),
    f.workRow(a.currentWork), ...a.rows(), ...f.usageRows(a.reservations)];
  assert.throws(() => f.restore(source), error => error instanceof Error && 'code' in error && error.code === 'restore_summary_protocol_evidence');
});

test('a response-observed receipt cannot bypass protocol checks with an empty reservation graph', async () => {
  const f = await fixture(), a = f.committed();
  const receipt = { kind: 'no_effect' as const, dispatchOutcome: 'response_observed' as const, stopReason: 'invalid_response' as const,
    workId: f.work.id, sourceRevision: 1, attemptId: a.value.id };
  Object.assign(a.value, { state: 'known_failed', receipt, plan: null, rootContext: null, modelReservationId: null,
    successorSchedule: null, chainLink: null, resultText: null });
  Object.assign(a.run, { state: 'stopped', stopReason: 'invalid_response', summaryEffect: receipt,
    result: { ...a.run.result!, countsKnown: true, status: 'stopped', stopReason: 'invalid_response' } });
  const source = [...f.baseRows().filter(row => row.path !== f.workRow().path),
    f.workRow({ ...f.work, state: 'failed', version: 2 }), ...a.rows()];
  assert.throws(() => f.restore(source), error => error instanceof Error && 'code' in error && error.code === 'restore_summary_protocol_evidence');
});


test('restore preserves all original terminal and zero-dispatch accounting classes', async () => {
  for (const kind of ['covered', 'not_dispatched_claimed', 'not_dispatched_reserved', 'response_observed', 'part_committed', 'published', 'superseded'] as const) {
    const f = await fixture(), a = f.terminal(kind);
    const source = [...f.baseRows().filter(row => row.path !== f.workRow().path && !row.path.includes('_private_summary_usage/')),
      f.workRow(a.currentWork), ...a.rows(), ...f.usageRows(a.reservations), ...a.protocolRows()];
    const result = f.restore(source), records = result.records.filter(row => !row.path.includes('_root_budget/') && !row.path.includes('_ai_usage/')).map(row => f.codec.decode(row));
    const work = privateSummaryWorkSchema.parse(records.find(row => row.context.kind === 'private-summary-work')!.value);
    assert.deepEqual(work.finalReceipt, a.currentWork.finalReceipt, kind);
    assert.deepEqual(work.completionWake, a.currentWork.completionWake, kind);
    const usage = privateSummaryUsageSchema.parse(records.find(row => row.context.kind === 'private-summary-usage')!.value);
    assert.equal(usage.used.modelCalls, a.reservations.filter(row => row.kind === 'model').length, kind);
    assert.equal(usage.used.toolCalls, a.reservations.filter(row => row.kind === 'tool').length, kind);
    assert.equal(work.state, a.currentWork.state === 'completed' ? 'completed' : 'restore_suspended', kind);
  }
});

test('reserved zero-dispatch history requires an empty original root and no daily admission', async () => {
  const f = await fixture(), a = f.terminal('not_dispatched_reserved');
  const source = [...f.baseRows().filter(row => row.path !== f.workRow().path && !row.path.includes('_private_summary_usage/')),
    f.workRow(a.currentWork), ...a.rows(), ...f.usageRows(a.reservations)];
  const rejected = (error: unknown) => error instanceof Error && 'code' in error && error.code === 'restore_summary_protocol_evidence';
  assert.throws(() => f.restore(source), rejected);
  const root = a.protocolRows()[0]!, collection = f.options.namespace + '_root_budget';
  const aad = JSON.stringify(['yuban-root-budget', 1, f.options.projectId, collection, a.run.id]);
  const raw = JSON.parse(f.options.cipher.decrypt(root.data.ciphertext, aad));
  raw.used.modelCalls = 1; raw.attempts = [{ request: { key: a.reservation.originalAttemptKey,
    fingerprint: a.reservation.requestFingerprint, kind: 'model', units: 1 }, outcome: { status: 'unknown' } }];
  assert.throws(() => f.restore([...source, { path: root.path, data: { ...root.data, ciphertext: f.options.cipher.encrypt(canonical(raw), aad) } }]), rejected);
});

test('terminal receipts reject a missing stage reservation despite an otherwise complete original root and daily graph', async () => {
  const f = await fixture(), a = f.terminal();
  const source = [...f.baseRows().filter(row => row.path !== f.workRow().path && !row.path.includes('_private_summary_usage/')),
    f.workRow(a.currentWork), ...a.rows(), ...f.usageRows([a.reservation]), ...a.protocolRows()];
  assert.throws(() => f.restore(source), error => error instanceof Error && 'code' in error && error.code === 'restore_summary_protocol_evidence');
});
