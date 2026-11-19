import { z } from 'zod';
import { chunkTreatmentSchema } from './source-series.ts';

export const adminTreatmentPath = /^\/api\/admin\/knowledge-treatments\/([a-z0-9][a-z0-9-]{0,79})$/u;
export const treatmentReviewMaxBytes = 2 * 1024 * 1024;
export const treatmentSourceId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/u);
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const base = { baseId: z.uuid(), baseHash: digest };
const edition = { ...base, versionId: z.uuid(), versionHash: digest };
export const treatmentCommand = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('draft'), ...base, changes: z.array(z.strictObject({
      key: treatmentSourceId, treatment: chunkTreatmentSchema,
    })).min(1).max(32)
  }),
  z.strictObject({ action: z.literal('review'), ...edition, sourceAndTermsChecked: z.literal(true), assessment: z.unknown() }),
  z.strictObject({ action: z.literal('publish'), ...edition }),
]);
export const treatmentView = z.strictObject({
  ...edition, sourceId: treatmentSourceId, title: z.string(), url: z.url(), termsUrl: z.url(),
  observationHash: digest.nullable(), state: z.enum(['draft', 'reviewed', 'withdrawn']), published: z.boolean(),
  chunks: z.array(z.strictObject({ key: treatmentSourceId, section: z.string(), sourceExcerpt: z.string(), previousTreatment: chunkTreatmentSchema, treatment: chunkTreatmentSchema })).min(1).max(32),
});
export const treatmentResult = z.strictObject({ versionId: z.uuid(), versionHash: digest, state: z.enum(['draft', 'reviewed', 'withdrawn', 'held', 'published']) });
export type TreatmentCommand = z.infer<typeof treatmentCommand>;
export type TreatmentView = z.infer<typeof treatmentView>;
