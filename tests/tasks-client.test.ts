import assert from "node:assert/strict";
import test from "node:test";
import { createTaskApi, TaskApiError } from "../src/client/task-api.ts";
import type { CareTask, TaskChange, TaskCreate, TaskPage, TaskReminder, TaskWorkState } from "../src/shared/tasks.ts";

const childId = "f5aad9ca-7cda-4c06-9398-a0e01b09e690";
const taskId = "15eb043b-d7a9-4b1c-afc1-25d1a92a2dca";
const otherId = "8e391c8b-71d9-48d5-a68d-54b15deaa282";
const occurrenceId = "34066145-bdad-4b6b-af85-2af9ee2953a6";
const context = { workspaceId: "5980663d-3bea-46fa-b63d-42d937026710", storageEpoch: "79081f55-9e30-4ee5-91fb-71982b20d6f7" };
const signal = () => new AbortController().signal;
const values = { title: "檢查到診資料", details: "帶備記錄", kind: "ordinary" as const, assigneeUserId: "alice", dueAt: "2026-10-01T09:00:00+08:00", timeZone: "Asia/Hong_Kong" };
const create: TaskCreate = { values, confirm: true };
const change: TaskChange = { action: "complete", expectedVersion: 1, confirm: true, note: "" };
const task: CareTask = { id: taskId, childId, version: 1, title: values.title, details: values.details, kind: values.kind,
  assigneeUserId: "alice", createdBy: "alice", createdAt: "2026-09-28T00:00:00Z", updatedAt: "2026-09-28T00:00:00Z",
  occurrence: { id: occurrenceId, dueAt: values.dueAt, timeZone: values.timeZone, state: "scheduled", terminalBasisVersion: null } };
const completed: CareTask = { ...task, version: 2, occurrence: { ...task.occurrence, state: "completed", terminalBasisVersion: 1 } };
const page: TaskPage = { items: [task], eligibleAssignees: [{ userId: "alice", name: "合成家長" }], nextAfterId: null };
const reminder: TaskReminder = { id: "c9c7d3fb-4237-423d-9155-8a65592d1190", batchId: "df5d68d7-e8e3-414e-bb4d-3420a136f30b",
  taskId, occurrenceId, taskVersion: 1, phase: "initial", createdAt: "2026-10-01T01:00:00Z" };
const work: TaskWorkState = { taskId, taskVersion: 1, status: "pending", nextAt: "2026-10-01T01:01:00Z", failures: 0 };
const workerPage: TaskPage = { ...page, reminders: [reminder], work: [work], workerEnabled: true };
const onlineResult = (result: unknown): typeof fetch => async (input, init) => {
  if (String(input).endsWith("/online/context")) return Response.json(context);
  const operation = JSON.parse(String(init?.body)).operation;
  return Response.json({ state: "confirmed", operation, changeSeq: "1", statusCode: 200, result });
};
const confirmedError = (error: unknown) => error instanceof TaskApiError && error.confirmed;

