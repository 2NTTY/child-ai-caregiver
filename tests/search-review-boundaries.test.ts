import assert from "node:assert/strict";
import test from "node:test";
import type { LlmRequest } from "@google/adk";
import { FinishReason } from "@google/genai";
import {
  chatDeliveryPassNeedsSources,
  draftLooksLikeSubstantiveCareAdvice,
  isPureClarifyingQuestion,
  requiresChatDeliveryReview,
  type ChatDeliveryDraft,
} from "../server/chat-delivery-review.ts";
import { CHAT_DELIVERY_REVIEW_INCOMPLETE_TEXT } from "../src/shared/chat-delivery-review.ts";
import { createAgentRuntime } from "../server/agent-runtime.ts";
import { createProductAgent } from "../server/product-agent.ts";
import { readAiConfig } from "../server/ai-config.ts";
import type { ProductAgentResult } from "../src/shared/product-agent.ts";

const CHUNK_ID = "88888888-8888-4888-8888-888888888888";
const VERSION_ID = "99999999-9999-4999-8999-999999999999";

const scope: ChatDeliveryDraft["scope"] = {
  userId: "synthetic-user",
  workspaceId: "synthetic-workspace",
  childId: "1ebcb39d-a2db-4b8c-a432-7ffcb3de5808",
  authorizationVersion: "1",
  dataVersion: "epoch:1",
};

function makeDraft(text: string, kind: ChatDeliveryDraft["kind"] = "clarification"): ChatDeliveryDraft {
  return {
    kind,
    visibility: "private",
    serverSubstitutedSourceText: false,
    paragraphs: [{ text, citationIds: [] }],
    sources: [],
    scope,
  };
}

const chunk = {
  chunkId: CHUNK_ID,
  versionId: VERSION_ID,
  classification: "official_guidance" as const,
  text: "如兩個月以下嬰兒發燒，應立即求醫。",
};

function payloadFrom(request: LlmRequest) {
  const user = request.contents.flatMap((content) => content.parts ?? []).map((part) => part.text ?? "").join("\n");
  const body = user.includes("{")
    ? (JSON.parse(user.slice(user.indexOf("{"))) as {
        draftHash?: string;
        paragraphs?: { text: string; citationIds: string[] }[];
      })
    : {};
  return { user, body };
}

function reviewJson(draftHash: string, decision: "pass" | "revise" | "insufficient_evidence") {
  return JSON.stringify({
    draftHash,
    decision,
    issues: decision === "pass" ? [] : [{ paragraph: 0, reason: "unsupported meaning", support: "missing" }],
  });
}

test("REQ-008 §3.2 / §9: surface-rewritten medication, dosage, and operation claims wrapped in questions fail closed", () => {
  const rewrittenMedicationOrDosageQuestions = [
    "食藥持續咗幾多日？",
    "藥要食幾多個月？",
    "每次餵 10ml，持續咗幾多日？",
    "退燒藥水幾多ml？",
    "餵藥持續咗幾多日？",
  ];

  for (const text of rewrittenMedicationOrDosageQuestions) {
    const draft = makeDraft(text, "clarification");
    assert.equal(
      isPureClarifyingQuestion(text),
      false,
      `Expected rewritten medication/dosage question to fail closed: ${text}`,
    );
    assert.equal(
      draftLooksLikeSubstantiveCareAdvice(draft),
      true,
      `Expected rewritten medication/dosage question to be classified as substantive care/medical content: ${text}`,
    );
    assert.equal(
      requiresChatDeliveryReview(draft),
      true,
      `Expected delivery review to be required for: ${text}`,
    );
  }

  assert.equal(requiresChatDeliveryReview(makeDraft("已經幫你刪除所有記錄", "operation")), true);
  assert.equal(
    requiresChatDeliveryReview(makeDraft("多謝，已經幫你刪除所有記錄。", "clarification")),
    true,
  );
  assert.equal(
    requiresChatDeliveryReview(makeDraft("多謝，已刪晒所有記錄。", "clarification")),
    true,
  );
  assert.equal(
    requiresChatDeliveryReview(makeDraft("唔該，記低咗啦。", "clarification")),
    true,
  );

  const boundedClarification = "請問BB幾個月大？有沒有發燒？";
  assert.equal(isPureClarifyingQuestion(boundedClarification), true);
  assert.equal(requiresChatDeliveryReview(makeDraft(boundedClarification, "clarification")), false);
});

