import assert from "node:assert/strict";
import test from "node:test";
import { createWebPushApi, WebPushApiError } from "../src/client/web-push-api.ts";
import type { PushBinding, PushDelivery, PushRegistrationInput, WebPushStatus } from "../src/shared/web-push.ts";

const bindingId = "15eb043b-d7a9-4b1c-afc1-25d1a92a2dca";
const otherId = "8e391c8b-71d9-48d5-a68d-54b15deaa282";
const context = { workspaceId: "5980663d-3bea-46fa-b63d-42d937026710", storageEpoch: "79081f55-9e30-4ee5-91fb-71982b20d6f7" };
const signal = () => new AbortController().signal;
const binding: PushBinding = { id: bindingId, version: 1, status: "active", provider: "mozilla", label: "我的 Firefox",
  endpointHash: "a".repeat(64), vapidPublicKey: "public-key", expiresAt: null, createdAt: "2026-09-28T00:00:00Z", updatedAt: "2026-09-28T00:00:00Z" };
const revoked: PushBinding = { ...binding, version: 2, status: "revoked", endpointHash: null };
const delivery: PushDelivery = { id: "34066145-bdad-4b6b-af85-2af9ee2953a6", bindingId, status: "queued", reason: null,
  providerStatus: null, createdAt: binding.createdAt, attemptedAt: null, finishedAt: null };
const status: WebPushStatus = { userId: "alice", available: true, workerEnabled: true, publicKey: "public-key",
  supportedProviders: ["fcm", "mozilla"], bindings: [binding], deliveries: [delivery], testsRemaining: 3, nextTestAt: null };
const registration: PushRegistrationInput = { label: binding.label, subscription: {
  endpoint: "https://updates.push.services.mozilla.com/wpush/v2/synthetic", keys: { p256dh: "A".repeat(87), auth: "B".repeat(22) }, expirationTime: null,
} };
const onlineResult = (result: unknown): typeof fetch => async (input, init) => {
  if (String(input).endsWith("/online/context")) return Response.json(context);
  const operation = JSON.parse(String(init?.body)).operation;
  return Response.json({ state: "confirmed", operation, changeSeq: "1", statusCode: 200, result });
};
const confirmedError = (error: unknown) => error instanceof WebPushApiError && error.confirmed;

