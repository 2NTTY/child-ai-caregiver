import type { PreviewWriteOperation } from "./preview/usePreviewOperation";

// Presentation-only projection of src/shared/tasks.ts. No transport or task authority lives here.
export type TaskState = "scheduled" | "completed" | "cancelled" | "needs_review";
export type TaskAction = "reschedule" | "complete" | "cancel" | "resolve";
export interface TaskValues {
  title: string; details: string; kind: "ordinary" | "appointment";
  assigneeUserId: string; dueAt: string; timeZone: string;
}
export interface TaskView {
  id: string; childId: string; version: number; title: string; details: string;
  kind: TaskValues["kind"]; assigneeUserId: string; createdBy: string; createdAt: string; updatedAt: string;
  occurrence: { id: string; dueAt: string; timeZone: string; state: TaskState; terminalBasisVersion: number | null };
}
export interface TaskRevisionView {
  task: TaskView; action: "create" | TaskAction; actorUserId: string;
  basisVersion: number; note: string; at: string;
}
export interface TaskAssigneeView { userId: string; name: string }
export interface TaskReminderView {
  id: string; batchId: string; taskId: string; occurrenceId: string; taskVersion: number;
  phase: "initial" | "follow_up"; createdAt: string;
}
export interface TaskWorkView {
  taskId: string; taskVersion: number; status: "pending" | "processed" | "stopped" | "failed" | "unknown";
  nextAt: string; failures: number;
}
export type TaskChangeInput =
  | { action: "reschedule"; expectedVersion: number; confirm: true; dueAt: string; timeZone: string; assigneeUserId: string; note: string }
  | { action: "complete" | "cancel"; expectedVersion: number; confirm: true; note: string }
  | { action: "resolve"; expectedVersion: number; confirm: true; outcome: "completed" | "cancelled"; note: string };
export type TaskDraftMode = "create" | TaskAction;
export interface TaskFormValues extends TaskValues { note: string; outcome: "" | "completed" | "cancelled" }
export interface TaskDraft {
  key: string; mode: TaskDraftMode; basis: TaskView | null;
  initialValues: TaskFormValues; reviewedValues: TaskFormValues | null;
}
export interface TasksViewModel {
  child: { id: string; name: string }; access: "editable" | "read_only" | "lost";
  online: boolean; reading: boolean; dataLabel: string;
  items: TaskView[]; eligibleAssignees: TaskAssigneeView[]; selected: TaskView | null;
  workerEnabled?: boolean; work: TaskWorkView[]; reminders: TaskReminderView[];
  history: TaskRevisionView[]; historyOpen: boolean; hasMoreHistory: boolean;
  draft: TaskDraft | null; latest: TaskView | null; operation: PreviewWriteOperation;
}
export interface TasksActions {
  selectTask(id: string): void; closePanel(): void;
  startCreate(): void; startChange(id: string, action: TaskAction): void;
  reviewDraft(values: TaskFormValues): void; editDraft(): void; submitReviewed(): void;
  useLatestVersion(): void; showHistory(): void; loadOlderHistory(): void;
}
export const taskStateLabels: Record<TaskState, string> = {
  scheduled: "待處理", completed: "已完成", cancelled: "已取消", needs_review: "待覆核 · 已停催",
};
export const taskActionLabels: Record<TaskDraftMode, string> = {
  create: "新增事項", reschedule: "改期／轉派", complete: "完成事項", cancel: "取消事項", resolve: "明確覆核終態",
};
export const taskWorkLabels: Record<TaskWorkView["status"], string> = {
  pending: "待處理", processed: "已處理", stopped: "已停止", failed: "失敗", unknown: "結果未知",
};
export function taskChangeAllowed(task: TaskView, action: TaskAction) {
  return action === "resolve" ? task.occurrence.state === "needs_review" : task.occurrence.state === "scheduled";
}
export function currentTaskMetadata(task: TaskView, assignees: TaskAssigneeView[], work: TaskWorkView[], reminders: TaskReminderView[]) {
  return {
    work: work.find(item => item.taskId === task.id && item.taskVersion === task.version),
    reminders: task.occurrence.state === "scheduled" && assignees.some(item => item.userId === task.assigneeUserId)
      ? reminders.filter(item => item.taskId === task.id && item.taskVersion === task.version && item.occurrenceId === task.occurrence.id) : [],
  };
}
