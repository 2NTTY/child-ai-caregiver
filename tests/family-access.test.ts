import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { FamilyError, READ_ROLES, WRITE_ROLES, withWorkspaceAccess } from "../server/family-access.ts";

test("membership is checked after the workspace lock and viewer cannot write", async () => {
  const calls: string[] = [];
  let role = "caregiver", executions = 0;
  const client = { release() { calls.push("release"); }, async query(sql: string) {
    calls.push(sql);
    if (sql.includes("FOR SHARE")) { role = "viewer"; return { rows: [{ owner_user_id: "owner", access_version: 2 }] }; }
    if (sql.includes("FROM family_members")) return { rows: [{ role }] };
    return { rows: [] };
  } };
  const pool = { connect: async () => client } as unknown as Pool;
  await assert.rejects(withWorkspaceAccess(pool, "member", "workspace", WRITE_ROLES, async () => { executions++; }),
    error => error instanceof FamilyError && error.status === 404);
  assert.equal(executions, 0);
  assert.ok(calls.indexOf("BEGIN") < calls.findIndex(sql => sql.includes("FOR SHARE")));
  assert.ok(calls.findIndex(sql => sql.includes("FOR SHARE")) < calls.findIndex(sql => sql.includes("FROM family_members")));
  assert.deepEqual(calls.slice(-2), ["ROLLBACK", "release"]);
  const result = await withWorkspaceAccess(pool, "member", "workspace", READ_ROLES, async (_client, currentRole) => currentRole);
  assert.equal(result, "viewer");
  assert.deepEqual(calls.slice(-2), ["COMMIT", "release"]);
});

test("a revoked member is rejected and owner management takes an exclusive lock", async () => {
  const calls: string[] = [];
  const client = { release() {}, async query(sql: string) {
    calls.push(sql);
    return { rows: sql.includes("FROM workspaces") ? [{ owner_user_id: "owner", access_version: 3 }] : [] };
  } };
  const pool = { connect: async () => client } as unknown as Pool;
  await assert.rejects(withWorkspaceAccess(pool, "revoked", "workspace", READ_ROLES, async () => "leak"), FamilyError);
  assert.equal(await withWorkspaceAccess(pool, "owner", "workspace", ["owner"], async (_client, role) => role, true), "owner");
  assert.ok(calls.some(sql => sql.endsWith("FOR UPDATE")));
});
