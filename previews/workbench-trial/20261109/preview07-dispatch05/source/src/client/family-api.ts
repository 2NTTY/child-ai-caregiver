import type { FamilyInvitation, FamilySpace, InvitationPreview, MemberRole, NotificationPreferences } from "../shared/family.ts";
import type { Child } from "../shared/records.ts";
import type { OnlineReceipt } from "../shared/online.ts";
import { createOnlineTransport, OnlineTransportError } from "./online-transport.ts";

export class FamilyApiError extends Error {
  readonly status: number;
  readonly onlineCode: string | null;
  readonly confirmed: boolean;
  constructor(status = 0, onlineCode: string | null = null, confirmed = false) {
    super("Family request could not be confirmed");
    this.name = "FamilyApiError";
    this.status = status;
    this.onlineCode = onlineCode;
    this.confirmed = confirmed;
  }
}

export interface FamilyApi {
  getSession(signal: AbortSignal): Promise<string | null>;
  listFamilies(signal: AbortSignal): Promise<FamilySpace[]>;
  getPreferences(signal: AbortSignal): Promise<NotificationPreferences>;
  savePreferences(input: Omit<NotificationPreferences, "version"> & { expectedVersion: number }, signal: AbortSignal, userId: string): Promise<NotificationPreferences>;
  createInvitation(familyId: string, email: string, role: MemberRole, expectedVersion: number, signal: AbortSignal, userId: string): Promise<{ invitation: FamilyInvitation; token: string }>;
  revokeInvitation(familyId: string, inviteId: string, expectedVersion: number, signal: AbortSignal, userId: string): Promise<void>;
  changeMember(familyId: string, memberUserId: string, role: MemberRole | "revoked", expectedVersion: number, signal: AbortSignal, userId: string): Promise<void>;
  previewInvitation(token: string, signal: AbortSignal, userId: string): Promise<InvitationPreview>;
  acceptInvitation(token: string, confirmWorkspaceId: string, signal: AbortSignal, userId: string): Promise<void>;
  createChild(familyId: string, displayName: string, signal: AbortSignal, userId: string): Promise<Child>;
  reconcilePending?(signal: AbortSignal, userId: string): Promise<OnlineReceipt | { state: "unconfirmed" } | null>;
  resetOnline?(): void;
  hasPendingOnline?(): boolean;
}

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const version = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const role = (value: unknown): value is MemberRole => value === "caregiver" || value === "viewer";
const date = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
const hhmm = (value: unknown): value is string => typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const member = (value: unknown): boolean => object(value) && id(value.userId) && typeof value.name === "string" && (value.role === "owner" || role(value.role));
const invitation = (value: unknown): value is FamilyInvitation => object(value) && id(value.id) && typeof value.email === "string" && role(value.role) && date(value.expiresAt) && ["pending", "accepted", "revoked", "expired"].includes(String(value.status));
const family = (value: unknown): value is FamilySpace => object(value) && id(value.id) && typeof value.ownerName === "string" && (value.role === "owner" || role(value.role)) && version(value.version) && Array.isArray(value.members) && value.members.every(member) && Array.isArray(value.invitations) && value.invitations.every(invitation);
const preferences = (value: unknown): value is NotificationPreferences => object(value) && typeof value.timeZone === "string" && value.timeZone.length > 0 && hhmm(value.quietStart) && hhmm(value.quietEnd) && typeof value.allowAppointmentDuringQuiet === "boolean" && version(value.version);
const preview = (value: unknown): value is InvitationPreview => object(value) && id(value.workspaceId) && typeof value.ownerName === "string" && role(value.role) && date(value.expiresAt);
const child = (value: unknown): value is Child => object(value) && id(value.id) && id(value.workspaceId) && typeof value.displayName === "string" && date(value.createdAt);
function checked<T>(value: unknown, guard: (value: unknown) => value is T): T {
  if (!guard(value)) throw new FamilyApiError();
  return value;
}

