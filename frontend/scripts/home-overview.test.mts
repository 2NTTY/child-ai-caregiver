import assert from "node:assert/strict";
import { test } from "node:test";
import { createPreviewModel } from "../src/preview/fixture.ts";
import { selectHomeAgentImportant, selectHomeOverview } from "../src/home-overview.ts";
import type { HomeViewModel } from "../src/view-model.ts";
const model: HomeViewModel = {
  caregiverName: "Test", children: [{ id: "a", displayName: "A", ageLabel: "未知", regionLabel: "未提供", allergiesLabel: null, profileConfirmed: false }],
  selectedChildId: "a", connection: "online", recordsLoad: "ready", profileLoad: "ready", records: [], lastReadLabel: null,
  operation: { state: "none", title: "", detail: "" }, guideStatus: "complete",
};
test("missing and mismatched projections never become an empty or previous child's overview", () => {
  assert.equal(selectHomeOverview(model)?.attention.state, "unavailable");
  assert.equal(selectHomeOverview({ ...model, selectedChildId: "b" }), null);
  assert.equal(selectHomeOverview({ ...model, overview: { childId: "b", attention: { state: "ready", items: [] }, ongoing: { state: "ready", items: [] } },
    focus: { kind: "task", title: "Old child", detail: "Hidden", action: { label: "View", destination: "tasks" } } })?.attention.state, "unavailable");
});
test("home and rail receive the same projection, order, identifiers and state", () => {
  const overview = { childId: "a", attention: { state: "ready" as const, items: [
    { id: "review", title: "Review", detail: "", statusLabel: "Review first", action: { label: "View", destination: "tasks" as const } },
    { id: "due", title: "Due", detail: "", statusLabel: "Explicitly supplied", action: { label: "View", destination: "tasks" as const } },
  ] }, ongoing: { state: "ready" as const, items: [] } };
  assert.strictEqual(selectHomeOverview({ ...model, overview }), overview);
  assert.deepEqual(selectHomeOverview({ ...model, overview })?.attention.items.map(item => item.id), ["review", "due"]);
});
test("legacy focus remains usable without deriving ongoing topics from records", () => {
  const selected = selectHomeOverview({ ...model, focus: { kind: "none", detail: "Explicit empty" } });
  assert.equal(selected?.attention.state, "ready");
  assert.equal(selected?.ongoing.state, "unavailable");
});

test("deleting the selected child derives both home and rail from the remaining child, including refresh", () => {
  const changes = { deletedChildIds: ["preview-child-1"] };
  const afterDeletion = createPreviewModel("focus_task", "preview-child-1", "complete", changes);
  assert.equal(afterDeletion.selectedChildId, "preview-child-2");
  assert.equal(afterDeletion.overview?.childId, "preview-child-2");
  assert.ok(afterDeletion.overview!.attention.items.length > 0);
  assert.ok(afterDeletion.overview!.attention.items.every(item => item.id.startsWith("preview-child-2")));
  assert.ok(afterDeletion.overview!.ongoing.items.every(item => item.id.startsWith("preview-child-2")));
  assert.ok(afterDeletion.records.every(record => record.childId !== "preview-child-1"));
  assert.strictEqual(selectHomeOverview(afterDeletion), afterDeletion.overview);
  const loading = createPreviewModel("loading", "preview-child-1", "complete", changes);
  assert.equal(selectHomeOverview(loading)?.childId, "preview-child-2");
  assert.equal(selectHomeOverview(loading)?.attention.state, "loading");
  assert.equal(selectHomeOverview(createPreviewModel("focus_task", "preview-child-1", "complete", changes))?.attention.state, "ready");
});
test("deleting the final child clears the projection; a newly created child gets only its own empty overview", () => {
  const deletedChildIds = ["preview-child-1", "preview-child-2"];
  const empty = createPreviewModel("focus_task", "preview-child-1", "complete", { deletedChildIds });
  assert.equal(empty.selectedChildId, null); assert.equal(empty.overview, undefined); assert.equal(selectHomeOverview(empty), null);
  const created = { ...model.children[0], id: "preview-new-child-1" };
  const next = createPreviewModel("focus_task", created.id, "complete", { deletedChildIds, createdChildren: [created] });
  assert.equal(next.selectedChildId, created.id); assert.equal(next.overview?.childId, created.id);
  assert.deepEqual(next.overview?.attention.items, []); assert.deepEqual(next.overview?.ongoing.items, []);
  const firstCreated = createPreviewModel("empty", created.id, "incomplete", { createdChildren: [created] });
  assert.equal(firstCreated.overview?.childId, created.id);
  assert.equal(selectHomeOverview(firstCreated)?.attention.state, "ready");
  assert.deepEqual(firstCreated.overview?.attention.items, []);
});

