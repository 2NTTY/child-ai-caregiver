import { createContext, memo, useCallback, useContext, useLayoutEffect, useState, type ReactNode } from "react";
import { TasksWorkspaceProvider, type TasksWorkspaceValue } from "../workspaces/TasksWorkspace";
import { PreparationWorkspaceProvider } from "../workspaces/PreparationWorkspace";
import { GrowthWorkspaceProvider, type GrowthWorkspaceValue } from "../workspaces/GrowthWorkspace";
import { MemoryReferenceWorkspaceProvider } from "../workspaces/MemoryReferenceWorkspace";
import { useDomainEnvironment } from "./useDomainEnvironment";
import { useTaskKnowledgeTasks } from "./task-knowledge-tasks";
import { useTaskKnowledgeSummary, type TaskKnowledgeSummaryValue } from "./task-knowledge-summary";
import { useTaskKnowledgeMemory } from "./task-knowledge-memory";
import { useTaskKnowledgeGrowth } from "./task-knowledge-growth";
import type { TaskKnowledgeEnvironment } from "./task-knowledge-runtime";

type MemoryOwner = ReturnType<typeof useTaskKnowledgeMemory>;
type Snapshot = { scopeKey: string; tasks: TasksWorkspaceValue; summary: TaskKnowledgeSummaryValue; memory: MemoryOwner; growth: GrowthWorkspaceValue };
const SummaryContext = createContext<TaskKnowledgeSummaryValue | null>(null);
const MemoryContext = createContext<MemoryOwner | null>(null);
export const useProductionTaskKnowledgeSummary = () => useContext(SummaryContext);
export const useProductionTaskKnowledgeMemory = () => useContext(MemoryContext);

// Only the nonvisual controller bridge is replaced on scope changes. The shell stays mounted.
const DomainBridge = memo(function DomainBridge({ env, publish }: { env: TaskKnowledgeEnvironment; publish(value: Snapshot): void }) {
  const tasks = useTaskKnowledgeTasks(env), summary = useTaskKnowledgeSummary(env);
  const memory = useTaskKnowledgeMemory(env), growth = useTaskKnowledgeGrowth(env);
  useLayoutEffect(() => { publish({ scopeKey: env.scopeKey, tasks, summary, memory, growth }); }, [env.scopeKey, tasks, summary, memory, growth, publish]);
  return null;
});

export function ProductionTaskKnowledgeDomains({ children }: { children: ReactNode }) {
  const env = useDomainEnvironment();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const publish = useCallback((value: Snapshot) => setSnapshot(value), []);
  const current = snapshot && env.scopeKey && snapshot.scopeKey === env.scopeKey ? snapshot : null;
  return <>
    {env.scopeKey && env.userId && env.childId ? <DomainBridge key={env.scopeKey} env={env} publish={publish} /> : null}
    <TasksWorkspaceProvider scopeKey={env.scopeKey} value={current?.tasks ?? null}>
      <PreparationWorkspaceProvider scopeKey={env.scopeKey} value={current?.summary.preparation ?? null}>
        <GrowthWorkspaceProvider scopeKey={env.scopeKey} value={current?.growth ?? null}>
          <MemoryReferenceWorkspaceProvider scopeKey={env.scopeKey} value={current?.memory.value ?? null}>
            <SummaryContext.Provider value={current?.summary ?? null}>
              <MemoryContext.Provider value={current?.memory ?? null}>{children}</MemoryContext.Provider>
            </SummaryContext.Provider>
          </MemoryReferenceWorkspaceProvider>
        </GrowthWorkspaceProvider>
      </PreparationWorkspaceProvider>
    </TasksWorkspaceProvider>
  </>;
}