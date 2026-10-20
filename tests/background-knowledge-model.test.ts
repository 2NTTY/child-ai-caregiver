import assert from "node:assert/strict";
import test from "node:test";
import { createModelKnowledgeReviewPort, prepareKnowledgeMaintenance, type PreparedKnowledgeMaintenance } from "../server/background-knowledge-model.ts";
import type { BackgroundKnowledgeCandidate } from "../server/background-knowledge-maintenance.ts";
import { SOURCE_WATCHES } from "../server/knowledge-source-catalog.ts";
import { observationHash } from "../server/knowledge-observation.ts";
import { knowledgeHash, sourceVersionHash } from "../server/knowledge-inputs.ts";

const fetchedAt = "2026-10-20T00:00:00.000Z";
function candidate(): BackgroundKnowledgeCandidate {
  const definition = SOURCE_WATCHES.find(item => item.id === "fhs-solid-food")!;
  const observed = { url: definition.url, title: "Local source fixture", text: "請攜帶健康記錄。\n如有問題，先記下要詢問的事項。",
    sourcePublishedAt: null, sourceUpdatedAt: null, sourceDateText: null };
  return { watchId: "fhs-solid-food", definition, observed, observationHash: observationHash(observed), previousObservationHash: null };
}
type Completion = Parameters<typeof prepareKnowledgeMaintenance>[0]["completeText"];
function provider(calls: { system: string; user: string; attemptKey: string }[], mode: "valid" | "quote" | "rules" = "valid"): Completion {
  return async input => {
    calls.push(input);
    const payload = JSON.parse(input.user);
    if (payload.role === "background-knowledge-maintenance") {
      return JSON.stringify({ units: payload.originalUnits.map((unit: { id: string; originalText: string }) => ({
        unitId: unit.id, section: "準備事項",
        ...(mode === "quote" ? { sourceExcerpt: "This quotation is invented." } : {}),
        text: "攜帶記錄並準備問題。", keywords: ["健康記錄"],
        applicability: { region: "HK", ageBasis: "any", minAgeMonths: null, maxAgeMonths: null, topics: ["preparation"], conditions: [] },
      })) });
    }
    assert.equal(payload.role, "knowledge-semantic-review");
    return "```json\n" + JSON.stringify({
      changes: payload.comparisonUnits.map((unit: { key: string; oldQuote: string | null; newQuote: string | null }) => ({
        key: unit.key, meaning: unit.oldQuote === null ? "new" : unit.newQuote === null ? "removed" : "unchanged",
        explanation: "The candidate is compared with the supplied original.",
      })),
      checks: { age: "No age claim", numbersAndUnits: "No numeric claim", timing: "No timing claim",
        conditions: "Preserved", exceptions: "None supplied", prohibitions: "None supplied", withdrawal: "No previous edition" },
      questions: [{ query: "要準備甚麼？", expectedKeys: payload.candidate.chunks.map((chunk: { key: string }) => chunk.key), reason: "Directly supported" }],
      growthRuleImpact: mode === "rules" ? "reviewed" : "none", growthRuleReason: "No executable rule change", decision: "approve",
    }) + "\n```";
  };
}

test("knowledge preparation preserves original evidence and stores a separate model review before returning approval", async () => {
  const source = candidate(), calls: Parameters<Completion>[0][] = [];
  let saved: PreparedKnowledgeMaintenance | null = null;
  const port = createModelKnowledgeReviewPort({ completeText: provider(calls), baseline: async () => null, growthRules: [],
    fetchedAt: async () => fetchedAt, savePrepared: async (bound, prepared) => {
      assert.equal(bound.observationHash, source.observationHash);
      assert.equal(prepared.source.chunks[0]!.originalText, source.observed.text);
      assert.equal(prepared.source.chunks[0]!.sourceExcerpt, source.observed.text);
      assert.equal(prepared.source.url, source.definition.url);
      assert.equal(prepared.assessment.observationHash, source.observationHash);
      saved = prepared;
    } });
  const result = await port.review(source);
  assert.ok(saved);
  assert.equal(calls.length, 2);
  assert.notEqual(calls[0]!.system, calls[1]!.system);
  assert.match(calls[0]!.attemptKey, /^knowledge-organize:/u);
  assert.match(calls[1]!.attemptKey, /^knowledge-review:/u);
  assert.equal(JSON.parse(calls[1]!.user).candidate.chunks[0].originalText, source.observed.text);
  assert.equal(result.reviewKind, "model_review");
  assert.equal(result.decision, "approve_candidate");
  assert.equal(result.modelReviewCompleted, true);
  // Preparation is not a publication receipt.
  assert.equal("published" in result, false);
});

