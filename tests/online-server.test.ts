import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { transactionPool } from "../server/transaction-pool.ts";
import { canonicalJson, onlineRoute, onlineSubmissionSchema } from "../server/online-routing.ts";
import { createOnlineStore } from "../server/online.ts";
import { handleOnlineRequest } from "../server/online-api.ts";
import { createStorageCipher } from "../server/storage-crypto.ts";
import type { OnlineReceipt } from "../src/shared/online.ts";

test("the online command boundary excludes models, read operations and caller-defined identity", () => {
  const id = randomUUID();
  for (const path of ["https://elsewhere/api/children", "/api/auth/sign-out", `/api/children/${id}/care/search`, `/api/children/${id}/messages/${id}/reply`]) {
    assert.throws(() => onlineRoute({ path, payload: {} }));
  }
  assert.deepEqual(onlineRoute({ path: `/api/children/${id}/messages`, payload: {} }).roles, ["owner", "caregiver", "viewer"]);
  assert.deepEqual(onlineRoute({ path: `/api/children/${id}/delete`, payload: {} }).roles, ["owner"]);
  const command = { path: "/api/children", payload: { displayName: "  原文\n" }, operation: { opId: id, deviceId: id, workspaceId: id, storageEpoch: id } };
  assert.equal(onlineSubmissionSchema.safeParse({ ...command, userId: "forged" }).success, false);
  assert.equal(canonicalJson({ b: [2, 1], a: "  原文\n" }), canonicalJson({ a: "  原文\n", b: [2, 1] }));
  assert.notEqual(canonicalJson({ text: "原文" }), canonicalJson({ text: " 原文" }));
});

test("borrowed store transactions cannot commit or release the outer connection", async () => {
  const calls: string[] = [];
  const client = { query: async (sql: string) => { calls.push(sql); return { rows: [] }; }, release() { throw new Error("Outer connection released"); } } as unknown as PoolClient;
  const adapter = transactionPool(client);
  const store = await adapter.pool.connect();
  await store.query("BEGIN"); await store.query("INSERT example"); await store.query("COMMIT"); store.release();
  adapter.assertReleased();
  assert.deepEqual(calls, ["SAVEPOINT online_store_1", "INSERT example", "RELEASE SAVEPOINT online_store_1"]);
  const second = await adapter.pool.connect(); await second.query("BEGIN");
  await assert.rejects(adapter.pool.connect(), /Overlapping/);
  await second.query("ROLLBACK"); second.release(); adapter.assertReleased();
  assert.deepEqual(calls.slice(-3), ["SAVEPOINT online_store_2", "ROLLBACK TO SAVEPOINT online_store_2", "RELEASE SAVEPOINT online_store_2"]);
  const third = await adapter.pool.connect(); await third.query("BEGIN"); third.release();
  assert.throws(adapter.assertReleased, /not closed/);
});

