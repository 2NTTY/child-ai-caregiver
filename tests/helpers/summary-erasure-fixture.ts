import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { serialFirestoreFixture } from './firestore-session-memory.ts';
import { createStorageCipher } from '../../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../../server/firestore-authority.ts';
import { FirestoreDomainData, firestoreDomainHash } from '../../server/firestore-domain-data.ts';
import { openRecoveryEnvelope } from '../../server/firestore-recovery-envelope.ts';
import { privateSummaryWorkSchema, privateSummaryWorkProjection, privateSummaryAttemptSchema, summarySourceRevisionSchema, summaryGrantRecordId,
  summaryManifestHash, summaryRevisionId, summaryAttemptId, summaryLineageKey, summaryChainGenesis,
  type SummaryWorkGrant, type SummaryManifest } from '../../server/private-summary-work.ts';
import { firestoreAgentRunSchema } from '../../server/firestore-agent-runs.ts';
import { firebaseErasureIntentHash, type FirebaseErasureIntent, type FirebaseErasureDescriptor } from '../../server/firebase-erasure-journal.ts';
import type { FirestoreRestoreDecoded } from '../../server/firestore-restore-codec.ts';

export async function summaryErasureFixture(throughVersion = 1) {
  const fake = serialFirestoreFixture(), options = { database: fake.database, projectId: 'synthetic-summary-erasure',
    namespace: 'synthetic_summary_erasure', cipher: createStorageCipher(Buffer.alloc(32, 74)) };
  const data = new FirestoreDomainData(options), generation = randomUUID();
  await createFirestoreAuthority(options).initializeControl({ enabled: true, generation });
  const scope = { ownerUserId: 'synthetic-owner', workspaceId: randomUUID(), childId: randomUUID(), storageEpoch: randomUUID() };
  const workId = randomUUID(), messageId = randomUUID(), factId = randomUUID(), at = '2026-11-04T00:00:00Z';
  const grant: SummaryWorkGrant = { grantId: randomUUID(), revision: 1, policyVersion: 'synthetic-policy', settingsVersion: 'synthetic-settings',
    promptPackVersion: 'synthetic-pack', billingSource: 'platform', billingVersion: 'synthetic-billing', model: 'synthetic-model',
    limits: { modelCalls: 8, toolCalls: 8 }, workDeadlineAt: null, retryPolicyVersion: 'synthetic-no-retry' };
  const grantRecordId = summaryGrantRecordId(workId, grant);
  const manifest = (version: number): SummaryManifest => ({ format: 'private-summary-manifest/v1', kind: 'fresh_message', mode: 'private',
    coveredMessageIds: [messageId], repairOf: null, appendAfterSortKey: null, sourceBasis: 'a'.repeat(64), sourceCoverageComplete: true,
    dependencies: [{ kind: 'fact', id: factId, version, validUntil: null }], units: [{ kind: 'chat_text', messageId,
      sortKey: '0000000000000000001', messageHash: 'b'.repeat(64), utf16Length: 8 }] });
  const revision = (number: number) => summarySourceRevisionSchema.parse({ format: 'private-summary-source-revision/v1',
    id: summaryRevisionId(workId, number), workId, sourceRevision: number, scope, authorizationVersion: '1', workerGeneration: generation,
    manifest: manifest(number), manifestHash: summaryManifestHash(manifest(number)), createdAt: at });
  const rev1 = revision(1), rev2 = revision(2), text = 'Synthetic private accumulated text';
  const work = privateSummaryWorkSchema.parse({ format: 'private-summary-work/v1', id: workId, lineageKey: summaryLineageKey(scope, rev2.manifest),
    scope, authorizationVersion: '1', workerGeneration: generation, version: 2, sourceRevision: 2, sourceRevisionId: rev2.id,
    manifestHash: rev2.manifestHash, grant, grantRecordId, state: 'ready',
    chain: { committedParts: 1, next: { unitIndex: 0, offsetUtf16: 1 }, accumulatorHash: firestoreDomainHash(text), digest: 'c'.repeat(64) },
    nextAttempt: 0, accumulator: { text, hash: firestoreDomainHash(text) }, activeAttemptId: null, lastRetirementId: null, finalReceipt: null, completionWake: null });
  function attempt(number: number, state: 'committed' | 'unknown' = 'committed') {
    const binding = { workId, sourceRevision: number, step: 0, attempt: 0 }, id = summaryAttemptId(binding), runId = randomUUID(), triggerReference = randomUUID();
    const originalText = 'Synthetic revision ' + number + ' private output';
    const receipt = { kind: 'part_committed' as const, workId, sourceRevision: number, attemptId: id, step: 0, next: { unitIndex: 0, offsetUtf16: 1 } };
    const context = { generation: 1, binding: { rootRunId: runId, ownerId: scope.ownerUserId, workspaceId: scope.workspaceId, childId: scope.childId,
      storageEpoch: scope.storageEpoch, authorizationVersion: '1', trigger: { kind: 'worker', reference: triggerReference },
      workflowVersion: grant.policyVersion, promptPackVersion: grant.promptPackVersion, settingsVersion: grant.settingsVersion,
      billingVersion: grant.billingVersion, limits: { modelCalls: 4, toolCalls: 8, queryEmbeddings: 1 }, deadlineAtMs: Date.parse('2026-11-04T01:00:00Z') } };
    const plan = { binding, manifestHash: revision(number).manifestHash, range: { unitIndex: 0, startUtf16: 0, endUtf16: 1, metadataOnly: false },
      priorAccumulatorHash: null, requestFingerprint: 'd'.repeat(64), outputTextLimit: 6000 };
    const value = privateSummaryAttemptSchema.parse({ format: 'private-summary-attempt/v1', id, binding, runId, triggerReference, state,
      plan, sourceRevisionId: summaryRevisionId(workId, number), chainLink: state === 'committed' ? {
        predecessor: summaryChainGenesis(workId, number, plan.manifestHash), next: 'e'.repeat(64), range: plan.range, outputHash: firestoreDomainHash(originalText) } : null,
      receipt: state === 'committed' ? receipt : null, resultText: state === 'committed' ? originalText : null, contentState: 'present', erasureIntentId: null,
      retirementId: null, noDispatchReason: null, grantRecordId, rootContext: context, modelReservationId: 'f'.repeat(64),
      successorSchedule: { binding: { ...binding, step: 1 }, dueAt: at } });
    const result = { provenance: null, runId, status: 'completed' as const, stopReason: null, text: originalText, citations: [],
      retrievalMode: 'not_used' as const, tools: [], counts: { modelCalls: 1, toolCalls: 1, queryEmbeddings: 0 }, proposals: [] };
    const run = firestoreAgentRunSchema.parse({ id: runId, ...scope, authorizationVersion: '1', dataVersion: scope.storageEpoch + ':1',
      trigger: { kind: 'worker', reference: triggerReference }, workerGeneration: generation, summaryWork: binding, summaryRetirementId: null,
      ...(state === 'committed' ? { summaryEffect: receipt } : {}), sourceMessageId: null, recipeId: 'memory-refresh',
      state: state === 'committed' ? 'completed' : 'unknown', stopReason: state === 'unknown' ? 'interrupted' : null,
      createdAt: at, expiresAt: '2026-11-04T01:00:00Z', result: state === 'committed' ? result : null });
    return { value, run, originalText };
  }
  function store<T>(suffix: string, kind: string, id: string, schema: z.ZodType<T>, value: T, recordScope = scope, extra: Record<string, unknown> = {}) {
    const version = kind === 'private-summary-work' ? (value as { version: number }).version
      : kind === 'private-summary-usage' ? (value as { revision: number }).revision : 1;
    const ref = data.ref(suffix, kind, id), raw = { ...data.tags(recordScope), ...extra,
      ...(kind === 'private-summary-work' ? privateSummaryWorkProjection(privateSummaryWorkSchema.parse(value)) : {}), ...data.seal(kind, id, recordScope, schema, value,
      version) };
    fake.records.set(ref.path, raw);
    const opened = openRecoveryEnvelope({ ...options, locator: raw.recovery, envelope: { family: 'domain', version: raw.version,
      recordVersion: raw.recordVersion, ciphertext: raw.ciphertext } });
    return { path: ref.path, context: opened.context, value: opened.value } as FirestoreRestoreDecoded;
  }
  function seed(number: number, state: 'committed' | 'unknown' = 'committed') {
    const a = attempt(number, state), r = revision(number);
    const rows = [store('private_summary_revisions', 'private-summary-revision', r.id, summarySourceRevisionSchema, r),
      store('private_summary_attempts', 'private-summary-attempt', a.value.id, privateSummaryAttemptSchema, a.value),
      store('agent_runs', 'agent-run', a.run.id, firestoreAgentRunSchema, a.run, scope,
        { runId: a.run.id, createdAt: a.run.createdAt, triggerKind: a.run.trigger.kind })];
    return { ...a, revision: r, rows };
  }
  const intent: FirebaseErasureIntent = { type: 'content-delete', scope, assetId: factId, operationId: randomUUID(), at,
    content: { kind: 'fact', throughVersion } };
  const descriptor: FirebaseErasureDescriptor = { objectName: 'erasures/v1/' + 'a'.repeat(64), generation: '1', cipherSha256: 'b'.repeat(64),
    intentSha256: firebaseErasureIntentHash(intent), bytes: 512, format: 'yuban-erasure-journal/v1' };
  const journal = { async writeOnce(value: FirebaseErasureIntent) { if (firebaseErasureIntentHash(value) !== descriptor.intentSha256) throw Error('Synthetic intent mismatch'); return descriptor; },
    async read(value: FirebaseErasureIntent) { if (firebaseErasureIntentHash(value) !== descriptor.intentSha256) throw Error('Synthetic intent mismatch'); return intent; } };
  const workRow = store('private_summary_works', 'private-summary-work', work.id, privateSummaryWorkSchema, work, scope, { completionWakeState: 'none' });
  return { fake, options, data, scope, generation, work, workRow, revision, seed, store, intent, descriptor, journal };
}
