import { privateSummaryScanRestoreSchemas, isPrivateSummaryScanKind, assertPrivateSummaryScanRecord, privateSummaryCutoverSchema, privateSummaryCutoverId, privateSummaryInventoryGenesis } from './private-summary-scan.ts';
import { z } from 'zod';
import { canonical } from './firestore-session-codec.ts';
import { FirestoreDomainData, firestoreDomainHash } from './firestore-domain-data.ts';
import type { FirestoreRecoveryContext } from './firestore-recovery-envelope.ts';
import type { FirestoreRestoreDecoded, FirestoreRestoreTransform, FirestoreRestoreRecord } from './firestore-restore-codec.ts';
import { firestoreAgentRunSchema } from './firestore-agent-runs.ts';
import { agentBudgetFingerprint } from './agent-budget.ts';
import { validateSummaryAdvance } from './private-summary-fragments.ts';
import { privateSummaryWorkSchema, privateSummaryWorkProjection, summaryLineageRecordSchema, summarySourceRevisionSchema, privateSummaryAttemptSchema,
  privateSummaryUsageSchema, summaryGrantRecordSchema, privateSummaryReservationSchema, summaryLineageKey, summaryLineageKeyForTarget,
  summaryChainGenesis, summaryReservationId, type PrivateSummaryUsage, type SummaryFastBinding } from './private-summary-work.ts';

export const privateSummaryRestoreSchemas = {
  ...privateSummaryScanRestoreSchemas,
  'private-summary-work': { suffix: 'private_summary_works', schema: privateSummaryWorkSchema },
  'private-summary-lineage': { suffix: 'private_summary_works', schema: summaryLineageRecordSchema },
  'private-summary-revision': { suffix: 'private_summary_revisions', schema: summarySourceRevisionSchema },
  'private-summary-attempt': { suffix: 'private_summary_attempts', schema: privateSummaryAttemptSchema },
  'private-summary-usage': { suffix: 'private_summary_usage', schema: privateSummaryUsageSchema },
  'private-summary-grant': { suffix: 'private_summary_usage', schema: summaryGrantRecordSchema },
  'private-summary-reservation': { suffix: 'private_summary_usage', schema: privateSummaryReservationSchema },
} as const;
export type PrivateSummaryRestoreKind = keyof typeof privateSummaryRestoreSchemas;
export function isPrivateSummaryRestoreKind(kind: string): kind is PrivateSummaryRestoreKind {
  return Object.hasOwn(privateSummaryRestoreSchemas, kind);
}
export function isPrivateSummaryUsageKind(kind: string): boolean {
  return ['private-summary-usage', 'private-summary-grant', 'private-summary-reservation'].includes(kind);
}
function check(ok: unknown, code = 'restore_summary_binding'): asserts ok {
  if (!ok) throw Object.assign(new Error('Restore private summary rejected'), { code, status: 409 });
}
const same = (a: unknown, b: unknown) => a === undefined || b === undefined ? a === b : canonical(a) === canonical(b);
const NIL = '00000000-0000-0000-0000-000000000000';

/** Query projections are checked against the authenticated body, never used as evidence themselves. */
export function privateSummaryRestoreMetadata(data: FirestoreDomainData, context: FirestoreRecoveryContext,
  raw: unknown, original?: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const { kind, id, scope, recordVersion } = context;
  check(isPrivateSummaryRestoreKind(kind) && context.family === 'domain' && context.envelopeVersion === 1
    && scope.workspaceId !== NIL && scope.childId !== NIL && scope.storageEpoch !== NIL);
  let expectedVersion = 1, metadata: Record<string, unknown> = data.tags(scope);
  switch (kind) {
    case 'private-summary-work': {
      const value = privateSummaryWorkSchema.parse(raw);
      check(value.id === id && same(value.scope, scope) && value.lastRetirementId === null, 'restore_summary_unsupported_retirement');
      expectedVersion = value.version;
      metadata = { ...metadata, ...privateSummaryWorkProjection(value) }; break;
    }
    case 'private-summary-lineage': {
      const value = summaryLineageRecordSchema.parse(raw); check(value.id === id && same(value.scope, scope));
      expectedVersion = value.version; break;
    }
    case 'private-summary-revision': {
      const value = summarySourceRevisionSchema.parse(raw); check(value.id === id && same(value.scope, scope)); break;
    }
    case 'private-summary-attempt': {
      const value = privateSummaryAttemptSchema.parse(raw); check(value.id === id);
      check(value.retirementId === null, 'restore_summary_unsupported_retirement'); break;
    }
    case 'private-summary-usage': {
      const value = privateSummaryUsageSchema.parse(raw); check(value.workId === id);
      check(value.unresolvedRetiredCount === 0, 'restore_summary_unsupported_retirement'); expectedVersion = value.revision; break;
    }
    case 'private-summary-grant': {
      const value = summaryGrantRecordSchema.parse(raw); check(value.id === id);
      check(value.renewal === null, 'restore_summary_unsupported_renewal'); break;
    }
    case 'private-summary-reservation': check(privateSummaryReservationSchema.parse(raw).reservationId === id); break;
    default: {
      check(isPrivateSummaryScanKind(kind)); assertPrivateSummaryScanRecord(context, raw);
      expectedVersion = privateSummaryScanRestoreSchemas[kind].schema.parse(raw).version; break;
    }
  }
  check(recordVersion === expectedVersion);
  if (original) {
    const envelopeKeys = new Set(['format', 'version', 'recordVersion', 'ciphertext', 'recovery']);
    check(Object.keys(original).every(key => envelopeKeys.has(key) || Object.hasOwn(metadata, key)));
    check(Object.entries(metadata).every(([key, value]) => same(original[key], value)));
  }
  return metadata;
}

