import { z } from 'zod';
import { documentRequestSchema } from '../src/shared/family-documents.ts';
import { importProvenanceSchema } from '../src/shared/import-provenance.ts';

const version = z.number().int().positive().max(2147483647);
/** Transfer metadata only. Bodies/revisions are paged separately through current disclosure checks. */
export const familyDocumentTransferSchema = z.object({
  format: z.literal('yuyoufang-document:1'), id: z.uuid(), childId: z.uuid(), version,
  kind: documentRequestSchema.shape.kind, purpose: documentRequestSchema.shape.purpose,
  request: documentRequestSchema, createdAt: z.iso.datetime({ precision: 6 }),
  status: z.enum(['active', 'archived']), archivedAt: z.iso.datetime({ offset: true }).nullable(),
  autoRefresh: z.boolean(), readState: z.enum(['ready', 'stale', 'invalidated']), invalidated: z.boolean(),
  currentSnapshot: z.object({ id: z.uuid(), version, readable: z.boolean() }).strict().nullable(),
  recentSnapshotIds: z.array(z.uuid()).max(10),
  importedFrom: importProvenanceSchema.optional(),
}).strict().refine(value => value.kind === value.request.kind && value.purpose === value.request.purpose
  && value.invalidated === (value.readState === 'invalidated')
  && (!value.invalidated || value.currentSnapshot?.readable !== true)
  && (value.readState !== 'ready' || value.currentSnapshot?.readable === true)
  && (value.status === 'archived') === (value.archivedAt !== null)
  && (value.currentSnapshot === null || value.currentSnapshot.version <= value.version)
  && new Set(value.recentSnapshotIds).size === value.recentSnapshotIds.length
  && !value.recentSnapshotIds.includes(value.currentSnapshot?.id ?? ''));
export type FamilyDocumentTransfer = z.infer<typeof familyDocumentTransferSchema>;
