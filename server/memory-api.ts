import { z } from "zod";
import type { MemoryStore } from "./memory.ts";
import { FamilyError } from "./family-access.ts";
import { apiError, jsonResponse } from "./workspace-api.ts";
import { factCreateSchema, factConfirmSchema, factReviseSchema, factDeactivateSchema, memoryDeleteSchema,
  topicCreateSchema, topicChangeSchema, topicReopenSchema } from "./memory-validation.ts";

export async function handleMemoryRequest(request: Request, userId: string | null, store: MemoryStore): Promise<Response> {
  if (!userId) return apiError("unauthorized", "請先登入。", 401);
  if (request.method === "POST") {
    const expected = request.headers.get("x-expected-user-id");
    if (!expected) return apiError("account_precondition_required", "請重新確認登入帳號。", 428);
    if (expected !== userId) return apiError("session_changed", "登入帳號已改變。", 409);
  }
  const url = new URL(request.url);
  const match = /^\/api\/children\/([^/]+)\/memory\/(facts|topics|summary)(?:\/([^/]+))?(?:\/([^/]+))?$/u.exec(url.pathname);
  if (!match || !z.uuid().safeParse(match[1]).success) return apiError("not_found", "找不到資料。", 404);
  const [, childId, section, id, action] = match;
  try {
    let result: unknown = null, status = 200;
    if (request.method === "GET") {
      if (!id && section === "summary") {
        const value = await store.summary(userId, childId); if (value) result = value;
      } else if (!id) {
        const after = url.searchParams.has("afterId") ? z.uuid().parse(url.searchParams.get("afterId")) : undefined;
        result = section === "facts" ? await store.facts(userId, childId, after) : await store.topics(userId, childId, after);
      } else if (z.uuid().safeParse(id).success && action === "history" && section !== "summary") {
        const before = url.searchParams.has("beforeVersion") ? z.coerce.number().int().positive().max(2147483647).parse(url.searchParams.get("beforeVersion")) : undefined;
        result = await store.history(userId, childId, section as "facts" | "topics", id, before);
      }
    } else if (request.method === "POST") {
      if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") return apiError("unsupported_media_type", "請以 JSON 提交資料。", 415);
      let body: unknown; try { body = await request.json(); } catch { return apiError("invalid_json", "請檢查輸入資料。", 400); }
      if (!id && section === "facts") { const fact = await store.createFact(userId, childId, factCreateSchema.parse(body)); if (fact) { result = { fact }; status = 201; } }
      else if (!id && section === "topics") { const topic = await store.createTopic(userId, childId, topicCreateSchema.parse(body)); if (topic) { result = { topic }; status = 201; } }
      else if (z.uuid().safeParse(id).success && section === "facts") {
        let fact;
        if (action === "confirm") fact = await store.confirmFact(userId, childId, id, factConfirmSchema.parse(body));
        else if (action === "revise") fact = await store.reviseFact(userId, childId, id, factReviseSchema.parse(body));
        else if (action === "deactivate") fact = await store.deactivateFact(userId, childId, id, factDeactivateSchema.parse(body));
        else if (action === "delete") { const input = memoryDeleteSchema.parse(body); if (await store.delete(userId, childId, section, id, input.expectedVersion)) result = { deleted: true }; }
        if (fact) result = { fact };
      } else if (z.uuid().safeParse(id).success && section === "topics") {
        let topic;
        if (action === "change") topic = await store.changeTopic(userId, childId, id, topicChangeSchema.parse(body));
        else if (action === "reopen") topic = await store.reopenTopic(userId, childId, id, topicReopenSchema.parse(body));
        else if (action === "delete") { const input = memoryDeleteSchema.parse(body); if (await store.delete(userId, childId, section, id, input.expectedVersion)) result = { deleted: true }; }
        if (topic) result = { topic };
      }
    } else return apiError("method_not_allowed", "不支援此操作。", 405);
    return result === null ? apiError("not_found", "找不到獲授權資料。", 404) : jsonResponse(result, status);
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("invalid_input", "請核對內容、來源、版本及確認範圍。", 400);
    if (error instanceof FamilyError) return apiError(error.code, error.status === 409 ? "資料或來源已改變，請保留輸入並重新核對。" : "資料或權限無效。", error.status);
    throw error;
  }
}
