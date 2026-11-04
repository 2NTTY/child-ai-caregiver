import { z } from 'zod';
import { importProvenanceSchema } from './import-provenance.ts';

const uuid = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/u);
const count = z.number().int().nonnegative().max(2147483646);
const resourceVersion = z.number().int().nonnegative().max(2147483647);
export const handoverImportSectionSchema = z.enum(['care', 'profile', 'tasks', 'memory', 'sources', 'documents', 'attachments', 'chat', 'concerns', 'growth']);
export const handoverImportResourceSectionSchema = z.enum(['care', 'profile', 'tasks', 'memory_facts', 'memory_topics', 'instructions', 'summary_history', 'private_sources', 'documents', 'visit_preparation', 'files', 'voices', 'photos', 'child_avatar', 'chat', 'chat_imports', 'concerns', 'growth_attention', 'growth_topics']);
export const handoverHistorySectionSchema = z.enum(['care_history', 'profile_history', 'task_history', 'memory_fact_history', 'memory_topic_history', 'private_source_history', 'document_versions', 'document_content', 'visit_preparation_history', 'file_content', 'voice_content', 'photo_content', 'child_avatar_content', 'voice_transcripts', 'concern_history', 'concern_events', 'growth_history', 'growth_topic_history']);
export type HandoverImportModule = z.infer<typeof handoverImportSectionSchema>;
export type HandoverImportResourceSection = z.infer<typeof handoverImportResourceSectionSchema>;
export function handoverImportModuleOf(section: HandoverImportResourceSection): HandoverImportModule {
  return section === 'care' || section === 'profile' || section === 'tasks' || section === 'chat' || section === 'concerns' ? section : section === 'chat_imports' ? 'chat' : section === 'private_sources' ? 'sources'
    : section === 'growth_attention' || section === 'growth_topics' ? 'growth'
    : section === 'documents' || section === 'visit_preparation' ? 'documents'
    : section === 'files' || section === 'voices' || section === 'photos' || section === 'child_avatar' ? 'attachments' : 'memory';
}
export const handoverImportTargetSchema = z.object({ sourceChildId: uuid,
  target: z.object({ childId: uuid, spaceId: uuid.nullable() }).strict(),
  sections: z.array(handoverImportSectionSchema).min(1).max(10)
    .refine(value => new Set(value).size === value.length),
}).strict();
const requestedTargetSchema = handoverImportTargetSchema.extend({
  target: z.union([handoverImportTargetSchema.shape.target, z.object({ createInClassId: uuid }).strict()]),
});
export const handoverImportResolutionSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('preserve') }).strict(),
  z.object({ mode: z.literal('replace_current'), targetId: uuid, expectedVersion: resourceVersion }).strict(),
  z.object({ mode: z.literal('restore_deleted'), targetId: uuid, expectedVersion: resourceVersion }).strict(),
]);
export const originalBackupModuleSchema = z.enum(['care', 'profile', 'tasks', 'sources', 'documents']);
export const selfAvatarRestoreSchema = z.object({ expectedVersion: resourceVersion,
  mode: z.enum(['replace_current', 'restore_deleted']) }).strict();
export const selfAvatarComparisonQuerySchema = z.object({ uploadId: uuid, expectedUploadVersion: count.positive() }).strict();
export const selfAvatarComparisonSchema = z.object({ uploadId: uuid, manifestSha256: hash,
  backupVersion: resourceVersion, localVersion: resourceVersion,
  state: z.enum(['empty_backup', 'unchanged', 'missing', 'different', 'deleted']) }).strict();
export const selfAvatarRestoreResultSchema = z.object({ outcome: z.enum(['created', 'updated', 'conflict', 'skipped']),
  reason: z.enum(['empty_backup', 'unchanged', 'version_conflict', 'decision_changed']).nullable(),
  backupVersion: resourceVersion, localVersion: resourceVersion, assetId: uuid.nullable() }).strict();
export const handoverImportCommandSchema = z.object({ opId: uuid, uploadId: uuid,
  expectedUploadVersion: count.positive(), acceptedManifestSha256: hash.nullable(),
  resolutionOnly: z.boolean().optional(), restoreOriginal: z.literal(true).optional(),
  accountAvatar: selfAvatarRestoreSchema.optional(),
  targets: z.array(requestedTargetSchema).max(100),
  resolutions: z.array(z.object({ sourceChildId: uuid, section: handoverImportResourceSectionSchema,
    resourceId: uuid, resolution: handoverImportResolutionSchema }).strict()).max(10000),
}).strict().refine(value => (value.targets.length > 0 || !!value.accountAvatar)
  && (!value.accountAvatar || value.restoreOriginal === true && value.resolutionOnly === true)
  && new Set(value.targets.map(row => row.sourceChildId)).size === value.targets.length
  && new Set(value.resolutions.map(row => JSON.stringify([row.sourceChildId, row.section, row.resourceId]))).size === value.resolutions.length
  && value.resolutions.every(row => value.targets.some(target => target.sourceChildId === row.sourceChildId && target.sections.includes(handoverImportModuleOf(row.section))))
  && (!value.restoreOriginal || value.resolutionOnly && value.acceptedManifestSha256 !== null && value.targets.every(row =>
    'childId' in row.target && row.target.spaceId === null && row.sourceChildId === row.target.childId
    && row.sections.every(module => originalBackupModuleSchema.safeParse(module).success)))
  && (!value.resolutionOnly || (value.resolutions.length > 0 || !!value.accountAvatar) && value.resolutions.every(row => row.resolution.mode !== 'preserve')
    && value.targets.every(row => !('createInClassId' in row.target))));
