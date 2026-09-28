import assert from "node:assert/strict";
import test from "node:test";
import { zodResolver } from "@hookform/resolvers/zod";
import { taskChangeSchema, taskValuesSchema } from "../src/shared/tasks.ts";

const options = { criteriaMode: "firstError" as const, shouldUseNativeValidation: false, fields: {} };
const values = { title: "到診準備", details: "", kind: "appointment" as const, assigneeUserId: "alice", dueAt: "2026-10-01T09:00:00+08:00", timeZone: "Asia/Hong_Kong" };

test("the task form Zod resolver accepts explicit offsets and rejects missing time zones or assignees", async () => {
  const resolve = zodResolver(taskValuesSchema);
  assert.deepEqual(await resolve(values, undefined, options), { errors: {}, values });
  for (const [field, value] of [["dueAt", "2026-10-01T09:00:00"], ["timeZone", "invalid-zone"], ["assigneeUserId", ""]]) {
    const result = await resolve({ ...values, [field]: value }, undefined, options);
    assert.ok(field in result.errors);
    assert.deepEqual(result.values, {});
  }
});

test("the change form resolver requires reasons for reschedule, cancellation and explicit review outcomes", async () => {
  const resolve = zodResolver(taskChangeSchema);
  const basis = { expectedVersion: 2, confirm: true as const };
  const complete = { ...basis, action: "complete" as const, note: "" };
  assert.deepEqual(await resolve(complete, undefined, options), { errors: {}, values: complete });
  const invalid = [
    { ...basis, action: "cancel" as const, note: "" },
    { ...basis, action: "reschedule" as const, dueAt: values.dueAt, timeZone: values.timeZone, assigneeUserId: "alice", note: " " },
    { ...basis, action: "resolve" as const, outcome: "completed" as const, note: "" },
  ];
  for (const input of invalid) assert.ok((await resolve(input, undefined, options)).errors.note);
  for (const outcome of ["completed", "cancelled"] as const) {
    const input = { ...basis, action: "resolve" as const, outcome, note: "已向家庭成員核對" };
    assert.deepEqual(await resolve(input, undefined, options), { errors: {}, values: input });
  }
});
