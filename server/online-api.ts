import { z } from "zod";
import { FamilyError } from "./family-access.ts";
import { apiError, jsonResponse } from "./workspace-api.ts";
import { onlineCommandSchema, onlineSubmissionSchema } from "./online-routing.ts";
import type { OnlineStore } from "./online.ts";

export async function handleOnlineRequest(request: Request, userId: string | null, store: Pick<OnlineStore, 'spaces' | 'context' | 'submit' | 'lookup' | 'changes'>): Promise<Response> {
  if (!userId) return apiError("unauthorized", "請先登入。", 401);
  if (!request.headers.get("x-expected-user-id")) return apiError("account_precondition_required", "請重新確認登入帳號。", 428);
  if (request.headers.get("x-expected-user-id") !== userId) return apiError("session_changed", "登入帳號已改變。", 409);
  const url = new URL(request.url);
  try {
    if (request.method === "GET") {
      if (url.pathname === "/api/online/spaces") return jsonResponse({ workspaces: await store.spaces(userId) });
      const lookup = /^\/api\/online\/operations\/([^/]+)$/u.exec(url.pathname);
      if (lookup) return jsonResponse(await store.lookup(userId, z.uuid().parse(lookup[1])));
      if (url.pathname === "/api/online/changes") {
        const input = z.object({ workspaceId: z.uuid(), storageEpoch: z.uuid(), cursor: z.string().regex(/^(0|[1-9][0-9]{0,18})$/u)
          .refine(value => BigInt(value) <= 9223372036854775807n) }).strict().parse(Object.fromEntries(url.searchParams));
        return jsonResponse(await store.changes(userId, input.workspaceId, input.storageEpoch, input.cursor));
      }
    }
    if (request.method === "POST" && ["/api/online/context", "/api/online/submit"].includes(url.pathname)) {
      if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") return apiError("unsupported_media_type", "請以 JSON 提交。", 415);
      let body: unknown; try { body = await request.json(); } catch { return apiError("invalid_json", "無效輸入。", 400); }
      if (url.pathname.endsWith("/context")) return jsonResponse(await store.context(userId, onlineCommandSchema.parse(body)));
      const result = await store.submit(userId, onlineSubmissionSchema.parse(body));
      return result instanceof Response ? result : jsonResponse(result);
    }
    return apiError("not_found", "找不到資料。", 404);
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("invalid_input", "請核對操作識別、版本及內容。", 400);
    if (error instanceof FamilyError) return apiError(error.code, error.status === 409
      ? "資料、操作或 Server 世代已改變；請保留輸入並重新核對，勿直接重建操作。" : "找不到獲授權資料。", error.status);
    throw error;
  }
}
