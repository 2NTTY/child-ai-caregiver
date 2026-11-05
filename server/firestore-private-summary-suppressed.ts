import type { FirestoreAuthorityTransaction as Binding } from './firestore-authority.ts';
import { FirestoreDomainData, domainReject, firestoreDomainHash } from './firestore-domain-data.ts';
import { privateSummarySuppressedSourceId, privateSummarySuppressedSourceSchema } from './private-summary-scan.ts';
import { summaryLineageKeyForTarget, summaryLineageRecordSchema, type SummarySourceDecision } from './private-summary-work.ts';

/** The production caller must read the durable gate and actual source in this same transaction.
 * A marker records that observation only; it never authorizes dispatch or skips a source read. */
export async function preparePrivateSummarySuppressedSource(data: FirestoreDomainData, b: Binding,
  source: Extract<SummarySourceDecision, { kind: 'suppressed' }>) {
  const blocked = { kind: 'blocked' as const };
  if (b.sharedAccess || b.actorUserId !== b.scope.ownerUserId || !source.observation) return blocked;
  const { target, sourceVersion, sourceBasis } = source.observation;
  const id = privateSummarySuppressedSourceId(b.scope, target);
  const candidate = privateSummarySuppressedSourceSchema.safeParse({ format: 'private-summary-suppressed-source/v1',
    id, scope: b.scope, authorizationVersion: b.authorizationVersion, workerGeneration: b.generation,
    version: 1, target, sourceVersion, sourceBasis, reason: source.reason });
  if (!candidate.success) return blocked;
  const lineageId = summaryLineageKeyForTarget(b.scope, target.kind === 'repair_batch'
    ? { kind: 'repair_batch', repairOf: target.summaryId } : target);
  const lineageRow = await b.transaction.get(data.ref('private_summary_works', 'private-summary-lineage', lineageId));
  if (lineageRow.exists) {
    const pointer = data.open('private-summary-lineage', lineageId, b.scope, summaryLineageRecordSchema, lineageRow);
    if (pointer.id !== lineageId || pointer.version !== lineageRow.get('recordVersion')
      || firestoreDomainHash(pointer.scope) !== firestoreDomainHash(b.scope)
      || Object.entries(data.tags(b.scope)).some(([key, value]) => lineageRow.get(key) !== value))
      domainReject('private_summary_binding', 500);
    if (pointer.authorizationVersion !== b.authorizationVersion || pointer.workerGeneration !== b.generation
      || pointer.owner.kind === 'work' || pointer.owner.accounting.state !== 'no_dispatch') return blocked;
  }
  const ref = data.ref('private_summary_scans', 'private-summary-suppressed-source', id), row = await b.transaction.get(ref);
  const previous = row.exists ? data.open('private-summary-suppressed-source', id, b.scope, privateSummarySuppressedSourceSchema, row) : null;
  if (previous && (previous.id !== id || previous.version !== row.get('recordVersion')
    || firestoreDomainHash(previous.scope) !== firestoreDomainHash(b.scope)
    || Object.entries(data.tags(b.scope)).some(([key, value]) => row.get(key) !== value)))
    domainReject('private_summary_scan_binding', 500);
  if (previous && firestoreDomainHash({ ...previous, version: 1 }) === firestoreDomainHash(candidate.data))
    return { kind: 'lookup' as const, commit() {} };
  const value = privateSummarySuppressedSourceSchema.parse({ ...candidate.data, version: (previous?.version ?? 0) + 1 });
  const sealed = { ...data.tags(b.scope), ...data.seal('private-summary-suppressed-source', id, b.scope,
    privateSummarySuppressedSourceSchema, value, value.version) };
  return { kind: 'prepared' as const, commit() { b.transaction.set(ref, sealed); } };
}
