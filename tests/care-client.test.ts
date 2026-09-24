import assert from "node:assert/strict";
import test from "node:test";
import { createCareApi, CareApiError } from "../src/client/care-api.ts";
import { emptyCareDetails } from "../src/shared/care.ts";

const signal = () => new AbortController().signal;
const profileData = { age: { kind: "unknown" }, dueDate: null, gestationalWeeksRaw: null, region: null, language: null, allergies: null, specialNeeds: null, preferences: null, source: "家長描述", validUntil: null } as const;
const profile = { childId: "child-1", version: 1, data: profileData, confirmedBy: "alice", confirmedAt: "2026-09-24T00:00:00.000Z", reason: "首次確認" };
const values = { text: "昨晚約九點飲奶", details: { ...emptyCareDetails("feeding"), quantity: { rawValue: "約120", unit: "ml", precision: "approximate" as const }, eventTime: { rawText: "昨晚約九點", at: null, timeZone: "Asia/Hong_Kong", precision: "approximate" as const } }, source: "家長描述" };
const record = { ...values, version: 1, confirmedBy: "alice", confirmedAt: "2026-09-24T00:00:00.000Z", reason: "首次確認", id: "record-1", childId: "child-1", authorUserId: "alice", createdAt: "2026-09-24T00:00:00.000Z" };
const context = { workspaceId: "5980663d-3bea-46fa-b63d-42d937026710", storageEpoch: "79081f55-9e30-4ee5-91fb-71982b20d6f7" };
const onlineResult = (result: unknown): typeof fetch => (async (input, init) => {
  if (String(input).endsWith("/online/context")) return Response.json(context);
  const operation = JSON.parse(String(init?.body)).operation;
  return Response.json({ state: "confirmed", operation, changeSeq: "1", statusCode: 200, result });
}) as typeof fetch;

test("care client preserves source and raw values, scopes routes, and sends account/version confirmation", async () => {
  const calls: { path: string; method: string; body: unknown }[] = [];
  const api = createCareApi("http://localhost:3001", async (input, init) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/api/, "") + url.search;
    const method = init?.method ?? "GET";
    assert.equal(init?.credentials, "include");
    assert.equal(init?.cache, "no-store");
    assert.equal(new Headers(init?.headers).get("x-expected-user-id"), method === "POST" ? "alice" : null);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ path, method, body });
    if (path === "/online/context") return Response.json(context);
    const operation = path === "/online/submit" ? body.operation : null;
    const target = operation ? body.path.replace(/^\/api/, "") : path;
    const respond = (result: unknown) => Response.json(operation
      ? { state: "confirmed", operation, changeSeq: "1", statusCode: 200, result } : result);
    if (target === "/auth/get-session") return respond({ user: { id: "alice" } });
    if (target.endsWith("/profile/history?beforeVersion=1")) return respond({ revisions: [profile], nextBeforeVersion: null });
    if (target.endsWith("/profile/delete")) return respond({ profile: { ...profile, version: 2, data: null } });
    if (target.endsWith("/profile")) return respond({ profile: method === "POST" ? { ...profile, version: 2 } : profile });
    if (target.endsWith("/care/search")) return respond({ records: [], nextCursor: { createdAt: record.createdAt, id: record.id }, scanned: 200, limit: 50 });
    if (target.endsWith("/care/record-1/history?beforeVersion=1")) return respond({ revisions: [record], nextBeforeVersion: null });
    if (target.endsWith("/care/record-1/delete")) return respond({ deleted: true });
    if (target.endsWith("/care/record-1/revise")) return respond({ record: { ...record, version: 2 } });
    if (target.endsWith("/care")) return respond({ record });
    throw new Error(`Unexpected route ${target}`);
  });
  assert.equal(await api.getSession(signal()), "alice");
  assert.deepEqual(await api.getProfile("child-1", signal()), profile);
  assert.equal((await api.saveProfile("child-1", profileData, 1, "補充來源", signal(), "alice")).version, 2);
  assert.equal((await api.profileHistory("child-1", 1, signal())).revisions[0]?.version, 1);
  assert.equal((await api.deleteProfile("child-1", 1, signal(), "alice")).data, null);
  const page = await api.search("child-1", { query: "飲奶", kind: "feeding", cursor: { createdAt: record.createdAt, id: record.id } }, signal(), "alice");
  assert.equal(page.records.length, 0);
  assert.ok(page.nextCursor, "an empty page can still have a next cursor");
  assert.deepEqual(await api.create("child-1", values, signal(), "alice"), record);
  assert.equal((await api.revise("child-1", record.id, values, 1, "修正", signal(), "alice")).version, 2);
  assert.equal((await api.history("child-1", record.id, 1, signal())).revisions[0]?.version, 1);
  await api.delete("child-1", record.id, 1, signal(), "alice");
  const direct = calls.filter(call => call.path !== "/online/context" && call.path !== "/online/submit");
  assert.deepEqual(direct.map(({ path, method }) => [path, method]), [
    ["/auth/get-session", "GET"], ["/children/child-1/profile", "GET"],
    ["/children/child-1/profile/history?beforeVersion=1", "GET"],
    ["/children/child-1/care/search", "POST"],
    ["/children/child-1/care/record-1/history?beforeVersion=1", "GET"],
  ]);
  assert.deepEqual(direct[3]?.body, { query: "飲奶", kind: "feeding", cursor: { createdAt: record.createdAt, id: record.id } });
  const submissions = calls.filter(call => call.path === "/online/submit").map(call => call.body as { path: string; payload: unknown });
  assert.deepEqual(submissions.map(item => [item.path, item.payload]), [
    ["/api/children/child-1/profile", { data: profileData, expectedVersion: 1, reason: "補充來源", confirmShared: true }],
    ["/api/children/child-1/profile/delete", { expectedVersion: 1, confirmDelete: true }],
    ["/api/children/child-1/care", { ...values, confirmShared: true }],
    ["/api/children/child-1/care/record-1/revise", { ...values, expectedVersion: 1, reason: "修正", confirmShared: true }],
    ["/api/children/child-1/care/record-1/delete", { expectedVersion: 1, confirmDelete: true }],
  ]);
  assert.equal(calls.filter(call => call.path === "/online/context").length, submissions.length);
});

