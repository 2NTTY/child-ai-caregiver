import { browserPopupRedirectResolver, GoogleAuthProvider, OAuthProvider, linkWithPopup, signInWithPopup, type User } from "firebase/auth";
import type { FirebaseSocialIdentityFactory } from "../../../src/client/firebase-auth-api.ts";
import { socialAuthProviderSchema, type SocialAuthProvider } from "../../../src/shared/auth-providers.ts";

const configuredProviders: string = process.env.EXPO_PUBLIC_AUTH_PROVIDERS ?? "";
const providers: readonly SocialAuthProvider[] = Object.freeze([...new Set(configuredProviders.split(",").map(value => value.trim())
  .filter((value): value is SocialAuthProvider => socialAuthProviderSchema.safeParse(value).success))]);
const providerInstance = (provider: SocialAuthProvider) => {
  if (!providers.includes(provider)) throw new Error("Authentication provider unavailable");
  if (provider === "google.com") return new GoogleAuthProvider();
  const apple = new OAuthProvider("apple.com"); apple.addScope("email"); apple.addScope("name"); return apple;
};

export const firebaseSocialFactory: FirebaseSocialIdentityFactory = auth => ({
  providers,
  signIn: async provider => (await signInWithPopup(auth, providerInstance(provider), browserPopupRedirectResolver)).user,
  link: async (user, provider) => (await linkWithPopup(user as User, providerInstance(provider), browserPopupRedirectResolver)).user,
});
