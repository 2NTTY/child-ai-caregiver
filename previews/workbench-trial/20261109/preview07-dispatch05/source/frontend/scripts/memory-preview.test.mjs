import assert from "node:assert/strict";
import test from "node:test";
import { applyMemoryPreviewWrite, canManageMemory, factConfirmationLabel, factDraftFrom, factDraftSchema, factIsApplicable, factUnavailableReason, topicDraftFrom, topicDraftSchema, topicMayAsk } from "../src/memory-view-model.ts";
import { createMemoryFixture, createMemoryPaginationSample } from "../src/preview/memory-fixture.ts";
import { appendMemoryPage, loadedMemoryPages, syntheticMemoryPage } from "../src/preview/memory-pagination.ts";

const childId = "preview-test-child";
const now = Date.parse("2026-09-29T12:00:00+08:00");
const setup = (changed = false, expired = false) => {
  const { data, sources } = createMemoryFixture(childId, changed, expired);
  return { data, sources, context: { childId, role: "caregiver", actorId: "preview-test-actor", sources, nextId: "preview-local-created", now } };
};

test("intended family candidates stay private until a separate shared confirmation", () => {
  const { data, sources, context } = setup();
  const draft = { ...factDraftFrom(null, sources), key: "New arrangement", content: "Preview only", sourceDescription: "Manual preview", intendedVisibility: "family" };
  const created = applyMemoryPreviewWrite(data, { kind: "create_fact", draft }, context);
  const candidate = created.facts[0];
  assert.equal(candidate.status, "candidate");
  assert.equal(candidate.visibility, "private");
  assert.equal(candidate.intendedVisibility, "family");
  assert.equal(factIsApplicable(candidate), false);
  assert.throws(() => applyMemoryPreviewWrite(created, { kind: "confirm_fact", basis: candidate, sharedConfirmed: false }, context));
  const confirmed = applyMemoryPreviewWrite(created, { kind: "confirm_fact", basis: candidate, sharedConfirmed: true }, context);
  assert.equal(confirmed.facts[0].visibility, "family");
  assert.equal(confirmed.facts[0].status, "confirmed");
  assert.equal(confirmed.facts[0].applicable, true);
  assert.equal(confirmed.facts[0].confirmedBy, context.actorId);
  assert.equal(confirmed.facts[0].confirmedAt, new Date(now).toISOString());
  assert.equal(confirmed.factVersions[candidate.id][1].confirmedBy, null);
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
  assert.equal(revised.facts[0].confirmedBy, own.confirmedBy);
  assert.equal(revised.facts[0].confirmedAt, own.confirmedAt);
  assert.equal(revised.facts[0].applicable, true);
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
  for (const fact of [changed, expired, inactive]) assert.equal(factIsApplicable(fact), false);
  const stale = { ...factDraftFrom(changed, sources), reason: "Review changed source" };
  assert.equal(factDraftSchema(sources, true).safeParse(stale).success, false);
  const corrected = applyMemoryPreviewWrite(data, { kind: "revise_fact", basis: changed, draft: { ...stale, sourceChoice: "record-v2" }, sharedConfirmed: true }, context);
  assert.equal(corrected.facts[0].source.version, 2);
  assert.equal(factIsApplicable(corrected.facts[0]), true);
  const stillInactive = applyMemoryPreviewWrite(data, { kind: "revise_fact", basis: inactive, draft: { ...factDraftFrom(inactive, sources), reason: "Review old arrangement" }, sharedConfirmed: false }, context);
  assert.equal(stillInactive.facts[0].status, "inactive");
  assert.equal(factIsApplicable(stillInactive.facts[0]), false);
  const extended = applyMemoryPreviewWrite(data, { kind: "revise_fact", basis: expired,
    draft: { ...factDraftFrom(expired, sources), validUntil: "2099-12-31T23:59:00+08:00", reason: "Extend after review" }, sharedConfirmed: false }, context);
  assert.equal(extended.facts[0].applicable, true);
  assert.equal(extended.facts[0].confirmedBy, expired.confirmedBy);
  const deactivated = applyMemoryPreviewWrite(data, { kind: "deactivate_fact", basis: expired, reason: "No longer current" }, context);
  assert.equal(deactivated.facts[0].applicable, false);
  assert.equal(deactivated.facts[0].confirmedBy, expired.confirmedBy);
});

