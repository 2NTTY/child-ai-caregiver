import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { FamilyError } from "../server/family-access.ts";
import { createProductAgentStore } from "../server/product-agent-store.ts";
import { createStorageCipher } from "../server/storage-crypto.ts";
import { createProductAgentApi, ProductAgentApiError } from "../src/client/product-agent-api.ts";
import { agentPendingPageSchema } from "../src/shared/product-agent.ts";

const userId = "synthetic-viewer", childId = "1ebcb39d-a2db-4b8c-a432-7ffcb3de5808";
const otherChildId = "b2a1b662-d13d-476b-bf52-40a28aa1a1a7", runId = "d4a1b662-d13d-476b-bf52-40a28aa1a1a7";
const cipher = createStorageCipher(Buffer.alloc(32, 7));
const value = { kind: "memory_fact" as const, key: "synthetic-fact", content: "Synthetic pending fact", intendedVisibility: "private" as const, validUntil: null };
function row(index: number, owner = userId, child = childId) {
  const id = `7de5a0e8-e106-4485-b7d2-${index.toString(16).padStart(12, "0")}`;
  const created = `2026-10-06T00:00:00.${Math.max(1, index - 1).toString().padStart(6, "0")}Z`;
  return { id, run_id: runId, call_id: `synthetic-${index}`, version: 1, state: "pending",
    child_id: child, owner_user_id: owner, cursor_created_at: created,
    created_at: new Date(created), expires_at: new Date("2099-01-01T00:00:00Z"), is_expired: false,
    payload_encrypted: cipher.encrypt(JSON.stringify({ value, result: null, targetLabel: null }),
      `agent-run:${child}:${owner}:${runId}:proposal:${id}:1`) };
}
function fixture(rows: ReturnType<typeof row>[]) {
  const queries: { sql: string; args: unknown[] }[] = [];
  let authorizationVersion = "1", updates = 0;
  const result = (items: unknown[] = []) => ({ rows: items, rowCount: items.length });
  const run = { id: runId, child_id: childId, owner_user_id: userId, authorization_version: "1", data_version: "epoch:1", source_message_id: null };
  const client = { release() {}, async query(sql: string, args: unknown[] = []) {
    queries.push({ sql, args });
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK" || sql.startsWith("SET LOCAL")) return result();
    if (sql.includes("FROM workspaces") && /FOR (SHARE|UPDATE)$/.test(sql)) return result([{ owner_user_id: "synthetic-owner", access_version: Number(authorizationVersion) }]);
    if (sql.includes("FROM family_members")) return result([{ role: "viewer" }]);
    if (sql.startsWith("SELECT 1 FROM children")) return result([{}]);
    if (sql.includes("JOIN agent_runs r")) {
      assert.match(sql, /r\.owner_user_id=\$1 AND r\.child_id=\$2/);
      assert.match(sql, /p\.state IN \('pending','expired'\)/);
      assert.match(sql, /ORDER BY p\.created_at DESC,p\.id DESC LIMIT 21/);
      assert.match(sql, /\(p\.created_at,p\.id\)<\(\$3::timestamptz,\$4::uuid\)/);
      const [owner, child, created, id] = args;
      return result(rows.filter(item => item.owner_user_id === owner && item.child_id === child
        && (item.state === "pending" || item.state === "expired")
        && (created === null || item.cursor_created_at < String(created)
          || item.cursor_created_at === created && item.id < String(id)))
        .sort((a, b) => b.cursor_created_at.localeCompare(a.cursor_created_at) || b.id.localeCompare(a.id)).slice(0, 21));
    }
    if (sql.includes("FROM agent_runs")) {
      assert.deepEqual(args, [runId, userId, childId]);
      return result([run]);
    }
    if (sql.includes("FROM agent_proposals") && sql.includes("FOR UPDATE")) return result(rows.filter(item => item.id === args[0] && item.run_id === args[1]));
    if (sql.startsWith("SELECT access_version::text")) return result([{ access_version: authorizationVersion, storage_epoch: "epoch", change_seq: "1" }]);
    if (sql.startsWith("UPDATE agent_proposals")) {
      updates++;
      const saved = rows.find(item => item.id === args[0])!;
      saved.version = Number(args[1]); saved.state = String(args[2]); saved.payload_encrypted = String(args[3]);
      return result([saved]);
    }
    throw new Error(`Unexpected business operation: ${sql}`);
  } };
  const pool = { connect: async () => client, async query(sql: string) {
    assert.equal(sql, "SELECT workspace_id FROM children WHERE id=$1");
    return result([{ workspace_id: "synthetic-workspace" }]);
  } } as unknown as Pool;
  return { store: createProductAgentStore(pool, cipher), queries, get updates() { return updates; },
    setAuthorizationVersion(version: string) { authorizationVersion = version; } };
}

