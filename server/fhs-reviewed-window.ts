import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { KnowledgePdfPage } from './knowledge-pdf.ts';
import { manualPublicationPin, type ManualPublicationPin } from './fhs-manual-publication.ts';
import type { createFirestoreKnowledgeWork } from './firestore-knowledge-work.ts';
import { knowledgeReviewHash } from './knowledge-review-assessment.ts';

const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const pageNumber = z.int().min(1).max(14);
const offset = z.int().nonnegative();
const span = z.strictObject({
  page:pageNumber, originalKind:z.enum(['page_transcription','text_layer']), organizerStart:offset, reviewerStart:offset,
  length:z.int().min(1).max(150), sha256:digest,
});
const passage = z.discriminatedUnion('proof', [
  span.extend({proof:z.literal('printed')}),
  span.extend({proof:z.literal('text_layer'), layerStart:offset, layerLength:z.int().min(1).max(150)}),
]);
const binding = z.strictObject({sourceId:z.string().regex(/^pdf-[0-9a-f]{24}$/u), sha256:digest, pages:pageNumber,bindingHash:digest});
const revision = z.discriminatedUnion('action', [
  binding.extend({action:z.literal('retain_window_quotes'), passages:z.array(passage).min(1).max(14)}),
  binding.extend({action:z.literal('review_window_region'), regionPages:z.array(pageNumber).min(1).max(14)}),
]).refine(row => {
  const pages = row.action === 'retain_window_quotes' ? row.passages.map(p => p.page) : row.regionPages;
  return pages.every((page, i) => page <= row.pages && (!i || page > pages[i-1]!));
});
export type ReviewedWindow = z.infer<typeof revision>;
export type BoundReviewedWindow = {action:'commissioned_window'; registration:ReviewedWindow; operationFingerprint:string; observationHash:string};
const registered = z.array(revision).parse(JSON.parse(readFileSync(new URL('../knowledge/fhs-reviewed-windows.json',import.meta.url),'utf8')));
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const failure = (code: string): never => { throw Object.assign(new Error(code), {code}); };

export function registeredReviewedWindow(pin: ManualPublicationPin | undefined, original: string, observation: string | null | undefined) {
  if (!pin || pin.resumeOnly || !observation || manualPublicationPin(pin.sourceId)?.lane !== pin.lane) return undefined;
  return registered.find(row => row.sourceId === pin.sourceId && row.sha256 === pin.sha256 && row.pages === pin.pages
    && (pin.lane === 'C2' || (pin.lane === 'C1' || pin.lane === 'C3') && row.action === 'retain_window_quotes')
    && row.bindingHash === knowledgeReviewHash(['fhs-reviewed-window/1',pin.sourceId,original,observation]));
}

export function hasReviewedWindowSource(sourceId: string) {
  return registered.some(row => row.sourceId === sourceId);
}

export function reviewedParentCode(row: ReviewedWindow) {
  return row.action === 'retain_window_quotes' ? 'knowledge_window_quote_mismatch' : 'knowledge_review_failed';
}

export function bindReviewedWindow(pin: ManualPublicationPin | undefined, original: string,
  prior: Awaited<ReturnType<ReturnType<typeof createFirestoreKnowledgeWork>['inspect']>>): BoundReviewedWindow | undefined {
  const observation = prior?.result?.observationHash;
  const registration = registeredReviewedWindow(pin,original,observation);
  if (!registration || !observation || !prior?.windowed || prior.request.watchId !== pin?.sourceId || prior.request.publishMode !== 'live'
    || prior.request.operationFingerprint !== original || prior.receipt || prior.prepared || prior.lease || prior.result?.published
    || prior.result?.status !== 'candidate_held' || prior.result.code !== reviewedParentCode(registration)
    || prior.budget.modelCalls !== (registration.action === 'retain_window_quotes' ? 2 : 1)) return undefined;
  return {action:'commissioned_window',registration,operationFingerprint:original,observationHash:observation};
}

/** Each registered offset selects one complete passage in the two independent, sealed readings. */
export function retainWindowPassage(selection: z.infer<typeof passage>, originalKind: string, organizer: string, reviewer: string, page: KnowledgePdfPage) {
  const quote = organizer.slice(selection.organizerStart,selection.organizerStart+selection.length);
  if (page.page !== selection.page || originalKind !== selection.originalKind || quote.length !== selection.length
    || sha(quote) !== selection.sha256 || reviewer.slice(selection.reviewerStart,selection.reviewerStart+selection.length) !== quote)
    return failure('knowledge_window_quote_mismatch');
  if (selection.proof === 'printed') return {quote,kind:'page_transcription' as const};
  const text = page.text.slice(selection.layerStart,selection.layerStart+selection.layerLength);
  // Preserve line breaks and layout spacing from the PDF. Content and punctuation must agree.
  if (page.status !== 'text' || text.length !== selection.layerLength || text.replace(/\s/gu,'') !== quote.replace(/\s/gu,''))
    return failure('knowledge_window_quote_mismatch');
  return {quote:text,kind:'text_layer' as const};
}

export function registeredPrintedPassage(parentHash: string, page: number, excerpt: string) {
  return registered.some(row => row.sha256 === parentHash && row.action === 'retain_window_quotes'
    && row.passages.some(p => p.page === page && p.proof === 'printed' && p.sha256 === sha(excerpt)));
}

export function reviseWindowRegion(value: unknown, pages: readonly number[]) {
  const draft = z.looseObject({ranges:z.record(z.string(),z.unknown())}).parse(value);
  for (const page of pages) {
    const key = 'pages-'+page+'-'+page;
    const item = z.looseObject({applicability:z.looseObject({region:z.literal('香港')})}).safeParse(draft.ranges[key]);
    if (!item.success) return failure('knowledge_retained_pdf_region_changed');
    draft.ranges[key] = {...item.data, applicability:{...item.data.applicability,region:'HK'}};
  }
  return draft;
}
