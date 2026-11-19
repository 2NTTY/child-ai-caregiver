import { matchesFhsLayout } from "./helpers/knowledge-pdf-layout-sample.ts";
import { pdfOrganizationContract } from "../server/knowledge-pdf-output.ts";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createModelKnowledgeReviewPort, includePriorRetrieval, prepareKnowledgeMaintenance, type PreparedKnowledgeMaintenance } from "../server/background-knowledge-model.ts";
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
function provider(calls: { system: string; user: string; attemptKey: string }[], mode: "valid" | "quote" | "rules" | "hold" = "valid"): Completion {
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
      ...(mode === "rules" ? { growthRuleImpact: "reviewed", growthRuleReason: "Model-created approval" } : {}),
      decisionReason: mode === "hold" ? "The supplied original does not resolve the scope of this claim." : "All claims are supported by the supplied original.",
      decision: mode === "hold" ? "hold" : "approve",
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
  assert.equal(result.growthRuleImpact, "none");
  assert.equal("growthRuleImpact" in JSON.parse(calls[1]!.user).outputSchema.properties, false);
  // Preparation is not a publication receipt.
  assert.equal("published" in result, false);
  const held = await prepareKnowledgeMaintenance({ candidate: source, baseline: null, fetchedAt, growthRules: [],
    completeText: provider([], "hold") });
  assert.equal(held.review.decision, "hold_candidate", "no executable rule does not override an evidence hold");
  assert.equal(held.assessment.growthRuleImpact, "none");
  assert.match(held.review.notes[0]!, /does not resolve/u);
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
    "semantic approval cannot erase the server-verified changed rule dependency");
});

test("a destination comparison keeps its baseline while an empty local store validates only additions", async () => {
  const old = candidate();
  const edition = await prepareKnowledgeMaintenance({ candidate: old, baseline: null, fetchedAt,
    growthRules: [], completeText: provider([]) });
  const baseline = { versionId: "c3000da1-1435-422f-9000-000000000001", versionHash: edition.versionHash,
    observationHash: old.observationHash, source: edition.source };
  const next = { ...old, observed: { ...old.observed, text: "Revised instructions and additional material." } };
  next.observationHash = observationHash(next.observed);
  const calls: Parameters<Completion>[0][] = [];
  const options = { fetchedAt: async () => fetchedAt, growthRules: [], completeText: provider(calls),
    comparison: { destination: "official-site", baseline }, async savePrepared(_: BackgroundKnowledgeCandidate, prepared: PreparedKnowledgeMaintenance) {
      const target = prepared.provenance.destinationReview!;
      assert.equal(target.assessment.comparedVersionId, baseline.versionId);
      assert.equal(target.previousObservationHash, baseline.observationHash);
      assert.deepEqual(target.assessment.changes.map(c => c.meaning).sort(), ["new", "removed"]);
      assert.equal(prepared.assessment.comparedVersionId, null);
      assert.deepEqual(prepared.assessment.changes.map(c => c.meaning), ["new"]);
    } };
  const result = await createModelKnowledgeReviewPort({ ...options, baseline: async () => null }).review(next, new AbortController().signal);
  assert.equal(result.previousObservationHash, null);
  assert.equal(JSON.parse(calls[1]!.user).binding.comparedHash, baseline.versionHash);
  await assert.rejects(createModelKnowledgeReviewPort({ ...options, baseline: async () => baseline }).review(next, new AbortController().signal),
    /knowledge_destination_baseline_conflict/u);
  assert.equal(calls.length, 2);
});

