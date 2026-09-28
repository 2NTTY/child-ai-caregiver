import { z } from "zod";
import { photoDraftSchema } from "../shared/photos.ts";
import {
  sharedInputCreateSchema, type PublicInputSource, type SharedInput, type SharedInputConfirmation, type SharedInputCreate,
} from "../shared/shared-inputs.ts";
import { createOnlineTransport, OnlineTransportError } from "./online-transport.ts";

export class SharedInputApiError extends Error {
  constructor(readonly status = 0, readonly onlineCode: string | null = null, readonly confirmed = false) {
    super("Shared input request could not be confirmed");
    this.name = "SharedInputApiError";
  }
}

export type SharedInputWriteResult = { input: SharedInput; recordId?: string } | { deleted: true } | null;
export type SharedInputReconciliation = { state: "confirmed"; result: SharedInputWriteResult } | { state: "unconfirmed" } | null;
export interface SharedInputApi {
  inputs(childId: string, signal: AbortSignal, userId: string): Promise<{ inputs: SharedInput[]; sources: PublicInputSource[]; canCreate: boolean }>;
  input(childId: string, inputId: string, signal: AbortSignal, userId: string): Promise<SharedInput>;
  create(childId: string, input: SharedInputCreate, signal: AbortSignal, userId: string): Promise<SharedInputWriteResult>;
  fetch(input: SharedInput, signal: AbortSignal, userId: string): Promise<SharedInput>;
  extract(input: SharedInput, excerpt: string, signal: AbortSignal, userId: string): Promise<SharedInput>;
  confirm(input: SharedInput, confirmation: SharedInputConfirmation, signal: AbortSignal, userId: string): Promise<SharedInputWriteResult>;
  delete(input: SharedInput, signal: AbortSignal, userId: string): Promise<SharedInputWriteResult>;
  reconcilePending(signal: AbortSignal, userId: string): Promise<SharedInputReconciliation>;
  hasPendingOnline(): boolean;
  resetOnline(): void;
}

const safeText = (max: number) => z.string().max(max).refine(value => !/[\u0000\uD800-\uDFFF]/u.test(value));
const user = z.string().min(1).max(128);
const version = z.number().int().positive().max(2147483647);
const dateTime = z.iso.datetime({ offset: true });
const httpsUrl = safeText(1000).refine(value => {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; }
  catch { return false; }
});
const sourceSchema = z.object({ id: z.string().regex(/^[a-z0-9-]{1,80}$/u), url: httpsUrl, publisher: safeText(200).min(1) }).strict();
const inputSchema = z.object({
  id: z.uuid(), childId: z.uuid(), ownerUserId: user, version, createdAt: dateTime, canManage: z.boolean(),
  kind: z.enum(["paste", "public_source", "personal_source"]), sourceNotes: safeText(1000).default(""), sourceId: sourceSchema.shape.id.nullable(),
  sourceLabel: safeText(200).min(1), sourceUrl: httpsUrl.nullable(), sourceDateText: safeText(200).nullable(),
  text: safeText(64000), sha256: z.string().regex(/^[a-f0-9]{64}$/u).nullable(), retrievedAt: dateTime.nullable(),
  fetchState: z.enum(["not_requested", "running", "ready", "failed", "unknown"]),
  extraction: z.object({
    state: z.enum(["not_requested", "running", "available", "failed", "unknown"]), runId: z.uuid().nullable(),
    excerpt: safeText(10000).nullable(), draft: photoDraftSchema.nullable(), stopReason: safeText(200).nullable(),
    processedAt: dateTime.nullable(), model: safeText(200).nullable(),
  }).strict(),
  recordId: z.uuid().nullable(), confirmationKind: z.enum(["reference", "family_record"]).nullable(),
}).strict();
const resultSchema = z.object({ input: inputSchema }).strict();
const confirmationSchema = z.object({ input: inputSchema, recordId: z.uuid() }).strict();
const deletionSchema = z.object({ deleted: z.literal(true) }).strict();
type Target = {
  kind: "create" | "confirm" | "delete"; childId: string; userId: string; inputId?: string;
  create?: SharedInputCreate; basis?: SharedInput; confirmation?: SharedInputConfirmation;
};
const codes = new Set(["inputs_capacity", "input_processing", "version_conflict", "invalid_input", "session_changed", "not_found", "forbidden"]);
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const sameSourceOrigin = (left: SharedInput, right: SharedInput) => left.kind === right.kind && left.sourceId === right.sourceId
  && left.sourceNotes === right.sourceNotes && left.sourceLabel === right.sourceLabel && left.sourceUrl === right.sourceUrl && left.createdAt === right.createdAt;
const sameSource = (left: SharedInput, right: SharedInput) => sameSourceOrigin(left, right)
  && left.sourceDateText === right.sourceDateText;

