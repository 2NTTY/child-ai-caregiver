import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { MemoryFact, MemoryTopic } from "../src/shared/memory.ts";
import { createMemoryStore } from "../server/memory.ts";
import { createStorageCipher } from "../server/storage-crypto.ts";

const childId = randomUUID(), workspaceId = randomUUID(), userId = "synthetic-owner";
const cipher = createStorageCipher(Buffer.alloc(32, 37));
const fact = (patch: Partial<MemoryFact> = {}): MemoryFact => ({
  id: randomUUID(), childId, visibility: "private", intendedVisibility: "private", status: "confirmed",
  version: 1, createdBy: userId, confirmedBy: userId, confirmedAt: "2026-10-01T00:00:00Z",
  key: "synthetic-key", content: "synthetic-value", source: { kind: "manual", description: "Synthetic fixture" },
  validUntil: null, reason: "Synthetic confirmation", applicable: true, sourceState: "current", ...patch,
});
const topic = (status: MemoryTopic["status"]): MemoryTopic => ({
  id: randomUUID(), childId, visibility: "family", title: "Synthetic topic", note: "Synthetic note", status,
  version: 1, updatedBy: userId, updatedAt: "2026-10-01T00:00:00Z",
  resumeAfter: status === "snoozed" ? "2099-01-01T00:00:00Z" : null,
  reopenReason: null, reopenedFrom: null, mayAsk: status === "pending",
});
function harness(facts: MemoryFact[], topics: MemoryTopic[] = [], sourceVersions = new Map<string, number>()) {
  const factRows = facts.map(value => ({ id: value.id, child_id: value.childId, created_by: value.createdBy,
    visibility: value.visibility, status: value.status, version: value.version, validity_indexed: true,
    payload_encrypted: cipher.encrypt(JSON.stringify(value), `memory-fact:${value.childId}:${value.id}:${value.version}`) }));
  const topicRows = topics.map(value => ({ id: value.id, child_id: value.childId, created_by: value.updatedBy,
    visibility: value.visibility, status: value.status, version: value.version,
    payload_encrypted: cipher.encrypt(JSON.stringify(value), `memory-topic:${value.childId}:${value.id}:${value.version}`) }));
  const calls: { sql: string; params: unknown[] }[] = [];
  const result = (rows: unknown[]) => ({ rows, rowCount: rows.length });
  const client = { release() {}, async query(sql: string, params: unknown[] = []) {
    calls.push({ sql, params });
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK" || sql.startsWith("SET LOCAL")) return result([]);
    if (sql.startsWith("SELECT workspace_id FROM children")) return result([{ workspace_id: workspaceId }]);
    if (sql.startsWith("SELECT owner_user_id, access_version FROM workspaces")) return result([{ owner_user_id: userId, access_version: 1 }]);
    if (sql.startsWith("SELECT 1 FROM children")) return result([{}]);
    if (sql.startsWith("SELECT profile_version FROM children")) return result([{ profile_version: 0 }]);
    if (sql.includes("FROM child_profile_revisions")) return result([]);
    if (sql.startsWith("SELECT version FROM text_records")) {
      const version = sourceVersions.get(params[0] as string);
      return result(version === undefined ? [] : [{ version }]);
    }
    if (sql.startsWith("SELECT id,version FROM text_records")) return result([]);
    const authorityQuery = `WITH checked AS MATERIALIZED (SELECT clock_timestamp() AS at)
    SELECT md5(jsonb_build_array(
    (SELECT coalesce(jsonb_agg(jsonb_build_array(id,version) ORDER BY id),'[]'::jsonb) FROM text_records WHERE child_id=$1),
    (SELECT coalesce(jsonb_agg(jsonb_build_array(id,version,status,visibility,valid_until,valid_until IS NULL OR valid_until>checked.at) ORDER BY id),'[]'::jsonb)
      FROM memory_facts WHERE child_id=$1 AND (visibility='family' OR created_by=$2)),
    (SELECT coalesce(jsonb_agg(jsonb_build_array(id,version) ORDER BY id),'[]'::jsonb) FROM memory_topics WHERE child_id=$1 AND (visibility='family' OR created_by=$2))
    )::text) AS authority, NOT EXISTS(SELECT 1 FROM memory_facts WHERE child_id=$1 AND (visibility='family' OR created_by=$2) AND NOT validity_indexed) AS metadata_complete,
    checked.at AS checked_at, (SELECT min(valid_until) FROM memory_facts WHERE child_id=$1
      AND (visibility='family' OR created_by=$2) AND valid_until>checked.at) AS fact_valid_until FROM checked`.replace(/\s+/gu, " ").trim();
    if (sql.replace(/\s+/gu, " ").trim() === authorityQuery) {
      assert.deepEqual(params, [childId, userId]);
      return result([{ authority: "synthetic-authority", metadata_complete: true,
        checked_at: new Date("2026-10-09T09:00:00.000Z"), fact_valid_until: null }]);
    }
    if (sql.startsWith("WITH checked")) throw new Error("Unexpected synthetic authority query: " + sql);
    if (sql.includes("FROM conversation_summaries") || sql.includes("FROM chat_messages")) return result([]);
    if (sql.includes("FROM memory_facts") || sql.includes("FROM memory_topics")) {
      const source = sql.includes("FROM memory_facts") ? factRows : topicRows;
      const paged = sql.includes("LIMIT $4");
      const familyOnly = paged && params[4] === true;
      const excludeInactive = sql.includes("NOT $6::boolean OR status<>'inactive'") && params[5] === true;
      if (sql.includes("NOT validity_indexed")) return result([]);
      let rows = source.filter(row => row.child_id === params[0]
        && (row.visibility === "family" || !familyOnly && row.created_by === params[1])
        && (!excludeInactive || row.status !== "inactive"));
      rows = rows.sort((a, b) => a.id.localeCompare(b.id));
      if (paged) rows = rows.filter(row => params[2] === null || row.id > (params[2] as string)).slice(0, params[3] as number);
      return result(rows);
    }
    throw new Error("Unexpected synthetic query: " + sql);
  } };
  return { store: createMemoryStore({ query: client.query, connect: async () => client } as unknown as Pool, cipher), calls };
}

