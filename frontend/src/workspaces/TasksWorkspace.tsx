import { createContext, useContext, type ReactNode } from "react";
import type { TasksActions, TasksViewModel } from "../task-view-model";
import type { WriteRecoveryActions } from "../view-model";

// Presentation injection only. The external domain controller owns reads, writes and authorization.
export interface TasksWorkspaceValue {
  scopeKey: string;
  model: TasksViewModel;
  actions: TasksActions;
  recovery: WriteRecoveryActions;
}
const Context = createContext<TasksWorkspaceValue | null>(null);

// The host passes its current identity/server/child/role scope independently of the loaded value.
// No preview hook runs here; mismatched or not-yet-loaded authority is withheld synchronously.
export function TasksWorkspaceProvider({ scopeKey, value, children }: {
  scopeKey: string; value: TasksWorkspaceValue | null; children: ReactNode;
}) {
  const current = value && scopeKey && value.scopeKey === scopeKey ? value : null;
  return <Context.Provider value={current}>{children}</Context.Provider>;
}
export function useTasksWorkspace() { return useContext(Context); }
