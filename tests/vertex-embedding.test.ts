import assert from "node:assert/strict";
import test from "node:test";
import type { EmbedContentResponse } from "@google/genai";
import { readAiConfig } from "../server/ai-config.ts";
import { EmbeddingFailure } from "../server/embedding-gateway.ts";

function validResponse(): EmbedContentResponse {
  return {
    embeddings: [{ values: [1, ...Array<number>(1023).fill(0)], statistics: { truncated: false, tokenCount: 23 } }],
    metadata: { billableCharacterCount: 120 },
  };
}

function rejectsResponse(response: EmbedContentResponse, read: (response: EmbedContentResponse) => unknown): void {
  assert.throws(() => read(response), { code: "invalid_response" });
}

test("Vertex embedding response and request boundaries", async (context) => {
  const calls: unknown[] = [];
  let settings: unknown;
  let nextResponse = validResponse();
  let nextError: unknown;
  class FakeApiError extends Error {
    readonly status: number;
    constructor(status: number) { super("private provider response"); this.status = status; }
  }
  class FakeGoogleGenAI {
    models = { embedContent: async (request: unknown) => {
      calls.push(request);
      if (nextError) throw nextError;
      return nextResponse;
    } };
    constructor(options: unknown) { settings = options; }
  }
  // Runtime 24.19 supports exports; the pinned 24.13 type package predates this option.
  const moduleOptions = { cache: false, exports: { ApiError: FakeApiError, GoogleGenAI: FakeGoogleGenAI } };
  context.mock.module("@google/genai", moduleOptions);
  const { createVertexEmbeddingProvider, readVertexEmbedding } = await import("../server/vertex-embedding.ts");

  await context.test("accepts one complete vector and preserves optional usage as unknown", () => {
    const reply = readVertexEmbedding(validResponse());
    assert.equal(reply.values.length, 1024);
    assert.equal(reply.inputTokens, 23);
    assert.equal(reply.billableCharacters, 120);
    const withoutUsage = validResponse();
    delete withoutUsage.embeddings?.[0]?.statistics?.tokenCount;
    delete withoutUsage.metadata;
    assert.deepEqual({ inputTokens: readVertexEmbedding(withoutUsage).inputTokens,
      billableCharacters: readVertexEmbedding(withoutUsage).billableCharacters },
    { inputTokens: null, billableCharacters: null });
  });

  await context.test("rejects missing, multiple, short, nonfinite and zero vectors", () => {
    rejectsResponse({}, readVertexEmbedding);
    const multiple = validResponse();
    multiple.embeddings?.push(validResponse().embeddings![0]!);
    rejectsResponse(multiple, readVertexEmbedding);
    const short = validResponse();
    short.embeddings![0]!.values!.pop();
    rejectsResponse(short, readVertexEmbedding);
    const nonfinite = validResponse();
    nonfinite.embeddings![0]!.values![0] = Number.NaN;
    rejectsResponse(nonfinite, readVertexEmbedding);
    const zero = validResponse();
    zero.embeddings![0]!.values![0] = 0;
    rejectsResponse(zero, readVertexEmbedding);
  });

  await context.test("requires explicit untruncated statistics", () => {
    const truncated = validResponse();
    truncated.embeddings![0]!.statistics!.truncated = true;
    rejectsResponse(truncated, readVertexEmbedding);
    const missing = validResponse();
    delete missing.embeddings![0]!.statistics!.truncated;
    rejectsResponse(missing, readVertexEmbedding);
  });

  await context.test("rejects invalid provider counts and over-limit token usage", () => {
    for (const count of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2049]) {
      const response = validResponse();
      response.embeddings![0]!.statistics!.tokenCount = count;
      rejectsResponse(response, readVertexEmbedding);
    }
    for (const count of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const response = validResponse();
      response.metadata!.billableCharacterCount = count;
      rejectsResponse(response, readVertexEmbedding);
    }
  });

  const config = readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project" });
  const provider = createVertexEmbeddingProvider(config);
  await context.test("sends one string per request with fixed Vertex settings and no SDK retry", async () => {
    const signal = new AbortController().signal;
    assert.equal((await provider.embed({ text: "Synthetic section", task: "RETRIEVAL_DOCUMENT", title: "Synthetic title" }, signal)).inputTokens, 23);
    await provider.embed({ text: "Synthetic query", task: "RETRIEVAL_QUERY" }, signal);
    assert.deepEqual(settings, { enterprise: true, project: "synthetic-project", location: "global", apiVersion: "v1",
      httpOptions: { timeout: config.timeoutMs, retryOptions: { attempts: 1 } } });
    assert.deepEqual(calls, [
      { model: "gemini-embedding-001", contents: "Synthetic section", config: { taskType: "RETRIEVAL_DOCUMENT",
        title: "Synthetic title", outputDimensionality: 1024, autoTruncate: false, abortSignal: signal } },
      { model: "gemini-embedding-001", contents: "Synthetic query", config: { taskType: "RETRIEVAL_QUERY",
        outputDimensionality: 1024, autoTruncate: false, abortSignal: signal } },
    ]);
  });

  await context.test("maps provider errors without exposing provider text or retrying", async () => {
    const signal = new AbortController().signal;
    nextError = new FakeApiError(400);
    await assert.rejects(provider.embed({ text: "Synthetic query", task: "RETRIEVAL_QUERY" }, signal),
      error => error instanceof EmbeddingFailure && error.code === "invalid_input" && !String(error).includes("private"));
    nextError = new FakeApiError(503);
    await assert.rejects(provider.embed({ text: "Synthetic query", task: "RETRIEVAL_QUERY" }, signal), { code: "unavailable" });
    nextError = new Error("private provider response");
    await assert.rejects(provider.embed({ text: "Synthetic query", task: "RETRIEVAL_QUERY" }, signal), { code: "unavailable" });
    assert.equal(calls.length, 5);
    nextError = undefined;
    const aborted = new AbortController();
    aborted.abort();
    await assert.rejects(provider.embed({ text: "Synthetic query", task: "RETRIEVAL_QUERY" }, aborted.signal), { code: "cancelled" });
    assert.equal(calls.length, 5);
  });
});
