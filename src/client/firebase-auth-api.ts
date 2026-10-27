import type { NativeSessionExchange } from "./native-session-transport.ts";
import { initializeApp } from "firebase/app";
import { connectAuthEmulator, confirmPasswordReset, createUserWithEmailAndPassword, getIdToken, inMemoryPersistence, initializeAuth,
  reload, sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword, signOut, updateProfile, type User, type Auth } from "firebase/auth";
import { ClientApiError, createRecordsApi, type RecordsIdentityAdapter, type SessionUser } from "./records-api.ts";
import type { AccountIdentityAdapter } from "./account-auth-api.ts";
import { accountAuthMethodsSchema, socialAuthProviderSchema, type AccountAuthMethods, type ReauthenticationInput, type SocialAuthProvider } from "../shared/auth-providers.ts";

export interface FirebasePublicConfig { apiKey: string; authDomain: string; projectId: string; appId: string; authEmulatorUrl?: string }
export interface FirebaseIdentityUser { readonly uid: string; readonly email: string | null; readonly emailVerified: boolean }
export interface FirebaseSocialIdentitySdk {
  readonly providers: readonly SocialAuthProvider[];
  signIn(provider: SocialAuthProvider): Promise<FirebaseIdentityUser>;
  link(user: FirebaseIdentityUser, provider: SocialAuthProvider): Promise<FirebaseIdentityUser>;
}
export type FirebaseSocialIdentityFactory = (auth: Auth) => FirebaseSocialIdentitySdk;
/** The SDK port exists for bounded offline verification; it never represents the business session. */
export interface FirebaseIdentitySdk {
  readonly social?: FirebaseSocialIdentitySdk;
  currentUser(): FirebaseIdentityUser | null;
  signIn(email: string, password: string): Promise<FirebaseIdentityUser>;
  signUp(email: string, password: string): Promise<FirebaseIdentityUser>;
  updateName(user: FirebaseIdentityUser, name: string): Promise<void>;
  reload(user: FirebaseIdentityUser): Promise<void>;
  idToken(user: FirebaseIdentityUser): Promise<string>;
  sendVerification(user: FirebaseIdentityUser, continueUrl: string): Promise<void>;
  requestReset(email: string, continueUrl: string): Promise<void>;
  confirmReset(token: string, password: string): Promise<void>;
  clear(): Promise<void>;
}
export interface FirebaseClientAuthApi extends RecordsIdentityAdapter, AccountIdentityAdapter {
  readonly socialProviders: readonly SocialAuthProvider[];
  authenticationMethods(userId: string, signal: AbortSignal): Promise<AccountAuthMethods>;
  authenticateProvider(provider: SocialAuthProvider, signal: AbortSignal): Promise<void>;
  reauthenticate(userId: string, proof: ReauthenticationInput, signal: AbortSignal): Promise<void>;
  prepareProviderLink(userId: string, proof: ReauthenticationInput, signal: AbortSignal): Promise<void>;
  linkProvider(userId: string, provider: SocialAuthProvider, consent: boolean, signal: AbortSignal): Promise<void>;
  cancelProviderLink(): Promise<void>;
}
interface Options { baseUrl: string; publicOrigin: string; config: FirebasePublicConfig; fetcher?: typeof fetch; sdk?: FirebaseIdentitySdk; socialFactory?: FirebaseSocialIdentityFactory; nativeSession?: NativeSessionExchange }
type AuthenticationStage = "provider_clear" | "session_read" | "sign_in" | "sign_up" | "update_name" | "identity_check" | "token" | "exchange";
interface Ticket { generation: number; signal: AbortSignal; authenticationStage?: AuthenticationStage }
const diagnosticProviderCodes = new Set(["auth/network-request-failed", "auth/timeout", "auth/internal-error", "auth/user-token-expired",
  "auth/invalid-user-token", "auth/user-disabled", "auth/too-many-requests", "auth/requires-recent-login", "auth/invalid-credential",
  "auth/invalid-email", "auth/wrong-password", "auth/user-not-found", "auth/email-already-in-use", "auth/weak-password",
  "auth/operation-not-allowed", "auth/invalid-api-key", "auth/app-not-authorized", "auth/tenant-id-mismatch"]);
let appSequence = 0;
const emailKey = (email: string) => email.trim().toLowerCase();
const unavailable = () => new ClientApiError(503, "auth_provider_unavailable");
const reauthenticationRequired = () => new ClientApiError(409, "firebase_reauthentication_required");

