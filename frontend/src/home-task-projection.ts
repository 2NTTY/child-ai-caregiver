import type { TaskView } from "./task-view-model.ts";

/** Only the authorized, already-loaded window. This is not a server query or urgency ranking. */
export function projectHomeTasks(items: readonly TaskView[], childId: string): { scheduled: TaskView[]; review: TaskView[]; undated: TaskView[] } {
  const scheduled: TaskView[] = [], review: TaskView[] = [], undated: TaskView[] = [];
  for (const item of items) {
    if (item.childId !== childId) continue;
    if (item.occurrence.state === "needs_review") review.push(item);
    else if (item.occurrence.state === "scheduled") {
      (Number.isFinite(Date.parse(item.occurrence.dueAt)) ? scheduled : undated).push(item);
    }
  }
  const byId = (a: TaskView, b: TaskView) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  scheduled.sort((a, b) => Date.parse(a.occurrence.dueAt) - Date.parse(b.occurrence.dueAt) || byId(a, b));
  review.sort(byId); undated.sort(byId);
  return { scheduled, review, undated };
}
