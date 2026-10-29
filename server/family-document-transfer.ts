import { z } from 'zod';
import { documentRequestSchema } from '../src/shared/family-documents.ts';
import { importProvenanceSchema } from '../src/shared/import-provenance.ts';
import { firestoreDocumentSnapshotSchema } from './firestore-family-document-snapshots.ts';
import { documentSourceRevisionSchema } from './family-document-copy.ts';

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
const revisionFields = { documentId: z.uuid(), snapshotId: z.uuid(), snapshotVersion: version,
  generatedAt: z.iso.datetime({ offset: true }), invalidated: z.boolean(), origin: documentSourceRevisionSchema.optional() };
export const documentTransferVersionSchema = z.object(revisionFields).strict()
  .refine(value => !value.origin || value.origin.invalidated === value.invalidated);
export const documentTransferContentSchema = z.object({ ...revisionFields, snapshot: firestoreDocumentSnapshotSchema.nullable() })
  .strict().refine(value => value.invalidated === (value.snapshot === null)
  && (!value.snapshot || value.snapshot.id === value.snapshotId && value.snapshot.version === value.snapshotVersion
    && value.snapshot.generatedAt === value.generatedAt)
  && (!value.origin || value.origin.invalidated === value.invalidated));
export type DocumentTransferContent = z.infer<typeof documentTransferContentSchema>;
