import type { FirebaseSocialIdentityFactory } from "../../../src/client/firebase-auth-api.ts";

/** Native providers stay unavailable until their device SDK adapters are installed. */
export const firebaseSocialFactory: FirebaseSocialIdentityFactory | undefined = undefined;
