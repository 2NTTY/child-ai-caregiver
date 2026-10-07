import assert from "node:assert/strict";
import test from "node:test";
import { projectConfirmedTask } from "./task-projection.ts";
import { taskWithCompletionRevision, taskHistoryDateMatches } from "../task-view-model.ts";
import { changeTask } from "../../../server/task-policy.ts";
import type { CareTask, TaskChange } from "../../../src/shared/tasks.ts";
const task: CareTask = { id: "task", childId: "child", version: 1, title: "Synthetic", details: "", kind: "ordinary", assigneeUserId: "user", createdBy: "user",
  createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z", occurrence: { id: "occurrence", dueAt: "2026-10-20T00:00:00Z", timeZone: "Asia/Hong_Kong", state: "scheduled", terminalBasisVersion: null } };
const now = "2026-10-07T01:23:45Z";
for (const action of ["complete", "cancel"] as const) test(`${action} uses the confirmed Server transition time without loading history`, () => {
  const confirmed = changeTask(task, { action, expectedVersion: 1, occurrenceId: "occurrence", confirm: true, note: "" } as TaskChange, now);
  const projected = taskWithCompletionRevision(projectConfirmedTask(confirmed), []);
  assert.equal(projected.terminalAt, now); assert.notEqual(projected.terminalAt, task.occurrence.dueAt);
  assert.equal(projected.completedAt, action === "complete" ? now : undefined);
  assert.equal(taskHistoryDateMatches(projected, { from: "2026-10-07", to: "2026-10-07" }, "Asia/Hong_Kong"), true);
  assert.throws(() => changeTask(confirmed, { action: "reschedule", expectedVersion: 2 } as TaskChange, "2026-10-08T00:00:00Z"));
  assert.equal(projectConfirmedTask({ ...confirmed }).terminalAt, now);
});
test("opposing terminal write clears dates; resolve supplies its own confirmed time", () => {
  const complete = changeTask(task, { action: "complete", expectedVersion: 1 } as TaskChange, now);
  const conflict = changeTask(complete, { action: "cancel", expectedVersion: 1 } as TaskChange, "2026-10-07T02:00:00Z");
  assert.equal(projectConfirmedTask(conflict).terminalAt, undefined);
  const resolvedAt = "2026-10-07T03:00:00Z", resolved = changeTask(conflict, { action: "resolve", outcome: "completed", expectedVersion: 3 } as TaskChange, resolvedAt);
  assert.equal(projectConfirmedTask(resolved).completedAt, resolvedAt);
});
test("matching revision is authoritative, and invalid or scheduled timestamps never create a terminal date", () => {
  const complete = changeTask(task, { action: "complete", expectedVersion: 1 } as TaskChange, now);
  const revision = { task: complete, action: "complete" as const, actorUserId: "user", basisVersion: 1, note: "", at: now };
  assert.equal(taskWithCompletionRevision(projectConfirmedTask(complete), [revision]).completedAt, now);
  assert.equal(projectConfirmedTask(task).terminalAt, undefined);
  assert.equal(projectConfirmedTask({ ...complete, updatedAt: "invalid" }).completedAt, undefined);
});
