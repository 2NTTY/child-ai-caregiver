import { accountAcknowledgementSchema } from "../src/shared/account-service.ts";
import { FirestoreAuthorityError, type FirestoreAuthority } from "./firestore-authority.ts";
import { FirebaseAuthError, type FirebaseAuthPort } from "./firebase-auth.ts";
import { DeviceSessionError } from "./firestore-device-sessions.ts";
import type { FirestoreOnlineStore } from "./firestore-online.ts";
import { FirestoreDomainError } from "./firestore-domain-data.ts";
import { handleOnlineRequest } from "./online-api.ts";
import { handleTaskRequest } from "./task-api.ts";
import { handleFamilyDocumentRequest } from "./family-document-api.ts";
import type { FamilyDocumentStore } from "./family-document-store.ts";
import { handleFirebasePhotoRequest, type FirebasePhotoApiPort } from "./firebase-photo-api.ts";
import { handlePersonalLibraryRequest, type PersonalLibrary } from "./personal-library-api.ts";
import { handleChatRequest } from "./chat-api.ts";
import type { ChatStore } from "./chat.ts";
import type { FirestoreCareStore } from './firestore-care.ts';
import { handleCareRequest } from "./care-api.ts";
import { FamilyError } from "./family-access.ts";
import { handleMemoryRequest } from "./memory-api.ts";
import type { MemoryStore } from "./memory.ts";
import type { createFirestoreProductAgent } from './firestore-product-agent.ts';
import { handleProductAgentRequest } from './product-agent-api.ts';
import { handleAgentActionsRequest } from './agent-actions-api.ts';
import { handleModelSettingsRequest } from './model-settings-api.ts';

const MAX_BODY_BYTES = 16 * 1024;
const authorityErrors = new Map<string, number>([
  ["invalid_input", 400], ["not_found", 404], ["service_disabled", 403], ["binding", 403],
  ["account_inactive", 403], ["account_not_ready", 403], ["email_not_verified", 403],
  ["identity_email_changed", 403], ["invitation_unavailable", 403], ["operation_conflict", 409],
  ["scope_changed", 409], ["transaction_change_conflict", 409], ["document_too_large", 413],
]);
const authenticationErrors = new Map<string, number>([
  ["unauthorized", 401], ["recent_reauthentication_required", 401], ["identity_changed", 409],
  ["invitation_required", 403], ["invitation_unavailable", 403], ["account_inactive", 403],
  ["account_not_ready", 403], ["service_disabled", 403], ["identity_email_changed", 403], ["binding", 403],
]);

export interface FirebaseRequestHandlerOptions {
  authority: Pick<FirestoreAuthority, "accountStatus" | "acknowledge">;
  auth: FirebaseAuthPort;
  publicOrigin: string;
  /** Supplied by deployment composition; this handler never infers mail readiness. */
  mailConfigured: boolean;
  online?: FirestoreOnlineStore;
  documents?: FamilyDocumentStore;
  photos?: FirebasePhotoApiPort;
  library?: Pick<PersonalLibrary, "page">;
  chat?: ChatStore;
  care?: FirestoreCareStore;
  memory?: MemoryStore;
  product?: Awaited<ReturnType<typeof createFirestoreProductAgent>>;
}
export type FirebaseRequestHandler = (request: Request) => Promise<Response>;

function uncached(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const key of [...headers.keys()]) if (key.startsWith("access-control-")) headers.delete(key);
  headers.set("Cache-Control", "private, no-store");
  headers.set("Pragma", "no-cache");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Vary", headers.has("vary") ? headers.get("vary") + ", Cookie" : "Cookie");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
