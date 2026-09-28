import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { nextReminderCheck, reminderLocalTime } from "../server/task-policy.ts";
import type { ReminderEvidence } from "../server/task-policy.ts";
import type { CareTask } from "../src/shared/tasks.ts";
import { DEFAULT_NOTIFICATION_PREFERENCES as preferences } from "../src/shared/family.ts";

const task: CareTask = { id: randomUUID(), childId: randomUUID(), version: 1, title: "合成", details: "", kind: "ordinary", assigneeUserId: "owner", createdBy: "owner", createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z",
  occurrence: { id: randomUUID(), dueAt: "2026-09-02T00:00:00Z", timeZone: "Asia/Hong_Kong", state: "scheduled", terminalBasisVersion: null } };
const evidence: ReminderEvidence = { authorized: true, assigneeEligible: true, initialAt: null, followUpAt: null, lastOrdinaryBatchAt: null, deliveryUnknown: false };

test("quiet reminders defer to the actual recipient-local boundary without daily polling", () => {
  assert.equal(nextReminderCheck(task, preferences, evidence, "2026-09-28T15:07:12Z"), "2026-09-29T00:00:00.000Z");
  assert.equal(nextReminderCheck(task, preferences, { ...evidence, lastOrdinaryBatchAt: "2026-09-28T04:00:00Z" }, "2026-09-28T04:00:00Z"), "2026-09-29T00:00:00.000Z");
  assert.equal(nextReminderCheck(task, preferences, { ...evidence, deliveryUnknown: true }, "2026-09-28T04:00:00Z"), null);
});

test("quiet-end scheduling crosses a DST fallback using UTC instants", () => {
  const ny = { ...preferences, timeZone: "America/New_York", quietStart: "00:00", quietEnd: "03:00" };
  const at = nextReminderCheck(task, ny, evidence, "2026-11-01T05:30:00Z");
  assert.equal(at, "2026-11-01T08:00:00.000Z");
  assert.deepEqual(reminderLocalTime(at!, ny.timeZone), { day: "2026-11-01", minutes: 180 });
});

test("not-due, terminal, and exhausted follow-up states have distinct next-check results", () => {
  assert.equal(nextReminderCheck(task, preferences, evidence, "2026-09-01T01:00:00Z"), task.occurrence.dueAt);
  assert.equal(nextReminderCheck({ ...task, occurrence: { ...task.occurrence, state: "cancelled" } }, preferences, evidence, "2026-09-28T04:00:00Z"), null);
  assert.equal(nextReminderCheck(task, preferences, { ...evidence, initialAt: "2026-09-26T00:00:00Z", followUpAt: "2026-09-27T00:00:00Z" }, "2026-09-28T04:00:00Z"), null);
});
