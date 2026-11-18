import { z } from 'zod';

const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/u);
export const sourceSeriesSchema = z.strictObject({
  id, institutionId: z.string().min(1).max(255), name: z.string().min(1).max(300),
});
export type SourceSeries = z.infer<typeof sourceSeriesSchema>;

// Membership belongs to the registered document identity. Titles and topic filters may change.
const fhsSeries: Record<string, readonly [string, string]> = {
  'fhs-solid-food': ['fhs-infant-feeding', '嬰幼兒健康飲食'],
  'fhs-feeding-booklet-en': ['fhs-infant-feeding', '嬰幼兒健康飲食'],
  'fhs-toddler-development': ['fhs-child-development', '兒童發展'],
  'fhs-preschool-development': ['fhs-child-development', '兒童發展'],
  'fhs-child-vision': ['fhs-vision-screening', '學前兒童視力普查'],
};
export function sourceSeries(source: { sourceId: string; title: string; url: string }): SourceSeries {
  const institutionId = new URL(source.url).hostname;
  const entry = institutionId === 'www.fhs.gov.hk' && Object.hasOwn(fhsSeries, source.sourceId) ? fhsSeries[source.sourceId] : undefined;
  return { institutionId, id: entry?.[0] ?? source.sourceId, name: entry?.[1] ?? source.title };
}

export const libraryPreferenceChangeSchema = z.strictObject({
  seriesId: id, imported: z.literal(true).optional(), adopt: z.boolean().optional(), expectedRevision: z.int().nonnegative(), enabled: z.boolean(), mode: z.enum(['fixed', 'follow']),
  editions: z.array(z.strictObject({ sourceId: id, versionId: z.uuid().optional(), versionHash: z.string().regex(/^[a-f0-9]{64}$/u).optional() }).refine(row => !!row.versionId || !!row.versionHash)).min(1).max(100),
}).refine(value => new Set(value.editions.map(item => item.sourceId)).size === value.editions.length);
export type LibraryPreferenceChange = z.infer<typeof libraryPreferenceChangeSchema>;
export const libraryPreferenceViewSchema = z.strictObject({
  revision: z.int().nonnegative(), enabled: z.boolean(), mode: z.enum(['fixed', 'follow']),
  selectedVersionId: z.uuid().nullable(), selectedVersionHash: z.string().regex(/^[a-f0-9]{64}$/u).optional(), eligible: z.boolean(),
});

export const chunkTreatmentSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('detailed'), policyVersion: z.literal(1) }),
  z.strictObject({ kind: z.literal('overview'), policyVersion: z.literal(1) }),
  z.strictObject({ kind: z.literal('structured'), policyVersion: z.literal(1),
    fields: z.array(z.strictObject({ label: z.string().min(1).max(80), value: z.string().min(1).max(300) })).min(1).max(16) }),
  z.strictObject({ kind: z.literal('excluded'), policyVersion: z.literal(1), reason: z.string().min(1).max(240) }),
]);
export type ChunkTreatment = z.infer<typeof chunkTreatmentSchema>;
