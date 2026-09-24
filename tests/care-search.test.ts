import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { createCareStore } from "../server/care.ts";
import { createStorageCipher } from "../server/storage-crypto.ts";

const cipher = createStorageCipher(Buffer.alloc(32, 7));
const childId = "f5aad9ca-7cda-4c06-9398-a0e01b09e690";
function fixture(total: number, match: boolean) {
  const rows = Array.from({ length: total }, (_, index) => {
    const id = `15eb043b-d7a9-4b1c-afc1-${index.toString().padStart(12, "0")}`;
    return { id, child_id: childId, author_user_id: "owner", created_at: new Date("2026-09-01T00:00:00.123Z"), cursor_created_at: "2026-09-01T00:00:00.123456Z",
      version: 1, details_encrypted: null, confirmed_by: null, confirmed_at: null,
      text_encrypted: cipher.encrypt(match ? `目標 ${index}` : "不相關", `text_records:${id}:${childId}:owner:text`) };
  });
  const client = { release() {}, async query(sql: string) {
    if (sql.startsWith("SELECT owner_user_id")) return { rows: [{ owner_user_id: "owner", access_version: 1 }] };
    if (sql.startsWith("SELECT 1 FROM children")) return { rows: [{}], rowCount: 1 };
    if (sql.startsWith("SELECT profile_version")) return { rows: [{ profile_version: 0 }] };
    if (sql.startsWith("SELECT *,to_char")) return { rows };
    return { rows: [], rowCount: 0 };
  } };
  const pool = { connect: async () => client, query: async () => ({ rows: [{ workspace_id: "family" }] }) } as unknown as Pool;
  return { store: createCareStore(pool, cipher), rows };
}
test("an empty bounded encrypted search continues from the last scanned row", async () => {
  const { store, rows } = fixture(201, false);
  const page = await store.search("owner", childId, { query: "目標" });
  assert.equal(page?.records.length, 0); assert.equal(page?.scanned, 200);
  assert.deepEqual(page?.nextCursor, { id: rows[199].id, createdAt: rows[199].cursor_created_at });
});
test("filled search pages preserve microseconds and do not skip the fetched remainder", async () => {
  const { store, rows } = fixture(52, true);
  const page = await store.search("owner", childId, { query: "目標" });
  assert.equal(page?.records.length, 50); assert.equal(page?.scanned, 50);
  assert.equal(page?.nextCursor?.id, rows[49].id); assert.equal(page?.nextCursor?.createdAt, "2026-09-01T00:00:00.123456Z");
});
test("exhausted search pages expose no continuation", async () => {
  const { store } = fixture(2, true);
  const page = await store.search("owner", childId, { query: "目標" });
  assert.equal(page?.records.length, 2); assert.equal(page?.nextCursor, null);
});
