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

test("children pagination returns every page under the original UID and accepts the old terminal shape", async () => {
  const pages = Array.from({ length: 3 }, (_, page) => Array.from({ length: 50 }, (_, item) => ({
    id: `child-${page}-${item}`, workspaceId: context.workspaceId, displayName: `Child ${page}-${item}`, createdAt: "2026-10-11T00:00:00.000Z",
  })));
  const paths: string[] = [], cursor = "opaque+cursor/with?encoding=1";
  const api = createRecordsApi("/api", async (input, init) => {
    if (String(input).endsWith("/auth/get-session")) return Response.json({ user: { id: "alice", name: "Parent", email: "alice@example.invalid" } });
    assert.equal(new Headers(init?.headers).get("x-expected-user-id"), "alice");
    assert.equal(init?.credentials, "include"); assert.equal(init?.cache, "no-store");
    paths.push(String(input));
    return Response.json({ children: pages[paths.length - 1], nextCursor: paths.length === 1 ? cursor : paths.length === 2 ? "last-page" : null });
  });
  await api.getSession(signal());
  assert.deepEqual(await api.listChildren(signal()), pages.flat());
  assert.deepEqual(paths, ["/api/children", "/api/children?cursor=" + encodeURIComponent(cursor), "/api/children?cursor=last-page"]);
  assert.deepEqual(await createRecordsApi("/api", async () => Response.json({ children: pages[0] })).listChildren(signal()), pages[0]);
});

test("children pagination rejects malformed or repeated cursors, child IDs and later page failures", async () => {
  const child = { id: "child-one", workspaceId: context.workspaceId, displayName: "Child", createdAt: "2026-10-11T00:00:00.000Z" };
  for (const nextCursor of [false, 1, {}, "", "bad cursor", "bad\u0000cursor", "\ud800"]) {
    let calls = 0;
    const api = createRecordsApi("/api", async () => { calls++; return Response.json({ children: [child], nextCursor }); });
    await assert.rejects(api.listChildren(signal()), ClientApiError); assert.equal(calls, 1);
  }
  for (const secondPage of [{ children: [], nextCursor: "page-two" }, { children: [child], nextCursor: null },
    { children: [{ ...child, id: "child-two", createdAt: "invalid" }], nextCursor: null }]) {
    let calls = 0;
    const api = createRecordsApi("/api", async () => Response.json(++calls === 1 ? { children: [child], nextCursor: "page-two" } : secondPage));
    await assert.rejects(api.listChildren(signal()), ClientApiError); assert.equal(calls, 2);
  }
  const duplicate = createRecordsApi("/api", async () => Response.json({ children: [child, child], nextCursor: null }));
  await assert.rejects(duplicate.listChildren(signal()), ClientApiError);
  let calls = 0;
  const conflict = createRecordsApi("/api", async () => ++calls === 1 ? Response.json({ children: [child], nextCursor: "page-two" })
    : new Response("PRIVATE CURSOR DETAIL", { status: 409 }));
  await assert.rejects(conflict.listChildren(signal()), error => error instanceof ClientApiError && error.status === 409 && !error.message.includes("PRIVATE"));
  assert.equal(calls, 2);
});

test("children pagination discards the whole result on cancellation or a positively observed identity change", async () => {
  const child = { id: "child-one", workspaceId: context.workspaceId, displayName: "Child", createdAt: "2026-10-11T00:00:00.000Z" };
  const controller = new AbortController(); let calls = 0;
  const aborted = createRecordsApi("/api", async () => { calls++; controller.abort(); return Response.json({ children: [child], nextCursor: "page-two" }); });
  await assert.rejects(aborted.listChildren(controller.signal), ClientApiError); assert.equal(calls, 1);
  let uid = "alice", resolve!: (response: Response) => void, start!: () => void;
  const started = new Promise<void>(done => { start = done; });
  const api = createRecordsApi("/api", async (input, init) => {
    if (String(input).endsWith("/auth/get-session")) return Response.json({ user: { id: uid, name: "Parent", email: uid + "@example.invalid" } });
    assert.equal(new Headers(init?.headers).get("x-expected-user-id"), "alice");
    start(); return new Promise<Response>(done => { resolve = done; });
  });
  await api.getSession(signal());
  const pending = api.listChildren(signal()); await started;
  uid = "bob"; await api.getSession(signal());
  resolve(Response.json({ children: [child], nextCursor: null }));
  await assert.rejects(pending, ClientApiError);
});
