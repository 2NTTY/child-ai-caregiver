import { z } from 'zod';
import { parseKnowledgeSource, sourceVersionHash, embeddingForChunk, internalKnowledgeSource } from '../server/knowledge-inputs.ts';
import { KNOWLEDGE_EMBEDDING } from '../src/shared/knowledge.ts';

import { checkPortableSource, checkPortableSeries, portableSeriesSchema } from '../server/knowledge-portable-series.ts';

const hex = z.string().regex(/^[a-f0-9]{64}$/u);
const vector = z.strictObject({
  chunkKey: z.string().min(1).max(100), inputHash: hex, model: z.string().min(1).max(180), dimensions: z.int().min(1).max(4096),
  pipeline: z.string().min(1).max(100), values: z.array(z.number().finite().min(-1e10).max(1e10)).min(1).max(4096),
}).refine(row => row.values.length === row.dimensions && row.values.some(v => v !== 0));
const edition = z.strictObject({ source: z.unknown(), versionHash: hex, library: portableSeriesSchema.optional(), embeddings: z.array(vector).max(32) });
function reject(reason) { throw new Error(reason); }

export function readPortableEdition(raw, entry) {
  if (raw?.kind === 'published_reference') reject('knowledge_transfer_reference_only');
  const data = edition.parse(raw), source = parseKnowledgeSource(data.source);
  if (source.sourceId !== entry.sourceId || data.versionHash !== entry.versionHash || sourceVersionHash(source) !== entry.versionHash)
    reject('knowledge_transfer_binding_invalid');
  if (internalKnowledgeSource(source.url)) reject('knowledge_transfer_internal_source');
  checkPortableSource(source);
  const library = data.library ? checkPortableSeries(source, data.library) : undefined;
  const checked = [], seen = new Set();
  for (const row of data.embeddings) {
    const chunk = source.chunks.find(item => item.key === row.chunkKey);
    if (!chunk || seen.has(row.chunkKey)) reject('knowledge_transfer_vector_invalid');
    seen.add(row.chunkKey);
    if (library && library.vectorSpace !== 'vertex-retrieval-document-cosine' || row.model !== KNOWLEDGE_EMBEDDING.model || row.dimensions !== KNOWLEDGE_EMBEDDING.dimensions || row.pipeline !== KNOWLEDGE_EMBEDDING.pipeline) continue;
    if (row.inputHash !== embeddingForChunk(source.title, chunk).hash) reject('knowledge_transfer_vector_invalid');
    checked.push(row);
  }
  return { source, embeddings: checked, ...(library ? { library } : {}) };
}

export async function importKnowledgePage({ ledger, store, archive, digest, operator, limit, signal, expectedRevision }) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 4096) reject('knowledge_transfer_page_invalid');
  signal?.throwIfAborted();
  let job = await ledger.start(digest, archive.entries.length, operator);
  if (expectedRevision !== undefined && job.revision !== expectedRevision) reject('knowledge_transfer_changed');
  for (let done = 0; done < limit && job.state === 'ready'; done++) {
    signal?.throwIfAborted();
    const entry = archive.entries[job.next];
    try {
      const portable = readPortableEdition(await archive.readEdition(job.next), entry);
      signal?.throwIfAborted();
      await store.importSource(portable.source, ledger.fence(job, entry, operator), portable.library);
    } catch (error) {
      signal?.throwIfAborted();
      const reason = error instanceof z.ZodError ? 'knowledge_transfer_edition_invalid'
        : /^knowledge_[a-z_]{1,100}$/u.test(error?.code ?? '') ? error.code : error?.message;
      // A transport failure may follow a committed write. Look up the same batch before taking further action.
      if (reason === 'knowledge_transfer_changed' || !/^knowledge_[a-z_]{1,100}$/u.test(reason ?? ''))
        reject(reason === 'knowledge_transfer_changed' ? reason : 'knowledge_transfer_result_unknown_check_status');
      await ledger.fail(job, entry, reason, operator);
      reject(reason);
    }
    const next = await ledger.get(digest);
    if (next?.revision !== job.revision + 1 && next?.state === 'ready') reject('knowledge_transfer_changed');
    job = next;
  }
  return job;
}
