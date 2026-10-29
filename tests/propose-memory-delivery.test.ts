import assert from "node:assert/strict";
import test from "node:test";
import { createProductAgentTools } from "../server/product-agent-tools.ts";
import { AGENT_CONFIRMATION_PENDING_TEXT, buildAgentConfirmationQuestion } from "../server/agent-work-tool-descriptions.ts";
import { looksLikeDurableMemoryFactQuestion, looksLikeDurableMemoryFactStatement } from "../server/memory-policy.ts";
import type { AgentRunContext, AgentTool } from "../server/agent-runtime.ts";
import type { MemoryFact } from "../src/shared/memory.ts";
import { chatDeliveryDraftHash, chatDeliveryReviewAllows, enforceChatDeliveryReview } from "../server/chat-delivery-review.ts";
import { AgentStopped } from "../server/agent-budget.ts";

const scope = {
  userId: "synthetic-caregiver",
  childId: "1ebcb39d-a2db-4b8c-a432-7ffcb3de5808",
  workspaceId: "synthetic-workspace",
  authorizationVersion: "1",
  dataVersion: "epoch:1",
};
const runId = "d4a1b662-d13d-476b-bf52-40a28aa1a1a7";

function toolContext(callId: string): Parameters<AgentTool["execute"]>[1] {
  return { scope, runId, callId, signal: new AbortController().signal };
}

function tools(options: {
  trustedUserMessage?: string;
  propose?: (...args: unknown[]) => Promise<unknown>;
  confirmationQuestions?: () => Promise<string[]>;
  requestConfirmation?: (...args: unknown[]) => Promise<unknown>;
  confirmations?: Array<{ runId: string; proposalId: string; expectedVersion: number; workId: null }>;
  memory?: Record<string, unknown>;
  knowledgeChunks?: unknown[];
  visibility?: "private" | "family";
}) {
  const run = {
    scope, runId, budget: { toolResponseCharacters: 12000, remainingModelCalls: 4, signal: new AbortController().signal },
    authorize: async () => true,
  } as unknown as AgentRunContext;
  const preparedQuestions: string[] = [];
  const store = {
    propose: options.propose ?? (async () => ({
      id: "f49a222e-77e4-4980-ae87-4c335b2b5c39", runId, childId: scope.childId, version: 1, status: "pending",
      createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString(),
      value: { kind: "memory_fact", key: "allergy", content: "BB 對雞蛋過敏", intendedVisibility: "private", validUntil: null },
      targetLabel: null, result: null,
    })),
    confirmationQuestions: options.confirmationQuestions ?? (async () => [...preparedQuestions]),
    requestConfirmation: options.requestConfirmation ?? (async (_scope: unknown, _asking: string, raw: { runId: string; proposalId: string; expectedVersion: number; workId: null }) => {
      options.confirmations?.push(raw);
      if (!preparedQuestions.includes("prepared")) preparedQuestions.push("prepared");
      return { id: "conf-1", proposalRunId: raw.runId, proposalId: raw.proposalId, proposalVersion: raw.expectedVersion, expiresAt: new Date(Date.now() + 86400000).toISOString(), question: "prepared" };
    }),
  };
  return createProductAgentTools({
    run, authorize: async () => true,
    trustedUserMessage: options.trustedUserMessage,
    visibility: options.visibility,
    store: store as never,
    memory: { context: async () => ({ profile: { childId: scope.childId, version: 0, data: null }, profileApplicable: false,
      facts: [], topics: [], summary: null, recentMessages: [], conflictingKeys: [], unavailableFactKeys: [],
      truncated: { facts: false, topics: false, messages: false } }), ...options.memory } as never,
    tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) } as never,
    knowledge: { createRun: () => ({ search: async () => ({ mode: "vector_keyword", chunks: options.knowledgeChunks ?? [] }),
      revalidateCitations: async () => true, readReviewedCitations: async () => [] }) } as never,
  });
}

test("allergy statements require propose_fact before citation-free present_answer", async () => {
  assert.equal(looksLikeDurableMemoryFactStatement("BB 對雞蛋過敏"), true);
  const surface = tools({ trustedUserMessage: "BB 對雞蛋過敏" });
  const present = surface.tools.find(tool => tool.name === "present_answer")!;
  const rejected = await present.execute({
    kind: "clarification",
    paragraphs: [{ text: "收到，BB 對雞蛋過敏。", citationIds: [] }],
  }, toolContext("c1"));
  assert.equal(rejected.status, "rejected");
  assert.equal((rejected.data as { code?: string }).code, "propose_fact_required");
});

