import { z } from 'zod';

const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/u);
export const sourceSeriesSchema = z.strictObject({
  id, institutionId: z.string().min(1).max(255), name: z.string().min(1).max(300),
});
export type SourceSeries = z.infer<typeof sourceSeriesSchema>;
export const childHealthSeries = { id: 'fhs-child-health', institutionId: 'www.fhs.gov.hk', name: '衛生署 兒童健康' } as const;
export const managedSeriesViewSchema = z.strictObject({
  stateHash: z.string().regex(/^[a-f0-9]{64}$/u), revision: z.int().nonnegative(), total: z.int().positive(), adopted: z.int().nonnegative(),
  enabled: z.int().nonnegative(), fixed: z.int().nonnegative(),
});
export type ManagedSeriesView = z.infer<typeof managedSeriesViewSchema>;
const manageSeries = z.strictObject({ action: z.literal('manage'), seriesId: z.literal(childHealthSeries.id),
  expectedState: managedSeriesViewSchema.shape.stateHash, operation: z.enum(['join', 'follow', 'fixed', 'enable', 'disable', 'remove']) });
export type ManageSeries = z.infer<typeof manageSeries>;

// Membership belongs to the registered document identity. Titles and topic filters may change.
const fhsSeries: Record<string, readonly [string, string]> = {
  'fhs-solid-food': ['fhs-infant-feeding', '嬰幼兒健康飲食'],
  'fhs-feeding-booklet-en': ['fhs-infant-feeding', '嬰幼兒健康飲食'],
  'fhs-toddler-development': ['fhs-child-development', '兒童發展'],
  'fhs-preschool-development': ['fhs-child-development', '兒童發展'],
  'fhs-child-vision': ['fhs-vision-screening', '學前兒童視力普查'],
};
export function sourceSeries(source: { sourceId: string; title: string; url: string; series?: SourceSeries }): SourceSeries {
  const institutionId = new URL(source.url).hostname;
  if (source.series && source.series.institutionId === institutionId) return source.series;
  const entry = institutionId === 'www.fhs.gov.hk' && Object.hasOwn(fhsSeries, source.sourceId) ? fhsSeries[source.sourceId] : undefined;
  return { institutionId, id: entry?.[0] ?? source.sourceId, name: entry?.[1] ?? source.title };
}

export const libraryArchiveMaxEditions = 100;
export const libraryArchiveSelectionSchema = z.strictObject({ seriesId: id,
  editions: z.array(z.strictObject({ sourceId: id, versionHash: z.string().regex(/^[a-f0-9]{64}$/u) })).min(1).max(libraryArchiveMaxEditions),
}).refine(value => new Set(value.editions.map(row => row.sourceId)).size === value.editions.length);
export type LibraryArchiveSelection = z.infer<typeof libraryArchiveSelectionSchema>;

export const librarySelectionMode = z.enum(['platform', 'fixed', 'follow']);
export const libraryPreferenceChangeSchema = z.strictObject({
  seriesId: id, imported: z.literal(true).optional(), adopt: z.boolean().optional(), wholeSeries: z.literal(true).optional(),
  expectedRevision: z.int().nonnegative(), enabled: z.boolean(), mode: librarySelectionMode,
  editions: z.array(z.strictObject({ sourceId: id, versionId: z.uuid().optional(), versionHash: z.string().regex(/^[a-f0-9]{64}$/u).optional() }).refine(row => !!row.versionId || !!row.versionHash)).min(1).max(100),
}).refine(value => new Set(value.editions.map(item => item.sourceId)).size === value.editions.length && (!value.wholeSeries || !value.imported && !value.adopt));
export type LibraryPreferenceChange = z.infer<typeof libraryPreferenceChangeSchema>;
const libraryJoinSchema = z.strictObject({
  action: z.literal('join'), seriesId: id, expectedRevision: z.int().nonnegative(), wholeSeries: z.literal(true).optional(),
  editions: z.array(z.strictObject({ sourceId: id, versionId: z.uuid() })).min(1).max(100),
}).refine(value => new Set(value.editions.map(item => item.sourceId)).size === value.editions.length);
export type LibraryJoin = z.infer<typeof libraryJoinSchema>;
export const librarySelectionCommandSchema = z.union([libraryJoinSchema, libraryPreferenceChangeSchema, manageSeries]);
export type LibrarySelectionCommand = z.infer<typeof librarySelectionCommandSchema>;
export const libraryPreferenceViewSchema = z.strictObject({
  revision: z.int().nonnegative(), enabled: z.boolean(), mode: librarySelectionMode,
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
export function needsKnowledgeVector(treatment?: ChunkTreatment) {
  return treatment?.kind !== 'structured' && treatment?.kind !== 'excluded';
}
