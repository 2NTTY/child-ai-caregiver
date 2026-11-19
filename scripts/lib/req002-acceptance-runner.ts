import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { FieldValue, VectorValue, type Firestore, type VectorQueryOptions } from "@google-cloud/firestore";
import { FinishReason } from "@google/genai";
import { z } from "zod";
import { readAiConfig, type AiConfig } from "../../server/ai-config.ts";
import { createAgentRuntime, type AgentScope, type AgentTool } from "../../server/agent-runtime.ts";
import type { AgentModelProvider } from "../../server/agent-model-gateway.ts";
import type { AgentDiagnostic } from "../../server/agent-observer.ts";
import { createEmbeddingGateway, type EmbeddingProvider } from "../../server/embedding-gateway.ts";
import { createFirestoreKnowledgeStore, type FirestoreKnowledgeEmbedding } from "../../server/firestore-knowledge.ts";
import { embeddingDocument, parseKnowledgeSource } from "../../server/knowledge-inputs.ts";
import { createKnowledgeRetriever } from "../../server/knowledge-retriever.ts";
import { createProductAgent } from "../../server/product-agent.ts";
import { handleProductAgentRequest } from "../../server/product-agent-api.ts";
import type { ProductAgentStore } from "../../server/product-agent-store.ts";
import { buildLocalOfficialSeedAssessment, LOCAL_OFFICIAL_SEED_IDS } from "../local-knowledge-assessments.ts";
import { firestoreDomainFixture } from "../../tests/helpers/firestore-domain-memory.ts";
import { createChatApi, type ChatApi } from "../../src/client/chat-api.ts";
import { ChatController } from "../../src/client/chat-controller.ts";
import { reconcileAgentProgress, toAgentProgressSource, type AgentProgress } from "../../src/shared/agent-feedback.ts";
import type { ChatMessage, ChatReplyState } from "../../src/shared/chat.ts";
import { KNOWLEDGE_EMBEDDING, type KnowledgeCandidate, type KnowledgeSourceInput } from "../../src/shared/knowledge.ts";
import type { MemoryContext } from "../../src/shared/memory.ts";
import type { ProductAgentResult } from "../../src/shared/product-agent.ts";
import { productAgentResultSchema } from "../../src/shared/product-agent-result.ts";
import {
  REQ002_CORE_SCENARIOS,
  REQ002_LIVE_UNSUPPORTED,
  checkReq002ScriptedAnswer,
  buildSanitizedAcceptanceReceipt,
  classifyTerminalCategory,
  createProviderBoundaryGuard,
  createRunMilestoneTracker,
  observeReq002Reply,
  findCanaryLeaks,
  inspectCaseCHelpMatch,
  verifyCitedVersionsInStore,
  type Req002AcceptanceReceipt,
  type Req002BudgetCaps,
} from "../../server/req002-acceptance-harness.ts";

function deterministicSeedVector(text: string): number[] {
  const values = new Array<number>(KNOWLEDGE_EMBEDDING.dimensions).fill(0);
  const cues: [RegExp, number][] = [
    [/固體食物|米糊|鐵質|引入|六個月|四個月|solid|iron|feeding|6\s*months/iu, 0],
    [/兩個月|未足四個月|過早/iu, 1],
    [/發燒|嘔吐|退燒|急症|fever|vomit/iu, 2],
    [/視力|眼睛|護眼|普查|vision/iu, 3],
    [/學前|幼兒|遊戲|語言|發展|development|preschool|toddler/iu, 4],
  ];
  for (const [pattern, bucket] of cues) {
    values[bucket] = pattern.test(text) ? 1 : 0.1;
  }
  const norm = Math.sqrt(values.reduce((sum, item) => sum + item * item, 0)) || 1;
  return values.map(item => item / norm);
}

