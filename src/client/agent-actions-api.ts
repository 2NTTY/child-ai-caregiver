import { z } from "zod";
import { resolveApiBaseUrl } from "../config/api-base-url.ts";
import { agentPolicyUpdateSchema, ordinaryRecordKinds } from "../shared/agent-actions.ts";
import type { AgentActionReceipt, AgentOperationPolicy, AgentPolicyUpdate, AgentPrivateNote } from "../shared/agent-actions.ts";
import { contactBindingSchema, contactChannelSchema } from "../shared/contact.ts";

export type AgentActionsErrorCode = "invalid_input" | "invalid_json" | "unauthorized" | "not_found" | "session_changed"
  | "account_precondition_required" | "version_conflict" | "operation_conflict" | "operation_unknown"
  | "sharing_confirmation_required" | "confirmation_scope_changed" | "source_changed" | "agent_run_expired"
  | "method_not_allowed" | "unsupported_media_type" | "policy_changed" | "contact_consent_changed";
const knownCodes = new Set<AgentActionsErrorCode>(["invalid_input", "invalid_json", "unauthorized", "not_found", "session_changed",
  "account_precondition_required", "version_conflict", "operation_conflict", "operation_unknown",
  "sharing_confirmation_required", "confirmation_scope_changed", "source_changed", "agent_run_expired",
  "method_not_allowed", "unsupported_media_type", "policy_changed", "contact_consent_changed"]);
const knownStatuses = new Set([400, 401, 403, 404, 405, 409, 415, 428, 429, 500, 502, 503, 504]);
export class AgentActionsApiError extends Error {
  readonly status: number;
  readonly code: AgentActionsErrorCode | null;
  constructor(status = 0, code: AgentActionsErrorCode | null = null) {
    super("Agent action request could not be confirmed");
    this.name = "AgentActionsApiError";
    this.status = knownStatuses.has(status) ? status : 0;
    this.code = code !== null && knownCodes.has(code) ? code : null;
  }
}

export interface AgentPrivateNotePage { items: AgentPrivateNote[]; nextAfterId: string | null }
export interface AgentNoteDelete { expectedVersion: number; operationId: string; confirmDelete: true }
export interface AgentActionsApi {
  getPolicy(childId: string, signal: AbortSignal, userId: string): Promise<AgentOperationPolicy>;
  savePolicy(childId: string, input: AgentPolicyUpdate, signal: AbortSignal, userId: string): Promise<AgentOperationPolicy>;
  listNotes(childId: string, signal: AbortSignal, userId: string, query?: string, afterId?: string | null): Promise<AgentPrivateNotePage>;
  deleteNote(childId: string, noteId: string, input: AgentNoteDelete, signal: AbortSignal, userId: string): Promise<boolean>;
  receipts(childId: string, runId: string, signal: AbortSignal, userId: string): Promise<AgentActionReceipt[]>;
}

const uuid = z.uuid(), identifier = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const version = z.number().int().nonnegative().max(2147483647), positiveVersion = version.refine(value => value > 0);
const timestamp = z.iso.datetime({ offset: true });
const text = (max: number) => z.string().min(1).max(max).refine(value => value.trim().length > 0);
const binding = contactBindingSchema.refine(value => value.bindingVersion <= 2147483647);
const bindings = z.array(binding).max(2).refine(values => new Set(values.map(value => value.channel)).size === values.length);
const policySchema = z.object({
  version, effective: z.boolean(), recordKinds: z.array(z.enum(ordinaryRecordKinds)).max(4)
    .refine(values => new Set(values).size === values.length),
  allowPrivateNotes: z.boolean(), allowSelfTasks: z.boolean(), reminderConsentVersion: version.nullable(), reminderBindings: bindings,
}).strict();
const policyResponse = z.object({ policy: policySchema }).strict();
const noteSchema = z.object({
  id: uuid, childId: uuid, version: positiveVersion, title: text(100), text: text(2000), sourceMessageId: uuid,
  createdAt: timestamp, updatedAt: timestamp, provenance: z.literal("user_statement"),
}).strict();
const notesResponse = z.object({ notes: z.object({ items: z.array(noteSchema).max(20), nextAfterId: uuid.nullable() }).strict() }).strict();
const deleteInput = z.object({ expectedVersion: z.number().int().positive().max(2147483646), operationId: uuid, confirmDelete: z.literal(true) }).strict();
const deleteResponse = z.object({ deleted: z.boolean() }).strict();
const receiptSchema = z.object({
  id: uuid, runId: uuid, kind: z.enum(["save_record", "save_private_note", "revise_private_note", "create_self_task", "change_self_task"]),
  resource: z.object({ kind: z.enum(["care_record", "private_note", "task"]), id: uuid, version: positiveVersion }).strict(),
  state: z.enum(["saved", "updated", "scheduled", "completed", "cancelled"]),
  notification: z.enum(["not_authorized", "authorized_for_due_event"]),
  channels: z.array(contactChannelSchema).max(2).refine(values => new Set(values).size === values.length), createdAt: timestamp,
}).strict();
const receiptsResponse = z.object({ receipts: z.array(receiptSchema).max(8) }).strict();
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