export const originalBackupComparisonQuerySchema = z.object({ uploadId: uuid, expectedUploadVersion: count.positive(), childId: uuid,
  module: originalBackupModuleSchema, includeRestoreTarget: z.literal(true).optional(), cursor: z.string().min(1).max(16000).optional() }).strict();
export const originalBackupComparisonSchema = z.object({ uploadId: uuid, manifestSha256: hash, childId: uuid, module: originalBackupModuleSchema,
  items: z.array(z.object({ id: uuid, targetId: uuid.optional(), resourceSection: z.enum(['documents', 'visit_preparation']).optional(), backupVersion: resourceVersion, localVersion: resourceVersion.nullable(),
    state: z.enum(['unchanged', 'local_newer', 'backup_newer', 'different', 'deleted', 'unavailable']),
    changedFields: z.array(z.string().min(1).max(80)).max(64) }).strict()).max(20), nextCursor: z.string().max(16000).nullable() }).strict().refine(page => page.items.every(item => (item.resourceSection !== undefined) === (page.module === 'documents')));
export type OriginalBackupComparison = z.infer<typeof originalBackupComparisonSchema>;
export type OriginalBackupComparisonQuery = z.infer<typeof originalBackupComparisonQuerySchema>;

export const handoverImportControlSchema = z.object({ opId: uuid, expectedVersion: count.positive() }).strict();
export const handoverImportViewSchema = z.object({ id: uuid, version: count.positive(), uploadId: uuid,
  packageId: uuid, packageVersion: count.positive(), manifestSha256: hash,
  integrity: z.enum(['trusted', 'untrusted_signer', 'missing_proof']),
  targets: z.array(handoverImportTargetSchema).max(10000), createdAt: z.iso.datetime({ offset: true }), updatedAt: z.iso.datetime({ offset: true }),
  state: z.enum(['queued', 'running', 'completed', 'cancelled', 'failed', 'interrupted']),
  totalItems: count, processedItems: count,
  counts: z.object({ created: count, updated: count, skipped: count, conflict: count }).strict(),
  error: z.string().max(100).nullable(),
}).strict();
export type HandoverImportCommand = z.infer<typeof handoverImportCommandSchema>;
export type HandoverImportView = z.infer<typeof handoverImportViewSchema>;
export const handoverImportModuleOutcomeSchema = z.object({ module: handoverImportSectionSchema,
  created: count, updated: count, skipped: count, conflict: count }).strict();
export const handoverImportSummarySchema = z.object({ batchId: uuid, state: handoverImportViewSchema.shape.state,
  processedItems: count, totalItems: count,
  accountAvatar: z.object({ result: selfAvatarRestoreResultSchema.nullable() }).strict().optional(),
  modules: z.array(handoverImportModuleOutcomeSchema).max(10).nullable(),
}).strict();
export type HandoverImportSummary = z.infer<typeof handoverImportSummarySchema>;
export const handoverImportPageSchema = z.object({ items: z.array(handoverImportViewSchema).max(20),
  nextCursor: z.string().max(2048).nullable() }).strict();
export const handoverImportResultQuerySchema = z.object({ sourceChildId: uuid, module: handoverImportSectionSchema,
  cursor: z.string().max(16000).optional() }).strict();
const resultResource = z.object({ id: uuid, version: resourceVersion }).strict();
export const handoverImportResultSchema = z.object({ id: uuid, batchId: uuid, sourceChildId: uuid,
  module: handoverImportSectionSchema, sourceResourceId: uuid, sourceVersion: resourceVersion,
  resourceSection: handoverImportResourceSectionSchema.optional(),
  sourceSection: handoverHistorySectionSchema.nullable(),
  at: z.iso.datetime({ offset: true }), outcome: z.enum(['created', 'updated', 'skipped', 'conflict']),
  reason: z.string().max(100).nullable(), recordedResource: resultResource.nullable(),
  currentResource: resultResource.extend({ deleted: z.boolean() }).nullable(),
  availableResolution: z.enum(['replace_current', 'restore_deleted']).nullable(),
}).strict();
export const handoverImportResultPageSchema = z.object({ batchId: uuid, sourceChildId: uuid, module: handoverImportSectionSchema,
  items: z.array(handoverImportResultSchema).max(20), nextCursor: z.string().max(16000).nullable(), complete: z.boolean() }).strict();
export type HandoverImportResult = z.infer<typeof handoverImportResultSchema>;
export type HandoverImportResultPage = z.infer<typeof handoverImportResultPageSchema>;
export type HandoverImportResultQuery = z.infer<typeof handoverImportResultQuerySchema>;
export const handoverSourceRevisionSchema = z.object({ format: z.literal('yuyoufang-source-revision:1'), childId: uuid,
  resource: z.object({ id: uuid, version: resourceVersion.positive() }).strict(),
  evidence: z.object({ module: handoverImportResourceSectionSchema, source: importProvenanceSchema,
    value: z.record(z.string(), z.unknown()) }).strict(),
}).strict();
export const handoverSourceHistoryQuerySchema = z.object({ childId: uuid, spaceId: uuid.nullable().default(null),
  module: handoverImportResourceSectionSchema, resourceId: uuid, cursor: z.string().max(16000).optional() }).strict();
export const handoverSourceHistoryPageSchema = z.object({ items: z.array(handoverSourceRevisionSchema).max(10),
  nextCursor: z.string().max(16000).nullable(), complete: z.boolean() }).strict();
