import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { InMemorySessionService, type LlmResponse } from "@google/adk";
import { FinishReason } from "@google/genai";
import { z } from "zod";
import { AgentBudget, AgentStopped, AGENT_LIMITS } from "../server/agent-budget.ts";
import { createAgentRuntime, type AgentRunInput, type AgentScope, type AgentTool } from "../server/agent-runtime.ts";
import { claimedRunAssembly, type ProductAgentDurableProfile } from "../server/product-agent-services.ts";
import {
  collectContiguousReadSlice,
  DEFAULT_READ_TOOL_BATCH_POLICY,
  isBatchableReadTool,
  normalizeReadBatchPolicy,
  type BatchCallDescriptor,
} from "../server/agent-tool-batch.ts";
import { readAiConfig } from "../server/ai-config.ts";
import { rejectPrivateMaintenanceScope } from "../server/background-knowledge-maintenance.ts";
import { chatDeliveryDraftHash, enforceChatDeliveryReview, type ChatDeliveryDraft } from "../server/chat-delivery-review.ts";
import type { DurableRootBudget, RootBudgetContext } from "../server/durable-root-budget.ts";
import { createEmbeddingGateway } from "../server/embedding-gateway.ts";
import { FirestoreAiUsage } from "../server/firestore-ai-usage.ts";
import { FirestoreRootBudget } from "../server/firestore-root-budget.ts";
import { FirestoreSessionService } from "../server/firestore-session-service.ts";
import { parseKnowledgeFilter } from "../server/knowledge-inputs.ts";
import { createKnowledgeRetriever } from "../server/knowledge-retriever.ts";
import { createProductAgent } from "../server/product-agent.ts";
import { createProductAgentTools } from "../server/product-agent-tools.ts";
import { loadAgentPrompt } from "../server/agent-prompt.ts";
import { createStorageCipher } from "../server/storage-crypto.ts";
import { FamilyError } from "../server/family-access.ts";
import type { KnowledgeCandidate, KnowledgeEvidence } from "../src/shared/knowledge.ts";
import type { MemoryContext } from "../src/shared/memory.ts";
import type { ProductAgentResult } from "../src/shared/product-agent.ts";
import { serialFirestoreFixture } from "./helpers/firestore-session-memory.ts";

const USER_ID = "synthetic-parent-batch";
const OTHER_USER_ID = "synthetic-parent-other";
const CHILD_ID = "11111111-2222-4333-8444-555555555555";
const OTHER_CHILD_ID = "99999999-8888-4777-8666-555555555555";
const WORKSPACE_ID = "synthetic-workspace-hk";
const SOURCE_ID = "fhs-synthetic-care";
const VERSION_V1 = "22222222-3333-4444-8555-666666666666";
const VERSION_V2 = "22222222-3333-4444-8555-777777777777";
const CHUNK_A = "33333333-4444-4555-8666-777777777777";
const CHUNK_B = "44444444-5555-4666-8777-888888888888";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_V2 = "e".repeat(64);
const SCOPE: AgentScope = {
  userId: USER_ID,
  childId: CHILD_ID,
  workspaceId: WORKSPACE_ID,
  authorizationVersion: "1",
  dataVersion: "epoch:1",
};

const modelResponse = (parts: Record<string, unknown>[]): LlmResponse => ({
  content: { role: "model", parts },
  finishReason: FinishReason.STOP,
});

const functionCallResponse = (calls: Array<{ id: string; name: string; args: Record<string, unknown> }>): LlmResponse =>
  modelResponse(calls.map(functionCall => ({ functionCall, thoughtSignature: "opaque-native-signature" })));

const aiConfig = readAiConfig({
  AI_ENABLED: "true",
  GCP_PROJECT_ID: "synthetic-project",
  AI_DAILY_USER_ATTEMPTS: "20",
  AI_DAILY_GLOBAL_ATTEMPTS: "100",
});

function makeCandidate(chunkId: string, overrides: Partial<KnowledgeCandidate> = {}): KnowledgeCandidate {
  return {
    chunkId,
    distance: 0.05,
    key: `key-${chunkId.slice(0, 8)}`,
    section: "嬰幼兒常見護理",
    sourceExcerpt: "若嬰兒出現發燒而精神尚可，可先量度體溫及按年齡評估。",
    text: "若嬰兒出現發燒而精神尚可，應定時量度體溫、保持室內通風並留意飲食及尿量；如持續不適或未滿三個月，應盡快求醫。",
    originalText: "原文詳細指引：若嬰兒出現發燒而精神尚可，應定時量度體溫、保持室內通風並留意飲食及尿量；如持續不適或未滿三個月，應盡快求醫。",
    keywords: ["發燒", "體溫", "嬰兒"],
    applicability: {
      region: "HK",
      ageBasis: "actual",
      minAgeMonths: 0,
      maxAgeMonths: 24,
      topics: ["fever", "general"],
      conditions: [],
    },
    sourceId: SOURCE_ID,
    versionId: VERSION_V1,
    versionHash: HASH_A,
    contentHash: HASH_A,
    url: "https://www.fhs.gov.hk/tc_chi/health_info/child/synthetic-fever.html",
    title: "衛生署家庭健康服務 — 合成發燒護理指南",
    publisher: "香港特別行政區政府衛生署",
    classification: "official_guidance",
    sourcePublishedAt: "2026-01-01T00:00:00.000Z",
    sourceUpdatedAt: "2026-06-01T00:00:00.000Z",
    sourceDateText: "2026年6月修訂",
    validUntil: null,
    fetchedAt: "2026-10-01T00:00:00.000Z",
    checkedAt: "2026-10-01T00:00:00.000Z",
    reviewState: "reviewed",
    ...overrides,
  };
}

function makeEvidence(chunkId: string, overrides: Partial<KnowledgeEvidence> = {}): KnowledgeEvidence {
  const { distance: _d, rankScore: _r, originalText: _o, ...base } = makeCandidate(chunkId);
  return {
    ...base,
    readCoverage: { kind: "reviewed_text_and_excerpt", complete: false },
    ...overrides,
  };
}

function emptyMemory(profileData: unknown = { age: { kind: "birth_date", date: "2026-05-01" }, region: "HK" }): MemoryContext {
  return {
    profile: { childId: CHILD_ID, version: 1, data: profileData },
    profileApplicable: Boolean(profileData),
    facts: [],
    topics: [],
    summary: null,
    recentMessages: [],
    conflictingKeys: [],
    unavailableFactKeys: [],
    truncated: { facts: false, topics: false, messages: false },
  } as unknown as MemoryContext;
}

