import { z } from 'zod';
import { sourceSeriesSchema } from './source-series.ts';

const label = (limit: number) => z.string().trim().min(1).max(limit);
const locator = z.url().max(2048).refine(value => {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password;
});
export const liveSourceCitationSchema = z.strictObject({
  id: z.uuid(), acquisition: z.literal('live'), classification: z.enum(['official_guidance', 'recent_information']).default('recent_information'), documentId: label(255), title: label(300), publisher: label(160),
  url: locator, termsUrl: locator.nullable(), fetchedAt: z.iso.datetime({ offset: true }), version: label(160).nullable(),
  sourceDate: label(120).nullable(), section: label(240).nullable(), page: z.int().positive().nullable(),
  conditions: z.array(label(300)).max(8), series: sourceSeriesSchema.optional(), contentHash: z.string().regex(/^[0-9a-f]{64}$/u),
  range: z.strictObject({ start: z.int().nonnegative(), end: z.int().positive() }).refine(value => value.end > value.start),
  rights: z.enum(['retain_excerpt', 'locator_only']), excerpt: z.string().min(1).max(800).refine(value => !!value.trim()).nullable(),
}).refine(value => value.rights === 'retain_excerpt' ? value.excerpt !== null : value.excerpt === null);
export type LiveSourceCitation = z.infer<typeof liveSourceCitationSchema>;
