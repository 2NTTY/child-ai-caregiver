import assert from "node:assert/strict";
import test from "node:test";
import { selectRecentConversation } from "../server/agent-context-window.ts";

test("selectRecentConversation detects partial turn when earliest message is an orphaned model reply", () => {
  // Turn 0: U0 -> M0
  // Turn 1: U1 -> M1
  // Turn 2: U2 -> M2
  // Turn 3: U3 (current instruction)
  const messages = [
    { id: "u0", role: "user", text: "第一個問題", inReplyTo: null },
    { id: "m0", role: "model", text: "第一個回答", inReplyTo: "u0" },
    { id: "u1", role: "user", text: "第二個問題", inReplyTo: null },
    { id: "m1", role: "model", text: "第二個回答", inReplyTo: "u1" },
    { id: "u2", role: "user", text: "第三個問題", inReplyTo: null },
    { id: "m2", role: "model", text: "第三個回答", inReplyTo: "u2" },
    { id: "u3", role: "user", text: "第四個問題（本次指令）", inReplyTo: null },
  ];

  // Default maxMessages = 6 from index 6 backwards: selects [m0, u1, m1, u2, m2, u3]
  // Note: m0 is selected, but u0 is omitted!
  const result = selectRecentConversation(messages, 6, { maxMessages: 6 });
  assert.equal(result.messages.length, 6);
  assert.equal(result.messages[0].id, "m0");
  assert.equal(result.coverage.partialTurn, true, "Must flag partial turn because u0 is missing");
  assert.equal(result.coverage.omittedTurnPromptMessageId, "u0");
});

test("selectRecentConversation reports complete turns when earliest message in window is a user prompt", () => {
  const messages = [
    { id: "u0", role: "user", text: "第一個問題", inReplyTo: null },
    { id: "m0", role: "model", text: "第一個回答", inReplyTo: "u0" },
    { id: "u1", role: "user", text: "第二個問題", inReplyTo: null },
    { id: "m1", role: "model", text: "第二個回答", inReplyTo: "u1" },
    { id: "u2", role: "user", text: "第三個問題（本次指令）", inReplyTo: null },
  ];

  // maxMessages = 6: all 5 messages selected [u0, m0, u1, m1, u2]
  const result = selectRecentConversation(messages, 4, { maxMessages: 6 });
  assert.equal(result.messages.length, 5);
  assert.equal(result.messages[0].id, "u0");
  assert.equal(result.coverage.partialTurn, false);
  assert.equal(result.coverage.omittedTurnPromptMessageId, null);
});

test("selectRecentConversation handles standalone model reply without inReplyTo gracefully", () => {
  const messages = [
    { id: "m0", role: "model", text: "系統打招呼", inReplyTo: null },
    { id: "u1", role: "user", text: "用戶回覆", inReplyTo: null },
  ];

  const result = selectRecentConversation(messages, 1, { maxMessages: 2 });
  assert.equal(result.messages.length, 2);
  assert.equal(result.coverage.partialTurn, false, "Model message with null inReplyTo is not a partial reply to an omitted prompt");
  assert.equal(result.coverage.omittedTurnPromptMessageId, null);
});

test("selectRecentConversation accurately tracks reply-to topology without assuming rigid even/odd parity", () => {
  // Scenario: user sends two consecutive messages (u0, u1), then model replies to u1 (m1), then user sends u2
  const messages = [
    { id: "u0", role: "user", text: "剛才忘了說", inReplyTo: null },
    { id: "u1", role: "user", text: "加上這個一起問", inReplyTo: null },
    { id: "m1", role: "model", text: "收到這兩點", inReplyTo: "u1" },
    { id: "u2", role: "user", text: "最新問題", inReplyTo: null },
  ];

  const result = selectRecentConversation(messages, 3, { maxMessages: 4 });
  assert.equal(result.messages.length, 4);
  assert.equal(result.coverage.partialTurn, false);
  assert.equal(result.coverage.omittedTurnPromptMessageId, null);
});
