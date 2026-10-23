import { GoogleAuth } from "google-auth-library";
import { ANDROID_PUSH_CHANNEL, ANDROID_PUSH_PACKAGE, nativePushContent, nativePushReferenceSchema,
  nativePushTokenSchema, type NativePushReference } from "../src/shared/native-push.ts";
import type { PushSendResult } from "./web-push-types.ts";

export interface NativePushGateway {
  readonly available: boolean;
  send(token: string, reference: NativePushReference, signal: AbortSignal,
    stillAuthorized: () => Promise<boolean>): Promise<PushSendResult>;
}
export interface NativePushConfig { projectId: string; }
const projectPattern = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u;
export function readNativePushConfig(env: Record<string, string | undefined>): NativePushConfig | null {
  if (env.ANDROID_PUSH_ENABLED === undefined || env.ANDROID_PUSH_ENABLED === "false") return null;
  if (env.ANDROID_PUSH_ENABLED !== "true" || !projectPattern.test(env.GCP_PROJECT_ID ?? "")) throw new Error("native_push_config_invalid");
  return { projectId: env.GCP_PROJECT_ID! };
}
const stopped = (reason: PushSendResult["reason"]): PushSendResult => ({ status: "stopped", reason, providerStatus: null });
const unknown = (): PushSendResult => ({ status: "unknown", reason: "transport_unknown", providerStatus: null });
async function readBoundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const reader = response.body?.getReader(); if (!reader) throw new Error("native_push_response_invalid");
  let size = 0; const parts: Uint8Array[] = [];
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw new Error("native_push_interrupted");
      const part = await reader.read(); if (signal.aborted) throw new Error("native_push_interrupted");
      if (part.done) break;
      size += part.value.length;
      if (size > 8192) { await reader.cancel(); throw new Error("native_push_response_too_large"); }
      parts.push(part.value);
    }
    return JSON.parse(Buffer.concat(parts).toString("utf8"));
  } finally { signal.removeEventListener("abort", abort); reader.releaseLock(); }
}
/** OAuth may refresh credentials; the message POST itself is issued at most once. */
export function createNativePushGateway(config: NativePushConfig | null, ports: {
  accessToken?: () => Promise<string | null>; fetch?: typeof fetch; deadlineMs?: number;
} = {}): NativePushGateway {
  if (config && !projectPattern.test(config.projectId)) throw new Error("native_push_config_invalid");
  const auth = config && !ports.accessToken ? new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/firebase.messaging"] }) : null;
  const accessToken = ports.accessToken ?? (() => auth!.getAccessToken());
  const transport = ports.fetch ?? globalThis.fetch;
  const deadlineMs = ports.deadlineMs ?? 15000;
  if (!Number.isInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 15000) throw new Error("native_push_config_invalid");
  return { available: !!config,
    async send(rawToken, rawReference, outerSignal, stillAuthorized) {
      if (!config) return stopped("configuration_unavailable");
      const token = nativePushTokenSchema.safeParse(rawToken), reference = nativePushReferenceSchema.safeParse(rawReference);
      if (!token.success || !reference.success) return stopped("request_invalid");
      const controller = new AbortController(), { signal } = controller;
      const abort = () => controller.abort(); outerSignal.addEventListener("abort", abort, { once: true });
      if (outerSignal.aborted) abort();
      const timer = setTimeout(abort, deadlineMs); timer.unref(); let issued = false;
      const bounded = async <T>(operation: () => Promise<T>): Promise<T> => {
        if (signal.aborted) throw new Error("native_push_interrupted");
        let listener: () => void = () => {};
        try { return await Promise.race([operation(), new Promise<never>((_, reject) => {
          listener = () => reject(new Error("native_push_interrupted")); signal.addEventListener("abort", listener, { once: true });
          if (signal.aborted) listener();
        })]); } finally { signal.removeEventListener("abort", listener); }
      };
      try {
        let credential: string | null;
        try { credential = await bounded(accessToken) ?? null; }
        catch { return stopped(signal.aborted ? "worker_interrupted" : "configuration_unavailable"); }
        if (!credential) return stopped("configuration_unavailable");
        // Recheck after authentication and immediately before the only external effect.
        if (!await bounded(stillAuthorized)) return stopped("revoked");
        if (signal.aborted) return stopped("worker_interrupted");
        const r = reference.data, content = { ...nativePushContent[r.kind] };
        const message = { token: token.data, notification: content,
          data: { v: "1", kind: r.kind, bindingId: r.bindingId, bindingVersion: String(r.bindingVersion), deliveryId: r.deliveryId },
          android: { restricted_package_name: ANDROID_PUSH_PACKAGE, priority: "normal", ttl: "300s",
            notification: { channel_id: ANDROID_PUSH_CHANNEL, tag: r.deliveryId } } };
        const sentAt = new Date().toISOString();
        issued = true;
        const response = await bounded(() => transport(`https://fcm.googleapis.com/v1/projects/${config.projectId}/messages:send`, {
          method: "POST", redirect: "error", signal, headers: { authorization: "Bearer " + credential, "content-type": "application/json" },
          body: JSON.stringify({ message }),
        }));
        if (response.status === 200) {
          const value = await readBoundedJson(response, signal);
          return value && typeof value === "object" && "name" in value && typeof value.name === "string"
            && value.name.startsWith(`projects/${config.projectId}/messages/`) && value.name.length < 512
            && value.name.length > `projects/${config.projectId}/messages/`.length
            ? { status: "accepted", reason: null, providerStatus: 200, message: { ...content, channel: "native_push", contentVersion: "native-push-generic-v1", sentAt } } : unknown();
        }
        let expired = false;
        if (response.status === 404 || response.status === 400) {
          try {
            const value = await readBoundedJson(response, signal) as { error?: { details?: unknown[] } };
            expired = Array.isArray(value?.error?.details) && value.error.details.some(detail => detail !== null && typeof detail === "object"
              && "@type" in detail && detail["@type"] === "type.googleapis.com/google.firebase.fcm.v1.FcmError"
              && "errorCode" in detail && detail.errorCode === "UNREGISTERED");
          } catch { /* A non-success HTTP status is known rejection even if its optional detail is unreadable. */ }
        } else { try { await response.body?.cancel(); } catch {} }
        return { status: "rejected", reason: expired ? "subscription_expired" : response.status === 429 ? "rate_limited" : "provider_rejected", providerStatus: response.status };
      } catch { return issued ? unknown() : stopped(signal.aborted ? "worker_interrupted" : "request_invalid"); }
      finally { clearTimeout(timer); outerSignal.removeEventListener("abort", abort); }
    },
  };
}
