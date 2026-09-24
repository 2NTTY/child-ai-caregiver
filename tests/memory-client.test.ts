import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryApi, MemoryApiError } from "../src/client/memory-api.ts";
import type { MemoryFact, MemoryTopic } from "../src/shared/memory.ts";

const childId = "f5aad9ca-7cda-4c06-9398-a0e01b09e690";
const factId = "15eb043b-d7a9-4b1c-afc1-25d1a92a2dca";
const topicId = "8e391c8b-71d9-48d5-a68d-54b15deaa282";
const reopenedId = "34066145-bdad-4b6b-af85-2af9ee2953a6";
const signal = () => new AbortController().signal;
const values = { key: "睡眠偏好", content: "較喜歡安靜環境", source: { kind: "manual" as const, description: "家長觀察" }, validUntil: null };
const fact: MemoryFact = { ...values, id: factId, childId, visibility: "private", intendedVisibility: "family", status: "candidate", version: 1,
  createdBy: "alice", confirmedBy: null, confirmedAt: null, reason: "", applicable: true, sourceState: "current" };
const topic: MemoryTopic = { id: topicId, childId, visibility: "private", title: "睡眠安排", note: "稍後再討論", status: "pending", version: 1,
  updatedBy: "alice", updatedAt: "2026-09-24T00:00:00Z", resumeAfter: null, reopenReason: null, reopenedFrom: null, mayAsk: true };
const context = { workspaceId: "5980663d-3bea-46fa-b63d-42d937026710", storageEpoch: "79081f55-9e30-4ee5-91fb-71982b20d6f7" };
const onlineResult = (result: unknown): typeof fetch => (async (input, init) => {
  if (String(input).endsWith("/online/context")) return Response.json(context);
  const operation = JSON.parse(String(init?.body)).operation;
  return Response.json({ state: "confirmed", operation, changeSeq: "1", statusCode: 200, result });
}) as typeof fetch;

