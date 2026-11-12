import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { ChatApiError } from "../src/client/chat-api.ts";
import { ChatController, CHAT_REPLY_ERROR_COPY } from "../src/client/chat-controller.ts";
import { projectAgentRun } from "../frontend/src/production/agent-projection.ts";
import { agentStopDetailHint, agentStopMessage } from "../src/shared/agent-stop-message.ts";

test("capacity busy stop reason maps cleanly in stop copy, run projection, and chat controller", async () => {
  assert.notEqual(agentStopMessage("busy"), "未能確認停止原因");
  assert.match(agentStopMessage("busy") ?? "", /忙碌/u);
  assert.match(agentStopDetailHint("busy") ?? "", /新訊息/u);

  const runId = randomUUID();
  const childId = randomUUID();
  const msgId = randomUUID();
  const projected = projectAgentRun({
    runId, status: "stopped", stopReason: "busy", text: "", provenance: null,
    tools: [], proposals: [], citations: [], privateSourceCitations: [],
    counts: { modelCalls: 0, toolCalls: 0, queryEmbeddings: 0 }, retrievalMode: "not_used",
  }, childId, null);
  assert.equal(projected.stopReasonLabel, agentStopMessage("busy"));
  assert.equal(projected.stopReasonDetail, agentStopDetailHint("busy"));

  const messages: Array<{ id: string; childId: string; role: "user" | "model"; text: string; createdAt: string; authorUserId: string | null; inReplyTo?: string | null; agentRunId?: string }> = [];
  let originalReply: { messageId: string; runId: string; status: "stopped"; stopReason: "busy" } | null = null;
  const controller = new ChatController({
    getSession: async () => ({ id: "parent-1", email: "parent@example.test", name: "Parent" }),
    listMessages: async cid => ({ messages: messages.filter(item => item.childId === cid) as never, limit: 100 }),
    saveMessage: async (cid, text) => {
      const saved = { id: msgId, childId: cid, role: "user" as const, text, createdAt: "2026-11-11T13:36:12.000Z", authorUserId: "parent-1" };
      messages.push(saved);
      return saved as never;
    },
    requestReply: async (_cid, mId, _sig, _uid, onProgress) => {
      onProgress?.({ runId, messageId: mId, phase: "started" });
      originalReply = { messageId: mId, runId, status: "stopped", stopReason: "busy" };
      throw new ChatApiError(429, "ai_capacity_busy");
    },
    getOriginalReply: async () => originalReply,
    getStatus: async () => true,
    getUsage: async () => ({ day: "2026-11-11", attempts: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, unknownUsageAttempts: 0 }),
  });

  controller.syncContext("parent-1", true, childId);
  await new Promise(r => setTimeout(r, 20));
  controller.setText("頭先下晝 3 點同孩子探熱，體溫 36.8 度。");
  await controller.send();

  const afterSend = controller.getSnapshot();
  assert.equal(afterSend.drafts[childId]?.phase, "draft");
  assert.equal(afterSend.drafts[childId]?.text, "頭先下晝 3 點同孩子探熱，體溫 36.8 度。");
  assert.equal(afterSend.replyError, CHAT_REPLY_ERROR_COPY.ai_capacity_busy);
  assert.equal(afterSend.remoteReply?.messageId, msgId);
  assert.equal(afterSend.remoteReply?.status, "stopped");
  assert.equal(afterSend.remoteReply?.stopReason, "busy");
  assert.equal(afterSend.messages.find(m => m.id === msgId)?.agentRunId, runId);

  // Reading original busy reply retains canonical copy instead of falling back to "未能確認停止原因".
  await controller.requestReply(msgId);
  const afterReload = controller.getSnapshot();
  assert.equal(afterReload.replyError, CHAT_REPLY_ERROR_COPY.ai_capacity_busy);
  assert.notEqual(afterReload.replyError, "未能確認停止原因");
  assert.equal(afterReload.remoteReply?.stopReason, "busy");
  controller.dispose();
});