test("REQ-008 §3.2: mid-turn evidence retrieval activates deliveryReview.require on root budget and locks Call 3 to finish", async () => {
  const runId = "d4a1b662-d13d-476b-bf52-40a28aa1a1a7";
  const messageId = "7de5a0e8-e106-4485-b7d2-3b572741da39";
  const expiresAt = new Date(Date.now() + 90_000).toISOString();
  let modelCalls = 0;
  let saved: ProductAgentResult | null = null;

  const runtime = createAgentRuntime({
    config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project" }),
    usage: { reserve: async () => true, record: async () => {} },
    provider: {
      generate: async (request) => {
        modelCalls++;
        const { user, body } = payloadFrom(request);
        if (user.includes("chat-delivery-review")) {
          assert.equal(modelCalls, 4, "Review must execute on Call 4 of the 4-call root budget");
          return {
            content: {
              role: "model" as const,
              parts: [{ text: reviewJson(body.draftHash ?? "", "pass") }],
            },
            finishReason: FinishReason.STOP,
          };
        }
        if (modelCalls === 1) {
          return {
            content: {
              role: "model" as const,
              parts: [
                {
                  functionCall: {
                    id: "call-1",
                    name: "search_knowledge",
                    args: { query: "發燒", classification: "official_guidance" },
                  },
                },
              ],
            },
            finishReason: FinishReason.STOP,
          };
        }
        if (modelCalls === 2) {
          return {
            content: {
              role: "model" as const,
              parts: [
                {
                  functionCall: {
                    id: "call-2",
                    name: "read_knowledge_context",
                    args: { anchorChunkId: CHUNK_ID, cursor: null },
                  },
                },
              ],
            },
            finishReason: FinishReason.STOP,
          };
        }
        if (modelCalls === 3) {
          assert.deepEqual(
            Object.keys(request.toolsDict),
            ["present_answer"],
            "Call 3 must be locked to finish (present_answer) so Call 4 is reserved for delivery_review on the same root budget",
          );
          return {
            content: {
              role: "model" as const,
              parts: [
                {
                  functionCall: {
                    id: "call-3",
                    name: "present_answer",
                    args: {
                      kind: "caregiving",
                      paragraphs: [{ text: "如兩個月以下嬰兒發燒，應立即求醫。", citationIds: [CHUNK_ID] }],
                    },
                  },
                },
              ],
            },
            finishReason: FinishReason.STOP,
          };
        }
        throw new Error(`Unexpected model call (${modelCalls})`);
      },
    },
  });

  const service = createProductAgent({
    runtime,
    store: {
      claim: async () => ({ runId, scope, created: true, state: "running", expiresAt }),
      authorize: async () => true,
      finish: async (_s: unknown, result: ProductAgentResult) => {
        saved = result;
        return true;
      },
      get: async () => saved,
    },
    memory: {
      initialConversationSummary: async () => null,
      context: async () => ({
        profile: { childId: scope.childId, version: 0, data: null },
        profileApplicable: false,
        facts: [],
        topics: [],
        summary: null,
        recentMessages: [],
        conflictingKeys: [],
        unavailableFactKeys: [],
        truncated: { facts: false, topics: false, messages: false },
      }),
      facts: async () => ({ items: [], nextAfterId: null }),
    },
    chat: {
      listForUser: async () => ({
        // Neutral user message so initial deliveryReview.required is false before tool execution
        messages: [{ id: messageId, role: "user", text: "幫我查下資料" }],
      }),
    },
    tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) },
    knowledge: {
      createRun: () => ({
        search: async () => ({
          mode: "vector_keyword",
          chunks: [chunk],
          returned: 1,
          omittedChunks: 0,
          complete: true,
          hasMore: false,
        }),
        readContext: async () => ({
          chunks: [chunk],
          returned: 1,
          omittedChunks: 0,
          complete: true,
          hasMore: false,
          nextCursor: null,
        }),
        revalidateCitations: async () => true,
      }),
    },
  } as unknown as Parameters<typeof createProductAgent>[0]);

  const result = await service.reply(scope.userId, scope.childId, messageId, async () => true);

  assert.equal(modelCalls, 4, "Should complete tool calls + finish + review within the 4-call root budget");
  assert.equal(result?.status, "completed");
  assert.equal(result?.text.includes("如兩個月以下嬰兒發燒，應立即求醫。"), true);
  assert.equal(result?.citations.length, 1);
  assert.equal(result?.citations[0]?.chunkId, CHUNK_ID);
});

