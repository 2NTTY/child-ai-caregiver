/** Public knowledge only. Child scope and age bounds must be supplied by the server. */
export const KNOWLEDGE_EMBEDDING = Object.freeze({ model: "gemini-embedding-001", dimensions: 1024, pipeline: "section-v1" });
export type KnowledgeClass = "official_guidance" | "recent_information";
export interface KnowledgeApplicability {
  region: string;
  ageBasis: "actual" | "corrected" | "any";
  minAgeMonths: number | null;
  maxAgeMonths: number | null;
  maxAgeMonthsExclusive?: boolean;
  topics: string[];
  conditions: string[];
}
export interface KnowledgeFilter {
  region: string;
  classification: KnowledgeClass;
  age: { basis: "actual" | "corrected"; minMonths: number; maxMonths: number } | null;
  topics: string[];
}
export interface KnowledgeChunkInput {
  key: string;
  section: string;
  sourceExcerpt: string;
  text: string;
  keywords: string[];
  applicability: KnowledgeApplicability;
}
export interface KnowledgeSourceInput {
  sourceId: string;
  url: string;
  title: string;
  publisher: string;
  classification: KnowledgeClass;
  sourcePublishedAt: string | null;
  sourceUpdatedAt: string | null;
  /** Preserve month/year-only source labels without inventing an exact publication time. */
  sourceDateText?: string | null;
  validUntil?: string | null;
  fetchedAt: string;
  termsUrl: string;
  chunks: KnowledgeChunkInput[];
}
export interface KnowledgeEvidence extends KnowledgeChunkInput {
  chunkId: string;
  sourceId: string;
  versionId: string;
  versionHash: string;
  contentHash: string;
  url: string;
  title: string;
  publisher: string;
  classification: KnowledgeClass;
  sourcePublishedAt: string | null;
  sourceUpdatedAt: string | null;
  sourceDateText?: string | null;
  validUntil?: string | null;
  fetchedAt: string;
  checkedAt: string;
  reviewState: "reviewed";
}
export interface KnowledgeCandidate extends KnowledgeEvidence {
  /** Null only in an explicitly degraded keyword query. Cosine distance is not evidence of support. */
  distance: number | null;
}
export interface KnowledgeResult {
  mode: "vector_keyword" | "keyword_degraded";
  degradationReason: "embedding_unavailable" | null;
  chunks: KnowledgeEvidence[];
}
