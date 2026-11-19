import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { LlmRequest, LlmResponse } from "@google/adk";
import { ApiError, FinishReason } from "@google/genai";
import { z } from "zod";
import { AgentBudget, AgentStopped } from "../server/agent-budget.ts";
import { AgentGatewayModel, type AgentModelProvider } from "../server/agent-model-gateway.ts";
import { createAgentRuntime, type AgentScope, type AgentTool } from "../server/agent-runtime.ts";
import {
  createAgentRunTraceCollector,
  formatOtelMetadataSpan,
  sanitizeAgentTraceEvent,
  type AgentTraceEvent,
} from "../server/agent-trace.ts";
import { readAiConfig } from "../server/ai-config.ts";
import { chatDeliveryDraftHash, enforceChatDeliveryReview, type ChatDeliveryDraft } from "../server/chat-delivery-review.ts";
import { composeFamilyDocumentDraft, enforceDataComposeReview } from "../server/data-compose.ts";
import { prepareKnowledgeMaintenance } from "../server/background-knowledge-model.ts";
import { observationHash } from "../server/knowledge-observation.ts";
import { SOURCE_WATCHES } from "../server/knowledge-source-catalog.ts";
import { createProductAgent } from "../server/product-agent.ts";
import { productAgentResultSchema } from "../src/shared/product-agent-result.ts";
import { dataComposeDraftSchema } from "../src/shared/data-compose.ts";
import type { DocumentSnapshot } from "../src/shared/family-documents.ts";
import type { KnowledgeEvidence } from "../src/shared/knowledge.ts";
import { createGeminiKeyProviders } from "../server/gemini-key-provider.ts";
import { nativeResponseSchema as pdfNativeResponseSchema } from "../server/knowledge-pdf-output.ts";
import { createCompatibleProviders } from "../server/openai-compatible-provider.ts";
import { nativeResponseSchema } from "../server/structured-output-schema.ts";

const CANARY = "秘密 CANARY 陳大文 沙田第一城 2026-05-18";
const SCOPE: AgentScope = {
  userId: "synthetic-trace-user", childId: "child-trace", workspaceId: "workspace-trace",
  authorizationVersion: "1", dataVersion: "epoch:1",
};
const config = readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project" });
const usage = { reserve: async () => true, record: async () => {} };

const textReply = (text: string): LlmResponse => ({
  content: { role: "model", parts: [{ text }] }, finishReason: FinishReason.STOP,
});
const callReply = (name: string, args: Record<string, unknown>, id = "call-" + name): LlmResponse => ({
  content: { role: "model", parts: [{ functionCall: { id, name, args }, thoughtSignature: "opaque-native-signature" }] },
  finishReason: FinishReason.STOP,
});

function collector() {
  const events: AgentTraceEvent[] = [];
  return { events, sink: (event: AgentTraceEvent) => { events.push(event); } };
}

function gatewayFixture(provider: AgentModelProvider, sink: (event: AgentTraceEvent) => void, extra: { retries?: number } = {}) {
  const budget = new AgentBudget();
  let attempt = 0;
  const model = new AgentGatewayModel({
    config: extra.retries ? { ...config, agentMaxRetries: extra.retries } : config,
    provider, usage, budget, userId: SCOPE.userId, childId: SCOPE.childId, authorize: async () => true,
    runId: "gateway-run", recipeId: "synthetic-recipe", role: "main_chat", onTrace: sink,
    nextAttemptIndex: () => ++attempt,
  });
  return { model, budget };
}

const terminal: AgentTool = { name: "present_answer", terminal: true, description: "Submit the synthetic answer.",
  parameters: z.object({ text: z.string() }), authorize: async () => true,
  execute: async () => ({ status: "succeeded", data: { acceptedForValidation: true } }) };

function runInput(tools: AgentTool[], extra: Record<string, unknown> = {}) {
  return { scope: SCOPE, recipeId: "p1-chat", trigger: { kind: "interactive" as const, reference: randomUUID() },
    messages: [{ role: "user" as const, text: "Synthetic request " + CANARY }], tools, authorize: async () => true,
    finalize: async () => "Server validated presentation", ...extra };
}

