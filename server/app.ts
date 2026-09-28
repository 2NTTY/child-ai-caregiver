import { handleWebPushRequest } from "./web-push-api.ts";
import { isIP } from "node:net";
import type { IncomingMessage, ServerResponse } from "node:http";
import { fromNodeHeaders } from "better-auth/node";
import type { createAuth } from "./auth.ts";
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
import { handleProductAgentRequest } from "./product-agent-api.ts";
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

function readBody(request: IncomingMessage): Promise<string> {
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
      if (size > MAX_BODY_BYTES) {
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
  auth: ReturnType<typeof createAuth>;
  workspaces: WorkspaceStore;
  records: RecordStore;
  families?: import("./families.ts").FamilyStore;
  care?: import("./care.ts").CareStore;
  memory?: import("./memory.ts").MemoryStore;
  tasks?: import("./tasks.ts").TaskStore;
  online?: OnlineStore;
  webPush?: import("./web-push-store.ts").WebPushStore;
  telegram?:{store:TelegramStore;config:TelegramConfig|null;gateway:TelegramGateway};
  growth?: import("./growth-store.ts").GrowthStore;
  productAgent?: import("./product-agent.ts").ProductAgent;
  productAgentStore?: import("./product-agent-store.ts").ProductAgentStore;
  modelGateway?: ModelGateway;
  chat?: ChatStore;
  chatPrompt?: string;
  aiMaxInputCharacters?: number;
  aiUsage?: AiUsageStore;
  checkDatabase: () => Promise<void>;
}) {
  const allowedOrigins = new Set([options.config.publicOrigin, options.config.webOrigin]);
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    let permittedOrigin: string | null = null;
    try {
      const headers = fromNodeHeaders(request.headers);
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
          "access-control-allow-headers": "content-type, x-expected-user-id",
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
      const length = Number(headers.get("content-length") ?? "0");
      if (!Number.isFinite(length) || length > MAX_BODY_BYTES) throw new BodyTooLargeError();
      const body = method === "POST" ? await readBody(request) : undefined;
      const aborted = new AbortController();
      response.once("close", () => { if (!response.writableEnded) aborted.abort(); });
      const webRequest = new Request(url, { method, headers, signal: aborted.signal, ...(body ? { body } : {}) });
      let result: Response;
      if(telegramWebhook && options.telegram?.config){
        result=await handleTelegramWebhook(webRequest,options.telegram.store,options.telegram.gateway,options.telegram.config.botId);
      } else if (url.pathname.startsWith("/api/auth/")) {
        result = await options.auth.handler(webRequest);
        if (result.status >= 500) {
          await result.body?.cancel();
          result = apiError("service_unavailable", "服務暫時未能處理，請稍後重試。", 503);
        }
      } else if (url.pathname === "/api/health" && method === "GET") {
        await options.checkDatabase();
        result = jsonResponse({ status: "ok" });
      } else if (["/api/ai/status", "/api/ai/usage"].includes(url.pathname) && method === "GET") {
        const sessionResult = await options.auth.api.getSession({ headers, returnHeaders: true });
        result = sessionResult.response?.user.id
          ? url.pathname.endsWith("/usage") && options.aiUsage
            ? jsonResponse(await options.aiUsage.getForUser(sessionResult.response.user.id))
            : jsonResponse({ available: options.modelGateway?.available() ?? false })
          : apiError("unauthorized", "請先登入。", 401);
        for (const cookie of sessionResult.headers.getSetCookie()) result.headers.append("set-cookie", cookie);
      } else if (url.pathname === "/api/workspaces" || url.pathname.startsWith("/api/workspaces/")
        || url.pathname === "/api/children" || url.pathname.startsWith("/api/children/")
        || url.pathname === "/api/families" || url.pathname.startsWith("/api/families/") || url.pathname === "/api/notification-preferences"
        || url.pathname.startsWith("/api/online/") || url.pathname === "/api/web-push" || url.pathname.startsWith("/api/web-push/")
        || url.pathname === "/api/telegram" || url.pathname.startsWith("/api/telegram/")) {
        const sessionResult = await options.auth.api.getSession({ headers, returnHeaders: true });
        const userId = sessionResult.response?.user.id ?? null;
        result = (url.pathname==="/api/telegram" || url.pathname.startsWith("/api/telegram/")) && options.telegram
          ? await handleTelegramRequest(webRequest,userId,options.telegram.store)
          : /^\/api\/children\/[^/]+\/growth(\/|$)/u.test(url.pathname) && options.growth
          ? await handleGrowthRequest(webRequest,userId,options.growth,async expected => (await options.auth.api.getSession({ headers }))?.user.id === expected)
          : options.productAgent && options.productAgentStore && options.chat
          && (/^\/api\/children\/[^/]+\/agent\//u.test(url.pathname) || /^\/api\/children\/[^/]+\/messages\/[^/]+\/reply$/u.test(url.pathname))
          ? await handleProductAgentRequest(webRequest, userId, { agent: options.productAgent, store: options.productAgentStore, chat: options.chat,
            isCurrentUser: async expected => (await options.auth.api.getSession({ headers }))?.user.id === expected })
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
            isCurrentUser: async expectedId => (await options.auth.api.getSession({ headers }))?.user.id === expectedId,
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
      } else {
        await writeResponse(apiError("service_unavailable", "服務暫時未能處理，請稍後重試。", 503), response, permittedOrigin);
      }
    }
  };
}
