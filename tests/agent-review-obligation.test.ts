import assert from "node:assert/strict";
import test from "node:test";
import { AgentBudget } from "../server/agent-budget.ts";
import * as delivery from "../server/chat-delivery-review.ts";
import type { ChatDeliveryDraft } from "../server/chat-delivery-review.ts";
import type { AgentRunContext } from "../server/agent-runtime.ts";
import { createProductAgentTools } from "../server/product-agent-tools.ts";

const scope = { userId: "synthetic-user", childId: "synthetic-child", workspaceId: "synthetic-workspace", authorizationVersion: "1", dataVersion: "1" };
const ordinaryDraft: ChatDeliveryDraft = {
  kind: "record_restatement", visibility: "private", serverSubstitutedSourceText: false, scope,
  paragraphs: [{ text: "這個清單分為三個部分。", citationIds: [] }], sources: [],
};

test("ordinary wording and unused source evidence do not automatically request a reviewer", () => {
  assert.equal(delivery.requiresChatDeliveryReview(ordinaryDraft), false);
  assert.equal(delivery.requiresChatDeliveryReview({ ...ordinaryDraft, sources: [{
    citationId: "source-1", version: "1", contentHash: "a".repeat(64), classification: "official_guidance",
    excerpt: "這個清單分為三個部分。", excerptComplete: true,
  }] }), false);
});

test("a single actual claim-to-citation binding still requires independent citation review", () => {
  assert.equal(delivery.requiresChatDeliveryReview({ ...ordinaryDraft,
    paragraphs: [{ text: "這個清單分為三個部分。", citationIds: ["source-1"] }],
    sources: [{ citationId: "source-1", version: "1", contentHash: "a".repeat(64), classification: "official_guidance",
      excerpt: "這個清單分為三個部分。", excerptComplete: true }],
  }), true);
});

test("an established review obligation survives citation removal and model relabelling", () => {
  assert.equal(typeof delivery.createChatDeliveryReviewObligation, "function");
  const obligation = delivery.createChatDeliveryReviewObligation();
  assert.equal(obligation.required, false);
  assert.equal(delivery.requiresChatDeliveryReview({ ...ordinaryDraft,
    paragraphs: [{ text: "這個清單分為三個部分。", citationIds: ["source-1"] }],
  }, obligation), true);
  assert.equal(obligation.required, true);
  assert.equal(delivery.requiresChatDeliveryReview({ ...ordinaryDraft, kind: "operation" }, obligation), true);
  assert.equal(delivery.createChatDeliveryReviewObligation().required, false, "The obligation belongs only to its original run");
});

test("trusted original receipts may deliver without clearing an existing review obligation", () => {
  assert.equal(typeof delivery.createChatDeliveryReviewObligation, "function");
  const obligation = delivery.createChatDeliveryReviewObligation(true);
  assert.equal(delivery.requiresChatDeliveryReview({ ...ordinaryDraft, serverSubstitutedReceiptText: true }, obligation), false);
  assert.equal(obligation.required, true);
  assert.equal(delivery.requiresChatDeliveryReview(ordinaryDraft, obligation), true);
});

test("a bounded clarification can deliver without cancelling the pending review task", () => {
  const obligation = delivery.createChatDeliveryReviewObligation(true);
  assert.equal(delivery.requiresChatDeliveryReview({ ...ordinaryDraft, kind: "clarification",
    paragraphs: [{ text: "寶寶幾個月大？", citationIds: [] }],
  }, obligation), false);
  assert.equal(obligation.required, true);
  assert.equal(delivery.requiresChatDeliveryReview(ordinaryDraft, obligation), true);
});

test("removing an established citation cannot gain acceptance from an unsupported review pass", async () => {
  const budget = new AgentBudget();
  const obligation = delivery.createChatDeliveryReviewObligation();
  delivery.requiresChatDeliveryReview({ ...ordinaryDraft,
    paragraphs: [{ text: ordinaryDraft.paragraphs[0]!.text, citationIds: ["source-1"] }],
  }, obligation);
  const presentation = { text: ordinaryDraft.paragraphs[0]!.text, citations: [], retrievalMode: "not_used" as const };
  try {
    await assert.rejects(delivery.enforceChatDeliveryReview({ presentation,
      tools: { deliveryDraft: () => ordinaryDraft, presentation: async () => presentation,
        replaceDeliveryAnswer: () => assert.fail("No repair was requested") },
      context: { scope, runId: "synthetic-run", budget, deliveryReview: obligation,
        completeText: async () => {
          budget.take("modelCalls");
          return JSON.stringify({ draftHash: delivery.chatDeliveryDraftHash(ordinaryDraft), decision: "pass", issues: [] });
        } }, provenance: { packVersion: "synthetic", model: "synthetic" },
    }), { reason: "delivery_review_no_sources" });
  } finally { budget.close(); }
});

