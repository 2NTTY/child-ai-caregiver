import assert from "node:assert/strict";
import { test } from "node:test";
import { HttpsError, type AuthBlockingEvent } from "firebase-functions/v2/identity";
import { defineSecret, defineString } from "firebase-functions/params";
import { createFirebaseRegistrationHandler, decodeFirebaseRegistrationStorageKey, FIREBASE_REGISTRATION_DEADLINE_MS } from "../server/firebase-registration.ts";
import { createFirestoreAuthority, FirestoreAuthorityError } from "../server/firestore-authority.ts";
import { createStorageCipher } from "../server/storage-crypto.ts";
import { serialFirestoreFixture } from "./helpers/firestore-session-memory.ts";

const PROJECT = "synthetic-server-project", EMAIL = "synthetic-registration@example.test", NOW = 1_800_000_000_000;
function event(patch: Partial<AuthBlockingEvent> = {}): AuthBlockingEvent {
  return { eventId: "synthetic-registration-event", eventType: "providers/cloud.auth/eventTypes/user.beforeCreate:password",
    authType: "USER", timestamp: new Date(NOW).toUTCString(), resource: { service: "identitytoolkit.googleapis.com", name: "projects/" + PROJECT },
    params: {}, ipAddress: "192.0.2.1", userAgent: "synthetic-test", additionalUserInfo: { providerId: "password", isNewUser: true },
    data: { uid: "synthetic-new-user", email: EMAIL, emailVerified: false, disabled: false,
      metadata: { creationTime: new Date(NOW).toUTCString(), lastSignInTime: new Date(NOW).toUTCString() }, providerData: [] },
    ...patch };
}
const httpsCode = (code: string) => (error: unknown) => {
  assert.ok(error instanceof HttpsError); assert.equal(error.code, code);
  assert.equal(error.details, undefined); assert.equal(JSON.stringify(error.toJSON()).includes(EMAIL), false); return true;
};
function fixture() {
  const calls: string[] = []; let failure: unknown;
  const handler = createFirebaseRegistrationHandler({ projectId: PROJECT, authority: {
    async assertCanRegister(email) { calls.push(email); if (failure) throw failure; },
  } });
  return { handler, calls, fail: (value: unknown) => { failure = value; } };
}

test("native password before-create accepts only a read-only invitation check without consuming or altering identity", async () => {
  const f = fixture(), input = event(), before = structuredClone(input);
  assert.equal(f.calls.length, 0);
  assert.equal(await f.handler(input), undefined); assert.deepEqual(f.calls, [EMAIL]); assert.deepEqual(input, before);
  assert.equal(await f.handler(input), undefined); assert.deepEqual(f.calls, [EMAIL, EMAIL]);
});

test("missing email, non-password methods and contradictory provider fields deny before any authority access", async () => {
  const f = fixture(), base = event();
  const invalid = [
    event({ data: undefined }),
    event({ data: { ...base.data!, email: undefined } }),
    event({ data: { ...base.data!, email: "invalid-email" } }),
    event({ eventType: "providers/cloud.auth/eventTypes/user.beforeCreate:google.com" }),
    event({ eventType: "providers/cloud.auth/eventTypes/user.beforeCreate:emailLink" }),
    event({ eventType: "providers/cloud.auth/eventTypes/user.beforeSignIn:password" }),
    event({ additionalUserInfo: { providerId: "google.com", isNewUser: true } }),
    event({ credential: { providerId: "password", signInMethod: "emailLink" } }),
    event({ credential: { providerId: "google.com", signInMethod: "google.com" } }),
    event({ data: { ...base.data!, providerData: [{ uid: "synthetic-provider", email: EMAIL, displayName: "", photoURL: "", phoneNumber: "", providerId: "google.com" }] } }),
  ];
  for (const input of invalid) await assert.rejects(f.handler(input), httpsCode("permission-denied"));
  assert.equal(f.calls.length, 0);
});

test("event resource project and tenant fields must agree with the explicit trusted scope", async () => {
  const f = fixture(), base = event();
  for (const input of [
    event({ resource: { ...base.resource, name: "projects/other-project" } }),
    event({ resource: { ...base.resource, name: "projects/" + PROJECT + "/tenants/other-tenant" } }),
    event({ resource: { ...base.resource, service: "untrusted.example.test" } }),
    event({ data: { ...base.data!, tenantId: "other-tenant" } }),
    event({ authType: "UNAUTHENTICATED" }),
  ]) await assert.rejects(f.handler(input), httpsCode("permission-denied"));
  assert.equal(f.calls.length, 0);
  const tenantCalls: string[] = [], tenant = "expected-tenant";
  const handler = createFirebaseRegistrationHandler({ projectId: PROJECT, tenantId: tenant,
    authority: { async assertCanRegister(email) { tenantCalls.push(email); } } });
  await handler(event({ resource: { ...base.resource, name: "projects/" + PROJECT + "/tenants/" + tenant }, data: { ...base.data!, tenantId: tenant } }));
  assert.deepEqual(tenantCalls, [EMAIL]);
});

