import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { productAgentResultSchema } from '../src/shared/product-agent-result.ts';
import type { ProductAgentResult } from '../src/shared/product-agent.ts';
import { createFirestoreAuthority, FirestoreAuthorityError, type FirestoreAuthorityTransaction as Binding } from './firestore-authority.ts';
import { FirestoreDomainData, FirestoreDomainError, domainParse, domainReject, firestoreDomainHash, type FirestoreDomainOptions } from './firestore-domain-data.ts';
import { prepareFirestoreBackgroundWork, readFirestoreBackgroundClaim, firestoreBackgroundWorkSchema } from './firestore-background-work.ts';
import { privateSummaryWorkSchema, privateSummaryUsageSchema, summarySourceRevisionSchema, summaryGrantRecordSchema,
  summaryLineageRecordSchema, summaryWorkGrantSchema, summaryLineageKey, summaryManifestHash, summaryRevisionId,
  summaryGrantRecordId, summaryChainGenesis, summaryPartBackgroundIdentity, privateSummaryAttemptSchema, summaryAttemptId, privateSummaryReservationSchema, summaryReservationId, summaryPartPlanSchema, summaryCompletionWakeSchema, summaryCompletionWakeId, summaryCompletionWakeIdentity, summarySuccessorScheduleSchema, summaryEffectReceiptSchema, parseSummaryBackgroundBasis, privateSummaryWorkProjection } from './private-summary-work.ts';
import { workRecoveryScopeSchema } from './firestore-work-continuation-recovery.ts';
import { readPrivateSummaryEntryGate } from './firestore-private-summary-cutover.ts';
import { prepareSummaryWorkPending } from './firestore-context-basis.ts';
import { preparePrivateSummaryScanProgress } from './firestore-private-summary-scan.ts';
import type { AgentScope } from './agent-runtime.ts';
import { firestoreRootBudgetContextSchema } from './firestore-root-budget.ts';
import { validateSummaryAdvance } from './private-summary-fragments.ts';
import { summarySaveSchema } from './memory-validation.ts';
import { agentBudgetFingerprint } from './agent-budget.ts';
import type { DurableAiUsageRequest } from './durable-ai-usage.ts';
import type { RootBudgetContext } from './durable-root-budget.ts';
import type { FirestoreAgentRun } from './firestore-agent-runs.ts';
import type { AgentRunClaim } from './product-agent-store.ts';
import type { FirestoreAgentRuns } from './firestore-agent-runs.ts';
import type { FirestoreMemoryStore } from './firestore-memory.ts';
import type { PrivateSummaryWork, PrivateSummaryUsage, PrivateSummarySourceRevision, SummaryGrantRecord,
  SummaryManifest, SummaryWorkGrant, SummarySourceReason, SummaryFastTarget, SummaryLineageRecord, PrivateSummaryAttempt, SummaryPartPlan, SummaryCompletionWake } from './private-summary-work.ts';

export type SummaryLegacyAdmission = { kind: 'blocked'; reason: 'missing' | 'incomplete' | 'unfenced' | 'unmapped_legacy' | 'stale' }
  | { kind: 'admitted'; barrierId: string; barrierVersion: number; scope: Binding['scope']; authorizationVersion: string;
      workerGeneration: string; lineageKey: string; manifestHash: string; inventoryHash: string };
/** Constructor-only authority reader. Never accept an admission proof in a request/model payload. */
export interface SummaryWorkPolicyPort {
  resolveSourceRevisionDueAt?(binding: Binding, input: { work: PrivateSummaryWork; priorRevision: PrivateSummarySourceRevision;
    manifest: SummaryManifest; grantRecord: SummaryGrantRecord }):
    Promise<{ kind: 'due'; dueAt: string } | { kind: 'blocked'; reason: 'policy_missing' | 'unavailable' }>;
  resolveNextPartDueAt?(binding: Binding, input: { work: PrivateSummaryWork; grantRecord: SummaryGrantRecord; plan: SummaryPartPlan; nextBinding: SummaryPartPlan['binding'] }):
    Promise<{ kind: 'due'; dueAt: string } | { kind: 'blocked'; reason: 'policy_missing' | 'unavailable' }>;
  resolveWakeDueAt?(binding: Binding, input: { work: PrivateSummaryWork; reason: 'scope_after_completion' }):
    Promise<{ kind: 'due'; dueAt: string } | { kind: 'blocked'; reason: 'policy_missing' | 'unavailable' }>;
  validateDailyRequest?(binding: Binding, input: { grantRecord: SummaryGrantRecord; run: FirestoreAgentRun; context: RootBudgetContext; request: DurableAiUsageRequest }):
    Promise<{ kind: 'matched'; grantRecordId: string; contextFingerprint: string; dailyRequestHash: string } | { kind: 'blocked'; reason: 'missing' | 'binding' | 'unavailable' }>;
  validateRootBinding?(binding: Binding, input: { grantRecord: SummaryGrantRecord; run: FirestoreAgentRun; context: RootBudgetContext }):
    Promise<{ kind: 'matched'; grantRecordId: string; contextFingerprint: string } | { kind: 'blocked'; reason: 'missing' | 'binding' | 'unavailable' }>;
  resolveInitial(binding: Binding, input: { workId: string; manifest: SummaryManifest }):
    Promise<{ grant: SummaryWorkGrant; dueAt: string } | null>;
  readLegacyAdmission(binding: Binding, input: { lineageKey: string; manifestHash: string }): Promise<SummaryLegacyAdmission>;
}
export interface FirestorePrivateSummaryWorkOptions extends FirestoreDomainOptions {
  memory: FirestoreMemoryStore;
  policy?: SummaryWorkPolicyPort;
  runs?: FirestoreAgentRuns;
  serverClock?: () => number;
  terminalVerifier?: SummaryTerminalVerifier;
  fastNoDispatchVerifier?: SummaryFastNoDispatchVerifier;
}
export interface SummaryFastNoDispatchVerifier {
  /** Read only the original bound ledger; never open, reset or recreate it. */
  verify(binding: Binding, run: FirestoreAgentRun): Promise<{ kind: 'verified'; evidenceId: string } | { kind: 'blocked' }>;
}
export type SummaryVerifiedTerminal =
  | { kind: 'terminal'; text: string; counts: import('./durable-root-budget.ts').RootBudgetLimits; tools: import('../src/shared/product-agent.ts').ProductAgentResult['tools']; evidenceHash: string }
  | { kind: 'no_effect'; dispatchOutcome: 'not_dispatched' | 'response_observed'; stopReason: import('./agent-budget.ts').AgentStopReason;
      counts: import('./durable-root-budget.ts').RootBudgetLimits; tools: import('../src/shared/product-agent.ts').ProductAgentResult['tools']; evidenceHash: string }
  | { kind: 'unknown' };
export interface SummaryTerminalVerifier {
  verify(binding: Binding, input: { work: PrivateSummaryWork; revision: PrivateSummarySourceRevision; attempt: PrivateSummaryAttempt;
    grantRecord: SummaryGrantRecord; run: FirestoreAgentRun; modelReservation: import('./private-summary-work.ts').PrivateSummaryUsageReservation | null;
    toolReservation: import('./private-summary-work.ts').PrivateSummaryUsageReservation | null }): Promise<SummaryVerifiedTerminal>;
}
export type SummaryWorkStart = { kind: 'created' | 'lookup'; work: PrivateSummaryWork }
  | { kind: 'blocked'; reason: SummarySourceReason | 'policy_missing' | 'legacy_missing' | 'legacy_incomplete'
      | 'legacy_unfenced' | 'legacy_unmapped_legacy' | 'legacy_stale' | 'legacy_active' | 'authority_changed'
      | 'grant_expired' | 'grant_exhausted' }
  | { kind: 'no_work' | 'already_covered' };
export type SummaryPartClaim = { decision: 'execute' | 'lookup'; claim: AgentRunClaim; attempt: PrivateSummaryAttempt }
  | { decision: 'blocked'; reason: SummarySourceReason | PrivateSummaryWork['state']; work: PrivateSummaryWork };
export type SummarySourceRefresh = { kind: 'refreshed' | 'unchanged' | 'lookup' | 'completed'; work: PrivateSummaryWork }
  | { kind: 'blocked'; reason: SummarySourceReason | 'active_attempt' | 'restore_suspended' | 'retired_source'
      | 'grant_expired' | 'grant_exhausted' | 'policy_missing' | 'same_source'; work: PrivateSummaryWork };
export type SummaryFastAdmission = { kind: 'prepared' | 'lookup'; sourceHash: string; coveredMessageIds: string[]; commit(): void }
  | { kind: 'blocked'; reason: string };
export interface SummaryWorkStateView {
  work: PrivateSummaryWork; revision: PrivateSummarySourceRevision; grant: SummaryGrantRecord; usage: PrivateSummaryUsage;
}
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const legacyAdmittedSchema = z.object({ kind: z.literal('admitted'), barrierId: digest,
  barrierVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), scope: workRecoveryScopeSchema,
  authorizationVersion: summaryLineageRecordSchema.shape.authorizationVersion, workerGeneration: z.uuid(),
  lineageKey: digest, manifestHash: digest, inventoryHash: digest }).strict();
