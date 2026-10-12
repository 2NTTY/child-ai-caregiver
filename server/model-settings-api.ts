import { apiError, jsonResponse } from "./workspace-api.ts";
import { ModelSettingsError } from "./model-settings-contract.ts";
import { parseModelSettingsCommand } from "./model-settings.ts";
import type { ModelRouting } from "./model-routing.ts";

export async function handleModelSettingsRequest(request: Request, userId: string | null, routing: Pick<ModelRouting, 'view' | 'settings' | 'check'>): Promise<Response> {
  if (!userId) return apiError("unauthorized", "請先登入。", 401);
  if (request.headers.get("x-expected-user-id") !== userId) return apiError("session_changed", "登入身份已改變，請重新讀取。", 403);
  const path = new URL(request.url).pathname;
  try {
    if (request.method === "GET" && path === "/api/ai/settings") return jsonResponse(await routing.view(userId));
    if (request.method !== "POST") return apiError("not_found", "找不到此服務。", 404);
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw new ModelSettingsError("invalid_input");
    let input: unknown;
    try { input = await request.json(); } catch { throw new ModelSettingsError("invalid_input"); }
    if (path === "/api/ai/settings") {
      return jsonResponse(await routing.settings.save(userId, parseModelSettingsCommand(input)));
    }
    if (path === "/api/ai/settings/check") {
      if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== 1
        || !("expectedVersion" in input) || !Number.isSafeInteger(input.expectedVersion) || (input.expectedVersion as number) < 0) throw new ModelSettingsError("invalid_input");
      return jsonResponse(await routing.check(userId, input.expectedVersion as number, request.signal));
    }
    return apiError("not_found", "找不到此服務。", 404);
  } catch (error) {
    if (error instanceof ModelSettingsError) return apiError(error.code,
      error.code === "version_conflict" ? "設定已改變，請重新讀取後再操作。" : "未能完成模型設定，請核對輸入或稍後再試。", error.status);
    return apiError("service_unavailable", "模型設定暫時未能處理。", 503);
  }
}
