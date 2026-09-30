import assert from "node:assert/strict";
import test from "node:test";
import { handleWebPushRequest } from "../server/web-push-api.ts";
import { FamilyError } from "../server/family-access.ts";
import type { WebPushStore } from "../server/web-push-store.ts";
import type { PushBinding, PushDelivery, WebPushStatus } from "../src/shared/web-push.ts";

const bindingId = "a4ac4d4e-4ce6-4b65-82ba-5482549336da";
const binding: PushBinding = { id: bindingId, version: 7, status: "active", provider: "fcm", label: "Synthetic browser",
  endpointHash: "a".repeat(64), vapidPublicKey: "synthetic-public-key", expiresAt: null,
  createdAt: "2026-09-28T00:00:00.000Z", updatedAt: "2026-09-28T00:00:00.000Z" };
const delivery: PushDelivery = { id: "b3ad5662-5557-4b9d-8c92-1f7a1b02f94f", bindingId, status: "queued", reason: null,
  providerStatus: null, createdAt: "2026-09-28T00:00:00.000Z", attemptedAt: null, finishedAt: null };
const status: WebPushStatus = { userId: "owner", available: true, workerEnabled: true, publicKey: binding.vapidPublicKey,
  supportedProviders: ["fcm", "mozilla"], bindings: [binding], deliveries: [delivery], testsRemaining: 2, nextTestAt: null };
const registration = { label: " Synthetic browser ", subscription: { endpoint: "https://fcm.googleapis.com/fcm/send/synthetic-token",
  keys: { p256dh: "A".repeat(87), auth: "A".repeat(22) }, expirationTime: null } };
