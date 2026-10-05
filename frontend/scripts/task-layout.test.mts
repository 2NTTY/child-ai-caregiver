import assert from "node:assert/strict";
import { test } from "node:test";
import { taskNextStep, taskScheduleSections, taskScheduleTime, type TaskView } from "../src/task-view-model.ts";
import { createTaskFixture } from "../src/preview/task-fixture.ts";

const fixture = createTaskFixture("layout-child", "normal");

test("schedule sections preserve every task identity and leave source order untouched", () => {
  const original = fixture.items.map(task => task.id);
  const groups = taskScheduleSections(fixture.items);
  assert.deepEqual(groups.map(group => group.id), ["2026-09-28", "2026-09-30", "ended"]);
  assert.deepEqual(groups.flatMap(group => group.items.map(task => task.id)).sort(), [...original].sort());
  assert.deepEqual(fixture.items.map(task => task.id), original);
  assert.ok(groups[0].label.includes("2026"));
  assert.ok(groups.at(-1)!.items.every(task => ["completed", "cancelled"].includes(task.occurrence.state)));
});

test("time grouping uses each task's explicit zone without changing its saved timestamp", () => {
  const task: TaskView = { ...fixture.items[0], occurrence: { ...fixture.items[0].occurrence, dueAt: "2026-09-29T23:30:00Z", timeZone: "Asia/Hong_Kong" } };
  assert.equal(taskScheduleSections([task])[0].id, "2026-09-30");
  assert.equal(taskScheduleTime(task), "07:30");
  assert.equal(task.occurrence.dueAt, "2026-09-29T23:30:00Z");
});

test("invalid dates or zones remain unconfirmed rather than becoming today's agenda", () => {
  for (const occurrence of [{ ...fixture.items[0].occurrence, dueAt: "not-a-date" }, { ...fixture.items[0].occurrence, timeZone: "Invalid/Zone" }]) {
    const task = { ...fixture.items[0], occurrence };
    assert.equal(taskScheduleSections([task])[0].id, "unconfirmed");
    assert.equal(taskScheduleTime(task), "待核對");
  }
});

test("next-step labels preserve review, terminal and revoked-assignee boundaries", () => {
  assert.equal(taskNextStep(fixture.items.find(task => task.occurrence.state === "needs_review")!, fixture.eligibleAssignees), "核對完成或取消");
  assert.equal(taskNextStep(fixture.items.find(task => task.occurrence.state === "completed")!, fixture.eligibleAssignees), "查看安排及歷史");
  assert.equal(taskNextStep({ ...fixture.items[0], assigneeUserId: "revoked" }, fixture.eligibleAssignees), "重新核對負責人");
  assert.equal(taskNextStep(fixture.items.find(task => task.kind === "appointment")!, fixture.eligibleAssignees), "核對到診安排");
});