test("after propose_fact, citation-free present becomes server pending receipt and skips review sources", async () => {
  const surface = tools({ trustedUserMessage: "BB 對雞蛋過敏" });
  const propose = surface.tools.find(tool => tool.name === "propose_fact")!;
  const present = surface.tools.find(tool => tool.name === "present_answer")!;
  const proposed = await propose.execute({
    key: "allergy-egg", content: "寶寶對雞蛋過敏", intendedVisibility: "private", validUntil: null,
  }, toolContext("c-propose"));
  assert.equal(proposed.status, "succeeded");
  const accepted = await present.execute({
    kind: "clarification",
    paragraphs: [{ text: "已記下 BB 對雞蛋過敏，待你確認。", citationIds: [] }],
  }, toolContext("c-present"));
  assert.equal(accepted.status, "succeeded");
  const presentation = await surface.presentation();
  assert.equal(presentation?.text, AGENT_CONFIRMATION_PENDING_TEXT);
  const draft = surface.deliveryDraft();
  assert.equal(draft?.serverSubstitutedReceiptText, true);
  assert.equal(draft?.paragraphs[0]?.text, AGENT_CONFIRMATION_PENDING_TEXT);
});

test("allergy questions do not require propose_fact", async () => {
  assert.equal(looksLikeDurableMemoryFactStatement("BB 有冇花生過敏？"), false);
  const surface = tools({ trustedUserMessage: "BB 有冇花生過敏？" });
  const present = surface.tools.find(tool => tool.name === "present_answer")!;
  const accepted = await present.execute({
    kind: "clarification",
    paragraphs: [{ text: "請稍等，我查一下記憶。", citationIds: [] }],
  }, toolContext("c1"));
  assert.equal(accepted.status, "succeeded");
});

test("preference statements require propose_fact before citation-free present_answer", async () => {
  assert.equal(looksLikeDurableMemoryFactStatement("BB 鍾意香蕉"), true);
  const surface = tools({ trustedUserMessage: "BB 鍾意香蕉" });
  const present = surface.tools.find(tool => tool.name === "present_answer")!;
  const rejected = await present.execute({
    kind: "clarification",
    paragraphs: [{ text: "收到，BB 鍾意香蕉。", citationIds: [] }],
  }, toolContext("c-pref"));
  assert.equal(rejected.status, "rejected");
  assert.equal((rejected.data as { code?: string }).code, "propose_fact_required");
});

test("after propose_fact for preference, citation-free present becomes server pending receipt", async () => {
  const surface = tools({
    trustedUserMessage: "BB 鍾意香蕉",
    propose: async () => ({
      id: "a11ce000-77e4-4980-ae87-4c335b2b5c39", runId, childId: scope.childId, version: 1, status: "pending",
      createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString(),
      value: { kind: "memory_fact", key: "likes-banana", content: "BB 鍾意香蕉", intendedVisibility: "private", validUntil: null },
      targetLabel: null, result: null,
    }),
  });
  const propose = surface.tools.find(tool => tool.name === "propose_fact")!;
  const present = surface.tools.find(tool => tool.name === "present_answer")!;
  const proposed = await propose.execute({
    key: "likes-banana", content: "BB 鍾意香蕉", intendedVisibility: "private", validUntil: null,
  }, toolContext("c-propose-pref"));
  assert.equal(proposed.status, "succeeded");
  const accepted = await present.execute({
    kind: "clarification",
    paragraphs: [{ text: "已記下 BB 鍾意香蕉，待你確認。", citationIds: [] }],
  }, toolContext("c-present-pref"));
  assert.equal(accepted.status, "succeeded");
  const presentation = await surface.presentation();
  assert.equal(presentation?.text, AGENT_CONFIRMATION_PENDING_TEXT);
  const draft = surface.deliveryDraft();
  assert.equal(draft?.serverSubstitutedReceiptText, true);
});

