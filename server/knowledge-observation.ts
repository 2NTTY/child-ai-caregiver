import { knowledgeHash } from "./knowledge-inputs.ts";
import { knowledgeReviewHash } from "./knowledge-review-assessment.ts";
import type { KnowledgeSourceInput } from "../src/shared/knowledge.ts";
import type { ObservedContent, SourceWatchDefinition } from "./knowledge-refresh-types.ts";

export function observationId(definition: SourceWatchDefinition, item: ObservedContent): string {
  return definition.kind !== "rss" ? definition.id : `${definition.id}-${knowledgeHash(item.url).slice(0, 32)}`;
}
export function observationHash(item: ObservedContent): string {
  return knowledgeHash([item.url, item.title, item.text, item.sourcePublishedAt, item.sourceUpdatedAt, item.sourceDateText,
    ...(item.extraction || item.pages ? [item.extraction ?? null, item.pages ?? null] : [])]);
}
export function definitionHash(definition: SourceWatchDefinition): string {
  return knowledgeHash([definition.id, definition.url, definition.kind, definition.classification, definition.publisher,
    definition.termsUrl, definition.audience, definition.selector ?? null, definition.itemHosts ?? [], definition.pdfPages ?? null, definition.title ?? null]);
}

/** Shared semantic-review boundary; storage adapters supply their transaction-bound observation. */
export function checkKnowledgeObservation(document: KnowledgeSourceInput,
  watch: { enabled: boolean; definition: SourceWatchDefinition } | undefined,
  observed: { content_hash: string; unavailable: boolean; document: ObservedContent; url: string } | undefined, expectedHash: string | null) {
  if (!watch) {
    if (expectedHash !== null || document.classification === "recent_information") throw new Error("knowledge_observation_review_required");
    return;
  }
  if (!watch.enabled || !observed || observed.unavailable || observed.content_hash !== expectedHash
    || document.url !== observed.url || document.classification !== watch.definition.classification
    || document.publisher !== watch.definition.publisher || document.termsUrl !== watch.definition.termsUrl
    || document.sourcePublishedAt !== observed.document.sourcePublishedAt || document.sourceUpdatedAt !== observed.document.sourceUpdatedAt
    || (document.sourceDateText ?? null) !== observed.document.sourceDateText) throw new Error("knowledge_observation_review_mismatch");
  if (watch.definition.kind === "pdf") {
    const expected = document.extraction, actual = observed.document.extraction;
    if (!expected || !actual || knowledgeReviewHash({ extractionQuality: "requires_review", ...expected })
      !== knowledgeReviewHash({ extractionQuality: "requires_review", ...actual })) throw new Error("knowledge_pdf_coverage_mismatch");
    for (const chunk of document.chunks) {
      const pages = observed.document.pages?.filter(page => page.page >= (chunk.pageStart ?? Infinity) && page.page <= (chunk.pageEnd ?? -Infinity));
      const original = pages?.map(page => page.text).join("\n\n");
      if (!chunk.originalText || !original?.includes(chunk.originalText) || !original.includes(chunk.sourceExcerpt))
        throw new Error("knowledge_pdf_original_page_mismatch");
    }
  }
}
