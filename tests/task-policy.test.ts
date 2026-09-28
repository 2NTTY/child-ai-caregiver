import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { changeTask, reminderDecision } from "../server/task-policy.ts";
import type { ReminderEvidence } from "../server/task-policy.ts";
import { taskCreateSchema, taskChangeSchema } from "../src/shared/tasks.ts";
import type { CareTask } from "../src/shared/tasks.ts";
import { DEFAULT_NOTIFICATION_PREFERENCES as preferences } from "../src/shared/family.ts";
import { onlineRoute } from "../server/online-routing.ts";
import { handleTaskRequest } from "../server/task-api.ts";
import type { TaskStore } from "../server/tasks.ts";

const now = "2026-09-28T04:00:00Z";
function task(): CareTask { return { id: randomUUID(), childId: randomUUID(), version: 1, title: "  合成事項\n", details: "", kind: "ordinary", assigneeUserId: "parent", createdBy: "parent", createdAt: now, updatedAt: now,
  occurrence: { id: randomUUID(), dueAt: "2026-09-27T10:00:00+08:00", timeZone: "Asia/Hong_Kong", state: "scheduled", terminalBasisVersion: null } }; }
const evidence: ReminderEvidence = { authorized: true, assigneeEligible: true, initialAt: null, followUpAt: null, lastOrdinaryBatchAt: null, deliveryUnknown: false };

test("task inputs preserve exact text and require explicit confirmation and an offset", () => {
  const values = { title: "  合成\n", details: "原文\n", kind: "ordinary", assigneeUserId: "parent", dueAt: "2026-09-28T09:00:00+08:00", timeZone: "Asia/Hong_Kong" };
  assert.deepEqual(taskCreateSchema.parse({ values, confirm: true }).values, values);
  for (const invalid of [{ values }, { values, confirm: false }, { values: { ...values, title: " " }, confirm: true }, { values: { ...values, dueAt: "2026-09-28T09:00:00" }, confirm: true }, { values: { ...values, timeZone: "guess" }, confirm: true }, { values, confirm: true, createdBy: "forged" }]) assert.equal(taskCreateSchema.safeParse(invalid).success, false);
  assert.equal(taskChangeSchema.safeParse({ action: "cancel", expectedVersion: 1, confirm: true, note: " " }).success, false);
});

test("rescheduling retains task and occurrence identities and rejects a stale basis", () => {
  const initial = task(), input = { action: "reschedule" as const, expectedVersion: 1, confirm: true as const, note: "改期", dueAt: "2026-09-30T09:00:00+08:00", timeZone: "Asia/Hong_Kong", assigneeUserId: "other" };
  const changed = changeTask(initial, input, now);
  assert.equal(changed.id, initial.id); assert.equal(changed.occurrence.id, initial.occurrence.id);
  assert.equal(changed.version, 2); assert.equal(changed.assigneeUserId, "other");
  assert.throws(() => changeTask(changed, input, now), { code: "version_conflict" });
  assert.equal(initial.version, 1);
});

test("opposing terminal writes retain a conflict in either order and stop reminders", () => {
  for (const firstAction of ["complete", "cancel"] as const) {
    const initial = task(), first = changeTask(initial, { action: firstAction, expectedVersion: 1, confirm: true, note: "家長處理" }, now);
    const second = changeTask(first, { action: firstAction === "complete" ? "cancel" : "complete", expectedVersion: 1, confirm: true, note: "另一照顧者" }, now);
    assert.equal(second.occurrence.state, "needs_review"); assert.equal(second.version, 3);
    assert.equal(reminderDecision(second, preferences, evidence, now), "stopped");
    const resolved = changeTask(second, { action: "resolve", outcome: "completed", expectedVersion: 3, confirm: true, note: "已核對" }, now);
    assert.equal(resolved.occurrence.state, "completed"); assert.equal(resolved.occurrence.terminalBasisVersion, null);
    assert.throws(() => changeTask(resolved, { action: "cancel", expectedVersion: 3, confirm: true, note: "舊資料" }, now), { code: "version_conflict" });
  }
});