function rows<T>(records: readonly FirestoreRestoreDecoded[], kind: string, schema: z.ZodType<T>) {
  return records.filter(row => row.context.kind === kind).map(record => ({ record, value: schema.parse(record.value) }));
}
function index<T>(values: readonly T[], key: (value: T) => string): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) { const id = key(value); check(!result.has(id)); result.set(id, value); }
  return result;
}
function usageEvidence(records: readonly FirestoreRestoreDecoded[]) {
  const heads = index(rows(records, 'private-summary-usage', privateSummaryUsageSchema), row => row.value.workId);
  const grants = index(rows(records, 'private-summary-grant', summaryGrantRecordSchema), row => row.value.id);
  const reservations = index(rows(records, 'private-summary-reservation', privateSummaryReservationSchema), row => row.value.reservationId);
  for (const { record, value } of heads.values()) {
    check(value.unresolvedRetiredCount === 0, 'restore_summary_unsupported_retirement');
    const grant = grants.get(value.grantRecordId);
    check(grant && grant.value.workId === value.workId && same(grant.value.grant, value.grant)
      && sameScope(record, grant.record) && grant.value.renewal === null);
    const spent = { modelCalls: 0, toolCalls: 0 };
    for (const row of reservations.values()) if (row.value.workId === value.workId) {
      const pinned = grants.get(row.value.grantRecordId);
      check(pinned && pinned.value.workId === value.workId && pinned.value.grant.revision === row.value.grantRevision
        && sameScope(record, row.record) && sameScope(record, pinned.record));
      if (row.value.kind === 'model') {
        check(row.value.originalDailyRequest.userId === scopeOf(record).ownerUserId
          && row.value.originalDailyRequest.childId === scopeOf(record).childId
          && row.value.originalDailyRequest.model === pinned.value.grant.model);
        spent.modelCalls += row.value.units;
      } else spent.toolCalls += row.value.units;
    }
    check(same(value.used, spent), 'restore_summary_usage_evidence');
  }
  for (const row of reservations.values()) check(heads.has(row.value.workId), 'restore_summary_usage_missing');
  for (const row of grants.values()) check(heads.has(row.value.workId), 'restore_summary_usage_missing');
  return { heads, grants, reservations };
}
function scopeOf(record: FirestoreRestoreDecoded) { check(record.context.family !== 'knowledge'); return record.context.scope; }
function sameScope(a: FirestoreRestoreDecoded, b: FirestoreRestoreDecoded) { return same(scopeOf(a), scopeOf(b)); }

function mergeFastBinding(a: SummaryFastBinding, b: SummaryFastBinding): SummaryFastBinding {
  const identity = (value: SummaryFastBinding) => [value.format, value.target, value.lineageKey, value.manifestHash, value.candidate];
  check(same(identity(a), identity(b)), 'restore_summary_immutable_conflict');
  const keys = ['rootContext', 'selected', 'noDispatch', 'transferredToWorkId'] as const;
  for (const key of keys) check(a[key] === null || b[key] === null || same(a[key], b[key]), 'restore_summary_immutable_conflict');
  // A single original run progresses one way. Do not invent a state by joining incompatible partial histories.
  const includes = (left: SummaryFastBinding, right: SummaryFastBinding) => keys.every(key => right[key] === null || same(left[key], right[key]));
  check(includes(a, b) || includes(b, a), 'restore_summary_immutable_conflict');
  return includes(b, a) ? b : a;
}

