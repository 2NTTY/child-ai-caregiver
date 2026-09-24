import assert from "node:assert/strict";
import test from "node:test";
import { ChatApiError, createChatApi } from "../src/client/chat-api.ts";

const childId = "669fc3c0-1734-42c9-b541-3b7f55f584e1";
const user = { id: "alice", name: "家長", email: "alice@example.test" };
const message = { id: "message-1", childId, authorUserId: user.id, role: "user", text: "原文", inReplyTo: null,
  createdAt: "2026-09-24T00:00:00.000Z" };
const reply = { id: "reply-1", childId, authorUserId: null, role: "model", text: "回覆", inReplyTo: message.id,
  createdAt: "2026-09-24T00:01:00.000Z" };
const context = { workspaceId: "5980663d-3bea-46fa-b63d-42d937026710", storageEpoch: "79081f55-9e30-4ee5-91fb-71982b20d6f7" };
const signal = () => new AbortController().signal;

test("chat saves the user message through online transport and keeps model replies direct", async () => {
  const calls: { path: string; body: unknown }[] = [];
  const api = createChatApi("http://localhost:3001", async () => user, async (input, init) => {
    const path = new URL(String(input)).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) as unknown : null;
    calls.push({ path, body });
    assert.equal(init?.credentials, "include");
    assert.equal(init?.cache, "no-store");
    assert.equal(new Headers(init?.headers).get("x-expected-user-id"), user.id);
    if (path === "/api/online/context") return Response.json(context);
    if (path === "/api/online/submit") {
      const submission = body as { path: string; payload: unknown; operation: unknown };
      assert.equal(submission.path, `/api/children/${childId}/messages`);
      assert.deepEqual(submission.payload, { text: message.text });
      return Response.json({ state: "confirmed", operation: submission.operation, changeSeq: "1", statusCode: 201,
        result: { message } });
    }
    if (path === `/api/children/${childId}/messages/${message.id}/reply`) return Response.json({ message: reply });
    throw new Error(`Unexpected route ${path}`);
  });
  assert.deepEqual(await api.saveMessage(childId, message.text, signal(), user.id), message);
  assert.deepEqual(await api.requestReply(childId, message.id, signal(), user.id), reply);
  assert.deepEqual(calls.map(call => call.path), ["/api/online/context", "/api/online/submit",
    `/api/children/${childId}/messages/${message.id}/reply`]);
  assert.deepEqual(calls[0].body, { path: `/api/children/${childId}/messages`, payload: { text: message.text } });
});

test("chat checks the confirmed message domain result and preserves online errors separately from AI codes", async () => {
  const invalid = createChatApi("/api", async () => user, async (input, init) => {
    if (String(input).endsWith("/online/context")) return Response.json(context);
    const operation = JSON.parse(String(init?.body)).operation;
    return Response.json({ state: "confirmed", operation, changeSeq: "1", statusCode: 201,
      result: { message: { ...message, authorUserId: "bob" } } });
  });
  await assert.rejects(invalid.saveMessage(childId, message.text, signal(), user.id), ChatApiError);

  const conflict = createChatApi("/api", async () => user, async (input) => {
    if (String(input).endsWith("/online/context")) return Response.json(context);
    return Response.json({ error: { code: "storage_epoch_changed", message: "private" } }, { status: 409 });
  });
  await assert.rejects(conflict.saveMessage(childId, message.text, signal(), user.id), error =>
    error instanceof ChatApiError && error.status === 409 && error.code === null
      && error.onlineCode === "storage_epoch_changed" && !error.confirmed && !error.message.includes("private"));
  assert.equal(conflict.hasPendingOnline?.(), true);

  const aiFailure = createChatApi("/api", async () => user, async () =>
    Response.json({ error: { code: "ai_unavailable", message: "private" } }, { status: 503 }));
  await assert.rejects(aiFailure.requestReply(childId, message.id, signal(), user.id), error =>
    error instanceof ChatApiError && error.code === "ai_unavailable" && error.onlineCode === null);
});