test("sanitizer rebuilds every trace event from an allowlist and drops hostile free text", () => {
  const hostile = {
    runId: CANARY, role: CANARY, phase: CANARY, recipeId: CANARY, elapsedMs: -5, tool: CANARY, code: CANARY, stopReason: CANARY,
    attemptKeyHash: CANARY, callIdHash: CANARY, outcome: CANARY, schemaMode: CANARY, terminalCategory: CANARY,
    prompt: CANARY, message: CANARY, args: { secret: CANARY }, error: new Error(CANARY),
    tokens: { inputTokens: 5, outputTokens: CANARY, cachedTokens: -1 },
    counts: { modelCalls: 1, toolCalls: CANARY, queryEmbeddings: 2 },
    contextAssembly: { packVersion: CANARY, recipeId: "ok", categories: [{ category: CANARY, included: true, reasonCode: "included" }] },
  } as unknown as AgentTraceEvent;
  const clean = sanitizeAgentTraceEvent(hostile);
  assert.doesNotMatch(JSON.stringify(clean), /CANARY|陳大文|沙田/u);
  assert.equal(Object.hasOwn(clean, "prompt"), false);
  assert.equal(clean.role, "main_chat");
  assert.equal(clean.elapsedMs, 0);
  assert.deepEqual(clean.tokens, { inputTokens: 5, outputTokens: null, cachedTokens: null });
  assert.equal(clean.counts?.toolCalls, 0);
  assert.equal(clean.contextAssembly, undefined);
  const span = formatOtelMetadataSpan(hostile);
  assert.doesNotMatch(JSON.stringify(span), /CANARY|陳大文|沙田/u);
  assert.ok(Object.keys(span.attributes).every(key => key.startsWith("yuban.") || key.startsWith("gen_ai.usage.")));
});

test("trace milestones stay ordered and terminal categories separate partial, failed, cancelled and unknown", () => {
  let clock = 0;
  const { events, sink } = collector();
  const trace = createAgentRunTraceCollector({ runId: "run-1", role: "main_chat", sinks: [sink], now: () => clock });
  clock = 10; trace.emit({ role: "main_chat", phase: "model_attempt_start" });
  clock = 25; trace.handle.markUsableSource(2);
  clock = 40; trace.handle.markApprovedAnswer();
  clock = 55;
  const end = trace.finalize({ status: "completed", counts: { modelCalls: 2, toolCalls: 1, queryEmbeddings: 1 } });
  const m = end.milestones!;
  assert.deepEqual([m.firstMeaningfulProgressMs, m.firstUsableSourceMs, m.firstApprovedAnswerMs, m.terminalSettledMs], [10, 25, 40, 55]);
  assert.equal(end.terminalCategory, "completed");
  assert.deepEqual(events.map(e => e.phase), ["model_attempt_start", "source_usable", "answer_approved", "run_end"]);
  const categories = ([
    [{ stopReason: "cancelled" }, "cancelled"], [{ stopReason: "tool_unknown" }, "unknown"],
    [{ stopReason: "model_limit", hasUsablePartial: true }, "partial"], [{ stopReason: "unavailable" }, "failed"],
  ] as const).map(([input]) => createAgentRunTraceCollector({ runId: "run-2", role: "main_chat" })
    .finalize({ status: "stopped", ...input, counts: { modelCalls: 0, toolCalls: 0, queryEmbeddings: 0 } }).terminalCategory);
  assert.deepEqual(categories, ["cancelled", "unknown", "partial", "failed"]);
});

test("one schema projection serves all roles and providers declare native or degraded structured output", () => {
  const schema = z.object({ a: z.string().min(1).max(5), n: z.number().min(0).max(9) }).strict();
  const projected = nativeResponseSchema(schema);
  assert.doesNotMatch(JSON.stringify(projected), /minLength|maxLength|minimum|maximum/u);
  assert.deepEqual(projected.required, ["a", "n"]);
  assert.equal(pdfNativeResponseSchema, nativeResponseSchema);
  assert.equal(createGeminiKeyProviders({ ...config, model: "gemini-2.5-flash" }, "synthetic-key").agent.structuredOutput, "native_json_schema");
  assert.equal(createCompatibleProviders({ ...config, model: "vendor/Custom-Chat" }, "synthetic-key", "https://models.example.test/v1").agent.structuredOutput,
    "prompt_strict_json");
});

