import { z } from 'zod';
import { knowledgeReviewHash } from './knowledge-review-assessment.ts';

const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const binding = z.object({
  sourceId: z.string().min(1), operationFingerprint: hash, observationHash: hash, organizerRequestHash: hash,
  priorOperationFingerprint: hash.optional(), reason: z.string().min(1),
});
export const retainedDraftRevisionSchema = z.discriminatedUnion('action', [binding.extend({
  action: z.literal('review_age_draft'), units: z.array(z.strictObject({
    unitId: z.string().regex(/^p0-[a-f0-9]{20}$/u), ageBasis: z.literal('any'),
    minAgeMonths: z.number().nullable(), maxAgeMonths: z.number().nullable(),
    conditions: z.array(z.string()).min(1),
    passages: z.array(z.strictObject({ start: z.number().int().nonnegative(), quote: z.string().min(1) })).min(1),
  })).min(1),
}), binding.extend({ action: z.literal('review_pdf_region'), sha256: hash, sections: z.array(z.string()).min(1),
  regionEdits: z.array(z.strictObject({range: z.string().min(1), from: z.enum(['hk', '香港']), to: z.literal('HK')})).min(1) })]);
export type RetainedDraftRevision = z.infer<typeof retainedDraftRevisionSchema>;
export const retainedDraftProvenanceSchema = z.strictObject({ priorWork: hash, organizerRequestHash: hash, revisionHash: hash });
export const retainedDraftWorkId = (prior: string) => knowledgeReviewHash(['fhs-retained-page-review/1', hash.parse(prior)]);

// Apply only the bound edits. The organizer schema validates the whole draft before independent review.
export function reviseRetainedDraft(value: unknown, revision: RetainedDraftRevision, originals: {id: string; originalText: string}[]) {
  if (revision.action === 'review_pdf_region') {
    const draft = z.looseObject({ ranges: z.record(z.string(), z.looseObject({region: z.string()})) }).parse(value);
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
