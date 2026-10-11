import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';
import { openFirebaseWorkerRuntime } from './firebase-worker-runtime.ts';

const MAX_BODY = 4096;
class WorkerBodyTooLarge extends Error {}
function readBody(request: IncomingMessage): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let bytes = 0;
    const cleanup = () => { request.off('data', data); request.off('end', end); request.off('error', failed); request.off('aborted', failed); };
    const data = (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY) { cleanup(); request.resume(); reject(new WorkerBodyTooLarge()); } else chunks.push(chunk);
    };
    const end = () => { cleanup(); resolve(new Uint8Array(Buffer.concat(chunks))); };
    const failed = () => { cleanup(); reject(new Error('Worker request unavailable')); };
    request.on('data', data); request.once('end', end); request.once('error', failed); request.once('aborted', failed);
  });
}
async function write(response: Response, target: ServerResponse) {
  target.statusCode = response.status;
  response.headers.forEach((value, key) => target.setHeader(key, value));
  target.setHeader('Cache-Control', 'no-store'); target.setHeader('X-Content-Type-Options', 'nosniff');
  target.end(Buffer.from(await response.arrayBuffer()));
}
const rejected = (status: number) => Response.json({ state: 'rejected' }, { status });
/** OIDC transport has no browser Origin requirement and accepts only the two fixed POST paths. */
export function createFirebaseWorkerNodeHandler(options: { workerOrigin: string; handler(request: Request): Promise<Response> }) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    try {
      const method = request.method ?? '', path = request.url ?? '';
      if (method !== 'POST') { await write(rejected(405), response); return; }
      if (!['/internal/task-reminders', '/internal/task-dispatch'].includes(path)) { await write(rejected(404), response); return; }
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers)) {
        if (Array.isArray(value)) for (const part of value) headers.append(name, part); else if (value !== undefined) headers.set(name, value);
      }
      const length = headers.get('content-length');
      if (length !== null && (!/^[0-9]+$/u.test(length) || Number(length) > MAX_BODY)) throw new WorkerBodyTooLarge();
      const body = await readBody(request);
      const incoming = new Request(new URL(path, options.workerOrigin), { method, headers, body: body as Uint8Array<ArrayBuffer> });
      await write(await options.handler(incoming), response);
    } catch (error) {
      if (!response.headersSent && !response.destroyed) await write(Response.json({ state: 'unavailable' }, { status: error instanceof WorkerBodyTooLarge ? 413 : 503 }), response);
      else response.destroy();
    } finally { request.resume(); }
  };
}

async function main() {
  const runtime = await openFirebaseWorkerRuntime(process.env);
  const handler = createFirebaseWorkerNodeHandler({ workerOrigin: runtime.workerConfig.workerOrigin, handler: runtime.handler });
  const server = createServer((request, response) => { request.on('error', () => {}); void handler(request, response).catch(() => response.destroy()); });
  server.requestTimeout = 15000; server.headersTimeout = 10000; server.maxHeadersCount = 100;
  let stopping: Promise<void> | undefined;
  const stop = () => stopping ??= (async () => {
    const deadline = setTimeout(() => server.closeAllConnections(), 20_000).unref();
    try { await new Promise<void>(resolve => server.close(() => resolve())); } finally { clearTimeout(deadline); await runtime.close(); }
  })();
  const shutdown = () => { void stop().catch(() => { console.error('firebase_worker_stop_failed'); process.exitCode = 1; }); };
  server.on('error', () => { console.error('firebase_worker_start_failed'); process.exitCode = 1; shutdown(); });
  server.listen(runtime.config.port, runtime.config.host, () => console.info('firebase_worker_started'));
  process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch(() => { console.error('firebase_worker_start_failed'); process.exitCode = 1; });
}