test("the current user request is part of the delivery binding", () => {
  assert.notEqual(delivery.chatDeliveryDraftHash({ ...ordinaryDraft, userRequest: "列出清單內容" }),
    delivery.chatDeliveryDraftHash({ ...ordinaryDraft, userRequest: "核對清單是否完整" }));
});

test("the binding includes the exact excerpt and source classification shown to the reviewer", () => {
  const source = { citationId: "source-1", version: "1", contentHash: "a".repeat(64),
    classification: "official_guidance" as const, excerpt: "Three parts", excerptComplete: true };
  const hash = delivery.chatDeliveryDraftHash({ ...ordinaryDraft, sources: [source] });
  assert.notEqual(hash, delivery.chatDeliveryDraftHash({ ...ordinaryDraft, sources: [{ ...source, excerpt: "Two parts" }] }));
  assert.notEqual(hash, delivery.chatDeliveryDraftHash({ ...ordinaryDraft, sources: [{ ...source, classification: "private" }] }));
});

test("rereview sees the original request, draft and repair issues as bounded data", async () => {
  const budget = new AgentBudget();
  const original: ChatDeliveryDraft = { ...ordinaryDraft, userRequest: "核對這個清單的引用。",
    paragraphs: [{ text: "這個清單分為兩個部分。", citationIds: ["source-1"] }],
    sources: [{ citationId: "source-1", version: "1", contentHash: "a".repeat(64), classification: "official_guidance",
      excerpt: "這個清單分為三個部分。", excerptComplete: true }] };
  let current = structuredClone(original), reviews = 0;
  const observed: Record<string, unknown>[] = [];
  const issues = [{ paragraph: 0, reason: "The count is incorrect", support: "The source lists three parts" }];
  const presentation = () => ({ text: current.paragraphs[0]!.text, citations: [], retrievalMode: "not_used" as const });
  try {
    const result = await delivery.enforceChatDeliveryReview({ presentation: presentation(),
      tools: { deliveryDraft: () => current, presentation: async () => presentation(),
        replaceDeliveryAnswer: value => { current = { ...current, kind: value.kind, paragraphs: value.paragraphs }; } },
      context: { scope, runId: "synthetic-run", budget, completeText: async input => {
        budget.take("modelCalls");
        const payload = JSON.parse(input.user.slice(input.user.indexOf("{")));
        if (input.purpose === "delivery_repair") return JSON.stringify({ kind: "record_restatement",
          paragraphs: [{ text: "這個清單分為三個部分。", citationIds: ["source-1"] }] });
        observed.push(payload); reviews++;
        return JSON.stringify({ draftHash: payload.draftHash, decision: reviews === 1 ? "revise" : "pass",
          issues: reviews === 1 ? issues : [] });
      } }, provenance: { packVersion: "synthetic", model: "synthetic" },
    });
    assert.equal(result.review?.decision, "pass");
    assert.equal(observed[0]?.userRequest, original.userRequest);
    assert.equal((observed[1]?.previousDraft as any)?.paragraphs[0]?.text, original.paragraphs[0]!.text);
    assert.deepEqual(observed[1]?.repairIssues, issues);
    assert.equal(observed[1]?.userRequest, original.userRequest);
    assert.equal(budget.counts.modelCalls, 3);
    assert.notEqual(result.review?.draftHash, delivery.chatDeliveryDraftHash(current), "The pass must also bind the reviewed repair context");
  } finally { budget.close(); }
});

