import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { InMemorySessionService } from "@google/adk";
import type { LlmRequest, LlmResponse } from "@google/adk";
import { FinishReason } from "@google/genai";
import { AGENT_LIMITS, AgentBudget, AgentStopped } from "../server/agent-budget.ts";
import { AgentGatewayModel } from "../server/agent-model-gateway.ts";
import { createProductAgentTools } from "../server/product-agent-tools.ts";
import { createAgentRuntime } from "../server/agent-runtime.ts";
import { createProductAgent } from "../server/product-agent.ts";
import { readAiConfig } from "../server/ai-config.ts";
import { dataComposeDraftHash } from "../server/data-compose.ts";
import type { DataComposeDraft } from "../src/shared/data-compose.ts";
import type { MemoryFact } from "../src/shared/memory.ts";
import { AGENT_CONFIRMATION_PENDING_TEXT } from "../server/agent-work-tool-descriptions.ts";
import { loadAgentPrompt } from "../server/agent-prompt.ts";
import {
  chatDeliveryDraftHash, chatDeliveryExcerpt, chatDeliveryPassNeedsSources, chatDeliveryReviewAllows,
  chatDeliveryReviewSourceExcerpt, draftLooksLikeSubstantiveCareAdvice, draftLooksLikeDirectiveCareAdvice, isPureClarifyingQuestion, isPureGreetingOrSmallTalk,
  enforceChatDeliveryReview, requiresChatDeliveryReview, SERVER_SKIP_CHAT_DELIVERY_REVIEW_TEXTS,
  type ChatDeliveryDraft,
} from "../server/chat-delivery-review.ts";
import { agentAnswerSchema, type ProductAgentResult } from "../src/shared/product-agent.ts";
import {
  CHAT_DELIVERY_REVIEW_INCOMPLETE_TEXT, CHAT_DELIVERY_REVIEW_POLICY_VERSION, chatDeliveryReviewDecisionSchema,
} from "../src/shared/chat-delivery-review.ts";
import { productAgentResultSchema } from "../src/shared/product-agent-result.ts";
import type { DurableRootBudget, RootBudgetContext, RootBudgetSnapshot } from "../server/durable-root-budget.ts";

const userId = "synthetic-user";
const childId = "1ebcb39d-a2db-4b8c-a432-7ffcb3de5808";
const runId = "d4a1b662-d13d-476b-bf52-40a28aa1a1a7";
const messageId = "7de5a0e8-e106-4485-b7d2-3b572741da39";
const scope = { userId, childId, workspaceId: "synthetic-workspace", authorizationVersion: "1", dataVersion: "epoch:1" };
const hashA = "a".repeat(64);
const hashB = "b".repeat(64);

function draft(text = "合成句子", version = "v1", contentHash = hashA): ChatDeliveryDraft {
  return {
    kind: "caregiving", visibility: "private", serverSubstitutedSourceText: false,
    paragraphs: [{ text, citationIds: ["chunk-1"] }],
    sources: [{ citationId: "chunk-1", version, contentHash, classification: "official_guidance", excerpt: "合成句子", excerptComplete: true }],
    scope,
  };
}

function passRecord(current = draft(), promptVersion = "0.1.39") {
  return {
    draftHash: chatDeliveryDraftHash(current),
    sourceVersions: current.sources.map(source => ({ citationId: source.citationId, version: source.version, contentHash: source.contentHash })),
    scope: { userId: scope.userId, workspaceId: scope.workspaceId, childId: scope.childId,
      authorizationVersion: scope.authorizationVersion, dataVersion: scope.dataVersion },
    visibility: current.visibility, decision: "pass" as const, model: "gemini-3.1-flash-lite", promptVersion,
    policyVersion: CHAT_DELIVERY_REVIEW_POLICY_VERSION,
  };
}

test("review binding follows the draft hash, source version and scope", () => {
  const current = draft();
  const record = passRecord(current);
  assert.equal(chatDeliveryReviewAllows(record, current, "0.1.39"), true);
  assert.equal(chatDeliveryReviewAllows(record, draft("另一句沒有依據的說法"), "0.1.39"), false);
  assert.equal(chatDeliveryReviewAllows(record, draft("合成句子", "v2"), "0.1.39"), false);
  assert.equal(chatDeliveryReviewAllows(record, draft("合成句子", "v1", hashB), "0.1.39"), false);
  assert.equal(chatDeliveryReviewAllows(record, { ...current, scope: { ...scope, dataVersion: "epoch:2" } }, "0.1.39"), false);
  assert.equal(chatDeliveryReviewAllows({ ...record, decision: "revise" }, current, "0.1.39"), false);
  assert.equal(chatDeliveryReviewAllows(record, current, "0.1.37"), false);
});

test("self-labelled exemptions and publish decisions are not chat-delivery review", () => {
  assert.equal(requiresChatDeliveryReview(draft()), true);
  assert.equal(requiresChatDeliveryReview({ ...draft(), serverSubstitutedSourceText: true }), false);
  for (const kind of ["clarification", "operation", "record_restatement"] as const) {
    // Ordinary uncited wording alone does not establish a review task; labels cannot clear one.
    assert.equal(requiresChatDeliveryReview({ ...draft(), kind, sources: [], paragraphs: [{ text: "沒有引用的說明", citationIds: [] }] }), false);
    assert.equal(requiresChatDeliveryReview({ ...draft(), kind }), true);
  }
  const careAsOperation = {
    ...draft(), kind: "operation" as const, sources: [],
    paragraphs: [{ text: "所有新生兒都應立即加鹽。", citationIds: [] }],
  };
  assert.equal(requiresChatDeliveryReview(careAsOperation), true);
  assert.equal(chatDeliveryPassNeedsSources(careAsOperation), true);
  const englishCare = {
    ...draft(), kind: "operation" as const, sources: [],
    paragraphs: [{ text: "Newborns should be given salt immediately.", citationIds: [] }],
  };
  const yueCare = {
    ...draft(), kind: "operation" as const, sources: [],
    paragraphs: [{ text: "BB未滿一歲唔好食蜜糖。", citationIds: [] }],
  };
  const rephrasedCare = {
    ...draft(), kind: "record_restatement" as const, sources: [],
    paragraphs: [{ text: "Don't give honey to infants under one year.", citationIds: [] }],
  };
  for (const sample of [englishCare, yueCare, rephrasedCare]) {
    assert.equal(draftLooksLikeSubstantiveCareAdvice(sample), true);
    assert.equal(requiresChatDeliveryReview(sample), true);
    assert.equal(chatDeliveryPassNeedsSources(sample), true);
  }
  const pureClarify = "寶寶幾個月大？";
  assert.equal(isPureClarifyingQuestion(pureClarify), true);
  assert.equal(requiresChatDeliveryReview({
    ...draft(), kind: "clarification", sources: [], paragraphs: [{ text: pureClarify, citationIds: [] }],
  }), false);
  assert.equal(chatDeliveryPassNeedsSources({
    ...draft(), kind: "clarification", sources: [], paragraphs: [{ text: pureClarify, citationIds: [] }],
  }), false);
  assert.equal(requiresChatDeliveryReview({
    ...draft(), kind: "clarification", sources: [],
    paragraphs: [{ text: "寶寶幾個月大？建議每日加鹽。", citationIds: [] }],
  }), true);
  const allowlisted = [...SERVER_SKIP_CHAT_DELIVERY_REVIEW_TEXTS][0]!;
  assert.equal(requiresChatDeliveryReview({
    ...draft(), kind: "operation", sources: [], paragraphs: [{ text: allowlisted, citationIds: [] }],
  }), false);
  assert.equal(requiresChatDeliveryReview({
    ...draft(), kind: "clarification", sources: [], paragraphs: [{ text: "請補充年齡？", citationIds: [] }],
  }), false);
  assert.equal(requiresChatDeliveryReview({ ...draft(), kind: "safety_help" }), true);
  assert.equal(requiresChatDeliveryReview({ ...draft(), kind: "private_reference" }), true);
  assert.equal(agentAnswerSchema.safeParse({ kind: "caregiving", paragraphs: [{ text: "句子", citationIds: ["chunk-1"] }], skipReview: true }).success, false);
  assert.equal(agentAnswerSchema.safeParse({ kind: "caregiving", paragraphs: [{ text: "句子", citationIds: ["chunk-1"] }], approved: true }).success, false);
  assert.equal(chatDeliveryReviewDecisionSchema.safeParse("approve").success, false);
  assert.equal(chatDeliveryReviewDecisionSchema.safeParse("hold").success, false);
  assert.equal(chatDeliveryReviewDecisionSchema.safeParse("insufficient_evidence").success, true);
});

test("classmate F1: citation-free care fails closed even when keywords miss", () => {
  for (const sample of [
    { kind: "operation" as const, text: "Put your child to sleep on their stomach." },
    { kind: "operation" as const, text: "瞓覺時畀孩子趴低就得。" },
    { kind: "clarification" as const, text: "Would you try giving your baby honey?" },
  ]) {
    const current = {
      ...draft(), kind: sample.kind, sources: [],
      paragraphs: [{ text: sample.text, citationIds: [] }],
    };
    assert.equal(requiresChatDeliveryReview(current), true, sample.text);
    assert.equal(isPureClarifyingQuestion(sample.text), false, sample.text);
  }
  // Trusted exemptions still skip.
  assert.equal(requiresChatDeliveryReview({
    ...draft(), kind: "clarification", sources: [], paragraphs: [{ text: "寶寶幾個月大？", citationIds: [] }],
  }), false);
  assert.equal(requiresChatDeliveryReview({
    ...draft(), kind: "operation", sources: [],
    paragraphs: [{ text: [...SERVER_SKIP_CHAT_DELIVERY_REVIEW_TEXTS][0]!, citationIds: [] }],
  }), false);
});


