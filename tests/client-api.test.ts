import assert from "node:assert/strict";
import test from "node:test";
import { ClientApiError, createRecordsApi } from "../src/client/records-api.ts";

const signal = () => new AbortController().signal;
const childId = "669fc3c0-1734-42c9-b541-3b7f55f584e1";
const record = { id: "record-1", childId, authorUserId: "alice", text: "  昨晚大約八點，飲咗約 120 ml 奶。\n  ", createdAt: "2026-09-22T01:00:00.000Z" };

test("client transport sends exact text with the cookie session and reads the configured API", async () => {
  let calls = 0;
  const api = createRecordsApi("http://localhost:3001", async (input, init) => {
    calls += 1;
    assert.equal(input, `http://localhost:3001/api/children/${childId}/records`);
    assert.equal(init?.credentials, "include");
    assert.equal(init?.cache, "no-store");
    assert.equal(new Headers(init?.headers).get("x-expected-user-id"), "alice");
    assert.equal(init?.method, "POST");
    assert.deepEqual(JSON.parse(init?.body as string), { text: record.text });
    return Response.json({ record }, { status: 201 });
  });
  assert.deepEqual(await api.createRecord(childId, record.text, signal(), "alice"), record);
  assert.equal(calls, 1);
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
  const api = createRecordsApi("/api", async () => Response.json({ record: { ...record, text: record.text.trim() } }));
  await assert.rejects(api.createRecord(childId, record.text, signal(), "alice"), error => error instanceof ClientApiError && error.status === 0);
});
