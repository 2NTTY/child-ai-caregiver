import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { createStorageCipher } from "../server/storage-crypto.ts";
const cipher = createStorageCipher(Buffer.alloc(32, 7));
import { handleRecordRequest } from "../server/record-api.ts";
import { createRecordStore } from "../server/records.ts";
import type { RecordStore } from "../server/records.ts";
import type { Child, TextRecord } from "../src/shared/records.ts";

const child: Child = {
  id: "79081f55-9e30-4ee5-91fb-71982b20d6f7",
  workspaceId: "5980663d-3bea-46fa-b63d-42d937026710",
  displayName: "小豆",
  createdAt: "2026-09-22T00:00:00.000Z",
};
const otherChildId = "38a8f579-e4d6-4eb4-a645-b8f3851bb0d9";
const record: TextRecord = {
  id: "2e5e3f13-44de-43cd-897a-82f96f29b514",
  childId: child.id,
  authorUserId: "owner",
  text: "  大約 3 點飲咗約 80 ml 奶。\n精神唔錯。🙂  ",
  createdAt: "2026-09-22T01:02:03.456Z",
};

function request(path: string, body?: unknown): Request {
  return new Request(`http://localhost${path}`, body === undefined ? undefined : {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8", "x-expected-user-id": "owner" },
    body: JSON.stringify(body),
  });
}

function unusedStore(): RecordStore {
  return new Proxy({} as RecordStore, { get() { throw new Error("Storage must not be accessed"); } });
}

function storeWith(overrides: Partial<RecordStore> = {}): RecordStore {
  return {
    deleteChildForUser: async () => { throw new Error("Unexpected deletion"); },
    listChildrenForUser: async (userId) => userId === "owner" ? [child] : [],
    getChildForUser: async (userId, childId) => userId === "owner" && childId === child.id ? child : null,
    createChildForUser: async () => { throw new Error("Child write must not be called"); },
    listRecordsForUser: async (userId, childId) => userId === "owner" && childId === child.id ? { records: [record], limit: 100 } : null,
    createRecordForUser: async () => { throw new Error("Record write must not be called"); },
    ...overrides,
  };
}

test("record API rejects absent sessions before accessing storage or input", async () => {
  for (const req of [request("/api/children"), request("/api/children", { displayName: "小豆" }), request(`/api/children/${child.id}/records`, { text: record.text })]) {
    const response = await handleRecordRequest(req, null, unusedStore());
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: { code: "unauthorized", message: "請先登入。" } });
  }
});

test("child lists are scoped to the session and disable response caching", async () => {
  const response = await handleRecordRequest(request("/api/children?ownerUserId=other"), "owner", storeWith());
  assert.deepEqual(await response.json(), { children: [child] });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  const other = await handleRecordRequest(request("/api/children?ownerUserId=owner"), "other", storeWith());
  assert.deepEqual(await other.json(), { children: [] });
});

test("writes reject a changed or absent expected account before any storage access", async () => {
  for (const path of ["/api/children", `/api/children/${child.id}/records`]) {
    const changed = await handleRecordRequest(request(path, { displayName: "原帳號草稿", text: record.text }), "new-account", unusedStore());
    assert.equal(changed.status, 409);
    assert.equal((await changed.json()).error.code, "session_changed");
    const absent = new Request(`http://localhost${path}`, { method: "POST", body: "{}" });
    assert.equal((await handleRecordRequest(absent, "owner", unusedStore())).status, 428);
  }
});

test("child creation validates the name and ignores client ownership and timestamps", async () => {
  let writes = 0;
  const store = storeWith({
    createChildForUser: async (userId, input) => {
      writes++;
      assert.equal(userId, "owner");
      assert.deepEqual(input, { displayName: "小豆" });
      return child;
    },
  });
  const response = await handleRecordRequest(request("/api/children", {
    displayName: "  小豆  ", ownerUserId: "other", workspaceId: "forged", id: "forged", createdAt: "1900-01-01",
  }), "owner", store);
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { child });
  assert.equal(writes, 1);
});

test("invalid child input returns fixed issues without echoing submitted data", async () => {
  const secret = "private-value-".repeat(10);
  const response = await handleRecordRequest(request("/api/children", { displayName: secret }), "owner", unusedStore());
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.deepEqual(body, { error: {
    code: "invalid_input", message: "請檢查輸入資料。",
    issues: [{ field: "displayName", code: "too_long", message: "孩子的稱呼不可超過 80 個字。" }],
  } });
  assert.ok(!JSON.stringify(body).includes(secret));
});

