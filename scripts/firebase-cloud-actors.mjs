import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, lstat, open } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleAuth } from 'google-auth-library';
import { applicationDefault, deleteApp, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { z } from 'zod';
import { openFirebasePersistence } from '../server/firebase-persistence.ts';
import { decodeFirebaseStorageKey } from '../server/firebase-storage-key.ts';

// Operator-only synthetic HTTP identity fixtures. This is not Web SDK or email lifecycle evidence.
// Auth REST fetches never retry. Admin same-value updates and original invitation transactions retain SDK retries.
// A 20-second SDK waiting limit cannot cancel an already submitted Admin/Firestore mutation; unknown stops the run.
const ORIGIN = 'https://yuban-firebase-check.web.app';
const PROJECT = 'ai-caregivers-for-children', PROJECT_NUMBER = '1064034424208';
const DATABASE = 'yuban-firebase-20261011', NAMESPACE = 'yuban_authority';
const APP_ID = '1:1064034424208:web:b0873383eee9d93256cf15';
const SOURCE = '17c67253590a27f5110ff5a8234f461a20aec207';
const KNOWLEDGE_VERSION = 'c9265331-6ec2-5436-b4c2-07d354e53101';
const SECRET = `projects/${PROJECT_NUMBER}/secrets/YUBAN_FIREBASE_STORAGE_KEY/versions/1`;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NODE = 'C:/Users/2NTTY/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe';
const TIMEOUT_MS = 20_000, MAX_LINE = 4096, MAX_COMMANDS = 100, MAX_RESPONSE = 32 * 1024, MAX_HTTP = 20;
const uidSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u), uuid = z.uuid();
const publicConfigSchema = z.object({ apiKey: z.string().regex(/^[A-Za-z0-9_-]{20,200}$/u),
  authDomain: z.literal(PROJECT + '.firebaseapp.com'), projectId: z.literal(PROJECT), appId: z.literal(APP_ID) }).strict();
const startSchema = z.object({ command: z.literal('start'), runId: z.string().regex(/^[A-Za-z0-9_-]{1,48}$/u),
  publicConfig: publicConfigSchema }).strict();
const commandSchema = z.union([startSchema, z.object({ command: z.enum(['prepare', 'core', 'delete', 'status', 'close']) }).strict()]);
const checkpointSchema = z.object({ step: z.string().regex(/^[a-zA-Z0-9_]+$/u), runId: startSchema.shape.runId,
  uid: uidSchema.optional(), operationId: uuid.optional() }).strict();
const identitySchema = z.object({ user: z.object({ id: uidSchema, name: z.string().max(1000), email: z.email().max(320) }).strict() }).strict();
const cookieSchema = z.string().max(16 * 1024 + 10).regex(/^__session=[A-Za-z0-9._~-]+$/u);
const childOperationSchema = z.object({ runId: startSchema.shape.runId.optional(), opId: uuid.optional(), deviceId: uuid.optional(),
  workspaceId: uuid.optional(), storageEpoch: uuid.optional() }).strict();
const CHILD_STEPS = new Set(['input', 'core_checkpoint', 'delete_checkpoint', 'core_complete', 'delete_complete',
  'task_context', 'task_create', 'task_original_replay', 'task_read', 'document_create', 'document_original_content',
  'document_typed_patch', 'document_patch_original_replay', 'document_read_latest', 'document_latest_content',
  'document_stale_version', 'document_after_conflict', 'photoReserve_context', 'photo_reserve', 'photo_reserve_original_replay',
  'photo_upload', 'photo_metadata_read', 'photo_authorized_content', 'photo_complete_list', 'foreign_child_tasks', 'foreign_task',
  'foreign_photo', 'foreign_photo_content', 'foreign_document', 'foreign_original_operation', 'library_catalog_version',
  'photoDelete_context', 'delete_original_photo_read', 'delete_original_context', 'photo_delete_original_operation',
  'photo_delete_original_replay', 'photo_delete_original_receipt', 'deleted_photo_metadata', 'deleted_photo_content',
  'deleted_photo_complete_list', 'deleted_reservation_receipt_redacted', 'child_A_original_replay',
  ...['A', 'B'].flatMap(actor => ['session_', 'account_', 'acknowledge_', 'child_', 'children_complete_'].map(prefix => prefix + actor)),
  'childA_context', 'childB_context']);