/** Seeds all 5 curated HK official sources into an in-memory vector-enabled Firestore double. */
export async function createSeededOfficialKnowledgeStore() {
  const rawSeed = JSON.parse(
    await readFile(new URL("../../knowledge/hk-official-seed.json", import.meta.url), "utf8"),
  ) as unknown[];
  const sources: KnowledgeSourceInput[] = rawSeed.map(item => parseKnowledgeSource(item));
  const fake = firestoreDomainFixture();

  const encode = (value: unknown): unknown => value instanceof VectorValue
    ? { syntheticVector: value.toArray() }
    : Array.isArray(value)
      ? value.map(encode)
      : value && typeof value === "object"
        ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v)]))
        : value;
  const decode = (value: unknown): unknown => value && typeof value === "object"
    && Object.keys(value).length === 1 && "syntheticVector" in value
    && Array.isArray((value as { syntheticVector: unknown }).syntheticVector)
    ? FieldValue.vector((value as { syntheticVector: number[] }).syntheticVector)
    : Array.isArray(value)
      ? value.map(decode)
      : value && typeof value === "object"
        ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, decode(v)]))
        : value;

  type FakeSnapshot = { exists?: boolean; id?: string; ref?: unknown; updateTime?: unknown; data(): unknown; get?: (k: string) => unknown };
  const snap = (s: FakeSnapshot) => ({
    ...s,
    data: () => decode(s.data()),
    get: (k: string) => decode(s.get ? s.get(k) : undefined),
  });

  type FakeQuery = {
    path?: string;
    filters?: [string, string, unknown][];
    where(key: string, op: string, value: unknown): FakeQuery;
    findNearest(opts: VectorQueryOptions): { get(): Promise<{ docs: { id: string; data(): unknown }[] }> };
  };

  const wrapQuery = (q: FakeQuery): FakeQuery => ({
    ...q,
    where: (key: string, op: string, value: unknown) => wrapQuery(q.where(key, op, value)),
    findNearest: (opts: VectorQueryOptions) => ({
      async get() {
        const qVec = opts.queryVector instanceof VectorValue ? opts.queryVector.toArray() : (opts.queryVector as number[]);
        const basePath = String((q as { path?: string }).path ?? "");
        const filters = (q as { filters?: [string, string, unknown][] }).filters ?? [];
        const docs = [...fake.records.entries()]
          .filter(([path]) => path.startsWith(basePath + "/"))
          .map(([path, raw]) => ({ path, row: decode(raw) as Record<string, unknown> }))
          .filter(({ row }) => filters.every(([k, op, v]) => (op === "==" ? row[k] === v : op === "in" && Array.isArray(v) && v.includes(row[k]))))
          .map(({ path, row }) => {
            const vec = (row.embedding as VectorValue).toArray();
            const dot = vec.reduce((sum, val, idx) => sum + val * (qVec[idx] ?? 0), 0);
            const nA = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
            const nB = Math.sqrt(qVec.reduce((s, v) => s + v * v, 0)) || 1;
            const distance = 1 - Math.max(-1, Math.min(1, dot / (nA * nB)));
            return { id: path.split("/").at(-1)!, row: { ...row, [opts.distanceResultField as string]: distance }, distance };
          })
          .filter(item => item.distance <= (opts.distanceThreshold ?? 2))
          .sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id))
          .slice(0, opts.limit)
          .map(item => ({ id: item.id, data: () => item.row }));
        return { docs };
      },
    }),
  });

  type FakeTx = {
    get(target: unknown): Promise<FakeSnapshot>;
    getAll(...targets: unknown[]): Promise<FakeSnapshot[]>;
    create(ref: unknown, val: unknown): unknown;
    set(ref: unknown, val: unknown): unknown;
    delete(ref: unknown): unknown;
  };
  const database = {
    collection: (path: string) => wrapQuery(fake.database.collection(path) as unknown as FakeQuery),
    runTransaction: (op: (tx: unknown) => Promise<unknown>) => fake.database.runTransaction(async rawTx => {
      const tx = rawTx as unknown as FakeTx;
      return op({
        get: async (target: unknown) => snap(await tx.get(target)),
        getAll: async (...targets: unknown[]) => (await tx.getAll(...targets)).map(snap),
        create: (ref: unknown, val: unknown) => tx.create(ref, encode(val)),
        set: (ref: unknown, val: unknown) => tx.set(ref, encode(val)),
        delete: (ref: unknown) => tx.delete(ref),
      });
    }),
  } as unknown as Firestore;

  const store = createFirestoreKnowledgeStore({
    database,
    projectId: "synthetic-req002-acceptance",
    namespace: "req002_acceptance",
    sourceIds: [...LOCAL_OFFICIAL_SEED_IDS],
  });

  const manifest = JSON.parse(
    await readFile(new URL("../../knowledge/local-development-seed.json", import.meta.url), "utf8"),
  ) as { sourceId?: string; versionHash?: string; assessment?: unknown };

  const publishedChunksByKey = new Map<string, { sourceId: string; chunkId: string; versionId: string; contentHash: string; text: string }>();

  for (const source of sources) {
    const imported = await store.importSource(source);
    for (let page = 0; page < 16; page += 1) {
      if ((await store.prepareSearch(imported.versionId, imported.hash)).complete) break;
    }
    await store.review(imported.versionId, imported.hash, "req002-seeded-acceptance", buildLocalOfficialSeedAssessment(source, manifest));
    const vectors: FirestoreKnowledgeEmbedding[] = [];
    for (const chunk of source.chunks) {
      const vec = deterministicSeedVector(`${source.title} ${chunk.section} ${chunk.text} ${chunk.keywords.join(" ")}`);
      vectors.push({
        chunkKey: chunk.key,
        inputHash: embeddingDocument(source.title, chunk.section, chunk.text).hash,
        ...KNOWLEDGE_EMBEDDING,
        values: vec,
      });
    }
    await store.publish(imported.versionId, imported.hash, vectors);
    const liveCandidates = await store.candidates(
      { region: "HK", classification: source.classification, age: { basis: "actual", minMonths: 0, maxMonths: 120 }, ageMatch: "overlap", topics: [] },
      null,
      { limit: 32 },
    );
    for (const row of liveCandidates.filter(c => c.sourceId === source.sourceId)) {
      publishedChunksByKey.set(`${row.sourceId}:${row.key}`, {
        sourceId: row.sourceId,
        chunkId: row.chunkId,
        versionId: row.versionId,
        contentHash: row.contentHash,
        text: row.text,
      });
    }
  }

  async function readChunkByIdentity(chunk: { chunkId: string; sourceId: string; versionId: string; contentHash: string }): Promise<KnowledgeCandidate | null> {
    const rows = await store.candidates(
      { region: "HK", classification: "official_guidance", age: { basis: "actual", minMonths: 0, maxMonths: 120 }, ageMatch: "overlap", topics: [] },
      null,
      { chunkIds: [chunk.chunkId], limit: 4 },
    );
    return rows.find(item => item.chunkId === chunk.chunkId && item.versionId === chunk.versionId && item.contentHash === chunk.contentHash) ?? null;
  }

  return { store, sources, publishedChunksByKey, readChunkByIdentity };
}

