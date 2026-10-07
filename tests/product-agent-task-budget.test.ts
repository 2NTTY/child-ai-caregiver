import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { FinishReason } from "@google/genai";
import { createAgentRuntime } from "../server/agent-runtime.ts";
import { createProductAgent } from "../server/product-agent.ts";
import { readAiConfig } from "../server/ai-config.ts";
import type { AgentProposal, ProductAgentResult } from "../src/shared/product-agent.ts";

// Exact last six synthetic UI messages at T7, including the current user message.
const conversation = [
  { role: "model", text: "Agent 未完成文字回覆，但已保存待你核對的候選；尚未確認的事項不代表已執行。請查看來源與待確認事項。" },
  { role: "user", text: "請只處理這個新的純合成任務。替目前的合成驗收小星 A 建立普通待辦「[合成驗收 T5] 準備故事書」，分派給我本人 dot 專用驗收帳戶 20261006，預定完成時間是2026年10月8日香港時間19:30。內容是「純合成驗收：把故事書放進交接袋」。只記在站內待辦；不要任何到期提示、外部通知、電話、訊息或背景跟進。" },
  { role: "model", text: "Agent 暫未能完成回覆；原訊息仍已保存。請查看運行狀態及未完成事項。" },
  { role: "user", text: "請只處理這個新的純合成觀察，不要重做舊請求。幫合成驗收小星 A 記下：2026年10月7日香港時間15:30，他把橙色畫簿放回抽屜。標記「合成驗收 Agent A6」，保存為普通日常觀察。不要建立待辦或發送通知。" },
  { role: "model", text: "已保存小星 A 的日常觀察記錄：他於 2026 年 10 月 7 日 15:30 把橙色畫簿放回抽屜 (標記：合成驗收 Agent A6)。此記錄僅作站內存檔。" },
  { role: "user", text: "請新增這個純合成普通待辦，不要重做舊請求：為合成驗收小星 A 建立「[合成驗收 T7] 整理繪本袋」，分派給我本人 dot 專用驗收帳戶 20261006，預定完成時間2026年10月12日香港時間19:30。內容是「純合成驗收：把繪本放入交接袋」。只在站內記錄，不要發送外部通知。" },
] as const;
// Source-mapped from the observed v1 controls, not a captured private HTTP payload.
// AgentAuthorization maps 日常備註 to note; its reminder checkbox reflects bindings.length > 0.
const observedPolicy = { version: 1, effective: true, recordKinds: ["note"], allowPrivateNotes: false,
  allowSelfTasks: true, allowRecordCorrections: false, reminderConsentVersion: null, reminderBindings: [] };

