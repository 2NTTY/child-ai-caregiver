import assert from "node:assert/strict";
import test from "node:test";
import { createProactiveSettingsApi, firstEnableTimeZone, ProactiveSettingsError } from "../frontend/src/production/proactive-settings-api.ts";

test("proactive opt-in uses the selected child's endpoint with own-account header and exact CAS operation", async () => {
  const calls: { url: string; init?: RequestInit }[] = [], saved = { enabled: false, timeZone: "Asia/Hong_Kong", version: 0 };
  const api = createProactiveSettingsApi("https://synthetic.invalid/api", async (url, init) => {
    calls.push({ url: String(url), init });
    assert.equal(new Headers(init?.headers).get("x-expected-user-id"), "parent"); return Response.json(saved);
  });
  const signal = new AbortController().signal;
  assert.deepEqual(await api.read("child-a", "parent", signal), saved);
  const input = { enabled: true, timeZone: "Asia/Tokyo", expectedVersion: 0, opId: "11111111-1111-4111-8111-111111111111" };
  await api.save("child-a", "parent", signal, input);
  assert.equal(calls[0].url, "https://synthetic.invalid/api/children/child-a/proactive-settings");
  assert.equal(calls[0].init?.method, "GET"); assert.equal(calls[1].init?.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[1].init?.body)), input);
});

test("first opt-in adopts detected timezone while saved preferences retain their timezone", () => {
  assert.equal(firstEnableTimeZone({ enabled: false, timeZone: "Asia/Hong_Kong", version: 0 }, "Asia/Tokyo"), "Asia/Tokyo");
  assert.equal(firstEnableTimeZone({ enabled: false, timeZone: "Asia/Hong_Kong", version: 1 }, "Asia/Tokyo"), "Asia/Hong_Kong");
  assert.equal(firstEnableTimeZone({ enabled: false, timeZone: "Asia/Hong_Kong", version: 0 }, "invalid"), "Asia/Hong_Kong");
});

test("unknown proactive preference writes are never automatically replayed", async () => {
  let requests = 0;
  const api = createProactiveSettingsApi("https://synthetic.invalid", async () => { requests++; throw new Error("Synthetic lost response"); });
  await assert.rejects(api.save("child", "parent", new AbortController().signal, { enabled: true, timeZone: "Asia/Tokyo", expectedVersion: 0, opId: "11111111-1111-4111-8111-111111111111" }), ProactiveSettingsError);
  assert.equal(requests, 1);
});
