import { DateTime } from "luxon";
import type { WriteOperationView } from "./view-model";

// Presentation-only projection of src/shared/tasks.ts. No transport or task authority lives here.
export type TaskState = "scheduled" | "completed" | "cancelled" | "needs_review";
export type TaskAction = "reschedule" | "complete" | "cancel" | "resolve";
export interface TaskValues {
  title: string; details: string; kind: "ordinary" | "appointment";
  assigneeUserId: string; dueAt: string; timeZone: string;
}
export interface TaskView {
  id: string; childId: string; version: number; title: string; details: string;
  // Presentation metadata must come from the matching completion revision, never dueAt/updatedAt.
  completedAt?: string; terminalAt?: string;
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
  // List read state is independent of mutations; omitted by older preview adapters.
  readState?: "loading" | "ready" | "error" | "stale";
  scheduleContext: { asOf: string; timeZone: string };
  items: TaskView[]; eligibleAssignees: TaskAssigneeView[]; selected: TaskView | null;
  hasMoreTasks: boolean; loadingMoreTasks: boolean;
  workerEnabled?: boolean; work: TaskWorkView[]; reminders: TaskReminderView[];
  history: TaskRevisionView[]; historyOpen: boolean; hasMoreHistory: boolean;
  draft: TaskDraft | null; latest: TaskView | null; operation: WriteOperationView;
}
export interface TasksActions {
  selectTask(id: string): void; closePanel(): void;
  startCreate(): void; startChange(id: string, action: TaskAction): void;
  reviewDraft(values: TaskFormValues): void; editDraft(): void; submitReviewed(): void;
  useLatestVersion(): void; showHistory(): void; loadOlderHistory(): void;
  loadMoreTasks(): void;
}
export const taskStateLabels: Record<TaskState, string> = {
  scheduled: "待處理", completed: "已回報完成", cancelled: "已取消", needs_review: "待覆核 · 已停催",
};
export const taskActionLabels: Record<TaskDraftMode, string> = {
  create: "新增事項", reschedule: "改期／轉派", complete: "完成事項", cancel: "取消事項", resolve: "核對完成或取消",
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

export interface TaskScheduleSection { id: string; label: string; items: TaskView[] }
export interface TaskScheduleContext { asOf: string; timeZone: string }
export type TaskHistoryFilter = "all" | "completed" | "cancelled";
export const RECENT_COMPLETED_LIMIT = 10;
export function pendingTasks(tasks: readonly TaskView[]) {
  return tasks.filter(task => task.occurrence.state === "scheduled" || task.occurrence.state === "needs_review");
}
export function taskWithCompletionRevision(task: TaskView, revisions: readonly TaskRevisionView[]): TaskView {
  const terminal = task.occurrence.state === "completed" || task.occurrence.state === "cancelled";
  const revision = terminal ? revisions.find(item =>
    item.task.id === task.id && item.task.childId === task.childId && item.task.version === task.version &&
    item.task.occurrence.id === task.occurrence.id && item.task.occurrence.state === task.occurrence.state &&
    (item.action === "resolve" || item.action === (task.occurrence.state === "completed" ? "complete" : "cancel")) &&
    DateTime.fromISO(item.at, { setZone: true }).isValid) : undefined;
  return { ...task, completedAt: task.occurrence.state === "completed" ? revision?.at ?? task.completedAt : undefined,
    terminalAt: terminal ? revision?.at ?? task.terminalAt : undefined };
}
function completionTime(task: TaskView) {
  const value = task.completedAt ? Date.parse(task.completedAt) : NaN;
  return Number.isFinite(value) ? value : null;
}
export function recentCompletedTasks(tasks: readonly TaskView[], limit = RECENT_COMPLETED_LIMIT) {
  return tasks.filter(task => task.occurrence.state === "completed")
    .map((task, index) => ({ task, index, at: completionTime(task) }))
    .sort((a, b) => a.at !== null && b.at !== null ? b.at - a.at || a.index - b.index
      : a.at !== null ? -1 : b.at !== null ? 1 : a.index - b.index)
    .slice(0, limit).map(item => item.task);
}
export function taskCompletionLabel(task: TaskView, timeZone: string) {
  const at = task.completedAt ? DateTime.fromISO(task.completedAt, { setZone: true }).setZone(timeZone) : null;
  return at?.isValid ? `${at.toFormat("M月d日 HH:mm")} 回報完成` : "完成時間未提供";
}
export interface TaskHistoryDateRange { from: string | null; to: string | null }
export function taskHistoryTime(task: TaskView) { return task.occurrence.state === "completed" ? task.completedAt : task.occurrence.state === "cancelled" ? task.terminalAt : undefined; }
export function taskHistoryDateMatches(task: TaskView, range: TaskHistoryDateRange, timeZone: string) {
  if (!range.from && !range.to) return true;
  const raw = taskHistoryTime(task), at = raw ? DateTime.fromISO(raw, { setZone: true }).setZone(timeZone) : null;
  if (!at?.isValid) return false;
  const day = at.toFormat("yyyy-MM-dd");
  return (!range.from || day >= range.from) && (!range.to || day <= range.to);
}
export function searchTaskHistory(tasks: readonly TaskView[], query: string, filter: TaskHistoryFilter, assignees: readonly TaskAssigneeView[]) {
  const needle = query.trim().toLocaleLowerCase("zh-HK");
  return tasks.filter(task => ["completed", "cancelled"].includes(task.occurrence.state) &&
    (filter === "all" || task.occurrence.state === filter) && (!needle || [task.title, task.details,
      assignees.find(person => person.userId === task.assigneeUserId)?.name ?? "", taskStateLabels[task.occurrence.state]]
      .some(value => value.toLocaleLowerCase("zh-HK").includes(needle))));
}

// Relative labels require the caller's explicit clock and viewing zone.
// An invalid required dueAt is unconfirmed data, not an unscheduled task.
export function taskScheduleSections(tasks: readonly TaskView[], context?: TaskScheduleContext): TaskScheduleSection[] {
  const today = context ? DateTime.fromISO(context.asOf, { setZone: true }).setZone(context.timeZone).startOf("day") : null;
  const groups = new Map<string, TaskScheduleSection>();
  for (const task of pendingTasks(tasks)) {
    const due = DateTime.fromISO(task.occurrence.dueAt, { setZone: true }).setZone(context?.timeZone ?? task.occurrence.timeZone);
    const date = due.toFormat("yyyy-MM-dd");
    const relative = due.isValid && today?.isValid;
    const id = !due.isValid ? "unconfirmed" : relative ? due.startOf("day").toMillis() < today.toMillis() ? "earlier"
      : date === today.toFormat("yyyy-MM-dd") ? "today" : "later" : date;
    const label = id === "unconfirmed" ? "時間待核對" : id === "earlier" ? "較早 · 仍待處理" : id === "today" ? `今日 · ${today!.toFormat("M月d日")}`
      : id === "later" ? "之後" : due.setLocale("zh-HK").toFormat("yyyy年M月d日 cccc");
    const group = groups.get(id) ?? { id, label, items: [] };
    group.items.push(task); groups.set(id, group);
  }
  const order: Record<string, string> = { earlier: "0", today: "1", unconfirmed: "2", later: "3" };
  return [...groups.values()].sort((a, b) => (order[a.id] ?? a.id).localeCompare(order[b.id] ?? b.id)).map(group => ({ ...group,
    items: [...group.items].sort((a, b) => (Date.parse(a.occurrence.dueAt) || 0) - (Date.parse(b.occurrence.dueAt) || 0)),
  }));
}
export function taskScheduleTime(task: TaskView): string {
  const due = DateTime.fromISO(task.occurrence.dueAt, { setZone: true }).setZone(task.occurrence.timeZone);
  return due.isValid ? due.toFormat("HH:mm") : "待核對";
}
export function taskNextStep(task: TaskView, assignees: TaskAssigneeView[]): string {
  if (task.occurrence.state === "needs_review") return "核對完成或取消";
  if (task.occurrence.state === "completed" || task.occurrence.state === "cancelled") return "查看安排及歷史";
  if (!assignees.some(person => person.userId === task.assigneeUserId)) return "重新核對負責人";
  return task.kind === "appointment" ? "核對到診安排" : "查看安排／回報進度";
}