test("tasks and legacy focus never become Agent important items", () => {
  const taskFocus: HomeViewModel = { ...model, focus: { kind: "task", title: "A task", detail: "Not Agent selected",
    action: { label: "View", destination: "tasks" } } };
  assert.equal(selectHomeOverview(taskFocus)?.attention.items.length, 1);
  assert.equal(selectHomeAgentImportant(taskFocus)?.state, "unavailable");
  assert.deepEqual(selectHomeAgentImportant(taskFocus)?.items, []);
  const taskOnly: HomeViewModel = { ...model, overview: selectHomeOverview(taskFocus)! };
  assert.equal(selectHomeAgentImportant(taskOnly)?.state, "unavailable");
  assert.deepEqual(selectHomeAgentImportant(taskOnly)?.items, []);
});

test("Agent read failure, loading, missing data and a confirmed empty snapshot remain distinct", () => {
  assert.equal(selectHomeAgentImportant(model)?.state, "unavailable");
  for (const state of ["ready", "loading", "error", "unavailable"] as const) {
    const agentImportant = { state, items: [], loadedAt: state === "ready" ? "2026-10-04T01:05:00Z" : null };
    const current: HomeViewModel = { ...model, overview: { childId: "a", agentImportant,
      attention: { state: "ready", items: [] }, ongoing: { state: "ready", items: [] } } };
    assert.strictEqual(selectHomeAgentImportant(current), agentImportant);
    assert.equal(selectHomeAgentImportant(current)?.state, state);
  }
});

test("Agent projections never leak a previous or inaccessible child's items", () => {
  const previous = createPreviewModel("normal", "preview-child-1", "complete");
  assert.equal(selectHomeAgentImportant(previous)?.items.length, 1);
  const changed = { ...previous, selectedChildId: "preview-child-2" };
  assert.equal(selectHomeAgentImportant(changed)?.state, "unavailable");
  assert.deepEqual(selectHomeAgentImportant(changed)?.items, []);
  assert.equal(selectHomeAgentImportant({ ...previous, children: [] }), null);
  assert.equal(selectHomeAgentImportant({ ...previous, selectedChildId: null }), null);
  const refreshed = createPreviewModel("normal", "preview-child-2", "complete");
  assert.ok(selectHomeAgentImportant(refreshed)?.items.every(item => item.id.startsWith("preview-child-2:")));
  const newlyCreated = createPreviewModel("empty", "preview-new-child-1", "incomplete", {
    createdChildren: [{ ...model.children[0], id: "preview-new-child-1" }],
  });
  assert.equal(selectHomeAgentImportant(newlyCreated)?.state, "ready");
  assert.deepEqual(selectHomeAgentImportant(newlyCreated)?.items, []);
});

test("Agent supplied order, original references and unknown outcomes are preserved", () => {
  const current = createPreviewModel("unknown", "preview-child-1", "complete");
  const unknown = current.overview!.agentImportant!.items[0];
  const later = { ...unknown, id: "later", source: { ...unknown.source, createdAt: "2026-10-05T01:00:00Z" } };
  const earlier = { ...unknown, id: "earlier", source: { ...unknown.source, createdAt: "2026-10-03T01:00:00Z" } };
  const agentImportant = { ...current.overview!.agentImportant!, items: [earlier, later] };
  const selected = selectHomeAgentImportant({ ...current, overview: { ...current.overview!, agentImportant } });
  assert.strictEqual(selected, agentImportant);
  assert.deepEqual(selected?.items.map(item => item.id), ["earlier", "later"]);
  assert.equal(selected?.items[0].source.status, "unknown");
  assert.equal(selected?.items[0].statusLabel, "結果未知");
  assert.equal(selected?.items[0].proposal, undefined);
  assert.equal(selected?.items[0].source.runId, unknown.source.runId);
  assert.equal(selected?.loadedAt, agentImportant.loadedAt);
  assert.equal(selected?.synthetic, true);
});

test("synthetic Agent selections remain independent of the sidebar task projection", () => {
  const current = createPreviewModel("focus_task", "preview-child-1", "complete");
  const overview = current.overview!;
  assert.ok(overview.attention.items.length > 0);
  assert.equal(overview.agentImportant?.synthetic, true);
  assert.equal(overview.agentImportant?.items.length, 1);
  assert.ok(overview.agentImportant?.items.every(item => !overview.attention.items.some(task => task.id === item.id)));
  assert.match(overview.agentImportant!.items[0].sourceLabel!, /合成/);
  assert.equal(overview.agentImportant?.items[0].action.destination, "chat");
});