test("allergy questions reject propose_fact and do not require propose on present", async () => {
  assert.equal(looksLikeDurableMemoryFactQuestion("Esther\u5c0d\u829d\u9ebb\u904e\u654f\u55ce\uff1f"), true);
  assert.equal(looksLikeDurableMemoryFactStatement("Esther\u5c0d\u829d\u9ebb\u904e\u654f\u55ce\uff1f"), false);
  let proposed = false;
  const surface = tools({
    trustedUserMessage: "Esther\u5c0d\u829d\u9ebb\u904e\u654f\u55ce\uff1f",
    propose: async () => { proposed = true; throw new Error("should not propose"); },
  });
  const propose = surface.tools.find(tool => tool.name === "propose_fact")!;
  const rejected = await propose.execute({
    key: "allergy-sesame-esther", content: "Esther\u829d\u9ebb\u904e\u654f", intendedVisibility: "private", validUntil: null,
  }, toolContext("c-q-propose"));
  assert.equal(rejected.status, "rejected");
  assert.equal((rejected.data as { code?: string }).code, "memory_read_not_propose");
  assert.equal(proposed, false);
  const present = surface.tools.find(tool => tool.name === "present_answer")!;
  const accepted = await present.execute({
    kind: "clarification",
    paragraphs: [{ text: "memory says Esther sesame allergy", citationIds: [] }],
  }, toolContext("c-q-present"));
  assert.equal(accepted.status, "succeeded");
});

test("allergy statement propose clears near-term validUntil", async () => {
  const captured: Array<string | null> = [];
  const surface = tools({
    trustedUserMessage: "Esther\u5c0d\u829d\u9ebb\u904e\u654f",
    propose: async (...args: unknown[]) => {
      const value = args[3] as { validUntil: string | null };
      captured.push(value.validUntil);
      return {
        id: "f49a222e-77e4-4980-ae87-4c335b2b5c40", runId, childId: scope.childId, version: 1, status: "pending",
        createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString(),
        value: { kind: "memory_fact", key: "allergy-sesame", content: "Esther\u5c0d\u829d\u9ebb\u904e\u654f", intendedVisibility: "private", validUntil: value.validUntil },
        targetLabel: null, result: null,
      };
    },
  });
  const propose = surface.tools.find(tool => tool.name === "propose_fact")!;
  const short = await propose.execute({
    key: "allergy-sesame", content: "Esther\u5c0d\u829d\u9ebb\u904e\u654f", intendedVisibility: "private",
    validUntil: new Date(Date.now() + 6 * 60 * 1000).toISOString(),
  }, toolContext("c-short"));
  assert.equal(short.status, "succeeded");
  assert.equal(captured[0], null);
  const longUntil = new Date(Date.now() + 40 * 24 * 60 * 60 * 1000).toISOString();
  const long = await propose.execute({
    key: "allergy-sesame", content: "Esther\u5c0d\u829d\u9ebb\u904e\u654f", intendedVisibility: "private",
    validUntil: longUntil,
  }, toolContext("c-long"));
  assert.equal(long.status, "succeeded");
  assert.equal(captured[1], longUntil);
});


test("preference propose_fact auto-prepares confirmation for full receipt append", async () => {
  const confirmations: Array<{ runId: string; proposalId: string; expectedVersion: number; workId: null }> = [];
  const preferenceContent = "BB 鐘意牛油果";
  const proposalValue = {
    id: "b0a7eca0-77e4-4980-ae87-4c335b2b5c39", runId, childId: scope.childId, version: 1, status: "pending" as const,
    createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString(),
    value: { kind: "memory_fact" as const, key: "likes-avocado", content: preferenceContent, intendedVisibility: "private" as const, validUntil: null },
    targetLabel: null, result: null,
  };
  const surface = tools({
    trustedUserMessage: preferenceContent,
    confirmations,
    propose: async () => proposalValue,
  });
  const propose = surface.tools.find(tool => tool.name === "propose_fact")!;
  const proposed = await propose.execute({
    key: "likes-avocado", content: preferenceContent, intendedVisibility: "private", validUntil: null,
  }, toolContext("c-avocado"));
  assert.equal(proposed.status, "succeeded");
  assert.equal((proposed.data as { result?: { confirmationPrepared?: boolean } }).result?.confirmationPrepared, true);
  assert.equal(confirmations.length, 1);
  assert.equal(confirmations[0]?.proposalId, proposalValue.id);
  assert.equal(confirmations[0]?.expectedVersion, 1);
  const question = buildAgentConfirmationQuestion(
    { value: proposalValue.value, targetLabel: null },
    false,
    "BB",
  );
  assert.ok(question.includes("事實名稱"));
  assert.ok(question.includes("內容"));
  assert.ok(question.includes("保存範圍"));
  assert.ok(question.includes("確認"));
  assert.ok(question.includes(preferenceContent));
  const receipt = AGENT_CONFIRMATION_PENDING_TEXT + "\n\n" + question;
  assert.ok(receipt.includes("已準備待確認"));
  assert.ok(receipt.includes("事實名稱"));
  assert.ok(receipt.includes("保存範圍"));
});

