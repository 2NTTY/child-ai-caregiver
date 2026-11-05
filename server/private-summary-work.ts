import { firestoreRootBudgetContextSchema, firestoreRootBudgetRecoverySchema } from './firestore-root-budget.ts';
import { firestoreDailyUsageRequestSchema } from './firestore-ai-usage.ts';
import type { AgentStopReason } from './agent-budget.ts';
import { z } from 'zod';
import { workRecoveryScopeSchema, workRecoverySchemas, type WorkRecoveryScope } from './firestore-work-continuation-recovery.ts';
import { firestoreDomainHash } from './firestore-domain-data.ts';
import { canonicalJson } from './online-routing.ts';
import { firestoreChatMessageSchema } from './chat-message-schema.ts';
import { summaryDependencySchema, summaryBatchSchema, summarySaveSchema } from './memory-validation.ts';

export { summaryDependencySchema } from './memory-validation.ts';
export type SummaryDependency = z.infer<typeof summaryDependencySchema>;
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const digest = z.string().regex(/^[a-f0-9]{64}$/u), sortKey = z.string().regex(/^[0-9]{19}$/u);
const chatSourceSchema = z.object({ kind: z.literal('chat_text'), messageId: z.uuid(), sortKey,
  messageHash: digest, utf16Length: integer }).strict();
const correctionSourceSchema = z.object({ kind: z.literal('correction_json'), dependency: summaryDependencySchema,
  valueHash: digest, utf16Length: integer.min(1) }).strict();
export const summarySourceUnitSchema = z.discriminatedUnion('kind', [chatSourceSchema, correctionSourceSchema]);
export type SummarySourceUnit = z.infer<typeof summarySourceUnitSchema>;
export const summaryCursorSchema = z.object({ unitIndex: integer, offsetUtf16: integer }).strict();
export type SummaryCursor = z.infer<typeof summaryCursorSchema>;
export const summaryFragmentRangeSchema = z.object({ unitIndex: integer, startUtf16: integer, endUtf16: integer,
  metadataOnly: z.boolean() }).strict().refine(range => range.metadataOnly
    ? range.startUtf16 === 0 && range.endUtf16 === 0 : range.endUtf16 > range.startUtf16);
export type SummaryFragmentRange = z.infer<typeof summaryFragmentRangeSchema>;
const manifestBasis = { format: z.literal('private-summary-manifest/v1'), mode: z.literal('private'),
  appendAfterSortKey: sortKey.nullable(), sourceBasis: digest, sourceCoverageComplete: z.boolean(),
  dependencies: summaryBatchSchema.shape.dependencies, units: z.array(summarySourceUnitSchema) };
const dependencyKey = (dependency: SummaryDependency) => `${dependency.kind}:${dependency.id}`;
export const summaryManifestSchema = z.discriminatedUnion('kind', [
  z.object({ ...manifestBasis, kind: z.literal('fresh_message'), coveredMessageIds: z.tuple([z.uuid()]), repairOf: z.null() }).strict(),
  z.object({ ...manifestBasis, kind: z.literal('repair_batch'), coveredMessageIds: summarySaveSchema.shape.coveredMessageIds,
    repairOf: z.uuid() }).strict(),
]).superRefine((manifest, context) => {
  const invalid = () => context.addIssue({ code: 'custom', message: 'private_summary_manifest_invalid' });
  const ids = manifest.coveredMessageIds;
  if (new Set(ids).size !== ids.length || manifest.units.length < ids.length) invalid();
  const dependencies = new Map(manifest.dependencies.map(dependency => [dependencyKey(dependency), dependency]));
  if (dependencies.size !== manifest.dependencies.length) invalid();
  let priorSortKey = manifest.kind === 'fresh_message' ? manifest.appendAfterSortKey : null;
  for (let index = 0; index < ids.length; index++) {
    const unit = manifest.units[index];
    if (!unit || unit.kind !== 'chat_text' || unit.messageId !== ids[index]) { invalid(); continue; }
    if (priorSortKey !== null && unit.sortKey <= priorSortKey) invalid();
    priorSortKey = unit.sortKey;
  }
  const corrected = new Set<string>();
  for (const unit of manifest.units.slice(ids.length)) {
    if (unit.kind !== 'correction_json') { invalid(); continue; }
    const key = dependencyKey(unit.dependency), declared = dependencies.get(key);
    if (!declared || canonicalJson(declared) !== canonicalJson(unit.dependency) || corrected.has(key)) invalid();
    corrected.add(key);
  }
});
export type SummaryManifest = z.infer<typeof summaryManifestSchema>;

