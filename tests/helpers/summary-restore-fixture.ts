import { randomUUID, createHash } from 'node:crypto';
import type { z } from 'zod';
import { firestoreDomainFixture } from './firestore-domain-memory.ts';
import { createStorageCipher } from '../../server/storage-crypto.ts';
import { FirestoreDomainData, firestoreDomainHash } from '../../server/firestore-domain-data.ts';
import { createFirestoreRestoreCodec } from '../../server/firestore-restore-codec.ts';
import { privateSummaryWorkSchema, privateSummaryWorkProjection, privateSummaryUsageSchema, summarySourceRevisionSchema, summaryGrantRecordSchema,
  summaryLineageRecordSchema, privateSummaryAttemptSchema, privateSummaryReservationSchema, summaryRevisionId,
  summaryGrantRecordId, summaryManifestHash, summaryLineageKey, summaryChainGenesis, summaryAttemptId,
  summaryReservationId, summaryCompletionWakeId, type SummaryManifest, type SummaryRunBinding } from '../../server/private-summary-work.ts';
import { firestoreAgentRunSchema } from '../../server/firestore-agent-runs.ts';
import { canonical } from '../../server/firestore-session-codec.ts';
import { agentBudgetFingerprint } from '../../server/agent-budget.ts';
import type { FirestoreDomainOptions } from '../../server/firestore-domain-data.ts';
import type { WorkRecoveryScope } from '../../server/firestore-work-continuation-recovery.ts';
import type { FirebaseBackupDocument } from '../../server/firestore-backup.ts';

