import { knowledgeHash } from "./knowledge-inputs.ts";
import { knowledgeIndexTokens } from "./knowledge-ranking.ts";
import type { KnowledgeChunkInput } from "../src/shared/knowledge.ts";

export const KNOWLEDGE_LEXICAL_PIPELINE = "lexical-v1" as const;
export const KNOWLEDGE_LEXICAL_BUCKETS = 256;
export const KNOWLEDGE_LEXICAL_BATCH = 64;
export interface LexicalMatch { chunkId: string; score: number }
export type LexicalTerms = Record<string, LexicalMatch[]>;
export const emptyLexicalHash = knowledgeHash({});
export const lexicalTokenHash = (token: string) => knowledgeHash([KNOWLEDGE_LEXICAL_PIPELINE, token]);
export const lexicalBucket = (hash: string) => Number.parseInt(hash.slice(0, 2), 16);

/** Public, rebuildable postings only. No body text or private information is copied here. */
export function knowledgeLexicalIndex(title: string, chunks: readonly { chunkId: string; document: KnowledgeChunkInput }[]) {
  const buckets: LexicalTerms[] = Array.from({ length: KNOWLEDGE_LEXICAL_BUCKETS }, () => ({}));
  for (const { chunkId, document } of chunks) {
    const scores = new Map<string, number>();
    const add = (text: string, weight: number) => {
      for (const token of knowledgeIndexTokens(text)) scores.set(token, (scores.get(token) ?? 0) + weight);
    };
    add(title, 4); add(document.section, 3); add(document.text, 1);
    document.keywords.forEach(text => add(text, 5)); document.applicability.topics.forEach(text => add(text, 4));
    for (const [token, score] of scores) {
      const hash = lexicalTokenHash(token), bucket = buckets[lexicalBucket(hash)]!;
      (bucket[hash] ??= []).push({ chunkId, score });
    }
  }
  // Stable ordering makes repeated staging and subsequent reads independently verifiable.
  const ordered = buckets.map(bucket => Object.fromEntries(Object.keys(bucket).sort().map(key => [key,
    bucket[key]!.sort((a, b) => a.chunkId < b.chunkId ? -1 : a.chunkId > b.chunkId ? 1 : 0)])));
  return { buckets: ordered, hashes: ordered.map(knowledgeHash), termCount: ordered.reduce((n, bucket) => n + Object.keys(bucket).length, 0) };
}
