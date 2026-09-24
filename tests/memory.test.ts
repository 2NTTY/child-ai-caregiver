import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { factIsApplicable, normalizedFactKey, profileIsApplicable, requireTopicTransition, topicMayAsk } from "../server/memory-policy.ts";
import { factValuesSchema, summarySaveSchema } from "../server/memory-validation.ts";
import { handleMemoryRequest } from "../server/memory-api.ts";
import type { MemoryStore } from "../server/memory.ts";
import { FamilyError } from "../server/family-access.ts";

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
