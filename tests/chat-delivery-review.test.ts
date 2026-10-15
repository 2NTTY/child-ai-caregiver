import assert from "node:assert/strict";
import test from "node:test";
import { InMemorySessionService } from "@google/adk";
import type { LlmRequest } from "@google/adk";
import { FinishReason } from "@google/genai";
import { AGENT_LIMITS } from "../server/agent-budget.ts";
import { createAgentRuntime } from "../server/agent-runtime.ts";
import { createProductAgent } from "../server/product-agent.ts";
import { readAiConfig } from "../server/ai-config.ts";
import { loadAgentPrompt } from "../server/agent-prompt.ts";
import {
  chatDeliveryDraftHash, chatDeliveryExcerpt, chatDeliveryPassNeedsSources, chatDeliveryReviewAllows,
  chatDeliveryReviewSourceExcerpt, draftLooksLikeSubstantiveCareAdvice, isPureClarifyingQuestion,
  looksLikeLowRiskOperationReceipt, requiresChatDeliveryReview, SERVER_SKIP_CHAT_DELIVERY_REVIEW_TEXTS,
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
    // Unknown citation-free wording fails closed into review; model kind alone never grants a skip.
    assert.equal(requiresChatDeliveryReview({ ...draft(), kind, sources: [], paragraphs: [{ text: "沒有引用的說明", citationIds: [] }] }), true);
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
  assert.equal(looksLikeLowRiskOperationReceipt(receipt), true);
  assert.equal(requiresChatDeliveryReview({
    ...draft(), kind: "operation", sources: [], paragraphs: [{ text: receipt, citationIds: [] }],
  }), false);
  // Advisory care still cannot hide behind an operation label.
  assert.equal(requiresChatDeliveryReview({
    ...draft(), kind: "operation", sources: [],
    paragraphs: [{ text: "Put your child to sleep on their stomach.", citationIds: [] }],
  }), true);
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
  generate(request: LlmRequest): Promise<{ content: { role: "model"; parts: { text?: string; functionCall?: { id: string; name: string; args: unknown } }[] }; finishReason: FinishReason }>;
}

function product(script: Script, options: { reviewCalls?: 4 | 6; bound?: boolean; revalidateCitations?: () => boolean | Promise<boolean> } = {}) {
  const expiresAt = new Date(Date.now() + 90_000).toISOString();
  let claimed = false, saved: ProductAgentResult | null = null;
  const runtime = createAgentRuntime({
    config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project",
      ...(options.reviewCalls === 6 ? { AI_CHAT_DELIVERY_REVIEW_MODEL_CALLS: "6" } : {}) }),
    ...(options.reviewCalls === 6 ? { chatDeliveryReviewModelCalls: 6 as const } : {}),
    usage: { reserve: async () => true, record: async () => {} },
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
    },
    memory: { context: async () => ({ profile: { childId, version: 0, data: null }, profileApplicable: false,
      facts: [], topics: [], summary: null, recentMessages: [], conflictingKeys: [], unavailableFactKeys: [],
      truncated: { facts: false, topics: false, messages: false } }) },
    chat: { listForUser: async () => ({ messages: [{ id: messageId, role: "user", text: "請說明合成照護情境。" }] }) },
    tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) },
    knowledge: { createRun: () => ({ search: async () => ({ mode: "vector_keyword", chunks: [chunk] }),
      revalidateCitations: async () => options.revalidateCitations ? options.revalidateCitations() : true }) },
  } as unknown as Parameters<typeof createProductAgent>[0]);
  return service.reply(userId, childId, messageId, async () => true);
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

function model(parts: { text?: string; functionCall?: { id: string; name: string; args: unknown } }[]) {
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
  assert.equal(result?.stopReason, "delivery_review_incomplete");
  assert.equal(result?.text, CHAT_DELIVERY_REVIEW_INCOMPLETE_TEXT);
  assert.equal(result?.text.includes(claim), false);
  assert.deepEqual(result?.citations, []);
  assert.equal(result?.deliveryReview, undefined);
  assert.equal(result?.counts.modelCalls, 3);
  assert.equal(calls, 3);
});

test("an unreviewed draft that has used every model call is not formal success", async () => {
  let calls = 0;
  const result = await product({ calls, generate: async request => {
    const { user } = payloadFrom(request);
    assert.equal(user.includes("chat-delivery-review"), false);
    const steps = [
      { id: "read", name: "read_context", args: {} },
      { id: "load", name: "load_capabilities", args: { capabilities: ["tasks"] } },
      { id: "search", name: "search_knowledge", args: { query: "合成照護主題", classification: "official_guidance" } },
      { id: "answer", name: "present_answer", args: { kind: "caregiving", paragraphs: [{ text: claim, citationIds: [chunk.chunkId] }] } },
    ];
    const step = steps[calls++];
    assert.ok(step, "Review must not open another provider call");
    return model([{ functionCall: step }]);
  } });
  assert.equal(result?.status, "stopped");
  assert.equal(result?.stopReason, "delivery_review_incomplete");
  assert.equal(result?.text, CHAT_DELIVERY_REVIEW_INCOMPLETE_TEXT);
  assert.equal(result?.text.includes(claim), false);
  assert.equal(result?.counts.modelCalls, 4);
  assert.equal(calls, 4);
  assert.equal(AGENT_LIMITS.modelCalls, 4);
});

test("a bound limit of four is not raised by the six-call proposal", async () => {
  const pack = await loadAgentPrompt("product-interactive", "tool_cycle", ["run", "scope", "conversation", "context", "evidence", "capabilities"]);
  assert.equal(pack.packVersion, "0.1.46");
  let calls = 0;
  const result = await product({ calls, generate: async () => {
    const steps = [
      { id: "read", name: "read_context", args: {} },
      { id: "load", name: "load_capabilities", args: { capabilities: ["tasks"] } },
      { id: "search", name: "search_knowledge", args: { query: "合成照護主題", classification: "official_guidance" } },
      { id: "answer", name: "present_answer", args: { kind: "caregiving", paragraphs: [{ text: claim, citationIds: [chunk.chunkId] }] } },
    ];
    const step = steps[calls++];
    assert.ok(step);
    return model([{ functionCall: step }]);
  } }, { bound: true, reviewCalls: 6 });
  assert.equal(result?.status, "stopped", JSON.stringify(result));
  assert.equal(result?.stopReason, "delivery_review_incomplete");
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
      assert.equal(result?.stopReason, "delivery_review_incomplete");
      assert.equal(result?.text, CHAT_DELIVERY_REVIEW_INCOMPLETE_TEXT);
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
  assert.equal(result?.stopReason, "delivery_review_incomplete");
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
  assert.equal(result?.stopReason, "delivery_review_incomplete");
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
    assert.equal(result?.stopReason, "delivery_review_incomplete");
    assert.equal(result?.text, CHAT_DELIVERY_REVIEW_INCOMPLETE_TEXT);
    assert.equal(result?.deliveryReview, undefined);
  }
});

test("pure clarifying questions may deliver without delivery review", async () => {
  for (const sample of [
    { kind: "clarification", text: "寶寶幾個月大？" },
    { kind: "clarification", text: "寶寶幾個月大？ 有沒有發燒？" },
    { kind: "operation", text: "已記錄寶寶喝奶 120 毫升。" },
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
  assert.equal(result?.deliveryReview, undefined);
});