test("201 inactive facts do not block private or family context", async () => {
  for (const scope of ["private", "family"] as const) {
    const rows = Array.from({ length: 201 }, () => fact({ status: "inactive", visibility: scope, applicable: false }));
    const { store, calls } = harness(rows);
    const context = await store.context(userId, childId, scope);
    assert.ok(context);
    assert.deepEqual(context.facts, []);
    assert.deepEqual(context.unavailableFactKeys, []);
    assert.equal(context.truncated.facts, false);
    const query = calls.find(call => call.sql.startsWith("SELECT * FROM memory_facts"))!;
    assert.match(query.sql, /status<>'inactive'.*ORDER BY id LIMIT \$4/u);
    assert.equal(query.params[3], 21);
    assert.equal(query.params[5], true);
  }
});

test("inactive history does not veto an independently confirmed replacement", async () => {
  const active = fact({ key: "growth.solid_food", content: "started", visibility: "family" });
  const rows = Array.from({ length: 200 }, () => fact({ status: "inactive", key: active.key, visibility: "family" }));
  const context = await harness([...rows, active]).store.context(userId, childId, "family");
  assert.ok(context);
  assert.deepEqual(context.facts.map(value => value.id), [active.id]);
  assert.equal(context.facts[0].applicable, true);
  assert.deepEqual(context.unavailableFactKeys, []);
});

test("expired, changed-source and candidate facts keep unavailable-key safeguards", async () => {
  const key = "growth.solid_food", recordId = randomUUID();
  for (const unavailable of [
    fact({ key, validUntil: "2000-01-01T00:00:00Z" }),
    fact({ key, source: { kind: "care_record", description: "Synthetic stale source", recordId, version: 1 } }),
    fact({ key, status: "candidate", confirmedAt: null, confirmedBy: null }),
  ]) {
    const active = fact({ key, content: "started" });
    const context = await harness([active, unavailable], [], new Map([[recordId, 2]])).store.context(userId, childId, "private");
    assert.ok(context);
    assert.deepEqual(context.facts.map(value => value.id), [active.id]);
    assert.deepEqual(context.unavailableFactKeys, [key]);
  }
});