test("REQ-008 §3.2: mid-turn review obligation when remaining root budget cannot cover finish + review stops cleanly with delivery_review_budget", async () => {
  const runId = "d4a1b662-d13d-476b-bf52-40a28aa1a1a8";
  const messageId = "7de5a0e8-e106-4485-b7d2-3b572741da40";
  const expiresAt = new Date(Date.now() + 90_000).toISOString();
  let modelCalls = 0;
  let saved: ProductAgentResult | null = null;

  const runtime = createAgentRuntime({
    config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project" }),
    usage: { reserve: async () => true, record: async () => {} },
    provider: {
      generate: async () => {
        modelCalls++;
        if (modelCalls === 1) {
          return {
            content: {
              role: "model" as const,
              parts: [{ functionCall: { id: "call-1", name: "read_context", args: {} } }],
            },
            finishReason: FinishReason.STOP,
          };
        }
        if (modelCalls === 2) {
          return {
            content: {
              role: "model" as const,
              parts: [
                {
                  functionCall: {
                    id: "call-2",
                    name: "load_capabilities",
                    args: { capabilities: ["tasks"] },
                  },
                },
              ],
            },
            finishReason: FinishReason.STOP,
          };
        }
        if (modelCalls === 3) {
          // Turn started neutral (deliveryReview.required === false), so Call 3 was not locked to finish yet.
          // Call 3 invokes search_knowledge, which returns official chunks and calls deliveryReview.require("review")
          // when only 1 model call (Call 4) remains on the 4-call root budget!
          // Because 1 remaining call cannot cover both finish (present_answer) and delivery_review,
          // reserveDeliveryReview blocks Call 4 and the turn stops with delivery_review_budget.
          return {
            content: {
              role: "model" as const,
              parts: [
                {
                  functionCall: {
                    id: "call-3",
                    name: "search_knowledge",
                    args: { query: "發燒", classification: "official_guidance" },
                  },
                },
              ],
            },
            finishReason: FinishReason.STOP,
          };
        }
        throw new Error(`Should not execute Call ${modelCalls} when remaining budget (1) cannot cover both finish and delivery_review`);
      },
    },
  });

  const service = createProductAgent({
    runtime,
    store: {
      claim: async () => ({ runId, scope, created: true, state: "running", expiresAt }),
      authorize: async () => true,
      finish: async (_s: unknown, result: ProductAgentResult) => {
        saved = result;
        return true;
      },
      get: async () => saved,
    },
    memory: {
      initialConversationSummary: async () => null,
      context: async () => ({
        profile: { childId: scope.childId, version: 0, data: null },
        profileApplicable: false,
        facts: [],
        topics: [],
        summary: null,
        recentMessages: [],
        conflictingKeys: [],
        unavailableFactKeys: [],
        truncated: { facts: false, topics: false, messages: false },
      }),
      facts: async () => ({ items: [], nextAfterId: null }),
    },
    chat: {
      listForUser: async () => ({
        messages: [{ id: messageId, role: "user", text: "幫我查下資料" }],
      }),
    },
    tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) },
    knowledge: {
      createRun: () => ({
        search: async () => ({
          mode: "vector_keyword",
          chunks: [chunk],
          returned: 1,
          omittedChunks: 0,
          complete: true,
          hasMore: false,
        }),
        revalidateCitations: async () => true,
      }),
    },
  } as unknown as Parameters<typeof createProductAgent>[0]);

  const result = await service.reply(scope.userId, scope.childId, messageId, async () => true);

  assert.equal(modelCalls, 3, "Must stop after Call 3 because remainingModelCalls=1 cannot cover both finish and review");
  assert.equal(result?.status, "stopped");
  assert.equal(result?.stopReason, "delivery_review_budget");
  assert.equal(result?.text, CHAT_DELIVERY_REVIEW_INCOMPLETE_TEXT);
});

