import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, FinishReason } from "@google/genai";
import { readAiConfig } from "../server/ai-config.ts";
import { createEmbeddingGateway } from "../server/embedding-gateway.ts";
import { createKnowledgeRetriever } from "../server/knowledge-retriever.ts";
import { AgentBudget } from "../server/agent-budget.ts";
import { createProductAgentTools } from "../server/product-agent-tools.ts";
import {
  BudgetCapExceededError,
  REQ002_CORE_SCENARIOS,
  REQ002_DEFAULT_BUDGET_CAPS,
  REQ002_SYNTHETIC_CANARY,
  buildSanitizedAcceptanceReceipt,
  createProviderBoundaryGuard,
  findCanaryLeaks,
  inspectCaseCHelpMatch,
  parseReq002LiveCliArgs,
} from "../server/req002-acceptance-harness.ts";
import {
  createSeededOfficialKnowledgeStore,
  executeReq002AcceptanceSuite,
  runBaselineVsBoundedComparison,
  runSseDisconnectAndRecoverySuite,
} from "../scripts/lib/req002-acceptance-runner.ts";

test("CLI guard refuses unflagged or ambiguous execution and enforces bounded flag ranges", () => {
  assert.throws(() => parseReq002LiveCliArgs([]), /Choose exactly one execution mode/u);
  assert.throws(() => parseReq002LiveCliArgs(["--live", "--offline"]), /Choose exactly one execution mode/u);
  assert.throws(() => parseReq002LiveCliArgs(["--offline", "--max-runs=0"]), /Invalid integer/u);
  assert.throws(() => parseReq002LiveCliArgs(["--live", "--unknown-flag"]), /Unknown CLI option/u);

  const live = parseReq002LiveCliArgs(["--live", "--write-receipt", "--max-runs=3", "--max-model-calls=10", "--max-embeddings=4"]);
  assert.equal(live.mode, "live");
  assert.equal(live.writeReceiptPath, "artifacts/verification/REQ002_LIVE_VERIFICATION_20261119.json");
  assert.deepEqual(live.budgetCaps, REQ002_DEFAULT_BUDGET_CAPS);

  const offline = parseReq002LiveCliArgs(["--offline", "--write-receipt=scratch/custom.json"]);
  assert.equal(offline.mode, "offline");
  assert.equal(offline.writeReceiptPath, "scratch/custom.json");
});

