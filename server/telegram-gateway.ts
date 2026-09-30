import { request } from "node:https";
import type { ClientRequest, IncomingMessage } from "node:http";
import { Api, GrammyError } from "grammy";
import type { ApiClientOptions } from "grammy";
import type { TelegramConfig, TelegramGateway, TelegramSendResult } from "./telegram-types.ts";

const REQUEST_LIMIT = 8 * 1024;
const RESPONSE_LIMIT = 32 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const SEND_TIMEOUT_MS = 15_000;
const TEST_MESSAGE = "育伴港渠道測試：這是你剛才確認發送的一般測試，沒有孩子資料。按下『收到測試』只記錄收到，不代表照護事項完成。";
const ACK_MESSAGE = "已記錄收到；不代表完成照護事項。";
const BLOCKED_DESCRIPTION = "Forbidden: bot was blocked by the user";

type SdkFetch = NonNullable<ApiClientOptions["fetch"]>;
type SdkSignal = NonNullable<Parameters<Api["sendMessage"]>[3]>;
export type TelegramTransport = (input: { url: string; body: string; signal: AbortSignal }) => Promise<Response>;

function transportError() { return new Error("telegram_transport_unavailable"); }
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function result(status: TelegramSendResult["status"], reason: TelegramSendResult["reason"], providerStatus: number | null = null, messageId: number | null = null): TelegramSendResult {
  return { status, reason, providerStatus, messageId };
}
function deadline(signal: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const timer = setTimeout(abort, SEND_TIMEOUT_MS);
  return {
    signal: controller.signal,
    close() { clearTimeout(timer); signal.removeEventListener("abort", abort); },
  };
}
async function bounded<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      abort = () => reject(transportError());
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    })]);
  } finally {
    if (abort) signal.removeEventListener("abort", abort);
  }
}

const httpsTransport: TelegramTransport = async ({ url, body, signal }) => {
  let endpoint: URL;
  try { endpoint = new URL(url); } catch { throw transportError(); }
  if (endpoint.protocol !== "https:" || endpoint.hostname !== "api.telegram.org"
    || (endpoint.port !== "" && endpoint.port !== "443") || endpoint.username || endpoint.password
    || endpoint.search || endpoint.hash || Buffer.byteLength(body) > REQUEST_LIMIT || signal.aborted) throw transportError();
  return new Promise<Response>((resolve, reject) => {
    let settled = false;
    let outgoing: ClientRequest | undefined;
    let incoming: IncomingMessage | undefined;
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", fail); };
    const fail = () => {
      if (settled) return;
      settled = true; cleanup(); outgoing?.destroy(); incoming?.destroy(); reject(transportError());
    };
    const timer = setTimeout(fail, REQUEST_TIMEOUT_MS);
    signal.addEventListener("abort", fail, { once: true });
    if (signal.aborted) { fail(); return; }
    try {
      outgoing = request({
        hostname: "api.telegram.org", port: 443, path: endpoint.pathname, method: "POST", agent: false,
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body), connection: "close", accept: "application/json" },
      }, response => {
        incoming = response;
        response.on("error", fail);
        response.on("aborted", fail);
        const status = response.statusCode;
        const length = response.headers["content-length"];
        if (status === undefined || status < 200 || status >= 600 || (status >= 300 && status < 400)
          || (length !== undefined && (!/^[0-9]+$/u.test(length) || Number(length) > RESPONSE_LIMIT))) { fail(); return; }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          if (settled) return;
          size += chunk.length;
          if (size > RESPONSE_LIMIT) { fail(); return; }
          chunks.push(chunk);
        });
        response.on("end", () => {
          if (settled) return;
          try {
            const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
            const reply = new Response(text, { status });
            settled = true; cleanup(); resolve(reply);
          } catch { fail(); }
        });
      });
      outgoing.on("error", fail);
      outgoing.end(body);
    } catch { fail(); }
  });
};