/** Validate the complete stored message; the caller supplies its authoritative sort key. */
export function makeSummaryChatSource(rawMessage: unknown, rawSortKey: string): {
  source: Extract<SummarySourceUnit, { kind: 'chat_text' }>; sourceText: string;
} {
  const message = firestoreChatMessageSchema.parse(rawMessage);
  return { source: chatSourceSchema.parse({ kind: 'chat_text', messageId: message.id, sortKey: rawSortKey,
    messageHash: firestoreDomainHash(message), utf16Length: message.text.length }), sourceText: message.text };
}
/** The caller must first validate and authorize the current domain value and dependency. */
export function makeSummaryCorrectionSource(rawDependency: SummaryDependency, rawValue: unknown): {
  source: Extract<SummarySourceUnit, { kind: 'correction_json' }>; sourceText: string;
} {
  const dependency = summaryDependencySchema.parse(rawDependency), value = z.json().parse(rawValue);
  const sourceText = canonicalJson(value);
  return { source: correctionSourceSchema.parse({ kind: 'correction_json', dependency,
    valueHash: firestoreDomainHash(value), utf16Length: sourceText.length }), sourceText };
}
export function summaryManifestHash(manifest: SummaryManifest): string {
  return firestoreDomainHash(summaryManifestSchema.parse(manifest));
}
export type SummaryLineageTarget = { kind: 'fresh_message'; messageId: string } | { kind: 'repair_batch'; repairOf: string };
export function summaryLineageKeyForTarget(rawScope: WorkRecoveryScope, rawTarget: SummaryLineageTarget): string {
  const scope = workRecoveryScopeSchema.parse(rawScope), target = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('fresh_message'), messageId: z.uuid() }).strict(),
    z.object({ kind: z.literal('repair_batch'), repairOf: z.uuid() }).strict(),
  ]).parse(rawTarget);
  return firestoreDomainHash(['private-summary-lineage/v1', scope, target]);
}
/** Source revisions retain the same original work lineage and therefore the same usage grant. */
export function summaryLineageKey(rawScope: WorkRecoveryScope, rawManifest: SummaryManifest): string {
  const manifest = summaryManifestSchema.parse(rawManifest);
  return summaryLineageKeyForTarget(rawScope, manifest.kind === 'fresh_message'
    ? { kind: manifest.kind, messageId: manifest.coveredMessageIds[0] } : { kind: manifest.kind, repairOf: manifest.repairOf });
}

const policyIdentity = z.string().min(1).refine(value => value.isWellFormed());
export const summaryWorkGrantSchema = z.object({ grantId: z.uuid(), revision: integer.min(1),
  policyVersion: policyIdentity, settingsVersion: policyIdentity, promptPackVersion: policyIdentity,
  billingSource: z.enum(['platform', 'personal']), billingVersion: policyIdentity, model: policyIdentity,
  limits: z.object({ modelCalls: integer, toolCalls: integer }).strict(),
  workDeadlineAt: z.iso.datetime({ offset: true }).nullable(), retryPolicyVersion: policyIdentity }).strict();
export type SummaryWorkGrant = z.infer<typeof summaryWorkGrantSchema>;
export function summaryGrantRecordId(workId: string, grant: SummaryWorkGrant): string {
  const value = summaryWorkGrantSchema.parse(grant);
  return firestoreDomainHash(['private-summary-grant/v1', z.uuid().parse(workId), value.grantId, value.revision]);
}
export const summaryGrantRenewalBasisSchema = z.object({ previousGrantRecordId: digest, usageRevision: integer.min(1),
  used: z.object({ modelCalls: integer, toolCalls: integer }).strict(), unresolvedRetiredCount: integer,
  sourceRevisionId: digest, chainDigest: digest, lastRetirementId: digest.nullable() }).strict()
  .refine(value => value.unresolvedRetiredCount === 0 || value.lastRetirementId !== null);