test("dislike preference propose_fact also auto-prepares confirmation", async () => {
  const confirmations: Array<{ runId: string; proposalId: string; expectedVersion: number; workId: null }> = [];
  const content = "BB 唔鐘意西蘭花";
  const surface = tools({
    trustedUserMessage: content,
    confirmations,
    propose: async () => ({
      id: "c0ffee00-77e4-4980-ae87-4c335b2b5c39", runId, childId: scope.childId, version: 1, status: "pending",
      createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString(),
      value: { kind: "memory_fact", key: "dislikes-broccoli", content, intendedVisibility: "private", validUntil: null },
      targetLabel: null, result: null,
    }),
  });
  const propose = surface.tools.find(tool => tool.name === "propose_fact")!;
  const proposed = await propose.execute({
    key: "dislikes-broccoli", content, intendedVisibility: "private", validUntil: null,
  }, toolContext("c-broccoli"));
  assert.equal(proposed.status, "succeeded");
  assert.equal((proposed.data as { result?: { confirmationPrepared?: boolean } }).result?.confirmationPrepared, true);
  assert.equal(confirmations.length, 1);
  const question = buildAgentConfirmationQuestion(
    { value: { kind: "memory_fact", key: "dislikes-broccoli", content, intendedVisibility: "private", validUntil: null }, targetLabel: null },
    false,
    "BB",
  );
  const receipt = [AGENT_CONFIRMATION_PENDING_TEXT, question].join("\n\n");
  for (const cue of ["事實名稱", "內容", "保存範圍", "確認"]) {
    assert.ok(receipt.includes(cue), "missing cue " + cue);
  }
});


test("hydration questions reject propose_fact (read, never propose)", async () => {
  const q = "Esther需要每天飲8杯水嗎？";
  assert.equal(looksLikeDurableMemoryFactQuestion(q), true);
  assert.equal(looksLikeDurableMemoryFactStatement(q), false);
  let proposed = false;
  const surface = tools({
    trustedUserMessage: q,
    propose: async () => { proposed = true; throw new Error("should not propose"); },
  });
  const propose = surface.tools.find(tool => tool.name === "propose_fact")!;
  const rejected = await propose.execute({
    key: "Esther_water_intake", content: "Esther需要每天飲8杯水", intendedVisibility: "private", validUntil: null,
  }, toolContext("c-hydrate-q"));
  assert.equal(rejected.status, "rejected");
  assert.equal((rejected.data as { code?: string }).code, "memory_read_not_propose");
  assert.equal(proposed, false);
});

test("generic question form rejects propose_fact without allergy topic", async () => {
  assert.equal(looksLikeDurableMemoryFactQuestion("BB幾多月大嗎？"), true);
  assert.equal(looksLikeDurableMemoryFactStatement("BB幾多月大嗎？"), false);
});


test("mixed remember + question still allows propose_fact", async () => {
  const mixed = "請記住：BB 對雞蛋過敏。明天要帶甚麼？";
  assert.equal(looksLikeDurableMemoryFactQuestion(mixed), false);
  assert.equal(looksLikeDurableMemoryFactStatement(mixed), true);
  let proposed = 0;
  const surface = tools({
    trustedUserMessage: mixed,
    propose: async () => {
      proposed += 1;
      return {
        id: "d00dle00-77e4-4980-ae87-4c335b2b5c39", runId, childId: scope.childId, version: 1, status: "pending",
        createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString(),
        value: { kind: "memory_fact", key: "allergy-egg", content: "BB 對雞蛋過敏", intendedVisibility: "private", validUntil: null },
        targetLabel: null, result: null,
      };
    },
  });
  const propose = surface.tools.find(tool => tool.name === "propose_fact")!;
  const accepted = await propose.execute({
    key: "allergy-egg", content: "BB 對雞蛋過敏", intendedVisibility: "private", validUntil: null,
  }, toolContext("c-mixed"));
  assert.equal(accepted.status, "succeeded");
  assert.equal(proposed, 1);
});