test("native providers receive the JSON schema and trace it; the attempt is counted once", async () => {
  const requests: LlmRequest[] = [];
  const { events, sink } = collector();
  const provider: AgentModelProvider = { structuredOutput: "native_json_schema",
    generate: async request => { requests.push(request); return textReply('{"ok":true}'); } };
  const { model, budget } = gatewayFixture(provider, sink);
  try {
    const responseJsonSchema = nativeResponseSchema(z.object({ ok: z.boolean() }));
    const text = await model.completeText({ system: "role instruction", user: CANARY, attemptKey: "model:native", responseJsonSchema, purpose: "delivery_review" });
    assert.equal(text, '{"ok":true}');
    assert.equal(requests[0]!.config?.responseMimeType, "application/json");
    assert.deepEqual(requests[0]!.config?.responseJsonSchema, responseJsonSchema);
    assert.equal(budget.counts.modelCalls, 1);
    assert.deepEqual(events.map(e => e.phase), ["model_attempt_start", "model_attempt_end"]);
    assert.ok(events.every(e => e.role === "delivery_review" && e.schemaMode === "native_json_schema" && e.attemptIndex === 1));
    assert.equal(events[1]!.outcome, "succeeded");
    assert.doesNotMatch(JSON.stringify(events), /CANARY|陳大文|role instruction/u);
  } finally { budget.close(); }
});

test("a provider without native schema degrades explicitly, keeps strict instructions and still counts one call", async () => {
  const requests: LlmRequest[] = [];
  const { events, sink } = collector();
  const provider: AgentModelProvider = { structuredOutput: "prompt_strict_json",
    generate: async request => { requests.push(request); return textReply('{"ok":true}'); } };
  const { model, budget } = gatewayFixture(provider, sink);
  try {
    await model.completeText({ system: "role instruction", user: "payload", attemptKey: "model:degraded",
      responseJsonSchema: nativeResponseSchema(z.object({ ok: z.boolean() })), purpose: "compose_review" });
    assert.equal(Object.hasOwn(requests[0]!.config ?? {}, "responseJsonSchema"), false);
    assert.equal(Object.hasOwn(requests[0]!.config ?? {}, "responseMimeType"), false);
    assert.match(String(requests[0]!.config?.systemInstruction), /Native provider JSON schema constraint is unavailable/u);
    assert.equal(budget.counts.modelCalls, 1);
    assert.ok(events.every(e => e.role === "compose_review" && e.schemaMode === "degraded_prompt_strict_json"
      && e.schemaDegradationReason === "provider_native_schema_unsupported"));
    // Calls without a schema stay marked unstructured, never as a silent downgrade.
    const plain = gatewayFixture(provider, sink);
    try {
      await plain.model.completeText({ system: "s", user: "u", attemptKey: "model:plain" });
      assert.equal(events.at(-1)!.schemaMode, "unstructured");
    } finally { plain.budget.close(); }
  } finally { budget.close(); }
});

test("review and repair request the schema, yet valid JSON with a wrong hash or missing sources is still rejected", async () => {
  const draft = (): ChatDeliveryDraft => ({ kind: "operation", visibility: "private", serverSubstitutedSourceText: false, scope: SCOPE,
    paragraphs: [{ text: "BB未滿一歲唔好食蜜糖。", citationIds: [] }], sources: [], images: [] });
  const current = draft();
  const tools = { deliveryDraft: () => current, presentation: async () => ({ text: current.paragraphs[0]!.text, citations: [], retrievalMode: "not_used" as const }),
    replaceDeliveryAnswer: () => {} };
  for (const mode of ["wrong_hash", "pass_without_sources"] as const) {
    const budget = new AgentBudget();
    const seen: { purpose?: string; role?: string; schema: boolean }[] = [];
    try {
      await assert.rejects(enforceChatDeliveryReview({ presentation: await tools.presentation(), tools,
        provenance: { packVersion: "synthetic-pack", model: "synthetic-model" },
        context: { scope: SCOPE, runId: randomUUID(), budget, completeText: async (input: any) => {
          seen.push({ purpose: input.purpose, role: input.role, schema: Boolean(input.responseJsonSchema) });
          const payload = JSON.parse(input.user.slice(input.user.indexOf("{")));
          return JSON.stringify({ draftHash: mode === "wrong_hash" ? "0".repeat(64) : payload.draftHash, decision: "pass", issues: [] });
        } } as never }),
        (error: unknown) => error instanceof AgentStopped
          && error.reason === (mode === "wrong_hash" ? "delivery_review_incomplete" : "delivery_review_no_sources"));
      assert.deepEqual(seen, [{ purpose: "delivery_review", role: "delivery_review", schema: true }], mode);
      assert.equal(chatDeliveryDraftHash(current).length, 64);
    } finally { budget.close(); }
  }
});

