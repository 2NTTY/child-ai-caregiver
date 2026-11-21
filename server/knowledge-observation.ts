import { knowledgeHash } from "./knowledge-inputs.ts";
import { knowledgeReviewHash } from "./knowledge-review-assessment.ts";
import type { KnowledgeSourceInput } from "../src/shared/knowledge.ts";
import type { ObservedContent, SourceWatchDefinition } from "./knowledge-refresh-types.ts";
import type { ScriptPassage } from '../src/shared/platform-media.ts';

export function observedPassageText(original: ObservedContent, passage?: ScriptPassage) {
  if (!passage) return original.text;
  const script = original.scripts?.find(s => s.page.transcriptUrl === passage.url && s.page.title === passage.title);
  if (!script || passage.lastParagraph > script.paragraphs.length) return undefined;
  return script.paragraphs.slice(passage.firstParagraph - 1, passage.lastParagraph).join('\n');
}

export function observationId(definition: SourceWatchDefinition, item: ObservedContent): string {
  return definition.kind !== "rss" ? definition.id : `${definition.id}-${knowledgeHash(item.url).slice(0, 32)}`;
}
export function observationHash(item: ObservedContent): string {
  return knowledgeHash([item.url, item.title, item.text, item.sourcePublishedAt, item.sourceUpdatedAt, item.sourceDateText,
    ...(item.nativeWindowMethod ? [item.nativeWindowMethod] : []), ...(item.rssItem ? [item.rssItem] : []), ...(item.extraction || item.pages ? [item.extraction ?? null, item.pages ?? null] : []),
    ...(item.scripts?.length ? [item.scripts.map(s => [s.page.url, s.page.title, s.paragraphs])] : [])]);
}
export function definitionHash(definition: SourceWatchDefinition): string {
  return knowledgeHash([definition.id, definition.url, definition.kind, definition.classification, definition.publisher,
    definition.termsUrl, definition.audience, definition.selector ?? null, definition.itemHosts ?? [], definition.pdfPages ?? null, definition.title ?? null, ...(definition.leafletPage ? [definition.leafletPage] : [])]);
}

/** Shared semantic-review boundary; storage adapters supply their transaction-bound observation. */
export function checkKnowledgeObservation(document: KnowledgeSourceInput,
  watch: { enabled: boolean; definition: SourceWatchDefinition } | undefined,
  observed: { content_hash: string; unavailable: boolean; document: ObservedContent; url: string } | undefined, expectedHash: string | null, windowedReview = false) {
  if (document.chunks.some(chunk => chunk.originalKind && !(chunk.originalKind === "page_excerpt"
    && watch?.definition.kind === "pdf" && observed?.document.pages?.length))
    && !windowedReview) throw Error("knowledge_window_review_required");
  for (const chunk of document.chunks) {
    const passage = chunk.scriptPassage;
    if (!passage) continue;
    if (watch?.definition.kind !== 'page' || !observed || !chunk.originalText
      || observedPassageText(observed.document, passage) !== chunk.originalText)
      throw Error('knowledge_script_original_mismatch');
  }
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
    if (observed.document.nativeWindowMethod) {
      if (!windowedReview || !actual || actual.complete || !expected?.complete || expected.pageStart !== 1
        || expected.pageEnd !== actual.totalPages || expected.totalPages !== actual.totalPages
        || expected.contentHash !== actual.contentHash) throw Error("knowledge_window_review_required");
      return;
    }
    if (!expected || !actual || knowledgeReviewHash({ extractionQuality: "requires_review", ...expected })
      !== knowledgeReviewHash({ extractionQuality: "requires_review", ...actual })) throw new Error("knowledge_pdf_coverage_mismatch");
    for (const chunk of document.chunks) {
      if (chunk.mediaClip) continue;
      const pages = observed.document.pages?.filter(page => page.page >= (chunk.pageStart ?? Infinity) && page.page <= (chunk.pageEnd ?? -Infinity));
      const original = pages?.map(page => page.text).join("\n\n");
      if (!chunk.originalText || !original?.includes(chunk.originalText) || !original.includes(chunk.sourceExcerpt)
        || chunk.excerptPage !== undefined && !pages?.some(page => page.page === chunk.excerptPage && page.text.includes(chunk.sourceExcerpt)))
        throw new Error("knowledge_pdf_original_page_mismatch");
    }
  }
}
