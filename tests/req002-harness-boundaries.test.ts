import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as harness from "../server/req002-acceptance-harness.ts";

test("CLI and provider boundary reject increases and invalid programmatic caps before dispatch", () => {
  for (const [key, flag, max] of [
    ["maxRuns", "--max-runs", 3], ["maxModelCalls", "--max-model-calls", 10],
    ["maxQueryEmbeddings", "--max-embeddings", 4],
  ] as const) {
    for (const mode of ["--offline", "--live"]) {
      for (const raw of [String(max + 1), "100", "1.5", "0", "1e0", "0x1", "NaN"]) {
        assert.throws(() => harness.parseReq002LiveCliArgs([mode, flag + "=" + raw]), /Invalid integer/u);
      }
      assert.equal(harness.parseReq002LiveCliArgs([mode, flag + "=1"]).budgetCaps[key], 1);
    }
    for (const value of [max + 1, Infinity, NaN, 0, 1.5]) {
      assert.throws(() => harness.createProviderBoundaryGuard({
        caps: { [key]: value }, provider: { generate: async () => assert.fail("must not dispatch") },
      }), /Invalid integer/u);
    }
  }
  const guard = harness.createProviderBoundaryGuard({ provider: { generate: async () => assert.fail() } });
  assert.ok(Object.isFrozen(guard.caps));
});

test("a blocked canary or document embedding never reaches an external provider", async () => {
  let calls = 0;
  const makeGuard = () => harness.createProviderBoundaryGuard({
    provider: { generate: async () => { calls++; return {}; } },
    embedding: { embed: async () => { calls++; return { values: [], inputTokens: 0, billableCharacters: 0 }; } },
  });
  const signal = new AbortController().signal;
  await assert.rejects(makeGuard().embedding!.embed({ task: "RETRIEVAL_DOCUMENT", text: "doc", title: "t" }, signal));
  await assert.rejects(makeGuard().embedding!.embed({ task: "RETRIEVAL_QUERY", text: harness.REQ002_SYNTHETIC_CANARY.name }, signal));
  await assert.rejects(makeGuard().provider.generate({ config: {}, contents: [{ role: "model", parts: [{ functionCall: {
    name: "search_knowledge", args: { query: harness.REQ002_SYNTHETIC_CANARY.address },
  } }] }], toolsDict: {}, liveConnectConfig: {} }, signal));
  assert.equal(calls, 0);
});

test("fragmented SSE reports progress before result; a missing or erroneous result is never an approved answer", async () => {
  let tick = 0;
  const tracker = harness.createRunMilestoneTracker(() => tick);
  const messageId = "11111111-1111-4111-8111-111111111111", runId = "22222222-2222-4222-8222-222222222222";
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  let releaseCleanup!: () => void;
  const cleanup = new Promise<void>(resolve => { releaseCleanup = resolve; });
  const response = new Response(new ReadableStream({ start(c) { stream = c; }, cancel: () => cleanup }), { headers: { "content-type": "text/event-stream" } });
  const done = harness.observeReq002Reply(response, tracker, messageId, () => runId, () => runId);
  const encode = (event: unknown) => new TextEncoder().encode("data: " + JSON.stringify(event) + "\n\n");
  const send = (event: unknown) => { const bytes = encode(event); stream.enqueue(bytes.slice(0, 9)); stream.enqueue(bytes.slice(9)); };
  tick = 3;
  const foreign = "33333333-3333-4333-8333-333333333333";
  const sourceCard = { chunkId: "s1", sourceId: "source", title: "title", section: "sec", publisher: "p",
    url: null, excerpt: "例", fetchedAt: null, sourceUpdatedAt: null, stage: "found" };
  send({ type: "progress", progress: { runId: foreign, messageId, phase: "help", sequence: 99, card: "emergency-hk-v1" } });
  send({ type: "progress", progress: { runId: foreign, messageId, phase: "searching", sequence: 100, sources: [sourceCard] } });
  send({ type: "progress", progress: { runId, messageId, phase: "started", sequence: 5 } });
  send({ type: "progress", progress: { runId, messageId, phase: "searching", sequence: 2 } });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(tracker.snapshot().firstMeaningfulProgressMs, null, "foreign run or superseded phase is not progress on the original run");
  assert.equal(tracker.snapshot().firstUsableSourceMs, null, "the foreign run cannot supply a source milestone");
  assert.deepEqual(tracker.helpCards(), []);
  tick = 12;
  send({ type: "progress", progress: { runId, messageId, phase: "working", sequence: 6 } });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(tracker.snapshot().firstMeaningfulProgressMs, 12);
  assert.equal(tracker.snapshot().firstApprovedAnswerMs, null);
  tick = 28;
  send({ type: "progress", progress: { runId, messageId, phase: "searching", sequence: 7,
    sources: [sourceCard] } });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(tracker.snapshot().firstUsableSourceMs, 28);
  tick = 60;
  send({ type: "result", status: 201, body: { message: { role: "model", inReplyTo: messageId, agentRunId: runId, text: "ok" } } });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(tracker.snapshot().firstApprovedAnswerMs, 60, "answer observed even while reader cleanup is pending");
  tick = 65;
  releaseCleanup();
  await done;
  assert.equal(tracker.snapshot().firstApprovedAnswerMs, 60);
  assert.equal(tracker.snapshot().terminalSettledMs, null);
  tick = 70;
  tracker.markTerminalSettled();
  assert.equal(tracker.snapshot().terminalSettledMs, 70);
  for (const events of [[], [{ type: "result", status: 403, body: {} }], [{ type: "result", status: 200, body: { message: { role: "model", text: "x", agentRunId: runId, inReplyTo: runId } } }]]) {
    const fresh = harness.createRunMilestoneTracker();
    const source = new Response(events.map(e => new TextDecoder().decode(encode(e))).join(""), { headers: { "content-type": "text/event-stream" } });
    if (!events.length) await assert.rejects(harness.observeReq002Reply(source, fresh, messageId, () => runId, () => runId));
    else await harness.observeReq002Reply(source, fresh, messageId, () => runId, () => runId);
    assert.equal(fresh.snapshot().firstApprovedAnswerMs, null);
  }
});