test("knowledge model stages reject invented evidence and rule authority without returning approval", async () => {
  const calls: Parameters<Completion>[0][] = [];
  await assert.rejects(prepareKnowledgeMaintenance({ candidate: candidate(), baseline: null, fetchedAt, growthRules: [],
    completeText: provider(calls, "quote") }));
  assert.equal(calls.length, 1, "invalid original evidence must not reach semantic review");
  const ruleCalls: Parameters<Completion>[0][] = [];
  await assert.rejects(prepareKnowledgeMaintenance({ candidate: candidate(), baseline: null, fetchedAt, growthRules: [],
    completeText: provider(ruleCalls, "rules") }), { message: "knowledge_growth_rule_authority_invalid" });
  assert.equal(ruleCalls.length, 2);
  const saveCalls: Parameters<Completion>[0][] = [];
  const port = createModelKnowledgeReviewPort({ completeText: provider(saveCalls), baseline: async () => null, growthRules: [],
    fetchedAt: async () => fetchedAt, savePrepared: async () => { throw Error("work_lease_lost"); } });
  await assert.rejects(port.review(candidate()), { message: "work_lease_lost" });
});

test("unchanged originals retain reviewed chunks and changed rule bindings cannot be model-approved", async () => {
  const observed = candidate();
  const initial = await prepareKnowledgeMaintenance({ candidate: observed, baseline: null, fetchedAt, growthRules: [],
    completeText: provider([]) });
  const source = { ...initial.source, chunks: initial.source.chunks.map(chunk => ({ ...chunk, key: "stable-preparation" })) };
  const baseline = { source, versionHash: sourceVersionHash(source),
    versionId: "11111111-1111-4111-8111-111111111111", observationHash: null };
  const growthRules = [{ id: "test-rule", revision: "v1", sourceId: source.sourceId,
    key: source.chunks[0]!.key, hash: knowledgeHash(source.chunks[0]) }];
  const calls: Parameters<Completion>[0][] = [];
  const unchanged = await prepareKnowledgeMaintenance({ candidate: observed, baseline, fetchedAt, growthRules,
    completeText: provider(calls) });
  assert.equal(calls.length, 1, "unchanged original must not be sent for model rewriting");
  const reviewInput = JSON.parse(calls[0]!.user);
  assert.equal(reviewInput.role, "knowledge-semantic-review");
  assert.equal(reviewInput.growthRuleBindings[0].state, "unchanged");
  assert.deepEqual(unchanged.source.chunks, source.chunks);
  assert.equal(unchanged.versionHash, baseline.versionHash);
  assert.match(unchanged.provenance.organizeAttemptKey, /^reused-originals:/u);
  assert.equal(unchanged.review.decision, "approve_candidate");

  const changedObservation = { ...observed.observed, text: observed.observed.text + "\n另帶已填寫的表格。" };
  const changedCalls: Parameters<Completion>[0][] = [];
  const changed = await prepareKnowledgeMaintenance({ candidate: { ...observed, observed: changedObservation,
    observationHash: observationHash(changedObservation) }, baseline, fetchedAt, growthRules,
    completeText: provider(changedCalls) });
  assert.equal(changedCalls.length, 2);
  assert.equal(JSON.parse(changedCalls[1]!.user).growthRuleBindings[0].state, "requires_review");
  assert.equal(changed.review.decision, "hold_candidate");
  assert.equal(changed.assessment.growthRuleImpact, "requires_review",
    "a model's none cannot erase the server-verified changed rule dependency");
});
