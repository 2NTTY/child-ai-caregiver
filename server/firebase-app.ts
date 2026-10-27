import { handleFirebaseAvatarRequest, type FirebaseAvatarApiPort } from './firebase-avatar-api.ts';
import { handleSharingControlRequest, type SharingControl } from './sharing-control-api.ts';
import { handleFirebaseChatFileRequest, type FirebaseChatFileApiPort } from './firebase-chat-files-api.ts';
import { handleFirebaseVoiceRequest, type FirebaseVoiceApiPort } from './firebase-voice-api.ts';
import { requestOriginAllowed } from "./request-auth-transport.ts";
import { z } from 'zod';
import { handleAdminRequest } from './admin-api.ts';
import type { FirestoreAdmin } from './firestore-admin.ts';
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
import type { FirestoreCareSummary } from './firestore-care-summary.ts';
import { summaryQuery } from '../src/shared/care-summary.ts';
import { domainParse } from './firestore-domain-data.ts';
import { handleCareRequest } from "./care-api.ts";
import { FamilyError } from "./family-access.ts";
import { handleMemoryRequest } from "./memory-api.ts";
import type { MemoryStore } from "./memory.ts";
import type { createFirestoreProductAgent } from './firestore-product-agent.ts';
import { handleProductAgentRequest } from './product-agent-api.ts';
import { handleAgentActionsRequest } from './agent-actions-api.ts';
import { handleModelSettingsRequest } from './model-settings-api.ts';
import { handleSharedInputRequest } from './shared-input-api.ts';
import type { SharedInputStore } from './shared-input-store.ts';
import type { SharedInputService } from './shared-input-service.ts';
import type { PhotoAgent } from './photo-agent.ts';
import { handleFirebaseAccountData, type FirebaseAccountDataPort } from './firebase-account-data-api.ts';

import { handleGrowthRequest } from "./growth-api.ts";
import type { FirestoreGrowthStore } from "./firestore-growth.ts";
import type { FirestoreConcernStore } from "./firestore-concerns.ts";
import { handleConcernRequest } from "./concern-api.ts";
import type { FirestoreWebPush } from './firestore-web-push.ts';
import type { FirestoreTelegram } from './firestore-telegram.ts';
import type { TelegramConfig, TelegramGateway } from './telegram-types.ts';
import { telegramWebhookAuthorized } from './telegram-config.ts';
import { handleTelegramWebhook } from './telegram-webhook.ts';
import type { FirestoreContact } from './firestore-contact.ts';

