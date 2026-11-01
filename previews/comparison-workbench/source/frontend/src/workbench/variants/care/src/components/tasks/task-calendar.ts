import { DateTime, IANAZone } from "luxon";
import { pendingTasks, type TaskAssigneeView, type TaskScheduleContext, type TaskView } from "../../task-view-model.ts";

export interface TaskCalendarDay {
  date: string; day: number; label: string; scheduled: number; review: number;
}
export interface TaskCalendarMonth {
  month: string | null; label: string; currentDay: string | null;
  weeks: (TaskCalendarDay | null)[][]; unconfirmedCount: number;
}
const explicitOffset = /(?:Z|[+-]\d{2}:\d{2})$/i;

function localInstant(value: string, timeZone: string) {
  if (!explicitOffset.test(value) || !IANAZone.isValidZone(timeZone)) return null;
  const at = DateTime.fromISO(value, { setZone: true }).setZone(timeZone);
  return at.isValid ? at : null;
}
export function taskCalendarDate(task: TaskView, timeZone: string) {
  return localInstant(task.occurrence.dueAt, timeZone)?.toISODate() ?? null;
}
export function taskCalendarItems(tasks: readonly TaskView[], timeZone: string, selectedDay: string | null) {
  return pendingTasks(tasks).filter(task => !selectedDay || taskCalendarDate(task, timeZone) === selectedDay);
}
export function toggleTaskCalendarDay(selectedDay: string | null, pressedDay: string | null) {
  return pressedDay === selectedDay ? null : pressedDay;
}
export function shiftTaskCalendarMonth(month: string, amount: number) {
  const date = /^\d{4}-\d{2}$/.test(month) ? DateTime.fromISO(`${month}-01`, { zone: "UTC" }) : null;
  return date?.isValid ? date.plus({ months: amount }).toFormat("yyyy-MM") : null;
}

// A derived index of loaded items, never a second task store or a coverage claim.
export function projectTaskCalendar(tasks: readonly TaskView[], context: TaskScheduleContext, requestedMonth: string | null = null): TaskCalendarMonth {
  const current = localInstant(context.asOf, context.timeZone);
  const month = requestedMonth ?? current?.toFormat("yyyy-MM") ?? null;
  const start = month && /^\d{4}-\d{2}$/.test(month) && IANAZone.isValidZone(context.timeZone)
    ? DateTime.fromISO(`${month}-01`, { zone: context.timeZone }) : null;
  const counts = new Map<string, { scheduled: number; review: number }>();
  let unconfirmedCount = 0;
  for (const task of pendingTasks(tasks)) {
    const date = taskCalendarDate(task, context.timeZone);
    if (!date) { unconfirmedCount++; continue; }
    const count = counts.get(date) ?? { scheduled: 0, review: 0 };
    if (task.occurrence.state === "needs_review") count.review++; else count.scheduled++;
    counts.set(date, count);
  }
  if (!start?.isValid) return { month: null, label: "日曆日期待核對", currentDay: current?.toISODate() ?? null, weeks: [], unconfirmedCount };
  const cells: (TaskCalendarDay | null)[] = Array.from({ length: start.weekday - 1 }, () => null);
  for (let day = 1; day <= start.daysInMonth!; day++) {
    const date = start.set({ day }), key = date.toISODate()!;
    cells.push({ date: key, day, label: date.setLocale("zh-HK").toFormat("yyyy年M月d日 cccc"), ...counts.get(key) ?? { scheduled: 0, review: 0 } });
  }
  while (cells.length % 7) cells.push(null);
  return { month: start.toFormat("yyyy-MM"), label: start.toFormat("yyyy年M月"), currentDay: current?.toISODate() ?? null,
    weeks: Array.from({ length: cells.length / 7 }, (_, index) => cells.slice(index * 7, index * 7 + 7)), unconfirmedCount };
}

export function taskCalendarDayLabel(day: TaskCalendarDay) {
  const counts = [day.scheduled ? `${day.scheduled} 項待辦或預約` : "", day.review ? `${day.review} 項待覆核` : ""].filter(Boolean);
  return `${day.label}；${counts.length ? `已載入 ${day.scheduled + day.review} 項：${counts.join("、")}` : "已載入資料未有安排"}`;
}

export type TaskBacklogFilter = "near" | "earlier" | "later" | "review" | "unconfirmed" | "all";
export const TASK_LIST_PAGE_SIZE = 10;
export interface TaskBacklogOptions {
  filter: TaskBacklogFilter; selectedDay: string | null; query: string; page: number;
}

// Display pagination is bounded independently of the owner's remote cursor.
export function projectTaskBacklog(tasks: readonly TaskView[], context: TaskScheduleContext, options: TaskBacklogOptions, assignees: readonly TaskAssigneeView[]) {
  const current = localInstant(context.asOf, context.timeZone)?.startOf("day");
  const today = current?.toISODate() ?? null, afterNear = current?.plus({ days: 7 }).toISODate() ?? null;
  const counts: Record<TaskBacklogFilter, number> = { near: 0, earlier: 0, later: 0, review: 0, unconfirmed: 0, all: 0 };
  const entries = pendingTasks(tasks).map((task, index) => {
    const date = taskCalendarDate(task, context.timeZone);
    const bucket = !date || !today || !afterNear ? "unconfirmed" : date < today ? "earlier" : date < afterNear ? "near" : "later";
    counts[bucket]++; counts.all++;
    if (task.occurrence.state === "needs_review") counts.review++;
    return { task, date, bucket, index };
  });
  const query = options.query.trim().toLocaleLowerCase("zh-HK");
  const matches = entries.filter(({ task, date, bucket }) => {
    const included = options.selectedDay ? date === options.selectedDay : options.filter === "all" || (options.filter === "review" ? task.occurrence.state === "needs_review" : options.filter === bucket);
    return included && (!query || [task.title, task.details, assignees.find(person => person.userId === task.assigneeUserId)?.name ?? ""]
      .some(value => value.toLocaleLowerCase("zh-HK").includes(query)));
  }).sort((a, b) => !a.date && b.date ? 1 : a.date && !b.date ? -1 : a.date && b.date ? Date.parse(a.task.occurrence.dueAt) - Date.parse(b.task.occurrence.dueAt) || a.index - b.index : a.index - b.index);
  const pageCount = Math.max(1, Math.ceil(matches.length / TASK_LIST_PAGE_SIZE));
  const page = Math.min(Math.max(0, Math.trunc(options.page) || 0), pageCount - 1);
  return { counts, page, pageCount, total: matches.length, from: matches.length ? page * TASK_LIST_PAGE_SIZE + 1 : 0,
    to: Math.min((page + 1) * TASK_LIST_PAGE_SIZE, matches.length), items: matches.slice(page * TASK_LIST_PAGE_SIZE, (page + 1) * TASK_LIST_PAGE_SIZE).map(entry => entry.task),
    nearLabel: current?.isValid ? `${current.toFormat("M月d日")}至${current.plus({ days: 6 }).toFormat("M月d日")}` : null };
}
