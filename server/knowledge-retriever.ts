import type { KnowledgeFilter, KnowledgeResult, KnowledgeEvidence, KnowledgeContextCursor, KnowledgeContextResult, KnowledgeContextChunk } from "../src/shared/knowledge.ts";
import { AgentStopped, agentBudgetFingerprint, type AgentBudget } from "./agent-budget.ts";
import { FamilyError } from "./family-access.ts";
import { EmbeddingFailure } from "./embedding-failure.ts";
import type { EmbeddingActor, EmbeddingGateway } from "./embedding-gateway.ts";
import { parseKnowledgeFilter, parseKnowledgeQuery } from "./knowledge-inputs.ts";
import { assertPublicKnowledgeQuery } from "./knowledge-query-minimization.ts";
import { firstHitPerSource, rankKnowledge } from "./knowledge-ranking.ts";
import { includeLeafletInSearch } from './fhs-leaflet-editions.ts';
import { procedureReadingPreview } from './knowledge-procedure-reading.ts';
import { readReviewedChart } from './knowledge-pdf-layout.ts';
import type { KnowledgeStore } from "./knowledge-store.ts";

import { comparableCardPassages, isKnowledgeEvidenceFresh, readReusableEvidence, sameReviewedEdition } from "./agent-evidence-reuse.ts";
export { isKnowledgeEvidenceFresh } from "./agent-evidence-reuse.ts";

function canonicalFilterKey(filter: KnowledgeFilter): string {
  return JSON.stringify({
    region: filter.region,
    classification: filter.classification,
    age: filter.age ? { basis: filter.age.basis, minMonths: filter.age.minMonths, maxMonths: filter.age.maxMonths } : null,
    ageMatch: filter.ageMatch ?? null,
    ...(filter.purpose?{purpose:filter.purpose}:{}),
    topics: [...filter.topics].sort(),
  });
}

function requestsVideoList(query: string) {
  if (!/影片|短片|視像|视频|劇本|文字稿|videos?|transcripts?/iu.test(query)) return false;
  return /片名|(?:影片|短片|視像|视频|劇本|文字稿)(?:的|嘅)?(?:題名|名稱|列表|目錄|清單)|(?:邊[幾啲]|哪[幾些]|有[咩乜]|所有|全部|列出|[\d一二兩三四五六七八九十幾]+)(?:個|套|條|段|的|嘅)?\s*(?:影片|短片|視像|视频|劇本|文字稿)|(?:list(?: of)?|which|all|titles? of)\s+(?:the\s+)?(?:videos?|transcripts?)|(?:video|transcript)\s+(?:titles?|list)/iu.test(query);
}

function namedVideoMaterial(query: string, ranked: KnowledgeEvidence[]) {
  if (/整張|整個系列|全卡|全庫|全系列|跨(?:文件|教材)|(?:所有|全部|各份)教材|across|whole (?:card|series)/iu.test(query)) return undefined;
  const normalize = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/gu, '');
  const question = normalize(query);
  const named = new Map<string, KnowledgeEvidence>();
  for (const row of ranked) {
    const title = normalize(row.title.split(/\s+[-－—]\s+|[（(]/u, 1)[0] ?? '');
    if (title.length >= 4 && question.includes(title)) named.set(row.versionId, row);
  }
  return named.size === 1 ? [...named.values()][0] : undefined;
}

function normalizeScriptTitle(title: string) {
  return title.normalize('NFKC').toLowerCase().replace(/\s+/gu, '');
}
function requestedScriptTitle(query: string) {
  const quoted = [...query.matchAll(/《([^《》]+)》/gu)];
  return quoted.length > 1 ? null : normalizeScriptTitle(quoted[0]?.[1] ?? query);
}
function exactScriptHit(title: string, rows: KnowledgeEvidence[]) {
  return rows.find(row => row.scriptPassage && normalizeScriptTitle(row.scriptPassage.title) === title);
}