test("a real run emits metadata-only phases for every stage and the attempt count equals the root budget", async () => {
  const { events, sink } = collector();
  const probe: AgentTool = { name: "read_probe", effect: "read", description: "Read one synthetic record.",
    parameters: z.object({ id: z.string() }).strict(), authorize: async () => true,
    execute: async () => ({ status: "succeeded", reference: "ref-1", data: { echo: CANARY } }) };
  let turn = 0;
  const runtime = createAgentRuntime({ config, usage, provider: { structuredOutput: "native_json_schema", generate: async () =>
    turn++ === 0 ? callReply("read_probe", { id: CANARY }) : callReply("present_answer", { text: CANARY }) } });
  const result = await runtime.run(runInput([probe, terminal], { onTrace: sink,
    contextAssembly: { categories: [{ category: "profile", included: true, reasonCode: "included", versionRefs: [{ kind: "profile", version: "3" }] },
      { category: "conversation_summary", included: false, reasonCode: "omitted_capacity" }] } }));
  assert.equal(result.status, "completed", JSON.stringify(result));
  const phases = events.map(e => e.phase);
  for (const phase of ["run_start", "context_assembled", "model_attempt_start", "model_attempt_end", "tool_start", "tool_end", "run_end"])
    assert.ok(phases.includes(phase as never), phase);
  assert.equal(events.filter(e => e.phase === "model_attempt_start").length, result.counts.modelCalls);
  assert.deepEqual(events.filter(e => e.phase === "model_attempt_start").map(e => e.attemptIndex), [1, 2]);
  const context = events.find(e => e.phase === "context_assembled")!.contextAssembly!;
  assert.equal(context.packVersion, result.provenance!.packVersion);
  assert.equal(context.recipeId, result.provenance!.recipeId);
  assert.deepEqual(context.categories.map(c => `${c.category}:${c.reasonCode}`).sort(), ["conversation_summary:omitted_capacity", "profile:included"]);
  assert.equal(events.find(e => e.phase === "tool_start")!.tool, "read_probe");
  const end = events.at(-1)!;
  assert.equal(end.phase, "run_end");
  assert.equal(end.terminalCategory, "completed");
  assert.ok(end.milestones!.firstMeaningfulProgressMs !== null && end.milestones!.terminalSettledMs !== null);
  assert.deepEqual(end.counts, result.counts);
  assert.ok(events.every(e => e.runId === result.runId));
  assert.doesNotMatch(JSON.stringify(events), /CANARY|陳大文|沙田|2026-05-18|Synthetic request/u);
  assert.doesNotMatch(JSON.stringify(events.map(formatOtelMetadataSpan)), /CANARY|陳大文|沙田|2026-05-18/u);
});

