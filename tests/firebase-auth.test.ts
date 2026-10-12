import assert from "node:assert/strict";
import { test } from "node:test";
import type { Auth, DecodedIdToken, UserRecord } from "firebase-admin/auth";
import { createFirebaseAuthPort, FirebaseAuthError, FIREBASE_SESSION_LIFETIME_MS } from "../server/firebase-auth.ts";
import { DeviceSessionError, FirestoreDeviceSessions } from "../server/firestore-device-sessions.ts";
import { createStorageCipher } from "../server/storage-crypto.ts";
import { serialFirestoreFixture } from "./helpers/firestore-session-memory.ts";

const PUBLIC_ORIGIN = "https://synthetic.example.test";
const nativeError = (code: string) => Object.assign(new Error("Synthetic native failure"), { code });
function fixture() {
  let now = 1_800_000_000_000, serial = 0, issueUnavailable = false, ledgerUnavailable = false;
  const firestore = serialFirestoreFixture();
  const ledger = new FirestoreDeviceSessions({ database: firestore.database, cipher: createStorageCipher(Buffer.alloc(32, 92)),
    projectId: "synthetic-server-project", namespace: "firebase_auth_test", serverClock: () => now });
  const users = new Map<string, UserRecord>();
  const idTokens = new Map<string, DecodedIdToken>(), cookies = new Map<string, DecodedIdToken>(), issued = new Map<string, string>();
  const failures = new Map<string, string>(), lifecycleFailures = new Map<string, unknown>();
  const calls: { operation: string; value?: unknown; checkRevoked?: boolean }[] = [];
  const admissions: { userId: string; email: string; emailVerified: boolean }[] = [];
  const admissionChecks: string[] = [];
  const admissionIdentities: { userId: string; currentIdentity: { email: string; emailVerified: boolean } | null }[] = [];
  const userId = "synthetic-user-one", secondUserId = "synthetic-user-two";
  for (const [uid, email, displayName] of [[userId, "admin-one@example.test", "Admin One"],
    [secondUserId, "admin-two@example.test", "Admin Two"]]) {
    users.set(uid, { uid, email, displayName, emailVerified: true, disabled: false } as UserRecord);
  }
  function token(uid = userId, authTimeSeconds = Math.floor(now / 1000), emailVerified = false) {
    const raw = "native.id." + (++serial);
    idTokens.set(raw, { uid, sub: uid, email: users.get(uid)?.email, email_verified: emailVerified, auth_time: authTimeSeconds,
      aud: "synthetic-server-project", iss: "https://securetoken.google.com/synthetic-server-project",
      iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + 3600, firebase: { identities: {}, sign_in_provider: "password" } });
    return raw;
  }
  const firstToken = token();
  function fail(operation: string) { const code = failures.get(operation); if (code) throw nativeError(code); }
  const admin: Pick<Auth, "verifyIdToken" | "createSessionCookie" | "verifySessionCookie" | "getUser"> = {
    async verifyIdToken(value, checkRevoked) {
      calls.push({ operation: "verifyIdToken", value, checkRevoked }); fail("verifyIdToken");
      const claims = idTokens.get(value); if (!claims) throw nativeError("auth/invalid-id-token");
      return { ...claims };
    },
    async createSessionCookie(value, options) {
      calls.push({ operation: "createSessionCookie", value: options }); fail("createSessionCookie");
      const claims = idTokens.get(value); if (!claims) throw nativeError("auth/invalid-id-token");
      const key = value + ":" + Math.floor(now / 1000), existing = issued.get(key);
      if (existing) return existing;
      const cookie = "native.session." + (++serial);
      cookies.set(cookie, { ...claims, iss: "https://session.firebase.google.com/synthetic-server-project",
        iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + options.expiresIn / 1000 });
      issued.set(key, cookie); return cookie;
    },
    async verifySessionCookie(value, checkRevoked) {
      calls.push({ operation: "verifySessionCookie", checkRevoked }); fail("verifySessionCookie");
      const claims = cookies.get(value); if (!claims) throw nativeError("auth/invalid-session-cookie");
      if (claims.exp <= Math.floor(now / 1000)) throw nativeError("auth/session-cookie-expired");
      return { ...claims };
    },
    async getUser(uid) {
      calls.push({ operation: "getUser", value: uid }); fail("getUser");
      const user = users.get(uid); if (!user) throw nativeError("auth/user-not-found"); return user;
    },
  };
  const sessions = {
    async issue(input: Parameters<typeof ledger.issue>[0]) {
      if (issueUnavailable) throw new DeviceSessionError(503, "device_sessions_unavailable"); await ledger.issue(input);
    },
    async assertActive(input: Parameters<typeof ledger.assertActive>[0]) {
      if (ledgerUnavailable) throw new DeviceSessionError(503, "device_sessions_unavailable"); await ledger.assertActive(input);
    },
    revokeThis: (input: Parameters<typeof ledger.revokeThis>[0]) => ledger.revokeThis(input),
    revokeOthers: (input: Parameters<typeof ledger.revokeOthers>[0]) => ledger.revokeOthers(input),
  };
  const lifecycle = {
    async admitIdentity(input: { userId: string; email: string; emailVerified: boolean }) {
      const error = lifecycleFailures.get("admitIdentity"); if (error) throw error; admissions.push(input);
    },
    async assertSessionAdmission(uid: string, currentIdentity?: { email: string; emailVerified: boolean }) {
      const error = lifecycleFailures.get("assertSessionAdmission"); if (error) throw error; admissionChecks.push(uid);
      admissionIdentities.push({ userId: uid, currentIdentity: currentIdentity ? { ...currentIdentity } : null });
    },
  };
  const options = { auth: admin, sessions, lifecycle, publicOrigin: PUBLIC_ORIGIN, serverClock: () => now };
  const port = createFirebaseAuthPort(options);
  function post(path: string, input: unknown = {}, cookie?: string, expected?: string, origin: string | null = PUBLIC_ORIGIN) {
    return port.handler(new Request(PUBLIC_ORIGIN + path, { method: "POST",
      headers: { "Content-Type": "application/json", ...(origin === null ? {} : { Origin: origin }),
        ...(cookie ? { Cookie: cookie } : {}), ...(expected === undefined ? {} : { "x-expected-user-id": expected }) },
      body: JSON.stringify(input) }));
  }
  const get = (cookie?: string) => port.handler(new Request(PUBLIC_ORIGIN + "/api/auth/get-session",
    { headers: cookie ? { Cookie: cookie } : {} }));
  const exchange = (value = firstToken, cookie?: string, expected?: string) => post("/api/auth/session", { idToken: value }, cookie, expected);
  return { port, options, users, cookies, idTokens, firstToken, token, userId, secondUserId, admissions, admissionChecks, admissionIdentities, calls, failures,
    lifecycleFailures, records: firestore.records, post, get, exchange, now: () => now, setNow: (value: number) => { now = value; },
    failIssue: (value = true) => { issueUnavailable = value; }, failLedger: (value = true) => { ledgerUnavailable = value; } };
}
function cookieOf(response: Response) {
  assert.equal(response.status, 200); const header = response.headers.get("set-cookie"); assert.ok(header); return header.split(";")[0];
}
async function responseCode(response: Response, status: number, code: string) {
  assert.equal(response.status, status); assert.deepEqual(await response.json(), { code });
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(response.headers.has("set-cookie"), false);
}