export function createKnowledgeRetriever(store: Pick<KnowledgeStore, "candidates"> & { readonly enforcesPersonalLibrarySelection?: boolean }, embeddings: EmbeddingGateway) {
  return {
    /** One instance per authorized Agent run; never share queries or caches between families. */
    createRun(options: { actor: EmbeddingActor; budget: AgentBudget; authorize: () => Promise<boolean>; embeddings?: EmbeddingGateway; publicOnly?: boolean }) {
      if (options.actor.kind !== "query_embedding") throw new Error("Invalid knowledge query actor");
      const { actor, budget, authorize } = options;
      const readCandidates = async (filter: KnowledgeFilter, vector: readonly number[] | null, selection: NonNullable<Parameters<KnowledgeStore['candidates']>[2]>) => {
        const candidates=await store.candidates(filter, vector, options.publicOnly ? selection : { ...selection, libraryUserId: actor.actorId });
        return filter.purpose==='read_originals'?candidates:candidates.filter(chunk=>chunk.applicability?.use!=='original_lookup');
      };
      const loaded = new Map<string, KnowledgeEvidence>();
      const issuedCursors = new Set<string>();
      const cache = new Map<string, Promise<number[] | null>>();
      const contextReadCache = new Map<string, { contentHash: string; result: KnowledgeContextResult; chunks: KnowledgeEvidence[] }>();
      // The same live read owns both validity and reviewed wording. Original-read coverage is separate.
      async function readReviewedCitations(citations: { chunkId: string; versionId: string; contentHash: string }[], applicability: KnowledgeFilter): Promise<KnowledgeEvidence[] | null> {
        if (!citations.length || citations.length > 6 || new Set(citations.map(item => item.chunkId)).size !== citations.length) return null;
        budget.check();
        if (!await budget.wait(authorize)) throw new EmbeddingFailure("unauthorized");
        const current = await budget.wait(() => readCandidates(parseKnowledgeFilter(applicability), null, { chunkIds: citations.map(item => item.chunkId), limit: 6 }));
        const now = Date.now();
        const matched = citations.map(citation => current.find(chunk => sameReviewedEdition(citation, chunk, applicability, now)));
        if (!await budget.wait(authorize)) throw new EmbeddingFailure("unauthorized");
        if (matched.some(chunk => !chunk)) return null;
        return matched.map(chunk => {
          const { distance: _distance, rankScore: _rankScore, ...candidate } = chunk!;
          const {originalText:_originalText,...reviewed}=procedureReadingPreview(candidate,applicability);
          return { ...reviewed, readCoverage: { kind: "reviewed_text_and_excerpt" as const, complete: false } };
        });
      }
      return {
        supportsScopedEvidenceReuse: store.enforcesPersonalLibrarySelection === true,
        async search(input: string, applicability: KnowledgeFilter, queryEmbeddingAttemptKey?: string): Promise<KnowledgeResult> {
          const query = assertPublicKnowledgeQuery(parseKnowledgeQuery(input));
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
          const videoList = requestsVideoList(query);
          const rawCandidates = await budget.wait(() => readCandidates(filter, vector, { query, ...(videoList ? { preferDistinctSources: true } : {}) }));
          const now = Date.now();
          const searchable = (candidate: KnowledgeEvidence) => isKnowledgeEvidenceFresh(candidate, now)
            && includeLeafletInSearch(query, candidate.url, candidate.extraction);
          const candidates = rawCandidates.filter(searchable);
          let ranked = rankKnowledge(query, candidates), omittedScripts = 0;
          const title = !videoList && requestedScriptTitle(query);
          if (title) {
            let exact = exactScriptHit(title, ranked);
            const films = ranked.flatMap(row => row.scriptPassage ? [row.scriptPassage.url] : []);
            // One long film can occupy several of the first six places. Check other eligible materials with the same query vector.
            if (!exact && filter.purpose === 'read_originals' && new Set(films).size < films.length
              && (query.includes('《') || !/[。！？!?]\s*\S/u.test(query))) {
              const distinct = await budget.wait(() => readCandidates(filter, vector, {query,preferDistinctSources:true}));
              exact = exactScriptHit(title, rankKnowledge(query, distinct.filter(searchable)));
            }
            if (exact && ranked[0]?.chunkId !== exact.chunkId)
              ranked = [exact, ...ranked.filter(row => row.chunkId !== exact.chunkId)].slice(0,6);
          }
          const anchor = videoList ? namedVideoMaterial(query, ranked) : undefined;
          if (anchor) {
            // Expand only a uniquely named material, through the same family and applicability gates.
            const edition = await budget.wait(() => readCandidates(filter, null, { versionId: anchor.versionId, limit: 60 }));
            if (!edition.some(row => row.chunkId === anchor.chunkId && row.contentHash === anchor.contentHash && row.versionHash === anchor.versionHash))
              throw new FamilyError(409, 'knowledge_context_source_changed');
            const firstPerPage = new Map<string, KnowledgeEvidence>();
            for (const row of edition) {
              const script = row.scriptPassage;
              if (script && row.versionId === anchor.versionId && row.versionHash === anchor.versionHash && row.sourceId === anchor.sourceId
                && !firstPerPage.has(script.url) && isKnowledgeEvidenceFresh(row, now)) {
                const { distance: _distance, rankScore: _rank, ...chunk } = row;
                firstPerPage.set(script.url, chunk);
              }
            }
            if (firstPerPage.size) {
              ranked = [...firstPerPage.values()].slice(0, 6);
              omittedScripts = firstPerPage.size - ranked.length;
            } else ranked = ranked.filter(row => row.sourceId === anchor.sourceId && row.versionId === anchor.versionId);
          }
          if (videoList && !anchor) {
            // Keep evidence from each matched material ahead of further passages from the same one.
            ranked = firstHitPerSource(ranked, row => row.sourceId);
          }
          const chunks = ranked.map(chunk=>procedureReadingPreview(chunk,filter)).map(({ originalText: _originalText, chartFields: _fields, ...chunk }) => ({
            ...chunk, ...(videoList ? { text: chunk.sourceExcerpt.slice(0, 48).toWellFormed() } : {}),
            readCoverage: { kind: "reviewed_text_and_excerpt" as const, complete: false },
          }));
          for (const chunk of chunks) loaded.set(chunk.chunkId, chunk);
          if (!await budget.wait(authorize)) throw new EmbeddingFailure("unauthorized");
          budget.check();
          return { mode: vector ? "vector_keyword" : "keyword_degraded", degradationReason: vector ? null : "embedding_unavailable", chunks,
            ...(videoList ? { videoListScope: anchor ? 'named_material_reviewed_passages' as const : 'matching_materials_reviewed_passages' as const,
              complete: false, hasMore: omittedScripts > 0, omittedChunks: omittedScripts } : {}) };
        },
        async readContext(anchor: KnowledgeEvidence, applicability: KnowledgeFilter, cursor: KnowledgeContextCursor | null = null, maxResponseCharacters = 8000): Promise<KnowledgeContextResult> {
          const known = loaded.get(anchor.chunkId);
          if (!known || known.versionId !== anchor.versionId || known.contentHash !== anchor.contentHash
            || cursor && (cursor.anchorChunkId !== anchor.chunkId || cursor.versionId !== anchor.versionId || !issuedCursors.has(JSON.stringify(cursor))))
            throw new FamilyError(400, "knowledge_context_cursor_invalid");
          budget.check();
          if (!await budget.wait(authorize)) throw new EmbeddingFailure("unauthorized");
          const filter = parseKnowledgeFilter(applicability);
          const contextCacheKey = store.enforcesPersonalLibrarySelection === true && cursor === null
            ? JSON.stringify({ chunkId: anchor.chunkId, versionId: anchor.versionId, filter: canonicalFilterKey(filter), maxResponseCharacters })
            : null;
          const cachedRead = contextCacheKey ? contextReadCache.get(contextCacheKey) : undefined;
          const required = [anchor, ...(cachedRead?.chunks ?? [])];
          const chunkIds = [...new Set(required.map(chunk => chunk.chunkId))];
          const live = await budget.wait(() => readCandidates(filter, null, { chunkIds, versionId: anchor.versionId, limit: chunkIds.length }));
          const now = Date.now();
          if (!required.every(chunk => live.some(item => sameReviewedEdition(chunk, item, filter, now)))) {
            if (contextCacheKey) contextReadCache.delete(contextCacheKey);
            for (const id of chunkIds) loaded.delete(id);
            throw new FamilyError(409, "knowledge_context_source_changed");
          }
          if (cachedRead && cachedRead.contentHash === anchor.contentHash && cachedRead.result.complete) {
            for (const item of cachedRead.chunks) loaded.set(item.chunkId, item);
            if (!await budget.wait(authorize)) throw new EmbeddingFailure("unauthorized");
            budget.check();
            return structuredClone(cachedRead.result);
          }
          const chunkId = cursor?.chunkId ?? (cursor ? null : anchor.chunkId);
          const first = chunkId ? await budget.wait(() => readCandidates(filter, null, { chunkIds: [chunkId], versionId: anchor.versionId, limit: 1 })) : [];
          if (chunkId && !first.length) throw new FamilyError(409, "knowledge_context_source_changed");
          const afterKey = first[0]?.key ?? cursor?.afterKey ?? anchor.key;
          const following = await budget.wait(() => readCandidates(filter, null, { versionId: anchor.versionId, afterKey, limit: 4 }));
          const queue = [...first, ...following], output: KnowledgeContextChunk[] = [];
          if (queue.some(item => item.sourceId !== anchor.sourceId || item.versionId !== anchor.versionId
            || item.versionHash !== anchor.versionHash || item.classification !== filter.classification || !isKnowledgeEvidenceFresh(item)))
            throw new FamilyError(409, "knowledge_context_source_changed");
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
            const { distance: _distance, rankScore: _rankScore, text: _text, chartFields: _fields, originalText, ...metadata } = candidate;
            const original = originalText ?? candidate.sourceExcerpt, offset = processed === 0 ? cursor?.offset ?? 0 : 0;
            if (offset > original.length) throw new FamilyError(400, "knowledge_context_offset_invalid");
            const maxLength = Math.min(original.length - offset, 6000 - characters);
            const reviewedChart = filter.purpose === 'read_originals' ? readReviewedChart(candidate) : undefined;
            const entry: KnowledgeContextChunk = { ...metadata,
              ...(reviewedChart && {reviewedChart}),
              original: { text: "", offset, nextOffset: offset, totalCharacters: original.length,
              coverage: originalText && !candidate.originalKind ? "chunk_original" : "excerpt_only" } };
            output.push(entry);
            const select = (length: number) => {
              entry.original.text = original.slice(offset, offset + length);
              entry.original.nextOffset = offset + length < original.length ? offset + length : null;
              entry.readCoverage = entry.reviewedChart ? { kind: 'reviewed_visual_page', complete: false } : candidate.originalKind
                ? { kind: "reviewed_text_and_excerpt", complete: false }
                : { kind: "original_segment", complete: offset === 0 && entry.original.nextOffset === null,
                  offset, nextOffset: entry.original.nextOffset, totalCharacters: original.length };
              nextCursor = entry.original.nextOffset === null
                ? (queue[processed + 1] ? { versionId: anchor.versionId, anchorChunkId: anchor.chunkId, afterKey: candidate.key, chunkId: queue[processed + 1].chunkId, offset: 0 } : null)
                : { versionId: anchor.versionId, anchorChunkId: anchor.chunkId, afterKey: candidate.key, chunkId: candidate.chunkId, offset: offset + length };
            };
            let low = 0, high = maxLength;
            while (low < high) { const middle = Math.ceil((low + high) / 2); select(middle); if (fits()) low = middle; else high = middle - 1; }
            select(low);
            if (low === 0 && (original.length > offset || !fits())) {
              output.pop(); nextCursor = { versionId: anchor.versionId, anchorChunkId: anchor.chunkId, afterKey: candidate.key, chunkId: candidate.chunkId, offset };
              if (!output.length) throw new FamilyError(400, "knowledge_context_response_capacity");
              break;
            }
            loaded.set(candidate.chunkId, { ...metadata, text: candidate.originalKind === "visual_page" ? candidate.text : entry.original.text, readCoverage: entry.readCoverage });
            characters += low; processed++;
            if (entry.original.nextOffset !== null) break;
          }
          if (nextCursor) issuedCursors.add(JSON.stringify(nextCursor));
          if (!fits()) throw new FamilyError(400, "knowledge_context_response_capacity");
          if (!await budget.wait(authorize)) throw new EmbeddingFailure("unauthorized");
          budget.check();
          const finalResult = result();
          if (contextCacheKey && finalResult.complete) {
            const cachedChunks = finalResult.chunks
              .map(chunk => loaded.get(chunk.chunkId))
              .filter((chunk): chunk is KnowledgeEvidence => Boolean(chunk));
            contextReadCache.set(contextCacheKey, {
              contentHash: anchor.contentHash,
              result: structuredClone(finalResult),
              chunks: structuredClone(cachedChunks),
            });
          }
          return finalResult;
        },
        readReviewedCitations,
        async readComparablePassages(anchor: KnowledgeEvidence, applicability: KnowledgeFilter): Promise<KnowledgeEvidence[]> {
          if (!anchor.series || store.enforcesPersonalLibrarySelection !== true) return [];
          if (!await budget.wait(authorize)) throw new EmbeddingFailure('unauthorized');
          const filter = parseKnowledgeFilter(applicability);
          const query = [anchor.section, ...anchor.applicability.conditions].join(' ').slice(0, 2000);
          const rows = await budget.wait(() => readCandidates(filter, null, { query, preferDistinctSources: true, limit: 6 }));
          if (!await budget.wait(authorize)) throw new EmbeddingFailure('unauthorized');
          return rankKnowledge(query, rows).filter(row => isKnowledgeEvidenceFresh(row) && comparableCardPassages(anchor, row)
            && includeLeafletInSearch(query, row.url, row.extraction)).map(({originalText: _original, citedExcerpt: _quote, ...row}) =>
              ({ ...row, readCoverage: { kind: 'reviewed_text_and_excerpt', complete: false } }));
        },
        async revalidateAndSeedEvidence(
          priorCitations: readonly KnowledgeEvidence[],
          applicability: KnowledgeFilter,
        ): Promise<{ valid: KnowledgeEvidence[]; invalidated: KnowledgeEvidence[] }> {
          budget.check();
          if (!await budget.wait(authorize)) throw new EmbeddingFailure("unauthorized");
          // Legacy/global readers can accept the option but cannot attest to this owner's grants.
          if (store.enforcesPersonalLibrarySelection !== true) {
            for (const item of priorCitations) loaded.delete(item.chunkId);
            return { valid: [], invalidated: [...priorCitations] };
          }
          const result = await readReusableEvidence(actor.actorId, parseKnowledgeFilter(applicability), priorCitations,
            (filter, selection) => budget.wait(() => readCandidates(filter, null, selection)));
          if (!await budget.wait(authorize)) throw new EmbeddingFailure("unauthorized");
          for (const item of result.invalidated) loaded.delete(item.chunkId);
          for (const item of result.valid) loaded.set(item.chunkId, item);
          return result;
        },
        seedEvidence(items: readonly KnowledgeEvidence[]) {
          for (const item of items) loaded.set(item.chunkId, item);
        },
        async revalidateCitations(citations: { chunkId: string; versionId: string; contentHash: string }[], applicability: KnowledgeFilter): Promise<boolean> {
          return await readReviewedCitations(citations, applicability) !== null;
        },
      };
    },
  };
}
