import { z } from "zod";
import type { OnlineReceipt } from "../shared/online.ts";
import {
  telegramBindingSchema, telegramChallengeSchema, telegramDeliverySchema, telegramStatusSchema,
  type TelegramBinding, type TelegramChallenge, type TelegramDelivery, type TelegramStatus,
} from "../shared/telegram.ts";
import { createOnlineTransport, OnlineTransportError } from "./online-transport.ts";

export class TelegramApiError extends Error {
  readonly status: number;
  readonly onlineCode: string | null;
  readonly confirmed: boolean;
  constructor(status = 0, onlineCode: string | null = null, confirmed = false) {
    super("Telegram request could not be confirmed");
    this.name = "TelegramApiError";
    this.status = status;
    this.onlineCode = onlineCode;
    this.confirmed = confirmed;
  }
}

export interface TelegramApi {
  status(signal: AbortSignal, userId: string): Promise<TelegramStatus>;
  begin(signal: AbortSignal, userId: string): Promise<TelegramChallenge>;
  confirm(challengeId: string, expectedVersion: number, signal: AbortSignal, userId: string): Promise<TelegramBinding>;
  revoke(bindingId: string, expectedVersion: number, signal: AbortSignal, userId: string): Promise<TelegramBinding>;
  test(bindingId: string, expectedVersion: number, signal: AbortSignal, userId: string): Promise<TelegramDelivery>;
  reconcilePending(signal: AbortSignal, userId: string): Promise<OnlineReceipt | { state: "unconfirmed" } | null>;
  hasPendingOnline(): boolean;
  resetOnline(): void;
}

const challengeResult = z.object({ challenge: telegramChallengeSchema }).strict();
const bindingResult = z.object({ binding: telegramBindingSchema }).strict();
const deliveryResult = z.object({ delivery: telegramDeliverySchema }).strict();

export function createTelegramApi(baseUrl = "", fetcher: typeof fetch = fetch): TelegramApi {
  const base = baseUrl.replace(/\/$/u, "");
  const apiUrl = base.endsWith("/api") ? base : `${base}/api`;
  const online = createOnlineTransport(apiUrl, fetcher);
  let generation = 0;

  async function call<T>(signal: AbortSignal, action: (innerSignal: AbortSignal) => Promise<T>): Promise<T> {
    const started = generation;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) controller.abort();
    const timeout = setTimeout(abort, 20_000);
    try {
      if (controller.signal.aborted) throw new TelegramApiError();
      const value = await action(controller.signal);
      if (controller.signal.aborted || started !== generation) throw new TelegramApiError();
      return value;
    } catch (error) {
      if (error instanceof TelegramApiError) throw error;
      if (error instanceof OnlineTransportError) throw new TelegramApiError(error.status, error.code, error.confirmed);
      throw new TelegramApiError();
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    }
  }

  async function mutate(path: string, payload: unknown, signal: AbortSignal, userId: string): Promise<unknown> {
    let confirmed = false;
    try {
      return await call(signal, async innerSignal => {
        const value = await online.submit({ path: `/api/telegram${path}`, payload }, innerSignal, userId);
        confirmed = true;
        return value;
      });
    } catch (error) {
      if (confirmed && error instanceof TelegramApiError) throw new TelegramApiError(error.status, error.onlineCode, true);
      throw error;
    }
  }

  return {
    hasPendingOnline: () => online.hasPending(),
    resetOnline() { generation++; online.reset(); },
    async reconcilePending(signal, userId) {
      let confirmed = false;
      try {
        return await call(signal, async innerSignal => {
          const receipt = await online.checkPending(innerSignal, userId);
          confirmed = receipt?.state === "confirmed";
          return receipt;
        });
      } catch (error) {
        if (confirmed && error instanceof TelegramApiError) throw new TelegramApiError(error.status, error.onlineCode, true);
        throw error;
      }
    },
    async status(signal, userId) {
      const value = await call(signal, async innerSignal => {
        const response = await fetcher(`${apiUrl}/telegram`, {
          method: "GET", credentials: "include", cache: "no-store", signal: innerSignal,
          headers: { Accept: "application/json", "x-expected-user-id": userId },
        });
        if (!response.ok) throw new TelegramApiError(response.status);
        return await response.json() as unknown;
      });
      const parsed = telegramStatusSchema.safeParse(value);
      if (!parsed.success) throw new TelegramApiError();
      return parsed.data;
    },
    async begin(signal, userId) {
      const parsed = challengeResult.safeParse(await mutate("/challenges", { confirmPrivateChannel: true }, signal, userId));
      if (!parsed.success) throw new TelegramApiError(0, null, true);
      return parsed.data.challenge;
    },
    async confirm(challengeId, expectedVersion, signal, userId) {
      const parsed = bindingResult.safeParse(await mutate(`/challenges/${encodeURIComponent(challengeId)}/confirm`,
        { expectedVersion, confirmAccount: true }, signal, userId));
      if (!parsed.success || parsed.data.binding.status !== "active") throw new TelegramApiError(0, null, true);
      return parsed.data.binding;
    },
    async revoke(bindingId, expectedVersion, signal, userId) {
      const parsed = bindingResult.safeParse(await mutate(`/bindings/${encodeURIComponent(bindingId)}/revoke`, { expectedVersion }, signal, userId));
      if (!parsed.success || parsed.data.binding.id !== bindingId || parsed.data.binding.status !== "revoked"
        || parsed.data.binding.version < expectedVersion) throw new TelegramApiError(0, null, true);
      return parsed.data.binding;
    },
    async test(bindingId, expectedVersion, signal, userId) {
      const parsed = deliveryResult.safeParse(await mutate(`/bindings/${encodeURIComponent(bindingId)}/test`,
        { expectedVersion, confirmImmediate: true }, signal, userId));
      if (!parsed.success || parsed.data.delivery.bindingId !== bindingId) throw new TelegramApiError(0, null, true);
      return parsed.data.delivery;
    },
  };
}