test("task client normalizes the API base and sends scoped reads and online-only exact writes", async () => {
  const calls: { path: string; method: string; body: unknown }[] = [];
  const api = createTaskApi("https://example.test/api/", async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.pathname.startsWith("/api/api"), false);
    const path = url.pathname.replace(/^\/api/u, "") + url.search;
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    assert.equal(init?.credentials, "include"); assert.equal(init?.cache, "no-store");
    assert.ok(init?.signal instanceof AbortSignal);
    assert.equal(new Headers(init?.headers).get("x-expected-user-id"), method === "POST" ? "alice" : null);
    calls.push({ path, method, body });
    if (path === "/auth/get-session") return Response.json({ user: { id: "alice" } });
    if (path === "/online/context") return Response.json(context);
    if (path === "/online/submit") return Response.json({ state: "confirmed", operation: body.operation, changeSeq: "2", statusCode: 200,
      result: { task: body.path.endsWith("/change") ? completed : task } });
    if (path.endsWith(`/tasks?afterId=${taskId}`)) return Response.json(page);
    if (path.endsWith(`/tasks/${taskId}`)) return Response.json({ task });
    if (path.endsWith(`/tasks/${taskId}/history?beforeVersion=2`)) return Response.json({ revisions: [{ task, action: "create", actorUserId: "alice", basisVersion: 0, note: "", at: task.createdAt }], nextBeforeVersion: null });
    throw new Error("Unexpected route");
  });
  assert.equal(await api.getSession(signal()), "alice");
  assert.deepEqual(await api.tasks(childId, taskId, signal()), page);
  assert.deepEqual(await api.task(childId, taskId, signal()), task);
  assert.equal((await api.history(childId, taskId, 2, signal())).revisions[0].basisVersion, 0);
  assert.deepEqual(await api.createTask(childId, create, signal(), "alice"), task);
  assert.deepEqual(await api.changeTask(childId, taskId, change, signal(), "alice"), completed);
  assert.deepEqual(calls.filter(call => call.method === "GET").map(call => call.path), ["/auth/get-session", `/children/${childId}/tasks?afterId=${taskId}`,
    `/children/${childId}/tasks/${taskId}`, `/children/${childId}/tasks/${taskId}/history?beforeVersion=2`]);
  const writes = calls.filter(call => call.path === "/online/submit").map(call => call.body as { path: string; payload: unknown });
  assert.deepEqual(writes.map(({ path, payload }) => ({ path, payload })), [
    { path: `/api/children/${childId}/tasks`, payload: create }, { path: `/api/children/${childId}/tasks/${taskId}/change`, payload: change },
  ]);
  assert.equal(calls.filter(call => call.method === "POST").length, 4);
});

test("task client rejects malformed, wrong-child and wrong-task reads without returning empty data", async () => {
  const invalid = (value: unknown) => createTaskApi("/api", async () => Response.json(value));
  for (const value of [{ ...page, items: [{ ...task, childId: otherId }] }, { ...page, nextAfterId: "bad-cursor" },
    { ...page, eligibleAssignees: [{ userId: "alice" }] }, { ...page, items: [{ ...task, occurrence: { ...task.occurrence, dueAt: "2026-10-01T09:00:00" } }] }]) {
    await assert.rejects(invalid(value).tasks(childId, null, signal()), TaskApiError);
  }
  await assert.rejects(invalid({ task: { ...task, id: otherId } }).task(childId, taskId, signal()), TaskApiError);
  await assert.rejects(invalid({ revisions: [{ task: { ...task, id: otherId }, action: "create", actorUserId: "alice", basisVersion: 0, note: "", at: task.createdAt }], nextBeforeVersion: null })
    .history(childId, taskId, null, signal()), TaskApiError);
  await assert.rejects(invalid({ revisions: [], nextBeforeVersion: 0 }).history(childId, taskId, null, signal()), TaskApiError);
});

test("task list reads preserve optional reminders and every recorded worker status without changing older responses", async () => {
  const read = (value: unknown) => createTaskApi("/api", async () => Response.json(value)).tasks(childId, null, signal());
  assert.deepEqual(await read(page), page);
  for (const status of ["pending", "processed", "stopped", "failed", "unknown"] as const) {
    const value: TaskPage = { ...workerPage, work: [{ ...work, status, failures: 2 }], workerEnabled: status !== "stopped",
      reminders: [reminder, { ...reminder, id: "e4c0f88f-0f2a-4884-b87a-e24cafafc3b6", phase: "follow_up", createdAt: "2026-10-01T02:00:00Z" }] };
    assert.deepEqual(await read(value), value);
  }
  assert.deepEqual(await read({ ...page, reminders: [], work: [], workerEnabled: false }), { ...page, reminders: [], work: [], workerEnabled: false });
});

