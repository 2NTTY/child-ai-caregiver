import { resolveApiBaseUrl } from "../../../src/config/api-base-url";
import { notificationMessagesPageSchema, type NotificationMessagesPage } from "../../../src/shared/notification-messages";

export class NotificationMessagesError extends Error {
  constructor(readonly status: number, readonly code: string) { super("Message history could not be read"); }
}

/** This route is personal and read-only. A missing route is not loss of child access. */
export function createNotificationMessagesApi(baseUrl = "", fetcher: typeof fetch = fetch) {
  const base = resolveApiBaseUrl(baseUrl), url = (base.endsWith("/api") ? base : base + "/api") + "/account/messages";
  let identity: string | null = null, generation = 0;
  const active = new Set<AbortController>();
  function setIdentity(userId: string | null) {
    if (identity === userId) return;
    identity = userId; generation++;
    for (const controller of active) controller.abort();
    active.clear();
  }
  async function page(userId: string, query: { cursor?: string; scopeVersion?: string }, signal: AbortSignal): Promise<NotificationMessagesPage> {
    if (identity === null) setIdentity(userId);
    if (identity !== userId) throw new NotificationMessagesError(409, "session_changed");
    const ticket = generation, controller = new AbortController(), abort = () => controller.abort();
    active.add(controller); signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    const timer = setTimeout(abort, 20_000);
    try {
      const params = new URLSearchParams(query);
      const response = await fetcher(url + (params.size ? "?" + params : ""), {
        credentials: "include", cache: "no-store", headers: { Accept: "application/json", "x-expected-user-id": userId }, signal: controller.signal,
      });
      if (!response.ok) {
        let code = "message_history_read_failed";
        try { const body = await response.json(); if (/^[a-z_]{1,80}$/u.test(body?.error?.code)) code = body.error.code; } catch { /* Keep the HTTP result. */ }
        if ([404, 501].includes(response.status) || response.status === 503 && ["message_history_unavailable", "firebase_domain_not_ready"].includes(code))
          throw new NotificationMessagesError(503, "message_history_unavailable");
        throw new NotificationMessagesError(response.status, code === "identity_changed" ? "session_changed" : code);
      }
      const result = notificationMessagesPageSchema.safeParse(await response.json());
      if (!result.success) throw new NotificationMessagesError(502, "invalid_message_page");
      if (controller.signal.aborted || generation !== ticket || identity !== userId) throw new NotificationMessagesError(409, "session_changed");
      if (result.data.userId !== userId || query.scopeVersion && result.data.scopeVersion !== query.scopeVersion)
        throw new NotificationMessagesError(409, "messages_scope_changed");
      return result.data;
    } finally {
      clearTimeout(timer); active.delete(controller); signal.removeEventListener("abort", abort);
    }
  }
  return { setIdentity, page };
}
