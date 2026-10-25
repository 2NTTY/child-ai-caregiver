import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { access, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { M03_INITIAL_WATCH_IDS } from '../src/shared/background-knowledge-maintenance.ts';
import { readLocalAgentModel } from '../server/local-agent-model.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = join(root, '.cache', 'agent-local'), statePath = join(directory, 'state.json');
const args = new Set(process.argv.slice(2));
const inspectionArgs = [...args].filter(arg => arg === '--inspect-knowledge' || /^--inspect-knowledge=[a-f0-9]{64}$/u.test(arg));
const inspection = inspectionArgs.length === 1;
if (inspectionArgs.length > 1) throw Error('Choose one knowledge work to inspect');
if ([...args].some(arg => !['--reset', '--confirm-local-reset', '--no-web', '--no-model', '--no-watch', '--prepare-knowledge',
  '--maintain-knowledge', '--live-source', '--new-knowledge-work', '--knowledge-watch=fhs-solid-food', '--knowledge-watch=fhs-feeding-booklet-en', '--help'].includes(arg)
  && !inspectionArgs.includes(arg))) throw Error('Unknown local Agent option');
if (inspection && ['--reset', '--prepare-knowledge', '--maintain-knowledge'].some(arg => args.has(arg)))
  throw Error('Knowledge inspection cannot reset data, prepare or start maintenance');
if (!args.has('--maintain-knowledge') && [...args].some(arg => arg === '--live-source' || arg === '--new-knowledge-work' || arg.startsWith('--knowledge-watch=')))
  throw Error('Knowledge work options require --maintain-knowledge');
if (args.has('--maintain-knowledge') && args.has('--prepare-knowledge')) throw Error('Choose preparation or maintenance, not both');
if (args.has('--help')) {
  console.log('agent:local [--no-web] [--no-model] [--no-watch]\nSet GEMINI_API_KEY or LOCAL_AGENT_CONFIG (protected JSON). ADC: LOCAL_MODEL_PROVIDER=vertex-adc, LOCAL_MODEL_PROJECT.\nFirst knowledge preparation: --prepare-knowledge (at most one paid embedding; later starts reuse it).\nIndependent maintenance: --maintain-knowledge [--knowledge-watch=fhs-solid-food|fhs-feeding-booklet-en] [--live-source] [--new-knowledge-work]. Default: curated fixture; original work ID reused.\nInspect saved work without a model or credentials: --inspect-knowledge[=<operation-fingerprint>].\nReset only this worktree: --reset --confirm-local-reset');
  process.exit(0);
}
const exists = async path => { try { await access(path); return true; } catch { return false; } };
if (inspection && !await exists(statePath)) throw Error('No local data to inspect; initialize the local environment first');
await mkdir(directory, { recursive: true, mode: 0o700 });
if (process.platform === 'win32') {
  const owner = spawnSync('whoami', [], { encoding: 'utf8', windowsHide: true });
  if (owner.status !== 0 || !owner.stdout.trim()) throw Error('Cannot determine local data owner');
  const protectedDirectory = spawnSync('icacls', [directory, '/inheritance:r', '/grant:r', owner.stdout.trim() + ':(OI)(CI)F'], { windowsHide: true, stdio: 'ignore' });
  if (protectedDirectory.status !== 0) throw Error('Cannot protect local data directory');
}
// An OS-owned listener prevents two runtimes from sharing the emulator object adapter.
const fingerprint = createHash('sha256').update(root).digest('hex').slice(0, 8);
const basePort = 17000 + parseInt(fingerprint.slice(0, 4), 16) % 2500 * 10;
const singleton = createServer();
await new Promise((done, reject) => { singleton.once('error', reject); singleton.listen(basePort + 9, '127.0.0.1', done); });
if (args.has('--reset')) {
  if (!args.has('--confirm-local-reset')) throw Error('Reset requires --confirm-local-reset; no data was removed');
  // directory is a fixed child of this checkout, never a config-supplied path.
  for (const item of ['state.json', 'export', 'export-next', 'export-previous']) await rm(join(directory, item), { recursive: true, force: true });
  console.log('Removed only this worktree local data. Model credential files were preserved.');
  singleton.close(); process.exit(0);
}
for (let offset = 0; offset < 8; offset++) {
  const probe = createServer();
  await new Promise((done, reject) => { probe.once('error', reject); probe.listen(basePort + offset, '127.0.0.1', done); });
  await new Promise(done => probe.close(done));
}
const saved = await exists(statePath) ? JSON.parse(await readFile(statePath, 'utf8')) : {
  format: 1, projectId: 'demo-yuyf-' + fingerprint, storageKey: randomBytes(32).toString('base64'),
  generation: randomUUID(), email: 'developer@local.yuyoufang.test', password: randomBytes(18).toString('base64url'),
  invitation: { operationId: randomUUID(), expiresAt: new Date(Date.now() + 365 * 86400000).toISOString() },
};
if (saved.format !== 1 || saved.projectId !== 'demo-yuyf-' + fingerprint) throw Error('Local state belongs to another checkout');
if (!await exists(statePath)) await writeFile(statePath, JSON.stringify(saved, null, 2), { mode: 0o600, flag: 'wx' });
const configured = !inspection && process.env.LOCAL_AGENT_CONFIG ? JSON.parse(await readFile(resolve(process.env.LOCAL_AGENT_CONFIG), 'utf8')) : {};
const provider = inspection ? 'gemini' : configured.provider ?? process.env.LOCAL_MODEL_PROVIDER ?? 'gemini';
const model = {
  provider,
  apiKey: inspection ? undefined : configured.apiKey ?? (provider === 'gemini' ? process.env.GEMINI_API_KEY : provider === 'vertex' ? process.env.VERTEX_API_KEY : provider === 'openai-compatible' ? process.env.LOCAL_MODEL_API_KEY : undefined),
  baseUrl: inspection ? undefined : configured.baseUrl ?? process.env.LOCAL_MODEL_BASE_URL,
  embeddingApiKey: inspection ? undefined : configured.embeddingApiKey ?? process.env.LOCAL_MODEL_EMBEDDING_API_KEY,
  embeddingProvider: inspection ? undefined : configured.embeddingProvider ?? process.env.LOCAL_MODEL_EMBEDDING_PROVIDER,
  embeddingProject: inspection ? undefined : configured.embeddingProject ?? process.env.LOCAL_MODEL_EMBEDDING_PROJECT,
  embeddingLocation: inspection ? undefined : configured.embeddingLocation ?? process.env.LOCAL_MODEL_EMBEDDING_LOCATION,
  project: configured.project ?? process.env.LOCAL_MODEL_PROJECT,
  location: configured.location ?? process.env.LOCAL_MODEL_LOCATION ?? 'global',
  model: configured.model ?? process.env.LOCAL_MODEL ?? (provider === 'openai-compatible' ? undefined : 'gemini-3.1-flash-lite'),
  adcPath: configured.adcPath ?? process.env.GOOGLE_APPLICATION_CREDENTIALS,
};
if (!['gemini', 'vertex', 'vertex-adc', 'openai-compatible'].includes(model.provider)) throw Error('Unsupported local model provider');
const enabled = !inspection && !args.has('--no-model');
if (!enabled && (args.has('--prepare-knowledge') || args.has('--maintain-knowledge'))) throw Error('Knowledge preparation/maintenance requires your explicit model credentials');
if (enabled && (model.provider === 'vertex-adc' ? !model.project : !model.apiKey)) throw Error('Set the selected provider credential in LOCAL_AGENT_CONFIG; use --no-model only for data/UI development');
if (enabled && model.provider === 'vertex-adc' && model.adcPath && !await exists(model.adcPath))
  throw Error('The explicitly configured ADC file does not exist. Fix adcPath / GOOGLE_APPLICATION_CREDENTIALS; no model call was made.');

// Do not inherit deployment variables, production credentials or frontend .env files.
const baseEnv = {};
for (const name of ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'COMSPEC', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'JAVA_HOME', 'LANG']) {
  if (process.env[name] !== undefined) baseEnv[name] = process.env[name];
}
// Firebase CLI launches "java" through PATH even after our explicit JAVA_HOME check.
const inheritedPath = baseEnv.PATH ?? baseEnv.Path ?? '';
delete baseEnv.Path;
baseEnv.PATH = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin') + delimiter + inheritedPath : inheritedPath;
Object.assign(baseEnv, { CI: '1', NO_COLOR: '1', FIREBASE_CLI_DISABLE_TELEMETRY: '1', EXPO_NO_DOTENV: '1', EXPO_NO_TELEMETRY: '1', BROWSER: 'none' });
const java = spawnSync(process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', 'java') : 'java', ['-version'], { encoding: 'utf8', windowsHide: true });
if (java.status !== 0 || !/version "(?:2[1-9]|[3-9][0-9])\./u.test(java.stderr)) throw Error('Java 21+ is required. Set JAVA_HOME to a JDK/JRE directory; the system installation need not change.');
const origin = 'http://127.0.0.1:' + basePort;
const emulatorHost = offset => '127.0.0.1:' + (basePort + offset);
const env = { ...baseEnv, NODE_ENV: 'development', YUYF_LOCAL_DEVELOPMENT: '1', HOST: '127.0.0.1', PORT: String(basePort),
  SERVER_ORIGIN: origin, WEB_ORIGIN: origin, GCP_PROJECT_ID: saved.projectId, GCLOUD_PROJECT: saved.projectId,
  FIREBASE_DATABASE_ID: '(default)', FIREBASE_NAMESPACE: 'local_agent',
  FIREBASE_KNOWLEDGE_SOURCE_IDS: M03_INITIAL_WATCH_IDS.join(','),
  FIRESTORE_EMULATOR_HOST: emulatorHost(2), FIREBASE_AUTH_EMULATOR_HOST: emulatorHost(3),
  FIREBASE_STORAGE_EMULATOR_HOST: emulatorHost(4), STORAGE_EMULATOR_HOST: 'http://' + emulatorHost(4),
  FIREBASE_PHOTO_BUCKET: saved.projectId + '-private', FIREBASE_ERASURE_BUCKET: saved.projectId + '-journal',
  FIREBASE_AUTH_EMAIL_ENABLED: 'true', FIREBASE_TASK_WORKER_ENABLED: 'true',
  AVATAR_WRITES_ENABLED: String(process.env.AVATAR_WRITES_ENABLED === 'true'),
  WEB_PUSH_ENABLED: 'false', ANDROID_PUSH_ENABLED: 'false', TELEGRAM_ENABLED: 'false',
  YUBAN_FIREBASE_STORAGE_KEY: saved.storageKey, LOCAL_AGENT_STATE_FILE: statePath, LOCAL_WEB_PORT: String(basePort + 1),
  LOCAL_MODEL_PROVIDER: model.provider, LOCAL_MODEL_PROJECT: model.project ?? '', VERTEX_LOCATION: model.location,
  GEMINI_MODEL: model.model, AI_ENABLED: String(enabled), ...(model.apiKey ? { LOCAL_MODEL_API_KEY: model.apiKey } : {}),
  ...(model.baseUrl !== undefined ? { LOCAL_MODEL_BASE_URL: model.baseUrl } : {}),
  ...(model.embeddingApiKey !== undefined ? { LOCAL_MODEL_EMBEDDING_API_KEY: model.embeddingApiKey } : {}),
  ...(model.embeddingProvider !== undefined ? { LOCAL_MODEL_EMBEDDING_PROVIDER: model.embeddingProvider } : {}),
  ...(model.embeddingProject !== undefined ? { LOCAL_MODEL_EMBEDDING_PROJECT: model.embeddingProject } : {}),
  ...(model.embeddingLocation !== undefined ? { LOCAL_MODEL_EMBEDDING_LOCATION: model.embeddingLocation } : {}),
  ...(inspection ? { LOCAL_KNOWLEDGE_INSPECT_OPERATION: inspectionArgs[0].split('=')[1] ?? '' } : {}),
  ...(args.has('--maintain-knowledge') ? {
    LOCAL_KNOWLEDGE_WATCH: [...args].find(arg => arg.startsWith('--knowledge-watch='))?.split('=')[1] ?? 'fhs-solid-food',
    LOCAL_KNOWLEDGE_LIVE_SOURCE: String(args.has('--live-source')), LOCAL_KNOWLEDGE_NEW_WORK: String(args.has('--new-knowledge-work')),
  } : {}),
};
if (model.provider === 'vertex-adc' && model.adcPath) env.GOOGLE_APPLICATION_CREDENTIALS = resolve(model.adcPath);
const localModel = readLocalAgentModel(env);
if ((args.has('--prepare-knowledge') || args.has('--maintain-knowledge')) && !localModel.embeddingConfigured)
  throw Error('Knowledge work needs a compatible embedding credential; configure a Gemini or explicit Vertex embedding key. No platform fallback.');
const publicEnv = { ...baseEnv, NODE_ENV: 'development', EXPO_PUBLIC_AUTH_PROVIDER: 'firebase',
  EXPO_PUBLIC_FIREBASE_PROJECT_ID: saved.projectId, EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: '127.0.0.1',
  EXPO_PUBLIC_FIREBASE_APP_ID: '1:123456789:web:abcdef0123456789', EXPO_PUBLIC_FIREBASE_API_KEY: 'local-emulator-public-key-only',
  EXPO_PUBLIC_AUTH_EMULATOR_URL: 'http://' + emulatorHost(3), EXPO_PUBLIC_API_BASE_URL: origin + '/api',
};
// Expo disables Metro's file watcher in CI mode. Only the emulator/Server
// processes need that flag; edited Web code must be available on the next read.
delete publicEnv.CI;
const firebasePath = join(root, 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js');
await writeFile(join(directory, 'firestore.rules'), "rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read, write: if false; } } }\n");
await writeFile(join(directory, 'storage.rules'), "rules_version = '2'; service firebase.storage { match /b/{bucket}/o { match /{object=**} { allow read, write: if false; } } }\n");
const firebaseConfig = join(directory, 'firebase.json');
await writeFile(firebaseConfig, JSON.stringify({ firestore: { rules: 'firestore.rules' }, storage: { rules: 'storage.rules' },
  emulators: { auth: { host: '127.0.0.1', port: basePort + 3 }, firestore: { host: '127.0.0.1', port: basePort + 2, websocketPort: basePort + 7 },
    storage: { host: '127.0.0.1', port: basePort + 4 }, hub: { host: '127.0.0.1', port: basePort + 5 },
    logging: { host: '127.0.0.1', port: basePort + 6 }, ui: { enabled: false }, singleProjectMode: true } }, null, 2));
const children = [], handles = [];
let stopping = false, saveInProgress;
function start(label, argv, childEnv, cwd = root, expectedExit = false) {
  const logPath = join(directory, label + '.log');
  const child = spawn(process.execPath, argv, { cwd, env: childEnv, windowsHide: true, detached: process.platform === 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
  children.push(child);
  // Logs are bounded per start and stay in the protected local directory.
  let bytes = 0;
  const log = open(logPath, 'w', 0o600); handles.push(log);
  for (const output of [child.stdout, child.stderr]) output.on('data', chunk => {
    if (bytes + chunk.length <= 2 * 1024 * 1024) { bytes += chunk.length; void log.then(file => file.write(chunk)).catch(() => {}); }
  });
  child.once('error', () => { console.error(label + ' failed to start; see ' + logPath); void stop(1); });
  child.once('exit', code => { if (!stopping && !expectedExit) { console.error(label + ' exited (' + code + '); see ' + logPath); void stop(1); } });
  return child;
}
function save() {
  return saveInProgress ??= (async () => {
    const next = join(directory, 'export-next'), current = join(directory, 'export'), previous = join(directory, 'export-previous');
    // Same Hub operation used by firebase-tools 15.34 emulators:export. Avoid a second
    // CLI process: its Windows shutdown can abort after a successful export.
    const response = await fetch('http://' + emulatorHost(5) + '/_admin/export', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({ path: next, initiatedBy: 'local-development', targets: ['auth', 'firestore', 'storage'] }),
    });
    if (!response.ok) { await response.body?.cancel(); throw Error('Local emulator export rejected: ' + response.status); }
    await response.body?.cancel();
    const manifest = JSON.parse(await readFile(join(next, 'firebase-export-metadata.json'), 'utf8'));
    if (!manifest.auth || !manifest.firestore || !manifest.storage) throw Error('Incomplete local snapshot');
    await rm(previous, { recursive: true, force: true });
    if (await exists(current)) await rename(current, previous);
    await rename(next, current);
  })().finally(() => { saveInProgress = undefined; });
}
function kill(child) {
  if (child.exitCode !== null || !child.pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  else child.kill('SIGTERM');
}
async function stop(code = 0) {
  if (stopping) return; stopping = true; clearInterval(checkpoint); process.stdin.pause();
  for (const child of children.slice(1)) kill(child);
  if (emulatorsReady) try { await save(); } catch (error) { console.error('Checkpoint failed; previous export retained. ' + error.message); code = 1; }
  for (const child of children) kill(child);
  await Promise.allSettled(handles.map(async file => (await file).close())); singleton.close(); process.exitCode = code;
}
let emulatorsReady = false, checkpoint;
process.once('SIGINT', () => void stop()); process.once('SIGTERM', () => void stop());
process.stdin.on('data', data => { if (data.toString().trim() === 'stop') void stop(); });
const imported = await exists(join(directory, 'export', 'firebase-export-metadata.json')) ? join(directory, 'export')
  : await exists(join(directory, 'export-previous', 'firebase-export-metadata.json')) ? join(directory, 'export-previous') : null;
start('emulators', [firebasePath, 'emulators:start', '--only', 'auth,firestore,storage', '--project', saved.projectId,
  '--config', firebaseConfig, ...(imported ? ['--import', imported] : [])], baseEnv, directory);
try {
  const until = Date.now() + 120_000;
  while (!stopping && Date.now() < until) {
    try {
      const response = await fetch('http://' + emulatorHost(5) + '/emulators', { signal: AbortSignal.timeout(1000) });
      const services = await response.json();
      if (services.auth && services.firestore && services.storage) { emulatorsReady = true; break; }
    } catch { /* The CLI downloads emulator binaries on the first start. */ }
    await new Promise(done => setTimeout(done, 500));
  }
  if (!emulatorsReady || stopping) throw Error('Emulators not ready; read the tail of ' + join(directory, 'emulators.log'));
  checkpoint = setInterval(() => { if (!stopping) void save().catch(error => console.error('Local checkpoint failed; previous snapshot retained. ' + error.message)); }, 60_000);
  if (inspection) {
    console.log('Inspecting saved local knowledge work; no model, external delivery or publication.');
    await new Promise((done, reject) => {
      const child = start('knowledge-inspection', [join(root, 'scripts', 'agent-local-inspect-knowledge.mjs')], env, root, true);
      child.once('exit', code => code === 0 ? done() : reject(Error('Inspection failed; read the tail of ' + join(directory, 'knowledge-inspection.log'))));
    });
    console.log('Inspection metadata: ' + join(directory, 'knowledge-inspection.log'));
    await stop();
  } else if (args.has('--maintain-knowledge')) {
    console.log('Explicit local knowledge maintenance: at most two generations, bounded missing embeddings; no family data or cloud publication.');
    await new Promise((done, reject) => {
      const child = start('maintenance', [join(root, 'scripts', 'agent-local-maintain.mjs')], env, root, true);
      child.once('exit', code => code === 0 ? done() : reject(Error('Maintenance stopped; original work retained. Inspect the tail of ' + join(directory, 'maintenance.log'))));
    });
    console.log('Maintenance result: ' + join(directory, 'maintenance-result.json') + '\nRestart normally to inspect the same local knowledge in chat.');
    await stop();
  } else if (args.has('--prepare-knowledge')) {
    console.log('Preparing one reviewed local source; at most one embedding using your configured credential.');
    await new Promise((done, reject) => {
      const child = start('knowledge', [join(root, 'scripts', 'agent-local-knowledge.mjs')], env, root, true);
      child.once('exit', code => code === 0 ? done() : reject(Error('Knowledge preparation stopped; inspect the tail of ' + join(directory, 'knowledge.log'))));
    });
    console.log('Local knowledge saved. Normal startup reuses the published version and vector.');
    await stop();
  } else {
  if (!args.has('--no-web')) start('web', [join(root, 'node_modules', 'expo', 'bin', 'cli'), 'start', '--web', '--localhost', '--port', String(basePort + 1)], publicEnv, join(root, 'frontend'));
  // Native watch-path disables dependency watching on supported hosts. Windows
  // dependency activity must not restart an in-flight paid run; prompt edits do.
  const watch = args.has('--no-watch') ? [] : process.platform === 'win32' || process.platform === 'darwin'
    ? ['--watch-preserve-output', ...['server', 'src/shared', 'prompts'].map(path => '--watch-path=' + join(root, path))]
    : ['--watch', '--watch-preserve-output'];
  start('api', [...watch, join(root, 'server', 'local-agent-main.ts')], env);
  console.log('Local Agent: ' + origin + '\nAccount: ' + saved.email + '\nLocal password/data: ' + statePath
    + '\nProvider: ' + model.provider + '; model: ' + model.model + '; AI enabled: ' + enabled
    + '\nLocal quotas and usage: ' + origin + '/admin (separate from production; restarting does not reset usage).'
    + '\nNo production data or external notifications. Ctrl+C saves the emulator snapshot.');
  }
} catch (error) { console.error(error.message); await stop(1); }
