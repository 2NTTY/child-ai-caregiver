import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ServerAuthPort } from './auth-port.ts';

const MAX_BODY_BYTES = 64 * 1024;
class BodyTooLarge extends Error {}
function readBody(request: IncomingMessage): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let bytes = 0;
    const cleanup = () => {
      request.off('data', data); request.off('end', end);
      request.off('error', error); request.off('aborted', aborted);
    };
    const data = (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) { cleanup(); request.resume(); reject(new BodyTooLarge()); }
      else chunks.push(chunk);
    };
    const end = () => { cleanup(); resolve(new Uint8Array(Buffer.concat(chunks))); };
    const error = () => { cleanup(); reject(new Error('request_unavailable')); };
    const aborted = () => { cleanup(); reject(new Error('request_aborted')); };
    request.on('data', data); request.once('end', end); request.once('error', error); request.once('aborted', aborted);
  });
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
  publicOrigin: string; auth: Pick<ServerAuthPort, 'fromNodeHeaders'>; handler(request: Request): Promise<Response>;
}) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const controller = new AbortController();
    response.once('close', () => { if (!response.writableEnded) controller.abort(); });
    try {
      const method = request.method ?? 'GET', path = request.url ?? '/';
      if (!path.startsWith('/') || path.startsWith('//')) { await write(failure('invalid_request_target', 400), response); return; }
      if (method !== 'GET' && method !== 'POST') { await write(failure('method_not_allowed', 405), response); return; }
      const headers = options.auth.fromNodeHeaders(request.headers);
      const length = headers.get('content-length');
      if (length !== null && (!/^\d+$/u.test(length) || Number(length) > MAX_BODY_BYTES)) throw new BodyTooLarge();
      if (method === 'POST' && headers.get('origin') !== options.publicOrigin) {
        await write(failure('origin_rejected', 403), response); return;
      }
      const body = method === 'POST' ? await readBody(request) : undefined;
      const incoming = new Request(new URL(path, options.publicOrigin), { method, headers, signal: controller.signal,
        ...(body?.length ? { body: body as Uint8Array<ArrayBuffer> } : {}) });
      await write(await options.handler(incoming), response);
    } catch (error) {
      if (!response.headersSent && !response.destroyed) await write(failure(error instanceof BodyTooLarge ? 'body_too_large' : 'service_unavailable', error instanceof BodyTooLarge ? 413 : 503), response);
      else response.destroy();
    } finally { request.resume(); }
  };
}
