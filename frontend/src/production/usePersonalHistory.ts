import { createContext, createElement, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createProductAgentApi } from "../../../src/client/product-agent-api";
import { createNotificationMessagesApi } from "./notification-messages-api";
import type { AgentWork } from "../../../src/shared/agent-work";
import type { MemoryReadProjection, ShortTermContextView, KnowledgeReferencesView } from "../memory-reference-view-model";
import { appendHistoryMessage, personalHistoryScopeMatches, type HistoryMessageRead, type PersonalHistorySearch, type PersonalMessagesPage } from "../history-view-model";
import { mergeById, useTaskKnowledgeRefresh, useTaskKnowledgeRuntime, domainFailure, type TaskKnowledgeEnvironment } from "./task-knowledge-runtime";

type WorkPage = { items: readonly AgentWork[]; nextCursor: string | null; complete: boolean };
type ReadKind = "work" | "history" | "message" | "notifications" | "references";
type PagedReadKind = Exclude<ReadKind, "message">;

// Re-read only the previously loaded depth, using this batch's fresh cursors.
// Never publish a partial refresh or merge an old page into a new snapshot.
async function readPageWindow<T extends { nextCursor: string | null; complete: boolean }>(
  depth: number, cursor: string | null, current: () => boolean, readPage: (cursor: string | null) => Promise<T>,
): Promise<T[]> {
  const pages: T[] = [], seen = new Set(cursor === null ? [] : [cursor]);
  for (let index = 0; index < depth; index++) {
    if (!current()) throw new Error("Obsolete personal read");
    const page = await readPage(cursor);
    if (!current()) throw new Error("Obsolete personal read");
    if (page.nextCursor !== null && seen.has(page.nextCursor)) throw new Error("Repeated personal read cursor");
    pages.push(page);
    if (page.complete) break;
    cursor = page.nextCursor;
    if (cursor === null) throw new Error("Incomplete personal read without a cursor");
    seen.add(cursor);
  }
  return pages;
}
const emptyRead = <T,>(scopeKey: string): MemoryReadProjection<T> => ({ scopeKey, state: "unavailable", revision: null, data: null, asOf: null });
const loadedRead = <T,>(scopeKey: string, data: T): MemoryReadProjection<T> => ({
  scopeKey, state: "ready", revision: new Date().toISOString(), asOf: new Date().toISOString(), data,
});

