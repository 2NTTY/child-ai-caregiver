/** Public knowledge only. Child scope and age bounds must be supplied by the server. */
import type { TimelyEventKind, TimelyEventLifecycle, TimelyEventStatus } from "./knowledge-timely.ts";

export type { TimelyEventKind, TimelyEventLifecycle, TimelyEventStatus };
export const KNOWLEDGE_EMBEDDING = Object.freeze({ model: "gemini-embedding-001", dimensions: 1024, pipeline: "section-v1" });
export type KnowledgeClass = "official_guidance" | "recent_information";
export interface KnowledgeApplicability {
  use?: 'original_lookup';
  region: string;
  ageBasis: "actual" | "corrected" | "any" | "publisher" | "unconfirmed";
  publisherAudience?: string;
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
  ageMatch?: "contained" | "overlap" | "unknown";
}
export interface KnowledgeQueryAge {
  basis: "actual" | "corrected"; minMonths: number; maxMonths: number;
  source: "message" | "profile"; quote: string; messageId?: string; offset?: number; profileVersion?: number;
}
export interface KnowledgeQueryContext {
  age: KnowledgeFilter["age"]; ageMatch: "contained" | "overlap" | "unknown";
  precision: "confirmed" | "approximate" | "query_hypothesis" | "unknown";
  provenance?: KnowledgeQueryAge;
  asOf?: string;
}
export interface KnowledgeExtraction {
  format: "html" | "text_pdf"; contentHash: string;
  extractionQuality?: "requires_review";
  totalPages?: number; pageStart?: number; pageEnd?: number; complete: boolean;
}
export interface KnowledgeChunkInput {
  scriptPassage?: import('./platform-media.ts').ScriptPassage;
  mediaClip?: import('./platform-media.ts').PlatformMediaClip;
  treatment?: import('./source-series.ts').ChunkTreatment;
  key: string;
  section: string;
  sourceExcerpt: string;
  originalText?: string;
  /** Source position is the original for textless material. Transcriptions are independently checked against the page image. */
  originalKind?: "page_excerpt" | "page_transcription" | "visual_page";
  /** Physical page of the evidence within a section that may span multiple pages. */
  excerptPage?: number;
  pageStart?: number;
  pageEnd?: number;
  text: string;
  keywords: string[];
  applicability: KnowledgeApplicability;
}
export interface KnowledgeSourceInput {
  series?: import('./source-series.ts').SourceSeries;
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
  timelyEvent?: TimelyEventLifecycle;
  fetchedAt: string;
  termsUrl: string;
  chunks: KnowledgeChunkInput[];
  extraction?: KnowledgeExtraction;
}
export interface KnowledgeEvidence extends KnowledgeChunkInput {
  series?: import('./source-series.ts').SourceSeries;
  citedExcerpt?: string;
  termsUrl?: string;
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
  timelyEvent?: TimelyEventLifecycle;
  fetchedAt: string;
  checkedAt: string;
  /** Successful source retrieval, independent of the human content review timestamp. */
  lastSuccessfulCheckAt?: string | null;
  usageScope?: "public_noncommercial" | "internal_noncommercial";
  reviewState: "reviewed";
  extraction?: KnowledgeExtraction;
  applicabilityStatus?: "applicable" | "conditional" | "requires_clarification";
  originalCoverage?: "chunk_original" | "excerpt_only";
  readCoverage?: { kind: "reviewed_text_and_excerpt" | "original_segment"; complete: boolean;
    offset?: number; nextOffset?: number | null; totalCharacters?: number; ranges?: { start: number; end: number }[] };
}
/** Restore the original spans returned to the model without inventing text across unread gaps. */
export function citedOriginalSpans(source: KnowledgeEvidence): string[] {
  if (source.readCoverage?.kind !== 'original_segment') return [source.sourceExcerpt];
  const ranges = source.readCoverage.ranges;
  if (!ranges?.length) return [source.text];
  let offset = 0;
  return ranges.map(range => {
    const start = offset;
    offset += range.end - range.start;
    return source.text.slice(start, offset);
  });
}

export interface KnowledgeCandidate extends KnowledgeEvidence {
  /** Null only in an explicitly degraded keyword query. Cosine distance is not evidence of support. */
  distance: number | null;
  rankScore?: number;
}
export interface KnowledgeResult {
  mode: "vector_keyword" | "keyword_degraded";
  degradationReason: "embedding_unavailable" | null;
  chunks: KnowledgeEvidence[];
  queryContext?: KnowledgeQueryContext;
  videoListScope?: 'named_material_reviewed_passages' | 'matching_materials_reviewed_passages';
  complete?: boolean;
  omittedChunks?: number;
  returned?: number;
  hasMore?: boolean;
}

export interface KnowledgeContextCursor {
  versionId: string; anchorChunkId: string; afterKey: string | null; chunkId: string | null; offset: number;
}
export interface KnowledgeContextChunk extends Omit<KnowledgeEvidence, "text" | "originalText"> {
  original: { text: string; offset: number; nextOffset: number | null; totalCharacters: number; coverage: "chunk_original" | "excerpt_only" };
}
export interface KnowledgeContextResult {
  versionId: string; anchorChunkId: string; chunks: KnowledgeContextChunk[];
  start: { key: string; offset: number } | null; nextCursor: KnowledgeContextCursor | null; complete: boolean;
  coverage: "same_version_chunks";
}