test("explicit short-lived preference propose keeps short validUntil", async () => {
  const content = "BB 只係今日偏好飲暖水，今晚後不適用";
  const sixHours = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
  const captured: Array<string | null> = [];
  const surface = tools({
    trustedUserMessage: content,
    propose: async (...args: unknown[]) => {
      const value = args[3] as { validUntil: string | null };
      captured.push(value.validUntil);
      return {
        id: "e11cafe0-77e4-4980-ae87-4c335b2b5c39", runId, childId: scope.childId, version: 1, status: "pending",
        createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString(),
        value: { kind: "memory_fact", key: "warm-water-today", content, intendedVisibility: "private", validUntil: value.validUntil },
        targetLabel: null, result: null,
      };
    },
  });
  const propose = surface.tools.find(tool => tool.name === "propose_fact")!;
  const short = await propose.execute({
    key: "warm-water-today", content, intendedVisibility: "private", validUntil: sixHours,
  }, toolContext("c-short-pref"));
  assert.equal(short.status, "succeeded");
  assert.equal(captured[0], sixHours);
});

test("remembered-fact read-back rejects a new proposal without preparing confirmation", async () => {
  const confirmations: Array<{ runId: string; proposalId: string; expectedVersion: number; workId: null }> = [];
  let writes = 0;
  const surface = tools({ trustedUserMessage: "你有冇記住 BB 對雞蛋過敏？", confirmations,
    propose: async () => { writes++; return {}; } });
  const result = await surface.tools.find(tool => tool.name === "propose_fact")!.execute({
    key: "egg-allergy", content: "BB 對雞蛋過敏", intendedVisibility: "private", validUntil: null,
  }, toolContext("read-not-write"));
  assert.equal(result.status, "rejected");
  assert.equal(result.data?.code, "memory_read_not_propose");
  assert.equal(writes, 0);
  assert.deepEqual(confirmations, []);
});

test("mixed request only proposes the explicit fact, not an inferred answer to the later question", async () => {
  let writes = 0;
  const surface = tools({ trustedUserMessage: "請記住：BB 對雞蛋過敏。明天帶甚麼？",
    propose: async () => { writes++; return {}; } });
  const result = await surface.tools.find(tool => tool.name === "propose_fact")!.execute({
    key: "tomorrow-food", content: "BB 明天不吃雞蛋", intendedVisibility: "private", validUntil: null,
  }, toolContext("inferred-fact"));
  assert.equal(result.status, "rejected");
  assert.equal(result.data?.code, "memory_fact_source_mismatch");
  assert.equal(writes, 0);
});

test("short expiry follows trusted original wording rather than a model paraphrase", async () => {
  const until = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
  const seen: unknown[] = [];
  const confirmations: Array<{ runId: string; proposalId: string; expectedVersion: number; workId: null }> = [];
  const surface = tools({ trustedUserMessage: "BB 今晚不吃雞蛋，明早恢復", confirmations,
    propose: async (...args) => {
      const value = args[3] as Record<string, unknown>; seen.push(value.validUntil);
      return { id: "f49a222e-77e4-4980-ae87-4c335b2b5c39", runId, childId: scope.childId, version: 1,
        status: "pending", value, createdAt: new Date().toISOString(), expiresAt: until, targetLabel: null, result: null };
    } });
  const result = await surface.tools.find(tool => tool.name === "propose_fact")!.execute({
    key: "egg-tonight", content: "BB 不吃雞蛋", intendedVisibility: "private", validUntil: until,
  }, toolContext("temporary-fact"));
  assert.equal(result.status, "succeeded");
  assert.deepEqual(seen, [until]);
  assert.equal(confirmations.length, 1);
});

function confirmedFact(index: number, content = `合成孩子偏好食物${index}`): MemoryFact {
  return { id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, childId: scope.childId,
    createdBy: scope.userId, visibility: "private", intendedVisibility: "private", status: "confirmed", version: 2,
    key: `food-${index}`, content, source: { kind: "manual", description: "synthetic confirmation" }, validUntil: null,
    confirmedBy: scope.userId, confirmedAt: "2026-10-28T00:00:00Z", reason: "confirmed", applicable: true, sourceState: "current" };
}
function memoryForFacts(facts: MemoryFact[], getFact?: (id: string) => MemoryFact | null) {
  return {
    context: async () => ({ profile: { childId: scope.childId, version: 0, data: null }, profileApplicable: false,
      facts: facts.slice(0, 10), topics: [], summary: null, recentMessages: [], conflictingKeys: [], unavailableFactKeys: [],
      truncated: { facts: facts.length > 10, topics: false, messages: false }, nextFactsAfterId: facts.length > 10 ? facts[9]!.id : null }),
    facts: async (_user: string, _child: string, afterId?: string) => {
      const start = afterId ? facts.findIndex(fact => fact.id === afterId) + 1 : 0;
      const items = facts.slice(start, start + 10);
      return { items, nextAfterId: start + 10 < facts.length ? items.at(-1)!.id : null };
    },
    getFact: async (_user: string, _child: string, id: string) => getFact ? getFact(id) : facts.find(fact => fact.id === id) ?? null,
  };
}
async function presentMemory(surface: ReturnType<typeof tools>, text: string) {
  const result = await surface.tools.find(tool => tool.name === "present_answer")!.execute({
    kind: "record_restatement", paragraphs: [{ text, citationIds: [] }],
  }, toolContext("present-memory"));
  assert.equal(result.status, "succeeded");
  return (await surface.presentation())!;
}
function reviewContext(onReview?: (payload: any) => void): AgentRunContext {
  return { scope, runId, budget: { remainingModelCalls: 1 },
    completeText: async ({ user }: { user: string }) => {
      const payload = JSON.parse(user.slice(user.indexOf("\n") + 1));
      onReview?.(payload);
      return JSON.stringify({ draftHash: payload.draftHash, decision: "pass", issues: [] });
    } } as unknown as AgentRunContext;
}

