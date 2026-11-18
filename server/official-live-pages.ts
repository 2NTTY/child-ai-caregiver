import type { KnowledgeClass } from '../src/shared/knowledge.ts';
import { domainReject } from './firestore-domain-data.ts';
import { knowledgeTokens } from './knowledge-ranking.ts';
import type { SourceFetcher } from './knowledge-refresh-types.ts';
import { SOURCE_WATCHES } from './knowledge-source-catalog.ts';
import { fetchKnowledgeSource } from './knowledge-source-fetch.ts';
import type { LiveSourceRead, LiveSourceReader } from './live-source-citation.ts';

const sentences = new Intl.Segmenter('zh-HK', { granularity: 'sentence' });

function bestPassage(text: string, tokens: ReadonlySet<string>) {
  let best: { score: number; start: number; end: number } | null = null;
  for (const sentence of sentences.segment(text)) {
    const lower = sentence.segment.toLowerCase();
    let score = 0, first = lower.length;
    for (const token of tokens) {
      const offset = lower.indexOf(token);
      if (offset >= 0) { score++; first = Math.min(first, offset); }
    }
    if (!score || best && score <= best.score) continue;
    // Keep the source's UTF-16 coordinates so the citation can reproduce its exact excerpt.
    const start = sentence.index + Math.max(0, first - 160);
    const end = Math.min(sentence.index + sentence.segment.length, start + 800);
    best = { score, start, end };
  }
  return best;
}

/** Live public pages are read from the installation's catalogue. Search terms never leave this process. */
export function createOfficialLivePages(options: {
  sourceIds: readonly string[]; mayRead(sourceId: string): Promise<boolean>; fetchSource?: SourceFetcher;
}) {
  const watches = SOURCE_WATCHES.filter(watch => watch.kind === 'page' && watch.audience === 'public_noncommercial'
    && options.sourceIds.includes(watch.id));
  const fetchSource = options.fetchSource ?? fetchKnowledgeSource;
  return {
    classifications: [...new Set(watches.map(watch => watch.classification))],
    async search(query: string, signal: AbortSignal, classification: KnowledgeClass) {
      signal.throwIfAborted();
      const tokens = knowledgeTokens(query, true);
      if (!tokens.size) return [];
      const results = await Promise.all(watches.filter(watch => watch.classification === classification).map(async watch => {
        if (!await options.mayRead(watch.id)) return null;
        const response = await fetchSource(watch, signal);
        signal.throwIfAborted();
        if (response.status !== 'ok') return { unavailable: true } as const;
        const page = response.items.find(item => item.url === watch.url);
        if (!page) return { unavailable: true } as const;
        const passage = bestPassage(page.text, tokens);
        if (!passage || !await options.mayRead(watch.id)) return null;
        const read: LiveSourceRead = { documentId: watch.id, classification: watch.classification, title: page.title, publisher: watch.publisher,
          url: page.url, termsUrl: watch.termsUrl, fetchedAt: new Date().toISOString(), version: null,
          sourceDate: page.sourceUpdatedAt ?? page.sourcePublishedAt ?? page.sourceDateText ?? null, section: null, page: null,
          conditions: [], rights: 'retain_excerpt', original: page.text, start: passage.start, end: passage.end };
        return { score: passage.score, read };
      }));
      const hits = results.flatMap(item => item && 'read' in item && item.read ? [item] : []);
      if (!hits.length && results.some(item => item && 'unavailable' in item))
        domainReject('live_source_unavailable', 503);
      return hits.sort((a, b) => b.score - a.score || a.read.documentId.localeCompare(b.read.documentId)).map(item => item.read);
    },
    async mayUse(citation: Pick<LiveSourceRead, 'documentId' | 'url' | 'publisher' | 'rights' | 'termsUrl' | 'classification'>, signal: AbortSignal) {
      signal.throwIfAborted();
      const watch = watches.find(item => item.id === citation.documentId && item.url === citation.url);
      return !!watch && watch.classification === citation.classification && watch.termsUrl === citation.termsUrl && watch.publisher === citation.publisher
        && citation.rights === 'retain_excerpt' && await options.mayRead(watch.id);
    },
  } satisfies LiveSourceReader;
}