test("Firebase auth composition is inert, production defaults secure, and only explicit local development allows HTTP", async () => {
  const f = fixture(); assert.equal(f.calls.length, 0); assert.equal(f.records.size, 0);
  for (const publicOrigin of ["http://127.0.0.1:3000", "http://remote.example.test", PUBLIC_ORIGIN + "/", "bad-url"]) {
    assert.throws(() => createFirebaseAuthPort({ ...f.options, publicOrigin }), error => error instanceof FirebaseAuthError && error.code === "invalid_configuration");
  }
  assert.throws(() => createFirebaseAuthPort({ ...f.options, publicOrigin: "http://remote.example.test", production: false }), FirebaseAuthError);
  const local = createFirebaseAuthPort({ ...f.options, publicOrigin: "http://127.0.0.1:3000", production: false });
  const response = await local.handler(new Request("http://127.0.0.1:3000/api/auth/session", { method: "POST",
    headers: { Origin: "http://127.0.0.1:3000", "Content-Type": "application/json" }, body: JSON.stringify({ idToken: f.firstToken }) }));
  assert.equal(response.status, 200); assert.equal(response.headers.get("set-cookie")!.includes("Secure"), false);
});

test("native token exchange trusts Admin current identity, verifies revocation, and issues a bounded private cookie after ledger commit", async () => {
  const f = fixture(), response = await f.exchange(), cookie = cookieOf(response);
  assert.deepEqual(await response.json(), { user: { id: f.userId, name: "Admin One", email: "admin-one@example.test" } });
  assert.deepEqual(f.admissions, [{ userId: f.userId, email: "admin-one@example.test", emailVerified: true }]);
  assert.ok(f.calls.some(call => call.operation === "verifyIdToken" && call.value === f.firstToken && call.checkRevoked === true));
  assert.ok(f.calls.filter(call => call.operation === "verifySessionCookie").every(call => call.checkRevoked === true));
  assert.deepEqual(f.calls.find(call => call.operation === "createSessionCookie")?.value, { expiresIn: FIREBASE_SESSION_LIFETIME_MS });
  const header = response.headers.get("set-cookie")!;
  for (const attribute of ["__session=", "HttpOnly", "Secure", "SameSite=Lax", "Path=/", "Max-Age=432000"]) assert.ok(header.includes(attribute));
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  const saved = JSON.stringify([...f.records]); assert.equal(saved.includes(f.firstToken), false);
  assert.equal(saved.includes(cookie.slice("__session=".length)), false); assert.equal(saved.includes(f.userId), false);
  const get = await f.get(cookie); assert.equal(get.status, 200); assert.deepEqual(await get.json(), { user: { id: f.userId, name: "Admin One", email: "admin-one@example.test" } });
  assert.equal(get.headers.has("set-cookie"), false); assert.deepEqual(f.admissionChecks, [f.userId, f.userId]);
});