const MAX_BODY_BYTES = 16 * 1024;
const authorityErrors = new Map<string, number>([
  ["invalid_input", 400], ["not_found", 404], ["invitation_consumed", 409], ["invitation_closed", 409], ["invitation_expiry_invalid", 400], ["service_disabled", 403], ["binding", 403],
  ["account_inactive", 403], ["account_not_ready", 403], ["email_not_verified", 403],
  ["identity_email_changed", 403], ["invitation_unavailable", 403], ["operation_conflict", 409],
  ["scope_changed", 409], ["operation_erased", 409], ["transaction_change_conflict", 409], ["document_too_large", 413],
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
  admin?: FirestoreAdmin;
  adminUid?: string | null;
  online?: FirestoreOnlineStore;
  sharing?: SharingControl;
  documents?: FamilyDocumentStore & { forSharedSpace?(selection: import('../src/shared/sharing.ts').SharedSelection): FamilyDocumentStore };
  photos?: FirebasePhotoApiPort;
  avatars?: FirebaseAvatarApiPort;
  voice?: FirebaseVoiceApiPort;
  files?: FirebaseChatFileApiPort;
  photoAgent?: PhotoAgent;
  accountData?: FirebaseAccountDataPort;
  library?: Pick<PersonalLibrary, "page">;
  chat?: ChatStore;
  care?: FirestoreCareStore;
  summary?: FirestoreCareSummary;
  memory?: MemoryStore & { forSharedSpace?(spaceId: string): MemoryStore };
  sources?: SharedInputStore;
  concerns?: FirestoreConcernStore;
  growth?: FirestoreGrowthStore;
  push?: FirestoreWebPush;
  nativePush?: import('./firestore-native-push.ts').FirestoreNativePush;
  contact?: FirestoreContact;
  telegram?: { store: FirestoreTelegram; config: TelegramConfig | null; gateway: TelegramGateway };
  sourceService?: SharedInputService;
  product?: Awaited<ReturnType<typeof createFirestoreProductAgent>>;
}
export type FirebaseRequestHandler = (request: Request) => Promise<Response>;

function uncached(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const key of [...headers.keys()]) if (key.startsWith("access-control-")) headers.delete(key);
  headers.set("Cache-Control", "private, no-store");
  headers.set("Pragma", "no-cache");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Vary", headers.has("vary") ? headers.get("vary") + ", Cookie, Authorization" : "Cookie, Authorization");
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
      if (path === '/api/telegram/webhook') {
        const channel = options.telegram;
        if (request.method !== 'POST' || !channel?.config || !telegramWebhookAuthorized(request.headers.get('x-telegram-bot-api-secret-token'), channel.config)) return errorResponse('forbidden', 403);
        return uncached(await handleTelegramWebhook(request, channel.store, channel.gateway, channel.config.botId, options.contact));
      }
      if (request.method === 'GET' && path === '/api/native-push/open' && options.nativePush) {
        const session = await auth.nativeSessionProof?.(request.headers);
        if (!session) throw new RequestError('unauthorized', 401);
        if (request.headers.get('x-expected-user-id') !== session.userId) throw new RequestError('session_changed', 409);
        const raw = new URL(request.url).searchParams.get('reference');
        if (!raw || raw.length > 1024) throw new RequestError('invalid_input', 400);
        let value; try { value = JSON.parse(raw); } catch { throw new RequestError('invalid_input', 400); }
        const ref = await options.nativePush.authorizeOpen(session.userId, session, value);
        const result = ref.kind === 'test' ? { kind: 'test', childId: null, taskId: null } : await options.contact?.resolveNativeOpen(session.userId, ref);
        if (!result) throw new RequestError('not_found', 404);
        // Recheck after lookup; a tap never marks receipt or completes a task.
        if ((await auth.nativeSessionProof?.(request.headers))?.sessionHash !== session.sessionHash) throw new RequestError('session_changed', 409);
        return json(result);
      }
      if (request.method === 'GET' && ((path === '/api/native-push' || path === '/api/native-push/v2') && options.nativePush || path === '/api/web-push' && options.push || path === '/api/telegram' && options.telegram)) {
        const userId = (await auth.getSession({ headers: request.headers }))?.user.id;
        if (!userId) throw new RequestError('unauthorized', 401);
        const expected = request.headers.get('x-expected-user-id');
        if (!expected || expected !== userId) throw new RequestError(expected ? 'session_changed' : 'account_precondition_required', expected ? 409 : 428);
        const result = path.startsWith('/api/native-push') ? await options.nativePush!.status(userId, await auth.nativeSessionProof?.(request.headers) ?? null, path.endsWith('/v2') ? 2 : 1) : path === '/api/web-push' ? await options.push!.status(userId) : await options.telegram!.store.status(userId);
        if ((await auth.getSession({ headers: request.headers }))?.user.id !== userId) throw new RequestError('identity_changed', 409);
        return json(result);
      }
      if ((path === "/healthz" || path === "/api/health") && request.method === "GET") {
        return json({ status: "ok", storage: "firestore", stage: "foundation" });
      }
      if (path.startsWith('/api/admin/') && request.headers.has('authorization')) return errorResponse('forbidden', 403);
      if (path.startsWith('/api/admin/') && options.admin) return uncached(await handleAdminRequest(request, { auth, admin: options.admin, adminUid: options.adminUid ?? null, publicOrigin, readJson }));
      if (path.startsWith("/api/auth/")) return uncached(await auth.handler(request));
      if (path === '/api/account/messages' && !options.accountData) return errorResponse('message_history_unavailable', 503);
      if (options.accountData && (path === '/api/account/messages' || path === '/api/account/export' || path === '/api/account/delete' || path.startsWith('/api/account/deletion/'))) {
        if (request.method !== 'GET' && !requestOriginAllowed(request.headers, publicOrigin)) throw new RequestError('origin_rejected', 403);
        return uncached(await handleFirebaseAccountData(request, auth, options.accountData, readJson));
      }
      if (path === "/api/account" && request.method === "GET") {
        const session = await auth.getSession({ headers: request.headers });
        return json(await accountStatus(session?.user.id ?? null));
      }
      if (path === "/api/account/acknowledgement" && request.method === "POST") {
        if (!requestOriginAllowed(request.headers, publicOrigin)) throw new RequestError("origin_rejected", 403);
        const session = await auth.getSession({ headers: request.headers }), userId = session?.user.id;
        if (!userId) throw new RequestError("unauthorized", 401);
        if (request.headers.get("x-expected-user-id") !== userId) throw new RequestError("identity_changed", 409);
        const parsed = accountAcknowledgementSchema.safeParse(await readJson(request));
        if (!parsed.success) throw new RequestError("account_acknowledgement_invalid", 400);
        await authority.acknowledge({ userId, operationId: parsed.data.operationId, policyVersion: parsed.data.policyVersion });
        // Return the existing complete status shape. A failed read is an unknown outcome, never false success.
        return json(await accountStatus(userId));
      }
      if (path === '/api/shared-spaces' || path.startsWith('/api/shared-spaces/')) {
        if (request.method !== 'GET' && !requestOriginAllowed(request.headers, publicOrigin)) throw new RequestError('origin_rejected', 403);
        const userId = (await auth.getSession({ headers:request.headers }))?.user.id;
        if (!userId) throw new RequestError('unauthorized', 401);
        if (!options.sharing) throw new RequestError('sharing_unavailable', 503);
        const isCurrentUser = async (expectedUserId: string) => (await auth.getSession({ headers:request.headers }))?.user.id === expectedUserId;
        return uncached(await handleSharingControlRequest(request, userId, options.sharing, isCurrentUser, readJson));
      }
      if (/^\/api\/(?:me|children\/[^/]+)\/avatar(?:\/|$)/u.test(path)) {
        if (request.method !== 'GET' && !requestOriginAllowed(request.headers, publicOrigin)) throw new RequestError('origin_rejected', 403);
        const userId = (await auth.getSession({ headers: request.headers }))?.user.id;
        if (!userId) throw new RequestError('unauthorized', 401);
        const isCurrentUser = async (expectedUserId: string) => (await auth.getSession({ headers: request.headers }))?.user.id === expectedUserId;
        return uncached(await handleFirebaseAvatarRequest(request, userId, options.avatars, isCurrentUser));
      }
      if (documents && /^\/api\/children\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/documents(?:\/|$)/iu.test(path)) {
        if (request.method !== "GET" && !requestOriginAllowed(request.headers, publicOrigin)) throw new RequestError("origin_rejected", 403);
        const session = await auth.getSession({ headers: request.headers }), userId = session?.user.id;
        if (!userId) throw new RequestError("unauthorized", 401);
        const isCurrentUser = async (expectedUserId: string) => (await auth.getSession({ headers: request.headers }))?.user.id === expectedUserId;
        const response = await handleFamilyDocumentRequest(request, userId, documents, isCurrentUser);
        if (!await isCurrentUser(userId)) throw new RequestError("identity_changed", 409);
        return uncached(response);
      }
      if (options.growth && /^\/api\/children\/[^/]+\/growth(?:\/|$)/u.test(path)) {
        if (request.method !== 'GET' && !requestOriginAllowed(request.headers, publicOrigin)) throw new RequestError('origin_rejected', 403);
        const userId = (await auth.getSession({ headers: request.headers }))?.user.id;
        if (!userId) throw new RequestError('unauthorized', 401);
        const isCurrentUser = async (expected: string) => (await auth.getSession({ headers: request.headers }))?.user.id === expected;
        const url = new URL(request.url), spaceId = url.searchParams.get('spaceId');
        if ([...url.searchParams.keys()].some(key => key !== 'spaceId') || url.searchParams.getAll('spaceId').length > 1
          || spaceId !== null && !z.uuid().safeParse(spaceId).success) throw new RequestError('invalid_input', 400);
        const growth = spaceId ? options.growth.forSharedSpace(spaceId) : options.growth;
        const response = await handleGrowthRequest(request, userId, growth, isCurrentUser);
        if (!await isCurrentUser(userId)) throw new RequestError('identity_changed', 409);
        return uncached(response);
      }
      const contactPath = /^\/api\/children\/([0-9a-f-]{36})\/contact$/iu.exec(path);
      if (request.method === 'GET' && contactPath && options.contact) {
        const userId = (await auth.getSession({ headers: request.headers }))?.user.id; if (!userId) throw new RequestError('unauthorized', 401);
        const expected = request.headers.get('x-expected-user-id'); if (expected && expected !== userId) throw new RequestError('session_changed', 409);
        const value = await options.contact.page(userId, contactPath[1]);
        if ((await auth.getSession({ headers: request.headers }))?.user.id !== userId) throw new RequestError('identity_changed', 409);
        return json(value);
      }
      if (options.concerns && /^\/api\/children\/[^/]+\/concerns(?:\/|$)/u.test(path)) {
        if (request.method !== 'GET' && !requestOriginAllowed(request.headers, publicOrigin)) throw new RequestError('origin_rejected', 403);
        const userId = (await auth.getSession({ headers: request.headers }))?.user.id;
        if (!userId) throw new RequestError('unauthorized', 401);
        const isCurrentUser = async (expected: string) => (await auth.getSession({ headers: request.headers }))?.user.id === expected;
        const url = new URL(request.url), spaceId = url.searchParams.get('spaceId');
        if ([...url.searchParams.keys()].some(key => key !== 'spaceId') || url.searchParams.getAll('spaceId').length > 1
          || spaceId !== null && !z.uuid().safeParse(spaceId).success) throw new RequestError('invalid_input', 400);
        const concerns = spaceId ? options.concerns.forSharedSpace(spaceId) : options.concerns;
        const response = await handleConcernRequest(request, userId, concerns, isCurrentUser);
        if (!await isCurrentUser(userId)) throw new RequestError('identity_changed', 409);
        return uncached(response);
      }
      if (options.sources && /^\/api\/children\/[^/]+\/inputs(?:\/|$)/u.test(path)) {
        if (request.method !== 'GET' && !requestOriginAllowed(request.headers, publicOrigin)) throw new RequestError('origin_rejected', 403);
        const userId = (await auth.getSession({ headers: request.headers }))?.user.id;
        if (!userId) throw new RequestError('unauthorized', 401);
        const isCurrentUser = async () => (await auth.getSession({ headers: request.headers }))?.user.id === userId;
        const response = await handleSharedInputRequest(request, userId, options.sources, { service: options.sourceService, isCurrentUser });
        if (!await isCurrentUser()) throw new RequestError('identity_changed', 409);
        return uncached(response);
      }
      if (options.files && /^\/api\/children\/[^/]+\/files(?:\/|$)/u.test(path)) {
        if (request.method !== 'GET' && !requestOriginAllowed(request.headers, publicOrigin)) throw new RequestError('origin_rejected', 403);
        const userId = (await auth.getSession({ headers: request.headers }))?.user.id;
        if (!userId) throw new RequestError('unauthorized', 401);
        const isCurrentUser = async (expected: string) => (await auth.getSession({ headers: request.headers }))?.user.id === expected;
        return uncached(await handleFirebaseChatFileRequest(request, userId, options.files, isCurrentUser));
      }
      if (options.voice && /^\/api\/children\/[^/]+\/voices(?:\/|$)/u.test(path)) {
        if (request.method !== 'GET' && !requestOriginAllowed(request.headers, publicOrigin)) throw new RequestError('origin_rejected', 403);
        const userId = (await auth.getSession({ headers: request.headers }))?.user.id;
        if (!userId) throw new RequestError('unauthorized', 401);
        const isCurrentUser = async (expected: string) => (await auth.getSession({ headers: request.headers }))?.user.id === expected;
        return uncached(await handleFirebaseVoiceRequest(request, userId, options.voice, isCurrentUser));
      }
      if (photos && /^\/api\/children\/[^/]+\/photos(?:\/|$)/u.test(path)) {
        if (request.method !== "GET" && !requestOriginAllowed(request.headers, publicOrigin)) throw new RequestError("origin_rejected", 403);
        const session = await auth.getSession({ headers: request.headers }), userId = session?.user.id;
        if (!userId) throw new RequestError("unauthorized", 401);
        const isCurrentUser = async (expectedUserId: string) => (await auth.getSession({ headers: request.headers }))?.user.id === expectedUserId;
        return uncached(await handleFirebasePhotoRequest(request, userId, photos, isCurrentUser, options.photoAgent));
      }
      if (library && /^\/api\/children\/[^/]+\/library$/u.test(path)) {
        if (request.method !== "GET" && !requestOriginAllowed(request.headers, publicOrigin)) throw new RequestError("origin_rejected", 403);
        const session = await auth.getSession({ headers: request.headers }), userId = session?.user.id;
        if (!userId) throw new RequestError("unauthorized", 401);
        const isCurrentUser = async (expectedUserId: string) => (await auth.getSession({ headers: request.headers }))?.user.id === expectedUserId;
        const response = await handlePersonalLibraryRequest(request, userId, { library, isCurrentUser });
        if (!await isCurrentUser(userId)) throw new RequestError("identity_changed", 409);
        return uncached(response);
      }
      if (online && (path === "/api/children" || path === "/api/notification-preferences" || path.startsWith("/api/online/") || /^\/api\/children\/[^/]+\/tasks(?:\/|$)/u.test(path))) {
        if (request.method !== "GET" && !requestOriginAllowed(request.headers, publicOrigin)) throw new RequestError("origin_rejected", 403);
        const session = await auth.getSession({ headers: request.headers }), userId = session?.user.id;
        if (!userId) throw new RequestError("unauthorized", 401);
        const expected = request.headers.get("x-expected-user-id");
        if (expected !== null && expected !== userId) throw new RequestError("identity_changed", 409);
        let response: Response;
        if (path.startsWith("/api/online/")) response = await handleOnlineRequest(request, userId, { ...online,
          async submit(expectedUserId, submission, context) {
            if ((await auth.getSession({ headers: request.headers }))?.user.id !== expectedUserId) throw new RequestError("identity_changed", 409);
            return online.submit(expectedUserId, submission, context);
          } }, async () => ({ nativeSession: await auth.nativeSessionProof?.(request.headers) ?? null }));
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
          const url = new URL(request.url), spaceId = url.searchParams.get('spaceId');
          if (url.searchParams.getAll('spaceId').length > 1 || spaceId !== null && !z.uuid().safeParse(spaceId).success) throw new RequestError('invalid_input', 400);
          const tasks = spaceId ? online.tasks.forSharedSpace?.(spaceId) : online.tasks;
          if (!tasks) throw new RequestError('shared_domain_unavailable', 409);
          const detail = /^\/api\/children\/([^/]+)\/tasks\/([^/]+)$/u.exec(path);
          if (request.method === "GET" && detail && tasks.detail) {
            if ([...url.searchParams.keys()].some(key => key !== 'spaceId')) throw new RequestError("invalid_input", 400);
            const result = await tasks.detail(userId, detail[1].toLowerCase(), detail[2].toLowerCase());
            response = result ? json(result) : errorResponse("not_found", 404);
          } else response = await handleTaskRequest(request, userId, tasks);
        }
        if ((await auth.getSession({ headers: request.headers }))?.user.id !== userId) throw new RequestError("identity_changed", 409);
        return uncached(response);
      }
      if (options.product && (path.startsWith('/api/ai/') || /^\/api\/children\/[^/]+\/(?:agent(?:\/|$)|messages\/[^/]+\/reply(?:\/|$))/u.test(path))) {
        if (request.method !== 'GET' && !requestOriginAllowed(request.headers, publicOrigin)) throw new RequestError('origin_rejected', 403);
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
        const url = new URL(request.url), spaceId = url.searchParams.get('spaceId');
        if (url.searchParams.getAll('spaceId').length > 1 || spaceId !== null && !z.uuid().safeParse(spaceId).success) throw new RequestError('invalid_input', 400);
        const memory = spaceId ? options.memory.forSharedSpace?.(spaceId) : options.memory;
        if (!memory) throw new RequestError('shared_domain_unavailable', 409);
        const response = await handleMemoryRequest(request, userId, memory);
        if ((await auth.getSession({ headers: request.headers }))?.user.id !== userId) throw new RequestError("identity_changed", 409);
        return uncached(response);
      }
      const summaryPath = /^\/api\/children\/([0-9a-f-]{36})\/summary$/iu.exec(path);
      if (summaryPath && options.summary) {
        if (request.method !== 'GET') throw new RequestError('method_not_allowed', 405);
        const userId = (await auth.getSession({ headers: request.headers }))?.user.id;
        if (!userId) throw new RequestError('unauthorized', 401);
        if (request.headers.get('x-expected-user-id') !== userId) throw new RequestError('session_changed', 409);
        const query = domainParse(summaryQuery, Object.fromEntries(new URL(request.url).searchParams));
        const result = await options.summary.get(userId, summaryPath[1].toLowerCase(), query);
        if ((await auth.getSession({ headers: request.headers }))?.user.id !== userId) throw new RequestError('identity_changed', 409);
        return json(result);
      }
      if (options.care && /^\/api\/children\/[^/]+\/(?:records|profile|care)(?:\/|$)/u.test(path)) {
        const readOnly = request.method === "GET" || request.method === "POST" && path.endsWith("/care/search");
        if (!readOnly) throw new RequestError("account_precondition_required", 428);
        if (request.method === "POST" && !requestOriginAllowed(request.headers, publicOrigin)) throw new RequestError("origin_rejected", 403);
        const userId = (await auth.getSession({ headers: request.headers }))?.user.id;
        if (!userId) throw new RequestError("unauthorized", 401);
        const records = /^\/api\/children\/([0-9a-f-]{36})\/records$/iu.exec(path);
        const sharedSpaceId = new URL(request.url).searchParams.get('spaceId');
        const care = sharedSpaceId !== null ? options.care.forSharedSpace(sharedSpaceId) : options.care;
        const response = records ? json(await care.listRecords(userId, records[1].toLowerCase()))
          : await handleCareRequest(request, userId, care);
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
      if (error instanceof FirestoreDomainError) {
        const response = errorResponse(error.code, error.status), retry = options.avatars?.retryAfterSeconds;
        if (error.code === 'avatar_busy' && error.status === 429 && Number.isInteger(retry) && retry! >= 1 && retry! <= 60)
          response.headers.set('Retry-After', String(retry));
        return response;
      }
      if (error instanceof FamilyError) return errorResponse(error.code, error.status);
      if (error instanceof FirestoreAuthorityError && authorityErrors.get(error.code) === error.status) return errorResponse(error.code, error.status);
      if (error instanceof FirebaseAuthError && authenticationErrors.get(error.code) === error.status) return errorResponse(error.code, error.status);
      if (error instanceof DeviceSessionError && error.code === "session_invalid" && error.status === 401) return errorResponse("unauthorized", 401);
      return errorResponse("firebase_service_unavailable", 503);
    }
  };
}