export function createAgentActionsApi(baseUrl = "", request: typeof fetch = fetch): AgentActionsApi {
  const base = resolveApiBaseUrl(baseUrl), apiUrl = base.endsWith("/api") ? base : `${base}/api`;
  const path = (childId: string) => `/children/${encodeURIComponent(childId)}/agent`;
  function scope(childId: string, userId: string, resourceId?: string) {
    if (!uuid.safeParse(childId).success || !identifier.safeParse(userId).success
      || resourceId !== undefined && !uuid.safeParse(resourceId).success) throw new AgentActionsApiError(400, "invalid_input");
  }
  async function call(url: string, signal: AbortSignal, userId: string, body?: string): Promise<unknown> {
    const controller = new AbortController(), abort = () => controller.abort(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    const timeout = setTimeout(() => controller.abort(), body === undefined ? 15_000 : 20_000);
    try {
      if (controller.signal.aborted) throw new AgentActionsApiError();
      const response = await request(`${apiUrl}${url}`, {
        method: body === undefined ? "GET" : "POST", credentials: "include", cache: "no-store",
        headers: { Accept: "application/json", "x-expected-user-id": userId, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(body === undefined ? {} : { body }), signal: controller.signal,
      });
      if (!response.ok) {
        let code: AgentActionsErrorCode | null = null;
        try {
          const value: unknown = await response.json();
          if (object(value) && object(value.error) && typeof value.error.code === "string" && knownCodes.has(value.error.code as AgentActionsErrorCode))
            code = value.error.code as AgentActionsErrorCode;
        } catch { /* Keep the allowlisted HTTP status without exposing response details. */ }
        throw new AgentActionsApiError(response.status, code);
      }
      return await response.json();
    } catch (error) {
      if (error instanceof AgentActionsApiError) throw error;
      throw new AgentActionsApiError();
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    }
  }
  return {
    async getPolicy(childId, signal, userId) {
      scope(childId, userId);
      const result = policyResponse.safeParse(await call(`${path(childId)}/policy`, signal, userId));
      if (!result.success) throw new AgentActionsApiError();
      return result.data.policy;
    },
    async savePolicy(childId, input, signal, userId) {
      scope(childId, userId);
      const parsed = agentPolicyUpdateSchema.safeParse(input);
      if (!parsed.success || !parsed.data.reminderBindings.every(item => binding.safeParse(item).success)) throw new AgentActionsApiError(400, "invalid_input");
      const result = policyResponse.safeParse(await call(`${path(childId)}/policy`, signal, userId, JSON.stringify(parsed.data)));
      if (!result.success || result.data.policy.version !== parsed.data.expectedVersion + 1) throw new AgentActionsApiError();
      return result.data.policy;
    },
    async listNotes(childId, signal, userId, query = "", afterId = null) {
      scope(childId, userId);
      if (!z.string().max(200).safeParse(query).success || afterId !== null && !uuid.safeParse(afterId).success) throw new AgentActionsApiError(400, "invalid_input");
      const search = new URLSearchParams({ query });
      if (afterId !== null) search.set("afterId", afterId);
      const result = notesResponse.safeParse(await call(`${path(childId)}/notes?${search}`, signal, userId));
      if (!result.success || result.data.notes.items.some(item => item.childId !== childId)
        || new Set(result.data.notes.items.map(item => item.id)).size !== result.data.notes.items.length) throw new AgentActionsApiError();
      return result.data.notes;
    },
    async deleteNote(childId, noteId, input, signal, userId) {
      scope(childId, userId, noteId);
      const parsed = deleteInput.safeParse(input);
      if (!parsed.success) throw new AgentActionsApiError(400, "invalid_input");
      const result = deleteResponse.safeParse(await call(`${path(childId)}/notes/${encodeURIComponent(noteId)}/delete`, signal, userId, JSON.stringify(parsed.data)));
      if (!result.success) throw new AgentActionsApiError();
      return result.data.deleted;
    },
    async receipts(childId, runId, signal, userId) {
      scope(childId, userId, runId);
      const result = receiptsResponse.safeParse(await call(`${path(childId)}/actions?runId=${encodeURIComponent(runId)}`, signal, userId));
      if (!result.success || result.data.receipts.some(item => item.runId !== runId)
        || new Set(result.data.receipts.map(item => item.id)).size !== result.data.receipts.length) throw new AgentActionsApiError();
      return result.data.receipts;
    },
  };
}