test("unverified identities may receive only an admitted account session and Admin verification state reaches lifecycle", async () => {
  const f = fixture(), user = f.users.get(f.userId)!;
  f.users.set(f.userId, { ...user, emailVerified: false } as UserRecord);
  cookieOf(await f.exchange()); assert.equal(f.admissions[0].emailVerified, false);
  // Data usability/policy checks belong to the independent authoritative business APIs.
  assert.equal(f.admissionChecks.length, 1);
});

test("all mutations require exact origin and existing sessions require matching expected identity", async () => {
  const f = fixture(), cookie = cookieOf(await f.exchange());
  for (const origin of [null, "https://foreign.example.test", PUBLIC_ORIGIN + "/"]) {
    await responseCode(await f.post("/api/auth/sign-out", {}, cookie, f.userId, origin), 403, "origin_rejected");
  }
  const put = await f.port.handler(new Request(PUBLIC_ORIGIN + "/api/auth/session", { method: "PUT", body: "{}" }));
  await responseCode(put, 403, "origin_rejected");
  for (const path of ["/api/auth/sign-out", "/api/auth/revoke-other-sessions"]) {
    await responseCode(await f.post(path, {}, cookie), 409, "identity_changed");
    await responseCode(await f.post(path, {}, cookie, f.secondUserId), 409, "identity_changed");
  }
  await responseCode(await f.exchange(f.firstToken, cookie), 409, "identity_changed");
  await responseCode(await f.exchange(f.token(f.secondUserId), cookie, f.userId), 409, "sign_out_required");
  const before = f.records.size;
  await responseCode(await f.post("/api/auth/session", { idToken: f.firstToken, uid: f.userId, emailVerified: true }), 400, "auth_body_invalid");
  await responseCode(await f.post("/api/auth/session", { idToken: f.firstToken, existingSessionHash: "untrusted-hash" }), 400, "auth_body_invalid");
  assert.equal(f.records.size, before); assert.notEqual(await (await f.get(cookie)).json(), null);
});

