import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import type { LlmRequest } from "@google/adk";
import { ThinkingLevel } from "@google/genai";
import { GoogleAuth } from "google-auth-library";
import { readAiConfig } from "../server/ai-config.ts";
import { createVertexAgentProvider } from "../server/agent-model-gateway.ts";
import { createVertexProvider } from "../server/vertex-provider.ts";
import { createGeminiKeyProviders } from "../server/gemini-key-provider.ts";

const apiKey = "synthetic-private-api-key";
const input = { systemInstruction: "Synthetic instruction", messages: [{ role: "user" as const, text: "Synthetic question" }] };
const parts = [
  { text: "Synthetic hidden thought", thought: true, thoughtSignature: "opaque-thought-signature" },
  { text: "Synthetic answer", thoughtSignature: "opaque-answer-signature" },
];
const usageMetadata = { promptTokenCount: 7, candidatesTokenCount: 2, thoughtsTokenCount: 3,
  totalTokenCount: 12, cachedContentTokenCount: 4 };
const response = { candidates: [{ content: { role: "model", parts }, finishReason: "STOP" }], usageMetadata };

function syntheticRequest(): LlmRequest {
  return { model: "ignored-untrusted-model", liveConnectConfig: {}, toolsDict: {}, contents: [
    { role: "user", parts: [{ text: "Synthetic question" }] },
    { role: "model", parts: [{ functionCall: { id: "prior-call", name: "read_context", args: {} },
      thoughtSignature: "opaque-prior-signature" }] },
    { role: "user", parts: [{ functionResponse: { id: "prior-call", name: "read_context", response: { records: [] } } }] },
  ], config: { systemInstruction: input.systemInstruction, candidateCount: 9, maxOutputTokens: 9999,
    temperature: 0.25, thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH, thinkingBudget: 9999, includeThoughts: true },
    abortSignal: new AbortController().signal } };
}

function mockAuth(context: TestContext) {
  context.mock.method(GoogleAuth.prototype, "getRequestHeaders", async () => new Headers({ authorization: "Bearer synthetic" }));
}

for (const scenario of [
  { model: "gemini-3.1-flash-lite", level: undefined, agent: "MINIMAL", defaultLevel: "MINIMAL" },
  { model: "gemini-3.1-flash-lite", level: "high", agent: "HIGH", defaultLevel: "MINIMAL" },
  { model: "gemini-3.8-flash", level: undefined, agent: "LOW", defaultLevel: "LOW" },
  { model: "gemini-3.8-flash", level: "low", agent: "LOW", defaultLevel: "LOW" },
  { model: "gemini-3.8-flash", level: "medium", agent: "MEDIUM", defaultLevel: "LOW" },
  { model: "gemini-3.8-flash", level: "high", agent: "HIGH", defaultLevel: "LOW" },
]) {
  test(`all four native request bodies preserve bounds and scope for ${scenario.model}/${scenario.level ?? "default"}`, async context => {
    mockAuth(context);
    const calls: { url: string; init: RequestInit }[] = [];
    context.mock.method(globalThis, "fetch", async (url: string | URL | Request, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      return Response.json(response);
    });
    const config = readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project", GEMINI_MODEL: scenario.model,
      AI_AGENT_THINKING_LEVEL: scenario.level, AI_MAX_OUTPUT_TOKENS: "4096" });
    const request = syntheticRequest();
    const originalContents = structuredClone(request.contents);
    const originalConfig = { ...request.config, thinkingConfig: { ...request.config!.thinkingConfig } };
    const controller = new AbortController();
    const vertexAgent = await createVertexAgentProvider(config).generate(request, controller.signal);
    const vertexModel = await createVertexProvider(config).generate(input, { signal: controller.signal, maxOutputTokens: 600 });
    const keyProviders = createGeminiKeyProviders(config, apiKey);
    const keyAgent = await keyProviders.agent.generate(request, controller.signal);
    const keyModel = await keyProviders.model.generate(input, { signal: controller.signal, maxOutputTokens: 600 });

    assert.equal(calls.length, 4);
    for (const [index, call] of calls.entries()) {
      const key = index >= 2;
      const agent = index % 2 === 0;
      assert.equal(call.url, key
        ? `https://generativelanguage.googleapis.com/v1beta/models/${scenario.model}:generateContent`
        : `https://aiplatform.googleapis.com/v1/projects/synthetic-project/locations/global/publishers/google/models/${scenario.model}:generateContent`);
      assert.equal(call.init.method, "POST");
      assert.ok(call.init.signal);
      assert.equal(call.init.signal.aborted, false);
      if (key) assert.equal(new Headers(call.init.headers).get("x-goog-api-key"), apiKey);
      const body = JSON.parse(String(call.init.body));
      assert.deepEqual(body.contents, agent ? request.contents : [{ role: "user", parts: [{ text: "Synthetic question" }] }]);
      assert.deepEqual(body.systemInstruction.parts, [{ text: input.systemInstruction }]);
      assert.deepEqual(body.generationConfig, {
        ...(agent ? { temperature: 0.25 } : {}), candidateCount: 1, maxOutputTokens: agent ? 1024 : 600,
        thinkingConfig: { thinkingLevel: index === 0 ? scenario.agent : scenario.defaultLevel },
      });
    }
    for (const reply of [vertexAgent, keyAgent]) {
      assert.deepEqual(reply.content, response.candidates[0]!.content);
      assert.equal(reply.finishReason, "STOP");
      assert.deepEqual(reply.usageMetadata, usageMetadata);
    }
    for (const reply of [vertexModel, keyModel]) {
      assert.deepEqual(reply, { text: "Synthetic answer", usage: { inputTokens: 7, outputTokens: 5, cachedTokens: 4 } });
    }
    assert.deepEqual(request.contents, originalContents);
    assert.deepEqual(request.config, originalConfig);
  });
}

test("all four native paths propagate abort without retries for the compatible 3.8 default", async context => {
  mockAuth(context);
  context.mock.method(console, "warn", () => {});
  const config = readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project", GEMINI_MODEL: "gemini-3.8-flash" });
  const keyProviders = createGeminiKeyProviders(config, apiKey);
  const vertexAgent = createVertexAgentProvider(config);
  const vertexModel = createVertexProvider(config);
  const paths = [
    (signal: AbortSignal) => vertexAgent.generate(syntheticRequest(), signal),
    (signal: AbortSignal) => vertexModel.generate(input, { signal, maxOutputTokens: 600 }),
    (signal: AbortSignal) => keyProviders.agent.generate(syntheticRequest(), signal),
    (signal: AbortSignal) => keyProviders.model.generate(input, { signal, maxOutputTokens: 600 }),
  ];
  for (const generate of paths) {
    let calls = 0;
    let reached!: () => void;
    const started = new Promise<void>(resolve => { reached = resolve; });
    context.mock.method(globalThis, "fetch", async (_url: string | URL | Request, init: RequestInit = {}) => {
      calls++;
      assert.deepEqual(JSON.parse(String(init.body)).generationConfig.thinkingConfig, { thinkingLevel: "LOW" });
      reached();
      return new Promise<Response>((_resolve, reject) => {
        const abort = () => reject(new Error("Synthetic aborted request"));
        init.signal?.addEventListener("abort", abort, { once: true });
        if (init.signal?.aborted) abort();
      });
    });
    const controller = new AbortController();
    const pending = generate(controller.signal);
    await started;
    controller.abort();
    await assert.rejects(pending);
    assert.equal(calls, 1);
  }
});
