import assert from "node:assert/strict";
import { test } from "node:test";
import { createFirebaseRequestHandler } from "../server/firebase-app.ts";
import { FirebaseAuthError, type FirebaseAuthPort } from "../server/firebase-auth.ts";
import { FirestoreAuthorityError, type FirestoreAuthority } from "../server/firestore-authority.ts";
import { SERVICE_DATA_NOTICE, SERVICE_POLICY_VERSION, type AccountServiceStatus } from "../src/shared/account-service.ts";
import type { ServerAuthSession, ServerAuthSessionWithHeaders } from "../server/auth-port.ts";

const PUBLIC_ORIGIN = "https://synthetic.example.test";
const USER_ID = "synthetic-owner";
const OPERATION_ID = "55e6449b-7ef3-4bf2-9c99-2f2f64fd746b";
const acknowledgement = { accepted: true, policyVersion: SERVICE_POLICY_VERSION, operationId: OPERATION_ID };
function fixture(mailConfigured = false) {
  let userId: string | null = USER_ID, acknowledged = false;
  let authFailure: unknown, statusFailure: unknown, acknowledgementFailure: unknown;
  const authRequests: Request[] = [], sessionHeaders: Headers[] = [], statusUserIds: (string | null)[] = [];
  const writes: Parameters<FirestoreAuthority["acknowledge"]>[0][] = [];
  function status(uid: string | null): Omit<AccountServiceStatus, "mailConfigured"> {
    return { enabled: true, registration: "invite", policyVersion: SERVICE_POLICY_VERSION, notice: SERVICE_DATA_NOTICE,
      user: uid === null ? null : { id: uid, emailVerified: true, acknowledged,
        acknowledgementVersion: acknowledged ? SERVICE_POLICY_VERSION : null } };
  }
  const authority: Pick<FirestoreAuthority, "accountStatus" | "acknowledge"> = {
    async accountStatus(uid) {
      statusUserIds.push(uid); if (statusFailure) throw statusFailure; return status(uid);
    },
    async acknowledge(input) {
      if (acknowledgementFailure) throw acknowledgementFailure;
      writes.push(input); acknowledged = true; return { policyVersion: SERVICE_POLICY_VERSION };
    },
  };
  function getSession(options: { headers: Headers; returnHeaders?: false }): Promise<ServerAuthSession | null>;
  function getSession(options: { headers: Headers; returnHeaders: true }): Promise<ServerAuthSessionWithHeaders>;
  async function getSession(options: { headers: Headers; returnHeaders?: boolean }) {
    sessionHeaders.push(options.headers); if (authFailure) throw authFailure;
    const response = userId === null ? null : { user: { id: userId } };
    return options.returnHeaders ? { response, headers: new Headers() } : response;
  }
  const auth: FirebaseAuthPort = {
    getSession,
    async handler(request) {
      authRequests.push(request);
      return Response.json({ provider: "native-firebase", path: new URL(request.url).pathname }, { status: 202,
        headers: { "Cache-Control": "public, max-age=600", "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Credentials": "true", "Set-Cookie": "__session=synthetic; HttpOnly; Secure; SameSite=Lax" } });
    },
    fromNodeHeaders() { return new Headers(); },
    async assertRecentReauthentication() { throw new Error("Not part of this foundation assignment"); },
  };
  const options = { authority, auth, publicOrigin: PUBLIC_ORIGIN, mailConfigured };
  const handler = createFirebaseRequestHandler(options);
  const get = (path: string, headers?: HeadersInit) => handler(new Request(PUBLIC_ORIGIN + path, { headers }));
  const post = (body: unknown = acknowledgement, patch: Record<string, string | null> = {}) => {
    const headers = new Headers({ Origin: PUBLIC_ORIGIN, "Content-Type": "application/json", "x-expected-user-id": USER_ID });
    for (const [key, value] of Object.entries(patch)) { if (value === null) headers.delete(key); else headers.set(key, value); }
    return handler(new Request(PUBLIC_ORIGIN + "/api/account/acknowledgement", { method: "POST", headers, body: JSON.stringify(body) }));
  };
  return { handler, options, get, post, writes, authRequests, sessionHeaders, statusUserIds, status,
    setUser: (value: string | null) => { userId = value; }, failAuth: (value: unknown) => { authFailure = value; },
    failStatus: (value: unknown) => { statusFailure = value; }, failAcknowledgement: (value: unknown) => { acknowledgementFailure = value; } };
}
function privateResponse(response: Response) {
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(response.headers.get("Pragma"), "no-cache");
  assert.ok([...response.headers.keys()].every(key => !key.startsWith("access-control-")));
}
async function errorCode(response: Response, status: number, code: string) {
  assert.equal(response.status, status); privateResponse(response);
  const value = await response.json(); assert.equal(value.error.code, code); assert.equal(typeof value.error.message, "string");
  return value;
}