function validate(options: Options): { apiUrl: string; continueUrl: string } {
  const origin = new URL(options.publicOrigin);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if (origin.origin !== options.publicOrigin || origin.username || origin.password
    || origin.protocol !== "https:" && !(origin.protocol === "http:" && local)) throw unavailable();
  const base = new URL(options.baseUrl, origin);
  if (base.origin !== origin.origin || base.username || base.password || base.search || base.hash
    || !["/", "/api", "/api/"].includes(base.pathname)) throw unavailable();
  const config = options.config;
  if (!config || !/^[A-Za-z0-9_-]{20,200}$/u.test(config.apiKey)
    || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u.test(config.projectId)
    || !/^1:[0-9]+:web:[a-f0-9]+$/iu.test(config.appId)
    || config.authDomain !== config.projectId + ".firebaseapp.com" && config.authDomain !== origin.hostname) throw unavailable();
  if (config.authEmulatorUrl !== undefined) {
    const emulator = new URL(config.authEmulatorUrl);
    if (!local || origin.protocol !== 'http:' || !config.projectId.startsWith('demo-')
      || emulator.protocol !== 'http:' || emulator.hostname !== '127.0.0.1' || !emulator.port
      || emulator.origin !== config.authEmulatorUrl || emulator.username || emulator.password) throw unavailable();
  } else if (config.projectId.startsWith('demo-')) throw unavailable();
  return { apiUrl: origin.origin + "/api", continueUrl: origin.origin + "/?account=verified" };
}

function nativeSdk(config: FirebasePublicConfig, socialFactory?: FirebaseSocialIdentityFactory): FirebaseIdentitySdk {
  const app = initializeApp(config, "yuban-browser-auth-" + ++appSequence);
  const auth = initializeAuth(app, { persistence: inMemoryPersistence });
  if (config.authEmulatorUrl) connectAuthEmulator(auth, config.authEmulatorUrl);
  return {
    ...(socialFactory ? { social: socialFactory(auth) } : {}),
    currentUser: () => auth.currentUser,
    signIn: async (email, password) => (await signInWithEmailAndPassword(auth, email, password)).user,
    signUp: async (email, password) => (await createUserWithEmailAndPassword(auth, email, password)).user,
    updateName: (user, name) => updateProfile(user as User, { displayName: name }),
    reload: user => reload(user as User),
    idToken: user => getIdToken(user as User, true),
    sendVerification: (user, url) => sendEmailVerification(user as User, { url, handleCodeInApp: false }),
    requestReset: (email, url) => sendPasswordResetEmail(auth, email, { url, handleCodeInApp: false }),
    confirmReset: (token, password) => confirmPasswordReset(auth, token, password),
    clear: () => signOut(auth),
  };
}

function sanitized(error: unknown): ClientApiError {
  if (error instanceof ClientApiError) return error;
  // SDK messages may contain credentials or provider response details. Only approved codes leave this port.
  const code = error !== null && typeof error === "object" && "code" in error ? error.code : null;
  const providerErrors: Record<string, [number, string]> = {
    'auth/popup-closed-by-user': [400, 'authentication_cancelled'],
    'auth/cancelled-popup-request': [400, 'authentication_cancelled'],
    'auth/popup-blocked': [400, 'auth_popup_blocked'],
    'auth/account-exists-with-different-credential': [409, 'auth_account_link_required'],
    'auth/credential-already-in-use': [409, 'auth_credential_in_use'],
    'auth/provider-already-linked': [409, 'auth_provider_already_linked'],
    'auth/operation-not-allowed': [503, 'auth_provider_disabled'],
    'auth/unauthorized-domain': [503, 'auth_domain_not_allowed'],
  };
  if (typeof code === 'string' && Object.hasOwn(providerErrors, code)) return new ClientApiError(...providerErrors[code]!);
  if (code === "auth/too-many-requests") return new ClientApiError(429);
  if (["auth/invalid-credential", "auth/invalid-email", "auth/wrong-password", "auth/user-not-found",
    "auth/email-already-in-use", "auth/weak-password", "auth/operation-not-allowed"].includes(code as string)) return new ClientApiError(400);
  if (code === "auth/requires-recent-login") return reauthenticationRequired();
  return new ClientApiError();
}
function diagnoseAuthentication(stage: AuthenticationStage, cause: "timeout" | "caller_abort" | "replaced" | "provider", error: unknown) {
  const code = error !== null && typeof error === "object" && "code" in error ? error.code : null;
  const providerCode = typeof code === "string" && diagnosticProviderCodes.has(code) ? code : null;
  // Only fixed phase names and approved SDK codes leave this diagnostic; never log the error object or inputs.
  try { console.warn("firebase_authenticate_unconfirmed " + JSON.stringify({ stage, cause, providerCode })); } catch { /* Diagnostics must not change authentication. */ }
}