const CHILD_ERRORS = new Set(['request_limit', 'response_limit', 'network_failure', 'unexpected_status', 'invalid_response_json',
  'input_limit', 'input_invalid', 'checkpoint_exists_or_unavailable', 'assertion_failed', 'local_failure']);
const childResultSchema = z.object({ step: z.string().refine(value => CHILD_STEPS.has(value)),
  error: z.string().refine(value => CHILD_ERRORS.has(value)).nullable(),
  status: z.union([z.literal('passed'), z.number().int().min(100).max(599), z.null()]), operation: childOperationSchema.nullable() }).strict();
const PROVIDER_CODES = new Set(['auth/user-not-found', 'auth/invalid-email', 'auth/email-already-exists', 'auth/user-disabled',
  'auth/insufficient-permission', 'auth/internal-error', 'auth/too-many-requests', 'EMAIL_EXISTS', 'INVALID_EMAIL',
  'OPERATION_NOT_ALLOWED', 'WEAK_PASSWORD', 'TOO_MANY_ATTEMPTS_TRY_LATER', 'INVALID_LOGIN_CREDENTIALS',
  'USER_DISABLED', 'MISSING_RECAPTCHA_TOKEN', 'INVALID_RECAPTCHA_TOKEN', 'CAPTCHA_CHECK_FAILED',
  'RECAPTCHA_NOT_ENABLED', 'INVALID_RECAPTCHA_ACTION']);

