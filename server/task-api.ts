import { z } from "zod";
import { taskChangeSchema, taskCreateSchema } from "../src/shared/tasks.ts";
import { FamilyError } from "./family-access.ts";
import { apiError, jsonResponse } from "./workspace-api.ts";
import type { TaskStore } from "./tasks.ts";

export async function handleTaskRequest(request: Request, userId: string | null, store: Pick<TaskStore, 'list' | 'get' | 'history'> & Partial<Pick<TaskStore, 'create' | 'change'>>, receiptTransaction = false): Promise<Response> {
  if (!userId) return apiError("unauthorized", "請先登入。", 401);
  if (request.method === "POST") {
    const expected = request.headers.get("x-expected-user-id");
    if (!expected) return apiError("account_precondition_required", "請重新確認登入帳號。", 428);
    if (expected !== userId) return apiError("session_changed", "登入帳號已改變。", 409);
    if (!receiptTransaction) return apiError("account_precondition_required", "請使用附原操作識別的任務提交入口。", 428);
  }
  const url = new URL(request.url);
  const match = /^\/api\/children\/([^/]+)\/tasks(?:\/([^/]+))?(?:\/(history|change))?$/u.exec(url.pathname);
  if (!match || !z.uuid().safeParse(match[1]).success || match[2] && !z.uuid().safeParse(match[2]).success) return apiError("not_found", "找不到事項。", 404);
  const childId = match[1].toLowerCase(), id = match[2]?.toLowerCase(), action = match[3];
  try {
    let result: unknown = null, status = 200;
    if (request.method === "GET") {
      if (!id) result = await store.list(userId, childId, url.searchParams.has("afterId") ? z.uuid().parse(url.searchParams.get("afterId")) : undefined);
      else if (action === "history") result = await store.history(userId, childId, id,
        url.searchParams.has("beforeVersion") ? z.coerce.number().int().positive().max(2147483647).parse(url.searchParams.get("beforeVersion")) : undefined);
      else if (!action) { const task = await store.get(userId, childId, id); if (task) result = { task }; }
    } else if (request.method === "POST") {
      if (!store.create || !store.change) return apiError("firebase_domain_not_ready", "此資料流程仍未接通。", 503);
      if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") return apiError("unsupported_media_type", "請以 JSON 提交。", 415);
      let body: unknown; try { body = await request.json(); } catch { return apiError("invalid_json", "請核對輸入。", 400); }
      if (!id) { const task = await store.create(userId, childId, taskCreateSchema.parse(body)); if (task) { result = { task }; status = 201; } }
      else if (action === "change") { const task = await store.change(userId, childId, id, taskChangeSchema.parse(body)); if (task) result = { task }; }
    } else return apiError("method_not_allowed", "不支援此操作。", 405);
    return result === null ? apiError("not_found", "找不到獲授權事項。", 404) : jsonResponse(result, status);
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("invalid_input", "請核對對象、時間、原因及確認範圍。", 400);
    if (error instanceof FamilyError) return apiError(error.code, error.status === 409 ? "事項版本或終態已改變，請重新讀取並核對。" : "事項或權限無效。", error.status);
    throw error;
  }
}
