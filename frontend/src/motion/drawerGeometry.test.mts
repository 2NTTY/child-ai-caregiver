import assert from "node:assert/strict";
import test from "node:test";
import { drawerGeometry } from "./drawerGeometry.ts";

test("dock reserves only the terminal width while the surface translates inside it", () => {
  const width = 310;
  for (const progress of [0, 0.1, 0.5, 0.9, 1, 0.7, 0.3, 0]) {
    assert.equal(drawerGeometry(width, progress, "dock", true).frameWidth, width);
    assert.equal(drawerGeometry(width, progress, "dock", false).frameWidth, 0);
    assert.equal(drawerGeometry(width, progress, "dock", true).translateX, width * (1 - progress));
  }
});

test("overlay never changes reserved width and exits wholly past its right edge", () => {
  const width = 294.4;
  for (const progress of [0, 0.25, 0.8, 1]) assert.equal(drawerGeometry(width, progress, "overlay", true).frameWidth, width);
  assert.deepEqual(drawerGeometry(width, 0, "overlay", false), { frameWidth: width, translateX: width });
  assert.deepEqual(drawerGeometry(width, 1, "overlay", true), { frameWidth: width, translateX: 0 });
});
