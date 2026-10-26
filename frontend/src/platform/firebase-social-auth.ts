import type { FirebaseSocialIdentityFactory } from "../../../src/client/firebase-auth-api.ts";

/** Non-platform fallback; Metro selects the Web or native adapter in actual clients. */
export const firebaseSocialFactory: FirebaseSocialIdentityFactory | undefined = undefined;