test("provider failure, transient retry and cancellation keep the original run linked without leaking messages", async () => {
  const failed = collector();
  const failing = createAgentRuntime({ config, usage, provider: { generate: async () => { throw new Error(CANARY); } } });
  const failure = await failing.run(runInput([terminal], { onTrace: failed.sink }));
  assert.equal(failure.stopReason, "unavailable");
  const error = failed.events.find(e => e.phase === "model_attempt_error")!;
  assert.equal(error.outcome, "unavailable");
  assert.equal(failed.events.at(-1)!.terminalCategory, "failed");
  assert.doesNotMatch(JSON.stringify(failed.events), /CANARY|陳大文|沙田/u);

  const retried = collector();
  let tries = 0;
  const retrying = createAgentRuntime({ config: { ...config, agentMaxRetries: 1 }, usage, provider: { generate: async () => {
    if (tries++ === 0) throw new ApiError({ status: 503, message: CANARY });
    return callReply("present_answer", { text: "ok" });
  } } });
  const retry = await retrying.run(runInput([terminal], { onTrace: retried.sink }));
  assert.equal(retry.status, "completed", JSON.stringify(retry));
  const attempts = retried.events.filter(e => e.phase === "model_attempt_start");
  assert.deepEqual(attempts.map(e => e.retryIndex), [0, 1]);
  assert.ok(retried.events.some(e => e.phase === "model_attempt_retry" && e.outcome === "unavailable"));
  assert.equal(new Set(attempts.map(e => e.attemptIndex)).size, 1, "a retry stays the same logical attempt");
  assert.doesNotMatch(JSON.stringify(retried.events), /CANARY|陳大文|沙田/u);

  const cancelled = collector(), controller = new AbortController();
  const cancelling = createAgentRuntime({ config, usage, provider: { generate: async () => { controller.abort(); return new Promise<LlmResponse>(() => {}); } } });
  const stop = await cancelling.run(runInput([terminal], { onTrace: cancelled.sink, signal: controller.signal }));
  assert.equal(stop.stopReason, "cancelled");
  assert.equal(cancelled.events.at(-1)!.terminalCategory, "cancelled");
});

test("direct completeText roles join the same run trace once each, with native and degraded schema modes", async () => {
  for (const structuredOutput of ["native_json_schema", "prompt_strict_json"] as const) {
    const { events, sink } = collector();
    const requests: LlmRequest[] = [];
    const runtime = createAgentRuntime({ config, usage, provider: { structuredOutput, generate: async request => {
      requests.push(request);
      return request.config?.tools?.length ? callReply("present_answer", { text: "draft" }) : textReply('{"ok":true}');
    } } });
    const result = await runtime.run(runInput([terminal], { onTrace: sink, finalize: async (_result: unknown, context: any) =>
      context.completeText({ system: "review", user: CANARY, attemptKey: "model:direct-review", purpose: "delivery_review", role: "delivery_review",
        responseJsonSchema: nativeResponseSchema(z.object({ ok: z.boolean() })) }) }));
    assert.equal(result.status, "completed", JSON.stringify(result));
    const starts = events.filter(e => e.phase === "model_attempt_start");
    assert.equal(starts.length, result.counts.modelCalls);
    assert.deepEqual(starts.map(e => e.role), ["main_chat", "delivery_review"]);
    assert.equal(starts[1]!.schemaMode, structuredOutput === "native_json_schema" ? "native_json_schema" : "degraded_prompt_strict_json");
    assert.equal(Object.hasOwn(requests.at(-1)!.config ?? {}, "responseJsonSchema"), structuredOutput === "native_json_schema");
    assert.ok(events.every(e => e.runId === result.runId));
    assert.doesNotMatch(JSON.stringify(events), /CANARY|陳大文|沙田/u);
  }
});

