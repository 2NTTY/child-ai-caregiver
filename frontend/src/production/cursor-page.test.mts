import assert from "node:assert/strict";
import test from "node:test";
import { appendCursorItems, cursorBoundary } from "./cursor-page.ts";

test("empty partial pages retain continuation and malformed boundaries cannot claim completion", () => {
  assert.deepEqual(cursorBoundary({ hasMore: true, nextCursor: "next" }), { hasMore: true, nextCursor: "next" });
  for (const page of [{ hasMore: true }, { hasMore: false, nextCursor: "next" }, { hasMore: true, nextCursor: "previous" }]) {
    assert.throws(() => cursorBoundary(page, "previous"), /invalid_page_cursor/);
  }
  assert.deepEqual(cursorBoundary({}), { hasMore: false, nextCursor: null }, "Legacy complete lists remain compatible");
});

test("overlapping continuation updates rows without losing loaded entries", () => {
  assert.deepEqual(appendCursorItems([{ id: "a", version: 1 }, { id: "b", version: 1 }], [{ id: "b", version: 2 }, { id: "c", version: 1 }]),
    [{ id: "a", version: 1 }, { id: "b", version: 2 }, { id: "c", version: 1 }]);
});
