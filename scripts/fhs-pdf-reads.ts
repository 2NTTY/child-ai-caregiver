import { createHash } from 'node:crypto';
import { open, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deserialize } from 'node:v8';
import { extractKnowledgePdf, KNOWLEDGE_PDF_MAX_BYTES, type KnowledgePdfOptions, type KnowledgePdfResult } from '../server/knowledge-pdf.ts';
import { largeFhsPdf } from '../server/platform-materials.ts';
import type { createFirestoreKnowledgeRefresh } from '../server/firestore-knowledge-refresh.ts';
import { knowledgeOperationId } from '../server/firestore-knowledge-maintenance.ts';
import type { RefreshJob } from '../server/knowledge-refresh-types.ts';

const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
const digest = /^[a-f0-9]{64}$/u;

type PdfPin = {sourceId: string; url: string; sha256: string; pages: number};
type Observations = Pick<ReturnType<typeof createFirestoreKnowledgeRefresh>, 'resumeCheck'>;
type Snapshot = Awaited<ReturnType<Observations['resumeCheck']>>;

export function matchesFhsPdfObservation(source: PdfPin, snapshot: Snapshot) {
  if (snapshot?.status !== 'ok' || snapshot.items.length !== 1) return false;
  const [item] = snapshot.items;
  return item?.url === source.url && item.extraction?.format === 'text_pdf'
    && item.extraction.contentHash === source.sha256 && item.extraction.totalPages === source.pages;
}

/** A parser reread has a separate free check, with the same original paid work. */
export async function resolveFhsPdfObservation(refresh: Observations, job: RefreshJob, operation: string, source: PdfPin) {
  if (job.watchId !== source.sourceId) throw Error('knowledge_campaign_source_binding_changed');
  const checkId = knowledgeOperationId('knowledge-observation/1', operation);
  const snapshot = await refresh.resumeCheck(job, checkId);
  if (snapshot?.status === 'failed' && snapshot.reason === 'parse') {
    const rereadId = knowledgeOperationId('knowledge-observation/parser-recovery/1', operation);
    const reread = await refresh.resumeCheck(job, rereadId);
    if (reread?.status === 'ok' && reread.items[0]?.nativeWindowMethod === 'native-pdf-window/1' && matchesFhsPdfObservation(source, reread))
      return {checkId:rereadId, snapshot:reread};
  }
  return {checkId, snapshot};
}

export async function fhsPdfParserBinding() {
  const pkg = JSON.parse(await readFile(new URL(import.meta.resolve('pdfjs-dist/package.json')), 'utf8'));
  const sources = await Promise.all(['knowledge-pdf', 'knowledge-pdf-worker', 'knowledge-pdf-glyphs', 'knowledge-pdf-quotes'].map(
    name => readFile(new URL('../server/' + name + '.ts', import.meta.url), 'utf8')));
  return sha256(Buffer.from(JSON.stringify([pkg.version, ...sources.map(code => code.replaceAll('\r\n', '\n'))])));
}

export function fhsPdfReadKey(hash: string, { startPage = 1, pageLimit = 8, includePagePdf = false }: KnowledgePdfOptions) {
  return [hash, startPage, pageLimit, includePagePdf ? 'slice' : 'text'].join('.');
}

export async function openFhsCampaignPdfReads(command: string, kind: string, env: NodeJS.ProcessEnv) {
  if (kind !== 'pdf' || !['process-age-checked', 'resume-age-checked'].includes(command)) return undefined;
  const directory = env.FHS_CAMPAIGN_PDF_READS, indexHash = env.FHS_CAMPAIGN_PDF_READS_SHA256;
  if (!directory && !indexHash) return undefined;
  if (!directory || !indexHash) throw Error('fhs_pdf_reads_configuration');
  return openFhsPdfReads(directory, indexHash);
}

async function pinnedFile(path: string, expected: string, maxBytes: number, error: string) {
  if (!digest.test(expected)) throw Error(error);
  const file = await open(path, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > maxBytes) throw Error(error);
    const bytes = await file.readFile();
    if (bytes.length !== stat.size || sha256(bytes) !== expected) throw Error(error);
    return bytes;
  } finally { await file.close(); }
}

/** The locally prepared index digest is delivered separately from the private read-only files. */
export async function openFhsPdfReads(directory: string, indexSha256: string): Promise<typeof extractKnowledgePdf> {
  const raw = await pinnedFile(join(directory, 'index.json'), indexSha256, 512 * 1024, 'fhs_pdf_index_integrity');
  const index = JSON.parse(raw.toString('utf8'));
  if (index.format !== 'fhs-pdf-reads/1' || index.parser !== await fhsPdfParserBinding()
    || !index.records || Array.isArray(index.records) || typeof index.records !== 'object')
    throw Error('fhs_pdf_index_integrity');
  return async (data, options = {}) => {
    if (options.signal?.aborted) throw Error('knowledge_pdf_aborted');
    if (!data.byteLength || (data.byteLength > KNOWLEDGE_PDF_MAX_BYTES && largeFhsPdf(options.expectedHash)?.bytes !== data.byteLength))
      return extractKnowledgePdf(data, options);
    const hash = sha256(data);
    if (options.expectedHash !== undefined && hash !== options.expectedHash) throw Error('knowledge_pdf_hash_mismatch');
    const key = fhsPdfReadKey(hash, options);
    if (!Object.hasOwn(index.records, key)) return extractKnowledgePdf(data, options);
    const record = index.records[key];
    if (typeof record !== 'string' || !digest.test(record)) throw Error('fhs_pdf_read_integrity');
    const bytes = await pinnedFile(join(directory, record), record, KNOWLEDGE_PDF_MAX_BYTES + 2 * 1024 * 1024, 'fhs_pdf_read_integrity');
    if (options.signal?.aborted) throw Error('knowledge_pdf_aborted');
    const result: KnowledgePdfResult = deserialize(bytes);
    if (result.fileHash !== hash || result.startPage !== (options.startPage ?? 1) || !!result.pagePdf !== !!options.includePagePdf)
      throw Error('fhs_pdf_read_integrity');
    return result;
  };
}