export { summaryPartBackgroundIdentity } from './private-summary-work.ts';
/** Runtime and worker wiring remains gated by trusted work policy and completed, continuously fenced cutover. */
export function createFirestorePrivateSummaryWork(options: FirestorePrivateSummaryWorkOptions) {
  const authority = createFirestoreAuthority(options), data = new FirestoreDomainData(options), now = options.serverClock ?? Date.now;
  function requirePrivate(b: Binding) {
    if (b.sharedAccess || b.actorUserId !== b.scope.ownerUserId) domainReject('private_summary_scope_changed');
  }
  const same = (a: unknown, b: unknown) => firestoreDomainHash(a) === firestoreDomainHash(b);
  async function readRecord<T>(b: Binding, collection: string, kind: string, id: string, schema: z.ZodType<T>): Promise<T | null> {
    const row = await b.transaction.get(data.ref(collection, kind, id));
    if (!row.exists) return null;
    if (Object.entries(data.tags(b.scope)).some(([key, value]) => row.get(key) !== value)) domainReject('private_summary_binding', 500);
    const value = data.open(kind, id, b.scope, schema, row);
    if (kind === 'private-summary-work') {
      const work = privateSummaryWorkSchema.parse(value);
      if (Object.entries(privateSummaryWorkProjection(work)).some(([key, expected]) => row.get(key) !== expected)
        || row.get('recordVersion') !== work.version)
        domainReject('private_summary_work_projection', 500);
    }
    if (kind === 'private-summary-lineage' && row.get('recordVersion') !== summaryLineageRecordSchema.parse(value).version)
      domainReject('private_summary_binding', 500);
    return value;
  }
  async function fastOriginalEvidence(b: Binding, runId: string): Promise<{
    run: FirestoreAgentRun; pointer: SummaryLineageRecord; evidenceId: string;
  } | null> {
    if (!options.runs || !options.fastNoDispatchVerifier
      || (await readPrivateSummaryEntryGate(data, b, !!options.policy)).kind !== 'durable') return null;
    const run = await options.runs.read(b, runId), fast = run.summaryFast;
    if (!fast || !fast.rootContext || fast.selected || fast.transferredToWorkId || run.state === 'completed'
      || run.authorizationVersion !== b.authorizationVersion || run.workerGeneration !== b.generation
      || run.state === 'stopped' && (!fast.noDispatch || run.stopReason !== 'input_limit')) return null;
    const candidate = await options.memory.readFastSource(b, fast.candidate.target);
    const fallback = await options.memory.selectSource(b, fast.target.kind === 'fresh_message'
      ? { kind: 'next_fresh' } : { kind: 'repair_batch', summaryId: fast.target.repairOf });
    if (candidate.kind !== 'eligible' || candidate.sourceHash !== fast.candidate.sourceHash || fallback.kind !== 'eligible'
      || summaryManifestHash(fallback.manifest) !== fast.manifestHash || summaryLineageKey(b.scope, fallback.manifest) !== fast.lineageKey) return null;
    const pointer = await readRecord(b, 'private_summary_works', 'private-summary-lineage', fast.lineageKey, summaryLineageRecordSchema);
    if (!pointer || !same(pointer.scope, b.scope) || pointer.id !== fast.lineageKey
      || pointer.authorizationVersion !== run.authorizationVersion || pointer.workerGeneration !== run.workerGeneration
      || pointer.owner.kind !== 'legacy_fast' || pointer.owner.runId !== run.id || pointer.owner.triggerReference !== run.trigger.reference
      || !same(pointer.owner.coveredMessageIds, fallback.manifest.coveredMessageIds)
      || !['unresolved', 'no_dispatch'].includes(pointer.owner.accounting.state)) return null;
    const proof = await options.fastNoDispatchVerifier.verify(b, run);
    if (proof.kind !== 'verified') return null;
    if (fast.noDispatch ? fast.noDispatch.evidenceId !== proof.evidenceId
        || pointer.owner.accounting.state !== 'no_dispatch' || pointer.owner.accounting.evidenceId !== proof.evidenceId
      : pointer.owner.accounting.state !== 'unresolved') return null;
    return { run, pointer, evidenceId: proof.evidenceId };
  }
  function createRecord<T>(b: Binding, collection: string, kind: string, id: string, schema: z.ZodType<T>, value: T) {
    b.transaction.create(data.ref(collection, kind, id), { ...data.tags(b.scope), ...data.seal(kind, id, b.scope, schema, value),
      ...(kind === 'private-summary-work' ? privateSummaryWorkProjection(privateSummaryWorkSchema.parse(value)) : {}) });
  }
  async function state(b: Binding, workId: string): Promise<SummaryWorkStateView> {
    domainParse(z.uuid(), workId); requirePrivate(b);
    const work = await readRecord(b, 'private_summary_works', 'private-summary-work', workId, privateSummaryWorkSchema);
    if (!work) domainReject('not_found', 404);
    const lineage = await readRecord(b, 'private_summary_works', 'private-summary-lineage', work.lineageKey, summaryLineageRecordSchema);
    const revision = await readRecord(b, 'private_summary_revisions', 'private-summary-revision', work.sourceRevisionId, summarySourceRevisionSchema);
    const grant = await readRecord(b, 'private_summary_usage', 'private-summary-grant', work.grantRecordId, summaryGrantRecordSchema);
    const usage = await readRecord(b, 'private_summary_usage', 'private-summary-usage', work.id, privateSummaryUsageSchema);
    if (!lineage || lineage.id !== work.lineageKey || lineage.owner.kind !== 'work' || lineage.owner.workId !== work.id
      || !same(lineage.scope, work.scope) || lineage.authorizationVersion !== work.authorizationVersion || lineage.workerGeneration !== work.workerGeneration
      || !revision || !grant || !usage || work.id !== workId || !same(work.scope, b.scope)
      || revision.id !== work.sourceRevisionId || revision.workId !== work.id || revision.sourceRevision !== work.sourceRevision
      || revision.manifestHash !== work.manifestHash || !same(revision.scope, work.scope)
      || revision.authorizationVersion !== work.authorizationVersion || revision.workerGeneration !== work.workerGeneration
      || work.lineageKey !== summaryLineageKey(work.scope, revision.manifest)
      || grant.id !== work.grantRecordId || grant.workId !== work.id || !same(grant.grant, work.grant)
      || usage.workId !== work.id || usage.grantRecordId !== grant.id || !same(usage.grant, grant.grant))
      domainReject('private_summary_binding', 500);
    return { work, revision, grant, usage };
  }
  function chainDigest(attempt: PrivateSummaryAttempt, predecessor: string, outputHash: string, next: import('./private-summary-work.ts').SummaryCursor) {
    if (!attempt.plan) domainReject('private_summary_chain_binding');
    return firestoreDomainHash(['private-summary-chain-link/v1', predecessor, attempt.binding, attempt.runId, attempt.plan.range, outputHash, next]);
  }
  async function readAttempt(b: Binding, id: string): Promise<PrivateSummaryAttempt> {
    requirePrivate(b); domainParse(z.uuid(), id);
    const attempt = await readRecord(b, 'private_summary_attempts', 'private-summary-attempt', id, privateSummaryAttemptSchema);
    if (!attempt) domainReject('not_found', 404);
    if (!options.runs) domainReject('private_summary_run_port_missing');
    const run = await options.runs.read(b, attempt.runId);
    const grant = await readRecord(b, 'private_summary_usage', 'private-summary-grant', attempt.grantRecordId, summaryGrantRecordSchema);
    const revision = await readRecord(b, 'private_summary_revisions', 'private-summary-revision', attempt.sourceRevisionId, summarySourceRevisionSchema);
    if (attempt.id !== id || !run.summaryWork || !same(run.summaryWork, attempt.binding) || run.trigger.kind !== 'worker'
      || run.trigger.reference !== attempt.triggerReference || run.recipeId !== 'memory-refresh'
      || !grant || grant.id !== attempt.grantRecordId || grant.workId !== attempt.binding.workId
      || !revision || revision.id !== attempt.sourceRevisionId || revision.workId !== attempt.binding.workId || revision.sourceRevision !== attempt.binding.sourceRevision
      || !same(revision.scope, b.scope) || revision.authorizationVersion !== run.authorizationVersion || revision.workerGeneration !== run.workerGeneration
      || !same(run.summaryEffect ?? null, attempt.receipt)
      || attempt.plan && attempt.plan.manifestHash !== revision.manifestHash) domainReject('private_summary_attempt_binding', 500);
    if (attempt.rootContext) {
      const root = attempt.rootContext.binding;
      if (root.ownerId !== run.ownerUserId || root.childId !== run.childId || root.workspaceId !== run.workspaceId
        || root.storageEpoch !== run.storageEpoch || root.authorizationVersion !== run.authorizationVersion
        || root.promptPackVersion !== grant.grant.promptPackVersion || root.billingVersion !== grant.grant.billingVersion
        || root.deadlineAtMs > Date.parse(run.expiresAt)
        || grant.grant.workDeadlineAt !== null && root.deadlineAtMs > Date.parse(grant.grant.workDeadlineAt)) domainReject('private_summary_root_binding');
    }
    if (attempt.plan) {
      const next = validateSummaryAdvance({ manifest: revision.manifest,
        prior: { unitIndex: attempt.plan.range.unitIndex, offsetUtf16: attempt.plan.range.startUtf16 }, range: attempt.plan.range });
      if (next.unitIndex < revision.manifest.units.length && !attempt.successorSchedule) domainReject('private_summary_missing_schedule');
      if (next.unitIndex === revision.manifest.units.length && attempt.successorSchedule) domainReject('private_summary_successor_binding');
      if (attempt.chainLink && (attempt.chainLink.next !== chainDigest(attempt, attempt.chainLink.predecessor, attempt.chainLink.outputHash, next)
        || attempt.receipt?.kind === 'part_committed' && (next.unitIndex >= revision.manifest.units.length || !same(attempt.receipt.next, next))
        || attempt.receipt?.kind === 'published' && (next.unitIndex !== revision.manifest.units.length
          || !same(attempt.receipt.coveredMessageIds, revision.manifest.coveredMessageIds) || attempt.receipt.repairOf !== revision.manifest.repairOf)))
        domainReject('private_summary_chain_binding');
    }
    return attempt;
  }
  async function liveAttempt(b: Binding, scope: AgentScope, runId: string, attemptId: string) {
    const attempt = await readAttempt(b, attemptId), current = await state(b, attempt.binding.workId), { work } = current;
    if (!options.runs) domainReject('private_summary_run_port_missing');
    const run = await options.runs.read(b, runId);
    if (!options.runs.matches(b, scope, run, false) || run.id !== attempt.runId || run.state !== 'running'
      || run.trigger.kind !== 'worker' || run.trigger.reference !== attempt.triggerReference
      || run.workerGeneration !== b.generation || work.workerGeneration !== b.generation
      || work.authorizationVersion !== b.authorizationVersion || work.state !== 'executing' || work.activeAttemptId !== attempt.id
      || !['claimed', 'reserved'].includes(attempt.state) || attempt.grantRecordId !== work.grantRecordId
      || attempt.binding.sourceRevision !== work.sourceRevision || attempt.binding.step !== work.chain.committedParts
      || attempt.binding.attempt !== work.nextAttempt || Date.parse(run.expiresAt) <= now()) domainReject('private_summary_run_binding');
    const lease = await readFirestoreBackgroundClaim(data, b, attempt.triggerReference);
    if (!lease || lease.id !== firestoreDomainHash(['product-work', summaryPartBackgroundIdentity(work)])) domainReject('private_summary_run_lease');
    return { ...current, attempt, run };
  }
  async function validateRoot(b: Binding, view: Awaited<ReturnType<typeof liveAttempt>>, context: RootBudgetContext) {
    const { attempt, grant, run } = view;
    if (!options.policy?.validateRootBinding) domainReject('private_summary_root_policy_missing');
    const bound = context.binding;
    if (bound.rootRunId !== run.id || bound.ownerId !== b.scope.ownerUserId || bound.workspaceId !== b.scope.workspaceId
      || bound.childId !== b.scope.childId || bound.storageEpoch !== b.scope.storageEpoch
      || bound.authorizationVersion !== b.authorizationVersion || !same(bound.trigger, run.trigger)
      || bound.promptPackVersion !== grant.grant.promptPackVersion || bound.billingVersion !== grant.grant.billingVersion
      || bound.deadlineAtMs <= now() || bound.deadlineAtMs > Date.parse(run.expiresAt)
      || grant.grant.workDeadlineAt !== null && bound.deadlineAtMs > Date.parse(grant.grant.workDeadlineAt))
      domainReject('private_summary_root_binding');
    const proof = await options.policy.validateRootBinding(b, { grantRecord: grant, run, context });
    if (proof.kind !== 'matched' || proof.grantRecordId !== attempt.grantRecordId
      || proof.contextFingerprint !== agentBudgetFingerprint(context)) domainReject('private_summary_root_profile');
  }
  async function readModelReservation(b: Binding, attempt: PrivateSummaryAttempt) {
    if (!attempt.modelReservationId || !attempt.plan || !attempt.rootContext) domainReject('private_summary_model_missing');
    const record = await readRecord(b, 'private_summary_usage', 'private-summary-reservation', attempt.modelReservationId, privateSummaryReservationSchema);
    const grant = await readRecord(b, 'private_summary_usage', 'private-summary-grant', attempt.grantRecordId, summaryGrantRecordSchema);
    if (!grant || grant.id !== attempt.grantRecordId || grant.workId !== attempt.binding.workId || !record || record.kind !== 'model' || record.reservationId !== attempt.modelReservationId || record.attemptId !== attempt.id
      || record.workId !== attempt.binding.workId || record.runId !== attempt.runId || record.grantRecordId !== attempt.grantRecordId
      || record.requestFingerprint !== attempt.plan.requestFingerprint
      || record.grantRevision !== grant.grant.revision || record.originalDailyRequest.model !== grant.grant.model
      || record.originalDailyRequest.userId !== attempt.rootContext.binding.ownerId
      || record.originalDailyRequest.childId !== attempt.rootContext.binding.childId
      || record.originalDailyRequest.deadlineAtMs !== attempt.rootContext.binding.deadlineAtMs
      || record.originalDailyRequest.bindingFingerprint !== agentBudgetFingerprint(attempt.rootContext)) domainReject('private_summary_model_binding');
    return record;
  }
  function workEnvelope(b: Binding, work: PrivateSummaryWork) {
    return { ...data.tags(b.scope), ...privateSummaryWorkProjection(work),
      ...data.seal('private-summary-work', work.id, b.scope, privateSummaryWorkSchema, work, work.version) };
  }
  async function prepareCompletionWake(b: Binding, work: PrivateSummaryWork): Promise<{ wake: SummaryCompletionWake; commit(): void }> {
    const wake = work.completionWake;
    if (work.state !== 'completed' || !work.finalReceipt || !wake) domainReject('private_summary_wake_binding');
    const identity = summaryCompletionWakeIdentity(work, wake.id), jobId = firestoreDomainHash(['product-work', identity]);
    const row = await b.transaction.get(data.ref('background_work', 'background-work', jobId));
    if (wake.scheduling.kind === 'queued') {
      if (!row.exists) domainReject('private_summary_wake_missing');
      const job = data.open('background-work', jobId, b.scope, firestoreBackgroundWorkSchema, row);
      if (job.id !== jobId || job.dueAt !== wake.scheduling.dueAt) domainReject('private_summary_wake_conflict');
      // The original helper authenticates every route/query projection and exact job identity.
      await prepareFirestoreBackgroundWork(data, b.transaction, identity, wake.scheduling.dueAt);
      return { wake, commit() {} };
    }
    // A partial restore cannot turn an existing dispatch into fresh scheduling authority.
    if (row.exists) domainReject('private_summary_wake_conflict');
    const due = await options.policy?.resolveWakeDueAt?.(b, { work, reason: 'scope_after_completion' });
    if (!due || due.kind === 'blocked') return { wake, commit() {} };
    const dueAt = domainParse(z.iso.datetime({ offset: true }), due.dueAt);
    const outbox = await prepareFirestoreBackgroundWork(data, b.transaction, identity, dueAt);
    if (outbox.id !== jobId) domainReject('private_summary_wake_conflict');
    return { wake: summaryCompletionWakeSchema.parse({ ...wake, scheduling: { kind: 'queued', jobId, dueAt } }), commit: outbox.commit };
  }
  async function settlePart(input: { scope: AgentScope; runId: string; attemptId: string;
    mode: { kind: 'caller'; result: ProductAgentResult; text: string | null } | { kind: 'recovery' } }): Promise<import('./private-summary-work.ts').SummaryEffectReceipt> {
      if (input.mode.kind === 'caller') domainParse(productAgentResultSchema, input.mode.result);
      return authority.runTransaction(input.scope.userId, input.scope.childId, async b => {
        const attempt = await readAttempt(b, input.attemptId), current = await state(b, attempt.binding.workId);
        const { work, revision, grant, usage } = current;
        if (!options.runs) domainReject('private_summary_run_port_missing');
        const run = await options.runs.read(b, input.runId);
        if (run.id !== attempt.runId || !options.runs.matches(b, input.scope, run, false)
          || work.authorizationVersion !== b.authorizationVersion || work.workerGeneration !== b.generation
          || run.workerGeneration !== b.generation) domainReject('private_summary_authority_changed');
        // The durable effect, not a retained native session, is the post-commit lookup authority.
        if (attempt.receipt) return attempt.receipt;
        if (!['executing', 'unknown'].includes(work.state) || work.activeAttemptId !== attempt.id
          || !['claimed', 'reserved', 'unknown'].includes(attempt.state) || attempt.grantRecordId !== work.grantRecordId
          || attempt.binding.sourceRevision !== work.sourceRevision || attempt.binding.step !== work.chain.committedParts
          || attempt.binding.attempt !== work.nextAttempt || run.result !== null
          || !(run.state === 'running' || run.state === 'unknown' && run.stopReason === 'interrupted')) domainReject('private_summary_terminal_binding');
        if (!options.terminalVerifier) domainReject('private_summary_terminal_missing');
        const model = attempt.modelReservationId ? await readModelReservation(b, attempt) : null;
        const toolId = model ? summaryReservationId(work.id, model.originalAttemptKey + ':tool-batch', 'tool') : null;
        const tool = toolId ? await readRecord(b, 'private_summary_usage', 'private-summary-reservation', toolId, privateSummaryReservationSchema) : null;
        if (tool && (!model || tool.kind !== 'tool' || tool.reservationId !== toolId || tool.workId !== work.id
          || tool.attemptId !== attempt.id || tool.runId !== run.id || tool.grantRecordId !== attempt.grantRecordId
          || tool.grantRevision !== grant.grant.revision || tool.originalAttemptKey !== model.originalAttemptKey + ':tool-batch')) domainReject('private_summary_tool_binding');
        const proof = await options.terminalVerifier.verify(b, { work, revision, attempt, grantRecord: grant, run,
          modelReservation: model, toolReservation: tool });
        if (proof.kind === 'unknown') domainReject('private_summary_terminal_unknown');
        domainParse(digest, proof.evidenceHash);
        const counts = domainParse(productAgentResultSchema.shape.counts, proof.counts);
        const tools = domainParse(productAgentResultSchema.shape.tools, proof.tools);
        if (counts.queryEmbeddings !== 0 || counts.modelCalls > (model?.units ?? 0) || counts.toolCalls > (tool?.units ?? 0)
          || counts.modelCalls > usage.used.modelCalls || counts.toolCalls > usage.used.toolCalls || tools.length > counts.toolCalls)
          domainReject('private_summary_terminal_binding');
        if (proof.kind === 'no_effect' && proof.dispatchOutcome === 'response_observed' && counts.modelCalls !== 1) domainReject('private_summary_terminal_binding');
        const terminal = proof.kind === 'terminal';
        if (terminal && (!attempt.plan || !model || !tool || counts.modelCalls !== 1 || counts.toolCalls !== 1
          || tool.units !== 1 || tools.length !== 1 || tools[0].name !== 'stage_private_summary'
          || tools[0].status !== 'succeeded' || tools[0].reference !== undefined)) domainReject('private_summary_terminal_binding');
        const expected: ProductAgentResult = { runId: run.id, status: terminal ? 'completed' : 'stopped',
          stopReason: terminal ? null : proof.stopReason, ...(terminal ? { outcome: 'no_action' as const } : {}),
          provenance: attempt.rootContext ? { packVersion: grant.grant.promptPackVersion, recipeId: run.recipeId, model: grant.grant.model } : null,
          text: '', citations: [], privateSourceCitations: [], retrievalMode: 'not_used', proposals: [], countsKnown: true, counts, tools };
        domainParse(productAgentResultSchema, expected);
        if (input.mode.kind === 'caller' && (!same(input.mode.result, expected) || input.mode.text !== (terminal ? proof.text : null))) domainReject('private_summary_terminal_mismatch');
        if (terminal && (domainParse(summarySaveSchema.shape.text, proof.text) !== proof.text || proof.text.length > attempt.plan!.outputTextLimit))
          domainReject('private_summary_terminal_mismatch');
        const source = await options.memory.revalidateSource(b, revision);
        const base = { workId: work.id, sourceRevision: work.sourceRevision, attemptId: attempt.id };
        let receipt: import('./private-summary-work.ts').SummaryEffectReceipt;
        let nextWork: PrivateSummaryWork = { ...work, version: work.version + 1, activeAttemptId: null };
        let nextAttempt: PrivateSummaryAttempt = { ...attempt };
        let summary: Extract<Awaited<ReturnType<FirestoreMemoryStore['prepareCompletedWorkWrite']>>, { kind: 'prepared' }> | undefined;
        let outbox: Awaited<ReturnType<typeof prepareFirestoreBackgroundWork>> | undefined;
        let wake: Awaited<ReturnType<typeof prepareCompletionWake>> | undefined;
        if (!terminal) {
          receipt = domainParse(summaryEffectReceiptSchema, { ...base, kind: 'no_effect', dispatchOutcome: proof.dispatchOutcome, stopReason: proof.stopReason });
          nextWork.state = 'failed';
          nextAttempt = { ...attempt, state: proof.dispatchOutcome === 'not_dispatched' ? 'not_dispatched' : 'known_failed',
            receipt, resultText: null, chainLink: null, noDispatchReason: proof.dispatchOutcome === 'not_dispatched' ? proof.stopReason : null };
          // No implicit retry. A future explicitly authorized reconciliation must use this original receipt/account.
        } else if (source.kind === 'already_covered' || source.kind === 'source_changed' || source.kind === 'suppressed') {
          receipt = { ...base, kind: 'superseded', reason: source.kind === 'already_covered' ? 'already_covered' : 'source_changed' };
          nextWork.state = source.kind === 'already_covered' ? 'completed' : source.kind === 'suppressed' ? 'suppressed' : 'invalidated';
          if (source.kind === 'already_covered') nextWork.finalReceipt = receipt;
          nextAttempt = { ...attempt, state: 'committed', receipt, resultText: null, chainLink: null };
        } else if (source.kind === 'blocked') {
          domainReject('private_summary_source_blocked');
        } else {
          const plan = attempt.plan!;
          if (plan.priorAccumulatorHash !== work.chain.accumulatorHash || plan.manifestHash !== revision.manifestHash) domainReject('private_summary_chain_binding');
          const next = validateSummaryAdvance({ manifest: revision.manifest, prior: work.chain.next, range: plan.range });
          const outputHash = firestoreDomainHash(proof.text);
          const chainLink = { predecessor: work.chain.digest, range: plan.range, outputHash,
            next: chainDigest(attempt, work.chain.digest, outputHash, next) };
          nextWork.chain = { committedParts: work.chain.committedParts + 1, next, accumulatorHash: outputHash, digest: chainLink.next };
          nextWork.accumulator = { text: proof.text, hash: outputHash }; nextWork.nextAttempt = 0;
          if (next.unitIndex === revision.manifest.units.length) {
            const prepared = await options.memory.prepareCompletedWorkWrite(b, { revision, text: proof.text }, run.id);
            if (prepared.kind !== 'prepared') domainReject('private_summary_source_' + prepared.kind);
            summary = prepared;
            receipt = { ...base, kind: 'published', summaryId: prepared.value.id, summaryVersion: prepared.value.version,
              coveredMessageIds: prepared.value.coveredMessageIds, repairOf: revision.manifest.repairOf };
            nextWork.state = 'completed'; nextWork.finalReceipt = receipt;
          } else {
            const schedule = attempt.successorSchedule;
            if (!schedule || !same(schedule.binding, { ...attempt.binding, step: attempt.binding.step + 1, attempt: 0 })) domainReject('private_summary_missing_schedule');
            receipt = { ...base, kind: 'part_committed', step: attempt.binding.step, next };
            nextWork.state = 'ready';
            const identity = summaryPartBackgroundIdentity(nextWork), id = firestoreDomainHash(['product-work', identity]);
            // A partial restore must not be mistaken for an already-committed successor.
            if ((await b.transaction.get(data.ref('background_work', 'background-work', id))).exists) domainReject('private_summary_successor_conflict');
            outbox = await prepareFirestoreBackgroundWork(data, b.transaction, identity, schedule.dueAt);
          }
          nextAttempt = { ...attempt, state: 'committed', receipt, resultText: proof.text, chainLink };
        }
        if (nextWork.state === 'completed') {
          nextWork.completionWake = { id: summaryCompletionWakeId(work.id, attempt.id), receiptHash: firestoreDomainHash(receipt), scheduling: { kind: 'pending_schedule' } };
          wake = await prepareCompletionWake(b, nextWork); nextWork.completionWake = wake.wake;
        }
        nextWork = privateSummaryWorkSchema.parse(nextWork); nextAttempt = privateSummaryAttemptSchema.parse(nextAttempt);
        const finish = await options.runs.prepareSummaryFinish(b, { scope: input.scope, runId: run.id, attemptId: attempt.id,
          result: expected, effect: receipt, ...(summary ? { changeSeq: summary.changeSeq } : {}) });
        const progress = receipt.kind === 'part_committed' || receipt.kind === 'published'
          || receipt.kind === 'superseded' && receipt.reason === 'already_covered'
          ? await preparePrivateSummaryScanProgress(data, b, revision.manifest.kind === 'fresh_message' ? 'fresh' : 'repair') : null;
        // Every authority/source/budget/session/outbox read has completed. No external effects occur in this callback.
        summary?.commit(); outbox?.commit(); wake?.commit(); finish.commit(); progress?.();
        b.transaction.set(data.ref('private_summary_attempts', 'private-summary-attempt', attempt.id), { ...data.tags(b.scope),
          ...data.seal('private-summary-attempt', attempt.id, b.scope, privateSummaryAttemptSchema, nextAttempt) });
        b.transaction.set(data.ref('private_summary_works', 'private-summary-work', work.id), workEnvelope(b, nextWork));
        return receipt;
      });
  }
  return {
    readStateIn(b: Binding, workId: string): Promise<SummaryWorkStateView> { return state(b, workId); },
    async refreshSource(input: { scope: AgentScope; workId: string; expectedVersion: number }): Promise<SummarySourceRefresh> {
      domainParse(z.number().int().positive().max(Number.MAX_SAFE_INTEGER), input.expectedVersion);
      const candidateRunId = randomUUID();
      return authority.runTransaction(input.scope.userId, input.scope.childId, async b => {
        const current = await state(b, input.workId), { work, revision, grant, usage } = current;
        if (!options.runs || !options.runs.matches(b, input.scope, undefined, false)
          || work.authorizationVersion !== b.authorizationVersion || work.workerGeneration !== b.generation)
          domainReject('private_summary_authority_changed');
        if (work.state === 'restore_suspended') return { kind: 'blocked', reason: 'restore_suspended', work };
        if (work.state === 'completed') return { kind: 'lookup', work };
        if (work.activeAttemptId !== null) return { kind: 'blocked', reason: 'active_attempt', work };
        // Retirement recovery is a separately tested protocol; absence of active never authorizes losing an unknown.
        if (work.lastRetirementId !== null) return { kind: 'blocked', reason: 'retired_source', work };
        if (input.expectedVersion < work.version) return { kind: 'lookup', work };
        if (input.expectedVersion !== work.version) domainReject('version_conflict');
        const source = await options.memory.rebuildSummarySource(b, revision);
        const persistState = (state: PrivateSummaryWork['state']) => {
          if (work.state === state) return work;
          const next = privateSummaryWorkSchema.parse({ ...work, state, version: work.version + 1 });
          b.transaction.set(data.ref('private_summary_works', 'private-summary-work', work.id), workEnvelope(b, next));
          return next;
        };
        if (source.kind === 'already_covered') {
          const binding = { workId: work.id, sourceRevision: work.sourceRevision, step: work.chain.committedParts, attempt: work.nextAttempt };
          const prepared = await options.runs.prepareSummaryAdministrativeCoverage(b, { workId: work.id, binding, candidateRunId });
          const receipt = domainParse(summaryEffectReceiptSchema, prepared.run.summaryEffect), id = summaryAttemptId(binding);
          if (receipt.kind !== 'superseded' || receipt.reason !== 'already_covered' || receipt.attemptId !== id
            || !same(prepared.run.summaryWork, binding) || prepared.claim.state !== 'completed') domainReject('private_summary_administrative_binding');
          const attempt = privateSummaryAttemptSchema.parse({ format: 'private-summary-attempt/v1', id, binding, runId: prepared.run.id,
            triggerReference: prepared.run.trigger.reference, state: 'committed', plan: null, sourceRevisionId: work.sourceRevisionId,
            chainLink: null, receipt, resultText: null, contentState: 'present', erasureIntentId: null, noDispatchReason: null,
            grantRecordId: work.grantRecordId, rootContext: null, modelReservationId: null, successorSchedule: null, retirementId: null });
          let next = privateSummaryWorkSchema.parse({ ...work, state: 'completed', version: work.version + 1, finalReceipt: receipt,
            completionWake: { id: summaryCompletionWakeId(work.id, id), receiptHash: firestoreDomainHash(receipt), scheduling: { kind: 'pending_schedule' } } });
          const wake = await prepareCompletionWake(b, next); next = privateSummaryWorkSchema.parse({ ...next, completionWake: wake.wake });
          const progress = await preparePrivateSummaryScanProgress(data, b,
            revision.manifest.kind === 'fresh_message' ? 'fresh' : 'repair');
          prepared.commit(); wake.commit(); progress();
          createRecord(b, 'private_summary_attempts', 'private-summary-attempt', id, privateSummaryAttemptSchema, attempt);
          b.transaction.set(data.ref('private_summary_works', 'private-summary-work', work.id), workEnvelope(b, next));
          return { kind: 'completed', work: next };
        }
        if (source.kind !== 'eligible') return { kind: 'blocked', reason: source.reason,
          work: source.kind === 'suppressed' ? persistState('suppressed') : work };
        const manifest = source.manifest;
        if (same(manifest, revision.manifest)) return { kind: 'unchanged', work };
        if (summaryLineageKey(work.scope, manifest) !== work.lineageKey || manifest.kind !== revision.manifest.kind
          || !same(manifest.coveredMessageIds, revision.manifest.coveredMessageIds) || manifest.repairOf !== revision.manifest.repairOf
          || same(manifest.units, revision.manifest.units) && same(manifest.dependencies, revision.manifest.dependencies))
          domainReject('private_summary_source_binding');
        if (grant.grant.workDeadlineAt !== null && Date.parse(grant.grant.workDeadlineAt) <= now())
          return { kind: 'blocked', reason: 'grant_expired', work: persistState('invalidated') };
        if (usage.used.modelCalls >= grant.grant.limits.modelCalls || usage.used.toolCalls >= grant.grant.limits.toolCalls)
          return { kind: 'blocked', reason: 'grant_exhausted', work: persistState('invalidated') };
        if (!options.policy?.resolveSourceRevisionDueAt) return { kind: 'blocked', reason: 'policy_missing', work: persistState('invalidated') };
        const due = await options.policy.resolveSourceRevisionDueAt(b, { work, priorRevision: revision, manifest, grantRecord: grant });
        if (due.kind !== 'due') return { kind: 'blocked', reason: 'policy_missing', work: persistState('invalidated') };
        const dueAt = domainParse(z.iso.datetime({ offset: true }), due.dueAt), sourceRevision = work.sourceRevision + 1;
        const sourceRevisionId = summaryRevisionId(work.id, sourceRevision), manifestHash = summaryManifestHash(manifest);
        const nextRevision = summarySourceRevisionSchema.parse({ ...revision, id: sourceRevisionId, sourceRevision,
          manifest, manifestHash, createdAt: new Date(now()).toISOString() });
        const next = privateSummaryWorkSchema.parse({ ...work, sourceRevision, sourceRevisionId, manifestHash,
          state: 'ready', version: work.version + 1, chain: { committedParts: 0, next: { unitIndex: 0, offsetUtf16: 0 },
            accumulatorHash: null, digest: summaryChainGenesis(work.id, sourceRevision, manifestHash) },
          accumulator: null, nextAttempt: 0, finalReceipt: null, completionWake: null });
        if ((await b.transaction.get(data.ref('private_summary_revisions', 'private-summary-revision', sourceRevisionId))).exists)
          domainReject('private_summary_revision_conflict');
        const identity = summaryPartBackgroundIdentity(next), outboxId = firestoreDomainHash(['product-work', identity]);
        if ((await b.transaction.get(data.ref('background_work', 'background-work', outboxId))).exists)
          domainReject('private_summary_revision_outbox_conflict');
        const outbox = await prepareFirestoreBackgroundWork(data, b.transaction, identity, dueAt);
        createRecord(b, 'private_summary_revisions', 'private-summary-revision', sourceRevisionId, summarySourceRevisionSchema, nextRevision);
        b.transaction.set(data.ref('private_summary_works', 'private-summary-work', work.id), workEnvelope(b, next));
        outbox.commit(); return { kind: 'refreshed', work: next };
      });
    },
    readEntryGate(b: Binding) { return readPrivateSummaryEntryGate(data, b, options.policy !== undefined); },
    /** Route authority only. Dispatch separately revalidates the original source, grant, root and daily account. */
    async authorizeBackgroundPart(b: Binding, reference: string): Promise<boolean> {
      if (b.sharedAccess || b.actorUserId !== b.scope.ownerUserId) return false;
      const job = await readFirestoreBackgroundClaim(data, b, reference);
      if (!job || job.kind !== 'memory-refresh') return false;
      const basis = parseSummaryBackgroundBasis(job.basis);
      if (basis?.kind !== 'part' || job.resourceId !== basis.binding.workId) return false;
      let current: SummaryWorkStateView;
      try { current = await state(b, basis.binding.workId); }
      catch (error) { if (error instanceof FirestoreDomainError && error.status === 404) return false; throw error; }
      const { work } = current;
      if (work.authorizationVersion !== b.authorizationVersion || work.workerGeneration !== b.generation
        || work.sourceRevision !== basis.binding.sourceRevision) return false;
      const attemptId = work.activeAttemptId ?? work.finalReceipt?.attemptId;
      if (attemptId) {
        if (!['executing', 'unknown', 'completed'].includes(work.state)) return false;
        const attempt = await readAttempt(b, attemptId);
        return attempt.triggerReference === reference && same(attempt.binding, basis.binding);
      }
      return work.state === 'ready' && basis.binding.step === work.chain.committedParts
        && basis.binding.attempt === work.nextAttempt;
    },
    /** Revalidation only: each execution still needs its original work, root and daily admissions. */
    async authorizePart(scope: AgentScope, runId: string, attemptId: string): Promise<boolean> {
      try { return await authority.runTransaction(scope.userId, scope.childId, async b => {
        const view = await liveAttempt(b, scope, runId, attemptId);
        if (!options.policy?.validateRootBinding || view.grant.grant.workDeadlineAt !== null
          && Date.parse(view.grant.grant.workDeadlineAt) <= now()) return false;
        if (view.attempt.rootContext) await validateRoot(b, view, view.attempt.rootContext);
        // Admission already charged the current reservation. Equality with its cap is not a new attempt.
        return (await options.memory.revalidateSource(b, view.revision)).kind === 'eligible';
      }); } catch (error) {
        if ((error instanceof FirestoreDomainError || error instanceof FirestoreAuthorityError) && [403, 404, 409, 428].includes(error.status)) return false;
        throw error;
      }
    },
    readEffect(userId: string, childId: string, attemptId: string): Promise<import('./private-summary-work.ts').SummaryEffectReceipt | null> {
      return authority.runTransaction(userId, childId, async b => (await readAttempt(b, attemptId)).receipt);
    },
    async finishPart(input: { scope: AgentScope; runId: string; attemptId: string; result: ProductAgentResult; text: string | null }): Promise<import('./private-summary-work.ts').SummaryEffectReceipt> {
      return settlePart({ scope: input.scope, runId: input.runId, attemptId: input.attemptId,
        mode: { kind: 'caller', result: input.result, text: input.text } });
    },
    async recoverTerminal(input: { scope: AgentScope; runId: string; attemptId: string }): Promise<{ state: 'settled' | 'unknown' | 'blocked'; receipt: import('./private-summary-work.ts').SummaryEffectReceipt | null }> {
      try { return { state: 'settled', receipt: await settlePart({ ...input, mode: { kind: 'recovery' } }) }; }
      catch (error) {
        if (error instanceof FirestoreDomainError && error.code === 'private_summary_terminal_unknown') return { state: 'unknown', receipt: null };
        if ((error instanceof FirestoreDomainError || error instanceof FirestoreAuthorityError) && [403, 404, 409, 428].includes(error.status))
          return { state: 'blocked', receipt: null };
        throw error; // Uncertain commits, corrupted evidence and infrastructure failures are not known failures.
      }
    },
    async scheduleCompletionWake(userId: string, childId: string, workId: string): Promise<SummaryCompletionWake> {
      return authority.runTransaction(userId, childId, async b => {
        const { work } = await state(b, workId);
        if (work.authorizationVersion !== b.authorizationVersion || work.workerGeneration !== b.generation) domainReject('private_summary_authority_changed');
        const prepared = await prepareCompletionWake(b, work);
        if (same(prepared.wake, work.completionWake)) return prepared.wake;
        const next = privateSummaryWorkSchema.parse({ ...work, version: work.version + 1, completionWake: prepared.wake });
        prepared.commit(); b.transaction.set(data.ref('private_summary_works', 'private-summary-work', work.id), workEnvelope(b, next));
        return prepared.wake;
      });
    },
    async reservePart(input: { scope: AgentScope; runId: string; attemptId: string; plan: SummaryPartPlan; modelAttemptKey: string;
      originalDailyRequest: DurableAiUsageRequest }): Promise<'execute' | 'lookup'> {
      const plan = domainParse(summaryPartPlanSchema, input.plan);
      return authority.runTransaction(input.scope.userId, input.scope.childId, async b => {
        const view = await liveAttempt(b, input.scope, input.runId, input.attemptId), { attempt, work, revision, grant, usage, run } = view;
        if (!attempt.rootContext) domainReject('private_summary_root_missing');
        const reservation = domainParse(privateSummaryReservationSchema, { format: 'private-summary-reservation/v1',
          workId: work.id, reservationId: summaryReservationId(work.id, input.modelAttemptKey, 'model'), attemptId: attempt.id,
          runId: run.id, grantRevision: grant.grant.revision, grantRecordId: attempt.grantRecordId, kind: 'model', units: 1,
          originalAttemptKey: input.modelAttemptKey, requestFingerprint: plan.requestFingerprint, originalDailyRequest: input.originalDailyRequest });
        if (reservation.kind !== 'model') domainReject('private_summary_model_binding');
        if (attempt.modelReservationId !== null) {
          const original = await readModelReservation(b, attempt);
          if (!same(original, reservation) || !same(attempt.plan, plan)) domainReject('private_summary_model_conflict');
          return 'lookup';
        }
        if (attempt.state !== 'claimed' || attempt.plan !== null) domainReject('private_summary_attempt_binding');
        await validateRoot(b, view, attempt.rootContext);
        const daily = reservation.originalDailyRequest, bound = attempt.rootContext.binding;
        if (daily.bindingFingerprint !== agentBudgetFingerprint(attempt.rootContext) || daily.userId !== work.scope.ownerUserId
          || daily.childId !== work.scope.childId || daily.model !== grant.grant.model || daily.deadlineAtMs !== bound.deadlineAtMs)
          domainReject('private_summary_daily_binding');
        if (!options.policy?.validateDailyRequest) domainReject('private_summary_daily_policy_missing');
        const proof = await options.policy.validateDailyRequest(b, { grantRecord: grant, run, context: attempt.rootContext, request: daily });
        if (proof.kind !== 'matched' || proof.grantRecordId !== attempt.grantRecordId
          || proof.contextFingerprint !== agentBudgetFingerprint(attempt.rootContext)
          || proof.dailyRequestHash !== agentBudgetFingerprint(daily)) domainReject('private_summary_daily_profile');
        const source = await options.memory.revalidateSource(b, revision);
        if (source.kind !== 'eligible') domainReject('private_summary_source_' + source.kind);
        if (!same(plan.binding, attempt.binding) || plan.manifestHash !== work.manifestHash
          || plan.priorAccumulatorHash !== work.chain.accumulatorHash
          || summarySaveSchema.shape.text.maxLength !== null && plan.outputTextLimit > summarySaveSchema.shape.text.maxLength)
          domainReject('private_summary_plan_binding');
        const nextCursor = validateSummaryAdvance({ manifest: revision.manifest, prior: work.chain.next, range: plan.range });
        const resolved = source.resolvedSources[plan.range.unitIndex];
        if (!resolved || !same(resolved.source, revision.manifest.units[plan.range.unitIndex])
          || resolved.sourceText.length !== resolved.source.utf16Length || !resolved.sourceText.isWellFormed()
          || !resolved.sourceText.slice(plan.range.startUtf16, plan.range.endUtf16).isWellFormed()) domainReject('private_summary_scalar_boundary');
        if (usage.used.modelCalls >= grant.grant.limits.modelCalls || usage.used.toolCalls >= grant.grant.limits.toolCalls)
          domainReject('private_summary_grant_exhausted');
        if (await readRecord(b, 'private_summary_usage', 'private-summary-reservation', reservation.reservationId, privateSummaryReservationSchema))
          domainReject('private_summary_reservation_conflict');
        let successorSchedule: PrivateSummaryAttempt['successorSchedule'] = null;
        if (nextCursor.unitIndex < revision.manifest.units.length) {
          if (!options.policy.resolveNextPartDueAt) domainReject('private_summary_schedule_missing');
          const nextBinding = { ...attempt.binding, step: attempt.binding.step + 1, attempt: 0 };
          const due = await options.policy.resolveNextPartDueAt(b, { work, grantRecord: grant, plan, nextBinding });
          if (due.kind !== 'due') domainReject('private_summary_schedule_blocked');
          successorSchedule = domainParse(summarySuccessorScheduleSchema, { binding: nextBinding, dueAt: due.dueAt });
        }
        const nextAttempt = privateSummaryAttemptSchema.parse({ ...attempt, state: 'reserved', plan,
          modelReservationId: reservation.reservationId, successorSchedule });
        const nextUsage = privateSummaryUsageSchema.parse({ ...usage, revision: usage.revision + 1,
          used: { ...usage.used, modelCalls: usage.used.modelCalls + 1 } });
        createRecord(b, 'private_summary_usage', 'private-summary-reservation', reservation.reservationId, privateSummaryReservationSchema, reservation);
        b.transaction.set(data.ref('private_summary_attempts', 'private-summary-attempt', attempt.id), { ...data.tags(b.scope),
          ...data.seal('private-summary-attempt', attempt.id, b.scope, privateSummaryAttemptSchema, nextAttempt) });
        b.transaction.set(data.ref('private_summary_usage', 'private-summary-usage', work.id), { ...data.tags(b.scope),
          ...data.seal('private-summary-usage', work.id, b.scope, privateSummaryUsageSchema, nextUsage, nextUsage.revision) });
        return 'execute';
      });
    },
    async reserveToolBatch(input: { scope: AgentScope; runId: string; attemptId: string; toolBatchKey: string;
      requestFingerprint: string; units: number }): Promise<'execute' | 'lookup'> {
      return authority.runTransaction(input.scope.userId, input.scope.childId, async b => {
        const view = await liveAttempt(b, input.scope, input.runId, input.attemptId), { attempt, work, revision, grant, usage, run } = view;
        const model = await readModelReservation(b, attempt);
        if (input.toolBatchKey !== model.originalAttemptKey + ':tool-batch' || attempt.state !== 'reserved') domainReject('private_summary_tool_binding');
        const reservation = domainParse(privateSummaryReservationSchema, { format: 'private-summary-reservation/v1', workId: work.id,
          reservationId: summaryReservationId(work.id, input.toolBatchKey, 'tool'), attemptId: attempt.id, runId: run.id,
          grantRevision: grant.grant.revision, grantRecordId: attempt.grantRecordId, kind: 'tool', units: input.units,
          originalAttemptKey: input.toolBatchKey, requestFingerprint: input.requestFingerprint });
        const original = await readRecord(b, 'private_summary_usage', 'private-summary-reservation', reservation.reservationId, privateSummaryReservationSchema);
        if (original) {
          if (!same(original, reservation)) domainReject('private_summary_tool_conflict');
          return 'lookup';
        }
        await validateRoot(b, view, attempt.rootContext!);
        const source = await options.memory.revalidateSource(b, revision);
        if (source.kind !== 'eligible') domainReject('private_summary_source_' + source.kind);
        if (input.units > grant.grant.limits.toolCalls - usage.used.toolCalls) domainReject('private_summary_grant_exhausted');
        const nextUsage = privateSummaryUsageSchema.parse({ ...usage, revision: usage.revision + 1,
          used: { ...usage.used, toolCalls: usage.used.toolCalls + input.units } });
        createRecord(b, 'private_summary_usage', 'private-summary-reservation', reservation.reservationId, privateSummaryReservationSchema, reservation);
        b.transaction.set(data.ref('private_summary_usage', 'private-summary-usage', work.id), { ...data.tags(b.scope),
          ...data.seal('private-summary-usage', work.id, b.scope, privateSummaryUsageSchema, nextUsage, nextUsage.revision) });
        return 'execute';
      });
    },
    async bindRootContext(scope: AgentScope, runId: string, attemptId: string, input: RootBudgetContext): Promise<void> {
      domainParse(z.uuid(), runId); domainParse(z.uuid(), attemptId);
      const context = domainParse(firestoreRootBudgetContextSchema, input);
      return authority.runTransaction(scope.userId, scope.childId, async b => {
        const view = await liveAttempt(b, scope, runId, attemptId), { attempt } = view;
        await validateRoot(b, view, context);
        if (attempt.rootContext !== null) {
          if (!same(attempt.rootContext, context)) domainReject('private_summary_root_conflict');
          return;
        }
        const next = privateSummaryAttemptSchema.parse({ ...attempt, rootContext: context });
        b.transaction.set(data.ref('private_summary_attempts', 'private-summary-attempt', attempt.id), { ...data.tags(b.scope),
          ...data.seal('private-summary-attempt', attempt.id, b.scope, privateSummaryAttemptSchema, next) });
      });
    },
    async claimPart(userId: string, childId: string, workId: string, reference: string): Promise<SummaryPartClaim> {
      domainParse(z.uuid(), reference); const candidateRunId = randomUUID();
      return authority.runTransaction(userId, childId, async b => {
        const current = await state(b, workId), { work, revision, usage } = current;
        if (!options.runs) domainReject('private_summary_run_port_missing');
        if (work.authorizationVersion !== b.authorizationVersion || work.workerGeneration !== b.generation) domainReject('private_summary_authority_changed');
        if (work.activeAttemptId !== null) {
          const attempt = await readAttempt(b, work.activeAttemptId), run = await options.runs.read(b, attempt.runId);
          if (attempt.triggerReference !== reference || attempt.binding.workId !== work.id
            || attempt.binding.sourceRevision !== work.sourceRevision || attempt.binding.step !== work.chain.committedParts
            || attempt.binding.attempt !== work.nextAttempt || attempt.grantRecordId !== work.grantRecordId
            || !['claimed', 'reserved', 'unknown'].includes(attempt.state)) domainReject('private_summary_attempt_binding');
          return { decision: 'lookup', claim: options.runs.projectClaim(b, run, false), attempt };
        }
        if (work.finalReceipt) {
          const attempt = await readAttempt(b, work.finalReceipt.attemptId), run = await options.runs.read(b, attempt.runId);
          if (attempt.triggerReference !== reference || !same(attempt.receipt, work.finalReceipt) || attempt.state !== 'committed'
            || run.state !== 'completed') domainReject('private_summary_attempt_binding');
          return { decision: 'lookup', claim: options.runs.projectClaim(b, run, false), attempt };
        }
        if (work.state !== 'ready') return { decision: 'blocked', reason: work.state, work };
        const binding = { workId: work.id, sourceRevision: work.sourceRevision, step: work.chain.committedParts, attempt: work.nextAttempt };
        const id = summaryAttemptId(binding);
        await options.runs.requireSummaryReady(b, { binding, reference, candidateRunId });
        if (await readRecord(b, 'private_summary_attempts', 'private-summary-attempt', id, privateSummaryAttemptSchema)) domainReject('private_summary_attempt_conflict');
        const source = await options.memory.revalidateSource(b, revision);
        if (source.kind === 'source_changed' || source.kind === 'suppressed') {
          const next = privateSummaryWorkSchema.parse({ ...work, version: work.version + 1,
            state: source.kind === 'source_changed' ? 'invalidated' : 'suppressed' });
          b.transaction.set(data.ref('private_summary_works', 'private-summary-work', work.id), workEnvelope(b, next));
          return { decision: 'blocked', reason: source.reason, work: next };
        }
        if (source.kind === 'blocked') return { decision: 'blocked', reason: source.reason, work };
        // Authoritative zero-dispatch completion precedes execution-only grant expiry and capacity checks.
        const covered = source.kind === 'already_covered';
        if (!covered && (work.grant.workDeadlineAt !== null && Date.parse(work.grant.workDeadlineAt) <= now()
          || usage.used.modelCalls >= work.grant.limits.modelCalls || usage.used.toolCalls >= work.grant.limits.toolCalls))
          domainReject('private_summary_work_blocked');
        const prepared = covered
          ? await options.runs.prepareSummaryCoveredClaim(b, { binding, reference, candidateRunId })
          : await options.runs.prepareSummaryClaim(b, { binding, reference, candidateRunId });
        if (!prepared.claim.created) domainReject('private_summary_claim_conflict');
        const attempt = privateSummaryAttemptSchema.parse({ format: 'private-summary-attempt/v1', id, binding, runId: prepared.run.id,
          triggerReference: reference, state: covered ? 'committed' : 'claimed', plan: null, sourceRevisionId: work.sourceRevisionId, chainLink: null,
          receipt: prepared.run.summaryEffect ?? null, resultText: null, contentState: 'present', erasureIntentId: null, noDispatchReason: null,
          grantRecordId: work.grantRecordId, rootContext: null, modelReservationId: null, successorSchedule: null, retirementId: null });
        let next = privateSummaryWorkSchema.parse({ ...work, version: work.version + 1,
          state: covered ? 'completed' : 'executing', activeAttemptId: covered ? null : id, finalReceipt: attempt.receipt,
          completionWake: covered ? { id: summaryCompletionWakeId(work.id, id), receiptHash: firestoreDomainHash(attempt.receipt),
            scheduling: { kind: 'pending_schedule' } } : null });
        const wake = covered ? await prepareCompletionWake(b, next) : null;
        if (wake) next = privateSummaryWorkSchema.parse({ ...next, completionWake: wake.wake });
        const progress = covered ? await preparePrivateSummaryScanProgress(data, b,
          revision.manifest.kind === 'fresh_message' ? 'fresh' : 'repair') : null;
        const envelope = workEnvelope(b, next);
        prepared.commit(); wake?.commit(); progress?.();
        createRecord(b, 'private_summary_attempts', 'private-summary-attempt', id, privateSummaryAttemptSchema, attempt);
        b.transaction.set(data.ref('private_summary_works', 'private-summary-work', work.id), envelope);
        return { decision: covered ? 'lookup' : 'execute', claim: prepared.claim, attempt };
      });
    },
    readAttempt(userId: string, childId: string, attemptId: string): Promise<PrivateSummaryAttempt> {
      return authority.runTransaction(userId, childId, b => readAttempt(b, attemptId));
    },
    /** Only the trusted runtime's actual capacity-fit failure invokes this settlement entry. */
    commitFastNoDispatch(userId: string, childId: string, runId: string, mode: 'commit' | 'lookup' = 'commit'): Promise<{ kind: 'verified'; evidenceId: string } | { kind: 'blocked' }> {
      return authority.runTransaction(userId, childId, async b => {
        requirePrivate(b);
        const proof = await fastOriginalEvidence(b, runId);
        if (!proof) return { kind: 'blocked' };
        const { run, pointer, evidenceId } = proof, fast = run.summaryFast!;
        if (fast.noDispatch) return { kind: 'verified', evidenceId };
        if (domainParse(z.enum(['commit', 'lookup']), mode) === 'lookup') return { kind: 'blocked' };
        if (pointer.owner.kind !== 'legacy_fast') domainReject('private_summary_binding', 500);
        const result: ProductAgentResult = { runId: run.id, status: 'stopped', stopReason: 'input_limit', provenance: null,
          countsKnown: true, counts: { modelCalls: 0, toolCalls: 0, queryEmbeddings: 0 }, text: '', citations: [],
          privateSourceCitations: [], retrievalMode: 'not_used', proposals: [], tools: [] };
        const nextPointer = summaryLineageRecordSchema.parse({ ...pointer, version: pointer.version + 1,
          owner: { ...pointer.owner, accounting: { state: 'no_dispatch', evidenceId } } });
        options.runs!.write(b, { ...run, state: 'stopped', stopReason: 'input_limit', result,
          summaryFast: { ...fast, noDispatch: { evidenceId } } });
        b.transaction.set(data.ref('private_summary_works', 'private-summary-lineage', pointer.id),
          { ...data.tags(b.scope), ...data.seal('private-summary-lineage', pointer.id, b.scope, summaryLineageRecordSchema, nextPointer, nextPointer.version) });
        return { kind: 'verified', evidenceId };
      });
    },
    bindFastRoot(userId: string, childId: string, runId: string, rawContext: RootBudgetContext): Promise<void> {
      const context = domainParse(firestoreRootBudgetContextSchema, rawContext);
      return authority.runTransaction(userId, childId, async b => {
        requirePrivate(b);
        if (!options.runs) domainReject('private_summary_run_port');
        const run = await options.runs.requireLive(b, options.runs.current(b), runId), fast = run.summaryFast;
        if (!fast || fast.noDispatch || fast.transferredToWorkId || fast.selected
          || (await readPrivateSummaryEntryGate(data, b, !!options.policy)).kind !== 'durable') domainReject('private_summary_fast_binding');
        const lease = await readFirestoreBackgroundClaim(data, b, run.trigger.reference);
        if (!lease || lease.kind !== 'memory-refresh' || lease.resourceId !== b.scope.childId
          || parseSummaryBackgroundBasis(lease.basis)?.kind !== 'scope') domainReject('private_summary_fast_binding');
        const original = await options.memory.readFastSource(b, fast.candidate.target);
        const fallback = await options.memory.selectSource(b, fast.target.kind === 'fresh_message'
          ? { kind: 'next_fresh' } : { kind: 'repair_batch', summaryId: fast.target.repairOf });
        if (original.kind !== 'eligible' || original.sourceHash !== fast.candidate.sourceHash || fallback.kind !== 'eligible'
          || summaryManifestHash(fallback.manifest) !== fast.manifestHash || summaryLineageKey(b.scope, fallback.manifest) !== fast.lineageKey)
          domainReject('private_summary_fast_source_changed');
        if (fast.rootContext) {
          if (!same(fast.rootContext, context)) domainReject('private_summary_fast_root_changed');
          return;
        }
        // This hook receives the actual fixed runtime binder's context before initializeDurable.
        // The run schema checks its original account, trigger, authority and absolute deadline.
        options.runs.write(b, { ...run, summaryFast: { ...fast, rootContext: context } });
      });
    },
    async prepareFastAdmission(b: Binding, input: { runId: string; reference: string; target: SummaryFastTarget;
      expectedSourceHash: string }): Promise<SummaryFastAdmission> {
      requirePrivate(b); domainParse(z.uuid(), input.runId); domainParse(z.uuid(), input.reference); domainParse(digest, input.expectedSourceHash);
      if (!options.runs) return { kind: 'blocked', reason: 'run_port_missing' };
      const run = await options.runs.requireLive(b, options.runs.current(b), input.runId);
      const lease = await readFirestoreBackgroundClaim(data, b, input.reference);
      if (run.trigger.kind !== 'worker' || run.trigger.reference !== input.reference || run.recipeId !== 'memory-refresh'
        || 'summaryWork' in run || !lease || lease.kind !== 'memory-refresh' || lease.resourceId !== b.scope.childId)
        return { kind: 'blocked', reason: 'run_binding' };
      const source = await options.memory.readFastSource(b, input.target);
      if (source.kind !== 'eligible') return { kind: 'blocked', reason: source.kind === 'already_covered' || source.kind === 'no_work'
        ? source.kind : source.reason };
      if (source.sourceHash !== input.expectedSourceHash) return { kind: 'blocked', reason: 'source_changed' };
      const coveredMessageIds = source.input.messages.map(message => message.id);
      const prior: SummaryLineageRecord[] = [];
      const fast = run.summaryFast;
      let fallbackIds: string[] | null = null;
      if (fast) {
        if (parseSummaryBackgroundBasis(lease.basis)?.kind !== 'scope'
          || (await readPrivateSummaryEntryGate(data, b, !!options.policy)).kind !== 'durable'
          || fast.noDispatch || fast.transferredToWorkId) return { kind: 'blocked', reason: 'entry_gate' };
        const original = await options.memory.readFastSource(b, fast.candidate.target);
        const fallback = await options.memory.selectSource(b, fast.target.kind === 'fresh_message'
          ? { kind: 'next_fresh' } : { kind: 'repair_batch', summaryId: fast.target.repairOf });
        if (original.kind !== 'eligible' || original.sourceHash !== fast.candidate.sourceHash || fallback.kind !== 'eligible'
          || summaryManifestHash(fallback.manifest) !== fast.manifestHash || summaryLineageKey(b.scope, fallback.manifest) !== fast.lineageKey)
          return { kind: 'blocked', reason: 'source_changed' };
        const candidateTarget = fast.candidate.target;
        if (candidateTarget.kind !== input.target.kind
          || candidateTarget.kind === 'fresh_prefix' && (input.target.kind !== 'fresh_prefix'
            || candidateTarget.firstMessageId !== input.target.firstMessageId || input.target.messageCount > candidateTarget.messageCount)
          || candidateTarget.kind === 'repair_batch' && (input.target.kind !== 'repair_batch' || candidateTarget.summaryId !== input.target.summaryId))
          return { kind: 'blocked', reason: 'candidate_changed' };
        if (fast.selected && (fast.selected.sourceHash !== source.sourceHash || !same(fast.selected.coveredMessageIds, coveredMessageIds)))
          return { kind: 'blocked', reason: 'selected_changed' };
        fallbackIds = fallback.manifest.coveredMessageIds;
      }
      if (!source.lineageKeys.length || new Set(source.lineageKeys).size !== source.lineageKeys.length) domainReject('private_summary_binding', 500);
      for (const key of source.lineageKeys) {
        domainParse(digest, key);
        const pointer = await readRecord(b, 'private_summary_works', 'private-summary-lineage', key, summaryLineageRecordSchema);
        if (pointer) {
          if (pointer.id !== key || !same(pointer.scope, b.scope)) domainReject('private_summary_binding', 500);
          if (pointer.authorizationVersion !== b.authorizationVersion || pointer.workerGeneration !== b.generation)
            return { kind: 'blocked', reason: 'authority_changed' };
          const expectedIds = fast && !fast.selected && key === fast.lineageKey ? fallbackIds : coveredMessageIds;
          if (pointer.owner.kind !== 'legacy_fast' || pointer.owner.runId !== run.id || pointer.owner.triggerReference !== input.reference
            || pointer.owner.accounting.state !== 'unresolved' || !same(pointer.owner.coveredMessageIds, expectedIds)
            || fast && !fast.selected && key !== fast.lineageKey)
            return { kind: 'blocked', reason: 'lineage_owned' };
          prior.push(pointer);
        }
      }
      if (fast && !fast.selected && (prior.length !== 1 || prior[0].id !== fast.lineageKey))
        return { kind: 'blocked', reason: 'lineage_incomplete' };
      if (!fast && prior.length) return prior.length === source.lineageKeys.length
        ? { kind: 'lookup', sourceHash: source.sourceHash, coveredMessageIds, commit() {} }
        : { kind: 'blocked', reason: 'lineage_incomplete' };
      if (!options.policy) return { kind: 'blocked', reason: 'policy_missing' };
      for (const lineageKey of source.lineageKeys) {
        const admission = await options.policy.readLegacyAdmission(b, { lineageKey, manifestHash: source.sourceHash });
        if (admission.kind === 'blocked') return { kind: 'blocked', reason: `legacy_${admission.reason}` };
        const proof = domainParse(legacyAdmittedSchema, admission, 'private_summary_migration_binding', 500);
        if (!same(proof.scope, b.scope) || proof.authorizationVersion !== b.authorizationVersion || proof.workerGeneration !== b.generation
          || proof.lineageKey !== lineageKey || proof.manifestHash !== source.sourceHash) return { kind: 'blocked', reason: 'legacy_stale' };
      }
      if (fast?.selected) return prior.length === source.lineageKeys.length
        ? { kind: 'lookup', sourceHash: source.sourceHash, coveredMessageIds, commit() {} }
        : { kind: 'blocked', reason: 'lineage_incomplete' };
      const pointers = source.lineageKeys.map(id => summaryLineageRecordSchema.parse({ format: 'private-summary-lineage/v1', id,
        scope: b.scope, authorizationVersion: b.authorizationVersion, workerGeneration: b.generation,
        version: (prior.find(pointer => pointer.id === id)?.version ?? 0) + 1,
        owner: { kind: 'legacy_fast', runId: run.id, triggerReference: input.reference, coveredMessageIds, accounting: { state: 'unresolved' } } }));
      return { kind: 'prepared', sourceHash: source.sourceHash, coveredMessageIds, commit() {
        for (const pointer of pointers) {
          if (prior.some(value => value.id === pointer.id)) b.transaction.set(data.ref('private_summary_works', 'private-summary-lineage', pointer.id),
            { ...data.tags(b.scope), ...data.seal('private-summary-lineage', pointer.id, b.scope, summaryLineageRecordSchema, pointer, pointer.version) });
          else createRecord(b, 'private_summary_works', 'private-summary-lineage', pointer.id, summaryLineageRecordSchema, pointer);
        }
        if (fast) options.runs!.write(b, { ...run, summaryFast: { ...fast,
          selected: { sourceHash: source.sourceHash, coveredMessageIds } } });
      } };
    },
    async start(userId: string, childId: string,
      target: { kind: 'next_fresh' } | { kind: 'repair_batch'; summaryId: string }, transition?: { reference?: string }): Promise<SummaryWorkStart> {
      const candidateId = randomUUID();
      return authority.runTransaction(userId, childId, async b => {
        requirePrivate(b);
        const identities = await options.memory.readSummaryLineageTargets(b, target);
        if (!identities.length) return { kind: 'no_work' };
        if (identities.length !== 1) domainReject('private_summary_binding', 500);
        const lineageKey = identities[0].lineageKey;
        const pointer = await readRecord(b, 'private_summary_works', 'private-summary-lineage', lineageKey, summaryLineageRecordSchema);
        let originalFast: FirestoreAgentRun | null = null;
        if (pointer) {
          if (pointer.id !== lineageKey || !same(pointer.scope, b.scope)) domainReject('private_summary_binding', 500);
          if (pointer.authorizationVersion !== b.authorizationVersion || pointer.workerGeneration !== b.generation)
            return { kind: 'blocked', reason: 'authority_changed' };
          if (pointer.owner.kind === 'work') {
            const original = await state(b, pointer.owner.workId);
            if (original.work.lineageKey !== lineageKey) domainReject('private_summary_binding', 500);
            if (original.work.authorizationVersion !== b.authorizationVersion || original.work.workerGeneration !== b.generation)
              return { kind: 'blocked', reason: 'authority_changed' };
            return { kind: 'lookup', work: original.work };
          }
          if (pointer.owner.accounting.state !== 'no_dispatch' || !transition?.reference) return { kind: 'blocked', reason: 'legacy_active' };
          const lease = await readFirestoreBackgroundClaim(data, b, transition.reference);
          if (!lease || lease.kind !== 'memory-refresh' || lease.resourceId !== b.scope.childId
            || parseSummaryBackgroundBasis(lease.basis)?.kind !== 'scope') return { kind: 'blocked', reason: 'legacy_active' };
          const proof = await fastOriginalEvidence(b, pointer.owner.runId);
          if (!proof || !proof.run.summaryFast?.noDispatch || proof.pointer.id !== pointer.id
            || proof.evidenceId !== pointer.owner.accounting.evidenceId) return { kind: 'blocked', reason: 'legacy_active' };
          originalFast = proof.run;
        }
        const source = await options.memory.selectSource(b, target);
        if (source.kind === 'no_work' || source.kind === 'already_covered') return { kind: source.kind };
        if (source.kind !== 'eligible') return { kind: 'blocked', reason: source.reason };
        const manifest = source.manifest, manifestHash = summaryManifestHash(manifest);
        if (summaryLineageKey(b.scope, manifest) !== lineageKey) return { kind: 'blocked', reason: 'source_changed' };
        if (!options.policy) return { kind: 'blocked', reason: 'policy_missing' };
        const admission = await options.policy.readLegacyAdmission(b, { lineageKey, manifestHash });
        if (admission.kind === 'blocked') return { kind: 'blocked', reason: `legacy_${admission.reason}` as const };
        const proof = domainParse(legacyAdmittedSchema, admission, 'private_summary_migration_binding', 500);
        if (!same(proof.scope, b.scope) || proof.authorizationVersion !== b.authorizationVersion || proof.workerGeneration !== b.generation
          || proof.lineageKey !== lineageKey || proof.manifestHash !== manifestHash) return { kind: 'blocked', reason: 'legacy_stale' };
        const resolved = await options.policy.resolveInitial(b, { workId: candidateId, manifest });
        if (!resolved) return { kind: 'blocked', reason: 'policy_missing' };
        const grant = domainParse(summaryWorkGrantSchema, resolved.grant), dueAt = domainParse(z.iso.datetime({ offset: true }), resolved.dueAt);
        if (grant.workDeadlineAt !== null && Date.parse(grant.workDeadlineAt) <= now()) return { kind: 'blocked', reason: 'grant_expired' };
        if (grant.limits.modelCalls === 0 || grant.limits.toolCalls === 0) return { kind: 'blocked', reason: 'grant_exhausted' };
        const sourceRevisionId = summaryRevisionId(candidateId, 1), grantRecordId = summaryGrantRecordId(candidateId, grant);
        const work = privateSummaryWorkSchema.parse({ format: 'private-summary-work/v1', id: candidateId, lineageKey,
          scope: b.scope, authorizationVersion: b.authorizationVersion, workerGeneration: b.generation, version: 1,
          sourceRevision: 1, sourceRevisionId, manifestHash, grant, grantRecordId, state: 'ready',
          chain: { committedParts: 0, next: { unitIndex: 0, offsetUtf16: 0 }, accumulatorHash: null,
            digest: summaryChainGenesis(candidateId, 1, manifestHash) }, nextAttempt: 0,
          accumulator: null, activeAttemptId: null, finalReceipt: null, completionWake: null, lastRetirementId: null });
        const revision = summarySourceRevisionSchema.parse({ format: 'private-summary-source-revision/v1', id: sourceRevisionId,
          workId: work.id, sourceRevision: 1, scope: b.scope, authorizationVersion: b.authorizationVersion,
          workerGeneration: b.generation, manifest, manifestHash, createdAt: new Date(now()).toISOString() });
        const grantRecord = summaryGrantRecordSchema.parse({ format: 'private-summary-grant/v1', id: grantRecordId, workId: work.id, grant, renewal: null });
        const usage = privateSummaryUsageSchema.parse({ format: 'private-summary-usage/v1', workId: work.id, grant,
          grantRecordId, used: { modelCalls: 0, toolCalls: 0 }, revision: 1, unresolvedRetiredCount: 0 });
        const lineage = summaryLineageRecordSchema.parse({ format: 'private-summary-lineage/v1', id: lineageKey,
          scope: b.scope, authorizationVersion: b.authorizationVersion, workerGeneration: b.generation,
          version: (pointer?.version ?? 0) + 1, owner: { kind: 'work', workId: work.id } });
        const outbox = await prepareFirestoreBackgroundWork(data, b.transaction, summaryPartBackgroundIdentity(work), dueAt);
        const pending = await prepareSummaryWorkPending(data, b);
        if (originalFast) {
          options.runs!.write(b, { ...originalFast, summaryFast: { ...originalFast.summaryFast!, transferredToWorkId: work.id } });
          b.transaction.set(data.ref('private_summary_works', 'private-summary-lineage', lineageKey),
            { ...data.tags(b.scope), ...data.seal('private-summary-lineage', lineageKey, b.scope, summaryLineageRecordSchema, lineage, lineage.version) });
        } else createRecord(b, 'private_summary_works', 'private-summary-lineage', lineageKey, summaryLineageRecordSchema, lineage);
        createRecord(b, 'private_summary_works', 'private-summary-work', work.id, privateSummaryWorkSchema, work);
        createRecord(b, 'private_summary_revisions', 'private-summary-revision', revision.id, summarySourceRevisionSchema, revision);
        createRecord(b, 'private_summary_usage', 'private-summary-grant', grantRecord.id, summaryGrantRecordSchema, grantRecord);
        createRecord(b, 'private_summary_usage', 'private-summary-usage', work.id, privateSummaryUsageSchema, usage);
        outbox.commit(); pending(); return { kind: 'created', work };
      });
    },
    readState(userId: string, childId: string, workId: string): Promise<SummaryWorkStateView> {
      return authority.runTransaction(userId, childId, b => state(b, workId));
    },
  };
}
