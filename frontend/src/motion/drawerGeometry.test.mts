import assert from "node:assert/strict";
import test from "node:test";
import { drawerGeometry } from "./drawerGeometry.ts";

test("dock edge and main workspace share one continuous boundary in both directions", () => {
  const stageWidth = 1224, width = 310;
  for (const progress of [0, 0.1, 0.5, 0.9, 1, 0.7, 0.3, 0]) {
    const geometry = drawerGeometry(width, progress, "dock");
    const mainRight = stageWidth - geometry.frameWidth;
    const drawerLeft = stageWidth - width + geometry.translateX;
    assert.ok(Math.abs(mainRight - drawerLeft) < 0.001, "the right-anchored live surface must meet the resized workspace");
    assert.ok(geometry.frameWidth >= 0 && geometry.frameWidth <= width);
  }
  assert.deepEqual(drawerGeometry(width, 1, "dock"), { frameWidth: width, translateX: 0 });
});

test("overlay never changes reserved width and exits wholly past its right edge", () => {
  const width = 294.4;
  for (const progress of [0, 0.25, 0.8, 1]) assert.equal(drawerGeometry(width, progress, "overlay").frameWidth, width);
  assert.deepEqual(drawerGeometry(width, 0, "overlay"), { frameWidth: width, translateX: width });
  assert.deepEqual(drawerGeometry(width, 1, "overlay"), { frameWidth: width, translateX: 0 });
});
