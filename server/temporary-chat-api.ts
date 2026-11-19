import { z } from "zod";
import {
  temporaryChatCloseSchema,
  temporaryChatCreateSchema,
  temporaryChatSendSchema,
} from "../src/shared/temporary-chat.ts";
import type { TemporaryChatService } from "./temporary-chat-agent.ts";
import { TemporaryChatError } from "./temporary-chat-store.ts";

const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const sessionsRoute = /^\/api\/temporary-chat\/sessions$/iu;
const sendRoute = new RegExp(`^/api/temporary-chat/sessions/(${uuid})/messages$`, "i");
const closeRoute = new RegExp(`^/api/temporary-chat/sessions/(${uuid})/close$`, "i");

const TEMPORARY_CHAT_ERROR_MESSAGES: Record<string, string> = {
  temporary_session_closed: "此臨時會話已結束並清除，無法繼續傳送訊息，請開啟新的臨時聊天。",
  temporary_session_expired: "此臨時會話已逾時失效並清除，無法續接，請開啟新的臨時聊天。",
  temporary_session_not_found: "找不到此臨時會話，請重新開啟空白臨時聊天。",
  temporary_session_generation_mismatch: "臨時會話狀態已更新，請重新整理後再試或開啟新會話。",
  temporary_chat_turn_in_progress: "上一則臨時訊息仍在處理中，請稍候再試。",
  temporary_chat_message_limit: "此臨時會話已達訊息上限，請結束並開啟新的臨時聊天。",
  temporary_chat_busy: "目前臨時聊天使用量已達上限，請稍後再試。",
  ai_quota_exceeded: "已達今日服務用量上限，請稍後再試。",
  unauthorized: "登入已失效，請重新登入。",
  invalid_input: "請檢查輸入內容。",
};

function tempJsonResponse(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: {
      "cache-control": "private, no-store",
      pragma: "no-cache",
      "x-content-type-options": "nosniff",
    },
  });
}

function tempApiError(code: string, message: string, status: number): Response {
  return tempJsonResponse({ error: { code, message } }, status);
}

async function readRequestJson(
  request: Request,
  isClose: boolean,
  readJson?: (request: Request) => Promise<unknown>,
): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  const mediaType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
  if (mediaType !== "application/json") {
    return { ok: false, response: tempApiError("unsupported_media_type", "請以 JSON 提交。", 415) };
  }
  if (readJson) {
    try {
      return { ok: true, value: await readJson(request) };
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        "status" in error &&
        typeof error.code === "string" &&
        typeof error.status === "number"
      ) {
        if (error.status === 413) {
          return { ok: false, response: tempApiError(error.code, "請求內容過大。", 413) };
        }
        if (error.status === 415) {
          return { ok: false, response: tempApiError("unsupported_media_type", "請以 JSON 提交。", 415) };
        }
      }
      return { ok: false, response: tempApiError("invalid_json", "請檢查輸入。", 400) };
    }
  }

  let rawText: string;
  try {
    rawText = await request.text();
  } catch {
    return { ok: false, response: tempApiError("invalid_json", "請檢查輸入。", 400) };
  }
  if (!rawText.trim() && isClose) {
    return { ok: true, value: {} };
  }
  try {
    return { ok: true, value: JSON.parse(rawText) as unknown };
  } catch {
    return { ok: false, response: tempApiError("invalid_json", "請檢查輸入。", 400) };
  }
}

export async function handleTemporaryChatRequest(
  request: Request,
  userId: string | null,
  service: TemporaryChatService,
  options: {
    isCurrentUser: (userId: string) => Promise<boolean>;
    readJson?: (request: Request) => Promise<unknown>;
  },
): Promise<Response> {
  if (!userId) return tempApiError("unauthorized", "請先登入。", 401);
  const expected = request.headers.get("x-expected-user-id");
  if (!expected) {
    return tempApiError("account_precondition_required", "請重新確認登入帳號。", 428);
  }
  if (expected !== userId || !(await options.isCurrentUser(userId))) {
    return tempApiError("session_changed", "登入帳號已改變。", 409);
  }

  const url = new URL(request.url);
  const path = url.pathname;
  const isCreate = sessionsRoute.test(path);
  const sendMatch = sendRoute.exec(path);
  const closeMatch = closeRoute.exec(path);
  if (!isCreate && !sendMatch && !closeMatch) {
    return tempApiError("not_found", "找不到臨時聊天服務。", 404);
  }
  if (request.method !== "POST") {
    return tempApiError("method_not_allowed", "不支援此操作。", 405);
  }

  const parsedJson = await readRequestJson(request, Boolean(closeMatch), options.readJson);
  if (!parsedJson.ok) return parsedJson.response;

  try {
    if (isCreate) {
      const parsed = temporaryChatCreateSchema.safeParse(parsedJson.value);
      if (!parsed.success) {
        return tempApiError("invalid_input", "請檢查輸入。", 400);
      }
      const created = service.createSession(userId);
      if (!(await options.isCurrentUser(userId))) {
        service.closeSession(userId, created.session.sessionId, "sign_out");
        return tempApiError("session_changed", "登入帳號已改變。", 409);
      }
      return tempJsonResponse(created, 201);
    }

    if (sendMatch) {
      const parsed = temporaryChatSendSchema.safeParse(parsedJson.value);
      if (!parsed.success) {
        return tempApiError("invalid_input", "請檢查輸入內容。", 400);
      }
      const sessionId = sendMatch[1]!.toLowerCase();
      const result = await service.sendTurn({
        userId,
        sessionId,
        generation: parsed.data.generation,
        text: parsed.data.text,
        isCurrentUser: options.isCurrentUser,
        signal: request.signal,
      });
      if (!(await options.isCurrentUser(userId))) {
        return tempApiError("session_changed", "登入帳號已改變。", 409);
      }
      return tempJsonResponse(result, 200);
    }

    const sessionId = closeMatch![1]!.toLowerCase();
    const parsed = temporaryChatCloseSchema.safeParse(parsedJson.value);
    if (!parsed.success) {
      return tempApiError("invalid_input", "請檢查結束參數。", 400);
    }
    const receipt = service.closeSession(userId, sessionId, parsed.data.reason ?? "user_exit");
    if (!(await options.isCurrentUser(userId))) {
      return tempApiError("session_changed", "登入帳號已改變。", 409);
    }
    return tempJsonResponse({ receipt }, 200);
  } catch (error) {
    if (error instanceof TemporaryChatError) {
      return tempApiError(
        error.code,
        TEMPORARY_CHAT_ERROR_MESSAGES[error.code] ?? "臨時聊天服務暫時未能處理，請稍後重試。",
        error.status,
      );
    }
    if (error instanceof z.ZodError) {
      return tempApiError("invalid_input", "請檢查輸入內容。", 400);
    }
    return tempApiError("temporary_chat_unavailable", "臨時聊天服務暫時未能處理，請稍後重試。", 503);
  }
}
