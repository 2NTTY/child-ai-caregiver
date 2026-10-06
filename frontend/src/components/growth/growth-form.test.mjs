import assert from "node:assert/strict";
import test from "node:test";
import { growthSourceUrl } from "../../growth-view-model.ts";

// Form-only assertions are preserved byte-for-byte beside the archived form snapshot.
// Keep the active source URL safety guard covered at its existing test entry.
test("Growth source links remain restricted to credential-free HTTPS", () => {
  for (const url of ["javascript:alert(1)", "http://example.com", "https://user:pass@example.com", " https://example.com"]) {
    assert.equal(growthSourceUrl(url), null);
  }
  assert.equal(growthSourceUrl("https://www.fhs.gov.hk/"), "https://www.fhs.gov.hk/");
});
