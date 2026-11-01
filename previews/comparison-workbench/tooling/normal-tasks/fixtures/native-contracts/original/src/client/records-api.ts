import type { Child, RecordList, TextRecord } from "../shared/records.ts";
import type { OnlineReceipt } from "../shared/online.ts";
import { createOnlineTransport, OnlineTransportError } from "./online-transport.ts";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
}

export interface Credentials {
  name: string;
  email: string;
  password: string;
}

export type AuthMode = "signIn" | "signUp";

export interface RecordsIdentityAdapter {
  assertAvailable?(): void;
  authenticate(mode: AuthMode, input: Credentials, signal: AbortSignal): Promise<void>;
  observeSession(user: SessionUser | null): void;
  clearSession(): Promise<void>;
}

export class ClientApiError extends Error {
  readonly status: number;
  readonly onlineCode: string | null;
  readonly confirmed: boolean;

  constructor(status = 0, onlineCode: string | null = null, confirmed = false) {
    super("Server request could not be confirmed");
    this.name = "ClientApiError";
    this.status = status;
    this.onlineCode = onlineCode;
    this.confirmed = confirmed;
  }
}

export interface RecordsApi {
  getSession(signal: AbortSignal): Promise<SessionUser | null>;
  authenticate(mode: AuthMode, input: Credentials, signal: AbortSignal): Promise<void>;
  signOut(signal: AbortSignal): Promise<void>;
  listChildren(signal: AbortSignal): Promise<Child[]>;
  createChild(displayName: string, signal: AbortSignal, expectedUserId: string): Promise<Child>;
  deleteChild(childId: string, signal: AbortSignal, expectedUserId: string): Promise<void>;
  listRecords(childId: string, signal: AbortSignal): Promise<RecordList>;
  createRecord(childId: string, text: string, signal: AbortSignal, expectedUserId: string): Promise<TextRecord>;
  reconcilePending?(signal: AbortSignal, userId: string): Promise<OnlineReceipt | { state: "unconfirmed" } | null>;
  resetOnline?(): void;
  hasPendingOnline?(): boolean;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function identifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function timestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function child(value: unknown): value is Child {
  return object(value) && identifier(value.id) && identifier(value.workspaceId)
    && typeof value.displayName === "string" && timestamp(value.createdAt)
    && (value.accessRole === undefined || ["owner", "caregiver", "viewer"].includes(value.accessRole as string));
}

function record(value: unknown): value is TextRecord {
  return object(value) && identifier(value.id) && identifier(value.childId)
    && identifier(value.authorUserId) && typeof value.text === "string" && timestamp(value.createdAt);
}

export function createRecordsApi(baseUrl: string, fetcher: typeof fetch = fetch, identity?: RecordsIdentityAdapter): RecordsApi {
  const base = baseUrl.replace(/\/$/, "");
  const apiUrl = base.endsWith("/api") ? base : `${base}/api`;
  const online = createOnlineTransport(apiUrl, fetcher);
  let observedUserId: string | null = null;

  async function onlineCall<T>(signal: AbortSignal, action: (outerSignal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) controller.abort();
    const timeout = setTimeout(abort, 20_000);
    try { return await action(controller.signal); }
    catch (error) {
      if (error instanceof OnlineTransportError) throw new ClientApiError(error.status, error.code, error.confirmed);
      throw new ClientApiError();
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    }
  }
  function mutate(path: string, body: unknown, signal: AbortSignal, userId: string): Promise<unknown> {
    observedUserId = userId;
    return onlineCall(signal, outerSignal => online.submit({ path: `/api${path}`, payload: body }, outerSignal, userId));
  }
  function resetOnline(): void {
    online.reset(); observedUserId = null;
    if (identity) void identity.clearSession().catch(() => {});
  }

  async function request(path: string, signal: AbortSignal, body?: unknown, expectedUserId?: string): Promise<unknown> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) controller.abort();
    const timeout = setTimeout(abort, 20_000);
    try {
      const response = await fetcher(`${apiUrl}${path}`, {
        method: body === undefined ? "GET" : "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(expectedUserId === undefined ? {} : { "x-expected-user-id": expectedUserId }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
      // Remote error bodies may contain private data or infrastructure details.
      if (!response.ok) {
        let code: string | null = null;
        if (path.startsWith("/auth/")) {
          try { const value = await response.json();
            const candidate = value?.code ?? value?.error?.code;
            if (candidate === "invitation_required" || candidate === "EMAIL_NOT_VERIFIED") code = candidate;
            // Better Auth's create-user validation may return the approved invitation reason as its message.
            if (value?.message === "invitation_required") code = "invitation_required";
          } catch { /* Keep status only; never expose remote error text. */ }
        }
        throw new ClientApiError(response.status, code);
      }
      return await response.json();
    } catch (error) {
      if (error instanceof ClientApiError) throw error;
      throw new ClientApiError();
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    }
  }

  async function getSession(signal: AbortSignal): Promise<SessionUser | null> {
    identity?.assertAvailable?.();
    const value = await request("/auth/get-session", signal);
    if (signal.aborted) throw new ClientApiError();
    if (value === null) { identity?.observeSession(null); return null; }
    if (!object(value) || !object(value.user) || !identifier(value.user.id)
      || typeof value.user.name !== "string" || typeof value.user.email !== "string") {
      throw new ClientApiError();
    }
    if (observedUserId !== null && observedUserId !== value.user.id) online.reset();
    observedUserId = value.user.id;
    const user = { id: value.user.id, name: value.user.name, email: value.user.email };
    identity?.observeSession(user);
    return user;
  }

  return {
    reconcilePending: (signal, userId) => onlineCall(signal, outerSignal => online.checkPending(outerSignal, userId)),
    resetOnline,
    hasPendingOnline: () => online.hasPending(),
    getSession,
    async authenticate(mode, input, signal) {
      if (identity) { await identity.authenticate(mode, input, signal); return; }
      await request(mode === "signUp" ? "/auth/sign-up/email" : "/auth/sign-in/email", signal,
        mode === "signUp" ? input : { email: input.email, password: input.password });
    },
    async signOut(signal) {
      const user = identity ? await getSession(signal) : null;
      await request("/auth/sign-out", signal, {}, user?.id);
      if (signal.aborted) throw new ClientApiError();
      if (identity) await identity.clearSession();
      online.reset(); observedUserId = null;
    },
    async listChildren(signal) {
      const userId = observedUserId, children: Child[] = [], childIds = new Set<string>(), cursors = new Set<string>();
      let path = "/children";
      while (true) {
        if (signal.aborted || observedUserId !== userId) throw new ClientApiError();
        const value = await request(path, signal, undefined, userId ?? undefined);
        if (signal.aborted || observedUserId !== userId || !object(value) || !Array.isArray(value.children)
          || !value.children.every(child)) throw new ClientApiError();
        for (const item of value.children) {
          if (childIds.has(item.id)) throw new ClientApiError();
          childIds.add(item.id); children.push(item);
        }
        // A missing cursor is the old SQL response shape; explicit null is the paged terminal response.
        if (!Object.hasOwn(value, "nextCursor") || value.nextCursor === null) return children;
        if (typeof value.nextCursor !== "string" || !value.nextCursor || /[\s\u0000-\u001f\u007f]/u.test(value.nextCursor)
          || cursors.has(value.nextCursor)) throw new ClientApiError();
        cursors.add(value.nextCursor);
        try { path = "/children?cursor=" + encodeURIComponent(value.nextCursor); }
        catch { throw new ClientApiError(); }
      }
    },
    async createChild(displayName, signal, expectedUserId) {
      const value = await mutate("/children", { displayName }, signal, expectedUserId);
      if (!object(value) || !child(value.child) || value.child.displayName !== displayName) throw new ClientApiError();
      return value.child;
    },
    async deleteChild(childId, signal, expectedUserId) {
      const value = await mutate(`/children/${encodeURIComponent(childId)}/delete`, { confirmChildId: childId }, signal, expectedUserId);
      if (!object(value) || value.deleted !== true || value.childId !== childId) throw new ClientApiError();
    },
    async listRecords(childId, signal) {
      const value = await request(`/children/${encodeURIComponent(childId)}/records`, signal);
      if (!object(value) || !Array.isArray(value.records) || !value.records.every(record)
        || !Number.isInteger(value.limit) || (value.limit as number) < 1 || (value.limit as number) > 100
        || value.records.length > (value.limit as number)
        || value.records.some((item: TextRecord) => item.childId !== childId)) {
        throw new ClientApiError();
      }
      return { records: value.records, limit: value.limit as number };
    },
    async createRecord(childId, text, signal, expectedUserId) {
      const value = await mutate(`/children/${encodeURIComponent(childId)}/records`, { text }, signal, expectedUserId);
      if (!object(value) || !record(value.record) || value.record.childId !== childId || value.record.text !== text) {
        throw new ClientApiError();
      }
      return value.record;
    },
  };
}
