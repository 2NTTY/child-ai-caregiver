import { z } from "zod";
import { accountEraseExecuteSchema, accountErasePrepareSchema } from "../src/shared/account-service.ts";
import { AccountServiceError } from "./account-admission.ts";
import type { AccountDataStore, AccountExportStore, AccountExportQuery } from "./account-data.ts";
import { FamilyError } from "./family-access.ts";
import { apiError, jsonResponse } from "./workspace-api.ts";
const passwordAttempts = new Map<string, { count: number; expiresAt: number }>();
function admitPasswordAttempt(userId: string) {
  const now = Date.now();
  for (const [id, entry] of passwordAttempts) if (entry.expiresAt <= now) passwordAttempts.delete(id);
  const current = passwordAttempts.get(userId);
  if (current && current.count >= 3 || !current && passwordAttempts.size >= 1000) throw new AccountServiceError(429, "erasure_password_rate_limit");
  passwordAttempts.set(userId, current ? { ...current, count: current.count + 1 } : { count: 1, expiresAt: now + 60000 });
}
export interface AccountDataServices {
  data: AccountDataStore;
  exporter: AccountExportStore;
  verifyPassword(headers: Headers, password: string): Promise<boolean>;
}
export async function handleAccountDataRequest(request: Request, userId: string | null, services: AccountDataServices): Promise<Response> {
  const url = new URL(request.url), path = url.pathname;
  try {
    const match = /^\/api\/account\/deletion\/([^/]+)$/.exec(path);
    if (request.method === "GET" && match && match[1] !== "prepare") {
      z.uuid().parse(match[1]);
      return jsonResponse(await services.data.status(match[1], request.headers.get("x-erasure-receipt") ?? ""));
    }
    if (!userId) return apiError("unauthorized", "請先登入。", 401);
    const expected = request.headers.get("x-expected-user-id");
    if (!expected) return apiError("account_precondition_required", "請重新確認登入帳號。", 428);
    if (expected !== userId) return apiError("session_changed", "登入帳號已改變。", 409);
    if (request.method === "GET" && path === "/api/account/export") {
      if ([...url.searchParams.keys()].some(key => !["section", "childId", "scopeVersion", "cursor"].includes(key))) throw new AccountServiceError(400, "invalid_input");
      return jsonResponse(await services.exporter.page(userId, Object.fromEntries(url.searchParams) as AccountExportQuery));
    }
    if (request.method !== "POST" || !["/api/account/deletion/prepare", "/api/account/delete"].includes(path)) return apiError("not_found", "找不到資料。", 404);
    if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") return apiError("unsupported_media_type", "請以 JSON 提交資料。", 415);
    const text = await request.text(); if (text.length > 4096) throw new AccountServiceError(400, "invalid_input");
    let body: unknown; try { body = JSON.parse(text); } catch { throw new AccountServiceError(400, "invalid_json"); }
    if (path === "/api/account/deletion/prepare") {
      const input = accountErasePrepareSchema.parse(body); return jsonResponse(await services.data.prepare(userId, input.operationId));
    }
    const input = accountEraseExecuteSchema.parse(body);
    const status = await services.data.status(input.operationId, input.receiptToken);
    if (status.state === "completed") return jsonResponse(status);
    admitPasswordAttempt(userId);
    if (!await services.verifyPassword(request.headers, input.password)) throw new AccountServiceError(403, "password_verification_failed");
    return jsonResponse(await services.data.execute(userId, input));
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("invalid_input", "請核對輸入及原收據。", 400);
    if (error instanceof AccountServiceError || error instanceof FamilyError) return apiError(error.code, "請重新核對帳戶、資料範圍及原收據。", error.status);
    throw error;
  }
}
