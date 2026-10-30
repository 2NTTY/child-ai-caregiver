import { z } from 'zod';
import { documentRequestSchema, reportCoverageSchema } from '../src/shared/family-documents.ts';
import { firestoreProfileSchema } from './firestore-care.ts';
import { firestoreDocumentSourceSchema } from './firestore-family-document-snapshots.ts';
import type { FirestoreDocumentReport } from './firestore-document-sources.ts';

/** Encrypted, bounded continuation data; authoritative inputs are rechecked on every batch. */
export const firestoreDocumentReportSchema: z.ZodType<FirestoreDocumentReport> = z.object({
  request: documentRequestSchema, sourceRevision: z.string().min(1).max(160),
  stage: z.enum(['profile', 'records', 'facts', 'tasks', 'concerns', 'done']),
  processedSources: z.number().int().nonnegative(), counts: reportCoverageSchema.shape.counts,
  validUntil: z.iso.datetime({ offset: true }).nullable(), profile: firestoreProfileSchema.nullable(),
  selected: z.array(z.object({ source: firestoreDocumentSourceSchema,
    domain: z.enum(['profile', 'body_life', 'abilities_interests', 'concerns', 'changes_support']).nullable(),
    recordKind: z.string().max(40).optional(), validUntil: z.iso.datetime({ offset: true }).nullable().optional(),
    activeConcern: z.boolean().optional() }).strict()).max(140),
  blocked: z.boolean().optional(), concernScanVersion: z.literal(1).optional(), pageAfter: z.uuid().optional(),
  concernAfter: z.object({ id: z.uuid(), sequence: z.number().int().nonnegative(), timelineId: z.uuid().nullable().optional() }).strict().optional(),
  pendingConcern: z.object({ id: z.uuid(), header: firestoreDocumentSourceSchema.nullable(), sawObservation: z.boolean() }).strict().optional(),
}).strict();
