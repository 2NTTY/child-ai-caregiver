import {createHash} from 'node:crypto';
import {copyFile, mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {serialize} from 'node:v8';
import {observeKnowledgeLeaflet} from '../server/knowledge-source-fetch.ts';
import {manualPdfWindowBudget, planKnowledgePdfWindows} from '../server/knowledge-pdf-windows.ts';
import {campaignMaterialWatches} from '../server/platform-materials.ts';
import {fhsPdfReadKey, openFhsPdfReads} from './fhs-pdf-reads.ts';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');

/** Keep original resumable windows and stage new layouts with the same pinned parser. */
export async function stageFhsPdfReads({sources, originals, prepared, indexSha256, outputParent, textOnly = false}) {
  const full = await readFile(join(prepared, 'index.json'));
  if (sha(full) !== indexSha256) throw Error('fhs_pdf_index_integrity');
  const index = JSON.parse(full.toString('utf8'));
  const read = await openFhsPdfReads(prepared, indexSha256);
  const records = {}, sourceReads = [];
  const identities = new Set(sources.map(row => row.sourceId));
  if (!sources.length || identities.size !== sources.length) throw Error('fhs_pdf_input_scope');
  await mkdir(outputParent, {recursive:true});
  const directory = await mkdtemp(join(outputParent, 'fhs-pdf-reads-'));
  const generated = new Set();
  const signal = new AbortController().signal;
  const capture = async (bytes, options = {}, allowNewRead = false) => {
    const key = fhsPdfReadKey(options.expectedHash ?? sha(bytes), options);
    const existing = Object.hasOwn(index.records, key);
    if (!existing && !allowNewRead) throw Error('fhs_pdf_prepared_read_missing');
    const result = await read(bytes, options);
    if (!textOnly || !options.includePagePdf) {
      if (existing) records[key] = index.records[key];
      else {
        const packed = serialize(result), digest = sha(packed);
        await writeFile(join(directory, digest), packed);
        generated.add(digest);
        records[key] = digest;
      }
    }
    return result;
  };
  for (const {sourceId, sha256, pages} of sources) {
    const definition = campaignMaterialWatches.find(watch => watch.id === sourceId);
    if (definition?.kind !== 'pdf' || definition.audience !== 'public_noncommercial' || !Number.isSafeInteger(pages) || pages < 1)
      throw Error('fhs_pdf_input_scope');
    const original = await readFile(join(originals, sha(definition.url)));
    if (sha(original) !== sha256) throw Error('fhs_pdf_original_changed');
    const result = await observeKnowledgeLeaflet(definition, original, definition.title, null, 'catalogue-pdf-original/1', signal, capture);
    const item = result.status === 'ok' && result.items.length === 1 ? result.items[0] : null;
    if (item?.extraction?.totalPages !== pages || item.extraction.contentHash !== sha256) throw Error('fhs_pdf_observation_changed');
    // The family receipt opens the parent PDF at any cited page, including the final partial block.
    if (sources.length === 1 && !textOnly) {
      for (let startPage = 1; startPage <= pages; startPage += 8) {
        const options = {expectedHash:sha256, startPage, pageLimit:Math.min(8, pages - startPage + 1)};
        if (Object.hasOwn(records, fhsPdfReadKey(sha256, options))) continue;
        const block = await capture(original, options, true);
        if (block.totalPages !== pages || block.pages.length !== options.pageLimit) throw Error('fhs_pdf_window_source_mismatch');
      }
    }
    const budget = item.nativeWindowMethod ? manualPdfWindowBudget(pages) : null;
    const windows = budget ? planKnowledgePdfWindows(pages, budget.modelCalls) : [];
    const modelCalls = Math.max(1, windows.length) * 2;
    const summary = {sourceId, sha256, pages, route: windows.length ? 'windows' : 'whole', minimumModelCalls:modelCalls};
    const windowInputs = [];
    const legacy = budget ? planKnowledgePdfWindows(pages, budget.modelCalls, 14) : [];
    const sameSlice = (a, b) => a.firstRead === b.firstRead && a.lastRead === b.lastRead;
    for (const range of [...windows, ...legacy.filter(old => !windows.some(w => sameSlice(w, old)))]) {
      const newWindow = !legacy.some(old => sameSlice(range, old));
      const count = range.lastRead - range.firstRead + 1;
      const slice = await capture(original, {expectedHash:sha256, startPage:range.firstRead, pageLimit:count, includePagePdf:true}, newWindow);
      if (!slice.pagePdf || slice.totalPages !== pages || slice.pages.length !== count) throw Error('fhs_pdf_window_source_mismatch');
      const sliceHash = sha(slice.pagePdf);
      for (let startPage = 1; startPage <= count; startPage += 8) {
        const inner = await capture(slice.pagePdf, {expectedHash:sliceHash, startPage, pageLimit:8}, newWindow);
        if (inner.totalPages !== count || inner.pages.length !== Math.min(8, count - startPage + 1)) throw Error('fhs_pdf_window_source_mismatch');
      }
      if (windows.includes(range)) windowInputs.push({first:range.first, last:range.last, firstRead:range.firstRead, lastRead:range.lastRead, sha256:sliceHash});
    }
    sourceReads.push({...summary, ...(windows.length ? {windows:windowInputs} : {})});
  }
  const digests = [...new Set(Object.values(records))].sort();
  for (const digest of digests) {
    const destination = join(directory, digest);
    if (!generated.has(digest)) await copyFile(join(prepared, digest), destination);
    if (sha(await readFile(destination)) !== digest) throw Error('fhs_pdf_read_integrity');
  }
  const sorted = Object.fromEntries(Object.entries(records).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  const manifest = Buffer.from(JSON.stringify({...index, records:sorted}));
  await writeFile(join(directory, 'index.json'), manifest);
  return {directory, indexSha256:sha(manifest), parser:index.parser, records:digests.length, sources:sourceReads};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [originals, prepared, outputParent, selection, ...extra] = process.argv.slice(2);
  if (!originals || !prepared || !outputParent || extra.length)
    throw Error('Use fhs-stage-pdf-reads.mjs ORIGINALS PREPARED_READS OUTPUT_PARENT [--text-only|SOURCE_ID]');
  const json = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
  const frozen = await json('../knowledge/fhs-initial-publication-lanes.json');
  const evidence = await json('../artifacts/verification/FHS_INITIAL_PDF_READS_20261120.json');
  const assigned = frozen.lanes.flatMap(lane => lane.sources);
  const textOnly = selection === '--text-only';
  const sources = !selection || textOnly ? assigned : assigned.filter(row => row.sourceId === selection);
  const staged = await stageFhsPdfReads({sources, originals, prepared, indexSha256:evidence.archive.indexSha256, outputParent, textOnly});
  console.log(JSON.stringify(staged));
}