test("data_compose, compose_review, knowledge_organize and knowledge_review pass native schemas and explicit trace roles", async () => {
  const seenCompose: { purpose?: string; role?: string; hasSchema: boolean }[] = [];
  const docId = "33333333-3333-4333-8333-333333333333";
  const snapshot: DocumentSnapshot = {
    id: docId, version: 3, generatedAt: "2026-10-14T00:00:00.000Z", sourceBasis: "synthetic", title: "到診準備",
    summary: "合成摘要", ageLabel: "2歲", period: { from: "2026-10-01", to: "2026-10-14" }, eventDate: "2026-10-20", coverageNote: "",
    sections: [{ id: "checklist", title: "清單", kind: "checklist", domain: null, items: [{ id: "bottle", text: "帶水壺", sourceIds: [], checked: false }] }],
    sources: [], changes: [],
  };
  const draft = dataComposeDraftSchema.parse({
    documentId: docId, expectedVersion: 3, authorityVersion: "epoch:1",
    edits: [{ op: "upsert_item", sectionId: "checklist", itemId: "bottle", text: "帶溫水壺" }],
    gaps: [], requiredConfirmations: ["parent_shared_document"],
  });
  const composeBudget = new AgentBudget();
  try {
    const context = {
      scope: SCOPE, runId: randomUUID(), budget: composeBudget,
      completeText: async (input: any) => {
        seenCompose.push({ purpose: input.purpose, role: input.role, hasSchema: Boolean(input.responseJsonSchema) });
        const body = JSON.parse(input.user.slice(input.user.indexOf("{")));
        if (input.purpose === "compose") return JSON.stringify(draft);
        return JSON.stringify({ draftHash: body.draftHash, decision: "pass", issues: [] });
      },
    } as never;
    const built = await composeFamilyDocumentDraft({
      intent: { documentId: docId, expectedVersion: 3, authorityVersion: "epoch:1", intent: "帶溫水壺", sourceQuote: "帶溫水壺" },
      snapshot, context,
    });
    assert.equal(built.documentId, docId);
    await enforceDataComposeReview({
      draft, snapshot, trustedIntent: "帶溫水壺", context, provenance: { packVersion: "synthetic-pack", model: "synthetic-model" },
    });
    assert.deepEqual(seenCompose, [
      { purpose: "compose", role: "data_compose", hasSchema: true },
      { purpose: "compose_review", role: "compose_review", hasSchema: true },
    ]);
  } finally { composeBudget.close(); }

  const definition = SOURCE_WATCHES.find(item => item.id === "fhs-solid-food")!;
  const observed = { url: definition.url, title: "Fixture", text: "請攜帶健康記錄。",
    sourcePublishedAt: null, sourceUpdatedAt: null, sourceDateText: null };
  const candidate = { watchId: "fhs-solid-food" as const, definition, observed, observationHash: observationHash(observed), previousObservationHash: null };
  const seenKnowledge: { role?: string; purpose?: string; hasSchema: boolean }[] = [];
  const prepared = await prepareKnowledgeMaintenance({
    candidate, baseline: null, growthRules: [], fetchedAt: "2026-10-20T00:00:00.000Z",
    completeText: async input => {
      seenKnowledge.push({ role: input.role, purpose: input.purpose, hasSchema: Boolean(input.responseJsonSchema) });
      const payload = JSON.parse(input.user);
      if (payload.role === "background-knowledge-maintenance") {
        return JSON.stringify({ units: payload.originalUnits.map((unit: { id: string }) => ({
          unitId: unit.id, section: "準備事項", text: "攜帶健康記錄。", keywords: ["健康記錄"],
          applicability: { region: "HK", ageBasis: "any", minAgeMonths: null, maxAgeMonths: null, topics: ["preparation"], conditions: [] },
        })) });
      }
      return JSON.stringify({
        changes: payload.comparisonUnits.map((unit: { key: string }) => ({ key: unit.key, meaning: "new", explanation: "Supported." })),
        checks: { age: "None", numbersAndUnits: "None", timing: "None", conditions: "Preserved", exceptions: "None", prohibitions: "None", withdrawal: "None" },
        questions: [{ query: "要準備甚麼？", expectedKeys: payload.candidate.chunks.map((c: { key: string }) => c.key), reason: "Supported" }],
        decisionReason: "Supported.", decision: "approve",
      });
    },
  });
  assert.equal(prepared.review.decision, "approve_candidate");
  assert.deepEqual(seenKnowledge, [
    { role: "knowledge_organize", purpose: undefined, hasSchema: true },
    { role: "knowledge_review", purpose: "knowledge_review", hasSchema: true },
  ]);
});

