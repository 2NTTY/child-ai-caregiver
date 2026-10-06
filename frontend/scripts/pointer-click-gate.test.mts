import assert from "node:assert/strict";
import { test } from "node:test";
import { createPointerClickGate } from "../src/components/navigation/pointer-click-gate.ts";

// Every binding represents an effect instance; the mounted control retains its gate.
function bindListeners(gate: ReturnType<typeof createPointerClickGate>) {
  return {
    pointerDown: () => gate.beginActivation(),
    dragReleaseOrCancel: () => gate.suppressNextClick(),
    pointerClick: () => gate.consumeClick(),
    keyboardActivate: () => { gate.beginActivation(); return gate.consumeClick(); },
  };
}

test("navigation scope listener replacement preserves and consumes one trailing drag click", () => {
  const gate = createPointerClickGate(); let listeners = bindListeners(gate);
  listeners.pointerDown(); listeners.dragReleaseOrCancel();
  // pointerup navigates from / to /more before the compatibility click arrives.
  listeners = bindListeners(gate);
  assert.equal(listeners.pointerClick(), true);
  assert.equal(listeners.pointerClick(), false);
});

test("cancel or drag back suppresses the trailing click but a fresh pointer tap is restored", () => {
  const gate = createPointerClickGate(); const listeners = bindListeners(gate);
  listeners.pointerDown(); listeners.dragReleaseOrCancel();
  assert.equal(listeners.pointerClick(), true);
  listeners.pointerDown(); listeners.dragReleaseOrCancel();
  // Cancellation need not produce a click; a later real pointerdown starts a new tap.
  listeners.pointerDown(); assert.equal(listeners.pointerClick(), false);
});

test("Enter or assistive activation is not consumed by an earlier cancelled pointer", () => {
  const gate = createPointerClickGate(); let listeners = bindListeners(gate);
  listeners.pointerDown(); listeners.dragReleaseOrCancel();
  listeners = bindListeners(gate);
  assert.equal(listeners.keyboardActivate(), false);
  assert.equal(listeners.pointerClick(), false);
});