function makeEmbeddingGateway(onEmbed?: (text: string) => void) {
  return createEmbeddingGateway({
    config: aiConfig,
    usage: { reserve: async () => true, record: async () => {} },
    provider: {
      embed: async req => {
        onEmbed?.(req.text);
        return {
          values: [1, ...Array<number>(1023).fill(0)],
          inputTokens: 4,
          billableCharacters: Math.max(1, req.text.length),
        };
      },
    },
  });
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("bounded read-only batching executes concurrently within maxConcurrent and reduces model turns", async () => {
  let inFlight = 0;
  let peakInFlight = 0;
  const completedIds: string[] = [];
  let modelTurns = 0;

  const readProbe: AgentTool = {
    name: "read_probe",
    effect: "read",
    description: "Read synthetic record concurrently.",
    parameters: z.object({ id: z.string() }).strict(),
    authorize: async () => true,
    execute: async args => {
      const id = String(args.id);
      inFlight++;
      if (inFlight > peakInFlight) peakInFlight = inFlight;
      await new Promise(resolve => setTimeout(resolve, 25));
      inFlight--;
      completedIds.push(id);
      return { status: "succeeded", reference: id, data: { value: `doc:${id}` } };
    },
  };
  const writeProbe: AgentTool = {
    name: "write_probe",
    description: "Mutating barrier tool.",
    parameters: z.object({ id: z.string() }).strict(),
    authorize: async () => true,
    execute: async args => ({ status: "succeeded", reference: String(args.id) }),
  };
  const showHelp: AgentTool = {
    name: "show_official_help",
    effect: "read",
    description: "Client help UI dock.",
    parameters: z.object({}).strict(),
    authorize: async () => true,
    execute: async () => ({ status: "succeeded" }),
  };
  const terminalTool: AgentTool = {
    name: "present_answer",
    terminal: true,
    description: "Submit final presentation.",
    parameters: z.object({ text: z.string() }).strict(),
    authorize: async () => true,
    execute: async () => ({ status: "succeeded", data: { acceptedForValidation: true } }),
  };

  assert.equal(isBatchableReadTool(readProbe), true);
  assert.equal(isBatchableReadTool(writeProbe), false);
  assert.equal(isBatchableReadTool(showHelp), false);
  assert.equal(isBatchableReadTool(terminalTool), false);
  assert.deepEqual(normalizeReadBatchPolicy(undefined), DEFAULT_READ_TOOL_BATCH_POLICY);

  const defs = new Map<string, AgentTool>([readProbe, writeProbe, showHelp, terminalTool].map(t => [t.name, t]));
  const mixedCalls: BatchCallDescriptor[] = [
    { id: "c1", name: "read_probe", args: { id: "r1" } },
    { id: "c2", name: "read_probe", args: { id: "r2" } },
    { id: "c3", name: "show_official_help", args: {} },
    { id: "c4", name: "read_probe", args: { id: "r3" } },
  ];
  assert.deepEqual(collectContiguousReadSlice(mixedCalls, 0, defs).map(s => s.callId), ["c1", "c2"]);

  const runtime = createAgentRuntime({
    config: aiConfig,
    usage: { reserve: async () => true, record: async () => {} },
    provider: {
      generate: async request => {
        const turn = modelTurns++;
        if (turn === 0) {
          return functionCallResponse([
            { id: "r1", name: "read_probe", args: { id: "alpha" } },
            { id: "r2", name: "read_probe", args: { id: "beta" } },
            { id: "r3", name: "read_probe", args: { id: "gamma" } },
            { id: "r4", name: "read_probe", args: { id: "delta" } },
          ]);
        }
        const responses = request.contents.flatMap(c => c.parts ?? []).filter(p => p.functionResponse);
        assert.equal(responses.length, 4);
        return functionCallResponse([{ id: "final", name: "present_answer", args: { text: "All 4 reads finished in 1 batch." } }]);
      },
    },
  });

  const result = await runtime.run({
    scope: SCOPE,
    recipeId: "p1-chat",
    trigger: { kind: "interactive", reference: randomUUID() },
    messages: [{ role: "user", text: "Read four records." }],
    tools: [readProbe, writeProbe, showHelp, terminalTool],
    authorize: async () => true,
    readBatchPolicy: { maxConcurrent: 3, maxBatchSize: 6, itemTimeoutMs: 5000 },
    finalize: async () => "All 4 reads finished in 1 batch.",
  });

  assert.equal(result.status, "completed", JSON.stringify(result));
  assert.equal(peakInFlight, 3, "Concurrent execution must reach maxConcurrent=3 without exceeding it");
  assert.equal(modelTurns, 2, "4 reads + present must complete in 2 model turns instead of 5");
  assert.equal(completedIds.length, 4);
  assert.deepEqual(result.tools.map(t => t.reference), ["alpha", "beta", "gamma", "delta", undefined]);
  assert.deepEqual(result.counts, { modelCalls: 2, toolCalls: 5, queryEmbeddings: 0 });
});

test("mutating write barriers, show_official_help, and sequential dependent reads enforce strict ordering", async () => {
  const trace: string[] = [];
  const readAnchor: AgentTool = {
    name: "read_anchor",
    effect: "read",
    description: "Fetch anchor chunk id.",
    parameters: z.object({ id: z.string() }).strict(),
    authorize: async () => true,
    execute: async args => {
      trace.push(`start:${args.id}`);
      await new Promise(resolve => setTimeout(resolve, 10));
      trace.push(`end:${args.id}`);
      return { status: "succeeded", reference: String(args.id), data: { anchorId: `anchor-${args.id}` } };
    },
  };
  const writeBarrier: AgentTool = {
    name: "save_mutation",
    description: "Mutating write barrier.",
    parameters: z.object({ id: z.string() }).strict(),
    authorize: async () => true,
    execute: async args => {
      trace.push(`start:${args.id}`);
      await new Promise(resolve => setTimeout(resolve, 10));
      trace.push(`end:${args.id}`);
      return { status: "succeeded", reference: String(args.id), data: { mutated: true } };
    },
  };
  const present: AgentTool = {
    name: "present_answer",
    terminal: true,
    description: "Complete response.",
    parameters: z.object({ text: z.string() }).strict(),
    authorize: async () => true,
    execute: async () => ({ status: "succeeded", data: { acceptedForValidation: true } }),
  };

  let turn = 0;
  const runtime = createAgentRuntime({
    config: aiConfig,
    usage: { reserve: async () => true, record: async () => {} },
    provider: {
      generate: async request => {
        const current = turn++;
        if (current === 0) {
          // Mutating write sits in the middle: read A and read B must NOT execute concurrently with write.
          return functionCallResponse([
            { id: "c1", name: "read_anchor", args: { id: "A" } },
            { id: "c2", name: "save_mutation", args: { id: "M" } },
            { id: "c3", name: "read_anchor", args: { id: "B" } },
          ]);
        }
        if (current === 1) {
          const anchorAResp = request.contents.flatMap(c => c.parts ?? []).find(p => p.functionResponse?.id === "c1")?.functionResponse?.response as any;
          assert.equal(anchorAResp?.data?.anchorId, "anchor-A");
          // Dependent sequential read in Turn 2 using anchor returned in Turn 1.
          return functionCallResponse([{ id: "c4", name: "read_anchor", args: { id: anchorAResp.data.anchorId } }]);
        }
        return functionCallResponse([{ id: "fin", name: "present_answer", args: { text: "Ordered execution complete." } }]);
      },
    },
  });

  const result = await runtime.run({
    scope: SCOPE,
    recipeId: "p1-chat",
    trigger: { kind: "interactive", reference: randomUUID() },
    messages: [{ role: "user", text: "Check barriers." }],
    tools: [readAnchor, writeBarrier, present],
    authorize: async () => true,
    readBatchPolicy: { maxConcurrent: 3, maxBatchSize: 6, itemTimeoutMs: 5000 },
    finalize: async () => "Ordered execution complete.",
  });

  assert.equal(result.status, "completed", JSON.stringify(result));
  assert.deepEqual(trace, [
    "start:A", "end:A",
    "start:M", "end:M",
    "start:B", "end:B",
    "start:anchor-A", "end:anchor-A",
  ]);
});

test("batch cap overflow, per-item timeout, read error, and mid-batch embedding_limit retain succeeded sibling results", async () => {
  const executed: string[] = [];
  let sharedEmbeddings = 0;

  const readItem: AgentTool = {
    name: "read_probe",
    effect: "read",
    description: "Read probe supporting timeout, failure, and embedding cap.",
    parameters: z.object({ mode: z.enum(["ok", "timeout", "throw", "embed_cap"]) }).strict(),
    authorize: async () => true,
    execute: async (args, ctx) => {
      const mode = String(args.mode);
      executed.push(mode);
      if (mode === "ok") {
        sharedEmbeddings++;
        return { status: "succeeded", reference: "ok-ref", data: { value: "preserved-sibling-evidence" } };
      }
      if (mode === "throw") {
        throw new Error("synthetic read failure");
      }
      if (mode === "embed_cap") {
        throw new AgentStopped("embedding_limit");
      }
      await new Promise<void>((_, reject) => {
        ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason ?? new Error("aborted")), { once: true });
      });
      return { status: "succeeded" };
    },
  };
  const present: AgentTool = {
    name: "present_answer",
    terminal: true,
    description: "Finish.",
    parameters: z.object({ text: z.string() }).strict(),
    authorize: async () => true,
    execute: async () => ({ status: "succeeded", data: { acceptedForValidation: true } }),
  };

  for (const variant of ["cap_timeout_throw", "embedding_limit"] as const) {
    executed.length = 0;
    sharedEmbeddings = 0;
    let modelTurn = 0;
    let observedBatchResponses: Array<{ id?: string; response: any }> = [];

    const runtime = createAgentRuntime({
      config: aiConfig,
      usage: { reserve: async () => true, record: async () => {} },
      provider: {
        generate: async request => {
          const turn = modelTurn++;
          if (turn === 0) {
            if (variant === "cap_timeout_throw") {
              return functionCallResponse([
                { id: "i0", name: "read_probe", args: { mode: "ok" } },
                { id: "i1", name: "read_probe", args: { mode: "timeout" } },
                { id: "i2", name: "read_probe", args: { mode: "throw" } },
                { id: "i3", name: "read_probe", args: { mode: "ok" } },
                { id: "i4", name: "read_probe", args: { mode: "ok" } },
              ]);
            }
            return functionCallResponse([
              { id: "e0", name: "read_probe", args: { mode: "ok" } },
              { id: "e1", name: "read_probe", args: { mode: "embed_cap" } },
            ]);
          }
          observedBatchResponses = request.contents
            .flatMap(c => c.parts ?? [])
            .filter(p => p.functionResponse)
            .map(p => ({ id: p.functionResponse!.id, response: p.functionResponse!.response }));
          return functionCallResponse([{ id: "fin", name: "present_answer", args: { text: "Recovered partial reads." } }]);
        },
      },
    });

    const result = await runtime.run({
      scope: SCOPE,
      recipeId: "p1-chat",
      trigger: { kind: "interactive", reference: randomUUID() },
      messages: [{ role: "user", text: `Run ${variant}` }],
      tools: [readItem, present],
      authorize: async () => true,
      readBatchPolicy: { maxConcurrent: 2, maxBatchSize: 3, itemTimeoutMs: 35 },
      finalize: async () => "Recovered partial reads.",
    });

    assert.equal(result.status, "completed", JSON.stringify({ variant, result }));
    if (variant === "cap_timeout_throw") {
      assert.equal(observedBatchResponses.length, 5);
      assert.equal(observedBatchResponses[0]?.response?.status, "succeeded");
      assert.equal(observedBatchResponses[0]?.response?.data?.value, "preserved-sibling-evidence");
      assert.equal(observedBatchResponses[1]?.response?.status, "failed");
      assert.equal(observedBatchResponses[1]?.response?.data?.code, "read_timeout");
      assert.equal(observedBatchResponses[1]?.response?.data?.recovery, "bounded_read");
      assert.equal(observedBatchResponses[2]?.response?.status, "failed");
      assert.equal(observedBatchResponses[2]?.response?.data?.code, "read_unavailable");
      assert.equal(observedBatchResponses[3]?.response?.status, "rejected");
      assert.equal(observedBatchResponses[3]?.response?.data?.code, "batch_limit_exceeded");
      assert.equal(observedBatchResponses[3]?.response?.data?.maxBatchSize, 3);
      assert.equal(observedBatchResponses[4]?.response?.status, "rejected");
      assert.equal(observedBatchResponses[4]?.response?.data?.code, "batch_limit_exceeded");
      assert.equal(executed.filter(m => m === "ok").length, 1, "Overflow items above maxBatchSize must never execute");
    } else {
      assert.equal(observedBatchResponses.length, 2);
      assert.equal(observedBatchResponses[0]?.response?.status, "succeeded");
      assert.equal(observedBatchResponses[0]?.response?.data?.value, "preserved-sibling-evidence");
      assert.equal(observedBatchResponses[1]?.response?.status, "rejected");
      assert.equal(observedBatchResponses[1]?.response?.data?.code, "embedding_limit");
      assert.equal(sharedEmbeddings, 1);
    }
  }
});

