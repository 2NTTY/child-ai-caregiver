import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { FinishReason } from "@google/genai";
import { readAiConfig } from "../server/ai-config.ts";
import { createAgentRuntime } from "../server/agent-runtime.ts";
import { createProductAgent } from "../server/product-agent.ts";
import { createProductAgentTools } from "../server/product-agent-tools.ts";
import { loadAgentPrompt } from "../server/agent-prompt.ts";
import { AgentBudget } from "../server/agent-budget.ts";
import { isPureScopeRefusalOrLimitation, isPureVerifiedOperationSummary, requiresChatDeliveryReview, chatDeliveryPassNeedsSources, createChatDeliveryReviewObligation } from "../server/chat-delivery-review.ts";
import { PRESENTATION_REPAIR_MESSAGE } from "../server/agent-presentation-repair.ts";
import { AGENT_CONFIRMATION_PENDING_TEXT } from "../server/agent-work-tool-descriptions.ts";
import type { AgentRunContext, AgentTool } from "../server/agent-runtime.ts";
import type { ProductAgentResult } from "../src/shared/product-agent.ts";

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

test("targeted citation recovery hints guide emergency-hk-v1 and evidence-backed retries", async () => {
  const b1 = new AgentBudget();
  try {
    const surface = createProductAgentTools({
      run: { scope, runId, budget: b1 } as unknown as AgentRunContext,
      authorize: async () => true,
      store: {} as never,
      memory: { context: async () => ({ profile: { childId: scope.childId, version: 0, data: null }, profileApplicable: false, facts: [], topics: [], summary: null, recentMessages: [], conflictingKeys: [], unavailableFactKeys: [], truncated: { facts: false, topics: false, messages: false } }) } as never,
      tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) } as never,
      knowledge: { createRun: () => ({ search: async () => ({ mode: "vector_keyword", chunks: [] }), revalidateCitations: async () => true }) } as never,
    });
    const showHelp = surface.tools.find(tool => tool.name === "show_official_help")!;
    const present = surface.tools.find(tool => tool.name === "present_answer")!;
    const helpRes = await showHelp.execute({ card: "emergency-hk-v1" }, toolContext("help-call"));
    assert.equal(helpRes.status, "succeeded");
    const errRes = await present.execute({ kind: "safety_help", paragraphs: [{ kind: "safety_help", text: "請打 999", citationIds: ["emergency-hk-v1"] }] }, toolContext("bad-safety"));
    assert.equal(errRes.status, "rejected");
    assert.equal((errRes.data as { code?: string })?.code, "citation_required");
    assert.match(String((errRes.data as { nextAction?: string })?.nextAction), /kind:\s*"operation"/u);
    const customDrugRes = await present.execute({ kind: "operation", paragraphs: [{ kind: "operation", text: "如果 BB 發燒抽筋，請先使用畫面上的緊急求助入口，不要自行給予退燒藥物。", citationIds: [] }] }, toolContext("bad-op-drug"));
    assert.equal(customDrugRes.status, "rejected");
    assert.equal((customDrugRes.data as { code?: string })?.code, "citation_required");
    const exactEmergency = await present.execute({ kind: "operation", paragraphs: [{ kind: "operation", text: "請先使用畫面上的緊急求助入口。", citationIds: [] }] }, toolContext("good-emergency"));
    assert.equal(exactEmergency.status, "succeeded");
  } finally {
    b1.close();
  }

  const b2 = new AgentBudget();
  try {
    const surface = createProductAgentTools({
      run: { scope, runId, budget: b2 } as unknown as AgentRunContext,
      authorize: async () => true,
      store: {} as never,
      memory: { context: async () => ({ profile: { childId: scope.childId, version: 0, data: null }, profileApplicable: false, facts: [], topics: [], summary: null, recentMessages: [], conflictingKeys: [], unavailableFactKeys: [], truncated: { facts: false, topics: false, messages: false } }) } as never,
      tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) } as never,
      knowledge: {
        createRun: () => ({
          search: async () => ({
            mode: "vector_keyword",
            chunks: [{
              chunkId: "00000000-0000-4000-8000-000000000077",
              versionId: "00000000-0000-4000-8000-000000000076",
              sourceId: "fhs-solid-food",
              classification: "official_guidance",
              text: "寶寶約六個月大時可開始進食固體食物。",
            }],
          }),
          revalidateCitations: async () => true,
        }),
      } as never,
    });
    const search = surface.tools.find(tool => tool.name === "search_knowledge")!;
    const present = surface.tools.find(tool => tool.name === "present_answer")!;
    await search.execute({ query: "嬰兒加固", classification: "official_guidance" }, toolContext("search-call"));
    const rej = await present.execute({
      kind: "mixed",
      paragraphs: [
        { kind: "caregiving", text: "寶寶約六個月大可開始加固。", citationIds: ["00000000-0000-4000-8000-000000000077"] },
        { kind: "caregiving", text: "BB 對花生過敏。", citationIds: [] },
      ],
    }, toolContext("bad-mixed"));
    assert.equal(rej.status, "rejected");
    assert.equal((rej.data as { code?: string })?.code, "citation_required");
    assert.match(String((rej.data as { nextAction?: string })?.nextAction), /record_restatement/u);
  } finally {
    b2.close();
  }
});