function createScriptedOfflineSliceModel(
  publishedChunksByKey: Map<string, { sourceId: string; chunkId: string; versionId: string; contentHash: string; text: string }>,
): AgentModelProvider {
  const solidChunk = publishedChunksByKey.get("fhs-solid-food:starting-solids");
  assert.ok(solidChunk, "Seeded fhs-solid-food:starting-solids chunk is required");

  return {
    async generate(request) {
      const allParts = request.contents.flatMap(content => content.parts ?? []);
      const joined = allParts.map(part => part.text ?? "").join("\n");
      const scenarioMarkers = [
        ["greeting", REQ002_CORE_SCENARIOS.greetingShortPath],
        ["caseA", REQ002_CORE_SCENARIOS.halfYearSolidFoodWithCanary],
        ["caseB", REQ002_CORE_SCENARIOS.twoMonthRestriction],
        ["caseC", REQ002_CORE_SCENARIOS.uncoveredFeverVomiting],
      ] as const;
      const activeScenario = scenarioMarkers
        .map(([key, marker]) => ({ key, idx: joined.lastIndexOf(marker) }))
        .filter(item => item.idx >= 0)
        .sort((a, b) => b.idx - a.idx)[0]?.key ?? "caseC";
      const reviewPayloadText = allParts.find(part => part.text?.startsWith("Server evidence payload for chat-delivery-review."))?.text;
      if (reviewPayloadText) {
        const body = JSON.parse(reviewPayloadText.slice(reviewPayloadText.indexOf("{"))) as { draftHash: string; paragraphs: { text: string; citationIds: string[] }[]; sources: unknown[] };
        const hasMissingSources = body.paragraphs.some(p => /發燒|嘔吐|固體食物/u.test(p.text) && p.citationIds.length === 0 && !/未收錄|沒有涵蓋/u.test(p.text));
        return {
          content: {
            role: "model",
            parts: [{
              text: JSON.stringify({
                draftHash: body.draftHash,
                decision: hasMissingSources ? "reject" : "pass",
                issues: hasMissingSources ? [{ paragraph: 0, reason: "Missing supporting official citations", support: "No official fever/vomiting source provided" }] : [],
              }),
            }],
          },
          finishReason: FinishReason.STOP,
          usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 28, totalTokenCount: 148 },
        };
      }

      if (activeScenario === "greeting") {
        return {
          content: {
            role: "model",
            parts: [{
              functionCall: {
                id: "call-greeting",
                name: "present_answer",
                args: { kind: "clarification", paragraphs: [{ text: "你好，不客氣！有咩可以幫到你？", citationIds: [] }] },
              },
              thoughtSignature: "opaque-greeting",
            }],
          },
          finishReason: FinishReason.STOP,
          usageMetadata: { promptTokenCount: 90, candidatesTokenCount: 20, totalTokenCount: 110 },
        };
      }

      const fnResponses = allParts.flatMap(part => part.functionResponse ? [part.functionResponse] : []);
      const searchRes = fnResponses.find(res => res.name === "search_knowledge")?.response as { status?: string; data?: { result?: { chunks?: { chunkId: string }[] } } } | undefined;

      if (activeScenario === "caseA") {
        if (!searchRes) {
          return {
            content: {
              role: "model",
              parts: [{
                functionCall: {
                  id: "call-search-solid",
                  name: "search_knowledge",
                  args: { query: "半歲嬰兒 準備好 開始食固體食物", classification: "official_guidance" },
                },
                thoughtSignature: "opaque-search-solid",
              }],
            },
            finishReason: FinishReason.STOP,
            usageMetadata: { promptTokenCount: 180, candidatesTokenCount: 24, totalTokenCount: 204 },
          };
        }
        return {
          content: {
            role: "model",
            parts: [{
              functionCall: {
                id: "call-present-solid",
                name: "present_answer",
                args: {
                  kind: "caregiving",
                  paragraphs: [{
                    text: "嬰兒一般大約六個月大可按個人發展留意是否準備好嘗試固體食物；未足四個月大的寶寶不應吃奶以外的食物，如仍有個別準備條件或健康疑問應另查適用資料或諮詢醫護人員。",
                    citationIds: [solidChunk.chunkId],
                  }],
                },
              },
              thoughtSignature: "opaque-present-solid",
            }],
          },
          finishReason: FinishReason.STOP,
          usageMetadata: { promptTokenCount: 220, candidatesTokenCount: 48, totalTokenCount: 268 },
        };
      }

      if (activeScenario === "caseB") {
        if (!searchRes) {
          return {
            content: {
              role: "model",
              parts: [{
                functionCall: {
                  id: "call-search-2m",
                  name: "search_knowledge",
                  args: { query: "兩個月 嬰兒 固體食物 米糊 年齡限制", classification: "official_guidance" },
                },
                thoughtSignature: "opaque-search-2m",
              }],
            },
            finishReason: FinishReason.STOP,
            usageMetadata: { promptTokenCount: 170, candidatesTokenCount: 22, totalTokenCount: 192 },
          };
        }
        return {
          content: {
            role: "model",
            parts: [{
              functionCall: {
                id: "call-present-2m",
                name: "present_answer",
                args: {
                  kind: "caregiving",
                  paragraphs: [{
                    text: "根據衞生署官方指引，未足四個月大的寶寶不應吃奶以外的食物，因此兩個月大暫時不應開始餵食米糊或固體食物。",
                    citationIds: [solidChunk.chunkId],
                  }],
                },
              },
              thoughtSignature: "opaque-present-2m",
            }],
          },
          finishReason: FinishReason.STOP,
          usageMetadata: { promptTokenCount: 210, candidatesTokenCount: 44, totalTokenCount: 254 },
        };
      }

      // Case C: Uncovered fever + vomiting — searches public query, sees no matching fever chunk, reports scope gap & medical-consult help without fabricating citations.
      if (!searchRes) {
        return {
          content: {
            role: "model",
            parts: [{
              functionCall: {
                id: "call-search-fever",
                name: "search_knowledge",
                args: { query: "嬰兒 發高燒 嘔吐", classification: "official_guidance" },
              },
              thoughtSignature: "opaque-search-fever",
            }],
          },
          finishReason: FinishReason.STOP,
          usageMetadata: { promptTokenCount: 165, candidatesTokenCount: 22, totalTokenCount: 187 },
        };
      }
      const hasShowHelp = fnResponses.some(res => res.name === "show_official_help");
      if (!hasShowHelp) {
        return {
          content: {
            role: "model",
            parts: [{
              functionCall: {
                id: "call-help-medical",
                name: "show_official_help",
                args: { card: "medical-consult-hk-v1" },
              },
              thoughtSignature: "opaque-help-med",
            }],
          },
          finishReason: FinishReason.STOP,
          usageMetadata: { promptTokenCount: 190, candidatesTokenCount: 18, totalTokenCount: 208 },
        };
      }
      return {
        content: {
          role: "model",
          parts: [{
            functionCall: {
              id: "call-present-gap",
              name: "present_answer",
              args: {
                kind: "clarification",
                paragraphs: [{
                  text: "暫未收錄此情況的官方資料。",
                  citationIds: [],
                }],
              },
            },
            thoughtSignature: "opaque-present-gap",
          }],
        },
        finishReason: FinishReason.STOP,
        usageMetadata: { promptTokenCount: 215, candidatesTokenCount: 42, totalTokenCount: 257 },
      };
    },
  };
}