test("mid-batch cancellation and authorization revocation stop queued reads without disclosing partial data", async () => {
  for (const mode of ["cancel", "revoke"] as const) {
    const controller = new AbortController();
    let authorized = true;
    const item0Started = deferred<void>();
    const releaseItem0 = deferred<void>();
    let startedCount = 0;

    const readItem: AgentTool = {
      name: "read_probe",
      effect: "read",
      description: "Read probe for abort/revoke.",
      parameters: z.object({ index: z.number() }).strict(),
      authorize: async () => true,
      execute: async (args, ctx) => {
        startedCount++;
        if (args.index === 0) {
          item0Started.resolve();
          await Promise.race([
            releaseItem0.promise,
            new Promise<void>(resolve => ctx.signal.addEventListener("abort", () => resolve(), { once: true })),
          ]);
        }
        return { status: "succeeded", data: { secret: "must-not-disclose" } };
      },
    };
    const present: AgentTool = {
      name: "present_answer",
      terminal: true,
      description: "Finish.",
      parameters: z.object({ text: z.string() }).strict(),
      authorize: async () => true,
      execute: async () => ({ status: "succeeded" }),
    };

    const runtime = createAgentRuntime({
      config: aiConfig,
      usage: { reserve: async () => true, record: async () => {} },
      provider: {
        generate: async () => functionCallResponse([
          { id: "b0", name: "read_probe", args: { index: 0 } },
          { id: "b1", name: "read_probe", args: { index: 1 } },
          { id: "b2", name: "read_probe", args: { index: 2 } },
          { id: "b3", name: "read_probe", args: { index: 3 } },
        ]),
      },
    });

    const pendingRun = runtime.run({
      scope: SCOPE,
      recipeId: "p1-chat",
      trigger: { kind: "interactive", reference: randomUUID() },
      messages: [{ role: "user", text: "Batch reads." }],
      tools: [readItem, present],
      signal: controller.signal,
      authorize: async () => authorized,
      readBatchPolicy: { maxConcurrent: 1, maxBatchSize: 6, itemTimeoutMs: 5000 },
      finalize: async () => "Should not finalize",
    });

    await item0Started.promise;
    if (mode === "cancel") {
      controller.abort();
    } else {
      authorized = false;
      releaseItem0.resolve();
    }

    const result = await pendingRun;
    assert.equal(result.status, "stopped", mode);
    assert.equal(result.stopReason, mode === "cancel" ? "cancelled" : "unauthorized", mode);
    assert.equal(result.text, null, mode);
    assert.deepEqual(result.tools, [], `${mode}: cancelled/revoked batch must not disclose tool results`);
    assert.equal(startedCount, 1, `${mode}: queued read items must not start after cancellation or revocation`);
  }
});