export type SummaryGrantRenewalBasis = z.infer<typeof summaryGrantRenewalBasisSchema>;
export const summaryGrantRecordSchema = z.object({ format: z.literal('private-summary-grant/v1'),
  id: digest, workId: z.uuid(), grant: summaryWorkGrantSchema, renewal: summaryGrantRenewalBasisSchema.nullable() }).strict()
  .refine(record => record.id === summaryGrantRecordId(record.workId, record.grant)
    && record.renewal?.previousGrantRecordId !== record.id);
export type SummaryGrantRecord = z.infer<typeof summaryGrantRecordSchema>;
const completeIds = summarySaveSchema.shape.coveredMessageIds.refine(ids => new Set(ids).size === ids.length);
export const summaryLineageRecordSchema = z.object({ format: z.literal('private-summary-lineage/v1'),
  id: digest, scope: workRecoveryScopeSchema, authorizationVersion: workRecoverySchemas.workspace.shape.accessVersion,
  workerGeneration: z.uuid(), version: integer.min(1), owner: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('work'), workId: z.uuid() }).strict(),
    z.object({ kind: z.literal('legacy_fast'), runId: z.uuid(), triggerReference: z.uuid(), coveredMessageIds: completeIds,
      accounting: z.discriminatedUnion('state', [
        z.object({ state: z.literal('unresolved') }).strict(),
        z.object({ state: z.literal('no_dispatch'), evidenceId: digest }).strict(),
        z.object({ state: z.literal('transferred'), workId: z.uuid(), transferRecordId: digest }).strict(),
      ]) }).strict(),
  ]) }).strict();
export type SummaryLineageRecord = z.infer<typeof summaryLineageRecordSchema>;

const summaryStopReasons = ['model_endpoint_invalid', 'model_endpoint_redirected', 'model_network_error', 'model_provider_quota', 'model_provider_rate_limit', 'model_tools_unsupported', 'model_input_unsupported', 'model_context_exceeded', 'model_output_limit', 'model_provider_rejected', 'model_response_invalid', 'embedding_not_configured', 'embedding_key_invalid', 'embedding_model_unavailable', 'embedding_provider_quota', 'embedding_provider_rate_limit', 'embedding_region_unavailable', 'embedding_permission_denied', 'embedding_provider_failed', 'model_key_invalid', 'model_region_unavailable', 'model_not_available', 'model_http_400', 'model_http_401', 'model_http_403', 'model_http_404', 'model_http_408', 'model_http_429', 'model_http_500', 'model_http_502', 'model_http_503', 'model_http_504', 'cancelled', 'deadline', 'model_limit', 'tool_limit', 'embedding_limit', 'input_limit', 'unauthorized', 'quota_exceeded', 'busy', 'unavailable', 'invalid_response', 'invalid_tool', 'tool_unknown', 'delivery_review_incomplete', 'delivery_review_rejected', 'delivery_review_no_sources', 'delivery_review_budget', 'compose_review_incomplete'] as const satisfies readonly AgentStopReason[];
const exhaustiveStopReasons: Exclude<AgentStopReason, typeof summaryStopReasons[number]> extends never ? true : never = true;
void exhaustiveStopReasons;
const authorityVersion = workRecoverySchemas.workspace.shape.accessVersion;
const time = z.iso.datetime({ offset: true });
const outputText = summarySaveSchema.shape.text;
export const summaryRunBindingSchema = z.object({ workId: z.uuid(), sourceRevision: integer.min(1),
  step: integer, attempt: integer }).strict();
export type SummaryRunBinding = z.infer<typeof summaryRunBindingSchema>;
export const summaryPartPlanSchema = z.object({ binding: summaryRunBindingSchema, manifestHash: digest,
  range: summaryFragmentRangeSchema, priorAccumulatorHash: digest.nullable(), requestFingerprint: digest,
  outputTextLimit: integer.min(1) }).strict();
