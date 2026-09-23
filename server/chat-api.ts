import type { ChatStore } from "./chat.ts";
import { apiError, jsonResponse } from "./workspace-api.ts";

const messagePath = /^\/api\/children\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/messages$/i;

function validText(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  let length = 0;
  for (const character of value) {
    const firstUnit = character.charCodeAt(0);
    if (firstUnit === 0 || (character.length === 1 && firstUnit >= 0xd800 && firstUnit <= 0xdfff)) return false;
    if (++length > 10_000) return false;
  }
  return true;
}

/** userId must come from a freshly checked server session, never request input. */
export async function handleChatRequest(request: Request, userId: string | null, store: Pick<ChatStore, "listForUser" | "createUserMessageForUser">): Promise<Response> {
  if (!userId) return apiError("unauthorized", "請先登入。", 401);
  if (request.method === "POST") {
    const expectedUserId = request.headers.get("x-expected-user-id");
    if (!expectedUserId) return apiError("account_precondition_required", "請重新確認登入帳號後再提交。", 428);
    if (expectedUserId !== userId) return apiError("session_changed", "登入帳號已改變，尚未保存。請重新登入原帳號。", 409);
  }

  const match = messagePath.exec(new URL(request.url).pathname);
  if (!match) return apiError("not_found", "找不到資料。", 404);
  const childId = match[1]!;
  if (request.method === "GET") {
    const page = await store.listForUser(userId, childId);
    return page ? jsonResponse(page) : apiError("not_found", "找不到資料。", 404);
  }
  if (request.method !== "POST") return apiError("method_not_allowed", "不支援此操作。", 405);

  // Do not inspect submitted content until the caller can read this child's chat.
  if (!await store.listForUser(userId, childId)) return apiError("not_found", "找不到資料。", 404);
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") return apiError("unsupported_media_type", "請以 JSON 提交資料。", 415);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("invalid_json", "請檢查輸入資料。", 400);
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return apiError("invalid_input", "請檢查輸入資料。", 400);
  }
  const fields = Object.keys(body);
  if (fields.length !== 1 || fields[0] !== "text") return apiError("invalid_input", "請檢查輸入資料。", 400);
  const text = (body as { text: unknown }).text;
  if (!validText(text)) return apiError("invalid_input", "請檢查輸入資料。", 400);
  const message = await store.createUserMessageForUser(userId, childId, text);
  return message ? jsonResponse({ message }, 201) : apiError("not_found", "找不到資料。", 404);
}