test("task list reads reject malformed or stale metadata instead of treating it as an empty success", async () => {
  const invalidReminders = [
    { ...reminder, taskId: otherId }, { ...reminder, occurrenceId: otherId }, { ...reminder, taskVersion: 2 },
    { ...reminder, taskVersion: 0 }, { ...reminder, id: "bad-id" }, { ...reminder, batchId: "bad-batch" },
    { ...reminder, phase: "unknown" }, { ...reminder, createdAt: "2026-10-01T09:00:00" },
  ];
  const invalidWork = [
    { ...work, taskId: otherId }, { ...work, taskVersion: 2 }, { ...work, taskVersion: 0 }, { ...work, status: "not_a_status" },
    { ...work, failures: -1 }, { ...work, failures: 1.5 }, { ...work, nextAt: "tomorrow" },
  ];
  const invalidPages = [
    ...invalidReminders.map(value => ({ ...workerPage, reminders: [value] })),
    ...invalidWork.map(value => ({ ...workerPage, work: [value] })),
    { ...workerPage, reminders: null }, { ...workerPage, work: null }, { ...workerPage, workerEnabled: "true" },
    ...["completed", "cancelled", "needs_review"].map(state => ({ ...workerPage, items: [{ ...task, occurrence: { ...task.occurrence, state } }] })),
    { ...workerPage, items: [] },
  ];
  for (const value of invalidPages) {
    const api = createTaskApi("/api", async () => Response.json(value));
    await assert.rejects(api.tasks(childId, null, signal()), error => error instanceof TaskApiError && error.status === 0 && !error.confirmed);
  }
});

test("confirmed task writes require the right scope and a newer version and preserve needs_review", async () => {
  await assert.rejects(createTaskApi("/api", onlineResult({ task: { ...task, childId: otherId } })).createTask(childId, create, signal(), "alice"), confirmedError);
  await assert.rejects(createTaskApi("/api", onlineResult({ task })).changeTask(childId, taskId, change, signal(), "alice"), confirmedError);
  await assert.rejects(createTaskApi("/api", onlineResult({ task: { ...completed, id: otherId } })).changeTask(childId, taskId, change, signal(), "alice"), confirmedError);
  const review: CareTask = { ...completed, version: 3, occurrence: { ...completed.occurrence, state: "needs_review" } };
  assert.equal((await createTaskApi("/api", onlineResult({ task: review })).changeTask(childId, taskId, change, signal(), "alice")).occurrence.state, "needs_review");
});

test("unknown task writes keep their original snapshot and opId; receipt lookup never resubmits", async () => {
  const submitted: { operation: { opId: string }; payload: TaskCreate }[] = [];
  let contexts = 0;
  const api = createTaskApi("/api", async (input, init) => {
    const path = String(input);
    if (path.endsWith("/online/context")) { contexts++; return Response.json(context); }
    if (path.includes("/online/operations/")) return Response.json({ state: "unconfirmed" });
    const submission = JSON.parse(String(init?.body)); submitted.push(submission);
    if (submitted.length === 1) throw new Error("PRIVATE NETWORK DETAIL");
    return Response.json({ state: "confirmed", operation: submission.operation, changeSeq: "2", statusCode: 201, result: { task } });
  });
  const draft = structuredClone(create);
  await assert.rejects(api.createTask(childId, draft, signal(), "alice"), error => error instanceof TaskApiError && !error.confirmed && error.status === 0);
  draft.values.title = "changed after submit";
  await assert.rejects(api.createTask(childId, draft, signal(), "alice"), error => error instanceof TaskApiError && error.onlineCode === "operation_pending");
  assert.deepEqual(await api.reconcilePending(signal(), "alice"), { state: "unconfirmed" });
  assert.equal(submitted.length, 1);
  assert.equal(api.hasPendingOnline(), true);
  assert.deepEqual(await api.createTask(childId, create, signal(), "alice"), task);
  assert.deepEqual(submitted.map(entry => entry.operation.opId), [submitted[0].operation.opId, submitted[0].operation.opId]);
  assert.deepEqual(submitted.map(entry => entry.payload), [create, create]);
  assert.equal(contexts, 1); assert.equal(api.hasPendingOnline(), false);
});

test("receipt reconciliation validates the pending task scope and treats null as confirmed", async () => {
  for (const result of [{ task: completed }, null, { task: { ...completed, childId: otherId } }, { task }]) {
    let operation: unknown; let submissions = 0;
    const api = createTaskApi("/api", async (input, init) => {
      const path = String(input);
      if (path.endsWith("/online/context")) return Response.json(context);
      if (path.endsWith("/online/submit")) { submissions++; operation = JSON.parse(String(init?.body)).operation; throw new Error("lost response"); }
      return Response.json({ state: "confirmed", operation, changeSeq: "3", statusCode: 200, result });
    });
    await assert.rejects(api.changeTask(childId, taskId, change, signal(), "alice"), TaskApiError);
    if (result !== null && result.task !== completed) await assert.rejects(api.reconcilePending(signal(), "alice"), confirmedError);
    else {
      const receipt = await api.reconcilePending(signal(), "alice");
      assert.equal(receipt?.state, "confirmed");
      if (receipt?.state === "confirmed") assert.deepEqual(receipt.result, result);
    }
    assert.equal(api.hasPendingOnline(), false); assert.equal(submissions, 1);
    assert.equal(await api.reconcilePending(signal(), "alice"), null);
  }
});

