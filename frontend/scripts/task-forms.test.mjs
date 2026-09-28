import assert from "node:assert/strict";
import test from "node:test";
import { emptyTaskForm, taskChangeFromForm, taskFormFromBasis, taskFormSchema, taskValuesFromForm } from "../src/components/tasks/task-form.ts";
import { currentTaskMetadata, taskChangeAllowed } from "../src/task-view-model.ts";
import { createTaskFixture } from "../src/preview/task-fixture.ts";

const fixture = createTaskFixture("preview-child-1", "normal");
const basis = fixture.items[0];
const valid = { ...emptyTaskForm(), title: "Health appointment", kind: "appointment", assigneeUserId: fixture.eligibleAssignees[0].userId,
  dueAt: "2026-10-01T09:00:00+08:00", timeZone: "Asia/Hong_Kong" };

test("creation requires explicit offset, IANA time zone and an eligible assignee", () => {
  const schema = taskFormSchema("create", fixture.eligibleAssignees);
  assert.equal(schema.safeParse(valid).success, true);
  assert.equal(schema.safeParse({ ...valid, dueAt: "2026-10-01T09:00:00" }).success, false);
  assert.equal(schema.safeParse({ ...valid, timeZone: "Unknown/Zone" }).success, false);
  assert.equal(schema.safeParse({ ...valid, assigneeUserId: "withdrawn-member" }).success, false);
  assert.deepEqual(taskValuesFromForm(valid), { title: valid.title, details: "", kind: "appointment", assigneeUserId: valid.assigneeUserId, dueAt: valid.dueAt, timeZone: valid.timeZone });
});

test("reschedule and cancellation require a reason; review requires an explicit terminal outcome", () => {
  const values = taskFormFromBasis(basis);
  assert.equal(taskFormSchema("complete", fixture.eligibleAssignees).safeParse(values).success, true);
  for (const action of ["reschedule", "cancel", "resolve"]) assert.equal(taskFormSchema(action, fixture.eligibleAssignees).safeParse(values).success, false);
  const resolved = { ...values, note: "Family reviewed the arrangement", outcome: "cancelled" };
  assert.equal(taskFormSchema("resolve", fixture.eligibleAssignees).safeParse(resolved).success, true);
  assert.deepEqual(taskChangeFromForm("resolve", resolved, 3), { action: "resolve", expectedVersion: 3, confirm: true, outcome: "cancelled", note: resolved.note });
  assert.deepEqual(taskChangeFromForm("reschedule", { ...values, note: "New time" }, 2), { action: "reschedule", expectedVersion: 2, confirm: true,
    dueAt: values.dueAt, timeZone: values.timeZone, assigneeUserId: values.assigneeUserId, note: "New time" });
});

test("terminal tasks cannot be rescheduled or reopened; needs_review only offers resolve", () => {
  for (const state of ["completed", "cancelled", "needs_review"]) {
    const task = { ...basis, occurrence: { ...basis.occurrence, state } };
    for (const action of ["reschedule", "complete", "cancel"]) assert.equal(taskChangeAllowed(task, action), false);
    assert.equal(taskChangeAllowed(task, "resolve"), state === "needs_review");
  }
});

test("visible reminders belong to the current version and occurrence, and stop after revocation or a terminal state", () => {
  const reminders = [...fixture.reminders, { ...fixture.reminders[0], id: "old-version", taskVersion: basis.version - 1 },
    { ...fixture.reminders[0], id: "old-occurrence", occurrenceId: "old-occurrence" }];
  const metadata = currentTaskMetadata(basis, fixture.eligibleAssignees, fixture.work, reminders);
  assert.equal(metadata.work.status, "processed");
  assert.equal(metadata.reminders.length, 2);
  assert.equal(currentTaskMetadata({ ...basis, version: basis.version + 1 }, fixture.eligibleAssignees, fixture.work, reminders).work, undefined);
  assert.equal(currentTaskMetadata({ ...basis, assigneeUserId: "withdrawn-member" }, fixture.eligibleAssignees, fixture.work, reminders).reminders.length, 0);
  assert.equal(currentTaskMetadata({ ...basis, occurrence: { ...basis.occurrence, state: "needs_review" } }, fixture.eligibleAssignees, fixture.work, reminders).reminders.length, 0);
  assert.deepEqual(createTaskFixture("preview-child-1", "access_lost"), { items: [], eligibleAssignees: [], histories: {}, reminders: [], work: [] });
});
