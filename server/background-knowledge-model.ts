import { z } from "zod";
import type { KnowledgeSourceInput } from "../src/shared/knowledge.ts";
import {
  BACKGROUND_KNOWLEDGE_POLICY_VERSION, backgroundKnowledgeReviewBindingSchema,
  type BackgroundKnowledgeReviewBinding,
} from "../src/shared/background-knowledge-maintenance.ts";
import type { BackgroundKnowledgeCandidate, KnowledgeSemanticReviewPort } from "./background-knowledge-maintenance.ts";
import { backgroundKnowledgePdfCoverageIssue } from "./background-knowledge-maintenance.ts";
import { loadAgentPrompt } from "./agent-prompt.ts";
import { knowledgeChunkInputSchema, knowledgeHash, parseKnowledgeSource, sourceVersionHash } from "./knowledge-inputs.ts";
import { observationHash } from "./knowledge-observation.ts";
import {
  knowledgeReviewAssessmentSchema, knowledgeReviewHash, validateKnowledgeAssessment,
  type KnowledgeReviewAssessment,
} from "./knowledge-review-assessment.ts";
import type { AgentGatewayModel } from "./agent-model-gateway.ts";

const INPUTS = ["run", "scope", "context", "evidence", "capabilities", "outputContract"];
const fields = knowledgeChunkInputSchema.shape;
const organizedSchema = z.strictObject({
  units: z.array(z.strictObject({
    unitId: z.string().regex(/^p[0-9]+-[a-f0-9]{20}$/u),
    section: fields.section, text: fields.text,
    keywords: fields.keywords, applicability: fields.applicability,
  })).min(1).max(32),
});
const reviewFields = knowledgeReviewAssessmentSchema.shape;
const modelAssessmentSchema = z.strictObject({
  changes: z.array(z.strictObject({
    key: reviewFields.changes.element.shape.key,
    meaning: reviewFields.changes.element.shape.meaning,
    explanation: reviewFields.changes.element.shape.explanation,
  })).max(64),
  checks: reviewFields.checks, questions: reviewFields.questions,
  growthRuleImpact: reviewFields.growthRuleImpact, growthRuleReason: reviewFields.growthRuleReason,
  decision: reviewFields.decision,
});
type OriginalUnit = { id: string; originalText: string; page: number | null };
export interface KnowledgeMaintenanceBaseline {
  versionId: string;
  versionHash: string;
  observationHash: string | null;
  source: KnowledgeSourceInput;
}
export interface KnowledgeGrowthRuleBinding {
  id: string;
  sourceId: string;
  key: string;
  hash: string;
  revision: string;
}
export interface PreparedKnowledgeMaintenance {
  source: KnowledgeSourceInput;
  versionHash: string;
  assessment: KnowledgeReviewAssessment;
  review: BackgroundKnowledgeReviewBinding;
  provenance: { packVersion: string; organizeAttemptKey: string; reviewAttemptKey: string };
}
export class KnowledgeMaintenanceModelError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.name = "KnowledgeMaintenanceModelError"; this.code = code; }
}
function reject(code: string): never { throw new KnowledgeMaintenanceModelError(code); }
function checkSignal(signal?: AbortSignal) {
  if (signal?.aborted) reject("knowledge_maintenance_cancelled");
}

/** Stable original ranges, not model-written quotations or invented PDF locations. */
function originalUnits(candidate: BackgroundKnowledgeCandidate): OriginalUnit[] {
  const issue = backgroundKnowledgePdfCoverageIssue(candidate);
  if (issue) reject(issue);
  const parts = candidate.definition.kind === "pdf"
    ? candidate.observed.pages!.map(page => ({ text: page.text, page: page.page }))
    : [{ text: candidate.observed.text, page: null }];
  const units: OriginalUnit[] = [];
  const occurrences = new Map<string, number>();
  for (const part of parts) {
    for (let offset = 0; offset < part.text.length;) {
      let end = Math.min(offset + 3000, part.text.length);
      // Do not split a surrogate pair; the authoritative text remains unchanged.
      if (end < part.text.length && /[\uD800-\uDBFF]/u.test(part.text[end - 1]!)) end -= 1;
      const originalText = part.text.slice(offset, end); offset = end;
      if (!originalText.trim()) continue;
      const id = `p${part.page ?? 0}-${knowledgeReviewHash(originalText).slice(0, 20)}`;
      // Preserve unchanged unit identities when another paragraph is inserted.
      const occurrence = occurrences.get(id) ?? 0;
      occurrences.set(id, occurrence + 1);
      units.push({ id: `p${part.page ?? 0}-${knowledgeReviewHash([id, occurrence]).slice(0, 20)}`, originalText, page: part.page });
      if (units.length > 32) reject("knowledge_maintenance_batch_too_large");
    }
  }
  if (!units.length) reject("knowledge_maintenance_no_readable_content");
  return units;
}

/**
 * Production model stages shared by cloud and local assembly. The supplied
 * gateway is already bound to the operator work, durable budget and cancellation.
 * This module cannot select a credential, publish, retry or start another run.
 */
