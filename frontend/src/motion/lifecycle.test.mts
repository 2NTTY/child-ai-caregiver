import assert from "node:assert/strict";
import test from "node:test";
import { canApplyInitialPreference, isCurrentPresentation, planListProjection } from "./lifecycle.ts";

test("a committed swap can reveal only its own presentation", () => {
  const b = { generation: 2, scopeKey: "synthetic-A", epoch: 0 };
  assert.equal(isCurrentPresentation(b, b), true);
  assert.equal(isCurrentPresentation(b, { ...b, generation: 3 }), false, "B swapping must not adopt C's cover token");
  assert.equal(isCurrentPresentation(b, { ...b, generation: 4 }), false, "cancel invalidates a queued swap");
  assert.equal(isCurrentPresentation(b, { ...b, epoch: 1 }), false, "resize/background invalidates old geometry");
  assert.equal(isCurrentPresentation(b, { ...b, scopeKey: "synthetic-B" }), false, "child scope cannot inherit old presentation");
});

test("a native startup preference cannot overwrite a newer event or unmount", () => {
  assert.equal(canApplyInitialPreference(true, 0, 0), true);
  assert.equal(canApplyInitialPreference(true, 0, 1), false);
  assert.equal(canApplyInitialPreference(false, 0, 0), false);
});


test("reduced-motion removal hands off focus before same-scope rows drop", () => {
  const plan = planListProjection(["a", "b", "c"], ["a", "c"], "scope-a", "scope-a", false);
  assert.equal(plan.retainUntilLayout, true);
  assert.deepEqual(plan.focusRemovedIds, ["b"]);
  assert.equal(plan.animate, false);
  const changedScope = planListProjection(["a", "b", "c"], ["d"], "scope-a", "scope-b", true);
  assert.equal(changedScope.retainUntilLayout, false);
  assert.deepEqual(changedScope.focusRemovedIds, []);
});
