import { readFileSync } from 'node:fs';
import type { KnowledgeExtraction } from '../src/shared/knowledge.ts';

interface LeafletEdition { web: string; print: string; printSha256: string; scope: 'leaflet_text' | 'chapter_directory' }
const { editions }: { editions: LeafletEdition[] } = JSON.parse(readFileSync(new URL('../knowledge/fhs-leaflet-editions.json', import.meta.url), 'utf8'));
const printEditions = new Map(editions.map(edition => [edition.print, edition]));
const coveredPrints = JSON.stringify(editions.filter(e => e.scope === 'leaflet_text').map(e => ({ url: e.print, hash: e.printSha256 })));

/** Only the publisher's identified, fingerprinted print counterpart is covered by its current-text notice. */
export function publisherCurrentText(url: string, extraction?: KnowledgeExtraction) {
  const edition = printEditions.get(url);
  return edition?.scope === 'leaflet_text' && extraction?.format === 'text_pdf' && edition.printSha256 === extraction.contentHash ? edition.web : undefined;
}

function requestsPrint(query: string) {
  return /pdf|printed|archiv|diagram|figures?|\btable\b|illustrat|印刷|紙本|舊版|旧版|原版|舊單張|圖[表像片解示]|插圖|附[表件錄圖]|表格|第\s*[\d一二三四五六七八九十]+\s*頁/iu.test(query);
}

export function includeLeafletInSearch(query: string, url: string, extraction?: KnowledgeExtraction) {
  return !publisherCurrentText(url, extraction) || requestsPrint(query);
}

export function omittedLeafletPrints(query?: string) {
  return query && !requestsPrint(query) ? coveredPrints : '[]';
}
