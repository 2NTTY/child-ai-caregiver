import assert from "node:assert/strict";
import test from "node:test";
import { createCareApi, CareApiError } from "../src/client/care-api.ts";
import { emptyCareDetails } from "../src/shared/care.ts";

const signal = () => new AbortController().signal;
const profileData = { age: { kind: "unknown" }, dueDate: null, gestationalWeeksRaw: null, region: null, language: null, allergies: null, specialNeeds: null, preferences: null, source: "家長描述", validUntil: null } as const;
const profile = { childId: "child-1", version: 1, data: profileData, confirmedBy: "alice", confirmedAt: "2026-09-24T00:00:00.000Z", reason: "首次確認" };
const values = { text: "昨晚約九點飲奶", details: { ...emptyCareDetails("feeding"), quantity: { rawValue: "約120", unit: "ml", precision: "approximate" as const }, eventTime: { rawText: "昨晚約九點", at: null, timeZone: "Asia/Hong_Kong", precision: "approximate" as const } }, source: "家長描述" };
const record = { ...values, version: 1, confirmedBy: "alice", confirmedAt: "2026-09-24T00:00:00.000Z", reason: "首次確認", id: "record-1", childId: "child-1", authorUserId: "alice", createdAt: "2026-09-24T00:00:00.000Z" };

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
    if (path === "/auth/get-session") return Response.json({ user: { id: "alice" } });
    if (path.endsWith("/profile/history?beforeVersion=1")) return Response.json({ revisions: [profile], nextBeforeVersion: null });
    if (path.endsWith("/profile/delete")) return Response.json({ profile: { ...profile, version: 2, data: null } });
    if (path.endsWith("/profile")) return Response.json({ profile: method === "POST" ? { ...profile, version: 2 } : profile });
    if (path.endsWith("/care/search")) return Response.json({ records: [], nextCursor: { createdAt: record.createdAt, id: record.id }, scanned: 200, limit: 50 });
    if (path.endsWith("/care/record-1/history?beforeVersion=1")) return Response.json({ revisions: [record], nextBeforeVersion: null });
    if (path.endsWith("/care/record-1/delete")) return Response.json({ deleted: true });
    if (path.endsWith("/care/record-1/revise")) return Response.json({ record: { ...record, version: 2 } });
    if (path.endsWith("/care")) return Response.json({ record });
    throw new Error(`Unexpected route ${path}`);
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
  assert.deepEqual(calls.map(({ path, method }) => [path, method]), [
    ["/auth/get-session", "GET"], ["/children/child-1/profile", "GET"], ["/children/child-1/profile", "POST"],
    ["/children/child-1/profile/history?beforeVersion=1", "GET"], ["/children/child-1/profile/delete", "POST"],
    ["/children/child-1/care/search", "POST"], ["/children/child-1/care", "POST"],
    ["/children/child-1/care/record-1/revise", "POST"], ["/children/child-1/care/record-1/history?beforeVersion=1", "GET"],
    ["/children/child-1/care/record-1/delete", "POST"],
  ]);
  assert.deepEqual(calls[2]?.body, { data: profileData, expectedVersion: 1, reason: "補充來源", confirmShared: true });
  assert.deepEqual(calls[4]?.body, { expectedVersion: 1, confirmDelete: true });
  assert.deepEqual(calls[5]?.body, { query: "飲奶", kind: "feeding", cursor: { createdAt: record.createdAt, id: record.id } });
  assert.deepEqual(calls[6]?.body, { ...values, confirmShared: true });
  assert.deepEqual(calls[7]?.body, { ...values, expectedVersion: 1, reason: "修正", confirmShared: true });
  assert.deepEqual(calls[9]?.body, { expectedVersion: 1, confirmDelete: true });
});

test("care client rejects mismatched identity, stale versions, private errors and unknown write results without retry", async () => {
  await assert.rejects(createCareApi("/api", async () => Response.json({ revisions: [{ ...profile, childId: "another-child" }], nextBeforeVersion: null })).profileHistory("child-1", null, signal()), CareApiError);
  await assert.rejects(createCareApi("/api", async () => Response.json({ profile: { ...profile, childId: "another-child" } })).getProfile("child-1", signal()), CareApiError);
  await assert.rejects(createCareApi("/api", async () => Response.json({ record: { ...record, version: 1 } })).revise("child-1", record.id, values, 1, "修正", signal(), "alice"), CareApiError);
  await assert.rejects(createCareApi("/api", async () => Response.json({ profile: { ...profile, version: 2, data: profileData } })).deleteProfile("child-1", 1, signal(), "alice"), CareApiError);
  for (const status of [400, 401, 404, 409, 500]) {
    let calls = 0;
    await assert.rejects(createCareApi("/api", async () => { calls++; return new Response("PRIVATE", { status }); }).create("child-1", values, signal(), "alice"), error => error instanceof CareApiError && error.status === status && !error.message.includes("PRIVATE"));
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(createCareApi("/api", async () => { calls++; throw new Error("PRIVATE NETWORK DETAIL"); }).create("child-1", values, signal(), "alice"), error => error instanceof CareApiError && error.status === 0 && !error.message.includes("PRIVATE"));
  assert.equal(calls, 1);
});
