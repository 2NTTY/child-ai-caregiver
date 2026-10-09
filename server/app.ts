import { handlePersonalLibraryRequest } from "./personal-library-api.ts";
import { AccountAdmissionError } from "./account-admission.ts";
import { handleAccountServiceRequest, type AccountServiceApi } from "./account-service-api.ts";
import { handleSharedInputRequest } from "./shared-input-api.ts";
import { handleModelSettingsRequest } from "./model-settings-api.ts";
import { handlePhotoRequest } from "./photo-api.ts";
import { PHOTO_LIMITS } from "../src/shared/photos.ts";
import { handleCareSummaryRequest } from "./care-summary-api.ts";
import { handleContactRequest } from "./contact-api.ts";
import { handleWebPushRequest } from "./web-push-api.ts";
import { isIP } from "node:net";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ServerAuthPort } from "./auth-port.ts";
import type { ServerConfig } from "./config.ts";
import { apiError, handleWorkspaceRequest, jsonResponse } from "./workspace-api.ts";
import type { WorkspaceStore } from "./workspaces.ts";
import type { RecordStore } from "./records.ts";
import { handleRecordRequest } from "./record-api.ts";
import type { ModelGateway } from "./model-gateway.ts";
import type { ChatStore } from "./chat.ts";
import { handleChatRequest } from "./chat-api.ts";
import { handleChatReply } from "./chat-reply.ts";
import { handleGrowthRequest } from "./growth-api.ts";
import { handleConcernRequest } from "./concern-api.ts";
import { handleFamilyDocumentRequest } from "./family-document-api.ts";
import { handleProductAgentRequest } from "./product-agent-api.ts";
import { handleAgentActionsRequest } from "./agent-actions-api.ts";
import type { AiUsageStore } from "./ai-usage.ts";
import { handleFamilyRequest } from "./family-api.ts";
import { handleCareRequest } from "./care-api.ts";
import { handleMemoryRequest } from "./memory-api.ts";
import { handleTaskRequest } from "./task-api.ts";
import { handleOnlineRequest } from "./online-api.ts";
import type { OnlineStore } from "./online.ts";

import type { TelegramConfig,TelegramGateway } from "./telegram-types.ts";
import type { TelegramStore } from "./telegram-store.ts";
import { telegramWebhookAuthorized } from "./telegram-config.ts";
import { handleTelegramRequest } from "./telegram-api.ts";
import { handleTelegramWebhook } from "./telegram-webhook.ts";
const MAX_BODY_BYTES = 64 * 1024;

class BodyTooLargeError extends Error {}

function readBody(request: IncomingMessage,limit=MAX_BODY_BYTES): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    const cleanup = () => {
      request.off("data", onData);
      request.off("end", onEnd);
      request.off("error", onError);
      request.off("aborted", onAborted);
    };
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        cleanup();
        request.resume();
        reject(new BodyTooLargeError());
      } else chunks.push(chunk);
    };
    const onEnd = () => { cleanup(); resolve(Buffer.concat(chunks).toString("utf8")); };
    const onError = () => { cleanup(); reject(new Error("Request stream failed")); };
    const onAborted = () => { cleanup(); reject(new Error("Request aborted")); };
    request.on("data", onData);
    request.once("end", onEnd);
    request.once("error", onError);
    request.once("aborted", onAborted);
  });
}

async function writeResponse(response: Response, target: ServerResponse, origin: string | null): Promise<void> {
  target.statusCode = response.status;
  response.headers.forEach((value, key) => { if (key !== "set-cookie") target.setHeader(key, value); });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) target.setHeader("set-cookie", cookies);
  target.setHeader("cache-control", "no-store");
  target.setHeader("x-content-type-options", "nosniff");
  target.setHeader("vary", "Origin");
  if (origin) {
    target.setHeader("access-control-allow-origin", origin);
    target.setHeader("access-control-allow-credentials", "true");
  }
  target.end(Buffer.from(await response.arrayBuffer()));
}

