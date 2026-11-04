import { z } from 'zod';
import { parseKnowledgeSource, sourceVersionHash, embeddingDocument, internalKnowledgeSource } from '../server/knowledge-inputs.ts';
import { KNOWLEDGE_EMBEDDING } from '../src/shared/knowledge.ts';

const hex = z.string().regex(/^[a-f0-9]{64}$/u);
const vector = z.strictObject({
  chunkKey: z.string().min(1).max(100), inputHash: hex, model: z.string().min(1).max(180), dimensions: z.int().min(1).max(4096),
  pipeline: z.string().min(1).max(100), values: z.array(z.number().finite().min(-1e10).max(1e10)).min(1).max(4096),
}).refine(row => row.values.length === row.dimensions && row.values.some(v => v !== 0));
const edition = z.strictObject({ source: z.unknown(), versionHash: hex, embeddings: z.array(vector).max(32) });
function reject(reason) { throw new Error(reason); }

export function readPortableEdition(raw, entry) {
  const data = edition.parse(raw), source = parseKnowledgeSource(data.source);
  if (source.sourceId !== entry.sourceId || data.versionHash !== entry.versionHash || sourceVersionHash(source) !== entry.versionHash)
    reject('knowledge_transfer_binding_invalid');
  if (internalKnowledgeSource(source.url)) reject('knowledge_transfer_internal_source');
  const checked = [], seen = new Set();
  for (const row of data.embeddings) {
    const chunk = source.chunks.find(item => item.key === row.chunkKey);
    if (!chunk || seen.has(row.chunkKey)) reject('knowledge_transfer_vector_invalid');
    seen.add(row.chunkKey);
    if (row.model !== KNOWLEDGE_EMBEDDING.model || row.dimensions !== KNOWLEDGE_EMBEDDING.dimensions || row.pipeline !== KNOWLEDGE_EMBEDDING.pipeline) continue;
    if (row.inputHash !== embeddingDocument(source.title, chunk.section, chunk.text).hash) reject('knowledge_transfer_vector_invalid');
    checked.push(row);
  }
  return { source, embeddings: checked };
}

export async function importKnowledgePage({ ledger, store, archive, digest, operator, limit }) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 4096) reject('knowledge_transfer_page_invalid');
  let job = await ledger.start(digest, archive.entries.length, operator);
  for (let done = 0; done < limit && job.state === 'ready'; done++) {
    const entry = archive.entries[job.next];
    try {
      const portable = readPortableEdition(await archive.readEdition(job.next), entry);
      await store.importSource(portable.source, ledger.fence(job, entry, operator));
    } catch (error) {
      const reason = error instanceof z.ZodError ? 'knowledge_transfer_edition_invalid'
        : /^knowledge_[a-z_]{1,100}$/u.test(error?.code ?? '') ? error.code : error?.message;
      // A transport failure may follow a committed write. Look up the same batch before taking further action.
      if (reason === 'knowledge_transfer_changed' || !/^knowledge_[a-z_]{1,100}$/u.test(reason ?? ''))
        reject(reason === 'knowledge_transfer_changed' ? reason : 'knowledge_transfer_result_unknown_check_status');
      await ledger.fail(job, entry, reason, operator);
      reject(reason);
    }
    job = await ledger.get(digest);
  }
  return job;
}
