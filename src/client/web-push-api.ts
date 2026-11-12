import { z } from "zod";
import type { OnlineReceipt } from "../shared/online.ts";
import { nativeChatPresenceSchema, nativePushReferenceSchema, type NativeChatPresence, type NativePushReference } from "../shared/native-push.ts";
import { pushBindingSchema, pushDeliverySchema, webPushStatusSchema, type PushBinding, type PushDelivery, type PushRegistrationInput, type WebPushStatus } from "../shared/web-push.ts";
import type { WebPushSubscription } from "../shared/web-push.ts";
import { createOnlineTransport, OnlineTransportError } from "./online-transport.ts";

export class WebPushApiError extends Error {
  readonly status: number;
  readonly onlineCode: string | null;
  readonly confirmed: boolean;
  constructor(status = 0, onlineCode: string | null = null, confirmed = false) {
    super("Web Push request could not be confirmed");
    this.name = "WebPushApiError";
    this.status = status;
    this.onlineCode = onlineCode;
    this.confirmed = confirmed;
  }
}

export interface WebPushApi {
  chatPresence(bindingId: string, signal: AbortSignal, userId: string): Promise<NativeChatPresence>;
  updateChatPresence(input: WebChatPresenceUpdate, signal: AbortSignal, userId: string): Promise<NativeChatPresence>;
  open(reference: NativePushReference, signal: AbortSignal, userId: string, subscription?: WebPushSubscription): Promise<WebPushChatTarget>;
  status(signal: AbortSignal, userId: string): Promise<WebPushStatus>;
  register(input: PushRegistrationInput, signal: AbortSignal, userId: string): Promise<PushBinding>;
  revoke(id: string, expectedVersion: number, signal: AbortSignal, userId: string): Promise<PushBinding>;
  test(id: string, expectedVersion: number, signal: AbortSignal, userId: string): Promise<PushDelivery>;
  reconcilePending(signal: AbortSignal, userId: string): Promise<OnlineReceipt | { state: "unconfirmed" } | null>;
  resetOnline(): void;
  hasPendingOnline(): boolean;
}
export type WebPushChatTarget = { kind: "chat"; childId: string; messageId: string };
export type WebChatPresenceUpdate = { bindingId: string; expectedBindingVersion: number; expectedPresenceVersion: number;
  childId: string | null; chatNotificationsEnabled?: boolean; chatPreviewEnabled?: boolean; subscription?: WebPushSubscription };

const bindingResultSchema = z.object({ binding: pushBindingSchema }).strict();
const deliveryResultSchema = z.object({ delivery: pushDeliverySchema }).strict();
const statusErrorSchema = z.object({ error: z.object({ code: z.enum(["session_changed", "account_precondition_required", "installation_proof_required"]) }) });
type BindingTarget = { kind: "binding"; bindingId?: string };
type DeliveryTarget = { kind: "delivery"; bindingId: string };
type Target = BindingTarget | DeliveryTarget;

function checkedResult(value: unknown, target: Target, confirmed: boolean): PushBinding | PushDelivery {
  if (target.kind === "binding") {
    const parsed = bindingResultSchema.safeParse(value);
    if (!parsed.success || target.bindingId !== undefined && parsed.data.binding.id !== target.bindingId.toLowerCase()) {
      throw new WebPushApiError(0, null, confirmed);
    }
    return parsed.data.binding;
  }
  const parsed = deliveryResultSchema.safeParse(value);
  if (!parsed.success || parsed.data.delivery.bindingId !== target.bindingId.toLowerCase()) throw new WebPushApiError(0, null, confirmed);
  return parsed.data.delivery;
}

