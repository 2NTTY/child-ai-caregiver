import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import test from "node:test";
import { FinishReason } from "@google/genai";
import type { LlmRequest, LlmResponse } from "@google/adk";
import { createRequestHandler } from "../server/app.ts";
import { readAiConfig } from "../server/ai-config.ts";
import {
  enforceChatDeliveryReview,
  isPureChatOnlyModeBoundaryNotice,
  type ChatDeliveryDraft,
} from "../server/chat-delivery-review.ts";
import { createFirebaseRequestHandler } from "../server/firebase-app.ts";
import { createFirestoreAuthority } from "../server/firestore-authority.ts";
import { createFirestoreCareStore } from "../server/firestore-care.ts";
import { createFirestoreChatStore } from "../server/firestore-chat.ts";
import { createFirestoreKnowledgeStore } from "../server/firestore-knowledge.ts";
import { createFirestoreMemoryStore } from "../server/firestore-memory.ts";
import { createFirestoreOnlineStore } from "../server/firestore-online.ts";
import { createFirestoreProductAgentStore } from "../server/firestore-product-agent-store.ts";
import { createStorageCipher } from "../server/storage-crypto.ts";
import {
  createDurableUsageAdapterForTemporaryChat,
  createTemporaryChatService,
} from "../server/temporary-chat-agent.ts";
import { handleTemporaryChatRequest } from "../server/temporary-chat-api.ts";
import { createTemporaryChatStore } from "../server/temporary-chat-store.ts";
import { SERVICE_POLICY_VERSION } from "../src/shared/account-service.ts";
import type { KnowledgeCandidate, KnowledgeFilter } from "../src/shared/knowledge.ts";
import { TEMPORARY_CHAT_LIMITS } from "../src/shared/temporary-chat.ts";
import { firestoreDomainFixture } from "./helpers/firestore-domain-memory.ts";

const CHUNK_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "22222222-2222-4222-8222-222222222222";
const USER_A = "temp-user-a";
const USER_B = "temp-user-b";

function sampleCandidate(): KnowledgeCandidate {
  const text = "發燒照顧期間應讓孩子少量多次補充水分，並密切觀察精神與進食情況。";
  return {
    chunkId: CHUNK_ID,
    sourceId: "fhs-fever-hk",
    versionId: VERSION_ID,
    versionHash: "a".repeat(64),
    contentHash: "b".repeat(64),
    url: "https://www.fhs.gov.hk/tc_chi/health_info/child/fever.html",
    title: "兒童發燒護理指引",
    publisher: "香港衞生署家庭健康服務",
    classification: "official_guidance",
    sourcePublishedAt: "2026-01-01T00:00:00.000Z",
    sourceUpdatedAt: "2026-01-01T00:00:00.000Z",
    validUntil: null,
    fetchedAt: "2026-02-01T00:00:00.000Z",
    checkedAt: "2026-02-01T00:00:00.000Z",
    reviewState: "reviewed",
    key: "fever-hydration",
    section: "補水要點",
    sourceExcerpt: text,
    text,
    keywords: ["發燒", "補水", "飲水"],
    distance: 0.1,
    applicability: {
      region: "HK",
      ageBasis: "any",
      minAgeMonths: 0,
      maxAgeMonths: 72,
      topics: ["發燒", "護理"],
      conditions: [],
    },
  };
}

function modelTextResponse(text: string): LlmResponse {
  return {
    finishReason: FinishReason.STOP,
    content: { role: "model", parts: [{ text }] },
    usageMetadata: { promptTokenCount: 20, totalTokenCount: 35, cachedContentTokenCount: 0 },
  };
}

function toolCallResponse(name: string, args: Record<string, unknown>, id = "call-1"): LlmResponse {
  return {
    finishReason: FinishReason.STOP,
    content: { role: "model", parts: [{ functionCall: { id, name, args } }] },
    usageMetadata: { promptTokenCount: 20, totalTokenCount: 35, cachedContentTokenCount: 0 },
  };
}

function extractUserText(request: LlmRequest): string {
  const last = request.contents.at(-1);
  return (last?.parts ?? [])
    .map(part => (typeof part.text === "string" ? part.text : ""))
    .join("\n");
}

function extractToolResponses(request: LlmRequest) {
  return request.contents.flatMap(content =>
    (content.parts ?? [])
      .filter(part => Boolean(part.functionResponse))
      .map(part => part.functionResponse!),
  );
}

