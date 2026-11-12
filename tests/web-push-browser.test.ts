import test from "node:test";
import assert from "node:assert/strict";
import { activatePushBrowser, browserPushSubscription, checkPushBrowserUser, pushHomeScreen, pushNeedsHomeScreen, setPushBrowserChatPreference } from "../src/client/push-browser.ts";

test("an existing browser worker updates without permission or suspension and scopes local restrictions to its binding", async t => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window"), originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const messages: any[] = [], updates: string[] = [];
  const subscription = { endpoint: "https://web.push.apple.com/synthetic", expirationTime: null, keys: { p256dh: "a".repeat(87), auth: "b".repeat(22) } };
  const reg = { active: { postMessage(body: unknown, ports: MessagePort[]) { messages.push(body); ports[0]!.postMessage({ ok: true, epoch: "epoch" }); } },
    pushManager: { getSubscription: async () => ({ toJSON: () => subscription }) } };
  const nav = { userAgent: "iPhone", platform: "iPhone", maxTouchPoints: 1, standalone: false,
    serviceWorker: { getRegistration: async () => reg, register: async (url: string) => { updates.push(url); return reg; } } };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { isSecureContext: true, PushManager: {}, Notification: {}, matchMedia: () => ({ matches: false }) } });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: nav });
  t.after(() => { if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow); else Reflect.deleteProperty(globalThis, "window");
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator); else Reflect.deleteProperty(globalThis, "navigator"); });
  assert.equal(pushNeedsHomeScreen(), true); nav.standalone = true; assert.equal(pushHomeScreen(), true); assert.equal(pushNeedsHomeScreen(), false);
  assert.equal(await checkPushBrowserUser("parent"), "epoch");
  assert.deepEqual(updates, ["/push-sw.js"], "An old installed worker receives the current protocol without requesting permission");
  assert.deepEqual(await browserPushSubscription(), subscription);
  const binding = { userId: "parent", id: "11111111-1111-4111-8111-111111111111", version: 2 };
  await activatePushBrowser("epoch", binding);
  assert.equal(await setPushBrowserChatPreference(binding, "generic", true, () => true, "epoch"), "epoch");
  assert.deepEqual(messages.map(value => value.type), ["check-user", "activate", "chat-preference"]);
  assert.equal(messages[2].restrictOnly, true); assert.equal(messages[2].epoch, "epoch"); assert.deepEqual(messages[2].binding, binding);
  await checkPushBrowserUser("stale", () => false); await activatePushBrowser("epoch", binding, () => false);
  await setPushBrowserChatPreference(binding, "preview", false, () => false);
  assert.equal(messages.length, 3, "A stale identity cannot mutate the worker after async registration lookup");
});