const json = (value: unknown, status = 200) => uncached(Response.json(value, { status }));
function errorResponse(code: string, status: number) {
  const message = code === "unauthorized" ? "請先登入。"
    : code === "identity_changed" ? "帳戶已改變，請重新讀取。"
    : status === 503 ? "此服務暫時未能處理，請稍後重試。"
    : status === 404 ? "找不到此服務。" : "請核對提交內容及帳戶資格。";
  return json({ error: { code, message } }, status);
}
class RequestError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number) { super("Firebase foundation request rejected"); this.code = code; this.status = status; }
}
async function readJson(request: Request): Promise<unknown> {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get("content-type") ?? "")) throw new RequestError("json_required", 415);
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) throw new RequestError("request_body_too_large", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError("invalid_request", 400);
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) { await reader.cancel(); throw new RequestError("request_body_too_large", 413); }
      chunks.push(value);
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError("invalid_request", 400);
  } finally { reader.releaseLock(); }
}

/** Explicitly assembled Firebase routes; unconnected domains remain unavailable. */
export function createFirebaseRequestHandler(options: FirebaseRequestHandlerOptions): FirebaseRequestHandler {
  const { authority, auth, publicOrigin, mailConfigured, online, documents, photos, library } = options;
  let origin: URL;
  try { origin = new URL(publicOrigin); } catch { throw new Error("invalid_firebase_app_configuration"); }
  if (origin.origin !== publicOrigin || !["https:", "http:"].includes(origin.protocol) || origin.username || origin.password
    || typeof mailConfigured !== "boolean" || typeof authority?.accountStatus !== "function" || typeof authority.acknowledge !== "function"
    || typeof auth?.getSession !== "function" || typeof auth.handler !== "function") throw new Error("invalid_firebase_app_configuration");
  async function accountStatus(userId: string | null) {
    return { ...await authority.accountStatus(userId), mailConfigured };
  }
  return async request => {
    try {
      const path = new URL(request.url).pathname;
      if ((path === "/healthz" || path === "/api/health") && request.method === "GET") {
        return json({ status: "ok", storage: "firestore", stage: "foundation" });
      }
      if (path.startsWith("/api/auth/")) return uncached(await auth.handler(request));
      if (path === "/api/account" && request.method === "GET") {
        const session = await auth.getSession({ headers: request.headers });
        return json(await accountStatus(session?.user.id ?? null));
      }
      if (path === "/api/account/acknowledgement" && request.method === "POST") {
        if (request.headers.get("origin") !== publicOrigin) throw new RequestError("origin_rejected", 403);
        const session = await auth.getSession({ headers: request.headers }), userId = session?.user.id;
        if (!userId) throw new RequestError("unauthorized", 401);
        if (request.headers.get("x-expected-user-id") !== userId) throw new RequestError("identity_changed", 409);
        const parsed = accountAcknowledgementSchema.safeParse(await readJson(request));
        if (!parsed.success) throw new RequestError("account_acknowledgement_invalid", 400);
        await authority.acknowledge({ userId, operationId: parsed.data.operationId, policyVersion: parsed.data.policyVersion });
        // Return the existing complete status shape. A failed read is an unknown outcome, never false success.
        return json(await accountStatus(userId));
      }
      if (documents && /^\/api\/children\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/documents(?:\/|$)/iu.test(path)) {
        if (request.method !== "GET" && request.headers.get("origin") !== publicOrigin) throw new RequestError("origin_rejected", 403);
        const session = await auth.getSession({ headers: request.headers }), userId = session?.user.id;
        if (!userId) throw new RequestError("unauthorized", 401);
        const isCurrentUser = async (expectedUserId: string) => (await auth.getSession({ headers: request.headers }))?.user.id === expectedUserId;
        const response = await handleFamilyDocumentRequest(request, userId, documents, isCurrentUser);
        if (!await isCurrentUser(userId)) throw new RequestError("identity_changed", 409);
        return uncached(response);
      }
      if (photos && /^\/api\/children\/[^/]+\/photos(?:\/|$)/u.test(path)) {
        if (request.method !== "GET" && request.headers.get("origin") !== publicOrigin) throw new RequestError("origin_rejected", 403);
        const session = await auth.getSession({ headers: request.headers }), userId = session?.user.id;
        if (!userId) throw new RequestError("unauthorized", 401);
        const isCurrentUser = async (expectedUserId: string) => (await auth.getSession({ headers: request.headers }))?.user.id === expectedUserId;
        return uncached(await handleFirebasePhotoRequest(request, userId, photos, isCurrentUser));
      }
      if (library && /^\/api\/children\/[^/]+\/library$/u.test(path)) {
        if (request.method !== "GET" && request.headers.get("origin") !== publicOrigin) throw new RequestError("origin_rejected", 403);
        const session = await auth.getSession({ headers: request.headers }), userId = session?.user.id;
        if (!userId) throw new RequestError("unauthorized", 401);
        const isCurrentUser = async (expectedUserId: string) => (await auth.getSession({ headers: request.headers }))?.user.id === expectedUserId;
        const response = await handlePersonalLibraryRequest(request, userId, { library, isCurrentUser });
        if (!await isCurrentUser(userId)) throw new RequestError("identity_changed", 409);
        return uncached(response);
      }
      if (online && (path === "/api/children" || path === "/api/notification-preferences" || path.startsWith("/api/online/") || /^\/api\/children\/[^/]+\/tasks(?:\/|$)/u.test(path))) {
        if (request.method !== "GET" && request.headers.get("origin") !== publicOrigin) throw new RequestError("origin_rejected", 403);
        const session = await auth.getSession({ headers: request.headers }), userId = session?.user.id;
        if (!userId) throw new RequestError("unauthorized", 401);
        const expected = request.headers.get("x-expected-user-id");
        if (expected !== null && expected !== userId) throw new RequestError("identity_changed", 409);
        let response: Response;
        if (path.startsWith("/api/online/")) response = await handleOnlineRequest(request, userId, { ...online,
          async submit(expectedUserId, submission) {
            if ((await auth.getSession({ headers: request.headers }))?.user.id !== expectedUserId) throw new RequestError("identity_changed", 409);
            return online.submit(expectedUserId, submission);
          } });
        else if (path === "/api/notification-preferences") {
          if (request.method !== "GET") throw new RequestError("account_precondition_required", 428);
          if (new URL(request.url).search) throw new RequestError("invalid_input", 400);
          if (!online.notificationPreferences) throw new RequestError("firebase_domain_not_ready", 503);
          response = json({ preferences: await online.notificationPreferences(userId) });
        } else if (path === "/api/children") {
          if (request.method !== "GET") throw new RequestError("account_precondition_required", 428);
          const url = new URL(request.url);
          if ([...url.searchParams.keys()].some(key => key !== "cursor") || url.searchParams.getAll("cursor").length > 1) throw new RequestError("invalid_input", 400);
          response = json(await online.children.list(userId, url.searchParams.get("cursor")));
        } else {
          const detail = /^\/api\/children\/([^/]+)\/tasks\/([^/]+)$/u.exec(path);
          if (request.method === "GET" && detail && online.tasks.detail) {
            if (new URL(request.url).search) throw new RequestError("invalid_input", 400);
            const result = await online.tasks.detail(userId, detail[1].toLowerCase(), detail[2].toLowerCase());
            response = result ? json(result) : errorResponse("not_found", 404);
          } else response = await handleTaskRequest(request, userId, online.tasks);
        }
        if ((await auth.getSession({ headers: request.headers }))?.user.id !== userId) throw new RequestError("identity_changed", 409);
        return uncached(response);
      }
      if (options.product && (path.startsWith('/api/ai/') || /^\/api\/children\/[^/]+\/(?:agent(?:\/|$)|messages\/[^/]+\/reply(?:\/|$))/u.test(path))) {
        if (request.method !== 'GET' && request.headers.get('origin') !== publicOrigin) throw new RequestError('origin_rejected', 403);
        const userId = (await auth.getSession({ headers: request.headers }))?.user.id;
        if (!userId) throw new RequestError('unauthorized', 401);
        const expectedUserId = request.headers.get('x-expected-user-id');
        const sessionRead = request.method === 'GET' && (path === '/api/ai/status' || path === '/api/ai/usage');
        if (expectedUserId !== userId && !(sessionRead && expectedUserId === null)) throw new RequestError('identity_changed', 409);
        const isCurrentUser = async (id: string) => (await auth.getSession({ headers: request.headers }))?.user.id === id;
        let checkedRequest = request;
        if (request.method === 'POST') checkedRequest = new Request(request.url, { method: 'POST', headers: request.headers,
          body: JSON.stringify(await readJson(request)), signal: request.signal });
        let response: Response;
        if (path === '/api/ai/status' && request.method === 'GET') response = json({ available: await options.product.routing.available(userId) });
        else if (path === '/api/ai/usage' && request.method === 'GET') response = json(await options.product.routing.currentUsage(userId));
        else if (path.startsWith('/api/ai/settings')) response = await handleModelSettingsRequest(checkedRequest, userId, options.product.routing);
        else if (/\/agent\/(?:policy|notes|actions)(?:\/|$)/u.test(path))
          response = await handleAgentActionsRequest(checkedRequest, userId, options.product.actions, isCurrentUser);
        else {
          if (!options.chat) throw new RequestError('firebase_domain_not_ready', 503);
          response = await handleProductAgentRequest(checkedRequest, userId, { ...options.product, chat: options.chat, isCurrentUser });
        }
        if (!await isCurrentUser(userId)) throw new RequestError('identity_changed', 409);
        return uncached(response);
      }
      if (options.memory && /^\/api\/children\/[^/]+\/memory\//u.test(path)) {
        if (request.method !== "GET") throw new RequestError("account_precondition_required", 428);
        const userId = (await auth.getSession({ headers: request.headers }))?.user.id;
        if (!userId) throw new RequestError("unauthorized", 401);
        const response = await handleMemoryRequest(request, userId, options.memory);
        if ((await auth.getSession({ headers: request.headers }))?.user.id !== userId) throw new RequestError("identity_changed", 409);
        return uncached(response);
      }
      if (options.care && /^\/api\/children\/[^/]+\/(?:records|profile|care)(?:\/|$)/u.test(path)) {
        const readOnly = request.method === "GET" || request.method === "POST" && path.endsWith("/care/search");
        if (!readOnly) throw new RequestError("account_precondition_required", 428);
        if (request.method === "POST" && request.headers.get("origin") !== publicOrigin) throw new RequestError("origin_rejected", 403);
        const userId = (await auth.getSession({ headers: request.headers }))?.user.id;
        if (!userId) throw new RequestError("unauthorized", 401);
        const records = /^\/api\/children\/([0-9a-f-]{36})\/records$/iu.exec(path);
        const response = records ? json(await options.care.listRecords(userId, records[1].toLowerCase()))
          : await handleCareRequest(request, userId, options.care);
        if ((await auth.getSession({ headers: request.headers }))?.user.id !== userId) throw new RequestError("identity_changed", 409);
        return uncached(response);
      }
      if (options.chat && /^\/api\/children\/[^/]+\/messages$/u.test(path)) {
        if (request.method !== "GET") throw new RequestError("account_precondition_required", 428);
        const userId = (await auth.getSession({ headers: request.headers }))?.user.id;
        if (!userId) throw new RequestError("unauthorized", 401);
        const response = await handleChatRequest(request, userId, options.chat);
        if ((await auth.getSession({ headers: request.headers }))?.user.id !== userId) throw new RequestError("identity_changed", 409);
        return uncached(response);
      }
      return path === "/api" || path.startsWith("/api/")
        ? errorResponse("firebase_domain_not_ready", 503) : errorResponse("not_found", 404);
    } catch (error) {
      if (error instanceof RequestError) return errorResponse(error.code, error.status);
      if (error instanceof FirestoreDomainError) return errorResponse(error.code, error.status);
      if (error instanceof FamilyError) return errorResponse(error.code, error.status);
      if (error instanceof FirestoreAuthorityError && authorityErrors.get(error.code) === error.status) return errorResponse(error.code, error.status);
      if (error instanceof FirebaseAuthError && authenticationErrors.get(error.code) === error.status) return errorResponse(error.code, error.status);
      if (error instanceof DeviceSessionError && error.code === "session_invalid" && error.status === 401) return errorResponse("unauthorized", 401);
      return errorResponse("firebase_service_unavailable", 503);
    }
  };
}