function checkedInput(value: unknown, childId: string, userId: string, inputId?: string, confirmed = false): SharedInput {
  const parsed = resultSchema.safeParse(value);
  if (!parsed.success || parsed.data.input.childId !== childId || parsed.data.input.ownerUserId !== userId
    || (inputId !== undefined && parsed.data.input.id !== inputId)
    || (parsed.data.input.kind === "public_source" ? parsed.data.input.sourceId === null : parsed.data.input.sourceId !== null)
    || ((parsed.data.input.recordId === null) !== (parsed.data.input.confirmationKind === null))) {
    throw new SharedInputApiError(0, null, confirmed);
  }
  return parsed.data.input;
}

function checkedWrite(value: unknown, target: Target): SharedInputWriteResult {
  if (target.kind === "delete") {
    const parsed = deletionSchema.safeParse(value);
    if (!parsed.success) throw new SharedInputApiError(0, null, true);
    return parsed.data;
  }
  if (target.kind === "confirm") {
    const parsed = confirmationSchema.safeParse(value);
    if (!parsed.success || !target.basis || !target.confirmation) throw new SharedInputApiError(0, null, true);
    const input = checkedInput({ input: parsed.data.input }, target.childId, target.userId, target.inputId, true);
    if (input.recordId !== parsed.data.recordId || input.confirmationKind !== target.confirmation.kind
      || input.version <= target.confirmation.expectedVersion || !sameSource(input, target.basis)
      || input.text !== target.basis.text || input.sha256 !== target.basis.sha256) throw new SharedInputApiError(0, null, true);
    return { input, recordId: parsed.data.recordId };
  }
  const input = checkedInput(value, target.childId, target.userId, undefined, true);
  const created = target.create;
  if (!created || input.kind !== created.kind || input.recordId !== null
    || (created.kind === "public_source" ? input.sourceId !== created.sourceId
      : input.text !== created.text || input.sourceLabel !== created.sourceLabel || input.sourceUrl !== created.sourceUrl
        || input.sourceDateText !== created.sourceDateText || (created.kind === "personal_source" && input.sourceNotes !== created.sourceNotes))) throw new SharedInputApiError(0, null, true);
  return { input };
}

