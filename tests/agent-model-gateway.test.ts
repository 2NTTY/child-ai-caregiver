import assert from "node:assert/strict";
import test, { mock } from "node:test";
import * as genai from "@google/genai";
import type { LlmRequest } from "@google/adk";
import { AGENT_RUN_LIMITS } from "../src/shared/agent-run-limits.ts";
import { readAiConfig } from "../server/ai-config.ts";
import type { AiConfig } from "../server/ai-config.ts";
import { AGENT_LIMITS, AgentBudget, agentBudgetFingerprint } from "../server/agent-budget.ts";
import { RootBudgetError, type DurableRootBudget, type RootBudgetContext, type RootBudgetSnapshot } from "../server/durable-root-budget.ts";
import type { DurableAiUsageReceipt, DurableAiUsageRequest } from "../server/durable-ai-usage.ts";

const clients: ConstructorParameters<typeof genai.GoogleGenAI>[0][] = [];
const requests: genai.GenerateContentParameters[] = [];
let respond: (request: genai.GenerateContentParameters) => Promise<genai.GenerateContentResponse>;
class StubGoogleGenAI {
  constructor(options: ConstructorParameters<typeof genai.GoogleGenAI>[0]) { clients.push(options); }
  models = { generateContent: async (request: genai.GenerateContentParameters) => {
    requests.push(request);
    return respond(request);
  } };
}
mock.module("@google/genai", { namedExports: { ...genai, GoogleGenAI: StubGoogleGenAI } });
mock.method(globalThis, "fetch", async () => { throw new Error("Network requests are forbidden in this offline suite"); });
const { createVertexAgentProvider, AgentGatewayModel } = await import("../server/agent-model-gateway.ts");

function setup() {
  clients.length = 0;
  requests.length = 0;
  respond = async () => Object.assign(new genai.GenerateContentResponse(), {
    candidates: [{ content: { role: "model", parts: [{ text: "Synthetic answer" }] }, finishReason: genai.FinishReason.STOP }],
  });
  const config = readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project" });
  const request: LlmRequest = { contents: [{ role: "user", parts: [{ text: "Synthetic input" }] }],
    liveConnectConfig: {}, toolsDict: {} };
  return { config, request, controller: new AbortController() };
}

test("legacy typed config without a thinking level retains the exact bounded native default", async () => {
  const { config, request, controller } = setup();
  delete config.agentThinkingLevel;
  await createVertexAgentProvider(config).generate(request, controller.signal);
  assert.deepEqual(clients, [{ enterprise: true, project: config.project, location: config.location, apiVersion: "v1",
    httpOptions: { timeout: config.timeoutMs, retryOptions: { attempts: 1 } } }]);
  assert.deepEqual(requests, [{ model: config.model, contents: request.contents, config: {
    candidateCount: 1, maxOutputTokens: 1024, thinkingConfig: { thinkingLevel: genai.ThinkingLevel.MINIMAL },
    abortSignal: controller.signal,
  } }]);
});

test("each explicit server level maps to its installed native enum without changing other settings", async () => {
  const { config, request, controller } = setup();
  const levels = { minimal: genai.ThinkingLevel.MINIMAL, low: genai.ThinkingLevel.LOW,
    medium: genai.ThinkingLevel.MEDIUM, high: genai.ThinkingLevel.HIGH } as const;
  for (const [level, expected] of Object.entries(levels)) {
    const selected = readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: config.project, AI_AGENT_THINKING_LEVEL: level });
    await createVertexAgentProvider(selected).generate(request, controller.signal);
    assert.deepEqual(requests.at(-1)!.config!.thinkingConfig, { thinkingLevel: expected });
    assert.equal(requests.at(-1)!.config!.candidateCount, 1);
    assert.equal(requests.at(-1)!.config!.maxOutputTokens, AGENT_LIMITS.outputTokens);
    assert.equal(requests.at(-1)!.config!.abortSignal, controller.signal);
    assert.equal(requests.at(-1)!.model, config.model);
    assert.equal(clients.at(-1)!.httpOptions!.retryOptions!.attempts, 1);
  }
  assert.equal(requests.length, 4);
});