test("terminal states never reschedule, repeat completion or resolve without a conflict", () => {
  const initial = task(), done = changeTask(initial, { action: "complete", expectedVersion: 1, confirm: true, note: "" }, now);
  for (const action of ["complete", "cancel"] as const) assert.throws(() => changeTask(done, { action, expectedVersion: 2, confirm: true, note: "" }, now), { code: "version_conflict" });
  assert.throws(() => changeTask(done, { action: "reschedule", expectedVersion: 2, confirm: true, note: "", dueAt: now, timeZone: "UTC", assigneeUserId: "parent" }, now), { code: "version_conflict" });
  assert.throws(() => changeTask(initial, { action: "resolve", expectedVersion: 1, confirm: true, note: "", outcome: "cancelled" }, now), { code: "version_conflict" });
});

test("reminder eligibility distinguishes overdue from complete, authorization and unknown delivery", () => {
  const item = task(); assert.equal(reminderDecision(item, preferences, evidence, now), "initial");
  assert.equal(item.occurrence.state, "scheduled");
  assert.equal(reminderDecision(item, preferences, { ...evidence, authorized: false }, now), "not_authorized");
  assert.equal(reminderDecision(item, preferences, { ...evidence, assigneeEligible: false }, now), "not_authorized");
  assert.equal(reminderDecision(item, preferences, { ...evidence, deliveryUnknown: true }, now), "unknown");
  assert.equal(reminderDecision({ ...item, occurrence: { ...item.occurrence, dueAt: "2026-09-29T00:00:00Z" } }, preferences, evidence, now), "not_due");
});

test("ordinary prompts share one recipient-local day and at most one later follow-up", () => {
  const item = task();
  assert.equal(reminderDecision(item, preferences, { ...evidence, lastOrdinaryBatchAt: "2026-09-28T00:00:00Z" }, now), "daily_limit");
  assert.equal(reminderDecision(item, preferences, { ...evidence, initialAt: now }, now), "daily_limit");
  assert.equal(reminderDecision(item, preferences, { ...evidence, initialAt: "2026-09-27T04:00:00Z" }, now), "follow_up");
  assert.equal(reminderDecision(item, preferences, { ...evidence, initialAt: "2026-09-26T04:00:00Z", followUpAt: "2026-09-27T04:00:00Z" }, now), "follow_up_limit");
});

test("quiet time uses the recipient zone with explicit appointment exception and exact boundaries", () => {
  const item = task(), appointment = { ...item, kind: "appointment" as const };
  assert.equal(reminderDecision(item, preferences, evidence, "2026-09-28T14:00:00Z"), "quiet");
  assert.equal(reminderDecision(item, preferences, evidence, "2026-09-28T00:00:00Z"), "initial");
  assert.equal(reminderDecision(appointment, preferences, evidence, "2026-09-28T14:00:00Z"), "quiet");
  assert.equal(reminderDecision(appointment, { ...preferences, allowAppointmentDuringQuiet: true }, evidence, "2026-09-28T14:00:00Z"), "initial");
  assert.equal(reminderDecision(item, { ...preferences, timeZone: "America/New_York" }, evidence, "2026-09-28T04:00:00Z"), "quiet");
  assert.equal(reminderDecision(item, { ...preferences, quietStart: "10:00", quietEnd: "13:00" }, evidence, now), "quiet");
});

test("task write routing excludes viewers, history and direct unreceipted HTTP mutations", async () => {
  const item = task(), path = `/api/children/${item.childId}/tasks`;
  assert.deepEqual(onlineRoute({ path, payload: {} }).roles, ["owner", "caregiver"]);
  assert.equal(onlineRoute({ path: `${path}/${item.id}/change`, payload: {} }).kind, "tasks");
  assert.throws(() => onlineRoute({ path: `${path}/${item.id}/history`, payload: {} }));
  let called = false;
  const store = { create() { called = true; throw new Error(); } } as unknown as TaskStore;
  const request = new Request(`http://local${path}`, { method: "POST", headers: { "content-type": "application/json", "x-expected-user-id": "parent" }, body: "{}" });
  assert.equal((await handleTaskRequest(request, "parent", store)).status, 428);
  assert.equal((await handleTaskRequest(request, null, store)).status, 401);
  assert.equal(called, false);
});

test("task HTTP normalizes UUID scope before encrypted store operations", async () => {
  const item = task(); let scope = "";
  const store = { async get(_user: string, childId: string, id: string) { scope = `${childId}:${id}`; return item; } } as unknown as TaskStore;
  const response = await handleTaskRequest(new Request(`http://local/api/children/${item.childId.toUpperCase()}/tasks/${item.id.toUpperCase()}`), "parent", store);
  assert.equal(response.status, 200); assert.equal(scope, `${item.childId}:${item.id}`);
});
