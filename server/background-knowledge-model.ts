import { amendedPdfChunks, pdfAmendmentSchema, type PdfAmendment } from "./knowledge-pdf-amendments.ts";
import { layoutFactContract, type KnowledgePdfQuestion, type LayoutFacts } from "./knowledge-pdf-layout.ts";
import { z } from "zod";
import { ageScopeInstruction, independentAgeCheck, modelAgeApplicability } from './knowledge-age-output.ts';
import { reviseRetainedDraft, type RetainedOrganizerRevision, type retainedDraftProvenanceSchema } from './knowledge-retained-draft.ts';
import { nativeCoverageSchema, nativeResponseSchema, pdfOrganizationContract } from "./knowledge-pdf-output.ts";
import { damagedPdfText, pdfQuantityLocators, readablePdfQuote } from "./knowledge-pdf-quotes.ts";
import type { KnowledgeSourceInput } from "../src/shared/knowledge.ts";
import {
  BACKGROUND_KNOWLEDGE_POLICY_VERSION, backgroundKnowledgeReviewBindingSchema,
  type BackgroundKnowledgeReviewBinding,
} from "../src/shared/background-knowledge-maintenance.ts";
import type { BackgroundKnowledgeCandidate, KnowledgeSemanticReviewPort } from "./background-knowledge-maintenance.ts";
import { backgroundKnowledgePdfCoverageIssue } from "./background-knowledge-maintenance.ts";
import { loadAgentPrompt, loadRecordedKnowledgePrompt } from "./agent-prompt.ts";
import { knowledgeChunkInputSchema, knowledgeHash, originalOrganizerApplicability, parseKnowledgeSource, sourceVersionHash } from "./knowledge-inputs.ts";
import { observationHash } from "./knowledge-observation.ts";
import {
  knowledgeReviewAssessmentSchema, knowledgeReviewHash, validateKnowledgeAssessment,
  type KnowledgeReviewAssessment,
} from "./knowledge-review-assessment.ts";
import { originalKnowledgePdf, type AgentGatewayModel } from "./agent-model-gateway.ts";

const INPUTS = ["run", "scope", "context", "evidence", "capabilities", "outputContract"];
const fields = knowledgeChunkInputSchema.shape;
const organizedSchema = z.strictObject({
  units: z.array(z.strictObject({
    unitId: z.string().regex(/^p[0-9]+-[a-f0-9]{20}$/u),
    section: fields.section, text: fields.text,
    keywords: fields.keywords, applicability: originalOrganizerApplicability,
  })).min(1).max(32),
});
const explicitAgeOrganization = organizedSchema.extend({
  units: z.array(organizedSchema.shape.units.element.extend({ applicability: modelAgeApplicability })).min(1).max(32),
});
const reviewFields = knowledgeReviewAssessmentSchema.shape;
const modelAssessmentSchema = z.strictObject({
  changes: z.array(z.strictObject({
    key: reviewFields.changes.element.shape.key,
    meaning: reviewFields.changes.element.shape.meaning,
    explanation: reviewFields.changes.element.shape.explanation,
  })).max(64),
  checks: reviewFields.checks, questions: reviewFields.questions,
  decisionReason: reviewFields.growthRuleReason,
  decision: reviewFields.decision,
});
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const focusReadingSchema = z.strictObject({ finding: z.string().trim().min(1).max(240),
  layoutFacts: z.record(z.string(), z.string().min(1).max(80)), attemptKey: z.string().max(150) });
export const focusEvidenceSchema = z.strictObject({ priorWork: digest, priorVersionHash: digest,
  parentHash: digest, contentHash: digest, physicalPage: z.number().int().positive(), method: z.string().min(1).max(80),
  mediaResolution: z.literal("MEDIA_RESOLUTION_HIGH"), organize: focusReadingSchema, review: focusReadingSchema });
export const nativePdfProvenanceSchema = z.strictObject({
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  organize: nativeCoverageSchema, review: nativeCoverageSchema,
  focus: focusEvidenceSchema.optional(),
  revision: z.strictObject({ priorWork: digest, priorVersionHash: digest, originalOrganizeAttempt: z.string().min(1),
    editingMethod: z.enum(["observed-pages-and-prior-reading/1", "cited-editorial-amendment/1"]),
    amendments: z.array(pdfAmendmentSchema.extend({ supported: z.boolean(), reason: z.string().min(1).max(300) })).max(32).optional(), feedback: z.string().min(1).max(1000) }).optional(),
  priorConditions: z.array(z.strictObject({
    oldKey: z.string(), pageStart: z.number().int(), pageEnd: z.number().int(), original: z.string(),
    newKey: z.string(), disposition: z.enum(["retained", "prior_edition_note", "unresolved"]),
    currentCondition: z.string().nullable(), reason: z.string().min(1).max(300),
  })).max(256).optional(),
  layoutQuestion: z.string().min(1).max(500).nullable(),
});
export const destinationReviewSchema = z.strictObject({
  destination: z.string().min(1).max(200), previousObservationHash: digest,
  assessment: knowledgeReviewAssessmentSchema,
});
export type { KnowledgePdfQuestion } from "./knowledge-pdf-layout.ts";
export type KnowledgePdfAcceptance = (sourceHash: string, physicalPage: number, role: "organize" | "review", facts: LayoutFacts) => boolean;

