import type { HistoryPage } from "../shared/care.ts";
import type { ConversationSummary, FactConfirm, FactCreate, SharedFactCreate, FactDeactivate, FactRevise, MemoryDelete, MemoryFact, MemoryPage, MemoryTopic, TopicChange, TopicCreate, TopicReopen } from "../shared/memory.ts";
import type { SharedSelection } from '../shared/sharing.ts';
import type { OnlineReceipt } from "../shared/online.ts";
import { createOnlineTransport, OnlineTransportError } from "./online-transport.ts";
import { importProvenanceSchema } from "../shared/import-provenance.ts";

export class MemoryApiError extends Error {
  readonly status: number;
  readonly onlineCode: string | null;
  readonly confirmed: boolean;
  constructor(status = 0, onlineCode: string | null = null, confirmed = false) {
    super("Memory request could not be confirmed");
    this.name = "MemoryApiError";
    this.status = status;
    this.onlineCode = onlineCode;
    this.confirmed = confirmed;
  }
}

export interface MemoryApi {
  getSession(signal: AbortSignal): Promise<string | null>;
  facts(childId: string, afterId: string | null, signal: AbortSignal): Promise<MemoryPage<MemoryFact>>;
  topics(childId: string, afterId: string | null, signal: AbortSignal): Promise<MemoryPage<MemoryTopic>>;
  summary(childId: string, signal: AbortSignal): Promise<ConversationSummary | null>;
  factHistory(childId: string, factId: string, beforeVersion: number | null, signal: AbortSignal): Promise<HistoryPage<MemoryFact>>;
  topicHistory(childId: string, topicId: string, beforeVersion: number | null, signal: AbortSignal): Promise<HistoryPage<MemoryTopic>>;
  createFact(childId: string, input: FactCreate, signal: AbortSignal, userId: string): Promise<MemoryFact>;
  createConfirmedFact?(childId: string, input: SharedFactCreate, signal: AbortSignal, userId: string): Promise<MemoryFact>;
  confirmFact(childId: string, factId: string, input: FactConfirm, signal: AbortSignal, userId: string): Promise<MemoryFact>;
  reviseFact(childId: string, factId: string, input: FactRevise, signal: AbortSignal, userId: string): Promise<MemoryFact>;
  deactivateFact(childId: string, factId: string, input: FactDeactivate, signal: AbortSignal, userId: string): Promise<MemoryFact>;
  deleteFact(childId: string, factId: string, input: MemoryDelete, signal: AbortSignal, userId: string): Promise<void>;
  createTopic(childId: string, input: TopicCreate, signal: AbortSignal, userId: string): Promise<MemoryTopic>;
  changeTopic(childId: string, topicId: string, input: TopicChange, signal: AbortSignal, userId: string): Promise<MemoryTopic>;
  reopenTopic(childId: string, topicId: string, input: TopicReopen, signal: AbortSignal, userId: string): Promise<MemoryTopic>;
  deleteTopic(childId: string, topicId: string, input: MemoryDelete, signal: AbortSignal, userId: string): Promise<void>;
  reconcilePending?(signal: AbortSignal, userId: string): Promise<OnlineReceipt | { state: "unconfirmed" } | null>;
  resetOnline?(): void;
  hasPendingOnline?(): boolean;
}

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const str = (value: unknown): value is string => typeof value === "string";
const nullable = (value: unknown): value is string | null => value === null || str(value);
const version = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const visibility = (value: unknown): boolean => value === "private" || value === "family";
const localSource = (value: unknown): boolean => object(value) && str(value.description) && (
  value.kind === "manual" ||
  (value.kind === "care_record" && str(value.recordId) && version(value.version)) ||
  (value.kind === "private_chat" && (value.messageId === undefined || str(value.messageId)))
);
const source = (value: unknown): boolean => localSource(value) || object(value) && value.kind === "imported" && str(value.description)
  && localSource(value.original) && ["current", "changed"].includes(String(value.sourceState));