test("record API rejects malformed JSON, wrong content types and non-object input", async () => {
  for (const [body, contentType, expectedStatus, expectedCode] of [
    ["{", "application/json", 400, "invalid_json"],
    ['{"displayName":"小豆"}', "text/plain", 415, "unsupported_media_type"],
    ["null", "application/json", 400, "invalid_input"],
    ["[]", "application/json", 400, "invalid_input"],
  ] as const) {
    const req = new Request("http://localhost/api/children", { method: "POST", headers: { "content-type": contentType, "x-expected-user-id": "owner" }, body });
    const response = await handleRecordRequest(req, "owner", unusedStore());
    assert.equal(response.status, expectedStatus);
    assert.equal((await response.json()).error.code, expectedCode);
  }
});

test("record reads distinguish an empty owned child from unavailable children", async () => {
  const owned = await handleRecordRequest(request(`/api/children/${child.id}/records`), "owner", storeWith());
  assert.deepEqual(await owned.json(), { records: [record], limit: 100 });
  const empty = await handleRecordRequest(request(`/api/children/${child.id}/records`), "owner", storeWith({ listRecordsForUser: async () => ({ records: [], limit: 100 }) }));
  assert.equal(empty.status, 200);
  assert.deepEqual(await empty.json(), { records: [], limit: 100 });

  const denied = await handleRecordRequest(request(`/api/children/${child.id}/records`), "other", storeWith());
  const missing = await handleRecordRequest(request(`/api/children/${otherChildId}/records`), "owner", storeWith());
  assert.equal(denied.status, 404);
  assert.equal(missing.status, 404);
  assert.deepEqual(await denied.json(), await missing.json());
});

test("unavailable children cannot receive records even with invalid request bodies", async () => {
  for (const [userId, childId] of [["other", child.id], ["owner", otherChildId]]) {
    const req = new Request(`http://localhost/api/children/${childId}/records`, { method: "POST", headers: { "x-expected-user-id": userId }, body: "{" });
    const response = await handleRecordRequest(req, userId, storeWith());
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: { code: "not_found", message: "找不到資料。" } });
  }
});

test("record creation preserves raw text and uses only route child and session author", async () => {
  let writes = 0;
  const store = storeWith({
    createRecordForUser: async (userId, input) => {
      writes++;
      assert.equal(userId, "owner");
      assert.deepEqual(input, { childId: child.id, text: record.text });
      return record;
    },
  });
  const response = await handleRecordRequest(request(`/api/children/${child.id}/records`, {
    text: record.text, childId: otherChildId, authorUserId: "other", createdAt: "1900-01-01", id: "forged",
  }), "owner", store);
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { record });
  assert.equal(writes, 1);
});

test("record creation does not claim success if storage no longer permits the write", async () => {
  const response = await handleRecordRequest(request(`/api/children/${child.id}/records`, { text: record.text }), "owner", storeWith({ createRecordForUser: async () => null }));
  assert.equal(response.status, 404);
});

test("record input validation does not echo sensitive text or write rejected input", async () => {
  for (const value of [{ text: "  \n\t " }, { text: "private".repeat(1500) }, { text: 0 }, null, []]) {
    const response = await handleRecordRequest(request(`/api/children/${child.id}/records`, value), "owner", storeWith());
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error.code, "invalid_input");
    assert.ok(body.error.issues.length > 0);
    assert.ok(!JSON.stringify(body).includes("private"));
  }
});

test("text that PostgreSQL cannot preserve is rejected before writing", async () => {
  for (const value of ["before\u0000after", "before\ud800after", "before\udfffafter"]) {
    const childResponse = await handleRecordRequest(request("/api/children", { displayName: value }), "owner", unusedStore());
    assert.equal(childResponse.status, 400);
    assert.equal((await childResponse.json()).error.code, "invalid_input");
    const recordResponse = await handleRecordRequest(request(`/api/children/${child.id}/records`, { text: value }), "owner", storeWith());
    assert.equal(recordResponse.status, 400);
    assert.equal((await recordResponse.json()).error.code, "invalid_input");
  }
});

test("record routes reject malformed identifiers, extra path segments and unsupported methods", async () => {
  for (const path of ["/api/children/not-an-id/records", `/api/children/${child.id}/records/extra`, `/api/children/${child.id}`, "/api/children-extra"]) {
    assert.equal((await handleRecordRequest(request(path), "owner", unusedStore())).status, 404);
  }
  for (const path of ["/api/children", `/api/children/${child.id}/records`]) {
    const req = new Request(`http://localhost${path}`, { method: "DELETE" });
    assert.equal((await handleRecordRequest(req, "owner", unusedStore())).status, 405);
  }
});