test("13 confirmed facts select only relevant evidence and bind the identical reviewed source set", async () => {
  const facts = Array.from({ length: 13 }, (_, index) => confirmedFact(index + 1));
  facts[12] = confirmedFact(13, "BB 對雞蛋過敏");
  const surface = tools({ trustedUserMessage: "你有冇記住 BB 對雞蛋過敏？", memory: memoryForFacts(facts) });
  const presentation = await presentMemory(surface, "已確認的記憶：BB 對雞蛋過敏。");
  const selected = surface.deliveryDraft()!;
  assert.deepEqual(selected.sources.map(source => source.citationId), [`memory-fact:${facts[12]!.id}`]);
  let payload: any;
  const reviewed = await enforceChatDeliveryReview({ tools: surface, presentation,
    context: reviewContext(value => { payload = value; }), provenance: { packVersion: "test", model: "mock-reviewer" } });
  assert.ok(reviewed.review);
  assert.equal(payload.draftHash, chatDeliveryDraftHash(selected));
  assert.deepEqual(payload.sources, selected.sources);
  assert.deepEqual(reviewed.review.sourceVersions, selected.sources.map(({ citationId, version, contentHash }) => ({ citationId, version, contentHash })));
  assert.equal(chatDeliveryReviewAllows(reviewed.review, surface.deliveryDraft()!, reviewed.review.promptVersion), true);
});

test("more than twelve required memory sources fail explicitly instead of binding a false complete answer", async () => {
  const facts = Array.from({ length: 13 }, (_, index) => confirmedFact(index + 1, `合成孩子喜歡第${index + 1}種食物`));
  const surface = tools({ trustedUserMessage: "全部記憶是甚麼？", memory: memoryForFacts(facts) });
  await assert.rejects(async () => {
    const presentation = await presentMemory(surface, facts.map(fact => fact.content).join("。"));
    await enforceChatDeliveryReview({ tools: surface, presentation, context: reviewContext(), provenance: { packVersion: "test", model: "mock-reviewer" } });
  }, (error: unknown) => error instanceof AgentStopped && error.reason === "delivery_review_incomplete");
});

for (const change of ["revoked", "expired", "changed"] as const) {
  test(`review pass cannot bind a memory source that became ${change}`, async () => {
    const fact = confirmedFact(1, "BB 對雞蛋過敏");
    let current: MemoryFact | null = fact;
    const surface = tools({ trustedUserMessage: "雞蛋過敏記憶是甚麼？", memory: memoryForFacts([fact], () => current) });
    const presentation = await presentMemory(surface, "BB 對雞蛋過敏。");
    await assert.rejects(enforceChatDeliveryReview({ tools: surface, presentation,
      context: reviewContext(() => { current = change === "revoked" ? null : change === "expired"
        ? { ...fact, validUntil: new Date(Date.now() - 1).toISOString() }
        : { ...fact, version: fact.version + 1, content: "BB 沒有雞蛋過敏" }; }),
      provenance: { packVersion: "test", model: "mock-reviewer" } }),
    (error: unknown) => error instanceof AgentStopped && ["delivery_review_incomplete", "unauthorized"].includes(error.reason));
  });
}