test("foundation handler is inert and health reports only the process stage without checking credentials or database", async () => {
  const f = fixture();
  assert.equal(f.authRequests.length + f.sessionHeaders.length + f.statusUserIds.length + f.writes.length, 0);
  f.failAuth(new Error("private credential configuration")); f.failStatus(new Error("private database configuration"));
  const response = await f.get("/healthz");
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { status: "ok", storage: "firestore", stage: "foundation" });
  privateResponse(response);
  assert.equal(f.sessionHeaders.length, 0); assert.equal(f.statusUserIds.length, 0);
  assert.throws(() => createFirebaseRequestHandler({ ...f.options, mailConfigured: undefined } as unknown as typeof f.options), /invalid_firebase_app_configuration/);
  assert.throws(() => createFirebaseRequestHandler({ ...f.options, publicOrigin: PUBLIC_ORIGIN + "/" }), /invalid_firebase_app_configuration/);
});

test("all auth paths delegate the original Web Request and preserve native cookies while enforcing private responses without CORS permission", async () => {
  const f = fixture();
  for (const [path, method] of [["/api/auth/get-session", "GET"], ["/api/auth/session", "POST"], ["/api/auth/sign-out", "POST"]]) {
    const request = new Request(PUBLIC_ORIGIN + path, { method, ...(method === "POST" ? { body: "{}" } : {}) });
    const response = await f.handler(request); assert.equal(f.authRequests.at(-1), request);
    assert.equal(response.status, 202); assert.equal((await response.json()).path, path); privateResponse(response);
    assert.equal(response.headers.get("set-cookie"), "__session=synthetic; HttpOnly; Secure; SameSite=Lax");
  }
  assert.equal(f.sessionHeaders.length, 0); assert.equal(f.writes.length, 0);
});

test("account status uses only the current auth identity and explicitly supplied mail readiness for anonymous and signed-in reads", async () => {
  const f = fixture();
  const response = await f.get("/api/account", { "x-expected-user-id": "untrusted-identity" });
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ...f.status(USER_ID), mailConfigured: false });
  assert.deepEqual(f.statusUserIds, [USER_ID]); privateResponse(response);
  f.setUser(null);
  assert.deepEqual(await (await f.get("/api/account")).json(), { ...f.status(null), mailConfigured: false });
  assert.deepEqual(f.statusUserIds, [USER_ID, null]);
  const configured = fixture(true); assert.equal((await (await configured.get("/api/account")).json()).mailConfigured, true);
});

test("acknowledgement validates the existing schema, carries the original operation ID and returns the full current account status", async () => {
  const f = fixture(true), response = await f.post();
  assert.equal(response.status, 200); privateResponse(response);
  assert.deepEqual(f.writes, [{ userId: USER_ID, operationId: OPERATION_ID, policyVersion: SERVICE_POLICY_VERSION }]);
  assert.deepEqual(await response.json(), { ...f.status(USER_ID), mailConfigured: true });
  assert.deepEqual(f.statusUserIds, [USER_ID]);
  for (const body of [{ ...acknowledgement, accepted: false }, { ...acknowledgement, userId: "untrusted" },
    { ...acknowledgement, policyVersion: "old-policy" }, { ...acknowledgement, operationId: "new-operation" }]) {
    await errorCode(await f.post(body), 400, "account_acknowledgement_invalid");
  }
  assert.equal(f.writes.length, 1);
});

