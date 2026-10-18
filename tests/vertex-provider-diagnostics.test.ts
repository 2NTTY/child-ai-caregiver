import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import { ApiError, FinishReason } from "@google/genai";
import type { LlmRequest } from "@google/adk";
import { GoogleAuth } from "google-auth-library";
import { readAiConfig } from "../server/ai-config.ts";
import { AgentBudget } from "../server/agent-budget.ts";
import { AgentGatewayModel, createVertexAgentProvider } from "../server/agent-model-gateway.ts";
import { createVertexProvider } from "../server/vertex-provider.ts";
import { ProviderFailure } from "../server/model-gateway.ts";
import type { AttemptRecord } from "../server/ai-usage.ts";

const config = readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project" });
const request: LlmRequest = { model: config.model, liveConnectConfig: {}, toolsDict: {},
  contents: [{ role: "user", parts: [{ text: "private-synthetic-prompt" }] }],
  config: { systemInstruction: "private-synthetic-instruction" } };
const signal = () => new AbortController().signal;
const privateBody = "private-synthetic-response child-id account-id https://private.invalid Authorization secret-key";

function capture(context: TestContext) {
  const logs: unknown[][] = [];
  context.mock.method(GoogleAuth.prototype, "getRequestHeaders", async () => new Headers({ authorization: "Bearer synthetic" }));
  for (const method of ["log", "warn", "error", "debug"] as const) {
    context.mock.method(console, method, (...args: unknown[]) => { logs.push(args); });
  }
  return logs;
}

test("Vertex failures retain only allowlisted HTTP metadata and never retry the SDK call", async context => {
  const logs = capture(context);
  let calls = 0;
  let status = 400;
  context.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json({ error: { code: status, message: privateBody, status: "PRIVATE_PROVIDER_CODE" } }, { status });
  });
  const provider = createVertexAgentProvider(config);
  for (const [code, category] of [[400, "invalid_request"], [401, "unauthenticated"], [403, "permission_denied"],
    [404, "not_found"], [429, "rate_limited"], [503, "provider_unavailable"]] as const) {
    status = code;
    await assert.rejects(provider.generate(request, signal()), error => error instanceof ApiError && error.status === code);
    assert.deepEqual(logs.at(-1), [JSON.stringify({ event: "vertex_generate_failure", httpStatus: code, category })]);
  }
  assert.equal(calls, 6);
  assert.equal(logs.length, 6);
  assert.doesNotMatch(JSON.stringify(logs), /private|child-id|account-id|https:|Authorization|secret-key|PRIVATE_PROVIDER_CODE/);
});

test("successful native SDK requests preserve the endpoint, bounds, parts and silence", async context => {
  const logs = capture(context);
  let calls = 0;
  const parts = [{ functionCall: { name: "read_context", args: {}, id: "synthetic-call" }, thoughtSignature: "private-signature" }];
  context.mock.method(globalThis, "fetch", async (url: string | URL | Request, init: RequestInit) => {
    calls++;
    assert.equal(String(url), "https://aiplatform.googleapis.com/v1/projects/synthetic-project/locations/global/publishers/google/models/gemini-3.1-flash-lite:generateContent");
    const body = JSON.parse(String(init.body));
    assert.deepEqual(body.contents, request.contents);
    assert.equal(body.generationConfig.candidateCount, 1);
    assert.equal(body.generationConfig.maxOutputTokens, 1024);
    assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, "MINIMAL");
    return Response.json({ candidates: [{ content: { role: "model", parts }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 4, totalTokenCount: 7 } });
  });
  const reply = await createVertexAgentProvider(config).generate(request, signal());
  assert.deepEqual(reply.content, { role: "model", parts });
  assert.equal(reply.finishReason, FinishReason.STOP);
  assert.deepEqual(reply.usageMetadata, { promptTokenCount: 4, totalTokenCount: 7 });
  assert.equal(calls, 1);
  assert.deepEqual(logs, []);
});

test("Agent failure accounting stays unknown, sanitized and single-attempt", async context => {
  const logs = capture(context);
  let calls = 0, reservations = 0, authorizations = 0;
  context.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json({ error: { message: privateBody } }, { status: 429 });
  });
  const records: AttemptRecord[] = [];
  const budget = new AgentBudget();
  try {
    const gateway = new AgentGatewayModel({ config, provider: createVertexAgentProvider(config), budget,
      userId: "private-account", childId: "private-child", authorize: async () => { authorizations++; return true; },
      usage: { reserve: async () => { reservations++; return true; }, record: async record => { records.push(record); } } });
    await assert.rejects(async () => { for await (const _ of gateway.generateContentAsync(request)) assert.fail("Must not yield"); }, { reason: "model_http_429" });
    assert.equal(gateway.failure?.message, "model_http_429");
    assert.equal(calls, 1); assert.equal(reservations, 1); assert.equal(authorizations, 2); // Before preparation and again before model admission.
    assert.deepEqual(budget.counts, { modelCalls: 1, toolCalls: 0, queryEmbeddings: 0 });
    assert.equal(records.length, 1);
    assert.equal(records[0]?.outcome, "rate_limited");
    assert.equal(records[0]?.inputTokens, null); assert.equal(records[0]?.outputTokens, null); assert.equal(records[0]?.cachedTokens, null);
    assert.equal(logs.length, 1);
    assert.doesNotMatch(JSON.stringify(logs), /private|prompt|instruction|response|secret-key/);
  } finally { budget.close(); }
});

test("unknown transport failures and cancellation cannot leak exception properties", async context => {
  const logs = capture(context);
  let calls = 0;
  const failure = Object.assign(new Error(privateBody), { status: 403, code: privateBody, url: privateBody, headers: privateBody });
  context.mock.method(globalThis, "fetch", async () => { calls++; throw failure; });
  await assert.rejects(createVertexAgentProvider(config).generate(request, signal()));
  assert.equal(calls, 1);
  assert.deepEqual(logs, [[JSON.stringify({ event: "vertex_generate_failure", httpStatus: null, category: "unknown" })]]);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(createVertexAgentProvider(config).generate(request, controller.signal));
  assert.deepEqual(logs.at(-1), [JSON.stringify({ event: "vertex_generate_failure", httpStatus: null, category: "aborted" })]);
  assert.doesNotMatch(JSON.stringify(logs), /private|secret-key|https:|stack|headers/);
});

test("plain Vertex provider logs safe metadata before preserving its sanitized failure", async context => {
  const logs = capture(context);
  let calls = 0;
  context.mock.method(globalThis, "fetch", async () => { calls++; return Response.json({ error: { message: privateBody } }, { status: 403 }); });
  await assert.rejects(createVertexProvider(config).generate({ systemInstruction: "private-instruction",
    messages: [{ role: "user", text: "private-prompt" }] }, { signal: signal(), maxOutputTokens: 512 }),
  error => error instanceof ProviderFailure && error.kind === "unavailable" && error.message === "Model provider failed");
  assert.equal(calls, 1);
  assert.deepEqual(logs, [[JSON.stringify({ event: "vertex_generate_failure", httpStatus: 403, category: "permission_denied" })]]);
});
