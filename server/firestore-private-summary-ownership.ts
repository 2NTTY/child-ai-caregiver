import { FirestoreDomainData, firestoreDomainHash } from './firestore-domain-data.ts';
import type { FirestoreAuthorityTransaction as Binding } from './firestore-authority.ts';
import { firestoreAgentClaimSchema, firestoreAgentRunSchema } from './firestore-agent-runs.ts';
import { summaryLineageKeyForTarget, summaryLineageRecordSchema } from './private-summary-work.ts';
import { readPrivateSummaryEntryGate } from './firestore-private-summary-cutover.ts';

/** Scheduling-only handoff from a global unknown barrier to already durable per-source
 * ownership. This does not settle, refund, transfer or permit another dispatch on the run. */
export async function readSummaryFastOwnedUnknown(data: FirestoreDomainData, b: Binding, reference: string): Promise<boolean> {
  if ((await readPrivateSummaryEntryGate(data, b, true)).kind !== 'durable') return false;
  const tags = data.tags(b.scope), matches = (row: { get(key: string): unknown }) =>
    Object.entries(tags).every(([key, value]) => row.get(key) === value);
  const key = JSON.stringify([b.scope.ownerUserId, b.scope.childId, 'worker', reference]);
  const claimRow = await b.transaction.get(data.ref('agent_claims', 'agent-claim', key));
  if (!claimRow.exists || !matches(claimRow) || claimRow.get('recordVersion') !== 1) return false;
  const claim = data.open('agent-claim', key, b.scope, firestoreAgentClaimSchema, claimRow);
  const row = await b.transaction.get(data.ref('agent_runs', 'agent-run', claim.runId));
  if (!row.exists || !matches(row) || row.get('recordVersion') !== 1) return false;
  const run = data.open('agent-run', claim.runId, b.scope, firestoreAgentRunSchema, row), fast = run.summaryFast;
  if (!fast?.selected || !fast.rootContext || fast.noDispatch || fast.transferredToWorkId
    || !['stopped', 'unknown'].includes(run.state) || !['unavailable', 'deadline', 'cancelled', 'interrupted'].includes(run.stopReason ?? '')
    || run.id !== claim.runId || row.get('runId') !== run.id || row.get('createdAt') !== run.createdAt || row.get('triggerKind') !== 'worker'
    || run.ownerUserId !== b.scope.ownerUserId || run.workspaceId !== b.scope.workspaceId
    || run.childId !== b.scope.childId || run.storageEpoch !== b.scope.storageEpoch || !run.dataVersion.startsWith(b.scope.storageEpoch + ':')
    || run.authorizationVersion !== b.authorizationVersion || run.workerGeneration !== b.generation
    || run.trigger.kind !== 'worker' || run.trigger.reference !== reference || run.recipeId !== 'memory-refresh') return false;
  const ids = fast.selected.coveredMessageIds;
  const keys = fast.target.kind === 'fresh_message'
    ? ids.map(messageId => summaryLineageKeyForTarget(b.scope, { kind: 'fresh_message', messageId })) : [fast.lineageKey];
  if (keys[0] !== fast.lineageKey || new Set(keys).size !== keys.length) return false;
  for (const id of keys) {
    const pointerRow = await b.transaction.get(data.ref('private_summary_works', 'private-summary-lineage', id));
    if (!pointerRow.exists || !matches(pointerRow)) return false;
    const pointer = data.open('private-summary-lineage', id, b.scope, summaryLineageRecordSchema, pointerRow);
    if (pointer.id !== id || pointer.version !== (id === fast.lineageKey ? 2 : 1) || pointerRow.get('recordVersion') !== pointer.version
      || firestoreDomainHash(pointer.scope) !== firestoreDomainHash(b.scope) || pointer.authorizationVersion !== b.authorizationVersion
      || pointer.workerGeneration !== b.generation || pointer.owner.kind !== 'legacy_fast' || pointer.owner.runId !== run.id
      || pointer.owner.triggerReference !== reference || pointer.owner.accounting.state !== 'unresolved'
      || firestoreDomainHash(pointer.owner.coveredMessageIds) !== firestoreDomainHash(ids)) return false;
  }
  return true;
}