test("pure greetings skip delivery review without cites", () => {
  for (const text of ["你好", "你好！", "你好，有什麼可以幫你？", "您好。", "Hello!", "Hi", "Good morning"]) {
    assert.equal(isPureGreetingOrSmallTalk(text), true, text);
    assert.equal(requiresChatDeliveryReview({
      ...draft(), kind: "clarification", sources: [], paragraphs: [{ text, citationIds: [] }],
    }), false, text);
    // Model kind alone must not force review when the text is a trusted greeting shape.
    assert.equal(requiresChatDeliveryReview({
      ...draft(), kind: "caregiving", sources: [], paragraphs: [{ text, citationIds: [] }],
    }), false, `caregiving:${text}`);
  }
  // Care-shaped text that opens with a greeting still fails closed into review.
  for (const text of ["你好，BB不要吃蜂蜜", "Hello, newborns should not have honey."]) {
    assert.equal(isPureGreetingOrSmallTalk(text), false, text);
    assert.equal(requiresChatDeliveryReview({
      ...draft(), kind: "clarification", sources: [], paragraphs: [{ text, citationIds: [] }],
    }), true, text);
  }
  // Mixed content after a greeting marker is not a whole-utterance greeting (Owner synthetic).
  // Keyword blacklists alone must not be the gate: these skip care-domain/advisory patterns.
  for (const sample of [
    { text: "你好，睡前食兩粒阿士匹靈。", kind: "caregiving" as const },
    { text: "你好，已完成刪除記錄。", kind: "operation" as const },
  ]) {
    assert.equal(isPureGreetingOrSmallTalk(sample.text), false, sample.text);
    assert.equal(requiresChatDeliveryReview({
      ...draft(), kind: sample.kind, sources: [], paragraphs: [{ text: sample.text, citationIds: [] }],
    }), true, sample.text);
  }
  // Ordinary uncited wording is not a greeting, but does not itself require a reviewer.
  assert.equal(isPureGreetingOrSmallTalk("沒有引用的說明"), false);
  assert.equal(requiresChatDeliveryReview({
    ...draft(), kind: "clarification", sources: [], paragraphs: [{ text: "沒有引用的說明", citationIds: [] }],
  }), false);
});
test("citation-free clarification softeners still require delivery review", () => {
  // Owner synthetic: advice / fake receipt wrapped as a softener question must not skip.
  // Do not rely on model kind, question mark shape, or thin keyword blacklists alone.
  for (const sample of [
    { text: "你好，睡前食兩粒阿士匹靈，好嗎？", kind: "clarification" as const },
    { text: "睡前食兩粒阿士匹靈，好嗎？", kind: "caregiving" as const },
    { text: "睡前食兩粒阿士匹靈好嗎？", kind: "clarification" as const },
    { text: "建議每日加鹽，好嗎？", kind: "clarification" as const },
    { text: "已完成刪除記錄，對嗎？", kind: "operation" as const },
    { text: "你好，已完成刪除記錄，對嗎？", kind: "clarification" as const },
    { text: "Take two aspirin at bedtime, okay?", kind: "clarification" as const },
  ]) {
    assert.equal(isPureClarifyingQuestion(sample.text), false, sample.text);
    assert.equal(requiresChatDeliveryReview({
      ...draft(), kind: sample.kind, sources: [], paragraphs: [{ text: sample.text, citationIds: [] }],
    }), true, sample.text);
  }
  // Trusted pure clarifies still skip.
  for (const text of ["寶寶幾個月大？", "請補充年齡？", "有沒有發燒？"]) {
    assert.equal(isPureClarifyingQuestion(text), true, text);
    assert.equal(requiresChatDeliveryReview({
      ...draft(), kind: "clarification", sources: [], paragraphs: [{ text, citationIds: [] }],
    }), false, text);
  }
});

test("classmate F2: multi-question clarifies and saved receipts with domain nouns", () => {
  for (const text of [
    "寶寶幾個月大？ 有沒有發燒？",
    "寶寶幾個月大？有沒有發燒？",
    "寶寶幾個月大？\n有沒有發燒？",
  ]) {
    assert.equal(isPureClarifyingQuestion(text), true, text);
    assert.equal(requiresChatDeliveryReview({
      ...draft(), kind: "clarification", sources: [], paragraphs: [{ text, citationIds: [] }],
    }), false, text);
  }
  const receipt = "已記錄寶寶喝奶 120 毫升。";
  assert.equal(requiresChatDeliveryReview({
    ...draft(), kind: "operation", sources: [], paragraphs: [{ text: receipt, citationIds: [] }],
  }), true);
  assert.equal(requiresChatDeliveryReview({
    ...draft(), kind: "operation", sources: [], serverSubstitutedReceiptText: true,
    paragraphs: [{ text: "已保存 1 項操作。", citationIds: [] }],
  }), false);
  // Advisory care still cannot hide behind an operation label.
  assert.equal(requiresChatDeliveryReview({
    ...draft(), kind: "operation", sources: [],
    paragraphs: [{ text: "Put your child to sleep on their stomach.", citationIds: [] }],
  }), true);
});

test("pure greetings skip delivery review without cites or memory grounding", () => {
  for (const text of ["你好", "你好！", "你好，有什麼可以幫你？", "您好！", "Hello!", "Hi", "Good morning"]) {
    assert.equal(isPureGreetingOrSmallTalk(text), true, text);
    assert.equal(requiresChatDeliveryReview({
      ...draft(), kind: "clarification", sources: [], paragraphs: [{ text, citationIds: [] }],
    }), false, text);
    // Model kind alone must not force review when the text is a trusted greeting shape.
    assert.equal(requiresChatDeliveryReview({
      ...draft(), kind: "caregiving", sources: [], paragraphs: [{ text, citationIds: [] }],
    }), false, `caregiving:${text}`);
  }
  // Care-shaped text that opens with a greeting still fails closed into review.
  for (const text of ["你好，BB不要吃蜂蜜", "Hello, newborns should not have honey."]) {
    assert.equal(isPureGreetingOrSmallTalk(text), false, text);
    assert.equal(requiresChatDeliveryReview({
      ...draft(), kind: "clarification", sources: [], paragraphs: [{ text, citationIds: [] }],
    }), true, text);
  }
  // Mixed content after a greeting marker is not a whole-utterance greeting (Owner synthetic).
  // Keyword blacklists alone must not be the gate: these skip care-domain/advisory patterns.
  for (const sample of [
    { text: "你好，睡前食兩粒阿士匹靈。", kind: "caregiving" as const },
    { text: "你好，已完成刪除記錄。", kind: "operation" as const },
  ]) {
    assert.equal(isPureGreetingOrSmallTalk(sample.text), false, sample.text);
    assert.equal(requiresChatDeliveryReview({
      ...draft(), kind: sample.kind, sources: [], paragraphs: [{ text: sample.text, citationIds: [] }],
    }), true, sample.text);
  }
  // Ordinary uncited wording is not a greeting, but does not itself require a reviewer.
  assert.equal(isPureGreetingOrSmallTalk("沒有引用的說明"), false);
  assert.equal(requiresChatDeliveryReview({
    ...draft(), kind: "clarification", sources: [], paragraphs: [{ text: "沒有引用的說明", citationIds: [] }],
  }), false);
});
test("citation-free clarification softeners still require delivery review", () => {
  // Owner synthetic: advice / fake receipt wrapped as a softener question must not skip.
  // Do not rely on model kind, question mark shape, or thin keyword blacklists alone.
  for (const sample of [
    { text: "你好，睡前食兩粒阿士匹靈，好嗎？", kind: "clarification" as const },
    { text: "睡前食兩粒阿士匹靈，好嗎？", kind: "caregiving" as const },
    { text: "睡前食兩粒阿士匹靈好嗎？", kind: "clarification" as const },
    { text: "建議每日加鹽，好嗎？", kind: "clarification" as const },
    { text: "已完成刪除記錄，對嗎？", kind: "operation" as const },
    { text: "你好，已完成刪除記錄，對嗎？", kind: "clarification" as const },
    { text: "Take two aspirin at bedtime, okay?", kind: "clarification" as const },
  ]) {
    assert.equal(isPureClarifyingQuestion(sample.text), false, sample.text);
    assert.equal(requiresChatDeliveryReview({
      ...draft(), kind: sample.kind, sources: [], paragraphs: [{ text: sample.text, citationIds: [] }],
    }), true, sample.text);
  }
  // Trusted pure clarifies still skip.
  for (const text of ["寶寶幾個月大？", "請補充年齡？", "有沒有發燒？"]) {
    assert.equal(isPureClarifyingQuestion(text), true, text);
    assert.equal(requiresChatDeliveryReview({
      ...draft(), kind: "clarification", sources: [], paragraphs: [{ text, citationIds: [] }],
    }), false, text);
  }
});