export async function prepareKnowledgeMaintenance(input: {
  candidate: BackgroundKnowledgeCandidate;
  baseline: KnowledgeMaintenanceBaseline | null;
  growthRules: readonly KnowledgeGrowthRuleBinding[];
  fetchedAt: string;
  completeText: Pick<AgentGatewayModel, "completeText">["completeText"];
  signal?: AbortSignal;
}): Promise<PreparedKnowledgeMaintenance> {
  const { candidate, baseline, signal } = input;
  checkSignal(signal);
  if (candidate.observationHash !== observationHash(candidate.observed)
    || candidate.watchId !== candidate.definition.id || candidate.observed.url !== candidate.definition.url)
    reject("knowledge_maintenance_observation_mismatch");
  z.iso.datetime({ offset: true }).parse(input.fetchedAt);
  if (Date.parse(input.fetchedAt) > Date.now()) reject("knowledge_maintenance_observation_mismatch");
  if (baseline) {
    z.uuid().parse(baseline.versionId);
    parseKnowledgeSource(baseline.source);
    if (baseline.versionHash !== sourceVersionHash(baseline.source)
      || baseline.source.sourceId !== candidate.watchId || baseline.source.url !== candidate.observed.url
      || baseline.observationHash !== candidate.previousObservationHash)
      reject("knowledge_maintenance_baseline_mismatch");
  } else if (candidate.previousObservationHash !== null) reject("knowledge_maintenance_baseline_missing");
  const units = originalUnits(candidate);
  const organize = await loadAgentPrompt("knowledge-organize", "structured", INPUTS);
  const complete = async (stage: "organize" | "review", system: string, payload: unknown) => {
    checkSignal(signal);
    const user = JSON.stringify(payload);
    // Fail explicitly rather than silently truncate evidence; the gateway also
    // applies its actual model/runtime capacity and the shared work budget.
    if (system.length + user.length > 64000) reject("knowledge_maintenance_input_limit");
    const attemptKey = `knowledge-${stage}:${knowledgeReviewHash({ system, user })}`;
    const raw = await input.completeText({ system, user, attemptKey });
    checkSignal(signal);
    if (raw.length > 128000) reject("knowledge_maintenance_output_limit");
    // Accept a complete JSON code block, never extract a guessed object from
    // surrounding prose or repair malformed JSON. Schema/evidence checks follow.
    const trimmed = raw.trim(), fenced = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/u.exec(trimmed);
    let value: unknown;
    try { value = JSON.parse(fenced ? fenced[1]! : trimmed); } catch { reject("knowledge_maintenance_invalid_json"); }
    return { value, attemptKey };
  };
  const reusable = new Map<string, KnowledgeSourceInput["chunks"][number]>();
  for (const unit of units) {
    // Reuse only an unambiguous, exact original range on the same PDF page.
    // Similar wording, a short excerpt or a different location is not enough.
    const matches = baseline?.source.chunks.filter(chunk => chunk.originalText === unit.originalText
      && (chunk.pageStart ?? null) === unit.page && (chunk.pageEnd ?? null) === unit.page) ?? [];
    if (matches.length === 1 && units.filter(other => other.originalText === unit.originalText && other.page === unit.page).length === 1)
      reusable.set(unit.id, matches[0]!);
  }
  const pending = units.filter(unit => !reusable.has(unit.id));
  const organized = pending.length ? await complete("organize", organize.text, {
    role: "background-knowledge-maintenance", watch: candidate.definition,
    observationHash: candidate.observationHash, originalUnits: pending,
    outputSchema: z.toJSONSchema(organizedSchema, { io: "input" }),
  }) : null;
  const drafted = organized ? organizedSchema.parse(organized.value) : { units: [] };
  const byId = new Map(drafted.units.map(unit => [unit.unitId, unit]));
  if (byId.size !== drafted.units.length || byId.size !== pending.length
    || pending.some(unit => !byId.has(unit.id))) reject("knowledge_maintenance_coverage_mismatch");
  const source = parseKnowledgeSource({
    sourceId: candidate.watchId, url: candidate.observed.url, title: candidate.observed.title,
    publisher: candidate.definition.publisher, classification: candidate.definition.classification,
    sourcePublishedAt: candidate.observed.sourcePublishedAt, sourceUpdatedAt: candidate.observed.sourceUpdatedAt,
    sourceDateText: candidate.observed.sourceDateText, fetchedAt: input.fetchedAt, termsUrl: candidate.definition.termsUrl,
    ...(candidate.observed.extraction ? { extraction: candidate.observed.extraction } : {}),
    chunks: units.map(unit => {
      const existing = reusable.get(unit.id);
      if (existing) return existing;
      const draft = byId.get(unit.id)!;
      // The short original preview is deterministic, not model-authored evidence.
      // Full original text remains available to the independent semantic review.
      const sourceExcerpt = [...unit.originalText.trim()].slice(0, 150).join("");
      return { key: unit.id, section: draft.section, sourceExcerpt,
        originalText: unit.originalText, text: draft.text, keywords: draft.keywords, applicability: draft.applicability,
        ...(unit.page !== null ? { pageStart: unit.page, pageEnd: unit.page } : {}) };
    }),
  });
  const reviewPrompt = await loadAgentPrompt("knowledge-review", "structured", INPUTS);
  const before = new Map(baseline?.source.chunks.map(chunk => [chunk.key, chunk]) ?? []);
  const after = new Map(source.chunks.map(chunk => [chunk.key, chunk]));
  const preview = (chunk: KnowledgeSourceInput["chunks"][number] | undefined) =>
    chunk ? [...(chunk.originalText ?? chunk.sourceExcerpt).trim()].slice(0, 150).join("") : null;
  const comparisonUnits = [...new Set([...before.keys(), ...after.keys()])].map(key => ({
    key, oldQuote: preview(before.get(key)), newQuote: preview(after.get(key)),
  }));
  const growthRuleBindings = input.growthRules.filter(rule => rule.sourceId === candidate.watchId).map(rule => {
    const previousHash = before.has(rule.key) ? knowledgeHash(before.get(rule.key)) : null;
    const nextHash = after.has(rule.key) ? knowledgeHash(after.get(rule.key)) : null;
    return { ...rule, previousHash, nextHash,
      state: previousHash === rule.hash && nextHash === rule.hash ? "unchanged" as const : "requires_review" as const };
  });
  const binding = { comparedVersionId: baseline?.versionId ?? null, comparedHash: baseline?.versionHash ?? null,
    observationHash: candidate.observationHash };
  const reviewed = await complete("review", reviewPrompt.text, {
    role: "knowledge-semantic-review",
    binding, comparisonUnits, growthRuleBindings, candidate: source, baseline: baseline?.source ?? null,
    outputSchema: z.toJSONSchema(modelAssessmentSchema, { io: "input" }),
  });
  const modelAssessment = modelAssessmentSchema.parse(reviewed.value);
  // The model cannot certify executable rules or erase a changed dependency.
  if (modelAssessment.growthRuleImpact === "reviewed") reject("knowledge_growth_rule_authority_invalid");
  const changedRule = growthRuleBindings.some(rule => rule.state === "requires_review");
  const assessment = validateKnowledgeAssessment({ ...modelAssessment, ...binding,
    ...(changedRule ? { growthRuleImpact: "requires_review",
      growthRuleReason: "Server: existing growth rule source binding changed or is unavailable. " + modelAssessment.growthRuleReason.slice(0, 1800) } : {}),
    changes: modelAssessment.changes.map(change => {
      const original = comparisonUnits.find(unit => unit.key === change.key);
      if (!original) reject("knowledge_maintenance_review_unit_mismatch");
      return { ...change, oldQuote: original.oldQuote, newQuote: original.newQuote };
    }),
  }, source, baseline?.source ?? null);
  if (assessment.observationHash !== candidate.observationHash
    || assessment.comparedVersionId !== (baseline?.versionId ?? null)
    || assessment.comparedHash !== (baseline?.versionHash ?? null))
    reject("knowledge_maintenance_review_binding_mismatch");
  const review = backgroundKnowledgeReviewBindingSchema.parse({
    watchId: candidate.watchId, observationHash: candidate.observationHash,
    previousObservationHash: candidate.previousObservationHash,
    decision: assessment.decision === "approve" && assessment.growthRuleImpact === "none" ? "approve_candidate" : "hold_candidate",
    reviewKind: "model_review", policyVersion: BACKGROUND_KNOWLEDGE_POLICY_VERSION,
    modelReviewCompleted: true, growthRuleImpact: assessment.growthRuleImpact,
    notes: [assessment.growthRuleReason.slice(0, 240)],
  });
  return { source, versionHash: sourceVersionHash(source), assessment, review,
    provenance: { packVersion: organize.packVersion,
      organizeAttemptKey: organized?.attemptKey ?? "reused-originals:" + knowledgeReviewHash([...reusable.values()]),
      reviewAttemptKey: reviewed.attemptKey } };
}

/** No memory fallback: the durable caller must store evidence before returning approval. */
export function createModelKnowledgeReviewPort(options: {
  completeText: Pick<AgentGatewayModel, "completeText">["completeText"];
  growthRules: readonly KnowledgeGrowthRuleBinding[];
  baseline(candidate: BackgroundKnowledgeCandidate): Promise<KnowledgeMaintenanceBaseline | null>;
  fetchedAt(candidate: BackgroundKnowledgeCandidate): Promise<string>;
  savePrepared(candidate: BackgroundKnowledgeCandidate, prepared: PreparedKnowledgeMaintenance): Promise<void>;
}): KnowledgeSemanticReviewPort {
  return {
    async review(candidate, signal) {
      checkSignal(signal);
      const prepared = await prepareKnowledgeMaintenance({ candidate, baseline: await options.baseline(candidate),
        fetchedAt: await options.fetchedAt(candidate), completeText: options.completeText, growthRules: options.growthRules, signal });
      checkSignal(signal);
      await options.savePrepared(candidate, prepared);
      checkSignal(signal);
      return prepared.review;
    },
  };
}