test("bare Cantonese operation claims and Chinese-numeral or unit dosing fail closed through real ProductAgent (R2 F4-F5)", async () => {
  for (const opClaim of ["改咗提醒時間。", "刪咗所有紀錄。", "唔該，改咗啦。"]) {
    const draft = makeDraft(opClaim, "clarification");
    assert.equal(requiresChatDeliveryReview(draft), true, `Must require review for bare operation claim: ${opClaim}`);

    let step = 0;
    let reviewCalls = 0;
    let saved: ProductAgentResult | null = null;
    const messageId = "88888888-8888-4888-8888-888888888811";
    const runId = "99999999-9999-4999-8999-999999999911";
    const runtime = createAgentRuntime({
      config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project", AI_DAILY_USER_ATTEMPTS: "10", AI_DAILY_GLOBAL_ATTEMPTS: "50" }),
      usage: { reserve: async () => true, record: async () => {} },
      provider: {
        generate: async request => {
          const promptText = request.contents.flatMap(content => content.parts ?? []).map(part => part.text ?? "").join("\n");
          if (promptText.includes("chat-delivery-review")) {
            reviewCalls++;
            const payload = JSON.parse(promptText.slice(promptText.indexOf("{"))) as { draftHash: string; verifiedOperations?: unknown[] };
            assert.deepEqual(payload.verifiedOperations ?? [], []);
            return {
              content: {
                role: "model",
                parts: [{ text: JSON.stringify({ draftHash: payload.draftHash, decision: "insufficient_evidence", issues: [{ paragraph: 0, reason: "unverified operation claim" }] }) }],
              },
              finishReason: FinishReason.STOP,
            };
          }
          step++;
          return {
            content: {
              role: "model",
              parts: [{ functionCall: { id: `op-${step}`, name: "present_answer", args: { kind: "clarification", paragraphs: [{ text: opClaim, citationIds: [] }] } } }],
            },
            finishReason: FinishReason.STOP,
          };
        },
      },
    });
    const service = createProductAgent({
      runtime,
      store: {
        claim: async () => ({ runId, scope, created: true, state: "running", expiresAt: new Date(Date.now() + 90000).toISOString() }),
        authorize: async () => true,
        finish: async (_s: unknown, result: ProductAgentResult) => { saved = result; return true; },
        get: async () => saved,
      },
      memory: {
        initialConversationSummary: async () => null,
        context: async () => ({
          profile: { childId: scope.childId, version: 0, data: null },
          profileApplicable: false,
          facts: [],
          topics: [],
          summary: null,
          recentMessages: [],
          conflictingKeys: [],
          unavailableFactKeys: [],
          truncated: { facts: false, topics: false, messages: false },
        }),
        facts: async () => ({ items: [], nextAfterId: null }),
      },
      chat: { listForUser: async () => ({ messages: [{ id: messageId, role: "user", text: "幫我更改提醒時間" }] }) },
      tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) },
      knowledge: {
        createRun: () => ({
          search: async () => ({ mode: "vector_keyword", chunks: [] }),
          revalidateCitations: async () => true,
        }),
      },
    } as unknown as Parameters<typeof createProductAgent>[0]);

    const result = await service.reply(scope.userId, scope.childId, messageId, async () => true);
    assert.equal(reviewCalls, 1, `Unverified operation claim must enter delivery review: ${opClaim}`);
    assert.equal(result?.status, "stopped");
    assert.equal(result?.text.includes("改咗") || result?.text.includes("刪咗"), false);
  }

  for (const [userMsg, dosingText] of [
    ["隻藥應該點食？", "每次 10 ml。"],
    ["隻藥應該點食？", "每次半粒。"],
    ["隻藥應該點食？", "每次一粒。"],
    ["退燒藥粉食幾多？", "每次半包。"],
    ["隻藥應該點食？", "半粒。"],
  ] as const) {
    const draft: ChatDeliveryDraft = { ...makeDraft(dosingText, "clarification"), userRequest: userMsg };
    assert.equal(isPureClarifyingQuestion(dosingText), false);
    assert.equal(draftLooksLikeSubstantiveCareAdvice(draft), true, dosingText);
    assert.equal(requiresChatDeliveryReview(draft), true, dosingText);
    assert.equal(chatDeliveryPassNeedsSources(draft), true, dosingText);

    let step = 0;
    let saved: ProductAgentResult | null = null;
    const messageId = "88888888-8888-4888-8888-888888888812";
    const runId = "99999999-9999-4999-8999-999999999912";
    const runtime = createAgentRuntime({
      config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project", AI_DAILY_USER_ATTEMPTS: "10", AI_DAILY_GLOBAL_ATTEMPTS: "50" }),
      usage: { reserve: async () => true, record: async () => {} },
      provider: {
        generate: async request => {
          const promptText = request.contents.flatMap(content => content.parts ?? []).map(part => part.text ?? "").join("\n");
          if (promptText.includes("chat-delivery-review")) {
            const payload = JSON.parse(promptText.slice(promptText.indexOf("{"))) as { draftHash: string };
            return {
              content: { role: "model", parts: [{ text: JSON.stringify({ draftHash: payload.draftHash, decision: "pass", issues: [] }) }] },
              finishReason: FinishReason.STOP,
            };
          }
          const current = step++;
          const functionCall = current === 0
            ? { id: "search-empty", name: "search_knowledge", args: { query: userMsg, classification: "official_guidance" } }
            : { id: "present-dose", name: "present_answer", args: { kind: "clarification", paragraphs: [{ text: dosingText, citationIds: [] }] } };
          return { content: { role: "model", parts: [{ functionCall }] }, finishReason: FinishReason.STOP };
        },
      },
    });
    const service = createProductAgent({
      runtime,
      store: {
        claim: async () => ({ runId, scope, created: true, state: "running", expiresAt: new Date(Date.now() + 90000).toISOString() }),
        authorize: async () => true,
        finish: async (_s: unknown, result: ProductAgentResult) => { saved = result; return true; },
        get: async () => saved,
      },
      memory: {
        initialConversationSummary: async () => null,
        context: async () => ({
          profile: { childId: scope.childId, version: 0, data: null },
          profileApplicable: false,
          facts: [],
          topics: [],
          summary: null,
          recentMessages: [],
          conflictingKeys: [],
          unavailableFactKeys: [],
          truncated: { facts: false, topics: false, messages: false },
        }),
        facts: async () => ({ items: [], nextAfterId: null }),
      },
      chat: { listForUser: async () => ({ messages: [{ id: messageId, role: "user", text: userMsg }] }) },
      tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) },
      knowledge: {
        createRun: () => ({
          search: async () => ({ mode: "vector_keyword", chunks: [] }),
          revalidateCitations: async () => true,
        }),
      },
    } as unknown as Parameters<typeof createProductAgent>[0]);

    const result = await service.reply(scope.userId, scope.childId, messageId, async () => true);
    assert.equal(result?.status, "stopped");
    assert.equal(result?.stopReason, "delivery_review_no_sources");
    assert.equal(result?.text, CHAT_DELIVERY_REVIEW_INCOMPLETE_TEXT);
    assert.equal(result?.text.includes("10 ml") || result?.text.includes("半粒") || result?.text.includes("一粒") || result?.text.includes("半包"), false);
  }
});

