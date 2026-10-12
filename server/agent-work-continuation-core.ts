import type { AgentWork, WorkResource } from "../src/shared/agent-work.ts";
import type { KnowledgeReviewAssessment } from "./knowledge-review-assessment.ts";
export interface KnowledgeCurrent extends KnowledgeBasis { assessment: KnowledgeReviewAssessment | null }
export interface ResourceBasis extends WorkResource { status: string; available: boolean; terminal: boolean }
export interface KnowledgeBasis { sourceId: string; versionId: string | null; hash: string | null; available: boolean }
export interface Baseline { resources: ResourceBasis[]; knowledge: KnowledgeBasis[] }
export interface WorkContinuationChanges {
  due: boolean;
  resources: { kind: WorkResource["kind"]; id: string; previousVersion: number; version: number; status: string }[];
  knowledge: { sourceId: string; versionId: string; meaning: "material" | "recheck" }[];
}
export interface WorkContinuationContextEntry {
  work: Pick<AgentWork, "id" | "childId" | "version" | "status" | "goal" | "focus" | "questions" | "resources" | "sourceMessageIds" | "followUp">;
  textPartial: boolean; changes: WorkContinuationChanges; knowledgeSourceIds: string[];
}
export const WORK_CONTINUATION_CONTEXT_LIMIT = 3500;
function contextExcerpt(value: string) {
  let text = value.slice(0, 120);
  // JSON escaping also spends context space; this is a bounded field excerpt, not a cut JSON document.
  while (JSON.stringify(text).length > 80) text = text.slice(0, Math.floor(text.length / 2));
  return text;
}
/** Retain all daily constituents before spending the remaining total budget on optional details. */
export function projectWorkContinuationContext(eventId: string, inputs: WorkContinuationContextEntry[]) {
  if (inputs.length > 5) throw new Error("work_continuation_context_invalid");
  const works: Record<string, unknown>[] = inputs.map(input => ({
    work: { id: input.work.id, version: input.work.version, status: input.work.status, goal: contextExcerpt(input.work.goal) },
    textPartial: true, referencesPartial: true,
    changes: { due: input.changes.due, resourceChanges: input.changes.resources.length, knowledgeChanges: input.changes.knowledge.length },
    knowledgeSourceIds: input.knowledgeSourceIds,
  }));
  const context = { eventType: "work_continuation", eventId, timeZone: "Asia/Hong_Kong", works };
  let used = JSON.stringify(context).length;
  // Input has already been bounded by the persisted work contract: five works, eight refs and four public sources each.
  if (used > WORK_CONTINUATION_CONTEXT_LIMIT) throw new Error("work_continuation_context_invalid");
  for (let index = 0; index < inputs.length; index++) {
    const detailed = { ...inputs[index], referencesPartial: false };
    const extra = JSON.stringify(detailed).length - JSON.stringify(works[index]).length;
    if (used + extra <= WORK_CONTINUATION_CONTEXT_LIMIT) { works[index] = detailed; used += extra; }
  }
  return context;
}
export function continuationKnowledgeMeaning(before: KnowledgeBasis | undefined, next: KnowledgeCurrent): "material" | "recheck" | null {
  if (!next.available || !next.versionId || before?.available && before.versionId === next.versionId) return null;
  const assessment = next.assessment;
  if (!before?.available || !assessment || assessment.comparedVersionId !== before.versionId || assessment.comparedHash !== before.hash)
    return "recheck";
  return assessment.changes.some(change => change.meaning !== "unchanged") ? "material" : null;
}
