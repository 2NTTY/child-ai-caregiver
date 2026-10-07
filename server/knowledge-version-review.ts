import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { KNOWLEDGE_EMBEDDING } from "../src/shared/knowledge.ts";
import type { KnowledgeChunkInput, KnowledgeSourceInput } from "../src/shared/knowledge.ts";
import { internalKnowledgeSource, knowledgeHash } from "./knowledge-inputs.ts";
import type { ObservedContent, SourceWatchDefinition } from "./knowledge-refresh-types.ts";

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
interface VersionRow { id: string; source_id: string; version_hash: string; document: KnowledgeSourceInput;
  review_state: "draft" | "reviewed" | "withdrawn"; checked_at: Date | null }
interface SourceRow { id: string; active_version_id: string | null; enabled: boolean }
interface WatchRow { id: string; enabled: boolean; revision: string; definition: SourceWatchDefinition }
interface ObservationRow { content_hash: string; approved_hash: string | null; approved_version_id: string | null;
  unavailable: boolean; document: ObservedContent; url: string }
interface ReviewRow { assessment: KnowledgeReviewAssessment; assessment_hash: string; watch_revision: string | null; observation_hash: string | null }

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

async function lockedVersion(client: PoolClient, versionId: string, expectedHash: string) {
  let row = (await client.query<VersionRow>("SELECT * FROM knowledge_versions WHERE id=$1", [versionId])).rows[0];
  if (!row) throw new Error("knowledge_version_unknown");
  const source = (await client.query<SourceRow>("SELECT * FROM knowledge_sources WHERE id=$1 FOR UPDATE", [row.source_id])).rows[0];
  row = (await client.query<VersionRow>("SELECT * FROM knowledge_versions WHERE id=$1", [versionId])).rows[0]!;
  if (!source || row.version_hash !== expectedHash) throw new Error("knowledge_review_version_mismatch");
  const watch = (await client.query<WatchRow>(`SELECT * FROM knowledge_watches WHERE id=(SELECT watch_id FROM knowledge_observations WHERE source_id=$1)
    OR (id=$1 AND definition->>'kind' IN ('page','pdf')) FOR SHARE`, [row.source_id])).rows[0];
  const observation = watch && (await client.query<ObservationRow>("SELECT * FROM knowledge_observations WHERE source_id=$1 FOR UPDATE", [row.source_id])).rows[0];
  return { row, source, watch, observation };
}
function checkObservation(row: VersionRow, watch: WatchRow | undefined, observed: ObservationRow | undefined, observationHash: string | null) {
  if (!watch) {
    if (observationHash !== null || row.document.classification === "recent_information") throw new Error("knowledge_observation_review_required");
    return;
  }
  if (!watch.enabled || !observed || observed.unavailable || observed.content_hash !== observationHash
    || row.document.url !== observed.url || row.document.classification !== watch.definition.classification
    || row.document.publisher !== watch.definition.publisher || row.document.termsUrl !== watch.definition.termsUrl
    || row.document.sourcePublishedAt !== observed.document.sourcePublishedAt || row.document.sourceUpdatedAt !== observed.document.sourceUpdatedAt
    || (row.document.sourceDateText ?? null) !== observed.document.sourceDateText)
    throw new Error("knowledge_observation_review_mismatch");
  if (watch.definition.kind === "pdf") {
    const expected = row.document.extraction, actual = observed.document.extraction;
    if (!expected || !actual || knowledgeReviewHash({ extractionQuality: "requires_review", ...expected })
      !== knowledgeReviewHash({ extractionQuality: "requires_review", ...actual })) throw new Error("knowledge_pdf_coverage_mismatch");
    for (const chunk of row.document.chunks) {
      const pages = observed.document.pages?.filter(page => page.page >= (chunk.pageStart ?? Infinity) && page.page <= (chunk.pageEnd ?? -Infinity));
      const original = pages?.map(page => page.text).join("\n\n");
      if (!chunk.originalText || !original?.includes(chunk.originalText) || !original.includes(chunk.sourceExcerpt))
        throw new Error("knowledge_pdf_original_page_mismatch");
    }
  }
}

