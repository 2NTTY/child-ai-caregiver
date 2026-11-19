import { z } from "zod";
import { loadAgentPrompt } from "./agent-prompt.ts";
import { originalKnowledgePdf, type AgentGatewayModel } from "./agent-model-gateway.ts";
import { type BackgroundKnowledgeCandidate, backgroundKnowledgeReviewMatchesCandidate } from "./background-knowledge-maintenance.ts";
import { KnowledgeMaintenanceModelError, focusEvidenceSchema, type KnowledgeMaintenanceBaseline, type KnowledgePdfAcceptance, type PreparedKnowledgeMaintenance } from "./background-knowledge-model.ts";
import { knowledgeChunkInputSchema, sourceVersionHash } from "./knowledge-inputs.ts";
import { layoutFactContract, type KnowledgePdfQuestion } from "./knowledge-pdf-layout.ts";
import { nativeResponseSchema } from "./knowledge-pdf-output.ts";
import { knowledgeReviewHash, validateKnowledgeAssessment } from "./knowledge-review-assessment.ts";
import { observationHash } from "./knowledge-observation.ts";

export const focusedKnowledgeWorkId = (priorWork: string, priorVersionHash: string, question: KnowledgePdfQuestion) =>
  knowledgeReviewHash(["knowledge-pdf-page-review/1", priorWork, priorVersionHash, question]);

export async function prepareFocusedKnowledgePage(input: {
  prior: PreparedKnowledgeMaintenance; priorWork: string; question: KnowledgePdfQuestion;
  candidate: BackgroundKnowledgeCandidate; baseline: KnowledgeMaintenanceBaseline | null;
  window: { descriptor: { parentHash: string; contentHash: string; first: number; count: number; total: number; method: string }; bytes: Buffer };
  completeText: AgentGatewayModel["completeText"]; acceptance?: KnowledgePdfAcceptance;
  growthRuleKeys: readonly string[]; signal?: AbortSignal;
}): Promise<PreparedKnowledgeMaintenance> {
  const { prior, question, candidate, baseline, window } = input;
  const proof = prior.provenance.nativePdf, page = question.physicalPage, keys = question.factKeys;
  const scope = window.descriptor;
  const invalid = () => { throw new KnowledgeMaintenanceModelError("knowledge_focus_binding_mismatch"); };
  if (!proof || proof.focus || !page || !keys?.length || scope.first !== page || scope.count !== 1
    || scope.total !== candidate.observed.extraction?.totalPages || scope.parentHash !== proof.contentHash
    || question.contentHash !== scope.parentHash || question.question !== proof.layoutQuestion
    || !candidate.definition.leafletPage || candidate.observed.extraction.contentHash !== scope.parentHash
    || prior.source.extraction?.contentHash !== scope.parentHash || prior.source.url !== candidate.observed.url
    || prior.source.sourceId !== candidate.watchId || prior.versionHash !== sourceVersionHash(prior.source)
    || observationHash(candidate.observed) !== candidate.observationHash || !backgroundKnowledgeReviewMatchesCandidate(prior.review, candidate)
    || prior.review.decision !== "approve_candidate" || !prior.review.modelReviewCompleted || prior.assessment.decision !== "approve"
    || prior.assessment.observationHash !== candidate.observationHash || prior.assessment.growthRuleImpact !== "none"
    || prior.assessment.comparedVersionId !== (baseline?.versionId ?? null) || prior.assessment.comparedHash !== (baseline?.versionHash ?? null)
    || [proof.organize, proof.review].some(r => r.unreadablePages.length || r.pages.length !== scope.total
      || r.pages.some((p, i) => p.page !== i + 1))) throw new KnowledgeMaintenanceModelError("knowledge_focus_binding_mismatch");
  const source = structuredClone(prior.source);
  const affected = source.chunks.filter(c => c.pageStart! <= page && c.pageEnd! >= page);
  // A passage spanning a boundary needs its complete source window reviewed.
  if (affected.length !== 1 || affected[0]!.pageStart !== page || affected[0]!.pageEnd !== page) invalid();
  const chunk = affected[0]!;
  if (input.growthRuleKeys.includes(chunk.key)) throw new KnowledgeMaintenanceModelError("knowledge_focus_growth_rule_review_required");
  const pdf = originalKnowledgePdf(window.bytes, scope.contentHash, true);
  const shape = z.strictObject({ decision: z.enum(["supported", "hold"]), finding: z.string().trim().min(1).max(240),
    layoutFacts: layoutFactContract(keys) });
  const responseJsonSchema = nativeResponseSchema(shape);
  async function read(role: "organize" | "review") {
    input.signal?.throwIfAborted();
    const prompt = await loadAgentPrompt(role === "organize" ? "knowledge-organize" : "knowledge-review", "structured",
      ["run","scope","context","evidence","capabilities","outputContract"]);
    // Both roles receive the page and existing passage. Neither sees the other role's visual answer.
    const user = JSON.stringify({ role, task: "focusedPhysicalPage", readScope: scope, localPage: 1,
      layoutQuestion: question.question, passage: { key: chunk.key, text: chunk.text, section: chunk.section,
        applicability: chunk.applicability }, factKeys: keys });
    const attemptKey = "knowledge-page-" + role + ":" + knowledgeReviewHash([prompt.text, user, scope.contentHash, responseJsonSchema, "HIGH"]);
    const raw = await input.completeText({ system: prompt.text, user, attemptKey, pdf, responseJsonSchema,
      ...(role === "review" ? { purpose: "knowledge_review" as const } : {}) });
    input.signal?.throwIfAborted();
    const reply = shape.parse(JSON.parse(raw));
    if (reply.decision !== "supported") throw new KnowledgeMaintenanceModelError("knowledge_native_visual_evidence_disputed");
    if (input.acceptance && !input.acceptance(scope.parentHash, scope.first, role, reply.layoutFacts))
      throw new KnowledgeMaintenanceModelError("knowledge_native_visual_sample_mismatch");
    return { finding: reply.finding, layoutFacts: reply.layoutFacts, attemptKey };
  }
  const organize = await read("organize"), review = await read("review");
  if (!input.acceptance && keys.some(k => organize.layoutFacts[k] !== review.layoutFacts[k]))
    throw new KnowledgeMaintenanceModelError("knowledge_native_visual_evidence_disputed");
  chunk.text = knowledgeChunkInputSchema.shape.text.parse(chunk.text + "\n" + question.question + "\n" + keys.map(key => review.layoutFacts[key]).join("、"));
  const assessment = validateKnowledgeAssessment({ ...prior.assessment, changes: prior.assessment.changes.map(change =>
    change.key === chunk.key ? { ...change, explanation: review.finding } : change) }, source, baseline?.source ?? null);
  const focus = focusEvidenceSchema.parse({ priorWork: input.priorWork, priorVersionHash: prior.versionHash,
    parentHash: scope.parentHash, contentHash: scope.contentHash, physicalPage: page, method: scope.method,
    mediaResolution: "MEDIA_RESOLUTION_HIGH", organize, review });
  return { source, versionHash: sourceVersionHash(source), assessment, review: { ...prior.review, notes: [review.finding] },
    provenance: { ...prior.provenance, nativePdf: { ...proof, focus } } };
}
