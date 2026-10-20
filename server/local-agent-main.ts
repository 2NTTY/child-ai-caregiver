import { createServer, request as proxyRequest } from 'node:http';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { assertLocalAgentEnvironment } from './local-agent-config.ts';
import { createLocalAgentBuckets } from './local-agent-storage.ts';
import { createLocalAgentWorker } from './local-agent-worker.ts';
import { createLocalAgentDelivery } from './local-agent-delivery.ts';
import { openFirebaseRuntime } from './firebase-runtime.ts';
import { createFirebaseNodeHandler } from './firebase-http.ts';
import { createGeminiKeyProviders } from './gemini-key-provider.ts';
import { readAiConfig } from './ai-config.ts';
import { FirestoreAuthorityError } from './firestore-authority.ts';
import type { AgentDiagnostic } from './agent-observer.ts';

const config = assertLocalAgentEnvironment(process.env);
const state = JSON.parse(await readFile(process.env.LOCAL_AGENT_STATE_FILE!, 'utf8'));
if (state.projectId !== config.projectId || state.storageKey !== process.env.YUBAN_FIREBASE_STORAGE_KEY) throw Error('Local state binding mismatch');
const provider = process.env.LOCAL_MODEL_PROVIDER;
if (provider !== 'gemini' && provider !== 'vertex' && provider !== 'vertex-adc') throw Error('Unknown local model provider');
if (process.env.AI_ENABLED === 'true' && (provider === 'vertex-adc' ? !process.env.LOCAL_MODEL_PROJECT : !process.env.LOCAL_MODEL_API_KEY)) throw Error('Local model credentials missing');
const modelConfig = readAiConfig({ ...process.env, GCP_PROJECT_ID: provider === 'vertex-adc' ? process.env.LOCAL_MODEL_PROJECT : config.projectId });
const events: AgentDiagnostic[] = [];
let delivery: ReturnType<typeof createLocalAgentDelivery>;
const runtime = await openFirebaseRuntime(process.env, { worker: true, local: {
  bucket: createLocalAgentBuckets(process.env), modelConfig,
  deliveries(domain) { delivery = createLocalAgentDelivery(domain, process.env); return delivery.adapters; },
  async bootstrapAccount(auth) {
    // Explicit synthetic account, not a first-user grant. Product admission and
    // recent reauthentication still use the production session and admin services.
    try { return (await auth.getUserByEmail(state.email)).uid; }
    catch (error) {
      if ((error as { code?: string }).code !== 'auth/user-not-found') throw error;
      return (await auth.createUser({ email: state.email, password: state.password, emailVerified: true, displayName: '本地開發帳號' })).uid;
    }
  },
  ...(provider !== 'vertex-adc' && modelConfig.enabled ? { providers: selected => createGeminiKeyProviders(selected, process.env.LOCAL_MODEL_API_KEY!, provider) } : {}),
  diagnostics(event) { events.push(event); if (events.length > 200) events.shift(); },
} });
try { await runtime.authority.readControl(); }
catch (error) {
  if (!(error instanceof FirestoreAuthorityError) || error.code !== 'not_found') throw error;
  await runtime.authority.initializeControl({ generation: state.generation, enabled: true });
}
const invitation = await runtime.database.runTransaction(tx => runtime.authority.readAdminInvitation(tx, state.email), { readOnly: true });
if (!invitation) await runtime.authority.issueInvitation({ email: state.email, ...state.invitation });
const git = (args: string[]) => { try { return execFileSync('git', args, { encoding: 'utf8', windowsHide: true }).trim(); } catch { return 'unknown'; } };
const manifest = JSON.parse(await readFile(new URL('../prompts/manifest.json', import.meta.url), 'utf8'));
const status = { mode: 'local-development', project: config.projectId, branch: git(['branch', '--show-current']), sha: git(['rev-parse', '--short', 'HEAD']),
  dirty: Boolean(git(['status', '--porcelain', '--untracked-files=no'])),
  model: modelConfig.model, provider, promptPack: manifest.version, enabled: modelConfig.enabled,
  roles: { chat: 'production-runtime', review: 'production-runtime', compose: 'production-family-document-patch', knowledgeMaintenance: 'explicit-local-maintenance-command' },
  externalDelivery: 'local-inbox-not-sent', email: 'emulator-inbox-not-sent', knowledge: 'one-reviewed-section-after-explicit-preparation', snapshots: 'periodic-and-graceful-stop' };
