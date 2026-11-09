import { z } from "zod";
import type { OnlineReceipt } from "../shared/online.ts";
import { pushDeliverySchema, type PushDelivery } from "../shared/web-push.ts";
import { nativePushBindingSchema, nativePushBindingV2Schema, nativePushStatusSchema, nativePushStatusV2Schema, type NativePushBinding, type NativePushBindingV2, type NativePushPlatform, type NativePushRegistration, type NativePushStatus, type NativePushStatusV2, type NativePushReference } from "../shared/native-push.ts";
import { createOnlineTransport, OnlineTransportError } from "./online-transport.ts";

export class NativePushApiError extends Error {
  readonly status: number;
  readonly onlineCode: string | null;
  readonly confirmed: boolean;
  constructor(status = 0, onlineCode: string | null = null, confirmed = false) {
    super("Native Push request could not be confirmed");
    this.name = "NativePushApiError";
    this.status = status;
    this.onlineCode = onlineCode;
    this.confirmed = confirmed;
  }
}

export type NativePushTarget = { kind: "test" | "care"; childId: string | null; taskId: string | null };
export interface NativePushApi<Binding extends NativePushBinding = NativePushBinding, Status extends NativePushStatus = NativePushStatus> {
  open(reference: NativePushReference, signal: AbortSignal, userId: string): Promise<NativePushTarget>;
  status(signal: AbortSignal, userId: string): Promise<Status>;
  register(input: NativePushRegistration, signal: AbortSignal, userId: string): Promise<Binding>;
  revoke(id: string, expectedVersion: number, signal: AbortSignal, userId: string): Promise<Binding>;
  test(id: string, expectedVersion: number, signal: AbortSignal, userId: string): Promise<PushDelivery>;
  reconcilePending(signal: AbortSignal, userId: string): Promise<OnlineReceipt | { state: "unconfirmed" } | null>;
  resetOnline(): void;
  hasPendingOnline(): boolean;
}

const bindingResultSchema = z.object({ binding: nativePushBindingSchema }).strict();
const bindingResultV2Schema = z.object({ binding: nativePushBindingV2Schema }).strict();
const deliveryResultSchema = z.object({ delivery: pushDeliverySchema }).strict();
const statusErrorSchema = z.object({ error: z.object({ code: z.enum(["session_changed", "account_precondition_required"]) }) });
type BindingTarget = { kind: "binding"; bindingId?: string };
type DeliveryTarget = { kind: "delivery"; bindingId: string };
type Target = BindingTarget | DeliveryTarget;

function checkedResult(value: unknown, target: Target, confirmed: boolean, v2: boolean): NativePushBinding | NativePushBindingV2 | PushDelivery {
  if (target.kind === "binding") {
    const parsed = (v2 ? bindingResultV2Schema : bindingResultSchema).safeParse(value);
    if (!parsed.success || target.bindingId !== undefined && parsed.data.binding.id !== target.bindingId.toLowerCase()) {
      throw new NativePushApiError(0, null, confirmed);
    }
    return parsed.data.binding;
  }
  const parsed = deliveryResultSchema.safeParse(value);
  if (!parsed.success || parsed.data.delivery.bindingId !== target.bindingId.toLowerCase()) throw new NativePushApiError(0, null, confirmed);
  return parsed.data.delivery;
}

