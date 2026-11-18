import { createRequire } from 'node:module';
import { z } from 'zod';
import type { KnowledgeSourceInput } from '../src/shared/knowledge.ts';
import { sourceSeries, sourceSeriesSchema } from '../src/shared/source-series.ts';
import { SOURCE_WATCHES } from './knowledge-source-catalog.ts';
import { canonical } from './firestore-session-codec.ts';
import { knowledgeHash } from './knowledge-inputs.ts';
import type { ObservedContent } from './knowledge-refresh-types.ts';
import type { FirestoreKnowledgeObservation } from './firestore-knowledge-refresh.ts';

const require = createRequire(import.meta.url);
const parserVersions = { pdf: String(require('pdfjs-dist/package.json').version), page: String(require('cheerio/package.json').version) };
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const method = z.strictObject({
  reader: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('page'), selector: z.literal('#content'), parser: z.literal('cheerio'), version: z.string().regex(/^\d+\.\d+\.\d+$/u) }),
    z.strictObject({ kind: z.literal('pdf'), startPage: z.int().positive(), endPage: z.int().positive(), parser: z.literal('pdfjs-dist'), version: z.string().regex(/^\d+\.\d+\.\d+$/u) }),
  ]),
  checkedAt: z.iso.datetime({ offset: true }), observationHash: hash,
  sample: z.strictObject({ key: z.string().regex(/^[a-z0-9-]{1,80}$/u), excerptHash: hash, titleHash: hash.optional() }),
  checks: z.tuple([z.literal('registered_url'), z.literal('title'), z.literal('original_excerpt')]),
});
export const portableSeriesSchema = z.strictObject({
  format: z.literal(1), series: sourceSeriesSchema, policyVersion: z.literal(1), coverage: z.literal('listed_editions_only'),
  audience: z.literal('public_noncommercial'), termsUrl: z.url(), vectorSpace: z.string().regex(/^[a-z][a-z0-9-]{0,99}$/u),
  method: method.nullable(),
});
export type PortableSeries = z.infer<typeof portableSeriesSchema>;

function describeSeries(source: KnowledgeSourceInput, context: FirestoreKnowledgeObservation | null): PortableSeries {
  const watch = context?.watch.definition, observed = context?.observation;
  const reader = watch?.kind === 'pdf' && watch.pdfPages
    ? { kind: 'pdf' as const, ...watch.pdfPages, parser: 'pdfjs-dist' as const, version: parserVersions.pdf }
    : watch?.kind === 'page' && watch.selector === '#content'
      ? { kind: 'page' as const, selector: '#content' as const, parser: 'cheerio' as const, version: parserVersions.page } : null;
  const sample = source.chunks.find(chunk => chunk.sourceExcerpt && chunk.treatment?.kind !== 'excluded');
  const verified = reader && sample && context?.catalogMatches && context.watch.enabled && observed && observed.url === source.url && !observed.unavailable
    && watch?.publisher === source.publisher && watch.classification === source.classification && watch.audience === 'public_noncommercial' && watch.url === source.url && watch.termsUrl === source.termsUrl;
  return portableSeriesSchema.parse({ format: 1, series: sourceSeries(source), policyVersion: 1, coverage: 'listed_editions_only',
    audience: 'public_noncommercial', termsUrl: source.termsUrl, vectorSpace: 'vertex-retrieval-document-cosine',
    method: verified ? { reader, checkedAt: observed.lastSuccessfulCheckAt, observationHash: observed.contentHash,
      sample: { key: sample.key, excerptHash: knowledgeHash(sample.sourceExcerpt) }, checks: ['registered_url', 'title', 'original_excerpt'] } : null });
}

export function portableSeries(source: KnowledgeSourceInput, context: FirestoreKnowledgeObservation | null) {
  const info = describeSeries(source, context);
  if (!context?.observation?.approved || context.observation.approved.contentHash !== context.observation.contentHash) info.method = null;
  return info;
}

export function checkPortableSource(source: KnowledgeSourceInput) {
  for (const url of [source.url, source.termsUrl]) {
    if (new URL(url).search) throw Error('knowledge_transfer_url_not_shareable');
  }
  const watch = SOURCE_WATCHES.find(watch => watch.id === source.sourceId);
  if (watch && (watch.url !== source.url || watch.termsUrl !== source.termsUrl || watch.publisher !== source.publisher
    || watch.classification !== source.classification || watch.audience !== 'public_noncommercial')) throw Error('knowledge_transfer_source_binding_invalid');
}

export function checkPortableSeries(source: KnowledgeSourceInput, value: unknown) {
  checkPortableSource(source);
  const info = portableSeriesSchema.parse(value), local = sourceSeries(source);
  if (info.series.institutionId !== local.institutionId || info.termsUrl !== source.termsUrl) throw Error('knowledge_transfer_series_binding_invalid');
  const sample = info.method && source.chunks.find(chunk => chunk.key === info.method!.sample.key);
  if (info.method && (!sample || knowledgeHash(sample.sourceExcerpt) !== info.method.sample.excerptHash))
    throw Error('knowledge_transfer_sample_invalid');
  return info;
}

// Local approval and a fresh parser result remain authoritative even for a byte-identical import.
export function verifyPortableMethod(info: PortableSeries, source: KnowledgeSourceInput, local: FirestoreKnowledgeObservation | null, content: ObservedContent | null) {
  if (!info.method) return 'not_supplied' as const;
  const expected = describeSeries(source, local).method;
  const sample = source.chunks.find(chunk => chunk.key === info.method!.sample.key);
  if (!expected || !sample || !content || !content.title.trim() || content.url !== source.url) return 'pending_local_check' as const;
  const actualTitle = info.method.sample.titleHash ? knowledgeHash(content.title) === info.method.sample.titleHash : content.title === source.title;
  const original = info.method.reader.kind === 'pdf' ? content.pages?.filter(page => page.status === 'text'
    && page.page >= (sample.pageStart ?? Infinity) && page.page <= (sample.pageEnd ?? 0)).map(page => page.text).join('\n') : content.text;
  if (!actualTitle || !original?.includes(sample.sourceExcerpt) || expected.observationHash !== info.method.observationHash
      || canonical(expected.reader) !== canonical(info.method.reader)) return 'pending_local_check' as const;
  return 'verified_locally' as const;
}