const provenance = (value: Record<string, unknown>) => value.importedFrom === undefined || importProvenanceSchema.safeParse(value.importedFrom).success;
const fact = (value: unknown): value is MemoryFact => object(value) && str(value.id) && str(value.childId) && visibility(value.visibility) && visibility(value.intendedVisibility) &&
  ["candidate", "confirmed", "inactive"].includes(String(value.status)) && version(value.version) && str(value.createdBy) && nullable(value.confirmedBy) && nullable(value.confirmedAt) &&
  str(value.key) && str(value.content) && source(value.source) && nullable(value.validUntil) && str(value.reason) && typeof value.applicable === "boolean" && ["current", "changed"].includes(String(value.sourceState))
  && provenance(value) && (value.confirmationBasis === undefined || value.confirmationBasis === "imported_source");
const topic = (value: unknown): value is MemoryTopic => object(value) && str(value.id) && str(value.childId) && visibility(value.visibility) && str(value.title) && str(value.note) &&
  ["pending", "answered", "snoozed", "resolved"].includes(String(value.status)) && version(value.version) && str(value.updatedBy) && str(value.updatedAt) &&
  nullable(value.resumeAfter) && nullable(value.reopenReason) && nullable(value.reopenedFrom) && typeof value.mayAsk === "boolean" && provenance(value);
const summary = (value: unknown): value is ConversationSummary => object(value) && str(value.id) && str(value.childId) && version(value.version) && str(value.text) && str(value.createdAt) &&
  nullable(value.previousId) && Array.isArray(value.coveredMessageIds) && value.coveredMessageIds.every(str) && str(value.lastCoveredMessageId);
function page<T>(value: unknown, guard: (value: unknown) => value is T, childId: string): MemoryPage<T> {
  if (!object(value) || !Array.isArray(value.items) || !value.items.every(guard) || !value.items.every((item: T) => (item as { childId: string }).childId === childId) || !nullable(value.nextAfterId)) throw new MemoryApiError();
  return value as unknown as MemoryPage<T>;
}
function history<T>(value: unknown, guard: (value: unknown) => value is T, childId: string, id: string): HistoryPage<T> {
  if (!object(value) || !Array.isArray(value.revisions) || !value.revisions.every(guard) || !value.revisions.every((item: T) => (item as { id: string; childId: string }).id === id && (item as { childId: string }).childId === childId) || !(value.nextBeforeVersion === null || version(value.nextBeforeVersion))) throw new MemoryApiError();
  return value as unknown as HistoryPage<T>;
}