export function summaryRestoreFixture(input?: { options: FirestoreDomainOptions; scope: WorkRecoveryScope; generation: string }) {
  const fake = firestoreDomainFixture(), options = input?.options ?? { database: fake.database, cipher: createStorageCipher(Buffer.alloc(32, 63)),
    projectId: 'synthetic-summary-restore', namespace: 'summary_restore' };
  const data = new FirestoreDomainData(options), codec = createFirestoreRestoreCodec(options);
  const scope = input?.scope ?? { ownerUserId: 'synthetic-owner', workspaceId: randomUUID(), childId: randomUUID(), storageEpoch: randomUUID() };
  const workId = randomUUID(), generation = input?.generation ?? randomUUID(), at = '2026-11-04T12:00:00.000Z';
  const manifest: SummaryManifest = { format: 'private-summary-manifest/v1', mode: 'private', appendAfterSortKey: null,
    sourceBasis: 'a'.repeat(64), sourceCoverageComplete: true, dependencies: [], kind: 'fresh_message', repairOf: null,
    coveredMessageIds: [randomUUID()], units: [] };
  manifest.units.push({ kind: 'chat_text', messageId: manifest.coveredMessageIds[0], sortKey: '0000000000000000001',
    messageHash: firestoreDomainHash('synthetic source'), utf16Length: 12 });
  const grant = { grantId: randomUUID(), revision: 1, policyVersion: 'synthetic-policy', settingsVersion: 'synthetic-settings',
    promptPackVersion: 'synthetic-prompts', billingSource: 'platform' as const, billingVersion: 'synthetic-billing', model: 'synthetic-model',
    limits: { modelCalls: 10, toolCalls: 10 }, workDeadlineAt: null, retryPolicyVersion: 'synthetic-no-retry' };
  const grantRecord = summaryGrantRecordSchema.parse({ format: 'private-summary-grant/v1', id: summaryGrantRecordId(workId, grant), workId, grant, renewal: null });
  const revision = summarySourceRevisionSchema.parse({ format: 'private-summary-source-revision/v1', id: summaryRevisionId(workId, 1),
    workId, sourceRevision: 1, scope, authorizationVersion: '1', workerGeneration: generation, manifest, manifestHash: summaryManifestHash(manifest), createdAt: at });
  const work = privateSummaryWorkSchema.parse({ format: 'private-summary-work/v1', id: workId, lineageKey: summaryLineageKey(scope, manifest),
    scope, authorizationVersion: '1', workerGeneration: generation, version: 1, sourceRevision: 1, sourceRevisionId: revision.id,
    manifestHash: revision.manifestHash, grant, grantRecordId: grantRecord.id, state: 'ready', chain: { committedParts: 0,
      next: { unitIndex: 0, offsetUtf16: 0 }, accumulatorHash: null, digest: summaryChainGenesis(workId, 1, revision.manifestHash) },
    nextAttempt: 0, accumulator: null, activeAttemptId: null, lastRetirementId: null, finalReceipt: null, completionWake: null });
  const lineage = summaryLineageRecordSchema.parse({ format: 'private-summary-lineage/v1', id: work.lineageKey, scope,
    authorizationVersion: '1', workerGeneration: generation, version: 1, owner: { kind: 'work', workId } });
  const usage = privateSummaryUsageSchema.parse({ format: 'private-summary-usage/v1', workId, grant, grantRecordId: grantRecord.id,
    used: { modelCalls: 0, toolCalls: 0 }, revision: 1, unresolvedRetiredCount: 0 });
  function row<T>(kind: string, id: string, schema: z.ZodType<T>, value: T, version = 1, extra: Record<string, unknown> = {}): FirebaseBackupDocument {
    const suffix = kind === 'private-summary-work' || kind === 'private-summary-lineage' ? 'private_summary_works'
      : kind === 'private-summary-revision' ? 'private_summary_revisions' : kind === 'private-summary-attempt' ? 'private_summary_attempts'
      : kind === 'agent-run' ? 'agent_runs' : 'private_summary_usage';
    return { path: data.ref(suffix, kind, id).path, data: { ...data.tags(scope), ...extra, ...data.seal(kind, id, scope, schema, value, version) } };
  }
  const workRow = (value = work) => row('private-summary-work', value.id, privateSummaryWorkSchema, value, value.version,
    privateSummaryWorkProjection(value));
  const usageRows = (reservations: z.infer<typeof privateSummaryReservationSchema>[] = [], revisionNumber = reservations.length + 1) => [
    row('private-summary-grant', grantRecord.id, summaryGrantRecordSchema, grantRecord),
    row('private-summary-usage', workId, privateSummaryUsageSchema, { ...usage, revision: revisionNumber,
      used: { modelCalls: reservations.filter(r => r.kind === 'model').length,
        toolCalls: reservations.filter(r => r.kind === 'tool').reduce((sum, r) => sum + r.units, 0) } }, revisionNumber),
    ...reservations.map(value => row('private-summary-reservation', value.reservationId, privateSummaryReservationSchema, value)),
  ];
  function attempt(step = 0, attemptNumber = 0) {
    const binding: SummaryRunBinding = { workId, sourceRevision: 1, step, attempt: attemptNumber };
    const id = summaryAttemptId(binding), runId = randomUUID(), reference = randomUUID();
    const rootContext = { binding: { rootRunId: runId, ownerId: scope.ownerUserId, workspaceId: scope.workspaceId,
      childId: scope.childId, storageEpoch: scope.storageEpoch, authorizationVersion: '1', trigger: { kind: 'worker', reference },
      workflowVersion: grant.policyVersion, promptPackVersion: grant.promptPackVersion, settingsVersion: grant.settingsVersion,
      billingVersion: grant.billingVersion, limits: { modelCalls: 4, toolCalls: 4, queryEmbeddings: 1 }, deadlineAtMs: Date.parse(at) + 60000 }, generation: 1 };
    const run = firestoreAgentRunSchema.parse({ id: runId, ...scope, authorizationVersion: '1', dataVersion: scope.storageEpoch + ':1',
      workerGeneration: generation, summaryWork: binding, summaryRetirementId: null, trigger: { kind: 'worker', reference }, sourceMessageId: null,
      recipeId: 'memory-refresh', state: 'running', stopReason: null, createdAt: at, expiresAt: new Date(rootContext.binding.deadlineAtMs).toISOString(), result: null });
    const key = 'model:' + agentBudgetFingerprint([run.id, run.trigger, 'first-model']);
    const reservation = privateSummaryReservationSchema.parse({ format: 'private-summary-reservation/v1', workId,
      reservationId: summaryReservationId(workId, key, 'model'), attemptId: id, runId, grantRevision: 1, grantRecordId: grantRecord.id,
      originalAttemptKey: key, requestFingerprint: 'b'.repeat(64), kind: 'model', units: 1,
      originalDailyRequest: { rootRunId: runId, attemptKey: key, userId: scope.ownerUserId, childId: scope.childId,
        kind: 'model', model: grant.model, bindingFingerprint: agentBudgetFingerprint(rootContext), requestFingerprint: 'b'.repeat(64),
        deadlineAtMs: rootContext.binding.deadlineAtMs, userLimit: 10, globalLimit: 100 } });
    if (reservation.kind !== 'model') throw new Error('Expected a synthetic model reservation');
    const value = privateSummaryAttemptSchema.parse({ format: 'private-summary-attempt/v1', id, binding, runId, triggerReference: reference,
      state: 'reserved', plan: { binding, manifestHash: revision.manifestHash, range: { unitIndex: 0, startUtf16: step * 4,
        endUtf16: (step + 1) * 4, metadataOnly: false }, priorAccumulatorHash: null, requestFingerprint: reservation.requestFingerprint, outputTextLimit: 100 },
      sourceRevisionId: revision.id, chainLink: null, receipt: null, resultText: null, contentState: 'present', erasureIntentId: null,
      retirementId: null, noDispatchReason: null, grantRecordId: grantRecord.id, rootContext, modelReservationId: reservation.reservationId,
      successorSchedule: { binding: { ...binding, step: step + 1, attempt: 0 }, dueAt: at } });
    return { value, run, reservation, rows: () => [row('private-summary-attempt', value.id, privateSummaryAttemptSchema, value), row('agent-run', run.id, firestoreAgentRunSchema, run)] };
  }
  function committed(step = 0, priorHash: string | null = null, predecessor = work.chain.digest, attemptNumber = 0) {
    const a = attempt(step, attemptNumber), text = 'Synthetic accumulator ' + step, next = { unitIndex: 0, offsetUtf16: (step + 1) * 4 };
    a.value.state = 'committed'; a.value.resultText = text; a.value.plan!.priorAccumulatorHash = priorHash;
    a.value.receipt = { kind: 'part_committed', workId, sourceRevision: 1, attemptId: a.value.id, step, next };
    const outputHash = firestoreDomainHash(text);
    a.value.chainLink = { predecessor, outputHash, range: a.value.plan!.range,
      next: firestoreDomainHash(['private-summary-chain-link/v1', predecessor, a.value.binding, a.value.runId, a.value.plan!.range, outputHash, next]) };
    a.run.state = 'completed'; a.run.summaryEffect = a.value.receipt;
    a.run.result = { provenance: null, runId: a.run.id, status: 'completed', stopReason: null, text: '', citations: [],
      retrievalMode: 'not_used', tools: [], counts: { modelCalls: 1, toolCalls: 0, queryEmbeddings: 0 }, proposals: [] };
    const currentWork = privateSummaryWorkSchema.parse({ ...work, version: step + 2, chain: { committedParts: step + 1,
      next, accumulatorHash: outputHash, digest: a.value.chainLink.next }, accumulator: { text, hash: outputHash } });
    return { ...a, currentWork };
  }
  /** Accounting graphs produced by the original terminal/coverage writers, without restoring native sessions. */
  function terminal(kind: 'part_committed' | 'published' | 'superseded' | 'response_observed' | 'not_dispatched_reserved' | 'not_dispatched_claimed' | 'covered' = 'part_committed') {
    const a = committed(), context = a.value.rootContext!;
    const { originalDailyRequest, ...basis } = a.reservation, originalAttemptKey = a.reservation.originalAttemptKey + ':tool-batch';
    const calls = [{ id: 'synthetic-stage-call', name: 'stage_private_summary', args: { text: a.value.resultText! } }];
    const tool = privateSummaryReservationSchema.parse({ ...basis, kind: 'tool', units: 1, originalAttemptKey,
      reservationId: summaryReservationId(workId, originalAttemptKey, 'tool'), requestFingerprint: agentBudgetFingerprint({ calls, units: 1 }) });
    const complete = ['part_committed', 'published', 'superseded'].includes(kind), dispatched = complete || kind === 'response_observed';
    const reserved = dispatched || kind === 'not_dispatched_reserved';
    const reservations = reserved ? complete ? [a.reservation, tool] : [a.reservation] : [];
    const counts = { modelCalls: dispatched ? 1 : 0, toolCalls: complete ? 1 : 0, queryEmbeddings: 0 };
    let currentWork = a.currentWork;
    if (kind !== 'part_committed' && kind !== 'published') {
      a.value.chainLink = null; a.value.resultText = null;
      currentWork = { ...work, version: 2, state: kind === 'superseded' ? 'invalidated' : kind === 'covered' ? 'completed' : 'failed' };
      a.value.receipt = kind === 'superseded' || kind === 'covered'
        ? { kind: 'superseded', reason: kind === 'covered' ? 'already_covered' : 'source_changed', workId, sourceRevision: 1, attemptId: a.value.id }
        : { kind: 'no_effect', dispatchOutcome: kind === 'response_observed' ? 'response_observed' : 'not_dispatched',
          stopReason: kind === 'response_observed' ? 'invalid_response' : 'unavailable', workId, sourceRevision: 1, attemptId: a.value.id };
      a.value.state = kind === 'response_observed' ? 'known_failed' : kind.startsWith('not_dispatched') ? 'not_dispatched' : 'committed';
      a.value.noDispatchReason = kind.startsWith('not_dispatched') ? 'unavailable' : null;
      if (!reserved) { a.value.plan = null; a.value.rootContext = kind === 'covered' ? null : context; a.value.modelReservationId = null; a.value.successorSchedule = null; }
    } else if (kind === 'published') {
      a.value.plan!.range.endUtf16 = manifest.units[0].utf16Length; a.value.successorSchedule = null;
      const next = { unitIndex: 1, offsetUtf16: 0 }, outputHash = a.value.chainLink!.outputHash;
      const digest = firestoreDomainHash(['private-summary-chain-link/v1', work.chain.digest, a.value.binding, a.value.runId, a.value.plan!.range, outputHash, next]);
      a.value.chainLink = { ...a.value.chainLink!, range: { ...a.value.plan!.range }, next: digest };
      a.value.receipt = { kind: 'published', workId, sourceRevision: 1, attemptId: a.value.id, summaryId: randomUUID(), summaryVersion: 1,
        coveredMessageIds: manifest.coveredMessageIds, repairOf: manifest.repairOf };
      currentWork = { ...currentWork, state: 'completed', chain: { committedParts: 1, next, accumulatorHash: outputHash, digest } };
    }
    if (currentWork.state === 'completed') currentWork = { ...currentWork, finalReceipt: a.value.receipt,
      completionWake: { id: summaryCompletionWakeId(workId, a.value.id), receiptHash: firestoreDomainHash(a.value.receipt), scheduling: { kind: 'pending_schedule' } } };
    const noEffect = a.value.receipt!.kind === 'no_effect';
    a.run.state = noEffect ? 'stopped' : 'completed'; a.run.stopReason = a.value.receipt!.kind === 'no_effect' ? a.value.receipt!.stopReason : null;
    a.run.summaryEffect = a.value.receipt ?? undefined;
    a.run.result = { provenance: a.value.rootContext ? { packVersion: grant.promptPackVersion, recipeId: 'memory-refresh', model: grant.model } : null,
      runId: a.run.id, status: noEffect ? 'stopped' : 'completed', stopReason: a.run.stopReason, countsKnown: true,
      ...(noEffect ? {} : { outcome: 'no_action' as const }), text: '', citations: [], privateSourceCitations: [], retrievalMode: 'not_used', proposals: [],
      counts, tools: complete ? [{ name: 'stage_private_summary', status: 'succeeded' }] : [] };
    const protocolRows = (): FirebaseBackupDocument[] => {
      if (!reserved) return [];
      const hash = (value: string) => createHash('sha256').update(value).digest('hex'), collection = options.namespace + '_root_budget';
      const root = { bindingFingerprint: hash(canonical(context.binding)), generation: context.generation, deadlineAtMs: context.binding.deadlineAtMs,
        limits: context.binding.limits, used: counts, status: 'stopped', attempts: dispatched ? reservations.map(value => ({ request: {
          key: value.originalAttemptKey, fingerprint: value.requestFingerprint, kind: value.kind === 'model' ? 'model' : 'tool_batch', units: value.units },
          outcome: { status: 'unknown' } })) : [] };
      const result: FirebaseBackupDocument[] = [{ path: collection + '/' + hash(a.run.id), data: { format: 'yuban-root-budget', version: 1,
        ciphertext: options.cipher.encrypt(canonical(root), JSON.stringify(['yuban-root-budget', 1, options.projectId, collection, a.run.id])) } }];
      if (!dispatched) return result;
      const dailyCollection = options.namespace + '_ai_usage', day = '2026-11-04';
      const seal = (id: string, value: unknown) => ({ path: dailyCollection + '/' + id, data: { format: 'yuban-ai-daily-usage', version: 1,
        ciphertext: options.cipher.encrypt(canonical(value), canonical(['yuban-ai-daily-usage', 1, options.projectId, dailyCollection, id])) } });
      result.push(seal('attempt_' + hash(canonical([a.run.id, originalDailyRequest.attemptKey])), { request: originalDailyRequest, billingSource: grant.billingSource,
        day, reservedAtMs: Date.parse(at), record: { kind: 'model', outcome: 'succeeded', inputTokens: 1, outputTokens: 1, cachedTokens: 0, durationMs: 1 } }),
      ...[null, scope.ownerUserId].map(userId => seal('daily_' + hash(canonical([grant.billingSource, day, userId])),
        { attempts: 1, inputTokens: 1, outputTokens: 1, cachedTokens: 0, known: 1 })));
      return result;
    };
    return { ...a, currentWork: privateSummaryWorkSchema.parse(currentWork), tool, reservations, protocolRows };
  }
  const baseRows = () => [workRow(), row('private-summary-lineage', lineage.id, summaryLineageRecordSchema, lineage),
    row('private-summary-revision', revision.id, summarySourceRevisionSchema, revision), ...usageRows()];
  return { options, data, codec, scope, generation, at, work, revision, grantRecord, lineage, usage, row, workRow, usageRows, attempt, committed, terminal, baseRows };
}