test("confirmed memory sources are review evidence, never a delivery-review free pass", () => {
  const memorySource = {
    citationId: "memory-fact:synthetic", version: "3", contentHash: hashA,
    classification: "private" as const, excerpt: "BB 對雞蛋過敏", excerptComplete: true,
  };
  for (const text of [
    "已確認記憶：BB 對雞蛋過敏。",
    "BB 對雞蛋並不過敏。",
    "已確認記憶：BB 喜歡藍色。",
  ]) {
    const memoryRestatement = {
      ...draft(), kind: "record_restatement" as const, sources: [memorySource],
      paragraphs: [{ text, citationIds: [] }],
    };
    assert.equal(requiresChatDeliveryReview(memoryRestatement), true, text);
    assert.equal(chatDeliveryPassNeedsSources(memoryRestatement), false);
  }
  // Deprecated flag must not skip review either.
  assert.equal(requiresChatDeliveryReview({
    ...draft(), kind: "record_restatement", sources: [{
      citationId: "memory-fact:synthetic", version: "3", contentHash: hashA,
      classification: "private", excerpt: "BB 對雞蛋過敏", excerptComplete: true,
    }],
    paragraphs: [{ text: "BB 對雞蛋並不過敏。", citationIds: [] }],
    serverVerifiedMemoryGrounding: true,
  }), true);
  // Citation-free restatement without sources still fails closed into review.
  assert.equal(requiresChatDeliveryReview({
    ...draft(), kind: "record_restatement", sources: [],
    paragraphs: [{ text: "已確認記憶：BB 對雞蛋過敏。", citationIds: [] }],
  }), true);
});

test("memory exemption gate ignores domain-only BB wording but blocks directive advice", () => {
  const domainOnly = {
    ...draft(), kind: "record_restatement" as const, sources: [],
    paragraphs: [{ text: "已確認記憶：BB 對花生過敏。", citationIds: [] }],
  };
  const directive = {
    ...draft(), kind: "operation" as const, sources: [],
    paragraphs: [{ text: "BB未滿一歲唔好食蜜糖。", citationIds: [] }],
  };
  assert.equal(draftLooksLikeSubstantiveCareAdvice(domainOnly), true);
  assert.equal(draftLooksLikeDirectiveCareAdvice(domainOnly), false);
  assert.equal(draftLooksLikeDirectiveCareAdvice(directive), true);
  assert.equal(draftLooksLikeSubstantiveCareAdvice(directive), true);
});

test("classmate F3: reviewer source excerpt keeps support after the first 800 characters", () => {
  const support = "Only after six months may fortified cereal be offered once daily.";
  const body = `${"x".repeat(800)}${support}`;
  assert.ok(body.length > 800 && body.length <= 4000);
  const head = chatDeliveryExcerpt(body);
  assert.equal(head.excerptComplete, false);
  assert.equal(head.excerpt.includes(support), false);
  const review = chatDeliveryReviewSourceExcerpt(body);
  assert.equal(review.excerptComplete, true);
  assert.equal(review.excerpt.includes(support), true);
  assert.equal(review.excerpt, body);
});

test("a persisted pass omits excerpts and private evidence", () => {
  const parsed = productAgentResultSchema.parse({
    provenance: null, runId, status: "completed", stopReason: null, text: "已核對", citations: [], retrievalMode: "not_used",
    tools: [], counts: { modelCalls: 2, toolCalls: 1, queryEmbeddings: 0 }, proposals: [], deliveryReview: passRecord(),
  });
  assert.equal(parsed.deliveryReview?.decision, "pass");
  assert.equal(JSON.stringify(parsed.deliveryReview).includes("合成句子"), false);
  assert.equal(productAgentResultSchema.safeParse({
    provenance: null, runId, status: "completed", stopReason: null, text: "已核對", citations: [], retrievalMode: "not_used",
    tools: [], counts: { modelCalls: 1, toolCalls: 1, queryEmbeddings: 0 }, proposals: [],
    deliveryReview: { ...passRecord(), excerpt: "private body" },
  }).success, false);
});

interface Script {
  calls: number;
  generate(request: LlmRequest): Promise<LlmResponse>;
}

function product(script: Script, options: { reviewCalls?: 4 | 6; bound?: boolean; revalidateCitations?: () => boolean | Promise<boolean>; reserve?: () => Promise<boolean>; onProgress?: (event: import("../src/shared/agent-feedback.ts").AgentProgress) => void; store?: Record<string, unknown>; documents?: unknown; userText?: string } = {}) {
  const expiresAt = new Date(Date.now() + 90_000).toISOString();
  let claimed = false, saved: ProductAgentResult | null = null;
  const runtime = createAgentRuntime({
    config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project",
      ...(options.reviewCalls === 6 ? { AI_CHAT_DELIVERY_REVIEW_MODEL_CALLS: "6" } : {}) }),
    ...(options.reviewCalls === 6 ? { chatDeliveryReviewModelCalls: 6 as const } : {}),
    usage: { reserve: options.reserve ?? (async () => true), record: async () => {} },
    provider: { generate: request => script.generate(request) },
    ...(options.bound ? {
      nativeSessionService: new InMemorySessionService(),
      chatDeliveryReviewModelCalls: 6 as const,
      boundRunLimits: { modelCalls: 4, queryEmbeddings: 2 },
      bindDurableRun: (input, pack, limits) => {
        assert.equal(limits.modelCalls, 4);
        assert.equal(AGENT_LIMITS.modelCalls, 4);
        assert.equal(limits.toolCalls, AGENT_LIMITS.toolCalls);
        const deadlineAtMs = input.deadlineAtMs ?? Date.parse(expiresAt);
        const context: RootBudgetContext = { generation: 1, binding: {
          rootRunId: runId, ownerId: userId, workspaceId: scope.workspaceId, childId, authorizationVersion: "1", storageEpoch: "epoch",
          trigger: { kind: "interactive", reference: messageId }, workflowVersion: "workflow", promptPackVersion: pack,
          settingsVersion: "fixed-settings", billingVersion: "fixed-billing",
          limits: { modelCalls: limits.modelCalls, toolCalls: limits.toolCalls, queryEmbeddings: limits.queryEmbeddings }, deadlineAtMs,
        } };
        const snapshot: RootBudgetSnapshot = { generation: 1, deadlineAtMs, limits: { ...context.binding.limits },
          used: { modelCalls: 0, toolCalls: 0, queryEmbeddings: 0 }, status: "active", attempts: [] };
        const adapter: DurableRootBudget = {
          open: async () => structuredClone(snapshot), read: async () => structuredClone(snapshot),
          reserve: async (_context, attempt) => {
            snapshot.attempts.push({ ...attempt, outcome: { status: "reserved" } });
            snapshot.used[attempt.kind === "model" ? "modelCalls" : attempt.kind === "embedding" ? "queryEmbeddings" : "toolCalls"] += attempt.units;
            return { decision: "execute", attempt: snapshot.attempts.at(-1)!, snapshot: structuredClone(snapshot) };
          },
          settle: async () => { throw new Error("No settlement permitted"); },
          stop: async () => { snapshot.status = "stopped"; return structuredClone(snapshot); },
        };
        return { adapter, context };
      },
    } : {}),
  });
  const service = createProductAgent({
    runtime,
    store: {
      claim: async () => { const created = !claimed; claimed = true; return { runId, scope, created, state: "running", expiresAt }; },
      authorize: async () => true,
      finish: async (_scope: unknown, result: ProductAgentResult) => { saved = result; return true; },
      get: async () => saved,
      ...options.store,
    },
    ...(options.documents ? { documents: options.documents } : {}),
    memory: { context: async () => ({ profile: { childId, version: 0, data: null }, profileApplicable: false,
      facts: [], topics: [], summary: null, recentMessages: [], conflictingKeys: [], unavailableFactKeys: [],
      truncated: { facts: false, topics: false, messages: false } }) },
    chat: { listForUser: async () => ({ messages: [{ id: messageId, role: "user", text: options.userText ?? "請說明合成照護情境。" }] }) },
    tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) },
    knowledge: { createRun: () => ({ search: async () => ({ mode: "vector_keyword", chunks: [chunk] }),
      revalidateCitations: async () => options.revalidateCitations ? options.revalidateCitations() : true }) },
  } as unknown as Parameters<typeof createProductAgent>[0]);
  return service.reply(userId, childId, messageId, async () => true, undefined, options.onProgress);
}

const chunk = { chunkId: "reviewed-chunk", classification: "official_guidance" as const, text: "只適用於六個月以上，而且沒有提到加鹽。" };
const claim = "所有新生兒都應立即加鹽。";

function payloadFrom(request: LlmRequest) {
  const user = request.contents.flatMap(content => content.parts ?? []).map(part => part.text ?? "").join("\n");
  const body = user.includes("{") ? JSON.parse(user.slice(user.indexOf("{"))) as {
    draftHash?: string; paragraphs?: { text: string; citationIds: string[] }[]; sources?: { citationId: string; excerpt: string }[];
  } : {};
  return { user, body };
}

function reviewJson(draftHash: string, decision: "pass" | "revise" | "insufficient_evidence") {
  return JSON.stringify({ draftHash, decision, issues: decision === "pass" ? [] : [{ paragraph: 0, reason: "unsupported meaning", support: "excerpt does not state the claim" }] });
}

function model(parts: { text?: string; functionCall?: { id: string; name: string; args: Record<string, unknown> } }[]) {
  return { content: { role: "model" as const, parts }, finishReason: FinishReason.STOP };
}

