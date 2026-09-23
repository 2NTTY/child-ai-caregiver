import assert from "node:assert/strict";
import test from "node:test";
import { handleChatRequest } from "../server/chat-api.ts";
import type { ChatStore } from "../server/chat.ts";
import type { ChatMessage, ChatPage } from "../src/shared/chat.ts";

const childId = "79081f55-9e30-4ee5-91fb-71982b20d6f7";
const otherChildId = "38a8f579-e4d6-4eb4-a645-b8f3851bb0d9";
const text = "  大約 3 點飲咗約 80 ml 奶。\n精神唔錯。🙂  ";
const message: ChatMessage = {
  id: "2e5e3f13-44de-43cd-897a-82f96f29b514",
  childId,
  authorUserId: "owner",
  role: "user",
  text,
  inReplyTo: null,
  createdAt: "2026-09-22T01:02:03.456Z",
};
const page: ChatPage = { messages: [message], limit: 100 };
type ApiStore = Pick<ChatStore, "listForUser" | "createUserMessageForUser">;

function storeWith(overrides: Partial<ApiStore> = {}): ApiStore {
  return {
    listForUser: async (userId, requestedChildId) => userId === "owner" && requestedChildId === childId ? page : null,
    createUserMessageForUser: async () => { throw new Error("Unexpected write"); },
    ...overrides,
  };
}

function unusedStore(): ApiStore {
  return new Proxy({} as ApiStore, { get() { throw new Error("Unexpected storage access"); } });
}

function request(body: unknown, options: { expectedUserId?: string; contentType?: string } = {}): Request {
  const headers: Record<string, string> = { "content-type": options.contentType ?? "application/json; charset=utf-8" };
  if (options.expectedUserId !== "") headers["x-expected-user-id"] = options.expectedUserId ?? "owner";
  return new Request(`http://localhost/api/children/${childId}/messages`, { method: "POST", headers, body: JSON.stringify(body) });
}

test("chat API checks the session and account precondition before storage", async () => {
  const unauthorized = await handleChatRequest(request({ text }), null, unusedStore());
  assert.equal(unauthorized.status, 401);
  assert.equal((await unauthorized.json()).error.code, "unauthorized");
  const missing = await handleChatRequest(request({ text }, { expectedUserId: "" }), "owner", unusedStore());
  assert.equal(missing.status, 428);
  assert.equal((await missing.json()).error.code, "account_precondition_required");
  const changed = await handleChatRequest(request({ text }, { expectedUserId: "other" }), "owner", unusedStore());
  assert.equal(changed.status, 409);
  assert.equal((await changed.json()).error.code, "session_changed");
});

test("chat GET restores only messages available to the session", async () => {
  const owned = await handleChatRequest(new Request(`http://localhost/api/children/${childId}/messages?owner=other`), "owner", storeWith());
  assert.equal(owned.status, 200);
  assert.deepEqual(await owned.json(), page);
  assert.equal(owned.headers.get("cache-control"), "no-store");
  assert.equal(owned.headers.get("x-content-type-options"), "nosniff");
  for (const [userId, requestedChildId] of [["other", childId], ["owner", otherChildId]]) {
    const denied = await handleChatRequest(new Request(`http://localhost/api/children/${requestedChildId}/messages`), userId, storeWith());
    assert.equal(denied.status, 404);
    assert.deepEqual(await denied.json(), { error: { code: "not_found", message: "找不到資料。" } });
  }
  const empty = await handleChatRequest(new Request(`http://localhost/api/children/${childId}/messages`), "owner", storeWith({ listForUser: async () => ({ messages: [], limit: 100 }) }));
  assert.deepEqual(await empty.json(), { messages: [], limit: 100 });
});

test("chat POST checks child access before parsing input", async () => {
  for (const [userId, requestedChildId] of [["other", childId], ["owner", otherChildId]]) {
    const denied = await handleChatRequest(new Request(`http://localhost/api/children/${requestedChildId}/messages`, {
      method: "POST", headers: { "x-expected-user-id": userId }, body: "{",
    }), userId, storeWith());
    assert.equal(denied.status, 404);
    assert.deepEqual(await denied.json(), { error: { code: "not_found", message: "找不到資料。" } });
  }
});

test("chat POST preserves Unicode source text and attributes it to the server session", async () => {
  let writes = 0;
  const response = await handleChatRequest(request({ text }), "owner", storeWith({
    createUserMessageForUser: async (userId, requestedChildId, submittedText) => {
      writes++;
      assert.deepEqual([userId, requestedChildId, submittedText], ["owner", childId, text]);
      return message;
    },
  }));
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { message });
  assert.equal(writes, 1);
  const revoked = await handleChatRequest(request({ text }), "owner", storeWith({ createUserMessageForUser: async () => null }));
  assert.equal(revoked.status, 404);
});

test("chat POST rejects invalid text and all additional fields without writing or echoing text", async () => {
  const secret = "private-value-".repeat(1000);
  const invalid = [null, [], {}, { text: 3 }, { text: "  \n\t " }, { text: secret }, { text: "before\u0000after" },
    { text: "before\ud800after" }, { text: "before\udfffafter" }, { text, role: "model" },
    { text, authorUserId: "other" }, { text, childId: otherChildId }, { text, inReplyTo: message.id }];
  for (const value of invalid) {
    const response = await handleChatRequest(request(value), "owner", storeWith());
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.deepEqual(body, { error: { code: "invalid_input", message: "請檢查輸入資料。" } });
    assert.ok(!JSON.stringify(body).includes(secret));
  }
  const exactLimit = "🙂".repeat(10_000);
  const accepted = await handleChatRequest(request({ text: exactLimit }), "owner", storeWith({
    createUserMessageForUser: async (_userId, _childId, submittedText) => {
      assert.equal(submittedText, exactLimit);
      return message;
    },
  }));
  assert.equal(accepted.status, 201);
  const tooLong = await handleChatRequest(request({ text: `${exactLimit}a` }), "owner", storeWith());
  assert.equal(tooLong.status, 400);
});

test("chat POST rejects malformed JSON and other media types", async () => {
  const malformed = await handleChatRequest(new Request(`http://localhost/api/children/${childId}/messages`, {
    method: "POST", headers: { "content-type": "application/json", "x-expected-user-id": "owner" }, body: "{",
  }), "owner", storeWith());
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error.code, "invalid_json");
  const media = await handleChatRequest(request({ text }, { contentType: "text/plain" }), "owner", storeWith());
  assert.equal(media.status, 415);
  assert.equal((await media.json()).error.code, "unsupported_media_type");
});

test("chat routes reject malformed paths and unsupported methods", async () => {
  for (const path of ["/api/children/not-a-uuid/messages", `/api/children/${childId}/messages/extra`, `/api/children/${childId}/records`]) {
    const response = await handleChatRequest(new Request(`http://localhost${path}`), "owner", unusedStore());
    assert.equal(response.status, 404);
  }
  const unsupported = await handleChatRequest(new Request(`http://localhost/api/children/${childId}/messages`, { method: "DELETE" }), "owner", unusedStore());
  assert.equal(unsupported.status, 405);
  assert.deepEqual(await unsupported.json(), { error: { code: "method_not_allowed", message: "不支援此操作。" } });
});