test("current facts keep private, family and child scope and redact private-chat references", async () => {
  const messageId = randomUUID();
  const shared = fact({ visibility: "family", createdBy: "synthetic-caregiver",
    source: { kind: "private_chat", description: "Explicitly shared synthetic fact", messageId } });
  const own = fact({ key: "own-private" }), other = fact({ createdBy: "synthetic-caregiver", key: "other-private" });
  const elsewhere = fact({ childId: randomUUID(), visibility: "family", key: "other-child" });
  const { store } = harness([shared, own, other, elsewhere, fact({ status: "candidate", key: "pending-private" })]);
  const personal = await store.context(userId, childId, "private"), family = await store.context(userId, childId, "family");
  assert.ok(personal && family);
  assert.deepEqual(personal.facts.map(value => value.id).sort(), [shared.id, own.id].sort());
  assert.deepEqual(personal.unavailableFactKeys, ["pending-private"]);
  assert.deepEqual(family.facts.map(value => value.id), [shared.id]);
  assert.deepEqual(family.unavailableFactKeys, []);
  assert.deepEqual(family.facts[0].source, { kind: "private_chat", description: "Explicitly shared synthetic fact" });
});

test("current fact prefixes preserve visible conflicts and expose resumable overflow", async () => {
  const first = fact({ key: "same-key", content: "one" }), second = fact({ key: "same-key", content: "two", visibility: "family" });
  const inactive = Array.from({ length: 201 }, () => fact({ status: "inactive" }));
  const context = await harness([...inactive, first, second]).store.context(userId, childId, "private");
  assert.ok(context);
  assert.equal(context.facts.length, 2);
  assert.deepEqual(context.conflictingKeys, ["same-key"]);
  const current = Array.from({ length: 200 }, (_, index) => fact({ id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, key: "key-" + index }));
  const last = fact({ id: "ffffffff-ffff-4fff-bfff-ffffffffffff", key: current[0].key, content: "conflicting last value" });
  for (const rows of [[...inactive, ...current, last], [...current.map(value => ({ ...value, status: "candidate" as const })), last]]) {
    const partial = await harness(rows).store.context(userId, childId, "private");
    assert.ok(partial); assert.equal(partial.truncated.facts, true); assert.equal(partial.nextFactsAfterId, current[19].id);
  }
});

test("historical fact pagination retains inactive rows and its original 50-item bound", async () => {
  const rows = Array.from({ length: 201 }, () => fact({ status: "inactive" }));
  const { store, calls } = harness(rows);
  const first = await store.facts(userId, childId);
  assert.ok(first);
  assert.equal(first.items.length, 50);
  assert.ok(first.items.every(value => value.status === "inactive"));
  assert.ok(first.nextAfterId);
  const second = await store.facts(userId, childId, first.nextAfterId);
  assert.ok(second);
  assert.equal(second.items.length, 50);
  assert.equal(new Set([...first.items, ...second.items].map(value => value.id)).size, 100);
  for (const call of calls.filter(call => call.sql.startsWith("SELECT * FROM memory_facts"))) {
    assert.equal(call.params[3], 51);
    assert.equal(call.params[5], false);
  }
});

test("all topic states remain visible and overflow exposes the next prefix", async () => {
  const topics = (["pending", "answered", "snoozed", "resolved"] as const).map(topic);
  const context = await harness([], topics).store.context(userId, childId, "family");
  assert.ok(context);
  assert.deepEqual(context.topics.map(value => value.status).sort(), ["pending", "answered", "snoozed", "resolved"].sort());
  assert.ok(context.topics.filter(value => value.status !== "pending").every(value => !value.mayAsk));
  const partial = await harness([], Array.from({ length: 201 }, () => topic("resolved"))).store.context(userId, childId, "family");
  assert.ok(partial); assert.equal(partial.topics.length, 20); assert.equal(partial.truncated.topics, true); assert.ok(partial.nextTopicsAfterId);
});