test("provider boundary guard counts generation, review/repair, and query embeddings and fails closed before over-budget dispatch", async () => {
  let upstreamModelCalls = 0;
  let upstreamEmbeddings = 0;
  const logs: string[] = [];

  const makeGuard = () => createProviderBoundaryGuard({
    caps: { maxRuns: 2, maxModelCalls: 3, maxQueryEmbeddings: 1 },
    provider: {
      async generate(request) {
        upstreamModelCalls += 1;
        return {
          content: { role: "model", parts: [{ text: request.config?.tools?.length ? "tool-turn" : "review-turn" }] },
          finishReason: FinishReason.STOP,
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
        };
      },
    },
    embedding: {
      async embed(req) {
        upstreamEmbeddings += 1;
        return { values: new Array<number>(1024).fill(0.1), inputTokens: req.text.length, billableCharacters: req.text.length };
      },
    },
    onLog: line => logs.push(line),
  });

  const guard = makeGuard();
  guard.beginRun("run-1");
  await guard.provider.generate({ contents: [], config: { tools: [{ functionDeclarations: [{ name: "search_knowledge" }] }] }, toolsDict: {}, liveConnectConfig: {} }, new AbortController().signal);
  await guard.provider.generate({ contents: [], config: {}, toolsDict: {}, liveConnectConfig: {} }, new AbortController().signal);
  await guard.provider.generate({ contents: [], config: {}, toolsDict: {}, liveConnectConfig: {} }, new AbortController().signal);
  await guard.embedding!.embed({ task: "RETRIEVAL_QUERY", text: "六個月嬰兒固體食物" }, new AbortController().signal);

  // 4th model call and 2nd query embedding must be blocked BEFORE touching upstream provider.
  await assert.rejects(
    guard.provider.generate({ contents: [], config: {}, toolsDict: {}, liveConnectConfig: {} }, new AbortController().signal),
    err => err instanceof BudgetCapExceededError && err.kind === "model_calls" && err.limit === 3,
  );
  await assert.rejects(guard.embedding!.embed({ task: "RETRIEVAL_QUERY", text: "later" }, new AbortController().signal),
    err => err instanceof BudgetCapExceededError && err.kind === "model_calls");
  const embeddingGuard = makeGuard();
  await embeddingGuard.embedding!.embed({ task: "RETRIEVAL_QUERY", text: "first query" }, new AbortController().signal);
  await assert.rejects(
    embeddingGuard.embedding!.embed({ task: "RETRIEVAL_QUERY", text: "second query" }, new AbortController().signal),
    err => err instanceof BudgetCapExceededError && err.kind === "query_embeddings" && err.limit === 1,
  );
  const runGuard = makeGuard();
  runGuard.beginRun("run-1");
  runGuard.beginRun("run-2");
  assert.throws(() => runGuard.beginRun("run-3"), err => err instanceof BudgetCapExceededError && err.kind === "runs" && err.limit === 2);

  assert.equal(upstreamModelCalls, 3, "Blocked 4th call must never reach upstream model provider");
  assert.equal(upstreamEmbeddings, 2, "Only the first embedding in each of two independent guard tests was dispatched");
  const snap = guard.snapshot();
  assert.equal(snap.modelCalls, 3);
  assert.equal(snap.reviewOrRepairCalls, 2);
  assert.equal(snap.queryEmbeddings, 1);
  assert.equal(snap.totalTokens, 45);
  assert.ok(logs.some(line => line.includes("cap_blocked kind=model_calls")));

  // Simulate provider throwing an error on a retry-enabled config: ensure partial counts remain bounded.
  const retryGuard = createProviderBoundaryGuard({
    caps: { maxRuns: 1, maxModelCalls: 1, maxQueryEmbeddings: 1 },
    provider: {
      async generate() { throw new ApiError({ status: 503, message: "transient" }); },
    },
  });
  retryGuard.beginRun("retry-test");
  await assert.rejects(retryGuard.provider.generate({ contents: [], config: {}, toolsDict: {}, liveConnectConfig: {} }, new AbortController().signal));
  assert.equal(retryGuard.snapshot().modelCalls, 1);
  await assert.rejects(retryGuard.provider.generate({ contents: [], config: {}, toolsDict: {}, liveConnectConfig: {} }, new AbortController().signal), BudgetCapExceededError);
});

test("Case C help checker keeps existing urgent/medical boundaries without inventing numeric 999 thresholds", () => {
  const numericFeverOnly = inspectCaseCHelpMatch("BB 發高燒到 39.5 度兼嘔咗兩次，點算好？");
  assert.equal(numericFeverOnly.respectsExistingEmergencyBoundaries, true);
  assert.equal(numericFeverOnly.cards.includes("emergency-hk-v1"), false, "39.5 degrees alone must not synthesize an unapproved 999 rule");

  const withConsultCue = inspectCaseCHelpMatch("BB 發高燒到 39.5 度，要唔要睇醫生或者食退燒藥？");
  assert.equal(withConsultCue.respectsExistingEmergencyBoundaries, true);
  assert.deepEqual(withConsultCue.cards, ["medical-consult-hk-v1"]);

  const urgentCue = inspectCaseCHelpMatch("BB 發高燒不退兼抽搐，點算？");
  assert.equal(urgentCue.respectsExistingEmergencyBoundaries, true);
  assert.ok(urgentCue.cards.includes("emergency-hk-v1"));
});

