import assert from "node:assert/strict";
import test from "node:test";
import { handleProductAgentRequest } from "../server/product-agent-api.ts";
import { agentStopMessage } from "../src/shared/agent-stop-message.ts";
import { projectAgentRun } from "../frontend/src/production/agent-projection.ts";

test("stopped replies persist a safe reason with saved results and reread without executing again", async () => {
  const child = "669fc3c0-1734-42c9-b541-3b7f55f584e1", id = "7a640e02-926b-4b0a-a812-799776883e02";
  const messages: any[] = []; let calls = 0, writes = 0;
  const options = { isCurrentUser: async () => true,
    agent: { reply: async () => { calls++; return { runId: child, status: "stopped", stopReason: "quota_exceeded",
      text: "準備單已保存；尚未完成後續整理。", proposals: [], tools: [], counts: { modelCalls: 1, toolCalls: 1, queryEmbeddings: 0 } }; } },
    store: { confirmationQuestions: async () => [], bindConfirmationQuestion: async () => {} },
    chat: { listForUser: async () => ({ messages, limit: 100 }),
      createModelMessageForUser: async (_user: string, childId: string, inReplyTo: string, text: string) => {
        writes++; const message = { id: child, childId, inReplyTo, text, role: "model", createdAt: "2026-10-15T00:00:00Z", authorUserId: null }; messages.push(message); return message;
      } },
  } as unknown as Parameters<typeof handleProductAgentRequest>[2];
  const request = () => new Request(`https://synthetic.invalid/api/children/${child}/messages/${id}/reply`,
    { method: "POST", headers: { "content-type": "application/json", "x-expected-user-id": "owner" }, body: "{}" });
  const response = await handleProductAgentRequest(request(), "owner", options);
  assert.equal(response?.status, 200); const first = await response!.json();
  assert.match(first.message.text, /^這次回覆未完成：今日 AI 用量已達上限。/u);
  assert.ok(first.message.text.includes("準備單已保存；尚未完成後續整理。"));
  const reread = await handleProductAgentRequest(request(), "owner", options);
  assert.equal((await reread!.json()).message.text, first.message.text);
  assert.equal(calls, 1); assert.equal(writes, 1);
  assert.equal(agentStopMessage("delivery_review_incomplete"), "尚未通過獨立核對，未成為正式回覆");
  const reviewed = projectAgentRun({ runId: id, status: "stopped", stopReason: "delivery_review_incomplete",
    text: "", provenance: null, tools: [], proposals: [], citations: [], privateSourceCitations: [],
    counts: { modelCalls: 1, toolCalls: 0, queryEmbeddings: 0 }, retrievalMode: "not_used" }, child, null);
  assert.equal(reviewed.stopReasonLabel, agentStopMessage("delivery_review_incomplete"));
  assert.equal(agentStopMessage("toString"), "未能確認停止原因");
});