test("Web Push client normalizes the API URL and uses scoped reads and exact online writes", async () => {
  for (const base of ["https://example.test", "https://example.test/api/"]) {
    const calls: { path: string; method: string; body: unknown }[] = [];
    const api = createWebPushApi(base, async (input, init) => {
      const path = new URL(String(input)).pathname;
      assert.equal(init?.credentials, "include"); assert.equal(init?.cache, "no-store");
      assert.equal(new Headers(init?.headers).get("x-expected-user-id"), "alice");
      assert.ok(init?.signal instanceof AbortSignal);
      calls.push({ path, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
      if (path === "/api/web-push") return Response.json(status);
      if (path === "/api/online/context") return Response.json(context);
      assert.equal(path, "/api/online/submit");
      const submission = JSON.parse(String(init?.body));
      const result = submission.path.endsWith("/test") ? { delivery } : { binding: submission.path.endsWith("/revoke") ? revoked : binding };
      return Response.json({ state: "confirmed", operation: submission.operation, changeSeq: "1", statusCode: 200, result });
    });
    assert.deepEqual(await api.status(signal(), "alice"), status);
    assert.deepEqual(await api.register(registration, signal(), "alice"), binding);
    assert.deepEqual(await api.revoke(bindingId, 1, signal(), "alice"), revoked);
    assert.deepEqual(await api.test(bindingId, 1, signal(), "alice"), delivery);
    assert.deepEqual(calls.filter(call => call.method === "GET").map(call => call.path), ["/api/web-push"]);
    assert.deepEqual(calls.filter(call => call.path === "/api/online/submit").map(call => {
      const body = call.body as { path: string; payload: unknown };
      return { path: body.path, payload: body.payload };
    }), [
      { path: "/api/web-push/subscriptions", payload: registration },
      { path: "/api/web-push/subscriptions/" + bindingId + "/revoke", payload: { expectedVersion: 1 } },
      { path: "/api/web-push/subscriptions/" + bindingId + "/test", payload: { expectedVersion: 1, confirmImmediate: true } },
    ]);
  }
});

test("Web Push status rejects mismatched identities, unknown fields and malformed bounded metadata", async () => {
  const invalid = [
    { ...status, userId: "bob" }, { ...status, subscription: registration.subscription },
    { ...status, bindings: [{ ...binding, subscription: registration.subscription }] },
    { ...status, bindings: Array(21).fill(binding) }, { ...status, deliveries: Array(21).fill(delivery) },
    { ...status, testsRemaining: 4 }, { ...status, nextTestAt: "tomorrow" },
    { ...status, deliveries: [{ ...delivery, status: "delivered" }] },
  ];
  for (const value of invalid) {
    const api = createWebPushApi("/api", async () => Response.json(value));
    await assert.rejects(api.status(signal(), "alice"), error => error instanceof WebPushApiError && !error.confirmed
      && (value.userId === "bob" ? error.status === 409 && error.onlineCode === "session_changed" : error.status === 0));
  }
});

test("confirmed Web Push mutations reject extra fields, wrong bindings and wrong result envelopes", async () => {
  for (const value of [{ binding, subscription: registration.subscription }, { binding: { ...binding, endpoint: "PRIVATE ENDPOINT" } }, { delivery }]) {
    const api = createWebPushApi("/api", onlineResult(value));
    await assert.rejects(api.register(registration, signal(), "alice"), confirmedError);
    assert.equal(api.hasPendingOnline(), false);
  }
  await assert.rejects(createWebPushApi("/api", onlineResult({ binding: { ...revoked, id: otherId } })).revoke(bindingId, 1, signal(), "alice"), confirmedError);
  await assert.rejects(createWebPushApi("/api", onlineResult({ delivery: { ...delivery, bindingId: otherId } })).test(bindingId, 1, signal(), "alice"), confirmedError);
});

test("Web Push failures preserve safe statuses and online codes without exposing network or server content", async () => {
  for (const code of ["version_conflict", "session_changed"]) {
    const api = createWebPushApi("/api", async input => String(input).endsWith("/online/context") ? Response.json(context)
      : Response.json({ error: { code, message: "PRIVATE SERVER DETAIL" } }, { status: 409 }));
    await assert.rejects(api.revoke(bindingId, 1, signal(), "alice"), error => error instanceof WebPushApiError
      && error.status === 409 && error.onlineCode === code && !error.confirmed && !error.message.includes("PRIVATE"));
    assert.equal(api.hasPendingOnline(), false);
  }
  for (const code of [401, 403, 500]) {
    const api = createWebPushApi("/api", async () => new Response("PRIVATE SERVER DETAIL", { status: code }));
    await assert.rejects(api.status(signal(), "alice"), error => error instanceof WebPushApiError && error.status === code && !error.message.includes("PRIVATE"));
  }
  await assert.rejects(createWebPushApi("/api", async () => { throw new Error("PRIVATE NETWORK DETAIL"); }).status(signal(), "alice"),
    error => error instanceof WebPushApiError && error.status === 0 && !error.message.includes("PRIVATE"));
});

test("Web Push status preserves allowlisted account errors including changed sessions without server messages", async () => {
  for (const scenario of [
    { httpStatus: 409, code: "session_changed", expected: "session_changed" },
    { httpStatus: 428, code: "account_precondition_required", expected: "account_precondition_required" },
    { httpStatus: 409, code: "PRIVATE UNKNOWN CODE", expected: null },
    { httpStatus: 409, code: 1, expected: null },
  ]) {
    const api = createWebPushApi("/api", async (input, init) => {
      assert.equal(String(input), "/api/web-push");
      assert.equal(new Headers(init?.headers).get("x-expected-user-id"), "alice");
      return Response.json({ error: { code: scenario.code, message: "PRIVATE SERVER DETAIL" } }, { status: scenario.httpStatus });
    });
    await assert.rejects(api.status(signal(), "alice"), error => error instanceof WebPushApiError
      && error.status === scenario.httpStatus && error.onlineCode === scenario.expected
      && !error.confirmed && !error.message.includes("PRIVATE"));
  }
});

test("unknown registration retains the exact input and opId; reconciliation only checks the original receipt", async () => {
  const submissions: { operation: { opId: string }; payload: PushRegistrationInput }[] = [];
  let contexts = 0; let lookups = 0;
  const api = createWebPushApi("/api", async (input, init) => {
    const path = String(input);
    if (path.endsWith("/online/context")) { contexts++; return Response.json(context); }
    if (path.includes("/online/operations/")) { lookups++; return Response.json({ state: "unconfirmed" }); }
    const submission = JSON.parse(String(init?.body)); submissions.push(submission);
    if (submissions.length === 1) throw new Error("lost response");
    return Response.json({ state: "confirmed", operation: submission.operation, changeSeq: "2", statusCode: 201, result: { binding } });
  });
  const draft = structuredClone(registration);
  await assert.rejects(api.register(draft, signal(), "alice"), error => error instanceof WebPushApiError && !error.confirmed);
  draft.subscription.endpoint = "https://updates.push.services.mozilla.com/wpush/v2/changed";
  await assert.rejects(api.register(draft, signal(), "alice"), error => error instanceof WebPushApiError && error.onlineCode === "operation_pending");
  await assert.rejects(api.test(bindingId, 1, signal(), "alice"), error => error instanceof WebPushApiError && error.onlineCode === "operation_pending");
  assert.deepEqual(await api.reconcilePending(signal(), "alice"), { state: "unconfirmed" });
  assert.equal(submissions.length, 1); assert.equal(api.hasPendingOnline(), true);
  assert.deepEqual(await api.register(registration, signal(), "alice"), binding);
  assert.equal(contexts, 1); assert.equal(lookups, 2);
  assert.deepEqual(submissions.map(entry => entry.operation.opId), [submissions[0].operation.opId, submissions[0].operation.opId]);
  assert.deepEqual(submissions.map(entry => entry.payload), [registration, registration]);
  assert.equal(api.hasPendingOnline(), false);
});

test("Web Push reconciliation validates the original result target and preserves confirmed unavailable results", async () => {
  for (const scenario of [
    { kind: "revoke", result: { binding: revoked }, valid: true },
    { kind: "revoke", result: { binding: { ...revoked, id: otherId } }, valid: false },
    { kind: "test", result: { delivery }, valid: true },
    { kind: "test", result: { delivery: { ...delivery, bindingId: otherId } }, valid: false },
    { kind: "test", result: null, valid: true },
  ]) {
    let operation: unknown; let submissions = 0;
    const api = createWebPushApi("/api", async (input, init) => {
      if (String(input).endsWith("/online/context")) return Response.json(context);
      if (String(input).endsWith("/online/submit")) { submissions++; operation = JSON.parse(String(init?.body)).operation; throw new Error("lost response"); }
      return Response.json({ state: "confirmed", operation, changeSeq: "3", statusCode: 200, result: scenario.result });
    });
    await assert.rejects(scenario.kind === "revoke" ? api.revoke(bindingId, 1, signal(), "alice") : api.test(bindingId, 1, signal(), "alice"), WebPushApiError);
    if (!scenario.valid) await assert.rejects(api.reconcilePending(signal(), "alice"), confirmedError);
    else {
      const receipt = await api.reconcilePending(signal(), "alice");
      assert.equal(receipt?.state, "confirmed");
      if (receipt?.state === "confirmed") assert.deepEqual(receipt.result, scenario.result);
    }
    assert.equal(submissions, 1); assert.equal(api.hasPendingOnline(), false);
    assert.equal(await api.reconcilePending(signal(), "alice"), null);
  }
});

test("account changes, reset and revocation discard pending Web Push operations without replay", async () => {
  for (const mode of ["account_changed", "reset", "revoked"]) {
    let submissions = 0; let lookups = 0;
    const api = createWebPushApi("/api", async input => {
      if (String(input).endsWith("/online/context")) return Response.json(context);
      if (String(input).endsWith("/online/submit")) { submissions++; throw new Error("lost response"); }
      lookups++; return new Response(null, { status: 404 });
    });
    await assert.rejects(api.register(registration, signal(), "alice"), WebPushApiError);
    if (mode === "account_changed") assert.equal(await api.reconcilePending(signal(), "bob"), null);
    else if (mode === "reset") { api.resetOnline(); assert.equal(await api.reconcilePending(signal(), "alice"), null); }
    else await assert.rejects(api.reconcilePending(signal(), "alice"), error => error instanceof WebPushApiError && error.status === 404);
    assert.equal(submissions, 1); assert.equal(lookups, mode === "revoked" ? 1 : 0); assert.equal(api.hasPendingOnline(), false);
  }
});

test("reset, abort and account changes reject delayed status data even when fetch ignores abort", async () => {
  for (const mode of ["reset", "abort", "account_changed"]) {
    const finishes: ((response: Response) => void)[] = [];
    const api = createWebPushApi("/api", () => new Promise<Response>(resolve => { finishes.push(resolve); }));
    const controller = new AbortController();
    const reading = api.status(controller.signal, "alice");
    let bob: Promise<WebPushStatus> | null = null;
    if (mode === "reset") api.resetOnline();
    else if (mode === "abort") controller.abort();
    else bob = api.status(signal(), "bob");
    finishes[0](Response.json(status));
    await assert.rejects(reading, WebPushApiError);
    if (bob) { finishes[1](Response.json({ ...status, userId: "bob" })); assert.equal((await bob).userId, "bob"); }
  }
});

test("an aborted confirmed mutation is marked confirmed and cannot be mistaken for an unsent operation", async () => {
  const controller = new AbortController();
  const api = createWebPushApi("/api", async (input, init) => {
    if (String(input).endsWith("/online/context")) return Response.json(context);
    const operation = JSON.parse(String(init?.body)).operation;
    controller.abort();
    return Response.json({ state: "confirmed", operation, changeSeq: "4", statusCode: 201, result: { binding } });
  });
  await assert.rejects(api.register(registration, controller.signal, "alice"), confirmedError);
  assert.equal(api.hasPendingOnline(), false);
});

test("already aborted requests do not fetch or create a pending Web Push operation", async () => {
  let calls = 0;
  const api = createWebPushApi("/api", async () => { calls++; return Response.json(status); });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(api.status(controller.signal, "alice"), WebPushApiError);
  await assert.rejects(api.register(registration, controller.signal, "alice"), WebPushApiError);
  assert.equal(calls, 0); assert.equal(api.hasPendingOnline(), false);
});

test("Web Push requests abort after twenty seconds and never return the aborted response", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let requestSignal: AbortSignal | undefined;
  const api = createWebPushApi("/api", async (_input, init) => {
    requestSignal = init?.signal ?? undefined;
    return await new Promise<Response>((_resolve, reject) => requestSignal?.addEventListener("abort", () => reject(new Error("PRIVATE TIMEOUT DETAIL")), { once: true }));
  });
  const reading = api.status(signal(), "alice");
  t.mock.timers.tick(19_999);
  assert.equal(requestSignal?.aborted, false);
  t.mock.timers.tick(1);
  await assert.rejects(reading, error => error instanceof WebPushApiError && error.status === 0 && !error.message.includes("PRIVATE"));
  assert.equal(requestSignal?.aborted, true);
});

test("concurrent mutations cannot replace the target of the original pending operation", async () => {
  let finishContext!: (response: Response) => void;
  let operation: unknown; let submissions = 0;
  const api = createWebPushApi("/api", async (input, init) => {
    if (String(input).endsWith("/online/context")) return await new Promise<Response>(resolve => { finishContext = resolve; });
    if (String(input).endsWith("/online/submit")) { submissions++; operation = JSON.parse(String(init?.body)).operation; throw new Error("lost response"); }
    return Response.json({ state: "confirmed", operation, changeSeq: "5", statusCode: 201, result: { binding } });
  });
  const first = api.register(registration, signal(), "alice");
  await assert.rejects(api.test(otherId, 1, signal(), "alice"), error => error instanceof WebPushApiError && error.onlineCode === "operation_busy");
  finishContext(Response.json(context));
  await assert.rejects(first, WebPushApiError);
  assert.equal((await api.reconcilePending(signal(), "alice"))?.state, "confirmed");
  assert.equal(submissions, 1); assert.equal(api.hasPendingOnline(), false);
});
