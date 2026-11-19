import { randomUUID, createHash } from 'node:crypto';
import type { KnowledgeClass } from '../src/shared/knowledge.ts';
import { liveSourceCitationSchema, type LiveSearchLimitation, type LiveSourceCitation } from '../src/shared/live-source-citation.ts';

export interface LiveSearchDetailedResult {
  readonly reads: readonly LiveSourceRead[];
  readonly limitations: readonly LiveSearchLimitation[];
}

// Installed only for a provider with an approved read and retention scope. The query is already minimized.
// Each read carries its actual original, not a search-result snippet or a model summary.
export interface LiveSourceReader {
  readonly classifications: readonly KnowledgeClass[];
  search(query: string, signal: AbortSignal, classification: KnowledgeClass): Promise<readonly LiveSourceRead[]>;
  searchDetailed?(query: string, signal: AbortSignal, classification: KnowledgeClass): Promise<LiveSearchDetailedResult>;
  mayUse(citation: LiveSourceCitation, signal: AbortSignal): Promise<boolean>;
}
export type PublishedLiveSeries = (sourceId: string, url: string) => Promise<import('../src/shared/source-series.ts').SourceSeries | null>;
export type LiveSourceReaderOption = LiveSourceReader | ((userId: string) => LiveSourceReader);
export interface LiveSourceRead extends Omit<LiveSourceCitation, 'acquisition' | 'id' | 'contentHash' | 'excerpt' | 'range'> {
  original: string; start: number; end: number;
}
export function snapshotLiveRead(read: LiveSourceRead): LiveSourceCitation {
  const { original, start, end, ...metadata } = read;
  if (!original || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > original.length || end - start > 800)
    throw Error('live_read_range_invalid');
  return liveSourceCitationSchema.parse({ ...metadata, id: randomUUID(), acquisition: 'live', range: { start, end },
    contentHash: createHash('sha256').update(original).digest('hex'),
    excerpt: read.rights === 'retain_excerpt' ? original.slice(start, end) : null });
}