test("pending discovery is private, read-only and bounded with microsecond and ID pagination", async () => {
  const rows = Array.from({ length: 22 }, (_, i) => row(i + 1));
  rows[20].is_expired = true;
  rows[19].state = "expired";
  const accepted = row(25); accepted.state = "accepted";
  const setup = fixture([...rows, accepted, row(30, "synthetic-other"), row(31, userId, otherChildId)]);
  const first = await setup.store.pendingProposals(userId, childId);
  assert.ok(first?.nextCursor);
  assert.equal(first.proposals.length, 20);
  assert.deepEqual(first.proposals.slice(0, 3).map(item => item.status), ["pending", "expired", "expired"]);
  assert.equal(agentPendingPageSchema.safeParse(first).success, true);
  const cursor = JSON.parse(Buffer.from(first.nextCursor, "base64url").toString("utf8"));
  assert.equal(cursor.createdAt, "2026-10-06T00:00:00.000002Z");
  const second = await setup.store.pendingProposals(userId, childId, first.nextCursor);
  assert.ok(second);
  assert.deepEqual(second.proposals.map(item => item.id), [rows[1].id, rows[0].id]);
  assert.equal(second.nextCursor, null);
  assert.equal(new Set([...first.proposals, ...second.proposals].map(item => item.id)).size, 22);
  assert.equal(setup.updates, 0);
  assert.ok(setup.queries.some(query => query.sql.endsWith("FOR SHARE")));
  assert.ok(!setup.queries.some(query => query.sql.endsWith("FOR UPDATE")));
  const queryCount = setup.queries.length;
  for (const invalid of ["%", "A".repeat(1025), Buffer.from(JSON.stringify({ ...cursor, userId: "synthetic-other" })).toString("base64url"),
    Buffer.from(JSON.stringify({ ...cursor, childId: otherChildId })).toString("base64url"),
    Buffer.from(JSON.stringify({ ...cursor, createdAt: "2026-10-06T00:00:00.002Z" })).toString("base64url")]) {
    await assert.rejects(setup.store.pendingProposals(userId, childId, invalid), error => error instanceof FamilyError && error.code === "invalid_input");
  }
  assert.equal(setup.queries.length, queryCount);
  let response = first;
  const api = createProductAgentApi("", (async (url: string, init: RequestInit) => {
    assert.match(url, /\/agent\/pending\?cursor=/);
    assert.equal(new Headers(init.headers).get("x-expected-user-id"), userId);
    return new Response(JSON.stringify(response), { headers: { "Content-Type": "application/json" } });
  }) as typeof fetch);
  assert.deepEqual(await api.getPendingProposals(childId, new AbortController().signal, userId, first.nextCursor), first);
  response = { ...first, proposals: [{ ...first.proposals[0], childId: otherChildId }] };
  await assert.rejects(api.getPendingProposals(childId, new AbortController().signal, userId, first.nextCursor), ProductAgentApiError);
});

test("expired proposals can only be dismissed at the exact version and replay returns the committed dismissal", async () => {
  const expired = row(1); expired.is_expired = true; expired.expires_at = new Date("2020-01-01T00:00:00Z");
  const setup = fixture([expired]); setup.setAuthorizationVersion("2");
  assert.equal((await setup.store.pendingProposals(userId, childId))?.proposals[0].status, "expired");
  await assert.rejects(setup.store.decide(userId, childId, runId, expired.id, { expectedVersion: 1, decision: "accept", confirmShared: true }),
    error => error instanceof FamilyError && error.code === "confirmation_expired");
  await assert.rejects(setup.store.decide(userId, childId, runId, expired.id, { expectedVersion: 2, decision: "dismiss", confirmShared: false }),
    error => error instanceof FamilyError && error.code === "version_conflict");
  const input = { expectedVersion: 1, decision: "dismiss" as const, confirmShared: false };
  const dismissed = await setup.store.decide(userId, childId, runId, expired.id, input);
  assert.equal(dismissed?.status, "dismissed"); assert.equal(dismissed?.version, 2); assert.equal(dismissed?.result, null);
  assert.deepEqual(await setup.store.decide(userId, childId, runId, expired.id, input), dismissed);
  assert.equal(setup.updates, 1);
  assert.deepEqual(await setup.store.pendingProposals(userId, childId), { proposals: [], nextCursor: null });
  const persistedExpired = row(2); persistedExpired.state = "expired";
  const persistedSetup = fixture([persistedExpired]);
  assert.equal((await persistedSetup.store.decide(userId, childId, runId, persistedExpired.id, input))?.status, "dismissed");
  const active = row(3), staleSetup = fixture([active]); staleSetup.setAuthorizationVersion("2");
  await assert.rejects(staleSetup.store.decide(userId, childId, runId, active.id, { expectedVersion: 1, decision: "accept", confirmShared: true }),
    error => error instanceof FamilyError && error.code === "confirmation_scope_changed");
  assert.equal(staleSetup.updates, 0);
});