export type SummaryPartPlan = z.infer<typeof summaryPartPlanSchema>;
export function summaryRevisionId(workId: string, revision: number): string {
  return firestoreDomainHash(['private-summary-revision/v1', z.uuid().parse(workId), integer.min(1).parse(revision)]);
}
export function summaryAttemptId(raw: SummaryRunBinding): string {
  const hash = firestoreDomainHash(['private-summary-attempt/v1', summaryRunBindingSchema.parse(raw)]);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
export function summaryReservationId(workId: string, key: string, kind: 'model' | 'tool'): string {
  return firestoreDomainHash(['private-summary-reservation/v1', z.uuid().parse(workId),
    policyIdentity.parse(key), z.enum(['model', 'tool']).parse(kind)]);
}
export function summaryChainGenesis(workId: string, revision: number, manifestHash: string): string {
  return firestoreDomainHash(['private-summary-chain/v1', z.uuid().parse(workId), integer.min(1).parse(revision), digest.parse(manifestHash)]);
}
export const summarySourceRevisionSchema = z.object({ format: z.literal('private-summary-source-revision/v1'),
  id: digest, workId: z.uuid(), sourceRevision: integer.min(1), scope: workRecoveryScopeSchema,
  authorizationVersion: authorityVersion, workerGeneration: z.uuid(), manifest: summaryManifestSchema,
  manifestHash: digest, createdAt: time }).strict().refine(value => value.id === summaryRevisionId(value.workId, value.sourceRevision)
    && value.manifestHash === summaryManifestHash(value.manifest));
export type PrivateSummarySourceRevision = z.infer<typeof summarySourceRevisionSchema>;
const effectBasis = { workId: z.uuid(), sourceRevision: integer.min(1), attemptId: z.uuid() };
export const summaryEffectReceiptSchema = z.discriminatedUnion('kind', [
  z.object({ ...effectBasis, kind: z.literal('part_committed'), step: integer, next: summaryCursorSchema }).strict(),
  z.object({ ...effectBasis, kind: z.literal('published'), summaryId: z.uuid(), summaryVersion: integer.min(1),
    coveredMessageIds: completeIds, repairOf: z.uuid().nullable() }).strict(),
  z.object({ ...effectBasis, kind: z.literal('superseded'), reason: z.enum(['source_changed', 'already_covered']) }).strict(),
  z.object({ ...effectBasis, kind: z.literal('no_effect'), dispatchOutcome: z.enum(['not_dispatched', 'response_observed']),
    stopReason: z.enum(summaryStopReasons) }).strict(),
]);
export type SummaryEffectReceipt = z.infer<typeof summaryEffectReceiptSchema>;
export const summaryChainHeadSchema = z.object({ committedParts: integer, next: summaryCursorSchema,
  accumulatorHash: digest.nullable(), digest }).strict();
export type SummaryChainHead = z.infer<typeof summaryChainHeadSchema>;
export const summaryChainLinkSchema = z.object({ predecessor: digest, next: digest,
  range: summaryFragmentRangeSchema, outputHash: digest }).strict();
export type SummaryChainLink = z.infer<typeof summaryChainLinkSchema>;
export const summaryCompletionWakeSchema = z.object({ id: digest, receiptHash: digest,
  scheduling: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('pending_schedule') }).strict(),
    z.object({ kind: z.literal('queued'), jobId: digest, dueAt: time }).strict(),
  ]) }).strict();