/** One read owner for current personal work, history, saved outbound messages and the public source catalog. */
export function usePersonalHistory(env: TaskKnowledgeEnvironment) {
  const api = useMemo(() => createProductAgentApi(env.apiBaseUrl, env.owner.fetcher), [env.apiBaseUrl, env.owner.fetcher]);
  const messagesApi = useMemo(() => createNotificationMessagesApi(env.apiBaseUrl, env.owner.fetcher), [env.apiBaseUrl, env.owner.fetcher]);
  const runtime = useTaskKnowledgeRuntime(env, "personal-history");
  const [work, setWork] = useState<MemoryReadProjection<WorkPage>>(() => emptyRead(env.scopeKey));
  const [history, setHistory] = useState<MemoryReadProjection<PersonalHistorySearch>>(() => emptyRead(env.scopeKey));
  const [message, setMessage] = useState<MemoryReadProjection<HistoryMessageRead>>(() => emptyRead(env.scopeKey));
  const [notificationUnavailable, setNotificationUnavailable] = useState(false);
  const [notifications, setNotifications] = useState<MemoryReadProjection<PersonalMessagesPage>>(() => emptyRead(env.scopeKey));
  const [references, setReferences] = useState<MemoryReadProjection<KnowledgeReferencesView>>(() => emptyRead(env.scopeKey));
  const referenceCursor = useRef<string | null>(null), notificationLoaded = useRef(false), historyLoaded = useRef(false);
  const busyRef = useRef<Record<ReadKind, boolean>>({ work: false, history: false, message: false, notifications: false, references: false });
  const [busy, setBusy] = useState(busyRef.current);
  const latest = useRef({ work, history, message, notifications, references }); latest.current = { work, history, message, notifications, references };
  const selectedMessageId = useRef<string | null>(null);
  const pageDepth = useRef<Record<PagedReadKind, number>>({ work: 1, history: 1, notifications: 1, references: 1 });
  const activeHistoryQuery = useRef<string | null>(null);
  const historyLife = useRef({ generation: 0, controller: null as AbortController | null });
  const messageLife = useRef({ generation: 0, controller: null as AbortController | null });
  const markBusy = (kind: ReadKind, value: boolean) => {
    busyRef.current = { ...busyRef.current, [kind]: value }; setBusy(busyRef.current);
  };
  useEffect(() => {
    messagesApi.setIdentity(env.userId);
    return () => {
      messagesApi.setIdentity(null);
      historyLife.current.generation++; historyLife.current.controller?.abort();
      messageLife.current.generation++; messageLife.current.controller?.abort();
    };
  }, [messagesApi, env.userId]);
  const clear = () => {
    setWork(emptyRead(env.scopeKey)); setHistory(emptyRead(env.scopeKey)); setMessage(emptyRead(env.scopeKey));
    setNotifications(emptyRead(env.scopeKey)); setNotificationUnavailable(false); setReferences(emptyRead(env.scopeKey));
    referenceCursor.current = null; notificationLoaded.current = false; historyLoaded.current = false; selectedMessageId.current = null;
    pageDepth.current = { work: 1, history: 1, notifications: 1, references: 1 }; activeHistoryQuery.current = null;
  };
  const errorRead = <T,>(before: MemoryReadProjection<T>): MemoryReadProjection<T> => before.state === "ready" || before.state === "stale"
    ? { ...before, state: "stale" } : { scopeKey: env.scopeKey, state: "error", revision: null, data: null, asOf: null };
  function read<T>(kind: ReadKind, setter: (next: MemoryReadProjection<T> | ((previous: MemoryReadProjection<T>) => MemoryReadProjection<T>)) => void,
    action: (signal: AbortSignal, current: () => boolean) => Promise<T>, initial: boolean, life?: { generation: number; controller: AbortController | null }) {
    if (!env.userId || kind !== "notifications" && !env.childId || !env.online || !runtime.live() || !life && busyRef.current[kind]) return;
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
        if (kind === "notifications" && domainFailure(error).code === "message_history_unavailable") {
          setNotificationUnavailable(true); notificationLoaded.current = false; pageDepth.current.notifications = 1;
          setter({ scopeKey: env.scopeKey, state: "unavailable", revision: null, data: null, asOf: null });
        } else if (runtime.accessError(error)) clear();
        else if (kind === "notifications" && ["messages_scope_changed", "invalid_message_cursor"].includes(domainFailure(error).code ?? "") || kind === "references" && domainFailure(error).status === 409) {
          if (kind === "notifications") { notificationLoaded.current = false; pageDepth.current.notifications = 1; }
          else referenceCursor.current = null;
          pageDepth.current[kind] = 1;
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
    const depth = more ? 1 : pageDepth.current.work;
    read("work", setWork, async (signal, current) => {
      const pages = await readPageWindow(depth, cursor ?? null, current,
        next => api.getWork(env.childId!, signal, env.userId!, null, next));
      const items = pages.reduce((items, page) => mergeById(items, page.items), more ? [...(before?.items ?? [])] : [] as AgentWork[]);
      if (current()) pageDepth.current.work = more ? pageDepth.current.work + pages.length : pages.length;
      return { ...pages[pages.length - 1], items };
    }, !before);
  };
  const readReferences = (more = false) => {
    const before = latest.current.references.data, cursor = more ? referenceCursor.current : null;
    if (more && !cursor) return;
    const depth = more ? 1 : pageDepth.current.references;
    read("references", setReferences, async (signal, current) => {
      const pages = await readPageWindow(depth, cursor, current,
        next => api.getLibrary(env.childId!, signal, env.userId!, next));
      const page = pages[pages.length - 1], catalog = new Map((more ? before?.catalog ?? [] : []).map(item => [item.sourceId, item]));
      for (const item of pages.flatMap(page => page.items)) catalog.set(item.sourceId, item);
      if (current()) {
        referenceCursor.current = page.nextCursor;
        pageDepth.current.references = more ? pageDepth.current.references + pages.length : pages.length;
      }
      return { audience: "public" as const, items: [], catalog: [...catalog.values()], hasMore: !page.complete };
    }, !before);
  };
  const searchHistory = (query: string, more = false) => {
    const before = latest.current.history.data, cursor = more ? before?.nextCursor : null;
    if (query.length > 200 || more && (!cursor || before?.query !== query)) return;
    if (busyRef.current.history && (more || activeHistoryQuery.current === query)) return;
    const sameQuery = before?.query === query, depth = more || !sameQuery ? 1 : pageDepth.current.history;
    historyLife.current.generation++; historyLife.current.controller?.abort(); activeHistoryQuery.current = query;
    if (!more && !sameQuery) closeMessage();
    read("history", setHistory, async (signal, current) => {
      const pages = await readPageWindow(depth, cursor ?? null, current,
        next => api.searchHistory(env.childId!, "message", query, signal, env.userId!, next));
      if (current()) {
        historyLoaded.current = true;
        pageDepth.current.history = more ? pageDepth.current.history + pages.length : pages.length;
      }
      const page = pages[pages.length - 1];
      return { query, matches: pages.reduce((items, page) => mergeById(items, page.matches), more ? [...(before?.matches ?? [])] : [] as PersonalHistorySearch["matches"][number][]),
        scanned: (more ? before?.scanned ?? 0 : 0) + pages.reduce((count, page) => count + page.scanned, 0), complete: page.complete, nextCursor: page.nextCursor };
    }, !before || !sameQuery, historyLife.current);
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
      await api.readHistory(env.childId!, id, more ? before!.nextOffset! : 0, signal, env.userId!, more ? before!.contentVersion : undefined)), !more, messageLife.current);
  };
  const readNotifications = (more = false) => {
    const before = latest.current.notifications.data, cursor = more ? before?.nextCursor : null;
    if (more && !cursor) return;
    const depth = more ? 1 : pageDepth.current.notifications;
    setNotificationUnavailable(false);
    read("notifications", setNotifications, async (signal, current) => {
      let scopeVersion = before?.scopeVersion;
      let asOf: string | undefined = more ? before?.asOf : undefined;
      const pages = await readPageWindow(depth, cursor ?? null, current, async next => {
        const page = await messagesApi.page(env.userId!, {
          ...(scopeVersion ? { scopeVersion } : {}), ...(next ? { cursor: next } : {}),
        }, signal);
        if (asOf && page.asOf !== asOf) throw new Error("Message page observation bound changed");
        scopeVersion = page.scopeVersion; asOf = page.asOf;
        return page;
      });
      const items = pages.reduce((items, page) => mergeById(items, page.items.map(item => ({ ...item, id: item.messageId }))),
        more ? [...(before?.items ?? [])] : [] as PersonalMessagesPage["items"][number][]);
      if (current()) {
        notificationLoaded.current = true;
        pageDepth.current.notifications = more ? pageDepth.current.notifications + pages.length : pages.length;
      }
      return { ...pages[pages.length - 1], items };
    }, !before);
  };
  const refresh = () => {
    if (env.childId) { readWork(); readReferences(); }
    if (historyLoaded.current && !busyRef.current.history) searchHistory(latest.current.history.data?.query ?? "");
    if (notificationLoaded.current) readNotifications();
  };
  useTaskKnowledgeRefresh(refresh, env.online && !!env.userId && !runtime.lost, Object.values(busy).some(Boolean));
  const onlineRead = <T,>(value: MemoryReadProjection<T>): MemoryReadProjection<T> => !env.online && value.state === "ready" ? { ...value, state: "stale" } : value;
  const shortTerm: MemoryReadProjection<ShortTermContextView> = work.data ? { ...work, data: {
    works: work.data.items, hasMoreWorks: !work.data.complete, messages: [], messageRead: work.data.items.some(item => item.sourceMessageIds.includes(selectedMessageId.current ?? "")) ? onlineRead(message) : undefined,
  } } : { ...work, data: null };
  return { scopeKey: env.scopeKey, messageOnly: !env.childId, childId: env.childId ?? "", childName: env.childName, online: env.online,
    access: runtime.lost ? "revoked" as const : "active" as const,
    work: runtime.lost ? emptyRead<WorkPage>(env.scopeKey) : onlineRead(work),
    history: runtime.lost ? emptyRead<PersonalHistorySearch>(env.scopeKey) : onlineRead(history),
    get selectedMessageId() { return runtime.lost ? null : selectedMessageId.current; },
    message: runtime.lost ? emptyRead<HistoryMessageRead>(env.scopeKey) : onlineRead(message),
    notificationUnavailable,
    notifications: runtime.lost ? emptyRead<PersonalMessagesPage>(env.scopeKey) : onlineRead(notifications),
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