test("ordinary action policy, verified operation receipts, mixed pending revisions and scope refusals deliver cleanly", async () => {
  const manifest = JSON.parse(await readFile(new URL("../prompts/manifest.json", import.meta.url), "utf8"));
  const prompt = await loadAgentPrompt("product-interactive", "tool_cycle", ["run", "scope", "conversation", "context", "evidence", "capabilities"]);
  const reviewPrompt = await loadAgentPrompt("chat-delivery-review", "structured", ["run", "scope", "context", "evidence", "capabilities", "outputContract"]);
  assert.equal(prompt.packVersion, manifest.version);
  assert.match(prompt.text, /load_capabilities/u);
  assert.match(prompt.text, /care_records/u);
  assert.match(prompt.text, /切勿在開頭硬插過敏紀錄/u);
  assert.match(prompt.text, /絕不可塞入無關主題/u);
  assert.match(reviewPrompt.text, /verifiedOperations/u);
  assert.match(reviewPrompt.text, /超出育兒／照護範圍的提問/u);
  assert.match(PRESENTATION_REPAIR_MESSAGE, /clarification/u);

  const messageId = randomUUID();
  const childId = scope.childId;
  const officialChunk = {
    chunkId: "00000000-0000-4000-8000-000000000321",
    versionId: "00000000-0000-4000-8000-000000000322",
    sourceId: "fhs-solid-food",
    title: "嬰幼兒飲食－引進固體食物過渡期",
    classification: "official_guidance" as const,
    text: "嬰兒約六個月大可開始逐一嘗試不同質感食物，並留意過敏反應。",
  };

  // Scenario A: save_ordinary_record followed by record_restatement passes review via verifiedOperations.
  {
    let step = 0, saved: ProductAgentResult | null = null, reviewPayload: { draftHash: string; verifiedOperations?: Array<{ kind: string; tool: string; recordKind?: string; summary?: string }> } | null = null, firstUserText = "";
    const receipt = {
      id: randomUUID(), runId, kind: "save_record" as const,
      resource: { kind: "care_record" as const, id: randomUUID(), version: 1 },
      state: "saved" as const, notification: "not_authorized" as const, channels: [], createdAt: "2026-11-11T08:00:00Z",
    };
    const runtime = createAgentRuntime({
      config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project" }),
      usage: { reserve: async () => true, record: async () => {} },
      provider: {
        async generate(request) {
          step++;
          const userText = request.contents.flatMap(c => c.parts ?? []).map(p => p.text ?? "").join("\n");
          if (step === 1) firstUserText = userText;
          if (userText.includes("chat-delivery-review")) {
            reviewPayload = JSON.parse(userText.slice(userText.indexOf("{")));
            assert.equal(reviewPayload!.verifiedOperations?.length, 1);
            assert.equal(reviewPayload!.verifiedOperations![0].kind, "action_receipt");
            assert.equal(reviewPayload!.verifiedOperations![0].tool, "save_ordinary_record");
            assert.equal(reviewPayload!.verifiedOperations![0].recordKind, "feeding");
            assert.match(reviewPayload!.verifiedOperations![0].summary ?? "", /120ml 配方奶/);
            return { finishReason: FinishReason.STOP, content: { role: "model", parts: [{ text: JSON.stringify({ draftHash: reviewPayload!.draftHash, decision: "pass", issues: [] }) }] } };
          }
          if (step === 1) {
            return { finishReason: FinishReason.STOP, content: { role: "model", parts: [{ functionCall: { id: "c1", name: "load_capabilities", args: { capabilities: ["care_records"] } } }] } };
          }
          if (step === 2) {
            return { finishReason: FinishReason.STOP, content: { role: "model", parts: [{ functionCall: { id: "c2", name: "save_ordinary_record", args: {
              sourceQuote: "今朝 8 點張保仔食咗 120ml 配方奶，加咗 2 茶匙純米糊，食完精神好好，幫我記低佢。",
              expectedPolicyVersion: 1,
              text: "今朝 8 點飲咗 120ml 配方奶，加咗 2 茶匙純米糊，食完精神好好。",
              details: { kind: "feeding", quantity: { rawValue: "120", unit: "ml", precision: "exact" }, eventTime: { rawText: "今朝 8 點", at: "2026-11-11T00:00:00Z", timeZone: "Asia/Hong_Kong", precision: "exact" } },
              quantityEvidence: "120ml",
            } } }] } };
          }
          return { finishReason: FinishReason.STOP, content: { role: "model", parts: [{ functionCall: { id: "c3", name: "present_answer", args: {
            kind: "record_restatement",
            paragraphs: [{ text: "已記低張保仔今朝 8 點飲咗 120ml 配方奶及 2 茶匙純米糊，精神好好。", citationIds: [] }],
          } } }] } };
        },
      },
    });
    const service = createProductAgent({
      runtime,
      store: {
        claim: async () => ({ runId, scope, created: true, sourceMessageId: messageId, state: "running", expiresAt: new Date(Date.now() + 90_000).toISOString() }),
        authorize: async () => true,
        finish: async (_s: unknown, result: ProductAgentResult) => { saved = result; return true; },
        get: async () => saved,
      } as never,
      actions: {
        policy: async () => ({ version: 1, effective: true, recordKinds: ["feeding", "note"], allowPrivateNotes: false, allowSelfTasks: false, allowRecordCorrections: false, reminderConsentVersion: null, reminderBindings: [] }),
        records: async () => ({ records: [], limit: 20, scanned: 0, nextCursor: null }),
        notes: async () => ({ items: [], nextAfterId: null }),
        execute: async () => receipt,
        receipts: async () => [receipt],
      } as never,
      memory: { context: async () => ({ profile: { childId, version: 1, data: null }, profileApplicable: false, facts: [], topics: [], summary: null, recentMessages: [{ id: messageId, childId, role: "user", text: "今朝 8 點張保仔食咗 120ml 配方奶，加咗 2 茶匙純米糊，食完精神好好，幫我記低佢。" }], conflictingKeys: [], unavailableFactKeys: [], truncated: { facts: false, topics: false, messages: false } }) } as never,
      chat: { listForUser: async () => ({ messages: [{ id: messageId, childId, role: "user", text: "今朝 8 點張保仔食咗 120ml 配方奶，加咗 2 茶匙純米糊，食完精神好好，幫我記低佢。" }] }) } as never,
      tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) } as never,
      knowledge: { createRun: () => ({ revalidateCitations: async () => true }) } as never,
    });
    const result = await service.reply(scope.userId, childId, messageId, async () => true);
    assert.match(firstUserText, /load_capabilities/u);
    assert.equal(result?.status, "completed");
    assert.equal(result?.deliveryReview?.decision, "pass");
    assert.match(result!.text, /120ml 配方奶/);
  }

  // Scenario B: directive care advice smuggled even after an action receipt stays blocked as delivery_review_no_sources.
  {
    const receipt = {
      id: randomUUID(), runId, kind: "save_record" as const,
      resource: { kind: "care_record" as const, id: randomUUID(), version: 1 },
      state: "saved" as const, notification: "not_authorized" as const, channels: [], createdAt: "2026-11-11T08:00:00Z",
    };
    let step = 0, saved: ProductAgentResult | null = null;
    const runtime = createAgentRuntime({
      config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project" }),
      usage: { reserve: async () => true, record: async () => {} },
      provider: {
        async generate(request) {
          step++;
          const userText = request.contents.flatMap(c => c.parts ?? []).map(p => p.text ?? "").join("\n");
          if (userText.includes("chat-delivery-review")) {
            const body = JSON.parse(userText.slice(userText.indexOf("{"))) as { draftHash: string };
            return { finishReason: FinishReason.STOP, content: { role: "model", parts: [{ text: JSON.stringify({ draftHash: body.draftHash, decision: "pass", issues: [] }) }] } };
          }
          if (step === 1) return { finishReason: FinishReason.STOP, content: { role: "model", parts: [{ functionCall: { id: "c1", name: "load_capabilities", args: { capabilities: ["care_records"] } } }] } };
          if (step === 2) return { finishReason: FinishReason.STOP, content: { role: "model", parts: [{ functionCall: { id: "c2", name: "save_ordinary_record", args: {
            sourceQuote: "幫我記低食咗 120ml 奶", expectedPolicyVersion: 1, text: "食咗 120ml 奶",
            details: { kind: "feeding", quantity: null, eventTime: { rawText: "今朝", at: null, timeZone: "Asia/Hong_Kong", precision: "unknown" } },
          } } }] } };
          return { finishReason: FinishReason.STOP, content: { role: "model", parts: [{ functionCall: { id: "c3", name: "present_answer", args: {
            kind: "record_restatement",
            paragraphs: [{ text: "已記低；另外 BB 未滿一歲唔好食蜜糖。", citationIds: [] }],
          } } }] } };
        },
      },
    });
    const service = createProductAgent({
      runtime,
      store: {
        claim: async () => ({ runId, scope, created: true, sourceMessageId: messageId, state: "running", expiresAt: new Date(Date.now() + 90_000).toISOString() }),
        authorize: async () => true,
        finish: async (_s: unknown, result: ProductAgentResult) => { saved = result; return true; },
        get: async () => saved,
      } as never,
      actions: {
        policy: async () => ({ version: 1, effective: true, recordKinds: ["feeding"], allowPrivateNotes: false, allowSelfTasks: false, allowRecordCorrections: false, reminderConsentVersion: null, reminderBindings: [] }),
        records: async () => ({ records: [], limit: 20, scanned: 0, nextCursor: null }),
        notes: async () => ({ items: [], nextAfterId: null }),
        execute: async () => receipt,
        receipts: async () => [receipt],
      } as never,
      memory: { context: async () => ({ profile: { childId, version: 1, data: null }, profileApplicable: false, facts: [], topics: [], summary: null, recentMessages: [{ id: messageId, childId, role: "user", text: "幫我記低食咗 120ml 奶" }], conflictingKeys: [], unavailableFactKeys: [], truncated: { facts: false, topics: false, messages: false } }) } as never,
      chat: { listForUser: async () => ({ messages: [{ id: messageId, childId, role: "user", text: "幫我記低食咗 120ml 奶" }] }) } as never,
      tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) } as never,
      knowledge: { createRun: () => ({ revalidateCitations: async () => true }) } as never,
    });
    const result = await service.reply(scope.userId, childId, messageId, async () => true);
    assert.equal(result?.status, "stopped");
    assert.equal(result?.stopReason, "delivery_review_no_sources");
  }

  // Scenario C: mixed pending memory proposal + official guidance passes delivery review with verifiedOperations & official source.
  for (const confirmationState of ["matching", "other_proposal", "other_run", "other_version", "revoked"] as const) {
    const exactBindings: unknown[] = [];
    const factProposalId = randomUUID();
    let step = 0, saved: ProductAgentResult | null = null, seenReview: { draftHash: string; verifiedOperations?: Array<{ kind: string; tool: string }>; sources?: unknown[] } | null = null;
    const runtime = createAgentRuntime({
      config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project" }),
      usage: { reserve: async () => true, record: async () => {} },
      provider: {
        async generate(request) {
          step++;
          const userText = request.contents.flatMap(c => c.parts ?? []).map(p => p.text ?? "").join("\n");
          if (userText.includes("chat-delivery-review")) {
            seenReview = JSON.parse(userText.slice(userText.indexOf("{")));
            assert.equal(seenReview!.verifiedOperations?.length ?? 0, confirmationState === "matching" ? 1 : 0, confirmationState);
            if (confirmationState === "matching") {
              assert.equal(seenReview!.verifiedOperations![0].kind, "pending_confirmation");
              assert.equal(seenReview!.verifiedOperations![0].tool, "propose_fact");
            }
            assert.equal(seenReview!.sources?.length, 1);
            return { finishReason: FinishReason.STOP, content: { role: "model", parts: [{ text: JSON.stringify({ draftHash: seenReview!.draftHash, decision: "pass", issues: [] }) }] } };
          }
          if (step === 1) {
            return { finishReason: FinishReason.STOP, content: { role: "model", parts: [
              { functionCall: { id: "lc", name: "load_capabilities", args: { capabilities: ["memory"] } } },
              { functionCall: { id: "k1", name: "search_knowledge", args: { query: "六個月嬰兒試固體食物", classification: "official_guidance" } } },
            ] } };
          }
          if (step === 2) {
            return { finishReason: FinishReason.STOP, content: { role: "model", parts: [{ functionCall: { id: "p1", name: "propose_fact", args: {
              key: "allergy-food", content: "BB 對雞蛋（包括蛋白）、花生及蝦過敏",
              intendedVisibility: "private", validUntil: null,
            } } }] } };
          }
          return { finishReason: FinishReason.STOP, content: { role: "model", parts: [{ functionCall: { id: "ans", name: "present_answer", args: {
            kind: "mixed",
            paragraphs: [
              { kind: "operation", text: "已為你準備好更新過敏資料的待確認候選，尚未正式保存，請核對及確認。", citationIds: [] },
              { kind: "caregiving", text: "約六個月大的嬰兒可開始逐一嘗試不同食物並留意過敏反應。", citationIds: [officialChunk.chunkId] },
            ],
          } } }] } };
        },
      },
    });
    const service = createProductAgent({
      runtime,
      store: {
        claim: async () => ({ runId, scope, created: true, sourceMessageId: messageId, state: "running", expiresAt: new Date(Date.now() + 90_000).toISOString() }),
        authorize: async () => true,
        propose: async (_s: unknown, _r: string, _c: string, value: unknown) => ({
          id: factProposalId, runId, childId, version: 1, status: "pending", createdAt: "2026-11-11T00:00:00Z", expiresAt: "2099-01-01T00:00:00Z", value, targetLabel: null, result: null,
        }),
        requestConfirmation: async () => ({ id: "conf-1", proposalRunId: runId, proposalId: factProposalId, proposalVersion: 1, expiresAt: "2099-01-01T00:00:00Z", question: "是否確認記錄過敏資料？" }),
        confirmationQuestions: async (_user: string, _child: string, _run: string, binding?: unknown) => {
          const liveBinding = {
            proposalRunId: confirmationState === "other_run" ? "older-run" : runId,
            proposalId: confirmationState === "other_proposal" ? "older-proposal-B" : factProposalId,
            proposalVersion: confirmationState === "other_version" ? 2 : 1,
          };
          if (binding) {
            exactBindings.push(binding);
            assert.deepEqual(binding, { proposalRunId: runId, proposalId: factProposalId, proposalVersion: 1 });
            if (JSON.stringify(binding) !== JSON.stringify(liveBinding)) return [];
          }
          return confirmationState === "revoked" ? [] : ["是否確認記錄過敏資料？"];
        },
        finish: async (_s: unknown, result: ProductAgentResult) => { saved = result; return true; },
        get: async () => saved,
      } as never,
      memory: {
        context: async () => ({ profile: { childId, version: 1, data: null }, profileApplicable: false, facts: [], topics: [], summary: null, recentMessages: [{ id: messageId, childId, role: "user", text: "記住 BB 對雞蛋（包括蛋白）、花生及蝦過敏，順便問六個月點開始加固？" }], conflictingKeys: [], unavailableFactKeys: [], truncated: { facts: false, topics: false, messages: false } }),
      } as never,
      chat: { listForUser: async () => ({ messages: [{ id: messageId, childId, role: "user", text: "記住 BB 對雞蛋（包括蛋白）、花生及蝦過敏，順便問六個月點開始加固？" }] }) } as never,
      tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) } as never,
      knowledge: { createRun: () => ({ search: async () => ({ mode: "vector_keyword", chunks: [officialChunk] }), revalidateCitations: async () => true }) } as never,
    });
    const result = await service.reply(scope.userId, childId, messageId, async () => true);
    assert.ok(exactBindings.length > 0, "Delivery evidence must request an exact run/proposal/version binding");
    assert.equal(result?.status, "completed");
    assert.equal(result?.deliveryReview?.decision, "pass");
    assert.match(result!.text, /待確認候選/);
    assert.match(result!.text, /過敏反應/);
    assert.notEqual(AGENT_CONFIRMATION_PENDING_TEXT, result!.text);
  }

  // Scenario D: pure out-of-scope refusal passes review & source gate; sneaking care advice stays blocked.
  const scopeRefusalDraft = {
    kind: "clarification" as const, visibility: "private" as const, serverSubstitutedSourceText: false,
    paragraphs: [{ text: "我主要協助香港嬰幼兒及兒童日常照護問題，無法回答火星核聚變等宇宙科學問題。", citationIds: [] }],
    sources: [], scope,
  };
  assert.equal(isPureScopeRefusalOrLimitation(scopeRefusalDraft), true);
  const obligation = createChatDeliveryReviewObligation();
  assert.equal(requiresChatDeliveryReview(scopeRefusalDraft, obligation), true);
  assert.equal(obligation.evidenceRequired, false);
  assert.equal(chatDeliveryPassNeedsSources(scopeRefusalDraft, obligation), false);

  const sneakyRefusalDraft = {
    ...scopeRefusalDraft,
    paragraphs: [{ text: "我無法回答火星核聚變，但 BB 未滿一歲唔好食蜜糖。", citationIds: [] }],
  };
  assert.equal(isPureScopeRefusalOrLimitation(sneakyRefusalDraft), false);
  const sneakyObligation = createChatDeliveryReviewObligation();
  assert.equal(requiresChatDeliveryReview(sneakyRefusalDraft, sneakyObligation), true);
  assert.equal(sneakyObligation.evidenceRequired, true);
  assert.equal(chatDeliveryPassNeedsSources(sneakyRefusalDraft, sneakyObligation), true);
  assert.equal(isPureVerifiedOperationSummary({ ...scopeRefusalDraft, verifiedOperations: [{ kind: "action_receipt", id: "r1", tool: "save_ordinary_record", state: "saved" }] }), true);
});