type NativePushApiOptions = { version: 2; platform: NativePushPlatform };
export function createNativePushApi(baseUrl: string, fetcher: typeof fetch | undefined, options: NativePushApiOptions): NativePushApi<NativePushBindingV2, NativePushStatusV2>;
export function createNativePushApi(baseUrl: string, fetcher?: typeof fetch): NativePushApi;
export function createNativePushApi(baseUrl: string, fetcher: typeof fetch = fetch, options?: NativePushApiOptions): NativePushApi {
  const base = baseUrl.replace(/\/$/u, "");
  const apiUrl = base.endsWith("/api") ? base : base + "/api";
  const v2 = options?.version === 2, resourcePath = v2 ? "/native-push/v2" : "/native-push";
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
      if (controller.signal.aborted) throw new NativePushApiError();
      const value = await action(controller.signal);
      if (controller.signal.aborted || started !== generation) throw new NativePushApiError();
      return value;
    } catch (error) {
      if (error instanceof NativePushApiError) throw error;
      if (error instanceof OnlineTransportError) throw new NativePushApiError(error.status, error.code, error.confirmed);
      throw new NativePushApiError();
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    }
  }

  function mutate(path: string, payload: unknown, target: BindingTarget, signal: AbortSignal, userId: string): Promise<NativePushBinding>;
  function mutate(path: string, payload: unknown, target: DeliveryTarget, signal: AbortSignal, userId: string): Promise<PushDelivery>;
  async function mutate(path: string, payload: unknown, target: Target, signal: AbortSignal, userId: string): Promise<NativePushBinding | PushDelivery> {
    selectUser(userId);
    if (operationBusy) throw new NativePushApiError(409, "operation_busy");
    operationBusy = true;
    if (!online.hasPending()) pendingTarget = target;
    let confirmed = false;
    try {
      return await call(signal, userId, async innerSignal => {
        const value = await online.submit({ path: "/api" + path, payload }, innerSignal, userId);
        confirmed = true;
        return checkedResult(value, target, true, v2);
      });
    } catch (error) {
      if (confirmed && error instanceof NativePushApiError) throw new NativePushApiError(error.status, error.onlineCode, true);
      throw error;
    } finally {
      if (!online.hasPending()) pendingTarget = null;
      operationBusy = false;
    }
  }
  const bindingPath = (id: string) => resourcePath + "/subscriptions/" + encodeURIComponent(id);

  return {
    async open(reference, signal, userId) {
      return call(signal, userId, async innerSignal => {
        const response = await fetcher(apiUrl + "/native-push/open?reference=" + encodeURIComponent(JSON.stringify(reference)), {
          method: "GET", cache: "no-store", signal: innerSignal, headers: { Accept: "application/json", "x-expected-user-id": userId },
        });
        if (!response.ok) throw new NativePushApiError(response.status);
        return z.discriminatedUnion("kind", [z.object({ kind: z.literal("test"), childId: z.null(), taskId: z.null() }).strict(),
          z.object({ kind: z.literal("care"), childId: z.uuid(), taskId: z.uuid() }).strict()]).parse(await response.json());
      });
    },
    resetOnline,
    hasPendingOnline: () => online.hasPending(),
    async status(signal, userId) {
      return await call(signal, userId, async innerSignal => {
        const response = await fetcher(apiUrl + resourcePath, {
          method: "GET", credentials: "include", cache: "no-store", signal: innerSignal,
          headers: { Accept: "application/json", "x-expected-user-id": userId },
        });
        if (!response.ok) {
          let onlineCode: string | null = null;
          try {
            const parsed = statusErrorSchema.safeParse(await response.json());
            if (parsed.success) onlineCode = parsed.data.error.code;
          } catch { /* A server response body is never an error message. */ }
          throw new NativePushApiError(response.status, onlineCode);
        }
        const parsed = (v2 ? nativePushStatusV2Schema : nativePushStatusSchema).safeParse(await response.json());
        if (!parsed.success) throw new NativePushApiError();
        if (parsed.data.userId !== userId) throw new NativePushApiError(409, "session_changed");
        return parsed.data;
      });
    },
    register: (input, signal, userId) => mutate(resourcePath + "/subscriptions", options ? { ...input, platform: options.platform } : input, { kind: "binding" }, signal, userId),
    revoke: (id, expectedVersion, signal, userId) => mutate(bindingPath(id) + "/revoke", { expectedVersion },
      { kind: "binding", bindingId: id }, signal, userId),
    test: (id, expectedVersion, signal, userId) => mutate(bindingPath(id) + "/test", { expectedVersion, confirmImmediate: true },
      { kind: "delivery", bindingId: id }, signal, userId),
    async reconcilePending(signal, userId) {
      selectUser(userId);
      if (operationBusy) throw new NativePushApiError(409, "operation_busy");
      operationBusy = true;
      const target = pendingTarget;
      let confirmed = false;
      try {
        return await call(signal, userId, async innerSignal => {
          const receipt = await online.checkPending(innerSignal, userId);
          confirmed = receipt?.state === "confirmed";
          if (receipt?.state === "confirmed" && receipt.result !== null) {
            if (!target) throw new NativePushApiError(0, null, true);
            checkedResult(receipt.result, target, true, v2);
          }
          return receipt;
        });
      } catch (error) {
        if (confirmed && error instanceof NativePushApiError) throw new NativePushApiError(error.status, error.onlineCode, true);
        throw error;
      } finally {
        if (!online.hasPending()) pendingTarget = null;
        operationBusy = false;
      }
    },
  };
}
