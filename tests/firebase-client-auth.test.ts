import assert from "node:assert/strict";
import test from "node:test";
import { createFirebaseAuthApi, createUnavailableFirebaseAuthApi, type FirebaseIdentitySdk, type FirebaseIdentityUser } from "../src/client/firebase-auth-api.ts";
import { createAccountAuthApi } from "../src/client/account-auth-api.ts";
import { ClientApiError, createRecordsApi, type SessionUser } from "../src/client/records-api.ts";

const publicOrigin = "https://app.example.invalid";
const config = { apiKey: "synthetic-public-api-key-2026", authDomain: "test-project.firebaseapp.com", projectId: "test-project", appId: "1:123:web:abc123" };
const credentials = { name: "Synthetic parent", email: "alice@example.invalid", password: "synthetic-private-password" };
const signal = () => new AbortController().signal;
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function fixture(verified = true) {
  const alice = { uid: "alice", email: credentials.email, emailVerified: verified };
  const state = { current: null as FirebaseIdentityUser | null, session: null as SessionUser | null,
    clearCalls: 0, signinCalls: 0, signupCalls: 0, nameCalls: 0, reloadCalls: 0, verificationCalls: 0, exchanges: [] as string[],
    resetCalls: 0, confirmCalls: 0, revokeCalls: 0, signoutCalls: 0 };
  const sdk: FirebaseIdentitySdk = {
    currentUser: () => state.current,
    signIn: async (email, password) => { assert.equal(email, credentials.email); assert.equal(password, credentials.password);
      state.signinCalls++; state.current = alice; return alice; },
    signUp: async (email, password) => { assert.equal(email, credentials.email); assert.equal(password, credentials.password);
      state.signupCalls++; state.current = alice; return alice; },
    updateName: async (user, name) => { assert.equal(user, alice); assert.equal(name, credentials.name); state.nameCalls++; },
    reload: async user => { assert.equal(user, state.current); state.reloadCalls++; },
    idToken: async user => "synthetic-id-token-" + user.uid,
    sendVerification: async (user, url) => { assert.equal(user, state.current); assert.equal(url, publicOrigin + "/?account=verified"); state.verificationCalls++; },
    requestReset: async (email, url) => { assert.equal(email, credentials.email); assert.equal(url, publicOrigin + "/"); state.resetCalls++; },
    confirmReset: async (token, password) => { assert.equal(token, "synthetic-verification-token"); assert.equal(password, credentials.password); state.confirmCalls++; },
    clear: async () => { state.current = null; state.clearCalls++; },
  };
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal(init?.credentials, "include"); assert.equal(init?.cache, "no-store");
    const path = new URL(String(input), publicOrigin).pathname;
    if (path === "/api/auth/get-session") return Response.json(state.session ? { user: state.session } : null);
    const expected = new Headers(init?.headers).get("x-expected-user-id");
    if (path === "/api/auth/session") {
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(Object.keys(body), ["idToken"]);
      assert.equal(body.idToken, "synthetic-id-token-" + state.current!.uid);
      assert.equal(expected, state.session?.id ?? state.current!.uid);
      state.exchanges.push(state.current!.uid);
      if (state.session && state.session.id !== state.current!.uid) return Response.json({ code: "sign_out_required" }, { status: 409 });
      state.session = { id: state.current!.uid, email: state.current!.email!, name: credentials.name };
      return Response.json({ user: state.session });
    }
    assert.equal(expected, state.session?.id);
    if (path === "/api/auth/sign-out") { state.signoutCalls++; state.session = null; return Response.json({ success: true }); }
    if (path === "/api/auth/revoke-other-sessions") { state.revokeCalls++; return Response.json({ success: true }); }
    throw new Error("Unexpected Server request");
  };
  const identity = createFirebaseAuthApi({ baseUrl: "/api", publicOrigin, config, fetcher, sdk });
  const records = createRecordsApi("/api", fetcher, identity), account = createAccountAuthApi("/api", fetcher, identity);
  return { alice, state, sdk, fetcher, identity, records, account };
}

test("Firebase identity exchanges only an ID token with the original cookie UID, then clears verified SDK state", async () => {
  const f = fixture();
  f.state.session = { id: "alice", email: credentials.email, name: "Original" };
  await f.records.authenticate("signIn", credentials, signal());
  assert.deepEqual(f.state.exchanges, ["alice"]); assert.equal(f.state.current, null); assert.equal(f.state.clearCalls, 2);
  assert.deepEqual(await f.records.getSession(signal()), { id: "alice", email: credentials.email, name: credentials.name });
  assert.equal(f.state.verificationCalls, 0);
  f.state.session = { id: "bob", email: "bob@example.invalid", name: "Other" };
  await assert.rejects(f.records.authenticate("signIn", credentials, signal()), error => error instanceof ClientApiError && error.status === 409);
  assert.equal(f.state.session.id, "bob"); assert.equal(f.state.current, null);
});

test("SDK state never establishes a business session and incomplete provider selection fails closed", async () => {
  const f = fixture(false); f.state.current = f.alice;
  assert.equal(await f.records.getSession(signal()), null);
  let requests = 0;
  const records = createRecordsApi("/api", async () => { requests++; return Response.json({ user: { id: "legacy", name: "Legacy", email: credentials.email } }); }, createUnavailableFirebaseAuthApi());
  await assert.rejects(records.getSession(signal()), error => error instanceof ClientApiError && error.onlineCode === "auth_provider_unavailable");
  await assert.rejects(records.authenticate("signIn", credentials, signal()), ClientApiError); assert.equal(requests, 0);
  for (const options of [{ config: { ...config, projectId: "other-project" } }, { baseUrl: "https://foreign.invalid/api" }, { config: { ...config, apiKey: "" } }]) {
    assert.throws(() => createFirebaseAuthApi({ baseUrl: "/api", publicOrigin, config, sdk: f.sdk, ...options }), ClientApiError);
  }
});