function apiFor(config: TelegramConfig, transport: TelegramTransport, state: { attempted: boolean; providerStatus: number | null }) {
  const fetch: SdkFetch = async (...[url, options]: Parameters<SdkFetch>) => {
    if (typeof url !== "string" || options?.method !== "POST" || typeof options.body !== "string" || !options.signal
      || Buffer.byteLength(options.body) > REQUEST_LIMIT || options.signal.aborted
      || !["sendMessage", "answerCallbackQuery"].some(method => url === "https://api.telegram.org/bot" + config.token + "/" + method)) throw transportError();
    // grammY's Node fetch shim uses the same abort listener contract as the native signal.
    const signal = options.signal as unknown as AbortSignal;
    state.attempted = true;
    const response = await transport({ url, body: options.body, signal });
    state.providerStatus = response.status;
    if (signal.aborted || (response.status >= 300 && response.status < 400)) throw transportError();
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > RESPONSE_LIMIT) throw transportError();
    let value: unknown;
    try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { throw transportError(); }
    if (!record(value) || typeof value.ok !== "boolean"
      || (value.ok && (!response.ok || !Object.hasOwn(value, "result")))
      || (!value.ok && (!Number.isSafeInteger(value.error_code) || Number(value.error_code) < 400 || Number(value.error_code) >= 600 || typeof value.description !== "string"))) throw transportError();
    // Only the Node Response/node-fetch response type boundary needs a shim cast.
    return new Response(JSON.stringify(value), { status: response.status }) as unknown as Awaited<ReturnType<SdkFetch>>;
  };
  return new Api(config.token, { apiRoot: "https://api.telegram.org", timeoutSeconds: 10, canUseWebhookReply: () => false, sensitiveLogs: false, fetch });
}

export function createTelegramGateway(config: TelegramConfig | null, transport: TelegramTransport = httpsTransport): TelegramGateway {
  return {
    async send(input, signal, stillAuthorized) {
      if (!config) return result("stopped", "configuration_unavailable");
      const scope = deadline(signal);
      const state = { attempted: false, providerStatus: null as number | null };
      try {
        if (scope.signal.aborted) return result("stopped", "worker_interrupted");
        if (!Number.isSafeInteger(input.chatId) || input.chatId <= 0 || !/^[A-Za-z0-9_-]{32}$/u.test(input.callbackToken)) return result("rejected", "provider_rejected");
        if (!await bounded(stillAuthorized(), scope.signal)) return result("stopped", "revoked");
        if (scope.signal.aborted) return result("stopped", "worker_interrupted");
        const api = apiFor(config, transport, state);
        const reply: unknown = await bounded(api.sendMessage(input.chatId, TEST_MESSAGE, {
          link_preview_options: { is_disabled: true }, protect_content: true,
          reply_markup: { inline_keyboard: [[{ text: "收到測試", callback_data: "ack:" + input.callbackToken }]] },
        }, scope.signal as unknown as SdkSignal), scope.signal);
        if (scope.signal.aborted || !record(reply) || !record(reply.chat) || reply.chat.id !== input.chatId
          || !Number.isSafeInteger(reply.message_id) || Number(reply.message_id) <= 0) return result("unknown", "transport_unknown", state.providerStatus);
        return result("accepted", null, state.providerStatus, Number(reply.message_id));
      } catch (error) {
        if (!state.attempted) return result("stopped", scope.signal.aborted ? "worker_interrupted" : "revoked");
        if (!scope.signal.aborted && error instanceof GrammyError) {
          const reason = error.error_code === 429 ? "rate_limited"
            : error.error_code === 403 && error.description === BLOCKED_DESCRIPTION ? "blocked" : "provider_rejected";
          return result("rejected", reason, error.error_code);
        }
        return result("unknown", "transport_unknown", state.providerStatus);
      } finally { scope.close(); }
    },
    async acknowledge(callbackQueryId, signal) {
      if (!config || !callbackQueryId || callbackQueryId.length > 256) throw new Error("telegram_acknowledgement_unavailable");
      const scope = deadline(signal);
      try {
        if (scope.signal.aborted) throw transportError();
        const api = apiFor(config, transport, { attempted: false, providerStatus: null });
        const reply: unknown = await bounded(api.answerCallbackQuery(callbackQueryId, { text: ACK_MESSAGE }, scope.signal as unknown as SdkSignal), scope.signal);
        if (reply !== true || scope.signal.aborted) throw transportError();
      } catch { throw new Error("telegram_acknowledgement_unavailable"); }
      finally { scope.close(); }
    },
  };
}
