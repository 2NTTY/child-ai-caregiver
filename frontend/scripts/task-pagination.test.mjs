import assert from "node:assert/strict";
import test from "node:test";
import { createTaskFixture, taskFixturePage } from "../src/preview/task-fixture.ts";
import { mergeTaskPages, replaceTaskInPage } from "../src/preview/task-pagination.ts";

test("the synthetic list exposes 50 items, then one more behind the list cursor", () => {
  const fixture = createTaskFixture("preview-child-1", "many_items");
  const first = taskFixturePage(fixture, null);
  assert.equal(first.items.length, 50);
  assert.equal(first.work.length, 50);
  assert.equal(first.items.filter(item => item.occurrence.state === "completed").length, 0);
  assert.equal(first.nextAfterId, first.items[49].id);
  const second = taskFixturePage(fixture, first.nextAfterId);
  assert.equal(second.items.length, 1);
  assert.equal(second.items[0].occurrence.state, "completed");
  assert.equal(second.nextAfterId, null);
  const merged = mergeTaskPages(first, second);
  assert.equal(merged.items.length, 51);
  assert.equal(merged.work.length, 51);
  assert.equal(merged.reminders.length, 1);
});

test("an overlapping page replaces its fetched snapshot and metadata without dropping other rows", () => {
  const fixture = createTaskFixture("preview-child-1", "normal");
  const previous = taskFixturePage(fixture, null);
  const changed = { ...previous.items[0], version: 3, title: "New fetched title",
    occurrence: { ...previous.items[0].occurrence, id: "new-occurrence" } };
  const added = { ...previous.items[1], id: "new-task", occurrence: { ...previous.items[1].occurrence, id: "new-task-occurrence" } };
  const page = {
    items: [changed, added], eligibleAssignees: previous.eligibleAssignees.slice(0, 1), nextAfterId: "next-cursor",
    reminders: [{ ...previous.reminders[0], id: "new-reminder", occurrenceId: "new-occurrence", taskVersion: 3 }],
    work: [{ ...previous.work[0], taskVersion: 3, status: "failed" }, { ...previous.work[1], taskId: added.id }],
    workerEnabled: false,
  };
  const merged = mergeTaskPages(previous, page);
  assert.equal(merged.items.length, previous.items.length + 1);
  assert.equal(merged.items[0], changed);
  assert.equal(merged.items.at(-1), added);
  assert.equal(merged.items.filter(item => item.id === changed.id).length, 1);
  assert.equal(merged.reminders.filter(item => item.taskId === changed.id).length, 1);
  assert.equal(merged.reminders.find(item => item.taskId === changed.id).id, "new-reminder");
  assert.equal(merged.work.find(item => item.taskId === changed.id).taskVersion, 3);
  assert.equal(merged.work.find(item => item.taskId === previous.items[1].id).taskVersion, previous.items[1].version);
  assert.equal(merged.nextAfterId, "next-cursor");
  assert.equal(merged.workerEnabled, false);
});

test("a confirmed task snapshot changes only its own list metadata and keeps the cursor", () => {
  const first = taskFixturePage(createTaskFixture("preview-child-1", "many_items"), null);
  const changed = { ...first.items[0], version: 2 };
  const next = replaceTaskInPage(first, changed);
  assert.equal(next.items[0], changed);
  assert.equal(next.items.length, 50);
  assert.equal(next.nextAfterId, first.nextAfterId);
  assert.equal(next.work.some(item => item.taskId === changed.id), false);
  assert.equal(next.work.length, 49);
  assert.equal(next.reminders.length, 0);
});