test("unverified signup retains only its page identity for explicit verification and uses fixed hosted action callbacks", async () => {
  const f = fixture(false);
  await f.records.authenticate("signUp", credentials, signal());
  assert.equal(f.state.signupCalls, 1); assert.equal(f.state.nameCalls, 1); assert.equal(f.state.verificationCalls, 0);
  assert.equal(f.state.current, f.alice); await f.records.getSession(signal());
  await f.account.requestVerification(credentials.email, signal());
  assert.equal(f.state.reloadCalls, 1); assert.equal(f.state.verificationCalls, 1);
  await f.account.requestPasswordReset(credentials.email, signal());
  await f.account.resetPassword("synthetic-verification-token", credentials.password, signal());
  await f.account.revokeOtherSessions("alice", signal());
  assert.equal(f.state.resetCalls, 1); assert.equal(f.state.confirmCalls, 1); assert.equal(f.state.revokeCalls, 1);
  await f.records.signOut(signal());
  assert.equal(f.state.signoutCalls, 1); assert.equal(f.state.current, null);
});

test("resend after reload or an account change requires fresh matching native credentials", async () => {
  const f = fixture(false); await f.records.authenticate("signIn", credentials, signal());
  const reloaded = createFirebaseAuthApi({ baseUrl: "/api", publicOrigin, config, fetcher: f.fetcher, sdk: { ...f.sdk, currentUser: () => null } });
  await assert.rejects(reloaded.requestVerification(credentials.email, signal()), error => error instanceof ClientApiError && error.onlineCode === "firebase_reauthentication_required");
  assert.equal(f.state.verificationCalls, 0);
  await f.records.authenticate("signIn", credentials, signal());
  f.state.session = { id: "bob", email: "bob@example.invalid", name: "Other" };
  await assert.rejects(f.account.requestVerification(credentials.email, signal()), error => error instanceof ClientApiError && error.onlineCode === "firebase_reauthentication_required");
  assert.equal(f.state.verificationCalls, 0); assert.equal(f.state.current, null);
});

test("verification reload rechecks the UID, email and authoritative session before any mail side effect", async () => {
  const f = fixture(false); await f.records.authenticate("signIn", credentials, signal());
  f.sdk.reload = async () => { f.state.session = { id: "bob", email: "bob@example.invalid", name: "Other" }; };
  await assert.rejects(f.account.requestVerification(credentials.email, signal()), ClientApiError);
  assert.equal(f.state.verificationCalls, 0); assert.equal(f.state.current, null);
  f.state.session = null; await f.records.authenticate("signIn", credentials, signal());
  f.sdk.reload = async () => { f.alice.emailVerified = true; };
  await assert.rejects(f.account.requestVerification(credentials.email, signal()), ClientApiError);
  assert.equal(f.state.verificationCalls, 0); assert.equal(f.state.current, null);
});

test("an aborted late SDK login cannot exchange a cookie or overwrite the next identity", async () => {
  const f = fixture(false), started = deferred<void>(), late = deferred<FirebaseIdentityUser>();
  const bob = { uid: "bob", email: credentials.email, emailVerified: true };
  let calls = 0;
  f.sdk.signIn = async () => {
    if (++calls === 1) { started.resolve(); const user = await late.promise; f.state.current = user; return user; }
    f.state.current = bob; return bob;
  };
  const controller = new AbortController(), old = f.records.authenticate("signIn", credentials, controller.signal);
  await started.promise; controller.abort(); await assert.rejects(old, ClientApiError);
  const next = f.records.authenticate("signIn", credentials, signal());
  await turn(); assert.equal(calls, 1); assert.deepEqual(f.state.exchanges, []);
  late.resolve(f.alice); await next;
  assert.deepEqual(f.state.exchanges, ["bob"]); assert.equal(f.state.current, null);
  assert.equal((await f.records.getSession(signal()))?.id, "bob");
});

test("the 20 second deadline rejects promptly and fences a late SDK success", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(false), started = deferred<void>(), late = deferred<FirebaseIdentityUser>();
  f.sdk.signIn = async () => { started.resolve(); const user = await late.promise; f.state.current = user; return user; };
  const pending = f.records.authenticate("signIn", credentials, signal());
  await started.promise; context.mock.timers.tick(20_000);
  await assert.rejects(pending, error => error instanceof ClientApiError && error.status === 0);
  late.resolve(f.alice); await turn(); assert.deepEqual(f.state.exchanges, []); assert.equal(f.state.current, null);
});

test("profile failure is not signup success and provider errors never expose or log secrets", async context => {
  const f = fixture(false), logs: unknown[][] = [];
  for (const method of ["log", "info", "warn", "error", "debug"] as const) context.mock.method(console, method, (...values: unknown[]) => { logs.push(values); });
  f.sdk.updateName = async () => { throw new Error(credentials.password + " synthetic-verification-token"); };
  await assert.rejects(f.records.authenticate("signUp", credentials, signal()), error => error instanceof ClientApiError
    && !error.message.includes(credentials.password) && !error.message.includes("synthetic-verification-token"));
  assert.deepEqual(f.state.exchanges, []); assert.equal(f.state.current, null); assert.equal(f.state.verificationCalls, 0);
  f.sdk.confirmReset = async () => { throw { code: "auth/internal-error", message: "synthetic-verification-token " + credentials.password }; };
  await assert.rejects(f.account.resetPassword("synthetic-verification-token", credentials.password, signal()), error => error instanceof ClientApiError
    && !JSON.stringify(error).includes(credentials.password) && !error.message.includes("synthetic-verification-token"));
  assert.deepEqual(logs, []);
});