test("fresh auth_time cannot be replaced by refreshed iat and current deleted, disabled or changed-email identities are rejected", async () => {
  const f = fixture();
  for (const authTime of [Math.floor(f.now() / 1000) - 301, Math.floor(f.now() / 1000) + 1]) {
    const response = await f.exchange(f.token(f.userId, authTime)); assert.equal(response.status, 401);
    assert.equal(response.headers.has("set-cookie"), false);
  }
  const user = f.users.get(f.userId)!;
  f.users.set(f.userId, { ...user, disabled: true } as UserRecord);
  await responseCode(await f.exchange(), 401, "unauthorized");
  f.users.set(f.userId, { ...user, email: "changed@example.test" } as UserRecord);
  await responseCode(await f.exchange(), 401, "unauthorized");
  f.users.delete(f.userId); await responseCode(await f.exchange(), 401, "unauthorized");
  assert.equal(f.records.size, 0);
});

test("session reads remain read-only and distinguish revoked credentials from SDK and Firestore unavailability", async () => {
  const f = fixture(), cookie = cookieOf(await f.exchange()), records = JSON.stringify([...f.records]);
  const response = await f.port.getSession({ headers: new Headers({ Cookie: cookie }), returnHeaders: true });
  assert.equal(response.response?.user.id, f.userId); assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(JSON.stringify([...f.records]), records);
  for (const operation of ["verifySessionCookie", "getUser"]) {
    f.failures.set(operation, "auth/internal-error");
    await responseCode(await f.get(cookie), 503, "authentication_unavailable");
    await assert.rejects(f.port.getSession({ headers: new Headers({ Cookie: cookie }) }), error => error instanceof FirebaseAuthError && error.status === 503);
    f.failures.delete(operation);
  }
  f.failLedger(); await responseCode(await f.get(cookie), 503, "device_sessions_unavailable"); f.failLedger(false);
  f.failures.set("verifySessionCookie", "auth/session-cookie-revoked");
  assert.equal(await (await f.get(cookie)).json(), null); f.failures.delete("verifySessionCookie");
  const user = f.users.get(f.userId)!; f.users.set(f.userId, { ...user, disabled: true } as UserRecord);
  assert.equal(await (await f.get(cookie)).json(), null); f.users.set(f.userId, user);
  f.users.delete(f.userId); assert.equal(await (await f.get(cookie)).json(), null);
  assert.equal(JSON.stringify([...f.records]), records);
});

test("ledger or lifecycle exchange failures never send a usable cookie or misreport success", async () => {
  const f = fixture(); f.failIssue();
  await responseCode(await f.exchange(), 503, "device_sessions_unavailable"); assert.equal(f.records.size, 0);
  f.failIssue(false);
  f.lifecycleFailures.set("admitIdentity", Object.assign(new Error(), { status: 403, code: "invitation_required" }));
  await responseCode(await f.exchange(), 403, "invitation_required");
  f.lifecycleFailures.set("admitIdentity", new Error("Synthetic admission outage"));
  await responseCode(await f.exchange(), 503, "account_admission_unavailable");
  f.lifecycleFailures.clear(); f.failures.set("verifyIdToken", "auth/internal-error");
  await responseCode(await f.exchange(), 503, "authentication_unavailable");
  assert.equal(f.records.size, 0);
});

