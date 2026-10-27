import type { AuthCredential } from "firebase/auth";
import type { AppleRequestOptions, AppleRequestResponse, AppleRequestOperation, AppleRequestScope, AndroidConfig } from "@invertase/react-native-apple-authentication";
import type { FirebaseIdentityUser, FirebaseSocialIdentitySdk } from "../../../src/client/firebase-auth-api.ts";
import { socialAuthProviderSchema, type SocialAuthProvider } from "../../../src/shared/auth-providers.ts";

export interface NativeProviderConfig {
  platform: "ios" | "android" | "unsupported"; providers?: string;
  googleWebClientId?: string; googleIosClientId?: string; appleServiceId?: string; appleRedirectUri?: string;
}
type AppleAndroidOptions = Omit<AndroidConfig, "responseType" | "scope"> & { responseType: "ID_TOKEN"; scope: "ALL" };
export interface NativeProviderPorts {
  google(): Promise<{ cancelledCode: string; sdk: Pick<typeof import("@react-native-google-signin/google-signin").GoogleSignin,
    "configure" | "hasPlayServices" | "signOut" | "signIn"> }>;
  appleIOS?: { isSupported: boolean; Operation: { LOGIN: AppleRequestOperation }; Scope: { FULL_NAME: AppleRequestScope; EMAIL: AppleRequestScope };
    Error: { CANCELED: string }; performRequest(options: AppleRequestOptions): Promise<Pick<AppleRequestResponse, "identityToken" | "state">> };
  appleAndroid?: { isSupported: boolean; ResponseType: { ID_TOKEN: "ID_TOKEN" }; Scope: { ALL: "ALL" }; Error: { SIGNIN_CANCELLED: string };
    configure(options: AppleAndroidOptions): void; signIn(): Promise<{ id_token?: string; state: string }> };
  randomBytes(count: number): Promise<Uint8Array>;
  firebase: {
    googleCredential(idToken: string): AuthCredential;
    appleCredential(idToken: string, rawNonce: string): AuthCredential;
    signIn(credential: AuthCredential): Promise<FirebaseIdentityUser>;
    link(user: FirebaseIdentityUser, credential: AuthCredential): Promise<FirebaseIdentityUser>;
  };
}
const failure = (code: string) => Object.assign(new Error("Native authentication could not be confirmed"), { code });
const code = (error: unknown) => error && typeof error === "object" && "code" in error ? String(error.code) : null;
const tokenPresent = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
function validRedirect(value: string | undefined) {
  try { const url = new URL(value ?? ""); return url.protocol === "https:" && !url.username && !url.password && !url.hash; }
  catch { return false; }
}

/** Native credentials return to the existing Firebase identity port; no business session lives here. */
export function createNativeProviderAdapter(config: NativeProviderConfig, ports: NativeProviderPorts): FirebaseSocialIdentitySdk {
  const requested = (config.providers ?? "").split(",").map(value => value.trim());
  const providers: readonly SocialAuthProvider[] = Object.freeze([...new Set(requested.filter((provider): provider is SocialAuthProvider => {
    if (!socialAuthProviderSchema.safeParse(provider).success || config.platform === "unsupported") return false;
    if (provider === "google.com") return !!config.googleWebClientId?.trim() && (config.platform !== "ios" || !!config.googleIosClientId?.trim());
    return config.platform === "ios" ? ports.appleIOS?.isSupported === true
      : ports.appleAndroid?.isSupported === true && !!config.appleServiceId?.trim() && validRedirect(config.appleRedirectUri);
  }))]);
  async function credential(provider: SocialAuthProvider): Promise<AuthCredential> {
    if (!providers.includes(provider)) throw failure("auth/operation-not-allowed");
    if (provider === "google.com") {
      const { sdk, cancelledCode } = await ports.google();
      sdk.configure({ webClientId: config.googleWebClientId!.trim(), offlineAccess: false,
        ...(config.platform === "ios" ? { iosClientId: config.googleIosClientId!.trim() } : {}) });
      if (config.platform === "android" && !await sdk.hasPlayServices({ showPlayServicesUpdateDialog: true })) throw new Error("Google Play services unavailable");
      // Clear the local account selection, without revoking the user's provider grants.
      await sdk.signOut();
      let idToken: string;
      try {
        const result = await sdk.signIn();
        if (result.type === "cancelled") throw failure("auth/popup-closed-by-user");
        if (!tokenPresent(result.data.idToken)) throw failure("auth/invalid-credential");
        idToken = result.data.idToken;
      } catch (error) {
        if (code(error) === cancelledCode) throw failure("auth/popup-closed-by-user");
        throw error;
      } finally { await sdk.signOut(); }
      return ports.firebase.googleCredential(idToken);
    }
    const [nonceBytes, stateBytes] = await Promise.all([ports.randomBytes(32), ports.randomBytes(32)]);
    if (nonceBytes.length !== 32 || stateBytes.length !== 32) throw new Error("Native secure randomness unavailable");
    const hex = (bytes: Uint8Array) => Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
    const nonce = hex(nonceBytes), state = hex(stateBytes);
    let idToken: string | null | undefined, returnedState: string | null;
    if (config.platform === "ios") {
      const sdk = ports.appleIOS!;
      try {
        const result = await sdk.performRequest({ requestedOperation: sdk.Operation.LOGIN,
          requestedScopes: [sdk.Scope.FULL_NAME, sdk.Scope.EMAIL], nonce, nonceEnabled: true, state });
        idToken = result.identityToken; returnedState = result.state;
      } catch (error) { if (code(error) === sdk.Error.CANCELED) throw failure("auth/popup-closed-by-user"); throw error; }
    } else {
      const sdk = ports.appleAndroid!;
      sdk.configure({ clientId: config.appleServiceId!.trim(), redirectUri: config.appleRedirectUri!, responseType: sdk.ResponseType.ID_TOKEN,
        scope: sdk.Scope.ALL, nonce, nonceEnabled: true, state });
      try { const result = await sdk.signIn(); idToken = result.id_token; returnedState = result.state; }
      catch (error) { if (code(error) === sdk.Error.SIGNIN_CANCELLED) throw failure("auth/popup-closed-by-user"); throw error; }
    }
    if (returnedState !== state || !tokenPresent(idToken)) throw failure("auth/invalid-credential");
    // The Apple SDK hashes this nonce before authorization; Firebase needs the original value.
    return ports.firebase.appleCredential(idToken, nonce);
  }
  return {
    providers,
    signIn: async provider => ports.firebase.signIn(await credential(provider)),
    link: async (user, provider) => ports.firebase.link(user, await credential(provider)),
  };
}