/** Reservations consume permanently. Different original identities are added, never scalar-maxed. */
export function mergePrivateSummaryUsage(snapshot: readonly FirestoreRestoreDecoded[], live: readonly FirestoreRestoreDecoded[]): FirestoreRestoreDecoded[] {
  usageEvidence(snapshot); usageEvidence(live);
  const result = new Map<string, FirestoreRestoreDecoded>();
  for (const row of [...snapshot, ...live].filter(row => isPrivateSummaryUsageKind(row.context.kind))) {
    const key = row.context.kind + ':' + row.context.id, prior = result.get(key);
    if (!prior) { result.set(key, row); continue; }
    check(sameScope(prior, row));
    if (row.context.kind !== 'private-summary-usage') {
      check(same(prior.value, row.value), 'restore_summary_immutable_conflict'); continue;
    }
    const left = privateSummaryUsageSchema.parse(prior.value), right = privateSummaryUsageSchema.parse(row.value);
    check(left.grantRecordId === right.grantRecordId && same(left.grant, right.grant), 'restore_summary_unsupported_renewal');
    if (right.revision > left.revision) result.set(key, row);
  }
  for (const [key, record] of result) if (record.context.kind === 'private-summary-usage') {
    const value = privateSummaryUsageSchema.parse(record.value), used = { modelCalls: 0, toolCalls: 0 };
    for (const candidate of result.values()) if (candidate.context.kind === 'private-summary-reservation') {
      const reservation = privateSummaryReservationSchema.parse(candidate.value);
      if (reservation.workId !== value.workId) continue;
      if (reservation.kind === 'model') used.modelCalls += reservation.units; else used.toolCalls += reservation.units;
    }
    const changed = !same(value.used, used);
    const merged: PrivateSummaryUsage = privateSummaryUsageSchema.parse({ ...value, used, revision: value.revision + (changed ? 1 : 0) });
    check(record.context.family === 'domain');
    result.set(key, { ...record, context: { ...record.context, recordVersion: merged.revision }, value: merged });
  }
  const merged = [...result.values()]; usageEvidence(merged); return merged;
}

