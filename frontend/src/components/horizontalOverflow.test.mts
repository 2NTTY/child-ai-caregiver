import assert from "node:assert/strict";
import test from "node:test";
import { horizontalOverflow, horizontalRevealOffset, nextHorizontalItem } from "./horizontalOverflow.ts";

test("only content overflowing the full row reserves the hint; right edge hides it", () => {
  assert.deepEqual(horizontalOverflow({ rowWidth: 300, viewportWidth: 252, contentWidth: 280, x: 0 }), { overflow: false, more: false });
  assert.deepEqual(horizontalOverflow({ rowWidth: 300, viewportWidth: 252, contentWidth: 600, x: 0 }), { overflow: true, more: true });
  assert.deepEqual(horizontalOverflow({ rowWidth: 300, viewportWidth: 252, contentWidth: 600, x: 348 }), { overflow: true, more: false });
  assert.deepEqual(horizontalOverflow({ rowWidth: 300, viewportWidth: 252, contentWidth: 600, x: 200 }), { overflow: true, more: true });
});

test("next item advances through rapid clicks before scroll events catch up", () => {
  const items = [0, 1, 2, 3].map(index => ({ key: String(index), x: index * 100, width: 90 }));
  const metrics = { rowWidth: 220, viewportWidth: 172, contentWidth: 390, x: 0 };
  assert.equal(nextHorizontalItem(items, metrics, null)?.key, "1");
  assert.equal(nextHorizontalItem(items, metrics, "1")?.key, "2");
  assert.equal(nextHorizontalItem(items, metrics, "2")?.key, "3");
  assert.equal(nextHorizontalItem([], metrics, null), undefined);
});

test("keyboard selection reveals either edge and clamps oversized or final items", () => {
  const metrics = { rowWidth: 300, viewportWidth: 252, contentWidth: 600, x: 200 };
  assert.equal(horizontalRevealOffset({ key: "first", x: 0, width: 90 }, metrics), 0);
  assert.equal(horizontalRevealOffset({ key: "visible", x: 220, width: 90 }, metrics), 200);
  assert.equal(horizontalRevealOffset({ key: "last", x: 510, width: 90 }, metrics), 348);
  assert.equal(horizontalRevealOffset({ key: "long", x: 100, width: 400 }, metrics), 100);
});
