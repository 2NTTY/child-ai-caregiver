import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { factIsApplicable, looksLikeDurableMemoryFactQuestion, looksLikeDurableMemoryFactStatement, normalizedFactKey, preserveMemoryFactUserWording, profileIsApplicable, requireTopicTransition, sanitizeDurableMemoryFactValidUntil, topicMayAsk } from "../server/memory-policy.ts";
import { factValuesSchema, summarySaveSchema } from "../server/memory-validation.ts";
import { handleMemoryRequest } from "../server/memory-api.ts";
import type { MemoryStore } from "../server/memory.ts";
import { FamilyError } from "../server/family-access.ts";
import { createMemoryStore } from "../server/memory.ts";
import { createStorageCipher } from "../server/storage-crypto.ts";
import type { Pool } from "pg";
import type { MemoryFact } from "../src/shared/memory.ts";

test("only confirmed, current and unexpired facts are applicable", () => {
  const base = { status: "confirmed" as const, sourceState: "current" as const, validUntil: null };
  assert.equal(factIsApplicable(base), true);
  for (const status of ["candidate", "inactive"] as const) assert.equal(factIsApplicable({ ...base, status }), false);
  assert.equal(factIsApplicable({ ...base, sourceState: "changed" }), false);
  assert.equal(factIsApplicable({ ...base, validUntil: "2026-01-01T00:00:00Z" }, Date.parse("2026-01-01T00:00:00Z")), false);
});
test("new sessions do not reopen answered or resolved topics; snooze has an explicit boundary", () => {
  for (const status of ["answered", "resolved"] as const) {
    assert.equal(topicMayAsk({ status, resumeAfter: null }, Number.MAX_SAFE_INTEGER), false);
    assert.throws(() => requireTopicTransition(status, "pending", null), /terminal_topic/u);
  }
  const due = "2027-01-01T00:00:00Z";
  assert.equal(topicMayAsk({ status: "snoozed", resumeAfter: due }, Date.parse(due) - 1), false);
  assert.equal(topicMayAsk({ status: "snoozed", resumeAfter: due }, Date.parse(due)), true);
  assert.throws(() => requireTopicTransition("pending", "snoozed", null), /invalid_snooze/u);
});
test("fact input preserves precision and rejects fabricated or incomplete source shapes", () => {
  const raw = { key: " 睡眠安排 ", content: "  大概半小時\n未確認精確時間  ", source: { kind: "manual", description: "原文" }, validUntil: null };
  assert.deepEqual(factValuesSchema.parse(raw), raw);
  assert.equal(factValuesSchema.safeParse({ ...raw, source: { kind: "private_chat", description: "missing ID" } }).success, false);
  assert.equal(factValuesSchema.safeParse({ ...raw, source: { kind: "care_record", description: "wrong version", recordId: randomUUID(), version: "1" } }).success, false);
  assert.equal(factValuesSchema.safeParse({ ...raw, content: "\ud800" }).success, false);
  assert.equal(normalizedFactKey("  ＡＢＣ "), "abc");
});
test("profile validity keeps the original Hong Kong calendar-date boundary", () => {
  const data = { validUntil: "2026-09-24" };
  assert.equal(profileIsApplicable(data, new Date("2026-09-24T15:59:59Z")), true);
  assert.equal(profileIsApplicable(data, new Date("2026-09-24T16:00:00Z")), false);
  assert.equal(profileIsApplicable(null), false);
});
const childId = randomUUID(), factId = randomUUID();
const request = (path: string, body?: unknown, headers: Record<string, string> = {}) => new Request(`http://localhost/api/children/${childId}/memory/${path}`, {
  method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", "x-expected-user-id": "owner", ...headers },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
test("memory writes require the current account and an explicit confirmation", async () => {
  let calls = 0;
  const store = { confirmFact: async () => { calls++; return {}; } } as unknown as MemoryStore;
  const body = { expectedVersion: 1, confirm: true, confirmShared: true };
  assert.equal((await handleMemoryRequest(request(`facts/${factId}/confirm`, body), null, store)).status, 401);
  assert.equal((await handleMemoryRequest(request(`facts/${factId}/confirm`, body, { "x-expected-user-id": "other" }), "owner", store)).status, 409);
  assert.equal((await handleMemoryRequest(request(`facts/${factId}/confirm`, { ...body, confirm: false }), "owner", store)).status, 400);
  assert.equal((await handleMemoryRequest(request(`facts/${factId}/confirm`, body), "owner", store)).status, 200);
  assert.equal(calls, 1);
});
test("memory HTTP does not expose a model summary write or hide a version conflict", async () => {
  const store = { reviseFact: async () => { throw new FamilyError(409, "version_conflict"); } } as unknown as MemoryStore;
  assert.equal((await handleMemoryRequest(request("summary", { text: "invented" }), "owner", store)).status, 404);
  const values = { key: "日常", content: "合成", source: { kind: "manual", description: "本人" }, validUntil: null };
  const response = await handleMemoryRequest(request(`facts/${factId}/revise`, { values, expectedVersion: 1, confirm: true, confirmShared: true, reason: "更正" }), "owner", store);
  assert.equal(response.status, 409); assert.equal((await response.json()).error.code, "version_conflict");
});
test("summary writes need exact coverage metadata and cannot carry fact or task mutations", () => {
  const value = { previousVersion: 0, basis: "a".repeat(64), text: "摘要", coveredMessageIds: [randomUUID()] };
  assert.deepEqual(summarySaveSchema.parse(value), value);
  assert.equal(summarySaveSchema.safeParse({ ...value, taskStatus: "completed" }).success, false);
  assert.equal(summarySaveSchema.safeParse({ ...value, coveredMessageIds: [] }).success, false);
});

test("deactivating shared memory hides another author's private message identifier and publishes only metadata", async () => {
  const child = randomUUID(), factId = randomUUID(), workspace = randomUUID(), messageId = randomUUID();
  const cipher = createStorageCipher(Buffer.alloc(32, 31));
  const value: MemoryFact = { id: factId, childId: child, createdBy: "author", visibility: "family", intendedVisibility: "family", status: "confirmed",
    version: 2, key: "作息", content: "已獲確認的合成內容", source: { kind: "private_chat", messageId, description: "主動分享" }, validUntil: null,
    confirmedBy: "author", confirmedAt: "2026-09-24T00:00:00Z", reason: "確認", applicable: true, sourceState: "current" };
  const row = { id: factId, child_id: child, created_by: "author", visibility: "family", version: 2,
    payload_encrypted: cipher.encrypt(JSON.stringify(value), `memory-fact:${child}:${factId}:2`) };
  let change: unknown[] | undefined, parentLocked = false;
  const client = { release() {}, async query(sql: string, params?: unknown[]) {
    if (sql.includes("FROM workspaces")) { parentLocked = sql.endsWith("FOR UPDATE"); return { rows: [{ owner_user_id: "owner", access_version: 1 }], rowCount: 1 }; }
    if (sql.includes("FROM family_members")) { assert.ok(parentLocked); return { rows: [{ role: "caregiver" }], rowCount: 1 }; }
    if (sql.startsWith("SELECT workspace_id")) return { rows: [{ workspace_id: workspace }], rowCount: 1 };
    if (sql.includes("FROM children")) return { rows: [{ profile_version: 0 }], rowCount: 1 };
    if (sql.includes("FROM memory_facts")) return { rows: [row], rowCount: 1 };
    if (sql.startsWith("UPDATE workspaces")) return { rows: [{ change_seq: "8" }], rowCount: 1 };
    if (sql.startsWith("INSERT INTO online_changes")) change = params;
    return { rows: [], rowCount: 1 };
  } };
  const pool = { query: client.query, connect: async () => client } as unknown as Pool;
  const result = await createMemoryStore(pool, cipher, true).deactivateFact("caregiver", child, factId, { expectedVersion: 2, reason: "更正使用範圍" });
  assert.equal(result?.status, "inactive");
  assert.deepEqual(result?.source, { kind: "private_chat", description: "主動分享" });
  assert.deepEqual(change, [workspace, "8", "memory", child, null, false, false]);
  assert.ok(!JSON.stringify(change).includes(messageId));
});
test("memory fact content keeps the user child nickname from the source message", () => {
  assert.equal(preserveMemoryFactUserWording("BB 對雞蛋過敏", "寶寶對雞蛋過敏"), "BB對雞蛋過敏");
  assert.equal(preserveMemoryFactUserWording("BB對花生過敏", "寶寶對花生過敏"), "BB對花生過敏");
  assert.equal(preserveMemoryFactUserWording("寶寶對雞蛋過敏", "BB對雞蛋過敏"), "寶寶對雞蛋過敏");
  assert.equal(preserveMemoryFactUserWording("記低：bb 對蛋過敏", "寶寶對蛋過敏"), "bb對蛋過敏");
  assert.equal(preserveMemoryFactUserWording("今日天氣好好", "寶寶對雞蛋過敏"), "寶寶對雞蛋過敏");
  assert.equal(preserveMemoryFactUserWording("", "寶寶對雞蛋過敏"), "寶寶對雞蛋過敏");
  assert.equal(preserveMemoryFactUserWording("BB 對雞蛋過敏", "BB 對雞蛋過敏"), "BB 對雞蛋過敏");
});


test("durable memory fact statements are distinguished from allergy questions", () => {
  assert.equal(looksLikeDurableMemoryFactStatement("BB 對雞蛋過敏"), true);
  assert.equal(looksLikeDurableMemoryFactStatement("寶寶對花生過敏"), true);
  assert.equal(looksLikeDurableMemoryFactStatement("BB 有冇對雞蛋過敏？"), false);
  assert.equal(looksLikeDurableMemoryFactStatement("BB 有冇花生過敏"), false);
  assert.equal(looksLikeDurableMemoryFactStatement("確認"), false);
});

test("lasting preference statements require propose_fact; preference questions do not", () => {
  assert.equal(looksLikeDurableMemoryFactStatement("BB 鍾意香蕉"), true);
  assert.equal(looksLikeDurableMemoryFactStatement("BB 喜歡蘋果"), true);
  assert.equal(looksLikeDurableMemoryFactStatement("BB 唔鍾意西蘭花"), true);
  assert.equal(looksLikeDurableMemoryFactStatement("BB likes bananas"), true);
  assert.equal(looksLikeDurableMemoryFactStatement("BB 鍾唔鍾意香蕉"), false);
  assert.equal(looksLikeDurableMemoryFactStatement("BB 鍾意香蕉嗎"), false);
  assert.equal(looksLikeDurableMemoryFactStatement("BB 有冇鍾意香蕉？"), false);
});

test("allergy questions are not durable statements and are classified as questions", () => {
  assert.equal(looksLikeDurableMemoryFactStatement("Esther\u5c0d\u829d\u9ebb\u904e\u654f"), true);
  assert.equal(looksLikeDurableMemoryFactStatement("Esther\u5c0d\u829d\u9ebb\u904e\u654f\u55ce\uff1f"), false);
  assert.equal(looksLikeDurableMemoryFactQuestion("Esther\u5c0d\u829d\u9ebb\u904e\u654f\u55ce\uff1f"), true);
  assert.equal(looksLikeDurableMemoryFactQuestion("Esther\u5c0d\u829d\u9ebb\u904e\u654f\uff1f"), true);
  assert.equal(looksLikeDurableMemoryFactQuestion("Esther\u5c0d\u829d\u9ebb\u904e\u654f"), false);
  assert.equal(looksLikeDurableMemoryFactQuestion("BB \u5c0d\u96de\u86cb\u904e\u654f\u55ce\uff1f"), true);
});

test("short validUntil on allergy proposals is coerced to null", () => {
  const now = Date.parse("2026-10-22T01:53:52.706Z");
  assert.equal(sanitizeDurableMemoryFactValidUntil("Esther\u5c0d\u829d\u9ebb\u904e\u654f", "2026-10-22T02:00:00.000Z", now), null);
  assert.equal(sanitizeDurableMemoryFactValidUntil("Esther\u5c0d\u829d\u9ebb\u904e\u654f", null, now), null);
  const long = "2099-12-31T23:59:00.000Z";
  assert.equal(sanitizeDurableMemoryFactValidUntil("Esther\u5c0d\u829d\u9ebb\u904e\u654f", long, now), long);
  assert.equal(sanitizeDurableMemoryFactValidUntil("\u666e\u901a\u5099\u8a3b", "2026-10-22T02:00:00.000Z", now), "2026-10-22T02:00:00.000Z");
});
