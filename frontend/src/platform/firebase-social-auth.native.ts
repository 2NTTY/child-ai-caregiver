import { Platform } from "react-native";
import { getRandomBytesAsync } from "expo-crypto";
import { GoogleAuthProvider, OAuthProvider, signInWithCredential, linkWithCredential, type User } from "firebase/auth";
import type { FirebaseSocialIdentityFactory } from "../../../src/client/firebase-auth-api.ts";
import { createNativeProviderAdapter, type NativeProviderPorts } from "./native-provider-adapter";

export const firebaseSocialFactory: FirebaseSocialIdentityFactory = auth => {
  const platform = Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : "unsupported";
  const providers: string = process.env.EXPO_PUBLIC_AUTH_PROVIDERS ?? "";
  let appleIOS: NativeProviderPorts["appleIOS"], appleAndroid: NativeProviderPorts["appleAndroid"];
  if (providers.split(",").some(value => value.trim() === "apple.com") && platform !== "unsupported") {
    const sdk = require("@invertase/react-native-apple-authentication") as typeof import("@invertase/react-native-apple-authentication");
    if (platform === "ios") appleIOS = sdk.appleAuth;
    else appleAndroid = {
      isSupported: sdk.appleAuthAndroid.isSupported,
      Error: sdk.appleAuthAndroid.Error, ResponseType: { ID_TOKEN: "ID_TOKEN" }, Scope: { ALL: "ALL" },
      configure: options => sdk.appleAuthAndroid.configure({ ...options,
        responseType: sdk.appleAuthAndroid.ResponseType.ID_TOKEN, scope: sdk.appleAuthAndroid.Scope.ALL }),
      signIn: () => sdk.appleAuthAndroid.signIn(),
    };
  }
  return createNativeProviderAdapter({ platform, providers,
    googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID, googleIosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    appleServiceId: process.env.EXPO_PUBLIC_APPLE_SERVICE_ID, appleRedirectUri: process.env.EXPO_PUBLIC_APPLE_REDIRECT_URI,
  }, {
    appleIOS, appleAndroid, randomBytes: getRandomBytesAsync,
    google: async () => {
      const sdk = await import("@react-native-google-signin/google-signin");
      return { sdk: sdk.GoogleSignin, cancelledCode: sdk.statusCodes.SIGN_IN_CANCELLED };
    },
    firebase: {
      googleCredential: token => GoogleAuthProvider.credential(token),
      appleCredential: (token, rawNonce) => new OAuthProvider("apple.com").credential({ idToken: token, rawNonce }),
      signIn: async credential => (await signInWithCredential(auth, credential)).user,
      link: async (user, credential) => (await linkWithCredential(user as User, credential)).user,
    },
  });
};