test("receipt fails closed on a stopped/missing case, leak, cap, missing source or broken recovery", () => {
  const baseScenario = {
    id: "case_a_half_year_solid_food", runId: "run-a", status: "completed", stopReason: null,
    terminalCategory: "completed" as const, cacheMode: "not_measured" as const,
    counts: { modelCalls: 3, queryEmbeddings: 1, toolCalls: 2 }, providerBoundaryCalls: 3,
    reviewDecision: "pass", citedChunkIds: ["chunk-1"], citedSourceIds: ["fhs-solid-food"],
    originalVersionVerified: true, getReplyReplaySameRunId: true, deterministicHelpCards: [],
    milestones: { firstMeaningfulProgressMs: 2, firstUsableSourceMs: 10, firstApprovedAnswerMs: 20, terminalSettledMs: 30 },
  };
  const raw: Parameters<typeof harness.buildSanitizedAcceptanceReceipt>[0] = {
    candidateSha: "a".repeat(40), suite: "core_abc", mode: "offline_scripted", provider: "fixture", model: "scripted",
    executedAt: "2026-11-19T00:00:00.000Z", budgetCaps: harness.REQ002_DEFAULT_BUDGET_CAPS,
    totals: { capBlocked: false, runsStarted: 3, modelCalls: 9, queryEmbeddings: 3, reviewOrRepairCalls: 3, promptTokens: 0, candidateTokens: 0, totalTokens: 0 },
    scenarios: [baseScenario, { ...baseScenario, id: "case_b_two_month_restriction", runId: "run-b" },
      { ...baseScenario, id: "case_c_uncovered_fever_vomiting", runId: "run-c", citedChunkIds: [], citedSourceIds: [],
        originalVersionVerified: false, deterministicHelpCards: ["medical-consult-hk-v1"] }],
    sseDisconnectRecovery: { transport: "in_memory_http_sse", abortedMidStream: true, preAbortPhases: ["searching"],
      retainedSourcesBeforeAbort: 1, duplicatePostCalls: 0, recoveredRunId: "run-d", lateOutOfOrderIgnored: true,
      stoppedRetainsQualifiedCards: true, revocationClearedCards: true },
    baselineComparison: { measurement: "scripted_provider_and_local_map", productCache: "not_measured", sampleSize: 1,
      sequentialBaselineModelCalls: 4, boundedBatchModelCalls: 2, modelCallReduction: 2, sequentialToolCalls: 3,
      boundedBatchToolCalls: 3, coldEmbeddings: 3, warmReusedEmbeddings: 3, note: "fixture only" },
    outboundQueryLeakCount: 0, embeddingPayloadLeakCount: 0, diagnosticAndLogLeakCount: 0,
  };
  assert.equal(harness.buildSanitizedAcceptanceReceipt(raw).verdict.status, "passed");
  for (const mutate of [
    (r: typeof raw) => { r.scenarios[0]!.status = "stopped"; },
    (r: typeof raw) => { r.scenarios.pop(); },
    (r: typeof raw) => { r.outboundQueryLeakCount++; },
    (r: typeof raw) => { r.embeddingPayloadLeakCount++; },
    (r: typeof raw) => { r.diagnosticAndLogLeakCount++; },
    (r: typeof raw) => { r.totals.capBlocked = true; },
    (r: typeof raw) => { r.scenarios[0]!.originalVersionVerified = false; },
    (r: typeof raw) => { r.scenarios[2]!.deterministicHelpCards = []; },
    (r: typeof raw) => { r.sseDisconnectRecovery.duplicatePostCalls++; },
    (r: typeof raw) => { r.baselineComparison.warmReusedEmbeddings--; },
    (r: typeof raw) => { r.scenarios[0]!.milestones.firstApprovedAnswerMs = null; },
  ]) {
    const changed = structuredClone(raw);
    mutate(changed);
    const result = harness.buildSanitizedAcceptanceReceipt(changed);
    assert.equal(result.verdict.status, "failed");
    assert.ok(result.verdict.failures.length);
  }
  assert.throws(() => harness.buildSanitizedAcceptanceReceipt({ ...raw, model: harness.REQ002_SYNTHETIC_CANARY.name }),
    error => error instanceof Error && !harness.findCanaryLeaks(error.message).length);
});

