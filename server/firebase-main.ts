import { createServer } from 'node:http';
import { openFirebaseRuntime } from './firebase-runtime.ts';
import { createFirebaseNodeHandler } from './firebase-http.ts';

const runtime = await openFirebaseRuntime(process.env);
const handler = createFirebaseNodeHandler({ publicOrigin: runtime.config.publicOrigin, auth: runtime.auth, handler: runtime.handler });
const server = createServer((request, response) => {
  request.on('error', () => {});
  void handler(request, response).catch(() => { response.destroy(); });
});
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.maxHeadersCount = 100;
server.on('error', () => { console.error('server_start_failed'); void runtime.close().catch(() => {}); process.exitCode = 1; });
server.listen(runtime.config.port, runtime.config.host, () => { console.info('firebase_server_started'); });
let stopping = false;
const stop = () => {
  if (stopping) return; stopping = true;
  const deadline = setTimeout(() => server.closeAllConnections(), 5000).unref();
  server.close(() => { clearTimeout(deadline); void runtime.close().catch(() => { process.exitCode = 1; }); });
};
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
