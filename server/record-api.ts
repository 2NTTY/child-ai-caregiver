import { validateCreateChild, validateCreateTextRecord } from "../src/shared/inputs.ts";
import type { InputIssue } from "../src/shared/inputs.ts";
import type { RecordStore } from "./records.ts";
import { apiError, jsonResponse } from "./workspace-api.ts";

function invalidInput(issues: InputIssue[]): Response {
  return jsonResponse({ error: { code: "invalid_input", message: "請檢查輸入資料。", issues } }, 400);
}

function storageTextIssues(field: "displayName" | "text", value: string): InputIssue[] {
  // PostgreSQL cannot store NUL; UTF-8 encoding would replace lone surrogates.
  return /[\u0000\uD800-\uDFFF]/u.test(value)
    ? [{ field, code: "invalid_type", message: "輸入內容含有無法保存的字元。" }]
    : [];
}

async function readJson(request: Request): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    return { ok: false, response: apiError("unsupported_media_type", "請以 JSON 提交資料。", 415) };
  }
  try {
    return { ok: true, value: await request.json() };
  } catch {
    return { ok: false, response: apiError("invalid_json", "請檢查輸入資料。", 400) };
  }
}

/** userId must come from a freshly checked server session, never request input. */
export async function handleRecordRequest(request: Request, userId: string | null, store: RecordStore): Promise<Response> {
  if (!userId) return apiError("unauthorized", "請先登入。", 401);
  if (request.method === "POST") {
    const expectedUserId = request.headers.get("x-expected-user-id");
    if (!expectedUserId) return apiError("account_precondition_required", "請重新確認登入帳號後再提交。", 428);
    // This is only a rejection precondition; the session remains the authority.
    if (expectedUserId !== userId) return apiError("session_changed", "登入帳號已改變，尚未保存。請重新登入原帳號。", 409);
  }
  const pathname = new URL(request.url).pathname;
  if (pathname === "/api/children") {
    if (request.method === "GET") return jsonResponse({ children: await store.listChildrenForUser(userId) });
    if (request.method !== "POST") return apiError("method_not_allowed", "不支援此操作。", 405);
    const body = await readJson(request);
    if (!body.ok) return body.response;
    const input = validateCreateChild(body.value);
    if (!input.ok) return invalidInput(input.issues);
    const encodingIssues = storageTextIssues("displayName", input.value.displayName);
    if (encodingIssues.length) return invalidInput(encodingIssues);
    return jsonResponse({ child: await store.createChildForUser(userId, input.value) }, 201);
  }

  const deletion = /^\/api\/children\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/delete$/i.exec(pathname);
  if (deletion) {
    if (request.method !== "POST") return apiError("method_not_allowed", "不支援此操作。", 405);
    const body = await readJson(request);
    if (!body.ok) return body.response;
    const value = body.value;
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 1
      || (value as Record<string, unknown>).confirmChildId !== deletion[1]) {
      return apiError("invalid_input", "請先確認要刪除的孩子及全部相關資料。", 400);
    }
    const deleted = await store.deleteChildForUser(userId, deletion[1]!);
    return deleted ? jsonResponse({ deleted: true, childId: deletion[1] }) : apiError("not_found", "找不到資料。", 404);
  }

  const match = /^\/api\/children\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/records$/i.exec(pathname);
  if (!match) return apiError("not_found", "找不到資料。", 404);
  const childId = match[1]!;
  if (request.method === "GET") {
    const result = await store.listRecordsForUser(userId, childId);
    return result ? jsonResponse(result) : apiError("not_found", "找不到資料。", 404);
  }
  if (request.method !== "POST") return apiError("method_not_allowed", "不支援此操作。", 405);
  // Check access before parsing input and recheck it in the INSERT itself.
  if (!await store.getChildForUser(userId, childId)) return apiError("not_found", "找不到資料。", 404);
  const body = await readJson(request);
  if (!body.ok) return body.response;
  const value = body.value;
  const input = validateCreateTextRecord(value !== null && typeof value === "object" && !Array.isArray(value)
    ? { childId, text: (value as Record<string, unknown>).text }
    : value);
  if (!input.ok) return invalidInput(input.issues);
  const encodingIssues = storageTextIssues("text", input.value.text);
  if (encodingIssues.length) return invalidInput(encodingIssues);
  const record = await store.createRecordForUser(userId, input.value);
  return record ? jsonResponse({ record }, 201) : apiError("not_found", "找不到資料。", 404);
}
