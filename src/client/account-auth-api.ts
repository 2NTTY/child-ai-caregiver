import { ClientApiError } from "./records-api.ts";

export interface AccountIdentityAdapter {
  requestVerification(email: string, signal: AbortSignal): Promise<void>;
  requestPasswordReset(email: string, signal: AbortSignal): Promise<void>;
  resetPassword(token: string, newPassword: string, signal: AbortSignal): Promise<void>;
}

/** Provider identity operations and Server-authoritative device session revocation. */
export function createAccountAuthApi(baseUrl: string, fetcher: typeof fetch = fetch, identity?: AccountIdentityAdapter) {
  const base = baseUrl.replace(/\/$/u, "");
  const api = base.endsWith("/api") ? base : base + "/api";
  async function post(path: string, body: unknown, signal: AbortSignal, userId?: string): Promise<void> {
    try {
      const response = await fetcher(api + "/auth/" + path, { method: "POST", credentials: "include", cache: "no-store",
        signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
        headers: { "content-type": "application/json", ...(userId ? { "x-expected-user-id": userId } : {}) }, body: JSON.stringify(body) });
      if (!response.ok) throw new ClientApiError(response.status);
      await response.body?.cancel();
    } catch (error) { if (error instanceof ClientApiError) throw error; throw new ClientApiError(); }
  }
  return {
    // Success means the request was handled. It does not prove an account exists or email arrived.
    requestVerification: (email: string, signal: AbortSignal) => identity ? identity.requestVerification(email, signal) : post("send-verification-email", { email }, signal),
    requestPasswordReset: (email: string, signal: AbortSignal) => identity ? identity.requestPasswordReset(email, signal) : post("request-password-reset", { email }, signal),
    resetPassword: (token: string, newPassword: string, signal: AbortSignal) => identity ? identity.resetPassword(token, newPassword, signal) : post("reset-password", { token, newPassword }, signal),
    revokeOtherSessions: (userId: string, signal: AbortSignal) => post("revoke-other-sessions", {}, signal, userId),
  };
}
