import type { NativeSessionExchange } from "./native-session-transport.ts";
import { initializeApp } from "firebase/app";
import { confirmPasswordReset, createUserWithEmailAndPassword, getIdToken, inMemoryPersistence, initializeAuth,
  reload, sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword, signOut, updateProfile, type User } from "firebase/auth";
import { ClientApiError, createRecordsApi, type RecordsIdentityAdapter, type SessionUser } from "./records-api.ts";
import type { AccountIdentityAdapter } from "./account-auth-api.ts";

export interface FirebasePublicConfig { apiKey: string; authDomain: string; projectId: string; appId: string }
export interface FirebaseIdentityUser { readonly uid: string; readonly email: string | null; readonly emailVerified: boolean }
/** The SDK port exists for bounded offline verification; it never represents the business session. */
export interface FirebaseIdentitySdk {
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
  reauthenticate(userId: string, password: string, signal: AbortSignal): Promise<void>;
}
interface Options { baseUrl: string; publicOrigin: string; config: FirebasePublicConfig; fetcher?: typeof fetch; sdk?: FirebaseIdentitySdk; nativeSession?: NativeSessionExchange }
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
  return { apiUrl: origin.origin + "/api", continueUrl: origin.origin + "/?account=verified" };
}

function nativeSdk(config: FirebasePublicConfig): FirebaseIdentitySdk {
  const app = initializeApp(config, "yuban-browser-auth-" + ++appSequence);
  const auth = initializeAuth(app, { persistence: inMemoryPersistence });
  return {
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
  const fetcher = options.fetcher ?? fetch, sdk = options.sdk ?? nativeSdk(options.config);
  const server = createRecordsApi(urls.apiUrl, fetcher);
  let generation = 0, retainedUser: FirebaseIdentityUser | null = null;
  let queue: Promise<void> = Promise.resolve();
  const guard = (ticket: Ticket) => { if (ticket.signal.aborted || ticket.generation !== generation) throw new ClientApiError(); };
  const clear = async () => { retainedUser = null; await sdk.clear(); };

  function run(signal: AbortSignal, action: (ticket: Ticket) => Promise<void>, replaceIdentity = false): Promise<void> {
    if (signal.aborted) {
      if (replaceIdentity) diagnoseAuthentication("provider_clear", "caller_abort", null);
      return Promise.reject(new ClientApiError());
    }
    const controller = new AbortController(), timed = setTimeout(() => controller.abort(), 20_000);
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
        throw new ClientApiError(value.status, value.code === "invitation_required" || value.code === "EMAIL_NOT_VERIFIED" ? value.code : null);
      }
      return;
    }
    const response = await fetcher(urls.apiUrl + "/auth/session", { method: "POST", credentials: "include", cache: "no-store",
      signal: ticket.signal, headers: { "content-type": "application/json", "x-expected-user-id": expectedUserId }, body: JSON.stringify({ idToken }) });
    guard(ticket);
    if (!response.ok) {
      let code: string | null = null;
      try { const value = await response.json();
        if (value?.code === "invitation_required" || value?.code === "EMAIL_NOT_VERIFIED") code = value.code;
      } catch { /* Do not expose response bodies. */ }
      throw new ClientApiError(response.status, code);
    }
    await response.body?.cancel();
  }
  const api: FirebaseClientAuthApi = {
    reauthenticate: (userId, password, signal) => run(signal, async ticket => {
      try {
        const original = await server.getSession(ticket.signal); guard(ticket);
        if (!original || original.id !== userId || !password || password.length > 128) throw reauthenticationRequired();
        await clear(); guard(ticket);
        const user = await sdk.signIn(original.email, password); guard(ticket);
        if (user.uid !== userId || sdk.currentUser() !== user || !user.email || emailKey(user.email) !== emailKey(original.email)) throw reauthenticationRequired();
        const proof = await sdk.idToken(user); guard(ticket);
        await exchange(proof, userId, ticket);
      } finally { await clear(); }
    }, true),
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
      if (retainedUser && (!user || retainedUser.uid !== user.id || !retainedUser.email
        || emailKey(retainedUser.email) !== emailKey(user.email) || retainedUser.emailVerified)) {
        void api.clearSession().catch(() => {});
      }
    },
    clearSession: () => {
      generation++; retainedUser = null;
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
  return { assertAvailable: () => { throw unavailable(); }, authenticate: reject, reauthenticate: reject, requestVerification: reject,
    requestPasswordReset: reject, resetPassword: reject, observeSession: () => {}, clearSession: async () => {} };
}