/** The complete bounded restore inventory is grouped by immutable revision, then each chain is walked once. */
export function assertPrivateSummaryRestoreRelations(records: readonly FirestoreRestoreDecoded[]): Set<string> {
  const works = index(rows(records, 'private-summary-work', privateSummaryWorkSchema), row => row.value.id);
  const revisions = index(rows(records, 'private-summary-revision', summarySourceRevisionSchema), row => row.value.id);
  const lineages = index(rows(records, 'private-summary-lineage', summaryLineageRecordSchema), row => row.value.id);
  const attempts = index(rows(records, 'private-summary-attempt', privateSummaryAttemptSchema), row => row.value.id);
  const runs = index(rows(records, 'agent-run', firestoreAgentRunSchema), row => row.value.id);
  const evidence = usageEvidence(records), verifiedRuns = new Set<string>();
  for (const { record, value } of works.values()) {
    const history = [...revisions.values()].filter(row => row.value.workId === value.id).sort((a, b) => a.value.sourceRevision - b.value.sourceRevision);
    check(history.length === value.sourceRevision && history.every((row, index) => row.value.sourceRevision === index + 1), 'restore_summary_revision_gap');
    const revision = revisions.get(value.sourceRevisionId), lineage = lineages.get(value.lineageKey), usage = evidence.heads.get(value.id);
    check(value.lastRetirementId === null, 'restore_summary_unsupported_retirement');
    check(revision && lineage && usage && sameScope(record, revision.record) && sameScope(record, lineage.record) && sameScope(record, usage.record)
      && revision.value.workId === value.id && revision.value.manifestHash === value.manifestHash
      && revision.value.authorizationVersion === value.authorizationVersion && revision.value.workerGeneration === value.workerGeneration
      && value.lineageKey === summaryLineageKey(value.scope, revision.value.manifest)
      && lineage.value.owner.kind === 'work' && lineage.value.owner.workId === value.id
      && lineage.value.authorizationVersion === value.authorizationVersion && lineage.value.workerGeneration === value.workerGeneration
      && usage.value.grantRecordId === value.grantRecordId && same(usage.value.grant, value.grant));
    if (value.activeAttemptId !== null) {
      const active = attempts.get(value.activeAttemptId);
      check(active && active.value.binding.workId === value.id && active.value.binding.sourceRevision === value.sourceRevision
        && active.value.binding.step === value.chain.committedParts && active.value.binding.attempt === value.nextAttempt
        && ['claimed', 'reserved', 'unknown'].includes(active.value.state));
    }
    if (value.finalReceipt) check(same(attempts.get(value.finalReceipt.attemptId)?.value.receipt, value.finalReceipt));
  }
  for (const { record, value } of attempts.values()) {
    const work = works.get(value.binding.workId), revision = revisions.get(value.sourceRevisionId), run = runs.get(value.runId), grant = evidence.grants.get(value.grantRecordId);
    check(value.retirementId === null, 'restore_summary_unsupported_retirement');
    check(work && revision && run && grant && sameScope(record, work.record) && sameScope(record, revision.record) && sameScope(record, run.record)
      && sameScope(record, grant.record) && revision.value.workId === value.binding.workId
      && revision.value.sourceRevision === value.binding.sourceRevision && grant.value.workId === value.binding.workId
      && run.value.summaryRetirementId === null && same(run.value.summaryWork, value.binding)
      && run.value.trigger.kind === 'worker' && run.value.trigger.reference === value.triggerReference && run.value.recipeId === 'memory-refresh'
      && run.value.authorizationVersion === revision.value.authorizationVersion && run.value.workerGeneration === revision.value.workerGeneration
      && same(run.value.summaryEffect ?? null, value.receipt)
      && (value.receipt !== null || ['running', 'unknown'].includes(run.value.state) && run.value.result === null));
    if (value.rootContext) {
      const root = value.rootContext.binding;
      check(root.ownerId === run.value.ownerUserId && root.workspaceId === run.value.workspaceId && root.childId === run.value.childId
        && root.storageEpoch === run.value.storageEpoch && root.authorizationVersion === run.value.authorizationVersion
        && root.promptPackVersion === grant.value.grant.promptPackVersion && root.billingVersion === grant.value.grant.billingVersion
        && root.deadlineAtMs <= Date.parse(run.value.expiresAt)
        && (grant.value.grant.workDeadlineAt === null || root.deadlineAtMs <= Date.parse(grant.value.grant.workDeadlineAt)));
    }
    if (value.modelReservationId !== null) {
      const reservation = evidence.reservations.get(value.modelReservationId)?.value;
      check(reservation && reservation.kind === 'model' && reservation.attemptId === value.id && reservation.runId === value.runId
        && reservation.workId === value.binding.workId && reservation.grantRecordId === value.grantRecordId
        && reservation.requestFingerprint === value.plan?.requestFingerprint && value.rootContext
        && reservation.originalDailyRequest.bindingFingerprint === agentBudgetFingerprint(value.rootContext)
        && reservation.originalDailyRequest.deadlineAtMs === value.rootContext.binding.deadlineAtMs);
      const tool = evidence.reservations.get(summaryReservationId(value.binding.workId, reservation.originalAttemptKey + ':tool-batch', 'tool'))?.value;
      if (tool) check(tool.kind === 'tool' && tool.attemptId === value.id && tool.runId === value.runId && tool.grantRecordId === value.grantRecordId);
    }
    if (value.plan) check(value.plan.manifestHash === revision.value.manifestHash);
    verifiedRuns.add(run.record.path);
  }
  for (const { record, value } of lineages.values()) {
    if (value.owner.kind === 'work') {
      const work = works.get(value.owner.workId);
      check(work && work.value.lineageKey === value.id && sameScope(record, work.record));
    } else {
      const run = runs.get(value.owner.runId);
      check(run && sameScope(record, run.record) && run.value.trigger.kind === 'worker'
        && run.value.trigger.reference === value.owner.triggerReference && run.value.recipeId === 'memory-refresh'
        && run.value.authorizationVersion === value.authorizationVersion && run.value.workerGeneration === value.workerGeneration);
      // A no-dispatch marker is dormant history here, not verified dispatch evidence or a new permission.
      check(value.owner.accounting.state !== 'transferred', 'restore_summary_unsupported_transfer');
      verifiedRuns.add(run.record.path);
    }
  }
  const transferredWorks = new Set<string>();
  for (const { record, value: run } of runs.values()) if (run.summaryFast) {
    const fast = run.summaryFast, pointer = lineages.get(fast.lineageKey), owned = [...lineages.values()]
      .filter(row => row.value.owner.kind === 'legacy_fast' && row.value.owner.runId === run.id);
    check(pointer && sameScope(record, pointer.record));
    const legacy = (version: number, covered: readonly string[], evidenceId?: string) => {
      check(pointer.value.version === version && pointer.value.owner.kind === 'legacy_fast'
        && pointer.value.owner.runId === run.id && pointer.value.owner.triggerReference === run.trigger.reference
        && same(pointer.value.owner.coveredMessageIds, covered)
        && (evidenceId === undefined ? pointer.value.owner.accounting.state === 'unresolved'
          : pointer.value.owner.accounting.state === 'no_dispatch' && pointer.value.owner.accounting.evidenceId === evidenceId));
    };
    if (fast.selected) {
      check(!fast.noDispatch && fast.transferredToWorkId === null);
      const ids = fast.selected.coveredMessageIds;
      const keys = fast.target.kind === 'fresh_message' ? ids.map(messageId => summaryLineageKeyForTarget(scopeOf(record), { kind: 'fresh_message', messageId }))
        : [fast.lineageKey];
      check(owned.length === keys.length && owned.every(row => keys.includes(row.value.id)));
      for (const key of keys) {
        const row = lineages.get(key); check(row && sameScope(record, row.record)
          && row.value.authorizationVersion === run.authorizationVersion && row.value.workerGeneration === run.workerGeneration
          && row.value.version === (key === fast.lineageKey ? 2 : 1) && row.value.owner.kind === 'legacy_fast'
          && row.value.owner.runId === run.id && row.value.owner.triggerReference === run.trigger.reference
          && row.value.owner.accounting.state === 'unresolved' && same(row.value.owner.coveredMessageIds, ids));
      }
    } else {
      const covered = fast.target.kind === 'fresh_message' ? [fast.target.messageId]
        : pointer.value.owner.kind === 'legacy_fast' ? pointer.value.owner.coveredMessageIds
          : [...revisions.values()].find(row => row.value.workId === fast.transferredToWorkId && row.value.sourceRevision === 1)?.value.manifest.coveredMessageIds;
      check(covered);
      if (fast.noDispatch) {
        check(run.result && run.state === 'stopped' && run.stopReason === 'input_limit' && run.result.status === 'stopped'
          && run.result.stopReason === 'input_limit' && run.result.countsKnown && same(run.result.counts, { modelCalls: 0, toolCalls: 0, queryEmbeddings: 0 })
          && run.result.provenance === null && run.result.text === '' && run.result.citations.length === 0 && run.result.proposals.length === 0
          && run.result.tools.length === 0 && run.result.retrievalMode === 'not_used' && (run.result.privateSourceCitations?.length ?? 0) === 0);
        if (fast.transferredToWorkId) {
          check(!transferredWorks.has(fast.transferredToWorkId)); transferredWorks.add(fast.transferredToWorkId);
          const work = works.get(fast.transferredToWorkId), usage = evidence.heads.get(fast.transferredToWorkId);
          check(usage && sameScope(record, usage.record));
          if (work) {
            const original = [...revisions.values()].find(row => row.value.workId === work.value.id && row.value.sourceRevision === 1);
            check(sameScope(record, work.record) && work.value.lineageKey === fast.lineageKey
              && work.value.authorizationVersion === run.authorizationVersion && work.value.workerGeneration === run.workerGeneration
              && original && original.value.manifestHash === fast.manifestHash && summaryLineageKey(scopeOf(record), original.value.manifest) === fast.lineageKey
              && pointer.value.version === 3 && pointer.value.owner.kind === 'work' && pointer.value.owner.workId === work.value.id && owned.length === 0);
          } else {
            // A prior restore may retain only the spent transfer marker and original accounting, never new work content.
            legacy(2, covered, fast.noDispatch.evidenceId); check(owned.length === 1);
          }
        } else { legacy(2, covered, fast.noDispatch.evidenceId); check(owned.length === 1); }
      } else { check(fast.transferredToWorkId === null); legacy(1, covered); check(owned.length === 1); }
    }
    verifiedRuns.add(record.path);
  }
  for (const { value } of evidence.reservations.values()) {
    const attempt = attempts.get(value.attemptId);
    if (!attempt) { check(!works.has(value.workId), 'restore_summary_attempt_missing'); continue; }
    check(attempt.value.binding.workId === value.workId && attempt.value.runId === value.runId && attempt.value.grantRecordId === value.grantRecordId);
    if (value.kind === 'model') check(attempt.value.modelReservationId === value.reservationId);
    else {
      const model = attempt.value.modelReservationId && evidence.reservations.get(attempt.value.modelReservationId)?.value;
      check(model && model.kind === 'model' && value.originalAttemptKey === model.originalAttemptKey + ':tool-batch');
    }
  }
  for (const { record, value: revision } of revisions.values()) {
    const work = works.get(revision.workId); check(work && sameScope(record, work.record)
      && revision.authorizationVersion === work.value.authorizationVersion && revision.workerGeneration === work.value.workerGeneration);
    const links = [...attempts.values()].filter(row => row.value.sourceRevisionId === revision.id && row.value.chainLink !== null)
      .sort((a, b) => a.value.binding.step - b.value.binding.step);
    let digest = summaryChainGenesis(revision.workId, revision.sourceRevision, revision.manifestHash);
    let cursor = { unitIndex: 0, offsetUtf16: 0 }, accumulatorHash: string | null = null;
    for (let step = 0; step < links.length; step++) {
      const attempt = links[step]!.value, link = attempt.chainLink!;
      check(attempt.binding.step === step && link.predecessor === digest && same(attempt.plan?.priorAccumulatorHash, accumulatorHash), 'restore_summary_chain');
      try { cursor = validateSummaryAdvance({ manifest: revision.manifest, prior: cursor, range: link.range }); }
      catch { check(false, 'restore_summary_chain'); }
      digest = firestoreDomainHash(['private-summary-chain-link/v1', digest, attempt.binding, attempt.runId, link.range, link.outputHash, cursor]);
      check(link.next === digest && (attempt.receipt?.kind === 'part_committed'
        ? same(attempt.receipt.next, cursor) && cursor.unitIndex < revision.manifest.units.length
        : attempt.receipt?.kind === 'published' && cursor.unitIndex === revision.manifest.units.length
          && same(attempt.receipt.coveredMessageIds, revision.manifest.coveredMessageIds) && attempt.receipt.repairOf === revision.manifest.repairOf), 'restore_summary_chain');
      accumulatorHash = link.outputHash;
    }
    if (work.value.sourceRevisionId === revision.id) check(same(work.value.chain, {
      committedParts: links.length, next: cursor, accumulatorHash, digest }), 'restore_summary_chain');
  }
  for (const run of runs.values()) if (run.value.summaryWork) check(verifiedRuns.has(run.record.path), 'restore_summary_run_missing');
  return verifiedRuns;
}

