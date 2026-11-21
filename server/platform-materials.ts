import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { KnowledgeSourceInput } from '../src/shared/knowledge.ts';
import type { SourceWatchDefinition } from './knowledge-refresh-types.ts';

interface Material {
  id: string; title: string; url: string; status: string; pdfs?: string[]; reuseSourceId?: string; mediaLinks?: string[]; categories: string[];
}
interface Original { sha256: string; url: string; pages: number }
const inventory: { items: Material[]; sections: Record<string, string>; pdfOriginals: Original[]; media: { url: string; videoIds?: string[] }[];
  videoDurationSeconds: Record<string, number> } = JSON.parse(
  readFileSync(new URL('../knowledge/fhs-child-inventory.json', import.meta.url), 'utf8'));
export const platformMaterials = new Map<string, { id: string; title: string; url: string; mediaLinks: string[] }>();
const byUrl = new Map<string, string>();
export const fhsPdfMediaPages = new Map<string, string>();
export const officialVideoPages = new Map(inventory.media.flatMap(item => (item.videoIds ?? []).map(id => [id, item.url] as const)));
export const knownVideoDurations = inventory.videoDurationSeconds;
interface ExternalDecision {
  sourceId: string; url: string; title: string; disposition: 'link_only' | 'public_noncommercial';
  publisher?: string; termsUrl?: string; sha256?: string;
}
const external: ExternalDecision[] = JSON.parse(readFileSync(new URL('../knowledge/fhs-external-rights.json', import.meta.url), 'utf8')).materials;
const externalById = new Map(external.map(row => [row.sourceId, row]));
const externalByUrl = new Map(external.map(row => [row.url, row]));
// Sources supported before the catalogue extension retain their existing publication and audience rules.
const priorSourceHosts = new Set(['www.fhs.gov.hk', 'www.studenthealth.gov.hk', 'www.chp.gov.hk', 'www.dh.gov.hk', 'news.rthk.hk', 'rthk.hk', 'www.rthk.hk']);
export const externalMaterialWatches: SourceWatchDefinition[] = external.filter(row => row.disposition === 'public_noncommercial').map(row => {
  if (!row.publisher || !row.termsUrl || !row.sha256 || !inventory.pdfOriginals.some(pdf => pdf.url === row.url && pdf.sha256 === row.sha256))
    throw Error('Invalid reviewed external material');
  return { id: row.sourceId, url: row.url, title: row.title, kind: 'pdf', leafletPage: row.url,
    publisher: row.publisher, termsUrl: row.termsUrl, classification: 'official_guidance', audience: 'public_noncommercial' };
});
export function reviewedExternalOriginal(url: string) {
  const entry = externalByUrl.get(url);
  return entry?.disposition === 'public_noncommercial' ? entry.sha256 : undefined;
}
export function externalMaterialAllowed(source: Pick<KnowledgeSourceInput, 'sourceId' | 'url' | 'termsUrl' | 'publisher' | 'extraction' | 'classification'>) {
  const entry = externalById.get(source.sourceId) ?? externalByUrl.get(source.url);
  if (!entry) return priorSourceHosts.has(new URL(source.url).hostname);
  return entry.disposition === 'public_noncommercial' && entry.sourceId === source.sourceId && entry.url === source.url
    && source.classification === 'official_guidance' && source.publisher === entry.publisher && source.termsUrl === entry.termsUrl
    && source.extraction?.format === 'text_pdf' && source.extraction.contentHash === entry.sha256;
}
function add(id: string, title: string, url: string, mediaLinks: string[]) {
  if (new URL(url).hostname !== 'www.fhs.gov.hk' && !reviewedExternalOriginal(url)) return;
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

// The catalogue also links other publishers. Only exact registered FHS documents belong to this family series.
const childHealthMembers = new Map<string, { url: string; categories: string[] }>();
const catalogueByUrl = new Map(inventory.items.map(item => [item.url, item]));
function categoryLabels(item: Material) {
  const pending = [...item.categories], seen = new Set<string>(), labels = new Set<string>();
  while (pending.length) {
    const url = pending.pop()!.replace('/sc_chi/', '/tc_chi/');
    if (seen.has(url)) continue;
    seen.add(url);
    const label = inventory.sections[url];
    if (label) {
      labels.add(label);
      const ageSection = url.replace(/(\/class_life\/child\/child_(?:bfm|otm|oty|tsy))_[^/]+\.html$/u, '$1.html');
      if (ageSection !== url && inventory.sections[ageSection]) labels.add(inventory.sections[ageSection]!);
    }
    else pending.push(...catalogueByUrl.get(url)?.categories ?? []);
  }
  return [...labels];
}
for (const item of platformMaterials.values()) {
  if (new URL(item.url).hostname !== 'www.fhs.gov.hk') continue;
  const pdf = inventory.pdfOriginals.find(row => row.url === item.url);
  const labels = inventory.items.filter(row => row.url === item.url || pdf && row.pdfs?.includes(pdf.sha256))
    .flatMap(categoryLabels);
  childHealthMembers.set(item.id, { url: item.url, categories: [...new Set(labels)] });
}
childHealthMembers.set('fhs-feeding-booklet-en', { url: 'https://www.fhs.gov.hk/english/health_info/child/14727.pdf',
  categories: ['營養及健康生活習慣'] });
export function childHealthCategories(source: { sourceId: string; url: string }) {
  const member = childHealthMembers.get(source.sourceId);
  return member?.url === source.url ? member.categories : undefined;
}
export function isChildHealthSourceId(id: string) { return childHealthMembers.has(id); }

// Only FHS material uses this reviewed publisher scope. External sources retain their own terms at review.
export const fhsMaterialWatches: SourceWatchDefinition[] = [...platformMaterials.values()].filter(item =>
  new URL(item.url).hostname === 'www.fhs.gov.hk' && !inventory.items.some(prior => prior.reuseSourceId === item.id))
  .map(item => ({
    id: item.id, url: item.url, title: item.title, kind: item.url.endsWith('.pdf') ? 'pdf' : 'page',
    ...(item.url.endsWith('.pdf') ? { leafletPage: item.url } : { selector: '#content' }),
    classification: 'official_guidance', publisher: '香港特別行政區政府衞生署家庭健康服務',
    termsUrl: 'https://www.fhs.gov.hk/english/notice/notice.html', audience: 'public_noncommercial',
  }));
export const campaignMaterialWatches = [...fhsMaterialWatches, ...externalMaterialWatches];

// Pin the large-object exceptions across catalogue updates, including citation and backup reads of old editions.
const largeBooklets = [
  { file: '30034.pdf', bytes: 63746648, sha256: '48db798a9c469d34bb99cd49f55c112c80d8691c77d41d8ec8b0396933396177' },
  { file: '30035.pdf', bytes: 53090252, sha256: 'be3c9e500c38b42efc26b2c31ed342f80abd3dbe873b646872cf455f19c1bc34' },
].map(({ file, bytes, sha256 }) => {
  const url = 'https://www.fhs.gov.hk/tc_chi/health_info/child/' + file;
  return { url, bytes, sha256, sourceId: 'pdf-' + createHash('sha256').update(url).digest('hex').slice(0, 24) };
});
export function largeFhsPdf(key?: string) {
  return largeBooklets.find(p => key === p.url || key === p.sha256 || key === p.sourceId);
}
export const largestFhsOriginalBytes = Math.max(...largeBooklets.map(p => p.bytes));