export function createRequestHandler(options: {
  config: ServerConfig;
  auth: ServerAuthPort;
  workspaces: WorkspaceStore;
  account?: AccountServiceApi;
  records: RecordStore;
  families?: import("./families.ts").FamilyStore;
  care?: import("./care.ts").CareStore;
  memory?: import("./memory.ts").MemoryStore;
  tasks?: import("./tasks.ts").TaskStore;
  online?: OnlineStore;
  inputs?:{store:import("./shared-input-store.ts").SharedInputStore;service:import("./shared-input-service.ts").SharedInputService};
  photos?:{store:import("./photo-store.ts").PhotoStore;agent:import("./photo-agent.ts").PhotoAgent};
  summary?:import("./care-summary-store.ts").CareSummaryStore;
  contact?:import("./contact-store.ts").ContactStore;
  growth?: import("./growth-store.ts").GrowthStore;
  concerns?: import("./concern-store.ts").ConcernStore;
  documents?: import("./family-document-store.ts").FamilyDocumentStore;
  productAgent?: import("./product-agent.ts").ProductAgent;
  productAgentStore?: import("./product-agent-store.ts").ProductAgentStore;
  personalLibrary?: import("./personal-library-api.ts").PersonalLibrary;
  agentActions?: import("./agent-actions-store.ts").AgentActionsStore;
  webPush?: import("./web-push-store.ts").WebPushStore;
  telegram?:{store:TelegramStore;config:TelegramConfig|null;gateway:TelegramGateway};
  modelGateway?: ModelGateway;
  modelRouting?: import("./model-routing.ts").ModelRouting;
  chat?: ChatStore;
  chatPrompt?: string;
  aiMaxInputCharacters?: number;
  aiUsage?: AiUsageStore;
  checkDatabase: () => Promise<void>;
}) {
  let photoUploads = 0;
  const allowedOrigins = new Set([options.config.publicOrigin, options.config.webOrigin]);
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    let permittedOrigin: string | null = null;
    let photoSlot = false;
    try {
      const headers = options.auth.fromNodeHeaders(request.headers);
      // Only the explicitly configured ingress peer may supply a single sanitized client IP.
      const peerIp = request.socket.remoteAddress?.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/u, "");
      const forwardedIp = headers.get("x-forwarded-for")?.trim();
      const clientIp = options.config.trustedProxyIp && peerIp === options.config.trustedProxyIp
        && forwardedIp && isIP(forwardedIp) ? forwardedIp : peerIp;
      if (clientIp) headers.set("x-forwarded-for", clientIp);
      else headers.delete("x-forwarded-for");
      const origin = headers.get("origin");
      if (origin && !allowedOrigins.has(origin)) {
        request.resume();
        await writeResponse(apiError("forbidden_origin", "此來源未獲授權。", 403), response, null);
        return;
      }
      permittedOrigin = origin;
      const method = request.method ?? "GET";
      if (!request.url?.startsWith("/") || request.url.startsWith("//")) {
        request.resume();
        await writeResponse(apiError("invalid_request", "無效請求。", 400), response, permittedOrigin);
        return;
      }
      const url = new URL(request.url, options.config.publicOrigin);
      if (method === "OPTIONS") {
        const preflight = new Response(null, { status: 204, headers: {
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "content-type, x-expected-user-id, x-erasure-receipt",
        } });
        await writeResponse(preflight, response, permittedOrigin);
        return;
      }
      if (method !== "GET" && method !== "POST") {
        request.resume();
        await writeResponse(apiError("method_not_allowed", "不支援此操作。", 405), response, permittedOrigin);
        return;
      }
      const telegramWebhook=url.pathname==="/api/telegram/webhook";
      if(telegramWebhook && (method!=="POST" || !telegramWebhookAuthorized(headers.get("x-telegram-bot-api-secret-token"),options.telegram?.config??null))){
        request.resume();
        await writeResponse(apiError("forbidden","無效渠道請求。",403),response,null);
        return;
      }
      if (method === "POST" && !origin && !telegramWebhook) {
        request.resume();
        await writeResponse(apiError("forbidden_origin", "此來源未獲授權。", 403), response, null);
        return;
      }
      const accountPath = url.pathname === "/api/account" || url.pathname.startsWith("/api/account/");
      if (options.account?.admission.enabled && !accountPath && !telegramWebhook
        && !url.pathname.startsWith("/api/auth/") && url.pathname !== "/api/health") {
        const session = await options.auth.getSession({ headers });
        if (!session?.user.id) throw new AccountAdmissionError(401, "unauthorized");
        await options.account.admission.assertUsable(session.user.id);
      }
      if (url.pathname === "/api/auth/revoke-other-sessions") {
        const session = await options.auth.getSession({ headers });
        if (!session?.user.id) throw new AccountAdmissionError(401, "unauthorized");
        if (headers.get("x-expected-user-id") !== session.user.id) throw new AccountAdmissionError(409, "session_changed");
      }
      let bodyLimit=MAX_BODY_BYTES;
      if (url.pathname.startsWith("/api/ai/settings")) bodyLimit = 2048;
      const upload=method==="POST" ? /^\/api\/children\/([a-f0-9-]{36})\/photos\/([a-f0-9-]{36})\/content$/u.exec(url.pathname):null;
      if(upload&&options.photos){
        const session=await options.auth.getSession({headers});
        const id=session?.user.id;
        const photo=id&&headers.get("x-expected-user-id")===id?await options.photos.store.get(id,upload[1],upload[2]):null;
        if(!photo||photo.ownerUserId!==id||!photo.canManage||photoUploads>=2){
          request.resume();await writeResponse(apiError("upload_unavailable","照片暫時未能上傳，請確認權限或稍後重試。",photo?429:404),response,permittedOrigin);return;
        }
        photoUploads++;photoSlot=true;
        bodyLimit=Math.ceil(PHOTO_LIMITS.bytes/3)*4+128;
      }
      const length = Number(headers.get("content-length") ?? "0");
      if (!Number.isFinite(length) || length < 0 || length > bodyLimit) throw new BodyTooLargeError();
      const body = method === "POST" ? await readBody(request,bodyLimit) : undefined;
      const aborted = new AbortController();
      response.once("close", () => { if (!response.writableEnded) aborted.abort(); });
      const webRequest = new Request(url, { method, headers, signal: aborted.signal, ...(body ? { body } : {}) });
      let result: Response;
      if(telegramWebhook && options.telegram?.config){
        result=await handleTelegramWebhook(webRequest,options.telegram.store,options.telegram.gateway,options.telegram.config.botId,options.contact);
      } else if (url.pathname.startsWith("/api/auth/")) {
        result = await options.auth.handler(webRequest);
        if (result.status >= 500) {
          await result.body?.cancel();
          result = apiError("service_unavailable", "服務暫時未能處理，請稍後重試。", 503);
        }
      } else if (url.pathname === "/api/health" && method === "GET") {
        await options.checkDatabase();
        result = jsonResponse({ status: "ok" });
      } else if (accountPath && options.account) {
        const sessionResult = await options.auth.getSession({ headers, returnHeaders: true });
        result = await handleAccountServiceRequest(webRequest, sessionResult.response?.user.id ?? null, options.account);
        for (const cookie of sessionResult.headers.getSetCookie()) result.headers.append("set-cookie", cookie);
      } else if (["/api/ai/settings", "/api/ai/settings/check"].includes(url.pathname) && options.modelRouting) {
        const sessionResult = await options.auth.getSession({ headers, returnHeaders: true });
        result = await handleModelSettingsRequest(webRequest, sessionResult.response?.user.id ?? null, options.modelRouting);
        for (const cookie of sessionResult.headers.getSetCookie()) result.headers.append("set-cookie", cookie);
      } else if (["/api/ai/status", "/api/ai/usage"].includes(url.pathname) && method === "GET") {
        const sessionResult = await options.auth.getSession({ headers, returnHeaders: true });
        result = sessionResult.response?.user.id
          ? url.pathname.endsWith("/usage") && options.aiUsage
            ? jsonResponse(options.modelRouting ? await options.modelRouting.currentUsage(sessionResult.response.user.id) : await options.aiUsage.getForUser(sessionResult.response.user.id))
            : jsonResponse({ available: options.modelRouting ? await options.modelRouting.available(sessionResult.response.user.id) : options.modelGateway?.available() ?? false })
          : apiError("unauthorized", "請先登入。", 401);
        for (const cookie of sessionResult.headers.getSetCookie()) result.headers.append("set-cookie", cookie);
      } else if (url.pathname === "/api/workspaces" || url.pathname.startsWith("/api/workspaces/")
        || url.pathname === "/api/children" || url.pathname.startsWith("/api/children/")
        || url.pathname === "/api/families" || url.pathname.startsWith("/api/families/") || url.pathname === "/api/notification-preferences"
        || url.pathname.startsWith("/api/online/") || url.pathname === "/api/web-push" || url.pathname.startsWith("/api/web-push/") || url.pathname === "/api/telegram" || url.pathname.startsWith("/api/telegram/")) {
        const sessionResult = await options.auth.getSession({ headers, returnHeaders: true });
        const userId = sessionResult.response?.user.id ?? null;
        result = /^\/api\/children\/[^/]+\/library$/u.test(url.pathname) && options.personalLibrary
          ? await handlePersonalLibraryRequest(webRequest, userId, { library: options.personalLibrary,
            isCurrentUser: async expected => (await options.auth.getSession({ headers }))?.user.id === expected })
          : /^\/api\/children\/[^/]+\/inputs(?:\/|$)/u.test(url.pathname)&&options.inputs
          ? await handleSharedInputRequest(webRequest,userId,options.inputs.store,{service:options.inputs.service,
              isCurrentUser:async()=>Boolean(userId)&&(await options.auth.getSession({headers}))?.user.id===userId})
          : /^\/api\/children\/[^/]+\/photos(?:\/|$)/u.test(url.pathname)&&options.photos
          ? await handlePhotoRequest(webRequest,userId,options.photos.store,{agent:options.photos.agent,
              isCurrentUser:async()=>Boolean(userId)&&(await options.auth.getSession({headers}))?.user.id===userId})
          : /^\/api\/children\/[^/]+\/(summary|visit-preparation)$/u.test(url.pathname) && options.summary
          ? await handleCareSummaryRequest(webRequest,userId,options.summary)
          : /\/api\/children\/[^/]+\/contact(\/|$)/u.test(url.pathname) && options.contact
          ? await handleContactRequest(webRequest,userId,options.contact)
          : (url.pathname === "/api/telegram" || url.pathname.startsWith("/api/telegram/")) && options.telegram
          ? await handleTelegramRequest(webRequest,userId,options.telegram.store)
          : /^\/api\/children\/[^/]+\/documents(\/|$)/u.test(url.pathname) && options.documents
          ? await handleFamilyDocumentRequest(webRequest,userId,options.documents,async expected => (await options.auth.getSession({ headers }))?.user.id === expected)
          : /^\/api\/children\/[^/]+\/concerns(\/|$)/u.test(url.pathname) && options.concerns
          ? await handleConcernRequest(webRequest,userId,options.concerns,async expected => (await options.auth.getSession({ headers }))?.user.id === expected)
          : /^\/api\/children\/[^/]+\/growth(\/|$)/u.test(url.pathname) && options.growth
          ? await handleGrowthRequest(webRequest,userId,options.growth,async expected => (await options.auth.getSession({ headers }))?.user.id === expected)
          : options.agentActions && /^\/api\/children\/[^/]+\/agent\/(policy|notes|actions)(\/|$)/u.test(url.pathname)
          ? await handleAgentActionsRequest(webRequest, userId, options.agentActions, async expected => (await options.auth.getSession({ headers }))?.user.id === expected)
          : options.productAgent && options.productAgentStore && options.chat
          && (/^\/api\/children\/[^/]+\/agent\//u.test(url.pathname) || /^\/api\/children\/[^/]+\/messages\/[^/]+\/reply(?:\/cancel)?$/u.test(url.pathname))
          ? await handleProductAgentRequest(webRequest, userId, { agent: options.productAgent, store: options.productAgentStore, chat: options.chat,
            isCurrentUser: async expected => (await options.auth.getSession({ headers }))?.user.id === expected })
          : url.pathname.startsWith("/api/online/") && options.online
          ? await handleOnlineRequest(webRequest, userId, options.online)
          : (url.pathname === "/api/web-push" || url.pathname.startsWith("/api/web-push/")) && options.webPush
            ? await handleWebPushRequest(webRequest, userId, options.webPush)
          : /^\/api\/children\/[^/]+\/tasks(\/|$)/u.test(url.pathname) && options.tasks
            ? await handleTaskRequest(webRequest, userId, options.tasks)
          : /^\/api\/children\/[^/]+\/memory(\/|$)/u.test(url.pathname) && options.memory
            ? await handleMemoryRequest(webRequest, userId, options.memory)
          : /^\/api\/children\/[^/]+\/(care|profile)(\/|$)/u.test(url.pathname) && options.care
          ? await handleCareRequest(webRequest, userId, options.care)
          : (url.pathname.startsWith("/api/families") || url.pathname === "/api/notification-preferences") && options.families
          ? await handleFamilyRequest(webRequest, userId, options.families, options.records)
          : url.pathname.endsWith("/reply") && options.chat && options.modelGateway && options.chatPrompt
          ? await handleChatReply(webRequest, userId, {
            chat: options.chat, records: options.records, gateway: options.modelGateway,
            prompt: options.chatPrompt, maxInputCharacters: options.aiMaxInputCharacters ?? 10000,
            isCurrentUser: async expectedId => (await options.auth.getSession({ headers }))?.user.id === expectedId,
          })
          : url.pathname.endsWith("/messages") && options.chat
          ? await handleChatRequest(webRequest, userId, options.chat)
          : url.pathname.startsWith("/api/children")
          ? await handleRecordRequest(webRequest, userId, options.records)
          : await handleWorkspaceRequest(webRequest, userId, options.workspaces);
        for (const cookie of sessionResult.headers.getSetCookie()) result.headers.append("set-cookie", cookie);
      } else result = apiError("not_found", "找不到此服務。", 404);
      await writeResponse(result, response, permittedOrigin);
    } catch (error) {
      request.resume();
      if (response.headersSent || response.destroyed) { response.end(); return; }
      if (error instanceof BodyTooLargeError) {
        response.setHeader("connection", "close");
        await writeResponse(apiError("payload_too_large", "請求內容過大。", 413), response, permittedOrigin);
      } else if (error instanceof AccountAdmissionError) {
        await writeResponse(apiError(error.code, "請先完成邀請資格、電郵驗證及資料使用確認。", error.status), response, permittedOrigin);
      } else {
        await writeResponse(apiError("service_unavailable", "服務暫時未能處理，請稍後重試。", 503), response, permittedOrigin);
      }
    } finally { if(photoSlot)photoUploads--; }
  };
}
