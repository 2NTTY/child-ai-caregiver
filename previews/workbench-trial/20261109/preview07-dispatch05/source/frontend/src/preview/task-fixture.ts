import { taskWithCompletionRevision } from "../task-view-model.ts";
import type { TaskAssigneeView, TaskReminderView, TaskRevisionView, TaskView, TaskWorkView } from "../task-view-model";
import type { TaskListPage } from "./task-pagination";

export type TaskPreviewCondition = "normal" | "viewer" | "access_lost" | "needs_review" | "assignee_revoked" | "worker_disabled" | "metadata_missing" | "worker_failed" | "worker_unknown" | "latest_terminal" | "many_items" | "completed_history";
export interface TaskFixture {
  items: TaskView[]; eligibleAssignees: TaskAssigneeView[];
  histories: Record<string, TaskRevisionView[]>; reminders: TaskReminderView[]; work: TaskWorkView[]; workerEnabled?: boolean;
}
export const taskPreviewClock = { asOf: "2026-10-04T16:00:00+08:00", timeZone: "Asia/Hong_Kong" };
const at = taskPreviewClock.asOf;
const createdAt = "2026-10-02T08:30:00+08:00";
export function createTaskFixture(childId: string, condition: TaskPreviewCondition): TaskFixture {
  if (condition === "access_lost") return { items: [], eligibleAssignees: [], histories: {}, reminders: [], work: [] };
  if (childId.startsWith("preview-new-child-")) return { items: [], eligibleAssignees: [{ userId: "preview-owner", name: "媽媽" }], histories: {}, reminders: [], work: [] };
  const prefix = `${childId}-task-`;
  function task(suffix: string, title: string, state: TaskView["occurrence"]["state"], version: number, kind: TaskView["kind"] = "ordinary"): TaskView {
    return { id: `${prefix}${suffix}`, childId, version, title,
      details: kind === "appointment" ? "家庭到診安排示例；機構預約確認須另外核對。" : "由家人明確建立的合成安排。",
      kind, assigneeUserId: "preview-owner", createdBy: "preview-owner", createdAt, updatedAt: version === 1 ? createdAt : at,
      occurrence: { id: `${prefix}${suffix}-occurrence`, dueAt: "2026-10-04T15:00:00+08:00", timeZone: "Asia/Hong_Kong", state, terminalBasisVersion: state === "scheduled" ? null : 1 } };
  }
  if (condition === "many_items") {
    const items = Array.from({ length: 51 }, (_, index) => task(`page-${String(index + 1).padStart(3, "0")}`,
      `合成事項 ${index + 1}`, index === 50 ? "completed" : "scheduled", index === 50 ? 2 : 1));
    return {
      items: items.map(item => taskWithCompletionRevision(item, item.occurrence.state === "completed" ? [{ task: item, action: "complete", actorUserId: "preview-owner", basisVersion: 1, note: "分頁完成示例", at }] : [])), eligibleAssignees: [{ userId: "preview-owner", name: "媽媽" }],
      histories: { [items[50].id]: [{ task: items[50], action: "complete", actorUserId: "preview-owner", basisVersion: 1, note: "分頁完成示例", at }] },
      reminders: [{ id: `${items[0].id}-initial`, batchId: "preview-page-batch", taskId: items[0].id,
        occurrenceId: items[0].occurrence.id, taskVersion: 1, phase: "initial", createdAt: at }],
      work: items.map(item => ({ taskId: item.id, taskVersion: item.version, status: item.occurrence.state === "scheduled" ? "pending" : "stopped", nextAt: item.occurrence.dueAt, failures: 0 })),
      workerEnabled: true,
    };
  }
  const ordinary = task("ordinary", "帶備上次到診資料", "scheduled", 2);
  ordinary.occurrence.dueAt = "2026-10-04T14:30:00+08:00";
  ordinary.updatedAt = "2026-10-03T09:00:00+08:00";
  const appointment = task("appointment", "健康院到診安排", "scheduled", 1, "appointment");
  const review = task("review", "核對到診準備是否完成", "needs_review", 3);
  review.occurrence.dueAt = "2026-10-03T18:00:00+08:00";
  const future = task("future", "下次家庭回顧", "scheduled", 1);
  future.occurrence.dueAt = "2026-10-11T10:00:00+08:00"; future.assigneeUserId = "preview-caregiver";
  const completed = task("completed", "整理上星期的照顧觀察", "completed", 2);
  const cancelled = task("cancelled", "星期日公園活動", "cancelled", 2);
  const items = [ordinary, appointment, review, future, completed, cancelled];
  const terminalRevisionTimes = new Map<string, string>();
  if (condition === "completed_history") for (let index = 1; index <= 12; index++) {
    const older = task(`history-${index}`, `已回報的家庭事項 ${index}`, "completed", 2);
    const completedAt = `2026-10-03T${String(20 - index).padStart(2, "0")}:00:00+08:00`;
    older.updatedAt = completedAt; terminalRevisionTimes.set(older.id, completedAt);
    items.push(older);
  }
  const eligibleAssignees: TaskAssigneeView[] = [{ userId: "preview-owner", name: "媽媽" }, { userId: "preview-caregiver", name: "爸爸" }];
  if (condition === "assignee_revoked") ordinary.assigneeUserId = "preview-revoked-member";
  const histories: Record<string, TaskRevisionView[]> = {};
  for (const item of items) {
    const initial: TaskView = { ...item, version: 1, updatedAt: createdAt, occurrence: { ...item.occurrence, state: "scheduled", terminalBasisVersion: null } };
    if (item.id === ordinary.id) initial.occurrence.dueAt = "2026-10-04T16:30:00+08:00";
    const revisions: TaskRevisionView[] = [{ task: initial, action: "create", actorUserId: "preview-owner", basisVersion: 0, note: "", at: createdAt }];
    if (item.id === ordinary.id) revisions.unshift({ task: item, action: "reschedule", actorUserId: "preview-caregiver", basisVersion: 1, note: "提早整理到診資料（合成）", at: item.updatedAt });
    if (item.occurrence.state === "completed" || item.occurrence.state === "cancelled") revisions.unshift({ task: item, action: item.occurrence.state === "completed" ? "complete" : "cancel", actorUserId: "preview-caregiver", basisVersion: 1, note: item.occurrence.state === "completed" ? "已整理觀察（合成）" : "家人改了當日安排（合成）", at: terminalRevisionTimes.get(item.id) ?? at });
    if (item.occurrence.state === "needs_review") {
      revisions.unshift({ task: { ...item, version: 2, updatedAt: "2026-10-03T18:00:00+08:00", occurrence: { ...item.occurrence, state: "completed" } }, action: "complete", actorUserId: "preview-owner", basisVersion: 1, note: "媽媽認為已準備好（合成）", at: "2026-10-03T18:00:00+08:00" });
      revisions.unshift({ task: item, action: "cancel", actorUserId: "preview-caregiver", basisVersion: 1, note: "爸爸認為安排已取消（合成）", at });
    }
    histories[item.id] = revisions;
  }
  const work: TaskWorkView[] = items.map((item, index) => ({ taskId: item.id, taskVersion: item.version,
    status: item.occurrence.state === "scheduled" ? index === 0 ? "processed" : "pending" : "stopped", nextAt: index === 0 ? at : item.occurrence.dueAt, failures: 0 }));
  if (condition === "worker_failed" || condition === "worker_unknown") {
    work[0] = { ...work[0], status: condition === "worker_failed" ? "failed" : "unknown", failures: condition === "worker_failed" ? 3 : 1 };
  }
  const reminders: TaskReminderView[] = [
    { id: `${ordinary.id}-initial`, batchId: "preview-batch-initial", taskId: ordinary.id, occurrenceId: ordinary.occurrence.id, taskVersion: ordinary.version, phase: "initial", createdAt: "2026-10-04T14:30:00+08:00" },
    { id: `${ordinary.id}-follow-up`, batchId: "preview-batch-follow-up", taskId: ordinary.id, occurrenceId: ordinary.occurrence.id, taskVersion: ordinary.version, phase: "follow_up", createdAt: at },
  ];
  return { items: items.map(item => taskWithCompletionRevision(item, histories[item.id] ?? [])), eligibleAssignees, histories, reminders: condition === "metadata_missing" ? [] : reminders,
    work: condition === "metadata_missing" ? [] : work, workerEnabled: condition === "metadata_missing" ? undefined : condition !== "worker_disabled" };
}

