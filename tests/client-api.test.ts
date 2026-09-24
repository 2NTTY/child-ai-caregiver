import assert from "node:assert/strict";
import test from "node:test";
import { ClientApiError, createRecordsApi } from "../src/client/records-api.ts";

const signal = () => new AbortController().signal;
const childId = "669fc3c0-1734-42c9-b541-3b7f55f584e1";
const context = { workspaceId: "5980663d-3bea-46fa-b63d-42d937026710", storageEpoch: "79081f55-9e30-4ee5-91fb-71982b20d6f7" };
const record = { id: "record-1", childId, authorUserId: "alice", text: "  昨晚大約八點，飲咗約 120 ml 奶。\n  ", createdAt: "2026-09-22T01:00:00.000Z" };

test("client transport sends exact text with the cookie session and reads the configured API", async () => {
  let calls = 0;
  const api = createRecordsApi("http://localhost:3001", async (input, init) => {
    calls += 1;
    assert.ok(["http://localhost:3001/api/online/context", "http://localhost:3001/api/online/submit"].includes(String(input)));
    assert.equal(init?.credentials, "include");
    assert.equal(init?.cache, "no-store");
    assert.equal(new Headers(init?.headers).get("x-expected-user-id"), "alice");
    assert.equal(init?.method, "POST");
    const body = JSON.parse(init?.body as string);
    if (String(input).endsWith("/context")) {
      assert.deepEqual(body, { path: `/api/children/${childId}/records`, payload: { text: record.text } });
      return Response.json(context);
    }
    assert.equal(body.path, `/api/children/${childId}/records`);
    assert.deepEqual(body.payload, { text: record.text });
    return Response.json({ state: "confirmed", operation: body.operation, changeSeq: "1", statusCode: 201, result: { record } });
  });
  assert.deepEqual(await api.createRecord(childId, record.text, signal(), "alice"), record);
  assert.equal(calls, 2);
});

test("client session result excludes credential fields and handles signed-out sessions", async () => {
  const user = { id: "alice", name: "測試者", email: "alice@example.test", privateField: "unused" };
  const api = createRecordsApi("/api", async () => Response.json({ user, session: { token: "never-store-this" }, token: "unused" }));
  assert.deepEqual(await api.getSession(signal()), { id: user.id, name: user.name, email: user.email });
  assert.equal(await createRecordsApi("/api", async () => Response.json(null)).getSession(signal()), null);
});

test("client errors never expose remote bodies or fetch exception details", async () => {
  for (const status of [401, 422, 429, 500]) {
    const api = createRecordsApi("/api", async () => new Response("PRIVATE SERVER DETAIL", { status }));
    await assert.rejects(api.listChildren(signal()), error => error instanceof ClientApiError
      && error.status === status && !error.message.includes("PRIVATE"));
  }
  const api = createRecordsApi("/api", async () => { throw new Error("PRIVATE NETWORK DETAIL"); });
  await assert.rejects(api.listChildren(signal()), error => error instanceof ClientApiError && error.status === 0 && !error.message.includes("PRIVATE"));
});

test("client refuses malformed success responses and records for another child", async () => {
  for (const value of ["unexpected", { records: [{ ...record, childId: "another-child" }], limit: 100 }, { records: [record], limit: 101 }]) {
    const api = createRecordsApi("/api", async () => Response.json(value));
    await assert.rejects(api.listRecords(childId, signal()), ClientApiError);
  }
  const api = createRecordsApi("/api", async (input, init) => {
    if (String(input).endsWith("/context")) return Response.json(context);
    const operation = JSON.parse(String(init?.body)).operation;
    return Response.json({ state: "confirmed", operation, changeSeq: "1", statusCode: 201,
      result: { record: { ...record, text: record.text.trim() } } });
  });
  await assert.rejects(api.createRecord(childId, record.text, signal(), "alice"), error => error instanceof ClientApiError && error.status === 0);
});

test("records transport keeps unknown work until a positive account change or sign out", async () => {
  let session: string | null = "alice";
  let unavailable = false;
  const api = createRecordsApi("/api", async (input, init) => {
    const path = String(input);
    if (path.endsWith("/auth/get-session")) return unavailable
      ? new Response("PRIVATE", { status: 503 })
      : Response.json(session === null ? null : { user: { id: session, name: "家長", email: "test@example.test" } });
    if (path.endsWith("/auth/sign-out")) return Response.json({ success: true });
    if (path.endsWith("/online/context")) return Response.json(context);
    if (path.endsWith("/online/submit")) throw new Error("network unknown");
    throw new Error(`Unexpected request ${String(init?.method)} ${path}`);
  });
  await api.getSession(signal());
  await assert.rejects(api.createChild("小豆", signal(), "alice"), ClientApiError);
  assert.equal(api.hasPendingOnline?.(), true);
  unavailable = true;
  await assert.rejects(api.getSession(signal()), ClientApiError);
  assert.equal(api.hasPendingOnline?.(), true);
  unavailable = false;
  session = null;
  assert.equal(await api.getSession(signal()), null);
  assert.equal(api.hasPendingOnline?.(), true);
  session = "bob";
  await api.getSession(signal());
  assert.equal(api.hasPendingOnline?.(), false);
  await assert.rejects(api.createChild("小豆", signal(), "bob"), ClientApiError);
  assert.equal(api.hasPendingOnline?.(), true);
  await api.signOut(signal());
  assert.equal(api.hasPendingOnline?.(), false);
});

test("a null session keeps the unknown operation for the same account to reconcile", async () => {
  let session: string | null = "alice";
  let contextCalls = 0;
  let lookupCalls = 0;
  const opIds: string[] = [];
  const child = { id: childId, workspaceId: context.workspaceId, displayName: "小豆", createdAt: "2026-09-24T00:00:00.000Z" };
  const api = createRecordsApi("/api", async (input, init) => {
    const path = String(input);
    if (path.endsWith("/auth/get-session")) return Response.json(session === null ? null
      : { user: { id: session, name: "家長", email: "test@example.test" } });
    if (path.endsWith("/online/context")) { contextCalls += 1; return Response.json(context); }
    if (path.includes("/online/operations/")) { lookupCalls += 1; return Response.json({ state: "unconfirmed" }); }
    if (path.endsWith("/online/submit")) {
      const operation = JSON.parse(String(init?.body)).operation;
      opIds.push(operation.opId);
      if (opIds.length === 1) throw new Error("unknown network outcome");
      return Response.json({ state: "confirmed", operation, changeSeq: "1", statusCode: 201, result: { child } });
    }
    throw new Error("Unexpected route");
  });
  await api.getSession(signal());
  await assert.rejects(api.createChild(child.displayName, signal(), "alice"), ClientApiError);
  session = null;
  assert.equal(await api.getSession(signal()), null);
  assert.equal(api.hasPendingOnline?.(), true);
  session = "alice";
  await api.getSession(signal());
  assert.deepEqual(await api.createChild(child.displayName, signal(), "alice"), child);
  assert.equal(contextCalls, 1);
  assert.equal(lookupCalls, 1);
  assert.equal(opIds.length, 2);
  assert.equal(opIds[0], opIds[1]);
  assert.equal(api.hasPendingOnline?.(), false);
});