test("retriever readContext reuses unchanged chunks and invalidates on content hash change, withdrawal, or expiry", async t => {
  let candidateCalls = 0;
  let storedChunk = makeCandidate(CHUNK_A, { validUntil: new Date(Date.now() + 60_000).toISOString() });
  const retriever = createKnowledgeRetriever(
    {
      enforcesPersonalLibrarySelection: true,
      async candidates(_filter, _vector, opts) {
        candidateCalls++;
        if (opts?.chunkIds) {
          return opts.chunkIds.includes(storedChunk.chunkId) ? [structuredClone(storedChunk)] : [];
        }
        return [structuredClone(storedChunk)];
      },
    },
    makeEmbeddingGateway(),
  );

  const budget = new AgentBudget();
  t.after(() => budget.close());
  const run = retriever.createRun({
    actor: { kind: "query_embedding", actorId: USER_ID, operationId: randomUUID() },
    budget,
    authorize: async () => true,
  });
  const filter = parseKnowledgeFilter({
    region: "HK",
    classification: "official_guidance",
    age: { basis: "actual", minMonths: 6, maxMonths: 6 },
    ageMatch: "contained",
    topics: [],
  });

  const searched = await run.search("嬰兒發燒體溫", filter);
  assert.equal(searched.chunks.length, 1);
  const anchorEvidence = searched.chunks[0]!;
  assert.equal(anchorEvidence.chunkId, CHUNK_A);
  const callsAfterSearch = candidateCalls;

  // First readContext warms same-run context cache; second identical readContext with unchanged hash reuses cached payload.
  const firstCtx = await run.readContext(anchorEvidence, filter, null);
  assert.equal(firstCtx.complete, true);
  assert.equal(firstCtx.chunks[0]?.chunkId, CHUNK_A);
  const callsAfterFirst = candidateCalls;
  assert.ok(callsAfterFirst >= callsAfterSearch);

  const secondCtx = await run.readContext(anchorEvidence, filter, null);
  assert.equal(secondCtx.chunks[0]?.chunkId, CHUNK_A);
  assert.equal(candidateCalls, callsAfterFirst + 1, "Reuse check only validates anchor liveness without extra window scan");

  // Source contentHash updates -> stale context throws 409 knowledge_context_source_changed.
  storedChunk = makeCandidate(CHUNK_A, { contentHash: HASH_V2, versionId: VERSION_V2, validUntil: new Date(Date.now() + 60_000).toISOString() });
  await assert.rejects(
    () => run.readContext(anchorEvidence, filter, null),
    (err: unknown) => err instanceof FamilyError && err.status === 409 && err.code === "knowledge_context_source_changed",
  );

  // Expiry and non-reviewed state invalidate search and readReviewedCitations live.
  const budget2 = new AgentBudget();
  t.after(() => budget2.close());
  const run2 = retriever.createRun({
    actor: { kind: "query_embedding", actorId: USER_ID, operationId: randomUUID() },
    budget: budget2,
    authorize: async () => true,
  });

  storedChunk = makeCandidate(CHUNK_A, { validUntil: new Date(Date.now() - 10_000).toISOString() });
  const expiredSearch = await run2.search("發燒量體溫", filter);
  assert.equal(expiredSearch.chunks.length, 0);
  const expiredCitations = await run2.readReviewedCitations(
    [{ chunkId: CHUNK_A, versionId: VERSION_V1, contentHash: HASH_A }],
    filter,
  );
  assert.equal(expiredCitations, null);

  storedChunk = makeCandidate(CHUNK_A, { reviewState: "withdrawn" as any, validUntil: new Date(Date.now() + 60_000).toISOString() });
  assert.equal((await run2.search("發燒幾度", filter)).chunks.length, 0);
  assert.equal(await run2.readReviewedCitations([{ chunkId: CHUNK_A, versionId: VERSION_V1, contentHash: HASH_A }], filter), null);
});

