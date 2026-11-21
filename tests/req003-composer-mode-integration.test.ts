import assert from "node:assert/strict";
import test from "node:test";
import { ChatController } from "../src/client/chat-controller.ts";
import { ChatApiError } from "../src/client/chat-api.ts";
import type { ChatMessage } from "../src/shared/chat.ts";

const child = "test-child";
const user = { id: "parent", name: "Parent", email: "parent@example.test" };
const settle = () => new Promise<void>(resolve => setImmediate(resolve));
const userMessage = (id: string, text: string, chatMode?: "chat_only" | "assistant"): ChatMessage =>
  ({ id, childId: child, authorUserId: user.id, role: "user" as const, text, chatMode, inReplyTo: null, createdAt: "2026-11-21T10:00:00.000Z" });
const modelMessage = (id: string) =>
  ({ ...userMessage("reply-"+id, "Reply"), authorUserId: null, role: "model" as const, inReplyTo: id });

test("composer keeps queue mode and page context despite a later switch to assistant", async () => {
  let releaseFirst!: () => void;
  const firstReply = new Promise<void>(resolve => { releaseFirst = resolve; });
  const saved: unknown[] = [];
  const controller = new ChatController({
    getSession: async () => user,
    listMessages: async () => ({ messages: [], limit: 100 }),
    saveMessage: async (_c, text, _s, _u, _v, _f, _p, options) => {
      saved.push(options);
      return userMessage("message-"+saved.length, text, typeof options === "string" ? options : options?.chatMode);
    },
    requestReply: async (_c, messageId) => {
      if (messageId === "message-1") await firstReply;
      return modelMessage(messageId);
    },
    getStatus: async () => true, getUsage: async () => ({ day: "2026-11-21", attempts: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, unknownUsageAttempts: 0 }),
  });
  controller.syncContext(user.id, true, child); await settle();
  controller.setText("first"); const first = controller.send(); await settle();
  controller.setText("queued"); controller.setChatMode("chat_only"); controller.queueNextText({ page: "/care" });
  controller.setChatMode("assistant");
  releaseFirst(); await first; await settle();
  assert.deepEqual(saved[1], { discussion: undefined, pageContext: { page: "/care" }, chatMode: "chat_only" });
  assert.equal(saved.length, 2);
  controller.dispose();
});

test("unknown chat-only save does not adopt an assistant look-alike and retry preserves origin and page", async () => {
  let history: ReturnType<typeof userMessage>[] = [];
  const saved: unknown[] = [];
  let replies = 0;
  const controller = new ChatController({
    getSession: async () => user,
    listMessages: async () => ({ messages: history, limit: 100 }),
    saveMessage: async (_c, text, _s, _u, _v, _f, _p, options) => {
      saved.push(options);
      if (saved.length === 1) throw new ChatApiError(0);
      return userMessage("retried", text, typeof options === "string" ? options : options?.chatMode);
    },
    requestReply: async (_c, messageId) => { replies++; return modelMessage(messageId); },
    getStatus: async () => true, getUsage: async () => ({ day: "2026-11-21", attempts: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, unknownUsageAttempts: 0 }),
  });
  const context = { page: "/care" as const };
  controller.syncContext(user.id, true, child); await settle();
  controller.setChatMode("chat_only"); controller.setText("same");
  await controller.send(undefined, undefined, undefined, { pageContext: context });
  controller.setChatMode("assistant");
  history = [{ ...userMessage("assistant-lookalike", "same"), pageContext: context }];
  await controller.reloadMessages();
  assert.equal(controller.getSnapshot().drafts[child].phase, "checked");
  assert.equal(controller.getSnapshot().drafts[child].candidateMessageId, null);
  assert.equal(replies, 0);
  controller.unlockCheckedSave(); await controller.send();
  assert.deepEqual(saved[1], { discussion: undefined, pageContext: context, chatMode: "chat_only" });
  assert.equal(replies, 1);
  controller.dispose();
});