for (const policy of [observedPolicy, null]) for (const inputLimit of [32000, 64000]) test(`T7 native Runner preserves full text and repairs a rejected task within budget (${policy ? "observed v1 controls" : "no active policy"}; ${inputLimit})`, async context => {
  const userId = "synthetic-user", childId = randomUUID(), runId = randomUUID(), workspaceId = randomUUID();
  const scope = { userId, childId, workspaceId, authorizationVersion: "1", dataVersion: "epoch:1" };
  const messages = conversation.map((message, index) => ({ ...message, id: randomUUID(), childId,
    authorUserId: message.role === "user" ? userId : null, inReplyTo: null, createdAt: `2026-10-07T07:00:0${index}Z` }));
  const messageId = messages.at(-1)!.id;
  const task = { title: "[合成驗收 T7] 整理繪本袋", details: "純合成驗收：把繪本放入交接袋", kind: "ordinary",
    assigneeUserId: userId, dueAt: "2026-10-12T11:30:00Z", timeZone: "Asia/Hong_Kong" };
  let calls = 0, proposalsWritten = 0, saved: ProductAgentResult | null = null;
  const proposals: AgentProposal[] = [], sizes: number[] = [], responseSizes: number[] = [];
  const runtime = createAgentRuntime({ config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project", AI_AGENT_MAX_INPUT_CHARACTERS: String(inputLimit) }),
    usage: { reserve: async () => true, record: async () => {} }, provider: { generate: async request => {
      const size = JSON.stringify({ contents: request.contents, config: request.config }).length;
      sizes.push(size); assert.ok(size < inputLimit, String(size));
      const tools = Object.keys(request.toolsDict);
      for (const required of ["read_context", "propose_task", "propose_task_change", "create_ordinary_reminder", "change_ordinary_reminder", "present_answer"])
        assert.ok(tools.includes(required), required);
      for (const unrelated of ["read_family_documents", "generate_family_document", "change_family_document", "save_ordinary_record", "revise_ordinary_record"])
        assert.ok(!tools.includes(unrelated), unrelated);
      const texts = request.contents.flatMap(content => content.parts ?? []).flatMap(part => typeof part.text === "string" ? [part.text] : []);
      for (const original of conversation) assert.ok(texts.includes(original.text), "The full original user/model text must reach the model unchanged");
      const index = calls++;
      assert.ok(index < 4, "Terminal presentation must not start a fifth model call");
      if (index === 2) {
        const response = request.contents.flatMap(content => content.parts ?? []).find(part => part.functionResponse?.id === "invalid-task")?.functionResponse?.response;
        assert.equal(response?.status, "rejected"); assert.equal((response?.data as any)?.code, "invalid_parameters");
        responseSizes.push(JSON.stringify(response).length); assert.ok(responseSizes[0] < 250, "No verbose validation data is returned");
        assert.equal(proposalsWritten, 0, "Invalid parameters must not execute a proposal write");
      }
      const parts = index === 0 ? [{ functionCall: { id: "context", name: "read_context", args: {} } }]
        : index === 1 ? [{ functionCall: { id: "invalid-task", name: "propose_task", args: { values: { ...task, dueAt: "2026-10-12T19:30" } } } }]
        : index === 2 ? [{ functionCall: { id: "repair-task", name: "propose_task", args: { values: task } } }]
        : [{ functionCall: { id: "answer", name: "present_answer", args: { kind: "operation", paragraphs: [{ text: "已整理待確認候選，尚未建立正式待辦。", citationIds: [] }] } } }];
      return { finishReason: FinishReason.STOP, content: { role: "model", parts } };
    } } });
  const service = createProductAgent({ runtime, store: {
    claim: async () => ({ runId, scope, created: true, expiresAt: new Date(Date.now() + 90000).toISOString() }), authorize: async () => true,
    propose: async (_scope: unknown, _runId: string, callId: string, value: AgentProposal["value"]) => {
      assert.equal(callId, "repair-task"); proposalsWritten++;
      const proposal: AgentProposal = { id: randomUUID(), runId, childId, version: 1, status: "pending", value,
        createdAt: "2026-10-07T07:42:11Z", expiresAt: "2099-10-07T07:42:11Z", result: null, targetLabel: null };
      proposals.push(proposal); return proposal;
    }, finish: async (_scope: unknown, result: ProductAgentResult) => { saved = { ...result, proposals }; return true; }, get: async () => saved,
  }, chat: { listForUser: async () => ({ messages }) }, memory: { context: async () => ({ profile: { childId, version: 0, data: null }, profileApplicable: false,
    facts: [], topics: [], summary: null, recentMessages: messages, conflictingKeys: [], unavailableFactKeys: [], truncated: { facts: false, topics: false, messages: false } }) },
    tasks: { list: async () => ({ items: [], eligibleAssignees: [{ userId, name: "dot 專用驗收帳戶 20261006" }], nextAfterId: null }) },
    knowledge: { createRun: () => ({ revalidateCitations: async () => true }) }, actions: { policy: async () => policy, receipts: async () => [],
      execute: async () => assert.fail("This test only saves an unconfirmed candidate") }, summary: {}, contact: {}, concerns: {}, sources: {}, documents: {}, growth: { list: async () => null },
  } as unknown as Parameters<typeof createProductAgent>[0]);
  const result = await service.reply(userId, childId, messageId, async () => true);
  assert.equal(result?.status, "completed", JSON.stringify(result)); assert.equal(calls, 4); assert.equal(proposalsWritten, 1);
  assert.equal(result.proposals[0].status, "pending"); assert.equal(result.proposals[0].result, null);
  assert.equal(result.tools.find(tool => tool.name === "propose_task")?.status, "rejected");
  context.diagnostic(JSON.stringify({ policy: policy ? "observed_v1_controls_mapped_to_contract" : "none", logicalCharacters: sizes, rejectedResponseCharacters: responseSizes[0], limit: inputLimit }));
});