test("a real citation whose excerpt does not support the claim is not a formal reply", async () => {
  let calls = 0;
  const result = await product({ calls, generate: async request => {
    const { user, body } = payloadFrom(request);
    calls++;
    if (user.includes("chat-delivery-review")) {
        assert.equal(Object.keys(request.toolsDict).length, 0);
      assert.equal(body.paragraphs?.[0]?.text, claim);
      return model([{ text: reviewJson(body.draftHash ?? "", "revise") }]);
    }
    const step = calls === 1
      ? { id: "search", name: "search_knowledge", args: { query: "合成照護主題", classification: "official_guidance" } }
      : calls === 2 ? { id: "answer", name: "present_answer", args: { kind: "caregiving", paragraphs: [{ text: claim, citationIds: [chunk.chunkId] }] } }
      : null;
    assert.ok(step, "Repair must not start when one call remains");
    return model([{ functionCall: step }]);
  } });
  assert.equal(result?.status, "stopped");
  assert.equal(result?.stopReason, "delivery_review_budget");
  assert.equal(result?.text, CHAT_DELIVERY_REVIEW_INCOMPLETE_TEXT);
  assert.equal(result?.text.includes(claim), false);
  // Retrieved official sources stay visible as non-approved evidence (REQ-002 source layer).
  assert.equal(result?.citations.length, 1);
  assert.equal(result?.citations[0]?.chunkId, chunk.chunkId);
  assert.equal(result?.retrievalMode, "vector_keyword");
  assert.equal(result?.deliveryReview, undefined);
  assert.equal(result?.counts.modelCalls, 3);
  assert.equal(calls, 3);
});

test("review failure keeps retrieved sources without elevating the unreviewed draft", async () => {
  let calls = 0;
  const result = await product({ calls, generate: async request => {
    const { user, body } = payloadFrom(request);
    calls++;
    if (user.includes("chat-delivery-review")) {
      assert.equal(Object.keys(request.toolsDict).length, 0);
      assert.equal(body.paragraphs?.[0]?.text, claim);
      return model([{ text: reviewJson(body.draftHash ?? "", "insufficient_evidence") }]);
    }
    const step = calls === 1
      ? { id: "search", name: "search_knowledge", args: { query: "合成照護主題", classification: "official_guidance" } }
      : calls === 2 ? { id: "answer", name: "present_answer", args: { kind: "caregiving", paragraphs: [{ text: claim, citationIds: [chunk.chunkId] }] } }
      : null;
    assert.ok(step);
    return model([{ functionCall: step }]);
  } });
  assert.equal(result?.status, "stopped");
  assert.equal(result?.stopReason, "delivery_review_rejected");
  assert.equal(result?.text, CHAT_DELIVERY_REVIEW_INCOMPLETE_TEXT);
  assert.equal(result?.text.includes(claim), false);
  assert.equal(result?.citations.length, 1);
  assert.equal(result?.citations[0]?.chunkId, chunk.chunkId);
  assert.equal(result?.citations[0]?.text, chunk.text);
  assert.equal(result?.retrievalMode, "vector_keyword");
  assert.equal(result?.deliveryReview, undefined);
});

test("an unreviewed draft is not formal success after the final reserved review attempt", async () => {
  let calls = 0;
  const result = await product({ calls, generate: async request => {
    calls++;
    const { user } = payloadFrom(request);
    if (user.includes("chat-delivery-review")) {
      assert.equal(calls, 4);
      return model([{ text: "invalid independent review" }]);
    }
    const steps = [
      [{ id: "read", name: "read_context", args: {} }, { id: "load", name: "load_capabilities", args: { capabilities: ["tasks"] } }],
      [{ id: "search", name: "search_knowledge", args: { query: "合成照護主題", classification: "official_guidance" } }],
      [{ id: "answer", name: "present_answer", args: { kind: "caregiving", paragraphs: [{ text: claim, citationIds: [chunk.chunkId] }] } }],
    ];
    const step = steps[calls - 1];
    assert.ok(step, "A fourth generation or fifth provider must not start");
    return model(step.map(functionCall => ({ functionCall })));
  } });
  assert.equal(result?.status, "stopped");
  assert.equal(result?.stopReason, "delivery_review_incomplete");
  assert.equal(result?.text, CHAT_DELIVERY_REVIEW_INCOMPLETE_TEXT);
  assert.equal(result?.text.includes(claim), false);
  assert.equal(result?.citations.length, 1);
  assert.equal(result?.citations[0]?.chunkId, chunk.chunkId);
  assert.equal(result?.deliveryReview, undefined);
  assert.equal(result?.counts.modelCalls, 4);
  assert.equal(calls, 4);
  assert.equal(AGENT_LIMITS.modelCalls, 4);
});

test("a bound limit of four is not raised by the six-call proposal", async () => {
  const pack = await loadAgentPrompt("product-interactive", "tool_cycle", ["run", "scope", "conversation", "context", "evidence", "capabilities"]);
  const manifest = JSON.parse(await readFile(new URL("../prompts/manifest.json", import.meta.url), "utf8"));
  assert.equal(pack.packVersion, manifest.version);
  let calls = 0;
  const result = await product({ calls, generate: async request => {
    calls++;
    const { user, body } = payloadFrom(request);
    if (user.includes("chat-delivery-review")) {
      assert.equal(calls, 4);
      return model([{ text: reviewJson(body.draftHash ?? "", "revise") }]);
    }
    const steps = [
      [{ id: "read", name: "read_context", args: {} }, { id: "load", name: "load_capabilities", args: { capabilities: ["tasks"] } }],
      [{ id: "search", name: "search_knowledge", args: { query: "合成照護主題", classification: "official_guidance" } }],
      [{ id: "answer", name: "present_answer", args: { kind: "caregiving", paragraphs: [{ text: claim, citationIds: [chunk.chunkId] }] } }],
    ];
    const step = steps[calls - 1];
    assert.ok(step, "The original bound limit cannot grow to six");
    return model(step.map(functionCall => ({ functionCall })));
  } }, { bound: true, reviewCalls: 6 });
  assert.equal(result?.status, "stopped", JSON.stringify(result));
  assert.equal(result?.stopReason, "delivery_review_budget");
  assert.equal(result?.counts.modelCalls, 4);
  assert.equal(calls, 4);
  const config = readAiConfig({ AI_CHAT_DELIVERY_REVIEW_MODEL_CALLS: "6" });
  assert.equal(config.chatDeliveryReviewModelCalls, 6);
  assert.equal(config.dailyUserAttempts, 20);
  assert.equal(config.dailyGlobalAttempts, 100);
});

test("clarification that still cites a source is reviewed, and a server-allowlisted operation is not", async () => {
  for (const cited of [false, true]) {
    let reviews = 0;
    const result = await product({ calls: 0, generate: async request => {
      const { user, body } = payloadFrom(request);
      if (user.includes("chat-delivery-review")) {
        reviews++;
        assert.equal(cited, true);
        return model([{ text: reviewJson(body.draftHash ?? "", "pass") }]);
      }
      if (!cited) return model([{ functionCall: { id: "answer", name: "present_answer", args: { kind: "operation", paragraphs: [{ text: "請先使用畫面上的緊急求助入口。", citationIds: [] }] } } }]);
      const search = { id: "search", name: "search_knowledge", args: { query: "合成照護主題", classification: "official_guidance" } };
      const answer = { id: "answer", name: "present_answer", args: { kind: "clarification", paragraphs: [{ text: chunk.text, citationIds: [chunk.chunkId] }] } };
      return model([{ functionCall: reviews === 0 && request.contents.some(content => content.parts?.some(part => part.functionResponse)) ? answer : search }]);
    } });
    assert.equal(result?.status, "completed", JSON.stringify(result));
    assert.equal(reviews, cited ? 1 : 0);
    assert.equal(result?.deliveryReview?.decision, cited ? "pass" : undefined);
  }
});

test("one repair can pass inside the proposal ceiling, and insufficient evidence does not repair", async () => {
  for (const decision of ["revise", "insufficient_evidence"] as const) {
    let reviews = 0, repairs = 0;
    const result = await product({ calls: 0, generate: async request => {
      const { user, body } = payloadFrom(request);
      if (user.includes("Repair the draft")) {
        repairs++;
        assert.equal(decision, "revise");
        return model([{ text: JSON.stringify({ kind: "caregiving", paragraphs: [{ text: chunk.text, citationIds: [chunk.chunkId] }] }) }]);
      }
      if (user.includes("chat-delivery-review")) {
        reviews++;
        const supported = body.paragraphs?.every(paragraph => paragraph.text === chunk.text) ?? false;
        return model([{ text: reviewJson(body.draftHash ?? "", reviews === 1 ? decision : supported ? "pass" : "revise") }]);
      }
      const responded = request.contents.some(content => content.parts?.some(part => part.functionResponse));
      const step = responded
        ? { id: "answer", name: "present_answer", args: { kind: "caregiving", paragraphs: [{ text: claim, citationIds: [chunk.chunkId] }] } }
        : { id: "search", name: "search_knowledge", args: { query: "合成照護主題", classification: "official_guidance" } };
      return model([{ functionCall: step }]);
    } }, { reviewCalls: 6 });
    if (decision === "revise") {
      assert.equal(result?.status, "completed", JSON.stringify(result));
      assert.equal(result?.text, chunk.text + " [1]");
      assert.equal(result?.text.includes(claim), false);
      assert.equal(result?.deliveryReview?.decision, "pass");
      assert.equal(reviews, 2);
      assert.equal(repairs, 1);
      assert.equal(result?.counts.modelCalls, 5);
    } else {
      assert.equal(result?.status, "stopped");
      assert.equal(result?.stopReason, "delivery_review_rejected");
      assert.equal(result?.text, CHAT_DELIVERY_REVIEW_INCOMPLETE_TEXT);
      assert.equal(result?.text.includes(claim), false);
      assert.equal(result?.citations.length, 1);
      assert.equal(result?.citations[0]?.chunkId, chunk.chunkId);
      assert.equal(result?.deliveryReview, undefined);
      assert.equal(reviews, 1);
      assert.equal(repairs, 0);
    }
  }
  assert.equal(AGENT_LIMITS.modelCalls, 4);
  assert.equal(readAiConfig({ AI_CHAT_DELIVERY_REVIEW_MODEL_CALLS: "6" }).dailyGlobalAttempts, 100);
});

