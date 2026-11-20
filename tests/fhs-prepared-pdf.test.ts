import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serialize } from 'node:v8';
import { fhsPdfParserBinding, openFhsPdfReads, openFhsCampaignPdfReads, resolveFhsPdfObservation } from '../scripts/fhs-pdf-reads.ts';
import { knowledgeOperationId } from '../server/firestore-knowledge-maintenance.ts';
import type { ObservedContent } from '../server/knowledge-refresh-types.ts';
import { knowledgeOriginalManifest } from '../server/firestore-knowledge-originals.ts';

const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');

test('a recovered parser receipt keeps the original work and must match the assigned PDF and physical page count', async () => {
  const operation = 'a'.repeat(64), primary = knowledgeOperationId('knowledge-observation/1', operation);
  const recovery = knowledgeOperationId('knowledge-observation/parser-recovery/1', operation);
  const pin = {sourceId:'book', url:'https://www.fhs.gov.hk/book.pdf', sha256:'b'.repeat(64), pages:4};
  const job = {watchId:pin.sourceId, revision:'r', workerGeneration:'g'};
  const item: ObservedContent = {url:pin.url, title:'Book', text:'', sourcePublishedAt:null, sourceUpdatedAt:null, sourceDateText:null,
    nativeWindowMethod:'native-pdf-window/1', extraction:{format:'text_pdf', contentHash:pin.sha256, totalPages:4,
      extractionQuality:'requires_review', pageStart:1, pageEnd:4, complete:false}};
  const failed = {status:'failed' as const, reason:'parse' as const};
  const ok = {status:'ok' as const, items:[item]};
  const refresh = {resumeCheck:async (_job: typeof job, id: string) => id === primary ? failed : id === recovery ? ok : null};
  assert.deepEqual(await resolveFhsPdfObservation(refresh, job, operation, pin), {checkId:recovery, snapshot:ok});
  for (const other of [{...pin, pages:5}, {...pin, sha256:'c'.repeat(64)}, {...pin, url:pin.url+'x'}])
    assert.deepEqual(await resolveFhsPdfObservation(refresh, job, operation, other), {checkId:primary, snapshot:failed});
  assert.deepEqual(await resolveFhsPdfObservation({resumeCheck:async (_job, id) => {
    assert.equal(id, primary); return ok;
  }}, job, operation, pin), {checkId:primary, snapshot:ok});
});

test('a large FHS original is admitted only for its catalogued source, bytes and PDF fingerprint', () => {
  const original = { schemaVersion: 1, projectId: 'demo-fhs', namespace: 'demo', bucketName: 'demo-private', generation: '1',
    sourceId: 'pdf-63e7d5463521682636a066e5', size: 63746648, mimeType: 'application/pdf',
    contentHash: '48db798a9c469d34bb99cd49f55c112c80d8691c77d41d8ec8b0396933396177' };
  assert.deepEqual(knowledgeOriginalManifest.parse(original), original);
  for (const change of [{ sourceId: 'other' }, { size: original.size - 1 }, { contentHash: '0'.repeat(64) }, { mimeType: 'application/rss+xml' }])
    assert.equal(knowledgeOriginalManifest.safeParse({ ...original, ...change }).success, false);
});

test('an initial campaign read reuses only the pinned bytes and exact physical window', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'fhs-pdf-reads-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  // The deliberately incomplete parent cannot yield this result through a fresh parse.
  const original = Buffer.from('%PDF-fixture'), fileHash = hash(original);
  const result = { fileHash, totalPages: 3, startPage: 2, nextPage: 3, complete: false,
    extractionQuality: 'requires_review', pages: [{ page: 2, status: 'empty', text: '' }], pagePdf: Buffer.from('%PDF-slice') };
  const payload = serialize(result), digest = hash(payload);
  const index = Buffer.from(JSON.stringify({ format: 'fhs-pdf-reads/1', parser: await fhsPdfParserBinding(), records: { [fileHash + '.2.1.slice']: digest } }));
  await writeFile(join(dir, digest), payload);
  await writeFile(join(dir, 'index.json'), index);
  const read = await openFhsPdfReads(dir, hash(index));
  const options = { expectedHash: fileHash, startPage: 2, pageLimit: 1, includePagePdf: true };
  assert.deepEqual(await read(original, options), result);
  const environment = {FHS_CAMPAIGN_PDF_READS: dir, FHS_CAMPAIGN_PDF_READS_SHA256: hash(index)};
  for (const command of ['process-age-checked', 'resume-age-checked']) {
    const campaignRead = await openFhsCampaignPdfReads(command, 'pdf', environment);
    assert.deepEqual(await campaignRead!(original, options), result);
    await assert.rejects(openFhsCampaignPdfReads(command, 'pdf', {FHS_CAMPAIGN_PDF_READS:dir}), /fhs_pdf_reads_configuration/);
  }
  assert.equal(await openFhsCampaignPdfReads('resume-age-checked', 'pdf', {}), undefined);
  assert.equal(await openFhsCampaignPdfReads('inspect', 'pdf', environment), undefined);
  await assert.rejects(read(original, { ...options, startPage: 1 }), /knowledge_pdf_unreadable/);
  await assert.rejects(read(Buffer.from('%PDF-changed'), options), /knowledge_pdf_hash_mismatch/);
  await assert.rejects(read(original, { ...options, signal: AbortSignal.abort() }), /knowledge_pdf_aborted/);
  await writeFile(join(dir, digest), serialize({ ...result, totalPages: 9 }));
  await assert.rejects(read(original, options), /fhs_pdf_read_integrity/);
  await assert.rejects(openFhsPdfReads(dir, '0'.repeat(64)), /fhs_pdf_index_integrity/);
});
