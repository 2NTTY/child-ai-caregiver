import type { ChatMessage, ChatPage } from "../shared/chat.ts";
import type { SessionUser } from "./records-api.ts";

export type ChatErrorCode = "ai_disabled" | "ai_busy" | "ai_quota_exceeded" | "ai_timeout" | "ai_unavailable"
  | "invalid_input" | "unauthorized" | "session_changed" | "not_found";

const knownCodes = new Set<ChatErrorCode>([
  "ai_disabled", "ai_busy", "ai_quota_exceeded", "ai_timeout", "ai_unavailable",
  "invalid_input", "unauthorized", "session_changed", "not_found",
]);

export class ChatApiError extends Error {
  readonly status: number;
  readonly code: ChatErrorCode | null;

  constructor(status = 0, code: ChatErrorCode | null = null) {
    super("Chat request could not be confirmed");
    this.name = "ChatApiError";
    this.status = status;
    this.code = code;
  }
}

export interface ChatUsage {
  day: string;
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  unknownUsageAttempts: number;
}

export interface ChatApi {
  getSession(signal: AbortSignal): Promise<SessionUser | null>;
  listMessages(childId: string, signal: AbortSignal): Promise<ChatPage>;
  saveMessage(childId: string, text: string, signal: AbortSignal, expectedUserId: string): Promise<ChatMessage>;
  requestReply(childId: string, messageId: string, signal: AbortSignal, expectedUserId: string): Promise<ChatMessage>;
  getStatus(signal: AbortSignal): Promise<boolean>;
  getUsage(signal: AbortSignal): Promise<ChatUsage>;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function id(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function message(value: unknown): value is ChatMessage {
  return object(value) && id(value.id) && id(value.childId)
    && (value.authorUserId === null || id(value.authorUserId))
    && (value.role === "user" || value.role === "model")
    && typeof value.text === "string"
    && (value.inReplyTo === null || id(value.inReplyTo))
    && typeof value.createdAt === "string" && Number.isFinite(Date.parse(value.createdAt))
    && (value.role === "user" ? value.authorUserId !== null && value.inReplyTo === null
      : value.authorUserId === null && value.inReplyTo !== null);
}

function nonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function createChatApi(baseUrl: string, getSession: ChatApi["getSession"], fetcher: typeof fetch = fetch): ChatApi {
  const base = baseUrl.replace(/\/$/, "");
  const apiUrl = base.endsWith("/api") ? base : `${base}/api`;

  async function request(path: string, signal: AbortSignal, body?: unknown, expectedUserId?: string, timeoutMs = 20_000): Promise<unknown> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) controller.abort();
    const timeout = setTimeout(abort, timeoutMs);
    try {
      const response = await fetcher(`${apiUrl}${path}`, {
        method: body === undefined ? "GET" : "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(expectedUserId === undefined ? {} : { "x-expected-user-id": expectedUserId }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
      if (!response.ok) {
        let code: ChatErrorCode | null = null;
        try {
          const value: unknown = await response.json();
          if (object(value) && object(value.error) && typeof value.error.code === "string"
            && knownCodes.has(value.error.code as ChatErrorCode)) code = value.error.code as ChatErrorCode;
        } catch { /* The status is still available when the body is malformed. */ }
        throw new ChatApiError(response.status, code);
      }
      return await response.json();
    } catch (error) {
      if (error instanceof ChatApiError) throw error;
      throw new ChatApiError();
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    }
  }

  return {
    getSession,
    async listMessages(childId, signal) {
      const value = await request(`/children/${encodeURIComponent(childId)}/messages`, signal);
      if (!object(value) || !Array.isArray(value.messages) || !value.messages.every(message)
        || !Number.isInteger(value.limit) || (value.limit as number) < 1 || (value.limit as number) > 100
        || value.messages.length > (value.limit as number)
        || value.messages.some((item: ChatMessage) => item.childId !== childId)) throw new ChatApiError();
      return { messages: value.messages, limit: value.limit as number };
    },
    async saveMessage(childId, text, signal, expectedUserId) {
      const value = await request(`/children/${encodeURIComponent(childId)}/messages`, signal, { text }, expectedUserId);
      if (!object(value) || !message(value.message) || value.message.childId !== childId
        || value.message.role !== "user" || value.message.authorUserId !== expectedUserId || value.message.text !== text) {
        throw new ChatApiError();
      }
      return value.message;
    },
    async requestReply(childId, messageId, signal, expectedUserId) {
      const value = await request(`/children/${encodeURIComponent(childId)}/messages/${encodeURIComponent(messageId)}/reply`,
        signal, {}, expectedUserId, 90_000);
      if (!object(value) || !message(value.message) || value.message.childId !== childId
        || value.message.role !== "model" || value.message.inReplyTo !== messageId) throw new ChatApiError();
      return value.message;
    },
    async getStatus(signal) {
      const value = await request("/ai/status", signal);
      if (!object(value) || typeof value.available !== "boolean") throw new ChatApiError();
      return value.available;
    },
    async getUsage(signal) {
      const value = await request("/ai/usage", signal);
      if (!object(value) || typeof value.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.day)
        || !nonnegativeInteger(value.attempts) || !nonnegativeInteger(value.inputTokens)
        || !nonnegativeInteger(value.outputTokens) || !nonnegativeInteger(value.cachedTokens)
        || !nonnegativeInteger(value.unknownUsageAttempts)) throw new ChatApiError();
      return {
        day: value.day, attempts: value.attempts, inputTokens: value.inputTokens,
        outputTokens: value.outputTokens, cachedTokens: value.cachedTokens,
        unknownUsageAttempts: value.unknownUsageAttempts,
      };
    },
  };
}