test("a second paragraph's valid citation does not override a rereview rejection of the uncited first claim", async () => {
  const budget = new AgentBudget(), obligation = delivery.createChatDeliveryReviewObligation();
  const original: ChatDeliveryDraft = { ...ordinaryDraft, userRequest: "核對清單及顏色的引用。",
    kind: "mixed", paragraphs: [
      { kind: "record_restatement", text: "清單有兩個部分。", citationIds: ["count-source"] },
      { kind: "record_restatement", text: "標籤是藍色。", citationIds: ["color-source"] },
    ], sources: [
      { citationId: "count-source", version: "1", contentHash: "a".repeat(64), classification: "official_guidance",
        excerpt: "清單有三個部分。", excerptComplete: true },
      { citationId: "color-source", version: "1", contentHash: "b".repeat(64), classification: "official_guidance",
        excerpt: "標籤是藍色。", excerptComplete: true },
    ] };
  let current = structuredClone(original), reviews = 0;
  const issues = [{ paragraph: 0, reason: "The count is unsupported", support: "The source says three, not two" }];
  const presentation = () => ({ text: current.paragraphs.map(p => p.text).join("\n"), citations: [], retrievalMode: "not_used" as const });
  try {
    await assert.rejects(delivery.enforceChatDeliveryReview({ presentation: presentation(),
      tools: { deliveryDraft: () => current, presentation: async () => presentation(),
        replaceDeliveryAnswer: value => { current = { ...current, ...value }; } },
      context: { scope, runId: "synthetic-run", budget, deliveryReview: obligation, completeText: async input => {
        budget.take("modelCalls");
        if (input.purpose === "delivery_repair") return JSON.stringify({ kind: "mixed", paragraphs: [
          { kind: "operation", text: original.paragraphs[0]!.text, citationIds: [] }, original.paragraphs[1],
        ] });
        const payload = JSON.parse(input.user.slice(input.user.indexOf("{"))); reviews++;
        if (reviews === 2) {
          assert.equal(payload.userRequest, original.userRequest);
          assert.deepEqual(payload.previousDraft.paragraphs.map(({ index: _index, ...paragraph }: any) => paragraph), original.paragraphs);
          assert.deepEqual(payload.previousDraft.sources, original.sources);
          assert.deepEqual(payload.repairIssues, issues);
          assert.equal(payload.paragraphs[0].text, original.paragraphs[0]!.text);
          assert.equal(payload.paragraphs[0].kind, "operation");
          assert.deepEqual(payload.paragraphs[0].citationIds, []);
          assert.deepEqual(payload.paragraphs[1].citationIds, ["color-source"]);
          assert.deepEqual(payload.sources, original.sources);
        }
        // The runtime cannot determine semantic support from citation presence.
        // The independent reviewer rejects the still-unsupported first claim.
        return JSON.stringify({ draftHash: payload.draftHash,
          decision: reviews === 1 ? "revise" : "insufficient_evidence", issues });
      } }, provenance: { packVersion: "synthetic", model: "synthetic" },
    }), { reason: "delivery_review_rejected" });
    assert.equal(reviews, 2);
    assert.equal(obligation.required, true);
    assert.equal(obligation.citationRequired, true);
    assert.equal(budget.counts.modelCalls, 3);
  } finally { budget.close(); }
});

test("a rejected citation cannot erase its obligation on a subsequent product presentation", async () => {
  const budget = new AgentBudget();
  const run: AgentRunContext = { scope, runId: "synthetic-run", budget, completeText: async input => {
    budget.take("modelCalls");
    const payload = JSON.parse(input.user.slice(input.user.indexOf("{")));
    return JSON.stringify({ draftHash: payload.draftHash, decision: "pass", issues: [] });
  } };
  const tools = createProductAgentTools({ run, authorize: async () => true,
    trustedUserMessage: "請核對清單的引用。", memory: {}, tasks: {}, store: {},
    knowledge: { createRun: () => ({}) },
  } as unknown as Parameters<typeof createProductAgentTools>[0]);
  const present = tools.tools.find(tool => tool.name === "present_answer")!;
  try {
    const rejected = await present.execute({ kind: "record_restatement",
      paragraphs: [{ text: ordinaryDraft.paragraphs[0]!.text, citationIds: ["not-a-retrieved-source"] }],
    }, { scope, runId: run.runId, callId: "rejected-citation", signal: budget.signal });
    assert.equal(rejected.status, "rejected");
    assert.equal(run.deliveryReview?.required, true);
    assert.equal(run.deliveryReview?.evidenceRequired, true);
    const accepted = await present.execute({ kind: "operation", paragraphs: ordinaryDraft.paragraphs },
      { scope, runId: run.runId, callId: "relabeled-answer", signal: budget.signal });
    assert.equal(accepted.status, "succeeded");
    assert.equal(tools.deliveryDraft()?.userRequest, "請核對清單的引用。");
    await assert.rejects(delivery.enforceChatDeliveryReview({ presentation: (await tools.presentation())!, tools,
      context: run, provenance: { packVersion: "synthetic", model: "synthetic" },
    }), { reason: "delivery_review_no_sources" });
  } finally { budget.close(); }
});

