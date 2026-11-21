import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { knowledgeReviewHash } from './knowledge-review-assessment.ts';

const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const binding = z.object({
  sourceId: z.string().min(1), operationFingerprint: hash, observationHash: hash, organizerRequestHash: hash,
  priorOperationFingerprint: hash.optional(), reason: z.string().min(1),
});
const pdf = binding.extend({ sha256: hash, sections: z.array(z.string()).min(1) });
const regionEdit = z.strictObject({range: z.string().min(1), from: z.enum(['hk', '香港']), to: z.literal('HK')});
const sourceRange = z.strictObject({basis: z.literal('actual'), minMonths: z.literal(0), maxMonths: z.literal(216), exclusiveEnd: z.boolean()});
const webOriginal = binding.omit({ organizerRequestHash: true }).extend({
  action: z.literal('review_web_original'), url: z.url(), ticketId: z.uuid(),
  rejectionHash: hash, audience: z.string().trim().min(1).max(80),
});
export type ReviewedWebOriginal = z.infer<typeof webOriginal>;
const manifestUrl = new URL('../knowledge/fhs-initial-recovery.json', import.meta.url);
const recovery = JSON.parse(readFileSync(manifestUrl, 'utf8'));
const webOriginals = new Map<string, ReviewedWebOriginal>();
for (const row of recovery.entries) {
  if (row.action !== 'review_web_original') continue;
  const pin = Object.freeze(webOriginal.parse(row));
  if (recovery.campaign !== 'fhs-child-initial-20261120' || webOriginals.has(pin.sourceId))
    throw Error('knowledge_campaign_recovery_manifest');
  webOriginals.set(pin.sourceId, pin);
}
export const commissionedWebOriginal = (id: string) => webOriginals.get(id);
export const retainedDraftRevisionSchema = z.discriminatedUnion('action', [webOriginal,binding.extend({
  action: z.literal('review_age_draft'), units: z.array(z.strictObject({
    unitId: z.string().regex(/^p0-[a-f0-9]{20}$/u), ageBasis: z.literal('any'),
    minAgeMonths: z.number().nullable(), maxAgeMonths: z.number().nullable(),
    conditions: z.array(z.string()).min(1),
    passages: z.array(z.strictObject({ start: z.number().int().nonnegative(), quote: z.string().min(1) })).min(1),
  })).min(1),
}), pdf.extend({ action: z.literal('review_pdf_region'), regionEdits: z.array(regionEdit).min(1) }),
pdf.extend({ action: z.literal('review_pdf_source_age'), regionEdits: z.array(regionEdit),
  sourceRanges: z.record(z.string().min(1), sourceRange) }),
pdf.extend({ action: z.literal('retain_pdf_transcription'), pages: z.literal(1), reviewerRequestHash: hash, sliceHash: hash,
  excerpt: z.string().trim().min(1).max(150), organizerStart: z.number().int().nonnegative(), reviewerStart: z.number().int().nonnegative() })]);
export type RetainedDraftRevision = z.infer<typeof retainedDraftRevisionSchema>;
export type RetainedTranscription = Extract<RetainedDraftRevision, {action:'retain_pdf_transcription'}>;
export type RetainedOrganizerRevision = Exclude<RetainedDraftRevision, RetainedTranscription | ReviewedWebOriginal>;
export const retainedDraftProvenanceSchema = z.strictObject({ priorWork: hash, organizerRequestHash: hash, reviewerRequestHash: hash.optional(), revisionHash: hash });
export const retainedDraftWorkId = (prior: string) => knowledgeReviewHash(['fhs-retained-page-review/1', hash.parse(prior)]);

// Only the exact packaged editorial revision may use the original source's campaign admission.
export function matchesRegisteredRetainedDraft(revision: RetainedDraftRevision, registeredOperation: string, recoveryOperation: string): boolean {
  if ((revision.priorOperationFingerprint ?? revision.operationFingerprint) !== registeredOperation
    || recoveryOperation !== retainedDraftWorkId(revision.operationFingerprint)) return false;
  if (recovery.campaign !== 'fhs-child-initial-20261120') return false;
  const entry = recovery.entries.find((row: {sourceId: string}) => row.sourceId === revision.sourceId);
  const bound = retainedDraftRevisionSchema.safeParse(entry);
  return bound.success && knowledgeReviewHash(bound.data) === knowledgeReviewHash(revision);
}

// Apply only the bound edits. The organizer schema validates the whole draft before independent review.
export function reviseRetainedDraft(value: unknown, revision: RetainedOrganizerRevision, originals: {id: string; originalText: string}[]) {
  if (revision.action !== 'review_age_draft') {
    const draft = z.looseObject({ ranges: z.record(z.string(), z.looseObject({region: z.string()})) }).parse(value);
    if (revision.action === 'review_pdf_source_age') {
      const keys = Object.keys(draft.ranges);
      if (!keys.length || keys.length !== Object.keys(revision.sourceRanges).length || keys.some(key => {
        const range = sourceRange.safeParse(draft.ranges[key]!.ageRange);
        return !range.success || !revision.sourceRanges[key] || range.data.exclusiveEnd !== revision.sourceRanges[key]!.exclusiveEnd;
      })) throw Error('knowledge_retained_pdf_age_changed');
    }
    for (const edit of revision.regionEdits) {
      const range = draft.ranges[edit.range];
      if (!range || range.region !== edit.from) throw Error('knowledge_retained_pdf_region_changed');
      range.region = edit.to;
    }
    return draft;
  }
  const draft = z.object({ units: z.array(z.object({ unitId: z.string(), applicability: z.looseObject({
    ageBasis: z.string(), minAgeMonths: z.number().nullable(), maxAgeMonths: z.number().nullable(), conditions: z.array(z.string()),
  }) }).passthrough()) }).strict().parse(value);
  const revised = new Set<string>();
  for (const edit of revision.units) {
    const range = originals.find(unit => unit.id === edit.unitId);
    const scope = draft.units.find(unit => unit.unitId === edit.unitId)?.applicability;
    if (!range || !scope || revised.has(edit.unitId) || edit.ageBasis !== 'any' || scope.ageBasis !== edit.ageBasis
      || (edit.minAgeMonths === null && edit.maxAgeMonths === null) || scope.maxAgeMonthsExclusive === true
      || scope.minAgeMonths !== edit.minAgeMonths || scope.maxAgeMonths !== edit.maxAgeMonths
      || knowledgeReviewHash(scope.conditions) !== knowledgeReviewHash(edit.conditions)
      || edit.passages.some(p => !range.originalText.startsWith(p.quote, p.start))) throw Error('knowledge_retained_page_scope_changed');
    revised.add(edit.unitId);
    scope.minAgeMonths = null;
    scope.maxAgeMonths = null;
  }
  return draft;
}
