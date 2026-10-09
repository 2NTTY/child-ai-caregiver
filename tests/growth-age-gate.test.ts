import assert from "node:assert/strict";
import test from "node:test";
import { growthProposals } from "../server/growth-rules.ts";
import { agentKnowledgeFilter } from "../server/product-agent-tools.ts";
import type { KnowledgeEvidence } from "../src/shared/knowledge.ts";
import type { MemoryContext } from "../src/shared/memory.ts";

const now = new Date("2026-09-28T00:00:00Z");
function context(): MemoryContext {
  return { profile: { childId: "synthetic-child", version: 1, confirmedBy: "synthetic-parent", confirmedAt: now.toISOString(), reason: null,
    data: { age: { kind: "birth_date", date: "2026-03-28" }, dueDate: null, gestationalWeeksRaw: null, region: "HK", language: "zh-HK",
      allergies: null, specialNeeds: null, preferences: null, source: "synthetic", validUntil: null } },
    profileApplicable: true, facts: [], topics: [], summary: null, recentMessages: [], conflictingKeys: [], unavailableFactKeys: [],
    truncated: { facts: false, topics: false, messages: false } };
}
function inaccessibleSources(): KnowledgeEvidence[] {
  return new Proxy([] as KnowledgeEvidence[], { get() { throw new Error("Growth evidence must not be read before the exact-age gate"); } });
}

test("approximate ages remain discovery hints but cannot reach growth evidence in any rule window", () => {
  for (const months of [6, 12, 36, 72]) {
    const ctx = context();
    ctx.profile.data!.age = { kind: "approximate", rawValue: String(months), unit: "months", asOf: "2026-09-28" };
    const before = structuredClone(ctx), filter = agentKnowledgeFilter(ctx, now);
    assert.deepEqual(filter.age, { basis: "actual", minMonths: months, maxMonths: months });
    assert.equal(filter.ageMatch, "overlap");
    const result = growthProposals(ctx, inaccessibleSources(), now);
    assert.deepEqual(result.proposals, []);
    assert.match(result.notices.join(" "), /有效的出生日期/u);
    assert.deepEqual(ctx, before);
  }
});

test("inapplicable, missing and unusable birth-date profiles stop before growth evidence", () => {
  const inapplicable = context(); inapplicable.profileApplicable = false;
  const missing = context(); missing.profile.data = null;
  const unknown = context(); unknown.profile.data!.age = { kind: "unknown" };
  const cases = [inapplicable, missing, unknown];
  for (const date of ["invalid-date", "2026-09-29", "2015-09-28"]) {
    const ctx = context(); ctx.profile.data!.age = { kind: "birth_date", date }; cases.push(ctx);
  }
  for (const ctx of cases) {
    const result = growthProposals(ctx, inaccessibleSources(), now);
    assert.deepEqual(result.proposals, []);
    assert.match(result.notices.join(" "), /有效的出生日期/u);
  }
});

test("valid birth dates reach the existing source gate and still fail closed without reviewed evidence", () => {
  for (const date of ["2026-03-28", "2025-09-28", "2023-09-28", "2020-09-28"]) {
    const ctx = context(); ctx.profile.data!.age = { kind: "birth_date", date };
    let evidenceReads = 0;
    const evidence = new Proxy([] as KnowledgeEvidence[], { get(target, property, receiver) {
      if (property === "find") evidenceReads += 1;
      return Reflect.get(target, property, receiver);
    } });
    const result = growthProposals(ctx, evidence, now);
    assert.equal(evidenceReads, 1);
    assert.deepEqual(result.proposals, []);
    assert.equal(result.notices.length, 1);
    assert.match(result.notices[0], /已核對來源暫未可用/u);
  }
});