test("a repair that relabels the draft out of review does not become formal success", async () => {
  let repairs = 0;
  const result = await product({ calls: 0, generate: async request => {
    const { user, body } = payloadFrom(request);
    if (user.includes("Repair the draft")) {
      repairs++;
      return model([{ text: JSON.stringify({ kind: "clarification", paragraphs: [{ text: "請補充年齡。", citationIds: [] }] }) }]);
    }
    if (user.includes("chat-delivery-review")) return model([{ text: reviewJson(body.draftHash ?? "", "revise") }]);
    const responded = request.contents.some(content => content.parts?.some(part => part.functionResponse));
    const step = responded
      ? { id: "answer", name: "present_answer", args: { kind: "caregiving", paragraphs: [{ text: claim, citationIds: [chunk.chunkId] }] } }
      : { id: "search", name: "search_knowledge", args: { query: "合成照護主題", classification: "official_guidance" } };
    return model([{ functionCall: step }]);
  } }, { reviewCalls: 6 });
  assert.equal(repairs, 1);
  assert.equal(result?.status, "stopped");
  assert.equal(result?.stopReason, "delivery_review_rejected");
  assert.equal(result?.text.includes(claim), false);
  assert.equal(result?.text.includes("請補充年齡"), false);
});

test("care advice labelled operation without cites cannot complete with zero reviews", async () => {
  let reviews = 0;
  const result = await product({ calls: 0, generate: async request => {
    const { user, body } = payloadFrom(request);
    if (user.includes("chat-delivery-review")) {
      reviews++;
      return model([{ text: reviewJson(body.draftHash ?? "", "pass") }]);
    }
    return model([{ functionCall: { id: "answer", name: "present_answer", args: {
      kind: "operation", paragraphs: [{ text: "所有新生兒都應立即加鹽。", citationIds: [] }],
    } } }]);
  } });
  assert.ok(reviews >= 1, "server gate must schedule delivery review");
  assert.equal(result?.status, "stopped");
  assert.equal(result?.stopReason, "delivery_review_no_sources");
  assert.equal(result?.text, CHAT_DELIVERY_REVIEW_INCOMPLETE_TEXT);
  assert.equal(result?.text.includes("加鹽"), false);
  assert.equal(result?.deliveryReview, undefined);
});

test("a repair that only returns a review decision does not become formal success", async () => {
  let repairs = 0;
  const result = await product({ calls: 0, generate: async request => {
    const { user, body } = payloadFrom(request);
    if (user.includes("Repair the draft")) {
      repairs++;
      return model([{ text: reviewJson(body.draftHash ?? "", "pass") }]);
    }
    if (user.includes("chat-delivery-review")) return model([{ text: reviewJson(body.draftHash ?? "", "revise") }]);
    const responded = request.contents.some(content => content.parts?.some(part => part.functionResponse));
    const step = responded
      ? { id: "answer", name: "present_answer", args: { kind: "caregiving", paragraphs: [{ text: claim, citationIds: [chunk.chunkId] }] } }
      : { id: "search", name: "search_knowledge", args: { query: "合成照護主題", classification: "official_guidance" } };
    return model([{ functionCall: step }]);
  } }, { reviewCalls: 6 });
  assert.equal(repairs, 1);
  assert.equal(result?.status, "stopped");
  assert.equal(result?.stopReason, "delivery_review_incomplete");
  assert.equal(result?.text.includes(claim), false);
  assert.equal(result?.deliveryReview, undefined);
});


test("english and yue care labelled operation without cites cannot complete with zero reviews", async () => {
  for (const text of [
    "Newborns should be given salt immediately.",
    "BB未滿一歲唔好食蜜糖。",
    "Don't give honey to infants under one year.",
    "Put your child to sleep on their stomach.",
    "瞓覺時畀孩子趴低就得。",
    "Would you try giving your baby honey?",
  ]) {
    let reviews = 0;
    const result = await product({ calls: 0, generate: async request => {
      const { user, body } = payloadFrom(request);
      if (user.includes("chat-delivery-review")) {
        reviews++;
        return model([{ text: reviewJson(body.draftHash ?? "", "pass") }]);
      }
      return model([{ functionCall: { id: "answer", name: "present_answer", args: {
        kind: "operation", paragraphs: [{ text, citationIds: [] }],
      } } }]);
    } });
    assert.ok(reviews >= 1, `server gate must schedule delivery review for: ${text}`);
    assert.equal(result?.status, "stopped", text);
    assert.equal(result?.stopReason, "delivery_review_no_sources");
    assert.equal(result?.text, CHAT_DELIVERY_REVIEW_INCOMPLETE_TEXT);
    assert.equal(result?.deliveryReview, undefined);
  }
});

test("pure clarifying questions may deliver without delivery review", async () => {
  for (const sample of [
    { kind: "clarification", text: "寶寶幾個月大？" },
    { kind: "clarification", text: "寶寶幾個月大？ 有沒有發燒？" },
  ]) {
    let reviews = 0;
    const result = await product({ calls: 0, generate: async request => {
      const { user, body } = payloadFrom(request);
      if (user.includes("chat-delivery-review")) {
        reviews++;
        return model([{ text: reviewJson(body.draftHash ?? "", "pass") }]);
      }
      return model([{ functionCall: { id: "answer", name: "present_answer", args: {
        kind: sample.kind, paragraphs: [{ text: sample.text, citationIds: [] }],
      } } }]);
    } });
    assert.equal(reviews, 0, sample.text);
    assert.equal(result?.status, "completed", JSON.stringify({ sample, result }));
    assert.equal(result?.text, sample.text);
    assert.equal(result?.deliveryReview, undefined);
  }
});

test("server review excludes generator summaries and preserves root accounting", async () => {
  const budget = new AgentBudget();
  let reserves = 0, calls = 0, summaryReads = 0;
  const gateway = new AgentGatewayModel({
    config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project" }),
    budget, userId, childId, authorize: async () => true,
    usage: { reserve: async () => { reserves++; return true; }, record: async () => {} },
    readConversationSummary: async () => { summaryReads++; throw new Error("review must not load chat context"); },
    provider: { generate: async request => {
      calls++;
      assert.equal(request.contents.length, 1);
      assert.equal(request.contents[0]?.parts?.[0]?.text, "explicit evidence only");
      assert.ok(String(request.config?.systemInstruction).startsWith("review instructions\n\n"));
      assert.match(String(request.config?.systemInstruction), /Server role budget:/u);
      assert.equal(request.config?.tools, undefined);
      return model([{ text: "reviewed" }]);
    } },
  });
  try {
    assert.equal(await gateway.completeText({ system: "review instructions", user: "explicit evidence only", attemptKey: "model:review:test" }), "reviewed");
    assert.equal(summaryReads, 0);
    assert.equal(calls, 1);
    assert.equal(reserves, 1);
    assert.equal(budget.remainingModelCalls, AGENT_LIMITS.modelCalls - 1);
  } finally { budget.close(); }
});

test("only current server receipts replace operation prose and background no-action stays silent", async () => {
  const budget = new AgentBudget();
  let hasReceipt = false;
  const surface = createProductAgentTools({
    run: { scope, runId, budget }, background: true,
    authorize: async () => true,
    actions: { receipts: async () => hasReceipt ? [{ id: "receipt" }] : [] },
    memory: {}, tasks: {}, store: {},
    knowledge: { createRun: () => ({}) },
  } as unknown as Parameters<typeof createProductAgentTools>[0]);
  const present = surface.tools.find(tool => tool.name === "present_answer")!;
  try {
    await present.execute({ kind: "operation", paragraphs: [{ text: "已記錄寶寶喝奶 120 毫升。", citationIds: [] }] },
      { scope, runId, callId: "present", signal: budget.signal });
    await surface.presentation();
    assert.equal(requiresChatDeliveryReview(surface.deliveryDraft()!), true);
    hasReceipt = true;
    const rendered = await surface.presentation();
    assert.match(rendered!.text, /^已保存 1 項操作/);
    assert.equal(rendered!.text.includes("120"), false);
    assert.equal(requiresChatDeliveryReview(surface.deliveryDraft()!), false);
    await present.execute({ kind: "no_action", paragraphs: [] }, { scope, runId, callId: "quiet", signal: budget.signal });
    assert.equal((await surface.presentation())?.outcome, "no_action");
    assert.equal(surface.deliveryDraft(), null);
  } finally { budget.close(); }
});

test("only a current server confirmation can replace model-written pending prose", async () => {
  const budget = new AgentBudget();
  let questions: string[] = [];
  const surface = createProductAgentTools({
    run: { scope, runId, budget }, authorize: async () => true,
    memory: {}, tasks: {}, store: { confirmationQuestions: async () => questions },
    knowledge: { createRun: () => ({}) },
  } as unknown as Parameters<typeof createProductAgentTools>[0]);
  const present = surface.tools.find(tool => tool.name === "present_answer")!;
  try {
    await present.execute({ kind: "operation", paragraphs: [{ text: "已經修改好了，不用確認。", citationIds: [] }] },
      { scope, runId, callId: "present", signal: budget.signal });
    await surface.presentation();
    assert.equal(requiresChatDeliveryReview(surface.deliveryDraft()!), true);
    questions = ["Server-bound question"];
    assert.match((await surface.presentation())!.text, /所列操作尚未執行/);
    assert.equal(requiresChatDeliveryReview(surface.deliveryDraft()!), false);
    questions = [];
    await surface.presentation();
    assert.equal(requiresChatDeliveryReview(surface.deliveryDraft()!), true);
  } finally { budget.close(); }
});