/** Verification clients may check a frozen sample against their own independently recorded reference. */
export function assertPreparedKnowledgePdfLayout(prepared: PreparedKnowledgeMaintenance,
  query?: KnowledgePdfQuestion, acceptance?: KnowledgePdfAcceptance) {
  if (!query?.factKeys?.length || prepared.source.extraction?.contentHash !== query.contentHash) return;
  const proof = prepared.provenance.nativePdf;
  if (!proof || proof.contentHash !== query.contentHash || proof.layoutQuestion !== query.question || !query.physicalPage)
    reject("knowledge_native_visual_evidence_missing");
  const schema = layoutFactContract(query.factKeys);
  for (const role of ["organize","review"] as const) {
    const observed = proof.focus?.physicalPage === query.physicalPage ? proof.focus[role] : proof[role];
    const facts = schema.safeParse(observed.layoutFacts);
    if (!facts.success || (acceptance && !acceptance(query.contentHash,query.physicalPage,role,facts.data)))
      reject("knowledge_native_visual_sample_mismatch");
  }
}
type OriginalUnit = { id: string; originalText: string; page: number | null; pageEnd: number | null };
type Applicability = KnowledgeSourceInput["chunks"][number]["applicability"];
export function includePriorRetrieval(current: Applicability, prior: Applicability[]): Applicability {
  if (!prior.length) return current;
  const scopes = [current, ...prior];
  if (scopes.some(scope => scope.region !== current.region)) reject("knowledge_pdf_region_conflict");
  const topics = [...new Set(scopes.flatMap(scope => scope.topics))];
  const { maxAgeMonthsExclusive: _, ...rest } = current;
  // Only the organizer may propose an unrestricted range for independent
  // review. Numeric scopes cannot bridge a gap or change the age basis.
  if (new Set(scopes.map(scope => scope.ageBasis).filter(basis => basis !== "any")).size > 1)
    reject("knowledge_pdf_age_scope_conflict");
  if (current.ageBasis === "any") return { ...current, topics };
  if (prior.some(scope => scope.ageBasis !== current.ageBasis)) reject("knowledge_pdf_age_scope_conflict");
  const ordered = [...scopes].sort((a, b) => a.minAgeMonths! - b.minAgeMonths!);
  let coveredTo = ordered[0]!.maxAgeMonths!;
  for (const scope of ordered.slice(1)) {
    if (scope.minAgeMonths! > coveredTo) reject("knowledge_pdf_age_scope_conflict");
    coveredTo = Math.max(coveredTo, scope.maxAgeMonths!);
  }
  return { ...rest, topics, minAgeMonths: ordered[0]!.minAgeMonths, maxAgeMonths: coveredTo,
    ...(scopes.filter(scope => scope.maxAgeMonths === coveredTo).every(scope => scope.maxAgeMonthsExclusive)
      ? { maxAgeMonthsExclusive: true } : {}) };
}
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
  provenance: { packVersion: string; organizeAttemptKey: string; reviewAttemptKey: string; retainedDraft?: z.infer<typeof retainedDraftProvenanceSchema>; nativePdf?: z.infer<typeof nativePdfProvenanceSchema>; destinationReview?: z.infer<typeof destinationReviewSchema>; windows?: import("./knowledge-pdf-windows.ts").WindowReading[] };
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
  let parts: { text: string; page: number | null }[] = candidate.definition.kind === "pdf"
    ? candidate.observed.pages!.map(page => ({ text: page.text, page: page.page }))
    : [{ text: candidate.observed.text, page: null }];
  const ends = new Map<number, number>();
  if (candidate.definition.leafletPage) {
    const grouped: typeof parts = [];
    for (const part of parts) {
      const prev = grouped.at(-1);
      if (prev && prev.text.length + part.text.length + 2 <= 3000) {
        prev.text += "\n\n" + part.text; ends.set(prev.page!, part.page!);
      } else grouped.push({ ...part });
    }
    parts = grouped;
  }
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
      units.push({ id: `p${part.page ?? 0}-${knowledgeReviewHash([id, occurrence]).slice(0, 20)}`, originalText, page: part.page, pageEnd: ends.get(part.page!) ?? part.page });
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
  explicitAgeScope?: boolean;
  retainedDraft?: { revision: RetainedOrganizerRevision; readOrganizer(attemptKey: string): Promise<string> };
  candidate: BackgroundKnowledgeCandidate;
  baseline: KnowledgeMaintenanceBaseline | null;
  growthRules: readonly KnowledgeGrowthRuleBinding[];
  fetchedAt: string;
  completeText: Pick<AgentGatewayModel, "completeText">["completeText"];
  readPdf?: (sourceId: string, hash: string) => Promise<Buffer>;
  pdfQuestion?: KnowledgePdfQuestion;
  acceptance?: KnowledgePdfAcceptance;
  previousVisual?: Pick<z.infer<typeof nativePdfProvenanceSchema>, "focus" | "layoutQuestion">;
  heldDraft?: { work: string; prepared: PreparedKnowledgeMaintenance; feedback: string; amendments?: PdfAmendment[] };
  signal?: AbortSignal;
}): Promise<PreparedKnowledgeMaintenance> {
  const { candidate, baseline, signal } = input;
  const retained = input.retainedDraft;
  if (retained && (baseline || (retained.revision.action !== 'review_age_draft'
    ? candidate.definition.kind !== 'pdf' || candidate.observed.extraction?.contentHash !== retained.revision.sha256
      || Boolean(input.explicitAgeScope) !== (retained.revision.action === 'review_pdf_region')
    : candidate.definition.kind !== 'page' || input.explicitAgeScope)
    || candidate.watchId !== retained.revision.sourceId || candidate.observationHash !== retained.revision.observationHash))
    reject('knowledge_retained_page_binding');
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
  const sha = candidate.definition.leafletPage ? candidate.observed.extraction!.contentHash : null;
  if (sha && !input.readPdf) reject("knowledge_original_missing");
  const sample = sha && input.pdfQuestion?.contentHash === sha && input.pdfQuestion.factKeys?.length
    ? input.pdfQuestion : null;
  if (sample && (!Number.isSafeInteger(sample.physicalPage) || sample.physicalPage! < 1
    || sample.physicalPage! > candidate.observed.extraction!.totalPages!)) reject("knowledge_native_visual_range_mismatch");
  const pdf = sha ? originalKnowledgePdf(await input.readPdf!(candidate.watchId, sha), sha, sample !== null || Boolean(input.previousVisual || input.heldDraft)) : undefined;
  const layoutQuestion = sample?.question ?? (pdf && input.pdfQuestion?.contentHash === sha ? input.pdfQuestion.question : null);
  function coverage(value: unknown) {
    const report = nativeCoverageSchema.parse(value);
    if (report.unreadablePages.length || report.pages.length !== candidate.observed.extraction?.totalPages
      || report.pages.some((p, i) => p.page !== i + 1) || Boolean(report.layoutAnswer) !== Boolean(layoutQuestion))
      reject("knowledge_native_read_incomplete");
    return report;
  }
  const nativeScope = pdf ? { readScope: { contentHash: sha, firstPage: 1,
    lastPage: candidate.observed.extraction!.totalPages }, layoutQuestion,
    textLayerWarnings: candidate.observed.pages!.filter(p => damagedPdfText.test(p.text)).map(p => p.page),
    quantityLocators: pdfQuantityLocators(candidate.observed.pages!),
    ...(sample ? { physicalPage: sample.physicalPage } : {}) } : {};
  const priorRanges = baseline?.source.extraction?.contentHash === sha ? baseline.source.chunks : [];
  const priorTopics = [...new Set(priorRanges.flatMap(chunk => chunk.applicability.topics))].slice(0, 12);
  const held = input.heldDraft, priorReading = held?.prepared.provenance.nativePdf;
  if (held && (!pdf || sample || !priorReading || priorReading.contentHash !== sha
    || held.prepared.source.sourceId !== candidate.watchId || held.prepared.source.url !== candidate.observed.url
    || held.prepared.source.extraction?.contentHash !== sha
    || held.prepared.versionHash !== sourceVersionHash(held.prepared.source) || held.prepared.assessment.observationHash !== candidate.observationHash))
    reject("knowledge_pdf_revision_binding_mismatch");
  const output = input.explicitAgeScope ? explicitAgeOrganization : organizedSchema;
  const pdfContract = pdf ? pdfOrganizationContract(units, sample?.factKeys, priorTopics, priorReading?.organize, input.explicitAgeScope) : null;
  const samePages = (unit: OriginalUnit) => priorRanges.filter(chunk => chunk.pageStart && chunk.pageEnd
    && chunk.pageStart >= unit.page! && chunk.pageEnd <= unit.pageEnd! && chunk.originalText
    && unit.originalText.includes(chunk.originalText));
  const priorVisual = input.previousVisual ?? (priorReading?.focus
    ? { focus: priorReading.focus, layoutQuestion: priorReading.layoutQuestion } : undefined);
  if (priorVisual && (!priorVisual.focus || priorVisual.focus.parentHash !== sha || !priorVisual.layoutQuestion || sample))
    reject("knowledge_focus_binding_mismatch");
  const organize = await loadAgentPrompt("knowledge-organize", "structured", INPUTS);
  let recordedLineEnding: "\n" | "\r\n" | undefined;
  const complete = async (stage: "organize" | "review", system: string, payload: unknown, responseJsonSchema?: Record<string, unknown>) => {
    checkSignal(signal);
    const user = JSON.stringify(payload);
    const keyFor = (prompt: string) => `knowledge-${stage}:${knowledgeReviewHash({ system: prompt, user, ...(pdf ? { pdfHash: sha, responseJsonSchema } : {}) })}`;
    let attemptKey = keyFor(system);
    const fromOriginal = retained && stage === 'organize';
    if (fromOriginal && knowledgeReviewHash({system, user, attemptKey}) !== retained.revision.organizerRequestHash) {
      for (const ending of ["\r\n", "\n"] as const) {
        const historical = await loadRecordedKnowledgePrompt("knowledge-organize", INPUTS, ending);
        const key = keyFor(historical.text);
        if (knowledgeReviewHash({ system: historical.text, user, attemptKey: key }) === retained.revision.organizerRequestHash) {
          recordedLineEnding = ending;
          system = historical.text;
          attemptKey = key;
          break;
        }
      }
      if (!recordedLineEnding) reject('knowledge_retained_page_request_changed');
    }
    // Fail explicitly rather than silently truncate evidence; the gateway also
    // applies its actual model/runtime capacity and the shared work budget.
    if (system.length + user.length > 64000) reject("knowledge_maintenance_input_limit");
    const raw = fromOriginal ? await retained.readOrganizer(attemptKey) : await input.completeText({ system, user, attemptKey, ...(pdf && !(held && stage === "organize") ? { pdf } : {}),
      ...(responseJsonSchema ? { responseJsonSchema } : {}),
      role: stage === "review" ? "knowledge_review" : "knowledge_organize",
      ...(stage === "review" ? { purpose: "knowledge_review" as const } : {}) });
    checkSignal(signal);
    if (raw.length > 128000) reject("knowledge_maintenance_output_limit");
    // Accept a complete JSON code block, never extract a guessed object from
    // surrounding prose or repair malformed JSON. Schema/evidence checks follow.
    const trimmed = raw.trim(), fenced = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/u.exec(trimmed);
    let value: unknown;
    try { value = JSON.parse(fenced ? fenced[1]! : trimmed); } catch { reject("knowledge_maintenance_invalid_json"); }
    return { value: fromOriginal ? reviseRetainedDraft(value, retained.revision, units) : value, attemptKey };
  };
  const amendments = held?.amendments;
  const reusable = amendments ? amendedPdfChunks(units, held.prepared.source.chunks, candidate.observed.pages!, amendments)
    : new Map<string, KnowledgeSourceInput["chunks"][number]>();
  for (const unit of units) {
    // Reuse only an unambiguous, exact original range on the same PDF page.
    // Similar wording, a short excerpt or a different location is not enough.
    const matches = baseline?.source.chunks.filter(chunk => chunk.originalText === unit.originalText
      && (chunk.pageStart ?? null) === unit.page && (chunk.pageEnd ?? null) === unit.page) ?? [];
    if (!pdf && matches.length === 1 && units.filter(other => other.originalText === unit.originalText && other.page === unit.page).length === 1)
      reusable.set(unit.id, matches[0]!);
  }
  if (amendments && priorVisual?.focus) {
    const focus = priorVisual.focus;
    const sampleChunk = [...reusable.values()].find(chunk => chunk.pageStart! <= focus.physicalPage && chunk.pageEnd! >= focus.physicalPage);
    const claims = [priorVisual.layoutQuestion!, ...Object.values(focus.review.layoutFacts)];
    if (!sampleChunk || claims.some(claim => !sampleChunk.text.includes(claim))) reject("knowledge_focus_binding_mismatch");
  }
  const pending = units.filter(unit => !reusable.has(unit.id));
  const organized = pending.length ? await complete("organize", organize.text, {
    role: "background-knowledge-maintenance", watch: candidate.definition,
    ...(input.explicitAgeScope ? { ageScope: ageScopeInstruction } : {}),
    observationHash: candidate.observationHash,
    ...(held ? { task:"reviseHeldReading", outputLanguage:"香港繁體中文，正文及條件採用阿拉伯數字",
      feedback:held.feedback, previousDraft:held.prepared.source.chunks.map(({section,applicability,pageStart,pageEnd}) =>
        ({section,applicability,pageStart,pageEnd})), pages:candidate.observed.pages,
      originalReadings:priorReading!.organize.pages } : {}),
    ...(pdfContract ? { ranges: pdfContract.ranges.map(({ key, first, last, pages }) => ({ key, first, last, pages })),
      priorRetrieval: priorRanges.map(({ pageStart, pageEnd, section, applicability, sourceExcerpt }) =>
        ({ pageStart, pageEnd, section, applicability, sourceExcerpt })) }
      : { originalUnits: pending.map(({ pageEnd: _, ...unit }) => unit) }),
    ...nativeScope,
    ...(pdf ? {} : { outputSchema: z.toJSONSchema(output, { io: "input" }) }),
  }, pdfContract ? pdfContract.schema : nativeResponseSchema(output)) : null;
  const pdfParser = retained?.revision.action === 'review_pdf_source_age' ? pdfOrganizationContract(units, [], [], undefined, false, true) : pdfContract;
  const parsedDraft = organized && pdfParser ? pdfParser.parse(organized.value) : null;
  const organizedCoverage = parsedDraft ? coverage(parsedDraft.nativeCoverage) : amendments ? coverage(priorReading!.organize) : null;
  if (sample && input.acceptance && !input.acceptance(sha!,sample.physicalPage!,"organize",organizedCoverage!.layoutFacts!))
    reject("knowledge_native_visual_sample_mismatch");
  const drafted = parsedDraft ?? (organized ? output.parse(organized.value) : { units: [] });
  if (held && drafted.units.some(unit => !/\p{Script=Han}/u.test(unit.section) || !/\p{Script=Han}/u.test(unit.text)))
    reject("knowledge_pdf_revision_language_mismatch");
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
      if (existing) return amendments ? { ...existing, applicability: includePriorRetrieval(existing.applicability,
        samePages(unit).map(chunk => chunk.applicability)) } : existing;
      const draft = byId.get(unit.id)!;
      // The short original preview is deterministic, not model-authored evidence.
      // Full original text remains available to the independent semantic review.
      const evidence = pdf ? readablePdfQuote(unit.originalText, samePages(unit)[0]?.sourceExcerpt)
        : { originalText: unit.originalText, sourceExcerpt: [...unit.originalText.trim()].slice(0, 150).join("") };
      const focus = priorVisual?.focus;
      const text = focus && unit.page! <= focus.physicalPage && unit.pageEnd! >= focus.physicalPage
        ? draft.text + "\n" + priorVisual.layoutQuestion + "\n" + Object.values(focus.review.layoutFacts).join("、") : draft.text;
      // Regrouping unchanged physical pages retains their existing retrieval
      // eligibility. The independent review sees the resulting scope and text.
      const applicability = pdf ? includePriorRetrieval(draft.applicability, samePages(unit).map(chunk => chunk.applicability))
        : draft.applicability;
      return { key: unit.id, section: draft.section, ...evidence,
        text, keywords: draft.keywords, applicability,
        ...(unit.page !== null ? { pageStart: unit.page, pageEnd: unit.pageEnd! } : {}) };
    }),
  });
  const reviewPrompt = recordedLineEnding ? await loadRecordedKnowledgePrompt("knowledge-review", INPUTS, recordedLineEnding)
    : await loadAgentPrompt("knowledge-review", "structured", INPUTS);
  const priorConditions = units.flatMap(unit => samePages(unit).flatMap(old =>
    old.applicability.conditions.map(original => ({ oldKey: old.key, pageStart: old.pageStart!, pageEnd: old.pageEnd!,
      original, newKey: unit.id, conditions: source.chunks.find(chunk => chunk.key === unit.id)!.applicability.conditions }))))
    .map((row, index) => ({ ...row, field: "priorCondition" + (index + 1) }));
  const before = new Map(baseline?.source.chunks.map(chunk => [chunk.key, chunk]) ?? []);
  const after = new Map(source.chunks.map(chunk => [chunk.key, chunk]));
  const preview = (chunk: KnowledgeSourceInput["chunks"][number] | undefined) =>
    chunk ? [...(chunk.sourceExcerpt || chunk.originalText || "").trim()].slice(0, 150).join("") : null;
  const comparisonUnits = [...new Set([...before.keys(), ...after.keys()])].map(key => ({
    key, oldQuote: preview(before.get(key)), newQuote: preview(after.get(key)),
  }));
  // The runtime selects a rule by source, key and exact chunk hash. An unrelated key
  // cannot activate or displace that binding, including on the first publication.
  const growthRuleBindings = input.growthRules.filter(rule => rule.sourceId === candidate.watchId
    && (before.has(rule.key) || after.has(rule.key))).map(rule => {
    const previousHash = before.has(rule.key) ? knowledgeHash(before.get(rule.key)) : null;
    const nextHash = after.has(rule.key) ? knowledgeHash(after.get(rule.key)) : null;
    return { ...rule, previousHash, nextHash,
      state: previousHash === rule.hash && nextHash === rule.hash ? "unchanged" as const : "requires_review" as const };
  });
  const binding = { comparedVersionId: baseline?.versionId ?? null, comparedHash: baseline?.versionHash ?? null,
    observationHash: candidate.observationHash };
  const changeFields = modelAssessmentSchema.shape.changes.element.shape;
  const pageKeys = pdf ? Array.from({ length: candidate.observed.extraction!.totalPages! }, (_, i) => "page" + (i + 1)) : [];
  const reviewCoverage = nativeCoverageSchema.omit({pages:true}).extend({
    ...(sample ? { layoutFacts: layoutFactContract(sample.factKeys!) } : {}),
    pageFindings: z.strictObject(Object.fromEntries(pageKeys.map(key => [key, nativeCoverageSchema.shape.pages.element.shape.finding]))),
  });
  const amendmentDecision = z.strictObject({ supported: z.boolean(), reason: z.string().trim().min(1).max(300) });
  const pdfReviewSchema = pdf ? modelAssessmentSchema.extend({
    ...(amendments ? { amendments: z.strictObject(Object.fromEntries(amendments.map(edit => [edit.key, amendmentDecision]))) } : {}),
    ...(priorConditions.length ? { priorConditions: z.strictObject(Object.fromEntries(priorConditions.map(row =>
      [row.field, z.strictObject({ disposition: z.enum(["prior_edition_note", "unresolved",
        ...row.conditions.map((_, i) => "condition" + (i + 1))]), reason: z.string().trim().min(1).max(300) })]))) } : {}),
    changes: z.strictObject(Object.fromEntries(comparisonUnits.map(({key, oldQuote, newQuote}) => [key, z.strictObject({
      meaning: oldQuote === null ? z.enum(["new"]) : newQuote === null ? z.enum(["removed"]) : changeFields.meaning, explanation: changeFields.explanation,
    })]))),
    questions: z.array(reviewFields.questions.element.extend({ expectedKeys: z.array(z.enum(source.chunks.map(chunk => chunk.key))) })).min(1).max(12),
    nativeCoverage: reviewCoverage,
  }) : null;
  const reviewed = await complete("review", reviewPrompt.text, {
    role: "knowledge-semantic-review",
    ...(input.explicitAgeScope || retained ? { ageScopeCheck: independentAgeCheck } : {}),
    ...(retained?.revision.action === 'review_age_draft' ? { editorialAgeProposal: { change: 'Only the numeric bounds were cleared in the listed units. Check the full original audience, exceptions and conditions. Hold if this broadens the intended audience.', reason: retained.revision.reason, originalScopes: retained.revision.units } } : {}),
    ...(retained?.revision.action === 'review_pdf_region' ? { editorialRegionProposal: { edits: retained.revision.regionEdits, reason: retained.revision.reason, sections: retained.revision.sections } } : {}),
    ...(retained?.revision.action === 'review_pdf_source_age' ? { officialAgeRanges: { ranges: retained.revision.sourceRanges, regionEdits: retained.revision.regionEdits, reason: retained.revision.reason, sections: retained.revision.sections } } : {}),
    binding, comparisonUnits, growthRuleBindings,
    ...(held ? { revisionFeedback: held.feedback } : {}),
    ...(amendments ? { proposedAmendments: amendments } : {}),
    ...(priorConditions.length ? { priorConditions: priorConditions.map(({ conditions, ...row }) => ({ ...row,
      currentConditions: Object.fromEntries(conditions.map((condition, i) => ["condition" + (i + 1), condition])) })) } : {}),
    candidate: pdf ? { ...source, chunks: source.chunks.map(({ originalText: _, ...chunk }) => chunk) } : source,
    baseline: baseline?.source ?? null, ...nativeScope,
    ...(pdf ? {} : { outputSchema: z.toJSONSchema(modelAssessmentSchema, { io: "input" }) }),
  }, nativeResponseSchema(pdfReviewSchema ?? modelAssessmentSchema));
  // Executable dependencies come from the catalog, not a model's interpretation
  // of whether a passage is about health. Semantic approval remains independent.
  if (reviewed.value && typeof reviewed.value === "object"
    && ("growthRuleImpact" in reviewed.value || "growthRuleReason" in reviewed.value))
    reject("knowledge_growth_rule_authority_invalid");
  const nativeReview = pdfReviewSchema?.parse(reviewed.value);
  const reviewedCoverage = nativeReview ? coverage({
    pages: pageKeys.map((key, i) => ({ page: i + 1, finding: nativeReview.nativeCoverage.pageFindings[key] })),
    ...(nativeReview.nativeCoverage.layoutFacts ? {layoutFacts:nativeReview.nativeCoverage.layoutFacts} : {}),
    layoutAnswer: nativeReview.nativeCoverage.layoutAnswer, unreadablePages: nativeReview.nativeCoverage.unreadablePages,
  }) : null;
  const { decisionReason, ...modelAssessment } = nativeReview
    ? modelAssessmentSchema.parse({ ...Object.fromEntries(Object.entries(nativeReview).filter(([k]) => k !== "nativeCoverage" && k !== "priorConditions" && k !== "amendments")),
      changes: Object.entries(nativeReview.changes).map(([key, change]) => ({ key, ...change })) })
    : modelAssessmentSchema.parse(reviewed.value);
  const conditionDecisions = z.record(z.string(), z.object({disposition:z.string(), reason:z.string()}))
    .parse(nativeReview?.priorConditions ?? {});
  const checkedConditions = priorConditions.map(({ field, conditions, ...row }) => {
    const { disposition, reason } = conditionDecisions[field]!;
    if (disposition === "unresolved" || disposition === "prior_edition_note")
      return { ...row, disposition: disposition as "unresolved" | "prior_edition_note", currentCondition: null, reason };
    const index = conditions.findIndex((_, i) => disposition === "condition" + (i + 1));
    if (index < 0) reject("knowledge_pdf_prior_condition_mismatch");
    return { ...row, disposition: "retained" as const, currentCondition: conditions[index]!, reason };
  });
  const unresolvedCondition = checkedConditions.find(row => row.disposition === "unresolved");
  const amendmentDecisions = z.record(z.string(), amendmentDecision).parse(nativeReview?.amendments ?? {});
  const reviewedAmendments = amendments?.map(edit => ({ ...edit, ...amendmentDecisions[edit.key]! }));
  const unsupportedAmendment = reviewedAmendments?.find(edit => !edit.supported);
  if (unresolvedCondition || unsupportedAmendment) modelAssessment.decision = "hold";
  if (sample) {
    if (input.acceptance && !input.acceptance(sha!,sample.physicalPage!,"review",reviewedCoverage!.layoutFacts!)) reject("knowledge_native_visual_sample_mismatch");
    const matches = source.chunks.filter(chunk => chunk.pageStart! <= sample.physicalPage! && chunk.pageEnd! >= sample.physicalPage!);
    if (matches.length !== 1) reject("knowledge_native_visual_range_mismatch");
    // Add only the claims independently identified by both stages on this physical page.
    const facts = reviewedCoverage!.layoutFacts!;
    if (!input.acceptance && sample.factKeys!.some(k => facts[k] !== organizedCoverage!.layoutFacts![k])) reject("knowledge_native_visual_evidence_disputed");
    const chunk = matches[0]!;
    chunk.text = knowledgeChunkInputSchema.shape.text.parse(chunk.text + "\n" + sample.question
      + "\n" + sample.factKeys!.map(key => facts[key]).join("、"));
  }
  const changedRules = growthRuleBindings.filter(rule => rule.state === "requires_review");
  const changedRule = changedRules.length > 0;
  const assessment = validateKnowledgeAssessment({ ...modelAssessment, ...binding,
    growthRuleImpact: changedRule ? "requires_review" : "none",
    growthRuleReason: changedRule
      ? changedRules.map(rule => `Rule ${rule.id} (${rule.revision}), key ${rule.key}: expected ${rule.hash}, previous ${rule.previousHash ?? "missing"}, candidate ${rule.nextHash ?? "missing"}.`).join(" ")
      : growthRuleBindings.length ? "Server: existing executable source bindings are unchanged."
        : "Server: no executable growth rule is affected by these source keys.",
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
    notes: [(unresolvedCondition?.reason ?? unsupportedAmendment?.reason ?? decisionReason).slice(0, 240), ...(changedRule ? [assessment.growthRuleReason] : [])],
  });
  return { source, versionHash: sourceVersionHash(source), assessment, review,
    provenance: { packVersion: organize.packVersion,
      ...(retained ? {retainedDraft: { priorWork: retained.revision.operationFingerprint, organizerRequestHash: retained.revision.organizerRequestHash, revisionHash: knowledgeReviewHash(retained.revision) }} : {}),
      organizeAttemptKey: organized?.attemptKey ?? (amendments ? priorReading!.revision?.originalOrganizeAttempt ?? held.prepared.provenance.organizeAttemptKey : null) ?? "reused-originals:" + knowledgeReviewHash([...reusable.values()]),
      reviewAttemptKey: reviewed.attemptKey, ...(sha && organizedCoverage && reviewedCoverage ? { nativePdf: { contentHash: sha,
        organize: organizedCoverage, review: reviewedCoverage, layoutQuestion, ...priorVisual,
        ...(held ? { revision: { priorWork:held.work, priorVersionHash:held.prepared.versionHash,
          originalOrganizeAttempt:priorReading!.revision?.originalOrganizeAttempt ?? held.prepared.provenance.organizeAttemptKey, editingMethod: amendments ? "cited-editorial-amendment/1" : "observed-pages-and-prior-reading/1",
          ...(reviewedAmendments ? { amendments: reviewedAmendments } : {}),
          feedback:held.feedback } } : {}), ...(checkedConditions.length ? { priorConditions: checkedConditions } : {}) } } : {}) } };
}