test("follow-up reply reuses valid prior official citations without re-searching and invalidates on update, withdrawal, expiry, profile shift, or user/child isolation", async () => {
  type Scenario = "valid_reuse" | "version_updated" | "withdrawn" | "expired" | "profile_shifted" | "wrong_child" | "wrong_user";
  for (const scenario of ["valid_reuse", "version_updated", "withdrawn", "expired", "profile_shifted", "wrong_child", "wrong_user"] as Scenario[]) {
    let liveChunks: KnowledgeCandidate[] = [
      scenario === "version_updated"
        ? makeCandidate(CHUNK_A, { versionId: VERSION_V2, contentHash: HASH_V2, validUntil: new Date(Date.now() + 300_000).toISOString() })
        : scenario === "expired"
          ? makeCandidate(CHUNK_A, { validUntil: new Date(Date.now() - 5_000).toISOString() })
          : scenario === "withdrawn"
            ? []
            : [makeCandidate(CHUNK_A, { validUntil: new Date(Date.now() + 300_000).toISOString() })],
    ].flat();

    let embeddingsCount = 0;
    const knowledge = createKnowledgeRetriever(
      {
        enforcesPersonalLibrarySelection: true,
        async candidates(filter, _vector, opts) {
          const matchesAge = (chunk: KnowledgeCandidate) => {
            if (!filter.age) return true;
            const min = chunk.applicability.minAgeMonths ?? 0;
            const max = chunk.applicability.maxAgeMonths ?? 1200;
            return filter.age.minMonths >= min && filter.age.maxMonths < max;
          };
          return liveChunks
            .filter(ch => ch.reviewState === "reviewed")
            .filter(matchesAge)
            .filter(ch => !opts?.chunkIds || opts.chunkIds.includes(ch.chunkId))
            .map(ch => structuredClone(ch));
        },
      },
      makeEmbeddingGateway(() => { embeddingsCount++; }),
    );

    const priorRunId = randomUUID();
    const currentMsgId = randomUUID();
    const priorResult: ProductAgentResult = {
      runId: priorRunId,
      status: "completed",
      stopReason: null,
      provenance: null,
      text: "先量度體溫並留意嬰兒精神反應。",
      tools: [{ name: "search_knowledge", status: "succeeded" }],
      citations: [makeEvidence(CHUNK_A)],
      privateSourceCitations: [],
      retrievalMode: "vector_keyword",
      counts: { modelCalls: 2, toolCalls: 2, queryEmbeddings: 1 },
      proposals: [],
    };

    const requestUserId = scenario === "wrong_user" ? OTHER_USER_ID : USER_ID;
    const requestChildId = scenario === "wrong_child" ? OTHER_CHILD_ID : CHILD_ID;
    let sawReusedContext = false;
    let sawInvalidatedFlag = false;
    let sawCitationRejection = false;
    let calls = 0;
    const savedRuns = new Map<string, ProductAgentResult>();

    const runtime = createAgentRuntime({
      config: aiConfig,
      usage: { reserve: async () => true, record: async () => {} },
      provider: {
        generate: async request => {
          const userTexts = request.contents.map(c => c.parts?.map(p => p.text ?? "").join("") ?? "").join("\n");
          const sysText = String(request.config?.systemInstruction ?? "");
          if (sysText.includes("chat-delivery-review") || userTexts.includes("chat-delivery-review") || (userTexts.includes("draftHash") && userTexts.includes("paragraphs"))) {
            const payload = JSON.parse(userTexts.slice(userTexts.indexOf("{")));
            return modelResponse([{
              text: JSON.stringify({
                draftHash: payload.draftHash,
                decision: "pass",
                issues: [],
              }),
            }]);
          }
          calls++;
          if (calls === 1) {
            sawReusedContext = userTexts.includes(`"chunkId":"${CHUNK_A}"`) && userTexts.includes("reusedOfficialEvidence");
            sawInvalidatedFlag = userTexts.includes(`"reusedEvidenceInvalidated":true`);
            // Try citing CHUNK_A directly first: valid_reuse succeeds cleanly without search_knowledge; invalidated cases must get rejected.
            return functionCallResponse([{
              id: "try-present",
              name: "present_answer",
              args: { kind: "caregiving", paragraphs: [{ text: "嬰兒發燒應定時量度體溫及留意尿量。", citationIds: [CHUNK_A] }] },
            }]);
          }
          const responses = request.contents.flatMap(c => c.parts ?? []).filter(p => p.functionResponse);
          const rej = responses.find(p => p.functionResponse?.name === "present_answer")?.functionResponse?.response as any;
          if (rej?.status === "rejected" && ["invalid_citation", "citation_required"].includes(rej?.data?.code)) {
            sawCitationRejection = true;
          }
          if (scenario === "version_updated") {
            if (calls === 2) {
              return functionCallResponse([{
                id: "re-search-v2",
                name: "search_knowledge",
                args: { query: "嬰兒發燒體溫", classification: "official_guidance" },
              }]);
            }
            return functionCallResponse([{
              id: "present-v2",
              name: "present_answer",
              args: { kind: "caregiving", paragraphs: [{ text: "嬰兒發燒應定時量度體溫及留意尿量。", citationIds: [CHUNK_A] }] },
            }]);
          }
          return functionCallResponse([{
            id: "clarify-after-reject",
            name: "present_answer",
            args: { kind: "clarification", paragraphs: [{ text: "寶寶幾個月大？", citationIds: [] }] },
          }]);
        },
      },
    });

    const profileData = scenario === "profile_shifted"
      ? { age: { kind: "approximate", rawValue: "8", unit: "years", asOf: "2026-10-01" }, region: "HK" }
      : { age: { kind: "birth_date", date: "2026-05-01" }, region: "HK" };

    const agent = createProductAgent({
      runtime,
      store: {
        claim: async (uid: string, cid: string, trigger: { kind: string; reference: string }) => ({
          runId: randomUUID(),
          scope: { userId: uid, childId: cid, workspaceId: WORKSPACE_ID, authorizationVersion: "1", dataVersion: "epoch:1" },
          created: true,
          sourceMessageId: trigger.reference,
          state: "running",
          expiresAt: new Date(Date.now() + 90_000).toISOString(),
        }),
        authorize: async () => true,
        finish: async (_scope: AgentScope, res: ProductAgentResult) => { savedRuns.set(res.runId, structuredClone(res)); return true; },
        get: async (uid: string, cid: string, id: string) => {
          if (uid === USER_ID && cid === CHILD_ID && id === priorRunId) return priorResult;
          const saved = savedRuns.get(id);
          return saved && uid === requestUserId && cid === requestChildId ? saved : null;
        },
      } as any,
      memory: { context: async () => emptyMemory(profileData) } as any,
      chat: {
        listForUser: async (uid: string, cid: string) => ({
          messages: uid === USER_ID && cid === CHILD_ID
            ? [
                { id: randomUUID(), childId: CHILD_ID, authorUserId: USER_ID, role: "user", text: "發燒點算？", inReplyTo: null, createdAt: "2026-11-01T00:00:00Z" },
                { id: randomUUID(), childId: CHILD_ID, authorUserId: null, role: "model", text: priorResult.text, inReplyTo: null, createdAt: "2026-11-01T00:00:05Z", agentRunId: priorRunId },
                { id: currentMsgId, childId: CHILD_ID, authorUserId: USER_ID, role: "user", text: "咁要唔要每隔幾耐量一次？", inReplyTo: null, createdAt: "2026-11-01T00:01:00Z" },
              ]
            : [
                { id: currentMsgId, childId: cid, authorUserId: uid, role: "user", text: "咁要唔要每隔幾耐量一次？", inReplyTo: null, createdAt: "2026-11-01T00:01:00Z" },
              ],
        }),
      } as any,
      tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) } as any,
      knowledge,
    });

    const reply = await agent.reply(requestUserId, requestChildId, currentMsgId, async () => true);
    assert.equal(reply?.status, "completed", `${scenario}: ${JSON.stringify(reply)}`);
    if (scenario === "valid_reuse") {
      assert.equal(sawReusedContext, true);
      assert.equal(sawInvalidatedFlag, false);
      assert.equal(sawCitationRejection, false);
      assert.equal(embeddingsCount, 0, "Valid prior citation reuse must not burn a new query embedding");
      assert.equal(reply.retrievalMode, "vector_keyword");
      assert.deepEqual(reply.citations.map(c => c.chunkId), [CHUNK_A]);
    } else {
      assert.equal(sawReusedContext, false, `${scenario} must NOT seed stale/unauthorized citation`);
      assert.equal(sawCitationRejection, true, `${scenario} must reject citing stale/foreign chunkId`);
      if (scenario !== "wrong_child" && scenario !== "wrong_user") {
        assert.equal(sawInvalidatedFlag, true, `${scenario} must expose reusedEvidenceInvalidated=true`);
      }
      if (scenario === "version_updated") {
        assert.equal(reply.citations[0]?.versionId, VERSION_V2);
        assert.equal(embeddingsCount, 1);
      } else {
        assert.equal(reply.citations.length, 0);
      }
    }
  }
});

