import { z } from "zod";
import { pushRegistrationInput, pushVersionInput, pushTestInput } from "../src/shared/web-push.ts";
import { FamilyError } from "./family-access.ts";
import { apiError, jsonResponse } from "./workspace-api.ts";
import type { WebPushStore } from "./web-push-store.ts";

export async function handleWebPushRequest(request: Request, userId: string | null, store: WebPushStore, receiptDispatch = false): Promise<Response> {
  if (!userId) return apiError("unauthorized", "請先登入。", 401);
  const expected = request.headers.get("x-expected-user-id");
  if (!expected) return apiError("account_precondition_required", "請重新確認登入帳號。", 428);
  if (expected !== userId) return apiError("session_changed", "登入帳號已改變。", 409);
  const path = new URL(request.url).pathname;
  try {
    if (request.method === "GET" && path === "/api/web-push") return jsonResponse(await store.status(userId));
    if (request.method !== "POST") return apiError("not_found", "找不到資料。", 404);
    if (!receiptDispatch) return apiError("online_operation_required", "請透過原操作收據提交。", 428);
    if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") return apiError("unsupported_media_type", "請以 JSON 提交。", 415);
    let body: unknown;
    try { body = await request.json(); } catch { return apiError("invalid_json", "請檢查輸入。", 400); }
    if (path === "/api/web-push/subscriptions") return jsonResponse({ binding: await store.register(userId, pushRegistrationInput.parse(body)) }, 201);
    const match = /^\/api\/web-push\/subscriptions\/([0-9a-f-]{36})\/(revoke|test)$/iu.exec(path);
    if (!match || !z.uuid().safeParse(match[1]).success) return apiError("not_found", "找不到資料。", 404);
    if (match[2].toLowerCase() === "revoke") return jsonResponse({ binding: await store.revoke(userId, match[1], pushVersionInput.parse(body).expectedVersion) });
    return jsonResponse({ delivery: await store.test(userId, match[1], pushTestInput.parse(body).expectedVersion) }, 201);
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("invalid_input", "請檢查訂閱資料及版本。", 400);
    if (error instanceof FamilyError) return apiError(error.code, error.status === 409
      ? "訂閱、版本、限額或 worker 狀態不允許此操作，請重新讀取。"
      : "找不到獲授權資料或輸入無效。", error.status);
    throw error;
  }
}
