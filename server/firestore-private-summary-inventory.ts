import { z } from 'zod';
import type { DocumentSnapshot } from '@google-cloud/firestore';
import type { FirestoreAuthorityTransaction as Binding } from './firestore-authority.ts';
import { FirestoreDomainData, domainParse, domainReject, firestoreDomainHash, type FirestoreDomainOptions } from './firestore-domain-data.ts';
import { openRecoveryEnvelope } from './firestore-recovery-envelope.ts';
import { firestoreAgentRunSchema, firestoreAgentClaimSchema, type FirestoreAgentRun } from './firestore-agent-runs.ts';
import { privateSummaryCutoverId, privateSummaryCutoverSchema, privateSummaryInventoryGenesis, type PrivateSummaryCutover } from './private-summary-scan.ts';
import { summaryLineageKeyForTarget, summaryLineageRecordSchema } from './private-summary-work.ts';
import type { WorkRecoveryScope } from './firestore-work-continuation-recovery.ts';

/** Trusted constructor-only adapter, never request input. Implementations MUST read the actual
 * deployment/dispatch authority in this same transaction, proving older binaries and worker
 * generations cannot dispatch. A pause flag, caller assertion or arbitrary digest is NOT proof.
 * Durable authority must also prove continuous fencing, since before upper capture, of every
 * entry able to add or rewrite the inventoried legacy runs/source mappings. Any interruption,
 * unverifiable continuity or same-generation restart must return null, never resume old cursors.
 * This contract is not deployment evidence. No production implementation currently exists.
 * Absence is blocked, including an empty scope. */
export type SummaryInventoryFenceReader = (binding: Binding) => Promise<{
  scope: WorkRecoveryScope; authorizationVersion: string; workerGeneration: string;
  entryFenceVersion: 'private-summary-entry/v1';
} | null>;
export type SummaryInventoryResult = { kind: 'advanced'; cutover: PrivateSummaryCutover }
  | { kind: 'blocked'; reason: 'entry_fence' | 'stale' | 'restore_suspended' };
const same = (a: unknown, b: unknown) => firestoreDomainHash(a) === firestoreDomainHash(b);
const fail = (): never => domainReject('private_summary_inventory_binding', 500);

/** Dormant, conservative inventory only. This cannot cut over arbitrary historical runs:
 * missing original identities remain unmapped. It never grants budget, promotes coverage or
 * no-dispatch, rewrites an epoch, or overwrites existing lineage/accounting. */
