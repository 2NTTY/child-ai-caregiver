/** Only credentials live in this port; business data and operation outcomes stay on the Server. */
export interface NativeCredentialStore {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  remove(): Promise<void>;
}
export interface NativeSessionExchange {
  exchange(idToken: string, expectedUserId: string, signal: AbortSignal): Promise<void>;
}
interface Credential { credential: string; expiresAtMs: number }
const prefix = "yuban-native-v1.";
function valid(value: unknown): value is Credential {
  if (!value || typeof value !== "object") return false;
  const v = value as Credential;
  return typeof v.credential === "string" && v.credential.startsWith(prefix) && v.credential.length <= 16 * 1024 + prefix.length
    && v.credential.length > prefix.length && /^[A-Za-z0-9._~-]+$/.test(v.credential)
    && Number.isSafeInteger(v.expiresAtMs) && v.expiresAtMs > 0;
}
function unavailable() { return new Error("Native session unavailable"); }

export function createNativeSessionTransport(options: { apiBaseUrl: string; store: NativeCredentialStore; fetcher: typeof fetch; clock?: () => number }) {
  const base = new URL(options.apiBaseUrl), now = options.clock ?? Date.now;
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash || !["/api", "/api/"].includes(base.pathname)) throw unavailable();
  let generation = 0;
  let storageQueue: Promise<unknown> = Promise.resolve();
  function storage<T>(operation: () => Promise<T>): Promise<T> {
    const pending = storageQueue.then(operation);
    storageQueue = pending.catch(() => {});
    return pending;
  }
  async function read() {
    return storage(async () => {
      const text = await options.store.read();
      if (text === null) return null;
      let value: unknown;
      try { value = JSON.parse(text); } catch { throw unavailable(); }
      if (!valid(value)) throw unavailable();
      if (value.expiresAtMs <= now()) { await options.store.remove(); return null; }
      return value;
    });
  }
  const clear = async () => { generation++; await storage(() => options.store.remove()); };
  function target(input: RequestInfo | URL) {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, base);
    if (url.origin !== base.origin || url.username || url.password || url.hash || !url.pathname.startsWith("/api/")
      || url.pathname === "/api/admin" || url.pathname.startsWith("/api/admin/")) throw unavailable();
    return url.href;
  }
  function headersFor(input: RequestInfo | URL, init?: RequestInit) {
    const headers = new Headers(init?.headers ?? (typeof input === "object" && "headers" in input ? input.headers : undefined));
    if (["authorization", "cookie", "origin", "sec-fetch-site", "sec-fetch-mode", "sec-fetch-dest"].some(key => headers.has(key))) throw unavailable();
    return headers;
  }
  async function send(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    const url = target(input), headers = headersFor(input, init), ticket = generation;
    const credential = await read();
    if (ticket !== generation || init.signal?.aborted) throw unavailable();
    if (credential) headers.set("Authorization", "Bearer " + credential.credential);
    const original = typeof input === "object" && "headers" in input ? input : undefined;
    const response = await options.fetcher(original ? new Request(url, original) : url,
      { ...init, headers, credentials: "omit", redirect: "error", cache: "no-store" });
    if (ticket !== generation || init.signal?.aborted) { await response.body?.cancel(); throw unavailable(); }
    if (response.redirected || response.url && new URL(response.url).origin !== base.origin) { await response.body?.cancel(); throw unavailable(); }
    if (new URL(url).pathname === "/api/auth/sign-out" && response.ok) await clear();
    return response;
  }
  return {
    fetcher: send as typeof fetch,
    clear,
    async exchange(idToken: string, expectedUserId: string, signal: AbortSignal) {
      const ticket = generation;
      const response = await send(base.origin + "/api/auth/native-session", { method: "POST", signal,
        headers: { "Content-Type": "application/json", "x-expected-user-id": expectedUserId }, body: JSON.stringify({ idToken }) });
      if (!response.ok) {
        // The caller maps only fixed error codes; never expose response prose or tokens.
        let code: string | null = null;
        try { const body = await response.json(); if (["invitation_required", "EMAIL_NOT_VERIFIED"].includes(body?.code)) code = body.code; } catch { /* No response disclosure. */ }
        throw Object.assign(unavailable(), { status: response.status, code });
      }
      const value: unknown = await response.json();
      if (!valid(value) || value.expiresAtMs <= now() || !("user" in value) || !value.user || typeof value.user !== "object"
        || !("id" in value.user) || value.user.id !== expectedUserId || response.headers.has("set-cookie")) throw unavailable();
      if (signal.aborted || ticket !== generation) throw unavailable();
      await storage(async () => {
        if (signal.aborted || ticket !== generation) throw unavailable();
        await options.store.write(JSON.stringify({ credential: value.credential, expiresAtMs: value.expiresAtMs }));
        if (signal.aborted || ticket !== generation) { await options.store.remove(); throw unavailable(); }
      });
    },
  };
}