test("external search_knowledge rejects raw PII canary before reaching embedding provider", async () => {
  const seed = await createSeededOfficialKnowledgeStore();
  let embedDispatched = 0;
  const config = readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-pii-guard" });
  const embeddings = createEmbeddingGateway({
    config,
    usage: { reserve: async () => true, record: async () => {} },
    provider: {
      async embed() {
        embedDispatched += 1;
        return { values: new Array<number>(1024).fill(0.1), inputTokens: 2, billableCharacters: 2 };
      },
    },
  });
  const budget = new AgentBudget();
  const retriever = createKnowledgeRetriever(seed.store, embeddings);
  try {
    const tools = createProductAgentTools({
      run: {
        scope: { userId: "u1", childId: "c1", workspaceId: "w1", authorizationVersion: "1", dataVersion: "epoch:1" },
        runId: "11111111-1111-4111-8111-111111111111",
        budget,
        deliveryReview: { required: false, reason: null, citationRequired: false, require() {}, binding() { return null; } },
      } as never,
      authorize: async () => true,
      store: { readHistory: async () => null } as never,
      memory: { context: async () => ({ profile: { childId: "c1", version: 0, data: null }, profileApplicable: false, facts: [], topics: [], summary: null, recentMessages: [], conflictingKeys: [], unavailableFactKeys: [], truncated: { facts: false, topics: false, messages: false } }) } as never,
      tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) },
      knowledge: retriever,
      trustedUserMessage: REQ002_CORE_SCENARIOS.halfYearSolidFoodWithCanary,
    } as never);
    const searchTool = tools.tools.find(tool => tool.name === "search_knowledge")!;
    const out = await searchTool.execute(
      { query: REQ002_CORE_SCENARIOS.halfYearSolidFoodWithCanary, classification: "official_guidance" },
      { scope: { userId: "u1", childId: "c1", workspaceId: "w1", authorizationVersion: "1", dataVersion: "epoch:1" }, runId: "11111111-1111-4111-8111-111111111111", callId: "c1", signal: new AbortController().signal },
    );
    assert.equal(out.status, "rejected");
    assert.equal(out.data?.code, "public_query_required");
    assert.equal(embedDispatched, 0, "Rejected PII query must never call external embedding provider");
  } finally {
    budget.close();
  }
});

test("receipt builder refuses any serialized canary token", () => {
  assert.ok(findCanaryLeaks({ nested: ["ok", REQ002_SYNTHETIC_CANARY.address] }).includes("沙田第一城"));
  assert.throws(() => buildSanitizedAcceptanceReceipt({
    candidateSha: "abcdef1234567",
    mode: "offline_scripted",
    provider: "scripted_offline",
    suite: "core_abc",
    model: REQ002_SYNTHETIC_CANARY.name,
    executedAt: new Date().toISOString(),
    budgetCaps: REQ002_DEFAULT_BUDGET_CAPS,
    totals: { capBlocked: false, runsStarted: 1, modelCalls: 1, reviewOrRepairCalls: 0, queryEmbeddings: 0, promptTokens: 0, candidateTokens: 0, totalTokens: 0 },
    scenarios: [{
      id: "case_a",
      runId: "run-1",
      status: "completed",
      stopReason: null,
      terminalCategory: "completed",
      cacheMode: "not_measured",
      counts: { modelCalls: 1, toolCalls: 1, queryEmbeddings: 0 },
      providerBoundaryCalls: 1,
      reviewDecision: "pass",
      citedChunkIds: [],
      citedSourceIds: [],
      originalVersionVerified: false,
      getReplyReplaySameRunId: true,
      deterministicHelpCards: [],
      milestones: { firstMeaningfulProgressMs: 1, firstUsableSourceMs: null, firstApprovedAnswerMs: 2, terminalSettledMs: 3 },
    }],
    sseDisconnectRecovery: {
      transport: "in_memory_http_sse",
      abortedMidStream: true,
      preAbortPhases: ["started", "searching"],
      retainedSourcesBeforeAbort: 1,
      duplicatePostCalls: 0,
      recoveredRunId: "run-1",
      lateOutOfOrderIgnored: true,
      stoppedRetainsQualifiedCards: true,
      revocationClearedCards: true,
    },
    baselineComparison: {
      measurement: "scripted_provider_and_local_map", productCache: "not_measured",
      sampleSize: 1,
      sequentialBaselineModelCalls: 4,
      boundedBatchModelCalls: 2,
      modelCallReduction: 2,
      sequentialToolCalls: 4,
      boundedBatchToolCalls: 4,
      coldEmbeddings: 3,
      warmReusedEmbeddings: 3,
      note: "synthetic",
    },
    outboundQueryLeakCount: 0,
    embeddingPayloadLeakCount: 0,
    diagnosticAndLogLeakCount: 0,
  }), /leaked synthetic canary tokens/u);
});

