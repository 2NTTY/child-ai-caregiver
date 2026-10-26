import type { ReadFailureDiagnostic } from "./read-failure.ts";
import { z } from "zod";
import type { SharedSelection } from '../shared/sharing.ts';
import { growthActionSchema, growthTopicActionSchema, growthTopicSchema,
  type GrowthAction, type GrowthAttention, type GrowthPage, type GrowthTopicAction, type GrowthTopicId } from "../shared/growth.ts";

export type GrowthErrorCode = "invalid_input" | "unauthorized" | "not_found" | "session_changed"
  | "account_precondition_required" | "version_conflict" | "source_changed" | "source_unavailable"
  | "sharing_confirmation_required" | "topic_disabled" | "check_original_growth" | "growth_changed" | "growth_fact_requires_review" | "growth_history_requires_review" | "growth_existing_task_requires_review"
  | "space_access_denied" | "module_not_shared" | "space_inactive" | "shared_domain_read_only";
const knownCodes = new Set<GrowthErrorCode>(["invalid_input", "unauthorized", "not_found", "session_changed",
  "account_precondition_required", "version_conflict", "source_changed", "source_unavailable",
  "sharing_confirmation_required", "topic_disabled", "check_original_growth", "growth_changed", "growth_fact_requires_review", "growth_history_requires_review", "growth_existing_task_requires_review",
  "space_access_denied", "module_not_shared", "space_inactive", "shared_domain_read_only"]);
const knownStatuses = new Set([400, 401, 403, 404, 405, 409, 415, 422, 428, 429, 500, 502, 503, 504]);

export class GrowthApiError extends Error {
  readonly status: number;
  readonly code: GrowthErrorCode | null;
  readonly readFailure: ReadFailureDiagnostic | null;
  constructor(status = 0, code: GrowthErrorCode | null = null, readFailure: ReadFailureDiagnostic | null = null) {
    super("Growth request could not be confirmed");
    this.name = "GrowthApiError";
    this.status = knownStatuses.has(status) ? status : 0;
    this.code = code !== null && knownCodes.has(code) ? code : null;
    this.readFailure = readFailure;
  }
}
export const requiresFreshGrowthConfirmation = (error: GrowthApiError): boolean => error.status >= 400 && error.status < 500;

export interface GrowthApi {
  getPage(childId: string, signal: AbortSignal, userId: string): Promise<GrowthPage>;
  decideAttention(childId: string, itemId: string, input: GrowthAction, signal: AbortSignal, userId: string): Promise<GrowthAttention>;
  updateTopic(childId: string, topicId: GrowthTopicId, input: GrowthTopicAction, signal: AbortSignal, userId: string): Promise<GrowthPage>;
}

const uuid = z.uuid();
const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const timestamp = z.iso.datetime({ offset: true });
const version = z.number().int().positive().max(2147483647);
const taskStateSchema = z.enum(["scheduled", "completed", "cancelled", "needs_review"]);
const itemSchema = z.object({
  id: uuid, childId: uuid, topicId: growthTopicSchema, version,
  state: z.enum(["proposed", "snoozed", "accepted", "dismissed", "inapplicable"]),
  title: z.string(), kind: z.enum(["observe", "arrange", "consult"]), whyNow: z.string(), advice: z.string(), limits: z.string(),
  basis: z.object({ stage: z.string(), ruleRevision: z.string(), sourceHash: z.string(), values: z.record(z.string(), z.string()) }),
  evidence: z.object({ profileVersion: version, facts: z.array(z.object({ id: uuid, version })) }),
  source: z.object({ sourceId: z.string(), versionId: uuid, chunkId: uuid, contentHash: z.string(),
    url: z.string(), title: z.string(), section: z.string(), checkedAt: timestamp, excerpt: z.string() }),
  sourceAvailable: z.boolean(), createdAt: timestamp, updatedAt: timestamp, snoozeUntil: timestamp.nullable(),
  previousId: uuid.nullable(), newReason: z.string(), taskId: uuid.nullable(), taskState: taskStateSchema.nullable(),
  lastAction: z.string(), actorUserId: identifier.nullable(), note: z.string(),
});
const inputSchema = z.object({ key: z.string().max(80), label: z.string(),
  choices: z.array(z.object({ value: z.string().max(80), label: z.string() })), value: z.string().nullable(), conflict: z.boolean(), factRefs: z.array(z.object({ id: uuid, version })).max(200) });
