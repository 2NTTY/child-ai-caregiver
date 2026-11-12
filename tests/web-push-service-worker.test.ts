import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { randomUUID, webcrypto } from "node:crypto";
import vm from "node:vm";

const source = await readFile(new URL("../public/push-sw.js", import.meta.url), "utf8");
function fixture(initialState?: unknown) {
  const listeners = new Map<string, (event: any) => void>();
  let saved: any = structuredClone(initialState);
  const shown: any[] = [], opened: string[] = [], clients: any[] = [];
  const indexedDB = { open() {
    const request: any = {};
    queueMicrotask(() => {
      request.result = { close() {}, transaction() {
        const tx: any = {};
        tx.objectStore = () => ({
          get() {
            const read: any = {};
            queueMicrotask(() => { read.result = structuredClone(saved); read.onsuccess();
              queueMicrotask(() => tx.oncomplete()); });
            return read;
          },
          put(value: unknown) { saved = structuredClone(value); },
        });
        return tx;
      } };
      request.onsuccess();
    });
    return request;
  } };
  const self = {
    location: { origin: "https://yuban.example" },
    addEventListener: (name: string, callback: (event: any) => void) => listeners.set(name, callback),
    skipWaiting: async () => {},
    registration: {
      getNotifications: async () => shown.filter(item => !item.closed),
      showNotification: async (title: string, options: any) => { shown.push({ title, data: options.data, options, closed: false, close() { this.closed = true; } }); },
    },
    clients: { claim: async () => {}, matchAll: async () => clients, openWindow: async (url: string) => { opened.push(url); } },
  };
  vm.runInNewContext(source, { self, indexedDB, crypto: webcrypto, URL, Intl, TextEncoder });
  const event = async (name: string, body: any) => {
    let pending: Promise<unknown> = Promise.resolve();
    listeners.get(name)!({ ...body, waitUntil(value: Promise<unknown>) { pending = value; } });
    await pending;
  };
  const message = async (body: any) => {
    let reply: any;
    await event("message", { source: { url: "https://yuban.example/" }, data: { channel: "yuban-push-v1", ...body },
      ports: [{ postMessage(value: unknown) { reply = value; } }] });
    return reply;
  };
  const push = (payload: unknown) => event("push", { data: { text: () => JSON.stringify(payload), json: () => payload } });
  return { message, push, event, shown, opened, clients, state: () => saved };
}
test("push worker fences stale activation and closes notifications on logout", async () => {
  const f = fixture(), first = await f.message({ type: "suspend" }), binding = { id: randomUUID(), userId: "account-a", version: 1 };
  assert.equal((await f.message({ type: "activate", epoch: first.epoch, binding })).ok, true);
  const payload = { v: 1, bindingId: binding.id, bindingVersion: 1, deliveryId: randomUUID() };
  await f.push(payload);
  assert.equal(f.shown.length, 1);
  await f.message({ type: "suspend" });
  assert.equal(f.shown[0].closed, true);
  assert.equal((await f.message({ type: "activate", epoch: first.epoch, binding })).ok, false);
  await f.push({ ...payload, deliveryId: randomUUID() });
  assert.equal(f.shown.length, 1);
});

test("chat push deduplicates and opens only a fixed same-origin delivery reference", async () => {
  const f = fixture(), epoch = (await f.message({ type: "suspend" })).epoch;
  const binding = { id: randomUUID(), userId: "account", version: 2 };
  await f.message({ type: "activate", epoch, binding });
  await f.message({ type: "chat-preference", binding, mode: "preview" });
  const payload = { v: 2, kind: "chat", bindingId: binding.id, bindingVersion: 2, deliveryId: randomUUID(),
    url: "https://attacker.example/private", content: { contentVersion: "web-push-chat-preview-v1", title: "育有方有新訊息", body: "PRIVATE preview" } };
  await f.push(payload); await f.push(payload);
  assert.equal(f.shown.length, 1); assert.equal(f.shown[0].options.body, "PRIVATE preview");
  assert.equal(JSON.stringify(f.state()).includes("PRIVATE"), false);
  const target = `https://yuban.example/?pushBinding=${binding.id}&pushVersion=2&pushDelivery=${payload.deliveryId}`;
  const click = () => f.event("notificationclick", { notification: { data: f.shown[0].options.data, close() {} } });
  await click(); assert.deepEqual(f.opened, [target]);
  const navigated: string[] = []; let focused = 0;
  f.clients.push({ url: "https://attacker.example/", navigate() { throw Error("foreign client"); }, postMessage() {} },
    { url: "https://yuban.example/children/old", navigate: async (url: string) => { navigated.push(url); }, focus: async () => { focused++; }, postMessage() {} });
  await click(); assert.deepEqual(navigated, [target]); assert.equal(focused, 1); assert.equal(f.opened.length, 1);
  await f.push({ ...payload, deliveryId: randomUUID(), content: { ...payload.content, body: "line\nbreak" } });
  await f.push({ ...payload, deliveryId: randomUUID(), content: { ...payload.content, body: "家".repeat(200) } });
  assert.equal(f.shown.length, 1);
  await f.message({ type: "suspend" }); await click(); assert.equal(f.opened.length, 1);
});

