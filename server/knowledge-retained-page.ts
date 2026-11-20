import { z } from 'zod';
import { knowledgeReviewHash } from './knowledge-review-assessment.ts';

const hash = z.string().regex(/^[a-f0-9]{64}$/u);
export const retainedPageRevisionSchema = z.object({
  sourceId: z.string().min(1), operationFingerprint: hash, observationHash: hash, organizerRequestHash: hash,
  reason: z.string().min(1), units: z.array(z.strictObject({
    unitId: z.string().regex(/^p0-[a-f0-9]{20}$/u), ageBasis: z.literal('any'),
    minAgeMonths: z.number().nullable(), maxAgeMonths: z.number().nullable(),
    conditions: z.array(z.string()).min(1),
    passages: z.array(z.strictObject({ start: z.number().int().nonnegative(), quote: z.string().min(1) })).min(1),
  })).min(1),
});
export type RetainedPageRevision = z.infer<typeof retainedPageRevisionSchema>;
export const retainedPageProvenanceSchema = z.strictObject({ priorWork: hash, organizerRequestHash: hash, revisionHash: hash });
export const retainedPageWorkId = (prior: string) => knowledgeReviewHash(['fhs-retained-page-review/1', hash.parse(prior)]);

// This editorial proposal changes only the conflicting bounds of inspected general units.
// The regular organizer schema validates the complete draft before a new independent review.
export function reviseRetainedPage(value: unknown, revision: RetainedPageRevision, originals: {id: string; originalText: string}[]) {
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