/** In-memory HTTP/SSE product harness used by the scripted offline suite. */
export function createProductAgentHttpHarness(input: {
  config: AiConfig;
  provider: AgentModelProvider;
  embeddingProvider: EmbeddingProvider;
  knowledgeStore: Awaited<ReturnType<typeof createSeededOfficialKnowledgeStore>>["store"];
  onDiagnostic?: (event: AgentDiagnostic) => void;
}) {
  const userId = "owner-req002-test";
  const childId = randomUUID();
  const origin = "https://acceptance.example.test";
  const scope: AgentScope = {
    userId,
    childId,
    workspaceId: "ws-req002",
    authorizationVersion: "1",
    dataVersion: "epoch:1",
  };

  let authorizedChild = true;
  const messages: ChatMessage[] = [];
  const runResults = new Map<string, ProductAgentResult>();
  const runByMessage = new Map<string, string>();
  const claims = new Map<string, string>();

  const embeddings = createEmbeddingGateway({
    config: input.config,
    usage: { reserve: async () => true, record: async () => {} },
    provider: input.embeddingProvider,
  });

  const runtime = createAgentRuntime({
    config: input.config,
    usage: { reserve: async () => true, record: async () => {} },
    provider: input.provider,
    embeddings,
    diagnostics: input.onDiagnostic,
  });

  const store = {
    async claim(_uid: string, _cid: string, trigger: { kind: string; reference: string }) {
      const existing = claims.get(trigger.reference);
      if (existing) {
        return { runId: existing, scope, created: false, expiresAt: new Date(Date.now() + 90_000).toISOString() };
      }
      const runId = randomUUID();
      claims.set(trigger.reference, runId);
      runByMessage.set(trigger.reference, runId);
      return { runId, scope, created: true, expiresAt: new Date(Date.now() + 90_000).toISOString() };
    },
    async authorize() { return authorizedChild; },
    async finish(_scope: AgentScope, result: ProductAgentResult) {
      const parsed = productAgentResultSchema.parse(JSON.parse(JSON.stringify(result)));
      runResults.set(parsed.runId, parsed);
      return true;
    },
    async get(_uid: string, _cid: string, runId: string) {
      const finished = runResults.get(runId);
      if (finished) return finished;
      if ([...claims.values()].includes(runId)) {
        return {
          runId,
          provenance: null,
          status: "running",
          text: "",
          citations: [],
          retrievalMode: "not_used",
          tools: [],
          countsKnown: false,
          proposals: [],
        } as unknown as ProductAgentResult;
      }
      return null;
    },
    async replyState(_uid: string, _cid: string, messageId: string): Promise<ChatReplyState | null> {
      const runId = runByMessage.get(messageId);
      if (!runId) return null;
      const saved = runResults.get(runId);
      return {
        messageId,
        runId,
        status: saved ? (saved.status as ChatReplyState["status"]) : "running",
        stopReason: saved?.stopReason ?? null,
      };
    },
    async cancelReply() { return true; },
    async backgroundRuns() { return []; },
    async pendingProposals() { return { items: [], nextCursor: null }; },
    async readHistory() { return null; },
    async searchHistory() { return { matches: [], complete: true, cursor: null }; },
    async readWork() { return null; },
  } as unknown as ProductAgentStore;

  const chat = {
    async listForUser(_uid: string, cid: string) {
      if (!authorizedChild || cid !== childId) return null;
      return { messages: [...messages], limit: 100, nextCursor: null };
    },
    async createUserMessageForUser(_uid: string, cid: string, text: string) {
      if (!authorizedChild || cid !== childId) return null;
      const msg: ChatMessage = {
        id: randomUUID(),
        childId,
        authorUserId: userId,
        role: "user",
        text,
        inReplyTo: null,
        createdAt: new Date().toISOString(),
      };
      messages.push(msg);
      return msg;
    },
    async createModelMessageForUser(_uid: string, cid: string, inReplyTo: string, text: string) {
      if (!authorizedChild || cid !== childId) return null;
      const runId = runByMessage.get(inReplyTo);
      const msg: ChatMessage = {
        id: randomUUID(),
        childId,
        authorUserId: null,
        role: "model",
        text,
        inReplyTo,
        ...(runId ? { agentRunId: runId } : {}),
        createdAt: new Date().toISOString(),
      };
      messages.push(msg);
      return msg;
    },
  };

  const memory = {
    async context() {
      return {
        profile: { childId, version: 0, data: null },
        profileApplicable: false,
        facts: [],
        topics: [],
        summary: null,
        recentMessages: [],
        conflictingKeys: [],
        unavailableFactKeys: [],
        truncated: { facts: false, topics: false, messages: false },
      } as unknown as MemoryContext;
    },
  };

  const agent = createProductAgent({
    runtime,
    store,
    chat: chat as never,
    memory: memory as never,
    tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) },
    knowledge: createKnowledgeRetriever(input.knowledgeStore, embeddings),
  });

  const handle = async (request: Request): Promise<Response> => {
    const pathname = new URL(request.url).pathname;
    if (pathname.startsWith("/api/children/") && (pathname.includes("/reply") || pathname.includes("/agent/"))) {
      return handleProductAgentRequest(request, userId, {
        agent,
        store,
        chat: chat as never,
        isCurrentUser: async expected => expected === userId,
      });
    }
    if (pathname === "/api/ai/status") return Response.json({ available: true });
    if (pathname === "/api/ai/usage") {
      return Response.json({ day: "2026-11-19", attempts: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, unknownUsageAttempts: 0 });
    }
    return Response.json({ error: { code: "not_found", message: "找不到。" } }, { status: 404 });
  };

  return {
    userId,
    childId,
    origin,
    chat,
    store,
    agent,
    handle,
    getClaimedRunId: (messageId: string) => runByMessage.get(messageId) ?? null,
    getRunResult: (messageId: string) => {
      const runId = runByMessage.get(messageId);
      return runId ? runResults.get(runId) ?? null : null;
    },
    setAuthorized: (allowed: boolean) => { authorizedChild = allowed; },
  };
}

