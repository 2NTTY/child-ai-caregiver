import assert from "node:assert/strict";
import test from "node:test";
import type { AuthCredential } from "firebase/auth";
import { createNativeProviderAdapter, type NativeProviderPorts } from "./native-provider-adapter.ts";

test("native provider credentials keep one Firebase sign-in/link path and reject cancellation or wrong Apple state", async () => {
  const original = { uid: "native-user", email: "synthetic@example.test", emailVerified: true };
  const events: string[] = [], appleInputs: { nonce?: string; state?: string }[] = [];
  let cancelled = false, wrongState = false, random = 0, googleConfiguration: unknown, androidConfiguration: unknown;
  const credential = (provider: string, idToken: string, rawNonce?: string): AuthCredential & { idToken: string; rawNonce?: string } => ({
    providerId: provider, signInMethod: provider, idToken, rawNonce,
    toJSON: () => ({ providerId: provider, signInMethod: provider, idToken, rawNonce }),
  });
  const ports: NativeProviderPorts = {
    randomBytes: async count => new Uint8Array(count).fill(++random),
    google: async () => ({ cancelledCode: "SIGN_IN_CANCELLED", sdk: {
      configure(options) { googleConfiguration = options; },
      hasPlayServices: async () => { events.push("play-services"); return true; },
      signOut: async () => { events.push("google-clear"); return null; },
      signIn: async () => { events.push("google-sign-in"); return cancelled ? { type: "cancelled", data: null } : {
        type: "success", data: { idToken: "synthetic-google-token", serverAuthCode: null, scopes: [],
          user: { id: "google-id", email: original.email, name: null, photo: null, familyName: null, givenName: null } },
      }; },
    } }),
    appleIOS: { isSupported: true, Operation: { LOGIN: 1 }, Scope: { FULL_NAME: 1, EMAIL: 0 }, Error: { CANCELED: "1001" },
      performRequest: async options => {
        assert.equal(options.requestedOperation, 1); assert.deepEqual(options.requestedScopes, [1, 0]);
        assert.equal(options.nonceEnabled, true); appleInputs.push(options);
        if (cancelled) throw { code: "1001", message: "Raw native message must not be exposed" };
        return { identityToken: "synthetic-apple-token", state: wrongState ? "other-state" : options.state ?? null };
      } },
    appleAndroid: { isSupported: true, ResponseType: { ID_TOKEN: "ID_TOKEN" }, Scope: { ALL: "ALL" }, Error: { SIGNIN_CANCELLED: "cancelled" },
      configure(options) { androidConfiguration = options; appleInputs.push(options); },
      signIn: async () => ({ id_token: "synthetic-apple-token", state: (androidConfiguration as { state: string }).state }),
    },
    firebase: {
      googleCredential: token => credential("google.com", token),
      appleCredential: (token, nonce) => credential("apple.com", token, nonce),
      signIn: async proof => { events.push("firebase-sign-in"); assert.equal(proof.providerId, "google.com"); return original; },
      link: async (user, proof) => {
        events.push("firebase-link"); assert.equal(user, original); assert.equal(proof.providerId, "apple.com");
        assert.equal((proof as AuthCredential & { rawNonce: string }).rawNonce, appleInputs.at(-1)!.nonce); return user;
      },
    },
  };
  const configured = { providers: "google.com,apple.com,unknown", googleWebClientId: "synthetic-web", googleIosClientId: "synthetic-ios",
    appleServiceId: "example.synthetic.service", appleRedirectUri: "https://example.test/apple/callback" };
  const ios = createNativeProviderAdapter({ ...configured, platform: "ios" }, ports);
  assert.deepEqual(ios.providers, ["google.com", "apple.com"]);
  assert.equal(await ios.signIn("google.com"), original);
  assert.deepEqual(googleConfiguration, { webClientId: configured.googleWebClientId, iosClientId: configured.googleIosClientId, offlineAccess: false });
  assert.deepEqual(events, ["google-clear", "google-sign-in", "google-clear", "firebase-sign-in"]);
  assert.equal(await ios.link(original, "apple.com"), original);
  assert.match(appleInputs[0].nonce!, /^[a-f0-9]{64}$/u); assert.notEqual(appleInputs[0].nonce, appleInputs[0].state);
  const before = events.filter(value => value.startsWith("firebase-")).length;
  cancelled = true;
  const cancellation = (error: unknown) => (error as { code?: string }).code === "auth/popup-closed-by-user";
  await assert.rejects(ios.signIn("google.com"), cancellation); await assert.rejects(ios.link(original, "apple.com"), cancellation);
  cancelled = false; wrongState = true;
  await assert.rejects(ios.link(original, "apple.com"), (error: unknown) => (error as { code?: string }).code === "auth/invalid-credential");
  assert.equal(events.filter(value => value.startsWith("firebase-")).length, before);
  assert.notEqual(appleInputs[0].nonce, appleInputs[1].nonce); wrongState = false;
  const android = createNativeProviderAdapter({ ...configured, platform: "android" }, ports);
  await android.signIn("google.com"); assert.equal(events.includes("play-services"), true);
  await android.link(original, "apple.com");
  assert.deepEqual(androidConfiguration, { clientId: configured.appleServiceId, redirectUri: configured.appleRedirectUri,
    responseType: "ID_TOKEN", scope: "ALL", nonceEnabled: true, nonce: appleInputs.at(-1)!.nonce, state: appleInputs.at(-1)!.state });
  assert.deepEqual(createNativeProviderAdapter({ ...configured, platform: "ios", googleIosClientId: "" }, ports).providers, ["apple.com"]);
  assert.deepEqual(createNativeProviderAdapter({ ...configured, platform: "android", appleRedirectUri: "http://example.test" }, ports).providers, ["google.com"]);
  assert.deepEqual(createNativeProviderAdapter({ platform: "android", providers: "" }, ports).providers, []);
});