test("device sign-out revokes this cookie, clears it after success and preserves other-device login", async () => {
  const f = fixture(), first = cookieOf(await f.exchange()), second = cookieOf(await f.exchange(f.token()));
  const response = await f.post("/api/auth/sign-out", {}, first, f.userId);
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { success: true });
  assert.ok(response.headers.get("set-cookie")!.includes("Max-Age=0"));
  assert.equal(await (await f.get(first)).json(), null); assert.notEqual(await (await f.get(second)).json(), null);
  assert.equal((await f.post("/api/auth/sign-out")).status, 200);
});

test("revoke-other sessions blocks original-token exchange, preserves current cookie and accepts a later interactive login", async () => {
  const f = fixture(), first = cookieOf(await f.exchange()), second = cookieOf(await f.exchange(f.token()));
  const response = await f.post("/api/auth/revoke-other-sessions", {}, first, f.userId);
  assert.equal(response.status, 200); assert.equal(await (await f.get(second)).json(), null);
  assert.notEqual(await (await f.get(first)).json(), null);
  await responseCode(await f.exchange(f.firstToken), 409, "recent_reauthentication_required");
  await responseCode(await f.exchange(f.token()), 409, "recent_reauthentication_required");
  // Retained identical cookie can recover its original exchange response without minting a new session.
  assert.equal(cookieOf(await f.exchange(f.firstToken, first, f.userId)), first);
  f.setNow(f.now() + 1000);
  const fresh = cookieOf(await f.exchange(f.token())); assert.notEqual(await (await f.get(fresh)).json(), null);
});

test("recent reauthentication uses native auth_time and requires origin/current identity rather than cookie issue time", async () => {
  const f = fixture(), token = f.token(f.userId, Math.floor(f.now() / 1000) - 299), cookie = cookieOf(await f.exchange(token));
  const headers = new Headers({ Cookie: cookie, Origin: PUBLIC_ORIGIN, "x-expected-user-id": f.userId });
  assert.equal((await f.port.assertRecentReauthentication(headers)).user.id, f.userId);
  await assert.rejects(f.port.assertRecentReauthentication(new Headers({ Cookie: cookie })), error => error instanceof FirebaseAuthError && error.code === "origin_rejected");
  f.setNow(f.now() + 2000);
  await assert.rejects(f.port.assertRecentReauthentication(headers), error => error instanceof FirebaseAuthError && error.code === "recent_reauthentication_required");
  assert.notEqual(await (await f.get(cookie)).json(), null);
  await responseCode(await f.exchange(token, cookie, f.userId), 401, "recent_reauthentication_required");
});

test("JSON is bounded, cookie ambiguity fails closed, Node headers adapt without Better Auth, and old native API routes return explicit transition status", async () => {
  const f = fixture(), cookie = cookieOf(await f.exchange());
  const node = f.port.fromNodeHeaders({ cookie: "unrelated=value; " + cookie, "x-expected-user-id": f.userId, "x-multi": ["one", "two"] });
  assert.equal((await f.port.getSession({ headers: node }))?.user.id, f.userId); assert.equal(node.get("x-multi"), "one, two");
  assert.equal(await (await f.get(cookie + "; " + cookie)).json(), null);
  assert.equal(await (await f.get("__session=malformed%20cookie")).json(), null);
  for (const [headers, body, status, code] of [
    [{}, "{}", 415, "json_required"], [{ "Content-Type": "application/json" }, "{", 400, "auth_body_invalid"],
    [{ "Content-Type": "application/json" }, JSON.stringify({ idToken: "a".repeat(16 * 1024) }), 413, "auth_body_too_large"],
  ] as const) {
    await responseCode(await f.port.handler(new Request(PUBLIC_ORIGIN + "/api/auth/session",
      { method: "POST", headers: { Origin: PUBLIC_ORIGIN, ...headers }, body })), status, code);
  }
  for (const path of ["/sign-up/email", "/sign-in/email", "/request-password-reset", "/reset-password", "/delete-user"]) {
    await responseCode(await f.post("/api/auth" + path, { email: "private@example.test", password: "not-saved" }), 503, "auth_provider_transition_required");
  }
  const records = JSON.stringify([...f.records]); assert.equal(records.includes("not-saved"), false);
});