export type SummaryCompletionWake = z.infer<typeof summaryCompletionWakeSchema>;
export function summaryCompletionWakeId(workId: string, attemptId: string) {
  return firestoreDomainHash(['private-summary-completion-wake/v1', z.uuid().parse(workId), z.uuid().parse(attemptId)]);
}
export function summaryCompletionWakeIdentity(input: { scope: WorkRecoveryScope; workerGeneration: string; authorizationVersion: string }, wakeId: string) {
  return { kind: 'memory-refresh' as const, scope: input.scope, resourceId: input.scope.childId,
    basis: 'summary-completion:v1:' + digest.parse(wakeId), generation: input.workerGeneration, authorizationVersion: input.authorizationVersion };
}
export const privateSummaryWorkSchema = z.object({ format: z.literal('private-summary-work/v1'), id: z.uuid(), lineageKey: digest,
  scope: workRecoveryScopeSchema, authorizationVersion: authorityVersion, workerGeneration: z.uuid(), version: integer.min(1),
  sourceRevision: integer.min(1), sourceRevisionId: digest, manifestHash: digest, grant: summaryWorkGrantSchema, grantRecordId: digest,
  state: z.enum(['ready', 'executing', 'unknown', 'policy_blocked', 'budget_exhausted', 'invalidated', 'suppressed',
    'capacity_blocked', 'restore_suspended', 'failed', 'completed']), chain: summaryChainHeadSchema, nextAttempt: integer,
  accumulator: z.object({ text: outputText, hash: digest }).strict().nullable(), activeAttemptId: z.uuid().nullable(),
  lastRetirementId: digest.nullable(), finalReceipt: summaryEffectReceiptSchema.nullable(), completionWake: summaryCompletionWakeSchema.nullable() }).strict().refine(value => {
  if (value.sourceRevisionId !== summaryRevisionId(value.id, value.sourceRevision)
    || value.grantRecordId !== summaryGrantRecordId(value.id, value.grant)) return false;
  if (value.accumulator && (value.accumulator.hash !== firestoreDomainHash(value.accumulator.text)
    || value.chain.accumulatorHash !== value.accumulator.hash)) return false;
  if (!value.chain.committedParts && (value.accumulator !== null || value.chain.accumulatorHash !== null
    || value.chain.next.unitIndex !== 0 || value.chain.next.offsetUtf16 !== 0
    || value.chain.digest !== summaryChainGenesis(value.id, value.sourceRevision, value.manifestHash))) return false;
  if (value.chain.committedParts > 0 && ['ready', 'executing'].includes(value.state) && !value.accumulator) return false;
  if (value.state === 'ready' && (value.activeAttemptId !== null || value.finalReceipt !== null)
    || value.state === 'executing' && value.activeAttemptId === null) return false;
  if (value.finalReceipt && (value.finalReceipt.workId !== value.id || value.finalReceipt.sourceRevision !== value.sourceRevision)) return false;
  if (value.state === 'completed') {
    const wake = value.completionWake;
    if (!value.finalReceipt || !wake || wake.id !== summaryCompletionWakeId(value.id, value.finalReceipt.attemptId)
      || wake.receiptHash !== firestoreDomainHash(value.finalReceipt)
      || wake.scheduling.kind === 'queued' && wake.scheduling.jobId !== firestoreDomainHash(['product-work', summaryCompletionWakeIdentity(value, wake.id)])) return false;
  } else if (value.completionWake !== null) return false;
  return value.state !== 'completed' || value.activeAttemptId === null && (value.finalReceipt?.kind === 'published'
    || value.finalReceipt?.kind === 'superseded' && value.finalReceipt.reason === 'already_covered');
});
export type PrivateSummaryWork = z.infer<typeof privateSummaryWorkSchema>;
/** Query metadata is always derived from the same validated encrypted work body. */
export function privateSummaryWorkProjection(raw: PrivateSummaryWork) {
  const work = privateSummaryWorkSchema.parse(raw);
  return { workState: work.state, completionWakeState: work.completionWake?.scheduling.kind ?? 'none' };
}
export function summaryPartBackgroundIdentity(work: PrivateSummaryWork) {
  return { kind: 'memory-refresh' as const, scope: work.scope, resourceId: work.id,
    basis: `summary-part:v1:${work.id}:${work.sourceRevision}:${work.chain.committedParts}:${work.nextAttempt}`,
    generation: work.workerGeneration, authorizationVersion: work.authorizationVersion };
}

export type SummaryBackgroundBasis = { kind: 'scope'; request: number }
  | { kind: 'part'; binding: SummaryRunBinding }
  | { kind: 'completion'; wakeId: string };
/** Parse identity only. The original live lease, authority and stored work still grant permission. */
export function parseSummaryBackgroundBasis(value: unknown): SummaryBackgroundBasis | null {
  if (typeof value !== 'string' || value.length > 256) return null;
  if (/^[1-9][0-9]*$/u.test(value)) {
    const request = Number(value);
    return Number.isSafeInteger(request) ? { kind: 'scope', request } : null;
  }
  const completion = /^summary-completion:v1:([a-f0-9]{64})$/u.exec(value);
  if (completion) return { kind: 'completion', wakeId: completion[1] };
  const part = /^summary-part:v1:([^:]+):([1-9][0-9]*):(0|[1-9][0-9]*):(0|[1-9][0-9]*)$/u.exec(value);
  if (!part) return null;
  const parsed = summaryRunBindingSchema.safeParse({ workId: part[1], sourceRevision: Number(part[2]),
    step: Number(part[3]), attempt: Number(part[4]) });
  return parsed.success ? { kind: 'part', binding: parsed.data } : null;
}