test("uncited hydrated memory cannot satisfy a citation obligation after the original citation is removed", async () => {
  const budget = new AgentBudget(), obligation = delivery.createChatDeliveryReviewObligation();
  delivery.requiresChatDeliveryReview({ ...ordinaryDraft,
    paragraphs: [{ text: ordinaryDraft.paragraphs[0]!.text, citationIds: ["source-1"] }],
  }, obligation);
  const current: ChatDeliveryDraft = { ...ordinaryDraft,
    paragraphs: [...ordinaryDraft.paragraphs, { text: "喜歡藍色。", citationIds: [] }],
    sources: [{ citationId: "memory-fact:synthetic", version: "1", contentHash: "b".repeat(64),
      classification: "private", excerpt: "喜歡藍色。", excerptComplete: true }] };
  const presentation = { text: current.paragraphs.map(p => p.text).join("\n"), citations: [], retrievalMode: "not_used" as const };
  try {
    await assert.rejects(delivery.enforceChatDeliveryReview({ presentation,
      tools: { deliveryDraft: () => current, presentation: async () => presentation, replaceDeliveryAnswer: () => assert.fail("No repair") },
      context: { scope, runId: "synthetic-run", budget, deliveryReview: obligation,
        completeText: async input => {
          budget.take("modelCalls");
          const payload = JSON.parse(input.user.slice(input.user.indexOf("{")));
          return JSON.stringify({ draftHash: payload.draftHash, decision: "pass", issues: [] });
        } }, provenance: { packVersion: "synthetic", model: "synthetic" },
    }), { reason: "delivery_review_no_sources" });
  } finally { budget.close(); }
});

test("repair can withdraw a claim into a bounded clarification without clearing the obligation", async () => {
  const budget = new AgentBudget(), obligation = delivery.createChatDeliveryReviewObligation();
  let current: ChatDeliveryDraft = { ...ordinaryDraft,
    paragraphs: [{ text: "這個清單分為兩個部分。", citationIds: ["source-1"] }],
    sources: [{ citationId: "source-1", version: "1", contentHash: "a".repeat(64),
      classification: "official_guidance", excerpt: "三個部分。", excerptComplete: true }] };
  let calls = 0;
  const presentation = () => ({ text: current.paragraphs[0]!.text, citations: [], retrievalMode: "not_used" as const });
  try {
    const result = await delivery.enforceChatDeliveryReview({ presentation: presentation(),
      tools: { deliveryDraft: () => current, presentation: async () => presentation(),
        replaceDeliveryAnswer: value => { current = { ...current, ...value, sources: [] }; } },
      context: { scope, runId: "synthetic-run", budget, deliveryReview: obligation, completeText: async input => {
        calls++; budget.take("modelCalls");
        if (input.purpose === "delivery_repair") return JSON.stringify({ kind: "clarification",
          paragraphs: [{ text: "寶寶幾個月大？", citationIds: [] }] });
        assert.equal(calls, 1, "A genuinely safe clarification needs no rereview");
        const payload = JSON.parse(input.user.slice(input.user.indexOf("{")));
        return JSON.stringify({ draftHash: payload.draftHash, decision: "revise",
          issues: [{ paragraph: 0, reason: "Need context", support: "The applicable age is unknown" }] });
      } }, provenance: { packVersion: "synthetic", model: "synthetic" },
    });
    assert.equal(result.presentation.text, "寶寶幾個月大？");
    assert.equal(result.review, null);
    assert.equal(obligation.required, true);
    assert.equal(calls, 2);
  } finally { budget.close(); }
});

