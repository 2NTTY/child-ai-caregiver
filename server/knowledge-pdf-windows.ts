import { z } from "zod";
import type { KnowledgeSourceInput } from "../src/shared/knowledge.ts";
import { BACKGROUND_KNOWLEDGE_POLICY_VERSION } from "../src/shared/background-knowledge-maintenance.ts";
import { loadAgentPrompt } from "./agent-prompt.ts";
import { originalKnowledgePdf, type AgentGatewayModel } from "./agent-model-gateway.ts";
import type { BackgroundKnowledgeCandidate } from "./background-knowledge-maintenance.ts";
import { KnowledgeMaintenanceModelError, type KnowledgeMaintenanceBaseline, type PreparedKnowledgeMaintenance } from "./background-knowledge-model.ts";
import { knowledgeChunkInputSchema, knowledgeHash, parseKnowledgeSource, sourceVersionHash } from "./knowledge-inputs.ts";
import type { KnowledgePdfPage } from "./knowledge-pdf.ts";
import { nativeResponseSchema } from "./knowledge-pdf-output.ts";
import { knowledgeReviewAssessmentSchema, knowledgeReviewHash, validateKnowledgeAssessment } from "./knowledge-review-assessment.ts";
export const PDF_WINDOW_METHOD = "native-pdf-window/1";
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const location = z.number().int().positive();
const pageFinding = z.strictObject({
  page: location, status: z.enum(["content", "navigation", "duplicate", "out_of_scope", "unreadable"]),
  reason: z.string().trim().min(1).max(240)
});
const chunk = knowledgeChunkInputSchema;
export const windowReadingSchema = z.strictObject({
  parentHash: digest, sliceHash: digest, first: location, last: location, firstRead: location, lastRead: location,
  method: z.literal(PDF_WINDOW_METHOD), organizeKey: z.string().max(150), reviewKey: z.string().max(150),
  pages: z.array(pageFinding).min(1).max(14), organizePages: z.array(pageFinding).min(1).max(14),
  originalLocations: z.record(z.string(), z.strictObject({ physicalPage: location, kind: z.enum(["text_layer", "page_transcription", "visual_page"]) })), chunks: z.array(chunk).max(14),
  previousChanges: z.record(z.string(), z.strictObject({ meaning: z.enum(["changed", "unchanged", "removed"]), reason: z.string().trim().min(1).max(600) })),
  checks: knowledgeReviewAssessmentSchema.shape.checks, explanations: z.record(z.string(), z.string().min(1).max(600)),
});
export type WindowReading = z.infer<typeof windowReadingSchema>;
const fields = ["run", "scope", "context", "evidence", "capabilities", "outputContract"];
type Range = {
  first: number;
  last: number;
};
export type PdfReadingWindow = Range & {
  firstRead: number;
  lastRead: number;
  ranges: Range[];
};
function reject(code: string): never { throw new KnowledgeMaintenanceModelError(code); }
/** At most 32 searchable ranges per edition. Neighbour pages carry continuation headings and footnotes. */
export function planKnowledgePdfWindows(total: number, allowance: number): PdfReadingWindow[] {
  if (!Number.isSafeInteger(total) || total < 1)
    reject("knowledge_window_range_invalid");
  const width = Math.ceil(total / 32);
  const perWindow = Math.floor(14 / width);
  if (perWindow < 1 || 2 * Math.ceil(Math.ceil(total / width) / perWindow) > allowance)
    reject("knowledge_window_model_budget_required");
  const windows: PdfReadingWindow[] = [];
  for (let first = 1; first <= total;) {
    const last = Math.min(total, first + perWindow * width - 1), ranges: Range[] = [];
    for (let page = first; page <= last; page += width)
      ranges.push({ first: page, last: Math.min(last, page + width - 1) });
    windows.push({ first, last, firstRead: Math.max(1, first - 1), lastRead: Math.min(total, last + 1), ranges });
    first = last + 1;
  }
  return windows;
}
const keyOf = (range: Range) => "pages-" + range.first + "-" + range.last;
export async function readKnowledgePdfWindow(input: {
  range: PdfReadingWindow;
  candidate: BackgroundKnowledgeCandidate;
  baseline: KnowledgeMaintenanceBaseline | null;
  sliceHash: string;
  bytes: Buffer;
  textLayers: KnowledgePdfPage[];
  completeText: AgentGatewayModel["completeText"];
  signal?: AbortSignal;
}) {
  const { range, candidate, bytes, sliceHash, baseline } = input, parentHash = candidate.observed.extraction!.contentHash;
  const pdf = originalKnowledgePdf(bytes, sliceHash, true), keys = range.ranges.map(keyOf);
  const physical = Array.from({ length: range.last - range.first + 1 }, (_, i) => range.first + i);
  const keysFor = (list: readonly string[], value: z.ZodType) => Object.fromEntries(list.map(k => [k, value]));
  const pageRecord = z.strictObject(keysFor(physical.map(p => "page" + p), pageFinding.omit({ page: true })));
  const material = z.strictObject({
    section: chunk.shape.section, text: chunk.shape.text, keywords: chunk.shape.keywords,
    applicability: chunk.shape.applicability, quotePage: location, quote: z.string().max(600),
    originalKind: z.enum(["text_layer", "page_transcription", "visual_page"])
  });
  const organizeShape = z.strictObject({ pages: pageRecord, ranges: z.strictObject(keysFor(keys, material.nullable())) });
  const old = baseline?.source.chunks.filter(c => {
    if (!c.pageStart)
      reject("knowledge_window_baseline_review_required");
    return c.pageStart >= range.first && (c.pageStart <= range.last || range.last === candidate.observed.extraction!.totalPages);
  }) ?? [];
  const previousChange = z.strictObject({ meaning: z.enum(["changed", "unchanged", "removed"]), reason: z.string().trim().min(1).max(600) });
  const reviewShape = z.strictObject({
    ...(old.length ? { previousChanges: z.strictObject(keysFor(old.map(c => c.key), previousChange)) } : {}), pages: pageRecord, ranges: z.strictObject(keysFor(keys, z.strictObject({
      supported: z.boolean(), originalQuote: z.string().max(600), reason: z.string().trim().min(1).max(600)
    }))),
    checks: knowledgeReviewAssessmentSchema.shape.checks, decision: z.enum(["approve", "hold"])
  });
  const common = {
    task: "physicalPageWindow", readScope: {
      parentHash, sliceHash, firstPhysicalPage: range.firstRead,
      lastPhysicalPage: range.lastRead, firstCorePage: range.first, lastCorePage: range.last
    }, ranges: range.ranges
  };
  async function call(role: "organize" | "review", payload: unknown, shape: z.ZodType) {
    input.signal?.throwIfAborted();
    const prompt = await loadAgentPrompt(role === "organize" ? "knowledge-organize" : "knowledge-review", "structured", fields);
    const responseJsonSchema = nativeResponseSchema(shape), user = JSON.stringify(payload);
    if (user.length + prompt.text.length > 64000)
      reject("knowledge_maintenance_input_limit");
    const attemptKey = "knowledge-window-" + role + ":" + knowledgeReviewHash([PDF_WINDOW_METHOD, prompt.text, user, responseJsonSchema, sliceHash, "HIGH"]);
    const raw = await input.completeText({
      system: prompt.text, user, attemptKey, pdf, responseJsonSchema,
      ...(role === "review" ? { purpose: "knowledge_review" as const } : {})
    });
    input.signal?.throwIfAborted();
    if (raw.length > 128000)
      reject("knowledge_maintenance_output_limit");
    return { raw: JSON.parse(raw), attemptKey };
  }
  const organized = await call("organize", { ...common, role: "organize", sourceTitle: candidate.observed.title }, organizeShape);
  const draft = organizeShape.parse(organized.raw);
  const reviewed = await call("review", {
    ...common, role: "review", baseline: old,
    candidate: Object.fromEntries(keys.map(key => {
      const entry = draft.ranges[key];
      if (!entry) return [key, null];
      const { quote: _withheld, ...passage } = material.parse(entry);
      return [key, passage];
    }))
  }, reviewShape);
  const review = reviewShape.parse(reviewed.raw);
  if (review.decision !== "approve")
    reject("knowledge_window_review_held");
  const organizePages = physical.map(page => pageFinding.parse({ page, ...pageFinding.omit({ page: true }).parse(draft.pages["page" + page]) }));
  const pages = organizePages.map(({ page, status }) => {
    const finding = pageFinding.omit({ page: true }).parse(review.pages["page" + page]);
    if (status === "unreadable" || status !== finding.status)
      reject("knowledge_window_coverage_disputed");
    return { page, ...finding };
  });
  const chunks: KnowledgeSourceInput["chunks"] = [], explanations: Record<string, string> = {};
  const originalLocations: Record<string, {
    physicalPage: number;
    kind: string;
  }> = {};
  for (const rangePart of range.ranges) {
    const key = keyOf(rangePart), m = material.nullable().parse(draft.ranges[key]);
    const verdict = z.object({ supported: z.boolean(), originalQuote: z.string(), reason: z.string() }).parse(review.ranges[key]);
    const hasContent = pages.some(p => p.page >= rangePart.first && p.page <= rangePart.last && p.status === "content");
    if (!verdict.supported || Boolean(m) !== hasContent)
      reject("knowledge_window_review_held");
    if (!m)
      continue;
    if (m.quotePage < rangePart.first || m.quotePage > rangePart.last)
      reject("knowledge_window_range_invalid");
    const layer = input.textLayers.find(p => p.page === m.quotePage);
    if (!layer)
      reject("knowledge_window_range_invalid");
    const quote = m.quote.trim(), checked = verdict.originalQuote.trim();
    if (m.originalKind === "visual_page") {
      if (quote || checked || layer.status === "text")
        reject("knowledge_window_quote_mismatch");
    } else {
      if (!quote || !checked) reject("knowledge_window_quote_mismatch");
      const supported = m.originalKind === "text_layer"
        ? layer.text.includes(quote) && layer.text.includes(checked)
        : layer.status !== "text" && quote.normalize("NFC") === checked.normalize("NFC");
      if (!supported) reject("knowledge_window_quote_mismatch");
    }
    chunks.push(chunk.parse({
      key, section: m.section, text: m.text, sourceExcerpt: [...quote].slice(0, 150).join(""),
      ...(quote ? { originalText: quote } : {}), originalKind: m.originalKind === "text_layer" ? "page_excerpt" : m.originalKind,
      pageStart: rangePart.first, pageEnd: rangePart.last, keywords: m.keywords, applicability: m.applicability
    }));
    originalLocations[key] = { physicalPage: m.quotePage, kind: m.originalKind };
    explanations[key] = verdict.reason;
  }
  return windowReadingSchema.parse({
    parentHash, sliceHash, first: range.first, last: range.last, firstRead: range.firstRead, lastRead: range.lastRead,
    method: PDF_WINDOW_METHOD, previousChanges: review.previousChanges ?? {}, organizeKey: organized.attemptKey, reviewKey: reviewed.attemptKey, pages, organizePages, originalLocations, chunks, checks: review.checks, explanations
  });
}
export function assembleKnowledgePdfWindows(input: {
  candidate: BackgroundKnowledgeCandidate;
  baseline: KnowledgeMaintenanceBaseline | null;
  windows: WindowReading[];
  fetchedAt: string;
  packVersion: string;
  growthRules: readonly {
    key: string;
    hash: string;
  }[];
}): PreparedKnowledgeMaintenance {
  const { candidate, baseline, windows } = input, doc = candidate.observed, extraction = doc.extraction!;
  const expected = planKnowledgePdfWindows(extraction.totalPages!, windows.length * 2);
  if (windows.length !== expected.length || windows.some((w, i) => w.parentHash !== extraction.contentHash || w.first !== expected[i]!.first || w.last !== expected[i]!.last
    || w.firstRead !== expected[i]!.firstRead || w.lastRead !== expected[i]!.lastRead || w.pages.length !== w.last - w.first + 1 || w.pages.some((p, j) => p.page !== w.first + j || p.status === "unreadable")))
    reject("knowledge_window_coverage_disputed");
  const source = parseKnowledgeSource({
    sourceId: candidate.watchId, url: doc.url, title: doc.title, publisher: candidate.definition.publisher,
    classification: candidate.definition.classification, sourcePublishedAt: doc.sourcePublishedAt, sourceUpdatedAt: doc.sourceUpdatedAt,
    sourceDateText: doc.sourceDateText, fetchedAt: input.fetchedAt, termsUrl: candidate.definition.termsUrl, extraction: { ...extraction, complete: true },
    chunks: windows.flatMap(w => w.chunks)
  });
  const before = new Map(baseline?.source.chunks.map(c => [c.key, c]) ?? []), after = new Map(source.chunks.map(c => [c.key, c]));
  const previousChanges = Object.assign({}, ...windows.map(w => w.previousChanges)) as WindowReading["previousChanges"];
  const reasons = Object.assign({}, ...windows.map(w => w.explanations)) as WindowReading["explanations"];
  for (const [key, original] of before) {
    const checked = previousChanges[key], current = after.get(key);
    if (!checked || (!current && checked.meaning !== "removed") || (current && checked.meaning === "removed")
      || (current && knowledgeReviewHash(original) === knowledgeReviewHash(current) && checked.meaning !== "unchanged"))
      reject("knowledge_window_baseline_review_required");
  }
  const changedRule = input.growthRules.some(r => !after.has(r.key) || knowledgeHash(after.get(r.key)) !== r.hash || knowledgeHash(before.get(r.key) ?? null) !== r.hash);
  // Full independent notes remain in each immutable window. Bound the edition-level summary.
  const checks = Object.fromEntries(Object.keys(windows[0]!.checks).map(key => {
    const notes = windows.map(w => w.checks[key as keyof WindowReading["checks"]]).join("\n");
    const references = windows.map(w => w.first + "–" + w.last).join(", ");
    return [key, notes.length <= 2000 ? notes : "Checked in the recorded physical page windows: " + references];
  }));
  const assessment = validateKnowledgeAssessment({
    comparedVersionId: baseline?.versionId ?? null, comparedHash: baseline?.versionHash ?? null,
    observationHash: candidate.observationHash, changes: [...new Set([...before.keys(), ...after.keys()])].map(key => {
      const previous = before.get(key), current = after.get(key);
      return {
        key, oldQuote: previous?.sourceExcerpt || null, newQuote: current?.sourceExcerpt || null,
        meaning: previous ? previousChanges[key]!.meaning : "new", explanation: previous ? previousChanges[key]!.reason : reasons[key]
      };
    }),
    checks, questions: windows.flatMap(w => w.chunks.slice(0, 1).map(c => ({ query: c.keywords[0]!, expectedKeys: [c.key], reason: w.explanations[c.key] }))).slice(0, 12),
    growthRuleImpact: changedRule ? "requires_review" : "none", growthRuleReason: changedRule ? "An executable binding changed." : "Server verified executable rule bindings.", decision: "approve"
  }, source, baseline?.source ?? null);
  const review = {
    watchId: candidate.watchId, observationHash: candidate.observationHash, previousObservationHash: candidate.previousObservationHash,
    decision: changedRule ? "hold_candidate" as const : "approve_candidate" as const, reviewKind: "model_review" as const, modelReviewCompleted: true,
    growthRuleImpact: changedRule ? "requires_review" as const : "none" as const, policyVersion: BACKGROUND_KNOWLEDGE_POLICY_VERSION, notes: ["Every physical core page has two source-bound reading receipts."]
  };
  return {
    source, assessment, versionHash: sourceVersionHash(source), review, provenance: {
      packVersion: input.packVersion,
      organizeAttemptKey: "window-set:" + knowledgeReviewHash(windows.map(w => w.organizeKey)), reviewAttemptKey: "window-set:" + knowledgeReviewHash(windows.map(w => w.reviewKey)), windows
    }
  };
}
