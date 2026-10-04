import assert from "node:assert/strict";
import test from "node:test";
import { readStoredReducedMotion, resolveReducedMotion } from "./preferencePolicy.ts";

test("manual reduction supplements but cannot disable the system preference", () => {
  assert.equal(resolveReducedMotion(false, false), false);
  assert.equal(resolveReducedMotion(false, true), true);
  assert.equal(resolveReducedMotion(true, false), true);
  assert.equal(resolveReducedMotion(true, true), true);
  assert.equal(resolveReducedMotion(null, false), true);
});

test("only the versioned opt-in value enables local reduction", () => {
  assert.equal(readStoredReducedMotion("1"), true);
  for (const value of [null, "", "0", "true", "invalid"]) assert.equal(readStoredReducedMotion(value), false);
});
