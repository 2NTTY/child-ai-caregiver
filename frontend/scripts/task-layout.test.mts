import assert from "node:assert/strict";
import { test } from "node:test";
import { pendingTasks, recentCompletedTasks, searchTaskHistory, taskCompletionLabel, taskHistoryDateMatches, taskNextStep, taskScheduleSections, taskScheduleTime, taskWithCompletionRevision, type TaskView } from "../src/task-view-model.ts";
import { createTaskFixture, taskPreviewClock } from "../src/preview/task-fixture.ts";

const fixture = createTaskFixture("layout-child", "normal");

test("pending day groups use the injected snapshot and retain unresolved review", () => {
  const original = fixture.items.map(task => task.id);
  const groups = taskScheduleSections(fixture.items, taskPreviewClock);
  assert.deepEqual(groups.map(group => group.id), ["earlier", "today", "later"]);
  assert.equal(groups.find(group => group.id === "today")?.label, "今日 · 10月4日");
  assert.equal(groups.find(group => group.id === "today")?.items.length, 2);
  assert.equal(pendingTasks(fixture.items).length, 4);
  assert.ok(groups.flatMap(group => group.items).some(task => task.occurrence.state === "needs_review"));
  assert.ok(groups.flatMap(group => group.items).every(task => !["completed", "cancelled"].includes(task.occurrence.state)));
  assert.deepEqual(fixture.items.map(task => task.id), original);
});

test("schedule dates use the requested viewing zone without mutating saved timestamps", () => {
  const task: TaskView = { ...fixture.items[0], occurrence: { ...fixture.items[0].occurrence, dueAt: "2026-10-03T23:30:00Z", timeZone: "Asia/Hong_Kong" } };
  assert.equal(taskScheduleSections([task], taskPreviewClock)[0].id, "today");
  assert.equal(taskScheduleTime(task), "07:30");
  assert.equal(taskScheduleSections([task], { asOf: "2026-10-04T12:00:00Z", timeZone: "UTC" })[0].id, "earlier");
  assert.equal(task.occurrence.dueAt, "2026-10-03T23:30:00Z");
  assert.ok(taskScheduleSections([task])[0].label.includes("2026"));
});

test("invalid dates stay unconfirmed and are never invented unscheduled tasks", () => {
  const task = { ...fixture.items[0], occurrence: { ...fixture.items[0].occurrence, dueAt: "not-a-date" } };
  assert.equal(taskScheduleSections([task], taskPreviewClock)[0].id, "unconfirmed");
  assert.equal(taskScheduleTime(task), "待核對");
});

test("recent completed projection is newest ten by completion revision, excluding cancelled", () => {
  const many = createTaskFixture("history-child", "completed_history");
  const done = recentCompletedTasks(many.items);
  assert.equal(done.length, 10);
  assert.ok(done.every(task => task.occurrence.state === "completed"));
  assert.ok(done.every((task, index) => !index || Date.parse(done[index - 1].completedAt!) >= Date.parse(task.completedAt!)));
  assert.equal(searchTaskHistory(many.items, "", "all", many.eligibleAssignees).length, 14);
  assert.equal(many.items.filter(task => task.occurrence.state === "completed").length, 13);
  for (const task of done) assert.equal(task.completedAt, many.histories[task.id].find(revision => revision.task.version === task.version)!.at);
});

test("unknown completion dates never borrow due or updated time and stay stable", () => {
  const completed = fixture.items.find(task => task.occurrence.state === "completed")!;
  const first = { ...completed, id: "unknown-a", completedAt: undefined, dueAt: "2099-01-01", updatedAt: "2099-01-01" };
  const second = { ...first, id: "unknown-b" };
  assert.deepEqual(recentCompletedTasks([first, completed, second]).map(task => task.id), [completed.id, "unknown-a", "unknown-b"]);
  assert.equal(taskCompletionLabel(first, "Asia/Hong_Kong"), "完成時間未提供");
  assert.equal(taskWithCompletionRevision(completed, []).completedAt, undefined);
  assert.equal(taskWithCompletionRevision(completed, [{ ...fixture.histories[completed.id][0], task: { ...completed, version: completed.version - 1 } }]).completedAt, undefined);
});

test("history searches only terminal loaded items by title, contents or eligible assignee", () => {
  assert.equal(searchTaskHistory(fixture.items, "公園", "all", fixture.eligibleAssignees)[0].occurrence.state, "cancelled");
  assert.equal(searchTaskHistory(fixture.items, "公園", "completed", fixture.eligibleAssignees).length, 0);
  assert.equal(searchTaskHistory(fixture.items, "媽媽", "all", fixture.eligibleAssignees).length, 2);
  assert.equal(searchTaskHistory(fixture.items, "到診資料", "all", fixture.eligibleAssignees).length, 0);
});

test("history date filters use actual terminal revision dates with inclusive local days", () => {
  const completed = fixture.items.find(task => task.occurrence.state === "completed")!;
  const cancelled = fixture.items.find(task => task.occurrence.state === "cancelled")!;
  assert.equal(taskHistoryDateMatches(completed, { from: "2026-10-04", to: "2026-10-04" }, "Asia/Hong_Kong"), true);
  assert.equal(taskHistoryDateMatches(cancelled, { from: "2026-10-04", to: "2026-10-04" }, "Asia/Hong_Kong"), true);
  assert.equal(taskHistoryDateMatches({ ...completed, completedAt: undefined }, { from: "2026-10-01", to: null }, "Asia/Hong_Kong"), false);
  assert.equal(taskHistoryDateMatches({ ...completed, completedAt: undefined }, { from: null, to: null }, "Asia/Hong_Kong"), true);
});

test("next-step labels preserve review, terminal and revoked-assignee boundaries", () => {
  assert.equal(taskNextStep(fixture.items.find(task => task.occurrence.state === "needs_review")!, fixture.eligibleAssignees), "核對完成或取消");
  assert.equal(taskNextStep(fixture.items.find(task => task.occurrence.state === "completed")!, fixture.eligibleAssignees), "查看安排及歷史");
  assert.equal(taskNextStep({ ...fixture.items[0], assigneeUserId: "revoked" }, fixture.eligibleAssignees), "重新核對負責人");
});
