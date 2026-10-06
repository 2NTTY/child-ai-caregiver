import { z } from "zod";
import { documentChangeSchema, documentExportSchema, documentRequestSchema } from "../src/shared/family-documents.ts";
import type { FamilyDocumentStore } from "./family-document-store.ts";
import { renderFamilyDocumentPdf } from "./family-document-pdf.ts";
import { FamilyError } from "./family-access.ts";
import { apiError, jsonResponse } from "./workspace-api.ts";
const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const route = new RegExp("^/api/children/(" + uuid + ")/documents(?:/(" + uuid + ")(?:/(actions|pdf))?)?$", "i");
const createSchema = z.object({ opId: z.uuid(), request: documentRequestSchema }).strict();
const changeSchema = z.object({ opId: z.uuid(), change: documentChangeSchema }).strict();
export async function handleFamilyDocumentRequest(request: Request, userId: string | null, store: FamilyDocumentStore,
  isCurrentUser: (userId: string) => Promise<boolean>): Promise<Response> {
  if (!userId) return apiError("unauthorized", "請先登入。", 401);
  const expected = request.headers.get("x-expected-user-id");
  if (!expected) return apiError("account_precondition_required", "請重新確認登入帳號。", 428);
  if (expected !== userId || !await isCurrentUser(userId)) return apiError("session_changed", "登入帳號已改變。", 409);
  const match = route.exec(new URL(request.url).pathname);
  if (!match) return apiError("not_found", "找不到文件。", 404);
  try {
    const childId = match[1].toLowerCase(), id = match[2]?.toLowerCase(), action = match[3];
    if (request.method === "GET" && !action) {
      if (id) {
        const item = await store.get(userId, childId, id);
        return item && await isCurrentUser(userId) ? jsonResponse({ item }) : apiError("not_found", "沒有可讀取的文件。", 404);
      }
      const page = await store.list(userId, childId);
      return page && await isCurrentUser(userId) ? jsonResponse({ page }) : apiError("not_found", "沒有可讀取的文件。", 404);
    }
    if (request.method !== "POST" || id && !action) return apiError("method_not_allowed", "不支援此操作。", 405);
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return apiError("unsupported_media_type", "請以 JSON 提交。", 415);
    let raw: unknown;
    try { raw = await request.json(); } catch { return apiError("invalid_json", "請核對輸入。", 400); }
    if (action === "pdf") {
      const input = documentExportSchema.parse(raw), snapshot = await store.exportSnapshot(userId, childId, id!, input);
      if (!snapshot) return apiError("not_found", "沒有可匯出的快照。", 404);
      // PDF formatting can be slow; no family lock is held while rendering.
      const bytes = await renderFamilyDocumentPdf(snapshot, input);
      const current = await store.exportSnapshot(userId, childId, id!, input);
      if (!current || current.sourceBasis !== snapshot.sourceBasis || current.id !== snapshot.id || current.version !== snapshot.version)
        return apiError("source_changed", "來源或版本已改變，請重新核對。", 409);
      if (!await isCurrentUser(userId)) return apiError("session_changed", "登入帳號已改變。", 409);
      return new Response(new Uint8Array(bytes), { headers: { "content-type": "application/pdf", "cache-control": "no-store",
        "content-disposition": 'attachment; filename="family-document.pdf"' } });
    }
    const parsed = id ? changeSchema.parse(raw) : createSchema.parse(raw);
    const item = "change" in parsed ? await store.change(userId, childId, id!, parsed.change, parsed.opId)
      : await store.create(userId, childId, parsed.request, parsed.opId);
    return item && await isCurrentUser(userId) ? jsonResponse({ item }) : apiError("not_found", "文件或權限已改變。", 404);
  } catch (error) {
    if (error instanceof FamilyError) return apiError(error.code, error.status === 409 ? "文件版本、來源或原操作已改變，請重新核對。" : "請核對文件與權限。", error.status);
    if (error instanceof z.ZodError) return apiError("invalid_input", "請核對文件輸入。", 400);
    return apiError("document_unavailable", "未能確認結果，請先重新讀取原文件，再重試原操作。", 503);
  }
}