test("snapshot eligibility and confirmer metadata survive a client clock shifted by 24 hours", () => {
  const { data } = setup(true, true);
  const shared = data.facts.find(item => item.id.endsWith("-shared"));
  const expired = data.facts.find(item => item.id.endsWith("-private"));
  const pending = data.topics.find(item => item.status === "pending");
  const snoozed = data.topics.find(item => item.status === "snoozed");
  const originalNow = Date.now;
  try {
    for (const offset of [-24, 24]) {
      Date.now = () => now + offset * 60 * 60 * 1000;
      assert.equal(factIsApplicable(shared), false);
      assert.equal(factIsApplicable(expired), false);
      assert.equal(factUnavailableReason(expired).includes("已過期"), false);
      assert.equal(topicMayAsk(pending), true);
      assert.equal(topicMayAsk(snoozed), false);
    }
  } finally { Date.now = originalNow; }
  assert.equal(shared.authorSelf, false);
  assert.equal(shared.confirmedBy, `${childId}-memory-member-caregiver`);
  assert.match(factConfirmationLabel(shared), /member-caregiver.*2026-09-28/);
  assert.equal(data.factVersions[expired.id][0].confirmedBy, `${childId}-memory-member-owner`);
  assert.equal(data.factVersions[expired.id][1].confirmedBy, `${childId}-memory-member-caregiver`);
  assert.notEqual(data.factVersions[expired.id][0].confirmedAt, data.factVersions[expired.id][1].confirmedAt);
});

test("synthetic 50+1 pages cover facts, topics and both histories with final cursors", () => {
  const data = createMemoryPaginationSample(setup().data);
  const sampleFact = data.facts[0];
  const sampleTopic = data.topics[0];
  for (const items of [data.facts, data.topics, data.factVersions[sampleFact.id], data.topicVersions[sampleTopic.id]]) {
    assert.equal(items.length, 51);
    const first = syntheticMemoryPage(items, null);
    assert.equal(first.items.length, 50);
    assert.match(first.nextAfterId, /^fixture-/);
    const last = syntheticMemoryPage(items, first.nextAfterId);
    assert.equal(last.items.length, 1);
    assert.equal(last.nextAfterId, null);
    const keyOf = items === data.factVersions[sampleFact.id] || items === data.topicVersions[sampleTopic.id]
      ? item => String(item.version) : item => item.id;
    assert.equal(loadedMemoryPages(items, 1, keyOf).items.length, 50);
    assert.equal(loadedMemoryPages(items, 2, keyOf).items.length, 51);
    assert.equal(loadedMemoryPages(items, 2, keyOf).nextAfterId, null);
  }
  const changedFact = { ...data.facts[49], applicable: false, version: data.facts[49].version + 1 };
  const overlappedFacts = appendMemoryPage(data.facts.slice(0, 50), { items: [changedFact, data.facts[50]], nextAfterId: null }, item => item.id);
  assert.equal(overlappedFacts.items.length, 51);
  assert.deepEqual(overlappedFacts.items.find(item => item.id === changedFact.id), changedFact);
  const versions = data.factVersions[sampleFact.id];
  const overlappedVersions = appendMemoryPage(versions.slice(0, 50), { items: [versions[49], versions[50]], nextAfterId: null }, item => String(item.version));
  assert.equal(overlappedVersions.items.length, 51);
});

test("terminal topic reopening creates a linked topic and preserves the old terminal state", () => {
  const { data, context } = setup();
  const answered = data.topics.find(item => item.status === "answered");
  const snoozed = data.topics.find(item => item.status === "snoozed");
  assert.equal(topicMayAsk(answered), false);
  assert.equal(topicMayAsk(snoozed), false);
  assert.equal(topicDraftSchema("change", now).safeParse({ ...topicDraftFrom(snoozed), resumeAfter: "2026-09-01T09:00:00+08:00" }).success, false);
  assert.throws(() => applyMemoryPreviewWrite(data, { kind: "change_topic", basis: answered, draft: { ...topicDraftFrom(answered), status: "pending" } }, context));
  const reopened = applyMemoryPreviewWrite(data, { kind: "reopen_topic", basis: answered, reason: "New information needs discussion" }, context);
  assert.deepEqual(reopened.topics.find(item => item.id === answered.id), answered);
  assert.equal(reopened.topics[0].reopenedFrom, answered.id);
  assert.equal(reopened.topics[0].status, "pending");
  assert.equal(reopened.topics[0].mayAsk, true);
  assert.equal(reopened.topics[0].reopenReason, "New information needs discussion");
  const pending = data.topics.find(item => item.status === "pending");
  const paused = applyMemoryPreviewWrite(data, { kind: "change_topic", basis: pending,
    draft: { ...topicDraftFrom(pending), status: "snoozed", resumeAfter: "2099-12-31T09:00:00+08:00" } }, context);
  assert.equal(paused.topics[0].mayAsk, false);
  assert.throws(() => applyMemoryPreviewWrite(reopened, { kind: "reopen_topic", basis: answered, reason: "Duplicate" }, { ...context, nextId: "preview-second" }));
});