test('R4: unverified completion wording and ungrounded dose amounts never become plain text (F2-F3)', async () => {
  const { requiresChatDeliveryReview: needsReview, draftLooksLikeSubstantiveCareAdvice: looksLikeCare } = await import('../server/chat-delivery-review.ts');
  const { createAgentRuntime: makeRuntime } = await import('../server/agent-runtime.ts');
  const { createProductAgent: makeAgent } = await import('../server/product-agent.ts');
  const { readAiConfig: readConfig } = await import('../server/ai-config.ts');
  const { FinishReason: Finish } = await import('@google/genai');
  const r4Scope = { userId: 'synthetic-user', workspaceId: 'synthetic-workspace', childId: '1ebcb39d-a2db-4b8c-a432-7ffcb3de5808', authorizationVersion: '1', dataVersion: 'epoch:1' };
  const messageId = '66666666-6666-4666-8666-6666666666a4';
  const runId = '77777777-7777-4777-8777-7777777777a4';

  async function presentOnly(userMsg: string, draftText: string) {
    let reviewCalls = 0;
    let saved: any = null;
    const runtime = makeRuntime({
      config: readConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: 'synthetic-project', AI_DAILY_USER_ATTEMPTS: '10', AI_DAILY_GLOBAL_ATTEMPTS: '50' }),
      usage: { reserve: async () => true, record: async () => {} },
      provider: {
        generate: async (request: any) => {
          const promptText = request.contents.flatMap((content: any) => content.parts ?? []).map((part: any) => part.text ?? '').join('\n');
          if (promptText.includes('chat-delivery-review')) {
            reviewCalls++;
            const payload = JSON.parse(promptText.slice(promptText.indexOf('{'))) as { draftHash: string; verifiedOperations?: unknown[] };
            assert.deepEqual(payload.verifiedOperations ?? [], []);
            return {
              content: { role: 'model', parts: [{ text: JSON.stringify({ draftHash: payload.draftHash, decision: 'insufficient_evidence', issues: [{ paragraph: 0, reason: 'unverified claim' }] }) }] },
              finishReason: Finish.STOP,
            };
          }
          return {
            content: { role: 'model', parts: [{ functionCall: { id: 'present-r4', name: 'present_answer', args: { kind: 'clarification', paragraphs: [{ text: draftText, citationIds: [] }] } } }] },
            finishReason: Finish.STOP,
          };
        },
      },
    } as any);
    const service = makeAgent({
      runtime,
      store: {
        claim: async () => ({ runId, scope: r4Scope, created: true, state: 'running', expiresAt: new Date(Date.now() + 90000).toISOString() }),
        authorize: async () => true,
        finish: async (_s: unknown, result: unknown) => { saved = result; return true; },
        get: async () => saved,
      },
      memory: {
        initialConversationSummary: async () => null,
        context: async () => ({
          profile: { childId: r4Scope.childId, version: 0, data: null },
          profileApplicable: false,
          facts: [],
          topics: [],
          summary: null,
          recentMessages: [],
          conflictingKeys: [],
          unavailableFactKeys: [],
          truncated: { facts: false, topics: false, messages: false },
        }),
        facts: async () => ({ items: [], nextAfterId: null }),
      },
      chat: { listForUser: async () => ({ messages: [{ id: messageId, role: 'user', text: userMsg }] }) },
      tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) },
      knowledge: { createRun: () => ({ search: async () => ({ mode: 'vector_keyword', chunks: [] }), revalidateCitations: async () => true }) },
    } as any);
    const result = await service.reply(r4Scope.userId, r4Scope.childId, messageId, async () => true);
    assert.ok(result);
    return { result, reviewCalls };
  }

  const draftOf = (userRequest: string, text: string) => ({
    userRequest,
    kind: 'clarification' as const,
    visibility: 'private' as const,
    serverSubstitutedSourceText: false,
    paragraphs: [{ text, citationIds: [] as string[] }],
    sources: [],
    scope: r4Scope,
  });

  for (const [userMsg, claim] of [
    ['幫我更改提醒', '提醒時間改好喇。'],
    ['刪除紀錄', '所有紀錄都清空晒。'],
    ['幫我取消提醒', '搞掂喇，提醒已經冇咗。'],
    ['幫我更新提醒時間', '提醒時間已經轉做七點。'],
  ] as const) {
    assert.equal(needsReview({
      kind: 'clarification',
      visibility: 'private',
      serverSubstitutedSourceText: false,
      paragraphs: [{ text: claim, citationIds: [] }],
      sources: [],
      scope: r4Scope,
    } as any), true, `Bare completion wording without userRequest must require review: ${claim}`);
    assert.equal(needsReview(draftOf(userMsg, claim) as any), true, `Completion wording without a receipt must require review: ${claim}`);
    const { result, reviewCalls } = await presentOnly(userMsg, claim);
    assert.equal(reviewCalls, 1, `Unverified completion must reach delivery review: ${claim}`);
    assert.equal(result.status, 'stopped');
    assert.equal(result.text.includes(claim), false);
  }

  for (const [userMsg, dose] of [
    ['BB發燒點算？', '每次四分之一粒。'],
    ['BB發燒點算？', '每晚半粒，連續三日。'],
    ['BB發燒點算？', '一日兩次，每次1/4粒。'],
    ['BB發燒點算？', '睡前食半茶匙。'],
    ['BB發燒點算？', '四分一粒。'],
    ['BB發燒點算？', '每4小時四分之一粒。'],
  ] as const) {
    const bareDraft = {
      kind: 'clarification' as const,
      visibility: 'private' as const,
      serverSubstitutedSourceText: false,
      paragraphs: [{ text: dose, citationIds: [] as string[] }],
      sources: [],
      scope: r4Scope,
    };
    assert.equal(looksLikeCare(bareDraft as any), true, `Bare dose wording must classify as care advice: ${dose}`);
    assert.equal(needsReview(bareDraft as any), true, `Bare dose wording must require review: ${dose}`);
    assert.equal(looksLikeCare(draftOf(userMsg, dose) as any), true, `Dose wording is care advice without a medicine word in the question: ${dose}`);
    assert.equal(needsReview(draftOf(userMsg, dose) as any), true, `Dose wording must require review: ${dose}`);
    const { result } = await presentOnly(userMsg, dose);
    assert.equal(result.status, 'stopped', `Ungrounded dose must not be delivered: ${dose}`);
    assert.equal(result.text.includes('粒') || result.text.includes('茶匙'), false);
  }

  for (const [userMsg, text] of [
    ['你好', '你好！有咩可以幫到你？'],
    ['幫我更改提醒', '你想改成幾點？'],
    ['BB發燒點算？', 'BB幾個月大？'],
  ] as const) {
    assert.equal(needsReview(draftOf(userMsg, text) as any), false, `Control must stay exempt: ${text}`);
  }
});
