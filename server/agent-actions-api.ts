import { z } from "zod";
import { agentPolicyUpdateSchema } from "../src/shared/agent-actions.ts";
import type { AgentActionsStore } from "./agent-actions-store.ts";
import { FamilyError } from "./family-access.ts";
import { apiError, jsonResponse } from "./workspace-api.ts";

const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const route = new RegExp("^/api/children/(" + uuid + ")/agent/(policy|actions|notes)(?:/(" + uuid + ")/delete)?$", "i");
const deletion = z.object({ expectedVersion: z.number().int().positive().max(2147483646),
  operationId: z.uuid(), confirmDelete: z.literal(true) }).strict();
export async function handleAgentActionsRequest(request: Request, userId: string | null,
  store: AgentActionsStore, isCurrentUser: (userId: string) => Promise<boolean>): Promise<Response> {
  if (!userId) return apiError("unauthorized", "請先登入。", 401);
  const expected = request.headers.get("x-expected-user-id");
  if (!expected) return apiError("account_precondition_required", "請重新確認登入帳號。", 428);
  if (expected !== userId || !await isCurrentUser(userId)) return apiError("session_changed", "登入帳號已改變。", 409);
  const url = new URL(request.url), match = route.exec(url.pathname);
  if (!match) return apiError("not_found", "找不到資料。", 404);
  const childId = match[1].toLowerCase(), kind = match[2].toLowerCase(), noteId = match[3]?.toLowerCase();
  const respond = async (value: unknown, field: string) => value !== null && await isCurrentUser(userId)
    ? jsonResponse({ [field]: value }) : apiError("not_found", "找不到可讀取的資料。", 404);
  try {
    if (request.method === "GET" && !noteId) {
      if (kind === "policy") return respond(await store.policy(userId, childId), "policy");
      if (kind === "actions") {
        const runId = z.uuid().parse(url.searchParams.get("runId"));
        return respond(await store.receipts(userId, childId, runId), "receipts");
      }
      const query = z.string().max(200).parse(url.searchParams.get("query") ?? "");
      const afterId = url.searchParams.has("afterId") ? z.uuid().parse(url.searchParams.get("afterId")) : undefined;
      return respond(await store.notes(userId, childId, query, afterId), "notes");
    }
    if (request.method !== "POST" || kind !== "policy" && !(kind === "notes" && noteId))
      return apiError("method_not_allowed", "不支援此操作。", 405);
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json")
      return apiError("unsupported_media_type", "請以 JSON 提交。", 415);
    let body: unknown;
    try { body = await request.json(); } catch { return apiError("invalid_json", "請檢查輸入。", 400); }
    if (kind === "policy" && !noteId)
      return respond(await store.savePolicy(userId, childId, agentPolicyUpdateSchema.parse(body)), "policy");
    if (kind === "notes" && noteId)
      return respond(await store.deleteNote(userId, childId, noteId, deletion.parse(body)), "deleted");
    return apiError("not_found", "找不到資料。", 404);
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("invalid_input", "請核對輸入及原操作。", 400);
    if (error instanceof FamilyError) return apiError(error.code,
      error.status === 409 ? "資料、授權或版本已改變，請重新讀取。" : "無法處理此操作，請核對權限。", error.status);
    return apiError("operation_unknown", "未能確認操作結果，請查核原操作；不要另建重複提交。", 503);
  }
}