export function createMemoryApi(baseUrl = "", fetcher: typeof fetch = fetch, selection?: Pick<SharedSelection, 'spaceId'>): MemoryApi {
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
      if (error instanceof OnlineTransportError) throw new MemoryApiError(error.status, error.code, error.confirmed);
      throw new MemoryApiError();
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    }
  }
  const mutate = (path: string, payload: unknown, signal: AbortSignal, userId: string) =>
    onlineCall(signal, outerSignal => online.submit({ path: `/api${path}`, payload, ...(selection ? { sharing: selection } : {}) }, outerSignal, userId));
  async function request(path: string, signal: AbortSignal, body?: unknown, userId?: string): Promise<unknown> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) controller.abort();
    const timeout = setTimeout(abort, 20_000);
    try {
      const selectedPath = selection && path.startsWith('/children/') ? `${path}${path.includes('?') ? '&' : '?'}spaceId=${encodeURIComponent(selection.spaceId)}` : path;
      const response = await fetcher(`${apiUrl}${selectedPath}`, {
        method: body === undefined ? "GET" : "POST", credentials: "include", cache: "no-store",
        headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json", "x-expected-user-id": userId ?? "" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: controller.signal,
      });
      if (!response.ok) throw new MemoryApiError(response.status);
      return await response.json();
    } catch (error) {
      if (error instanceof MemoryApiError) throw error;
      throw new MemoryApiError();
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    }
  }
  const child = (id: string) => `/children/${encodeURIComponent(id)}/memory`;
  const entity = (childId: string, kind: "facts" | "topics", id: string) => `${child(childId)}/${kind}/${encodeURIComponent(id)}`;
  const cursor = (name: string, value: string | number | null) => value === null ? "" : `?${name}=${encodeURIComponent(value)}`;
  function checkedFact(value: unknown, childId: string, id?: string, previousVersion?: number) {
    if (!object(value) || !fact(value.fact) || value.fact.childId !== childId || (id && value.fact.id !== id) || (previousVersion !== undefined && value.fact.version <= previousVersion)) throw new MemoryApiError(0, null, true);
    return value.fact;
  }
  function checkedTopic(value: unknown, childId: string, id?: string, previousVersion?: number) {
    if (!object(value) || !topic(value.topic) || value.topic.childId !== childId || (id && value.topic.id !== id) || (previousVersion !== undefined && value.topic.version <= previousVersion)) throw new MemoryApiError(0, null, true);
    return value.topic;
  }
  function deleted(value: unknown) { if (!object(value) || value.deleted !== true) throw new MemoryApiError(0, null, true); }
  return {
    reconcilePending: (signal, userId) => onlineCall(signal, outerSignal => online.checkPending(outerSignal, userId)),
    resetOnline: () => online.reset(),
    hasPendingOnline: () => online.hasPending(),
    async getSession(signal) {
      const value = await request("/auth/get-session", signal);
      if (value === null) return null;
      if (!object(value) || !object(value.user) || !str(value.user.id)) throw new MemoryApiError();
      return value.user.id;
    },
    async facts(childId, afterId, signal) { return page(await request(`${child(childId)}/facts${cursor("afterId", afterId)}`, signal), fact, childId); },
    async topics(childId, afterId, signal) { return page(await request(`${child(childId)}/topics${cursor("afterId", afterId)}`, signal), topic, childId); },
    async summary(childId, signal) {
      const value = await request(`${child(childId)}/summary`, signal);
      if (!object(value) || !(value.summary === null || summary(value.summary)) || (value.summary && value.summary.childId !== childId)) throw new MemoryApiError();
      return value.summary;
    },
    async factHistory(childId, factId, beforeVersion, signal) { return history(await request(`${entity(childId, "facts", factId)}/history${cursor("beforeVersion", beforeVersion)}`, signal), fact, childId, factId); },
    async topicHistory(childId, topicId, beforeVersion, signal) { return history(await request(`${entity(childId, "topics", topicId)}/history${cursor("beforeVersion", beforeVersion)}`, signal), topic, childId, topicId); },
    async createFact(childId, input, signal, userId) { return checkedFact(await mutate(`${child(childId)}/facts`, input, signal, userId), childId); },
    async createConfirmedFact(childId, input, signal, userId) { return checkedFact(await mutate(`${child(childId)}/facts/confirmed`, input, signal, userId), childId); },
    async confirmFact(childId, factId, input, signal, userId) { return checkedFact(await mutate(`${entity(childId, "facts", factId)}/confirm`, input, signal, userId), childId, factId, input.expectedVersion); },
    async reviseFact(childId, factId, input, signal, userId) { return checkedFact(await mutate(`${entity(childId, "facts", factId)}/revise`, input, signal, userId), childId, factId, input.expectedVersion); },
    async deactivateFact(childId, factId, input, signal, userId) { return checkedFact(await mutate(`${entity(childId, "facts", factId)}/deactivate`, input, signal, userId), childId, factId, input.expectedVersion); },
    async deleteFact(childId, factId, input, signal, userId) { deleted(await mutate(`${entity(childId, "facts", factId)}/delete`, input, signal, userId)); },
    async createTopic(childId, input, signal, userId) { return checkedTopic(await mutate(`${child(childId)}/topics`, input, signal, userId), childId); },
    async changeTopic(childId, topicId, input, signal, userId) { return checkedTopic(await mutate(`${entity(childId, "topics", topicId)}/change`, input, signal, userId), childId, topicId, input.expectedVersion); },
    async reopenTopic(childId, topicId, input, signal, userId) {
      const result = checkedTopic(await mutate(`${entity(childId, "topics", topicId)}/reopen`, input, signal, userId), childId);
      if (result.reopenedFrom !== topicId || result.id === topicId || result.status !== "pending") throw new MemoryApiError(0, null, true);
      return result;
    },
    async deleteTopic(childId, topicId, input, signal, userId) { deleted(await mutate(`${entity(childId, "topics", topicId)}/delete`, input, signal, userId)); },
  };
}