export function createWebPushApi(baseUrl: string, fetcher: typeof fetch = fetch, options?: { version: 2 }): WebPushApi {
  const base = baseUrl.replace(/\/$/u, "");
  const apiUrl = base.endsWith("/api") ? base : base + "/api";
  const online = createOnlineTransport(apiUrl, fetcher);
  let generation = 0;
  let currentUser: string | null = null;
  let pendingTarget: Target | null = null;
  let operationBusy = false;

  function resetOnline(): void {
    generation++;
    currentUser = null;
    pendingTarget = null;
    online.reset();
  }
  function selectUser(userId: string): void {
    if (currentUser !== null && currentUser !== userId) resetOnline();
    currentUser = userId;
  }
  async function call<T>(signal: AbortSignal, userId: string, action: (innerSignal: AbortSignal) => Promise<T>): Promise<T> {
    selectUser(userId);
    const started = generation;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) controller.abort();
    const timeout = setTimeout(abort, 20_000);
    try {
      if (controller.signal.aborted) throw new WebPushApiError();
      const value = await action(controller.signal);
      if (controller.signal.aborted || started !== generation) throw new WebPushApiError();
      return value;
    } catch (error) {
      if (error instanceof WebPushApiError) throw error;
      if (error instanceof OnlineTransportError) throw new WebPushApiError(error.status, error.code, error.confirmed);
      throw new WebPushApiError();
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    }
  }

  function mutate(path: string, payload: unknown, target: BindingTarget, signal: AbortSignal, userId: string): Promise<PushBinding>;
  function mutate(path: string, payload: unknown, target: DeliveryTarget, signal: AbortSignal, userId: string): Promise<PushDelivery>;
  async function mutate(path: string, payload: unknown, target: Target, signal: AbortSignal, userId: string): Promise<PushBinding | PushDelivery> {
    selectUser(userId);
    if (operationBusy) throw new WebPushApiError(409, "operation_busy");
    operationBusy = true;
    if (!online.hasPending()) pendingTarget = target;
    let confirmed = false;
    try {
      return await call(signal, userId, async innerSignal => {
        const value = await online.submit({ path: "/api" + path, payload }, innerSignal, userId);
        confirmed = true;
        return checkedResult(value, target, true);
      });
    } catch (error) {
      if (confirmed && error instanceof WebPushApiError) throw new WebPushApiError(error.status, error.onlineCode, true);
      throw error;
    } finally {
      if (!online.hasPending()) pendingTarget = null;
      operationBusy = false;
    }
  }
  const bindingPath = (id: string) => "/web-push/subscriptions/" + encodeURIComponent(id);

  async function checkedResponse(response: Response): Promise<unknown> {
    if (response.ok) return response.json();
    let code: string | null = null;
    try { const parsed = statusErrorSchema.safeParse(await response.json()); if (parsed.success) code = parsed.data.error.code; } catch { /* Response bodies remain private. */ }
    throw new WebPushApiError(response.status, code);
  }

  async function presenceResult(response: Response, bindingId: string) {
    const parsed = nativeChatPresenceSchema.safeParse(await checkedResponse(response));
    if (!parsed.success || parsed.data.bindingId !== bindingId) throw new WebPushApiError();
    return parsed.data;
  }

  return {
    chatPresence: (bindingId, signal, userId) => call(signal, userId, async innerSignal => presenceResult(await fetcher(apiUrl + "/web-push/chat-presence?bindingId=" + encodeURIComponent(bindingId), {
      method: "GET", credentials: "include", cache: "no-store", signal: innerSignal,
      headers: { Accept: "application/json", "x-expected-user-id": userId },
    }), bindingId)),
    updateChatPresence: (input, signal, userId) => call(signal, userId, async innerSignal => presenceResult(await fetcher(apiUrl + "/web-push/chat-presence", {
      method: "POST", credentials: "include", cache: "no-store", signal: innerSignal,
      headers: { Accept: "application/json", "Content-Type": "application/json", "x-expected-user-id": userId }, body: JSON.stringify(input),
    }), input.bindingId)),
    open: (reference, signal, userId, subscription) => call(signal, userId, async innerSignal => {
      nativePushReferenceSchema.parse(reference);
      const response = await fetcher(apiUrl + "/web-push/open" + (subscription ? "" : "?reference=" + encodeURIComponent(JSON.stringify(reference))), {
        method: subscription ? "POST" : "GET", credentials: "include", cache: "no-store", signal: innerSignal,
        headers: { Accept: "application/json", "x-expected-user-id": userId, ...(subscription ? { "Content-Type": "application/json" } : {}) },
        ...(subscription ? { body: JSON.stringify({ reference, subscription }) } : {}),
      });
      return z.object({ kind: z.literal("chat"), childId: z.uuid(), messageId: z.uuid() }).strict().parse(await checkedResponse(response));
    }),
    resetOnline,
    hasPendingOnline: () => online.hasPending(),
    async status(signal, userId) {
      return await call(signal, userId, async innerSignal => {
        const response = await fetcher(apiUrl + "/web-push" + (options?.version === 2 ? "?v=2" : ""), {
          method: "GET", credentials: "include", cache: "no-store", signal: innerSignal,
          headers: { Accept: "application/json", "x-expected-user-id": userId },
        });
        if (!response.ok) {
          let onlineCode: string | null = null;
          try {
            const parsed = statusErrorSchema.safeParse(await response.json());
            if (parsed.success) onlineCode = parsed.data.error.code;
          } catch { /* A server response body is never an error message. */ }
          throw new WebPushApiError(response.status, onlineCode);
        }
        const parsed = webPushStatusSchema.safeParse(await response.json());
        if (!parsed.success) throw new WebPushApiError();
        if (parsed.data.userId !== userId) throw new WebPushApiError(409, "session_changed");
        return parsed.data;
      });
    },
    register: (input, signal, userId) => mutate("/web-push/subscriptions", input, { kind: "binding" }, signal, userId),
    revoke: (id, expectedVersion, signal, userId) => mutate(bindingPath(id) + "/revoke", { expectedVersion },
      { kind: "binding", bindingId: id }, signal, userId),
    test: (id, expectedVersion, signal, userId) => mutate(bindingPath(id) + "/test", { expectedVersion, confirmImmediate: true },
      { kind: "delivery", bindingId: id }, signal, userId),
    async reconcilePending(signal, userId) {
      selectUser(userId);
      if (operationBusy) throw new WebPushApiError(409, "operation_busy");
      operationBusy = true;
      const target = pendingTarget;
      let confirmed = false;
      try {
        return await call(signal, userId, async innerSignal => {
          const receipt = await online.checkPending(innerSignal, userId);
          confirmed = receipt?.state === "confirmed";
          if (receipt?.state === "confirmed" && receipt.result !== null) {
            if (!target) throw new WebPushApiError(0, null, true);
            checkedResult(receipt.result, target, true);
          }
          return receipt;
        });
      } catch (error) {
        if (confirmed && error instanceof WebPushApiError) throw new WebPushApiError(error.status, error.onlineCode, true);
        throw error;
      } finally {
        if (!online.hasPending()) pendingTarget = null;
        operationBusy = false;
      }
    },
  };
}