test("irrelevant, expired, inactive and private facts in family delivery cannot supply review evidence", async () => {
  const valid = confirmedFact(1, "BB 對雞蛋過敏");
  const facts = [confirmedFact(2, "照顧者喜歡看書"), { ...valid, validUntil: new Date(Date.now() - 1).toISOString() },
    { ...confirmedFact(3, "BB 對雞蛋過敏"), status: "inactive" as const }];
  const surface = tools({ trustedUserMessage: "雞蛋過敏記憶是甚麼？", memory: memoryForFacts(facts) });
  await presentMemory(surface, "BB 對雞蛋過敏。");
  assert.deepEqual(surface.deliveryDraft()!.sources, []);
  const family = tools({ visibility: "family", trustedUserMessage: "雞蛋過敏記憶是甚麼？", memory: memoryForFacts([valid]) });
  await presentMemory(family, "BB 對雞蛋過敏。");
  assert.deepEqual(family.deliveryDraft()!.sources, []);
});

for (const questions of [[], ["first", "second"]]) {
  test(`a pending candidate with ${questions.length} live confirmation questions does not grant a receipt exemption`, async () => {
    const surface = tools({ trustedUserMessage: "BB 對雞蛋過敏", confirmationQuestions: async () => questions });
    await surface.tools.find(tool => tool.name === "propose_fact")!.execute({
      key: "egg-allergy", content: "BB 對雞蛋過敏", intendedVisibility: "private", validUntil: null,
    }, toolContext("candidate"));
    await surface.tools.find(tool => tool.name === "present_answer")!.execute({
      kind: "record_restatement", paragraphs: [{ text: "BB 對雞蛋過敏。", citationIds: [] }],
    }, toolContext("present-candidate"));
    const presentation = await surface.presentation();
    assert.notEqual(presentation!.text, AGENT_CONFIRMATION_PENDING_TEXT);
    assert.equal(surface.deliveryDraft()!.serverSubstitutedReceiptText, false);
  });
}

test("a missing confirmation result is not reported as prepared", async () => {
  const surface = tools({ trustedUserMessage: "BB 對雞蛋過敏", requestConfirmation: async () => null });
  await assert.rejects(surface.tools.find(tool => tool.name === "propose_fact")!.execute({
    key: "egg-allergy", content: "BB 對雞蛋過敏", intendedVisibility: "private", validUntil: null,
  }, toolContext("candidate-no-confirmation")), (error: unknown) => error instanceof AgentStopped && error.reason === "unauthorized");
});

test("explicit fact and a comma-separated later question cannot be stored together", async () => {
  let writes = 0;
  const surface = tools({ trustedUserMessage: "請記住 BB 對雞蛋過敏，另外明天應該帶香蕉嗎？",
    propose: async () => { writes++; return {}; } });
  const result = await surface.tools.find(tool => tool.name === "propose_fact")!.execute({
    key: "food", content: "BB 對雞蛋過敏，明天應該帶香蕉", intendedVisibility: "private", validUntil: null,
  }, toolContext("mixed-source"));
  assert.equal(result.status, "rejected");
  assert.equal(result.data?.code, "memory_fact_source_mismatch");
  assert.equal(writes, 0);
});


test("mixed source matching preserves numeric punctuation", async () => {
  let writes = 0;
  const surface = tools({ trustedUserMessage: "請記住：BB 喜歡 1.2 份香蕉。明天帶甚麼？",
    propose: async () => { writes++; return {}; } });
  const result = await surface.tools.find(tool => tool.name === "propose_fact")!.execute({
    key: "banana", content: "BB 喜歡 12 份香蕉", intendedVisibility: "private", validUntil: null,
  }, toolContext("distinct-quantity"));
  assert.equal(result.status, "rejected");
  assert.equal(result.data?.code, "memory_fact_source_mismatch");
  assert.equal(writes, 0);
});

test("an old source ID cannot widen the fact explicitly requested in a mixed turn", async () => {
  let writes = 0;
  const surface = tools({ trustedUserMessage: "請記住：BB 對雞蛋過敏。明天帶甚麼？",
    propose: async () => { writes++; return {}; } });
  const result = await surface.tools.find(tool => tool.name === "propose_fact")!.execute({
    key: "banana", content: "BB 喜歡香蕉", intendedVisibility: "private", validUntil: null,
    sourceMessageId: "00000000-0000-4000-8000-000000000001",
  }, toolContext("old-unrequested-fact"));
  assert.equal(result.status, "rejected");
  assert.equal(result.data?.code, "memory_fact_source_mismatch");
  assert.equal(writes, 0);
});