/** Preserve the original authority binding as historical protocol evidence. No resume or permit is emitted. */
export function transformPrivateSummaryRestore(data: FirestoreDomainData, record: FirestoreRestoreDecoded): FirestoreRestoreRecord {
  const context = record.context; check(context.family === 'domain' && isPrivateSummaryRestoreKind(context.kind));
  const schema: z.ZodType<unknown> = privateSummaryRestoreSchemas[context.kind].schema;
  let value: unknown = schema.parse(record.value), version = context.recordVersion!;
  if (context.kind === 'private-summary-work') {
    const work = privateSummaryWorkSchema.parse(value);
    if (work.state !== 'completed') {
      check(work.version < 2147483647, 'restore_version_exhausted');
      value = privateSummaryWorkSchema.parse({ ...work, state: 'restore_suspended', version: work.version + 1 });
      version = work.version + 1;
    }
  } else if (context.kind === 'private-summary-attempt') {
    const attempt = privateSummaryAttemptSchema.parse(value);
    if (attempt.state === 'claimed' || attempt.state === 'reserved') value = privateSummaryAttemptSchema.parse({ ...attempt, state: 'unknown' });
  }
  const metadata = privateSummaryRestoreMetadata(data, { ...context, recordVersion: version }, value);
  return { oldPath: record.path, path: record.path, data: { ...metadata,
    ...data.seal(context.kind, context.id, context.scope, schema, value, version) } };
}