/**
 * Verifies an in-memory HTTP/SSE stream disconnect, reconnect recovery (`GET .../reply`),
 * out-of-order frame deduplication, stopped card retention, and 403 revocation cleanup.
 */
export async function runSseDisconnectAndRecoverySuite(): Promise<Req002AcceptanceReceipt["sseDisconnectRecovery"]> {
  const seed = await createSeededOfficialKnowledgeStore();
  const solidChunk = seed.publishedChunksByKey.get("fhs-solid-food:starting-solids")!;
  const config = readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-sse-project" });

  let releaseSecondModelTurn!: () => void;
  const secondTurnGate = new Promise<void>(resolve => { releaseSecondModelTurn = resolve; });
  let secondTurnReached = false;
  let postReplyCalls = 0;

  const sseModel: AgentModelProvider = {
    async generate(request) {
      const parts = request.contents.flatMap(content => content.parts ?? []);
      const reviewText = parts.find(p => p.text?.startsWith("Server evidence payload for chat-delivery-review."))?.text;
      if (reviewText) {
        const body = JSON.parse(reviewText.slice(reviewText.indexOf("{"))) as { draftHash: string };
        return {
          content: { role: "model", parts: [{ text: JSON.stringify({ draftHash: body.draftHash, decision: "pass", issues: [] }) }] },
          finishReason: FinishReason.STOP,
        };
      }
      const hasSearch = parts.some(p => p.functionResponse?.name === "search_knowledge");
      if (!hasSearch) {
        return {
          content: {
            role: "model",
            parts: [{ functionCall: { id: "c-search", name: "search_knowledge", args: { query: "六個月 固體食物", classification: "official_guidance" } } }],
          },
          finishReason: FinishReason.STOP,
        };
      }
      secondTurnReached = true;
      await secondTurnGate;
      return {
        content: {
          role: "model",
          parts: [{
            functionCall: {
              id: "c-present",
              name: "present_answer",
              args: {
                kind: "caregiving",
                paragraphs: [{ text: "嬰兒約六個月大可開始留意是否準備好嘗試固體食物。", citationIds: [solidChunk.chunkId] }],
              },
            },
          }],
        },
        finishReason: FinishReason.STOP,
      };
    },
  };

  const harness = createProductAgentHttpHarness({
    config,
    provider: sseModel,
    embeddingProvider: {
      embed: async req => ({ values: deterministicSeedVector(req.text), inputTokens: 4, billableCharacters: req.text.length }),
    },
    knowledgeStore: seed.store,
  });

  const userMsg = await harness.chat.createUserMessageForUser(harness.userId, harness.childId, "BB 半歲食固體食物要注意咩？");
  assert.ok(userMsg);

  let serverResponsePromise!: Promise<Response>;
  let abortedMidStream = false;
  const preAbortPhases: string[] = [];
  let retainedSourcesBeforeAbort = 0;

  // Streaming fetch adapter that passes early SSE frames through and forcibly drops the stream before `type: "result"`.
  const fetcher: typeof fetch = async (inputUrl, init) => {
    const url = typeof inputUrl === "string" ? inputUrl : inputUrl instanceof URL ? inputUrl.toString() : inputUrl.url;
    const req = new Request(url, init);
    if (req.method === "POST" && url.endsWith("/reply")) {
      postReplyCalls += 1;
      serverResponsePromise = harness.handle(req);
      const serverRes = await serverResponsePromise;
      const upstream = serverRes.body!.getReader();
      const decoder = new TextDecoder();
      const proxied = new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (abortedMidStream) return;
          const { value, done } = await upstream.read();
          if (done) {
            controller.close();
            return;
          }
          const chunkText = decoder.decode(value, { stream: true });
          const frames = chunkText.split("\n\n").filter(Boolean);
          for (const frame of frames) {
            if (!frame.startsWith("data: ")) continue;
            const payload = JSON.parse(frame.slice(6)) as { type?: string; progress?: AgentProgress };
            if (payload.type === "progress" && payload.progress) {
              preAbortPhases.push(payload.progress.phase);
              if (payload.progress.sources?.length) {
                retainedSourcesBeforeAbort = Math.max(retainedSourcesBeforeAbort, payload.progress.sources.length);
              }
              if (payload.progress.sources?.length) abortedMidStream = true;
            }
          }
          controller.enqueue(value); // Each upstream chunk is forwarded exactly once.
          if (abortedMidStream) {
            await upstream.cancel();
            setTimeout(() => controller.error(new Error("Synthetic mid-stream SSE disconnect")), 0);
          }
        },
        cancel: () => upstream.cancel(),
      });
      return new Response(proxied, { status: serverRes.status, headers: serverRes.headers });
    }
    if (url.endsWith("/messages")) {
      const page = await harness.chat.listForUser(harness.userId, harness.childId);
      return Response.json(page ?? { messages: [], limit: 100, nextCursor: null });
    }
    return harness.handle(req);
  };

  const api = createChatApi(harness.origin, async () => ({ id: harness.userId, name: "Owner", email: "owner@example.test" }), fetcher);
  const controller = new ChatController(api);
  let released = false;
  const releaseGate = () => {
    if (!released) {
      released = true;
      releaseSecondModelTurn();
    }
  };
  try {
    controller.syncContext(harness.userId, true, harness.childId);
    await new Promise(resolve => setTimeout(resolve, 10));

    await controller.requestReply(userMsg.id);
    assert.equal(abortedMidStream, true, "SSE stream must abort mid-flight right after source card frame");
    const snapAfterDrop = controller.getSnapshot();
    assert.equal(snapAfterDrop.remoteReply?.status, "running", "Mid-stream drop must retain remoteReply=running");
    assert.ok(snapAfterDrop.remoteReply?.runId);

    // Wait until server model enters second turn, then let background execution finish & persist.
    const turnDeadline = Date.now() + 5000;
    while (!secondTurnReached && Date.now() < turnDeadline) await new Promise(resolve => setTimeout(resolve, 5));
    assert.ok(secondTurnReached, "Gated offline model did not reach the second turn");
    releaseGate();
    const waitDeadline = Date.now() + 5000;
    while (Date.now() < waitDeadline) {
      const finishedRun = harness.getRunResult(userMsg.id);
      const savedPage = await harness.chat.listForUser(harness.userId, harness.childId);
      const hasSavedModel = savedPage?.messages.some(m => m.inReplyTo === userMsg.id && m.role === "model") ?? false;
      if (finishedRun && hasSavedModel) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    await serverResponsePromise;

    await controller.refreshOriginalReply();
    const afterRecovery = controller.getSnapshot();
    assert.equal(postReplyCalls, 1, "Recovering original reply must never issue a duplicate POST .../reply");
    assert.equal(afterRecovery.remoteReply, null);
    assert.ok(afterRecovery.messages.some(m => m.inReplyTo === userMsg.id && m.role === "model"));

    const savedRun = harness.getRunResult(userMsg.id);
    assert.ok(savedRun && savedRun.status === "completed");

    // Verify late/duplicate/mismatched runId sequence reconciliation.
    const rId = savedRun.runId;
    const sCard = toAgentProgressSource({ chunkId: solidChunk.chunkId, sourceId: solidChunk.sourceId, title: "Title", publisher: "FHS", sourceExcerpt: "Excerpt", url: "https://www.fhs.gov.hk/tc_chi/health_info/child/14727.html" }, "read")!;
    const stateRev = reconcileAgentProgress(null, { runId: rId, messageId: userMsg.id, phase: "reviewing", sequence: 4, sources: [sCard] });
    const ignoredSeq = reconcileAgentProgress(stateRev, { runId: rId, messageId: userMsg.id, phase: "searching", sequence: 2 });
    const ignoredWrongRun = reconcileAgentProgress(stateRev, { runId: randomUUID(), messageId: userMsg.id, phase: "model", sequence: 9 });
    const lateOutOfOrderIgnored = ignoredSeq === stateRev && ignoredWrongRun === stateRev;

    // Verify stopped/unknown state preserves qualified source cards and 403 revocation clears them.
    const revokedMsgId = randomUUID();
    let denyChild = false;
    const revokingApi: ChatApi = {
      ...api,
      listMessages: async () => {
        if (denyChild) throw new (await import("../../src/client/chat-api.ts")).ChatApiError(403, "unauthorized");
        return {
          messages: [{ id: revokedMsgId, childId: harness.childId, authorUserId: harness.userId, role: "user", text: "問緊固體食物", inReplyTo: null, createdAt: new Date().toISOString() }],
          limit: 100,
          nextCursor: null,
        };
      },
      requestReply: async (_c, m, _s, _u, onProgress) => {
        onProgress?.({ runId: rId, messageId: m, phase: "searching", sequence: 1, sources: [sCard] });
        onProgress?.({ runId: rId, messageId: m, phase: "reviewing", sequence: 2 });
        throw new (await import("../../src/client/chat-api.ts")).ChatApiError(503, "ai_unavailable");
      },
    };
    const revController = new ChatController(revokingApi);
    try {
      revController.syncContext(harness.userId, true, harness.childId);
      await new Promise(resolve => setTimeout(resolve, 10));
      await revController.requestReply(revokedMsgId);
      const afterStopped = revController.getSnapshot();
      const stoppedRetainsQualifiedCards = (afterStopped.feedback?.sources.length ?? 0) === 1
        && !afterStopped.messages.some(m => m.inReplyTo === revokedMsgId);
      denyChild = true;
      await revController.reloadMessages();
      const afterRevoke = revController.getSnapshot();
      const revocationClearedCards = afterRevoke.feedback === null;
      return {
        transport: "in_memory_http_sse",
        abortedMidStream,
        preAbortPhases,
        retainedSourcesBeforeAbort,
        duplicatePostCalls: postReplyCalls - 1,
        recoveredRunId: savedRun.runId,
        lateOutOfOrderIgnored,
        stoppedRetainsQualifiedCards,
        revocationClearedCards,
      };
    } finally {
      revController.dispose();
    }
  } finally {
    releaseGate();
    controller.dispose();
  }
}

