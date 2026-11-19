import { z } from "zod";
import { platformPublisherHosts } from './platform-material.ts';
import { platformCardMedia } from './platform-media.ts';

import { libraryPreferenceViewSchema, sourceSeriesSchema } from './source-series.ts';
import type { LibraryJoin } from './source-series.ts';

const sourceId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/);
const time = z.iso.datetime({ offset: true });
export const librarySeriesV1MediaType = 'application/vnd.yuyoufang.library-series.v1+json';
export const librarySeriesV2MediaType = 'application/vnd.yuyoufang.library-series.v2+json';
export const librarySeriesMediaType = 'application/vnd.yuyoufang.library-series.v3+json';
const legacyLibraryItem = z.object({
  sourceId, versionId: z.uuid(), title: z.string().min(1).max(300), publisher: z.string().min(1).max(160),
  url: z.url().refine(value => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port
      && platformPublisherHosts.has(url.hostname);
  }),
  classification: z.enum(["official_guidance", "recent_information"]),
  checkedAt: time, sourceUpdatedAt: time.nullable(), validUntil: time.nullable(),
});
export const personalLibraryItemSchema = legacyLibraryItem.extend({
  series: sourceSeriesSchema.optional(), preference: libraryPreferenceViewSchema.optional(),
  media: platformCardMedia.optional(),
  versionHash: z.string().regex(/^[a-f0-9]{64}$/u).optional(), fetchedAt: time.optional(), lastCheckedAt: time.nullable().optional(),
  lastSuccessfulCheckAt: time.nullable().optional(), publishedAt: time.nullable().optional(),
  coverage: z.string().max(240).optional(), methods: z.array(z.string().max(200)).max(8).optional(), topics: z.array(z.string()).max(384).optional(),
}).strict();
export const registeredLibrarySourceSchema = z.strictObject({ sourceId, series: sourceSeriesSchema, publisher: z.string().max(160),
  url: personalLibraryItemSchema.shape.url, kind: z.enum(['page', 'pdf']), status: z.enum(['registered', 'pending', 'withdrawn']),
  lastCheckedAt: time.nullable(), lastSuccessfulCheckAt: time.nullable(), live: z.boolean() });
export type RegisteredLibrarySource = z.infer<typeof registeredLibrarySourceSchema>;
export const personalLibraryPageSchema = z.object({
  items: z.array(personalLibraryItemSchema).max(10), registered: z.array(registeredLibrarySourceSchema).max(10).optional(),
  nextCursor: z.string().regex(/^[A-Za-z0-9_-]{1,2048}$/).nullable(), complete: z.boolean(),
}).strict().refine(page => page.complete === (page.nextCursor === null)
  && new Set(page.items.map(item => item.sourceId)).size === page.items.length);
export type PersonalLibraryItem = z.infer<typeof personalLibraryItemSchema>;
export type PersonalLibraryPage = z.infer<typeof personalLibraryPageSchema>;

export function platformLibraryJoin(items: readonly PersonalLibraryItem[]): LibraryJoin | null {
  const { series, preference } = items[0] ?? {};
  if (!series || !preference || items.some(item => item.series?.id !== series.id
    || item.preference?.revision !== preference.revision)) return null;
  return { action: 'join', seriesId: series.id, expectedRevision: preference.revision,
    editions: items.map(({ sourceId, versionId }) => ({ sourceId, versionId })) };
}

export function selectedLibraryEditions(items: readonly PersonalLibraryItem[]) {
  return items.flatMap(item => {
    const selection = item.preference;
    if (selection?.eligible === false) return [];
    const versionHash = selection?.mode === 'fixed' && selection.revision > 0 ? selection.selectedVersionHash : item.versionHash;
    return versionHash ? [{ sourceId: item.sourceId, versionHash }] : [];
  }).sort((a, b) => a.sourceId.localeCompare(b.sourceId, 'en'));
}

export function librarySeriesV1Page(page: PersonalLibraryPage) {
  return { ...page, items: librarySeriesV2Page(page).items.map(item => item.preference?.mode === 'platform'
    ? { ...item, preference: { ...item.preference, mode: 'follow' as const } } : item) };
}
export function librarySeriesV2Page(page: PersonalLibraryPage) {
  return { ...page, items: page.items.map(({ media: _, ...item }) => item) };
}

// Existing app versions use strict item and page schemas. Only send fields they understand.
export function legacyLibraryPage({ items, nextCursor, complete }: PersonalLibraryPage) {
  return { items: items.map(item => legacyLibraryItem.parse(item)), nextCursor, complete };
}
