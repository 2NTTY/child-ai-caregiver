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
    if (path === "/auth/get-session") return Response.json({ user: { id: "alice" } });
    if (path.endsWith("/facts?afterId=" + factId)) return Response.json({ items: [fact], nextAfterId: null });
    if (path.endsWith("/topics?afterId=" + topicId)) return Response.json({ items: [topic], nextAfterId: null });
    if (path.endsWith("/summary")) return Response.json({ summary: null });
    if (path.endsWith("/facts/" + factId + "/history?beforeVersion=2")) return Response.json({ revisions: [fact], nextBeforeVersion: null });
    if (path.endsWith("/topics/" + topicId + "/history?beforeVersion=2")) return Response.json({ revisions: [topic], nextBeforeVersion: null });
    if (path.endsWith("/facts/" + factId + "/delete") || path.endsWith("/topics/" + topicId + "/delete")) return Response.json({ deleted: true });
    if (path.endsWith("/facts/" + factId + "/confirm") || path.endsWith("/facts/" + factId + "/revise") || path.endsWith("/facts/" + factId + "/deactivate")) return Response.json({ fact: { ...fact, version: 2 } });
    if (path.endsWith("/topics/" + topicId + "/change")) return Response.json({ topic: { ...topic, status: "snoozed", resumeAfter: "2026-10-01T09:00:00+08:00", version: 2 } });
    if (path.endsWith("/topics/" + topicId + "/reopen")) return Response.json({ topic: { ...topic, id: reopenedId, reopenedFrom: topicId, version: 1 } });
    if (path.endsWith("/facts")) return Response.json({ fact });
    if (path.endsWith("/topics")) return Response.json({ topic });
    throw new Error(`Unexpected route ${path}`);
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
  assert.deepEqual(calls.slice(1).map(({ path, method }) => [path, method]), [
    [`/children/${childId}/memory/facts?afterId=${factId}`, "GET"], [`/children/${childId}/memory/topics?afterId=${topicId}`, "GET"],
    [`/children/${childId}/memory/summary`, "GET"], [`/children/${childId}/memory/facts/${factId}/history?beforeVersion=2`, "GET"],
    [`/children/${childId}/memory/topics/${topicId}/history?beforeVersion=2`, "GET"],
    [`/children/${childId}/memory/facts`, "POST"], [`/children/${childId}/memory/facts/${factId}/confirm`, "POST"],
    [`/children/${childId}/memory/facts/${factId}/revise`, "POST"], [`/children/${childId}/memory/facts/${factId}/deactivate`, "POST"],
    [`/children/${childId}/memory/facts/${factId}/delete`, "POST"], [`/children/${childId}/memory/topics`, "POST"],
    [`/children/${childId}/memory/topics/${topicId}/change`, "POST"], [`/children/${childId}/memory/topics/${topicId}/reopen`, "POST"],
    [`/children/${childId}/memory/topics/${topicId}/delete`, "POST"],
  ]);
  assert.deepEqual(calls.slice(6).map(({ body }) => body), [
    { values, intendedVisibility: "family" }, { expectedVersion: 1, confirm: true, confirmShared: true },
    { values, expectedVersion: 1, reason: "補充", confirm: true, confirmShared: false }, { expectedVersion: 1, reason: "不再適用" },
    { expectedVersion: 1, confirmDelete: true }, { title: "睡眠安排", note: "", visibility: "family", confirmShared: true },
    { expectedVersion: 1, status: "snoozed", note: "稍後再談", resumeAfter: "2026-10-01T09:00:00+08:00" },
    { expectedVersion: 1, reason: "新情況" }, { expectedVersion: 1, confirmDelete: true },
  ]);
});

test("memory client rejects malformed or out-of-scope responses and stale writes", async () => {
  const invalid = (payload: unknown) => createMemoryApi("/api", async () => Response.json(payload));
  await assert.rejects(invalid({ items: [{ ...fact, childId: "another" }], nextAfterId: null }).facts(childId, null, signal()), MemoryApiError);
  await assert.rejects(invalid({ items: [fact], nextAfterId: 7 }).facts(childId, null, signal()), MemoryApiError);
  await assert.rejects(invalid({ summary: { id: "summary", childId: "another", version: 1, text: "private", createdAt: "", previousId: null, coveredMessageIds: [], lastCoveredMessageId: "" } }).summary(childId, signal()), MemoryApiError);
  await assert.rejects(invalid({ revisions: [{ ...topic, id: "another" }], nextBeforeVersion: null }).topicHistory(childId, topicId, null, signal()), MemoryApiError);
  await assert.rejects(invalid({ fact }).reviseFact(childId, factId, { values, expectedVersion: 1, reason: "補充", confirm: true, confirmShared: false }, signal(), "alice"), MemoryApiError);
  await assert.rejects(invalid({ topic: { ...topic, id: reopenedId, reopenedFrom: null } }).reopenTopic(childId, topicId, { expectedVersion: 1, reason: "新情況" }, signal(), "alice"), MemoryApiError);
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