// Mirrors the bounded list page shape without adding a preview transport.
export function taskFixturePage(fixture: TaskFixture, afterId: string | null): TaskListPage {
  const start = afterId === null ? 0 : fixture.items.findIndex(item => item.id === afterId) + 1;
  const offset = afterId !== null && start === 0 ? fixture.items.length : start;
  const items = fixture.items.slice(offset, offset + 50);
  const ids = new Set(items.map(item => item.id));
  return {
    items, eligibleAssignees: fixture.eligibleAssignees,
    nextAfterId: offset + items.length < fixture.items.length ? items.at(-1)?.id ?? null : null,
    reminders: fixture.reminders.filter(item => ids.has(item.taskId)),
    work: fixture.work.filter(item => ids.has(item.taskId)), workerEnabled: fixture.workerEnabled,
  };
}

// Fixed competing snapshots, not a client implementation of Server conflict rules.
export function taskConflictFixture(basis: TaskView, terminal: boolean): TaskView {
  return { ...basis, version: basis.version + 1, updatedAt: "2026-10-04T15:55:00+08:00",
    assigneeUserId: terminal ? basis.assigneeUserId : "preview-caregiver",
    occurrence: { ...basis.occurrence, dueAt: terminal ? basis.occurrence.dueAt : "2026-10-05T10:00:00+08:00",
      state: terminal ? "completed" : basis.occurrence.state, terminalBasisVersion: terminal ? basis.version : basis.occurrence.terminalBasisVersion } };
}
