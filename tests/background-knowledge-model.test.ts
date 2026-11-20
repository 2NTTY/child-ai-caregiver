import { matchesFhsLayout } from "./helpers/knowledge-pdf-layout-sample.ts";
import { pdfOrganizationContract } from "../server/knowledge-pdf-output.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assembleAgentPrompt } from "../server/agent-prompt.ts";
import { retainedDraftRevisionSchema, retainedDraftWorkId } from "../server/knowledge-retained-draft.ts";
import { createHash, randomUUID } from "node:crypto";
import { canResumeRetainedPromptFailure, createFirestoreKnowledgeWork } from "../server/firestore-knowledge-work.ts";
import { createStorageCipher } from "../server/storage-crypto.ts";
import { EmbeddingAdmissionDeferred } from "../server/embedding-failure.ts";
import { firestoreDomainFixture } from "./helpers/firestore-domain-memory.ts";
import test from "node:test";
import { createModelKnowledgeReviewPort, includePriorRetrieval, prepareKnowledgeMaintenance, type PreparedKnowledgeMaintenance } from "../server/background-knowledge-model.ts";
import type { BackgroundKnowledgeCandidate } from "../server/background-knowledge-maintenance.ts";
import { SOURCE_WATCHES } from "../server/knowledge-source-catalog.ts";
import { observationHash } from "../server/knowledge-observation.ts";
import { knowledgeHash, parseKnowledgeFilter, parseKnowledgeSource, sourceVersionHash } from "../server/knowledge-inputs.ts";
import { reviseRetainedDraft } from '../server/knowledge-retained-draft.ts';
import { knowledgeReviewHash } from '../server/knowledge-review-assessment.ts';

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

test("the initial corpus age grammar couples bounds and holds one-sided evidence before independent review", async () => {
  const calls: Parameters<Completion>[0][] = [];
  const make = (age: object) => prepareKnowledgeMaintenance({ candidate: candidate(), baseline: null, fetchedAt, growthRules: [],
    explicitAgeScope: true, completeText: async input => {
      calls.push(input);
      const wire = JSON.stringify(input.responseJsonSchema);
      assert.ok(wire.includes('requiresAgeReview') && wire.includes('one_sided'), 'The native contract must offer an explicit age hold');
      const payload = JSON.parse(input.user);
      const shape = payload.outputSchema.properties.units.items.properties.applicability;
      const alternatives = shape.anyOf;
      const unrestricted = alternatives.find((branch: any) => branch.properties.ageBasis?.enum?.includes('any'));
      const bounded = alternatives.find((branch: any) => branch.properties.ageBasis?.enum?.includes('actual'));
      assert.equal(unrestricted.properties.minAgeMonths.type, 'null');
      assert.equal(unrestricted.properties.maxAgeMonths.type, 'null');
      assert.equal(bounded.properties.minAgeMonths.type, 'number');
      assert.equal(bounded.properties.maxAgeMonths.type, 'number');
      return JSON.stringify({ units: payload.originalUnits.map((unit: { id: string }) => ({
        unitId: unit.id, section: '原文', text: '原文', keywords: ['資料'], applicability: age })) });
    } });
  await assert.rejects(make({ requiresAgeReview: 'one_sided' }), { code: 'knowledge_age_one_sided' });
  await assert.rejects(make({ region: 'HK', ageBasis: 'any', minAgeMonths: 0, maxAgeMonths: 24, topics: ['care'], conditions: [] }), /invalid/i);
  await assert.rejects(make({ region: 'HK', ageBasis: 'actual', minAgeMonths: 12, maxAgeMonths: 7, topics: ['care'], conditions: [] }), /Invalid age applicability/);
  assert.equal(calls.length, 3);
  const accepted: Parameters<Completion>[0][] = [];
  const prepared = await prepareKnowledgeMaintenance({ candidate: candidate(), baseline: null, fetchedAt, growthRules: [],
    explicitAgeScope: true, completeText: provider(accepted) });
  assert.equal(prepared.review.decision, 'approve_candidate');
  assert.ok(JSON.parse(accepted[1]!.user).ageScopeCheck.includes('checks.age'));
  const pdf = pdfOrganizationContract([{ id: 'page', page: 1, pageEnd: 1 }], [], [], undefined, true);
  const page = pdf.ranges[0]!;
  assert.throws(() => pdf.parse({ ranges: { [page.key]: { section: 'Section', keywords: ['care'], region: 'HK', topics: ['care'],
    conditions: [], pageText: {physicalPage1: 'Text'}, ageRange: {requiresAgeReview: 'uncertain'} } },
    nativeCoverage: {pages: [{page: 1, finding: 'Text'}], unreadablePages: [], layoutAnswer: null} }), {code:'knowledge_age_uncertain'});
});

