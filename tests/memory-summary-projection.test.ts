import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { readInitialConversationSummary, readSummary } from "../server/memory-summary.ts";
import { profileIsApplicable } from "../server/memory-policy.ts";
import type { StorageCipher } from "../server/storage-crypto.ts";

const userId = "synthetic-user", childId = "11111111-1111-4111-8111-111111111111";
const summaryId = "22222222-2222-4222-8222-222222222222";
const messageId = "33333333-3333-4333-8333-333333333333";
function fixture(options: { now?: string; factUntil?: string | null; profileUntil?: string | null; invalidated?: boolean; complete?: boolean; intact?: boolean; changed?: boolean; missing?: boolean; unknownClock?: boolean } = {}) {
  const now = new Date(options.now ?? "2026-10-09T15:59:59.000Z");
  const data = { validUntil: options.profileUntil === undefined ? "2026-10-09" : options.profileUntil };
  const profile = [{ profile_version: 1 }];
  const basis = createHash("sha256").update(JSON.stringify(["v2", profile, profileIsApplicable(data, now), "synthetic-authority"])).digest("hex");
  const value = { id: summaryId, childId, version: 3, text: "Synthetic private conversation summary", createdAt: "2026-10-01T00:00:00.000Z",
    previousId: null, coveredMessageIds: [messageId], lastCoveredMessageId: messageId, basis };
  const queries: string[] = [];
  const client = { query: async (sql: string, parameters: unknown[]) => {
    queries.push(sql);
    if (sql.startsWith("SELECT id,payload_encrypted,invalidated")) {
      assert.deepEqual(parameters, [childId, userId]);
      return { rows: options.missing ? [] : [{ id: summaryId, payload_encrypted: JSON.stringify(value), invalidated: options.invalidated ?? false }] };
    }
    if (sql.includes("AND NOT validity_indexed ORDER BY id LIMIT 100")) return { rows: [] };
    if (sql.startsWith("SELECT profile_version")) return { rows: profile };
    if (sql.startsWith("SELECT version,payload_encrypted FROM child_profile_revisions")) return { rows: [{ version: 1, payload_encrypted: JSON.stringify({ data }) }] };
    if (sql.startsWith("WITH checked AS MATERIALIZED")) {
      assert.deepEqual(parameters, [childId, userId]);
      assert.ok(sql.includes("valid_until>checked.at")); assert.ok(sql.includes("min(valid_until)"));
      return { rows: [{ authority: options.changed ? "changed-authority" : "synthetic-authority", metadata_complete: options.complete ?? true,
        checked_at: options.unknownClock ? new Date(NaN) : now, fact_valid_until: options.factUntil ? new Date(options.factUntil) : null }] };
    }
    if (sql.startsWith("SELECT 1 FROM conversation_summaries")) return { rowCount: options.intact === false ? 1 : 0, rows: [] };
    throw new Error("Unexpected synthetic query: " + sql);
  } } as unknown as PoolClient;
  const cipher: StorageCipher = { decrypt: (text: string) => text, encrypt: (text: string) => text };
  return { client, cipher, value, queries };
}

test("summary projection reuses authority and coverage checks and strips internal or unrelated fields", async () => {
  const f = fixture();
  const projected = await readInitialConversationSummary(f.client, f.cipher, userId, childId);
  assert.deepEqual(projected, { summary: { id: summaryId, version: 3, text: f.value.text, createdAt: f.value.createdAt, lastCoveredMessageId: messageId },
    basis: f.value.basis, validUntil: "2026-10-09T16:00:00.000Z" });
  const publicSummary = await readSummary(f.client, f.cipher, userId, childId);
  const { basis: _basis, ...expected } = f.value;
  assert.deepEqual(publicSummary, expected);
  assert.ok(!f.queries.some(sql => sql.includes("FROM chat_messages")), "Projection must not reread original conversation bodies");
});

test("the earliest fact expiry or inclusive Hong Kong profile boundary bounds the projection", async () => {
  for (const [options, expected] of [
    [{ factUntil: "2026-10-09T15:59:59.500Z" }, "2026-10-09T15:59:59.500Z"],
    [{ factUntil: "2026-10-10T00:00:00.000Z" }, "2026-10-09T16:00:00.000Z"],
    [{ profileUntil: null, factUntil: "2026-10-10T00:00:00.000Z" }, "2026-10-10T00:00:00.000Z"],
    [{ profileUntil: null, factUntil: null }, null],
  ] as const) {
    const f = fixture(options);
    assert.equal((await readInitialConversationSummary(f.client, f.cipher, userId, childId))?.validUntil, expected);
  }
});

test("invalidated, missing, changed, incomplete or unprovable snapshots are omitted", async () => {
  for (const options of [{ invalidated: true }, { missing: true }, { changed: true }, { complete: false }, { intact: false },
    { unknownClock: true }, { profileUntil: "2027-02-30" }, { factUntil: "not-a-timestamp" }]) {
    const f = fixture(options);
    assert.equal(await readInitialConversationSummary(f.client, f.cipher, userId, childId), null, JSON.stringify(options));
  }
});
