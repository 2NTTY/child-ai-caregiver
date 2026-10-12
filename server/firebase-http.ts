import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ServerAuthPort } from './auth-port.ts';
import type { TelegramConfig } from './telegram-types.ts';
import { telegramWebhookAuthorized } from './telegram-config.ts';

const MAX_BODY_BYTES = 64 * 1024, MAX_PHOTO_BODY_BYTES = 6 * 1024 * 1024, MAX_DOCUMENT_BODY_BYTES = 2 * 1024 * 1024;
const UUID_PATH = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const photoContent = new RegExp('^/api/children/' + UUID_PATH + '/photos/' + UUID_PATH + '/content$', 'i');
const documentWrite = new RegExp('^/api/children/' + UUID_PATH + '/documents(?:/' + UUID_PATH + '/actions)?$', 'i');
class BodyTooLarge extends Error {}
function readBody(request: IncomingMessage, maximum: number, signal: AbortSignal): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let bytes = 0;
    const cleanup = () => {
      request.off('data', data); request.off('end', end);
      request.off('error', error); request.off('aborted', aborted); request.off('close', closed);
      signal.removeEventListener('abort', aborted);
    };
    const data = (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maximum) { cleanup(); request.resume(); reject(new BodyTooLarge()); }
      else chunks.push(chunk);
    };
    const end = () => { cleanup(); resolve(new Uint8Array(Buffer.concat(chunks))); };
    const error = () => { cleanup(); reject(new Error('request_unavailable')); };
    const aborted = () => { cleanup(); reject(new Error('request_aborted')); };
    const closed = () => { if (!request.complete) aborted(); };
    if (signal.aborted || request.aborted || request.destroyed) { aborted(); return; }
    signal.addEventListener('abort', aborted, { once: true });
    request.on('data', data); request.once('end', end); request.once('error', error); request.once('aborted', aborted); request.once('close', closed);
  });
}
async function waitWhileConnected<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  let aborted: () => void = () => {};
  try {
    return await Promise.race([pending, new Promise<never>((_resolve, reject) => {
      aborted = () => reject(new Error('request_aborted'));
      if (signal.aborted) aborted(); else signal.addEventListener('abort', aborted, { once: true });
    })]);
  } finally { signal.removeEventListener('abort', aborted); }
}
async function write(response: Response, target: ServerResponse) {
  target.statusCode = response.status;
  response.headers.forEach((value, key) => { if (key !== 'set-cookie') target.setHeader(key, value); });
  const cookies = response.headers.getSetCookie(); if (cookies.length) target.setHeader('set-cookie', cookies);
  target.setHeader('cache-control', 'private, no-store'); target.setHeader('x-content-type-options', 'nosniff');
  target.end(Buffer.from(await response.arrayBuffer()));
}
const failure = (code: string, status: number) => Response.json({ code }, { status });

/** Bounded same-origin Node transport. Business handlers recheck identity and authority. */
export function createFirebaseNodeHandler(options: {
  publicOrigin: string; auth: Pick<ServerAuthPort, 'fromNodeHeaders'> & {
    getSession?(options: { headers: Headers }): Promise<{ user: { id: string } } | null>;
  }; handler(request: Request): Promise<Response>; telegramConfig?: TelegramConfig | null;
}) {
  let activeLargeBodies = 0;
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const controller = new AbortController(); let holdsLargeBody = false;
    response.once('close', () => { if (!response.writableEnded) controller.abort(); });
    try {
      const method = request.method ?? 'GET', path = request.url ?? '/';
      if (!path.startsWith('/') || path.startsWith('//')) { await write(failure('invalid_request_target', 400), response); return; }
      if (method !== 'GET' && method !== 'POST') { await write(failure('method_not_allowed', 405), response); return; }
      const headers = options.auth.fromNodeHeaders(request.headers);
      const pathname = new URL(path, options.publicOrigin).pathname;
      const webhook = pathname === '/api/telegram/webhook';
      if (webhook && (method !== 'POST' || !telegramWebhookAuthorized(headers.get('x-telegram-bot-api-secret-token'), options.telegramConfig ?? null))) {
        await write(failure('forbidden', 403), response); return;
      }
      const maximum = method === 'POST' && photoContent.test(pathname) ? MAX_PHOTO_BODY_BYTES
        : method === 'POST' && documentWrite.test(pathname) ? MAX_DOCUMENT_BODY_BYTES : MAX_BODY_BYTES;
      const length = headers.get('content-length');
      if (length !== null && (!/^\d+$/u.test(length) || Number(length) > maximum)) throw new BodyTooLarge();
      if (method === 'POST' && !webhook && headers.get('origin') !== options.publicOrigin) {
        await write(failure('origin_rejected', 403), response); return;
      }
      if (maximum > MAX_BODY_BYTES) {
        if (activeLargeBodies >= 2) { await write(failure('request_capacity', 429), response); return; }
        activeLargeBodies++; holdsLargeBody = true;
        const session = await waitWhileConnected(Promise.resolve(options.auth.getSession?.({ headers })), controller.signal);
        if (controller.signal.aborted || request.aborted || request.destroyed) throw new Error('request_aborted');
        if (!session) { await write(failure('unauthorized', 401), response); return; }
        const expected = headers.get('x-expected-user-id');
        if (!expected || expected !== session.user.id) {
          await write(failure(expected ? 'identity_changed' : 'account_precondition_required', expected ? 409 : 428), response); return;
        }
      }
      const body = method === 'POST' ? await readBody(request, maximum, controller.signal) : undefined;
      const incoming = new Request(new URL(path, options.publicOrigin), { method, headers, signal: controller.signal,
        ...(body?.length ? { body: body as Uint8Array<ArrayBuffer> } : {}) });
      await write(await options.handler(incoming), response);
    } catch (error) {
      if (!response.headersSent && !response.destroyed) await write(failure(error instanceof BodyTooLarge ? 'body_too_large' : 'service_unavailable', error instanceof BodyTooLarge ? 413 : 503), response);
      else response.destroy();
    } finally { if (holdsLargeBody) activeLargeBodies--; request.resume(); }
  };
}
