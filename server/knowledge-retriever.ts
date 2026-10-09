import type { KnowledgeFilter, KnowledgeResult, KnowledgeEvidence, KnowledgeContextCursor, KnowledgeContextResult, KnowledgeContextChunk } from "../src/shared/knowledge.ts";
import { AgentStopped, agentBudgetFingerprint, type AgentBudget } from "./agent-budget.ts";
import { FamilyError } from "./family-access.ts";
import { EmbeddingFailure } from "./embedding-gateway.ts";
import type { EmbeddingActor, EmbeddingGateway } from "./embedding-gateway.ts";
import { parseKnowledgeFilter, parseKnowledgeQuery } from "./knowledge-inputs.ts";
import { rankKnowledge } from "./knowledge-ranking.ts";
import type { KnowledgeStore } from "./knowledge-store.ts";

export function createKnowledgeRetriever(store: Pick<KnowledgeStore, "candidates">, embeddings: EmbeddingGateway) {
  return {
    /** One instance per authorized Agent run; never share queries or caches between families. */
    createRun(options: { actor: EmbeddingActor; budget: AgentBudget; authorize: () => Promise<boolean>; embeddings?: EmbeddingGateway }) {
      if (options.actor.kind !== "query_embedding") throw new Error("Invalid knowledge query actor");
      const { actor, budget, authorize } = options;
      const loaded = new Map<string, KnowledgeEvidence>();
      const issuedCursors = new Set<string>();
      const cache = new Map<string, Promise<number[] | null>>();
      // The same live read owns both validity and reviewed wording. Original-read coverage is separate.
      async function readReviewedCitations(citations: { chunkId: string; versionId: string; contentHash: string }[], applicability: KnowledgeFilter): Promise<KnowledgeEvidence[] | null> {
        if (!citations.length || citations.length > 6 || new Set(citations.map(item => item.chunkId)).size !== citations.length) return null;
        budget.check();
        if (!await budget.wait(authorize)) throw new EmbeddingFailure("unauthorized");
        const current = await budget.wait(() => store.candidates(parseKnowledgeFilter(applicability), null, { chunkIds: citations.map(item => item.chunkId), limit: 6 }));
        const matched = citations.map(citation => current.find(chunk => chunk.chunkId === citation.chunkId
          && chunk.versionId === citation.versionId && chunk.contentHash === citation.contentHash));
        if (!await budget.wait(authorize)) throw new EmbeddingFailure("unauthorized");
        if (matched.some(chunk => !chunk)) return null;
        return matched.map(chunk => {
          const { distance: _distance, rankScore: _rankScore, originalText: _originalText, ...reviewed } = chunk!;
          return { ...reviewed, readCoverage: { kind: "reviewed_text_and_excerpt" as const, complete: false } };
        });
      }
      return {
        async search(input: string, applicability: KnowledgeFilter, queryEmbeddingAttemptKey?: string): Promise<KnowledgeResult> {
          const query = parseKnowledgeQuery(input);
          const filter = parseKnowledgeFilter(applicability);
          budget.check();
          if (!await budget.wait(authorize)) throw new EmbeddingFailure("unauthorized");
          let pending = cache.get(query);
          if (!pending) {
            const embed = () => (options.embeddings ?? embeddings).embed({ task: "RETRIEVAL_QUERY", text: query }, actor, budget.signal, authorize,
              queryEmbeddingAttemptKey ? budget.queryEmbeddingDailyUsage(queryEmbeddingAttemptKey) : undefined)
              .catch(error => { if (error instanceof EmbeddingFailure && error.code === "unavailable") return null; throw error; });
            if (budget.durable) {
              // Cache the whole admission before it can yield to a parallel identical query.
              pending = (async () => {
                if (!queryEmbeddingAttemptKey) throw new AgentStopped("unavailable");
                await budget.admit({ key: queryEmbeddingAttemptKey, fingerprint: agentBudgetFingerprint({ task: "RETRIEVAL_QUERY", text: query }), kind: "embedding", units: 1 });
                await budget.checkDurable();
                return embed();
              })();
            } else {
              budget.take("queryEmbeddings");
              pending = embed();
            }
            cache.set(query, pending);
          }
          const vector = await budget.wait(() => pending!);
          // Only the vector is cached. Publication, withdrawal, freshness and applicability are always read anew.
          const candidates = await budget.wait(() => store.candidates(filter, vector, { query }));
          const chunks = rankKnowledge(query, candidates).map(({ originalText: _originalText, ...chunk }) => ({
            ...chunk, readCoverage: { kind: "reviewed_text_and_excerpt" as const, complete: false },
          }));
          for (const chunk of chunks) loaded.set(chunk.chunkId, chunk);
          if (!await budget.wait(authorize)) throw new EmbeddingFailure("unauthorized");
          budget.check();
          return { mode: vector ? "vector_keyword" : "keyword_degraded", degradationReason: vector ? null : "embedding_unavailable", chunks };
        },
        async readContext(anchor: KnowledgeEvidence, applicability: KnowledgeFilter, cursor: KnowledgeContextCursor | null = null, maxResponseCharacters = 8000): Promise<KnowledgeContextResult> {
          const known = loaded.get(anchor.chunkId);
          if (!known || known.versionId !== anchor.versionId || known.contentHash !== anchor.contentHash
            || cursor && (cursor.anchorChunkId !== anchor.chunkId || cursor.versionId !== anchor.versionId || !issuedCursors.has(JSON.stringify(cursor))))
            throw new FamilyError(400, "knowledge_context_cursor_invalid");
          budget.check();
          if (!await budget.wait(authorize)) throw new EmbeddingFailure("unauthorized");
          const filter = parseKnowledgeFilter(applicability);
          const live = await budget.wait(() => store.candidates(filter, null, { chunkIds: [anchor.chunkId], versionId: anchor.versionId, limit: 1 }));
          if (!live.some(item => item.contentHash === anchor.contentHash)) throw new FamilyError(409, "knowledge_context_source_changed");
          const chunkId = cursor?.chunkId ?? (cursor ? null : anchor.chunkId);
          const first = chunkId ? await budget.wait(() => store.candidates(filter, null, { chunkIds: [chunkId], versionId: anchor.versionId, limit: 1 })) : [];
          if (chunkId && !first.length) throw new FamilyError(409, "knowledge_context_source_changed");
          const afterKey = first[0]?.key ?? cursor?.afterKey ?? anchor.key;
          const following = await budget.wait(() => store.candidates(filter, null, { versionId: anchor.versionId, afterKey, limit: 4 }));
          const queue = [...first, ...following], output: KnowledgeContextChunk[] = [];
          let nextCursor: KnowledgeContextCursor | null = null, characters = 0, processed = 0;
          const result = (): KnowledgeContextResult => ({ versionId: anchor.versionId, anchorChunkId: anchor.chunkId, chunks: output,
            start: output.length ? { key: output[0].key, offset: output[0].original.offset } : null,
            nextCursor, complete: nextCursor === null, coverage: "same_version_chunks" });
          const fits = () => JSON.stringify({ status: "succeeded", data: { result: result() } }).length <= maxResponseCharacters;
          for (const candidate of queue) {
            if (processed >= 3 || characters >= 6000) {
              nextCursor = { versionId: anchor.versionId, anchorChunkId: anchor.chunkId, afterKey: output.at(-1)?.key ?? afterKey, chunkId: candidate.chunkId, offset: 0 };
              break;
            }
            const { distance: _distance, rankScore: _rankScore, text: _text, originalText, ...metadata } = candidate;
            const original = originalText ?? candidate.sourceExcerpt, offset = processed === 0 ? cursor?.offset ?? 0 : 0;
            if (offset > original.length) throw new FamilyError(400, "knowledge_context_offset_invalid");
            const maxLength = Math.min(original.length - offset, 6000 - characters);
            const entry: KnowledgeContextChunk = { ...metadata, original: { text: "", offset, nextOffset: offset, totalCharacters: original.length,
              coverage: originalText ? "chunk_original" : "excerpt_only" } };
            output.push(entry);
            const select = (length: number) => {
              entry.original.text = original.slice(offset, offset + length);
              entry.original.nextOffset = offset + length < original.length ? offset + length : null;
              entry.readCoverage = { kind: "original_segment", complete: offset === 0 && entry.original.nextOffset === null,
                offset, nextOffset: entry.original.nextOffset, totalCharacters: original.length };
              nextCursor = entry.original.nextOffset === null
                ? (queue[processed + 1] ? { versionId: anchor.versionId, anchorChunkId: anchor.chunkId, afterKey: candidate.key, chunkId: queue[processed + 1].chunkId, offset: 0 } : null)
                : { versionId: anchor.versionId, anchorChunkId: anchor.chunkId, afterKey: candidate.key, chunkId: candidate.chunkId, offset: offset + length };
            };
            let low = 0, high = maxLength;
            while (low < high) { const middle = Math.ceil((low + high) / 2); select(middle); if (fits()) low = middle; else high = middle - 1; }
            select(low);
            if (low === 0 && original.length > offset) {
              output.pop(); nextCursor = { versionId: anchor.versionId, anchorChunkId: anchor.chunkId, afterKey: candidate.key, chunkId: candidate.chunkId, offset };
              if (!output.length) throw new FamilyError(400, "knowledge_context_response_capacity");
              break;
            }
            entry.readCoverage = { kind: "original_segment", complete: offset === 0 && entry.original.nextOffset === null,
              offset, nextOffset: entry.original.nextOffset, totalCharacters: original.length };
            loaded.set(candidate.chunkId, { ...metadata, text: entry.original.text, readCoverage: entry.readCoverage });
            characters += low; processed++;
            if (entry.original.nextOffset !== null) break;
          }
          if (nextCursor) issuedCursors.add(JSON.stringify(nextCursor));
          if (!fits()) throw new FamilyError(400, "knowledge_context_response_capacity");
          if (!await budget.wait(authorize)) throw new EmbeddingFailure("unauthorized");
          budget.check(); return result();
        },
        readReviewedCitations,
        async revalidateCitations(citations: { chunkId: string; versionId: string; contentHash: string }[], applicability: KnowledgeFilter): Promise<boolean> {
          return await readReviewedCitations(citations, applicability) !== null;
        },
      };
    },
  };
}
