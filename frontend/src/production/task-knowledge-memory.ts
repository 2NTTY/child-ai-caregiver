import { readLoadedIdWindow } from "./task-knowledge-read-window";
import type { PersonalHistoryOwner } from "./usePersonalHistory";
import { useEffect, useMemo, useRef, useState } from "react";
import { createMemoryApi, MemoryApiError } from "../../../src/client/memory-api";
import type { MemoryFact, MemoryTopic } from "../../../src/shared/memory";
import type { MemoryFactView, MemorySummaryView, MemoryTopicView } from "../memory-view-model";
import type { LongTermMemoryView, MemoryReferenceWorkspaceValue } from "../memory-reference-view-model";
import { useTaskKnowledgeMemoryManagement, type MemoryManagementEntity } from "./task-knowledge-memory-management";
import { mergeById, useTaskKnowledgeRefresh, useTaskKnowledgeRuntime, type TaskKnowledgeEnvironment } from "./task-knowledge-runtime";

export function useTaskKnowledgeMemory(env: TaskKnowledgeEnvironment, personalHistory?: PersonalHistoryOwner | null) {
  const api = useMemo(() => createMemoryApi(env.apiBaseUrl, env.owner.fetcher, env.sharing), [env.apiBaseUrl, env.owner.fetcher, env.sharing]);
  const runtime = useTaskKnowledgeRuntime(env, "memory");
  const [facts, setFacts] = useState<MemoryFactView[]>([]), [summary, setSummary] = useState<MemorySummaryView | null>(null);
  const [topics, setTopics] = useState<MemoryTopicView[]>([]), [topicCursor, setTopicCursor] = useState<string | null>(null);
  const [topicHistories, setTopicHistories] = useState<Record<string, { topicVersion: number; items: MemoryTopicView[]; cursor: number | null }>>({});
  const managementRef = useRef<{ busy: boolean; pending: unknown; conflict: unknown; check(): void } | null>(null);
  const [cursor, setCursor] = useState<string | null>(null), [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false), [asOf, setAsOf] = useState<string | null>(null);
  const [histories, setHistories] = useState<LongTermMemoryView["histories"]>({});
  const readThrough = useRef({ facts: null as string | null, topics: null as string | null });
  const historyCursors = useRef<Record<string, number | null>>({}), inFlight = useRef(false);
  useEffect(() => () => { inFlight.current = false; }, []);
  const topicView = (value: MemoryTopic): MemoryTopicView => ({ ...value, authorSelf: value.updatedBy === env.userId });
  const factView = (value: MemoryFact): MemoryFactView => ({ ...value, authorSelf: value.createdBy === env.userId });
  const verified = async <T,>(action: (signal: AbortSignal) => Promise<T>, signal: AbortSignal) => {
    if (await api.getSession(signal) !== env.userId) throw new MemoryApiError(401);
    const value = await action(signal);
    if (await api.getSession(signal) !== env.userId) throw new MemoryApiError(401);
    return value;
  };
  const clearAccess = (error: unknown) => {
    if (!runtime.accessError(error)) return false;
    setFacts([]); setTopics([]); setTopicHistories({}); setSummary(null); setHistories({}); historyCursors.current = {}; setLoaded(false); setCursor(null); setTopicCursor(null); readThrough.current = { facts: null, topics: null }; return true;
  };
  const loadAll = async (signal: AbortSignal, current: () => boolean, preserveReading = false) => {
    // A later denial must still revoke this read set if another parallel read
    // already rejected with a transient failure.
    const checkedRead = <T,>(read: Promise<T>) => read.catch(error => { if (current()) clearAccess(error); throw error; });
    const [factPages, topicPages, summaryValue] = await Promise.all([
      checkedRead(readLoadedIdWindow(preserveReading ? readThrough.current.facts : null, current,
        after => runtime.read(["facts", after], next => verified(inner => api.facts(env.childId!, after, inner), next), signal))),
      checkedRead(readLoadedIdWindow(preserveReading ? readThrough.current.topics : null, current,
        after => runtime.read(["topics", after], next => verified(inner => api.topics(env.childId!, after, inner), next), signal))),
      checkedRead(runtime.read(["summary"], next => verified(inner => api.summary(env.childId!, inner), next), signal)),
    ]);
    if (!current()) return;
    const nextFacts = factPages.flatMap(page => page.items.map(factView)), nextTopics = topicPages.flatMap(page => page.items.map(topicView));
    const factVersions = new Map(nextFacts.map(item => [item.id, item.version])), topicVersions = new Map(nextTopics.map(item => [item.id, item.version]));
    const nextHistories = preserveReading ? Object.fromEntries(Object.entries(histories).filter(([id, history]) => factVersions.get(id) === history.factVersion)) : {};
    setHistories(nextHistories);
    historyCursors.current = Object.fromEntries(Object.entries(historyCursors.current).filter(([id]) => id in nextHistories));
    setTopicHistories(previous => preserveReading ? Object.fromEntries(Object.entries(previous).filter(([id, history]) => topicVersions.get(id) === history.topicVersion)) : {});
    readThrough.current = { facts: nextFacts.at(-1)?.id ?? null, topics: nextTopics.at(-1)?.id ?? null };
    setFacts(nextFacts); setCursor(factPages.at(-1)!.nextAfterId); setTopics(nextTopics); setTopicCursor(topicPages.at(-1)!.nextAfterId); setSummary(summaryValue);
    setLoaded(true); setFailed(false); setAsOf(new Date().toISOString());
  };
  const refresh = (after: string | null = null, preserveReading = false) => {
    if (inFlight.current || managementRef.current?.busy || !env.online || !runtime.live()) return;
    if (after === null && (managementRef.current?.pending || managementRef.current?.conflict)) { managementRef.current.check(); return; }
    inFlight.current = true; setBusy(true);
    void runtime.request(async (signal, current) => {
      try {
        if (after === null) await loadAll(signal, current, preserveReading);
        else {
          const value = await runtime.read(["facts", after], next => verified(inner => api.facts(env.childId!, after, inner), next), signal);
          if (!current()) return;
          readThrough.current.facts = value.items.at(-1)?.id ?? readThrough.current.facts;
          setFacts(before => mergeById(before, value.items.map(factView))); setCursor(value.nextAfterId); setFailed(false); setAsOf(new Date().toISOString());
        }
      } catch (error) { if (current() && !clearAccess(error)) setFailed(true); }
      finally { if (current()) { inFlight.current = false; setBusy(false); } }
    });
  };
  const history = (id: string, expectedVersion: number, older: boolean) => {
    const basis = facts.find(item => item.id === id && item.version === expectedVersion);
    const before = older ? historyCursors.current[id] : null;
    if (!basis || inFlight.current || managementRef.current?.busy || !env.online || !runtime.live() || older && !before) return;
    inFlight.current = true; setBusy(true);
    setHistories(previous => ({ ...previous, [id]: { factVersion: expectedVersion, state: "loading", items: previous[id]?.items ?? [], hasMore: !!before } }));
    void runtime.request(async (signal, current) => {
      try {
        const value = await runtime.read(["history", id, before, expectedVersion], next => verified(inner => api.factHistory(env.childId!, id, before ?? null, inner), next), signal);
        if (!current()) return;
        historyCursors.current[id] = value.nextBeforeVersion;
        setHistories(previous => ({ ...previous, [id]: { factVersion: expectedVersion, state: "ready",
          items: older ? [...(previous[id]?.items ?? []), ...value.revisions.filter(item => !previous[id]?.items.some(old => old.version === item.version)).map(factView)] : value.revisions.map(factView),
          hasMore: value.nextBeforeVersion !== null } }));
      } catch (error) {
        if (current() && !clearAccess(error)) setHistories(previous => ({ ...previous, [id]: { factVersion: expectedVersion, state: "error", items: [], hasMore: false } }));
      } finally { if (current()) { inFlight.current = false; setBusy(false); } }
    });
  };
  const management = useTaskKnowledgeMemoryManagement({ env, api, runtime, loadAll, reading: () => inFlight.current, readFailed: () => setFailed(true),
    currentEntity(entity) {
      if (runtime.lost) return null;
      if (entity.kind === "fact") { const item = facts.find(value => value.id === entity.item.id); return item ? { kind: "fact", item } : null; }
      const item = topics.find(value => value.id === entity.item.id); return item ? { kind: "topic", item } : null;
    },
    changed(intent, value) {
      setSummary(null);
      if (intent.kind === "delete_fact") { setFacts(before => before.filter(item => item.id !== intent.basis.id)); setHistories({}); }
      else if (intent.kind === "delete_topic") { setTopics(before => before.filter(item => item.id !== intent.basis.id)); setTopicHistories({}); }
      else if (value && "key" in value) setFacts(before => [factView(value), ...before.filter(item => item.id !== value.id)]);
      else if (value && "title" in value) setTopics(before => [topicView(value), ...before.filter(item => item.id !== value.id)]);
    },
    async latestEntity(entity, signal): Promise<MemoryManagementEntity | null> {
      if (entity.kind === "fact") {
        const value = await runtime.read(["history", entity.item.id, null, "latest"], next => verified(inner => api.factHistory(env.childId!, entity.item.id, null, inner), next), signal);
        const item = value.revisions[0]; if (!item || !runtime.live()) return null;
        const projected = factView(item); setFacts(before => mergeById(before, [projected])); return { kind: "fact", item: projected };
      }
      const value = await runtime.read(["topic-history", entity.item.id, null], next => verified(inner => api.topicHistory(env.childId!, entity.item.id, null, inner), next), signal);
      const item = value.revisions[0]; if (!item || !runtime.live()) return null;
      const projected = topicView(item); setTopics(before => mergeById(before, [projected])); return { kind: "topic", item: projected };
    },
  });
  managementRef.current = management;
  useTaskKnowledgeRefresh(() => refresh(null, true), env.online && !!env.childId && !runtime.lost, busy || management.busy);
  const moreTopics = () => {
    const after = topicCursor;
    if (!after || inFlight.current || management.busy || !runtime.live() || !env.online) return;
    inFlight.current = true; setBusy(true);
    void runtime.request(async (signal, current) => {
      try {
        const value = await runtime.read(["topics", after], next => verified(inner => api.topics(env.childId!, after, inner), next), signal);
        if (current()) { readThrough.current.topics = value.items.at(-1)?.id ?? readThrough.current.topics; setTopics(before => mergeById(before, value.items.map(topicView))); setTopicCursor(value.nextAfterId); }
      } catch (error) { if (current() && !clearAccess(error)) setFailed(true); }
      finally { if (current()) { inFlight.current = false; setBusy(false); } }
    });
  };
  const topicHistory = (id: string, expectedVersion: number, older = false) => {
    const basis = topics.find(item => item.id === id && item.version === expectedVersion), before = older ? topicHistories[id]?.cursor : null;
    if (!basis || inFlight.current || management.busy || !env.online || !runtime.live() || older && !before) return;
    inFlight.current = true; setBusy(true);
    void runtime.request(async (signal, current) => {
      try {
        const value = await runtime.read(["topic-history", id, before], next => verified(inner => api.topicHistory(env.childId!, id, before ?? null, inner), next), signal);
        if (current()) setTopicHistories(previous => ({ ...previous, [id]: { topicVersion: expectedVersion, items: older ? [...(previous[id]?.items ?? []), ...value.revisions.filter(item => !previous[id]?.items.some(old => old.version === item.version)).map(topicView)] : value.revisions.map(topicView), cursor: value.nextBeforeVersion } }));
      } catch (error) { if (current() && !clearAccess(error)) setFailed(true); }
      finally { if (current()) { inFlight.current = false; setBusy(false); } }
    });
  };
  const value: MemoryReferenceWorkspaceValue = { scopeKey: env.scopeKey, model: {
    scopeKey: env.scopeKey, childId: env.childId!, childName: env.childName, access: runtime.lost ? "revoked" : "active", online: env.online,
    dataLabel: "查看已保存記憶及來源",
    shortTerm: personalHistory?.scopeKey === env.scopeKey ? personalHistory.shortTerm : { scopeKey: env.scopeKey, state: "unavailable", revision: null, data: null, asOf: null },
    references: personalHistory?.scopeKey === env.scopeKey ? personalHistory.references : { scopeKey: env.scopeKey, state: "unavailable", revision: null, data: null, asOf: null },
    longTerm: loaded && !runtime.lost ? { scopeKey: env.scopeKey, state: failed || !env.online ? "stale" : "ready", revision: JSON.stringify([facts.map(item => [item.id, item.version]), summary?.id, summary?.version]),
      asOf, data: { childId: env.childId!, facts, hasMoreFacts: cursor !== null, summary, histories } }
      : { scopeKey: env.scopeKey, state: failed ? "error" : "loading", revision: null, data: null, asOf: null },
  }, reads: {
    loadMoreReferences: personalHistory?.actions.moreReferences, loadMoreWork: personalHistory?.actions.moreWork,
    readWorkMessage: personalHistory?.actions.readMessage, loadMoreWorkMessage: personalHistory?.actions.moreMessage,
    closeWorkMessage: personalHistory?.actions.closeMessage, refreshContext: personalHistory?.actions.refresh,
    workBusy: personalHistory?.busy.work, messageBusy: personalHistory?.busy.message, referencesBusy: personalHistory?.busy.references,
    loadMoreFacts() { if (cursor) refresh(cursor); }, readFactHistory(id, expectedVersion) { history(id, expectedVersion, false); },
    loadMoreFactHistory(id, expectedVersion) { history(id, expectedVersion, true); },
  } };
  return { value, refresh: () => refresh(), busy: busy || management.busy, failed, lost: runtime.lost, management, role: env.role, sharedMode: env.sharedMode, facts: runtime.lost ? [] : facts, topics: runtime.lost ? [] : topics, hasMoreTopics: topicCursor !== null, moreTopics, topicHistory, topicHistories: runtime.lost ? {} : topicHistories };
}
