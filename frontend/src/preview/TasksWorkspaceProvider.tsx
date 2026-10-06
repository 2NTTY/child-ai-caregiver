import { TasksWorkspaceProvider as InjectTasksWorkspace } from "../workspaces/TasksWorkspace";
import { createContext, useContext, type ReactNode } from "react";
import { useGlobalSearchParams, usePathname } from "expo-router";
import { normalizeHistoryCategory } from "../components/history/history-filters";
import type { HomeChild } from "../view-model";
import { usePreview } from "./PreviewContext";
import { useTasksPreview } from "./useTasksPreview";

type TasksPreviewWorkspaceValue = ReturnType<typeof useTasksPreview> & { scopeKey: string };
const TasksWorkspaceContext = createContext<TasksPreviewWorkspaceValue | null>(null);
const absentChild: HomeChild = { id: "no-authorized-task-child", displayName: "", ageLabel: "未提供", regionLabel: "未提供", allergiesLabel: null, profileConfirmed: false, accessRole: "viewer" };

// A single synthetic Task owner serves Tasks and classified History. It is not a TaskApi adapter.
export function TasksWorkspaceProvider({ children }: { children: ReactNode }) {
  const { model } = usePreview();
  const child = model.children.find(item => item.id === model.selectedChildId);
  const pathname = usePathname();
  const { category } = useGlobalSearchParams<{ category?: string | string[] }>();
  const scopeKey = JSON.stringify(["preview-server", model.caregiverName, child?.id ?? null, child?.accessRole ?? null]);
  const entry = pathname === "/tasks" ? "tasks" : pathname === "/history" && normalizeHistoryCategory(category) === "tasks" ? "task-history" : "";
  const preview = useTasksPreview(child ?? absentChild, model.connection === "online", model.recordsLoad === "loading", scopeKey, entry);
  const value = child && preview.scopeReady ? { ...preview, scopeKey } : null;
  const consumer = value ? { scopeKey, model: { ...value.model, operation: { ...value.model.operation, referenceLabel: value.model.operation.reference ? `合成操作參考：${value.model.operation.reference}；不是 Server opId。` : undefined } }, actions: value.actions, recovery: { checkOriginalOperation: preview.controller.check, retryOriginalOperation: preview.controller.retryOriginal, reloadCurrent: preview.controller.reloadCurrent } } : null;
  return <TasksWorkspaceContext.Provider value={value}><InjectTasksWorkspace scopeKey={scopeKey} value={consumer}>{children}</InjectTasksWorkspace></TasksWorkspaceContext.Provider>;
}
export function useTasksPreviewWorkspace() { return useContext(TasksWorkspaceContext); }
