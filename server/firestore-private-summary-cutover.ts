import { z } from 'zod';
import type { FirestoreAuthorityTransaction as Binding } from './firestore-authority.ts';
import { FirestoreDomainData, FirestoreDomainError, firestoreDomainHash, domainParse, domainReject } from './firestore-domain-data.ts';
import { privateSummaryCutoverId, privateSummaryCutoverSchema, type PrivateSummaryCutover } from './private-summary-scan.ts';
import type { SummaryLegacyAdmission, SummaryFastAdmission } from './firestore-private-summary-work.ts';
import type { SummaryFastTarget } from './private-summary-work.ts';
import type { FirestoreAgentRuns } from './firestore-agent-runs.ts';
import type { FirestoreMemoryStore } from './firestore-memory.ts';
import type { SummaryInput } from '../src/shared/memory.ts';
import { readFirestoreBackgroundClaim } from './firestore-background-work.ts';

export type PrivateSummaryEntryGate = { kind: 'legacy' }
  | { kind: 'durable'; cutover: PrivateSummaryCutover }
  | { kind: 'blocked'; reason: 'activation_missing' | 'inventory' | 'blocked' | 'restore_suspended' | 'stale' | 'policy_missing' };

export const summaryFastPayloadHash = (value: SummaryInput) => firestoreDomainHash({ previousVersion: value.previousVersion,
  basis: value.basis, messages: value.messages, moreUncovered: value.moreUncovered,
  repairOf: value.repairOf ?? null, currentSources: value.currentSources ?? [] });

/** A missing policy never means an activated scope can return to the pre-cutover route. */
export async function readPrivateSummaryEntryGate(data: FirestoreDomainData, b: Binding,
  policyAvailable: boolean): Promise<PrivateSummaryEntryGate> {
  if (b.sharedAccess || b.actorUserId !== b.scope.ownerUserId) return { kind: 'blocked', reason: 'stale' };
  const id = privateSummaryCutoverId(b.scope);
  const row = await b.transaction.get(data.ref('private_summary_scans', 'private-summary-cutover', id));
  if (!row.exists) {
    // Cross-epoch retained evidence also forbids a new empty legacy account after a partial restore.
    const tags = data.tags(b.scope);
    for (const suffix of ['private_summary_works', 'private_summary_revisions', 'private_summary_attempts', 'private_summary_usage']) {
      const history = await b.transaction.get(data.collection(suffix).where('workspaceTag', '==', tags.workspaceTag)
        .where('userTag', '==', tags.userTag).where('childTag', '==', tags.childTag).limit(1));
      if (!history.empty) return { kind: 'blocked', reason: 'activation_missing' };
    }
    return { kind: 'legacy' };
  }
  const cutover = data.open('private-summary-cutover', id, b.scope, privateSummaryCutoverSchema, row);
  if (cutover.id !== id || firestoreDomainHash(cutover.scope) !== firestoreDomainHash(b.scope)
    || Object.entries(data.tags(b.scope)).some(([key, value]) => row.get(key) !== value)
    || row.get('recordVersion') !== cutover.version) domainReject('private_summary_cutover_projection', 500);
  if (cutover.phase === 'restore_suspended') return { kind: 'blocked', reason: 'restore_suspended' };
  if (cutover.authorizationVersion !== b.authorizationVersion || cutover.workerGeneration !== b.generation)
    return { kind: 'blocked', reason: 'stale' };
  if (cutover.phase !== 'complete') return { kind: 'blocked', reason: cutover.phase };
  if (!policyAvailable) return { kind: 'blocked', reason: 'policy_missing' };
  return { kind: 'durable', cutover };
}

/** The production composer pins this reader; an injected grant resolver cannot manufacture inventory proof. */
export async function readPrivateSummaryLegacyAdmission(data: FirestoreDomainData, b: Binding,
  input: { lineageKey: string; manifestHash: string }): Promise<SummaryLegacyAdmission> {
  const digest = z.string().regex(/^[a-f0-9]{64}$/u);
  domainParse(digest, input.lineageKey); domainParse(digest, input.manifestHash);
  const gate = await readPrivateSummaryEntryGate(data, b, true);
  if (gate.kind === 'legacy') return { kind: 'blocked', reason: 'missing' };
  if (gate.kind === 'blocked') return { kind: 'blocked', reason: gate.reason === 'stale' ? 'stale'
    : gate.reason === 'blocked' ? 'unmapped_legacy' : 'incomplete' };
  return { kind: 'admitted', barrierId: gate.cutover.id, barrierVersion: gate.cutover.version,
    scope: b.scope, authorizationVersion: b.authorizationVersion, workerGeneration: b.generation,
    ...input, inventoryHash: gate.cutover.inventoryHash };
}

/** Re-read the actual selected whole-message payload on every authorization, before any provider admission. */
export async function authorizePrivateSummaryFastEntry(data: FirestoreDomainData, b: Binding,
  services: { memory: FirestoreMemoryStore; runs: FirestoreAgentRuns; work: {
    readEntryGate(binding: Binding): Promise<PrivateSummaryEntryGate>;
    prepareFastAdmission(binding: Binding, input: { runId: string; reference: string; target: SummaryFastTarget; expectedSourceHash: string }): Promise<SummaryFastAdmission>;
  } },
  input: { runId: string; reference: string; selected: SummaryInput | null }): Promise<boolean> {
  const gate = await services.work.readEntryGate(b);
  if (gate.kind === 'blocked') return false;
  const lease = await readFirestoreBackgroundClaim(data, b, input.reference);
  if (!lease || lease.kind !== 'memory-refresh' || lease.resourceId !== b.scope.childId) return false;
  let run;
  try { run = await services.runs.requireLive(b, services.runs.current(b), input.runId); }
  catch (error) { if (error instanceof FirestoreDomainError && error.code === 'agent_scope_changed') return false; throw error; }
  if (run.recipeId !== 'memory-refresh' || run.trigger.kind !== 'worker' || run.trigger.reference !== input.reference || 'summaryWork' in run) return false;
  if (!input.selected) return true;
  const selected = input.selected;
  if (!selected.messages.length) return false;
  const target = selected.repairOf ? { kind: 'repair_batch' as const, summaryId: selected.repairOf }
    : { kind: 'fresh_prefix' as const, firstMessageId: selected.messages[0].id, messageCount: selected.messages.length };
  const source = await services.memory.readFastSource(b, target);
  if (source.kind !== 'eligible') return false;
  if (summaryFastPayloadHash(source.input) !== summaryFastPayloadHash(selected)) return false;
  if (gate.kind === 'legacy') return true;
  const admission = await services.work.prepareFastAdmission(b, { runId: input.runId, reference: input.reference,
    target, expectedSourceHash: source.sourceHash });
  if (admission.kind === 'blocked') return false;
  admission.commit(); return true;
}
