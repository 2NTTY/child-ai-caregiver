import assert from "node:assert/strict";
import test from "node:test";
import { applyMemoryPreviewWrite, canManageMemory, factDraftFrom, factDraftSchema, factIsApplicable, topicDraftFrom, topicDraftSchema, topicMayAsk } from "../src/memory-view-model.ts";
import { createMemoryFixture } from "../src/preview/memory-fixture.ts";

const childId = "preview-test-child";
const now = Date.parse("2026-09-29T12:00:00+08:00");
const setup = (changed = false, expired = false) => {
  const { data, sources } = createMemoryFixture(childId, changed, expired);
  return { data, sources, context: { childId, role: "caregiver", sources, nextId: "preview-local-created", now } };
};

test("intended family candidates stay private until a separate shared confirmation", () => {
  const { data, sources, context } = setup();
  const draft = { ...factDraftFrom(null, sources), key: "New arrangement", content: "Preview only", sourceDescription: "Manual preview", intendedVisibility: "family" };
  const created = applyMemoryPreviewWrite(data, { kind: "create_fact", draft }, context);
  const candidate = created.facts[0];
  assert.equal(candidate.status, "candidate");
  assert.equal(candidate.visibility, "private");
  assert.equal(candidate.intendedVisibility, "family");
  assert.equal(factIsApplicable(candidate, now), false);
  assert.throws(() => applyMemoryPreviewWrite(created, { kind: "confirm_fact", basis: candidate, sharedConfirmed: false }, context));
  const confirmed = applyMemoryPreviewWrite(created, { kind: "confirm_fact", basis: candidate, sharedConfirmed: true }, context);
  assert.equal(confirmed.facts[0].visibility, "family");
  assert.equal(confirmed.facts[0].status, "confirmed");
  assert.equal(confirmed.factVersions[candidate.id][1].visibility, "private");
  assert.equal(data.facts.some(item => item.id === candidate.id), false);
});

test("viewers manage their own private memory while shared writes remain blocked", () => {
  const { data, sources, context } = setup();
  const own = data.facts.find(item => item.id.endsWith("-private"));
  const shared = data.facts.find(item => item.visibility === "family");
  const candidate = data.facts.find(item => item.status === "candidate");
  const viewer = { ...context, role: "viewer" };
  assert.equal(canManageMemory("viewer", own), true);
  assert.equal(canManageMemory("viewer", { ...own, authorSelf: false }), false);
  assert.equal(canManageMemory("viewer", shared), false);
  const draft = { ...factDraftFrom(own, sources), content: "Corrected private note", reason: "Correct wording" };
  const revised = applyMemoryPreviewWrite(data, { kind: "revise_fact", basis: own, draft, sharedConfirmed: false }, viewer);
  assert.equal(revised.facts[0].visibility, "private");
  assert.equal(revised.facts[0].version, own.version + 1);
  assert.equal(revised.factVersions[own.id][1].content, own.content);
  assert.equal(revised.summary, null);
  assert.throws(() => applyMemoryPreviewWrite(data, { kind: "delete_fact", basis: shared }, viewer));
  assert.throws(() => applyMemoryPreviewWrite(data, { kind: "confirm_fact", basis: candidate, sharedConfirmed: true }, viewer));
});

test("changed sources, expired facts and inactive facts are unavailable until explicitly corrected", () => {
  const { data, sources, context } = setup(true, true);
  const changed = data.facts.find(item => item.sourceState === "changed");
  const expired = data.facts.find(item => item.id.endsWith("-private"));
  const inactive = data.facts.find(item => item.status === "inactive");
  for (const fact of [changed, expired, inactive]) assert.equal(factIsApplicable(fact, now), false);
  const stale = { ...factDraftFrom(changed, sources), reason: "Review changed source" };
  assert.equal(factDraftSchema(sources, true).safeParse(stale).success, false);
  const corrected = applyMemoryPreviewWrite(data, { kind: "revise_fact", basis: changed, draft: { ...stale, sourceChoice: "record-v2" }, sharedConfirmed: true }, context);
  assert.equal(corrected.facts[0].source.version, 2);
  assert.equal(factIsApplicable(corrected.facts[0], now), true);
  const stillInactive = applyMemoryPreviewWrite(data, { kind: "revise_fact", basis: inactive, draft: { ...factDraftFrom(inactive, sources), reason: "Review old arrangement" }, sharedConfirmed: false }, context);
  assert.equal(stillInactive.facts[0].status, "inactive");
  assert.equal(factIsApplicable(stillInactive.facts[0], now), false);
});

test("terminal topic reopening creates a linked topic and preserves the old terminal state", () => {
  const { data, context } = setup();
  const answered = data.topics.find(item => item.status === "answered");
  const snoozed = data.topics.find(item => item.status === "snoozed");
  assert.equal(topicMayAsk(answered, now), false);
  assert.equal(topicMayAsk(snoozed, now), false);
  assert.equal(topicDraftSchema("change", now).safeParse({ ...topicDraftFrom(snoozed), resumeAfter: "2026-09-01T09:00:00+08:00" }).success, false);
  assert.throws(() => applyMemoryPreviewWrite(data, { kind: "change_topic", basis: answered, draft: { ...topicDraftFrom(answered), status: "pending" } }, context));
  const reopened = applyMemoryPreviewWrite(data, { kind: "reopen_topic", basis: answered, reason: "New information needs discussion" }, context);
  assert.deepEqual(reopened.topics.find(item => item.id === answered.id), answered);
  assert.equal(reopened.topics[0].reopenedFrom, answered.id);
  assert.equal(reopened.topics[0].status, "pending");
  assert.equal(reopened.topics[0].reopenReason, "New information needs discussion");
  assert.throws(() => applyMemoryPreviewWrite(reopened, { kind: "reopen_topic", basis: answered, reason: "Duplicate" }, { ...context, nextId: "preview-second" }));
});
