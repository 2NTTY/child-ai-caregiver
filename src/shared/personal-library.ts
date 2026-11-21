import { z } from "zod";
import { platformPublisherHosts } from './platform-material.ts';
import { mediaWithoutPages, platformCardMedia } from './platform-media.ts';

import { libraryPreferenceViewSchema, managedSeriesViewSchema, sourceSeriesSchema } from './source-series.ts';
import type { LibraryJoin } from './source-series.ts';

const sourceId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/);
const time = z.iso.datetime({ offset: true });
export const librarySeriesV1MediaType = 'application/vnd.yuyoufang.library-series.v1+json';
export const librarySeriesV2MediaType = 'application/vnd.yuyoufang.library-series.v2+json';
export const librarySeriesV3MediaType = 'application/vnd.yuyoufang.library-series.v3+json';
export const librarySeriesV4MediaType = 'application/vnd.yuyoufang.library-series.v4+json';
export const librarySeriesV5MediaType = 'application/vnd.yuyoufang.library-series.v5+json';
export const librarySeriesMediaType = 'application/vnd.yuyoufang.library-series.v6+json';
export const libraryCatalogPageSize = 10;
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
  childHealth: managedSeriesViewSchema.extend({ categories: z.array(z.string().min(1).max(200)).max(100),
    categoryCounts: z.array(z.strictObject({ name: z.string().min(1).max(200), count: z.int().positive() })).max(100).optional(),
    previousChoice: libraryPreferenceViewSchema.optional() }).optional(),
  media: platformCardMedia.optional(),
  sourceDateText: z.string().max(200).optional(),
  versionHash: z.string().regex(/^[a-f0-9]{64}$/u).optional(), fetchedAt: time.optional(), lastCheckedAt: time.nullable().optional(),
  lastSuccessfulCheckAt: time.nullable().optional(), publishedAt: time.nullable().optional(),
  coverage: z.string().max(240).optional(), methods: z.array(z.string().max(200)).max(8).optional(), topics: z.array(z.string()).max(384).optional(),
}).strict();
export const registeredLibrarySourceSchema = z.strictObject({ sourceId, series: sourceSeriesSchema, publisher: z.string().max(160),
  url: personalLibraryItemSchema.shape.url, kind: z.enum(['page', 'pdf']), status: z.enum(['registered', 'pending', 'withdrawn']),
  lastCheckedAt: time.nullable(), lastSuccessfulCheckAt: time.nullable(), live: z.boolean() });
export type RegisteredLibrarySource = z.infer<typeof registeredLibrarySourceSchema>;
const publisherOriginal = z.strictObject({ sourceId, title: legacyLibraryItem.shape.title, url: legacyLibraryItem.shape.url,
  categories: z.array(z.string().min(1).max(200)).max(100) });
export type PublisherOriginal = z.infer<typeof publisherOriginal>;
export const personalLibraryPageSchema = z.object({
  items: z.array(personalLibraryItemSchema).max(libraryCatalogPageSize), registered: z.array(registeredLibrarySourceSchema).max(10).optional(),
  publisherOriginals: z.array(publisherOriginal).max(libraryCatalogPageSize).optional(),
  nextCursor: z.string().regex(/^[A-Za-z0-9_-]{1,2048}$/).nullable(), complete: z.boolean(),
}).strict().refine(page => {
  const rows = [...page.items, ...(page.publisherOriginals ?? [])];
  return page.complete === (page.nextCursor === null) && rows.length <= libraryCatalogPageSize
    && new Set(rows.map(row => row.sourceId)).size === rows.length;
});
export type PersonalLibraryItem = z.infer<typeof personalLibraryItemSchema>;
export type PersonalLibraryPage = z.infer<typeof personalLibraryPageSchema>;
export const libraryDocumentChoice = (item: PersonalLibraryItem) => item.childHealth?.previousChoice ?? item.preference;
export function childHealthStatus(view: NonNullable<PersonalLibraryItem['childHealth']>) {
  if (!view.adopted) return '未下載';
  if (view.adopted < view.total) return `已採用 ${view.adopted}／${view.total} 份`;
  if (!view.enabled) return '已停用';
  if (view.enabled < view.adopted) return '部分已停用';
  return view.fixed === view.adopted ? '已固定' : view.fixed ? '部分已固定' : '已跟隨';
}

export function platformLibraryJoin(items: readonly PersonalLibraryItem[]): LibraryJoin | null {
  const { series, preference } = items[0] ?? {};
  if (!series || !preference || items.some(item => item.series?.id !== series.id
    || item.preference?.revision !== preference.revision)) return null;
  return { action: 'join', seriesId: series.id, expectedRevision: preference.revision,
    editions: items.map(({ sourceId, versionId }) => ({ sourceId, versionId })) };
}

export function selectedLibraryEditions(items: readonly PersonalLibraryItem[]) {
  return items.flatMap(item => {
    const selection = libraryDocumentChoice(item);
    if (selection?.eligible === false) return [];
    const versionHash = selection?.mode === 'fixed' && selection.revision > 0 ? selection.selectedVersionHash : item.versionHash;
    return versionHash ? [{ sourceId: item.sourceId, versionHash }] : [];
  }).sort((a, b) => a.sourceId.localeCompare(b.sourceId, 'en'));
}

export function librarySeriesV1Page(page: PersonalLibraryPage) {
  return { ...page, items: librarySeriesV2Page(page).items.map(item => item.preference?.mode === 'platform'
    ? { ...item, preference: { ...item.preference, mode: 'follow' as const } } : item) };
}
const releasedCatalogueHosts = new Set(['www.fhs.gov.hk', 'www.studenthealth.gov.hk', 'www.dh.gov.hk']);
const releasedCatalogueItem = (item: { url: string }) => releasedCatalogueHosts.has(new URL(item.url).hostname);
export function librarySeriesV2Page(page: PersonalLibraryPage) {
  return { ...page, items: librarySeriesV3Page(page).items.filter(releasedCatalogueItem).map(({ media: _, ...item }) => item) };
}
export function librarySeriesV3Page(page: PersonalLibraryPage) {
  return { ...page, items: librarySeriesV4Page(page).items.map(({ childHealth: _, ...item }) => item) };
}
export function librarySeriesV4Page(page: PersonalLibraryPage) {
  return { ...page, items: page.items.map(({ sourceDateText: _date, media, ...item }) => ({
    ...item, ...(media ? { media: mediaWithoutPages(media) } : {}),
  })) };
}

// Existing app versions use strict item and page schemas. Only send fields they understand.
export function legacyLibraryPage({ items, nextCursor, complete }: PersonalLibraryPage) {
  return { items: items.filter(releasedCatalogueItem).map(item => legacyLibraryItem.parse(item)), nextCursor, complete };
}
