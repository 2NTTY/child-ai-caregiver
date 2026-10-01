/* Web Push only. No fetch handler, offline cache, auth tokens or care content. */
const DB = "yuban-web-push-v1";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let work = Promise.resolve();
function serial(event, action) {
  const next = work.then(action);
  work = next.catch(() => {});
  event.waitUntil(next.catch(() => {}));
}
function state(change) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore("state");
    open.onerror = () => reject(new Error("push_state_unavailable"));
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction("state", change ? "readwrite" : "readonly"), table = tx.objectStore("state");
      let result;
      const read = table.get("current");
      read.onsuccess = () => {
        const previous = read.result || { epoch: crypto.randomUUID(), active: null, seen: [] };
        result = change ? change(previous) : previous;
        if (change) table.put(result, "current");
      };
      tx.oncomplete = () => { db.close(); resolve(result); };
      tx.onabort = tx.onerror = () => { db.close(); reject(new Error("push_state_unavailable")); };
    };
  });
}
async function closeNotifications() {
  for (const item of await self.registration.getNotifications()) item.close();
}
self.addEventListener("install", event => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("message", event => {
  const source = event.source, message = event.data, port = event.ports[0];
  if (!source || !source.url || new URL(source.url).origin !== self.location.origin || !port || message?.channel !== "yuban-push-v1") return;
  serial(event, async () => {
    try {
      if (message.type === "suspend") {
        const current = await state(previous => ({ epoch: crypto.randomUUID(), active: null, seen: previous.seen }));
        await closeNotifications();
        for (const client of await self.clients.matchAll({ type: "window", includeUncontrolled: true })) client.postMessage({ channel: "yuban-push-v1", type: "suspended" });
        port.postMessage({ ok: true, epoch: current.epoch });
      } else if (message.type === "activate") {
        const binding = message.binding;
        if (!uuid.test(message.epoch) || !binding || !uuid.test(binding.id) || !Number.isSafeInteger(binding.version)
          || binding.version < 1 || typeof binding.userId !== "string" || binding.userId.length > 128) throw new Error();
        let accepted = false;
        await state(previous => {
          if (previous.epoch !== message.epoch) return previous;
          accepted = true; return { ...previous, active: { id: binding.id, version: binding.version, userId: binding.userId } };
        });
        port.postMessage({ ok: accepted });
      } else { port.postMessage({ ok: false }); }
    } catch { port.postMessage({ ok: false }); }
  });
});
self.addEventListener("push", event => {
  serial(event, async () => {
    if (!event.data || event.data.text().length > 1024) return;
    let payload;
    try { payload = event.data.json(); } catch { return; }
    if (payload?.v !== 1 || !uuid.test(payload.bindingId) || !uuid.test(payload.deliveryId) || !Number.isSafeInteger(payload.bindingVersion)) return;
    if (payload.kind !== undefined && !["test", "care"].includes(payload.kind)) return;
    const current = await state();
    if (!current.active || current.active.id !== payload.bindingId || current.active.version !== payload.bindingVersion
      || current.seen.includes(payload.deliveryId)) return;
    await state(previous => ({ ...previous, seen: [...previous.seen.slice(-19), payload.deliveryId] }));
    const care = payload.kind === "care";
    await self.registration.showNotification(care ? "育有方照護提示" : "育有方通知測試", {
      body: care ? "你有獲授權的照護事項提示，請開啟育有方查看。收到提示不代表事項已完成。" : "這是你剛才要求的測試通知，不代表照護事項已完成。",
      tag: (care ? "yuban-care-" : "yuban-test-") + payload.deliveryId,
      data: { bindingId: payload.bindingId, bindingVersion: payload.bindingVersion },
    });
  });
});
self.addEventListener("pushsubscriptionchange", event => {
  serial(event, async () => { await state(previous => ({ ...previous, epoch: crypto.randomUUID(), active: null })); await closeNotifications(); });
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  serial(event, async () => {
    const current = await state(), data = event.notification.data;
    if (!current.active || data?.bindingId !== current.active.id || data?.bindingVersion !== current.active.version) return;
    // Never accept a destination URL from a notification or bypass the page's normal login.
    const root = new URL("/", self.location.origin).href;
    const existing = (await self.clients.matchAll({ type: "window", includeUncontrolled: true })).find(client => client.url === root);
    if (existing) await existing.focus(); else await self.clients.openWindow(root);
  });
});
