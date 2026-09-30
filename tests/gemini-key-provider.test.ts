import assert from "node:assert/strict";
import test from "node:test";
import type { LlmRequest } from "@google/adk";
import type { EmbedContentResponse } from "@google/genai";
import { readAiConfig } from "../server/ai-config.ts";
import { EmbeddingFailure } from "../server/embedding-gateway.ts";
import { createGeminiKeyProviders } from "../server/gemini-key-provider.ts";
import { ProviderFailure } from "../server/model-gateway.ts";

const config = { ...readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project" }), maxOutputTokens: 2048 };
const apiKey = "synthetic-private-api-key";
const input = { systemInstruction: "Synthetic instruction", messages: [{ role: "user" as const, text: "Synthetic question" }] };
const query = { text: "Synthetic query", task: "RETRIEVAL_QUERY" as const };
const signal = () => new AbortController().signal;
const vector = () => [3, 4, ...Array<number>(1022).fill(0)];

function requestUrl(value: string | URL | Request): URL {
  const url = new URL(value instanceof Request ? value.url : String(value));
  assert.equal(url.origin, "https://generativelanguage.googleapis.com");
  assert.equal(url.searchParams.has("key"), false);
  return url;
}

test("native SDK preserves Agent parts and bounds the P1 and Agent request settings", async (context) => {
  const calls: { url: URL; init: RequestInit }[] = [];
  const parts = [{ text: "Hidden thought", thought: true, thoughtSignature: "opaque-signature" },
    { functionCall: { id: "call-1", name: "read_records", args: {} }, thoughtSignature: "call-signature" }];
  const response = { candidates: [{ content: { role: "model", parts }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 7, totalTokenCount: 10 } };
  let nextResponse = response;
  context.mock.method(globalThis, "fetch", async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: requestUrl(url), init });
    return Response.json(nextResponse);
  });
  const providers = createGeminiKeyProviders(config, apiKey);
  const request: LlmRequest = { model: "ignored-client-model", liveConnectConfig: {}, toolsDict: {}, contents: [
    { role: "user", parts: [{ text: "Synthetic photo" }, { inlineData: { mimeType: "image/png", data: "AA==" } }] },
    { role: "model", parts: [{ functionCall: { id: "prior-call", name: "read_records", args: {} }, thoughtSignature: "prior-signature" }] },
    { role: "user", parts: [{ functionResponse: { id: "prior-call", name: "read_records", response: { records: [] } } }] },
  ], config: { systemInstruction: "Synthetic instruction", candidateCount: 4, maxOutputTokens: 4000,
    httpOptions: { baseUrl: "https://untrusted.invalid", headers: { "x-untrusted": "discard" },
      retryOptions: { attempts: 9 }, extraBody: { injected: true } } } };
  const reply = await providers.agent.generate(request, signal());
  assert.deepEqual(reply.content, response.candidates[0]!.content);
  assert.deepEqual(reply.usageMetadata, response.usageMetadata);
  const agentBody = JSON.parse(String(calls[0]!.init.body));
  assert.deepEqual(agentBody.contents, request.contents);
  assert.equal(agentBody.generationConfig.candidateCount, 1);
  assert.equal(agentBody.generationConfig.maxOutputTokens, 1024);
  assert.equal(agentBody.generationConfig.thinkingConfig.thinkingLevel, "MINIMAL");
  assert.equal(agentBody.injected, undefined);
  assert.equal(new Headers(calls[0]!.init.headers).get("x-untrusted"), null);
  assert.equal(new Headers(calls[0]!.init.headers).get("x-goog-api-key"), apiKey);
  assert.equal(calls[0]!.url.pathname, "/v1beta/models/gemini-3.1-flash-lite:generateContent");

  nextResponse = { ...response, candidates: [{ content: { role: "model", parts: [
    { text: "Hidden thought", thought: true, thoughtSignature: "opaque-signature" },
    { text: "Synthetic answer", thought: false, thoughtSignature: "answer-signature" },
  ] }, finishReason: "STOP" }] };
  assert.deepEqual(await providers.model.generate(input, { signal: signal(), maxOutputTokens: 4000 }),
    { text: "Synthetic answer", usage: { inputTokens: 7, outputTokens: 3, cachedTokens: null } });
  const modelBody = JSON.parse(String(calls[1]!.init.body));
  assert.deepEqual(modelBody.contents, [{ role: "user", parts: [{ text: "Synthetic question" }] }]);
  assert.deepEqual(modelBody.systemInstruction.parts, [{ text: input.systemInstruction }]);
  assert.equal(modelBody.generationConfig.maxOutputTokens, 1024);
  assert.equal(calls.length, 2);
});

