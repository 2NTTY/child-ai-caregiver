import { NATIVE_SESSION_PREFIX, nativeRequestContext, nativeSessionCredential, requestOriginAllowed } from "./request-auth-transport.ts";
import { createHash } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import type { Auth, DecodedIdToken, UserRecord } from "firebase-admin/auth";
import type { FirestoreDeviceSessions } from "./firestore-device-sessions.ts";
import type { ServerAuthPort, ServerAuthSession, ServerAuthSessionWithHeaders } from "./auth-port.ts";
import { DeviceSessionError, type DeviceSessionsPort } from "./firestore-device-sessions.ts";
import { accountAuthProviderSchema, socialAuthProviderSchema, type AccountAuthMethods, type AccountAuthProvider } from '../src/shared/auth-providers.ts';
import type { ProviderAdmission, ProviderGrants, ProviderIdentity } from './firestore-authority.ts';

export const FIREBASE_SESSION_LIFETIME_MS = 5 * 24 * 60 * 60 * 1000;
export const FIREBASE_RECENT_AUTH_SECONDS = 5 * 60;
const MAX_BODY_BYTES = 16 * 1024;
const COOKIE_NAME = "__session";
const hashCookie = (cookie: string, native = false) => createHash("sha256").update((native ? "native-session\0" : "") + cookie, "utf8").digest("hex");
const invalidCredentials = new Set(["auth/id-token-expired", "auth/id-token-revoked", "auth/invalid-id-token",
  "auth/session-cookie-expired", "auth/session-cookie-revoked", "auth/invalid-session-cookie", "auth/argument-error",
  "auth/user-disabled", "auth/user-not-found"]);
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
export interface FirebaseIdentityAdmission {
  admitIdentity(input: { userId: string; email: string; emailVerified: boolean }, proof: ProviderAdmission): Promise<unknown>;
  assertSessionAdmission(userId: string, currentIdentity: { email: string; emailVerified: boolean }, method: ProviderIdentity): Promise<ProviderGrants>;
}
export interface FirebaseAuthPortOptions {
  auth: Pick<Auth, "verifyIdToken" | "createSessionCookie" | "verifySessionCookie" | "getUser">;
  sessions: DeviceSessionsPort & Pick<FirestoreDeviceSessions, 'assertActiveIn'>;
  lifecycle: FirebaseIdentityAdmission;
  publicOrigin: string;
  serverClock?: () => number;
  /** Defaults to true. Only explicitly non-production loopback HTTP may omit Secure. */
  production?: boolean;
  /** Trusted loopback development only: cookies are not isolated by port. */
  localCookieName?: string;
}
export class FirebaseAuthError extends Error {
  readonly status: 400 | 401 | 403 | 409 | 413 | 415 | 503;
  readonly code: string;
  constructor(status: FirebaseAuthError["status"], code: string) {
    super("Authentication request rejected"); this.name = "FirebaseAuthError"; this.status = status; this.code = code;
  }
}
export interface FirebaseAuthPort extends ServerAuthPort {
  assertRecentReauthentication(headers: Headers): Promise<ServerAuthSession>;
}
interface AuthenticatedSession {
  session: ServerAuthSession & { user: { id: string; name: string; email: string } };
  sessionHash: string;
  authTimeSeconds: number;
  method: ProviderIdentity;
  verifiedEmailAtIssue: boolean;
  methods: AccountAuthMethods;
}

