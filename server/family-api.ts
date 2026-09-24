import { z } from "zod";
import type { FamilyStore } from "./families.ts";
import type { RecordStore } from "./records.ts";
import { FamilyError } from "./family-access.ts";
import { apiError, jsonResponse } from "./workspace-api.ts";
import { validateCreateChild } from "../src/shared/inputs.ts";

const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const version = z.number().int().min(1).max(2147483646);
const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
const memberRole = z.enum(["caregiver", "viewer"]);
const clock = z.string().regex(/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/u);
const preferences = z.object({ timeZone: z.string().max(100).refine(value => {
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
}), quietStart: clock, quietEnd: clock, allowAppointmentDuringQuiet: z.boolean(), expectedVersion: z.number().int().min(0).max(2147483646) }).strict()
  .refine(value => value.quietStart !== value.quietEnd);

export async function handleFamilyRequest(request: Request, userId: string | null, store: FamilyStore,
  records: Pick<RecordStore, "createChildForUser">): Promise<Response> {
  if (!userId) return apiError("unauthorized", "請先登入。", 401);
  if (request.method === "POST") {
    const expected = request.headers.get("x-expected-user-id");
    if (!expected) return apiError("account_precondition_required", "請重新確認登入帳號後提交。", 428);
    if (expected !== userId) return apiError("session_changed", "登入帳號已改變。", 409);
  }
  const path = new URL(request.url).pathname;
  try {
    if (request.method === "GET") {
      if (path === "/api/families") return jsonResponse({ families: await store.list(userId) });
      if (path === "/api/notification-preferences") return jsonResponse({ preferences: await store.preferences(userId) });
      return apiError("not_found", "找不到資料。", 404);
    }
    if (request.method !== "POST") return apiError("method_not_allowed", "不支援此操作。", 405);
    if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
      return apiError("unsupported_media_type", "請以 JSON 提交資料。", 415);
    }
    let body: unknown;
    try { body = await request.json(); } catch { return apiError("invalid_json", "請檢查輸入資料。", 400); }
    if (path === "/api/notification-preferences") {
      const input = preferences.parse(body), { expectedVersion, ...values } = input;
      return jsonResponse({ preferences: await store.savePreferences(userId, values, expectedVersion) });
    }
    if (path === "/api/families/invitations/preview") {
      const input = z.object({ token }).strict().parse(body);
      return jsonResponse({ invitation: await store.preview(userId, input.token) });
    }
    if (path === "/api/families/invitations/accept") {
      const input = z.object({ token, confirmWorkspaceId: z.string().regex(new RegExp(`^${uuid}$`, "i")) }).strict().parse(body);
      await store.accept(userId, input.token, input.confirmWorkspaceId);
      return jsonResponse({ joined: true });
    }
    const match = new RegExp(`^/api/families/(${uuid})/(invitations|members|children)(?:/([^/]+))?(?:/(revoke))?$`, "i").exec(path);
    if (!match) return apiError("not_found", "找不到資料。", 404);
    const [, workspaceId, section, target, action] = match;
    if (section === "invitations" && !target && !action) {
      const input = z.object({ email: z.string().trim().email().max(254), role: memberRole, expectedVersion: version }).strict().parse(body);
      return jsonResponse(await store.invite(userId, workspaceId, input.email, input.role, input.expectedVersion), 201);
    }
    if (section === "invitations" && target && new RegExp(`^${uuid}$`, "i").test(target) && action === "revoke") {
      const input = z.object({ expectedVersion: version }).strict().parse(body);
      await store.revokeInvite(userId, workspaceId, target, input.expectedVersion);
      return jsonResponse({ updated: true });
    }
    if (section === "members" && target && /^[A-Za-z0-9_-]{1,128}$/u.test(target) && !action) {
      const input = z.object({ role: z.enum(["caregiver", "viewer", "revoked"]), expectedVersion: version }).strict().parse(body);
      await store.setMember(userId, workspaceId, target, input.role, input.expectedVersion);
      return jsonResponse({ updated: true });
    }
    if (section === "children" && !target && !action) {
      const value = z.object({ displayName: z.string() }).strict().parse(body), input = validateCreateChild(value);
      if (!input.ok || /[\u0000\uD800-\uDFFF]/u.test(value.displayName)) throw new FamilyError(400, "invalid_input");
      return jsonResponse({ child: await records.createChildForUser(userId, input.value, workspaceId) }, 201);
    }
    return apiError("not_found", "找不到資料。", 404);
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("invalid_input", "請檢查輸入、角色及版本。", 400);
    if (error instanceof FamilyError) return apiError(error.code,
      error.status === 409 ? "資料或權限已改變，請重新讀取後確認。" : "找不到獲授權資料或輸入無效。", error.status);
    throw error;
  }
}