test("record storage maps an empty owned child separately from an unavailable child", async () => {
  let accessible = true;
  let rows: unknown[] = [];
  const pool = {
    query: async () => ({ rows: accessible ? [{ workspace_id: child.workspaceId }] : [] }),
    connect: async () => ({
      query: async (sql: string) => {
        if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
        if (sql.includes("FROM workspaces WHERE id=$1 FOR SHARE")) return { rows: [{ owner_user_id: "owner", access_version: 1 }] };
        if (sql.includes("SELECT 1 FROM children")) return { rowCount: accessible ? 1 : 0, rows: [] };
        if (sql.includes("FROM text_records")) return { rows };
        throw new Error(`Unexpected SQL: ${sql}`);
      },
      release: () => undefined,
    }),
  } as unknown as Pool;
  const store = createRecordStore(pool, cipher);
  assert.deepEqual(await store.listRecordsForUser("owner", child.id), { records: [], limit: 100 });
  accessible = false;
  assert.equal(await store.listRecordsForUser("other", child.id), null);
  accessible = true;
  rows = [{ id: record.id, child_id: record.childId, author_user_id: record.authorUserId, text: cipher.encrypt(record.text, `text_records:${record.id}:${record.childId}:${record.authorUserId}:text`), created_at: new Date(record.createdAt) }];
  assert.deepEqual(await store.listRecordsForUser("owner", child.id), { records: [record], limit: 100 });
});

test("record storage encrypts SQL payloads and returns authenticated server values", async () => {
  const pool = {
    query: async () => ({ rows: [{ workspace_id: child.workspaceId }] }),
    connect: async () => ({
      query: async (sql: string, values: unknown[] = []) => {
        assert.ok(!sql.includes(record.text));
        assert.ok(!values.includes(record.text));
        if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
        if (sql.includes("FROM workspaces WHERE id=$1 FOR SHARE")) return { rows: [{ owner_user_id: "owner", access_version: 1 }] };
        if (sql.includes("SELECT 1 FROM children")) return { rowCount: 1, rows: [] };
        if (sql.includes("INSERT INTO text_records")) {
          assert.equal(cipher.decrypt(values[3] as string, `text_records:${values[0]}:${child.id}:owner:text`), record.text);
          assert.ok(values.includes("owner"));
          assert.ok(values.includes(child.id));
          return { rows: [{ id: record.id, child_id: record.childId, author_user_id: record.authorUserId, text: cipher.encrypt(record.text, `text_records:${record.id}:${record.childId}:${record.authorUserId}:text`), created_at: new Date(record.createdAt) }] };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      },
      release: () => undefined,
    }),
  } as unknown as Pool;
  const stored = await createRecordStore(pool, cipher).createRecordForUser("owner", { childId: child.id, text: record.text });
  assert.deepEqual(stored, record);
});

test("storage failures propagate without retrying a potentially committed record", async () => {
  let attempts = 0;
  const failure = new Error("Synthetic database failure");
  const pool = {
    query: async () => ({ rows: [{ workspace_id: child.workspaceId }] }),
    connect: async () => ({
      query: async (sql: string) => {
        if (sql === "BEGIN" || sql === "ROLLBACK") return { rows: [] };
        if (sql.includes("FROM workspaces WHERE id=$1 FOR SHARE")) return { rows: [{ owner_user_id: "owner", access_version: 1 }] };
        if (sql.includes("SELECT 1 FROM children")) return { rowCount: 1, rows: [] };
        if (sql.includes("INSERT INTO text_records")) { attempts++; throw failure; }
        throw new Error(`Unexpected SQL: ${sql}`);
      },
      release: () => undefined,
    }),
  } as unknown as Pool;
  const store = createRecordStore(pool, cipher);
  await assert.rejects(store.createRecordForUser("owner", { childId: child.id, text: record.text }), (error: unknown) => error === failure);
  assert.equal(attempts, 1);
});


test("child deletion requires the current account and exact confirmation before an owned delete", async () => {
  let deletions = 0;
  const store = storeWith({ deleteChildForUser: async (userId, childId) => {
    if (userId !== "owner" || childId !== child.id) return false;
    deletions++;
    return true;
  } });
  const path = `/api/children/${child.id}/delete`;
  assert.equal((await handleRecordRequest(request(path, { confirmChildId: child.id }), null, store)).status, 401);
  assert.equal((await handleRecordRequest(request(path, { confirmChildId: otherChildId }), "owner", store)).status, 400);
  assert.equal((await handleRecordRequest(request(path, { confirmChildId: child.id, extra: true }), "owner", store)).status, 400);
  assert.equal((await handleRecordRequest(request(path, { confirmChildId: child.id }), "other", store)).status, 409);
  assert.equal(deletions, 0);
  const response = await handleRecordRequest(request(path, { confirmChildId: child.id }), "owner", store);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { deleted: true, childId: child.id });
  assert.equal(deletions, 1);
});
