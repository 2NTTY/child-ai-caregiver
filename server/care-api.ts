import { z } from "zod";
import type { CareStore } from "./care.ts";
import { FamilyError } from "./family-access.ts";
import { apiError, jsonResponse } from "./workspace-api.ts";
import { careCreateSchema, careReviseSchema, careSearchSchema, deleteCareSchema, profileSaveSchema } from "./care-validation.ts";

export async function handleCareRequest(request: Request, userId: string | null, store: CareStore): Promise<Response> {
  if (!userId) return apiError("unauthorized", "請先登入。", 401);
  if (request.method === "POST") {
    const expected = request.headers.get("x-expected-user-id");
    if (!expected) return apiError("account_precondition_required", "請重新確認登入帳號。", 428);
    if (expected !== userId) return apiError("session_changed", "登入帳號已改變。", 409);
  }
  const url = new URL(request.url);
  const match = /^\/api\/children\/([^/]+)\/(profile|care)(?:\/([^/]+))?(?:\/([^/]+))?$/u.exec(url.pathname);
  if (!match || !z.uuid().safeParse(match[1]).success) return apiError("not_found", "找不到資料。", 404);
  const [, childId, section, target, action] = match;
  try {
    let result: unknown = null, status = 200;
    if (request.method === "GET") {
      const before = url.searchParams.has("beforeVersion") ? z.coerce.number().int().min(1).max(2147483647).parse(url.searchParams.get("beforeVersion")) : undefined;
      if (section === "profile" && !target) {
        const profile = await store.profile(userId, childId); if (profile) result = { profile };
      } else if (section === "profile" && target === "history" && !action) result = await store.profileHistory(userId, childId, before);
      else if (section === "care" && z.uuid().safeParse(target).success && action === "history") result = await store.history(userId, childId, target, before);
    } else if (request.method === "POST") {
      if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") return apiError("unsupported_media_type", "請以 JSON 提交資料。", 415);
      let body: unknown; try { body = await request.json(); } catch { return apiError("invalid_json", "請檢查輸入資料。", 400); }
      if (section === "profile" && !target) {
        const input = profileSaveSchema.parse(body);
        const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
        if (input.data.age.kind === "birth_date" && input.data.age.date > today
          || input.data.age.kind === "approximate" && input.data.age.asOf > today) throw new FamilyError(400, "invalid_age_date");
        const profile = await store.saveProfile(userId, childId, input.data, input.expectedVersion, input.reason); if (profile) result = { profile };
      } else if (section === "profile" && target === "delete" && !action) {
        const input = deleteCareSchema.parse(body);
        const profile = await store.deleteProfile(userId, childId, input.expectedVersion); if (profile) result = { profile };
      } else if (section === "care" && target === "search" && !action) result = await store.search(userId, childId, careSearchSchema.parse(body));
      else if (section === "care" && !target) {
        const { confirmShared: _confirmed, ...input } = careCreateSchema.parse(body);
        const record = await store.create(userId, childId, input); if (record) { result = { record }; status = 201; }
      } else if (section === "care" && z.uuid().safeParse(target).success && action === "revise") {
        const { expectedVersion, reason, confirmShared: _confirmed, ...input } = careReviseSchema.parse(body);
        const record = await store.revise(userId, childId, target, input, expectedVersion, reason); if (record) result = { record };
      } else if (section === "care" && z.uuid().safeParse(target).success && action === "delete") {
        const input = deleteCareSchema.parse(body);
        if (await store.delete(userId, childId, target, input.expectedVersion)) result = { deleted: true };
      }
    } else return apiError("method_not_allowed", "不支援此操作。", 405);
    return result === null ? apiError("not_found", "找不到獲授權資料。", 404) : jsonResponse(result, status);
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("invalid_input", "請核對原文、日期、單位、版本及共享確認。", 400);
    if (error instanceof FamilyError) return apiError(error.code, error.status === 409 ? "資料已被更改，請保留本次輸入並重新核對版本。" : "資料或權限無效。", error.status);
    throw error;
  }
}
