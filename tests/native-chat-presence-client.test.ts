import test from "node:test";
import assert from "node:assert/strict";
import { createNativePushApi, NativePushApiError, type NativeChatPresence } from "../src/client/native-push-api.ts";
import { NativeChatPresenceController } from "../frontend/src/production/NativeChatPresenceController.ts";

const bindingId = "11111111-1111-4111-8111-111111111111", childId = "22222222-2222-4222-8222-222222222222", messageId = "33333333-3333-4333-8333-333333333333";
const presence: NativeChatPresence = { bindingId, presenceVersion: 1, chatNotificationsEnabled: true };

test("native chat API validates exact notification targets and sends session-bound CAS payloads", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const api = createNativePushApi("https://synthetic.invalid", async (url, init) => {
    calls.push({ url: String(url), init });
    assert.equal(new Headers(init?.headers).get("x-expected-user-id"), "parent");
    return Response.json(String(url).includes("/open?") ? { kind: "chat", childId, messageId } : presence);
  });
  const signal = new AbortController().signal;
  assert.deepEqual(await api.open({ v: 1, kind: "test", bindingId, bindingVersion: 1, deliveryId: messageId }, signal, "parent"), { kind: "chat", childId, messageId });
  assert.deepEqual(await api.chatPresence(signal, "parent"), presence);
  await api.updateChatPresence({ childId, expectedPresenceVersion: 1, chatNotificationsEnabled: false }, signal, "parent");
  assert.equal(calls[2].url, "https://synthetic.invalid/api/native-push/chat-presence");
  assert.deepEqual(JSON.parse(String(calls[2].init?.body)), { childId, expectedPresenceVersion: 1, chatNotificationsEnabled: false });
  const invalid = createNativePushApi("https://synthetic.invalid", async () => Response.json({ kind: "chat", childId, messageId: "invalid" }));
  await assert.rejects(invalid.open({ v: 1, kind: "test", bindingId, bindingVersion: 1, deliveryId: messageId }, signal, "parent"), NativePushApiError);
});

test("heartbeat, preference and blur share one CAS stream and discard superseded foreground requests", async () => {
  let state = { ...presence }, active = 0, maxActive = 0;
  const writes: any[] = [];
  const controller = new NativeChatPresenceController({
    async chatPresence() { return state; },
    async updateChatPresence(input) {
      active++; maxActive = Math.max(maxActive, active); await new Promise(setImmediate);
      assert.equal(input.expectedPresenceVersion, state.presenceVersion); writes.push(input);
      state = { ...state, presenceVersion: state.presenceVersion + 1, chatNotificationsEnabled: input.chatNotificationsEnabled ?? state.chatNotificationsEnabled };
      active--; return state;
    },
  }, "parent", () => true);
  await controller.foreground(childId);
  const preference = controller.setEnabled(false), olderHeartbeat = controller.foreground(childId), blur = controller.foreground(null);
  await Promise.all([preference, olderHeartbeat, blur]);
  assert.equal(maxActive, 1); assert.equal(writes.length, 3);
  assert.equal(writes[1].chatNotificationsEnabled, false); assert.equal(writes.at(-1).childId, null);
  assert.equal(writes.at(-1).expectedPresenceVersion, 3);
  controller.dispose();
});

test("CAS conflict re-reads without replaying preference and a changed session rejects queued writes", async () => {
  let reads = 0, writes = 0, current = true;
  const controller = new NativeChatPresenceController({
    async chatPresence() { reads++; return { ...presence, presenceVersion: reads }; },
    async updateChatPresence() { writes++; throw new NativePushApiError(409); },
  }, "parent", () => current);
  await assert.rejects(controller.setEnabled(false), NativePushApiError);
  assert.equal(reads, 2); assert.equal(writes, 1);
  const queued = controller.foreground(childId); current = false;
  await assert.rejects(queued, NativePushApiError); assert.equal(writes, 1);
  controller.dispose();
});
