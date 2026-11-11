import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("care profile owner uses quiet background refresh without resetting unchanged form drafts", async () => {
  const source = await readFile(new URL("../frontend/src/production/CareProfileDomains.tsx", import.meta.url), "utf8");
  assert.match(source, /async function loadProfile\(recovery = false, quiet = false\)/u);
  assert.match(source, /if \(!quiet \|\| profileSnapshot\.current === null\)\s*\{\s*setProfile\(previous => \(\{ \.\.\.previous, reading: true/u);
  assert.match(source, /const applyReset = reset && \(!unchanged \|\| forceReset\);/u);
  assert.match(source, /loadProfile\(false, profileSnapshot\.current !== null\)/u);
});
