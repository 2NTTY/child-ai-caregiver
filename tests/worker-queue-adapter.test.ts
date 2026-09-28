import assert from "node:assert/strict";
import test from "node:test";
import type { PoolClient } from "pg";
import { databaseAdapter } from "../server/worker-queue.ts";

test("queue adapter preserves query arguments and single-statement rows", async () => {
  const values = ["reference"], rows = [{ id: "job" }];
  const client = { async query(text: string, parameters: unknown[]) {
    assert.equal(text, "SELECT $1"); assert.equal(parameters, values); return { rows };
  } } as unknown as PoolClient;
  assert.deepEqual(await databaseAdapter(client).executeSql("SELECT $1", values), { rows });
});

test("queue adapter returns supervisor rows from a multi-statement transaction", async () => {
  const client = { async query() {
    return [{ rows: [] }, { rows: [] }, { rows: [{ readyCount: 1 }] }, { rows: [] }];
  } } as unknown as PoolClient;
  assert.deepEqual(await databaseAdapter(client).executeSql("BEGIN; SELECT 1; COMMIT"), { rows: [{ readyCount: 1 }] });
});

test("queue adapter propagates database failure without manufacturing success", async () => {
  const failure = new Error("synthetic database failure");
  const client = { async query() { throw failure; } } as unknown as PoolClient;
  await assert.rejects(databaseAdapter(client).executeSql("SELECT 1"), error => error === failure);
});