for (const text of ['幫我記：BB 對雞蛋過敏。明天帶甚麼？', '請幫我記下 BB 對雞蛋過敏。另外明天帶甚麼？']) {
  test(`a direct record imperative remains eligible beside a question: ${text}`, async () => {
    const surface = tools({ trustedUserMessage: text });
    const result = await surface.tools.find(tool => tool.name === "propose_fact")!.execute({
      key: "egg-allergy", content: "BB 對雞蛋過敏", intendedVisibility: "private", validUntil: null,
    }, toolContext("record-clause"));
    assert.equal(result.status, "succeeded");
    assert.equal(result.data?.result && (result.data.result as { confirmationPrepared: boolean }).confirmationPrepared, true);
  });
}

test("a temporary clause does not authorize short expiry for a different fact", async () => {
  const seen: unknown[] = [];
  const surface = tools({ trustedUserMessage: "BB 暫時不吃雞蛋；BB 對牛奶過敏。",
    propose: async (...args) => { seen.push((args[3] as { validUntil: string | null }).validUntil); return {
      id: "00000000-0000-4000-8000-000000000001", runId, childId: scope.childId, version: 1, status: "pending",
    }; } });
  const result = await surface.tools.find(tool => tool.name === "propose_fact")!.execute({
    key: "milk-allergy", content: "BB 對牛奶過敏", intendedVisibility: "private",
    validUntil: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
  }, toolContext("separate-fact-window"));
  assert.equal(result.status, "succeeded");
  assert.deepEqual(seen, [null]);
});


async function mixedMemoryAndOfficialSurface() {
  const fact = confirmedFact(1, "BB 對雞蛋過敏");
  let current: MemoryFact | null = fact;
  const chunk = { chunkId: "00000000-0000-4000-8000-000000000099", versionId: "00000000-0000-4000-8000-000000000098",
    sourceId: "synthetic-official", classification: "official_guidance", text: "如對食物過敏，應向醫護人員查詢。" };
  const surface = tools({ trustedUserMessage: "雞蛋過敏記憶是甚麼？有甚麼一般資料？", memory: memoryForFacts([fact], () => current), knowledgeChunks: [chunk] });
  const searched = await surface.tools.find(tool => tool.name === "search_knowledge")!.execute({ query: "食物過敏", classification: "official_guidance" }, toolContext("search"));
  assert.equal(searched.status, "succeeded");
  const presented = await surface.tools.find(tool => tool.name === "present_answer")!.execute({
    kind: "mixed", paragraphs: [{ kind: "record_restatement", text: "BB 對雞蛋過敏。", citationIds: [] },
      { kind: "caregiving", text: chunk.text, citationIds: [chunk.chunkId] }],
  }, toolContext("mixed-presentation"));
  assert.equal(presented.status, "succeeded");
  return { surface, fact, chunk, revoke: () => { current = null; } };
}

test("mixed official and memory paragraphs bind both relevant source types", async () => {
  const { surface, fact, chunk } = await mixedMemoryAndOfficialSurface();
  await surface.presentation();
  assert.deepEqual(surface.deliveryDraft()!.sources.map(source => source.citationId).sort(), [chunk.chunkId, `memory-fact:${fact.id}`].sort());
});

test("official citations cannot hide a revoked memory source in a mixed answer", async () => {
  const { surface, revoke } = await mixedMemoryAndOfficialSurface();
  const presentation = (await surface.presentation())!;
  await assert.rejects(enforceChatDeliveryReview({ tools: surface, presentation,
    context: reviewContext(revoke), provenance: { packVersion: "test", model: "mock-reviewer" } }),
  (error: unknown) => error instanceof AgentStopped && error.reason === "delivery_review_incomplete");
});

for (const content of ['BB 不吃雞蛋，只限今晚', 'BB 不吃雞蛋']) {
  test(`a trailing qualifier stays bound to its immediately preceding fact: ${content}`, async () => {
    const until = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
    const seen: unknown[] = [];
    const surface = tools({ trustedUserMessage: 'BB 不吃雞蛋，只限今晚',
      propose: async (...args) => { seen.push((args[3] as { validUntil: string | null }).validUntil); return {
        id: '00000000-0000-4000-8000-000000000001', runId, childId: scope.childId, version: 1, status: 'pending',
      }; } });
    const result = await surface.tools.find(tool => tool.name === 'propose_fact')!.execute({
      key: 'egg-tonight', content, intendedVisibility: 'private', validUntil: until,
    }, toolContext('trailing-fact-window'));
    assert.equal(result.status, 'succeeded');
    assert.deepEqual(seen, [until]);
  });
}