test("ProductAgent records short-path summary skip, loader calls, milestones and review schema without leaking canary text", async () => {
  const userId = "synthetic-user", childId = "11111111-1111-4111-8111-111111111111";
  const chunkId = "44444444-4444-4444-8444-444444444444";
  const chunk: KnowledgeEvidence = {
    chunkId, classification: "official_guidance", text: "六個月大可按發展徵象嘗試固體食物。", key: "solid-start",
    section: "Start", sourceExcerpt: "六個月大可按發展徵象嘗試固體食物。", keywords: ["solid"],
    applicability: { region: "HK", ageBasis: "any", minAgeMonths: null, maxAgeMonths: null, topics: ["feeding"], conditions: [] },
    sourceId: "fhs-solid-food", versionId: "55555555-5555-4555-8555-555555555555",
    versionHash: "a".repeat(64), contentHash: "b".repeat(64),
    url: "https://www.fhs.gov.hk/solid", title: "Solid food", publisher: "FHS",
    sourcePublishedAt: null, sourceUpdatedAt: null, fetchedAt: new Date().toISOString(), checkedAt: new Date().toISOString(), reviewState: "reviewed",
  };
  const runCase = async (userText: string, mode: "greeting" | "knowledge") => {
    const { events, sink } = collector();
    const runId = randomUUID(), ref = randomUUID();
    let saved: any = null, calls = 0;
    const runtime = createAgentRuntime({
      config, usage, onTrace: sink,
      provider: { structuredOutput: "native_json_schema", generate: async request => {
        const text = request.contents.flatMap(c => c.parts ?? []).map(p => p.text ?? "").join("\n");
        if (text.includes("chat-delivery-review")) {
          const body = JSON.parse(text.slice(text.indexOf("{")));
          return textReply(JSON.stringify({ draftHash: body.draftHash, decision: "pass", issues: [] }));
        }
        const step = calls++;
        if (mode === "greeting") return callReply("present_answer", { kind: "clarification", paragraphs: [{ text: "早晨，有咩可以幫到你？", citationIds: [] }] });
        if (step === 0) return callReply("search_knowledge", { query: "加固", classification: "official_guidance" });
        return callReply("present_answer", { kind: "caregiving", paragraphs: [{ text: "六個月大可按發展徵象嘗試固體食物。", citationIds: [chunkId] }] });
      } },
    });
    const service = createProductAgent({
      runtime, onTrace: sink,
      store: {
        claim: async () => ({ runId, scope: { userId, childId, workspaceId: "ws", authorizationVersion: "1", dataVersion: "epoch:1" }, created: true, expiresAt: new Date(Date.now() + 90_000).toISOString() }),
        authorize: async () => true,
        finish: async (_s: unknown, result: unknown) => { saved = productAgentResultSchema.parse(JSON.parse(JSON.stringify(result))); return true; },
        get: async () => saved,
      } as never,
      memory: { context: async () => ({ profile: { childId, version: 0, data: null }, profileApplicable: false, facts: [], topics: [], summary: null, recentMessages: [], conflictingKeys: [], unavailableFactKeys: [], truncated: { facts: false, topics: false, messages: false } }) } as never,
      chat: { listForUser: async () => ({ messages: [{ id: ref, role: "user", text: userText }] }) } as never,
      tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) } as never,
      knowledge: { createRun: () => ({ search: async () => ({ mode: "vector_keyword", chunks: [chunk] }), revalidateCitations: async () => true }) } as never,
    });
    const out = await service.reply(userId, childId, ref, async () => true);
    assert.equal(out?.status, "completed");
    return { events, out };
  };

  const greeting = await runCase("hi", "greeting");
  const gEnd = greeting.events.at(-1)!;
  assert.equal(gEnd.contextAssembly?.categories.find(c => c.category === "conversation_summary")?.reasonCode, "skipped_short_path");
  assert.equal(gEnd.counts?.modelCalls, 1);

  const knowledge = await runCase(CANARY + "幾時可以食固體食物？", "knowledge");
  const kEnd = knowledge.events.at(-1)!;
  assert.equal(kEnd.contextAssembly?.loaderCalls.knowledgeSearches, 1);
  assert.deepEqual(knowledge.events.filter(e => e.phase === "model_attempt_start").map(e => e.role), ["main_chat", "main_chat", "delivery_review"]);
  assert.ok(knowledge.events.some(e => e.phase === "source_usable" && e.sourceCount === 1));
  assert.ok(knowledge.events.some(e => e.phase === "answer_approved"));
  const m = kEnd.milestones!;
  assert.ok(m.firstMeaningfulProgressMs !== null && m.firstUsableSourceMs !== null && m.firstApprovedAnswerMs !== null && m.terminalSettledMs !== null);
  assert.ok(m.firstMeaningfulProgressMs <= m.firstUsableSourceMs && m.firstUsableSourceMs <= m.firstApprovedAnswerMs && m.firstApprovedAnswerMs <= m.terminalSettledMs);
  assert.doesNotMatch(JSON.stringify(knowledge.events), /CANARY|陳大文|沙田/u);
});