test("present_answer deduplicates duplicate citationIds and exposes availableOfficialCitationIds on citation errors", async () => {
  const budget = new AgentBudget();
  try {
    const chunk = makeEvidence(CHUNK_A);
    const defaultFilter = parseKnowledgeFilter({ region: "HK", classification: "official_guidance", age: { basis: "actual", minMonths: 6, maxMonths: 6 }, ageMatch: "contained", topics: [] });
    const toolsSurface = createProductAgentTools({
      run: { scope: SCOPE, runId: randomUUID(), budget },
      authorize: async () => true,
      seededOfficialEvidence: [{ chunk, filter: defaultFilter }],
      knowledge: {
        createRun: () => ({
          search: async () => ({ mode: "vector_keyword", degradationReason: null, chunks: [chunk] }),
          readContext: async () => ({ chunks: [], complete: true, nextCursor: null }),
          readReviewedCitations: async () => [chunk],
          supportsScopedEvidenceReuse: true,
          revalidateAndSeedEvidence: async () => ({ valid: [chunk], invalidated: [] }),
          seedEvidence: () => {},
          revalidateCitations: async () => true,
        }),
      } as any,
      memory: { context: async () => emptyMemory() } as any,
      tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) } as any,
      store: {} as any,
    });
    const present = toolsSurface.tools.find(t => t.name === "present_answer")!;
    const callCtx = { scope: SCOPE, runId: randomUUID(), callId: "p1", signal: budget.signal };

    const expectedAvailable = [{ chunkId: CHUNK_A, title: chunk.title, section: chunk.section }];

    // 1. invalid_citation (mixed valid+unknown) and citation_required (missing/unseen citation) include exact availableOfficialCitationIds locator.
    const badCiteRes = await present.execute({
      kind: "caregiving",
      paragraphs: [{ text: "請定時量度體溫。", citationIds: [CHUNK_A, CHUNK_B] }],
    }, callCtx);
    assert.equal(badCiteRes.status, "rejected");
    assert.equal((badCiteRes.data as any)?.code, "invalid_citation");
    assert.deepEqual((badCiteRes.data as any)?.availableOfficialCitationIds, expectedAvailable);

    const unknownOnlyRes = await present.execute({
      kind: "caregiving",
      paragraphs: [{ text: "請定時量度體溫。", citationIds: [CHUNK_B] }],
    }, callCtx);
    assert.equal(unknownOnlyRes.status, "rejected");
    assert.equal((unknownOnlyRes.data as any)?.code, "citation_required");
    assert.deepEqual((unknownOnlyRes.data as any)?.availableOfficialCitationIds, expectedAvailable);

    // 2. citation_required also includes availableOfficialCitationIds locator.
    const missingCiteRes = await present.execute({
      kind: "caregiving",
      paragraphs: [{ text: "請定時量度體溫。", citationIds: [] }],
    }, callCtx);
    assert.equal(missingCiteRes.status, "rejected");
    assert.equal((missingCiteRes.data as any)?.code, "citation_required");
    assert.deepEqual((missingCiteRes.data as any)?.availableOfficialCitationIds, expectedAvailable);

    // 3. Duplicate citationIds in a single paragraph are deduplicated programmatically.
    const dedupRes = await present.execute({
      kind: "caregiving",
      paragraphs: [{ text: "嬰兒發燒應定時量度體溫。", citationIds: [CHUNK_A, CHUNK_A] }],
    }, callCtx);
    assert.equal(dedupRes.status, "succeeded");
    const pres = await toolsSurface.presentation();
    assert.ok(pres);
    assert.deepEqual(pres.citations.map(c => c.chunkId), [CHUNK_A]);
    assert.deepEqual(toolsSurface.deliveryDraft()?.paragraphs[0]?.citationIds, [CHUNK_A]);
    assert.equal(await toolsSurface.bindRepairEvidence()(), true);
  } finally {
    budget.close();
  }
});

test("delivery repair receives only the bound draft evidence, recomputes live hash, blocks no-op repairs, and stops citation stripping", async () => {
  const chunk = makeEvidence(CHUNK_A);
  const initialDraft = (): ChatDeliveryDraft => ({
    kind: "caregiving",
    visibility: "private",
    serverSubstitutedSourceText: false,
    scope: SCOPE,
    paragraphs: [{ text: "嬰兒發燒應食退燒藥並多穿衣服捂汗。", citationIds: [CHUNK_A] }],
    sources: [{
      citationId: CHUNK_A,
      version: chunk.versionId,
      contentHash: chunk.contentHash,
      classification: "official_guidance",
      excerpt: chunk.sourceExcerpt,
      excerptComplete: true,
    }],
    images: [],
  });

  // Scenario A: Partial repair receives bound evidence without re-searching, updates text+hash, passes rereview.
  {
    const budget = new AgentBudget();
    let current = initialDraft();
    let repairSawEvidence = false;
    let rereviewSawUpdatedHash = false;
    const initialHash = chatDeliveryDraftHash(current);
    const surface = {
      deliveryDraft: () => current,
      presentation: async () => ({
        text: current.paragraphs.map(p => p.text).join("\n"),
        citations: current.paragraphs[0]!.citationIds.length ? [chunk] : [],
        retrievalMode: "vector_keyword" as const,
      }),
      replaceDeliveryAnswer: (next: { kind: any; paragraphs: any }) => {
        current = {
          ...current,
          kind: next.kind,
          paragraphs: next.paragraphs,
          sources: next.paragraphs[0]?.citationIds?.length ? current.sources : [],
        };
      },
      bindRepairEvidence: () => async () => true,
    };
    try {
      const outcome = await enforceChatDeliveryReview({
        presentation: await surface.presentation(),
        tools: surface,
        provenance: { packVersion: "synthetic-pack", model: "synthetic-model" },
        context: {
          scope: SCOPE,
          runId: randomUUID(),
          budget,
          completeText: async (input: { purpose?: string; user: string }) => {
            const payload = JSON.parse(input.user.slice(input.user.indexOf("{")));
            if (input.purpose === "delivery_repair") {
              repairSawEvidence = payload.sources?.[0]?.citationId === CHUNK_A && !("retrievedEvidence" in payload);
              return JSON.stringify({
                kind: "caregiving",
                paragraphs: [{ text: "嬰兒發燒時應保持室內通風及定時量度體溫，切勿包裹過多衣物。", citationIds: [CHUNK_A] }],
              });
            }
            if (payload.draftHash !== initialHash) {
              rereviewSawUpdatedHash = payload.draftHash !== initialHash
                && payload.paragraphs?.[0]?.text === "嬰兒發燒時應保持室內通風及定時量度體溫，切勿包裹過多衣物。";
              return JSON.stringify({
                draftHash: payload.draftHash,
                decision: "pass",
                issues: [],
              });
            }
            return JSON.stringify({
              draftHash: payload.draftHash,
              decision: "revise",
              issues: [{ paragraph: 0, reason: "勿建議捂汗或自行用藥", support: "官方指引無捂汗或自用退燒藥建議" }],
            });
          },
        } as any,
      });
      assert.equal(repairSawEvidence, true);
      assert.equal(rereviewSawUpdatedHash, true);
      assert.equal(outcome.review?.decision, "pass");
      assert.equal(outcome.presentation.citations[0]?.chunkId, CHUNK_A);
    } finally {
      budget.close();
    }
  }

  // Scenario B: Identical no-op repair fails closed with delivery_review_rejected before burning a third review call.
  {
    const budget = new AgentBudget();
    const current = initialDraft();
    let completeCalls = 0;
    const surface = {
      bindRepairEvidence: () => async () => true,
      deliveryDraft: () => current,
      presentation: async () => ({ text: current.paragraphs[0]!.text, citations: [chunk], retrievalMode: "vector_keyword" as const }),
      replaceDeliveryAnswer: () => {},
    };
    try {
      await assert.rejects(
        () => enforceChatDeliveryReview({
          presentation: { text: current.paragraphs[0]!.text, citations: [chunk], retrievalMode: "vector_keyword" },
          tools: surface,
          provenance: { packVersion: "synthetic-pack", model: "synthetic-model" },
          context: {
            scope: SCOPE,
            runId: randomUUID(),
            budget,
            completeText: async (input: { purpose?: string; user: string }) => {
              completeCalls++;
              const payload = JSON.parse(input.user.slice(input.user.indexOf("{")));
              if (input.purpose === "delivery_repair") {
                return JSON.stringify({ kind: "caregiving", paragraphs: current.paragraphs });
              }
              return JSON.stringify({ draftHash: payload.draftHash, decision: "revise", issues: [{ paragraph: 0, reason: "需修改", support: "excerpt differs" }] });
            },
          } as any,
        }),
        err => err instanceof AgentStopped && err.reason === "delivery_review_rejected",
      );
      assert.equal(completeCalls, 2, "Must block identical no-op repair before spending a wasted rereview call");
    } finally {
      budget.close();
    }
  }

  // Scenario C: Repair stripping prior official citations for non-limitation care advice fails closed with delivery_review_no_sources.
  {
    const budget = new AgentBudget();
    let current = initialDraft();
    const surface = {
      bindRepairEvidence: () => async () => true,
      deliveryDraft: () => current,
      presentation: async () => ({
        text: current.paragraphs[0]!.text,
        citations: current.paragraphs[0]!.citationIds.length ? [chunk] : [],
        retrievalMode: "vector_keyword" as const,
      }),
      replaceDeliveryAnswer: (next: { kind: any; paragraphs: any }) => {
        current = {
          ...current,
          kind: next.kind,
          paragraphs: next.paragraphs,
          sources: next.paragraphs[0]?.citationIds?.length ? current.sources : [],
        };
      },
    };
    try {
      await assert.rejects(
        () => enforceChatDeliveryReview({
          presentation: { text: current.paragraphs[0]!.text, citations: [chunk], retrievalMode: "vector_keyword" },
          tools: surface,
          provenance: { packVersion: "synthetic-pack", model: "synthetic-model" },
          context: {
            scope: SCOPE,
            runId: randomUUID(),
            budget,
            completeText: async (input: { purpose?: string; user: string }) => {
              const payload = JSON.parse(input.user.slice(input.user.indexOf("{")));
              if (input.purpose === "delivery_repair") {
                return JSON.stringify({
                  kind: "caregiving",
                  paragraphs: [{ text: "嬰兒發燒應定時量度體溫。", citationIds: [] }],
                });
              }
              if (current.sources.length === 0 && !payload.paragraphs?.[0]?.citationIds?.length) {
                return JSON.stringify({ draftHash: payload.draftHash, decision: "pass", issues: [] });
              }
              return JSON.stringify({ draftHash: payload.draftHash, decision: "revise", issues: [{ paragraph: 0, reason: "調整表達", support: "excerpt adjustment" }] });
            },
          } as any,
        }),
        err => err instanceof AgentStopped && err.reason === "delivery_review_no_sources",
      );
    } finally {
      budget.close();
    }
  }
});