export const summarySuccessorScheduleSchema = z.object({ binding: summaryRunBindingSchema, dueAt: time }).strict();
export const privateSummaryAttemptSchema = z.object({ format: z.literal('private-summary-attempt/v1'), id: z.uuid(),
  binding: summaryRunBindingSchema, runId: z.uuid(), triggerReference: z.uuid(),
  state: z.enum(['claimed', 'reserved', 'committed', 'not_dispatched', 'known_failed', 'unknown']),
  plan: summaryPartPlanSchema.nullable(), sourceRevisionId: digest, chainLink: summaryChainLinkSchema.nullable(),
  receipt: summaryEffectReceiptSchema.nullable(), resultText: outputText.nullable(), contentState: z.enum(['present', 'erased']),
  erasureIntentId: z.uuid().nullable(), retirementId: digest.nullable(), noDispatchReason: policyIdentity.nullable(), grantRecordId: digest,
  rootContext: firestoreRootBudgetContextSchema.nullable(), modelReservationId: digest.nullable(), successorSchedule: summarySuccessorScheduleSchema.nullable() }).strict().refine(value => {
  if (value.id !== summaryAttemptId(value.binding)
    || value.sourceRevisionId !== summaryRevisionId(value.binding.workId, value.binding.sourceRevision)) return false;
  if (value.retirementId !== null && (value.retirementId !== summaryRetirementId(value.binding.workId, value.id)
    || !value.plan || !value.rootContext || !value.modelReservationId
    || !['unknown', 'committed', 'not_dispatched', 'known_failed'].includes(value.state)
    || value.receipt && value.receipt.kind !== 'no_effect'
      && !(value.receipt.kind === 'superseded' && value.receipt.reason === 'source_changed'))) return false;
  if (value.plan && canonicalJson(value.plan.binding) !== canonicalJson(value.binding)) return false;
  if ((value.plan === null) !== (value.modelReservationId === null)
    || value.modelReservationId !== null && value.rootContext === null) return false;
  if (value.successorSchedule && (!value.plan || value.successorSchedule.binding.workId !== value.binding.workId
    || value.successorSchedule.binding.sourceRevision !== value.binding.sourceRevision
    || value.successorSchedule.binding.step !== value.binding.step + 1 || value.successorSchedule.binding.attempt !== 0)) return false;
  if (value.state === 'claimed' && (value.plan !== null || value.receipt !== null || value.resultText !== null || value.successorSchedule !== null)
    || value.state === 'reserved' && value.plan === null) return false;
  if (value.rootContext && (value.rootContext.binding.rootRunId !== value.runId
    || value.rootContext.binding.trigger.kind !== 'worker' || value.rootContext.binding.trigger.reference !== value.triggerReference)) return false;
  if (value.receipt && (value.receipt.workId !== value.binding.workId || value.receipt.sourceRevision !== value.binding.sourceRevision
    || value.receipt.attemptId !== value.id || value.receipt.kind === 'part_committed' && value.receipt.step !== value.binding.step)) return false;
  if (['claimed', 'reserved', 'unknown'].includes(value.state)
    && (value.receipt !== null || value.chainLink !== null || value.resultText !== null)) return false;
  if (value.state === 'committed' && (value.receipt === null || value.receipt.kind === 'no_effect')) return false;
  if (value.state === 'not_dispatched' ? value.receipt?.kind !== 'no_effect' || value.noDispatchReason !== value.receipt.stopReason
    : value.noDispatchReason !== null) return false;
  if (value.state === 'known_failed' || value.state === 'not_dispatched') {
    if (value.receipt?.kind !== 'no_effect' || value.chainLink !== null || value.resultText !== null
      || value.receipt.dispatchOutcome !== (value.state === 'known_failed' ? 'response_observed' : 'not_dispatched')) return false;
  }
  if (value.receipt?.kind === 'part_committed' || value.receipt?.kind === 'published') {
    if (!value.plan || !value.chainLink || value.contentState === 'present' && value.resultText === null) return false;
  }
  if (value.receipt?.kind === 'superseded' && (value.resultText !== null || value.chainLink !== null)) return false;
  if (value.chainLink && (value.state !== 'committed'
    || value.receipt?.kind !== 'part_committed' && value.receipt?.kind !== 'published')) return false;
  if (value.contentState === 'erased' ? value.resultText !== null || value.erasureIntentId === null : value.erasureIntentId !== null) return false;
  if (value.resultText !== null && (value.state !== 'committed' || value.plan === null || value.resultText.length > value.plan.outputTextLimit)) return false;
  return !value.chainLink || value.plan !== null && canonicalJson(value.chainLink.range) === canonicalJson(value.plan.range)
    && (value.contentState === 'erased' || value.resultText !== null && value.chainLink.outputHash === firestoreDomainHash(value.resultText));
});
export type PrivateSummaryAttempt = z.infer<typeof privateSummaryAttemptSchema>;
export const privateSummaryUsageSchema = z.object({ format: z.literal('private-summary-usage/v1'), workId: z.uuid(),
  grant: summaryWorkGrantSchema, grantRecordId: digest, used: z.object({ modelCalls: integer, toolCalls: integer }).strict(),
  revision: integer.min(1), unresolvedRetiredCount: integer }).strict().refine(value => value.grantRecordId === summaryGrantRecordId(value.workId, value.grant));
