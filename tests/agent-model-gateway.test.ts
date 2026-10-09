import assert from "node:assert/strict";
import test, { mock } from "node:test";
import * as genai from "@google/genai";
import type { LlmRequest } from "@google/adk";
import { readAiConfig } from "../server/ai-config.ts";
import type { AiConfig } from "../server/ai-config.ts";
import { AGENT_LIMITS } from "../server/agent-budget.ts";

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
const { createVertexAgentProvider } = await import("../server/agent-model-gateway.ts");

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