test("grouped PDF sections require one keyed summary for each physical page in its range", () => {
  const contract = pdfOrganizationContract([{id:"u1",page:5,pageEnd:6}]);
  const range = contract.ranges[0]!;
  const group = {section:"Fruit",keywords:["fruit"],region:"HK",topics:["care"],conditions:[],ageRange:null};
  const nativeCoverage = {pages:[{page:5,finding:"Table introduction"},{page:6,finding:"Fruit row"}],unreadablePages:[],layoutAnswer:null};
  const parse = (pageText:Record<string,string>) => contract.parse({ranges:{[range.key]:{...group,pageText}},nativeCoverage});
  const spelling = contract.parse({ranges:{[range.key]:{...group,region:"Hong Kong",pageText:{physicalPage5:"Opening",physicalPage6:"Fruit"}}},nativeCoverage});
  assert.equal(spelling.units[0]!.applicability.region,"HK");
  assert.deepEqual(range.pages,["physicalPage5","physicalPage6"]);
  assert.throws(() => parse({physicalPage1:"Wrong physical page",physicalPage6:"Figure"}));
  assert.throws(() => parse({physicalPage6:"Figure"}));
  assert.match(parse({physicalPage6:"Figure",physicalPage5:"Introduction"}).units[0]!.text,/第 5 頁　Introduction\n第 6 頁　Figure/u);
  const mapped = pdfOrganizationContract([{id:"u1",page:5,pageEnd:6}], [], ["feeding", "sleep"]);
  const retained = mapped.parse({ranges:{[range.key]:{...group,priorTopicMatches:{feeding:true,sleep:false},
    pageText:{physicalPage5:"Opening",physicalPage6:"Food preparation"}}},nativeCoverage});
  assert.deepEqual(retained.units[0]!.applicability.topics, ["feeding", "care"]);
  const edit = pdfOrganizationContract([{id:"u1",page:5,pageEnd:6}], [], [], nativeCoverage);
  const revision = {ranges:{[range.key]:{...group,pageText:{physicalPage5:"修訂",physicalPage6:"已讀圖表"}}}};
  assert.deepEqual(edit.parse(revision).nativeCoverage,nativeCoverage);
  assert.throws(()=>edit.parse({...revision,nativeCoverage}),/revision_unbound_coverage/u);
});