test("request config cannot override the server level, enable thoughts, raise output or replace abort", async () => {
  const { config, request, controller } = setup();
  config.agentThinkingLevel = "low";
  config.maxOutputTokens = 4096;
  request.config = { candidateCount: 9, maxOutputTokens: 9999, temperature: 0.25,
    thinkingConfig: { thinkingLevel: genai.ThinkingLevel.HIGH, thinkingBudget: 9999, includeThoughts: true },
    abortSignal: new AbortController().signal };
  const original = { ...request.config, thinkingConfig: { ...request.config.thinkingConfig } };
  const provider = createVertexAgentProvider(config);
  await provider.generate(request, controller.signal);
  assert.deepEqual(requests[0]!.config, { ...request.config, candidateCount: 1, maxOutputTokens: AGENT_LIMITS.outputTokens,
    thinkingConfig: { thinkingLevel: genai.ThinkingLevel.LOW }, abortSignal: controller.signal });
  assert.equal(Object.hasOwn(requests[0]!.config!.thinkingConfig!, "includeThoughts"), false);
  assert.deepEqual(request.config, original);
  config.maxOutputTokens = 512;
  await provider.generate(request, controller.signal);
  assert.equal(requests[1]!.config!.maxOutputTokens, 512);
});

test("provider rejects malformed typed server levels before constructing a native client", () => {
  const { config } = setup();
  for (const value of ["", " ", "HIGH", "auto", null, 1, {}, genai.ThinkingLevel.THINKING_LEVEL_UNSPECIFIED]) {
    assert.throws(() => createVertexAgentProvider({ ...config, agentThinkingLevel: value } as AiConfig), {
      message: "Invalid AI_AGENT_THINKING_LEVEL configuration",
    });
  }
  assert.equal(clients.length, 0);
  assert.equal(requests.length, 0);
});

test("native content, opaque signatures, usage and finish reasons preserve the existing projection", async () => {
  const { config, request, controller } = setup();
  const content = { role: "model", parts: [
    { text: "Synthetic hidden thought", thought: true, thoughtSignature: "opaque-thought-signature" },
    { functionCall: { name: "read_context", id: "synthetic-call", args: {} }, thoughtSignature: "opaque-tool-signature" },
    { text: "Synthetic answer", thoughtSignature: "opaque-text-signature" },
  ] };
  const usageMetadata = { promptTokenCount: 20, candidatesTokenCount: 3, thoughtsTokenCount: 7,
    totalTokenCount: 30, cachedContentTokenCount: 4 };
  const candidate = { content, finishReason: genai.FinishReason.MAX_TOKENS };
  respond = async () => Object.assign(new genai.GenerateContentResponse(), { candidates: [candidate], usageMetadata });
  const provider = createVertexAgentProvider(config);
  const result = await provider.generate(request, controller.signal);
  assert.equal(result.content, content);
  assert.equal(result.content!.parts, content.parts);
  assert.equal(result.finishReason, genai.FinishReason.MAX_TOKENS);
  assert.equal(result.usageMetadata, usageMetadata);
  respond = async () => Object.assign(new genai.GenerateContentResponse(), { candidates: [candidate, candidate], usageMetadata });
  const multiple = await provider.generate(request, controller.signal);
  assert.equal(multiple.content, undefined);
  assert.equal(multiple.finishReason, genai.FinishReason.MAX_TOKENS);
  assert.equal(multiple.usageMetadata, usageMetadata);
});

test("abort reaches the native request and failures are rethrown once without provider retries", async context => {
  const { config, request, controller } = setup();
  const warnings: unknown[][] = [];
  context.mock.method(console, "warn", (...args: unknown[]) => { warnings.push(args); });
  const failure = new Error("synthetic-private-error");
  respond = async parameters => new Promise((_, reject) => {
    assert.equal(parameters.config!.abortSignal, controller.signal);
    parameters.config!.abortSignal!.addEventListener("abort", () => reject(failure), { once: true });
  });
  const pending = createVertexAgentProvider(config).generate(request, controller.signal);
  controller.abort();
  await assert.rejects(pending, error => error === failure);
  assert.equal(requests.length, 1);
  assert.equal(clients[0]!.httpOptions!.retryOptions!.attempts, 1);
  assert.deepEqual(warnings, [[JSON.stringify({ event: "vertex_generate_failure", httpStatus: null, category: "aborted" })]]);
});

test("legacy typed 3.8 config defaults to LOW and valid explicit settings retain their native enum", async () => {
  const { config, request, controller } = setup();
  config.model = "gemini-3.8-flash";
  delete config.agentThinkingLevel;
  const levels = [[undefined, genai.ThinkingLevel.LOW], ["low", genai.ThinkingLevel.LOW],
    ["medium", genai.ThinkingLevel.MEDIUM], ["high", genai.ThinkingLevel.HIGH]] as const;
  for (const [level, expected] of levels) {
    await createVertexAgentProvider({ ...config, agentThinkingLevel: level }).generate(request, controller.signal);
    assert.deepEqual(requests.at(-1), { model: "gemini-3.8-flash", contents: request.contents, config: {
      candidateCount: 1, maxOutputTokens: 1024, thinkingConfig: { thinkingLevel: expected }, abortSignal: controller.signal,
    } });
  }
  assert.equal(clients.length, 4);
  assert.equal(requests.length, 4);
});

