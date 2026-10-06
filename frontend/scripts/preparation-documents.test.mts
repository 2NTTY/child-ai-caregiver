import assert from "node:assert/strict";
import { test } from "node:test";
import {
  archivePreparation, canChangePreparation, checkPreparationItem, preparationAuthorityKey, preparationDateLabel,
  projectPreparations, searchPreparationHistory, type PreparationScope,
} from "../src/preparation-view-model.ts";
import { createPreparationFixture } from "../src/preview/preparation-fixture.ts";
import type { HomeChild } from "../src/view-model.ts";

const children: HomeChild[] = [
  { id: "preview-child-1", displayName: "甲", ageLabel: "未提供", regionLabel: "香港", allergiesLabel: null, profileConfirmed: true, accessRole: "owner" },
  { id: "preview-child-2", displayName: "乙", ageLabel: "未提供", regionLabel: "香港", allergiesLabel: null, profileConfirmed: true, accessRole: "caregiver" },
];
const authorityKey = preparationAuthorityKey("preview-parent", children);
const scope: PreparationScope = { authorityKey, childId: children[0]!.id, role: "owner", online: true, condition: "ready" };
const input = (documentId: string, expectedVersion = 1) => ({ authorityKey, childId: scope.childId, documentId, expectedVersion, at: "2026-10-05T16:05:00Z" });
const fixture = () => createPreparationFixture(authorityKey, children);

test("one owner exposes four purposes plus an archived document for the authorized child only", () => {
  const state = fixture(), projection = projectPreparations(state, scope);
  assert.equal(projection.length, 5);
  assert.deepEqual(projection.filter(document => document.status === "active").map(document => document.purpose), ["appointment", "school", "outing", "handoff"]);
  assert.ok(projection.every(document => document.childId === scope.childId));
  assert.ok(projection.every(document => document.sources.every(source => source.provenance === "synthetic_preview")));
  assert.equal(createPreparationFixture(authorityKey, [{ ...children[0]!, id: "new-child" }]).documents.length, 0);
});

test("archive changes only the selected document, reuses its frozen revision and is immediately searchable", () => {
  const state = fixture(), document = state.documents[0]!, revision = document.revisions[0]!;
  const next = archivePreparation(state, scope, input(document.id));
  assert.equal(next.documents.length, state.documents.length);
  assert.equal(state.documents[0]!.status, "active");
  assert.equal(next.documents[0]!.status, "archived");
  assert.equal(next.documents[0]!.archivedRevisionId, revision.id);
  assert.equal(next.documents[0]!.revisions, document.revisions);
  assert.ok(next.documents.slice(1).every((item, index) => item === state.documents[index + 1]));
  const projected = projectPreparations(next, scope);
  assert.equal(projected.filter(item => item.status === "active").length, 3);
  assert.equal(searchPreparationHistory(projected, "到診", { from: "2026-10-06", to: "2026-10-06" })[0]?.id, document.id);
});

test("checklist changes create a new revision while preserving the earlier snapshot", () => {
  const state = fixture(), document = state.documents[0]!, original = document.revisions[0]!;
  const changed = checkPreparationItem(state, scope, { ...input(document.id), sectionId: "checklist", itemId: "check-0", checked: true });
  assert.equal(changed.documents[0]!.revisions.length, 2);
  assert.equal(changed.documents[0]!.revisions[0], original);
  assert.equal(original.sections[2]!.items[0]!.checked, false);
  assert.equal(changed.documents[0]!.revisions[1]!.sections[2]!.items[0]!.checked, true);
  const archived = archivePreparation(changed, scope, input(document.id, 2));
  assert.equal(projectPreparations(archived, scope)[0]!.revision?.number, 2);
  assert.equal(checkPreparationItem(archived, scope, { ...input(document.id, 3), sectionId: "checklist", itemId: "check-0", checked: false }), archived);
});

test("stale versions, foreign documents, repeated archive, and non-checklist item IDs cannot mutate", () => {
  const state = fixture(), document = state.documents[0]!;
  assert.equal(archivePreparation(state, scope, input(document.id, 0)), state);
  assert.equal(archivePreparation(state, scope, input(state.documents[5]!.id)), state);
  assert.equal(archivePreparation(state, scope, { ...input(document.id), at: "2026-10-05T12:00:00" }), state);
  assert.equal(checkPreparationItem(state, scope, { ...input(document.id), sectionId: "questions", itemId: "question-0", checked: true }), state);
  const archived = archivePreparation(state, scope, input(document.id));
  assert.equal(archivePreparation(archived, scope, input(document.id, 2)), archived);
});

