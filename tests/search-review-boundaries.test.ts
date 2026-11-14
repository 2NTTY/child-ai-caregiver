import assert from "node:assert/strict";
import test from "node:test";
import type { LlmRequest } from "@google/adk";
import { FinishReason } from "@google/genai";
import {
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