const pageSchema = z.object({
  authorityVersion: z.string().min(1).max(100), items: z.array(itemSchema), historyHasMore: z.boolean(),
  topics: z.array(z.object({ id: growthTopicSchema, title: z.string(), version, disabled: z.boolean(), inputs: z.array(inputSchema) })),
  notices: z.array(z.string()), eligibleAssignees: z.array(z.object({ userId: identifier, name: z.string() })), canManage: z.boolean(),
});
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const unique = (values: string[]) => new Set(values).size === values.length;
function checkedPage(value: unknown, childId: string, status = 0): GrowthPage {
  const parsed = object(value) ? pageSchema.safeParse(value.page) : null;
  if (!parsed?.success) throw new GrowthApiError(0, null, { category: "schema", status, code: null });
  if (parsed.data.items.some(item => item.childId !== childId)) throw new GrowthApiError(0, null, { category: "scope", status, code: null });
  if (!unique(parsed.data.items.map(item => item.id)) || !unique(parsed.data.topics.map(topic => topic.id))
    || !unique(parsed.data.eligibleAssignees.map(assignee => assignee.userId))
    || parsed.data.topics.some(topic => !unique(topic.inputs.map(input => input.key))
      || topic.inputs.some(input => !unique(input.choices.map(choice => choice.value))))) throw new GrowthApiError(0, null, { category: "duplicates", status, code: null });
  return parsed.data;
}
interface PendingWrite {
  kind: "item" | "topic"; childId: string; targetId: string; userId: string; body: string; reviewed: boolean; reconfirm: boolean;
}