function copy(record: FirestoreRestoreDecoded): FirestoreRestoreDecoded {
  return { ...record, context: { ...record.context }, value: structuredClone(record.value) };
}
/** Snapshot content is not rolled forward, except the complete protocol history of an already retained work. */
export function reconcilePrivateSummaryRestore(snapshot: FirestoreRestoreDecoded[], live: readonly FirestoreRestoreDecoded[]): void {
  assertPrivateSummaryRestoreRelations(snapshot); assertPrivateSummaryRestoreRelations(live);
  const workIds = new Set(rows(snapshot, 'private-summary-work', privateSummaryWorkSchema).map(row => row.value.id));
  const snapshotRuns = index(rows(snapshot, 'agent-run', firestoreAgentRunSchema), row => row.value.id);
  const liveRuns = index(rows(live, 'agent-run', firestoreAgentRunSchema), row => row.value.id);
  const retainedFastRunIds = new Set([...snapshotRuns.values()].filter(row => row.value.summaryFast).map(row => row.value.id));
  const fastFor = (runId: string) => {
    const a = snapshotRuns.get(runId)?.value.summaryFast, b = liveRuns.get(runId)?.value.summaryFast;
    return a && b ? mergeFastBinding(a, b) : a ?? b;
  };
  const result = new Map(snapshot.filter(row => !isPrivateSummaryUsageKind(row.context.kind)).map(row => [row.path, row]));
  for (const row of live) {
    const kind = row.context.kind;
    const retained = kind === 'private-summary-work' ? workIds.has(privateSummaryWorkSchema.parse(row.value).id)
      : kind === 'private-summary-revision' ? workIds.has(summarySourceRevisionSchema.parse(row.value).workId)
      : kind === 'private-summary-attempt' ? workIds.has(privateSummaryAttemptSchema.parse(row.value).binding.workId)
      : kind === 'private-summary-lineage' ? (() => { const v = summaryLineageRecordSchema.parse(row.value); return result.has(row.path)
        || v.owner.kind === 'work' && workIds.has(v.owner.workId) || v.owner.kind === 'legacy_fast' && retainedFastRunIds.has(v.owner.runId); })()
      : kind === 'agent-run' ? (() => { const v = firestoreAgentRunSchema.parse(row.value); return !!v.summaryWork && workIds.has(v.summaryWork.workId)
        || !!v.summaryFast && (retainedFastRunIds.has(v.id) || workIds.has(v.summaryFast.transferredToWorkId ?? '')); })() : false;
    if (!retained) continue;
    const prior = result.get(row.path);
    if (!prior) { result.set(row.path, copy(row)); continue; }
    check(sameScope(prior, row), 'restore_summary_immutable_conflict');
    if (same(prior.value, row.value)) continue;
    if (kind === 'private-summary-work') {
      const a = privateSummaryWorkSchema.parse(prior.value), b = privateSummaryWorkSchema.parse(row.value);
      check(same([a.id, a.scope, a.lineageKey, a.authorizationVersion, a.workerGeneration, a.grantRecordId, a.grant],
        [b.id, b.scope, b.lineageKey, b.authorizationVersion, b.workerGeneration, b.grantRecordId, b.grant])
        && a.version !== b.version, 'restore_summary_immutable_conflict');
      const newer = a.version > b.version ? prior : row, older = a.version > b.version ? b : a;
      check(privateSummaryWorkSchema.parse(newer.value).sourceRevision >= older.sourceRevision, 'restore_summary_immutable_conflict');
      result.set(row.path, copy(newer));
    } else if (kind === 'private-summary-attempt') {
      const a = privateSummaryAttemptSchema.parse(prior.value), b = privateSummaryAttemptSchema.parse(row.value);
      check(same([a.id, a.binding, a.runId, a.triggerReference, a.sourceRevisionId, a.grantRecordId],
        [b.id, b.binding, b.runId, b.triggerReference, b.sourceRevisionId, b.grantRecordId]), 'restore_summary_immutable_conflict');
      for (const key of ['plan', 'rootContext', 'modelReservationId', 'successorSchedule', 'receipt', 'chainLink', 'erasureIntentId', 'noDispatchReason'] as const)
        check(a[key] === null || b[key] === null || same(a[key], b[key]), 'restore_summary_immutable_conflict');
      const terminal = a.receipt ? a : b.receipt ? b : null;
      if (terminal) for (const key of ['plan', 'modelReservationId', 'successorSchedule'] as const)
        check(terminal[key] !== null || a[key] === null && b[key] === null, 'restore_summary_immutable_conflict');
      const erased = a.contentState === 'erased' ? a : b.contentState === 'erased' ? b : null;
      const base = terminal ?? (a.plan ? a : b);
      const merged = privateSummaryAttemptSchema.parse({ ...base, rootContext: a.rootContext ?? b.rootContext,
        state: terminal?.state ?? (a.state === 'unknown' || b.state === 'unknown' ? 'unknown' : base.plan ? 'reserved' : 'claimed'),
        ...(erased ? { contentState: 'erased', erasureIntentId: erased.erasureIntentId, resultText: null } : {}) });
      result.set(row.path, { ...copy(row), value: merged });
    } else if (kind === 'private-summary-lineage') {
      const a = summaryLineageRecordSchema.parse(prior.value), b = summaryLineageRecordSchema.parse(row.value);
      check(same([a.id, a.scope, a.authorizationVersion, a.workerGeneration], [b.id, b.scope, b.authorizationVersion, b.workerGeneration])
        && a.version !== b.version, 'restore_summary_immutable_conflict');
      const older = a.version < b.version ? a : b, newer = a.version < b.version ? b : a;
      check(older.owner.kind === 'legacy_fast', 'restore_summary_immutable_conflict');
      const fast = fastFor(older.owner.runId); check(fast && fast.lineageKey === a.id, 'restore_summary_immutable_conflict');
      if (newer.owner.kind === 'legacy_fast') {
        check(newer.owner.runId === older.owner.runId && newer.owner.triggerReference === older.owner.triggerReference
          && older.version === 1 && newer.version === 2 && older.owner.accounting.state === 'unresolved', 'restore_summary_immutable_conflict');
        if (newer.owner.accounting.state === 'unresolved') check(fast.selected
          && same(newer.owner.coveredMessageIds, fast.selected.coveredMessageIds)
          && same(older.owner.coveredMessageIds, fast.target.kind === 'fresh_message' ? [fast.target.messageId] : fast.selected.coveredMessageIds), 'restore_summary_immutable_conflict');
        else check(newer.owner.accounting.state === 'no_dispatch' && fast.noDispatch && !fast.selected
          && newer.owner.accounting.evidenceId === fast.noDispatch.evidenceId
          && same(older.owner.coveredMessageIds, newer.owner.coveredMessageIds), 'restore_summary_immutable_conflict');
      } else {
        check(fast.noDispatch && fast.transferredToWorkId === newer.owner.workId && !fast.selected && newer.version === 3
          && (older.version === 2 && older.owner.accounting.state === 'no_dispatch' && older.owner.accounting.evidenceId === fast.noDispatch.evidenceId
            || older.version === 1 && older.owner.accounting.state === 'unresolved'), 'restore_summary_immutable_conflict');
        if (!workIds.has(newer.owner.workId)) {
          // Both source inventories were fully verified above. Keep the historical pointer without reviving a post-snapshot work body.
          check(a.owner.kind === 'legacy_fast' && a.owner.accounting.state === 'no_dispatch' && a.version === 2,
            'restore_summary_immutable_conflict');
          result.set(row.path, copy(prior)); continue;
        }
      }
      result.set(row.path, copy(a.version > b.version ? prior : row));
    } else if (kind === 'agent-run') {
      const a = firestoreAgentRunSchema.parse(prior.value), b = firestoreAgentRunSchema.parse(row.value);
      const identity = (value: typeof a) => ({ ...value, state: null, stopReason: null, result: null, summaryEffect: null, summaryFast: null });
      check(same(identity(a), identity(b)) && !!a.summaryFast === !!b.summaryFast
        && (!a.summaryEffect || !b.summaryEffect || same(a.summaryEffect, b.summaryEffect)), 'restore_summary_immutable_conflict');
      const fast = a.summaryFast && b.summaryFast ? mergeFastBinding(a.summaryFast, b.summaryFast) : null;
      const attemptId = rows([...snapshot, ...live], 'private-summary-attempt', privateSummaryAttemptSchema)
        .find(attempt => attempt.value.runId === a.id && attempt.value.contentState === 'erased')?.value.id;
      const redacted = (value: typeof a) => ({ ...value.result, text: '', citations: [], proposals: [],
        ...(value.result?.privateSourceCitations === undefined ? {} : { privateSourceCitations: [] }),
        tools: value.result?.tools.map(({ name, status }) => ({ name, status })) });
      if (a.result && b.result) check(same(attemptId ? redacted(a) : a.result, attemptId ? redacted(b) : b.result), 'restore_summary_immutable_conflict');
      const advanced = fast && !same(a.summaryFast, b.summaryFast) ? same(fast, b.summaryFast) ? b : a : null;
      const selected = advanced ?? (a.summaryEffect ? a : b.summaryEffect ? b : a.result && !b.result ? a : b.state === 'unknown' ? b : a.state === 'unknown' ? a : b);
      const value = firestoreAgentRunSchema.parse({ ...selected, ...(fast ? { summaryFast: fast } : {}),
        ...(attemptId && selected.result ? { result: redacted(selected) } : {}) });
      result.set(row.path, { ...copy(row), value });
    } else check(same(prior.value, row.value), 'restore_summary_immutable_conflict');
  }
  for (const row of mergePrivateSummaryUsage(snapshot, live)) result.set(row.path, copy(row));
  snapshot.splice(0, snapshot.length, ...result.values());
  assertPrivateSummaryRestoreRelations(snapshot);
}

