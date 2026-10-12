import { z } from "zod";
import type { KnowledgeChunkInput, KnowledgeSourceInput } from "../src/shared/knowledge.ts";
import { knowledgeHash } from "./knowledge-inputs.ts";
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const note = z.string().min(1).max(2000).refine(value => Boolean(value.trim()));
export const knowledgeReviewAssessmentSchema = z.strictObject({
  comparedVersionId: z.uuid().nullable(), comparedHash: hash.nullable(), observationHash: hash.nullable(),
  changes: z.array(z.strictObject({ key: z.string().regex(/^[a-z0-9-]{1,80}$/), oldQuote: note.nullable(), newQuote: note.nullable(),
    meaning: z.enum(["new", "changed", "unchanged", "removed"]), explanation: note })).max(64),
  checks: z.strictObject({ age: note, numbersAndUnits: note, timing: note, conditions: note, exceptions: note, prohibitions: note, withdrawal: note }),
  questions: z.array(z.strictObject({ query: note, expectedKeys: z.array(z.string().regex(/^[a-z0-9-]{1,80}$/)).max(32), reason: note })).min(1).max(12),
  growthRuleImpact: z.enum(["none", "requires_review", "reviewed"]), growthRuleReason: note,
  decision: z.enum(["approve", "hold"]),
}).refine(value => (value.comparedVersionId === null) === (value.comparedHash === null));
export type KnowledgeReviewAssessment = z.infer<typeof knowledgeReviewAssessmentSchema>;
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
export function knowledgeReviewHash(value: unknown): string { return knowledgeHash(canonical(value) ?? null); }
const original = (chunk: KnowledgeChunkInput, quote: string | null) => quote !== null &&
  [chunk.originalText, chunk.sourceExcerpt].some(text => text?.includes(quote));
/** Validate recorded meaning against the actual compared editions; this is evidence, not a clinical guarantee. */
export function validateKnowledgeAssessment(raw: unknown, current: KnowledgeSourceInput, compared: KnowledgeSourceInput | null): KnowledgeReviewAssessment {
  const assessment = knowledgeReviewAssessmentSchema.parse(raw);
  const old = new Map((compared?.chunks ?? []).map(chunk => [chunk.key, chunk]));
  const next = new Map(current.chunks.map(chunk => [chunk.key, chunk]));
  const changed = new Set([...new Set([...old.keys(), ...next.keys()])].filter(key => knowledgeReviewHash(old.get(key)) !== knowledgeReviewHash(next.get(key))));
  const seen = new Set<string>();
  for (const change of assessment.changes) {
    if (seen.has(change.key)) throw new Error("knowledge_review_duplicate_key");
    seen.add(change.key);
    const before = old.get(change.key), after = next.get(change.key);
    if ((!before && !after) || (before ? !original(before, change.oldQuote) : change.oldQuote !== null)) throw new Error("knowledge_review_old_quote_mismatch");
    if (after ? !original(after, change.newQuote) : change.newQuote !== null) throw new Error("knowledge_review_new_quote_mismatch");
    const validMeaning = !before ? change.meaning === "new" : !after ? change.meaning === "removed"
      : changed.has(change.key) ? ["changed", "unchanged"].includes(change.meaning) : change.meaning === "unchanged";
    if (!validMeaning) throw new Error("knowledge_review_meaning_mismatch");
  }
  if ([...changed].some(key => !seen.has(key))) throw new Error("knowledge_review_incomplete_diff");
  for (const question of assessment.questions) {
    if (new Set(question.expectedKeys).size !== question.expectedKeys.length || question.expectedKeys.some(key => !next.has(key)))
      throw new Error("knowledge_review_question_keys_invalid");
  }
  return assessment;
}
