import { AccountAdmissionError, type AccountAdmission } from "./account-admission.ts";
import { apiError, jsonResponse } from "./workspace-api.ts";
export interface AccountServiceApi {
  admission: AccountAdmission;
  handleData?: (request: Request, userId: string | null) => Promise<Response>;
}
export async function handleAccountServiceRequest(request: Request, userId: string | null, service: AccountServiceApi): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  try {
    if (pathname === "/api/account" && request.method === "GET") return jsonResponse(await service.admission.status(userId));
    if (pathname === "/api/account/acknowledgement" && request.method === "POST") {
      if (!userId) return apiError("unauthorized", "請先登入。", 401);
      if (request.headers.get("x-expected-user-id") !== userId) return apiError("identity_changed", "帳戶已改變，請重新讀取。", 409);
      let body: unknown;
      try { body = await request.json(); } catch { return apiError("invalid_request", "請核對提交內容。", 400); }
      return jsonResponse(await service.admission.acknowledge(userId, body));
    }
    return service.handleData ? await service.handleData(request, userId) : apiError("not_found", "找不到此服務。", 404);
  } catch (error) {
    if (error instanceof AccountAdmissionError) return apiError(error.code, "請完成邀請資格、電郵驗證及資料使用確認。", error.status);
    throw error;
  }
}