test("an upstream rejection counts once, and exceeding the ceiling stops all further dispatch", async () => {
  let attempts = 0, embeddings = 0;
  const guard = harness.createProviderBoundaryGuard({ caps: { maxModelCalls: 1 },
    provider: { generate: async () => { attempts++; throw new Error("fixture failure"); } },
    embedding: { embed: async () => { embeddings++; return { values: [1], inputTokens: 1, billableCharacters: 1 }; } },
  });
  const req = { contents: [], config: {}, toolsDict: {}, liveConnectConfig: {} }, signal = new AbortController().signal;
  await assert.rejects(guard.provider.generate(req, signal), /fixture failure/u);
  await assert.rejects(guard.provider.generate(req, signal), harness.BudgetCapExceededError);
  await assert.rejects(guard.embedding!.embed({ task: "RETRIEVAL_QUERY", text: "public" }, signal), harness.BudgetCapExceededError);
  assert.equal(guard.snapshot().capBlocked, true);
  assert.equal(attempts, 1);
  assert.equal(embeddings, 0);
});

test("a model-only selection fails before constructing either adapter, without falling back to ADC", async () => {
  const { readLocalAgentModel } = await import("../server/local-agent-model.ts");
  let selectedBuilt = 0, adcBuilt = 0;
  const configuredKey = () => { selectedBuilt++; return "key pair"; };
  const adc = () => { adcBuilt++; return "adc pair"; };
  for (const provider of ["vertex", "openai-compatible"] as const) {
    // readLocalAgentModel reports false without a separate embedding key for these two providers,
    // even though providers() can construct a callable (but unusable) embedding adapter.
    // All values are literals; this offline test never reads credentials or instantiates SDK clients.
    const selected = readLocalAgentModel({ NODE_ENV: "development", YUYF_LOCAL_DEVELOPMENT: "1", AI_ENABLED: "true",
      GCP_PROJECT_ID: "synthetic-req002-test", LOCAL_MODEL_PROVIDER: provider, LOCAL_MODEL_API_KEY: "not-a-credential",
      ...(provider === "openai-compatible" ? { LOCAL_MODEL_BASE_URL: "https://fixture.example.test/v1", GEMINI_MODEL: "fixture" } : {}),
    });
    assert.equal(typeof selected.providers, "function");
    assert.equal(selected.embeddingConfigured, false);
    const missing = { ...selected, providers: configuredKey };
    assert.throws(() => harness.selectReq002LocalAdapters(missing, {}, adc), /query embedding is not configured/u);
    assert.throws(() => harness.selectReq002LocalAdapters({ ...missing, providers: undefined, embeddingConfigured: true }, {}, adc),
      /no provider factory/u);
  }
  assert.equal(selectedBuilt, 0);
  assert.equal(adcBuilt, 0);
  assert.equal(harness.selectReq002LocalAdapters({ provider: "gemini", embeddingConfigured: true, providers: configuredKey }, {}, adc), "key pair");
  assert.equal(harness.selectReq002LocalAdapters({ provider: "vertex-adc", embeddingConfigured: true }, {}, adc), "adc pair");
  assert.equal(selectedBuilt, 1);
  assert.equal(adcBuilt, 1);
});

test("candidate provenance is the clean tracked checkout containing the entrypoint, not the caller cwd", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "req002-origin-")));
  const git = (...args: string[]) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgSign=false", ...args], {
    cwd: dir, encoding: "utf8", env: { PATH: process.env.PATH, HOME: dir, GIT_CONFIG_NOSYSTEM: "1" },
  }).trim();
  try {
    git("init", "--quiet");
    mkdirSync(join(dir, "scripts"));
    const file = join(dir, "scripts", "verify-req002-live.mjs");
    writeFileSync(file, "// fixture\n");
    git("add", "--", "scripts");
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "--quiet", "-m", "fixture");
    const entry = pathToFileURL(file);
    assert.equal(harness.resolveReq002CandidateSha(entry), git("rev-parse", "HEAD"));
    writeFileSync(file, "// dirty fixture\n");
    assert.throws(() => harness.resolveReq002CandidateSha(entry), /clean tracked checkout/u);
    git("add", "--", "scripts");
    assert.throws(() => harness.resolveReq002CandidateSha(entry), /clean tracked checkout/u);
    mkdirSync(join(dir, "nested/scripts"), { recursive: true });
    assert.throws(() => harness.resolveReq002CandidateSha(pathToFileURL(join(dir, "nested/scripts/entry.mjs"))), /checkout root/u);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