export function createGrowthApi(baseUrl = "", fetcher: typeof fetch = fetch, selection?: Pick<SharedSelection, 'spaceId'>): GrowthApi {
  const base = baseUrl.replace(/\/$/, "");
  const apiUrl = base.endsWith("/api") ? base : base + "/api";
  const spaceId = selection ? uuid.parse(selection.spaceId) : null;
  let pending: PendingWrite | null = null;
  function checkScope(childId: string, userId: string) {
    if (!uuid.safeParse(childId).success || !identifier.safeParse(userId).success) throw new GrowthApiError(400, "invalid_input");
  }
  const path = (childId: string) => "/children/" + encodeURIComponent(childId) + "/growth";
  async function request(url: string, signal: AbortSignal, userId: string, body?: string, received?: (status: number) => void): Promise<unknown> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) controller.abort();
    const timeout = setTimeout(abort, body === undefined ? 15_000 : 20_000);
    try {
      if (controller.signal.aborted) throw new GrowthApiError();
      const selectedUrl = spaceId ? url + (url.includes('?') ? '&' : '?') + 'spaceId=' + encodeURIComponent(spaceId) : url;
      const response = await fetcher(apiUrl + selectedUrl, {
        method: body === undefined ? "GET" : "POST", credentials: "include", cache: "no-store",
        headers: { Accept: "application/json", "x-expected-user-id": userId,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(body === undefined ? {} : { body }), signal: controller.signal,
      });
      received?.(response.status);
      if (!response.ok) {
        let code: GrowthErrorCode | null = null;
        let diagnosticCode: string | null = null;
        try {
          const value: unknown = await response.json();
          if (object(value) && object(value.error) && typeof value.error.code === "string") {
            if (knownCodes.has(value.error.code as GrowthErrorCode)) code = value.error.code as GrowthErrorCode;
            if (code || ["growth_unavailable", "memory_context_requires_selection"].includes(value.error.code)) diagnosticCode = value.error.code;
          }
        } catch { /* Keep the allowlisted status when the response body is malformed. */ }
        if (controller.signal.aborted) throw new GrowthApiError();
        throw new GrowthApiError(response.status, code, { category: "http", status: response.status, code: diagnosticCode });
      }
      let value: unknown;
      try { value = await response.json(); }
      catch { throw new GrowthApiError(0, null, { category: "invalid_json", status: response.status, code: null }); }
      if (controller.signal.aborted) throw new GrowthApiError();
      return value;
    } catch (error) {
      if (error instanceof GrowthApiError) throw error;
      throw new GrowthApiError();
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    }
  }
  function beginWrite(kind: PendingWrite["kind"], childId: string, targetId: string, userId: string, body: string): PendingWrite {
    if (pending && (!pending.reviewed || pending.kind !== kind || pending.childId !== childId || pending.targetId !== targetId
      || pending.userId !== userId || pending.body !== body)) throw new GrowthApiError(0, "check_original_growth");
    const attempt: PendingWrite = { kind, childId, targetId, userId, body, reviewed: false, reconfirm: false };
    pending = attempt;
    return attempt;
  }
  function failedWrite(attempt: PendingWrite, error: unknown) {
    if (error instanceof GrowthApiError) attempt.reconfirm = requiresFreshGrowthConfirmation(error);
  }
  return {
    async getPage(childId, signal, userId) {
      checkScope(childId, userId);
      let status = 0;
      const page = checkedPage(await request(path(childId), signal, userId, undefined, value => { status = value; }), childId, status);
      if (pending && pending.childId === childId && pending.userId === userId) {
        if (pending.reconfirm) pending = null;
        else pending.reviewed = pending.kind === "item"
          ? page.items.some(item => item.id === pending!.targetId)
          : page.topics.some(topic => topic.id === pending!.targetId);
      }
      return page;
    },
    async decideAttention(childId, itemId, raw, signal, userId) {
      checkScope(childId, userId);
      const parsed = growthActionSchema.safeParse(raw);
      if (!uuid.safeParse(itemId).success || !parsed.success) throw new GrowthApiError(400, "invalid_input");
      const input = parsed.data;
      const attempt = beginWrite("item", childId, itemId, userId, JSON.stringify(input));
      try {
        const value = await request(path(childId) + "/" + encodeURIComponent(itemId) + "/decide", signal, userId, attempt.body);
        const item = object(value) ? itemSchema.safeParse(value.item) : null;
        const expectedState = input.action === "accept" ? "accepted" : input.action === "snooze" ? "snoozed" : "dismissed";
        if (!item?.success || item.data.id !== itemId || item.data.childId !== childId
          || item.data.version !== input.expectedVersion + 1 || item.data.state !== expectedState) throw new GrowthApiError();
        pending = null;
        return item.data;
      } catch (error) { failedWrite(attempt, error); throw error; }
    },
    async updateTopic(childId, topicId, raw, signal, userId) {
      checkScope(childId, userId);
      const parsed = growthTopicActionSchema.safeParse(raw);
      if (!growthTopicSchema.safeParse(topicId).success || !parsed.success) throw new GrowthApiError(400, "invalid_input");
      const input = parsed.data;
      const attempt = beginWrite("topic", childId, topicId, userId, JSON.stringify(input));
      try {
        const page = checkedPage(await request(path(childId) + "/topics/" + encodeURIComponent(topicId), signal, userId, attempt.body), childId);
        const topic = page.topics.find(item => item.id === topicId);
        if (!topic || topic.version !== input.expectedVersion + 1
          || (input.action === "set_enabled" && topic.disabled !== !input.enabled)) throw new GrowthApiError();
        pending = null;
        return page;
      } catch (error) { failedWrite(attempt, error); throw error; }
    },
  };
}
