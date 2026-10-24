import assert from "node:assert/strict";
import test from "node:test";
import { createProductAgentTools } from "../server/product-agent-tools.ts";
import { AGENT_CONFIRMATION_PENDING_TEXT, buildAgentConfirmationQuestion } from "../server/agent-work-tool-descriptions.ts";
import { looksLikeDurableMemoryFactQuestion, looksLikeDurableMemoryFactStatement } from "../server/memory-policy.ts";
import type { AgentRunContext } from "../server/agent-runtime.ts";

const scope = {
  userId: "synthetic-caregiver",
  childId: "1ebcb39d-a2db-4b8c-a432-7ffcb3de5808",
  workspaceId: "synthetic-workspace",
  authorizationVersion: "1",
  dataVersion: "epoch:1",
};
const runId = "d4a1b662-d13d-476b-bf52-40a28aa1a1a7";

function tools(options: {
  trustedUserMessage?: string;
  propose?: (...args: unknown[]) => Promise<unknown>;
  confirmationQuestions?: () => Promise<string[]>;
  requestConfirmation?: (...args: unknown[]) => Promise<unknown>;
  confirmations?: Array<{ runId: string; proposalId: string; expectedVersion: number; workId: null }>;
}) {
  const run = {
    scope, runId, budget: { toolResponseCharacters: 12000, remainingModelCalls: 4, signal: new AbortController().signal },
    authorize: async () => true,
  } as unknown as AgentRunContext;
  const store = {
    propose: options.propose ?? (async () => ({
      id: "f49a222e-77e4-4980-ae87-4c335b2b5c39", runId, childId: scope.childId, version: 1, status: "pending",
      createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString(),
      value: { kind: "memory_fact", key: "allergy", content: "BB 對雞蛋過敏", intendedVisibility: "private", validUntil: null },
      targetLabel: null, result: null,
    })),
    confirmationQuestions: options.confirmationQuestions,
    requestConfirmation: options.requestConfirmation ?? (async (_scope: unknown, _asking: string, raw: { runId: string; proposalId: string; expectedVersion: number; workId: null }) => {
      options.confirmations?.push(raw);
      return { id: "conf-1", proposalRunId: raw.runId, proposalId: raw.proposalId, proposalVersion: raw.expectedVersion, expiresAt: new Date(Date.now() + 86400000).toISOString(), question: "prepared" };
    }),
  };
  return createProductAgentTools({
    run, authorize: async () => true,
    trustedUserMessage: options.trustedUserMessage,
    store: store as never,
    memory: { context: async () => ({ profile: { childId: scope.childId, version: 0, data: null }, profileApplicable: false,
      facts: [], topics: [], summary: null, recentMessages: [], conflictingKeys: [], unavailableFactKeys: [],
      truncated: { facts: false, topics: false, messages: false } }) } as never,
    tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) } as never,
    knowledge: { createRun: () => ({ search: async () => ({ mode: "vector_keyword", chunks: [] }),
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
  }, { callId: "c1" });
  assert.equal(rejected.status, "rejected");
  assert.equal((rejected.data as { code?: string }).code, "propose_fact_required");
});

test("after propose_fact, citation-free present becomes server pending receipt and skips review sources", async () => {
  const surface = tools({ trustedUserMessage: "BB 對雞蛋過敏" });
  const propose = surface.tools.find(tool => tool.name === "propose_fact")!;
  const present = surface.tools.find(tool => tool.name === "present_answer")!;
  const proposed = await propose.execute({
    key: "allergy-egg", content: "寶寶對雞蛋過敏", intendedVisibility: "private", validUntil: null,
  }, { callId: "c-propose" });
  assert.equal(proposed.status, "succeeded");
  const accepted = await present.execute({
    kind: "clarification",
    paragraphs: [{ text: "已記下 BB 對雞蛋過敏，待你確認。", citationIds: [] }],
  }, { callId: "c-present" });
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
  }, { callId: "c1" });
  assert.equal(accepted.status, "succeeded");
});

test("preference statements require propose_fact before citation-free present_answer", async () => {
  assert.equal(looksLikeDurableMemoryFactStatement("BB 鍾意香蕉"), true);
  const surface = tools({ trustedUserMessage: "BB 鍾意香蕉" });
  const present = surface.tools.find(tool => tool.name === "present_answer")!;
  const rejected = await present.execute({
    kind: "clarification",
    paragraphs: [{ text: "收到，BB 鍾意香蕉。", citationIds: [] }],
  }, { callId: "c-pref" });
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
  }, { callId: "c-propose-pref" });
  assert.equal(proposed.status, "succeeded");
  const accepted = await present.execute({
    kind: "clarification",
    paragraphs: [{ text: "已記下 BB 鍾意香蕉，待你確認。", citationIds: [] }],
  }, { callId: "c-present-pref" });
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
  }, { callId: "c-q-propose" });
  assert.equal(rejected.status, "rejected");
  assert.equal((rejected.data as { code?: string }).code, "memory_read_not_propose");
  assert.equal(proposed, false);
  const present = surface.tools.find(tool => tool.name === "present_answer")!;
  const accepted = await present.execute({
    kind: "clarification",
    paragraphs: [{ text: "memory says Esther sesame allergy", citationIds: [] }],
  }, { callId: "c-q-present" });
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
  }, { callId: "c-short" });
  assert.equal(short.status, "succeeded");
  assert.equal(captured[0], null);
  const longUntil = new Date(Date.now() + 40 * 24 * 60 * 60 * 1000).toISOString();
  const long = await propose.execute({
    key: "allergy-sesame", content: "Esther\u5c0d\u829d\u9ebb\u904e\u654f", intendedVisibility: "private",
    validUntil: longUntil,
  }, { callId: "c-long" });
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
  }, { callId: "c-avocado" });
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
  }, { callId: "c-broccoli" });
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
  }, { callId: "c-hydrate-q" });
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
  }, { callId: "c-mixed" });
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
  }, { callId: "c-short-pref" });
  assert.equal(short.status, "succeeded");
  assert.equal(captured[0], sixHours);
});