test("seeded 5-source offline suite covers Case G, A, B, C, SSE mid-stream disconnect recovery, and baseline benchmark with zero leaks", async () => {
  const options = {
    candidateSha: "deadbeef12345",
    mode: "offline" as const,
    config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-req002-suite", AI_AGENT_MAX_RETRIES: "0" }),
    providerName: "scripted_offline",
  };
  const receipt = await executeReq002AcceptanceSuite(options);
  const greetingReceipt = await executeReq002AcceptanceSuite({ ...options, offlineGreetingOnly: true });

  assert.deepEqual(receipt.verdict, { status: "passed", failures: [] });
  assert.deepEqual(greetingReceipt.verdict, { status: "passed", failures: [] });
  const byId = new Map(receipt.scenarios.map(item => [item.id, item]));
  const caseG = greetingReceipt.scenarios[0]!;
  assert.equal(caseG.id, "case_g_greeting_short_path");
  assert.equal(caseG.status, "completed");
  assert.equal(caseG.counts.modelCalls, 1);
  assert.equal(caseG.counts.queryEmbeddings, 0);
  assert.equal(caseG.reviewDecision, null);
  assert.equal(caseG.getReplyReplaySameRunId, true);

  const caseA = byId.get("case_a_half_year_solid_food")!;
  assert.equal(caseA.status, "completed");
  assert.equal(caseA.reviewDecision, "pass");
  assert.deepEqual(caseA.citedSourceIds, ["fhs-solid-food"]);
  assert.equal(caseA.originalVersionVerified, true);
  assert.equal(caseA.getReplyReplaySameRunId, true);
  assert.ok(
    caseA.milestones.firstMeaningfulProgressMs !== null
    && caseA.milestones.firstUsableSourceMs !== null
    && caseA.milestones.firstApprovedAnswerMs !== null
    && caseA.milestones.terminalSettledMs !== null,
  );
  assert.ok(
    caseA.milestones.firstMeaningfulProgressMs <= caseA.milestones.firstUsableSourceMs
    && caseA.milestones.firstUsableSourceMs <= caseA.milestones.terminalSettledMs,
  );

  const caseB = byId.get("case_b_two_month_restriction")!;
  assert.equal(caseB.status, "completed");
  assert.equal(caseB.reviewDecision, "pass");
  assert.deepEqual(caseB.citedSourceIds, ["fhs-solid-food"]);
  assert.equal(caseB.originalVersionVerified, true);

  const caseC = byId.get("case_c_uncovered_fever_vomiting")!;
  assert.deepEqual(caseC.citedChunkIds, [], "Uncovered fever+vomiting must never fabricate official citations");
  assert.ok(caseC.deterministicHelpCards.includes("medical-consult-hk-v1"));
  assert.equal(caseC.deterministicHelpCards.includes("emergency-hk-v1"), false);
  assert.equal(caseC.getReplyReplaySameRunId, true);

  assert.equal(receipt.sseDisconnectRecovery.abortedMidStream, true);
  assert.ok(receipt.sseDisconnectRecovery.retainedSourcesBeforeAbort >= 1);
  assert.equal(receipt.sseDisconnectRecovery.duplicatePostCalls, 0);
  assert.equal(receipt.sseDisconnectRecovery.lateOutOfOrderIgnored, true);
  assert.equal(receipt.sseDisconnectRecovery.stoppedRetainsQualifiedCards, true);
  assert.equal(receipt.sseDisconnectRecovery.revocationClearedCards, true);

  assert.ok(receipt.scenarios.every(s => s.cacheMode === "not_measured"));
  assert.equal(receipt.baselineComparison.productCache, "not_measured");
  assert.ok(receipt.baselineComparison.modelCallReduction >= 1);
  assert.equal(receipt.baselineComparison.warmReusedEmbeddings, receipt.baselineComparison.coldEmbeddings);

  assert.equal(receipt.privacyCheck.outboundQueryLeakCount, 0);
  assert.equal(receipt.privacyCheck.embeddingPayloadLeakCount, 0);
  assert.equal(receipt.privacyCheck.diagnosticAndLogLeakCount, 0);
  assert.equal(receipt.privacyCheck.receiptLeakCount, 0);
  assert.equal(findCanaryLeaks(receipt).length, 0);

  // Also verify direct standalone exports execute cleanly within caps.
  const directSse = await runSseDisconnectAndRecoverySuite();
  assert.equal(directSse.abortedMidStream, true);
  const directBench = await runBaselineVsBoundedComparison();
  assert.ok(directBench.sequentialBaselineModelCalls > directBench.boundedBatchModelCalls);
});
