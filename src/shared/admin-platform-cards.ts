import { z } from 'zod';

const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/u);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const binding = { sourceId: id, versionId: z.uuid(), versionHash: hash, baseId: z.uuid().nullable() };
export const platformCardCommand = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('media'), sourceId: id, enabled: z.boolean(), revision: z.int().nonnegative() }),
  z.strictObject({ action: z.literal('draft'), source: z.unknown() }),
  z.strictObject({ action: z.literal('review'), ...binding, termsChecked: z.literal(true), assessment: z.unknown() }),
  z.strictObject({ action: z.literal('sync'), ...binding }),
]);
export const platformVersionBinding = z.object({ sourceId: id, versionId: z.uuid(), versionHash: hash });
export const platformCardPreview = z.strictObject({
  ...binding, baseHash: hash.nullable(), title: z.string(), url: z.url(), termsUrl: z.url(), observationHash: hash.nullable(),
  state: z.enum(['draft', 'reviewed', 'withdrawn']), published: z.boolean(), headerChanged: z.boolean(),
  headerChanges: z.array(z.strictObject({ field: z.string(), previous: z.string().nullable(), current: z.string().nullable() })).optional(),
  changes: z.array(z.strictObject({ key: id, previous: z.string().nullable(), current: z.string().nullable(),
    oldQuote: z.string().nullable(), newQuote: z.string().nullable() })).max(64),
});
export type PlatformCardPreview = z.infer<typeof platformCardPreview>;
export type PlatformCardCommand = z.infer<typeof platformCardCommand>;