export type PrivateSummaryUsage = z.infer<typeof privateSummaryUsageSchema>;
export function summaryRetirementId(workId: string, attemptId: string): string {
  return firestoreDomainHash(['private-summary-source-retirement/v1', z.uuid().parse(workId), z.uuid().parse(attemptId)]);
}
export const summarySourceRetirementSchema = z.object({ format: z.literal('private-summary-source-retirement/v1'),
  id: digest, workId: z.uuid(), attemptId: z.uuid(), runId: z.uuid(), scope: workRecoveryScopeSchema,
  authorizationVersion: authorityVersion, workerGeneration: z.uuid(), sourceRevisionId: digest, manifestHash: digest,
  grantRecordId: digest, rootContextFingerprint: digest, stoppedRootHash: digest,
  frozenCounts: firestoreRootBudgetRecoverySchema.shape.used.extend({ queryEmbeddings: z.literal(0) }),
  modelReservationId: digest, toolReservationId: digest.nullable(), observedManifest: summaryManifestSchema,
  observedManifestHash: digest, policyVersion: policyIdentity, createdAt: time }).strict().refine(value =>
    value.id === summaryRetirementId(value.workId, value.attemptId)
    && value.observedManifestHash === summaryManifestHash(value.observedManifest));
export type SummarySourceRetirement = z.infer<typeof summarySourceRetirementSchema>;
const reservationBasis = { format: z.literal('private-summary-reservation/v1'), workId: z.uuid(), reservationId: digest,
  attemptId: z.uuid(), runId: z.uuid(), grantRevision: integer.min(1), grantRecordId: digest,
  originalAttemptKey: policyIdentity, requestFingerprint: digest };
export const privateSummaryReservationSchema = z.discriminatedUnion('kind', [
  z.object({ ...reservationBasis, kind: z.literal('model'), units: z.literal(1),
    originalDailyRequest: firestoreDailyUsageRequestSchema.extend({ kind: z.literal('model') }) }).strict(),
  z.object({ ...reservationBasis, kind: z.literal('tool'), units: integer.min(1) }).strict(),
]).refine(value => value.reservationId === summaryReservationId(value.workId, value.originalAttemptKey, value.kind)
  && (value.kind !== 'model' || value.originalDailyRequest.rootRunId === value.runId
    && value.originalDailyRequest.attemptKey === value.originalAttemptKey
    && value.originalDailyRequest.requestFingerprint === value.requestFingerprint));
export type PrivateSummaryUsageReservation = z.infer<typeof privateSummaryReservationSchema>;