/** Admin SDK and ledger are injected; importing or constructing never starts network work. */
export function createFirebaseAuthPort(options: FirebaseAuthPortOptions): FirebaseAuthPort {
  const { auth, sessions, lifecycle, publicOrigin, serverClock = Date.now, production = true } = options;
  let origin: URL;
  try { origin = new URL(publicOrigin); } catch { throw new FirebaseAuthError(400, "invalid_configuration"); }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if (origin.origin !== publicOrigin || origin.username || origin.password
    || origin.protocol !== "https:" && !(origin.protocol === "http:" && loopback && production === false)
    || typeof serverClock !== "function" || typeof production !== "boolean"
    || ["verifyIdToken", "createSessionCookie", "verifySessionCookie", "getUser"].some(key => typeof auth?.[key as keyof typeof auth] !== "function")
    || ["issue", "assertActive", "revokeThis", "revokeOthers"].some(key => typeof sessions?.[key as keyof DeviceSessionsPort] !== "function")
    || typeof lifecycle?.admitIdentity !== "function" || typeof lifecycle.assertSessionAdmission !== "function") {
    throw new FirebaseAuthError(400, "invalid_configuration");
  }
  const secure = origin.protocol === "https:";
  const cookieName = options.localCookieName ?? COOKIE_NAME;
  if (options.localCookieName !== undefined && (production || !loopback
    || !/^__local_session_[a-f0-9]{8}$/.test(cookieName))) throw new FirebaseAuthError(400, "invalid_configuration");
  const now = () => {
    const value = serverClock();
    if (!Number.isSafeInteger(value) || value < 0) throw new FirebaseAuthError(503, "authentication_unavailable");
    return value;
  };
  const cookieHeader = (value: string, maxAge: number) =>
    cookieName + "=" + value + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" + maxAge + (secure ? "; Secure" : "");
  const privateHeaders = () => new Headers({ "Cache-Control": "private, no-store", "Pragma": "no-cache", "Vary": "Cookie, Authorization" });
  function json(value: unknown, status = 200, cookie?: string) {
    const headers = privateHeaders(); headers.set("Content-Type", "application/json");
    if (cookie !== undefined) headers.set("Set-Cookie", cookie);
    return new Response(JSON.stringify(value), { status, headers });
  }
  const errorCode = (error: unknown) => record(error) && typeof error.code === "string" ? error.code : null;
  async function sdk<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error) {
      if (invalidCredentials.has(errorCode(error) ?? "")) throw new FirebaseAuthError(401, "unauthorized");
      throw new FirebaseAuthError(503, "authentication_unavailable");
    }
  }
  async function admission<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error) {
      if (error instanceof DeviceSessionError || error instanceof FirebaseAuthError) throw error;
      const admissionDeniedCodes = new Set(["invitation_required", "invitation_unavailable", "account_inactive",
        "account_not_ready", "service_disabled", "identity_email_changed", "binding", "email_not_verified",
        "auth_account_link_required", "auth_credential_in_use"]);
      if (record(error) && error.status === 403 && typeof error.code === "string" && admissionDeniedCodes.has(error.code)) {
        throw new FirebaseAuthError(403, error.code);
      }
      if (record(error) && error.status === 401 && error.code === "unauthorized") throw new FirebaseAuthError(401, "unauthorized");
      throw new FirebaseAuthError(503, "account_admission_unavailable");
    }
  }
  function validatedClaims(decoded: DecodedIdToken) {
    if (typeof decoded?.uid !== "string" || !decoded.uid || decoded.uid.length > 128 || !decoded.uid.isWellFormed()
      || decoded.sub !== decoded.uid || !Number.isSafeInteger(decoded.auth_time) || decoded.auth_time < 0
      || decoded.auth_time > Math.floor(now() / 1000)) throw new FirebaseAuthError(401, "unauthorized");
    return decoded;
  }
  function recent(authTimeSeconds: number) {
    if (now() / 1000 - authTimeSeconds > FIREBASE_RECENT_AUTH_SECONDS) {
      throw new FirebaseAuthError(401, "recent_reauthentication_required");
    }
  }
  async function currentIdentity(decoded: DecodedIdToken): Promise<UserRecord> {
    const user = await sdk(() => auth.getUser(decoded.uid));
    if (user.disabled || user.uid !== decoded.uid || typeof user.email !== "string" || !user.email
      || user.email !== decoded.email || typeof user.emailVerified !== "boolean") throw new FirebaseAuthError(401, "unauthorized");
    return user;
  }
  function directorySubject(provider: AccountAuthProvider, user: UserRecord): string | null {
    const entry = user.providerData?.find(item => item.providerId === provider);
    if (!entry?.uid) return null;
    return provider === 'password' ? 'password' : createHash('sha256').update(entry.uid).digest('hex');
  }
  function providerIdentity(decoded: DecodedIdToken, user: UserRecord, provider: AccountAuthProvider): ProviderIdentity {
    if (provider === 'password') return { provider, subject: 'password' };
    const identities = decoded.firebase?.identities?.[provider];
    const subject = directorySubject(provider, user);
    if (!subject || !Array.isArray(identities) || identities.length !== 1 || typeof identities[0] !== 'string'
      || createHash('sha256').update(identities[0]).digest('hex') !== subject) throw new FirebaseAuthError(401, 'unauthorized');
    return { provider, subject };
  }
  function signInMethod(decoded: DecodedIdToken, user: UserRecord) {
    const method = accountAuthProviderSchema.safeParse(decoded.firebase?.sign_in_provider);
    if (!method.success) throw new FirebaseAuthError(401, 'unauthorized');
    return providerIdentity(decoded, user, method.data);
  }
  function extractCookie(headers: Headers) {
    const matches = (headers.get("cookie") ?? "").split(";").map(part => part.trim()).filter(part => part.startsWith(cookieName + "="));
    if (!matches.length) return null;
    if (matches.length !== 1) throw new FirebaseAuthError(401, "unauthorized");
    const cookie = matches[0].slice(cookieName.length + 1);
    if (!cookie || cookie.length > MAX_BODY_BYTES || !/^[A-Za-z0-9._~-]+$/.test(cookie)) throw new FirebaseAuthError(401, "unauthorized");
    return cookie;
  }
  async function readSession(headers: Headers): Promise<AuthenticatedSession | null> {
    try {
      const native = headers.has("authorization");
      const cookie = native ? nativeSessionCredential(headers) : extractCookie(headers);
      if (cookie === null) return null;
      const decoded = validatedClaims(await sdk(() => auth.verifySessionCookie(cookie, true)));
      const user = await currentIdentity(decoded), sessionHash = hashCookie(cookie, native);
      await sessions.assertActive({ userId: user.uid, sessionHash });
      const method = signInMethod(decoded, user);
      const grants = await admission(() => lifecycle.assertSessionAdmission(user.uid, { email: user.email!, emailVerified: user.emailVerified }, method));
      const providers = accountAuthProviderSchema.options.filter(provider => grants[provider] !== undefined && grants[provider] === directorySubject(provider, user));
      return { session: { user: { id: user.uid, name: typeof user.displayName === "string" ? user.displayName : "", email: user.email! } },
        sessionHash, authTimeSeconds: decoded.auth_time, method, verifiedEmailAtIssue: decoded.email_verified === true,
        methods: { userId: user.uid, providers, currentProvider: providers.includes(method.provider) ? method.provider : null } };
    } catch (error) {
      if (error instanceof FirebaseAuthError && error.status === 401 || error instanceof DeviceSessionError && error.status === 401) return null;
      throw error;
    }
  }
  function sameOrigin(headers: Headers) {
    if (!requestOriginAllowed(headers, publicOrigin)) throw new FirebaseAuthError(403, "origin_rejected");
  }
  function expectedIdentity(headers: Headers, userId: string) {
    if (headers.get("x-expected-user-id") !== userId) throw new FirebaseAuthError(409, "identity_changed");
  }
  async function body(request: Request): Promise<Record<string, unknown>> {
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get("content-type") ?? "")) {
      throw new FirebaseAuthError(415, "json_required");
    }
    const length = request.headers.get("content-length");
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) throw new FirebaseAuthError(413, "auth_body_too_large");
    const reader = request.body?.getReader();
    if (!reader) throw new FirebaseAuthError(400, "auth_body_invalid");
    const chunks: Uint8Array[] = []; let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_BODY_BYTES) { await reader.cancel(); throw new FirebaseAuthError(413, "auth_body_too_large"); }
        chunks.push(value);
      }
      const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
      if (!record(value)) throw new FirebaseAuthError(400, "auth_body_invalid");
      return value;
    } catch (error) {
      if (error instanceof FirebaseAuthError) throw error;
      throw new FirebaseAuthError(400, "auth_body_invalid");
    } finally { reader.releaseLock(); }
  }
  async function handler(request: Request): Promise<Response> {
    try {
      const path = new URL(request.url).pathname;
      if (request.method === "GET" && path === "/api/auth/get-session") return json((await readSession(request.headers))?.session ?? null);
      if (request.method === 'GET' && path === '/api/auth/providers') {
        const current = await readSession(request.headers);
        if (!current) throw new FirebaseAuthError(401, 'unauthorized');
        expectedIdentity(request.headers, current.session.user.id);
        return json(current.methods);
      }
      const nativeExchange = path === "/api/auth/native-session";
      if (request.method !== "GET") {
        if (nativeExchange) {
          if (!nativeRequestContext(request.headers) || request.headers.has("authorization") && !nativeSessionCredential(request.headers)) {
            throw new FirebaseAuthError(403, "origin_rejected");
          }
        } else sameOrigin(request.headers);
      }
      if (request.method !== "POST") return json({ code: "auth_provider_transition_required" }, 503);
      const input = await body(request);
      if (path === "/api/auth/session" || nativeExchange) {
        if (!nativeExchange && request.headers.has("authorization")) throw new FirebaseAuthError(403, "origin_rejected");
        const target = input.linkProvider === undefined ? undefined : socialAuthProviderSchema.safeParse(input.linkProvider);
        if (target && !target.success || Object.keys(input).some(key => key !== 'idToken' && key !== 'linkProvider')
          || typeof input.idToken !== "string" || !input.idToken || input.idToken.length > MAX_BODY_BYTES) {
          throw new FirebaseAuthError(400, "auth_body_invalid");
        }
        const existing = await readSession(request.headers);
        if (existing) expectedIdentity(request.headers, existing.session.user.id);
        const decoded = validatedClaims(await sdk(() => auth.verifyIdToken(input.idToken as string, true)));
        recent(decoded.auth_time);
        const user = await currentIdentity(decoded);
        if (existing && existing.session.user.id !== user.uid) throw new FirebaseAuthError(409, "sign_out_required");
        const expected = request.headers.get("x-expected-user-id");
        if (!existing && expected !== null && expected !== user.uid) throw new FirebaseAuthError(409, "identity_changed");
        const method = signInMethod(decoded, user);
        const providerEmail = user.providerData?.find(entry => entry.providerId === method.provider)?.email;
        const proof: ProviderAdmission = { method, verifiedInvitationAddress: decoded.email_verified === true
          && typeof providerEmail === 'string' && providerEmail.toLowerCase() === user.email!.toLowerCase() };
        if (target?.success) {
          if (!existing) throw new FirebaseAuthError(401, 'recent_reauthentication_required');
          recent(existing.authTimeSeconds);
          if (!existing.verifiedEmailAtIssue || !user.emailVerified || decoded.email_verified !== true) throw new FirebaseAuthError(403, 'email_not_verified');
          if (method.provider !== target.data) throw new FirebaseAuthError(403, 'auth_provider_proof_required');
          proof.link = { original: existing.method, target: { provider: target.data, subject: method.subject },
            assertOriginalSession: async tx => {
              recent(existing.authTimeSeconds);
              await sessions.assertActiveIn(tx, { userId: user.uid, sessionHash: existing.sessionHash });
            } };
        }
        await admission(() => lifecycle.admitIdentity({ userId: user.uid, email: user.email!, emailVerified: user.emailVerified }, proof));
        await admission(() => lifecycle.assertSessionAdmission(user.uid, { email: user.email!, emailVerified: user.emailVerified }, method));
        const cookie = await sdk(() => auth.createSessionCookie(input.idToken as string, { expiresIn: FIREBASE_SESSION_LIFETIME_MS }));
        if (!cookie || cookie.length > MAX_BODY_BYTES || !/^[A-Za-z0-9._~-]+$/.test(cookie)) {
          throw new FirebaseAuthError(503, "authentication_unavailable");
        }
        const issuedClaims = validatedClaims(await sdk(() => auth.verifySessionCookie(cookie, true)));
        if (issuedClaims.uid !== user.uid || issuedClaims.email !== user.email || issuedClaims.auth_time !== decoded.auth_time
          || issuedClaims.firebase?.sign_in_provider !== method.provider
          || !Number.isSafeInteger(issuedClaims.exp) || !Number.isSafeInteger(issuedClaims.iat)
          || issuedClaims.exp * 1000 <= now() || issuedClaims.iat * 1000 > now() + 5_000
          // Bound duration using the issuer clock; sub-second host skew must not reject a valid five-day cookie.
          || issuedClaims.exp <= issuedClaims.iat || (issuedClaims.exp - issuedClaims.iat) * 1000 > FIREBASE_SESSION_LIFETIME_MS) {
          throw new FirebaseAuthError(503, "authentication_unavailable");
        }
        await sessions.issue({ userId: user.uid, sessionHash: hashCookie(cookie, nativeExchange), expiresAtMs: issuedClaims.exp * 1000,
          authTimeSeconds: decoded.auth_time, ...(existing ? { existingSessionHash: existing.sessionHash } : {}) });
        const result = { user: { id: user.uid, name: typeof user.displayName === "string" ? user.displayName : "", email: user.email } };
        if (nativeExchange) return json({ ...result, credential: NATIVE_SESSION_PREFIX + cookie, expiresAtMs: issuedClaims.exp * 1000 });
        return json(result, 200, cookieHeader(cookie, FIREBASE_SESSION_LIFETIME_MS / 1000));
      }
      if (path === "/api/auth/sign-out" || path === "/api/auth/revoke-other-sessions") {
        if (Object.keys(input).length) throw new FirebaseAuthError(400, "auth_body_invalid");
        const current = await readSession(request.headers);
        if (!current) {
          if (path === "/api/auth/sign-out") return json({ success: true }, 200, request.headers.has("authorization") ? undefined : cookieHeader("", 0));
          throw new FirebaseAuthError(401, "unauthorized");
        }
        expectedIdentity(request.headers, current.session.user.id);
        const key = { userId: current.session.user.id, sessionHash: current.sessionHash };
        if (path === "/api/auth/sign-out") {
          await sessions.revokeThis(key);
          return json({ success: true }, 200, request.headers.has("authorization") ? undefined : cookieHeader("", 0));
        }
        await sessions.revokeOthers(key);
        return json({ success: true });
      }
      return json({ code: "auth_provider_transition_required" }, 503);
    } catch (error) {
      if (error instanceof FirebaseAuthError || error instanceof DeviceSessionError) return json({ code: error.code }, error.status);
      return json({ code: "authentication_unavailable" }, 503);
    }
  }
  function getSession(options: { headers: Headers; returnHeaders?: false }): Promise<ServerAuthSession | null>;
  function getSession(options: { headers: Headers; returnHeaders: true }): Promise<ServerAuthSessionWithHeaders>;
  async function getSession(options: { headers: Headers; returnHeaders?: boolean }): Promise<ServerAuthSession | null | ServerAuthSessionWithHeaders> {
    const session = (await readSession(options.headers))?.session ?? null;
    return options.returnHeaders ? { response: session, headers: privateHeaders() } : session;
  }
  function fromNodeHeaders(headers: IncomingHttpHeaders) {
    const result = new Headers();
    for (const [key, value] of Object.entries(headers)) {
      if (Array.isArray(value)) {
        if (key.toLowerCase() === "cookie") result.set(key, value.join("; "));
        else for (const item of value) result.append(key, item);
      } else if (value !== undefined) result.set(key, value);
    }
    return result;
  }
  return { handler, getSession, fromNodeHeaders,
    async nativeSessionProof(headers) {
      if (!headers.has("authorization")) return null;
      const current = await readSession(headers);
      return current ? { userId: current.session.user.id, sessionHash: current.sessionHash } : null;
    },
    async assertRecentReauthentication(headers) {
      sameOrigin(headers);
      const current = await readSession(headers);
      if (!current) throw new FirebaseAuthError(401, "unauthorized");
      expectedIdentity(headers, current.session.user.id);
      recent(current.authTimeSeconds);
      return current.session;
    },
  };
}
