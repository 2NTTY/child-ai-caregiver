import type { WorkspaceStore } from "./workspaces.ts";

export function jsonResponse(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}

export function apiError(code: string, message: string, status: number): Response {
  return jsonResponse({ error: { code, message } }, status);
}

/** userId must come from a freshly checked server session, never request input. */
export async function handleWorkspaceRequest(request: Request, userId: string | null, store: WorkspaceStore): Promise<Response> {
  if (!userId) return apiError("unauthorized", "請先登入。", 401);
  const pathname = new URL(request.url).pathname;
  if (pathname === "/api/workspaces") {
    if (request.method === "GET") return jsonResponse({ workspaces: await store.listForUser(userId) });
    if (request.method === "POST") return jsonResponse({ workspace: await store.ensureForUser(userId) });
    return apiError("method_not_allowed", "不支援此操作。", 405);
  }
  const id = pathname.slice("/api/workspaces/".length);
  if (request.method !== "GET") return apiError("method_not_allowed", "不支援此操作。", 405);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return apiError("not_found", "找不到資料。", 404);
  }
  const workspace = await store.getForUser(userId, id);
  return workspace ? jsonResponse({ workspace }) : apiError("not_found", "找不到資料。", 404);
}
