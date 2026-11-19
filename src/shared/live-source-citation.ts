import { z } from 'zod';
import { sourceSeriesSchema } from './source-series.ts';

const label = (limit: number) => z.string().trim().min(1).max(limit);
const locator = z.url().max(2048).refine(value => {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password;
});

export const LIVE_SOURCE_KINDS = [
  'official_page',
  'community_discussion',
  'product_spec',
  'service_info',
  'public_news',
] as const;
export const liveSourceKindSchema = z.enum(LIVE_SOURCE_KINDS);
export type LiveSourceKind = z.infer<typeof liveSourceKindSchema>;

export const LIVE_SOURCE_CAUTIONS = [
  'self_reported_unverified',
  'suspected_promotional',
  'stale_source',
  'conflicting_claims',
  'partial_read',
] as const;
export const liveSourceCautionSchema = z.enum(LIVE_SOURCE_CAUTIONS);
export type LiveSourceCaution = z.infer<typeof liveSourceCautionSchema>;

export const liveProductSpecSchema = z.strictObject({
  brand: label(80).nullable().optional(),
  model: label(120).nullable().optional(),
  variantOrStage: label(80).nullable().optional(),
  regionVersion: label(80).nullable().optional(),
  batchCode: label(80).nullable().optional(),
  priceText: label(80).nullable().optional(),
});
export type LiveProductSpec = z.infer<typeof liveProductSpecSchema>;

export const LIVE_SEARCH_LIMITATION_REASONS = [
  'login_or_access_restricted',
  'original_unreadable',
  'stale_only',
  'no_matching_results',
  'suspected_promotional_only',
  'unapproved_host',
] as const;
export const liveSearchLimitationSchema = z.strictObject({
  url: locator.nullable(),
  title: label(300).nullable(),
  publisher: label(160).nullable(),
  reason: z.enum(LIVE_SEARCH_LIMITATION_REASONS),
  detail: label(240),
});
export type LiveSearchLimitation = z.infer<typeof liveSearchLimitationSchema>;

export const liveSourceCitationSchema = z.strictObject({
  id: z.uuid(), acquisition: z.literal('live'), classification: z.enum(['official_guidance', 'recent_information']).default('recent_information'), documentId: label(255), title: label(300), publisher: label(160),
  url: locator, termsUrl: locator.nullable(), fetchedAt: z.iso.datetime({ offset: true }), version: label(160).nullable(),
  sourceDate: label(120).nullable(), section: label(240).nullable(), page: z.int().positive().nullable(),
  conditions: z.array(label(300)).max(8), series: sourceSeriesSchema.optional(),
  sourceKind: liveSourceKindSchema.optional(),
  productSpec: liveProductSpecSchema.optional(),
  cautions: z.array(liveSourceCautionSchema).max(5).optional(),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/u),
  range: z.strictObject({ start: z.int().nonnegative(), end: z.int().positive() }).refine(value => value.end > value.start),
  rights: z.enum(['retain_excerpt', 'locator_only']), excerpt: z.string().min(1).max(800).refine(value => !!value.trim()).nullable(),
}).refine(value => value.rights === 'retain_excerpt' ? value.excerpt !== null : value.excerpt === null);
export type LiveSourceCitation = z.infer<typeof liveSourceCitationSchema>;
