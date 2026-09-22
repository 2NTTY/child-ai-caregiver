import assert from "node:assert/strict";
import test from "node:test";
import { resolveApiBaseUrl } from "../src/config/api-base-url.ts";

test("API configuration defaults to same-origin and supports an HTTPS deployment", () => {
  assert.equal(resolveApiBaseUrl(undefined), "/api");
  assert.equal(resolveApiBaseUrl("  "), "/api");
  assert.equal(resolveApiBaseUrl("https://care.example/api/"), "https://care.example/api");
});

test("API configuration supports local development without accepting remote cleartext", () => {
  for (const address of ["http://localhost:3001", "http://127.0.0.1:3001", "http://[::1]:3001/api"]) {
    assert.equal(resolveApiBaseUrl(address), address);
  }
  assert.throws(() => resolveApiBaseUrl("http://care.example"));
});

test("API configuration rejects credentials, query data, fragments and invalid schemes", () => {
  for (const address of ["//care.example", "javascript:alert(1)", "file:///api", "https://name:secret@care.example", "https://care.example?key=secret", "https://care.example#secret", "https://care.example/api?", "https://care.example/api#", "https://care.example/unrelated", "/other"]) {
    assert.throws(() => resolveApiBaseUrl(address), { message: "Invalid API base URL configuration" });
  }
});
