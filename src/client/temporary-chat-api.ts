import type {
  TemporaryChatCloseReason,
  TemporaryChatCloseResponse,
  TemporaryChatCreateResponse,
  TemporaryChatSendResponse,
} from "../shared/temporary-chat.ts";

export class TemporaryChatApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "TemporaryChatApiError";
    this.status = status;
    this.code = code;
  }
}

export interface TemporaryChatApi {
  createSession(userId: string, signal?: AbortSignal): Promise<TemporaryChatCreateResponse>;
  sendMessage(
    userId: string,
    sessionId: string,
    input: { text: string; generation: number },
    signal?: AbortSignal,
  ): Promise<TemporaryChatSendResponse>;
  closeSession(
    userId: string,
    sessionId: string,
    input?: { generation?: number; reason?: TemporaryChatCloseReason },
    options?: { signal?: AbortSignal; keepalive?: boolean },
  ): Promise<TemporaryChatCloseResponse>;
}

async function readErrorPayload(
  response: Response,
): Promise<{ code: string; message: string }> {
  try {
    const parsed = (await response.json()) as {
      error?: { code?: unknown; message?: unknown };
    };
    const code =
      typeof parsed?.error?.code === "string" ? parsed.error.code : "temporary_chat_unavailable";
    const message =
      typeof parsed?.error?.message === "string"
        ? parsed.error.message
        : "臨時聊天服務暫時未能處理，請稍後重試。";
    return { code, message };
  } catch {
    return {
      code: "temporary_chat_unavailable",
      message: "臨時聊天服務暫時未能處理，請稍後重試。",
    };
  }
}

export function createTemporaryChatApi(
  apiBaseUrl: string,
  fetcher: typeof fetch = fetch,
): TemporaryChatApi {
  const base = apiBaseUrl.replace(/\/$/, "");
  const apiUrl = base.endsWith("/api") ? base : `${base}/api`;

  async function postJson<T>(
    path: string,
    userId: string,
    body: unknown,
    options?: { signal?: AbortSignal; keepalive?: boolean },
  ): Promise<T> {
    const response = await fetcher(`${apiUrl}${path}`, {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json",
        "x-expected-user-id": userId,
      },
      body: JSON.stringify(body),
      ...(options?.signal ? { signal: options.signal } : {}),
      ...(options?.keepalive ? { keepalive: true } : {}),
    });

    if (!response.ok) {
      const error = await readErrorPayload(response);
      throw new TemporaryChatApiError(response.status, error.code, error.message);
    }

    return (await response.json()) as T;
  }

  return {
    createSession(userId, signal) {
      return postJson<TemporaryChatCreateResponse>("/temporary-chat/sessions", userId, {}, { signal });
    },
    sendMessage(userId, sessionId, input, signal) {
      return postJson<TemporaryChatSendResponse>(
        `/temporary-chat/sessions/${encodeURIComponent(sessionId)}/messages`,
        userId,
        { text: input.text, generation: input.generation },
        { signal },
      );
    },
    closeSession(userId, sessionId, input = {}, options) {
      return postJson<TemporaryChatCloseResponse>(
        `/temporary-chat/sessions/${encodeURIComponent(sessionId)}/close`,
        userId,
        input,
        options,
      );
    },
  };
}
