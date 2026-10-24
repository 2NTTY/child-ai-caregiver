import { createContext, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { TasksWorkspaceProvider, type TasksWorkspaceValue } from "../workspaces/TasksWorkspace";
import { PreparationWorkspaceProvider } from "../workspaces/PreparationWorkspace";
import { GrowthWorkspaceProvider, type GrowthWorkspaceValue } from "../workspaces/GrowthWorkspace";
import { MemoryReferenceWorkspaceProvider } from "../workspaces/MemoryReferenceWorkspace";
import { useDomainEnvironment } from "./useDomainEnvironment";
import { useTaskKnowledgeTasks } from "./task-knowledge-tasks";
import { useTaskKnowledgeSummary, type TaskKnowledgeSummaryValue } from "./task-knowledge-summary";
import { useTaskKnowledgeMemory } from "./task-knowledge-memory";
import { useTaskKnowledgeGrowth } from "./task-knowledge-growth";
import { useFamilyDocuments } from "./useFamilyDocuments";
import { usePersonalHistory, PersonalHistoryProvider, type PersonalHistoryOwner } from "./usePersonalHistory";
import type { TaskKnowledgeEnvironment } from "./task-knowledge-runtime";
import { usePathname } from "expo-router";

type MemoryOwner = ReturnType<typeof useTaskKnowledgeMemory>;
type DocumentOwner = ReturnType<typeof useFamilyDocuments>;
type Snapshot = { scopeKey: string; tasks: TasksWorkspaceValue; summary: TaskKnowledgeSummaryValue; memory: MemoryOwner; growth: GrowthWorkspaceValue; documents: DocumentOwner; history: PersonalHistoryOwner };
const SummaryContext = createContext<TaskKnowledgeSummaryValue | null>(null);
const MemoryContext = createContext<MemoryOwner | null>(null);
const DocumentContext = createContext<DocumentOwner | null>(null);
export const useProductionTaskKnowledgeSummary = () => useContext(SummaryContext);
export const useProductionTaskKnowledgeMemory = () => useContext(MemoryContext);
export const useProductionFamilyDocuments = () => useContext(DocumentContext);

// Only the nonvisual controller bridge is replaced on scope changes. The shell stays mounted.
const DomainBridge = memo(function DomainBridge({ env, publish }: { env: TaskKnowledgeEnvironment; publish(value: Snapshot): void }) {
  const tasks = useTaskKnowledgeTasks(env), summary = useTaskKnowledgeSummary(env);
  const history = usePersonalHistory(env);
  const memory = useTaskKnowledgeMemory(env, history), growth = useTaskKnowledgeGrowth(env);
  const documents = useFamilyDocuments(env);
  const archive = growth.model.page?.authorityVersion === documents.archive.authorityVersion ? documents.archive
    : { ...documents.archive, authorityVersion: growth.model.page?.authorityVersion ?? documents.archive.authorityVersion,
      state: documents.archive.authorityVersion ? "invalidated" as const : documents.archive.state,
      snapshot: null, history: [], periods: [], reading: undefined, label: "文件及成長頁的授權基準未能同步，請重新讀取。" };
  const connectedGrowth: GrowthWorkspaceValue = { ...growth, model: { ...growth.model,
    page: growth.model.page ? { ...growth.model.page, archive } : null }, actions: { ...growth.actions,
    refresh() { growth.actions.refresh(); documents.refresh(); } } };
  useLayoutEffect(() => { publish({ scopeKey: env.scopeKey, tasks, summary, memory, growth: connectedGrowth, documents, history }); }, [env.scopeKey, tasks, summary, memory, growth, documents, history, publish]);
  return null;
});

// An account without a selected child still has its own private message history.
// This branch never mounts the child task, memory, document or growth owners.
const AccountHistoryBridge = memo(function AccountHistoryBridge({ env, publish }: {
  env: TaskKnowledgeEnvironment; publish(value: PersonalHistoryOwner): void;
}) {
  const history = usePersonalHistory(env);
  useLayoutEffect(() => { publish(history); }, [history, publish]);
  return null;
});

export function ProductionTaskKnowledgeDomains({ children }: { children: ReactNode }) {
  const env = useDomainEnvironment();
  const pathname = usePathname();
  const historyScope = env.scopeKey || (env.identityKey && env.userId ? JSON.stringify(["account-messages", env.identityKey]) : "");
  const accountEnv = useMemo(() => ({ ...env, scopeKey: historyScope,
    current: () => env.currentIdentity() && !env.owner.getSnapshot().scopeKey }), [env, historyScope]);
  const [accountHistory, setAccountHistory] = useState<PersonalHistoryOwner | null>(null);
  useLayoutEffect(() => { if (env.scopeKey) setAccountHistory(null); }, [env.scopeKey]);
  const publishAccount = useCallback((value: PersonalHistoryOwner) => setAccountHistory(value), []);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const publish = useCallback((value: Snapshot) => setSnapshot(value), []);
  const current = snapshot && env.scopeKey && snapshot.scopeKey === env.scopeKey ? snapshot : null;
  const flushOnLeave = useRef(current?.documents.flushChecks);
  flushOnLeave.current = current?.documents.flushChecks;
  // The persistent owner finishes saves after navigation. Do not wake every
  // domain hook just because a route changed.
  useEffect(() => { flushOnLeave.current?.(); }, [pathname, env.scopeKey]);
  const currentHistory = env.scopeKey ? current?.history ?? null
    : accountHistory?.scopeKey === historyScope ? accountHistory : null;
  return <>
    {env.scopeKey && env.userId && env.childId ? <DomainBridge key={env.scopeKey} env={env} publish={publish} />
      : historyScope && env.userId ? <AccountHistoryBridge key={historyScope} env={accountEnv} publish={publishAccount} /> : null}
    <TasksWorkspaceProvider scopeKey={env.scopeKey} value={current?.tasks ?? null}>
      <PreparationWorkspaceProvider scopeKey={env.scopeKey} value={current?.documents.preparation ?? null}>
        <GrowthWorkspaceProvider scopeKey={env.scopeKey} value={current?.growth ?? null}>
          <MemoryReferenceWorkspaceProvider scopeKey={env.scopeKey} value={current?.memory.value ?? null}>
            <SummaryContext.Provider value={current?.summary ?? null}>
              <MemoryContext.Provider value={current?.memory ?? null}>
                <DocumentContext.Provider value={current?.documents ?? null}><PersonalHistoryProvider scopeKey={historyScope} value={currentHistory}>{children}</PersonalHistoryProvider></DocumentContext.Provider>
              </MemoryContext.Provider>
            </SummaryContext.Provider>
          </MemoryReferenceWorkspaceProvider>
        </GrowthWorkspaceProvider>
      </PreparationWorkspaceProvider>
    </TasksWorkspaceProvider>
  </>;
}