// Dependencies may log their own error objects. Only explicit sanitized JSON is allowed on this operator channel.
for (const method of ['log', 'info', 'warn', 'error', 'debug']) console[method] = () => {};
let state = 'awaiting_start', step = 'input', input, directory, persistence, adminApp, nativeAuth, child;
let creations = 0, requests = 0, commands = 0, status = null, currentUid = null, currentOperationId = null;
let hadFailure = false;
const actors = { A: { email: 'f02-20261011-a@synthetic.invalid' }, B: { email: 'f02-20261011-b@synthetic.invalid' } };
class OperatorError extends Error {
  constructor(code, providerCode = null) { super('Operator run stopped'); this.code = code; this.providerCode = providerCode; }
}
function stop(code, providerCode = null) { throw new OperatorError(code, providerCode); }
function emit(value) { process.stdout.write(JSON.stringify(value) + '\n'); }
function providerCode(error) { return PROVIDER_CODES.has(error?.code) ? error.code : null; }
function guard() { if (state === 'failed' || state === 'closed') stop('run_stopped'); }
function failure(error) {
  state = 'failed'; hadFailure = true;
  emit({ step, error: error instanceof OperatorError ? error.code : 'operation_failed', status,
    providerCode: error instanceof OperatorError ? error.providerCode : providerCode(error),
    operation: { ...(input ? { runId: input.runId } : {}), ...(currentUid ? { uid: currentUid } : {}),
      ...(currentOperationId ? { operationId: currentOperationId } : {}) } });
}
function redactedStatus() {
  emit({ step: 'status', state, runId: input?.runId ?? null, creations, requests, transport: 'auth_rest',
    emailVerification: 'synthetic_admin_fixture_only', users: { A: actors.A.userId ?? null, B: actors.B.userId ?? null } });
}
async function waiting(action) {
  guard(); let timer;
  try {
    const result = await Promise.race([Promise.resolve().then(action), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new OperatorError('sdk_outcome_unknown')), TIMEOUT_MS);
    })]);
    guard(); return result;
  } finally { clearTimeout(timer); }
}
async function immutable(name, recordStep, extra = {}) {
  const value = checkpointSchema.parse({ step: recordStep, runId: input.runId, ...extra });
  const file = await open(join(directory, name + '.json'), 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(value) + '\n', 'utf8'); await file.sync(); } finally { await file.close(); }
}
async function checkpoint(name, extra = {}) {
  step = name; status = null; currentOperationId = extra.operationId ?? null; currentUid = extra.uid ?? null;
  guard(); await immutable(name, name, extra); guard();
}
async function responseBytes(response) {
  const pieces = []; let count = 0;
  for await (const part of response.body ?? []) {
    const bytes = Buffer.from(part); count += bytes.length;
    if (count > MAX_RESPONSE) { await response.body?.cancel().catch(() => {}); stop('response_limit'); }
    pieces.push(bytes);
  }
  return Buffer.concat(pieces);
}
function restError(value) {
  const message = value?.error?.message;
  if (typeof message !== 'string') return null;
  const code = message.split(/[ :]/u, 1)[0]; return PROVIDER_CODES.has(code) ? code : null;
}
async function http(url, { method = 'GET', headers = {}, body, privateResponse = false } = {}) {
  guard(); if (requests >= MAX_HTTP) stop('request_limit'); requests++;
  let response, bytes;
  try {
    response = await fetch(url, { method, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: 'application/json', 'cache-control': 'no-store', pragma: 'no-cache', ...headers,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    status = response.status; bytes = await responseBytes(response);
  } catch (error) { if (error instanceof OperatorError) throw error; stop('http_outcome_unknown'); }
  guard(); let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { stop('invalid_response_json'); } finally { bytes.fill(0); }
  if (response.status !== 200) stop('unexpected_status', restError(value));
  if (privateResponse && (response.headers.get('cache-control') !== 'private, no-store'
    || response.headers.get('pragma') !== 'no-cache')) stop('private_headers_invalid');
  return { value, headers: response.headers };
}
function crc32c(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0x82f63b78 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
async function openOperator() {
  for (const name of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_DATABASE_EMULATOR_HOST', 'STORAGE_EMULATOR_HOST']) {
    if (process.env[name] !== undefined) stop('emulator_configuration_rejected');
  }
  const google = new GoogleAuth({ projectId: PROJECT, scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const token = await waiting(() => google.getAccessToken());
  if (typeof token !== 'string' || !token || /[\s\u0000-\u001f\u007f]/u.test(token)) stop('adc_unavailable');
  step = 'public_config_read'; status = null;
  const config = (await http(`https://firebase.googleapis.com/v1beta1/projects/${PROJECT}/webApps/${APP_ID}/config`,
    { headers: { authorization: 'Bearer ' + token } })).value;
  for (const key of ['apiKey', 'authDomain', 'projectId', 'appId']) {
    if (config?.[key] !== input.publicConfig[key]) stop('public_config_mismatch');
  }
  step = 'storage_key_read'; status = null;
  const secret = (await http('https://secretmanager.googleapis.com/v1/' + SECRET + ':access',
    { headers: { authorization: 'Bearer ' + token } })).value;
  if (secret?.name !== SECRET || typeof secret?.payload?.data !== 'string'
    || !/^\d{1,10}$/u.test(String(secret?.payload?.dataCrc32c))) stop('secret_invalid');
  const decoded = Buffer.from(secret.payload.data, 'base64');
  let encoded;
  try {
    if (decoded.length !== 44 || decoded.toString('base64') !== secret.payload.data
      || crc32c(decoded) !== Number(secret.payload.dataCrc32c)) stop('secret_invalid');
    encoded = new TextDecoder('utf-8', { fatal: true }).decode(decoded);
    const checked = decodeFirebaseStorageKey(encoded); checked.fill(0);
  } finally { decoded.fill(0); secret.payload.data = ''; }
  const env = { NODE_ENV: 'production', SERVER_ORIGIN: ORIGIN, WEB_ORIGIN: ORIGIN, GCP_PROJECT_ID: PROJECT,
    FIREBASE_DATABASE_ID: DATABASE, FIREBASE_NAMESPACE: NAMESPACE, FIREBASE_AUTH_EMAIL_ENABLED: 'true',
    FIREBASE_TASK_WORKER_ENABLED: 'false', FIREBASE_PHOTO_BUCKET: PROJECT + '-firebase-private',
    FIREBASE_ERASURE_BUCKET: PROJECT + '-firebase-journal', YUBAN_FIREBASE_STORAGE_KEY: encoded };
  try {
    persistence = await waiting(async () => {
      const opened = await openFirebasePersistence(env);
      if (state === 'failed' || state === 'closed') { await opened.close().catch(() => {}); stop('run_stopped'); }
      return opened;
    });
  } finally { delete env.YUBAN_FIREBASE_STORAGE_KEY; encoded = undefined; }
  adminApp = initializeApp({ projectId: PROJECT, credential: applicationDefault() }, 'f02-actors-' + randomUUID());
  nativeAuth = getAuth(adminApp);
}
async function assertAbsent(actorName) {
  step = 'absence_' + actorName; status = null;
  try { await waiting(() => nativeAuth.getUserByEmail(actors[actorName].email)); }
  catch (error) { if (error?.code === 'auth/user-not-found') return; throw error; }
  stop('actor_already_exists');
}
async function authRest(action, body) {
  const url = 'https://identitytoolkit.googleapis.com/v1/accounts:' + action + '?key=' + input.publicConfig.apiKey;
  return (await http(url, { method: 'POST', body })).value;
}
async function prepareActor(name) {
  const actor = actors[name], operationId = randomUUID();
  await checkpoint('invitation_' + name + '_started', { operationId });
  const expiresAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
  const invitation = await waiting(() => persistence.authority.issueInvitation({ email: actor.email, expiresAt, operationId }));
  if (invitation.email !== actor.email || invitation.expiresAt !== expiresAt || invitation.state !== 'issued'
    || invitation.consumedBy !== null) stop('invitation_mismatch');
  await immutable('invitation_' + name + '_confirmed', 'invitation_' + name + '_confirmed', { operationId });
  await checkpoint('create_' + name + '_started');
  if (creations >= 2) stop('creation_limit'); creations++;
  actor.password = randomBytes(36).toString('base64url') + 'aA1!';
  const created = await authRest('signUp', { email: actor.email, password: actor.password, returnSecureToken: true });
  actor.userId = uidSchema.parse(created?.localId);
  if (created.email !== actor.email || Object.entries(actors).some(([key, value]) => key !== name && value.userId === actor.userId)) stop('actor_binding_invalid');
  // Unverified sign-up credentials are not used to establish a business session.
  for (const key of ['idToken', 'refreshToken']) if (Object.hasOwn(created, key)) created[key] = '';
  await immutable('create_' + name + '_confirmed', 'create_' + name + '_confirmed', { uid: actor.userId });
  step = 'new_identity_' + name; currentUid = actor.userId; status = null;
  const before = await waiting(() => nativeAuth.getUser(actor.userId));
  if (before.uid !== actor.userId || before.email !== actor.email || before.disabled || before.emailVerified) stop('actor_binding_invalid');
  await checkpoint('synthetic_verified_fixture_' + name + '_started', { uid: actor.userId });
  const fixture = await waiting(() => nativeAuth.updateUser(actor.userId, { emailVerified: true }));
  if (fixture.uid !== actor.userId || fixture.email !== actor.email || fixture.disabled || fixture.emailVerified !== true) stop('fixture_binding_invalid');
  await immutable('synthetic_verified_fixture_' + name + '_confirmed', 'synthetic_verified_fixture_' + name + '_confirmed', { uid: actor.userId });
  await checkpoint('sign_in_' + name + '_started', { uid: actor.userId });
  const signed = await authRest('signInWithPassword', { email: actor.email, password: actor.password, returnSecureToken: true });
  if (signed.localId !== actor.userId || signed.email !== actor.email || typeof signed.idToken !== 'string'
    || signed.idToken.length > 15_000 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(signed.idToken)) stop('actor_binding_invalid');
  actor.password = undefined; if (Object.hasOwn(signed, 'refreshToken')) signed.refreshToken = '';
  step = 'verified_token_' + name; status = null;
  const claims = await waiting(() => nativeAuth.verifyIdToken(signed.idToken, true));
  if (claims.uid !== actor.userId || claims.email !== actor.email || claims.email_verified !== true
    || !Number.isSafeInteger(claims.auth_time) || claims.auth_time > Math.floor(Date.now() / 1000)
    || Math.floor(Date.now() / 1000) - claims.auth_time > 300) stop('verified_token_invalid');
  await checkpoint('session_' + name + '_started', { uid: actor.userId });
  let exchanged;
  try { exchanged = await http(ORIGIN + '/api/auth/session', { method: 'POST', privateResponse: true,
    headers: { origin: ORIGIN, 'x-expected-user-id': actor.userId }, body: { idToken: signed.idToken } }); }
  finally { signed.idToken = ''; }
  const exchangeIdentity = identitySchema.parse(exchanged.value);
  if (exchangeIdentity.user.id !== actor.userId || exchangeIdentity.user.email !== actor.email) stop('session_binding_invalid');
  const cookies = exchanged.headers.getSetCookie();
  if (cookies.length !== 1 || !/^__session=[A-Za-z0-9._~-]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=432000; Secure$/u.test(cookies[0])) stop('session_cookie_invalid');
  actor.cookie = cookieSchema.parse(cookies[0].split(';', 1)[0]);
  step = 'session_' + name + '_read'; status = null;
  const session = identitySchema.parse((await http(ORIGIN + '/api/auth/get-session', { privateResponse: true,
    headers: { origin: ORIGIN, 'x-expected-user-id': actor.userId, cookie: actor.cookie } })).value);
  if (session.user.id !== actor.userId || session.user.email !== actor.email) stop('session_binding_invalid');
  await immutable('session_' + name + '_confirmed', 'session_' + name + '_confirmed', { uid: actor.userId });
}
async function prepare() {
  if (state !== 'ready_to_prepare') stop('phase_not_available');
  state = 'preparing'; await checkpoint('prepare_started'); await openOperator();
  await assertAbsent('A'); await assertAbsent('B');
  await immutable('actors_absent_confirmed', 'actors_absent_confirmed');
  await prepareActor('A'); await prepareActor('B');
  guard(); state = 'prepared'; await immutable('prepare_confirmed', 'prepare_confirmed');
  emit({ step: 'prepare_complete', status: 'passed', transport: 'auth_rest', emailVerification: 'synthetic_admin_fixture_only',
    operation: { runId: input.runId }, users: { A: actors.A.userId, B: actors.B.userId } });
}
async function acceptance(phase) {
  if (state !== (phase === 'core' ? 'prepared' : 'core_passed')) stop('phase_not_available');
  state = phase + '_running'; await checkpoint(phase + '_started');
  const accounts = Object.fromEntries(['A', 'B'].map(name => [name, { userId: uidSchema.parse(actors[name].userId), cookie: cookieSchema.parse(actors[name].cookie) }]));
  const childInput = Buffer.from(JSON.stringify({ phase, origin: ORIGIN, runId: input.runId,
    expectedSourceRevision: SOURCE, expectedKnowledgeVersionId: KNOWLEDGE_VERSION, accounts }));
  // Only basic OS variables are inherited. Credentials travel through stdin, never argv/environment/files.
  const env = Object.fromEntries(['SystemRoot', 'WINDIR', 'TEMP', 'TMP'].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
  let result;
  try {
    result = await new Promise((resolveChild, reject) => {
      let bytes = 0, stderrBytes = 0, output = '', inputFailed = false, settled = false, timer;
      const fail = code => { if (settled) return; settled = true; clearTimeout(timer); child?.kill(); reject(new OperatorError(code)); };
      child = spawn(NODE, [join(ROOT, 'scripts', 'firebase-cloud-acceptance.mjs')], { cwd: ROOT, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      timer = setTimeout(() => fail('acceptance_outcome_unknown'), 100 * TIMEOUT_MS + 30_000);
      child.on('error', () => fail('acceptance_process_unavailable'));
      child.stdout.on('data', part => { bytes += part.length; if (bytes > 4096) return fail('acceptance_output_invalid'); output += part.toString('utf8'); });
      child.stderr.on('data', part => { stderrBytes += part.length; if (stderrBytes > 4096) fail('acceptance_output_invalid'); });
      child.stdin.on('error', () => { inputFailed = true; });
      child.once('close', code => {
        child = undefined; if (settled) return; settled = true; clearTimeout(timer);
        if (inputFailed || stderrBytes > 0) return reject(new OperatorError('acceptance_process_unconfirmed'));
        try {
          const parsed = childResultSchema.parse(JSON.parse(output.trim()));
          const passed = code === 0 && parsed.step === phase + '_complete' && parsed.error === null && parsed.status === 'passed';
          if (code === 0 && !passed || code !== 0 && (parsed.error === null || parsed.status === 'passed')) stop('acceptance_output_invalid');
          if (parsed.operation?.runId !== undefined && parsed.operation.runId !== input.runId) stop('acceptance_output_invalid');
          resolveChild({ parsed, passed });
        } catch { reject(new OperatorError('acceptance_output_invalid')); }
      });
      child.stdin.end(childInput);
    });
  } finally { childInput.fill(0); }
  guard();
  if (result.passed) { await immutable(phase + '_confirmed', phase + '_confirmed'); state = phase + '_passed'; }
  else { state = 'failed'; hadFailure = true; }
  emit(result.parsed);
}
async function start(value) {
  if (state !== 'awaiting_start') stop('start_already_consumed');
  if (process.argv.length !== 2 || !/^24\.(?:1[2-9]|[2-9][0-9])\./u.test(process.versions.node)) stop('runtime_invalid');
  input = startSchema.parse(value); step = 'operator_checkpoint';
  const parent = join(ROOT, 'tmp');
  try { await mkdir(parent, { mode: 0o700 }); } catch (error) { if (error?.code !== 'EEXIST') throw error; }
  const parentStat = await lstat(parent); if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) stop('checkpoint_unavailable');
  // The fixed actor batch fence also rejects a new process with a different runId after an unknown attempt.
  directory = join(parent, 'f02-cloud-actors-20261011');
  try { await mkdir(directory, { mode: 0o700 }); } catch { stop('checkpoint_exists_or_unavailable'); }
  await immutable('start_confirmed', 'start_confirmed'); state = 'ready_to_prepare';
  emit({ step: 'start_complete', state, operation: { runId: input.runId }, testedSource: SOURCE, expectedKnowledgeVersionId: KNOWLEDGE_VERSION });
}
async function close() {
  state = 'closed'; child?.kill();
  for (const actor of Object.values(actors)) { actor.password = undefined; actor.cookie = undefined; }
  const closing = Promise.allSettled([adminApp ? deleteApp(adminApp) : Promise.resolve(), persistence ? persistence.close() : Promise.resolve()]);
  let timer; const confirmed = await Promise.race([closing.then(results => results.every(value => value.status === 'fulfilled')),
    new Promise(resolveClosed => { timer = setTimeout(() => resolveClosed(false), TIMEOUT_MS); })]); clearTimeout(timer);
  emit({ step: 'close', status: confirmed ? 'closed' : 'local_close_unconfirmed', operation: input ? { runId: input.runId } : null });
  process.exitCode = confirmed && !hadFailure ? 0 : 1;
}
async function command(line) {
  try {
    if (++commands > MAX_COMMANDS) stop('command_limit');
    const value = commandSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line)));
    if (value.command === 'status') { redactedStatus(); return; }
    if (value.command === 'close') { await close(); return; }
    if (state === 'failed') { emit({ step: 'command', error: 'run_stopped', status: null, operation: input ? { runId: input.runId } : null }); return; }
    step = 'command'; status = null;
    if (value.command === 'start') await start(value);
    else if (value.command === 'prepare') await prepare();
    else await acceptance(value.command);
  } catch (error) { failure(error); }
}
process.on('uncaughtException', () => { failure(new OperatorError('process_failure')); child?.kill(); });
process.on('unhandledRejection', () => { failure(new OperatorError('process_failure')); child?.kill(); });
try {
  let pending = [], oversized = false;
  for await (const chunk of process.stdin) {
    for (const byte of chunk) {
      if (byte === 10) {
        if (oversized) failure(new OperatorError('input_limit'));
        else { if (pending.at(-1) === 13) pending.pop(); await command(Buffer.from(pending)); }
        pending = []; oversized = false;
        if (state === 'closed') break;
      } else if (!oversized) {
        if (pending.length >= MAX_LINE) { pending = []; oversized = true; } else pending.push(byte);
      }
    }
    if (state === 'closed') break;
  }
  if (state !== 'closed') {
    if (oversized) failure(new OperatorError('input_limit'));
    else if (pending.length) await command(Buffer.from(pending));
    if (state !== 'closed') await close();
  }
} catch (error) { failure(error); if (state !== 'closed') await close(); }