test("memory client sends scoped routes, exact confirmation payloads and account headers", async () => {
  const calls: { path: string; method: string; body: unknown }[] = [];
  const api = createMemoryApi("http://localhost:3001", async (input, init) => {
    const path = new URL(String(input)).pathname.replace(/^\/api/, "") + new URL(String(input)).search;
    const method = init?.method ?? "GET";
    assert.equal(init?.credentials, "include");
    assert.equal(init?.cache, "no-store");
    assert.ok(init?.signal instanceof AbortSignal);
    assert.equal(new Headers(init?.headers).get("x-expected-user-id"), method === "POST" ? "alice" : null);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ path, method, body });
    if (path === "/online/context") return Response.json(context);
    const operation = path === "/online/submit" ? body.operation : null;
    const target = operation ? body.path.replace(/^\/api/, "") : path;
    const respond = (result: unknown) => Response.json(operation
      ? { state: "confirmed", operation, changeSeq: "1", statusCode: 200, result } : result);
    if (target === "/auth/get-session") return respond({ user: { id: "alice" } });
    if (target.endsWith("/facts?afterId=" + factId)) return respond({ items: [fact], nextAfterId: null });
    if (target.endsWith("/topics?afterId=" + topicId)) return respond({ items: [topic], nextAfterId: null });
    if (target.endsWith("/summary")) return respond({ summary: null });
    if (target.endsWith("/facts/" + factId + "/history?beforeVersion=2")) return respond({ revisions: [fact], nextBeforeVersion: null });
    if (target.endsWith("/topics/" + topicId + "/history?beforeVersion=2")) return respond({ revisions: [topic], nextBeforeVersion: null });
    if (target.endsWith("/facts/" + factId + "/delete") || target.endsWith("/topics/" + topicId + "/delete")) return respond({ deleted: true });
    if (target.endsWith("/facts/" + factId + "/confirm") || target.endsWith("/facts/" + factId + "/revise") || target.endsWith("/facts/" + factId + "/deactivate")) return respond({ fact: { ...fact, version: 2 } });
    if (target.endsWith("/topics/" + topicId + "/change")) return respond({ topic: { ...topic, status: "snoozed", resumeAfter: "2026-10-01T09:00:00+08:00", version: 2 } });
    if (target.endsWith("/topics/" + topicId + "/reopen")) return respond({ topic: { ...topic, id: reopenedId, reopenedFrom: topicId, version: 1 } });
    if (target.endsWith("/facts")) return respond({ fact });
    if (target.endsWith("/topics")) return respond({ topic });
    throw new Error(`Unexpected route ${target}`);
  });
  assert.equal(await api.getSession(signal()), "alice");
  assert.deepEqual(await api.facts(childId, factId, signal()), { items: [fact], nextAfterId: null });
  assert.deepEqual(await api.topics(childId, topicId, signal()), { items: [topic], nextAfterId: null });
  assert.equal(await api.summary(childId, signal()), null);
  assert.deepEqual((await api.factHistory(childId, factId, 2, signal())).revisions, [fact]);
  assert.deepEqual((await api.topicHistory(childId, topicId, 2, signal())).revisions, [topic]);
  await api.createFact(childId, { values, intendedVisibility: "family" }, signal(), "alice");
  await api.confirmFact(childId, factId, { expectedVersion: 1, confirm: true, confirmShared: true }, signal(), "alice");
  await api.reviseFact(childId, factId, { values, expectedVersion: 1, reason: "補充", confirm: true, confirmShared: false }, signal(), "alice");
  await api.deactivateFact(childId, factId, { expectedVersion: 1, reason: "不再適用" }, signal(), "alice");
  await api.deleteFact(childId, factId, { expectedVersion: 1, confirmDelete: true }, signal(), "alice");
  await api.createTopic(childId, { title: "睡眠安排", note: "", visibility: "family", confirmShared: true }, signal(), "alice");
  await api.changeTopic(childId, topicId, { expectedVersion: 1, status: "snoozed", note: "稍後再談", resumeAfter: "2026-10-01T09:00:00+08:00" }, signal(), "alice");
  await api.reopenTopic(childId, topicId, { expectedVersion: 1, reason: "新情況" }, signal(), "alice");
  await api.deleteTopic(childId, topicId, { expectedVersion: 1, confirmDelete: true }, signal(), "alice");
  const direct = calls.filter(call => call.path !== "/online/context" && call.path !== "/online/submit");
  assert.deepEqual(direct.map(({ path, method }) => [path, method]), [
    ["/auth/get-session", "GET"],
    [`/children/${childId}/memory/facts?afterId=${factId}`, "GET"], [`/children/${childId}/memory/topics?afterId=${topicId}`, "GET"],
    [`/children/${childId}/memory/summary`, "GET"], [`/children/${childId}/memory/facts/${factId}/history?beforeVersion=2`, "GET"],
    [`/children/${childId}/memory/topics/${topicId}/history?beforeVersion=2`, "GET"],
  ]);
  const submissions = calls.filter(call => call.path === "/online/submit").map(call => call.body as { path: string; payload: unknown });
  assert.deepEqual(submissions.map(({ path }) => path), [
    `/api/children/${childId}/memory/facts`, `/api/children/${childId}/memory/facts/${factId}/confirm`,
    `/api/children/${childId}/memory/facts/${factId}/revise`, `/api/children/${childId}/memory/facts/${factId}/deactivate`,
    `/api/children/${childId}/memory/facts/${factId}/delete`, `/api/children/${childId}/memory/topics`,
    `/api/children/${childId}/memory/topics/${topicId}/change`, `/api/children/${childId}/memory/topics/${topicId}/reopen`,
    `/api/children/${childId}/memory/topics/${topicId}/delete`,
  ]);
  assert.deepEqual(submissions.map(({ payload }) => payload), [
    { values, intendedVisibility: "family" }, { expectedVersion: 1, confirm: true, confirmShared: true },
    { values, expectedVersion: 1, reason: "補充", confirm: true, confirmShared: false }, { expectedVersion: 1, reason: "不再適用" },
    { expectedVersion: 1, confirmDelete: true }, { title: "睡眠安排", note: "", visibility: "family", confirmShared: true },
    { expectedVersion: 1, status: "snoozed", note: "稍後再談", resumeAfter: "2026-10-01T09:00:00+08:00" },
    { expectedVersion: 1, reason: "新情況" }, { expectedVersion: 1, confirmDelete: true },
  ]);
  assert.equal(calls.filter(call => call.path === "/online/context").length, submissions.length);
});