function jsonPost(path: string, body: unknown, userId: string | null = USER_A, expectedHeader: string | null = userId) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    origin: "https://synthetic.example.test",
  };
  if (expectedHeader !== null) {
    headers["x-expected-user-id"] = expectedHeader;
  }
  return new Request(`https://synthetic.example.test${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function buildScriptedHarness(options: {
  clock?: () => number;
  dailyUserAttempts?: number;
  onGenerate?: (request: LlmRequest, signal: AbortSignal) => Promise<LlmResponse>;
  onSearch?: (filter: KnowledgeFilter, selection: Record<string, unknown>) => KnowledgeCandidate[];
  onEmbed?: (text: string) => number[];
} = {}) {
  const clock = options.clock ?? Date.now;
  const store = createTemporaryChatStore({ clock, sweepIntervalMs: 0 });
  const providerCalls: Array<{
    isReview: boolean;
    system: string;
    contentsJson: string;
    toolNames: string[];
  }> = [];
  const searchSelections: Array<{
    filter: KnowledgeFilter;
    selection: { libraryUserId?: string; [key: string]: unknown };
  }> = [];
  const embedTexts: string[] = [];
  const usageRecords: Array<Record<string, unknown>> = [];
  let reserveAttempts = 0;

  const knowledge = {
    async candidates(
      filter: KnowledgeFilter,
      _vector: readonly number[] | null,
      selection: {
        libraryUserId?: string;
        query?: string;
        chunkIds?: string[];
        versionId?: string;
        afterKey?: string;
        limit?: number;
      } = {},
    ) {
      searchSelections.push({ filter, selection: { ...selection } });
      if (options.onSearch) return options.onSearch(filter, selection);
      return [sampleCandidate()];
    },
  };

  const baseConfig = readAiConfig({
    AI_ENABLED: "true",
    GCP_PROJECT_ID: "synthetic-temp-chat",
    AI_DAILY_USER_ATTEMPTS: String(options.dailyUserAttempts ?? 20),
    AI_DAILY_GLOBAL_ATTEMPTS: "100",
  });

  const service = createTemporaryChatService({
    store,
    knowledge,
    clock,
    resolveExecution: async () => {
      return {
        config: baseConfig,
        usage: {
          async getForUser() {
            return {
              day: "2026-11-20",
              attempts: reserveAttempts,
              inputTokens: 0,
              outputTokens: 0,
              cachedTokens: 0,
              unknownUsageAttempts: 0,
            };
          },
          async reserve(_uid, userLimit) {
            if (reserveAttempts >= userLimit) return false;
            reserveAttempts += 1;
            return true;
          },
          async record(attempt) {
            usageRecords.push({ ...attempt });
          },
        },
        embeddings: {
          async embed(input) {
            embedTexts.push(input.text);
            if (options.onEmbed) return options.onEmbed(input.text);
            return [0.25, ...new Array(767).fill(0)];
          },
        },
        authorize: async () => true,
        provider: {
          async generate(request, signal) {
            const system =
              typeof request.config?.systemInstruction === "string"
                ? request.config.systemInstruction
                : JSON.stringify(request.config?.systemInstruction ?? "");
            const prompt = extractUserText(request);
            const isReview = prompt.includes("Server evidence payload for chat-delivery-review");
            const toolNames = (request.config?.tools ?? []).flatMap(tool =>
              "functionDeclarations" in tool
                ? (tool.functionDeclarations ?? []).map(d => d.name ?? "")
                : [],
            );
            providerCalls.push({
              isReview,
              system,
              contentsJson: JSON.stringify(request.contents),
              toolNames,
            });

            if (isReview) {
              const jsonMatch = /\{[\s\S]*\}$/u.exec(prompt);
              const parsed = jsonMatch ? (JSON.parse(jsonMatch[0]) as { draftHash: string }) : { draftHash: "" };
              return modelTextResponse(
                JSON.stringify({
                  draftHash: parsed.draftHash,
                  decision: "pass",
                  issues: [],
                }),
              );
            }

            if (options.onGenerate) {
              return options.onGenerate(request, signal);
            }

            const userText = extractUserText(request);
            if (userText.includes("早安") || userText.includes("你好")) {
              return toolCallResponse("present_answer", {
                kind: "clarification",
                paragraphs: [{ text: "你好！請問想了解什麼公共育兒資訊？", citationIds: [] }],
              });
            }
            return modelTextResponse("你好");
          },
        },
      };
    },
  });

  return { store, service, providerCalls, searchSelections, embedTexts, usageRecords };
}

test("1. temporary chat session creation is blank, rejects childId/extra keys, and enforces auth & cross-user isolation", async () => {
  const { service } = buildScriptedHarness();
  const isCurrentUser = async (uid: string) => uid === USER_A || uid === USER_B;

  const unauth = await handleTemporaryChatRequest(
    jsonPost("/api/temporary-chat/sessions", {}, null, null),
    null,
    service,
    { isCurrentUser },
  );
  assert.equal(unauth.status, 401);

  const missingHeader = await handleTemporaryChatRequest(
    jsonPost("/api/temporary-chat/sessions", {}, USER_A, null),
    USER_A,
    service,
    { isCurrentUser },
  );
  assert.equal(missingHeader.status, 428);

  const wrongHeader = await handleTemporaryChatRequest(
    jsonPost("/api/temporary-chat/sessions", {}, USER_A, USER_B),
    USER_A,
    service,
    { isCurrentUser },
  );
  assert.equal(wrongHeader.status, 409);

  const withChildId = await handleTemporaryChatRequest(
    jsonPost("/api/temporary-chat/sessions", { childId: randomUUID() }, USER_A),
    USER_A,
    service,
    { isCurrentUser },
  );
  assert.equal(withChildId.status, 400);
  assert.equal((await withChildId.json()).error.code, "invalid_input");

  const getMethod = await handleTemporaryChatRequest(
    new Request("https://synthetic.example.test/api/temporary-chat/sessions", {
      method: "GET",
      headers: { "x-expected-user-id": USER_A },
    }),
    USER_A,
    service,
    { isCurrentUser },
  );
  assert.equal(getMethod.status, 405);

  const createdRes = await handleTemporaryChatRequest(
    jsonPost("/api/temporary-chat/sessions", {}, USER_A),
    USER_A,
    service,
    { isCurrentUser },
  );
  assert.equal(createdRes.status, 201);
  assert.equal(createdRes.headers.get("cache-control"), "private, no-store");
  assert.equal(createdRes.headers.get("pragma"), "no-cache");
  assert.equal(createdRes.headers.get("x-content-type-options"), "nosniff");
  const createdBody = (await createdRes.json()) as {
    session: { sessionId: string; generation: number };
    messages: unknown[];
  };
  assert.deepEqual(createdBody.messages, []);
  assert.equal(createdBody.session.generation, 1);

  const sendWithChildId = await handleTemporaryChatRequest(
    jsonPost(
      `/api/temporary-chat/sessions/${createdBody.session.sessionId}/messages`,
      { text: "發燒補水", generation: 1, childId: randomUUID() },
      USER_A,
    ),
    USER_A,
    service,
    { isCurrentUser },
  );
  assert.equal(sendWithChildId.status, 400);

  const crossUserSend = await handleTemporaryChatRequest(
    jsonPost(
      `/api/temporary-chat/sessions/${createdBody.session.sessionId}/messages`,
      { text: "偷讀他人會話", generation: 1 },
      USER_B,
    ),
    USER_B,
    service,
    { isCurrentUser },
  );
  assert.equal(crossUserSend.status, 404);
  assert.equal((await crossUserSend.json()).error.code, "temporary_session_not_found");
});

test("2. multi-turn follow-up uses only current temporary session + publicOnly retrieval without libraryUserId", async () => {
  const h = buildScriptedHarness({
    onGenerate: async request => {
      const toolResponses = extractToolResponses(request);
      const userText = extractUserText(request);
      const isFollowUp = userText.includes("如果唔肯飲呢");
      if (toolResponses.length === 0) {
        return toolCallResponse("search_knowledge", {
          query: isFollowUp ? "兒童發燒 不願飲水" : "兒童發燒 飲水",
          classification: "official_guidance",
        });
      }
      if (toolResponses.some(res => res.name === "search_knowledge") && !toolResponses.some(res => res.name === "present_answer")) {
        return toolCallResponse("present_answer", {
          kind: "caregiving",
          paragraphs: [
            {
              text: isFollowUp
                ? "若孩子不願一次飲用太多，仍建議少量多次補水並留意精神狀態。"
                : "兒童發燒期間應少量多次補充水分，並觀察精神狀況。",
              citationIds: [CHUNK_ID],
            },
          ],
        });
      }
      return toolCallResponse("present_answer", {
        kind: "clarification",
        paragraphs: [{ text: "請補充你想問的公共知識。", citationIds: [] }],
      });
    },
  });

  const { session } = h.service.createSession(USER_A);
  const turn1 = await h.service.sendTurn({
    userId: USER_A,
    sessionId: session.sessionId,
    generation: session.generation,
    text: "BB發燒點補水？",
    isCurrentUser: async () => true,
  });

  assert.equal(turn1.modelMessage.citations?.length, 1);
  assert.equal(turn1.modelMessage.citations?.[0]?.id, CHUNK_ID);
  assert.equal(h.searchSelections.length >= 1, true);
  // publicOnly: true must never forward libraryUserId to KnowledgeStore.candidates.
  for (const call of h.searchSelections) {
    assert.equal(call.selection.libraryUserId, undefined);
  }
  // Verify prompt contains no real child profiles or private memory tools.
  const firstCall = h.providerCalls[0]!;
  assert.doesNotMatch(firstCall.toolNames.join(","), /read_context|read_memory_facts|save_|propose_/);
  assert.equal(firstCall.toolNames.includes("search_knowledge"), true);
  assert.equal(firstCall.toolNames.includes("present_answer"), true);

  // Turn 2 follow-up references Turn 1 within this temporary session.
  const turn2 = await h.service.sendTurn({
    userId: USER_A,
    sessionId: session.sessionId,
    generation: turn1.session.generation,
    text: "如果唔肯飲呢？",
    isCurrentUser: async () => true,
  });
  const secondTurnGen = h.providerCalls.find(c => !c.isReview && c.contentsJson.includes("如果唔肯飲呢"))!;
  assert.match(secondTurnGen.contentsJson, /BB發燒點補水/);
  assert.equal(turn2.session.generation, turn1.session.generation + 1);
  assert.equal(turn2.modelMessage.citations?.[0]?.id, CHUNK_ID);
  assert.equal(h.searchSelections.length >= 2, true);
  for (const call of h.searchSelections) {
    assert.equal(call.selection.libraryUserId, undefined);
  }

  // Also verify FirestoreKnowledgeStore.mayReadPublicLivePage never touches personal selections.
  const fake = firestoreDomainFixture();
  const ks = createFirestoreKnowledgeStore({
    database: fake.database,
    cipher: createStorageCipher(Buffer.alloc(32, 19)),
    projectId: "project-test",
    namespace: "ns_test",
    sourceIds: ["fhs-fever-hk"],
  });
  assert.equal(await ks.mayReadPublicLivePage("non-existent-source"), false);
});

test("3. temporary chat enforces PII query minimization before consuming embedding quota with zero extra classifier LLM", async () => {
  let attempt = 0;
  const h = buildScriptedHarness({
    onGenerate: async request => {
      const toolResponses = extractToolResponses(request);
      if (attempt === 0) {
        attempt += 1;
        return toolCallResponse("search_knowledge", {
          query: "張小明住沙田第一城3座501室電話91234567發燒點算",
          classification: "official_guidance",
        });
      }
      if (toolResponses.some(r => r.name === "search_knowledge" && (r.response as { status?: string }).status === "rejected") && attempt === 1) {
        attempt += 1;
        return toolCallResponse("search_knowledge", {
          query: "幼兒 發燒 照顧",
          classification: "official_guidance",
        });
      }
      return toolCallResponse("present_answer", {
        kind: "caregiving",
        paragraphs: [
          {
            text: "發燒照顧期間應讓孩子少量多次補充水分，並密切觀察精神與進食情況。",
            citationIds: [CHUNK_ID],
          },
        ],
      });
    },
  });

  const { session } = h.service.createSession(USER_A);
  const res = await h.service.sendTurn({
    userId: USER_A,
    sessionId: session.sessionId,
    generation: session.generation,
    text: "張小明電話91234567發燒點算？",
    isCurrentUser: async () => true,
  });

  assert.equal(res.modelMessage.citations?.length, 1);
  // First rejected PII search consumed 0 embeddings; only the clean retry embedded once.
  assert.deepEqual(h.embedTexts, ["幼兒 發燒 照顧"]);
  assert.equal(
    h.providerCalls.every(call => !call.system.includes("classify") && !call.system.includes("intent")),
    true,
  );
});

test("4. save/record/memory requests in temporary chat are blocked at tool boundary with zero persistent writes", async () => {
  const h = buildScriptedHarness({
    onGenerate: async () =>
      toolCallResponse("present_answer", {
        kind: "clarification",
        paragraphs: [
          {
            text: "目前為臨時聊天，不會建立或保存任何記憶或記錄；如需保存，請退出臨時聊天並於主聊天的助手模式處理。",
            citationIds: [],
          },
        ],
      }),
  });

  const { session } = h.service.createSession(USER_A);
  const res = await h.service.sendTurn({
    userId: USER_A,
    sessionId: session.sessionId,
    generation: session.generation,
    text: "幫我記低 BB 今日 120ml 飲奶同聽日打針提醒。",
    isCurrentUser: async () => true,
  });

  assert.match(res.modelMessage.text, /目前為臨時聊天.*不會建立或保存/);
  const genCall = h.providerCalls.find(call => !call.isReview)!;
  for (const forbiddenTool of [
    "propose_fact",
    "propose_task",
    "save_ordinary_record",
    "save_private_instruction",
    "create_ordinary_reminder",
    "request_confirmation",
  ]) {
    assert.equal(genCall.toolNames.includes(forbiddenTool), false);
  }
});

test("5. service layer enforces daily quota (429) on both AiUsageStore and createDurableUsageAdapterForTemporaryChat", async () => {
  const h = buildScriptedHarness({ dailyUserAttempts: 1 });
  const { session } = h.service.createSession(USER_A);

  await h.service.sendTurn({
    userId: USER_A,
    sessionId: session.sessionId,
    generation: session.generation,
    text: "你好",
    isCurrentUser: async () => true,
  });

  await assert.rejects(
    () =>
      h.service.sendTurn({
        userId: USER_A,
        sessionId: session.sessionId,
        generation: 2,
        text: "第二句應該超額",
        isCurrentUser: async () => true,
      }),
    error => (error as { status?: number; code?: string }).status === 429 && (error as { code?: string }).code === "ai_quota_exceeded",
  );

  // Also test createDurableUsageAdapterForTemporaryChat directly.
  const reserved: Array<{ req: Record<string, unknown>; activity?: unknown }> = [];
  const recorded: Array<{ req: Record<string, unknown>; attempt: Record<string, unknown> }> = [];
  const secretUserPrompt = "UNIQUE_TEMP_SECRET_PROMPT_XYZ";
  const adapted = createDurableUsageAdapterForTemporaryChat({
    dailyUsage: {
      billingSource: "platform",
      async reserve(req, _purpose, activity) {
        reserved.push({ req: { ...req }, activity });
        if (reserved.length > 1) return { decision: "quota_exceeded" };
        return {
          decision: "execute",
          receipt: {
            day: "2026-11-20",
            reservedAtMs: Date.now(),
            record: null,
          },
        };
      },
      async record(req, attempt) {
        recorded.push({ req: { ...req }, attempt: { ...attempt } });
        return { day: "2026-11-20", reservedAtMs: Date.now(), record: attempt };
      },
    },
    userId: USER_A,
    runId: randomUUID(),
    model: "gemini-3.1-flash-lite",
    deadlineAtMs: Date.now() + 60_000,
    billingSource: "platform",
  });

  assert.equal(await adapted.usage.reserve(USER_A, 10, 100), true);
  assert.equal(reserved[0]!.req.childId, TEMPORARY_CHAT_LIMITS.usageScopeChildId);
  assert.equal(JSON.stringify(reserved[0]).includes(secretUserPrompt), false);
  await adapted.usage.record({
    userId: USER_A,
    childId: TEMPORARY_CHAT_LIMITS.usageScopeChildId,
    model: "gemini-3.1-flash-lite",
    outcome: "succeeded",
    inputTokens: 10,
    outputTokens: 5,
    cachedTokens: 0,
    durationMs: 12,
  });
  assert.equal(recorded.length, 1);
  assert.equal(await adapted.usage.reserve(USER_A, 10, 100), false);
});

test("6. zero temporary-chat content leaks to console logs or Firestore persistence across normal, 503, and 429 turns", async () => {
  const canaryUser = "PRIVATE_CANARY_ALPHA_9911";
  const canaryReply = "REPLY_CANARY_OMEGA_8822";
  const consoleCalls: string[] = [];
  const orig = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };
  console.log = (...args) => { consoleCalls.push(args.map(String).join(" ")); };
  console.info = (...args) => { consoleCalls.push(args.map(String).join(" ")); };
  console.warn = (...args) => { consoleCalls.push(args.map(String).join(" ")); };
  console.error = (...args) => { consoleCalls.push(args.map(String).join(" ")); };

  try {
    let fail = false;
    const h = buildScriptedHarness({
      dailyUserAttempts: 2,
      onGenerate: async () => {
        if (fail) throw new Error("synthetic_upstream_boom");
        return toolCallResponse("present_answer", {
          kind: "clarification",
          paragraphs: [{ text: canaryReply, citationIds: [] }],
        });
      },
    });
    const { session } = h.service.createSession(USER_A);
    const ok = await h.service.sendTurn({
      userId: USER_A,
      sessionId: session.sessionId,
      generation: session.generation,
      text: canaryUser,
      isCurrentUser: async () => true,
    });
    assert.equal(ok.modelMessage.text, canaryReply);

    fail = true;
    await assert.rejects(() =>
      h.service.sendTurn({
        userId: USER_A,
        sessionId: session.sessionId,
        generation: ok.session.generation,
        text: canaryUser,
        isCurrentUser: async () => true,
      }),
    );

    const logDump = consoleCalls.join("\n");
    assert.equal(logDump.includes(canaryUser), false);
    assert.equal(logDump.includes(canaryReply), false);
  } finally {
    console.log = orig.log;
    console.info = orig.info;
    console.warn = orig.warn;
    console.error = orig.error;
  }
});

test("7. normal exit physically deletes in-memory content, creates revoked tombstone, blocks reuse, and re-entry is blank", async () => {
  const h = buildScriptedHarness();
  const { session } = h.service.createSession(USER_A);
  const turn = await h.service.sendTurn({
    userId: USER_A,
    sessionId: session.sessionId,
    generation: session.generation,
    text: "你好",
    isCurrentUser: async () => true,
  });
  assert.equal(h.store.hasSessionContent(session.sessionId), true);

  const receipt = h.service.closeSession(USER_A, session.sessionId, "user_exit");
  assert.equal(receipt.status, "cleared");
  assert.equal(receipt.scope, "application_controlled_only");
  assert.equal(h.store.hasSessionContent(session.sessionId), false);
  assert.deepEqual(h.store.stats(), { activeSessions: 0, revokedTombstones: 1 });

  await assert.rejects(
    () =>
      h.service.sendTurn({
        userId: USER_A,
        sessionId: session.sessionId,
        generation: turn.session.generation,
        text: "試圖續接已結束會話",
        isCurrentUser: async () => true,
      }),
    error => (error as { status?: number; code?: string }).status === 410 && (error as { code?: string }).code === "temporary_session_closed",
  );

  const fresh = h.service.createSession(USER_A);
  assert.notEqual(fresh.session.sessionId, session.sessionId);
  assert.deepEqual(fresh.messages, []);
});

test("8. exiting mid-flight cancels AbortSignal and drops late slow response without resurrecting closed session", async () => {
  let providerAborted = false;
  let releaseSlowProvider!: () => void;
  const slowGate = new Promise<void>(resolve => {
    releaseSlowProvider = resolve;
  });
  let notifyProviderEntered!: () => void;
  const providerEntered = new Promise<void>(resolve => {
    notifyProviderEntered = resolve;
  });

  const h = buildScriptedHarness({
    onGenerate: async (_req, signal) => {
      signal.addEventListener("abort", () => {
        providerAborted = true;
      });
      notifyProviderEntered();
      // Intentionally wait for manual release even after signal aborts, simulating non-cancellable SDK call.
      await slowGate;
      return toolCallResponse("present_answer", {
        kind: "clarification",
        paragraphs: [{ text: "遲來的回覆", citationIds: [] }],
      });
    },
  });

  const { session } = h.service.createSession(USER_A);
  const inflight = h.service.sendTurn({
    userId: USER_A,
    sessionId: session.sessionId,
    generation: session.generation,
    text: "在途請求測試",
    isCurrentUser: async () => true,
  });
  const expectedRejection = assert.rejects(
    () => inflight,
    error => (error as { status?: number; code?: string }).status === 410 && (error as { code?: string }).code === "temporary_session_closed",
  );

  // Wait deterministically until the fake provider has actually started and attached its abort listener.
  await providerEntered;
  const receipt = h.service.closeSession(USER_A, session.sessionId, "user_exit");
  assert.equal(receipt.cancelledInFlight, true);
  assert.equal(providerAborted, true);
  assert.equal(h.store.hasSessionContent(session.sessionId), false);

  releaseSlowProvider();
  await expectedRejection;
  assert.equal(h.store.hasSessionContent(session.sessionId), false);
});

test("9. abnormal disconnect TTLs enforce 15m sliding idle expiry and 60m hard ceiling without reactivation", async () => {
  let now = Date.UTC(2026, 10, 20, 1, 0, 0);
  const h = buildScriptedHarness({ clock: () => now });

  // Part A: 15-minute idle expiration
  const s1 = h.service.createSession(USER_A);
  const t1 = await h.service.sendTurn({
    userId: USER_A,
    sessionId: s1.session.sessionId,
    generation: s1.session.generation,
    text: "你好",
    isCurrentUser: async () => true,
  });
  // Advance 14m59s -> still alive
  now += 14 * 60 * 1000 + 59 * 1000;
  const t2 = await h.service.sendTurn({
    userId: USER_A,
    sessionId: s1.session.sessionId,
    generation: t1.session.generation,
    text: "早安",
    isCurrentUser: async () => true,
  });
  assert.equal(h.store.hasSessionContent(s1.session.sessionId), true);
  // Advance full 15m without activity -> swept & expired
  now += TEMPORARY_CHAT_LIMITS.idleTtlMs;
  assert.equal(h.store.sweepExpired(), 1);
  assert.equal(h.store.hasSessionContent(s1.session.sessionId), false);
  await assert.rejects(
    () =>
      h.service.sendTurn({
        userId: USER_A,
        sessionId: s1.session.sessionId,
        generation: t2.session.generation,
        text: "斷線後嘗試續接",
        isCurrentUser: async () => true,
      }),
    error => (error as { status?: number; code?: string }).status === 410 && (error as { code?: string }).code === "temporary_session_expired",
  );

  // Part B: non-extending 60-minute hard ceiling even with active turns every 10 minutes
  const s2 = h.service.createSession(USER_A);
  let gen = s2.session.generation;
  for (let step = 0; step < 5; step++) {
    now += 10 * 60 * 1000; // 10, 20, 30, 40, 50 min
    const r = await h.service.sendTurn({
      userId: USER_A,
      sessionId: s2.session.sessionId,
      generation: gen,
      text: "你好",
      isCurrentUser: async () => true,
    });
    gen = r.session.generation;
  }
  now += 10 * 60 * 1000; // reaches 60m hard limit
  await assert.rejects(
    () =>
      h.service.sendTurn({
        userId: USER_A,
        sessionId: s2.session.sessionId,
        generation: gen,
        text: "滿 60 分鐘上限後",
        isCurrentUser: async () => true,
      }),
    error => (error as { status?: number; code?: string }).status === 410 && (error as { code?: string }).code === "temporary_session_expired",
  );
  assert.equal(h.store.hasSessionContent(s2.session.sessionId), false);
});

test("10. idempotent close retry after reconnect returns already_cleared while cross-user close fails with 404", async () => {
  const h = buildScriptedHarness();
  const isCurrentUser = async (uid: string) => uid === USER_A || uid === USER_B;
  const { session } = h.service.createSession(USER_A);

  const firstClose = await handleTemporaryChatRequest(
    jsonPost(`/api/temporary-chat/sessions/${session.sessionId}/close`, { reason: "user_exit" }, USER_A),
    USER_A,
    h.service,
    { isCurrentUser },
  );
  assert.equal(firstClose.status, 200);
  const firstBody = (await firstClose.json()) as { receipt: { status: string; scope: string } };
  assert.equal(firstBody.receipt.status, "cleared");
  assert.equal(firstBody.receipt.scope, "application_controlled_only");

  const crossUserClose = await handleTemporaryChatRequest(
    jsonPost(`/api/temporary-chat/sessions/${session.sessionId}/close`, { reason: "client_reset" }, USER_B),
    USER_B,
    h.service,
    { isCurrentUser },
  );
  assert.equal(crossUserClose.status, 404);

  const retryClose = await handleTemporaryChatRequest(
    jsonPost(`/api/temporary-chat/sessions/${session.sessionId}/close`, {}, USER_A),
    USER_A,
    h.service,
    { isCurrentUser },
  );
  assert.equal(retryClose.status, 200);
  const retryBody = (await retryClose.json()) as { receipt: { status: string; scope: string } };
  assert.equal(retryBody.receipt.status, "already_cleared");
  assert.equal(retryBody.receipt.scope, "application_controlled_only");
});

test("11. HTTP integration on both createRequestHandler and createFirebaseRequestHandler preserves headers and leaves main chat untouched", async () => {
  const fake = firestoreDomainFixture();
  const options = {
    database: fake.database,
    cipher: createStorageCipher(Buffer.alloc(32, 41)),
    projectId: "synthetic-req003-pr4",
    namespace: "synthetic_req003_pr4",
  };
  const authority = createFirestoreAuthority(options);
  await authority.initializeControl({ generation: randomUUID(), enabled: true });
  await authority.issueInvitation({
    email: `${USER_A}@example.test`,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    operationId: randomUUID(),
  });
  await authority.admitIdentity({ userId: USER_A, email: `${USER_A}@example.test`, emailVerified: true });
  await authority.acknowledge({
    userId: USER_A,
    operationId: randomUUID(),
    policyVersion: SERVICE_POLICY_VERSION,
  });

  const chat = createFirestoreChatStore(options);
  const care = createFirestoreCareStore(options);
  const memory = createFirestoreMemoryStore({ ...options, chat, care });
  const online = createFirestoreOnlineStore({ ...options, mutations: [chat.mutation, care.mutation, memory.mutation] });
  const agentStore = createFirestoreProductAgentStore({
    ...options,
    chat,
    care,
    memory,
    online,
    validateKnowledge: async () => {},
    continuationKnowledge: async () => [],
  });
  const ctx = await online.context(USER_A, { path: "/api/children", payload: { displayName: "小晴" } });
  const childId = (
    (
      await online.submit(USER_A, {
        path: "/api/children",
        payload: { displayName: "小晴" },
        operation: { ...ctx, opId: randomUUID(), deviceId: randomUUID() },
      })
    ).result as { child: { id: string } }
  ).child.id;
  await chat.createUserMessageForUser(USER_A, childId, "主聊天既有問題");
  const beforeMain = await chat.listForUser(USER_A, childId);
  const { store: tempStore, service } = buildScriptedHarness();

  // Part A: createFirebaseRequestHandler
  const firebaseHandler = createFirebaseRequestHandler({
    authority,
    auth: {
      async getSession({ headers, returnHeaders }: { headers: Headers; returnHeaders?: boolean }) {
        const res = headers.get("cookie") === "session=valid-a" ? { user: { id: USER_A } } : null;
        return (returnHeaders ? { response: res, headers: new Headers() } : res) as never;
      },
      handler: async () => new Response(null, { status: 404 }),
      fromNodeHeaders: () => new Headers(),
      async assertRecentReauthentication() {
        return { user: { id: USER_A } } as never;
      },
    },
    publicOrigin: "https://synthetic.example.test",
    mailConfigured: false,
    temporaryChat: service,
  });

  const badOriginRes = await firebaseHandler(
    new Request("https://synthetic.example.test/api/temporary-chat/sessions", {
      method: "POST",
      headers: {
        cookie: "session=valid-a",
        origin: "https://evil.example.test",
        "content-type": "application/json",
        "x-expected-user-id": USER_A,
      },
      body: "{}",
    }),
  );
  assert.equal(badOriginRes.status, 403);

  const fbCreate = await firebaseHandler(
    new Request("https://synthetic.example.test/api/temporary-chat/sessions", {
      method: "POST",
      headers: {
        cookie: "session=valid-a",
        origin: "https://synthetic.example.test",
        "content-type": "application/json",
        "x-expected-user-id": USER_A,
      },
      body: "{}",
    }),
  );
  assert.equal(fbCreate.status, 201);
  assert.equal(fbCreate.headers.get("cache-control"), "private, no-store");
  assert.equal(fbCreate.headers.get("pragma"), "no-cache");
  assert.equal(fbCreate.headers.get("x-content-type-options"), "nosniff");
  const fbSession = (await fbCreate.json()) as { session: { sessionId: string; generation: number } };

  const fbSend = await firebaseHandler(
    new Request(`https://synthetic.example.test/api/temporary-chat/sessions/${fbSession.session.sessionId}/messages`, {
      method: "POST",
      headers: {
        cookie: "session=valid-a",
        origin: "https://synthetic.example.test",
        "content-type": "application/json",
        "x-expected-user-id": USER_A,
      },
      body: JSON.stringify({ text: "你好", generation: fbSession.session.generation }),
    }),
  );
  assert.equal(fbSend.status, 200);
  const fbClose = await firebaseHandler(
    new Request(`https://synthetic.example.test/api/temporary-chat/sessions/${fbSession.session.sessionId}/close`, {
      method: "POST",
      headers: {
        cookie: "session=valid-a",
        origin: "https://synthetic.example.test",
        "content-type": "application/json",
        "x-expected-user-id": USER_A,
      },
      body: "{}",
    }),
  );
  assert.equal(fbClose.status, 200);
  assert.equal(tempStore.hasSessionContent(fbSession.session.sessionId), false);

  // Part B: createRequestHandler (server/app.ts) without opening any socket
  const nodeHandler = createRequestHandler({
    config: {
      port: 0,
      host: "127.0.0.1",
      publicOrigin: "https://synthetic.example.test",
      webOrigin: "https://synthetic.example.test",
      production: false,
      databaseUrl: "postgres://unused",
      authSecret: "synthetic-secret-value-at-least-32-chars",
    },
    auth: {
      fromNodeHeaders(raw) {
        const headers = new Headers();
        for (const [k, v] of Object.entries(raw)) {
          if (typeof v === "string") headers.set(k, v);
        }
        return headers;
      },
      async getSession({ returnHeaders }: { headers: Headers; returnHeaders?: boolean }) {
        const res = { user: { id: USER_A } };
        return (returnHeaders ? { response: res, headers: new Headers() } : res) as never;
      },
      handler: async () => new Response(null, { status: 404 }),
    },
    workspaces: {
      async ensureForUser() { throw new Error("Unexpected workspace write"); },
      async listForUser() { throw new Error("Unexpected workspace read"); },
      async getForUser() { throw new Error("Unexpected workspace read"); },
    },
    records: {} as never,
    temporaryChat: service,
    checkDatabase: async () => {},
  });

  async function invokeNode(urlPath: string, payload: string) {
    const req = new EventEmitter() as IncomingMessage & { resume: () => IncomingMessage };
    req.method = "POST";
    req.url = urlPath;
    req.headers = {
      origin: "https://synthetic.example.test",
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(payload)),
      "x-expected-user-id": USER_A,
    };
    req.socket = { remoteAddress: "127.0.0.1" } as IncomingMessage["socket"];
    req.resume = () => req;

    const resHeaders = new Map<string, string | string[]>();
    let endedBody: Buffer = Buffer.alloc(0);
    const res = new EventEmitter() as ServerResponse & { writableEnded: boolean };
    res.writableEnded = false;
    res.statusCode = 200;
    res.setHeader = (k: string, v: string | number | readonly string[]) => {
      resHeaders.set(k.toLowerCase(), Array.isArray(v) ? v.map(String) : String(v));
      return res;
    };
    res.end = ((chunk?: unknown) => {
      if (chunk) endedBody = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      res.writableEnded = true;
      res.emit("finish");
      return res;
    }) as ServerResponse["end"];

    const done = nodeHandler(req, res);
    process.nextTick(() => {
      if (payload.length) req.emit("data", Buffer.from(payload));
      req.emit("end");
    });
    await done;
    return { status: res.statusCode, headers: resHeaders, json: JSON.parse(endedBody.toString("utf8")) };
  }

  const nodeCreated = await invokeNode("/api/temporary-chat/sessions", "{}");
  assert.equal(nodeCreated.status, 201);
  assert.equal(nodeCreated.headers.get("cache-control"), "no-store");
  const nodeSid = (nodeCreated.json as { session: { sessionId: string } }).session.sessionId;
  const nodeClosed = await invokeNode(`/api/temporary-chat/sessions/${nodeSid}/close`, "{}");
  assert.equal(nodeClosed.status, 200);

  // Main chat and pending proposals remain 100% untouched.
  const afterMain = await chat.listForUser(USER_A, childId);
  assert.equal(afterMain?.messages.length, beforeMain?.messages.length);
  assert.equal(afterMain?.messages[0]?.text, "主聊天既有問題");
  const pending = await agentStore.store.pendingProposals(USER_A, childId);
  assert.ok(pending);
  assert.equal(pending.proposals.length, 0);
});