/** Measures sequential multi-turn baseline vs single-turn bounded batching and warm query cache reuse. */
export async function runBaselineVsBoundedComparison(): Promise<Req002AcceptanceReceipt["baselineComparison"]> {
  const config = readAiConfig({ AI_ENABLED: "true", AI_AGENT_ENABLED: "true", GCP_PROJECT_ID: "synthetic-benchmark" });
  let embeddingsDispatched = 0;
  const cache = new Map<string, number[]>();
  const runWorkload = async (batched: boolean) => {
    const queryIds = ["q1", "q2", "q3"];
    let step = 0;
    const provider: AgentModelProvider = {
      async generate() {
        const s = step++;
        if (batched) {
          if (s === 0) {
            return {
              content: {
                role: "model",
                parts: queryIds.map(q => ({ functionCall: { id: "call-" + q, name: "probe_query", args: { q } } })),
              },
              finishReason: FinishReason.STOP,
            };
          }
          return {
            content: { role: "model", parts: [{ text: "done" }] },
            finishReason: FinishReason.STOP,
          };
        }
        if (s < queryIds.length) {
          return {
            content: { role: "model", parts: [{ functionCall: { id: "seq-" + s, name: "probe_query", args: { q: queryIds[s] } } }] },
            finishReason: FinishReason.STOP,
          };
        }
        return {
          content: { role: "model", parts: [{ text: "done" }] },
          finishReason: FinishReason.STOP,
        };
      },
    };
    const runtime = createAgentRuntime({ config, usage: { reserve: async () => true, record: async () => {} }, provider });
    const probe: AgentTool = {
      name: "probe_query",
      effect: "read",
      description: "Read-only query probe.",
      parameters: z.object({ q: z.string() }).strict(),
      authorize: async () => true,
      execute: async args => {
        const key = String(args.q);
        if (!cache.has(key)) {
          embeddingsDispatched += 1;
          cache.set(key, deterministicSeedVector(key));
        }
        return { status: "succeeded", data: { q: key } };
      },
    };
    return runtime.run({
      scope: { userId: "bench", childId: "child", workspaceId: "ws", authorizationVersion: "1", dataVersion: "1" },
      recipeId: "p1-chat",
      trigger: { kind: "interactive", reference: randomUUID() },
      messages: [{ role: "user", text: "Compare three independent childcare questions." }],
      tools: [probe],
      authorize: async () => true,
      finalize: async result => result.text,
    });
  };

  const sequential = await runWorkload(false);
  assert.equal(sequential.status, "completed");
  const coldEmbeddings = embeddingsDispatched;
  const bounded = await runWorkload(true);
  assert.equal(bounded.status, "completed");
  const warmReusedEmbeddings = coldEmbeddings - (embeddingsDispatched - coldEmbeddings);

  return {
    measurement: "scripted_provider_and_local_map",
    productCache: "not_measured",
    sampleSize: 1,
    sequentialBaselineModelCalls: sequential.counts.modelCalls,
    boundedBatchModelCalls: bounded.counts.modelCalls,
    modelCallReduction: Math.max(0, sequential.counts.modelCalls - bounded.counts.modelCalls),
    sequentialToolCalls: sequential.counts.toolCalls,
    boundedBatchToolCalls: bounded.counts.toolCalls,
    coldEmbeddings,
    warmReusedEmbeddings,
    note: "One scripted runtime pair with a probe-local Map, not a production cache, live-provider speed measurement or latency distribution.",
  };
}

