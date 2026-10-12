import { z } from "zod";
import { concernChangeSchema, concernValuesSchema } from "../src/shared/concerns.ts";
import type { ConcernStore } from "./concern-store.ts";
import { FirestoreDomainError } from "./firestore-domain-data.ts";
import { FirestoreAuthorityError } from "./firestore-authority.ts";
import { FamilyError } from "./family-access.ts";
import { apiError, jsonResponse } from "./workspace-api.ts";
const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const route = new RegExp("^/api/children/(" + uuid + ")/concerns(?:/(" + uuid + ")/actions)?$", "i");
const createSchema = z.object({ opId: z.uuid(), confirmShared: z.literal(true), values: concernValuesSchema }).strict();
const changeSchema = z.object({ opId: z.uuid(), confirmShared: z.literal(true), change: concernChangeSchema }).strict();
export async function handleConcernRequest(request: Request, userId: string | null, store: Pick<ConcernStore, "list" | "create" | "change">, isCurrentUser: (userId: string) => Promise<boolean>): Promise<Response> {
  if (!userId) return apiError("unauthorized", "請先登入。", 401);
  const expected = request.headers.get("x-expected-user-id");
  if (!expected) return apiError("account_precondition_required", "請重新確認登入帳號。", 428);
  if (expected !== userId || !await isCurrentUser(userId)) return apiError("session_changed", "登入帳號已改變。", 409);
  const match = route.exec(new URL(request.url).pathname);
  if (!match) return apiError("not_found", "找不到持續關注。", 404);
  try {
    const childId = match[1].toLowerCase(), id = match[2]?.toLowerCase();
    if (request.method === "GET" && !id) {
      const page = await store.list(userId, childId);
      return page && await isCurrentUser(userId) ? jsonResponse({ page }) : apiError("not_found", "沒有可讀取的資料。", 404);
    }
    if (request.method !== "POST") return apiError("method_not_allowed", "不支援此操作。", 405);
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return apiError("unsupported_media_type", "請以 JSON 提交。", 415);
    let raw: unknown;
    try { raw = await request.json(); } catch { return apiError("invalid_json", "請核對輸入。", 400); }
    const parsed = id ? changeSchema.parse(raw) : createSchema.parse(raw);
    const item = "change" in parsed ? await store.change(userId, childId, id!, parsed.change, parsed.opId)
      : await store.create(userId, childId, parsed.values, parsed.opId);
    return item && await isCurrentUser(userId) ? jsonResponse({ item }) : apiError("not_found", "資料或權限已改變。", 404);
  } catch (error) {
    if (error instanceof FamilyError || error instanceof FirestoreDomainError || error instanceof FirestoreAuthorityError) return apiError(error.code, error.status === 409 ? "關注版本或原操作已改變，請重新核對。" : "請核對資料與權限。", error.status);
    if (error instanceof z.ZodError) return apiError("invalid_input", "請核對輸入及家庭共享確認。", 400);
    return apiError("concern_unavailable", "未能確認結果，請先重新讀取原關注，再重試原操作。", 503);
  }
}