test("cold start identity checks preserve the same account and suspend a different account", async () => {
  const f = fixture(), epoch = (await f.message({ type: "suspend" })).epoch;
  const binding = { id: randomUUID(), userId: "account", version: 1 };
  await f.message({ type: "activate", epoch, binding });
  await f.push({ v: 1, bindingId: binding.id, bindingVersion: 1, deliveryId: randomUUID() });
  assert.equal((await f.message({ type: "check-user", userId: "account" })).ok, true);
  assert.equal((await f.message({ type: "check-user", userId: "account" })).epoch, epoch);
  assert.equal(f.state().epoch, epoch); assert.equal(f.shown[0].closed, false);
  assert.equal((await f.message({ type: "check-user", userId: "different" })).ok, true);
  assert.equal(f.state().active, null); assert.notEqual(f.state().epoch, epoch); assert.equal(f.shown[0].closed, true);
  assert.equal((await f.message({ type: "activate", epoch, binding })).ok, false);
});

test("chat clicks focus a background client before navigation can outlive WebKit user activation", async () => {
  const f = fixture(), epoch = (await f.message({ type: "suspend" })).epoch;
  const binding = { id: randomUUID(), userId: "account", version: 1 };
  await f.message({ type: "activate", epoch, binding });
  await f.message({ type: "chat-preference", binding, mode: "generic" });
  await f.push({ v: 2, kind: "chat", bindingId: binding.id, bindingVersion: 1, deliveryId: randomUUID() });
  const calls: string[] = []; let activation = true;
  f.clients.push({ url: "https://yuban.example/", focused: false, postMessage() {},
    async focus() { if (!activation) throw Error("InvalidAccessError: user gesture expired"); calls.push("focus"); },
    async navigate(url: string) { activation = false; calls.push("navigate"); assert.match(url, /\?pushBinding=/u); } });
  await f.event("notificationclick", { notification: { data: f.shown[0].options.data, close() {} } });
  assert.deepEqual(calls, ["focus", "navigate"]);
  assert.equal(f.opened.length, 0);
});

test("chat preferences fence delayed previews, downgrade visible cards and preserve legacy notifications", async () => {
  const f = fixture(), epoch = (await f.message({ type: "suspend" })).epoch;
  const binding = { id: randomUUID(), userId: "account", version: 1 };
  await f.message({ type: "activate", epoch, binding });
  const chat = { v: 2, kind: "chat", bindingId: binding.id, bindingVersion: 1, deliveryId: randomUUID(),
    content: { contentVersion: "web-push-chat-preview-v1", title: "育有方有新訊息", body: "PRIVATE preview" } };
  await f.push(chat); assert.equal(f.shown.length, 0);
  assert.equal((await f.message({ type: "chat-preference", binding, epoch, mode: "preview" })).ok, true);
  await f.push(chat); assert.equal(f.shown[0].options.body, "PRIVATE preview");
  await f.push({ v: 1, kind: "care", bindingId: binding.id, bindingVersion: 1, deliveryId: randomUUID() });
  assert.equal((await f.message({ type: "chat-preference", binding: { ...binding, userId: "foreign" }, mode: "off" })).ok, false);
  assert.equal((await f.message({ type: "chat-preference", binding, epoch: randomUUID(), mode: "off" })).ok, false);
  assert.equal((await f.message({ type: "chat-preference", binding, mode: "generic" })).ok, true);
  assert.equal(f.shown[0].closed, true); assert.equal(f.shown[1].closed, false);
  await f.push({ ...chat, deliveryId: randomUUID() });
  assert.equal(f.shown[2].options.body, "你有新的聊天訊息，請開啟育有方查看。");
  assert.equal((await f.message({ type: "chat-preference", binding, mode: "preview", restrictOnly: true })).ok, true);
  await f.push({ ...chat, deliveryId: randomUUID() });
  assert.equal(f.shown[3].options.body, "你有新的聊天訊息，請開啟育有方查看。");
  assert.equal((await f.message({ type: "chat-preference", binding, mode: "off" })).ok, true);
  assert.equal((await f.message({ type: "activate", epoch, binding })).ok, true);
  assert.equal(f.state().active.chatMode, "off");
  assert.equal(f.shown[2].closed, true); assert.equal(f.shown[3].closed, true); assert.equal(f.shown[1].closed, false);
  await f.push({ ...chat, deliveryId: randomUUID() }); assert.equal(f.shown.length, 4);
  await f.event("notificationclick", { notification: { data: f.shown[0].options.data, close() {} } });
  assert.equal(f.opened.length, 0);
  const restarted = fixture(f.state());
  await restarted.push({ ...chat, deliveryId: randomUUID() }); assert.equal(restarted.shown.length, 0);
  await restarted.message({ type: "chat-preference", binding, mode: "preview", restrictOnly: true });
  await restarted.push({ ...chat, deliveryId: randomUUID() }); assert.equal(restarted.shown.length, 0);
});

