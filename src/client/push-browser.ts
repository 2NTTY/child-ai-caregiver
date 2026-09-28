import type { PushBinding, PushBrowserBinding, WebPushStatus, WebPushSubscription } from "../shared/web-push.ts";

const CHANNEL = "yuban-push-v1";
export function pushBrowserSupported(): boolean {
  return typeof window !== "undefined" && window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}
export function pushPermission(): NotificationPermission | "unsupported" {
  return pushBrowserSupported() ? Notification.permission : "unsupported";
}
function failure(): Error { return new Error("push_browser_unavailable"); }
async function registration(create = false): Promise<ServiceWorkerRegistration | null> {
  if (!pushBrowserSupported()) return null;
  const current = create ? await navigator.serviceWorker.register("/push-sw.js", { scope: "/", updateViaCache: "none" })
    : await navigator.serviceWorker.getRegistration("/");
  if (!current) return null;
  if (current.active) return current;
  const worker = current.installing ?? current.waiting;
  if (!worker) throw failure();
  await new Promise<void>((resolve, reject) => {
    const changed = () => { if (worker.state === "activated") finish(); else if (worker.state === "redundant") finish(failure()); };
    const timer = setTimeout(() => finish(failure()), 10000);
    const finish = (error?: Error) => { clearTimeout(timer); worker.removeEventListener("statechange", changed); error ? reject(error) : resolve(); };
    worker.addEventListener("statechange", changed); changed();
  });
  return current;
}
async function message(reg: ServiceWorkerRegistration, body: Record<string, unknown>): Promise<{ ok: boolean; epoch?: string }> {
  if (!reg.active) throw failure();
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => { channel.port1.close(); reject(failure()); }, 5000);
    channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolve(event.data); };
    reg.active!.postMessage({ channel: CHANNEL, ...body }, [channel.port2]);
  });
}
export async function suspendPushBrowser(): Promise<string | null> {
  const reg = await registration();
  if (!reg) return null;
  const result = await message(reg, { type: "suspend" });
  if (!result.ok || !result.epoch) throw failure();
  return result.epoch;
}
async function hash(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))))
    .map(byte => byte.toString(16).padStart(2, "0")).join("");
}
export async function ownedBrowserBinding(status: WebPushStatus): Promise<PushBinding | null> {
  if (pushPermission() !== "granted") return null;
  const reg = await registration();
  const subscription = await reg?.pushManager.getSubscription();
  if (!subscription) return null;
  const endpointHash = await hash(subscription.endpoint);
  return status.bindings.find(binding => binding.status === "active" && binding.endpointHash === endpointHash
    && binding.vapidPublicKey === status.publicKey && (!binding.expiresAt || Date.parse(binding.expiresAt) > Date.now())) ?? null;
}
export async function activatePushBrowser(epoch: string, binding: PushBrowserBinding): Promise<void> {
  const reg = await registration();
  if (!reg || !(await message(reg, { type: "activate", epoch, binding })).ok) throw failure();
}
/** Call immediately from a user gesture, before any asynchronous work. */
export function requestPushPermission(): Promise<NotificationPermission> {
  if (!pushBrowserSupported()) return Promise.reject(failure());
  return Notification.permission === "default" ? Notification.requestPermission() : Promise.resolve(Notification.permission);
}
export async function subscribePushBrowser(publicKey: string, preserveExisting: boolean): Promise<{ subscription: WebPushSubscription; epoch: string }> {
  if (pushPermission() !== "granted") throw failure();
  const reg = await registration(true);
  if (!reg) throw failure();
  const state = await message(reg, { type: "suspend" });
  if (!state.ok || !state.epoch) throw failure();
  let subscription = await reg.pushManager.getSubscription();
  if (subscription && !preserveExisting) {
    if (!await subscription.unsubscribe()) throw failure();
    subscription = null;
  }
  const key = Uint8Array.from(atob(publicKey.replace(/-/g, "+").replace(/_/g, "/")), value => value.charCodeAt(0));
  subscription ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.auth || !json.keys.p256dh) throw failure();
  return { epoch: state.epoch, subscription: { endpoint: json.endpoint, expirationTime: json.expirationTime ?? null,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } } };
}
export async function unsubscribePushBrowser(): Promise<void> {
  await suspendPushBrowser();
  const reg = await registration();
  const subscription = await reg?.pushManager.getSubscription();
  if (subscription && !await subscription.unsubscribe()) throw failure();
}
