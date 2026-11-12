/* Web Push only. No fetch handler, offline cache, auth tokens or persisted message text. */
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
async function closeChatNotifications(binding) {
  for (const item of await self.registration.getNotifications()) {
    const data = item.data;
    if (data?.v === 2 && data.kind === "chat" && data.bindingId === binding.id && data.bindingVersion === binding.version) item.close();
  }
}
const chatModes = { off: 0, generic: 1, preview: 2 };
function sameBinding(left, right) {
  return left && right && left.id === right.id && left.version === right.version && left.userId === right.userId;
}
self.addEventListener("install", event => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("message", event => {
  const source = event.source, message = event.data, port = event.ports[0];
  if (!source || !source.url || new URL(source.url).origin !== self.location.origin || !port || message?.channel !== "yuban-push-v1") return;
  serial(event, async () => {
    try {
      if (message.type === "check-user") {
        if (message.userId !== null && (typeof message.userId !== "string" || !message.userId.length || message.userId.length > 128)) throw new Error();
        let changed = false;
        const current = await state(previous => {
          if (!previous.active || previous.active.userId === message.userId) return previous;
          changed = true; return { ...previous, epoch: crypto.randomUUID(), active: null };
        });
        if (changed) await closeNotifications();
        port.postMessage({ ok: true, epoch: current.epoch });
      } else if (message.type === "chat-preference") {
        const binding = message.binding, mode = message.mode;
        if (!binding || !uuid.test(binding.id) || !Number.isSafeInteger(binding.version) || binding.version < 1
          || typeof binding.userId !== "string" || !binding.userId.length || binding.userId.length > 128
          || !["off", "generic", "preview"].includes(mode)
          || message.restrictOnly !== undefined && typeof message.restrictOnly !== "boolean"
          || message.epoch !== undefined && !uuid.test(message.epoch)) throw new Error();
        let accepted = false, appliedMode;
        const current = await state(previous => {
          if (!sameBinding(previous.active, binding) || message.epoch !== undefined && message.epoch !== previous.epoch) return previous;
          accepted = true;
          const oldMode = previous.active.chatMode;
          // An initial verified read may set a mode; routine reads cannot undo a local restriction.
          appliedMode = message.restrictOnly && oldMode !== undefined && chatModes[mode] > chatModes[oldMode] ? oldMode : mode;
          const tightened = message.restrictOnly && oldMode !== undefined && chatModes[appliedMode] < chatModes[oldMode];
          return { ...previous, epoch: tightened ? crypto.randomUUID() : previous.epoch,
            active: { ...previous.active, chatMode: appliedMode } };
        });
        if (accepted && appliedMode !== "preview") await closeChatNotifications(binding);
        port.postMessage({ ok: accepted, epoch: current.epoch });
      } else if (message.type === "suspend") {
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
          accepted = true; return { ...previous, active: sameBinding(previous.active, binding)
            ? previous.active : { id: binding.id, version: binding.version, userId: binding.userId } };
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
    const chat = payload?.v === 2 && payload.kind === "chat";
    if ((!chat && payload?.v !== 1) || !uuid.test(payload.bindingId) || !uuid.test(payload.deliveryId)
      || !Number.isSafeInteger(payload.bindingVersion) || payload.bindingVersion < 1) return;
    if (!chat && payload.kind !== undefined && !["test", "care"].includes(payload.kind)) return;
    const current = await state();
    if (!current.active || current.active.id !== payload.bindingId || current.active.version !== payload.bindingVersion
      || current.seen.includes(payload.deliveryId)) return;
    const chatMode = current.active.chatMode ?? "off";
    if (chat && chatMode === "off") return;
    const care = payload.kind === "care", content = payload.content;
    // New sends carry their exact generic content. Legacy reference-only payloads keep their old display.
    const genericTitle = chat ? '育有方有新訊息' : care ? '育有方照護提示' : '育有方通知測試';
    const genericBody = chat ? '你有新的聊天訊息，請開啟育有方查看。' : care ? '你有獲授權的照護事項提示，請開啟育有方查看。收到提示不代表事項已完成。' : '這是你剛才要求的測試通知，不代表照護事項已完成。';
    const preview = chat && content?.contentVersion === 'web-push-chat-preview-v1';
    if (content !== undefined && (!content || content.title !== genericTitle || (preview
      ? !validPreview(content.body)
      : content.contentVersion !== (chat ? 'web-push-chat-v1' : 'web-push-generic-v1') || content.body !== genericBody))) return;
    await state(previous => ({ ...previous, seen: [...previous.seen.slice(-99), payload.deliveryId] }));
    await self.registration.showNotification(genericTitle, {
      body: chat && chatMode !== "preview" ? genericBody : content ? content.body : genericBody,
      tag: (chat ? "yuban-chat-" : care ? "yuban-care-" : "yuban-test-") + payload.deliveryId,
      data: { bindingId: payload.bindingId, bindingVersion: payload.bindingVersion,
        ...(chat ? { v: 2, kind: "chat", deliveryId: payload.deliveryId } : {}) },
    });
  });
});
function validPreview(text) {
  if (typeof text !== "string" || !text || text !== text.trim() || /[\p{Cc}\u202a-\u202e\u2066-\u2069\u2028\u2029]/u.test(text)
    || /\s{2}/u.test(text) || new TextEncoder().encode(text).byteLength > 483) return false;
  const segments = Array.from(new Intl.Segmenter("zh-HK", { granularity: "grapheme" }).segment(text));
  return segments.length <= 80 || segments.length === 81 && text.endsWith("…");
}
self.addEventListener("pushsubscriptionchange", event => {
  serial(event, async () => { await state(previous => ({ ...previous, epoch: crypto.randomUUID(), active: null })); await closeNotifications(); });
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  serial(event, async () => {
    const current = await state(), data = event.notification.data;
    if (!current.active || data?.bindingId !== current.active.id || data?.bindingVersion !== current.active.version) return;
    // Never accept a destination URL from a notification or bypass the page's normal login.
    const root = new URL("/", self.location.origin), chat = data.v === 2 && data.kind === "chat";
    if (chat) {
      if (!current.active.chatMode || current.active.chatMode === "off") return;
      if (!uuid.test(data.bindingId) || !uuid.test(data.deliveryId) || !Number.isSafeInteger(data.bindingVersion) || data.bindingVersion < 1) return;
      root.searchParams.set("pushBinding", data.bindingId);
      root.searchParams.set("pushVersion", String(data.bindingVersion));
      root.searchParams.set("pushDelivery", data.deliveryId);
    }
    const existing = (await self.clients.matchAll({ type: "window", includeUncontrolled: true })).find(client => {
      try { const url = new URL(client.url); return chat ? url.origin === root.origin : url.href === root.href; } catch { return false; }
    });
    if (existing) {
      // WebKit gates focus on a short user gesture; navigation may wait on the network.
      await existing.focus();
      if (chat) {
        try {
          const navigated = await existing.navigate(root.href);
          if (navigated === null) { await self.clients.openWindow(root.href); return; }
        } catch { await self.clients.openWindow(root.href); return; }
      }
    } else await self.clients.openWindow(root.href);
  });
});