/** A current-scope deny gate covers retained domain history and accounting-only work alike. */
export function privateSummaryRestoreGuards(data: FirestoreDomainData, records: readonly FirestoreRestoreDecoded[],
  input: FirestoreRestoreTransform & { restoreId: string }, erased: (scope: import('./firestore-work-continuation-recovery.ts').WorkRecoveryScope) => boolean) {
  const scopes = new Map<string, import('./firestore-work-continuation-recovery.ts').WorkRecoveryScope>();
  for (const record of records) if (isPrivateSummaryRestoreKind(record.context.kind)) {
    const original = scopeOf(record), epoch = input.newEpochByWorkspace.get(original.workspaceId);
    if (!epoch || erased(original)) continue;
    const scope = { ...original, storageEpoch: epoch };
    scopes.set(privateSummaryCutoverId(scope), scope);
  }
  return [...scopes].map(([id, scope]) => {
    const authorizationVersion = input.newAuthorizationVersionByWorkspace?.get(scope.workspaceId); check(authorizationVersion);
    const value = privateSummaryCutoverSchema.parse({ format: 'private-summary-cutover/v1', id, scope, authorizationVersion,
      workerGeneration: input.generation, version: 1, inventoryVersion: 1, phase: 'restore_suspended', entryFenceVersion: 'private-summary-entry/v1',
      upperCaptured: false, upperRunDocumentId: null, afterRunDocumentId: null, inspectedRuns: 0, unresolvedMappedRuns: 0, unmappedRuns: 0,
      inventoryHash: privateSummaryInventoryGenesis(scope, authorizationVersion, input.generation, 1), exhausted: false, restoreId: input.restoreId });
    return { path: data.ref('private_summary_scans', 'private-summary-cutover', id).path,
      data: { ...data.tags(scope), ...data.seal('private-summary-cutover', id, scope, privateSummaryCutoverSchema, value, value.version) } };
  });
}