const route = (action: string) => `/api/web-push/subscriptions/${bindingId}/${action}`;
function request(path: string, body?: unknown, options: { expectedUserId?: string; contentType?: string; method?: string } = {}): Request {
  const headers: Record<string, string> = { "content-type": options.contentType ?? "application/json; charset=utf-8" };
  if (options.expectedUserId !== "") headers["x-expected-user-id"] = options.expectedUserId ?? "owner";
  return new Request(`http://localhost${path}?userId=forged`, { method: options.method ?? (body === undefined ? "GET" : "POST"),
    headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
function storeWith(overrides: Partial<WebPushStore> = {}): WebPushStore {
  return new Proxy(overrides as WebPushStore, { get(target, property) {
    if (property in target) return Reflect.get(target, property);
    return () => { throw new Error(`Unexpected web push store access: ${String(property)}`); };
  } });
}
async function error(response: Response, statusCode: number, code: string) {
  assert.equal(response.status, statusCode);
  assert.equal((await response.json()).error.code, code);
}

test("web push GET and mutations check session and expected account before storage", async () => {
  for (const [path, body] of [["/api/web-push", undefined], ["/api/web-push/subscriptions", registration]] as const) {
    await error(await handleWebPushRequest(request(path, body), null, storeWith(), true), 401, "unauthorized");
    await error(await handleWebPushRequest(request(path, body, { expectedUserId: "" }), "owner", storeWith(), true), 428, "account_precondition_required");
    await error(await handleWebPushRequest(request(path, body, { expectedUserId: "other" }), "owner", storeWith(), true), 409, "session_changed");
  }
});

test("web push GET reads only the logged-in owner and returns an uncached status", async () => {
  const calls: string[] = [];
  const response = await handleWebPushRequest(request("/api/web-push"), "owner", storeWith({ status: async userId => {
    calls.push(userId); return status;
  } }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), status);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(calls, ["owner"]);
});

test("web push mutations require receipt dispatch before storage", async () => {
  for (const [path, body] of [["/api/web-push/subscriptions", registration], [route("revoke"), { expectedVersion: 7 }],
    [route("test"), { expectedVersion: 7, confirmImmediate: true }]] as const) {
    await error(await handleWebPushRequest(request(path, body), "owner", storeWith()), 428, "online_operation_required");
  }
});

test("web push routes reject malformed JSON, media type and strict input before storage", async () => {
  await error(await handleWebPushRequest(request("/api/web-push/subscriptions", registration, { contentType: "text/plain" }),
    "owner", storeWith(), true), 415, "unsupported_media_type");
  const malformed = new Request("http://localhost/api/web-push/subscriptions", { method: "POST",
    headers: { "content-type": "application/json", "x-expected-user-id": "owner" }, body: "{" });
  await error(await handleWebPushRequest(malformed, "owner", storeWith(), true), 400, "invalid_json");
  const invalid: [string, unknown][] = [
    ["/api/web-push/subscriptions", { ...registration, userId: "forged" }],
    ["/api/web-push/subscriptions", { ...registration, label: " " }],
    ["/api/web-push/subscriptions", { ...registration, subscription: { ...registration.subscription, extra: true } }],
    ["/api/web-push/subscriptions", { ...registration, subscription: { ...registration.subscription,
      keys: { ...registration.subscription.keys, auth: "short" } } }],
    [route("revoke"), { expectedVersion: 0 }], [route("revoke"), { expectedVersion: 1.5 }],
    [route("revoke"), { expectedVersion: 7, extra: true }], [route("test"), { expectedVersion: 7 }],
    [route("test"), { expectedVersion: 7, confirmImmediate: false }],
    [route("test"), { expectedVersion: 7, confirmImmediate: true, extra: true }],
  ];
  for (const [path, body] of invalid) await error(await handleWebPushRequest(request(path, body), "owner", storeWith(), true), 400, "invalid_input");
});

test("web push registration, revoke and confirmed test forward identity and versions", async () => {
  const calls: unknown[][] = [];
  const store = storeWith({
    register: async (userId, input) => { calls.push(["register", userId, input]); return binding; },
    revoke: async (userId, id, version) => { calls.push(["revoke", userId, id, version]); return { ...binding, status: "revoked" }; },
    test: async (userId, id, version) => { calls.push(["test", userId, id, version]); return delivery; },
  });
  const registered = await handleWebPushRequest(request("/api/web-push/subscriptions", registration), "owner", store, true);
  assert.equal(registered.status, 201);
  assert.deepEqual(await registered.json(), { binding });
  const revoked = await handleWebPushRequest(request(route("revoke"), { expectedVersion: 7 }), "owner", store, true);
  assert.equal(revoked.status, 200);
  assert.deepEqual(await revoked.json(), { binding: { ...binding, status: "revoked" } });
  const tested = await handleWebPushRequest(request(route("test"), { expectedVersion: 9, confirmImmediate: true }), "owner", store, true);
  assert.equal(tested.status, 201);
  assert.deepEqual(await tested.json(), { delivery });
  assert.deepEqual(calls, [["register", "owner", { ...registration, label: "Synthetic browser" }],
    ["revoke", "owner", bindingId, 7], ["test", "owner", bindingId, 9]]);
});

test("case-insensitive revoke routes cannot dispatch the test operation", async () => {
  const calls: unknown[][] = [];
  const store = storeWith({ revoke: async (userId, id, version) => {
    calls.push([userId, id, version]); return { ...binding, status: "revoked" };
  } });
  const revoked = await handleWebPushRequest(request(route("REVOKE"), { expectedVersion: 7 }), "owner", store, true);
  assert.equal(revoked.status, 200);
  await error(await handleWebPushRequest(request(route("REVOKE"), { expectedVersion: 7, confirmImmediate: true }),
    "owner", store, true), 400, "invalid_input");
  assert.deepEqual(calls, [["owner", bindingId, 7]]);
});

test("web push routes preserve store authorization and version conflict codes", async () => {
  for (const [statusCode, code] of [[404, "not_found"], [409, "version_conflict"], [409, "push_unavailable"]] as const) {
    const response = await handleWebPushRequest(request(route("test"), { expectedVersion: 7, confirmImmediate: true }),
      "owner", storeWith({ test: async () => { throw new FamilyError(statusCode, code); } }), true);
    await error(response, statusCode, code);
  }
});

test("web push unknown routes, methods and invalid binding IDs avoid storage", async () => {
  for (const req of [request("/api/web-push/unknown"), request("/api/web-push", undefined, { method: "DELETE" }),
    request("/api/web-push/subscriptions/not-a-uuid/test", { expectedVersion: 7, confirmImmediate: true }),
    request(`/api/web-push/subscriptions/${"a".repeat(36)}/revoke`, { expectedVersion: 7 })]) {
    await error(await handleWebPushRequest(req, "owner", storeWith(), true), 404, "not_found");
  }
});