test("explicit MINIMAL on a typed 3.8 config fails before client construction or network activity", () => {
  const { config } = setup();
  assert.throws(() => createVertexAgentProvider({ ...config, model: "gemini-3.8-flash", agentThinkingLevel: "minimal" }), {
    message: "Invalid AI_AGENT_THINKING_LEVEL configuration",
  });
  assert.equal(clients.length, 0);
  assert.equal(requests.length, 0);
});

function gatewaySetup(options: { reserveDeliveryReview?: boolean; used?: number; purpose?: "delivery_review" | "delivery_repair" | "compose_review" } = {}) {
  const { config } = setup();
  const budget = new AgentBudget();
  if (options.used) budget.take("modelCalls", options.used);
  const events: string[] = [];
  const model = new AgentGatewayModel({ config, budget, userId: "synthetic-user", childId: "synthetic-child",
    reserveDeliveryReview: options.reserveDeliveryReview, authorize: async () => true,
    usage: { reserve: async () => { events.push("quota"); return true; }, record: async () => { events.push("record"); } },
    provider: { generate: async request => {
      events.push("provider");
      assert.deepEqual(request.toolsDict, {});
      assert.doesNotMatch(JSON.stringify(request), /onProviderStart|delivery_repair|delivery_review|compose_review/u);
      return { content: { role: "model", parts: [{ text: "Synthetic role result" }] }, finishReason: genai.FinishReason.STOP };
    } } });
  const input = { system: "Return synthetic text.", user: "Synthetic evidence", attemptKey: "model:synthetic-role",
    purpose: options.purpose, onProviderStart: () => { events.push("start"); } };
  return { budget, config, events, model, input };
}

test("generation and delivery repair cannot spend the protected final review attempt", async () => {
  for (const purpose of [undefined, "delivery_repair"] as const) {
    const s = gatewaySetup({ reserveDeliveryReview: true, used: 3, purpose });
    try {
      await assert.rejects(s.model.completeText(s.input), { reason: "model_limit" });
      assert.deepEqual(s.events, []);
      assert.equal(s.budget.counts.modelCalls, 3);
    } finally { s.budget.close(); }
  }
});

test("review may use the protected final attempt and its start observation cannot control execution", async () => {
  const s = gatewaySetup({ reserveDeliveryReview: true, used: 3, purpose: "delivery_review" });
  try {
    assert.equal(await s.model.completeText({ ...s.input, onProviderStart: () => {
      s.events.push("start"); throw new Error("Synthetic observer failure");
    } }), "Synthetic role result");
    assert.deepEqual(s.events, ["quota", "start", "provider", "record"]);
    assert.equal(s.budget.counts.modelCalls, 4);
    await assert.rejects(s.model.completeText({ ...s.input, attemptKey: "model:exhausted-review" }), { reason: "model_limit" });
    assert.deepEqual(s.events, ["quota", "start", "provider", "record"]);
  } finally { s.budget.close(); }
});

test("non-review paths retain their last generation attempt without a reserve", async () => {
  const s = gatewaySetup({ used: 3 });
  try {
    assert.equal(await s.model.completeText(s.input), "Synthetic role result");
    assert.equal(s.budget.counts.modelCalls, 4);
    assert.deepEqual(s.events, ["quota", "start", "provider", "record"]);
  } finally { s.budget.close(); }
});

