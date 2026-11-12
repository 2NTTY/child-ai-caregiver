import test from "node:test";
import assert from "node:assert/strict";
import { createWebPushApi, WebPushApiError } from "../src/client/web-push-api.ts";
import { WebChatPresenceController } from "../frontend/src/production/WebChatPresenceController.ts";
import { parseWebPushOpen } from "../src/client/push-browser.ts";

const bindingId = "11111111-1111-4111-8111-111111111111", childId = "22222222-2222-4222-8222-222222222222", messageId = "33333333-3333-4333-8333-333333333333";
const subscription = { endpoint: "https://web.push.apple.com/synthetic", expirationTime: null, keys: { p256dh: "a".repeat(87), auth: "b".repeat(22) } };
const reference = { v: 1 as const, kind: "care" as const, bindingId, bindingVersion: 2, deliveryId: messageId };

test("web chat calls use cookies, expected account and exact installation CAS including initial zero", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const state = { bindingId, presenceVersion: 0, chatNotificationsEnabled: false, chatPreviewEnabled: false };
  const api = createWebPushApi("https://synthetic.invalid", async (url, init) => {
    calls.push({ url: String(url), init });
    assert.equal(init?.credentials, "include");
    assert.equal(new Headers(init?.headers).get("x-expected-user-id"), "parent");
    return Response.json(String(url).includes("/open") ? { kind: "chat", childId, messageId } : state);
  }, { version: 2 });
  const signal = new AbortController().signal;
  assert.deepEqual(await api.chatPresence(bindingId, signal, "parent"), state);
  await api.updateChatPresence({ bindingId, expectedBindingVersion: 2, expectedPresenceVersion: 0, childId: null, chatNotificationsEnabled: true, chatPreviewEnabled: false, subscription }, signal, "parent");
  assert.deepEqual(await api.open(reference, signal, "parent"), { kind: "chat", childId, messageId });
  await api.open(reference, signal, "parent", subscription);
  assert.equal(calls[0].url, `https://synthetic.invalid/api/web-push/chat-presence?bindingId=${bindingId}`);
  assert.deepEqual(JSON.parse(String(calls[1].init?.body)), { bindingId, expectedBindingVersion: 2, expectedPresenceVersion: 0, childId: null, chatNotificationsEnabled: true, chatPreviewEnabled: false, subscription });
  assert.equal(calls[3].init?.method, "POST"); assert.deepEqual(JSON.parse(String(calls[3].init?.body)), { reference, subscription });
  const wrong = createWebPushApi("/api", async () => Response.json({ ...state, bindingId: childId }));
  await assert.rejects(wrong.chatPresence(bindingId, signal, "parent"), WebPushApiError);
});

test("web installation controller serializes consent and heartbeat without blindly replaying conflicts", async () => {
  let state = { bindingId, presenceVersion: 0, chatNotificationsEnabled: false, chatPreviewEnabled: false };
  const writes: any[] = []; let fail = false;
  const presence = new WebChatPresenceController({
    async chatPresence() { return state; },
    async updateChatPresence(input) {
      writes.push(input); assert.equal(input.expectedPresenceVersion, state.presenceVersion);
      if (fail) throw new WebPushApiError(409);
      state = { ...state, chatNotificationsEnabled: input.chatNotificationsEnabled ?? state.chatNotificationsEnabled,
        chatPreviewEnabled: input.chatPreviewEnabled ?? state.chatPreviewEnabled, presenceVersion: state.presenceVersion + 1 };
      return state;
    },
  }, "parent", () => true);
  presence.bind({ id: bindingId, version: 2 });
  await presence.setEnabled(true, false, subscription);
  await Promise.all([presence.foreground(childId), presence.foreground(null)]);
  assert.equal(writes.length, 2); assert.equal(writes[0].chatPreviewEnabled, false);
  assert.equal(writes[1].childId, null); assert.equal(writes[1].expectedBindingVersion, 2);
  fail = true; await assert.rejects(presence.setPreviewEnabled(true, subscription), WebPushApiError);
  assert.equal(writes.length, 3);
  presence.bind({ id: childId, version: 1 });
  await assert.rejects(presence.setEnabled(true, true, subscription), WebPushApiError);
  assert.equal(writes.length, 3, "An old response cannot authorize a different installation");
  presence.dispose();
});

test("fixed push URL parsing rejects partial, duplicate and arbitrary navigation references", () => {
  const query = `pushBinding=${bindingId}&pushVersion=2&pushDelivery=${messageId}`;
  assert.deepEqual(parseWebPushOpen(`https://synthetic.invalid/?${query}`), reference);
  for (const suffix of [`pushBinding=${bindingId}`, query.replace("pushVersion=2", "pushVersion=0"), `${query}&pushVersion=3`, query.replace(messageId, "invalid")]) {
    assert.equal(parseWebPushOpen(`https://synthetic.invalid/?${suffix}`), null);
  }
});