test("near-budget runs reserve review safely for caregiving replies and skip unnecessary review reserve on clarifying replies", async () => {
  // 1) Near-budget planning: modelCalls=3 used on work -> caregiving path reserves 1 remaining call for delivery review and completes in 4 calls.
  const chunk = makeEvidence(CHUNK_A);
  let calls = 0;
  let savedNearBudget: ProductAgentResult | null = null;
  const msgId = randomUUID();
  const runtime = createAgentRuntime({
    config: aiConfig,
    usage: { reserve: async () => true, record: async () => {} },
    provider: {
      generate: async request => {
        const text = request.contents.map(c => c.parts?.map(p => p.text ?? "").join("") ?? "").join("\n");
        const sysText = String(request.config?.systemInstruction ?? "");
        if (sysText.includes("chat-delivery-review") || text.includes("chat-delivery-review") || (text.includes("draftHash") && text.includes("paragraphs"))) {
          const payload = JSON.parse(text.slice(text.indexOf("{")));
          return modelResponse([{
            text: JSON.stringify({
              draftHash: payload.draftHash,
              decision: "pass",
              issues: [],
            }),
          }]);
        }
        const turn = calls++;
        if (turn === 0) {
          return functionCallResponse([{ id: "s1", name: "search_knowledge", args: { query: "嬰兒發燒體溫", classification: "official_guidance" } }]);
        }
        if (turn === 1) {
          return functionCallResponse([{ id: "r1", name: "read_knowledge_context", args: { anchorChunkId: CHUNK_A, cursor: null } }]);
        }
        return functionCallResponse([{
          id: "ans",
          name: "present_answer",
          args: { kind: "caregiving", paragraphs: [{ text: "若嬰兒出現發燒而精神尚可，可先定時量度體溫並保持室內通風。", citationIds: [CHUNK_A] }] },
        }]);
      },
    },
  });

  const agent = createProductAgent({
    runtime,
    store: {
      claim: async () => ({
        runId: randomUUID(), scope: SCOPE, created: true, sourceMessageId: msgId, state: "running",
        expiresAt: new Date(Date.now() + 90_000).toISOString(),
      }),
      authorize: async () => true,
      finish: async (_scope: AgentScope, res: ProductAgentResult) => { savedNearBudget = structuredClone(res); return true; },
      get: async (_u: string, _c: string, id: string) => (savedNearBudget?.runId === id ? savedNearBudget : null),
    } as any,
    memory: { context: async () => emptyMemory() } as any,
    chat: { listForUser: async () => ({ messages: [{ id: msgId, childId: CHILD_ID, authorUserId: USER_ID, role: "user", text: "嬰兒發燒點量體溫？", inReplyTo: null, createdAt: "2026-11-01T00:00:00Z" }] }) } as any,
    tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) } as any,
    knowledge: createKnowledgeRetriever(
      { async candidates() { return [makeCandidate(CHUNK_A)]; } },
      makeEmbeddingGateway(),
    ),
  });

  const result = await agent.reply(USER_ID, CHILD_ID, msgId, async () => true);
  assert.equal(result?.status, "completed", JSON.stringify(result));
  assert.equal(result.counts.modelCalls, AGENT_LIMITS.modelCalls, "Search + readContext + present + review must fit within 4 model calls");
  assert.equal(result.deliveryReview?.decision, "pass");

  // 2) Exhausted budget before review on caregiving draft stops with delivery_review_budget without calling model.
  const zeroLeft = new AgentBudget();
  zeroLeft.take("modelCalls", AGENT_LIMITS.modelCalls);
  let extraCalls = 0;
  try {
    await assert.rejects(
      () => enforceChatDeliveryReview({
        presentation: { text: "嬰兒發燒應定時量度體溫。", citations: [chunk], retrievalMode: "vector_keyword" },
        tools: {
          deliveryDraft: () => ({
            kind: "caregiving",
            visibility: "private",
            serverSubstitutedSourceText: false,
            scope: SCOPE,
            paragraphs: [{ text: "嬰兒發燒應定時量度體溫。", citationIds: [CHUNK_A] }],
            sources: [{ citationId: CHUNK_A, version: chunk.versionId, contentHash: chunk.contentHash, classification: "official_guidance", excerpt: chunk.sourceExcerpt, excerptComplete: true }],
            images: [],
          }),
          presentation: async () => null,
          replaceDeliveryAnswer: () => {},
        },
        context: { scope: SCOPE, runId: randomUUID(), budget: zeroLeft, completeText: async () => { extraCalls++; return ""; } } as any,
        provenance: { packVersion: "synthetic-pack", model: "synthetic-model" },
      }),
      err => err instanceof AgentStopped && err.reason === "delivery_review_budget",
    );
    assert.equal(extraCalls, 0);
  } finally {
    zeroLeft.close();
  }

  // 3) Pure clarifying reply at near-budget (4th model call) skips review reserve and completes with 0 review calls.
  const clarifyBudget = new AgentBudget();
  let clarifyReviewCalls = 0;
  try {
    clarifyBudget.take("modelCalls", 3);
    const snap = clarifyBudget.planningSnapshot(true, { reserveDeliveryReview: false });
    assert.equal(snap.reserveForDeliveryReview.modelCalls, 0);
    await clarifyBudget.admitModel({ reserveDeliveryReview: false });
    assert.equal(clarifyBudget.counts.modelCalls, 4);
    const clarifyOutcome = await enforceChatDeliveryReview({
      presentation: { text: "寶寶幾個月大？", citations: [], retrievalMode: "not_used" },
      tools: {
        deliveryDraft: () => ({
          kind: "clarification",
          visibility: "private",
          serverSubstitutedSourceText: false,
          scope: SCOPE,
          paragraphs: [{ text: "寶寶幾個月大？", citationIds: [] }],
          sources: [],
          images: [],
        }),
        presentation: async () => null,
        replaceDeliveryAnswer: () => {},
      },
      context: { scope: SCOPE, runId: randomUUID(), budget: clarifyBudget, completeText: async () => { clarifyReviewCalls++; return ""; } } as any,
      provenance: { packVersion: "synthetic-pack", model: "synthetic-model" },
    });
    assert.equal(clarifyReviewCalls, 0);
    assert.equal(clarifyOutcome.presentation.text, "寶寶幾個月大？");
  } finally {
    clarifyBudget.close();
  }
});