test("provider start never fires for rejected quota, authorization, input or cancellation", async () => {
  for (const rejection of ["quota", "authorization", "input", "cancelled", "revoked-after-quota", "cancelled-after-quota"] as const) {
    const { config } = setup();
    const controller = new AbortController(), budget = new AgentBudget(controller.signal);
    let starts = 0, providers = 0, authorized = rejection !== "authorization";
    const model = new AgentGatewayModel({ config, budget, userId: "synthetic-user", childId: "synthetic-child",
      reserveDeliveryReview: true, authorize: async () => authorized,
      usage: { reserve: async () => {
        if (rejection === "revoked-after-quota") authorized = false;
        if (rejection === "cancelled-after-quota") controller.abort();
        return rejection !== "quota";
      }, record: async () => {} },
      provider: { generate: async () => { providers++; throw new Error("Provider must not start"); } } });
    if (rejection === "cancelled") controller.abort();
    try {
      await assert.rejects(model.completeText({ system: "Synthetic role", user: rejection === "input" ? "x".repeat(32001) : "Synthetic input",
        attemptKey: "model:rejected-role", purpose: "delivery_review", onProviderStart: () => { starts++; } }), {
        reason: rejection === "quota" ? "quota_exceeded" : rejection.includes("cancelled") ? "cancelled"
          : rejection === "input" ? "input_limit" : "unauthorized",
      });
      assert.equal(starts, 0, rejection);
      assert.equal(providers, 0, rejection);
    } finally { budget.close(); }
  }
});

function durableGatewayProbe(budget: AgentBudget) {
  const context: RootBudgetContext = { generation: 1, binding: { rootRunId: "synthetic-role-root", ownerId: "synthetic-user",
    workspaceId: "workspace", childId: "synthetic-child", authorizationVersion: "1", storageEpoch: "epoch",
    trigger: { kind: "interactive", reference: "message" }, workflowVersion: "workflow", promptPackVersion: "synthetic-pack",
    settingsVersion: "settings", billingVersion: "billing", limits: { modelCalls: 4, toolCalls: 16, queryEmbeddings: 2 }, deadlineAtMs: budget.deadlineAtMs } };
  const snapshot: RootBudgetSnapshot = { generation: 1, deadlineAtMs: budget.deadlineAtMs, limits: { ...context.binding.limits },
    used: { modelCalls: 0, toolCalls: 0, queryEmbeddings: 0 }, status: "active", attempts: [] };
  const adapter: DurableRootBudget = { open: async () => structuredClone(snapshot), read: async () => structuredClone(snapshot),
    reserve: async (_, attempt) => {
      const previous = snapshot.attempts.find(item => item.key === attempt.key);
      if (previous) return { decision: "lookup", attempt: previous, snapshot: structuredClone(snapshot) };
      if (snapshot.used.modelCalls >= 4) throw new RootBudgetError("budget_exhausted");
      snapshot.attempts.push({ ...attempt, outcome: { status: "reserved" } });
      snapshot.used.modelCalls++;
      return { decision: "execute", attempt: snapshot.attempts.at(-1)!, snapshot: structuredClone(snapshot) };
    }, settle: async () => { throw new Error("No settlement expected"); },
    stop: async () => { snapshot.status = "stopped"; return structuredClone(snapshot); } };
  return { context, snapshot, adapter };
}

