import { createContext, createElement, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createProductAgentApi } from "../../../src/client/product-agent-api";
import { createAccountApi } from "../../../src/client/account-api";
import type { AgentWork } from "../../../src/shared/agent-work";
import type { MemoryReadProjection, ShortTermContextView, KnowledgeReferencesView } from "../memory-reference-view-model";
import { appendHistoryMessage, notificationHistoryItem, personalHistoryScopeMatches, type HistoryMessageRead, type PersonalHistorySearch, type NotificationHistoryPage } from "../history-view-model";
import { mergeById, useTaskKnowledgeRefresh, useTaskKnowledgeRuntime, domainFailure, type TaskKnowledgeEnvironment } from "./task-knowledge-runtime";

type WorkPage = { items: readonly AgentWork[]; nextCursor: string | null; complete: boolean };
type ReadKind = "work" | "history" | "message" | "notifications" | "references";
const emptyRead = <T,>(scopeKey: string): MemoryReadProjection<T> => ({ scopeKey, state: "unavailable", revision: null, data: null, asOf: null });
const loadedRead = <T,>(scopeKey: string, data: T): MemoryReadProjection<T> => ({
  scopeKey, state: "ready", revision: new Date().toISOString(), asOf: new Date().toISOString(), data,
});

/** One read owner for current personal work, history, delivery metadata and the public source catalog. */
export function usePersonalHistory(env: TaskKnowledgeEnvironment) {
  const api = useMemo(() => createProductAgentApi(env.apiBaseUrl, env.owner.fetcher), [env.apiBaseUrl, env.owner.fetcher]);
  const account = useMemo(() => createAccountApi(env.apiBaseUrl, env.owner.fetcher), [env.apiBaseUrl, env.owner.fetcher]);
  const runtime = useTaskKnowledgeRuntime(env, "personal-history");
  const [work, setWork] = useState<MemoryReadProjection<WorkPage>>(() => emptyRead(env.scopeKey));
  const [history, setHistory] = useState<MemoryReadProjection<PersonalHistorySearch>>(() => emptyRead(env.scopeKey));
  const [message, setMessage] = useState<MemoryReadProjection<HistoryMessageRead>>(() => emptyRead(env.scopeKey));
  const [notifications, setNotifications] = useState<MemoryReadProjection<NotificationHistoryPage>>(() => emptyRead(env.scopeKey));
  const [references, setReferences] = useState<MemoryReadProjection<KnowledgeReferencesView>>(() => emptyRead(env.scopeKey));
  const referenceCursor = useRef<string | null>(null), notificationLoaded = useRef(false), historyLoaded = useRef(false);
  const busyRef = useRef<Record<ReadKind, boolean>>({ work: false, history: false, message: false, notifications: false, references: false });
  const [busy, setBusy] = useState(busyRef.current);
  const latest = useRef({ work, history, message, notifications, references }); latest.current = { work, history, message, notifications, references };
  const selectedMessageId = useRef<string | null>(null);
  const historyLife = useRef({ generation: 0, controller: null as AbortController | null });
  const messageLife = useRef({ generation: 0, controller: null as AbortController | null });
  const markBusy = (kind: ReadKind, value: boolean) => {
    busyRef.current = { ...busyRef.current, [kind]: value }; setBusy(busyRef.current);
  };
  useEffect(() => {
    account.setIdentity(env.userId);
    return () => {
      account.setIdentity(null);
      historyLife.current.generation++; historyLife.current.controller?.abort();
      messageLife.current.generation++; messageLife.current.controller?.abort();
    };
  }, [account, env.userId]);
  const clear = () => {
    setWork(emptyRead(env.scopeKey)); setHistory(emptyRead(env.scopeKey)); setMessage(emptyRead(env.scopeKey));
    setNotifications(emptyRead(env.scopeKey)); setReferences(emptyRead(env.scopeKey));
    referenceCursor.current = null; notificationLoaded.current = false; historyLoaded.current = false; selectedMessageId.current = null;
  };
  const errorRead = <T,>(before: MemoryReadProjection<T>): MemoryReadProjection<T> => before.state === "ready" || before.state === "stale"
    ? { ...before, state: "stale" } : { scopeKey: env.scopeKey, state: "error", revision: null, data: null, asOf: null };
  function read<T>(kind: ReadKind, setter: (next: MemoryReadProjection<T> | ((previous: MemoryReadProjection<T>) => MemoryReadProjection<T>)) => void,
    action: (signal: AbortSignal, current: () => boolean) => Promise<T>, initial: boolean, life?: { generation: number; controller: AbortController | null }) {
    if (!env.userId || !env.childId || !env.online || !runtime.live() || !life && busyRef.current[kind]) return;
    const ticket = life?.generation;
    markBusy(kind, true);
    if (initial) setter({ scopeKey: env.scopeKey, state: "loading", revision: null, data: null, asOf: null });
    void runtime.request(async (signal, scopeCurrent) => {
      const controller = new AbortController(), abort = () => controller.abort();
      signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort();
      if (life) life.controller = controller;
      const current = () => scopeCurrent() && !controller.signal.aborted && (!life || ticket === life.generation);
      try {
        const value = await action(controller.signal, current);
        if (current()) setter(loadedRead(env.scopeKey, value));
      } catch (error) {
        if (!current()) return;
        if (runtime.accessError(error)) clear();
        else if (kind === "notifications" && domainFailure(error).code === "export_scope_changed" || kind === "references" && domainFailure(error).status === 409) {
          if (kind === "notifications") notificationLoaded.current = false;
          else referenceCursor.current = null;
          setter({ scopeKey: env.scopeKey, state: "error", revision: null, data: null, asOf: null });
        } else setter(errorRead);
      } finally {
        signal.removeEventListener("abort", abort);
        if (scopeCurrent() && (!life || ticket === life.generation)) {
          if (life) life.controller = null;
          markBusy(kind, false);
        }
      }
    });
  }
  const readWork = (more = false) => {
    const before = latest.current.work.data, cursor = more ? before?.nextCursor : null;
    if (more && !cursor) return;
    read("work", setWork, async signal => {
      const page = await api.getWork(env.childId!, signal, env.userId!, null, cursor ?? null);
      return { ...page, items: more ? mergeById(before?.items ?? [], page.items) : page.items };
    }, !before);
  };
  const readReferences = (more = false) => {
    const before = latest.current.references.data, cursor = more ? referenceCursor.current : null;
    if (more && !cursor) return;
    read("references", setReferences, async (signal, current) => {
      const page = await api.getLibrary(env.childId!, signal, env.userId!, cursor);
      if (more && page.nextCursor === cursor) throw new Error("Repeated library cursor");
      if (current()) referenceCursor.current = page.nextCursor;
      const incoming = new Map(page.items.map(item => [item.sourceId, item]));
      return { audience: "public" as const, items: [], catalog: more
        ? [...(before?.catalog ?? []).filter(item => !incoming.has(item.sourceId)), ...page.items] : page.items,
        hasMore: !page.complete };
    }, !more || !before);
  };
  const searchHistory = (query: string, more = false) => {
    const before = latest.current.history.data, cursor = more ? before?.nextCursor : null;
    if (query.length > 200 || more && (!cursor || before?.query !== query)) return;
    if (more && busyRef.current.history) return;
    historyLife.current.generation++; historyLife.current.controller?.abort();
    if (!more) closeMessage();
    read("history", setHistory, async (signal, current) => {
      const page = await api.searchHistory(env.childId!, "message", query, signal, env.userId!, cursor ?? null);
      if (more && page.nextCursor === cursor) throw new Error("Repeated history cursor");
      if (current()) historyLoaded.current = true;
      return { query, matches: more ? mergeById(before?.matches ?? [], page.matches) : page.matches,
        scanned: (more ? before?.scanned ?? 0 : 0) + page.scanned, complete: page.complete, nextCursor: page.nextCursor };
    }, !more, historyLife.current);
  };
  const closeMessage = () => {
    messageLife.current.generation++; messageLife.current.controller?.abort(); markBusy("message", false);
    selectedMessageId.current = null; setMessage(emptyRead(env.scopeKey));
  };
  const readMessage = (id: string, more = false) => {
    const before = latest.current.message.data;
    if (more && (busyRef.current.message || before?.id !== id || before.nextOffset === null)) return;
    messageLife.current.generation++; messageLife.current.controller?.abort();
    selectedMessageId.current = id;
    read("message", setMessage, async signal => appendHistoryMessage(more ? before : null,
      await api.readHistory(env.childId!, id, more ? before!.nextOffset! : 0, signal, env.userId!)), !more, messageLife.current);
  };
  const readNotifications = (more = false) => {
    const before = latest.current.notifications.data, cursor = more ? before?.nextCursor : null;
    if (more && !cursor) return;
    read("notifications", setNotifications, async (signal, current) => {
      const page = await account.exportPage(env.userId!, { section: "notification_deliveries",
        ...(more ? { scopeVersion: before!.scopeVersion, cursor: cursor! } : {}) }, signal);
      if (more && page.nextCursor === cursor) throw new Error("Repeated notification cursor");
      if (current()) notificationLoaded.current = true;
      const items = page.items.map(notificationHistoryItem);
      return { items: more ? mergeById(before?.items ?? [], items) : items,
        scopeVersion: page.scopeVersion, nextCursor: page.nextCursor, complete: page.complete };
    }, !more || !before);
  };
  const refresh = () => {
    readWork(); readReferences();
    if (historyLoaded.current) searchHistory(latest.current.history.data?.query ?? "");
    if (notificationLoaded.current) readNotifications();
  };
  useTaskKnowledgeRefresh(refresh, env.online && !!env.childId && !runtime.lost, Object.values(busy).some(Boolean));
  const onlineRead = <T,>(value: MemoryReadProjection<T>): MemoryReadProjection<T> => !env.online && value.state === "ready" ? { ...value, state: "stale" } : value;
  const shortTerm: MemoryReadProjection<ShortTermContextView> = work.data ? { ...work, data: {
    works: work.data.items, hasMoreWorks: !work.data.complete, messages: [], messageRead: work.data.items.some(item => item.sourceMessageIds.includes(selectedMessageId.current ?? "")) ? onlineRead(message) : undefined,
  } } : { ...work, data: null };
  return { scopeKey: env.scopeKey, childId: env.childId ?? "", childName: env.childName, online: env.online,
    access: runtime.lost ? "revoked" as const : "active" as const,
    work: runtime.lost ? emptyRead<WorkPage>(env.scopeKey) : onlineRead(work),
    history: runtime.lost ? emptyRead<PersonalHistorySearch>(env.scopeKey) : onlineRead(history),
    message: runtime.lost ? emptyRead<HistoryMessageRead>(env.scopeKey) : onlineRead(message),
    notifications: runtime.lost ? emptyRead<NotificationHistoryPage>(env.scopeKey) : onlineRead(notifications),
    shortTerm: runtime.lost ? emptyRead<ShortTermContextView>(env.scopeKey) : onlineRead(shortTerm),
    references: runtime.lost ? emptyRead<KnowledgeReferencesView>(env.scopeKey) : onlineRead(references), busy,
    actions: {
      refresh, searchHistory: (query: string) => searchHistory(query), moreHistory: () => { const query = latest.current.history.data?.query; if (query !== undefined) searchHistory(query, true); },
      readMessage: (id: string) => readMessage(id), moreMessage: () => { const id = latest.current.message.data?.id; if (id) readMessage(id, true); },
      closeMessage, moreWork: () => readWork(true), loadNotifications: () => readNotifications(),
      moreNotifications: () => readNotifications(true), moreReferences: () => readReferences(true),
    },
  };
}
export type PersonalHistoryOwner = ReturnType<typeof usePersonalHistory>;
export const PersonalHistoryContext = createContext<PersonalHistoryOwner | null>(null);
export function PersonalHistoryProvider({ scopeKey, value, children }: { scopeKey: string; value: PersonalHistoryOwner | null; children: ReactNode }) {
  const current = personalHistoryScopeMatches(scopeKey, value) ? value : null;
  return createElement(PersonalHistoryContext.Provider, { value: current }, children);
}
export const usePersonalHistoryWorkspace = () => useContext(PersonalHistoryContext);
