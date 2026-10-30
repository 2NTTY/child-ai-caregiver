import { createHash } from 'node:crypto';
import { importProvenanceSchema, type ImportProvenance } from '../src/shared/import-provenance.ts';
import type { HandoverIntegrity } from '../src/shared/handover.ts';
import type { HandoverImportRow } from './handover-import.ts';
import { HandoverArchiveError } from './handover-archive.ts';
import { canonicalJson } from './online-routing.ts';

/** Runtime and restore authenticate the importer; the displayed source confirmer is not a local actor. */
export function importConfirmationActor(value: { confirmationBasis?: string; confirmedBy: string | null;
  confirmedAt: string | null; importedFrom?: ImportProvenance }, section: 'care' | 'profile' | 'memory_facts'): string | null | undefined {
  if (value.confirmationBasis !== 'imported_source') return value.confirmedBy;
  const link = value.importedFrom?.current;
  return link?.source.section === section && link.source.confirmedBy === value.confirmedBy && link.source.confirmedAt === value.confirmedAt
    ? link.importedBy : undefined;
}

/** Called with a server-verified row, after destination authorization, never with a client-supplied approval. */
export function makeImportProvenance(row: HandoverImportRow, integrity: HandoverIntegrity, importedBy: string, importedAt: string): ImportProvenance {
  const value = row.value;
  if (row.section === 'child_avatar' ? !value.target || typeof value.target !== 'object'
    || (value.target as { kind?: unknown; childId?: unknown }).kind !== 'child'
    || (value.target as { childId?: unknown }).childId !== row.childId : value.childId !== row.childId) throw new HandoverArchiveError('invalid_package_scope');
  const previous = value.importedFrom === undefined ? null : importProvenanceSchema.safeParse(value.importedFrom);
  if (previous && !previous.success) throw new HandoverArchiveError('invalid_package_data');
  const chain = previous?.success ? [previous.data.current, ...previous.data.previous] : [];
  const identities = new Set<string>();
  const result = importProvenanceSchema.safeParse({ current: {
    source: { serverId: row.source.serverId, accountId: row.source.accountId, childId: row.childId,
      section: row.section, resourceId: row.section === 'profile' || row.section === 'visit_preparation' || row.section === 'child_avatar' ? row.childId : value.id, resourceVersion: value.version,
      authorUserId: value.authorUserId ?? value.createdBy ?? value.updatedBy ?? null, createdAt: value.createdAt ?? value.updatedAt ?? null,
      confirmedBy: value.confirmedBy ?? null, confirmedAt: value.confirmedAt ?? null,
      confirmationBasis: value.confirmationBasis ?? null, assigneeUserId: value.assigneeUserId ?? null,
      ...(row.section === 'memory_topics' ? { reopenedFrom: value.reopenedFrom ?? null } : {}),
      ...(row.section === 'instructions' ? { sourceMessageId: value.sourceMessageId ?? null, statementProvenance: value.provenance } : {}),
      ...(row.section === 'summary_history' ? { previousSummaryId: value.previousId ?? null } : {}),
      ...(row.section === 'documents' && value.snapshotId ? { snapshotId: value.snapshotId } : {}),
      ...(row.section === 'concerns' && Array.isArray(value.attentionIds) && Object.hasOwn(value, 'followUp') ? { concern: { timelineId: value.timelineId ?? null,
        attentionIds: value.attentionIds, followUp: value.followUp, updatedAt: value.updatedAt } } : {}),
      ...(row.section === 'concern_events' ? { concernEvent: { concernId: value.concernId, sequence: value.sequence,
        timelineId: value.timelineId ?? null, sourceLabel: value.sourceLabel, recordId: value.recordId ?? null, taskId: value.taskId ?? null,
        attentionId: value.attentionId ?? null, attentionVersion: value.attentionVersion ?? null, runId: value.runId ?? null } } : {}),
      ...(row.section === 'growth_attention' && value.evidence && value.source ? { growth: { evidence: value.evidence, previousId: value.previousId, taskId: value.taskId,
        taskState: value.taskState, lastAction: value.lastAction, state: value.state, sourceAvailable: value.sourceAvailable,
        sourceVersionId: (value.source as Record<string, unknown>).versionId, sourceChunkId: (value.source as Record<string, unknown>).chunkId } } : {}),
      ...(row.section === 'growth_topics' ? { growthTopic: value.topicId } : {}),
      ...(row.section === 'visit_preparation' && typeof value.reviewed === 'boolean' ? { preparation: { appointmentTaskId: value.appointmentTaskId,
        reviewed: value.reviewed, reviewedBasis: value.reviewedBasis } } : {}) },
    sourceHash: createHash('sha256').update(canonicalJson(value)).digest('hex'),
    packageId: row.source.packageId, packageVersion: row.source.packageVersion, manifestSha256: row.source.manifestSha256,
    integrity, importedBy, importedAt,
  }, previous: chain.filter(link => { const id = canonicalJson(link); if (identities.has(id)) return false; identities.add(id); return true; }) });
  if (!result.success) throw new HandoverArchiveError('invalid_package_provenance');
  return result.data;
}