test("regrouping an unchanged page preserves its qualified retrieval and archives its earlier collection note", async () => {
  const definition = SOURCE_WATCHES.find(d => d.leafletPage)!;
  const pdf = Buffer.from("%PDF-1.7 synthetic, with injected page layers and model responses");
  const contentHash = createHash("sha256").update(pdf).digest("hex");
  const pages = ["Cover", "Contents", "Age eligibility also requires the readiness signs on this page."].map((text,i) =>
    ({ page: i + 1, text, status: "text" as const }));
  const observed = { url: definition.url, title: "Booklet", text: pages.map(p => p.text).join("\n\n"), pages,
    sourcePublishedAt: null, sourceUpdatedAt: null, sourceDateText: null,
    extraction: { format: "text_pdf" as const, contentHash, totalPages: 3, pageStart: 1, pageEnd: 3, complete: true } };
  const administrative = "The earlier edition only collected physical page 3.";
  const clinical = "The lookup age is insufficient to establish readiness.";
  const scope = { region: "HK", ageBasis: "actual" as const, minAgeMonths: 0, maxAgeMonths: 12,
    topics: ["feeding"], conditions: [administrative, clinical] };
  const source = { sourceId: definition.id, url: definition.url, title: observed.title, publisher: definition.publisher,
    classification: definition.classification, termsUrl: definition.termsUrl, sourcePublishedAt: null, sourceUpdatedAt: null, fetchedAt,
    extraction: { ...observed.extraction, pageStart: 3, complete: false },
    chunks: [{key:"previous-page", section:"Readiness", sourceExcerpt:pages[2]!.text, originalText:pages[2]!.text,
      text:"Previous guidance.", keywords:["readiness"], applicability:scope, pageStart:3, pageEnd:3}] };
  const baseline = { versionId: "c3000da1-1435-422f-9000-000000000001", versionHash: sourceVersionHash(source), source,
    observationHash: knowledgeHash("earlier-page") };
  const candidate: BackgroundKnowledgeCandidate = { watchId: "fhs-feeding-booklet-en", definition, observed, observationHash: observationHash(observed),
    previousObservationHash: baseline.observationHash };
  const current = "Physical page 3 also requires readiness signs.";
  async function run(unresolved: boolean) {
    return prepareKnowledgeMaintenance({ candidate, baseline, growthRules: [], fetchedAt, readPdf: async () => pdf, async completeText(input) {
      const v = JSON.parse(input.user);
      if (v.ranges) return JSON.stringify({ ranges: { [v.ranges[0].key]: { section:"Starting", keywords:["solids"],
        priorTopicMatches:{feeding:true}, region:"HK",topics:["readiness"],conditions:[current],
        ageRange:{basis:"actual",minMonths:6,maxMonths:24,exclusiveEnd:true},
        pageText:{physicalPage1:"Cover",physicalPage2:"Contents",physicalPage3:"Check readiness before starting."} } },
        nativeCoverage:{pages:pages.map(p => ({page:p.page,finding:p.text})),unreadablePages:[],layoutAnswer:null} });
      assert.equal(v.priorConditions[1].original, clinical);
      const reference = JSON.parse((await provider([])(input)).split("\n")[1]!);
      reference.changes = Object.fromEntries(reference.changes.map(({key,...value}: {key:string}) => [key,value]));
      return JSON.stringify({...reference, priorConditions:{priorCondition1:{disposition:"prior_edition_note",reason:"Old collection coverage."},
        priorCondition2:{disposition:unresolved?"unresolved":"condition1",reason:"Physical page 3 requires readiness."}},
        nativeCoverage:{pageFindings:{page1:"Cover",page2:"Contents",page3:"Readiness signs"},unreadablePages:[],layoutAnswer:null}});
    } });
  }
  const accepted = await run(false), applicability = accepted.source.chunks[0]!.applicability;
  assert.deepEqual([applicability.minAgeMonths, applicability.maxAgeMonths, applicability.maxAgeMonthsExclusive], [0,24,true]);
  assert.deepEqual(applicability.conditions, [current]);
  assert.deepEqual(accepted.provenance.nativePdf!.priorConditions!.map(c => [c.pageStart,c.original,c.disposition,c.currentCondition]),
    [[3,administrative,"prior_edition_note",null],[3,clinical,"retained",current]]);
  assert.equal((await run(true)).review.decision, "hold_candidate");
  const prior = accepted.source.chunks[0]!;
  const edit = { key: prior.key, text: "Eligibility also requires readiness.", applicability: prior.applicability,
    evidence: [{ page: 3, quote: pages[2]!.text }] };
  async function amend(quote: string, supported: boolean) {
    return prepareKnowledgeMaintenance({ candidate, baseline, growthRules: [], fetchedAt, readPdf: async () => pdf,
      heldDraft: { work: knowledgeHash("held"), prepared: accepted, feedback: "Verify the example against the original.",
        amendments: [{ ...edit, evidence: [{ page: 3, quote }] }] },
      async completeText(input) {
        const v = JSON.parse(input.user);
        assert.equal(v.role, "knowledge-semantic-review");
        assert.ok(input.pdf);
        assert.deepEqual(v.proposedAmendments, [edit]);
        const reference = JSON.parse((await provider([])(input)).split("\n")[1]!);
        reference.changes = Object.fromEntries(reference.changes.map(({key,...value}: {key:string}) => [key,value]));
        return JSON.stringify({ ...reference, amendments: { [edit.key]: { supported, reason: "Compared the cited page." } },
          priorConditions: { priorCondition1: { disposition: "prior_edition_note", reason: "Old scope." },
            priorCondition2: { disposition: "condition1", reason: "Readiness qualifier." } },
          nativeCoverage: {pageFindings:{page1:"Cover",page2:"Contents",page3:"Readiness signs"},unreadablePages:[],layoutAnswer:null} });
      } });
  }
  await assert.rejects(amend("Fabricated original span", true), /amendment_evidence_mismatch/u);
  assert.equal((await amend(edit.evidence[0]!.quote, false)).review.decision, "hold_candidate");
  const edited = await amend(edit.evidence[0]!.quote, true);
  assert.equal(edited.source.chunks[0]!.originalText, prior.originalText);
  assert.equal(edited.source.chunks[0]!.text, edit.text);
  assert.equal(edited.provenance.nativePdf?.revision?.originalOrganizeAttempt, accepted.provenance.organizeAttemptKey);
  assert.throws(() => includePriorRetrieval({...scope,minAgeMonths:18,maxAgeMonths:24},[scope]), /age_scope_conflict/u);
  assert.throws(() => includePriorRetrieval({...scope,ageBasis:"corrected"},[scope]), /age_scope_conflict/u);
});

test("the registered visual sample rejects wrong fruit and disagreement independently of an approval", () => {
  const answer = {fruit:"蘋果",tool:"金屬匙羹",arrowColour:"藍色",arrowDirection:"向右"};
  assert.equal(matchesFhsLayout(answer),true);
  assert.equal(matchesFhsLayout({...answer,arrowDirection:"右邊"}),true);
  assert.equal(matchesFhsLayout({...answer,fruit:"梨子"}),false);
  assert.equal(matchesFhsLayout({...answer,fruit:"梨子（或類似蘋果的果肉）"}),false);
  assert.equal(matchesFhsLayout({...answer,arrowDirection:"向左"}),false);
  assert.equal(matchesFhsLayout(undefined),false);
});
