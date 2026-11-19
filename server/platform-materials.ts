import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { SourceWatchDefinition } from './knowledge-refresh-types.ts';

interface Material {
  id: string; title: string; url: string; status: string; pdfs?: string[]; reuseSourceId?: string; mediaLinks?: string[];
}
interface Original { sha256: string; url: string; pages: number }
const inventory: { items: Material[]; pdfOriginals: Original[]; media: { url: string; videoIds?: string[] }[];
  videoDurationSeconds: Record<string, number> } = JSON.parse(
  readFileSync(new URL('../knowledge/fhs-child-inventory.json', import.meta.url), 'utf8'));
export const platformMaterials = new Map<string, { id: string; title: string; url: string; mediaLinks: string[] }>();
const byUrl = new Map<string, string>();
export const fhsPdfMediaPages = new Map<string, string>();
export const officialVideoPages = new Map(inventory.media.flatMap(item => (item.videoIds ?? []).map(id => [id, item.url] as const)));
export const knownVideoDurations = inventory.videoDurationSeconds;
export const approvedPublicChpUrls = new Set(inventory.items.filter(item => ['html', 'pdf'].includes(item.status)
  && new URL(item.url).hostname === 'www.chp.gov.hk').map(item => item.url).concat(inventory.pdfOriginals
  .filter(item => new URL(item.url).hostname === 'www.chp.gov.hk').map(item => item.url)));
function add(id: string, title: string, url: string, mediaLinks: string[]) {
  if (byUrl.has(url)) return;
  if (platformMaterials.has(id)) throw new Error('Duplicate platform material identity');
  platformMaterials.set(id, { id, title, url, mediaLinks });
  byUrl.set(url, id);
}
for (const item of inventory.items) {
  if (item.status === 'html' || item.status === 'pdf') add(item.id, item.title, item.url, item.mediaLinks ?? []);
}
for (const original of inventory.pdfOriginals) {
  const referrers = inventory.items.filter(item => item.pdfs?.includes(original.sha256));
  const landing = referrers.find(item => item.url.replace(/\.html$/u, '.pdf') === original.url);
  if (landing?.url.endsWith('.html') && new URL(original.url).hostname === 'www.fhs.gov.hk') fhsPdfMediaPages.set(original.url, landing.url);
  const label = landing?.title ?? new URL(original.url).pathname.split('/').at(-1)!;
  add('pdf-' + createHash('sha256').update(original.url).digest('hex').slice(0, 24), label, original.url, landing?.mediaLinks ?? []);
}

// Only FHS material uses this reviewed publisher scope. External sources retain their own terms at review.
export const fhsMaterialWatches: SourceWatchDefinition[] = [...platformMaterials.values()].filter(item =>
  new URL(item.url).hostname === 'www.fhs.gov.hk' && !inventory.items.some(prior => prior.reuseSourceId === item.id))
  .map(item => ({
    id: item.id, url: item.url, title: item.title, kind: item.url.endsWith('.pdf') ? 'pdf' : 'page',
    ...(item.url.endsWith('.pdf') ? { leafletPage: item.url } : { selector: '#content' }),
    classification: 'official_guidance', publisher: '香港特別行政區政府衞生署家庭健康服務',
    termsUrl: 'https://www.fhs.gov.hk/english/notice/notice.html', audience: 'public_noncommercial',
  }));