test("same-day admission reopens the identical sealed candidate only when capacity is available", async () => {
  const source = candidate(), generation = randomUUID(), fingerprint = knowledgeHash('synthetic-original-operation');
  const work = createFirestoreKnowledgeWork({ database: firestoreDomainFixture().database, namespace: 'synthetic',
    projectId: 'demo-maintenance', cipher: createStorageCipher(Buffer.alloc(32, 1)), readControl: async () => ({ enabled: true, generation }) });
  const request = { watchId: source.watchId, operationFingerprint: fingerprint, workerGeneration: generation, publishMode: 'live' as const };
  const config = knowledgeHash('original-config'), limits = { modelCalls: 2, deadlineMs: 60000, publicationConfigHash: config };
  const token = randomUUID(), session = await work.bind(request, token, config, limits);
  await session.ports.claimOperation(fingerprint, token, Date.now() + 60000);
  const prepared = await prepareKnowledgeMaintenance({ candidate: source, baseline: null, fetchedAt, growthRules: [], completeText: provider([]) });
  await session.savePrepared(source, prepared);
  await session.waitForQuota();
  const waiting = await work.inspect(request);
  await assert.rejects(work.bind(request, randomUUID(), config, limits, undefined, async () => false), EmbeddingAdmissionDeferred);
  assert.deepEqual(await work.inspect(request), waiting);
  const resumedToken = randomUUID(), resumed = await work.bind(request, resumedToken, config, limits, undefined, async () => true);
  await resumed.ports.claimOperation(fingerprint, resumedToken, Date.now() + 60000);
  assert.deepEqual(await resumed.readPrepared(source), prepared);
  assert.equal((await work.inspect(request))?.waitingForQuotaDay, undefined);
});