/** No memory fallback: the durable caller must store evidence before returning approval. */
export function createModelKnowledgeReviewPort(options: {
  explicitAgeScope?: boolean;
  retainedDraft?: Parameters<typeof prepareKnowledgeMaintenance>[0]['retainedDraft'];
  completeText: Pick<AgentGatewayModel, "completeText">["completeText"];
  growthRules: readonly KnowledgeGrowthRuleBinding[];
  baseline(candidate: BackgroundKnowledgeCandidate): Promise<KnowledgeMaintenanceBaseline | null>;
  fetchedAt(candidate: BackgroundKnowledgeCandidate): Promise<string>;
  readPdf?: (sourceId: string, hash: string) => Promise<Buffer>;
  pdfQuestion?: KnowledgePdfQuestion;
  acceptance?: KnowledgePdfAcceptance;
  comparison?: { destination: string; baseline: KnowledgeMaintenanceBaseline };
  previousVisual?: (candidate: BackgroundKnowledgeCandidate) => Promise<Pick<z.infer<typeof nativePdfProvenanceSchema>, "focus" | "layoutQuestion">>;
  heldDraft?: () => Promise<NonNullable<Parameters<typeof prepareKnowledgeMaintenance>[0]["heldDraft"]>>;
  savePrepared(candidate: BackgroundKnowledgeCandidate, prepared: PreparedKnowledgeMaintenance): Promise<void>;
}): KnowledgeSemanticReviewPort {
  return {
    async review(candidate, signal) {
      checkSignal(signal);
      const local = await options.baseline(candidate), comparison = options.comparison;
      if (comparison && (local || candidate.previousObservationHash !== null || !comparison.baseline.observationHash))
        reject("knowledge_destination_baseline_conflict");
      const comparedCandidate = comparison ? { ...candidate, previousObservationHash: comparison.baseline.observationHash } : candidate;
      const prepared = await prepareKnowledgeMaintenance({ candidate: comparedCandidate, baseline: comparison?.baseline ?? local,
        explicitAgeScope: options.explicitAgeScope, retainedDraft: options.retainedDraft, previousVisual: await options.previousVisual?.(candidate),
        heldDraft: await options.heldDraft?.(),
        fetchedAt: await options.fetchedAt(candidate), completeText: options.completeText, readPdf: options.readPdf, pdfQuestion: options.pdfQuestion, acceptance: options.acceptance, growthRules: options.growthRules, signal });
      if (comparison) {
        prepared.provenance.destinationReview = destinationReviewSchema.parse({ destination: comparison.destination,
          previousObservationHash: comparison.baseline.observationHash, assessment: prepared.assessment });
        // The reviewer read the whole candidate. On an empty local store every
        // retained key is an addition. Never relabel a destination withdrawal
        // or a changed key as independently assessed against the empty store.
        const additions = prepared.assessment.changes.filter(change => change.newQuote !== null);
        if (additions.length !== prepared.source.chunks.length || additions.some(change => change.meaning !== "new"))
          reject("knowledge_empty_baseline_projection_ambiguous");
        prepared.assessment = validateKnowledgeAssessment({ ...prepared.assessment, comparedVersionId: null, comparedHash: null,
          changes: additions }, prepared.source, null);
        prepared.review = { ...prepared.review, previousObservationHash: null };
      }
      checkSignal(signal);
      await options.savePrepared(candidate, prepared);
      checkSignal(signal);
      return prepared.review;
    },
  };
}
