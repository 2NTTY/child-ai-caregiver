import type { TaskAssigneeView, TaskReminderView, TaskView, TaskWorkView } from "../task-view-model";

export interface TaskListPage {
  items: TaskView[];
  eligibleAssignees: TaskAssigneeView[];
  nextAfterId: string | null;
  reminders: TaskReminderView[];
  work: TaskWorkView[];
  workerEnabled?: boolean;
}

// A fetched page replaces snapshots and metadata for its task IDs only.
export function mergeTaskPages(previous: TaskListPage, page: TaskListPage): TaskListPage {
  const pageIds = new Set(page.items.map(item => item.id));
  const replacements = new Map(page.items.map(item => [item.id, item]));
  const previousIds = new Set(previous.items.map(item => item.id));
  return {
    items: [...previous.items.map(item => replacements.get(item.id) ?? item), ...[...replacements.values()].filter(item => !previousIds.has(item.id))],
    eligibleAssignees: page.eligibleAssignees,
    nextAfterId: page.nextAfterId,
    reminders: [...previous.reminders.filter(item => !pageIds.has(item.taskId)), ...page.reminders],
    work: [...previous.work.filter(item => !pageIds.has(item.taskId)), ...page.work],
    workerEnabled: page.workerEnabled,
  };
}

export function replaceTaskInPage(previous: TaskListPage, task: TaskView, prepend = false): TaskListPage {
  const items = previous.items.filter(item => item.id !== task.id);
  return {
    ...previous,
    items: prepend ? [task, ...items] : previous.items.some(item => item.id === task.id)
      ? previous.items.map(item => item.id === task.id ? task : item) : previous.items,
    reminders: previous.reminders.filter(item => item.taskId !== task.id),
    work: previous.work.filter(item => item.taskId !== task.id),
  };
}