test("memory client rejects malformed or out-of-scope responses and stale writes", async () => {
  const invalid = (payload: unknown) => createMemoryApi("/api", async () => Response.json(payload));
  await assert.rejects(invalid({ items: [{ ...fact, childId: "another" }], nextAfterId: null }).facts(childId, null, signal()), MemoryApiError);
  await assert.rejects(invalid({ items: [fact], nextAfterId: 7 }).facts(childId, null, signal()), MemoryApiError);
  await assert.rejects(invalid({ summary: { id: "summary", childId: "another", version: 1, text: "private", createdAt: "", previousId: null, coveredMessageIds: [], lastCoveredMessageId: "" } }).summary(childId, signal()), MemoryApiError);
  await assert.rejects(invalid({ revisions: [{ ...topic, id: "another" }], nextBeforeVersion: null }).topicHistory(childId, topicId, null, signal()), MemoryApiError);
  await assert.rejects(createMemoryApi("/api", onlineResult({ fact })).reviseFact(childId, factId, { values, expectedVersion: 1, reason: "補充", confirm: true, confirmShared: false }, signal(), "alice"),
    error => error instanceof MemoryApiError && error.confirmed);
  await assert.rejects(createMemoryApi("/api", onlineResult({ topic: { ...topic, id: reopenedId, reopenedFrom: null } })).reopenTopic(childId, topicId, { expectedVersion: 1, reason: "新情況" }, signal(), "alice"),
    error => error instanceof MemoryApiError && error.confirmed);
});

test("memory client preserves failure status without leaking response details or retrying", async () => {
  for (const status of [400, 401, 403, 404, 409, 500]) {
    let calls = 0;
    await assert.rejects(createMemoryApi("/api", async () => { calls++; return new Response("PRIVATE DETAIL", { status }); })
      .createFact(childId, { values, intendedVisibility: "private" }, signal(), "alice"),
    error => error instanceof MemoryApiError && error.status === status && !error.message.includes("PRIVATE"));
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(createMemoryApi("/api", async () => { calls++; throw new Error("PRIVATE NETWORK DETAIL"); })
    .createTopic(childId, { title: "睡眠安排", note: "", visibility: "private", confirmShared: false }, signal(), "alice"),
  error => error instanceof MemoryApiError && error.status === 0 && !error.message.includes("PRIVATE"));
  assert.equal(calls, 1);
});

test("memory client reconciles an unknown write and retries only the original operation identity", async () => {
  const submitted: string[] = [];
  let contexts = 0;
  const api = createMemoryApi("/api", async (input, init) => {
    const path = String(input);
    if (path.endsWith("/online/context")) { contexts++; return Response.json(context); }
    if (path.includes("/online/operations/")) return Response.json({ state: "unconfirmed" });
    if (path.endsWith("/online/submit")) {
      const operation = JSON.parse(String(init?.body)).operation;
      submitted.push(operation.opId);
      if (submitted.length === 1) throw new Error("PRIVATE NETWORK DETAIL");
      return Response.json({ state: "confirmed", operation, changeSeq: "2", statusCode: 201, result: { fact } });
    }
    throw new Error("Unexpected route");
  });
  const input = { values, intendedVisibility: "family" as const };
  await assert.rejects(api.createFact(childId, input, signal(), "alice"), error => error instanceof MemoryApiError && error.status === 0 && !error.confirmed);
  assert.equal(submitted.length, 1);
  assert.equal(api.hasPendingOnline?.(), true);
  assert.deepEqual(await api.reconcilePending!(signal(), "alice"), { state: "unconfirmed" });
  assert.equal(submitted.length, 1, "receipt lookup must not resubmit");
  assert.deepEqual(await api.createFact(childId, input, signal(), "alice"), fact);
  assert.deepEqual(submitted, [submitted[0], submitted[0]]);
  assert.equal(contexts, 1);
  assert.equal(api.hasPendingOnline?.(), false);
});

test("confirmed null receipt clears the pending identity without creating another write", async () => {
  let operation: unknown;
  let submissions = 0;
  const api = createMemoryApi("/api", async (input, init) => {
    const path = String(input);
    if (path.endsWith("/online/context")) return Response.json(context);
    if (path.endsWith("/online/submit")) { submissions++; operation = JSON.parse(String(init?.body)).operation; throw new Error("PRIVATE NETWORK DETAIL"); }
    if (path.includes("/online/operations/")) return Response.json({ state: "confirmed", operation, changeSeq: "3", statusCode: 201, result: null });
    throw new Error("Unexpected route");
  });
  await assert.rejects(api.createTopic(childId, { title: "睡眠安排", note: "", visibility: "private", confirmShared: false }, signal(), "alice"), MemoryApiError);
  const receipt = await api.reconcilePending!(signal(), "alice");
  assert.equal(receipt?.state, "confirmed");
  if (receipt?.state === "confirmed") assert.equal(receipt.result, null);
  assert.equal(api.hasPendingOnline?.(), false);
  assert.equal(submissions, 1);
});