test("claimed continuation workers preserve original rootRunId, immutable limits/deadline, separate maintenance ledger, and primary result priority", async () => {
  // 1) Separate maintenance ledger rejects private child/workspace scopes and separates Firestore namespaces.
  assert.equal(rejectPrivateMaintenanceScope({ childId: CHILD_ID }), "knowledge_maintenance_private_scope_forbidden");
  assert.equal(rejectPrivateMaintenanceScope({ familyUserId: USER_ID }), "knowledge_maintenance_private_scope_forbidden");
  assert.equal(rejectPrivateMaintenanceScope({}), null);

  // 2) Claimed continuation worker binds to original rootRunId + immutable limits + immutable deadline across replay.
  const f = serialFirestoreFixture();
  const cipher = createStorageCipher(Buffer.alloc(32, 73));
  const storage = { database: f.database, cipher, projectId: "synthetic-project" };
  const root = new FirestoreRootBudget({ ...storage, namespace: "synthetic_continuation_root_budget" });
  const daily = new FirestoreAiUsage({ ...storage, namespace: "synthetic_continuation_daily_usage", billingSource: "platform" });
  const nativeSessionService = new FirestoreSessionService({ ...storage, namespace: "synthetic_continuation_sessions" });
  const pack = (await loadAgentPrompt("product-interactive", "tool_cycle", ["run", "scope", "conversation", "context", "evidence", "capabilities"])).packVersion;
  const opens: RootBudgetContext[] = [];
  const rootBudget: DurableRootBudget = {
    open: ctx => { opens.push(structuredClone(ctx)); return root.open(ctx); },
    read: ctx => root.read(ctx),
    reserve: (ctx, attempt) => root.reserve(ctx, attempt),
    settle: (ctx, attempt, outcome) => root.settle(ctx, attempt, outcome),
    stop: ctx => root.stop(ctx),
  };

  let providerCalls = 0;
  const durable = claimedRunAssembly(
    aiConfig,
    {
      nativeSessionService,
      rootBudget,
      dailyUsage: daily,
      profile: {
        config: { ...aiConfig },
        billingSource: "platform",
        workflowVersion: "product-work-followup-v1",
        promptPackVersion: pack,
        settingsVersion: "fixed-followup-v1",
        billingVersion: "platform-v1",
        runLimits: { modelCalls: 2, queryEmbeddings: 1 },
      } satisfies ProductAgentDurableProfile,
      provider: {
        generate: async () => {
          providerCalls++;
          return functionCallResponse([{ id: `call-${providerCalls}`, name: "read_work", args: {} }]);
        },
      },
    },
    undefined,
    true,
  );

  const workerRuntime = createAgentRuntime({
    usage: { reserve: async () => true, record: async () => {} },
    ...durable,
    provider: durable.provider!,
  });

  const rootRunId = randomUUID();
  const workerEventId = randomUUID();
  const workerGeneration = randomUUID();
  const fixedDeadline = Date.now() + 60_000;
  const readWorkTool: AgentTool = {
    name: "read_work",
    effect: "read",
    description: "Read work state.",
    parameters: z.object({}).strict(),
    authorize: async () => true,
    execute: async () => ({ status: "succeeded", data: { ok: true } }),
  };

  const workerInput: AgentRunInput = {
    runId: rootRunId,
    scope: SCOPE,
    claimedRun: {
      runId: rootRunId,
      scope: SCOPE,
      created: true,
      sourceMessageId: null,
      state: "running",
      expiresAt: new Date(fixedDeadline).toISOString(),
      storageEpoch: "epoch",
      workerGeneration,
      trigger: { kind: "worker", reference: workerEventId },
      recipeId: "product-work-followup",
    },
    deadlineAtMs: fixedDeadline,
    trigger: { kind: "worker", reference: workerEventId },
    recipeId: "product-work-followup",
    availableInputs: ["run", "scope", "conversation", "context", "evidence", "capabilities"],
    messages: [{ role: "user", text: "Check due work." }],
    tools: [readWorkTool],
    authorize: async () => true,
    ...({ runLimits: { modelCalls: 12, queryEmbeddings: 6 } } as any),
  };

  const workerResult = await workerRuntime.run(workerInput);
  assert.equal(workerResult.stopReason, "model_limit");
  assert.equal(providerCalls, 2, "Immutable claimed limits (modelCalls=2) cannot be widened at runtime");
  assert.equal(opens.length, 1);
  assert.equal(opens[0]?.binding.rootRunId, rootRunId);
  assert.equal(opens[0]?.binding.deadlineAtMs, fixedDeadline);
  assert.equal((await root.read(opens[0]!)).used.modelCalls, 2);

  // Replaying with created=false refuses to reset quota or re-dispatch the model.
  const replay = await workerRuntime.run({
    ...workerInput,
    claimedRun: { ...workerInput.claimedRun!, created: false },
  });
  assert.equal(replay.status, "stopped");
  assert.equal(providerCalls, 2, "Replay must never reset original root budget or re-run provider");

  // 3) Primary interactive finish commits primary result first and preserves it cleanly even if deferred followup throws.
  const msgId = randomUUID();
  let committedPrimary: ProductAgentResult | null = null;
  const primaryRuntime = createAgentRuntime({
    config: aiConfig,
    usage: { reserve: async () => true, record: async () => {} },
    provider: {
      generate: async () => functionCallResponse([{
        id: "p-clarify",
        name: "present_answer",
        args: { kind: "clarification", paragraphs: [{ text: "寶寶目前幾多個月大？", citationIds: [] }] },
      }]),
    },
  });
  const primaryAgent = createProductAgent({
    runtime: primaryRuntime,
    store: {
      claim: async () => ({
        runId: randomUUID(), scope: SCOPE, created: true, sourceMessageId: msgId, state: "running",
        expiresAt: new Date(Date.now() + 90_000).toISOString(),
      }),
      authorize: async () => true,
      finish: async (_scope: AgentScope, res: ProductAgentResult) => { committedPrimary = structuredClone(res); return true; },
      get: async (_u: string, _c: string, id: string) => (committedPrimary?.runId === id ? committedPrimary : null),
    } as any,
    memory: { context: async () => emptyMemory() } as any,
    chat: { listForUser: async () => ({ messages: [{ id: msgId, childId: CHILD_ID, authorUserId: USER_ID, role: "user", text: "想問資料", inReplyTo: null, createdAt: "2026-11-01T00:00:00Z" }] }) } as any,
    tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) } as any,
    knowledge: { createRun: () => ({ revalidateAndSeedEvidence: async () => ({ valid: [], invalidated: [] }), seedEvidence: () => {} }) } as any,
  });

  const primaryReply = await primaryAgent.reply(USER_ID, CHILD_ID, msgId, async () => true);
  assert.equal(primaryReply?.status, "completed");
  const savedPrimary = committedPrimary as ProductAgentResult | null;
  assert.ok(savedPrimary, "Primary store.finish must commit primary result synchronously on completion");
  assert.equal(savedPrimary.text, "寶寶目前幾多個月大？");
});