test("known missing, revoked, expired and disabled admission states use one fixed permission error; database faults are unavailable", async () => {
  const f = fixture();
  for (const [code, status] of [["not_found", 404], ["invitation_unavailable", 403], ["service_disabled", 403], ["invalid_input", 400]] as const) {
    f.fail(new FirestoreAuthorityError(code, status)); await assert.rejects(f.handler(event()), httpsCode("permission-denied"));
  }
  for (const failure of [new Error(EMAIL + " private database details"), new FirestoreAuthorityError("invalid_document", 500),
    new FirestoreAuthorityError(EMAIL, 403), Object.assign(new Error(), { code: "not_found", status: 404 })]) {
    f.fail(failure); await assert.rejects(f.handler(event()), httpsCode("unavailable"));
  }
});

test("canonical invitation checks remain read-only across repeated events and distinguish missing, revoked and expired records", async () => {
  const memory = serialFirestoreFixture(); let now = NOW;
  const authority = createFirestoreAuthority({ database: memory.database, cipher: createStorageCipher(Buffer.alloc(32, 95)),
    projectId: PROJECT, namespace: "registration_test", serverClock: () => now });
  await authority.initializeControl({ generation: "36c547be-64f9-4b26-a665-344943a54ae1", enabled: true });
  await authority.issueInvitation({ email: EMAIL, expiresAt: new Date(NOW + 60_000).toISOString(), operationId: "cf2d836d-39e4-44e3-9b50-f24923089c7c" });
  const handler = createFirebaseRegistrationHandler({ authority, projectId: PROJECT }), before = JSON.stringify([...memory.records]);
  await handler(event()); await handler(event()); assert.equal(JSON.stringify([...memory.records]), before);
  await assert.rejects(handler(event({ data: { ...event().data!, email: "missing@example.test" } })), httpsCode("permission-denied"));
  now = NOW + 60_000; await assert.rejects(handler(event()), httpsCode("permission-denied"));
  now = NOW;
  await authority.revokeInvitation({ email: EMAIL, operationId: "601e0bae-a9a2-4e9b-9274-7d8fa74d9b9a" });
  const revoked = JSON.stringify([...memory.records]);
  await assert.rejects(handler(event()), httpsCode("permission-denied")); assert.equal(JSON.stringify([...memory.records]), revoked);
});

test("read-only deadline fails closed before seven seconds and a late read cannot create success or write admission", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let finish!: () => void; let calls = 0;
  const pendingRead = new Promise<void>(resolve => { finish = resolve; });
  const handler = createFirebaseRegistrationHandler({ projectId: PROJECT,
    authority: { async assertCanRegister() { calls++; await pendingRead; } } });
  const pending = handler(event()), denied = assert.rejects(pending, httpsCode("unavailable"));
  assert.ok(FIREBASE_REGISTRATION_DEADLINE_MS < 7000);
  t.mock.timers.tick(FIREBASE_REGISTRATION_DEADLINE_MS); await denied; assert.equal(calls, 1);
  finish(); await pendingRead; await assert.rejects(pending, httpsCode("unavailable"));
});

test("storage secret accepts only canonical base64 of exactly 32 bytes and rejects alternatives without exposing values", () => {
  const key = Buffer.alloc(32, 7), encoded = key.toString("base64");
  assert.deepEqual(decodeFirebaseRegistrationStorageKey(encoded), key);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const noncanonical = encoded.slice(0, -2) + alphabet[alphabet.indexOf(encoded.at(-2)!) + 1] + "=";
  for (const value of ["", " " + encoded, encoded + "\n", encoded.slice(0, -1), Buffer.alloc(31).toString("base64"),
    Buffer.alloc(33).toString("base64"), noncanonical]) {
    assert.throws(() => decodeFirebaseRegistrationStorageKey(value), httpsCode("unavailable"));
  }
});

test("deployment export is discoverable with fixed bounded options and never reads secrets, resolves config or constructs Firestore during import", async t => {
  let secretReads = 0, configReads = 0, clients = 0;
  const secretProbe = defineSecret("SYNTHETIC_DISCOVERY_SECRET"), configProbe = defineString("SYNTHETIC_DISCOVERY_PARAMETER");
  t.mock.method(Object.getPrototypeOf(secretProbe), "value", () => { secretReads++; throw new Error("Secret must remain lazy"); });
  t.mock.method(Object.getPrototypeOf(configProbe), "value", () => { configReads++; throw new Error("Config must remain lazy"); });
  t.mock.module("@google-cloud/firestore", { namedExports: { Firestore: class {
    constructor() { clients++; throw new Error("Cloud client must remain lazy"); }
  } } });
  const { beforeYubanUserCreated } = await import("../server/firebase-blocking.ts");
  const endpoint = beforeYubanUserCreated.__endpoint;
  assert.equal(typeof beforeYubanUserCreated, "function");
  assert.equal(endpoint.platform, "gcfv2"); assert.deepEqual(endpoint.region, ["asia-east2"]);
  assert.equal(endpoint.cpu, 1); assert.equal(endpoint.availableMemoryMb, 256); assert.equal(endpoint.timeoutSeconds, 7);
  assert.equal(endpoint.minInstances, 0); assert.equal(endpoint.maxInstances, 1); assert.equal(endpoint.concurrency, 1);
  assert.equal(endpoint.blockingTrigger?.eventType, "providers/cloud.auth/eventTypes/user.beforeCreate");
  assert.match(JSON.stringify(endpoint.serviceAccountEmail), /FIREBASE_BLOCKING_SERVICE_ACCOUNT/);
  assert.deepEqual(endpoint.secretEnvironmentVariables, [{ key: "YUBAN_FIREBASE_STORAGE_KEY" }]);
  assert.equal(secretReads, 0); assert.equal(configReads, 0); assert.equal(clients, 0);
});