/** Runs the full REQ-002 acceptance verification suite (Case G, Case A, Case B, Case C, SSE disconnect, benchmark) and returns a sanitized receipt. */
export async function executeReq002AcceptanceSuite(options: {
  candidateSha: string;
  mode: "live" | "offline";
  config: AiConfig;
  providerName: string;
  rawProvider?: AgentModelProvider;
  rawEmbedding?: EmbeddingProvider;
  budgetCaps?: Partial<Req002BudgetCaps>;
  offlineGreetingOnly?: boolean;
}): Promise<Req002AcceptanceReceipt> {
  if (options.mode !== "offline") throw new Error(REQ002_LIVE_UNSUPPORTED);
  if (options.rawProvider || options.rawEmbedding) {
    throw new Error("Offline verification always uses the built-in scripted providers.");
  }
  const seed = await createSeededOfficialKnowledgeStore();
  const capturedLogs: string[] = [];
  const rawProvider = createScriptedOfflineSliceModel(seed.publishedChunksByKey);
  const rawEmbedding: EmbeddingProvider = {
    embed: async req => ({ values: deterministicSeedVector(req.text), inputTokens: 6, billableCharacters: req.text.length }),
  };

  const boundary = createProviderBoundaryGuard({
    caps: options.budgetCaps,
    provider: rawProvider,
    embedding: rawEmbedding,
    onLog: line => capturedLogs.push(line),
  });

  const harness = createProductAgentHttpHarness({
    config: options.config,
    provider: boundary.provider,
    embeddingProvider: boundary.embedding!,
    knowledgeStore: seed.store,
    onDiagnostic: event => {
      capturedLogs.push(JSON.stringify(event));
    },
  });

  const scenariosToRun: {
    id: string;
    text: string;
  }[] = options.offlineGreetingOnly
    ? [{ id: "case_g_greeting_short_path", text: REQ002_CORE_SCENARIOS.greetingShortPath }]
    : [
        { id: "case_a_half_year_solid_food", text: REQ002_CORE_SCENARIOS.halfYearSolidFoodWithCanary },
        { id: "case_b_two_month_restriction", text: REQ002_CORE_SCENARIOS.twoMonthRestriction },
        { id: "case_c_uncovered_fever_vomiting", text: REQ002_CORE_SCENARIOS.uncoveredFeverVomiting },
      ];

  const scenarioReceipts: Req002AcceptanceReceipt["scenarios"] = [];
  for (const item of scenariosToRun) {
    const previous = boundary.snapshot();
    if (previous.capBlocked || previous.runsStarted >= boundary.caps.maxRuns
      || previous.modelCalls >= boundary.caps.maxModelCalls) break;
    const callsBefore = previous.modelCalls;
    boundary.beginRun(item.id);
    const userMessage = await harness.chat.createUserMessageForUser(harness.userId, harness.childId, item.text);
    assert.ok(userMessage);

    const helpCheck = item.id === "case_c_uncovered_fever_vomiting"
      ? inspectCaseCHelpMatch(item.text)
      : { cards: [], respectsExistingEmergencyBoundaries: true };
    assert.equal(helpCheck.respectsExistingEmergencyBoundaries, true);

    const tracker = createRunMilestoneTracker();
    const sseRes = await harness.handle(new Request(`${harness.origin}/api/children/${harness.childId}/messages/${userMessage.id}/reply`, {
      method: "POST",
      headers: {
        origin: harness.origin,
        "content-type": "application/json",
        "x-expected-user-id": harness.userId,
        accept: "text/event-stream",
      },
      body: "{}",
    }));
    const isGreeting = item.id === "case_g_greeting_short_path";
    const deliveredText = await observeReq002Reply(sseRes, tracker, userMessage.id, () => harness.getClaimedRunId(userMessage.id), () => {
      const saved = harness.getRunResult(userMessage.id);
      // A/B owe independent review. A greeting or safe uncovered-topic limitation can
      // be cleared by the product's normal completion path without a review binding.
      const owesCitationReview = item.id === "case_a_half_year_solid_food" || item.id === "case_b_two_month_restriction";
      return saved?.status === "completed" && (!owesCitationReview || saved.deliveryReview?.decision === "pass") ? saved.runId : null;
    });

    const result = harness.getRunResult(userMessage.id);
    const replayBeforeCalls = boundary.snapshot().modelCalls;
    const getReplyRes = await harness.handle(new Request(`${harness.origin}/api/children/${harness.childId}/messages/${userMessage.id}/reply`, {
      method: "GET",
      headers: { "x-expected-user-id": harness.userId },
    }));
    const getReplyJson = getReplyRes.ok ? (await getReplyRes.json()) as { reply?: ChatReplyState | null } : null;
    const getReplyReplaySameRunId = Boolean(
      result
      && result.status !== "running"
      && getReplyJson?.reply?.runId === result.runId && getReplyJson.reply.status === result.status
      && getReplyJson.reply.messageId === userMessage.id
      && boundary.snapshot().modelCalls === replayBeforeCalls,
    );

    if (getReplyReplaySameRunId) tracker.markTerminalSettled();

    const citations = result?.citations ?? [];
    const originalVersionVerified = citations.length > 0
      ? await verifyCitedVersionsInStore(citations, chunk => seed.readChunkByIdentity(chunk))
      : false;

    // Report the actual product help events/tool receipts, never the expected classifier output.
    const helpCards = tracker.helpCards();
    for (const t of result?.tools ?? []) {
      if (t.name === "show_official_help" && t.status === "succeeded"
        && (t.reference === "medical-consult-hk-v1" || t.reference === "emergency-hk-v1") && !helpCards.includes(t.reference)) helpCards.push(t.reference);
    }

    scenarioReceipts.push({
      id: item.id,
      runId: result?.runId ?? null,
      status: result?.status ?? "not_observed",
      stopReason: result?.stopReason ?? null,
      terminalCategory: classifyTerminalCategory(result),
      retrievalMode: result?.retrievalMode ?? null,
      scriptedAnswerEvidence: checkReq002ScriptedAnswer(item.id, deliveredText,
        item.id === "case_b_two_month_restriction" && originalVersionVerified && citations[0]
          ? await seed.readChunkByIdentity(citations[0]) : null),
      cacheMode: isGreeting ? "not_applicable" : "not_measured",
      counts: result?.counts ?? { modelCalls: 0, toolCalls: 0, queryEmbeddings: 0 },
      providerBoundaryCalls: boundary.snapshot().modelCalls - callsBefore,
      reviewDecision: result?.deliveryReview?.decision ?? null,
      citedChunkIds: citations.map(c => c.chunkId),
      citedSourceIds: [...new Set(citations.map(c => c.sourceId))],
      originalVersionVerified,
      getReplyReplaySameRunId,
      deterministicHelpCards: helpCards,
      milestones: tracker.snapshot(),
    });
    const observed = boundary.snapshot();
    if (result?.status !== "completed" || !getReplyReplaySameRunId || observed.capBlocked
      || findCanaryLeaks([observed.searchQueryArgs, observed.embeddingPayloads, capturedLogs]).length) break;
  }

  const snap = boundary.snapshot();
  const outboundQueryLeakCount = findCanaryLeaks(snap.searchQueryArgs).length;
  const embeddingPayloadLeakCount = findCanaryLeaks(snap.embeddingPayloads).length;
  const diagnosticAndLogLeakCount = findCanaryLeaks(capturedLogs).length;

  const sseDisconnectRecovery = await runSseDisconnectAndRecoverySuite();
  const baselineComparison = await runBaselineVsBoundedComparison();

  return buildSanitizedAcceptanceReceipt({
    candidateSha: options.candidateSha,
    mode: "offline_scripted",
    suite: options.offlineGreetingOnly ? "offline_greeting_smoke" : "core_abc",
    provider: options.providerName,
    model: options.config.model,
    executedAt: new Date().toISOString(),
    budgetCaps: boundary.caps,
    totals: {
      capBlocked: snap.capBlocked,
      runsStarted: snap.runsStarted,
      modelCalls: snap.modelCalls,
      reviewOrRepairCalls: snap.reviewOrRepairCalls,
      queryEmbeddings: snap.queryEmbeddings,
      promptTokens: snap.promptTokens,
      candidateTokens: snap.candidateTokens,
      totalTokens: snap.totalTokens,
    },
    scenarios: scenarioReceipts,
    sseDisconnectRecovery,
    baselineComparison,
    outboundQueryLeakCount,
    embeddingPayloadLeakCount,
    diagnosticAndLogLeakCount,
  });
}