test("same-cookie exchange uses the Admin cookie expiry and remains replay safe within the same second", async () => {
  const f = fixture(), cookie = cookieOf(await f.exchange());
  f.setNow(f.now() + 123);
  assert.equal(cookieOf(await f.exchange(f.firstToken, cookie, f.userId)), cookie);
  assert.equal(f.records.size, 2);
});


test("Firebase lifecycle admission preserves fixed authority business refusals and keeps unknown failures unavailable", async () => {
  for (const stage of ["admitIdentity", "assertSessionAdmission"]) {
    const f = fixture();
    for (const code of ["invitation_required", "invitation_unavailable", "account_inactive", "account_not_ready",
      "service_disabled", "identity_email_changed", "binding"]) {
      f.lifecycleFailures.set(stage, Object.assign(new Error("Private authority details"), { status: 403, code }));
      await responseCode(await f.exchange(), 403, code);
    }
    f.lifecycleFailures.set(stage, Object.assign(new Error("private@example.test"), { status: 403, code: "private@example.test" }));
    await responseCode(await f.exchange(), 503, "account_admission_unavailable");
    assert.equal(f.records.size, 0);
  }
});




test("current Admin verification overrides old verified claims on reads and session exchange", async () => {
  const f = fixture(), token = f.token(f.userId, Math.floor(f.now() / 1000), true);
  const cookie = cookieOf(await f.exchange(token)), rawCookie = cookie.slice("__session=".length);
  assert.equal(f.cookies.get(rawCookie)!.email_verified, true);
  const current = f.users.get(f.userId)!;
  f.users.set(f.userId, { ...current, emailVerified: false } as UserRecord);
  f.admissionIdentities.length = 0;
  const response = await f.get(cookie);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).user.id, f.userId);
  assert.equal(response.headers.has("set-cookie"), false);
  assert.deepEqual(f.admissionIdentities.at(-1), { userId: f.userId,
    currentIdentity: { email: current.email!, emailVerified: false } });
  assert.equal(cookieOf(await f.exchange(token, cookie, f.userId)), cookie);
  assert.equal(f.admissions.at(-1)!.emailVerified, false);
  assert.ok(f.admissionIdentities.every(value => value.currentIdentity?.emailVerified === false));
  f.lifecycleFailures.set("assertSessionAdmission", new Error("Synthetic canonical update unavailable"));
  await responseCode(await f.get(cookie), 503, "account_admission_unavailable");
  f.lifecycleFailures.set("assertSessionAdmission", Object.assign(new Error(), { status: 403, code: "account_not_ready" }));
  await responseCode(await f.get(cookie), 403, "account_not_ready");
  f.lifecycleFailures.clear();
  assert.equal((await (await f.get(cookie)).json()).user.id, f.userId);
});

test("session duration uses verified issuer time with bounded clock skew", async () => {
 const f=fixture(), native=f.options.auth.createSessionCookie;
 let extra=0;
 const port=createFirebaseAuthPort({...f.options,auth:{...f.options.auth,async createSessionCookie(value,options){
  const cookie=await native(value,options), claims=f.cookies.get(cookie)!;
  claims.iat+=1;claims.exp+=1+extra;return cookie;
 }}});
 const exchange=(token:string)=>port.handler(new Request(PUBLIC_ORIGIN+"/api/auth/session",{method:"POST",
  headers:{Origin:PUBLIC_ORIGIN,"Content-Type":"application/json"},body:JSON.stringify({idToken:token})}));
 assert.equal((await exchange(f.firstToken)).status,200);
 extra=1;await responseCode(await exchange(f.token()),503,"authentication_unavailable");
});
