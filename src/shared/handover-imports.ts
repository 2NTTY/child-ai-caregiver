import { z } from 'zod';
import { importProvenanceSchema } from './import-provenance.ts';

const uuid = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/u);
const count = z.number().int().nonnegative().max(2147483646);
const resourceVersion = z.number().int().nonnegative().max(2147483647);
export const handoverImportSectionSchema = z.enum(['care', 'profile', 'tasks', 'memory', 'sources', 'documents', 'attachments']);
export const handoverImportResourceSectionSchema = z.enum(['care', 'profile', 'tasks', 'memory_facts', 'memory_topics', 'instructions', 'summary_history', 'private_sources', 'documents', 'visit_preparation', 'files', 'voices', 'photos', 'child_avatar']);
export const handoverHistorySectionSchema = z.enum(['care_history', 'profile_history', 'task_history', 'memory_fact_history', 'memory_topic_history', 'private_source_history', 'document_versions', 'document_content', 'visit_preparation_history', 'file_content', 'voice_content', 'photo_content', 'child_avatar_content', 'voice_transcripts']);
export type HandoverImportModule = z.infer<typeof handoverImportSectionSchema>;
export type HandoverImportResourceSection = z.infer<typeof handoverImportResourceSectionSchema>;
export function handoverImportModuleOf(section: HandoverImportResourceSection): HandoverImportModule {
  return section === 'care' || section === 'profile' || section === 'tasks' ? section : section === 'private_sources' ? 'sources'
    : section === 'documents' || section === 'visit_preparation' ? 'documents'
    : section === 'files' || section === 'voices' || section === 'photos' || section === 'child_avatar' ? 'attachments' : 'memory';
}
export const handoverImportTargetSchema = z.object({ sourceChildId: uuid,
  target: z.object({ childId: uuid, spaceId: uuid.nullable() }).strict(),
  sections: z.array(handoverImportSectionSchema).min(1).max(7)
    .refine(value => new Set(value).size === value.length),
}).strict();
export const handoverImportResolutionSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('preserve') }).strict(),
  z.object({ mode: z.literal('replace_current'), targetId: uuid, expectedVersion: resourceVersion }).strict(),
  z.object({ mode: z.literal('restore_deleted'), targetId: uuid, expectedVersion: resourceVersion }).strict(),
]);
export const handoverImportCommandSchema = z.object({ opId: uuid, uploadId: uuid,
  expectedUploadVersion: count.positive(), acceptedManifestSha256: hash.nullable(),
  resolutionOnly: z.boolean().optional(),
  targets: z.array(handoverImportTargetSchema).min(1).max(100),
  resolutions: z.array(z.object({ sourceChildId: uuid, section: handoverImportResourceSectionSchema,
    resourceId: uuid, resolution: handoverImportResolutionSchema }).strict()).max(10000),
}).strict().refine(value => new Set(value.targets.map(row => row.sourceChildId)).size === value.targets.length
  && new Set(value.resolutions.map(row => JSON.stringify([row.sourceChildId, row.section, row.resourceId]))).size === value.resolutions.length
  && value.resolutions.every(row => value.targets.some(target => target.sourceChildId === row.sourceChildId && target.sections.includes(handoverImportModuleOf(row.section))))
  && (!value.resolutionOnly || value.resolutions.length > 0 && value.resolutions.every(row => row.resolution.mode !== 'preserve')));
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