test("12. cross-mode & delivery review regression: official help + pure boundary pass while uncited care/fake save fail closed", async () => {
  const scope = {
    userId: USER_A,
    workspaceId: TEMPORARY_CHAT_LIMITS.usageScopeChildId,
    childId: TEMPORARY_CHAT_LIMITS.usageScopeChildId,
    authorizationVersion: "temporary:s:g1",
    dataVersion: "temporary:s:g1",
  };

  // Pure temporary-chat boundary notice passes isPureChatOnlyModeBoundaryNotice
  const validBoundaryDraft: ChatDeliveryDraft = {
    userRequest: "幫我記低 BB 今日食奶",
    chatMode: "chat_only",
    temporaryChat: true,
    kind: "clarification",
    visibility: "private",
    serverSubstitutedSourceText: false,
    serverSubstitutedReceiptText: false,
    verifiedOperations: [],
    paragraphs: [
      {
        text: "目前為臨時聊天，不會建立或保存任何記憶或記錄；如需保存，請退出臨時聊天並於主聊天的助手模式處理。",
        citationIds: [],
      },
    ],
    sources: [],
    scope,
  };
  assert.equal(isPureChatOnlyModeBoundaryNotice(validBoundaryDraft), true);

  // Fake saved claim inside temporary chat is rejected even with temporaryChat: true
  const fakeSaveDraft: ChatDeliveryDraft = {
    ...validBoundaryDraft,
    paragraphs: [{ text: "已經幫你將 BB 飲奶記錄保存好，可退出臨時聊天查看。", citationIds: [] }],
  };
  assert.equal(isPureChatOnlyModeBoundaryNotice(fakeSaveDraft), false);

  // Uncited care dosing advice in temporary chat fails closed inside service
  const uncitedCareHarness = buildScriptedHarness({
    onGenerate: async () =>
      toolCallResponse("present_answer", {
        kind: "clarification",
        paragraphs: [{ text: "建議每次餵撲熱息痛藥水 5 ml。", citationIds: [] }],
      }),
  });
  const s1 = uncitedCareHarness.service.createSession(USER_A);
  await assert.rejects(
    () =>
      uncitedCareHarness.service.sendTurn({
        userId: USER_A,
        sessionId: s1.session.sessionId,
        generation: s1.session.generation,
        text: "發燒點算？",
        isCurrentUser: async () => true,
      }),
    error => (error as { status?: number; code?: string }).status === 503 && (error as { code?: string }).code === "ai_unavailable",
  );

  // Emergency redirect with show_official_help delivers emergency-hk-v1 card safely without unverified dosing text
  let step = 0;
  const emergencyHarness = buildScriptedHarness({
    onGenerate: async () => {
      if (step === 0) {
        step += 1;
        return toolCallResponse("show_official_help", { card: "emergency-hk-v1" });
      }
      return toolCallResponse("present_answer", {
        kind: "clarification",
        paragraphs: [{ text: "請先使用畫面上的緊急求助入口。", citationIds: [] }],
      });
    },
  });
  const s2 = emergencyHarness.service.createSession(USER_A);
  const ok = await emergencyHarness.service.sendTurn({
    userId: USER_A,
    sessionId: s2.session.sessionId,
    generation: s2.session.generation,
    text: "BB抽搐叫唔醒",
    isCurrentUser: async () => true,
  });
  assert.equal(ok.modelMessage.text, "請先使用畫面上的緊急求助入口。");
  assert.deepEqual(ok.modelMessage.helpCards, ["emergency-hk-v1"]);

  // Verify enforceChatDeliveryReview never treats a chat_only non-temporary notice with temporary text unless temporaryChat is true
  await assert.rejects(() =>
    enforceChatDeliveryReview({
      presentation: { text: fakeSaveDraft.paragraphs[0]!.text, citations: [], retrievalMode: "not_used" },
      tools: {
        presentation: async () => ({ text: fakeSaveDraft.paragraphs[0]!.text, citations: [], retrievalMode: "not_used" }),
        deliveryDraft: () => fakeSaveDraft,
        replaceDeliveryAnswer: () => {},
      },
      context: {
        scope,
        runId: randomUUID(),
        budget: { remainingModelCalls: 0 } as never,
      },
      provenance: { packVersion: "0.1.68", model: "gemini-3.1-flash-lite" },
    }),
  );
});
