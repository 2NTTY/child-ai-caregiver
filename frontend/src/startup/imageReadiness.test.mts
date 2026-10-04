import assert from "node:assert/strict";
import test from "node:test";
import { firstScreenImagesSettled, requiredFirstScreenImages, settleFirstScreenImage } from "./imageReadiness.ts";

test("only visible first-screen artwork blocks startup", () => {
  assert.deepEqual(requiredFirstScreenImages("/", 390), ["home-hero"]);
  assert.deepEqual(requiredFirstScreenImages("/login", 1440), ["login-hero"]);
  assert.deepEqual(requiredFirstScreenImages("/login", 390), []);
  assert.deepEqual(requiredFirstScreenImages("/chat", 1440), []);
});

test("pending images cannot finish startup, while explicit fallback can", () => {
  assert.equal(firstScreenImagesSettled(["home-hero"], {}), false);
  const loaded = settleFirstScreenImage({}, "home-hero", "loaded");
  assert.equal(firstScreenImagesSettled(["home-hero"], loaded), true);
  const failed = settleFirstScreenImage({}, "home-hero", "fallback");
  assert.equal(firstScreenImagesSettled(["home-hero"], failed), true);
  assert.equal(failed["home-hero"], "fallback");
});

test("late load cannot replace a fallback or make failed artwork pop in", () => {
  const failed = settleFirstScreenImage({}, "home-hero", "fallback");
  assert.equal(settleFirstScreenImage(failed, "home-hero", "loaded"), failed);
  const loaded = settleFirstScreenImage({}, "home-hero", "loaded");
  assert.equal(settleFirstScreenImage(loaded, "home-hero", "fallback"), loaded);
});
