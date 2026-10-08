import type { Pool } from "pg";
import { z } from "zod";
import type { PersonalLibraryPage } from "../src/shared/personal-library.ts";
import { FamilyError, READ_ROLES, withChildAccess } from "./family-access.ts";
import { createKnowledgeStore } from "./knowledge-store.ts";
import type { StorageCipher } from "./storage-crypto.ts";
import { apiError, jsonResponse } from "./workspace-api.ts";

const cursorSchema = z.object({
  v: z.literal(1), userId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), childId: z.uuid(),
  accessVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  afterSourceId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
}).strict();
export function createPersonalLibrary(pool: Pool, cipher: StorageCipher) {
  const knowledge = createKnowledgeStore(pool);
  function decode(raw: string | null, userId: string, childId: string) {
    if (raw === null) return null;
    try {
      if (!/^[A-Za-z0-9_-]{1,2048}$/.test(raw)) throw new Error();
      const bytes = Buffer.from(raw, "base64url");
      if (bytes.toString("base64url") !== raw) throw new Error();
      const value = cursorSchema.parse(JSON.parse(cipher.decrypt(bytes.toString("utf8"), "personal-library-cursor:1:" + userId)));
      if (value.userId !== userId || value.childId !== childId) throw new Error();
      return value;
    } catch { throw new FamilyError(400, "invalid_cursor"); }
  }
  return {
    async page(userId: string, childId: string, rawCursor: string | null = null): Promise<PersonalLibraryPage | null> {
      const cursor = decode(rawCursor, userId, childId);
      return withChildAccess(pool, userId, childId, READ_ROLES, async (client, _role, workspaceId) => {
        const space = (await client.query<{ access_version: number }>("SELECT access_version FROM workspaces WHERE id=$1", [workspaceId])).rows[0];
        if (!space) return null;
        if (cursor && cursor.accessVersion !== space.access_version) throw new FamilyError(409, "library_scope_changed");
        const page = await knowledge.catalog(cursor?.afterSourceId ?? null, client);
        const nextCursor = page.nextSourceId === null ? null : Buffer.from(cipher.encrypt(JSON.stringify({
          v: 1, userId, childId, accessVersion: space.access_version, afterSourceId: page.nextSourceId,
        }), "personal-library-cursor:1:" + userId)).toString("base64url");
        return { items: page.items, nextCursor, complete: nextCursor === null };
      });
    },
  };
}
export type PersonalLibrary = ReturnType<typeof createPersonalLibrary>;
export async function handlePersonalLibraryRequest(request: Request, userId: string | null, options: {
  library: PersonalLibrary; isCurrentUser(userId: string): Promise<boolean>;
}): Promise<Response> {
  if (!userId) return apiError("unauthorized", "請先登入。", 401);
  const expected = request.headers.get("x-expected-user-id");
  if (!expected) return apiError("account_precondition_required", "請重新確認登入帳號。", 428);
  if (expected !== userId || !await options.isCurrentUser(userId)) return apiError("session_changed", "登入帳號已改變。", 409);
  const url = new URL(request.url), match = /^\/api\/children\/([a-f0-9-]{36})\/library$/i.exec(url.pathname);
  if (!match || !z.uuid().safeParse(match[1]).success) return apiError("not_found", "找不到資料。", 404);
  if (request.method !== "GET") return apiError("method_not_allowed", "不支援此操作。", 405);
  try {
    if ([...url.searchParams.keys()].some(key => key !== "cursor") || url.searchParams.getAll("cursor").length > 1)
      throw new FamilyError(400, "invalid_input");
    const page = await options.library.page(userId, match[1].toLowerCase(), url.searchParams.get("cursor"));
    if (!await options.isCurrentUser(userId)) return apiError("session_changed", "登入帳號已改變。", 409);
    return page ? jsonResponse(page) : apiError("not_found", "沒有可讀取的參考目錄。", 404);
  } catch (error) {
    if (error instanceof FamilyError) return apiError(error.code, "資料範圍已改變，請重新讀取。", error.status);
    if (error instanceof z.ZodError) return apiError("invalid_input", "請重新讀取參考目錄。", 400);
    return apiError("library_unavailable", "暫時讀不到參考目錄，請稍後重新讀取。", 503);
  }
}