test("retained page proposals reuse the original request, preserve conditions and require a fresh reviewer decision", async () => {
  const source = candidate(), calls: Parameters<Completion>[0][] = [];
  const base = { candidate: source, baseline: null, fetchedAt, growthRules: [] };
  await prepareKnowledgeMaintenance({ ...base, completeText: provider(calls) });
  const { system, user, attemptKey } = calls[0]!;
  const unitId = JSON.parse(user).originalUnits[0].id;
  const scope = { ageBasis: 'any' as const, minAgeMonths: 0, maxAgeMonths: 12, conditions: ['Only for the registered audience'] };
  const revision = { action: 'review_age_draft' as const, sourceId: source.watchId, observationHash: source.observationHash, organizerRequestHash: knowledgeReviewHash({system, user, attemptKey}),
    operationFingerprint: 'a'.repeat(64), reason: 'The example has no whole-unit upper bound.',
    units: [{ unitId, ...scope, passages: [{ start: 0, quote: source.observed.text.slice(0, 5) }] }] };
  const retainedDraft = { revision, async readOrganizer(key: string) {
    assert.equal(key, attemptKey);
    return JSON.stringify({ units: [{ unitId, section: 'Fixture', text: source.observed.text, keywords: ['fixture'],
      applicability: { region: 'HK', topics: ['care'], ...scope } }] });
  } };
  const reviews: Parameters<Completion>[0][] = [];
  const prepared = await prepareKnowledgeMaintenance({ ...base, retainedDraft, completeText: provider(reviews, 'hold') });
  assert.equal(reviews.length, 1);
  const payload = JSON.parse(reviews[0]!.user);
  assert.equal(payload.role, 'knowledge-semantic-review');
  assert.deepEqual(payload.editorialAgeProposal.originalScopes, revision.units);
  assert.deepEqual(payload.candidate.chunks[0].applicability, { region: 'HK', topics: ['care'], ...scope, minAgeMonths: null, maxAgeMonths: null });
  assert.equal(prepared.review.decision, 'hold_candidate');
  assert.equal(prepared.provenance.retainedDraft?.revisionHash, knowledgeReviewHash(revision));
  const promptRoot = new URL('../prompts/', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', promptRoot), 'utf8'));
  const otherEnding = system.includes('\r\n') ? '\n' : '\r\n';
  const recorded = (recipeId: string) => assembleAgentPrompt({manifest, recipeId, mode:'structured',
    availableInputs:['run','scope','context','evidence','capabilities','outputContract'],
    readModule: async path => readFileSync(new URL(path, promptRoot), 'utf8').replace(/\r?\n/gu, otherEnding)});
  const historicalSystem = (await recorded('knowledge-organize')).text;
  const historicalKey = 'knowledge-organize:' + knowledgeReviewHash({system:historicalSystem, user});
  assert.notEqual(historicalKey, attemptKey);
  const historicalReview: Parameters<Completion>[0][] = [];
  await prepareKnowledgeMaintenance({...base, retainedDraft:{
    revision:{...revision, organizerRequestHash:knowledgeReviewHash({system:historicalSystem, user, attemptKey:historicalKey})},
    async readOrganizer(key) {assert.equal(key,historicalKey); return retainedDraft.readOrganizer(attemptKey);}
  }, completeText:provider(historicalReview,'hold')});
  assert.equal(historicalReview.length,1);
  assert.equal(historicalReview[0]!.system,(await recorded('knowledge-review')).text);
  revision.units[0]!.passages[0]!.start++;
  await assert.rejects(prepareKnowledgeMaintenance({ ...base, retainedDraft, completeText: provider(reviews) }), /scope_changed/);
  revision.organizerRequestHash = 'b'.repeat(64);
  await assert.rejects(prepareKnowledgeMaintenance({ ...base, retainedDraft, completeText: provider(reviews) }), /request_changed/);
  assert.equal(reviews.length, 1);
});

test('a registered retained preflight can resume once on the same operation with its failure preserved', async () => {
  const manifest = JSON.parse(readFileSync(new URL('../knowledge/fhs-initial-recovery.json', import.meta.url), 'utf8'));
  const revision = retainedDraftRevisionSchema.parse(manifest.entries.find((row: {sourceId: string}) => row.sourceId === 'fhs-30034'));
  const fingerprint = retainedDraftWorkId(revision.operationFingerprint), generation = randomUUID();
  const work = createFirestoreKnowledgeWork({ database: firestoreDomainFixture().database, namespace: 'synthetic',
    projectId: 'demo-maintenance', cipher: createStorageCipher(Buffer.alloc(32, 1)), readControl: async () => ({enabled: true, generation}) });
  const request = { watchId: revision.sourceId, operationFingerprint: fingerprint, workerGeneration: generation, publishMode: 'live' as const };
  const config = knowledgeHash('original-config'), limits = { modelCalls: 1, deadlineMs: 60000 };
  async function recordFailure() {
    const token = randomUUID(), session = await work.bind(request, token, config, limits, undefined, undefined, revision);
    const claim = await session.ports.claimOperation(fingerprint, token, Date.now() + 30000);
    assert.equal(claim.status, 'claimed');
    await session.ports.saveResult(fingerprint, {status: 'candidate_held', code: 'knowledge_retained_page_request_changed',
      watchId: request.watchId, observationHash: revision.observationHash, published: false, publishMode: 'live'});
    await session.ports.releaseOperation(fingerprint, token);
  }
  await recordFailure();
  const failed = await work.inspect(request);
  assert.ok(failed?.result);
  assert.equal(canResumeRetainedPromptFailure({...failed, budget: {...failed.budget, modelCalls: 1}}, revision), false);
  assert.equal(canResumeRetainedPromptFailure({...failed, result: {...failed.result, code: 'knowledge_review_failed'}}, revision), false);
  assert.equal(canResumeRetainedPromptFailure(failed, {...revision, reason: 'changed revision'}), false);
  await work.bind(request, randomUUID(), config, limits);
  assert.deepEqual((await work.inspect(request))?.result, failed.result);
  await recordFailure();
  const second = await work.inspect(request);
  assert.deepEqual(second?.retainedPromptFailure, failed.result);
  assert.equal(second?.budget.modelCalls, 0);
  await work.bind(request, randomUUID(), config, limits, undefined, undefined, revision);
  assert.deepEqual((await work.inspect(request))?.result, second?.result);
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
  const firstPublication = await prepareKnowledgeMaintenance({ candidate: observed, baseline: null, fetchedAt,
    growthRules, completeText: provider([]) });
  assert.ok(firstPublication.source.chunks.every(chunk => chunk.key !== growthRules[0]!.key));
  assert.equal(firstPublication.review.decision, "approve_candidate");
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

  // A new unit outside a complete pinned range may publish without rewriting that range.
  const originalText = observed.observed.text.padEnd(3000, "甲");
  const pinned = { ...source.chunks[0]!, originalText };
  const prior = { ...source, chunks: [pinned] };
  const addition = { ...observed.observed, text: originalText + "\n另附開放時間。" };
  const extended = await prepareKnowledgeMaintenance({
    candidate: { ...observed, observed: addition, observationHash: observationHash(addition) },
    baseline: { ...baseline, source: prior, versionHash: sourceVersionHash(prior) }, fetchedAt,
    growthRules: [{ ...growthRules[0]!, hash: knowledgeHash(pinned) }], completeText: provider([]),
  });
  assert.deepEqual(extended.source.chunks[0], pinned);
  assert.equal(extended.source.chunks.length, 2);
  assert.equal(extended.assessment.growthRuleImpact, "none");
  assert.equal(extended.review.decision, "approve_candidate");

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

test("retained PDF region corrections preserve the original reading and send the same physical page to an independent reviewer", async () => {
  const definition = SOURCE_WATCHES.find(w => w.leafletPage)!;
  const pdf = Buffer.from("%PDF-1.7 test fixture");
  const sha256 = createHash("sha256").update(pdf).digest("hex");
  const observed = { ...candidate().observed, url: definition.url, pages: [{page: 1, text: "Physical page one.", status: "text" as const}],
    extraction: {format: "text_pdf" as const, contentHash: sha256, totalPages: 1, pageStart: 1, pageEnd: 1, complete: true} };
  const source = { watchId: definition.id, definition, observed, observationHash: observationHash(observed), previousObservationHash: null };
  const base = { candidate: source, explicitAgeScope: true, baseline: null, fetchedAt, growthRules: [], readPdf: async () => pdf };
  const range = "fromPage1Through1Unit1", conditions = ["Only the stated daily amount has the stated age range."];
  const draft = JSON.stringify({ ranges: { [range]: { region: "香港", section: "Intake", keywords: ["cup"], topics: ["care"], conditions,
    ageRange: { basis: "actual", minMonths: 12, maxMonths: 60, exclusiveEnd: false }, pageText: {physicalPage1: "Daily amount for the specified ages."} } },
    nativeCoverage: { pages: [{ page: 1, finding: "Age range is conditional." }], unreadablePages: [], layoutAnswer: null } });
  let organizerRequestHash = "", organizerKey = "";
  const freshReview = new Error('Fresh PDF draft reached independent review');
  await assert.rejects(prepareKnowledgeMaintenance({ ...base, async completeText({role, system, user, attemptKey}) {
    if (role === 'knowledge_review') {
      assert.equal(JSON.parse(user).candidate.chunks[0].applicability.region, 'HK');
      throw freshReview;
    }
    organizerRequestHash = knowledgeReviewHash({system, user, attemptKey});
    organizerKey = attemptKey;
    return draft;
  } }), error => error === freshReview);
  const revision = { action: 'review_pdf_region' as const, sourceId: source.watchId, observationHash: source.observationHash, sha256,
    organizerRequestHash, operationFingerprint: 'd'.repeat(64), reason: 'Verify conditional ages on physical page one.', sections: ['Physical page 1'],
    regionEdits: [{ range, from: '香港' as const, to: 'HK' as const }] };
  const retainedDraft = { revision, async readOrganizer(key: string) { assert.equal(key, organizerKey); return draft; } };
  let reviews = 0;
  const completeText: Completion = async input => {
    ++reviews;
    assert.equal(input.role, 'knowledge_review');
    assert.equal(input.pdf?.sha256, sha256);
    const payload = JSON.parse(input.user);
    assert.deepEqual(payload.editorialRegionProposal.edits, revision.regionEdits);
    assert.deepEqual(payload.candidate.chunks[0].applicability, {region: 'HK', ageBasis: 'actual', minAgeMonths: 12, maxAgeMonths: 60, topics: ['care'], conditions});
    const response = JSON.parse((await provider([], 'hold')(input)).split('\n')[1]!);
    response.changes = Object.fromEntries(response.changes.map(({key, ...rest}: {key: string}) => [key, rest]));
    return JSON.stringify({...response, nativeCoverage: { pageFindings: {page1: "Conditional ages"}, unreadablePages: [], layoutAnswer: null }});
  };
  const result = await prepareKnowledgeMaintenance({ ...base, retainedDraft, completeText });
  assert.equal(result.review.decision, 'hold_candidate');
  assert.equal(result.provenance.retainedDraft?.priorWork, revision.operationFingerprint);
  revision.regionEdits[0]!.range = 'fromPage2Through2Unit1';
  await assert.rejects(prepareKnowledgeMaintenance({ ...base, retainedDraft, completeText }), /pdf_region_changed/u);
  assert.equal(reviews, 1);
});

test("retained official PDF endpoints survive storage while the original organizer and family query keep their registered limits", () => {
  const units = [{id: 'u1', page: 1, pageEnd: 1}];
  const original = pdfOrganizationContract(units);
  const key = original.ranges[0]!.key;
  const ageRange = {basis: 'actual' as const, minMonths: 0 as const, maxMonths: 216 as const, exclusiveEnd: true};
  const raw = { ranges: { [key]: { section: 'Child protection', keywords: ['care'], region: '香港', topics: ['care'],
    conditions: ['People under 18'], ageRange, pageText: {physicalPage1: 'Children are people under 18.'} } },
    nativeCoverage: {pages: [{page: 1, finding: 'Age definition'}], unreadablePages: [], layoutAnswer: null} };
  const revision = { action: 'review_pdf_source_age' as const, sourceId: 'fixture', sha256: 'a'.repeat(64),
    operationFingerprint: 'b'.repeat(64), observationHash: 'c'.repeat(64), organizerRequestHash: 'd'.repeat(64),
    reason: 'Check the original upper bound.', sections: ['Page 1'], sourceRanges: {[key]: ageRange},
    regionEdits: [{range: key, from: '香港' as const, to: 'HK' as const}] };
  const proposed = reviseRetainedDraft(raw, revision, []);
  assert.throws(() => original.parse(proposed));
  const parsed = pdfOrganizationContract(units, [], [], undefined, false, true).parse(proposed).units[0]!.applicability;
  const watch = candidate().definition;
  const document = {sourceId: watch.id, url: watch.url, title: 'Fixture', publisher: watch.publisher, termsUrl: watch.termsUrl,
    classification: 'official_guidance', sourcePublishedAt: null, sourceUpdatedAt: null, fetchedAt,
    chunks: [{key:'fixture', section:'Page one', sourceExcerpt:'Children under 18', text:'People under 18', keywords:['care'], applicability:parsed}]};
  assert.equal(parseKnowledgeSource(document).chunks[0]!.applicability.maxAgeMonths, 216);
  assert.throws(() => parseKnowledgeSource({...document, classification:'recent_information'}), /Only official guidance/);
  assert.equal(parsed.maxAgeMonthsExclusive, true);
  const query = {region: 'HK', topics: [], age: {basis: 'actual', minMonths: 120, maxMonths: 120}};
  assert.equal(parseKnowledgeFilter(query).age?.maxMonths, 120);
  assert.throws(() => parseKnowledgeFilter({...query, age: {...query.age, maxMonths: 121}}));
  assert.throws(() => reviseRetainedDraft(raw, {...revision, sourceRanges: {[key]: {...ageRange, exclusiveEnd: false}}}, []), /pdf_age_changed/);
});

test("grouped PDF sections require one keyed summary for each physical page in its range", () => {
  const contract = pdfOrganizationContract([{id:"u1",page:5,pageEnd:6}]);
  const range = contract.ranges[0]!;
  const group = {section:"Fruit",keywords:["fruit"],region:"HK",topics:["care"],conditions:[],ageRange:null};
  const nativeCoverage = {pages:[{page:5,finding:"Table introduction"},{page:6,finding:"Fruit row"}],unreadablePages:[],layoutAnswer:null};
  const parse = (pageText:Record<string,string>) => contract.parse({ranges:{[range.key]:{...group,pageText}},nativeCoverage});
  const withRegion = (region: string) => contract.parse({ranges:{[range.key]:{...group,region,pageText:{physicalPage5:"Opening",physicalPage6:"Fruit"}}},nativeCoverage});
  for (const spelling of ["Hong Kong", "香港", "hk"]) assert.equal(withRegion(spelling).units[0]!.applicability.region, "HK");
  assert.throws(() => withRegion("未註明"));
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
