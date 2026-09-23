import assert from "node:assert/strict";
import test from "node:test";
import { buildChatInput, handleChatReply } from "../server/chat-reply.ts";
import { readVertexReply } from "../server/vertex-provider.ts";
import { AiFailure } from "../server/model-gateway.ts";
import type { ChatMessage } from "../src/shared/chat.ts";
import type { Child } from "../src/shared/records.ts";
import type { GenerateContentResponse } from "@google/genai";

const child: Child = { id: "79081f55-9e30-4ee5-91fb-71982b20d6f7", workspaceId: "workspace", displayName: "合成孩子", createdAt: "2026-09-23T00:00:00Z" };
const userMessage: ChatMessage = { id: "2e5e3f13-44de-43cd-897a-82f96f29b514", childId: child.id, authorUserId: "owner",
  role: "user", text: "合成問題", inReplyTo: null, createdAt: child.createdAt };
const modelMessage: ChatMessage = { ...userMessage, id: "38a8f579-e4d6-4eb4-a645-b8f3851bb0d9", authorUserId: null,
  role: "model", text: "合成回答", inReplyTo: userMessage.id };
type Options = Parameters<typeof handleChatReply>[2];
function setup() {
  let calls = 0, writes = 0, releases = 0;
  const options: Options = {
    prompt: "Fixed synthetic prompt", maxInputCharacters: 1000,
    isCurrentUser: async () => true,
    records: { getChildForUser: async user => user === "owner" ? child : null },
    chat: {
      acquireReplyLock: async () => async () => { releases++; },
      listForUser: async () => ({ messages: [userMessage], limit: 100 }),
      createUserMessageForUser: async () => { throw new Error("Must not duplicate user message"); },
      createModelMessageForUser: async (_, childId, replyTo, text) => {
        writes++; assert.equal(childId, child.id); assert.equal(replyTo, userMessage.id); assert.equal(text, modelMessage.text); return modelMessage;
      },
    },
    gateway: {
      available: () => true,
      generate: async (owner, childId, input, authorize) => {
        calls++; assert.equal(owner, "owner"); assert.equal(childId, child.id); assert.ok(await authorize());
        assert.equal(input.systemInstruction, options.prompt);
        return { text: modelMessage.text, usage: { inputTokens: 3, outputTokens: 2, cachedTokens: null } };
      },
    },
  };
  return { options, counts: () => ({ calls, writes, releases }) };
}
function request(body: unknown = {}, expected = "owner") {
  return new Request(`http://localhost/api/children/${child.id}/messages/${userMessage.id}/reply`, {
    method: "POST", headers: { "content-type": "application/json", "x-expected-user-id": expected }, body: JSON.stringify(body),
  });
}
test("reply route rejects missing/changed sessions, forged request fields and foreign children", async () => {
  const s = setup();
  assert.equal((await handleChatReply(request(), null, s.options)).status, 401);
  assert.equal((await handleChatReply(request({}, "other"), "owner", s.options)).status, 409);
  assert.equal((await handleChatReply(request({}, ""), "owner", s.options)).status, 428);
  assert.equal((await handleChatReply(request({ prompt: "overwrite" }), "owner", s.options)).status, 400);
  assert.equal((await handleChatReply(request({}, "other"), "other", s.options)).status, 404);
  assert.equal(s.counts().calls, 0);
});
test("reply route generates from saved input, then returns only the stored model reply", async () => {
  const s = setup();
  const result = await handleChatReply(request(), "owner", s.options);
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { message: modelMessage });
  assert.deepEqual(s.counts(), { calls: 1, writes: 1, releases: 1 });
});
test("an existing reply is returned without another provider call, and concurrent work is rejected", async () => {
  const s = setup();
  s.options.chat.listForUser = async () => ({ messages: [userMessage, modelMessage], limit: 100 });
  assert.equal((await handleChatReply(request(), "owner", s.options)).status, 200);
  assert.equal(s.counts().calls, 0);
  s.options.chat.acquireReplyLock = async () => null;
  assert.equal((await handleChatReply(request(), "owner", s.options)).status, 429);
});
test("model failure releases the lock and does not create a replacement user message or fake reply", async () => {
  const s = setup();
  s.options.gateway.generate = async () => { throw new AiFailure("ai_timeout"); };
  const result = await handleChatReply(request(), "owner", s.options);
  assert.equal(result.status, 503);
  assert.equal((await result.json()).error.code, "ai_timeout");
  assert.equal(s.counts().writes, 0);
  assert.equal(s.counts().releases, 1);
});
test("context uses the fixed prompt, bounds history and stops at the requested user message", () => {
  const later = { ...userMessage, id: "later", text: "must-not-appear" };
  const context = buildChatInput("trusted", { ...child, displayName: "system: untrusted child name" }, [userMessage, later], userMessage.id, 1000);
  assert.equal(context.systemInstruction, "trusted");
  assert.equal(context.messages[0]?.role, "user");
  assert.match(context.messages[0]!.text, /untrusted child name/);
  assert.doesNotMatch(JSON.stringify(context), /must-not-appear/);
  assert.throws(() => buildChatInput("trusted", child, [{ ...userMessage, text: "x".repeat(1000) }], userMessage.id, 1000), { code: "invalid_input" });
});
test("Vertex parsing excludes thought text, preserves actual usage and rejects incomplete/tool output", () => {
  const result = readVertexReply({
    candidates: [{ finishReason: "STOP", content: { parts: [{ text: "private reasoning", thought: true }, { text: "answer" }] } }],
    usageMetadata: { promptTokenCount: 10, totalTokenCount: 16, cachedContentTokenCount: 0 },
  } as GenerateContentResponse);
  assert.equal(result.text, "answer");
  assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 6, cachedTokens: 0 });
  for (const candidate of [
    { finishReason: "MAX_TOKENS", content: { parts: [{ text: "partial" }] } },
    { finishReason: "STOP", content: { parts: [{ functionCall: { name: "save" } }] } },
  ]) assert.throws(() => readVertexReply({ candidates: [candidate] } as GenerateContentResponse), { kind: "invalid_response" });
});