export interface SummaryResolvedSource {
  source: SummarySourceUnit; sourceText: string; modelMetadata: Readonly<Record<string, unknown>>;
}
export interface SummaryCoverageProof {
  kind: 'fresh_watermark' | 'repair_replacement'; coveredMessageIds: string[];
  headVersion: number; lastCoveredSortKey: string | null; replacementSummaryId: string | null;
}
export type SummarySourceReason = 'source_missing' | 'source_changed' | 'dependency_changed' | 'dependency_expired'
  | 'dependency_suppressed' | 'incomplete_dependencies' | 'incomplete_dependencies_changed' | 'coverage_unverifiable'
  | 'source_authority_changed' | 'repair_unavailable';
export type SummarySourceDecision = { kind: 'eligible'; manifest: SummaryManifest; resolvedSources: SummaryResolvedSource[] }
  | { kind: 'already_covered'; proof: SummaryCoverageProof }
  | { kind: 'source_changed' | 'blocked'; reason: SummarySourceReason }
  | { kind: 'suppressed'; reason: SummarySourceReason; observation?: {
    target: import('./private-summary-scan.ts').PrivateSummarySuppressedTarget; sourceVersion: number; sourceBasis: string } }
  | { kind: 'no_work' };
export type SummaryFastTarget = { kind: 'fresh_prefix'; firstMessageId: string; messageCount: number }
  | { kind: 'repair_batch'; summaryId: string };
export const summaryFastBindingSchema = z.object({ format: z.literal('private-summary-fast/v1'),
  target: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('fresh_message'), messageId: z.uuid() }).strict(),
    z.object({ kind: z.literal('repair_batch'), repairOf: z.uuid() }).strict(),
  ]), lineageKey: digest, manifestHash: digest,
  candidate: z.object({ target: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('fresh_prefix'), firstMessageId: z.uuid(), messageCount: integer.min(1) }).strict(),
    z.object({ kind: z.literal('repair_batch'), summaryId: z.uuid() }).strict(),
  ]), sourceHash: digest }).strict(), rootContext: firestoreRootBudgetContextSchema.nullable(),
  selected: z.object({ sourceHash: digest, coveredMessageIds: completeIds }).strict().nullable(),
  noDispatch: z.object({ evidenceId: digest }).strict().nullable(), transferredToWorkId: z.uuid().nullable(),
}).strict().refine(value => {
  if (value.target.kind === 'fresh_message') {
    if (value.candidate.target.kind !== 'fresh_prefix' || value.candidate.target.firstMessageId !== value.target.messageId
      || value.selected && (value.selected.coveredMessageIds[0] !== value.target.messageId
        || value.selected.coveredMessageIds.length > value.candidate.target.messageCount)) return false;
  } else if (value.candidate.target.kind !== 'repair_batch' || value.candidate.target.summaryId !== value.target.repairOf) return false;
  return (!value.noDispatch || value.rootContext !== null && value.selected === null)
    && (!value.transferredToWorkId || value.noDispatch !== null);
});
export type SummaryFastBinding = z.infer<typeof summaryFastBindingSchema>;
export type SummaryFastSource = { kind: 'eligible'; input: import('../src/shared/memory.ts').SummaryInput;
  sourceHash: string; lineageKeys: string[] }
  | Exclude<SummarySourceDecision, { kind: 'eligible' }>;
export interface SummarySourceReader {
  readFastSource(binding: import('./firestore-authority.ts').FirestoreAuthorityTransaction,
    target: SummaryFastTarget): Promise<SummaryFastSource>;
  readSummaryLineageTargets(binding: import('./firestore-authority.ts').FirestoreAuthorityTransaction,
    target: { kind: 'next_fresh' } | { kind: 'repair_batch'; summaryId: string }):
    Promise<{ target: SummaryLineageTarget; lineageKey: string }[]>;
  selectSource(binding: import('./firestore-authority.ts').FirestoreAuthorityTransaction,
    target: { kind: 'next_fresh' } | { kind: 'repair_batch'; summaryId: string }): Promise<SummarySourceDecision>;
  revalidateSource(binding: import('./firestore-authority.ts').FirestoreAuthorityTransaction,
    revision: PrivateSummarySourceRevision): Promise<Exclude<SummarySourceDecision, { kind: 'no_work' }>>;
  rebuildSummarySource(binding: import('./firestore-authority.ts').FirestoreAuthorityTransaction,
    revision: PrivateSummarySourceRevision): Promise<Exclude<SummarySourceDecision, { kind: 'no_work' }>>;
}