test("query embeddings accept missing Vertex statistics, normalize 1024 dimensions and reject unsafe inputs or vectors", async (context) => {
  const calls: { url: URL; init: RequestInit }[] = [];
  let response: EmbedContentResponse = { embeddings: [{ values: vector() }] };
  context.mock.method(globalThis, "fetch", async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: requestUrl(url), init });
    return Response.json(response);
  });
  const providers = createGeminiKeyProviders(config, apiKey);
  const reply = await providers.embedding.embed(query, signal());
  assert.equal(reply.values.length, 1024);
  assert.equal(reply.values[0], 0.6);
  assert.equal(reply.values[1], 0.8);
  assert.equal(Math.hypot(...reply.values), 1);
  assert.equal(reply.inputTokens, null);
  assert.equal(reply.billableCharacters, null);
  assert.equal(calls[0]!.url.pathname, "/v1beta/models/gemini-embedding-001:batchEmbedContents");
  const body = JSON.parse(String(calls[0]!.init.body));
  assert.equal(body.requests.length, 1);
  assert.equal(body.requests[0].taskType, "RETRIEVAL_QUERY");
  assert.equal(body.requests[0].outputDimensionality, 1024);
  assert.equal(body.requests[0].autoTruncate, undefined);
  assert.deepEqual(body.requests[0].content.parts, [{ text: query.text }]);
  for (const invalid of [{ ...query, text: " " }, { ...query, text: "港".repeat(667) },
    { ...query, task: "RETRIEVAL_DOCUMENT" as const, title: "Synthetic title" }]) {
    await assert.rejects(providers.embedding.embed(invalid, signal()), { code: "invalid_input" });
  }
  assert.equal(calls.length, 1);
  for (const invalid of [[], [{ values: [] }], [{ values: Array<number>(1024).fill(0) }],
    [{ values: [Number.NaN, ...Array<number>(1023).fill(0)] }],
    [{ values: vector() }, { values: vector() }], [{ values: vector(), statistics: { truncated: true } }]]) {
    response = { embeddings: invalid };
    await assert.rejects(providers.embedding.embed(query, signal()), { code: "invalid_response" });
  }
  assert.equal(calls.length, 7);
});

test("metadata checks use only GET and native SDK errors or cancellation cannot expose the key or retry", async (context) => {
  const calls: { url: URL; init: RequestInit }[] = [];
  let mode: "metadata" | "missing-actions" | "unsupported" | "error" | "pending" = "metadata";
  let started!: () => void;
  const startedRequest = new Promise<void>(resolve => { started = resolve; });
  const logs: unknown[][] = [];
  for (const method of ["log", "warn", "error", "debug"] as const) context.mock.method(console, method, (...args: unknown[]) => { logs.push(args); });
  context.mock.method(globalThis, "fetch", async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: requestUrl(url), init });
    if (mode === "error") return Response.json({ error: { code: 429,
      message: `Private request and response ${apiKey}`, status: "RESOURCE_EXHAUSTED" } }, { status: 429 });
    if (mode === "pending") {
      started();
      return new Promise<Response>((_resolve, reject) => {
        const abort = () => reject(new Error(`Private abort ${apiKey}`));
        init.signal?.addEventListener("abort", abort, { once: true });
        if (init.signal?.aborted) abort();
      });
    }
    return Response.json({ name: "models/gemini-3.1-flash-lite",
      ...(mode === "missing-actions" ? {} : { supportedGenerationMethods: mode === "unsupported" ? ["embedContent"] : ["generateContent"] }) });
  });
  const providers = createGeminiKeyProviders(config, apiKey);
  assert.equal(await providers.check(signal()), true);
  mode = "missing-actions";
  assert.equal(await providers.check(signal()), true);
  mode = "unsupported";
  assert.equal(await providers.check(signal()), false);
  assert.equal(calls.length, 3);
  assert.ok(calls.every(call => call.init.method === "GET" && call.init.body === undefined
    && call.url.pathname === "/v1beta/models/gemini-3.1-flash-lite"));
  mode = "error";
  const sanitized = (error: unknown) => error instanceof Error && !String(error).includes(apiKey)
    && !String(error).includes("Private") && !Object.hasOwn(error, "cause");
  await assert.rejects(providers.model.generate(input, { signal: signal(), maxOutputTokens: 512 }),
    error => error instanceof ProviderFailure && error.kind === "rate_limited" && sanitized(error));
  const request: LlmRequest = { model: config.model, liveConnectConfig: {}, contents: [{ role: "user", parts: [{ text: "Synthetic question" }] }], toolsDict: {} };
  await assert.rejects(providers.agent.generate(request, signal()),
    error => error instanceof ProviderFailure && error.kind === "rate_limited" && sanitized(error));
  await assert.rejects(providers.embedding.embed(query, signal()),
    error => error instanceof EmbeddingFailure && error.code === "unavailable" && sanitized(error));
  assert.equal(await providers.check(signal()), false);
  assert.equal(calls.length, 7);
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(providers.agent.generate(request, aborted.signal), { kind: "unavailable" });
  await assert.rejects(providers.model.generate(input, { signal: aborted.signal, maxOutputTokens: 512 }), { kind: "unavailable" });
  await assert.rejects(providers.embedding.embed(query, aborted.signal), { code: "cancelled" });
  assert.equal(await providers.check(aborted.signal), false);
  assert.equal(calls.length, 7);
  mode = "pending";
  const controller = new AbortController();
  const pending = providers.agent.generate(request, controller.signal);
  await startedRequest;
  controller.abort();
  await assert.rejects(pending, error => error instanceof ProviderFailure && sanitized(error));
  assert.equal(calls.length, 8);
  assert.equal(calls[7]!.init.signal?.aborted, true);
  assert.deepEqual(logs, []);
});