test("a restarted worker uses persisted binding preferences without a live PWA or install event", async () => {
  const f = fixture(), epoch = (await f.message({ type: "suspend" })).epoch;
  const binding = { id: randomUUID(), userId: "account", version: 3 };
  await f.message({ type: "activate", epoch, binding });
  // A verified first read may initialize preferences; later routine reads cannot widen them.
  await f.message({ type: "chat-preference", binding, epoch, mode: "generic", restrictOnly: true });
  const restarted = fixture(f.state()), payload = { v: 2, kind: "chat", bindingId: binding.id, bindingVersion: 3, deliveryId: randomUUID() };
  await restarted.push(payload); assert.equal(restarted.shown.length, 1);
  await restarted.event("notificationclick", { notification: { data: restarted.shown[0].options.data, close() {} } });
  assert.equal(restarted.opened[0], `https://yuban.example/?pushBinding=${binding.id}&pushVersion=3&pushDelivery=${payload.deliveryId}`);
  const nextEpoch = (await restarted.message({ type: "suspend" })).epoch;
  await restarted.message({ type: "activate", epoch: nextEpoch, binding });
  assert.equal((await restarted.message({ type: "chat-preference", binding, epoch, mode: "preview" })).ok, false);
  await restarted.push({ ...payload, deliveryId: randomUUID() }); assert.equal(restarted.shown.length, 1);
});

test("a restrictive preference rotates its epoch and rejects another tab's late loosening response", async () => {
  const f = fixture(), epoch = (await f.message({ type: "suspend" })).epoch;
  const binding = { id: randomUUID(), userId: "account", version: 1 };
  await f.message({ type: "activate", epoch, binding });
  const initial = await f.message({ type: "chat-preference", binding, mode: "preview", restrictOnly: true });
  assert.equal(initial.epoch, epoch);
  const restricted = await f.message({ type: "chat-preference", binding, epoch, mode: "off", restrictOnly: true });
  assert.equal(restricted.ok, true); assert.notEqual(restricted.epoch, epoch);
  assert.equal(f.state().active.id, binding.id); assert.equal(f.state().active.chatMode, "off");
  const late = await f.message({ type: "chat-preference", binding, epoch, mode: "preview" });
  assert.equal(late.ok, false); assert.equal(late.epoch, restricted.epoch);
  assert.equal(f.state().active.chatMode, "off");
  const repeated = await f.message({ type: "chat-preference", binding, epoch: restricted.epoch, mode: "off", restrictOnly: true });
  assert.equal(repeated.ok, true); assert.equal(repeated.epoch, restricted.epoch);
});
test("push worker ignores foreign/version-mismatched/duplicate payloads and uses only fixed text", async () => {
  const f = fixture(), epoch = (await f.message({ type: "suspend" })).epoch;
  const binding = { id: randomUUID(), userId: "account-b", version: 2 };
  await f.message({ type: "activate", epoch, binding });
  const payload = { v: 1, bindingId: binding.id, bindingVersion: 2, deliveryId: randomUUID(), body: "PRIVATE", url: "https://attacker.example" };
  await f.push({ ...payload, bindingId: randomUUID() }); await f.push({ ...payload, bindingVersion: 1 }); await f.push(payload); await f.push(payload);
  assert.equal(f.shown.length, 1);
  assert.equal(JSON.stringify(f.shown).includes("PRIVATE"), false);
  await f.event("notificationclick", { notification: { data: f.shown[0].options.data, close() {} } });
  assert.deepEqual(f.opened, ["https://yuban.example/"]);
  await f.message({ type: "suspend" });
  await f.event("notificationclick", { notification: { data: f.shown[0].options.data, close() {} } });
  assert.equal(f.opened.length, 1);
});
test("subscription changes suspend rather than silently rebind an account", async () => {
  const f = fixture(), epoch = (await f.message({ type: "suspend" })).epoch;
  await f.message({ type: "activate", epoch, binding: { id: randomUUID(), userId: "account", version: 1 } });
  await f.event("pushsubscriptionchange", {});
  assert.equal(f.state().active, null);
  assert.notEqual(f.state().epoch, epoch);
});

test('push worker renders captured content while legacy references still use their original display', async () => {
  const f = fixture(), epoch = (await f.message({ type: 'suspend' })).epoch;
  const binding = { id: randomUUID(), userId: 'account', version: 1 };
  await f.message({ type: 'activate', epoch, binding });
  const content = { contentVersion: 'web-push-generic-v1', title: '育有方照護提示', body: '你有獲授權的照護事項提示，請開啟育有方查看。收到提示不代表事項已完成。' };
  await f.push({ v: 1, kind: 'care', bindingId: binding.id, bindingVersion: 1, deliveryId: randomUUID(), content });
  assert.equal(f.shown[0].title, content.title); assert.equal(f.shown[0].options.body, content.body);
  await f.push({ v: 1, bindingId: binding.id, bindingVersion: 1, deliveryId: randomUUID(), content: { ...content, contentVersion: 'unknown' } });
  assert.equal(f.shown.length, 1);
});
