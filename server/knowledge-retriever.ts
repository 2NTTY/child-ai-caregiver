import type { KnowledgeFilter, KnowledgeResult } from "../src/shared/knowledge.ts";
import type { AgentBudget } from "./agent-budget.ts";
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
      const cache = new Map<string, Promise<number[] | null>>();
      return {
        async search(input: string, applicability: KnowledgeFilter): Promise<KnowledgeResult> {
          const query = parseKnowledgeQuery(input);
          const filter = parseKnowledgeFilter(applicability);
          budget.check();
          if (!await budget.wait(authorize)) throw new EmbeddingFailure("unauthorized");
          let pending = cache.get(query);
          if (!pending) {
            budget.take("queryEmbeddings");
            pending = (options.embeddings ?? embeddings).embed({ task: "RETRIEVAL_QUERY", text: query }, actor, budget.signal, authorize)
              .catch(error => { if (error instanceof EmbeddingFailure && error.code === "unavailable") return null; throw error; });
            cache.set(query, pending);
          }
          const vector = await budget.wait(() => pending!);
          // Only the vector is cached. Publication, withdrawal, freshness and applicability are always read anew.
          const candidates = await budget.wait(() => store.candidates(filter, vector));
          const chunks = rankKnowledge(query, candidates);
          if (!await budget.wait(authorize)) throw new EmbeddingFailure("unauthorized");
          budget.check();
          return { mode: vector ? "vector_keyword" : "keyword_degraded", degradationReason: vector ? null : "embedding_unavailable", chunks };
        },
        async revalidateCitations(citations: { chunkId: string; versionId: string; contentHash: string }[], applicability: KnowledgeFilter): Promise<boolean> {
          if (!citations.length || citations.length > 6 || new Set(citations.map(item => item.chunkId)).size !== citations.length) return false;
          budget.check();
          if (!await budget.wait(authorize)) throw new EmbeddingFailure("unauthorized");
          const current = await budget.wait(() => store.candidates(parseKnowledgeFilter(applicability), null));
          const valid = citations.every(citation => current.some(chunk => chunk.chunkId === citation.chunkId
            && chunk.versionId === citation.versionId && chunk.contentHash === citation.contentHash));
          if (!await budget.wait(authorize)) throw new EmbeddingFailure("unauthorized");
          return valid;
        },
      };
    },
  };
}
