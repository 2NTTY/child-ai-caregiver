import type { TaskView } from './task-view-model';

/** Sort only the authorized loaded window. This is not a global urgency ranking. */
export function projectHomeTasks(items: readonly TaskView[], childId: string): { scheduled: TaskView[]; review: TaskView[]; undated: TaskView[] } {
  const scheduled: TaskView[] = [], review: TaskView[] = [], undated: TaskView[] = [];
  for (const item of items) {
    if (item.childId !== childId) continue;
    if (item.occurrence.state === 'needs_review') review.push(item);
    else if (item.occurrence.state === 'scheduled') (Number.isFinite(Date.parse(item.occurrence.dueAt)) ? scheduled : undated).push(item);
  }
  const byId = (a: TaskView, b: TaskView) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  scheduled.sort((a, b) => Date.parse(a.occurrence.dueAt) - Date.parse(b.occurrence.dueAt) || byId(a, b));
  review.sort(byId); undated.sort(byId);
  return { scheduled, review, undated };
}

export function homeTaskTimeLabel(task: TaskView): string {
  const instant = Date.parse(task.occurrence.dueAt);
  if (!Number.isFinite(instant)) return '時間待核對';
  try {
    return new Intl.DateTimeFormat('zh-HK', { timeZone: task.occurrence.timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(instant);
  } catch { return '時間待核對'; }
}