test("acknowledgement requires exact same-origin and a matching authenticated identity before calling authority", async () => {
  const f = fixture();
  for (const origin of [null, "https://foreign.example.test", PUBLIC_ORIGIN + "/"]) {
    await errorCode(await f.post(acknowledgement, { Origin: origin }), 403, "origin_rejected");
  }
  assert.equal(f.sessionHeaders.length, 0);
  for (const expected of [null, "different-user"]) {
    await errorCode(await f.post(acknowledgement, { "x-expected-user-id": expected }), 409, "identity_changed");
  }
  f.setUser(null); await errorCode(await f.post(), 401, "unauthorized");
  assert.equal(f.writes.length, 0); assert.equal(f.statusUserIds.length, 0);
});

test("acknowledgement JSON parsing bounds both declared and actual bytes and rejects malformed or non-JSON bodies", async () => {
  const f = fixture();
  await errorCode(await f.post(acknowledgement, { "Content-Type": null }), 415, "json_required");
  await errorCode(await f.post(acknowledgement, { "Content-Length": "16385" }), 413, "request_body_too_large");
  await errorCode(await f.post({ ...acknowledgement, padding: "x".repeat(16 * 1024) }), 413, "request_body_too_large");
  const headers = { Origin: PUBLIC_ORIGIN, "Content-Type": "application/json", "x-expected-user-id": USER_ID };
  for (const body of ["{", "", "[]", "null"]) {
    const response = await f.handler(new Request(PUBLIC_ORIGIN + "/api/account/acknowledgement", { method: "POST", headers, body }));
    assert.equal(response.status, 400); privateResponse(response);
  }
  assert.equal(f.writes.length, 0);
});

test("auth or database outages remain 503 and do not become anonymous account state or successful acknowledgements", async () => {
  const f = fixture();
  f.failAuth(new FirebaseAuthError(503, "authentication_unavailable"));
  await errorCode(await f.get("/api/account"), 503, "firebase_service_unavailable");
  assert.equal(f.statusUserIds.length, 0);
  f.failAuth(undefined); f.failStatus(new Error("private database host and secret"));
  const error = await errorCode(await f.get("/api/account"), 503, "firebase_service_unavailable");
  assert.equal(JSON.stringify(error).includes("secret"), false);
  await errorCode(await f.post(), 503, "firebase_service_unavailable");
  assert.equal(f.writes.length, 1, "Committed write can survive a failed result read; caller retains its original operation ID");
  f.failStatus(undefined); f.failAcknowledgement(new Error("private database details"));
  await errorCode(await f.post(), 503, "firebase_service_unavailable");
  assert.equal(f.writes.length, 1);
});

test("known authority and authentication errors preserve only fixed safe codes and unexpected errors never expose exception text", async () => {
  const f = fixture();
  for (const [code, status] of [["invalid_input", 400], ["operation_conflict", 409], ["account_inactive", 403], ["email_not_verified", 403]] as const) {
    f.failAcknowledgement(new FirestoreAuthorityError(code, status));
    await errorCode(await f.post(), status, code);
  }
  f.failAcknowledgement(new FirestoreAuthorityError("private-email@example.test", 403));
  const result = await errorCode(await f.post(), 503, "firebase_service_unavailable");
  assert.equal(JSON.stringify(result).includes("private-email"), false);
  f.failAcknowledgement(undefined); f.failAuth(new FirebaseAuthError(403, "identity_email_changed"));
  await errorCode(await f.get("/api/account"), 403, "identity_email_changed");
});

test("unmigrated business domains return explicit 503 without fake data, auth lookups or writer execution", async () => {
  const f = fixture();
  for (const path of ["/api", "/api/children", "/api/children/child/messages", "/api/account/export", "/api/health"]) {
    await errorCode(await f.get(path), 503, "firebase_domain_not_ready");
  }
  await errorCode(await f.handler(new Request(PUBLIC_ORIGIN + "/api/children", { method: "POST", body: "{}" })), 503, "firebase_domain_not_ready");
  await errorCode(await f.get("/unknown"), 404, "not_found");
  await errorCode(await f.handler(new Request(PUBLIC_ORIGIN + "/healthz", { method: "POST" })), 404, "not_found");
  assert.equal(f.sessionHeaders.length, 0); assert.equal(f.statusUserIds.length, 0); assert.equal(f.writes.length, 0);
});