test("identity, server, child authorization and role changes invalidate the old authority before reading", () => {
  const state = fixture();
  for (const changedAuthority of [preparationAuthorityKey("other-parent", children), preparationAuthorityKey("preview-parent", children, "other-server"),
    preparationAuthorityKey("preview-parent", children.slice(1)), preparationAuthorityKey("preview-parent", children.map(child => ({ ...child, accessRole: "viewer" })))]) {
    assert.deepEqual(projectPreparations(state, { ...scope, authorityKey: changedAuthority }), []);
    assert.equal(archivePreparation(state, { ...scope, authorityKey: changedAuthority }, input(state.documents[0]!.id)), state);
  }
  assert.ok(projectPreparations(state, { ...scope, childId: children[1]!.id, role: "caregiver" }).every(item => item.childId === children[1]!.id));
  assert.deepEqual(projectPreparations(state, { ...scope, childId: "no-access" }), []);
});

test("source revocation and invalidation mask both active and frozen archived content", () => {
  const state = fixture();
  for (const condition of ["private_revoked", "source_invalidated", "unknown"] as const) {
    const restrictedScope = { ...scope, condition }, documents = projectPreparations(state, restrictedScope);
    assert.equal(documents.length, 5);
    assert.ok(documents.every(document => document.revision === null && document.sources.length === 0));
    assert.equal(searchPreparationHistory(documents, "公園", { from: null, to: null }).length, 0);
    assert.equal(archivePreparation(state, restrictedScope, input(state.documents[0]!.id)), state);
  }
  const removedSource = { ...state, sources: [] };
  assert.ok(projectPreparations(removedSource, scope).every(document => document.readState === "unknown" && !document.revision));
});

test("source version changes preserve a labelled old snapshot but cannot save or archive", () => {
  const state = fixture(), changedScope = { ...scope, condition: "source_changed" as const };
  const documents = projectPreparations(state, changedScope);
  assert.ok(documents.every(document => document.readState === "stale" && !!document.revision));
  assert.ok(documents.every(document => !canChangePreparation(document, changedScope)));
  assert.equal(archivePreparation(state, changedScope, input(documents[0]!.id)), state);
});

test("offline, viewer, unknown and read-only states never permit a local mutation", () => {
  const state = fixture(), document = state.documents[0]!;
  for (const changedScope of [{ ...scope, online: false }, { ...scope, role: "viewer" as const }, { ...scope, condition: "read_only" as const }, { ...scope, condition: "unknown" as const }]) {
    assert.equal(archivePreparation(state, changedScope, input(document.id)), state);
    assert.equal(checkPreparationItem(state, changedScope, { ...input(document.id), sectionId: "checklist", itemId: "check-0", checked: true }), state);
  }
  for (const condition of ["loading", "unavailable", "lost", "empty"] as const) assert.deepEqual(projectPreparations(state, { ...scope, condition }), []);
});

test("history searches body, purpose and accessible source labels but does not search active documents", () => {
  const documents = projectPreparations(fixture(), scope), range = { from: null, to: null };
  assert.equal(searchPreparationHistory(documents, "公園", range).length, 1);
  assert.equal(searchPreparationHistory(documents, "外出／旅行", range).length, 1);
  assert.equal(searchPreparationHistory(documents, "過往準備單版面示例", range).length, 1);
  assert.equal(searchPreparationHistory(documents, "到診", range).length, 0);
  assert.equal(searchPreparationHistory(documents, "乙", range).length, 0);
});

test("history date filtering uses inclusive archive dates in Hong Kong and excludes unknown dates only when filtered", () => {
  const documents = projectPreparations(fixture(), scope);
  assert.equal(searchPreparationHistory(documents, "", { from: "2026-09-27", to: "2026-09-27" }).length, 1);
  assert.equal(searchPreparationHistory(documents, "", { from: "2026-09-28", to: null }).length, 0);
  const missing = documents.map(document => ({ ...document, archivedAt: null }));
  assert.equal(searchPreparationHistory(missing, "", { from: null, to: null }).length, 1);
  assert.equal(searchPreparationHistory(missing, "", { from: "2026-01-01", to: null }).length, 0);
  assert.equal(preparationDateLabel(null), "日期未提供");
  assert.equal(preparationDateLabel("invalid"), "日期未提供");
});
