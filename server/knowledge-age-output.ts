import { z } from 'zod';
import { knowledgeChunkInputSchema } from './knowledge-inputs.ts';

export const AGE_OUTPUT_VERSION = 'source-unit-age/1';

const stored = knowledgeChunkInputSchema.shape.applicability;
const { minAgeMonths, maxAgeMonths } = stored.shape;
export const ageScopeInstruction = 'Use a numeric interval only when the original establishes both endpoints for this entire unit. For a general unit, preserve ages from individual examples, linked titles, activities or subgroups in their own text and conditions. Never infer numeric months from a stage such as preschool. If a whole-unit restriction is one-sided, or its audience cannot be represented faithfully, return requiresAgeReview. Never supply a missing endpoint or make a restricted unit unrestricted.';
export const independentAgeCheck = 'In checks.age compare both endpoints, age basis and exceptions against the original for each numeric unit. Hold if an endpoint is inferred, if an example or subsection was applied to the whole unit, or if an unrestricted unit lost an actual age restriction.';

export const ageReviewRequired = z.strictObject({ requiresAgeReview: z.enum(['one_sided', 'uncertain']) })
  .transform((hold): never => {
    const code = hold.requiresAgeReview === 'one_sided' ? 'knowledge_age_one_sided' : 'knowledge_age_uncertain';
    throw Object.assign(new Error(code), { code });
  });

// The provider receives the same mutually exclusive combinations that the storage validator accepts.
export const modelAgeApplicability = z.union([
  z.strictObject({ ...stored.shape, ageBasis: z.enum(['any']), minAgeMonths: z.null(), maxAgeMonths: z.null() }),
  z.strictObject({ ...stored.shape, ageBasis: z.enum(['actual', 'corrected']), minAgeMonths: minAgeMonths.unwrap(), maxAgeMonths: maxAgeMonths.unwrap() }),
  ageReviewRequired,
]).transform(value => stored.parse(value));
