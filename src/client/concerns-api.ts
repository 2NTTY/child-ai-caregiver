import type { ReadFailureDiagnostic } from "./read-failure.ts";
import { z } from "zod";
import { resolveApiBaseUrl } from "../config/api-base-url.ts";
import { concernChangeSchema, concernValuesSchema, type Concern, type ConcernChange, type ConcernPage, type ConcernValues } from "../shared/concerns.ts";

export type ConcernErrorCode = "invalid_input" | "invalid_json" | "unauthorized" | "not_found" | "session_changed"
  | "account_precondition_required" | "concern_changed" | "concern_history_requires_review" | "operation_mismatch"
  | "sharing_confirmation_required" | "check_original_concern";
const knownCodes = new Set<ConcernErrorCode>(["invalid_input", "invalid_json", "unauthorized", "not_found", "session_changed",
  "account_precondition_required", "concern_changed", "concern_history_requires_review", "operation_mismatch", "sharing_confirmation_required", "check_original_concern"]);
const knownStatuses = new Set([400, 401, 403, 404, 405, 409, 415, 422, 428, 429, 500, 502, 503, 504]);
export class ConcernApiError extends Error {
  readonly status: number;
  readonly code: ConcernErrorCode | null;
  readonly readFailure: ReadFailureDiagnostic | null;
  constructor(status = 0, code: ConcernErrorCode | null = null, readFailure: ReadFailureDiagnostic | null = null) {
    super("Concern request could not be confirmed"); this.name = "ConcernApiError";
    this.status = knownStatuses.has(status) ? status : 0;
    this.code = code !== null && knownCodes.has(code) ? code : null;
    this.readFailure = readFailure;
  }
}
export const requiresFreshConcernConfirmation = (error: ConcernApiError) => error.status >= 400 && error.status < 500;
export interface ConcernsApi {
  getPage(childId: string, signal: AbortSignal, userId: string): Promise<ConcernPage>;
  change(childId: string, id: string, input: ConcernChange, signal: AbortSignal, userId: string): Promise<Concern>;
  create(childId: string, input: ConcernValues, signal: AbortSignal, userId: string): Promise<Concern>;
}
const uuid = z.uuid(), identifier = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const timestamp = z.iso.datetime({ offset: true }), version = z.number().int().positive().max(2147483647);
const eventSchema = z.object({ id: uuid, at: timestamp, kind: z.enum(["observation", "confirmed_action"]),
  title: z.string(), text: z.string(), sourceLabel: z.string(), actorUserId: identifier,
  recordId: uuid.optional(), taskId: uuid.optional(), attentionId: uuid.optional(), attentionVersion: version.optional(), runId: uuid.optional() }).strict();
const itemSchema = z.object({ id: uuid, childId: uuid, title: z.string().min(1).max(160), reason: z.string().min(1).max(2000),
  status: z.enum(["following", "closed"]), version, createdAt: timestamp, updatedAt: timestamp, archivedAt: timestamp.nullable(),
  statusBeforeArchive: z.literal("following").optional(), attentionIds: z.array(uuid).max(200), events: z.array(eventSchema).max(200), historyComplete: z.literal(true),
  followUp: z.object({ id: uuid, at: timestamp, state: z.enum(["pending", "queued", "completed", "stopped", "unknown", "cancelled"]), runId: uuid.nullable() }).strict().nullable() }).strict();
const pageSchema = z.object({ authorityVersion: z.string().min(1).max(100), items: z.array(itemSchema).max(200), canManage: z.boolean() }).strict();
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const unique = (values: string[]) => new Set(values).size === values.length;
function checkedItem(value: unknown, childId: string, id?: string, status = 0): Concern {
  const parsed = itemSchema.safeParse(value);
  if (!parsed.success) throw new ConcernApiError(0, null, { category: "schema", status, code: null });
  if (parsed.data.childId !== childId || id !== undefined && parsed.data.id !== id) throw new ConcernApiError(0, null, { category: "scope", status, code: null });
  if (!unique(parsed.data.events.map(event => event.id)) || !unique(parsed.data.attentionIds)) throw new ConcernApiError(0, null, { category: "duplicates", status, code: null });
  return parsed.data;
}
interface PendingWrite { kind: "create" | "change"; childId: string; userId: string; id: string; payload: string; body: string; reviewed: boolean; reconfirm: boolean }

