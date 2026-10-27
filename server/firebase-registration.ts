import { HttpsError, type AuthBlockingEvent } from "firebase-functions/v2/identity";
import { z } from "zod";
import { decodeFirebaseStorageKey } from "./firebase-storage-key.ts";
import { FirestoreAuthorityError, type FirestoreAuthority } from "./firestore-authority.ts";

export const FIREBASE_REGISTRATION_DEADLINE_MS = 6000;
const BEFORE_CREATE = "providers/cloud.auth/eventTypes/user.beforeCreate:";
const registrationProviders = new Set(['password', 'google.com', 'apple.com']);
const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const DENIED_CODES = new Map([["not_found", 404], ["invitation_unavailable", 403], ["service_disabled", 403], ["invalid_input", 400]]);
const deny = () => new HttpsError("permission-denied", "Registration is not permitted");
const unavailable = () => new HttpsError("unavailable", "Registration is temporarily unavailable");

export interface FirebaseRegistrationOptions {
  /** Only the read-only invitation check is exposed; admission/consumption is a separate transaction. */
  authority: Pick<FirestoreAuthority, "assertCanRegister">;
  projectId: string;
  tenantId?: string | null;
}
export type FirebaseRegistrationHandler = (event: AuthBlockingEvent) => Promise<void>;

/** Strict canonical base64, no whitespace, files, logging or fallback key. */
export function decodeFirebaseRegistrationStorageKey(encoded: string): Buffer {
  try { return decodeFirebaseStorageKey(encoded); } catch { throw unavailable(); }
}

/** Receives only events authenticated by beforeUserCreated's native SDK wrapper, never HTTP bodies. */
export function createFirebaseRegistrationHandler({ authority, projectId, tenantId = null }: FirebaseRegistrationOptions): FirebaseRegistrationHandler {
  if (typeof authority?.assertCanRegister !== "function" || !PROJECT_ID.test(projectId)
    || tenantId !== null && (typeof tenantId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(tenantId))) throw unavailable();
  const expectedResource = "projects/" + projectId + (tenantId === null ? "" : "/tenants/" + tenantId);
  return async event => {
    const user = event?.data;
    const provider = typeof event?.eventType === 'string' && event.eventType.startsWith(BEFORE_CREATE)
      ? event.eventType.slice(BEFORE_CREATE.length) : '';
    if (!registrationProviders.has(provider) || event.authType !== "USER"
      || event.resource?.service !== "identitytoolkit.googleapis.com" || event.resource.name !== expectedResource
      || !user || !z.email().max(320).safeParse(user.email).success
      || user.tenantId !== undefined && user.tenantId !== tenantId
      || event.additionalUserInfo?.providerId !== undefined && event.additionalUserInfo.providerId !== provider
      || event.credential != null && (event.credential.providerId !== provider || event.credential.signInMethod !== provider)
      || provider !== 'password' && user.emailVerified !== true
      || !Array.isArray(user.providerData) || user.providerData.some(item => item.providerId !== provider)) throw deny();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(unavailable()), FIREBASE_REGISTRATION_DEADLINE_MS);
      });
      // This port only reads. A late SDK read may finish, but cannot consume an invitation or grant a late success.
      await Promise.race([authority.assertCanRegister(user.email!), deadline]);
    } catch (error) {
      if (error instanceof FirestoreAuthorityError && DENIED_CODES.get(error.code) === error.status) throw deny();
      throw unavailable();
    } finally { if (timer !== undefined) clearTimeout(timer); }
  };
}

