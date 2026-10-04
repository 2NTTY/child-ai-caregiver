import assert from "node:assert/strict";
import { test } from "node:test";
import { createHomeAgentPhotoHandoff, homeAgentScope } from "../src/home-agent-entry.ts";
import type { PhotoOriginal } from "../src/photo-view-model.ts";

function original(onDispose: () => void): PhotoOriginal {
  return { fileName: "synthetic.png", mimeType: "image/png", bytes: 10, sha256: "synthetic", imageSource: { uri: "synthetic-only" }, dispose: onDispose };
}
const context = { caregiverName: "Synthetic caregiver", selectedChildId: "a", children: [
  { id: "a", displayName: "A", ageLabel: "未知", regionLabel: "未提供", allergiesLabel: null, profileConfirmed: false, accessRole: "owner" as const },
] };

test("capture scope requires the selected child and changes with identity or access", () => {
  const scope = homeAgentScope(context);
  assert.ok(scope);
  assert.equal(homeAgentScope({ ...context, selectedChildId: "missing" }), null);
  assert.notEqual(homeAgentScope({ ...context, caregiverName: "Other caregiver" }), scope);
  assert.notEqual(homeAgentScope({ ...context, children: [{ ...context.children[0], accessRole: "viewer" }] }), scope);
});

test("a photo transfers once and disposal belongs to the composer after taking it", () => {
  const handoff = createHomeAgentPhotoHandoff();
  let disposed = 0;
  const photo = original(() => disposed++);
  handoff.stage("a", photo);
  assert.equal(handoff.take("a"), photo);
  assert.equal(handoff.take("a"), null);
  handoff.clear();
  assert.equal(disposed, 0);
  photo.dispose?.();
  assert.equal(disposed, 1);
});

test("replacement and cancelled handoffs release their local photo exactly once", () => {
  const handoff = createHomeAgentPhotoHandoff();
  let firstDisposed = 0, secondDisposed = 0;
  const first = original(() => firstDisposed++), second = original(() => secondDisposed++);
  handoff.stage("a", first);
  handoff.stage("a", first);
  assert.equal(firstDisposed, 0);
  handoff.stage("a", second);
  assert.equal(firstDisposed, 1);
  handoff.clear(); handoff.clear();
  assert.equal(secondDisposed, 1);
  assert.equal(handoff.take("a"), null);
});

test("changed or missing scope drops a pending photo instead of exposing it to another child", () => {
  const handoff = createHomeAgentPhotoHandoff();
  let disposed = 0;
  handoff.stage("a", original(() => disposed++));
  assert.equal(handoff.take("b"), null);
  assert.equal(disposed, 1);
  handoff.stage("a", original(() => disposed++));
  handoff.retainScope("a");
  assert.equal(disposed, 1);
  handoff.retainScope(null);
  assert.equal(handoff.take("a"), null);
  assert.equal(disposed, 2);
});
