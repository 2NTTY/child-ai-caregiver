import { z } from 'zod';
import { importProvenanceSchema } from '../src/shared/import-provenance.ts';
import { careValuesSchema, profileDataSchema } from './care-validation.ts';
import { sharedWriteAttributionSchema } from './shared-write-attribution.ts';

const uuid = z.uuid(), version = z.number().int().min(0).max(2147483646), time = z.iso.datetime({ offset: true });
const user = z.string().min(1).max(256);
export const firestoreCareStorageSchema = careValuesSchema.extend({ id: uuid, childId: uuid, authorUserId: user, createdAt: time,
  version: version.min(1), confirmedBy: user, confirmedAt: time, reason: z.string().max(500),
  confirmationBasis: z.enum(['explicit', 'preauthorized_user_statement', 'imported_source']).optional(),
  importedFrom: importProvenanceSchema.optional(),
  createdViaShare: sharedWriteAttributionSchema.optional(), confirmedViaShare: sharedWriteAttributionSchema.optional() }).strict();
export const firestoreProfileStorageSchema = z.object({ childId: uuid, version, data: profileDataSchema.nullable(),
  confirmedBy: user.nullable(), confirmedAt: time.nullable(), reason: z.string().max(500).nullable(),
  confirmationBasis: z.enum(['explicit', 'imported_source']).optional(), importedFrom: importProvenanceSchema.optional(),
  confirmedViaShare: sharedWriteAttributionSchema.optional() }).strict();
export const firestoreCareSchema = firestoreCareStorageSchema.transform(({ createdViaShare, confirmedViaShare, ...value }) => value);
export const firestoreProfileSchema = firestoreProfileStorageSchema.transform(({ confirmedViaShare, ...value }) => value);
