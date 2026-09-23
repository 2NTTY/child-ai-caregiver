import type { Child, RecordList, TextRecord } from "../shared/records.ts";

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

export class ClientApiError extends Error {
  readonly status: number;

  constructor(status = 0) {
    super("Server request could not be confirmed");
    this.name = "ClientApiError";
    this.status = status;
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
    && typeof value.displayName === "string" && timestamp(value.createdAt);
}

function record(value: unknown): value is TextRecord {
  return object(value) && identifier(value.id) && identifier(value.childId)
    && identifier(value.authorUserId) && typeof value.text === "string" && timestamp(value.createdAt);
}

export function createRecordsApi(baseUrl: string, fetcher: typeof fetch = fetch): RecordsApi {
  const base = baseUrl.replace(/\/$/, "");
  const apiUrl = base.endsWith("/api") ? base : `${base}/api`;

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
      if (!response.ok) throw new ClientApiError(response.status);
      return await response.json();
    } catch (error) {
      if (error instanceof ClientApiError) throw error;
      throw new ClientApiError();
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    }
  }

  return {
    async getSession(signal) {
      const value = await request("/auth/get-session", signal);
      if (value === null) return null;
      if (!object(value) || !object(value.user) || !identifier(value.user.id)
        || typeof value.user.name !== "string" || typeof value.user.email !== "string") {
        throw new ClientApiError();
      }
      return { id: value.user.id, name: value.user.name, email: value.user.email };
    },
    async authenticate(mode, input, signal) {
      await request(mode === "signUp" ? "/auth/sign-up/email" : "/auth/sign-in/email", signal,
        mode === "signUp" ? input : { email: input.email, password: input.password });
    },
    async signOut(signal) {
      await request("/auth/sign-out", signal, {});
    },
    async listChildren(signal) {
      const value = await request("/children", signal);
      if (!object(value) || !Array.isArray(value.children) || !value.children.every(child)) {
        throw new ClientApiError();
      }
      return value.children;
    },
    async createChild(displayName, signal, expectedUserId) {
      const value = await request("/children", signal, { displayName }, expectedUserId);
      if (!object(value) || !child(value.child) || value.child.displayName !== displayName) throw new ClientApiError();
      return value.child;
    },
    async deleteChild(childId, signal, expectedUserId) {
      const value = await request(`/children/${encodeURIComponent(childId)}/delete`, signal, { confirmChildId: childId }, expectedUserId);
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
      const value = await request(`/children/${encodeURIComponent(childId)}/records`, signal, { text }, expectedUserId);
      if (!object(value) || !record(value.record) || value.record.childId !== childId || value.record.text !== text) {
        throw new ClientApiError();
      }
      return value.record;
    },
  };
}