test("each durable provider retry is charged but generation retries cannot steal the review reserve", async () => {
  const { config } = setup(), budget = new AgentBudget(), durable = durableGatewayProbe(budget);
  config.agentMaxRetries = AGENT_RUN_LIMITS.modelRetries.default;
  assert.equal(config.agentMaxRetries, 3, "Use the resolved routing policy, not the legacy zero-retry fallback");
  await budget.initializeDurable(durable);
  const starts: number[] = [], daily: DurableAiUsageRequest[] = [], recorded: string[] = [];
  const dailyReceipts = new Map<string, DurableAiUsageReceipt>();
  const reservationDay = "2026-10-29", reservedAtMs = Date.parse(`${reservationDay}T00:00:00Z`);
  let providers = 0;
  const model = new AgentGatewayModel({ config, budget, userId: "synthetic-user", childId: "synthetic-child",
    reserveDeliveryReview: true, authorize: async () => true,
    usage: { reserve: async () => { throw new Error("Legacy daily quota must not be used"); }, record: async () => { throw new Error("Legacy record must not be used"); } },
    durableDailyUsage: { context: durable.context, adapter: {
      billingSource: "platform",
      reserve: async request => {
        daily.push(request);
        const existing = dailyReceipts.get(request.attemptKey);
        if (existing) return { decision: "lookup", receipt: existing };
        const receipt: DurableAiUsageReceipt = { kind: request.kind ?? "model", day: reservationDay, reservedAtMs, record: null };
        dailyReceipts.set(request.attemptKey, receipt);
        return { decision: "execute", receipt };
      },
      read: async request => dailyReceipts.get(request.attemptKey) ?? null,
      record: async (request, record) => {
        recorded.push(`${request.attemptKey}:${record.outcome}`);
        const reservation = dailyReceipts.get(request.attemptKey);
        assert.ok(reservation, "Accounting requires the original daily reservation");
        const receipt = { ...reservation, record };
        dailyReceipts.set(request.attemptKey, receipt);
        return receipt;
      },
      getForUser: async () => ({ day: reservationDay, attempts: dailyReceipts.size,
        inputTokens: 0, outputTokens: 0, cachedTokens: 0, unknownUsageAttempts: dailyReceipts.size, billingSource: "platform" }),
    } },
    provider: { generate: async request => {
      providers++;
      assert.equal(starts.length, providers, "A start observation must precede every admitted provider attempt");
      assert.equal(durable.snapshot.attempts.at(-1)!.fingerprint,
        agentBudgetFingerprint({ model: config.model, contents: request.contents, config: request.config }));
      if (providers === 1 || providers === 3) throw new genai.ApiError({ status: 503, message: "Synthetic temporary provider failure" });
      return { content: { role: "model", parts: [{ text: "Synthetic role result" }] }, finishReason: genai.FinishReason.STOP };
    } } });
  const input = { system: "Synthetic bounded role", user: "Synthetic evidence", attemptKey: "model:first",
    onProviderStart: () => { starts.push(providers); } };
  try {
    assert.equal(await model.completeText(input), "Synthetic role result");
    await assert.rejects(model.completeText({ ...input, attemptKey: "model:third" }), { reason: "model_limit" });
    assert.equal(providers, 3);
    assert.equal(budget.remainingModelCalls, 1);
    assert.equal(await model.completeText({ ...input, attemptKey: "model:review", purpose: "delivery_review" }), "Synthetic role result");
    assert.deepEqual(durable.snapshot.attempts.map(item => item.key), ["model:first", "model:first:retry:1", "model:third", "model:review"]);
    assert.equal(durable.snapshot.attempts[0]!.fingerprint, durable.snapshot.attempts[1]!.fingerprint);
    assert.deepEqual(daily.map(item => item.attemptKey), ["model:first", "model:first:retry:1", "model:third", "model:review"]);
    assert.deepEqual(recorded, ["model:first:unavailable", "model:first:retry:1:succeeded", "model:third:unavailable", "model:review:succeeded"]);
    assert.equal(budget.counts.modelCalls, 4);
    assert.equal(providers, 4);
    assert.equal(starts.length, 4);
  } finally { budget.close(); }
});


test("a tool-work attempt label does not authorize spending the protected review reserve", async () => {
  const s = gatewaySetup({ reserveDeliveryReview: true, used: 3 });
  try {
    await assert.rejects(s.model.completeText({ ...s.input, attemptKey: "tool-work:synthetic-compose" }), { reason: "model_limit" });
    assert.deepEqual(s.events, []);
    assert.equal(s.budget.remainingModelCalls, 1);
  } finally { s.budget.close(); }
});

test("trusted compose review can use the final shared attempt without increasing the hard ceiling", async () => {
  const s = gatewaySetup({ reserveDeliveryReview: true, used: 3, purpose: "compose_review" });
  try {
    assert.equal(await s.model.completeText(s.input), "Synthetic role result");
    assert.equal(s.budget.counts.modelCalls, 4);
    assert.deepEqual(s.events, ["quota", "start", "provider", "record"]);
    await assert.rejects(s.model.completeText({ ...s.input, attemptKey: "model:extra-review" }), { reason: "model_limit" });
    assert.deepEqual(s.events, ["quota", "start", "provider", "record"]);
  } finally { s.budget.close(); }
});

test("durable admission refreshes the shared count before checking the review reserve", async () => {
  const { config } = setup(), budget = new AgentBudget(), durable = durableGatewayProbe(budget);
  await budget.initializeDurable(durable);
  durable.snapshot.used.modelCalls = 3;
  let providers = 0, starts = 0, quotas = 0;
  const model = new AgentGatewayModel({ config, budget, userId: "synthetic-user", childId: "synthetic-child",
    reserveDeliveryReview: true, authorize: async () => true,
    usage: { reserve: async () => { quotas++; return true; }, record: async () => {} },
    provider: { generate: async () => { providers++; throw new Error("Provider must not start"); } } });
  try {
    await assert.rejects(model.completeText({ system: "Synthetic generation", user: "Synthetic request",
      attemptKey: "model:stale-local-count", onProviderStart: () => { starts++; } }), { reason: "model_limit" });
    assert.deepEqual([providers, starts, quotas], [0, 0, 0]);
    assert.equal(budget.remainingModelCalls, 1);
    assert.equal(durable.snapshot.attempts.length, 0);
  } finally { budget.close(); }
});
