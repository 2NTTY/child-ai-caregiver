import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { randomUUID, webcrypto } from "node:crypto";
import vm from "node:vm";

const source = await readFile(new URL("../public/push-sw.js", import.meta.url), "utf8");
function fixture() {
  const listeners = new Map<string, (event: any) => void>();
  let saved: any;
  const shown: any[] = [], opened: string[] = [];
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
      showNotification: async (title: string, options: any) => { shown.push({ title, options, closed: false, close() { this.closed = true; } }); },
    },
    clients: { claim: async () => {}, matchAll: async () => [], openWindow: async (url: string) => { opened.push(url); } },
  };
  vm.runInNewContext(source, { self, indexedDB, crypto: webcrypto, URL });
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
  return { message, push, event, shown, opened, state: () => saved };
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