export function createSharedInputApi(baseUrl = "", fetcher: typeof fetch = fetch): SharedInputApi {
  const base = baseUrl.replace(/\/$/u, ""), apiUrl = base.endsWith("/api") ? base : base + "/api";
  const online = createOnlineTransport(apiUrl, fetcher);
  let generation = 0, pendingTarget: Target | null = null;
  const collection = (childId: string) => "/children/" + encodeURIComponent(childId) + "/inputs";
  const entity = (childId: string, inputId: string) => collection(childId) + "/" + encodeURIComponent(inputId);
  const identity = (childId: string, userId: string, inputId?: string) => {
    if (!z.uuid().safeParse(childId).success || !user.safeParse(userId).success
      || (inputId !== undefined && !z.uuid().safeParse(inputId).success)) throw new SharedInputApiError(400, "invalid_input");
  };
  const manageable = (input: SharedInput, userId: string) => {
    identity(input.childId, userId, input.id);
    if (input.ownerUserId !== userId || !input.canManage) throw new SharedInputApiError(403, "forbidden");
    if (!version.safeParse(input.version).success) throw new SharedInputApiError(400, "invalid_input");
  };
  async function call<T>(signal: AbortSignal, action: (innerSignal: AbortSignal) => Promise<T>, timeoutMs = 20_000): Promise<T> {
    const started = generation, controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) controller.abort();
    const timeout = setTimeout(abort, timeoutMs);
    try {
      if (controller.signal.aborted) throw new SharedInputApiError();
      const value = await action(controller.signal);
      if (started !== generation) throw new SharedInputApiError();
      return value;
    } catch (error) {
      if (error instanceof SharedInputApiError) throw error;
      if (error instanceof OnlineTransportError) throw new SharedInputApiError(error.status, error.code, error.confirmed);
      throw new SharedInputApiError();
    } finally {
      clearTimeout(timeout); signal.removeEventListener("abort", abort);
    }
  }
  const request = (path: string, signal: AbortSignal, userId: string, body?: unknown, timeoutMs = 20_000) => call(signal, async innerSignal => {
    const response = await fetcher(apiUrl + path, {
      method: body === undefined ? "GET" : "POST", credentials: "include", cache: "no-store", signal: innerSignal,
      headers: { Accept: "application/json", "x-expected-user-id": userId,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      let code: string | null = null;
      try {
        const value: unknown = await response.json();
        if (object(value) && object(value.error) && typeof value.error.code === "string" && codes.has(value.error.code)) code = value.error.code;
      } catch { /* Remote error bodies are never displayed. */ }
      throw new SharedInputApiError(response.status, code);
    }
    return response.json() as Promise<unknown>;
  }, timeoutMs);
  async function mutate(path: string, payload: unknown, target: Target, signal: AbortSignal): Promise<SharedInputWriteResult> {
    if (!online.hasPending()) pendingTarget = target;
    let confirmed = false;
    try {
      const value = await call(signal, async innerSignal => {
        const result = await online.submit({ path: "/api" + path, payload }, innerSignal, target.userId);
        confirmed = true;
        return result;
      });
      return checkedWrite(value, target);
    } catch (error) {
      if (error instanceof SharedInputApiError && error.confirmed && error.onlineCode === "operation_result_unavailable") return null;
      if (confirmed && error instanceof SharedInputApiError) throw new SharedInputApiError(error.status, error.onlineCode, true);
      throw error;
    } finally { if (!online.hasPending()) pendingTarget = null; }
  }
  return {
    hasPendingOnline: () => online.hasPending(),
    resetOnline() { generation++; pendingTarget = null; online.reset(); },
    async reconcilePending(signal, userId) {
      const target = pendingTarget;
      let confirmed = false;
      try {
        const receipt = await call(signal, async innerSignal => {
          const value = await online.checkPending(innerSignal, userId);
          confirmed = value?.state === "confirmed";
          return value;
        });
        if (receipt?.state !== "confirmed") return receipt;
        if (receipt.result === null) return { state: "confirmed", result: null };
        if (!target || target.userId !== userId) throw new SharedInputApiError(0, null, true);
        return { state: "confirmed", result: checkedWrite(receipt.result, target) };
      } catch (error) {
        if (confirmed && error instanceof SharedInputApiError) throw new SharedInputApiError(error.status, error.onlineCode, true);
        throw error;
      } finally { if (!online.hasPending()) pendingTarget = null; }
    },
    async inputs(childId, signal, userId) {
      identity(childId, userId);
      const parsed = z.object({ inputs: z.array(inputSchema), sources: z.array(sourceSchema), canCreate: z.boolean() }).strict()
        .safeParse(await request(collection(childId), signal, userId));
      if (!parsed.success || new Set(parsed.data.inputs.map(input => input.id)).size !== parsed.data.inputs.length
        || new Set(parsed.data.sources.map(source => source.id)).size !== parsed.data.sources.length) throw new SharedInputApiError();
      for (const input of parsed.data.inputs) checkedInput({ input }, childId, userId);
      return parsed.data;
    },
    async input(childId, inputId, signal, userId) {
      identity(childId, userId, inputId);
      return checkedInput(await request(entity(childId, inputId), signal, userId), childId, userId, inputId);
    },
    async create(childId, input, signal, userId) {
      identity(childId, userId);
      const parsed = sharedInputCreateSchema.safeParse(input);
      if (!parsed.success || (parsed.data.kind === "paste" && !parsed.data.sourceLabel.trim())) throw new SharedInputApiError(400, "invalid_input");
      return mutate(collection(childId), parsed.data, { kind: "create", childId, userId, create: parsed.data }, signal);
    },
    async fetch(input, signal, userId) {
      manageable(input, userId);
      if ((input.kind !== "public_source" && input.kind !== "personal_source") || !input.sourceUrl || input.recordId !== null) throw new SharedInputApiError(400, "invalid_input");
      const next = checkedInput(await request(entity(input.childId, input.id) + "/fetch", signal, userId,
        { expectedVersion: input.version, confirmFetch: true }, 25_000), input.childId, userId, input.id);
      if (!sameSourceOrigin(next, input) || next.version < input.version) throw new SharedInputApiError();
      return next;
    },
    async extract(input, excerpt, signal, userId) {
      manageable(input, userId);
      if (input.recordId !== null || !safeText(10000).safeParse(excerpt).success || !excerpt.trim() || !input.text.includes(excerpt)) {
        throw new SharedInputApiError(400, "invalid_input");
      }
      const next = checkedInput(await request(entity(input.childId, input.id) + "/extract", signal, userId,
        { expectedVersion: input.version, confirmModel: true, excerpt }, 95_000), input.childId, userId, input.id);
      if (!sameSource(next, input) || next.text !== input.text || next.sha256 !== input.sha256 || next.version < input.version) throw new SharedInputApiError();
      return next;
    },
    async confirm(input, confirmation, signal, userId) {
      manageable(input, userId);
      if (input.recordId !== null || confirmation.expectedVersion !== input.version || confirmation.confirmShared !== true
        || (confirmation.kind !== "reference" && confirmation.kind !== "family_record")
        || (confirmation.kind === "family_record" && confirmation.confirmChildFact !== true)
        || (confirmation.kind === "reference" && (confirmation.values.details.kind !== "note" || confirmation.values.details.quantity !== null
          || confirmation.values.details.eventTime.at !== null || confirmation.values.details.eventTime.precision !== "unknown"))) {
        throw new SharedInputApiError(400, "invalid_input");
      }
      return mutate(entity(input.childId, input.id) + "/confirm", confirmation,
        { kind: "confirm", childId: input.childId, userId, inputId: input.id, basis: input, confirmation }, signal);
    },
    async delete(input, signal, userId) {
      manageable(input, userId);
      return mutate(entity(input.childId, input.id) + "/delete", { expectedVersion: input.version, confirmDelete: true },
        { kind: "delete", childId: input.childId, userId, inputId: input.id }, signal);
    },
  };
}