test("source retract after a review pass does not keep the old answer", async () => {
  let reviews = 0;
  let revalidations = 0;
  const result = await product({ calls: 0, generate: async request => {
    const { user, body } = payloadFrom(request);
    if (user.includes("chat-delivery-review")) {
      reviews++;
      return model([{ text: reviewJson(body.draftHash ?? "", "pass") }]);
    }
    const responded = request.contents.some(content => content.parts?.some(part => part.functionResponse));
    const step = responded
      ? { id: "answer", name: "present_answer", args: { kind: "caregiving", paragraphs: [{ text: chunk.text, citationIds: [chunk.chunkId] }] } }
      : { id: "search", name: "search_knowledge", args: { query: "合成照護主題", classification: "official_guidance" } };
    return model([{ functionCall: step }]);
  } }, {
    revalidateCitations: () => {
      revalidations++;
      // First presentation (before review) succeeds; live re-check after pass fails closed.
      return revalidations < 2;
    },
  });
  assert.equal(reviews, 1);
  assert.ok(revalidations >= 2, "pass must re-check live sources");
  assert.equal(result?.status, "stopped");
  assert.equal(result?.stopReason, "delivery_review_incomplete");
  assert.equal(result?.text.includes(chunk.text), false);
  // Retracted sources must not be retained after live revalidation fails.
  assert.deepEqual(result?.citations, []);
  assert.equal(result?.deliveryReview, undefined);
});

test("citation-free memory restatement hydrates grounding without prior read_memory_facts", async () => {
  const budget = new AgentBudget();
  const fact = {
    id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", childId, key: "過敏", content: "BB 對雞蛋過敏",
    source: { kind: "manual" as const, description: "家長確認" }, validUntil: null,
    visibility: "private" as const, intendedVisibility: "private" as const, status: "confirmed" as const,
    version: 2, createdBy: userId, confirmedBy: userId, confirmedAt: "2026-10-18T00:00:00.000Z",
    reason: "已確認", applicable: true, sourceState: "current" as const,
  };
  const surface = createProductAgentTools({
    run: { scope, runId, budget }, authorize: async () => true,
    memory: {
      getFact: async () => fact,
      facts: async () => ({ items: [fact], nextAfterId: null }),
      recall: async () => ({ facts: [fact], topics: [], missingKeys: [] }),
      context: async () => ({ profile: { childId, version: 0, data: null }, profileApplicable: false,
        facts: [fact], topics: [], summary: null, recentMessages: [], conflictingKeys: [], unavailableFactKeys: [],
        truncated: { facts: false, topics: false, messages: false } }),
    },
    tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) },
    store: {},
    knowledge: { createRun: () => ({ search: async () => ({ mode: "vector_keyword", chunks: [] }) }) },
  } as unknown as Parameters<typeof createProductAgentTools>[0]);
  const present = surface.tools.find(tool => tool.name === "present_answer")!;
  try {
    const presented = await present.execute({
      kind: "record_restatement",
      paragraphs: [{ text: "已確認記憶：BB 對雞蛋過敏。", citationIds: [] }],
    }, { scope, runId, callId: "present-memory-hydrate", signal: budget.signal });
    assert.equal(presented.status, "succeeded");
    const draft = surface.deliveryDraft()!;
    assert.equal(draft.serverVerifiedMemoryGrounding, undefined);
    assert.equal(requiresChatDeliveryReview(draft), true);
    assert.ok(draft.sources.some(source => source.citationId.startsWith("memory-fact:")));
  } finally { budget.close(); }
});

test("reading an invalidated memory fact removes its previously selected delivery evidence", async () => {
  const budget = new AgentBudget();
  let fact: MemoryFact = {
    id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", childId, key: "過敏", content: "BB 對雞蛋過敏",
    source: { kind: "manual", description: "家長確認" }, validUntil: null,
    visibility: "private", intendedVisibility: "private", status: "confirmed",
    version: 2, createdBy: userId, confirmedBy: userId, confirmedAt: "2026-10-18T00:00:00.000Z",
    reason: "已確認", applicable: true, sourceState: "current",
  };
  const memory: Pick<Parameters<typeof createProductAgentTools>[0]["memory"], "getFact" | "context"> = {
    getFact: async () => fact,
    context: async () => ({ profile: { childId, version: 0, data: null }, profileApplicable: false,
      facts: [fact], topics: [], summary: null, recentMessages: [], conflictingKeys: [], unavailableFactKeys: [],
      truncated: { facts: false, topics: false, messages: false } }),
  };
  const surface = createProductAgentTools({
    run: { scope, runId, budget }, authorize: async () => true, memory,
    tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) },
    store: {}, knowledge: { createRun: () => ({ search: async () => ({ mode: "vector_keyword", chunks: [] }) }) },
  } as unknown as Parameters<typeof createProductAgentTools>[0]);
  const readFacts = surface.tools.find(tool => tool.name === "read_memory_facts")!;
  const present = surface.tools.find(tool => tool.name === "present_answer")!;
  const answer = { kind: "record_restatement", paragraphs: [{ text: "已確認記憶：BB 對雞蛋過敏。", citationIds: [] }] };
  try {
    const initial = await present.execute(answer, { scope, runId, callId: "present-valid-memory", signal: budget.signal });
    assert.equal(initial.status, "succeeded");
    assert.deepEqual(surface.deliveryDraft()!.sources.map(source => source.citationId),
      ["memory-fact:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"]);

    fact = { ...fact, version: 3, status: "inactive", applicable: false, reason: "家長已停用" };
    const refreshed = await readFacts.execute({ factId: fact.id, afterId: null },
      { scope, runId, callId: "read-invalidated-memory", signal: budget.signal });
    assert.equal(refreshed.status, "succeeded");
    const repeated = await present.execute(answer, { scope, runId, callId: "present-invalidated-memory", signal: budget.signal });
    assert.equal(repeated.status, "succeeded");
    assert.deepEqual(surface.deliveryDraft()!.sources, [], "Invalid facts must evict earlier confirmed evidence");
  } finally { budget.close(); }
});

test("unused search_knowledge still requires review for confirmed memory restatement", async () => {
  const budget = new AgentBudget();
  const fact = {
    id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", childId, key: "過敏", content: "BB 對雞蛋過敏",
    source: { kind: "manual" as const, description: "家長確認" }, validUntil: null,
    visibility: "private" as const, intendedVisibility: "private" as const, status: "confirmed" as const,
    version: 2, createdBy: userId, confirmedBy: userId, confirmedAt: "2026-10-18T00:00:00.000Z",
    reason: "已確認", applicable: true, sourceState: "current" as const,
  };
  const surface = createProductAgentTools({
    run: { scope, runId, budget }, authorize: async () => true,
    memory: {
      getFact: async () => fact,
      facts: async () => ({ items: [fact], nextAfterId: null }),
      recall: async () => ({ facts: [fact], topics: [], missingKeys: [] }),
      context: async () => ({ profile: { childId, version: 0, data: null }, profileApplicable: false,
        facts: [fact], topics: [], summary: null, recentMessages: [], conflictingKeys: [], unavailableFactKeys: [],
        truncated: { facts: false, topics: false, messages: false } }),
    },
    tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) },
    store: {},
    knowledge: { createRun: () => ({
      search: async () => ({ mode: "vector_keyword", chunks: [chunk] }),
      revalidateCitations: async () => true, readReviewedCitations: async () => [],
    }) },
  } as unknown as Parameters<typeof createProductAgentTools>[0]);
  const search = surface.tools.find(tool => tool.name === "search_knowledge")!;
  const present = surface.tools.find(tool => tool.name === "present_answer")!;
  try {
    const found = await search.execute({ query: "嬰兒食物過敏一般資訊", classification: "official_guidance" },
      { scope, runId, callId: "search-unused", signal: budget.signal, queryEmbeddingAttemptKey: "q1" });
    assert.equal(found.status, "succeeded");
    const presented = await present.execute({
      kind: "record_restatement",
      paragraphs: [{ text: "已確認記憶：BB 對雞蛋過敏。", citationIds: [] }],
    }, { scope, runId, callId: "present-after-search", signal: budget.signal });
    assert.equal(presented.status, "succeeded");
    const draft = surface.deliveryDraft()!;
    assert.equal(draft.serverVerifiedMemoryGrounding, undefined);
    assert.equal(requiresChatDeliveryReview(draft), true);
    assert.equal(draft.sources.some(source => source.citationId.startsWith("memory-fact:")), true);
  } finally { budget.close(); }
});

