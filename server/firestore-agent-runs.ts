import { summaryRunBindingSchema, summaryEffectReceiptSchema, privateSummaryWorkSchema, summaryPartBackgroundIdentity, summarySourceRevisionSchema, privateSummaryAttemptSchema, summaryAttemptId, summaryRetirementId, summaryLineageRecordSchema, summaryGrantRecordSchema, summaryLineageKey, type SummaryRunBinding, type SummaryEffectReceipt } from './private-summary-work.ts';
import { randomUUID } from 'node:crypto';
import { AGENT_RUN_LIMITS } from '../src/shared/agent-run-limits.ts';
import { z } from 'zod';
import type { DocumentSnapshot } from '@google-cloud/firestore';
import type { AgentScope } from './agent-runtime.ts';
import type { AgentRunClaim } from './product-agent-store.ts';
import type { ProductAgentResult } from '../src/shared/product-agent.ts';
import { productAgentResultSchema } from '../src/shared/product-agent-result.ts';
import { createFirestoreAuthority, type FirestoreAuthorityTransaction as Binding } from './firestore-authority.ts';
import { FirestoreDomainData, domainParse, domainReject, firestoreDomainHash, type FirestoreDomainOptions } from './firestore-domain-data.ts';
import type { FirestoreChatStore } from './firestore-chat.ts';
import type { FirestoreMemoryStore } from './firestore-memory.ts';
import { FirestoreAuthorityError } from './firestore-authority.ts';
import { summarySaveSchema } from './memory-validation.ts';
import { FirestoreDomainError } from './firestore-domain-data.ts';
import { readFirestoreBackgroundClaim, firestoreBackgroundReference } from './firestore-background-work.ts';
import { summaryFastBindingSchema, summaryManifestHash, summaryLineageKeyForTarget, parseSummaryBackgroundBasis, type SummaryFastBinding } from './private-summary-work.ts';
import { readPrivateSummaryEntryGate, summaryFastPayloadHash } from './firestore-private-summary-cutover.ts';
import { mixedRunScopeSchema } from './mixed-chat-records.ts';
import type { MixedRoomPin, MixedTransferScope, MixedTranscriptPage, MixedTranscriptRow } from '../src/shared/mixed-chat-transfer.ts';
import type { SummaryInput } from '../src/shared/memory.ts';

const uuid = z.uuid(), time = z.iso.datetime({ offset: true }), decimal = z.string().regex(/^(0|[1-9][0-9]{0,18})$/u);
const accountChildId='00000000-0000-0000-0000-000000000000';
export const firestoreAgentRunSchema = z.object({
  id: uuid, childId: uuid, ownerUserId: z.string().min(1).max(256), workspaceId: uuid, storageEpoch: uuid,
  authorizationVersion: decimal, dataVersion: z.string().max(100),
  trigger: z.object({ kind: z.enum(['interactive', 'worker']), reference: uuid }).strict(),
  workerGeneration: uuid.optional(),
  mixedChat:mixedRunScopeSchema.optional(),
  summaryFast: summaryFastBindingSchema.optional(),
  summaryWork: summaryRunBindingSchema.optional(), summaryRetirementId: z.string().regex(/^[a-f0-9]{64}$/u).nullable().optional(), summaryEffect: summaryEffectReceiptSchema.optional(),
  sourceMessageId: uuid.nullable(), recipeId: z.string().min(1).max(128),
  state: z.enum(['running', 'completed', 'stopped', 'unknown']), stopReason: z.string().max(128).nullable(),
  createdAt: time, expiresAt: time, result: productAgentResultSchema.nullable(),
}).strict().refine(run => run.mixedChat ? run.childId === accountChildId && run.trigger.kind === 'interactive'
    && run.recipeId === 'product-interactive' && run.sourceMessageId === run.trigger.reference : run.childId !== accountChildId)
  .refine(run => (!run.summaryWork || run.summaryRetirementId !== undefined)
  && (run.summaryRetirementId === undefined || !!run.summaryWork)
  && (!run.summaryRetirementId || !!run.summaryWork
    && run.summaryRetirementId === summaryRetirementId(run.summaryWork.workId, summaryAttemptId(run.summaryWork))
    && run.state !== 'running'
    && (!run.summaryEffect || run.summaryEffect.kind === 'no_effect'
      || run.summaryEffect.kind === 'superseded' && run.summaryEffect.reason === 'source_changed')))
  .refine(run => {
    const fast = run.summaryFast;
    if (!fast) return true;
    if (run.summaryWork || run.trigger.kind !== 'worker' || run.recipeId !== 'memory-refresh' || !run.workerGeneration
      || run.sourceMessageId !== null || fast.lineageKey !== summaryLineageKeyForTarget({ ownerUserId: run.ownerUserId,
        workspaceId: run.workspaceId, childId: run.childId, storageEpoch: run.storageEpoch }, fast.target)) return false;
    const root = fast.rootContext?.binding;
    if (root && (root.rootRunId !== run.id || root.ownerId !== run.ownerUserId || root.workspaceId !== run.workspaceId
      || root.childId !== run.childId || root.storageEpoch !== run.storageEpoch || root.authorizationVersion !== run.authorizationVersion
      || root.trigger.kind !== run.trigger.kind || root.trigger.reference !== run.trigger.reference
      || root.deadlineAtMs > Date.parse(run.expiresAt) || root.deadlineAtMs < Date.parse(run.createdAt))) return false;
    return !fast.noDispatch || run.state === 'stopped' && run.stopReason === 'input_limit';
  })
  .refine(run => !run.summaryEffect || !!run.summaryWork && run.trigger.kind === 'worker' && run.recipeId === 'memory-refresh'
  && run.summaryEffect.workId === run.summaryWork.workId && run.summaryEffect.sourceRevision === run.summaryWork.sourceRevision
  && run.summaryEffect.attemptId === summaryAttemptId(run.summaryWork) && run.state !== 'running' && run.result !== null);