export async function reviewKnowledgeVersion(client: PoolClient, versionId: string, expectedHash: string, operator: string,
  raw: KnowledgeReviewAssessment, internal: boolean, expectedWatchRevision?: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(operator)) throw new Error("knowledge_operator_invalid");
  const state = await lockedVersion(client, versionId, expectedHash), { row, source, watch, observation } = state;
  if (expectedWatchRevision && watch?.revision !== expectedWatchRevision) throw new Error("knowledge_watch_revision_changed");
  const assessment = knowledgeReviewAssessmentSchema.parse(raw);
  checkObservation(row, watch, observation, assessment.observationHash);
  if (!internal && (watch?.definition.audience === "internal_noncommercial" || internalKnowledgeSource(row.document.url)))
    throw new Error("knowledge_source_internal_review_required");
  const assessmentHash = knowledgeReviewHash(assessment);
  const previous = (await client.query<ReviewRow>("SELECT * FROM knowledge_version_reviews WHERE version_id=$1 ORDER BY reviewed_at DESC,id DESC LIMIT 1", [versionId])).rows[0];
  // A repeated approved operation keeps its original baseline even after publication points at this edition.
  if (row.review_state === "reviewed" && previous?.assessment_hash === assessmentHash && previous.watch_revision === (watch?.revision ?? null)
    && previous.observation_hash === (observation?.content_hash ?? null)
    && (!watch || observation?.approved_hash === observation?.content_hash && observation?.approved_version_id === versionId)
    && (source.active_version_id === assessment.comparedVersionId || source.active_version_id === versionId)) {
    return publishKnowledgeVersion(client, versionId, expectedHash, internal, true);
  }
  const compared = source.active_version_id ? (await client.query<VersionRow>("SELECT * FROM knowledge_versions WHERE id=$1", [source.active_version_id])).rows[0] : null;
  if ((compared?.id ?? null) !== assessment.comparedVersionId || (compared?.version_hash ?? null) !== assessment.comparedHash)
    throw new Error("knowledge_review_baseline_changed");
  validateKnowledgeAssessment(assessment, row.document, compared?.document ?? null);
  const fullReview = row.review_state === "withdrawn" || previous !== undefined
    && (previous.watch_revision !== (watch?.revision ?? null) || watch !== undefined && observation?.approved_hash === null);
  if (fullReview && row.document.chunks.some(chunk => !assessment.changes.some(change => change.key === chunk.key)))
    throw new Error("knowledge_withdrawn_full_review_required");
  if (observation && assessment.changes.some(change => change.newQuote !== null && !observation.document.text.includes(change.newQuote)))
    throw new Error("knowledge_review_observation_quote_mismatch");
  const approved = assessment.decision === "approve" && assessment.growthRuleImpact !== "requires_review";
  await client.query(`INSERT INTO knowledge_version_reviews(id,version_id,version_hash,assessment,assessment_hash,operator_alias,watch_revision,observation_hash)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [randomUUID(), versionId, expectedHash, assessment, assessmentHash, operator, watch?.revision ?? null, observation?.content_hash ?? null]);
  if (!approved) {
    if (row.review_state !== "draft") await client.query("UPDATE knowledge_versions SET review_state='withdrawn' WHERE id=$1", [versionId]);
    return { status: "held" as const, reason: assessment.decision === "hold" ? "operator_hold" : "growth_rules_require_review" };
  }
  await client.query("UPDATE knowledge_versions SET review_state='reviewed',reviewed_by=$2,checked_at=now() WHERE id=$1", [versionId, operator]);
  if (observation) await client.query(`UPDATE knowledge_observations SET approved_hash=$2,approved_version_id=$3,approved_by=$4,approved_at=now() WHERE source_id=$1`,
    [row.source_id, observation.content_hash, versionId, operator]);
  return publishKnowledgeVersion(client, versionId, expectedHash, internal, true);
}

function pendingPublication(reason: string, allowed: boolean): { status: "pending"; reason: string } {
  if (!allowed) throw new Error(reason);
  return { status: "pending", reason };
}

export async function publishKnowledgeVersion(client: PoolClient, versionId: string, expectedHash: string, internal: boolean, pendingAllowed: boolean) {
  const { row, source, watch, observation } = await lockedVersion(client, versionId, expectedHash);
  if (row.review_state !== "reviewed") return pendingPublication("knowledge_version_unreviewed", pendingAllowed);
  if (row.document.validUntil && Date.parse(row.document.validUntil) <= Date.now()) return pendingPublication("knowledge_version_expired", pendingAllowed);
  const review = (await client.query<ReviewRow>("SELECT * FROM knowledge_version_reviews WHERE version_id=$1 ORDER BY reviewed_at DESC,id DESC LIMIT 1", [versionId])).rows[0];
  // Legacy active editions remain usable, but new publication requires recorded semantic evidence.
  if (!review || review.assessment.decision !== "approve" || review.assessment.growthRuleImpact === "requires_review") return pendingPublication("knowledge_semantic_review_required", pendingAllowed);
  if (source.active_version_id !== versionId && source.active_version_id !== review.assessment.comparedVersionId)
    return pendingPublication("knowledge_review_baseline_changed", pendingAllowed);
  if (review.assessment.comparedVersionId && source.active_version_id !== versionId) {
    const baseline = (await client.query<{ version_hash: string }>("SELECT version_hash FROM knowledge_versions WHERE id=$1", [review.assessment.comparedVersionId])).rows[0];
    if (baseline?.version_hash !== review.assessment.comparedHash) return pendingPublication("knowledge_review_baseline_changed", pendingAllowed);
  }
  if (review.watch_revision !== (watch?.revision ?? null)) return pendingPublication("knowledge_watch_revision_changed", pendingAllowed);
  try { checkObservation(row, watch, observation, review.observation_hash); }
  catch (error) {
    if (error instanceof Error && ["knowledge_observation_review_mismatch", "knowledge_observation_review_required", "knowledge_pdf_coverage_mismatch", "knowledge_pdf_original_page_mismatch"].includes(error.message))
      return pendingPublication(error.message, pendingAllowed);
    throw error;
  }
  if (watch && (observation?.approved_hash !== observation?.content_hash || observation?.approved_version_id !== versionId))
    return pendingPublication("knowledge_observation_review_required", pendingAllowed);
  if (!internal && (watch?.definition.audience === "internal_noncommercial" || internalKnowledgeSource(row.document.url)))
    throw new Error("knowledge_source_internal_review_required");
  const readiness = await client.query<{ missing: string }>(`SELECT count(*)::text AS missing FROM knowledge_chunks c WHERE c.version_id=$4 AND NOT EXISTS
    (SELECT 1 FROM knowledge_vectors e WHERE e.input_hash=c.embedding_hash AND e.model=$1 AND e.dimensions=$2 AND e.pipeline=$3)`,
    [KNOWLEDGE_EMBEDDING.model, KNOWLEDGE_EMBEDDING.dimensions, KNOWLEDGE_EMBEDDING.pipeline, versionId]);
  if (Number(readiness.rows[0]?.missing) !== 0) {
    if (pendingAllowed) return { status: "pending" as const, reason: "vectors_incomplete" };
    throw new Error("knowledge_vectors_incomplete");
  }
  await client.query("UPDATE knowledge_versions SET published_at=COALESCE(published_at,now()) WHERE id=$1", [versionId]);
  await client.query("UPDATE knowledge_sources SET active_version_id=$2,enabled=true,disabled_reason=NULL,last_checked_at=$3 WHERE id=$1", [row.source_id, versionId, row.checked_at]);
  if (source.active_version_id !== versionId && (await client.query("SELECT 1 FROM app_migrations WHERE id='033-agent-work-continuation'")).rowCount) {
    // The check compares recorded semantic evidence; timestamps and hashes alone never trigger a model.
    await client.query(`UPDATE agent_work_followups SET next_check_at=LEAST(COALESCE(next_check_at,now()),now())
      WHERE enabled AND knowledge_source_ids @> ARRAY[$1]::text[]`, [row.source_id]);
  }
  return { status: "published" as const };
}