function fixture() {
  const user = "owner", workspaceId = randomUUID(), epoch = randomUUID(), opId = randomUUID(), deviceId = randomUUID(), childId = randomUUID();
  const cipher = createStorageCipher(Buffer.alloc(32, 19));
  const path = `/api/children/${childId}/care`;
  const command = { path, payload: { text: "私密內容" } };
  const identity = { workspaceId, storageEpoch: epoch, opId, deviceId };
  const ctx = (field: string) => `online-operation:${user}:${opId}:${field}`;
  let member: string | undefined, spaceOwner = user, redacted = false, childExists = true, changedEpoch = false;
  let fingerprint = "";
  const row = { user_id: user, op_id: opId, device_id: deviceId, workspace_id: workspaceId, storage_epoch: epoch,
    path, child_id: childId, kind: "care", owner_only: false, request_hash_encrypted: "", result_encrypted: cipher.encrypt(JSON.stringify({ record: { id: randomUUID(), text: "私密內容" } }), ctx("result")), status_code: 201, change_seq: "2" };
  const calls: string[] = [];
  const client = { release() {}, async query(sql: string, values?: unknown[]) {
    calls.push(sql);
    if (sql.includes("FROM online_operations")) return { rows: [{ ...row, request_hash_encrypted: cipher.encrypt(fingerprint, ctx("hash")), result_encrypted: redacted ? null : row.result_encrypted }], rowCount: 1 };
    if (sql.includes("FROM workspaces")) {
      if (sql.endsWith("FOR SHARE") && calls.filter(value => value.includes("FROM online_operations")).length === 1) redacted = true;
      return { rows: [{ id: workspaceId, owner_user_id: spaceOwner, storage_epoch: changedEpoch ? randomUUID() : epoch, access_version: 3, change_seq: "5" }], rowCount: 1 };
    }
    if (sql.includes("FROM family_members")) return { rows: member ? [{ role: member }] : [], rowCount: member ? 1 : 0 };
    if (sql.includes("FROM children")) return { rows: childExists ? [{ workspace_id: workspaceId }] : [], rowCount: childExists ? 1 : 0 };
    if (sql.includes("FROM online_changes")) {
      assert.deepEqual(values?.slice(3), [user, spaceOwner === user]);
      assert.match(sql, /private_user_id IS NULL OR private_user_id=\$4/);
      return { rows: [], rowCount: 0 };
    }
    return { rows: [], rowCount: 0 };
  } };
  return { store: createOnlineStore({ connect: async () => client } as unknown as Pool, cipher), user, identity, command, calls,
    setMember(value: string | undefined) { spaceOwner = "another-owner"; member = value; },
    setEpochChanged() { changedEpoch = true; }, setChildDeleted() { childExists = false; }, setFingerprint(value: string) { fingerprint = value; } };
}

test("receipt lookup rereads redaction after the workspace lock and rejects revoked membership", async () => {
  const f = fixture();
  const receipt = await f.store.lookup(f.user, f.identity.opId) as OnlineReceipt;
  assert.equal(receipt.state, "confirmed"); assert.equal(receipt.result, null);
  assert.equal(f.calls.filter(sql => sql.includes("FROM online_operations")).length, 2);
  f.setMember(undefined);
  await assert.rejects(f.store.lookup(f.user, f.identity.opId), { status: 404 });
  assert.equal(f.calls.at(-1), "ROLLBACK");
});

test("replayed writes reject changed payloads, role downgrade and stale storage epochs", async () => {
  const f = fixture();
  await assert.rejects(f.store.submit(f.user, { ...f.command, operation: f.identity }), { code: "operation_mismatch" });
  assert.ok(!f.calls.some(sql => sql.startsWith("INSERT")));
  f.setMember("viewer");
  await assert.rejects(f.store.submit(f.user, { ...f.command, operation: f.identity }), { status: 404 });
  f.setEpochChanged();
  await assert.rejects(f.store.submit(f.user, { ...f.command, operation: f.identity }), { code: "storage_epoch_changed" });
});

test("change cursors exclude private/owner events and reject future or wrong-epoch cursors", async () => {
  const f = fixture(); f.setMember("caregiver");
  const page = await f.store.changes(f.user, f.identity.workspaceId, f.identity.storageEpoch, "0");
  assert.equal(page.cursor, "5"); assert.deepEqual(page.changes, []);
  await assert.rejects(f.store.changes(f.user, f.identity.workspaceId, f.identity.storageEpoch, "6"), { code: "cursor_invalid" });
  await assert.rejects(f.store.changes(f.user, f.identity.workspaceId, randomUUID(), "0"), { code: "storage_epoch_changed" });
});

test("HTTP operation lookup requires the current session account even on GET", async () => {
  const f = fixture(); const url = `http://local/api/online/operations/${f.identity.opId}`;
  assert.equal((await handleOnlineRequest(new Request(url), null, f.store)).status, 401);
  assert.equal((await handleOnlineRequest(new Request(url), f.user, f.store)).status, 428);
  assert.equal((await handleOnlineRequest(new Request(url, { headers: { "x-expected-user-id": "another" } }), f.user, f.store)).status, 409);
  assert.equal(f.calls.length, 0);
});