export function createFamilyApi(baseUrl: string, fetcher: typeof fetch = fetch): FamilyApi {
  const base = baseUrl.replace(/\/$/, "");
  const apiUrl = base.endsWith("/api") ? base : `${base}/api`;
  const online = createOnlineTransport(apiUrl, fetcher);
  async function onlineCall<T>(signal: AbortSignal, action: (outerSignal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) controller.abort();
    const timeout = setTimeout(abort, 20_000);
    try { return await action(controller.signal); }
    catch (error) {
      if (error instanceof OnlineTransportError) throw new FamilyApiError(error.status, error.code, error.confirmed);
      throw new FamilyApiError();
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    }
  }
  const mutate = (path: string, payload: unknown, signal: AbortSignal, userId: string) =>
    onlineCall(signal, outerSignal => online.submit({ path: `/api${path}`, payload }, outerSignal, userId));
  async function request(path: string, signal: AbortSignal, body?: unknown, userId?: string): Promise<unknown> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) controller.abort();
    const timeout = setTimeout(abort, 20_000);
    try {
      const response = await fetcher(`${apiUrl}${path}`, {
        method: body === undefined ? "GET" : "POST", credentials: "include", cache: "no-store",
        headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json", "x-expected-user-id": userId ?? "" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: controller.signal,
      });
      if (!response.ok) throw new FamilyApiError(response.status);
      return await response.json();
    } catch (error) {
      if (error instanceof FamilyApiError) throw error;
      throw new FamilyApiError();
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    }
  }
  const familyPath = (familyId: string) => `/families/${encodeURIComponent(familyId)}`;
  return {
    reconcilePending: (signal, userId) => onlineCall(signal, outerSignal => online.checkPending(outerSignal, userId)),
    resetOnline: () => online.reset(),
    hasPendingOnline: () => online.hasPending(),
    async getSession(signal) {
      const value = await request("/auth/get-session", signal);
      if (value === null) return null;
      if (!object(value) || !object(value.user) || !id(value.user.id)) throw new FamilyApiError();
      return value.user.id;
    },
    async listFamilies(signal) {
      const value = await request("/families", signal);
      if (!object(value) || !Array.isArray(value.families) || !value.families.every(family)) throw new FamilyApiError();
      return value.families;
    },
    async getPreferences(signal) {
      const value = await request("/notification-preferences", signal);
      if (!object(value)) throw new FamilyApiError();
      return checked(value.preferences, preferences);
    },
    async savePreferences(input, signal, userId) {
      const value = await mutate("/notification-preferences", input, signal, userId);
      if (!object(value)) throw new FamilyApiError();
      return checked(value.preferences, preferences);
    },
    async createInvitation(familyId, email, inviteRole, expectedVersion, signal, userId) {
      const value = await mutate(`${familyPath(familyId)}/invitations`, { email, role: inviteRole, expectedVersion }, signal, userId);
      if (!object(value) || !invitation(value.invitation) || typeof value.token !== "string" || !value.token) throw new FamilyApiError();
      return { invitation: value.invitation, token: value.token };
    },
    async revokeInvitation(familyId, inviteId, expectedVersion, signal, userId) {
      const value = await mutate(`${familyPath(familyId)}/invitations/${encodeURIComponent(inviteId)}/revoke`, { expectedVersion }, signal, userId);
      if (!object(value) || value.updated !== true) throw new FamilyApiError();
    },
    async changeMember(familyId, memberUserId, memberRole, expectedVersion, signal, userId) {
      const value = await mutate(`${familyPath(familyId)}/members/${encodeURIComponent(memberUserId)}`, { role: memberRole, expectedVersion }, signal, userId);
      if (!object(value) || value.updated !== true) throw new FamilyApiError();
    },
    async previewInvitation(token, signal, userId) {
      const value = await request("/families/invitations/preview", signal, { token }, userId);
      if (!object(value)) throw new FamilyApiError();
      return checked(value.invitation, preview);
    },
    async acceptInvitation(token, confirmWorkspaceId, signal, userId) {
      const value = await mutate("/families/invitations/accept", { token, confirmWorkspaceId }, signal, userId);
      if (!object(value) || value.joined !== true) throw new FamilyApiError();
    },
    async createChild(familyId, displayName, signal, userId) {
      const value = await mutate(`${familyPath(familyId)}/children`, { displayName }, signal, userId);
      if (!object(value)) throw new FamilyApiError();
      const created = checked(value.child, child);
      if (created.workspaceId !== familyId || created.displayName !== displayName) throw new FamilyApiError();
      return created;
    },
  };
}