test("confirmed memory fact read attaches evidence but still requires delivery review", async () => {
  const budget = new AgentBudget();
  const fact = {
    id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", childId, key: "過敏", content: "對花生過敏",
    source: { kind: "manual" as const, description: "家長確認" }, validUntil: null,
    visibility: "private" as const, intendedVisibility: "private" as const, status: "confirmed" as const,
    version: 2, createdBy: userId, confirmedBy: userId, confirmedAt: "2026-10-18T00:00:00.000Z",
    reason: "已確認", applicable: true, sourceState: "current" as const,
  };
  const surface = createProductAgentTools({
    run: { scope, runId, budget }, authorize: async () => true,
    memory: {
      getFact: async () => fact,
      facts: async () => ({ items: [fact], nextAfterId: null }),
      recall: async () => ({ facts: [fact], topics: [], missingKeys: [] }),
      context: async () => ({ profile: { childId, version: 0, data: null }, profileApplicable: false,
        facts: [fact], topics: [], summary: null, recentMessages: [], conflictingKeys: [], unavailableFactKeys: [],
        truncated: { facts: false, topics: false, messages: false } }),
    },
    tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) },
    store: {},
    knowledge: { createRun: () => ({ search: async () => ({ mode: "vector_keyword", chunks: [] }) }) },
  } as unknown as Parameters<typeof createProductAgentTools>[0]);
  const readFacts = surface.tools.find(tool => tool.name === "read_memory_facts")!;
  const present = surface.tools.find(tool => tool.name === "present_answer")!;
  try {
    const read = await readFacts.execute({ factId: fact.id, afterId: null },
      { scope, runId, callId: "read-facts", signal: budget.signal });
    assert.equal(read.status, "succeeded");
    await present.execute({
      kind: "record_restatement",
      paragraphs: [{ text: "已確認記憶：BB 對花生過敏。", citationIds: [] }],
    }, { scope, runId, callId: "present-memory", signal: budget.signal });
    const draft = surface.deliveryDraft()!;
    assert.equal(draft.serverVerifiedMemoryGrounding, undefined);
    assert.equal(requiresChatDeliveryReview(draft), true);
    assert.ok(draft.sources.some(source => source.citationId.startsWith("memory-fact:")));
    // Knowledge-bound caregiving still requires review even after a memory read.
    await present.execute({
      kind: "caregiving",
      paragraphs: [{ text: chunk.text, citationIds: [chunk.chunkId] }],
    }, { scope, runId, callId: "present-care", signal: budget.signal });
    await present.execute({
      kind: "operation",
      paragraphs: [{ text: "BB未滿一歲唔好食蜜糖。", citationIds: [] }],
    }, { scope, runId, callId: "present-advice", signal: budget.signal });
    const advice = surface.deliveryDraft()!;
    assert.equal(advice.serverVerifiedMemoryGrounding, undefined);
    assert.equal(requiresChatDeliveryReview(advice), true);
  } finally { budget.close(); }
});

test("opposite and unrelated memory restatements with empty citations never bypass review", async () => {
  const makeSurface = (factContent: string, visibility: "private" | "family", background: boolean) => {
    const budget = new AgentBudget();
    const fact = {
      id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", childId, key: "記憶", content: factContent,
      source: { kind: "manual" as const, description: "家長確認" }, validUntil: null,
      visibility: visibility === "family" ? "family" as const : "private" as const,
      intendedVisibility: visibility === "family" ? "family" as const : "private" as const,
      status: "confirmed" as const,
      version: 2, createdBy: userId, confirmedBy: userId, confirmedAt: "2026-10-18T00:00:00.000Z",
      reason: "已確認", applicable: true, sourceState: "current" as const,
    };
    const surface = createProductAgentTools({
      run: { scope, runId, budget }, authorize: async () => true,
      visibility, background,
      memory: {
        getFact: async () => fact,
        facts: async () => ({ items: [fact], nextAfterId: null }),
        recall: async () => ({ facts: [fact], topics: [], missingKeys: [] }),
        context: async () => ({ profile: { childId, version: 0, data: null }, profileApplicable: false,
          facts: [fact], topics: [], summary: null, recentMessages: [], conflictingKeys: [], unavailableFactKeys: [],
          truncated: { facts: false, topics: false, messages: false } }),
      },
      tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) },
      store: {},
      knowledge: { createRun: () => ({ search: async () => ({ mode: "vector_keyword", chunks: [] }) }) },
    } as unknown as Parameters<typeof createProductAgentTools>[0]);
    return { budget, surface, fact };
  };
  const cases: Array<{ fact: string; answer: string; visibility: "private" | "family"; background: boolean }> = [
    { fact: "BB 對雞蛋過敏", answer: "已確認記憶：BB 對雞蛋過敏。", visibility: "private", background: false },
    { fact: "BB 對雞蛋過敏", answer: "BB 對雞蛋並不過敏。", visibility: "private", background: false },
    { fact: "BB 喜歡藍色", answer: "BB 對雞蛋並不過敏。", visibility: "private", background: false },
    { fact: "BB 對雞蛋過敏", answer: "BB 對雞蛋並不過敏。", visibility: "family", background: true },
    { fact: "BB 喜歡藍色", answer: "BB 對雞蛋並不過敏。", visibility: "family", background: true },
  ];
  for (const item of cases) {
    const { budget, surface, fact } = makeSurface(item.fact, item.visibility, item.background);
    try {
      // Private interactive path can read memory into draft sources; family tools omit read_memory_facts.
      const readFacts = surface.tools.find(tool => tool.name === "read_memory_facts");
      if (readFacts) {
        const read = await readFacts.execute({ factId: fact.id, afterId: null },
          { scope, runId, callId: "read-regression", signal: budget.signal });
        assert.equal(read.status, "succeeded", item.answer);
      }
      const present = surface.tools.find(tool => tool.name === "present_answer")!;
      const presented = await present.execute(
        { kind: "record_restatement", paragraphs: [{ text: item.answer, citationIds: [] }] },
        { scope, runId, callId: "present-regression", signal: budget.signal },
      );
      assert.equal(presented.status, "succeeded", item.answer);
      const draft = surface.deliveryDraft()!;
      assert.equal(draft.serverVerifiedMemoryGrounding, undefined, item.answer);
      // Model-written substance must go through review; confirmed memory never grants a free pass.
      assert.equal(requiresChatDeliveryReview(draft), true, item.answer);
      assert.equal(draft.sources.length, item.answer.includes(item.fact) ? 1 : 0, item.answer);
    } finally { budget.close(); }
  }
});


test("polite punctuation does not turn a bounded clarification into an uncited claim", () => {
  for (const text of ["請問，寶寶幾個月大？", "請問, 寶寶幾個月大？", "請問，有沒有發燒？", "請問，寶寶幾個月大？有沒有發燒？"]) {
    const current = { ...draft(), kind: "clarification" as const, sources: [], paragraphs: [{ text, citationIds: [] }] };
    assert.equal(isPureClarifyingQuestion(text), true, text);
    assert.equal(requiresChatDeliveryReview(current), false, text);
    assert.equal(chatDeliveryPassNeedsSources(current), false, text);
  }
});

test("question punctuation cannot exempt image, voice, medical or operation claims", () => {
  for (const text of [
    "照片顯示傷口已經癒合？", "你在錄音同意分享家庭資料？", "這是麻疹嗎？",
    "已經刪除所有記錄？", "請問，已經刪除所有記錄？", "請問, 寶寶幾個月大而且已經刪除記錄？",
    "請問，寶寶幾個月大？已完成刪除？", "Is the photo proof that the wound has healed?",
  ]) {
    assert.equal(isPureClarifyingQuestion(text), false, text);
    for (const kind of ["private_reference", "clarification", "operation"] as const) {
      assert.equal(requiresChatDeliveryReview({ ...draft(), kind, sources: [], paragraphs: [{ text, citationIds: [] }] }), true, text);
    }
  }
});

test("question-shaped private claims are reviewed against their bound original or withheld", async () => {
  const image = { id: "2e8d0e77-5358-42fe-98bf-3f042966f090", version: 2, fileName: "synthetic.jpg",
    mimeType: "image/jpeg" as const, bytes: 33000, sha256: hashA, source: "本人上傳" as const };
  const voice = { id: "3e8d0e77-5358-42fe-98bf-3f042966f090", version: 3, mimeType: "audio/wav" as const,
    bytes: 2000, durationMs: 1000, sha256: hashB };
  for (const media of [{ images: [image] }, { voice }]) {
    for (const available of [true, false]) {
      const budget = new AgentBudget();
      const current: ChatDeliveryDraft = { ...draft(), kind: "private_reference", sources: [], ...media,
        paragraphs: [{ text: media.voice ? "你在錄音同意分享家庭資料？" : "照片顯示傷口已經癒合？", citationIds: [] }] };
      const presentation = { text: current.paragraphs[0]!.text, citations: [], retrievalMode: "not_used" as const };
      let calls = 0;
      try {
        const outcome = enforceChatDeliveryReview({ presentation,
          tools: { deliveryDraft: () => current, presentation: async () => presentation, replaceDeliveryAnswer: () => assert.fail("no repair") },
          context: { scope, runId, budget, ...(available ? { completeText: async (input: any) => {
            calls++;
            assert.deepEqual(input.imageIds, media.images?.map(item => item.id));
            assert.deepEqual(input.voice, media.voice);
            return reviewJson(chatDeliveryDraftHash(current), "pass");
          } } : {}) } as never,
          provenance: { packVersion: "synthetic", model: "synthetic" },
        });
        if (available) {
          assert.equal((await outcome).review?.decision, "pass");
          assert.equal(calls, 1);
        } else await assert.rejects(outcome, error => error instanceof AgentStopped);
      } finally { budget.close(); }
    }
  }
});