test("version_conflict is a known rejection and preserves its safe code without a retry", async () => {
  let submissions = 0;
  const api = createTaskApi("/api", async input => {
    if (String(input).endsWith("/online/context")) return Response.json(context);
    submissions++;
    return Response.json({ error: { code: "version_conflict", message: "PRIVATE SERVER DETAIL" } }, { status: 409 });
  });
  await assert.rejects(api.changeTask(childId, taskId, change, signal(), "alice"), error => error instanceof TaskApiError && error.onlineCode === "version_conflict" && error.status === 409 && !error.confirmed && !error.message.includes("PRIVATE"));
  assert.equal(api.hasPendingOnline(), false); assert.equal(submissions, 1);
});

test("read errors preserve failure status and never expose server content", async () => {
  for (const status of [401, 403, 404, 500]) {
    let calls = 0;
    const api = createTaskApi("/api", async () => { calls++; return new Response("PRIVATE SERVER DETAIL", { status }); });
    await assert.rejects(api.tasks(childId, null, signal()), error => error instanceof TaskApiError && error.status === status && !error.message.includes("PRIVATE"));
    assert.equal(calls, 1);
  }
  await assert.rejects(createTaskApi("/api", async () => { throw new Error("PRIVATE NETWORK DETAIL"); }).tasks(childId, null, signal()),
    error => error instanceof TaskApiError && error.status === 0 && !error.message.includes("PRIVATE"));
});

test("revocation and account changes discard pending task identities without replay", async () => {
  for (const mode of ["revoked", "account_changed", "reset"] as const) {
    let submissions = 0; let lookups = 0;
    const api = createTaskApi("/api", async input => {
      const path = String(input);
      if (path.endsWith("/online/context")) return Response.json(context);
      if (path.endsWith("/online/submit")) { submissions++; throw new Error("lost response"); }
      lookups++; return new Response(null, { status: 404 });
    });
    await assert.rejects(api.createTask(childId, create, signal(), "alice"), TaskApiError);
    if (mode === "revoked") await assert.rejects(api.reconcilePending(signal(), "alice"), error => error instanceof TaskApiError && error.status === 404);
    else if (mode === "account_changed") assert.equal(await api.reconcilePending(signal(), "bob"), null);
    else { api.resetOnline(); assert.equal(await api.reconcilePending(signal(), "alice"), null); }
    assert.equal(api.hasPendingOnline(), false); assert.equal(submissions, 1); assert.equal(lookups, mode === "revoked" ? 1 : 0);
  }
});

test("reset and abort suppress delayed task reads even when the fetcher ignores abort", async () => {
  for (const mode of ["reset", "abort"] as const) {
    let finish!: (response: Response) => void;
    const api = createTaskApi("/api", () => new Promise<Response>(resolve => { finish = resolve; }));
    const controller = new AbortController();
    const reading = api.tasks(childId, null, controller.signal);
    if (mode === "reset") api.resetOnline(); else controller.abort();
    finish(Response.json(workerPage));
    await assert.rejects(reading, TaskApiError);
  }
});

test("a confirmed write response received after abort cannot be mistaken for an unsent operation", async () => {
  const controller = new AbortController();
  const api = createTaskApi("/api", async (input, init) => {
    if (String(input).endsWith("/online/context")) return Response.json(context);
    const operation = JSON.parse(String(init?.body)).operation;
    controller.abort();
    return Response.json({ state: "confirmed", operation, changeSeq: "4", statusCode: 201, result: { task } });
  });
  await assert.rejects(api.createTask(childId, create, controller.signal, "alice"), confirmedError);
  assert.equal(api.hasPendingOnline(), false);
});
