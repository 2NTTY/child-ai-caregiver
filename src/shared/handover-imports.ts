import { z } from 'zod';
import { importProvenanceSchema } from './import-provenance.ts';

const uuid = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/u);
const count = z.number().int().nonnegative().max(2147483646);
const resourceVersion = z.number().int().nonnegative().max(2147483647);
export const handoverImportSectionSchema = z.enum(['care', 'profile', 'tasks']);
export const handoverImportTargetSchema = z.object({ sourceChildId: uuid,
  target: z.object({ childId: uuid, spaceId: uuid.nullable() }).strict(),
  sections: z.array(handoverImportSectionSchema).min(1).max(3)
    .refine(value => new Set(value).size === value.length),
}).strict();
export const handoverImportResolutionSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('preserve') }).strict(),
  z.object({ mode: z.literal('replace_current'), targetId: uuid, expectedVersion: resourceVersion }).strict(),
  z.object({ mode: z.literal('restore_deleted'), targetId: uuid, expectedVersion: resourceVersion }).strict(),
]);
export const handoverImportCommandSchema = z.object({ opId: uuid, uploadId: uuid,
  expectedUploadVersion: count.positive(), acceptedManifestSha256: hash.nullable(),
  targets: z.array(handoverImportTargetSchema).min(1).max(100),
  resolutions: z.array(z.object({ sourceChildId: uuid, section: handoverImportSectionSchema,
    resourceId: uuid, resolution: handoverImportResolutionSchema }).strict()).max(10000),
}).strict().refine(value => new Set(value.targets.map(row => row.sourceChildId)).size === value.targets.length
  && new Set(value.resolutions.map(row => JSON.stringify([row.sourceChildId, row.section, row.resourceId]))).size === value.resolutions.length
  && value.resolutions.every(row => value.targets.some(target => target.sourceChildId === row.sourceChildId && target.sections.includes(row.section))));
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
export const handoverSourceRevisionSchema = z.object({ format: z.literal('yuyoufang-source-revision:1'), childId: uuid,
  resource: z.object({ id: uuid, version: resourceVersion.positive() }).strict(),
  evidence: z.object({ module: handoverImportSectionSchema, source: importProvenanceSchema,
    value: z.record(z.string(), z.unknown()) }).strict(),
}).strict();
export const handoverSourceHistoryQuerySchema = z.object({ childId: uuid, spaceId: uuid.nullable().default(null),
  module: handoverImportSectionSchema, resourceId: uuid, cursor: z.string().max(16000).optional() }).strict();
export const handoverSourceHistoryPageSchema = z.object({ items: z.array(handoverSourceRevisionSchema).max(10),
  nextCursor: z.string().max(16000).nullable(), complete: z.boolean() }).strict();