const api = createFirebaseNodeHandler({ publicOrigin: config.publicOrigin, auth: runtime.auth, handler: runtime.handler, telegramConfig: null });
const worker = createLocalAgentWorker(runtime, process.env);
// Disabling paid models must not stop attachment cleanup or other deterministic work.
worker.start();
const webPort = Number(process.env.LOCAL_WEB_PORT);
if (!Number.isInteger(webPort) || webPort < 1024 || webPort > 65535) throw Error('Invalid local Web port');
const expectedHost = new URL(config.publicOrigin).host;
const server = createServer((request, response) => {
  request.on('error', () => {});
  if (request.headers.host !== expectedHost || request.headers.origin && request.headers.origin !== config.publicOrigin) {
    response.writeHead(403); response.end(); return;
  }
  const path = new URL(request.url ?? '/', config.publicOrigin).pathname;
  if (path === '/__local/telegram/start') {
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('Referrer-Policy', 'no-referrer');
    if (request.method === 'GET') {
      const token = new URL(request.url!, config.publicOrigin).searchParams.get('token') ?? '';
      if (!/^[A-Za-z0-9_-]{32}$/u.test(token)) { response.writeHead(400); response.end('Invalid local challenge'); return; }
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; form-action 'self'; frame-ancestors 'none'" });
      response.end('<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><title>本地 Telegram 收件箱</title><h1>只連接本機測試帳號</h1>'
        + '<p>不會連接 Telegram 或發送訊息。開始後請回育有方重新讀取，並確認顯示的本地帳號。</p>'
        + '<form method="post"><input type="hidden" name="token" value="' + token
        + '"><button type="submit">模擬開始（只限本機）</button></form></html>'); return;
    }
    if (request.method !== 'POST') { response.writeHead(405); response.end(); return; }
    if (request.headers.origin !== config.publicOrigin) { response.writeHead(403); response.end(); return; }
    void (async () => {
      let size = 0; const pieces: Buffer[] = [];
      for await (const piece of request) {
        size += piece.length; if (size > 256) throw Error('Local request too large');
        pieces.push(Buffer.from(piece));
      }
      const form = new URLSearchParams(Buffer.concat(pieces).toString('utf8'));
      if ([...form.keys()].length !== 1) throw Error('Invalid local request');
      const outcome = await runtime.telegram.webhook(delivery.syntheticTelegramStart(form.get('token') ?? ''));
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ mode: 'local-only', outcome,
        instruction: '請回育有方重新讀取並確認本地測試帳號；此操作沒有發送訊息。' }));
    })().catch(() => { if (!response.headersSent) response.writeHead(400); response.end('Local challenge unavailable'); });
    return;
  }
  if (path === '/__local/inbox') {
    if (request.method !== 'GET') { response.writeHead(405); response.end(); return; }
    void fetch('http://' + process.env.FIREBASE_AUTH_EMULATOR_HOST + '/emulator/v1/projects/' + config.projectId + '/oobCodes',
      { signal: AbortSignal.timeout(3000), redirect: 'error' }).then(async result => {
        if (!result.ok) throw Error('Local inbox unavailable');
        const value = await result.json() as { oobCodes?: { email?: string; requestType?: string; oobLink?: string }[] };
        const messages = (value.oobCodes ?? []).slice(-20).map(item => ({ email: item.email, type: item.requestType,
          link: item.oobLink, delivery: 'local-only-not-sent' }));
        const captured = await delivery.list();
        response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify({ messages, truncated: (value.oobCodes?.length ?? 0) > 20, ...captured }));
      }).catch(() => { response.writeHead(503); response.end('Local inbox unavailable'); });
    return;
  }
  if (path === '/__local/status' || path === '/__local/events') {
    if (request.method !== 'GET') { response.writeHead(405); response.end(); return; }
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    if (path.endsWith('/events')) response.end(JSON.stringify({ events }));
    else void readFile(new URL('../prompts/manifest.json', import.meta.url), 'utf8')
      .then(value => response.end(JSON.stringify({ ...status, promptPack: JSON.parse(value).version })))
      .catch(() => response.end(JSON.stringify({ ...status, promptPack: 'invalid' })));
    return;
  }
  if (path === '/healthz' || path.startsWith('/api/')) {
    void api(request, response).catch(() => response.destroy()); return;
  }
  // Preserve streaming and HMR; the application and API have one browser origin.
  const upstream = proxyRequest({ host: 'localhost', port: webPort, method: request.method, path: request.url, headers: request.headers }, result => {
    response.writeHead(result.statusCode ?? 502, result.headers); result.pipe(response);
  });
  upstream.on('error', () => { if (!response.headersSent) response.writeHead(503); response.end('Local Web is starting. Refresh shortly.'); });
  response.once('close', () => upstream.destroy()); request.pipe(upstream);
});
server.on('upgrade', (request, socket, head) => {
  if (request.headers.host !== expectedHost || request.headers.origin && request.headers.origin !== config.publicOrigin) { socket.destroy(); return; }
  const upstream = proxyRequest({ host: 'localhost', port: webPort, path: request.url, headers: request.headers });
  upstream.on('upgrade', (result, peer, buffered) => {
    socket.write('HTTP/1.1 101 Switching Protocols\r\n' + Object.entries(result.headers).map(([key, value]) => key + ': ' + value).join('\r\n') + '\r\n\r\n');
    if (buffered.length) socket.write(buffered); if (head.length) peer.write(head);
    peer.on('error', () => socket.destroy()); socket.on('error', () => peer.destroy());
    peer.pipe(socket); socket.pipe(peer); socket.once('close', () => peer.destroy());
  });
  upstream.on('error', () => socket.destroy()); upstream.end();
});
server.requestTimeout = 15000; server.headersTimeout = 10000;
server.listen(config.port, config.host, () => console.log('local_agent_ready ' + JSON.stringify(status)));
let closing = false;
const stop = () => {
  if (closing) return; closing = true;
  const deadline = setTimeout(() => server.closeAllConnections(), 5000).unref();
  server.close(() => { clearTimeout(deadline); void worker.close().then(() => runtime.close()).catch(() => { process.exitCode = 1; }); });
};
process.once('SIGINT', stop); process.once('SIGTERM', stop);