export function createConcernsApi(baseUrl = "", fetcher: typeof fetch = fetch): ConcernsApi {
  const base = resolveApiBaseUrl(baseUrl), apiUrl = base.endsWith("/api") ? base : base + "/api";
  let pending: PendingWrite | null = null, activeScope: string | null = null;
  function scope(childId: string, userId: string) {
    if (!uuid.safeParse(childId).success || !identifier.safeParse(userId).success) throw new ConcernApiError(400, "invalid_input");
    const next = userId + ":" + childId;
    if (activeScope !== next) { pending = null; activeScope = next; }
  }
  const path = (childId: string) => "/children/" + encodeURIComponent(childId) + "/concerns";
  async function request(url: string, signal: AbortSignal, userId: string, body?: string, received?: (status: number) => void): Promise<unknown> {
    const controller = new AbortController(), abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort();
    const timeout = setTimeout(abort, body === undefined ? 15_000 : 20_000);
    try {
      if (controller.signal.aborted) throw new ConcernApiError();
      const response = await fetcher(apiUrl + url, { method: body === undefined ? "GET" : "POST", credentials: "include", cache: "no-store",
        headers: { Accept: "application/json", "x-expected-user-id": userId, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(body === undefined ? {} : { body }), signal: controller.signal });
      received?.(response.status);
      if (!response.ok) {
        let code: ConcernErrorCode | null = null;
        let diagnosticCode: string | null = null;
        try { const value: unknown = await response.json();
          if (object(value) && object(value.error) && typeof value.error.code === "string") {
            if (knownCodes.has(value.error.code as ConcernErrorCode)) code = value.error.code as ConcernErrorCode;
            if (code || value.error.code === "concern_unavailable") diagnosticCode = value.error.code;
          }
        } catch { /* Preserve only the allowlisted HTTP status. */ }
        if (controller.signal.aborted) throw new ConcernApiError();
        throw new ConcernApiError(response.status, code, { category: "http", status: response.status, code: diagnosticCode });
      }
      let value: unknown;
      try { value = await response.json(); }
      catch { throw new ConcernApiError(0, null, { category: "invalid_json", status: response.status, code: null }); }
      if (controller.signal.aborted) throw new ConcernApiError(); return value;
    } catch (error) { if (error instanceof ConcernApiError) throw error; throw new ConcernApiError(); }
    finally { clearTimeout(timeout); signal.removeEventListener("abort", abort); }
  }
  function begin(kind: PendingWrite["kind"], childId: string, id: string, userId: string, input: ConcernValues | ConcernChange) {
    const payload = JSON.stringify(input);
    if (pending) {
      if (!pending.reviewed || pending.kind !== kind || pending.childId !== childId || pending.id !== id || pending.userId !== userId || pending.payload !== payload)
        throw new ConcernApiError(0, "check_original_concern");
      pending.reviewed = false; return pending;
    }
    const body = JSON.stringify({ opId: crypto.randomUUID(), confirmShared: true, [kind === "create" ? "values" : "change"]: input });
    return pending = { kind, childId, id, userId, payload, body, reviewed: false, reconfirm: false };
  }
  async function write(kind: PendingWrite["kind"], childId: string, id: string, userId: string, input: ConcernValues | ConcernChange, signal: AbortSignal) {
    const attempt = begin(kind, childId, id, userId, input);
    try {
      const value = await request(path(childId) + (kind === "change" ? "/" + encodeURIComponent(id) + "/actions" : ""), signal, userId, attempt.body);
      const item = checkedItem(object(value) ? value.item : null, childId, kind === "change" ? id : undefined);
      const expected = "expectedVersion" in input ? input.expectedVersion + 1 : 1;
      if (item.version !== expected || ("action" in input && (input.action === "archive" && item.status !== "closed" || input.action === "restore" && item.status !== "following"))) throw new ConcernApiError();
      if (pending === attempt) pending = null;
      return item;
    } catch (error) {
      if (pending === attempt && error instanceof ConcernApiError) attempt.reconfirm = requiresFreshConcernConfirmation(error);
      throw error;
    }
  }
  return {
    async getPage(childId, signal, userId) {
      scope(childId, userId);
      try {
        let status = 0;
        const value = await request(path(childId), signal, userId, undefined, value => { status = value; }), parsed = pageSchema.safeParse(object(value) ? value.page : null);
        if (!parsed.success) throw new ConcernApiError(0, null, { category: "schema", status, code: null });
        if (!unique(parsed.data.items.map(item => item.id))) throw new ConcernApiError(0, null, { category: "duplicates", status, code: null });
        for (const item of parsed.data.items) checkedItem(item, childId, undefined, status);
        if (pending && pending.childId === childId && pending.userId === userId) {
          if (pending.reconfirm) pending = null;
          else pending.reviewed = pending.kind === "create" || parsed.data.items.some(item => item.id === pending!.id);
        }
        return parsed.data;
      } catch (error) {
        if (error instanceof ConcernApiError && ([401, 403, 404].includes(error.status) || error.code === "session_changed")) pending = null;
        throw error;
      }
    },
    async change(childId, id, raw, signal, userId) {
      scope(childId, userId); const parsed = concernChangeSchema.safeParse(raw);
      if (!uuid.safeParse(id).success || !parsed.success) throw new ConcernApiError(400, "invalid_input");
      return write("change", childId, id, userId, parsed.data, signal);
    },
    async create(childId, raw, signal, userId) {
      scope(childId, userId); const parsed = concernValuesSchema.safeParse(raw);
      if (!parsed.success) throw new ConcernApiError(400, "invalid_input");
      return write("create", childId, "", userId, parsed.data, signal);
    },
  };
}
