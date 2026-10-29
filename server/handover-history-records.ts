import { z } from 'zod';
import { handoverSourceRevisionSchema, type HandoverImportResourceSection } from '../src/shared/handover-imports.ts';
import { firestoreDomainHash } from './firestore-domain-data.ts';
import type { WorkRecoveryScope } from './firestore-work-continuation-recovery.ts';

export const historyModules = { care_history: 'care', profile_history: 'profile', task_history: 'tasks',
  memory_fact_history: 'memory_facts', memory_topic_history: 'memory_topics', private_source_history: 'private_sources',
  document_versions: 'documents', document_content: 'documents', visit_preparation_history: 'visit_preparation' } as const;
export type HistoryModule = HandoverImportResourceSection;
export function historyResourceForContent(kind: 'care' | 'profile' | 'fact' | 'topic'): HandoverImportResourceSection {
  return kind === 'fact' ? 'memory_facts' : kind === 'topic' ? 'memory_topics' : kind;
}
export function historyModule(section: string): HistoryModule | undefined {
  return Object.hasOwn(historyModules, section) ? historyModules[section as keyof typeof historyModules] : undefined;
}
/** A source revision is evidence, not a local mutation or a transferable execution receipt. */
export const sourceHistoryExportSchema = handoverSourceRevisionSchema;
export const sourceHistoryRecordSchema = sourceHistoryExportSchema.extend({
  opId: z.uuid(), importedBy: z.string().min(1).max(256), importedAt: z.iso.datetime({ offset: true }),
}).strict();
export type SourceHistoryRecord = z.infer<typeof sourceHistoryRecordSchema>;
export const sourceHistoryExport = (value: SourceHistoryRecord) => {
  const { opId: _opId, importedBy: _actor, importedAt: _at, ...result } = value; return result;
};
export function sourceHistoryId(scope: WorkRecoveryScope, value: Pick<SourceHistoryRecord, 'resource' | 'evidence'>) {
  const source = value.evidence.source.current.source;
  return firestoreDomainHash([scope.ownerUserId, scope.workspaceId, scope.childId, value.resource.id,
    source.serverId, source.accountId, source.childId, source.section, source.resourceId, source.resourceVersion]);
}
export const sourceHistoryMetadata = (value: SourceHistoryRecord) => ({ module: value.evidence.module,
  entityId: value.resource.id, entityVersion: value.resource.version });