test("a rejected mixed caregiving paragraph cannot be relabelled to remove its review obligation", async () => {
  const budget = new AgentBudget();
  const run: AgentRunContext = { scope, runId: "synthetic-run", budget, completeText: async input => {
    budget.take("modelCalls");
    const payload = JSON.parse(input.user.slice(input.user.indexOf("{")));
    return JSON.stringify({ draftHash: payload.draftHash, decision: "pass", issues: [] });
  } };
  const tools = createProductAgentTools({ run, authorize: async () => true, memory: {}, tasks: {}, store: {},
    knowledge: { createRun: () => ({}) },
  } as unknown as Parameters<typeof createProductAgentTools>[0]);
  const present = tools.tools.find(tool => tool.name === "present_answer")!;
  try {
    const first = await present.execute({ kind: "mixed", paragraphs: [{ kind: "caregiving", text: "飯後兩粒。", citationIds: [] }] },
      { scope, runId: run.runId, callId: "mixed-care", signal: budget.signal });
    assert.equal(first.status, "rejected");
    assert.equal(run.deliveryReview?.required, true);
    const second = await present.execute({ kind: "operation", paragraphs: [{ text: "飯後兩粒。", citationIds: [] }] },
      { scope, runId: run.runId, callId: "relabel-care", signal: budget.signal });
    assert.equal(second.status, "succeeded");
    await assert.rejects(delivery.enforceChatDeliveryReview({ presentation: (await tools.presentation())!, tools,
      context: run, provenance: { packVersion: "synthetic", model: "synthetic" },
    }), { reason: "delivery_review_no_sources" });
  } finally { budget.close(); }
});

test("relabelled caregiving cannot replace its official evidence requirement with a private citation", async () => {
  const budget = new AgentBudget(), obligation = delivery.createChatDeliveryReviewObligation();
  delivery.requiresChatDeliveryReview({ ...ordinaryDraft, kind: "mixed",
    paragraphs: [{ kind: "caregiving", text: "飯後兩粒。", citationIds: ["official-1"] }],
  }, obligation);
  const current: ChatDeliveryDraft = { ...ordinaryDraft, kind: "operation",
    paragraphs: [{ text: "飯後兩粒。", citationIds: ["private-1"] }],
    sources: [{ citationId: "private-1", version: "1", contentHash: "b".repeat(64), classification: "private",
      excerpt: "飯後兩粒。", excerptComplete: true }] };
  const presentation = { text: "飯後兩粒。", citations: [], retrievalMode: "not_used" as const };
  try {
    await assert.rejects(delivery.enforceChatDeliveryReview({ presentation,
      tools: { deliveryDraft: () => current, presentation: async () => presentation, replaceDeliveryAnswer: () => assert.fail("No repair") },
      context: { scope, runId: "synthetic-run", budget, deliveryReview: obligation, completeText: async input => {
        budget.take("modelCalls"); const payload = JSON.parse(input.user.slice(input.user.indexOf("{")));
        return JSON.stringify({ draftHash: payload.draftHash, decision: "pass", issues: [] });
      } }, provenance: { packVersion: "synthetic", model: "synthetic" },
    }), { reason: "delivery_review_no_sources" });
  } finally { budget.close(); }
});

test("an inactive live review obligation does not steal the final generation call", async () => {
  const budget = new AgentBudget();
  const reserveDeliveryReview = () => false;
  try {
    budget.take("modelCalls", 3);
    assert.equal(budget.planningSnapshot(true, { reserveDeliveryReview }).reserveForDeliveryReview.modelCalls, 0);
    await budget.admitModel({ reserveDeliveryReview });
    assert.equal(budget.counts.modelCalls, 4);
  } finally { budget.close(); }
});

test("serialized admission reads a newly required review instead of an earlier snapshot", async () => {
  const budget = new AgentBudget();
  let required = false;
  const reserveDeliveryReview = () => required;
  try {
    budget.take("modelCalls", 2);
    assert.equal(budget.planningSnapshot(true, { reserveDeliveryReview }).phase, "work");
    const preceding = budget.admitModel({ reserveDeliveryReview });
    const queued = budget.admitModel({ reserveDeliveryReview });
    required = true;
    await preceding;
    await assert.rejects(queued, { reason: "model_limit" });
    assert.equal(budget.counts.modelCalls, 3);
    await budget.admitModel({ reserveDeliveryReview, purpose: "delivery_review" });
    assert.equal(budget.counts.modelCalls, 4);
  } finally { budget.close(); }
});