export function createFirestorePrivateSummaryInventory(options: FirestoreDomainOptions & {
  readEntryFence?: SummaryInventoryFenceReader; pageSize?: number;
}) {
  const data = new FirestoreDomainData(options), pageSize = domainParse(z.number().int().min(1).max(4), options.pageSize ?? 4);
  const readFence = options.readEntryFence;
  function requirePrivate(b: Binding) {
    if (b.sharedAccess || b.actorUserId !== b.scope.ownerUserId) domainReject('private_summary_scope_changed');
  }
  async function read(b: Binding): Promise<PrivateSummaryCutover | null> {
    requirePrivate(b);
    const id = privateSummaryCutoverId(b.scope), row = await b.transaction.get(data.ref('private_summary_scans', 'private-summary-cutover', id));
    if (!row.exists) return null;
    const value = data.open('private-summary-cutover', id, b.scope, privateSummaryCutoverSchema, row);
    if (value.id !== id || !same(value.scope, b.scope) || row.get('recordVersion') !== value.version
      || Object.entries(data.tags(b.scope)).some(([key, tag]) => row.get(key) !== tag)) fail();
    return value;
  }
  function query(b: Binding) {
    const tags = data.tags(b.scope);
    // Intentionally no epoch filter: retained old-epoch summary runs cannot disappear.
    return data.collection('agent_runs').where('workspaceTag', '==', tags.workspaceTag)
      .where('userTag', '==', tags.userTag).where('childTag', '==', tags.childTag);
  }
  function decode(b: Binding, row: DocumentSnapshot): FirestoreAgentRun {
    if (!/^[a-f0-9]{64}$/u.test(row.id) || row.get('format') !== 'yuban-firestore-domain' || row.get('version') !== 1
      || row.get('recordVersion') !== 1) fail();
    const { context, value } = openRecoveryEnvelope({ ...options, envelope: { family: 'domain', version: 1,
      recordVersion: row.get('recordVersion'), ciphertext: row.get('ciphertext') }, locator: row.get('recovery') });
    const run = domainParse(firestoreAgentRunSchema, value, 'private_summary_inventory_binding', 500);
    const scope = { ownerUserId: run.ownerUserId, workspaceId: run.workspaceId, childId: run.childId, storageEpoch: run.storageEpoch };
    if (context.kind !== 'agent-run' || context.id !== run.id || context.recordVersion !== 1 || !same(context.scope, scope)
      || run.ownerUserId !== b.scope.ownerUserId || run.workspaceId !== b.scope.workspaceId || run.childId !== b.scope.childId
      || row.id !== data.ref('agent_runs', 'agent-run', run.id).id
      || Object.entries(data.tags(scope)).some(([key, tag]) => row.get(key) !== tag)
      || row.get('runId') !== run.id || row.get('createdAt') !== run.createdAt || row.get('triggerKind') !== run.trigger.kind
      || !run.dataVersion.startsWith(run.storageEpoch + ':') || run.result && run.result.runId !== run.id
      || (run.trigger.kind === 'interactive' ? run.sourceMessageId !== run.trigger.reference : run.sourceMessageId !== null)) fail();
    return run;
  }
  async function classify(b: Binding, run: FirestoreAgentRun) {
    if (run.recipeId !== 'memory-refresh') return { kind: 'non_summary', evidence: null };
    const fast = run.summaryFast;
    const unmapped = { kind: 'unmapped', evidence: null };
    if (run.storageEpoch !== b.scope.storageEpoch || run.authorizationVersion !== b.authorizationVersion || run.workerGeneration !== b.generation
      || !fast?.selected || fast.noDispatch || fast.transferredToWorkId) return unmapped;
    const claimId = JSON.stringify([run.ownerUserId, run.childId, run.trigger.kind, run.trigger.reference]);
    const claimRow = await b.transaction.get(data.ref('agent_claims', 'agent-claim', claimId));
    if (!claimRow.exists) return unmapped;
    const claim = data.open('agent-claim', claimId, b.scope, firestoreAgentClaimSchema, claimRow);
    if (claimRow.get('recordVersion') !== 1 || claim.runId !== run.id
      || Object.entries(data.tags(b.scope)).some(([key, tag]) => claimRow.get(key) !== tag)) return unmapped;
    const ids = fast.selected.coveredMessageIds;
    const keys = fast.target.kind === 'fresh_message'
      ? ids.map(messageId => summaryLineageKeyForTarget(b.scope, { kind: 'fresh_message', messageId })) : [fast.lineageKey];
    const pointers = [];
    // Every selected source must retain its complete ORIGINAL owner. Never reconstruct missing IDs.
    for (const key of keys) {
      const row = await b.transaction.get(data.ref('private_summary_works', 'private-summary-lineage', key));
      if (!row.exists) return unmapped;
      const pointer = data.open('private-summary-lineage', key, b.scope, summaryLineageRecordSchema, row);
      if (pointer.id !== key || !same(pointer.scope, b.scope) || pointer.authorizationVersion !== run.authorizationVersion
        || pointer.workerGeneration !== run.workerGeneration || pointer.version !== (key === fast.lineageKey ? 2 : 1)
        || row.get('recordVersion') !== pointer.version || Object.entries(data.tags(b.scope)).some(([k, tag]) => row.get(k) !== tag)
        || pointer.owner.kind !== 'legacy_fast' || pointer.owner.runId !== run.id || pointer.owner.triggerReference !== run.trigger.reference
        || pointer.owner.accounting.state !== 'unresolved' || !same(pointer.owner.coveredMessageIds, ids)) return unmapped;
      pointers.push(pointer);
    }
    return { kind: 'mapped_unresolved', evidence: firestoreDomainHash({ claim, pointers }) };
  }
  async function advance(b: Binding): Promise<SummaryInventoryResult> {
    requirePrivate(b);
    // This port is deliberately absent in production. There is no installed:true shortcut.
    const fence = await readFence?.(b);
    if (!fence || fence.entryFenceVersion !== 'private-summary-entry/v1' || !same(fence.scope, b.scope)
      || fence.authorizationVersion !== b.authorizationVersion || fence.workerGeneration !== b.generation)
      return { kind: 'blocked', reason: 'entry_fence' };
    const original = await read(b);
    if (original?.phase === 'restore_suspended') return { kind: 'blocked', reason: 'restore_suspended' };
    if (original && (original.authorizationVersion !== b.authorizationVersion || original.workerGeneration !== b.generation))
      return { kind: 'blocked', reason: 'stale' };
    if (original?.exhausted) return { kind: 'advanced', cutover: original };
    const base: PrivateSummaryCutover = original ?? privateSummaryCutoverSchema.parse({ format: 'private-summary-cutover/v1',
      id: privateSummaryCutoverId(b.scope), scope: b.scope, authorizationVersion: b.authorizationVersion, workerGeneration: b.generation,
      version: 1, inventoryVersion: 1, phase: 'inventory', entryFenceVersion: 'private-summary-entry/v1', upperCaptured: false,
      upperRunDocumentId: null, afterRunDocumentId: null, inspectedRuns: 0, unresolvedMappedRuns: 0, unmappedRuns: 0,
      inventoryHash: privateSummaryInventoryGenesis(b.scope, b.authorizationVersion, b.generation, 1), exhausted: false, restoreId: null });
    let upper = base.upperRunDocumentId;
    if (!base.upperCaptured) {
      const head = await b.transaction.get(query(b).orderBy('__name__', 'desc').limit(1));
      upper = head.empty ? null : head.docs[0]!.id;
    }
    const entries: { documentId: string; runId: string; identity: string; kind: string; evidence: string | null }[] = [];
    let after = base.afterRunDocumentId, unresolved = base.unresolvedMappedRuns, unmapped = base.unmappedRuns, exhausted = upper === null;
    if (upper !== null) {
      let pageQuery = query(b).where('__name__', '<=', upper).orderBy('__name__', 'asc').limit(pageSize);
      if (after !== null) pageQuery = pageQuery.startAfter(after);
      const page = await b.transaction.get(pageQuery);
      for (const row of page.docs) {
        if (after !== null && row.id <= after || row.id > upper) fail();
        const run = decode(b, row), decision = await classify(b, run);
        entries.push({ documentId: row.id, runId: run.id, identity: firestoreDomainHash(run), ...decision });
        if (decision.kind === 'mapped_unresolved') unresolved++;
        if (decision.kind === 'unmapped') unmapped++;
        after = row.id;
      }
      exhausted = page.size < pageSize || after === upper;
    }
    const next = privateSummaryCutoverSchema.parse({ ...base, version: base.version + (original ? 1 : 0), upperCaptured: true,
      upperRunDocumentId: upper, afterRunDocumentId: after, inspectedRuns: base.inspectedRuns + entries.length,
      unresolvedMappedRuns: unresolved, unmappedRuns: unmapped, exhausted,
      phase: exhausted ? unmapped === 0 ? 'complete' : 'blocked' : 'inventory',
      inventoryHash: firestoreDomainHash(['private-summary-inventory-page/v1', base.inventoryHash, upper, base.afterRunDocumentId, after, entries]) });
    // All reads finish before this single atomic cursor/count/hash commit. Existing pointers stay unchanged.
    b.transaction.set(data.ref('private_summary_scans', 'private-summary-cutover', next.id),
      { ...data.tags(b.scope), ...data.seal('private-summary-cutover', next.id, b.scope, privateSummaryCutoverSchema, next, next.version) });
    return { kind: 'advanced', cutover: next };
  }
  return { advance, read };
}