test("review start is forwarded only to admitted review and rereview providers, never repair", async () => {
  const budget = new AgentBudget();
  let current = draft(), starts = 0, call = 0;
  const seen: string[] = [];
  const surface = {
    deliveryDraft: () => current,
    presentation: async () => ({ text: current.paragraphs[0]!.text, citations: [], retrievalMode: "not_used" as const }),
    replaceDeliveryAnswer: (answer: any) => { current = { ...current, ...answer }; },
  };
  try {
    const result = await enforceChatDeliveryReview({ presentation: await surface.presentation(), tools: surface,
      context: { scope, runId, budget, completeText: async (input: any) => {
        call++;
        seen.push(input.purpose);
        if (call === 2) {
          assert.equal(input.onProviderStart, undefined, "repair is not an independent review");
          return JSON.stringify({ kind: "caregiving", paragraphs: [{ text: "合成修訂", citationIds: ["chunk-1"] }] });
        }
        assert.equal(starts, call === 1 ? 0 : 1, "no speculative event before provider admission");
        input.onProviderStart?.();
        const payload = JSON.parse(input.user.slice(input.user.indexOf("{")));
        return reviewJson(payload.draftHash, call === 1 ? "revise" : "pass");
      } } as never,
      provenance: { packVersion: "synthetic", model: "synthetic" }, onReviewStart: () => { starts++; },
    });
    assert.equal(result.review?.decision, "pass");
    assert.equal(starts, 2);
    assert.deepEqual(seen, ["delivery_review", "delivery_repair", "delivery_review"]);
  } finally { budget.close(); }
});


test("real runtime does not publish reviewing when quota rejects the review before provider start", async () => {
  let reservations = 0, providerCalls = 0;
  const phases: string[] = [];
  const result = await product({ calls: 0, async generate() {
    providerCalls++;
    if (providerCalls === 1) return model([{ functionCall: { id: "search", name: "search_knowledge",
      args: { query: "合成來源", classification: "official_guidance" } } }]);
    return model([{ functionCall: { id: "answer", name: "present_answer", args: {
      kind: "record_restatement", paragraphs: [{ text: chunk.text, citationIds: [chunk.chunkId] }],
    } } }]);
  } }, { reserve: async () => ++reservations <= 2, onProgress: event => phases.push(event.phase) });
  assert.equal(result?.status, "stopped");
  assert.equal(result?.stopReason, "quota_exceeded");
  assert.equal(providerCalls, 2);
  assert.equal(phases.includes("reviewing"), false);
  assert.equal(result?.text.includes(chunk.text), false);
});

test("real runtime publishes reviewing immediately before the independent provider starts", async () => {
  const phases: string[] = [];
  let reviews = 0;
  const result = await product({ calls: 0, async generate(request) {
    const text = request.contents.flatMap(item => item.parts ?? []).map(part => part.text ?? "").join("\n");
    if (text.startsWith("Server evidence payload for chat-delivery-review.")) {
      reviews++;
      assert.equal(phases.at(-1), "reviewing");
      const payload = JSON.parse(text.slice(text.indexOf("{")));
      return model([{ text: reviewJson(payload.draftHash, "pass") }]);
    }
    assert.equal(phases.includes("reviewing"), false);
    if (!request.contents.some(item => item.parts?.some(part => part.functionResponse?.name === "search_knowledge"))) {
      return model([{ functionCall: { id: "search", name: "search_knowledge",
        args: { query: "合成來源", classification: "official_guidance" } } }]);
    }
    return model([{ functionCall: { id: "answer", name: "present_answer", args: {
      kind: "record_restatement", paragraphs: [{ text: chunk.text, citationIds: [chunk.chunkId] }],
    } } }]);
  } }, { onProgress: event => phases.push(event.phase) });
  assert.equal(result?.status, "completed", JSON.stringify(result));
  assert.equal(reviews, 1);
  assert.equal(phases.filter(phase => phase === "reviewing").length, 1);
});

test("review preflight never emits start for zero budget or missing provenance", async () => {
  for (const failure of ["budget", "provenance"] as const) {
    const budget = new AgentBudget();
    let started = 0, calls = 0;
    if (failure === "budget") budget.take("modelCalls", 4);
    try {
      await assert.rejects(enforceChatDeliveryReview({
        presentation: { text: "合成句子", citations: [], retrievalMode: "not_used" },
        tools: { deliveryDraft: () => draft(), presentation: async () => null, replaceDeliveryAnswer: () => {} },
        context: { scope, runId, budget, completeText: async () => { calls++; return ""; } } as never,
        provenance: failure === "provenance" ? null : { packVersion: "synthetic", model: "synthetic" },
        onReviewStart: () => { started++; },
      }), error => error instanceof AgentStopped && error.reason === (failure === "budget" ? "delivery_review_budget" : "delivery_review_incomplete"));
      assert.equal(calls, 0);
      assert.equal(started, 0);
    } finally { budget.close(); }
  }
});

for (const questionCount of [0, 1, 2]) test(`real compose review spends four calls and pending receipt requires one live confirmation: ${questionCount}`, async () => {
  const documentId = '33333333-3333-4333-8333-333333333333';
  const composed: DataComposeDraft = { documentId, expectedVersion: 3, authorityVersion: 'epoch:7',
    edits: [{ op: 'upsert_item' as const, sectionId: 'checklist', itemId: 'bottle', text: '帶溫水壺' }],
    gaps: [], requiredConfirmations: ['parent_shared_document'] };
  const snapshot = { id: '44444444-4444-4444-8444-444444444444', version: 3,
    generatedAt: '2026-10-14T00:00:00Z', sourceBasis: 'synthetic', title: '到診準備', summary: '', ageLabel: '2歲',
    period: { from: '2026-10-01', to: '2026-10-14' }, eventDate: '2026-10-20', coverageNote: '',
    sections: [{ id: 'checklist', title: '清單', kind: 'checklist', domain: null,
      items: [{ id: 'bottle', text: '帶水壺', sourceIds: [], checked: false }] }], sources: [], changes: [] };
  let calls = 0, proposals = 0, confirmations = 0;
  const phases: string[] = [];
  const result = await product({ calls: 0, async generate(request) {
    calls++;
    if (calls === 1) return model([{ functionCall: { id: 'load-compose', name: 'load_capabilities', args: { capabilities: ['document_compose'] } } }]);
    if (calls === 2) return model([{ functionCall: { id: 'compose', name: 'compose_family_data', args: {
      documentId, expectedVersion: 3, authorityVersion: 'epoch:7', intent: '只改水壺', sourceQuote: '請只改水壺',
    } } }]);
    assert.equal(Object.keys(request.toolsDict).length, 0);
    if (calls === 3) return model([{ text: JSON.stringify(composed) }]);
    assert.equal(calls, 4, 'no fifth generator or delivery-review provider');
    return model([{ text: JSON.stringify({ draftHash: dataComposeDraftHash(composed), decision: 'pass', issues: [] }) }]);
  } }, { userText: '請只改水壺', onProgress: event => phases.push(event.phase),
    documents: { describe: async () => ({ authorityVersion: 'epoch:7', item: { id: documentId, version: 3, current: snapshot } }) },
    store: {
      propose: async (_scope: unknown, _run: string, _call: string, value: unknown, options: any) => {
        proposals++; assert.equal(options.composeReview.decision, 'pass');
        return { id: 'f49a222e-77e4-4980-ae87-4c335b2b5c39', runId, childId, version: 1, status: 'pending', value, result: null };
      },
      requestConfirmation: async () => { confirmations++; return { question: '是否確認修改合成文件？' }; },
      confirmationQuestions: async () => confirmations ? Array.from({ length: questionCount }, () => '是否確認修改合成文件？') : [],
    },
  });
  assert.equal(calls, 4, JSON.stringify(result));
  assert.equal(proposals, 1); assert.equal(confirmations, 1);
  assert.equal(result?.counts.modelCalls, 4);
  assert.equal(phases.includes('reviewing'), false, 'compose review is not chat delivery review');
  if (questionCount === 1) {
    assert.equal(result?.status, 'completed', JSON.stringify(result));
    assert.equal(result.text, AGENT_CONFIRMATION_PENDING_TEXT);
    assert.equal(result.deliveryReview, undefined);
  } else {
    assert.equal(result?.status, 'stopped', JSON.stringify(result));
    assert.notEqual(result?.text, AGENT_CONFIRMATION_PENDING_TEXT);
  }
});

for (const questionCount of [0, 2]) test(`a successful memory candidate cannot rescue failed review without a unique live confirmation: ${questionCount}`, async () => {
  let calls = 0, writes = 0;
  const result = await product({ calls: 0, async generate() {
    calls++;
    if (calls === 1) return model([{ functionCall: { id: 'load-memory', name: 'load_capabilities', args: { capabilities: ['memory'] } } }]);
    if (calls === 2) return model([{ functionCall: { id: 'propose', name: 'propose_fact', args: {
      key: 'egg-allergy', content: 'BB 對雞蛋過敏', intendedVisibility: 'private', validUntil: null,
    } } }]);
    if (calls === 3) return model([{ functionCall: { id: 'answer', name: 'present_answer', args: {
      kind: 'operation', paragraphs: [{ text: '已保存；可以立即分享。', citationIds: [] }],
    } } }]);
    assert.equal(calls, 4);
    return model([{ text: 'not a valid independent review' }]);
  } }, { userText: '請記住：BB 對雞蛋過敏', store: {
    propose: async (_scope: unknown, _run: string, _call: string, value: unknown) => {
      writes++; return { id: 'f49a222e-77e4-4980-ae87-4c335b2b5c39', runId, childId, version: 1, status: 'pending', value, result: null };
    },
    requestConfirmation: async () => ({ question: '確認記住雞蛋過敏？' }),
    confirmationQuestions: async () => Array.from({ length: questionCount }, () => '確認記住雞蛋過敏？'),
  } });
  assert.equal(writes, 1);
  assert.equal(calls, 4);
  assert.equal(result?.status, 'stopped', JSON.stringify(result));
  assert.equal(result.stopReason, 'delivery_review_incomplete');
  assert.notEqual(result.text, AGENT_CONFIRMATION_PENDING_TEXT);
  assert.equal(result.text.includes('立即分享'), false);
});