export type FirestoreAgentRun = z.infer<typeof firestoreAgentRunSchema>;
export type SummaryFastProbeClaim = { kind: 'claimed'; claim: AgentRunClaim; run: FirestoreAgentRun; commit(): void }
  | { kind: 'blocked'; reason: string; workId?: string; runId?: string };
export const firestoreAgentClaimSchema = z.object({ runId: uuid, mixedChat:mixedRunScopeSchema.optional() }).strict();
export interface FirestoreAgentRunOptions extends FirestoreDomainOptions {
  chat: FirestoreChatStore;
  memory: FirestoreMemoryStore;
  serverClock?: () => number;
  readInteractiveRunSeconds?: (tx: import("@google-cloud/firestore").Transaction, scope: Binding['scope']) => Promise<number>;
  /** Only the authenticated worker composition supplies this canonical lease/resource gate. */
  authorizeWorker?: (binding: Binding, reference: string, recipeId: string) => Promise<boolean>;
}
export interface FirestoreAgentResultProjection {
  /** Read original proposal/action/document ledgers, even when final generation was interrupted. */
  read(binding: Binding, run: FirestoreAgentRun, result: ProductAgentResult): Promise<ProductAgentResult>;
}

/** Private business run authority. Native ADK sessions remain protocol state, never execution receipts. */
export function createFirestoreAgentRuns(options: FirestoreAgentRunOptions) {
  const authority = createFirestoreAuthority(options), data = new FirestoreDomainData(options);
  const now = options.serverClock ?? Date.now;
  const ref = (id: string) => data.ref('agent_runs', 'agent-run', id);
  const claimId = (b: Binding, kind: 'interactive' | 'worker', reference: string) =>
    JSON.stringify([b.scope.ownerUserId, b.scope.childId, kind, reference]);
  const current = (b: Binding): AgentScope => ({ userId: b.scope.ownerUserId, childId: b.scope.childId,
    workspaceId: b.scope.workspaceId, authorizationVersion: b.authorizationVersion,
    dataVersion: b.scope.storageEpoch + ':' + b.changeSeq });
  function matches(b: Binding, scope: AgentScope, run?: FirestoreAgentRun, exact = true) {
    return scope.userId === b.scope.ownerUserId && scope.childId === b.scope.childId
      && scope.workspaceId === b.scope.workspaceId && scope.authorizationVersion === b.authorizationVersion
      && scope.dataVersion.split(':')[0] === b.scope.storageEpoch
      && (!run || run.authorizationVersion === b.authorizationVersion && run.storageEpoch === b.scope.storageEpoch)
      && (!exact || (run?.dataVersion ?? scope.dataVersion) === current(b).dataVersion);
  }
  function decode(b: Binding, id: string, row: DocumentSnapshot): FirestoreAgentRun {
    if (!row.exists || Object.entries(data.tags(b.scope)).some(([key, value]) => row.get(key) !== value)) domainReject('not_found', 404);
    const run = data.open('agent-run', id, b.scope, firestoreAgentRunSchema, row);
    if (run.id !== id || run.childId !== b.scope.childId || run.ownerUserId !== b.scope.ownerUserId
      || run.workspaceId !== b.scope.workspaceId || run.storageEpoch !== b.scope.storageEpoch
      || !run.dataVersion.startsWith(run.storageEpoch + ':') || row.get('runId') !== id
      || row.get('createdAt') !== run.createdAt || row.get('triggerKind') !== run.trigger.kind
      || row.get('recordVersion') !== 1 || run.result && run.result.runId !== id
      || (run.trigger.kind === 'interactive' ? run.sourceMessageId !== run.trigger.reference : run.sourceMessageId !== null))
      domainReject('agent_run_binding', 500);
    return run;
  }
  async function read(b: Binding, id: string) {
    domainParse(uuid, id); return decode(b, id, await b.transaction.get(ref(id)));
  }
  function expired(run: FirestoreAgentRun): FirestoreAgentRun {
    return run.state === 'running' && Date.parse(run.expiresAt) <= now()
      ? { ...run, state: 'unknown', stopReason: 'interrupted' } : run;
  }
  function write(b: Binding, run: FirestoreAgentRun, create = false) {
    const envelope = { ...data.tags(b.scope), runId: run.id, createdAt: run.createdAt, triggerKind: run.trigger.kind,
      ...data.seal('agent-run', run.id, b.scope, firestoreAgentRunSchema, run) };
    if (create) b.transaction.create(ref(run.id), envelope); else b.transaction.set(ref(run.id), envelope);
  }
  async function requireLive(b: Binding, scope: AgentScope, id: string) {
    const run = expired(await read(b, id));
    if (!matches(b, scope, run) || run.state !== 'running'
      || run.trigger.kind === 'worker' && (run.workerGeneration !== b.generation || !await options.authorizeWorker?.(b, run.trigger.reference, run.recipeId))) domainReject('agent_scope_changed');
    return run;
  }
  function advance(b: Binding, run: FirestoreAgentRun, changeSeq: string) {
    domainParse(decimal, changeSeq);
    // Only called by a server-owned prepared mutation, in the same Firestore transaction.
    if (BigInt(changeSeq) !== BigInt(b.changeSeq) + 1n) domainReject('agent_change_binding', 500);
    write(b, { ...run, dataVersion: b.scope.storageEpoch + ':' + changeSeq });
  }
  const empty = (run: FirestoreAgentRun): ProductAgentResult => ({ runId: run.id, status: run.state,
    stopReason: run.stopReason, provenance: null, countsKnown: false, text: '', citations: [], privateSourceCitations: [],
    retrievalMode: 'not_used', tools: [], counts: { modelCalls: 0, toolCalls: 0, queryEmbeddings: 0 }, proposals: [] });
  async function originalRun(b: Binding, kind: 'interactive' | 'worker', reference: string) {
    const id = claimId(b, kind, reference), snapshot = await b.transaction.get(data.ref('agent_claims', 'agent-claim', id));
    if (!snapshot.exists) return null;
    const claim = data.open('agent-claim', id, b.scope, firestoreAgentClaimSchema, snapshot);
    const run = await read(b, claim.runId);
    if (run.trigger.kind !== kind || run.trigger.reference !== reference
      || firestoreDomainHash(claim.mixedChat ?? null) !== firestoreDomainHash(run.mixedChat ?? null)) domainReject('agent_claim_binding', 500);
    return run;
  }
  const originalReplyRun = (b: Binding, id: string) => originalRun(b, 'interactive', id);
  function projectClaim(b: Binding, run: FirestoreAgentRun, created: boolean): AgentRunClaim {
    return { runId: run.id, scope: { ...current(b), authorizationVersion: run.authorizationVersion, dataVersion: run.dataVersion },
      created, sourceMessageId: run.sourceMessageId, state: run.state, expiresAt: run.expiresAt,
      storageEpoch: run.storageEpoch, trigger: run.trigger, recipeId: run.recipeId, workerGeneration: run.workerGeneration,
      purpose: run.trigger.kind === 'interactive' ? 'chat' : run.recipeId === 'product-work-followup' ? 'work-continuation' : 'background' };
  }
  const prepareClaim = (b: Binding, input: { trigger: NonNullable<AgentRunClaim['trigger']>; recipeId: string; candidateRunId: string }) =>
    prepareClaimBase(b, input);
  async function prepareFastProbeClaim(b: Binding, input: { reference: string; candidate: SummaryInput; candidateRunId: string }): Promise<SummaryFastProbeClaim> {
    const job = await readFirestoreBackgroundClaim(data, b, input.reference);
    if (!job || job.kind !== 'memory-refresh' || job.resourceId !== b.scope.childId
      || parseSummaryBackgroundBasis(job.basis)?.kind !== 'scope') return { kind: 'blocked', reason: 'scope_lease' };
    if ((await readPrivateSummaryEntryGate(data, b, true)).kind !== 'durable') return { kind: 'blocked', reason: 'entry_gate' };
    if (!input.candidate.messages.length || input.candidate.unavailableReason) return { kind: 'blocked', reason: 'source_missing' };
    const target = input.candidate.repairOf ? { kind: 'repair_batch' as const, summaryId: input.candidate.repairOf }
      : { kind: 'fresh_prefix' as const, firstMessageId: input.candidate.messages[0].id, messageCount: input.candidate.messages.length };
    const candidate = await options.memory.readFastSource(b, target);
    if (candidate.kind !== 'eligible' || summaryFastPayloadHash(candidate.input) !== summaryFastPayloadHash(input.candidate))
      return { kind: 'blocked', reason: 'source_changed' };
    const source = await options.memory.selectSource(b, target.kind === 'repair_batch' ? target : { kind: 'next_fresh' });
    if (source.kind !== 'eligible') return { kind: 'blocked', reason: source.kind };
    const lineageKey = summaryLineageKey(b.scope, source.manifest);
    if (candidate.lineageKeys[0] !== lineageKey) return { kind: 'blocked', reason: 'source_changed' };
    const binding = summaryFastBindingSchema.parse({ format: 'private-summary-fast/v1',
      target: source.manifest.kind === 'fresh_message' ? { kind: 'fresh_message', messageId: source.manifest.coveredMessageIds[0] }
        : { kind: 'repair_batch', repairOf: source.manifest.repairOf }, lineageKey, manifestHash: summaryManifestHash(source.manifest),
      candidate: { target, sourceHash: candidate.sourceHash }, rootContext: null, selected: null, noDispatch: null, transferredToWorkId: null });
    const prepared = await prepareClaimBase(b, { trigger: { kind: 'worker', reference: input.reference },
      recipeId: 'memory-refresh', candidateRunId: input.candidateRunId }, undefined, undefined, binding);
    const pointerRef = data.ref('private_summary_works', 'private-summary-lineage', lineageKey), row = await b.transaction.get(pointerRef);
    if (row.exists) {
      const pointer = data.open('private-summary-lineage', lineageKey, b.scope, summaryLineageRecordSchema, row);
      if (pointer.id !== lineageKey || firestoreDomainHash(pointer.scope) !== firestoreDomainHash(b.scope)
        || Object.entries(data.tags(b.scope)).some(([key, value]) => row.get(key) !== value) || row.get('recordVersion') !== pointer.version)
        domainReject('private_summary_binding', 500);
      if (pointer.authorizationVersion !== b.authorizationVersion || pointer.workerGeneration !== b.generation)
        return { kind: 'blocked', reason: 'authority_changed' };
      if (pointer.owner.kind === 'work') return { kind: 'blocked', reason: 'lineage_owned', workId: pointer.owner.workId };
      if (pointer.owner.runId !== prepared.run.id || pointer.owner.triggerReference !== input.reference)
        return { kind: 'blocked', reason: 'lineage_owned', runId: pointer.owner.runId };
      if (pointer.owner.accounting.state !== 'unresolved') return { kind: 'blocked', reason: 'legacy_settled', runId: pointer.owner.runId };
      const covered = prepared.run.summaryFast?.selected?.coveredMessageIds ?? source.manifest.coveredMessageIds;
      if (firestoreDomainHash(pointer.owner.coveredMessageIds) !== firestoreDomainHash(covered)) domainReject('private_summary_binding', 500);
      return { kind: 'claimed', ...prepared };
    }
    if (!prepared.claim.created) return { kind: 'blocked', reason: 'lineage_missing' };
    const pointer = summaryLineageRecordSchema.parse({ format: 'private-summary-lineage/v1', id: lineageKey, scope: b.scope,
      authorizationVersion: b.authorizationVersion, workerGeneration: b.generation, version: 1,
      owner: { kind: 'legacy_fast', runId: prepared.run.id, triggerReference: input.reference,
        coveredMessageIds: source.manifest.coveredMessageIds, accounting: { state: 'unresolved' } } });
    const envelope = { ...data.tags(b.scope), ...data.seal('private-summary-lineage', lineageKey, b.scope, summaryLineageRecordSchema, pointer, pointer.version) };
    return { kind: 'claimed', claim: prepared.claim, run: prepared.run, commit() {
      prepared.commit(); b.transaction.create(pointerRef, envelope);
    } };
  }
  async function requireSummaryReady(b: Binding, input: { binding: SummaryRunBinding; reference: string; candidateRunId: string }) {
    const binding = domainParse(summaryRunBindingSchema, input.binding);
    const row = await b.transaction.get(data.ref('private_summary_works', 'private-summary-work', binding.workId));
    if (!row.exists) domainReject('summary_work_missing');
    const work = data.open('private-summary-work', binding.workId, b.scope, privateSummaryWorkSchema, row);
    if (row.get('completionWakeState') !== (work.completionWake?.scheduling.kind ?? 'none') || row.get('recordVersion') !== work.version
      || work.id !== binding.workId || firestoreDomainHash(work.scope) !== firestoreDomainHash(b.scope)
      || work.authorizationVersion !== b.authorizationVersion || work.workerGeneration !== b.generation
      || work.state !== 'ready' || work.activeAttemptId !== null || work.sourceRevision !== binding.sourceRevision
      || work.chain.committedParts !== binding.step || work.nextAttempt !== binding.attempt) domainReject('summary_work_binding');
    const job = await readFirestoreBackgroundClaim(data, b, input.reference);
    if (!job || job.id !== firestoreDomainHash(['product-work', summaryPartBackgroundIdentity(work)])) domainReject('summary_work_lease');
    return work;
  }
  async function prepareSummaryClaim(b: Binding, input: { binding: SummaryRunBinding; reference: string; candidateRunId: string }) {
    await requireSummaryReady(b, input);
    return prepareClaimBase(b, { trigger: { kind: 'worker', reference: input.reference },
      recipeId: 'memory-refresh', candidateRunId: input.candidateRunId }, input.binding);
  }
  /** The only no-dispatch terminal path independently rereads authoritative whole coverage. */
  async function prepareSummaryCoveredClaim(b: Binding, input: { binding: SummaryRunBinding; reference: string; candidateRunId: string }) {
    const work = await requireSummaryReady(b, input);
    const row = await b.transaction.get(data.ref('private_summary_revisions', 'private-summary-revision', work.sourceRevisionId));
    if (!row.exists) domainReject('summary_source_missing');
    const revision = data.open('private-summary-revision', work.sourceRevisionId, b.scope, summarySourceRevisionSchema, row);
    if (revision.id !== work.sourceRevisionId || revision.workId !== work.id || revision.sourceRevision !== work.sourceRevision
      || revision.manifestHash !== work.manifestHash) domainReject('summary_source_binding');
    if ((await options.memory.revalidateSource(b, revision)).kind !== 'already_covered') domainReject('summary_not_covered');
    const effect: SummaryEffectReceipt = { kind: 'superseded', reason: 'already_covered', workId: work.id,
      sourceRevision: work.sourceRevision, attemptId: summaryAttemptId(input.binding) };
    return prepareClaimBase(b, { trigger: { kind: 'worker', reference: input.reference },
      recipeId: 'memory-refresh', candidateRunId: input.candidateRunId }, input.binding, effect);
  }
  /** Zero-dispatch administrative coverage only. This never grants a lease or returns execution permission. */
  async function prepareSummaryAdministrativeCoverage(b: Binding, input: { workId: string; binding: SummaryRunBinding; candidateRunId: string }) {
    if (b.sharedAccess || b.actorUserId !== b.scope.ownerUserId) domainReject('agent_scope_changed');
    domainParse(uuid, input.workId);
    const expected = domainParse(summaryRunBindingSchema, input.binding);
    const row = await b.transaction.get(data.ref('private_summary_works', 'private-summary-work', input.workId));
    if (!row.exists) domainReject('summary_work_missing');
    const work = data.open('private-summary-work', input.workId, b.scope, privateSummaryWorkSchema, row);
    if (work.id !== input.workId || firestoreDomainHash(work.scope) !== firestoreDomainHash(b.scope)
      || work.authorizationVersion !== b.authorizationVersion || work.workerGeneration !== b.generation
      || row.get('recordVersion') !== work.version || row.get('completionWakeState') !== (work.completionWake?.scheduling.kind ?? 'none')
      || work.state === 'restore_suspended' || work.state === 'completed' || work.activeAttemptId !== null) domainReject('summary_work_binding');
    const lineageRow = await b.transaction.get(data.ref('private_summary_works', 'private-summary-lineage', work.lineageKey));
    const revisionRow = await b.transaction.get(data.ref('private_summary_revisions', 'private-summary-revision', work.sourceRevisionId));
    const grantRow = await b.transaction.get(data.ref('private_summary_usage', 'private-summary-grant', work.grantRecordId));
    if (!lineageRow.exists || !revisionRow.exists || !grantRow.exists) domainReject('summary_work_binding');
    const lineage = data.open('private-summary-lineage', work.lineageKey, b.scope, summaryLineageRecordSchema, lineageRow);
    const revision = data.open('private-summary-revision', work.sourceRevisionId, b.scope, summarySourceRevisionSchema, revisionRow);
    const grant = data.open('private-summary-grant', work.grantRecordId, b.scope, summaryGrantRecordSchema, grantRow);
    if (lineage.id !== work.lineageKey || lineage.owner.kind !== 'work' || lineage.owner.workId !== work.id
      || firestoreDomainHash(lineage.scope) !== firestoreDomainHash(work.scope)
      || lineage.authorizationVersion !== work.authorizationVersion || lineage.workerGeneration !== work.workerGeneration
      || revision.id !== work.sourceRevisionId || revision.workId !== work.id || revision.sourceRevision !== work.sourceRevision
      || revision.manifestHash !== work.manifestHash || summaryLineageKey(work.scope, revision.manifest) !== work.lineageKey
      || grant.id !== work.grantRecordId || grant.workId !== work.id || firestoreDomainHash(grant.grant) !== firestoreDomainHash(work.grant))
      domainReject('summary_work_binding');
    const binding = { workId: work.id, sourceRevision: work.sourceRevision, step: work.chain.committedParts, attempt: work.nextAttempt };
    if (firestoreDomainHash(expected) !== firestoreDomainHash(binding)) domainReject('summary_administrative_binding');
    const reference = firestoreBackgroundReference({ id: firestoreDomainHash(['product-work', summaryPartBackgroundIdentity(work)]) });
    const attemptRow = await b.transaction.get(data.ref('private_summary_attempts', 'private-summary-attempt', summaryAttemptId(binding)));
    const priorRun = await originalRun(b, 'worker', reference);
    // Occupied binding reconciliation requires its own known-effect/retirement proof; it cannot be guessed from absence of active.
    if (attemptRow.exists || priorRun !== null || work.lastRetirementId !== null) domainReject('summary_administrative_occupied');
    if ((await options.memory.rebuildSummarySource(b, revision)).kind !== 'already_covered') domainReject('summary_not_covered');
    const effect: SummaryEffectReceipt = { kind: 'superseded', reason: 'already_covered', workId: work.id,
      sourceRevision: work.sourceRevision, attemptId: summaryAttemptId(binding) };
    return prepareClaimBase(b, { trigger: { kind: 'worker', reference }, recipeId: 'memory-refresh',
      candidateRunId: input.candidateRunId }, binding, effect);
  }
  /** Trusted summary coordinator only. No lease renewal, exact changeSeq relaxation for ordinary runs, or writes before commit. */
  async function prepareSummaryFinish(b: Binding, input: { scope: AgentScope; runId: string; attemptId: string;
    result: ProductAgentResult; effect: SummaryEffectReceipt; changeSeq?: string }) {
    const run = await read(b, input.runId), effect = domainParse(summaryEffectReceiptSchema, input.effect);
    const result = domainParse(productAgentResultSchema, input.result);
    if (!run.summaryWork || b.sharedAccess || b.actorUserId !== b.scope.ownerUserId || !matches(b, input.scope, run, false)
      || run.workerGeneration !== b.generation || run.trigger.kind !== 'worker' || run.recipeId !== 'memory-refresh'
      || run.result !== null || !(run.state === 'running' || run.state === 'unknown' && run.stopReason === 'interrupted')
      || result.runId !== run.id || !['completed', 'stopped'].includes(result.status)
      || effect.workId !== run.summaryWork.workId || effect.sourceRevision !== run.summaryWork.sourceRevision
      || effect.attemptId !== input.attemptId || input.attemptId !== summaryAttemptId(run.summaryWork)) domainReject('summary_finish_binding');
    const row = await b.transaction.get(data.ref('private_summary_works', 'private-summary-work', effect.workId));
    const attemptRow = await b.transaction.get(data.ref('private_summary_attempts', 'private-summary-attempt', input.attemptId));
    if (!row.exists || !attemptRow.exists) domainReject('summary_finish_binding');
    const work = data.open('private-summary-work', effect.workId, b.scope, privateSummaryWorkSchema, row);
    const attempt = data.open('private-summary-attempt', input.attemptId, b.scope, privateSummaryAttemptSchema, attemptRow);
    if (work.id !== effect.workId || work.activeAttemptId !== attempt.id || !['executing', 'unknown'].includes(work.state)
      || work.authorizationVersion !== b.authorizationVersion || work.workerGeneration !== b.generation
      || firestoreDomainHash(work.scope) !== firestoreDomainHash(b.scope) || work.version !== row.get('recordVersion')
      || row.get('completionWakeState') !== (work.completionWake?.scheduling.kind ?? 'none')
      || attempt.runId !== run.id || firestoreDomainHash(attempt.binding) !== firestoreDomainHash(run.summaryWork)
      || attempt.receipt !== null || !['claimed', 'reserved', 'unknown'].includes(attempt.state)
      || attempt.grantRecordId !== work.grantRecordId || work.sourceRevision !== attempt.binding.sourceRevision
      || work.chain.committedParts !== attempt.binding.step || work.nextAttempt !== attempt.binding.attempt) domainReject('summary_finish_binding');
    const changeSeq = input.changeSeq ?? b.changeSeq;
    domainParse(decimal, changeSeq);
    if (input.changeSeq !== undefined && BigInt(changeSeq) !== BigInt(b.changeSeq) + 1n) domainReject('agent_change_binding');
    const saved = firestoreAgentRunSchema.parse({ ...run, state: result.status, stopReason: result.stopReason,
      dataVersion: b.scope.storageEpoch + ':' + changeSeq, summaryEffect: effect, result });
    return { run: saved, commit() { write(b, saved); } };
  }
  async function prepareClaimBase(b: Binding, input: { trigger: NonNullable<AgentRunClaim['trigger']>; recipeId: string; candidateRunId: string; mixedRoomId?:string }, summaryWork?: SummaryRunBinding, noDispatchEffect?: SummaryEffectReceipt, summaryFast?: SummaryFastBinding) {
    const { trigger, recipeId, candidateRunId } = input;
    if (b.sharedAccess || b.actorUserId !== b.scope.ownerUserId) domainReject('agent_scope_changed');
    domainParse(uuid, candidateRunId);
    domainParse(firestoreAgentRunSchema.shape.trigger, trigger); domainParse(firestoreAgentRunSchema.shape.recipeId, recipeId);
    if (!summaryWork && !summaryFast && trigger.kind === 'worker' && recipeId === 'memory-refresh'
      && (await readPrivateSummaryEntryGate(data, b, false)).kind !== 'legacy') domainReject('summary_fast_probe_required');
    if (summaryWork ? trigger.kind !== 'worker' || recipeId !== 'memory-refresh'
      : trigger.kind === 'interactive' ? recipeId !== 'product-interactive' : !options.authorizeWorker) domainReject('domain_not_ready', 503);
    let mixedChat:z.infer<typeof mixedRunScopeSchema> | undefined;
    if (input.mixedRoomId) {
      if (trigger.kind !== 'interactive' || recipeId !== 'product-interactive') domainReject('agent_scope_changed');
      const {room,basis}=await options.chat.mixed.sourceIn(b,input.mixedRoomId,trigger.reference);
      mixedChat={roomId:room.id,scope:room.scope,childIds:room.childIds,basis};
    } else if (trigger.kind === 'interactive') {
      const source = await options.chat.readMessage(b, b.scope.childId, trigger.reference);
      if (!source || source.role !== 'user' || source.authorUserId !== b.scope.ownerUserId) domainReject('not_found', 404);
    } else if (!summaryWork && !await options.authorizeWorker?.(b, trigger.reference, recipeId)) domainReject('background_not_authorized', 403);
    const old = await originalRun(b, trigger.kind, trigger.reference);
    if (old && old.mixedChat?.roomId !== mixedChat?.roomId) domainReject('agent_claim_binding',409);
    if (old && firestoreDomainHash(old.summaryWork ?? null) !== firestoreDomainHash(summaryWork ?? null)) domainReject('summary_run_binding');
    const fastIdentity = (value: SummaryFastBinding) => ({ target: value.target, lineageKey: value.lineageKey,
      manifestHash: value.manifestHash, candidate: value.candidate });
    if (old && (!!old.summaryFast !== !!summaryFast || summaryFast
      && firestoreDomainHash(fastIdentity(old.summaryFast!)) !== firestoreDomainHash(fastIdentity(summaryFast)))) domainReject('summary_fast_binding');
    // Existing claims keep their original absolute deadline; a retry never extends it.
    const seconds = old ? null : trigger.kind === "interactive"
      ? await options.readInteractiveRunSeconds?.(b.transaction, b.scope) ?? AGENT_RUN_LIMITS.deadlineSeconds.default : 90;
    if (seconds !== null && (!Number.isSafeInteger(seconds) || seconds < AGENT_RUN_LIMITS.deadlineSeconds.min || seconds > AGENT_RUN_LIMITS.deadlineSeconds.max)) domainReject("invalid_run_deadline");
    const at = now();
    const run: FirestoreAgentRun = old ? expired(old) : {
      id: candidateRunId, childId: b.scope.childId, ownerUserId: b.scope.ownerUserId, workspaceId: b.scope.workspaceId, storageEpoch: b.scope.storageEpoch,
      authorizationVersion: b.authorizationVersion, dataVersion: current(b).dataVersion, trigger,
      ...(mixedChat ? {mixedChat} : {}),
      ...(trigger.kind === 'worker' ? {workerGeneration:b.generation} : {}), ...(summaryWork ? { summaryWork, summaryRetirementId: null } : {}),
      ...(summaryFast ? { summaryFast } : {}),
      sourceMessageId: trigger.kind === 'interactive' ? trigger.reference : null, recipeId, state: 'running', stopReason: null,
      createdAt: new Date(at).toISOString(), expiresAt: new Date(at + seconds! * 1000).toISOString(), result: null,
    };
    if (noDispatchEffect) {
      if (old || !summaryWork) domainReject('summary_claim_conflict');
      run.state = 'completed'; run.summaryEffect = noDispatchEffect;
      run.result = { ...empty(run), countsKnown: true, outcome: 'no_action' };
    }
    const claim = projectClaim(b, run, !old);
    return { claim, run, commit() {
      if (!old) {
        const id = claimId(b, trigger.kind, trigger.reference);
        const envelope = { ...data.tags(b.scope), ...data.seal('agent-claim', id, b.scope, firestoreAgentClaimSchema,
          { runId: run.id, ...(mixedChat ? {mixedChat} : {}) }) };
        write(b, run, true); b.transaction.create(data.ref('agent_claims', 'agent-claim', id), envelope);
      } else if (old.state !== run.state) write(b, run);
    } };
  }
  return {
    authority, data, current, matches, read, requireLive, advance, write, originalReplyRun, originalRun, prepareClaim, prepareFastProbeClaim, prepareSummaryClaim, prepareSummaryCoveredClaim, prepareSummaryAdministrativeCoverage, prepareSummaryFinish, requireSummaryReady, projectClaim,
    async claimMixed(userId:string,roomId:string,messageId:string) {
      const candidateRunId=randomUUID();
      return authority.runTransaction(userId,null,async b=>{
        const prepared=await prepareClaimBase(b,{trigger:{kind:'interactive',reference:messageId},recipeId:'product-interactive',candidateRunId,mixedRoomId:domainParse(uuid,roomId)});
        prepared.commit(); return prepared.claim;
      });
    },
    async mixedInput(userId:string,roomId:string,messageId:string) {
      return authority.runTransaction(userId,null,async b=>{
        const source=await options.chat.mixed.sourceIn(b,roomId,messageId,true);
        const messages:{id:string;role:'user'|'model';text:string;inReplyTo?:string}[]=[];
        for (const message of source.earlier) {
          messages.push(message);
          const old=await originalReplyRun(b,message.id);
          if (old?.mixedChat?.roomId===roomId && old.result?.status==='completed' && old.result.text)
            messages.push({id:old.id,role:'model',text:old.result.text,inReplyTo:message.id});
        }
        messages.push(source.message);
        return {room:source.room,taskScope:source.taskScope,messages,hasEarlier:source.hasEarlier};
      });
    },
    async authorizeMixed(userId:string,roomId:string,messageId:string,runId:string) {
      try {
        return await authority.runTransaction(userId,null,async b=>{
          const source=await options.chat.mixed.sourceIn(b,roomId,messageId);
          const run=expired(await read(b,runId));
          return run.state==='running' && run.mixedChat?.roomId===roomId && run.sourceMessageId===messageId
            && run.mixedChat.basis===source.basis && matches(b,current(b),run);
        });
      } catch(error) {
        if ((error instanceof FirestoreDomainError || error instanceof FirestoreAuthorityError) && [403,404,409,428].includes(error.status)) return false;
        throw error;
      }
    },
    async mixedResult(userId:string,roomId:string,messageId:string,cancel=false) {
      return authority.runTransaction(userId,null,async b=>{
        await options.chat.mixed.sourceIn(b,roomId,messageId);
        const original=await originalReplyRun(b,messageId);
        if (!original) return null;
        if (original.mixedChat?.roomId !== roomId) domainReject('agent_claim_binding',409);
        let run=expired(original);
        if (cancel && run.state === 'running') run={...run,state:'stopped',stopReason:'cancelled'};
        if (run.state !== original.state) write(b,run);
        return {...(run.result ?? empty(run)),status:run.state,stopReason:run.stopReason};
      });
    },
    async mixedTranscriptPage(userId:string,pin:MixedRoomPin,scope:MixedTransferScope,childIds:string[],cursor:string|null):Promise<MixedTranscriptPage> {
      return authority.runTransaction(userId,null,async b=>{
        const page=await options.chat.mixed.exportPageIn(b,pin,scope,new Set(childIds),cursor);
        const items=await Promise.all(page.messages.map(async message=>{
          const archived=page.archivedReplies?.find(entry=>entry.messageId===message.id);
          if (archived) return {message,reply:archived.reply};
          const original=await originalReplyRun(b,message.id);
          const run=original && expired(original);
          if (run && (run.mixedChat?.roomId!==pin.id || run.sourceMessageId!==message.id)) domainReject('agent_claim_binding',409);
          let reply:MixedTranscriptRow['reply'];
          if (!run) reply={status:'not_started'};
          else if (run.state!=='completed') reply={status:run.state};
          else {
            if (run.result?.status!=='completed') domainReject('agent_claim_binding',409);
            reply={status:'completed',text:run.result.text,citations:run.result.citations.map(
              ({sourceId,versionId,chunkId,title,url,section,pageStart,pageEnd})=>({sourceId,versionId,chunkId,title,url,section,
                ...(pageStart===undefined?{}:{pageStart}),...(pageEnd===undefined?{}:{pageEnd})}))};
          }
          return {message,reply};
        }));
        return {items,nextCursor:page.nextCursor,from:page.room.createdAt,to:page.room.updatedAt};
      });
    },
    async finishMixed(userId:string,roomId:string,messageId:string,raw:ProductAgentResult) {
      const value=domainParse(productAgentResultSchema,raw);
      if (value.status==='running' || value.outcome || value.proposals.length) domainReject('invalid_result',500);
      return authority.runTransaction(userId,null,async b=>{
        const source=await options.chat.mixed.sourceIn(b,roomId,messageId);
        const run=await originalReplyRun(b,messageId);
        if (!run || run.id !== value.runId || run.mixedChat?.roomId !== roomId) domainReject('agent_scope_changed');
        if (run.result || !(run.state==='running' || run.state==='unknown' && run.stopReason==='interrupted')) return false;
        const result=run.mixedChat.basis===source.basis && matches(b,current(b),run) ? value :
          {...empty(run),status:'stopped' as const,stopReason:'source_changed',counts:value.counts,countsKnown:value.countsKnown};
        const change=await b.prepareChange(run.id,'chat',false);
        write(b,{...run,state:result.status,stopReason:result.stopReason,result});
        change.commit(); return true;
      });
    },
    async replyState(userId: string, childId: string, messageId: string) {
      domainParse(uuid, messageId);
      try { return await authority.runTransaction(userId, childId, async b => {
        const source = await options.chat.readMessage(b, childId, messageId);
        if (!source || source.role !== 'user' || source.authorUserId !== userId) domainReject('not_found', 404);
        const original = await originalReplyRun(b, messageId);
        if (!original) return null;
        if (!matches(b, current(b), original, false)) domainReject('agent_scope_changed');
        const run = expired(original);
        return { messageId, runId: run.id, status: run.state, stopReason: run.stopReason };
      }); } catch (error) {
        // A missing/foreign child is not an unclaimed message and must not enable a new reply.
        if (error instanceof FirestoreAuthorityError && [403, 404].includes(error.status)) domainReject('not_found', 404);
        throw error;
      }
    },
    async claim(userId: string, childId: string, trigger: AgentRunClaim['trigger'] & {}, recipeId: string): Promise<AgentRunClaim> {
      domainParse(firestoreAgentRunSchema.shape.trigger, trigger); domainParse(firestoreAgentRunSchema.shape.recipeId, recipeId);
      if (trigger.kind === 'interactive' ? recipeId !== 'product-interactive' : !options.authorizeWorker) domainReject('domain_not_ready', 503);
      const candidateRunId = randomUUID();
      return authority.runTransaction(userId, childId, async b => {
        const prepared = await prepareClaim(b, { trigger, recipeId, candidateRunId });
        prepared.commit(); return prepared.claim;
      });
    },
    async authorize(scope: AgentScope, runId?: string) {
      try {
        return await authority.runTransaction(scope.userId, scope.childId, async b => {
          const run = runId ? expired(await read(b, runId)) : undefined;
          return matches(b, scope, run) && (!runId || run?.state === 'running')
            && (!run || run.trigger.kind !== 'worker' || run.workerGeneration === b.generation && await options.authorizeWorker?.(b, run.trigger.reference, run.recipeId) === true);
        });
      } catch (error) {
        if (error instanceof FirestoreAuthorityError && [403, 404, 428].includes(error.status)) return false;
        throw error;
      }
    },
    async cancelReply(userId: string, childId: string, messageId: string) {
      domainParse(uuid, messageId);
      return authority.runTransaction(userId, childId, async b => {
        const source = await options.chat.readMessage(b, childId, messageId), original = await originalReplyRun(b, messageId);
        if (!source || source.role !== 'user' || !original || original.result
          || !matches(b, current(b), original, false)) return false;
        const run = expired(original);
        if (run.state === 'stopped' && run.stopReason === 'cancelled') return true;
        if (run.state !== 'running') { if (run.state !== original.state) write(b, run); return false; }
        write(b, { ...run, state: 'stopped', stopReason: 'cancelled' }); return true;
      });
    },
    async result(userId: string, childId: string, runId: string, projection: FirestoreAgentResultProjection, cancelledOnly = false) {
      return authority.runTransaction(userId, childId, async b => {
        const original = await read(b, runId), run = expired(original);
        if (cancelledOnly && !(run.state === 'stopped' && run.stopReason === 'cancelled' && run.result === null)) return null;
        const value = await projection.read(b, run, { ...(run.result ?? empty(run)), status: run.state, stopReason: run.stopReason });
        if (run.state !== original.state) write(b, run);
        return value;
      });
    },
    async finish(scope: AgentScope, raw: ProductAgentResult, summary?: z.infer<typeof summarySaveSchema>) {
      const value = domainParse(productAgentResultSchema, raw);
      if (value.status === 'running') domainReject('invalid_result', 500);
      return authority.runTransaction(scope.userId, scope.childId, async b => {
        // The execution deadline prevents new work, not the original executor's terminal save.
        // A read may already have projected expiry as interrupted. Only that unresolved state
        // can settle; cancellation, another final result and changed authority remain fenced.
        const run = await read(b, value.runId);
        if (run.summaryWork) domainReject('summary_finish_required');
        const unresolved = run.state === 'running' || run.state === 'unknown' && run.stopReason === 'interrupted';
        if (!unresolved || run.result !== null || !matches(b, scope, run, false)) return false;
        if (value.outcome === 'no_action' && run.trigger.kind !== 'worker') domainReject('invalid_result', 500);
        const unchanged = matches(b, scope, run) && (run.trigger.kind !== 'worker'
          || run.workerGeneration === b.generation && await options.authorizeWorker?.(b, run.trigger.reference, run.recipeId) === true);
        const result: ProductAgentResult = unchanged ? value : { ...value, status: 'stopped', stopReason: 'unauthorized',
          text: '資料在處理期間有變，請核對目前資料及原操作收據；不要重複提交已保存的操作。',
          citations: [], privateSourceCitations: [], retrievalMode: 'not_used', tools: [], proposals: [] };
        if (!unchanged) { delete result.outcome; delete result.deliveryReview; }
        // A stale summary is optional; an invalid authority/read is not a silent empty summary.
        let prepared: Awaited<ReturnType<FirestoreMemoryStore['prepareSummaryWrite']>> | undefined;
        if (summary && result.status === 'completed') {
          try { prepared = await options.memory.prepareSummaryWrite(b, summary, run.id); }
          catch (error) {
            // This specific check precedes change reservation and all writes. Other failures remain fatal.
            if (!(error instanceof FirestoreDomainError && error.code === 'summary_coverage_changed')) throw error;
          }
        }
        const saved: FirestoreAgentRun = { ...run, state: result.status, stopReason: result.stopReason,
          dataVersion: b.scope.storageEpoch + ':' + (prepared?.changeSeq ?? b.changeSeq),
          result: { ...result, proposals: [] } };
        prepared?.commit(); write(b, saved); return true;
      });
    },
    async backgroundRuns(userId: string, childId: string) {
      return authority.runTransaction(userId, childId, async b => {
        const tags = data.tags(b.scope);
        const rows = await b.transaction.get(data.collection('agent_runs')
          .where('workspaceTag', '==', tags.workspaceTag).where('epochTag', '==', tags.epochTag)
          .where('childTag', '==', tags.childTag).where('userTag', '==', tags.userTag).where('triggerKind', '==', 'worker')
          .orderBy('createdAt', 'desc').orderBy('runId', 'desc').limit(20));
        return rows.docs.map(row => { const run = decode(b, row.get('runId'), row); return { runId: run.id, createdAt: run.createdAt }; });
      });
    },
  };
}
export type FirestoreAgentRuns = ReturnType<typeof createFirestoreAgentRuns>;
