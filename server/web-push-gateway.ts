import { createECDH, ECDH } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import { readFile, stat } from "node:fs/promises";
import webPush from "web-push";
import { z } from "zod";
import { webPushContent, pushSubscriptionInput, type PushPayload, type WebPushSubscription } from "../src/shared/web-push.ts";
import type { PushSendResult, VapidConfig, WebPushGateway } from "./web-push-types.ts";

const hosts = new Map([["fcm.googleapis.com", "fcm"], ["updates.push.services.mozilla.com", "mozilla"]] as const);
const invalid = () => new Error("web_push_input_invalid");
export function pushProvider(endpoint: string): "fcm" | "mozilla" {
  if (!endpoint || endpoint.length > 2048 || /[\s\\\u0000-\u001f\u007f-\uffff]/u.test(endpoint)) throw invalid();
  const url = new URL(endpoint);
  const provider = hosts.get(url.hostname as "fcm.googleapis.com");
  if (!provider || url.protocol !== "https:" || url.port || url.username || url.password || url.hash
    || url.pathname === "/" || url.href !== endpoint) throw invalid();
  return provider;
}
function bytes(value: string, length: number) {
  const result = Buffer.from(value, "base64url");
  if (result.length !== length || result.toString("base64url") !== value) throw invalid();
  return result;
}
export function checkedSubscription(input: unknown): WebPushSubscription {
  const subscription = pushSubscriptionInput.parse(input);
  pushProvider(subscription.endpoint);
  const publicKey = bytes(subscription.keys.p256dh, 65);
  if (publicKey[0] !== 4) throw invalid();
  ECDH.convertKey(publicKey, "prime256v1");
  bytes(subscription.keys.auth, 16);
  if (subscription.expirationTime !== null && (subscription.expirationTime <= Date.now()
    || subscription.expirationTime > 8640000000000000)) throw invalid();
  return subscription;
}
export function checkedVapid(input: unknown): VapidConfig {
  const value = z.object({ publicKey: z.string(), privateKey: z.string(), subject: z.string().max(254) }).strict().parse(input);
  const key = createECDH("prime256v1"); key.setPrivateKey(bytes(value.privateKey, 32));
  if (!key.getPublicKey().equals(bytes(value.publicKey, 65))) throw invalid();
  const subject = new URL(value.subject);
  if (!["https:", "mailto:"].includes(subject.protocol) || /[\s\u0000-\u001f\u007f]/u.test(value.subject)
    || subject.username || subject.password || subject.hash
    || (subject.protocol === "https:" ? !subject.hostname : !/^[^@/?#]+@[^@/?#]+$/u.test(subject.pathname))) throw invalid();
  return value;
}
export async function readWebPushConfig(env: Record<string, string | undefined>): Promise<VapidConfig | null> {
  if (env.WEB_PUSH_ENABLED === undefined || env.WEB_PUSH_ENABLED === "false") return null;
  if (env.WEB_PUSH_ENABLED !== "true") throw new Error("web_push_config_invalid");
  try {
    const path = env.WEB_PUSH_VAPID_FILE;
    if (!path) throw invalid();
    const info = await stat(path);
    if (!info.isFile() || info.size > 2048 || (process.platform !== "win32" && (info.mode & 0o077))) throw invalid();
    return checkedVapid(JSON.parse(await readFile(path, "utf8")));
  } catch { throw new Error("web_push_config_invalid"); }
}
/** IPv4-only initial adapter; pin the validated address while retaining TLS hostname verification. */
export function isPublicPushAddress(value: string): boolean {
  if (isIP(value) !== 4) return false;
  const [a, b, c] = value.split(".").map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254
    || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 || b === 2)
    || a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100)
    || a === 203 && b === 0 && c === 113);
}
export function providerResult(status: number): PushSendResult {
  if (status === 201) return { status: "accepted", reason: null, providerStatus: status };
  if (status === 404 || status === 410) return { status: "rejected", reason: "subscription_expired", providerStatus: status };
  // A response from the provider is known; no automatic retry, even for rate limits.
  return { status: "rejected", reason: status === 429 ? "rate_limited" : "provider_rejected", providerStatus: status };
}
const stopped = (reason: PushSendResult["reason"]): PushSendResult => ({ status: "stopped", reason, providerStatus: null });
const unknown = (): PushSendResult => ({ status: "unknown", reason: "transport_unknown", providerStatus: null });
export function createWebPushGateway(config: VapidConfig | null): WebPushGateway {
  if (config) checkedVapid(config);
  return {
    publicKey: config?.publicKey ?? null,
    async send(input, payload: PushPayload, outerSignal, stillAuthorized) {
      if (!config) return stopped("configuration_unavailable");
      const controller = new AbortController(), signal = controller.signal;
      const abort = () => controller.abort();
      outerSignal.addEventListener("abort", abort, { once: true });
      if (outerSignal.aborted) abort();
      const deadline = setTimeout(abort, 15000).unref();
      try {
        let subscription: WebPushSubscription;
        try { subscription = checkedSubscription(input); } catch { return stopped("request_invalid"); }
        if (signal.aborted) return stopped("worker_interrupted");
        const url = new URL(subscription.endpoint);
        // Bound the DNS/auth wait as well as socket activity. No second request or redirect.
        const bounded = async <T>(promise: Promise<T>): Promise<T> => {
          if (signal.aborted) throw invalid();
          let onAbort: () => void = () => {};
          try { return await Promise.race([promise, new Promise<never>((_, reject) => {
            onAbort = () => reject(invalid()); signal.addEventListener("abort", onAbort, { once: true });
          })]); } finally { signal.removeEventListener("abort", onAbort); }
        };
        let address: string;
        try {
          const addresses = await bounded(lookup(url.hostname, { family: 4, all: true }));
          if (!addresses.length || addresses.some(entry => !isPublicPushAddress(entry.address))) return stopped("request_invalid");
          address = addresses[0].address;
          if (!await bounded(stillAuthorized())) return stopped("revoked");
        } catch { return stopped(signal.aborted ? "worker_interrupted" : "request_invalid"); }
        if (signal.aborted) return stopped("worker_interrupted");
        const content = { ...webPushContent[payload.kind === "care" ? "care" : "test"] };
        let details: ReturnType<typeof webPush.generateRequestDetails>;
        try {
          details = webPush.generateRequestDetails(subscription, JSON.stringify({ ...payload, content }), {
            TTL: 300, urgency: "normal", contentEncoding: "aes128gcm",
            vapidDetails: config,
          });
        } catch { return stopped("request_invalid"); }
        return await new Promise<PushSendResult>(resolve => {
          let settled = false, sentAt: string | null = null;
          const finish = (result: PushSendResult) => { if (!settled) { settled = true; resolve(result); } };
          // generateRequestDetails performs crypto only; this is the sole network request.
          const req = request(url, { method: "POST", headers: details.headers, agent: false, family: 4, signal,
            lookup: (_host, _options, callback) => callback(null, address, 4),
          }, response => {
            const status = response.statusCode;
            // HTTP status is sufficient evidence. Do not accumulate arbitrary provider bodies.
            const result = status ? providerResult(status) : unknown();
            finish(result.status === 'accepted' && sentAt
              ? { ...result, message: { ...content, channel: 'web_push', sentAt } } : result);
            response.on("error", () => {});
            response.destroy();
          });
          req.on("error", () => finish(unknown()));
          req.setTimeout(10000, () => req.destroy());
          sentAt = new Date().toISOString();
          req.end(details.body);
        });
      } catch { return unknown(); }
      finally { clearTimeout(deadline); outerSignal.removeEventListener("abort", abort); }
    },
  };
}