/** Both platforms exchange provider proof with the same Server authority. */
export function createFirebaseAuthApi(options: Options): FirebaseClientAuthApi {
  let urls: ReturnType<typeof validate>;
  try { urls = validate(options); } catch { throw unavailable(); }
  const fetcher = options.fetcher ?? fetch, sdk = options.sdk ?? nativeSdk(options.config, options.socialFactory);
  const server = createRecordsApi(urls.apiUrl, fetcher);
  let generation = 0, retainedUser: FirebaseIdentityUser | null = null;
  let linkPreparation: { user: FirebaseIdentityUser; generation: number; expiresAt: number } | null = null;
  let linkExpiry: ReturnType<typeof setTimeout> | undefined;
  let queue: Promise<void> = Promise.resolve();
  const guard = (ticket: Ticket) => { if (ticket.signal.aborted || ticket.generation !== generation) throw new ClientApiError(); };
  const clearLink = () => { linkPreparation = null; if (linkExpiry !== undefined) clearTimeout(linkExpiry); linkExpiry = undefined; };
  const clear = async () => { retainedUser = null; clearLink(); await sdk.clear(); };

  function run(signal: AbortSignal, action: (ticket: Ticket) => Promise<void>, replaceIdentity = false, deadlineMs = 20_000): Promise<void> {
    if (signal.aborted) {
      if (replaceIdentity) diagnoseAuthentication("provider_clear", "caller_abort", null);
      return Promise.reject(new ClientApiError());
    }
    const controller = new AbortController(), timed = setTimeout(() => controller.abort(), deadlineMs);
    const combined = AbortSignal.any([signal, controller.signal]);
    const ticket: Ticket = { generation: replaceIdentity ? ++generation : generation, signal: combined };
    if (replaceIdentity) ticket.authenticationStage = "provider_clear";
    let rejectAbort!: () => void;
    const aborted = new Promise<never>((_, reject) => { rejectAbort = () => reject(new ClientApiError()); });
    combined.addEventListener("abort", rejectAbort, { once: true });
    const task = queue.then(async () => { guard(ticket); await action(ticket); guard(ticket); });
    // An uncancellable SDK completion stays serialized until its own provider state has been cleared.
    queue = task.then(() => {}, () => {});
    return Promise.race([task, aborted]).catch(error => {
      if (ticket.authenticationStage) {
        const cause = controller.signal.aborted ? "timeout" : signal.aborted ? "caller_abort"
          : ticket.generation !== generation || ticket.authenticationStage === "identity_check" && error instanceof ClientApiError
            && error.onlineCode === "firebase_reauthentication_required" ? "replaced" : "provider";
        diagnoseAuthentication(ticket.authenticationStage, cause, error);
      }
      throw sanitized(error);
    }).finally(() => {
      clearTimeout(timed); combined.removeEventListener("abort", rejectAbort);
    });
  }
  async function exchange(idToken: string, expectedUserId: string, ticket: Ticket) {
    guard(ticket);
    if (options.nativeSession) {
      try { await options.nativeSession.exchange(idToken, expectedUserId, ticket.signal); guard(ticket); }
      catch (error) {
        const value = error as { status?: number; code?: string | null };
        throw new ClientApiError(value.status, exchangeCode(value.code));
      }
      return;
    }
    const response = await fetcher(urls.apiUrl + "/auth/session", { method: "POST", credentials: "include", cache: "no-store",
      signal: ticket.signal, headers: { "content-type": "application/json", "x-expected-user-id": expectedUserId }, body: JSON.stringify({ idToken }) });
    guard(ticket);
    if (!response.ok) {
      let code: string | null = null;
      try { const value = await response.json();
        code = exchangeCode(value?.code);
      } catch { /* Do not expose response bodies. */ }
      throw new ClientApiError(response.status, code);
    }
    await response.body?.cancel();
  }
  function exchangeCode(value: unknown): string | null {
    return typeof value === 'string' && ['invitation_required', 'invitation_unavailable', 'EMAIL_NOT_VERIFIED',
      'identity_changed', 'identity_email_changed', 'sign_out_required', 'recent_reauthentication_required'].includes(value) ? value : null;
  }
  const socialProviders = Object.freeze(socialAuthProviderSchema.options.filter(provider => sdk.social?.providers.includes(provider)));
  function social(provider: SocialAuthProvider) {
    if (!socialAuthProviderSchema.safeParse(provider).success || !socialProviders.includes(provider) || !sdk.social) {
      throw new ClientApiError(503, 'auth_provider_unavailable');
    }
    return sdk.social;
  }
  function checkedUser(user: FirebaseIdentityUser, ticket: Ticket, expected?: SessionUser | null) {
    guard(ticket);
    if (sdk.currentUser() !== user || !user.uid || !user.email || expected && (user.uid !== expected.id
      || emailKey(user.email) !== emailKey(expected.email))) throw reauthenticationRequired();
    return user;
  }
  async function methods(userId: string, signal: AbortSignal): Promise<AccountAuthMethods> {
    const epoch = generation;
    const response = await fetcher(urls.apiUrl + '/auth/providers', { credentials: 'include', cache: 'no-store', signal,
      headers: { 'x-expected-user-id': userId } });
    if (signal.aborted || epoch !== generation) throw reauthenticationRequired();
    if (!response.ok) { await response.body?.cancel(); throw new ClientApiError(response.status); }
    const parsed = accountAuthMethodsSchema.safeParse(await response.json());
    if (signal.aborted || epoch !== generation || !parsed.success || parsed.data.userId !== userId) throw reauthenticationRequired();
    return parsed.data;
  }
  async function originalIdentity(userId: string, proof: ReauthenticationInput, ticket: Ticket) {
    if (!userId) throw reauthenticationRequired();
    await clear(); guard(ticket);
    const originalRead = server.getSession(ticket.signal);
    // A popup must begin before waiting for network preflight; Server exchange still enforces the original UID.
    let user: FirebaseIdentityUser;
    if (typeof proof === 'string') {
      const original = await originalRead; guard(ticket);
      if (!original || original.id !== userId || !proof || proof.length > 128) throw reauthenticationRequired();
      user = await sdk.signIn(original.email, proof);
      return checkedUser(user, ticket, original);
    }
    const provider = socialAuthProviderSchema.safeParse(proof?.provider);
    if (!provider.success) { await originalRead; throw reauthenticationRequired(); }
    const enrolledRead = methods(userId, ticket.signal);
    void originalRead.catch(() => {}); void enrolledRead.catch(() => {});
    user = await social(provider.data).signIn(provider.data); guard(ticket);
    const [original, enrolled] = await Promise.all([originalRead, enrolledRead]); guard(ticket);
    if (!original || original.id !== userId || !enrolled.providers.includes(provider.data)) throw reauthenticationRequired();
    return checkedUser(user, ticket, original);
  }
  const api: FirebaseClientAuthApi = {
    socialProviders,
    authenticationMethods: async (userId, signal) => {
      let result!: AccountAuthMethods;
      // A cancelled popup can still link at the provider. Reconcile only after its SDK cleanup settles.
      await run(signal, async ticket => { result = await methods(userId, ticket.signal); });
      return result;
    },
    authenticateProvider: (provider, signal) => run(signal, async ticket => {
      try {
        await clear(); guard(ticket);
        const originalRead = server.getSession(ticket.signal); void originalRead.catch(() => {});
        const user = checkedUser(await social(provider).signIn(provider), ticket);
        const original = await originalRead; guard(ticket);
        if (original && original.id !== user.uid) throw new ClientApiError(409, 'sign_out_required');
        const proof = await sdk.idToken(user); guard(ticket);
        await exchange(proof, original?.id ?? user.uid, ticket);
      } finally { await clear(); }
    }, true, 90_000),
    reauthenticate: (userId, input, signal) => run(signal, async ticket => {
      try {
        const user = await originalIdentity(userId, input, ticket);
        const proof = await sdk.idToken(user); guard(ticket);
        await exchange(proof, userId, ticket);
      } finally { await clear(); }
    }, true, typeof input === 'string' ? 20_000 : 90_000),
    prepareProviderLink: (userId, input, signal) => run(signal, async ticket => {
      let retain = false;
      try {
        const user = await originalIdentity(userId, input, ticket);
        const proof = await sdk.idToken(user); guard(ticket);
        await exchange(proof, userId, ticket); guard(ticket);
        linkPreparation = { user, generation: ticket.generation, expiresAt: Date.now() + 120_000 };
        linkExpiry = setTimeout(() => { void api.cancelProviderLink().catch(() => {}); }, 120_000);
        retain = true;
      } finally { if (!retain) await clear(); }
    }, true, typeof input === 'string' ? 20_000 : 90_000),
    linkProvider: (userId, provider, consent, signal) => run(signal, async ticket => {
      try {
        if (consent !== true) throw new ClientApiError(400, 'provider_link_consent_required');
        const prepared = linkPreparation;
        if (!prepared || prepared.generation !== ticket.generation || prepared.user.uid !== userId
          || prepared.expiresAt <= Date.now() || sdk.currentUser() !== prepared.user) throw reauthenticationRequired();
        clearLink();
        const linked = checkedUser(await social(provider).link(prepared.user, provider), ticket);
        if (linked.uid !== userId) throw reauthenticationRequired();
        const original = await server.getSession(ticket.signal); guard(ticket);
        if (!original || original.id !== userId) throw reauthenticationRequired();
        const proof = await sdk.idToken(linked); guard(ticket);
        await exchange(proof, userId, ticket);
      } finally { await clear(); }
    }, false, 90_000),
    cancelProviderLink: () => api.clearSession(),
    authenticate: (mode, input, signal) => run(signal, async ticket => {
      let retain = false;
      try {
        await clear(); guard(ticket);
        ticket.authenticationStage = "session_read";
        const original = await server.getSession(ticket.signal); guard(ticket);
        ticket.authenticationStage = mode === "signUp" ? "sign_up" : "sign_in";
        const user = await (mode === "signUp" ? sdk.signUp(input.email, input.password) : sdk.signIn(input.email, input.password));
        guard(ticket);
        if (mode === "signUp") { ticket.authenticationStage = "update_name"; await sdk.updateName(user, input.name); guard(ticket); }
        ticket.authenticationStage = "identity_check";
        if (sdk.currentUser() !== user || !user.uid || !user.email || emailKey(user.email) !== emailKey(input.email)) throw reauthenticationRequired();
        ticket.authenticationStage = "token";
        const idToken = await sdk.idToken(user); guard(ticket);
        ticket.authenticationStage = "exchange";
        await exchange(idToken, original?.id ?? user.uid, ticket); guard(ticket);
        // Retain only this page's unverified provider identity for an explicit resend.
        if (!user.emailVerified) { retainedUser = user; retain = true; }
      } finally { if (!retain) await clear(); }
    }, true),
    observeSession: (user: SessionUser | null) => {
      if (linkPreparation && (!user || linkPreparation.user.uid !== user.id)) void api.cancelProviderLink().catch(() => {});
      if (retainedUser && (!user || retainedUser.uid !== user.id || !retainedUser.email
        || emailKey(retainedUser.email) !== emailKey(user.email) || retainedUser.emailVerified)) {
        void api.clearSession().catch(() => {});
      }
    },
    clearSession: () => {
      generation++; retainedUser = null; clearLink();
      const task = queue.then(clear);
      queue = task.then(() => {}, () => {});
      return task.catch(error => { throw sanitized(error); });
    },
    requestVerification: (email, signal) => run(signal, async ticket => {
      try {
        const session = await server.getSession(ticket.signal); guard(ticket);
        const user = retainedUser;
        if (!session || !user || sdk.currentUser() !== user || session.id !== user.uid || !user.email
          || emailKey(session.email) !== emailKey(user.email) || emailKey(email) !== emailKey(session.email)) throw reauthenticationRequired();
        await sdk.reload(user); guard(ticket);
        if (sdk.currentUser() !== user || !user.email || user.uid !== session.id || emailKey(user.email) !== emailKey(session.email)
          || user.emailVerified) throw reauthenticationRequired();
        const latest = await server.getSession(ticket.signal); guard(ticket);
        if (!latest || latest.id !== session.id || emailKey(latest.email) !== emailKey(session.email)) throw reauthenticationRequired();
        await sdk.sendVerification(user, urls.continueUrl); guard(ticket);
      } catch (error) {
        if (ticket.signal.aborted || ticket.generation !== generation || error instanceof ClientApiError && error.onlineCode === "firebase_reauthentication_required") await clear();
        throw error;
      }
    }),
    requestPasswordReset: (email, signal) => run(signal, async ticket => {
      await sdk.requestReset(email, options.publicOrigin + "/"); guard(ticket);
    }),
    resetPassword: (token, password, signal) => run(signal, async ticket => {
      await sdk.confirmReset(token, password); guard(ticket);
    }),
  };
  return api;
}

/** Invalid or incomplete Firebase selection closes authentication instead of using the old provider. */
export function createUnavailableFirebaseAuthApi(): FirebaseClientAuthApi {
  const reject = async () => { throw unavailable(); };
  return { socialProviders: [], authenticationMethods: reject, authenticateProvider: reject, prepareProviderLink: reject,
    linkProvider: reject, cancelProviderLink: async () => {}, assertAvailable: () => { throw unavailable(); }, authenticate: reject, reauthenticate: reject, requestVerification: reject,
    requestPasswordReset: reject, resetPassword: reject, observeSession: () => {}, clearSession: async () => {} };
}