test("care client rejects mismatched identity, stale versions, private errors and unknown write results without retry", async () => {
  await assert.rejects(createCareApi("/api", async () => Response.json({ revisions: [{ ...profile, childId: "another-child" }], nextBeforeVersion: null })).profileHistory("child-1", null, signal()), CareApiError);
  await assert.rejects(createCareApi("/api", async () => Response.json({ profile: { ...profile, childId: "another-child" } })).getProfile("child-1", signal()), CareApiError);
  await assert.rejects(createCareApi("/api", onlineResult({ record: { ...record, version: 1 } })).revise("child-1", record.id, values, 1, "修正", signal(), "alice"), CareApiError);
  await assert.rejects(createCareApi("/api", onlineResult({ profile: { ...profile, version: 2, data: profileData } })).deleteProfile("child-1", 1, signal(), "alice"), CareApiError);
  for (const status of [400, 401, 404, 409, 500]) {
    let calls = 0;
    await assert.rejects(createCareApi("/api", async () => { calls++; return new Response("PRIVATE", { status }); }).create("child-1", values, signal(), "alice"), error => error instanceof CareApiError && error.status === status && !error.message.includes("PRIVATE"));
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(createCareApi("/api", async () => { calls++; throw new Error("PRIVATE NETWORK DETAIL"); }).create("child-1", values, signal(), "alice"), error => error instanceof CareApiError && error.status === 0 && !error.message.includes("PRIVATE"));
  assert.equal(calls, 1);
});

test("care reconciliation maps an epoch conflict without discarding the unknown operation", async () => {
  const api = createCareApi("/api", async input => {
    if (String(input).endsWith("/online/context")) return Response.json(context);
    if (String(input).endsWith("/online/submit")) throw new Error("unknown network outcome");
    if (String(input).includes("/online/operations/")) return Response.json({ error: { code: "storage_epoch_changed", message: "private" } }, { status: 409 });
    throw new Error("Unexpected route");
  });
  await assert.rejects(api.create("child-1", values, signal(), "alice"), error =>
    error instanceof CareApiError && error.status === 0 && error.onlineCode === null);
  assert.equal(api.hasPendingOnline?.(), true);
  await assert.rejects(api.reconcilePending!(signal(), "alice"), error =>
    error instanceof CareApiError && error.status === 409 && error.onlineCode === "storage_epoch_changed"
      && !error.confirmed && !error.message.includes("private"));
  assert.equal(api.hasPendingOnline?.(), true);
  api.resetOnline?.();
  assert.equal(api.hasPendingOnline?.(), false);
});

test("care search carries change sequence into the next page and exposes only cursor_stale", async () => {
  const cursor = { createdAt: record.createdAt, id: record.id, changeSeq: "7" };
  let calls = 0;
  const api = createCareApi("/api", async (input, init) => {
    assert.equal(String(input), "/api/children/child-1/care/search");
    const body = JSON.parse(String(init?.body));
    calls += 1;
    if (calls === 1) {
      assert.deepEqual(body, { query: "飲奶" });
      return Response.json({ records: [], nextCursor: cursor, scanned: 200, limit: 50 });
    }
    assert.deepEqual(body, { query: "飲奶", cursor });
    return Response.json({ error: { code: "cursor_stale", message: "private detail" } }, { status: 409 });
  });
  const first = await api.search("child-1", { query: "飲奶" }, signal(), "alice");
  assert.deepEqual(first.nextCursor, cursor);
  await assert.rejects(api.search("child-1", { query: "飲奶", cursor: first.nextCursor! }, signal(), "alice"), error =>
    error instanceof CareApiError && error.status === 409 && error.onlineCode === "cursor_stale"
      && !error.message.includes("private"));
  assert.equal(calls, 2);
});
