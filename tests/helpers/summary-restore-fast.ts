import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { privateSummaryFastFixture } from './private-summary-fast.ts';
import { createFirestorePrivateSummaryWork } from '../../server/firestore-private-summary-work.ts';
import { createPrivateSummaryFastNoDispatchVerifier } from '../../server/private-summary-terminal.ts';
import { FirestoreRootBudget, firestoreRootBudgetRecoverySchema } from '../../server/firestore-root-budget.ts';
import { createFirestoreRestoreCodec } from '../../server/firestore-restore-codec.ts';
import { prepareFirebaseRestore } from '../../server/firestore-restore.ts';
import { isRestoreProtocolOrUsage } from '../../server/firestore-restore-usage.ts';
import { firestoreAgentRunSchema, type FirestoreAgentRun } from '../../server/firestore-agent-runs.ts';
import { summaryLineageRecordSchema, type SummaryLineageRecord } from '../../server/private-summary-work.ts';
import { canonical } from '../../server/firestore-session-codec.ts';
import type { AgentRunClaim } from '../../server/product-agent-store.ts';
import type { FirebaseBackupDocument } from '../../server/firestore-backup.ts';

/** Actual fast probe/selection/certificate/T0 writers, with only synthetic authority and source data. */
export async function summaryRestoreFastFixture(mode: 'selected' | 'certificate' | 'transferred') {
  const f = await privateSummaryFastFixture();
  const scope = await f.authority.runTransaction('owner', f.childId, async b => b.scope);
  if (mode === 'selected') await f.chat.createUserMessageForUser('owner', f.childId, 'Second complete synthetic source');
  const candidate = (await f.memory.prepareMaintenance('owner', f.childId))!;
  const root = new FirestoreRootBudget({ ...f.options, namespace: f.options.namespace + '_root_budget' });
  const service = createFirestorePrivateSummaryWork({ ...f.options, memory: f.memory, runs: f.runs, policy: f.policy,
    fastNoDispatchVerifier: createPrivateSummaryFastNoDispatchVerifier({ root, sessions: f.sessions }) });
  const codec = createFirestoreRestoreCodec(f.options);
  const domain = (documents: readonly FirebaseBackupDocument[]) => documents
    .filter(row => !isRestoreProtocolOrUsage(f.options.namespace, row.path)).map(row => codec.decode(row));
  const capture = (): FirebaseBackupDocument[] => [...f.fake.records]
    .filter(([path]) => (path.startsWith(f.options.namespace + '_') || path.startsWith(f.options.namespace + '/'))
      && !path.includes('_test_summary_'))
    .map(([path, data]) => ({ path, data: structuredClone(data) }));
  let claim!: AgentRunClaim, probe!: FirebaseBackupDocument[], bound!: FirebaseBackupDocument[];
  await f.withScopeLease(async reference => {
    claim = await f.authority.runTransaction('owner', f.childId, async b => {
      const prepared = await f.runs.prepareFastProbeClaim(b, { reference, candidate, candidateRunId: randomUUID() });
      assert.equal(prepared.kind, 'claimed'); if (prepared.kind !== 'claimed') throw new Error('Expected original synthetic fast probe');
      prepared.commit(); return prepared.claim;
    });
    probe = capture();
    await service.bindFastRoot('owner', f.childId, claim.runId, f.context(claim));
    await root.open(f.context(claim)); bound = capture();
    if (mode === 'selected') await f.authority.runTransaction('owner', f.childId, async b => {
      const target = { kind: 'fresh_prefix' as const, firstMessageId: candidate.messages[0].id, messageCount: candidate.messages.length };
      const source = await f.memory.readFastSource(b, target);
      assert.equal(source.kind, 'eligible'); if (source.kind !== 'eligible') throw new Error('Expected complete synthetic prefix');
      const prepared = await service.prepareFastAdmission(b, { runId: claim.runId, reference, target, expectedSourceHash: source.sourceHash });
      assert.equal(prepared.kind, 'prepared'); if (prepared.kind !== 'prepared') throw new Error('Expected selected synthetic prefix');
      prepared.commit();
    });
  });
  let certificate: FirebaseBackupDocument[] | null = null;
  if (mode !== 'selected') {
    await root.stop(f.context(claim));
    assert.equal((await service.commitFastNoDispatch('owner', f.childId, claim.runId)).kind, 'verified');
    certificate = capture();
    if (mode === 'transferred') await f.withScopeLease(async reference => {
      const started = await service.start('owner', f.childId, { kind: 'next_fresh' }, { reference });
      assert.equal(started.kind, 'created'); if (started.kind !== 'created') throw new Error('Expected one synthetic transferred work');
    });
  }
  const current = capture(), context = f.context(claim), restoreId = randomUUID();
  const rootPath = f.options.namespace + '_root_budget/' + createHash('sha256').update(claim.runId).digest('hex');
  const rootAad = JSON.stringify(['yuban-root-budget', 1, f.options.projectId, f.options.namespace + '_root_budget', claim.runId]);
  const run = (documents = current) => firestoreAgentRunSchema.parse(domain(documents).find(row => row.context.kind === 'agent-run' && row.context.id === claim.runId)!.value);
  function replaceRun(documents: FirebaseBackupDocument[], value: FirestoreAgentRun) {
    const row = documents.find(row => row.path === f.data.ref('agent_runs', 'agent-run', claim.runId).path)!;
    row.data = { ...row.data, ...f.data.seal('agent-run', value.id, scope, firestoreAgentRunSchema, value, 1) };
  }
  function replaceLineage(documents: FirebaseBackupDocument[], value: SummaryLineageRecord) {
    const row = documents.find(row => row.path === f.data.ref('private_summary_works', 'private-summary-lineage', value.id).path)!;
    row.data = { ...row.data, ...f.data.seal('private-summary-lineage', value.id, value.scope, summaryLineageRecordSchema, value, value.version) };
  }
  const rootValue = (documents = current) => firestoreRootBudgetRecoverySchema.parse(JSON.parse(
    f.options.cipher.decrypt(documents.find(row => row.path === rootPath)!.data.ciphertext as string, rootAad)));
  function replaceRoot(documents: FirebaseBackupDocument[], value: ReturnType<typeof rootValue>) {
    documents.find(row => row.path === rootPath)!.data = { format: 'yuban-root-budget', version: 1,
      ciphertext: f.options.cipher.encrypt(canonical(firestoreRootBudgetRecoverySchema.parse(value)), rootAad) };
  }
  function pause(documents: readonly FirebaseBackupDocument[], generation: string) {
    return documents.map(row => {
      if (isRestoreProtocolOrUsage(f.options.namespace, row.path)) return row;
      const decoded = codec.decode(row); if (decoded.context.kind !== 'control') return row;
      const transformed = codec.transform(decoded, { newEpochByWorkspace: new Map(), generation, photoDescriptors: new Map() });
      return { path: transformed.path, data: transformed.data };
    });
  }
  const restore = (snapshot = current, live = snapshot, sourceGeneration: string = f.generation, operationId: string = restoreId) => prepareFirebaseRestore(f.options, {
    restoreId: operationId, targetDatabaseId: 'synthetic-target-db', sourceGeneration,
    documents: pause(snapshot, sourceGeneration), liveDocuments: pause(live, sourceGeneration),
    authUsers: [{ userId: 'owner', email: 'owner@example.test', disabled: false, emailVerified: true }], erasures: [],
    photoDescriptors: new Map(), erasureDescriptors: new Map() });
  return { ...f, scope, root, service, codec, domain, capture, probe, bound, certificate, current, context, claim, candidate,
    rootPath, rootAad, rootValue, replaceRoot, run, replaceRun, replaceLineage, restore, restoreId };
}
