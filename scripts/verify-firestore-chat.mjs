import assert from 'node:assert/strict';
import { readFile, writeFile, lstat } from 'node:fs/promises';
import { randomUUID, randomBytes } from 'node:crypto';
import { isAbsolute, relative, resolve, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleAuth } from 'google-auth-library';
import { initializeApp, applicationDefault, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { openFirebaseRuntime } from '../server/firebase-runtime.ts';
import { createFirebaseAuthApi } from '../src/client/firebase-auth-api.ts';
import { createRecordsApi } from '../src/client/records-api.ts';
import { createChatApi } from '../src/client/chat-api.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { setFirebaseBackupControl } from '../server/firestore-backup.ts';

// One continuous native-data/real-Runner check. No notification, SMTP, deployment, restore or retry.
// The protected directory must already exist outside the repository and contain firebase.env/storage.key.
const mode = process.argv[2], directory = process.argv[3];
const root = fileURLToPath(new URL('..', import.meta.url));
const report = { format: 1, package: 'P2-F03', transport: 'production client APIs and handler; native Firebase/Firestore/Vertex',
  maximum: { accounts: 2, children: 1, apiRequests: 40, agentRuns: 1, modelCalls: 4, queryEmbeddings: 2, inputCharactersPerCall: 64000, outputTokensPerCall: 1024 },
  steps: [], apiRequests: 0, modelCalls: 0, queryEmbeddings: 0, notifications: 0, emails: 0, deployments: 0 };
let runtime, admin, control, activeGeneration, enabledByThisRun = false, success = false;
const accounts = [], run = randomUUID();
const step = name => { report.phase = name; report.steps.push(name); console.info(JSON.stringify({ step: name })); };
const check = (condition, name) => { if (!condition) throw Error(name); };
async function privateWrite(name, data) { await writeFile(join(directory, name), JSON.stringify(data, null, 2), { flag: 'wx', mode: 0o600 }); }
try {
  check(['--preflight', '--approved-run'].includes(mode), 'explicit_mode_required');
  const rel = relative(root, resolve(directory ?? '.'));
  check(directory && isAbsolute(directory) && (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)), 'protected_directory_outside_repository_required');
  const info = await lstat(directory); check(info.isDirectory() && !info.isSymbolicLink(), 'protected_directory_required');
  const env = { ...process.env };
  for (const line of (await readFile(join(directory, 'firebase.env'), 'utf8')).split(/\r?\n/u)) {
    if (!/^[A-Z_0-9]+=/u.test(line)) continue;
    const at = line.indexOf('='); env[line.slice(0, at)] = line.slice(at + 1);
  }
  check(env.GCP_PROJECT_ID === 'ai-caregivers-for-children' && env.FIREBASE_DATABASE_ID === 'yuban-firebase-20261011'
    && env.FIREBASE_NAMESPACE === 'yuban_authority' && env.SERVER_ORIGIN === 'https://ex-machina.eu.org', 'approved_target_required');
  // Explicit current product limits; this check never increases or resets shared counters.
  Object.assign(env, { STORAGE_KEY_FILE: join(directory, 'storage.key'), AI_ENABLED: 'true',
    AI_DAILY_USER_ATTEMPTS: '12', AI_DAILY_GLOBAL_ATTEMPTS: '20', AI_MAX_ATTEMPTS: '1',
    AI_AGENT_MAX_INPUT_CHARACTERS: '64000', AI_MAX_OUTPUT_TOKENS: '1024', FIREBASE_TASK_WORKER_ENABLED: 'false' });
  check(process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.FIRESTORE_EMULATOR_HOST && !process.env.FIREBASE_AUTH_EMULATOR_HOST,
    'explicit_native_credentials_required');
  report.phase = 'runtime_open'; runtime = await openFirebaseRuntime(env);
  report.phase = 'read_control';
  control = await runtime.authority.readControl();
  check(control.enabled === false, 'expected_paused_source');
  check(runtime.knowledge, 'existing_public_knowledge_required');
  report.phase = 'read_public_source';
  const pages = await runtime.knowledge.candidates({ region: 'HK', classification: 'official_guidance', age: null,
    ageMatch: 'unknown', topics: [] }, null, { limit: 1 });
  check(pages.length === 1, 'published_source_required');
  const client = await new GoogleAuth({ keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getClient();
  const base = 'https://firestore.googleapis.com/v1/projects/' + env.GCP_PROJECT_ID + '/databases/' + env.FIREBASE_DATABASE_ID;
  report.phase = 'read_indexes'; const indexes = [];
  let pageToken;
  do {
    const result = (await client.request({ url: base + '/collectionGroups/-/indexes', params: { ...(pageToken ? { pageToken } : {}) }, retry: false })).data;
    indexes.push(...result.indexes ?? []); pageToken = result.nextPageToken;
    check(indexes.length <= 200, 'index_listing_bound');
  } while (pageToken);
  const desired = JSON.parse(await readFile(new URL('../deploy/firebase/firestore.indexes.json', import.meta.url), 'utf8')).indexes;
  const canonical = value => JSON.stringify(sort(value));
  function sort(value) { return Array.isArray(value) ? value.map(sort) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])])) : value; }
  const normalize = value => canonical({ queryScope: value.queryScope, fields: value.fields.filter(field => field.fieldPath !== '__name__') });
  report.missingOrBuildingIndexes = desired.filter(wanted => !indexes.some(current => current.name.includes('/collectionGroups/' + wanted.collectionGroup + '/')
    && current.state === 'READY' && normalize(current) === normalize(wanted))).map(value => value.collectionGroup);
  step('paused_source_and_existing_published_knowledge_read');
  if (mode === '--preflight') {
    report.state = 'preflight_only'; console.info(JSON.stringify(report));
  } else {
    check(report.missingOrBuildingIndexes.length === 0, 'required_indexes_not_ready');
    report.phase = 'native_accounts_and_core';
    const apps = (await client.request({ url: 'https://firebase.googleapis.com/v1beta1/projects/' + env.GCP_PROJECT_ID + '/webApps?pageSize=10', retry: false })).data.apps;
    check(apps?.length === 1, 'existing_web_app_required');
    const config = (await client.request({ url: 'https://firebase.googleapis.com/v1beta1/' + apps[0].name + '/config', retry: false })).data;
    admin = initializeApp({ projectId: config.projectId, credential: applicationDefault() }, 'f03-check-' + run);
    const auth = getAuth(admin), origin = runtime.config.publicOrigin, signal = AbortSignal.timeout(240_000);
    await privateWrite('f03-' + run + '-recovery.json', { run, database: env.FIREBASE_DATABASE_ID, namespace: env.FIREBASE_NAMESPACE, control });
    activeGeneration = randomUUID();
    // Register restoration responsibility before the write: a lost acknowledgement is not permission to leave it enabled.
    enabledByThisRun = true;
    await setFirebaseBackupControl({ database: runtime.database, cipher: runtime.cipher, projectId: env.GCP_PROJECT_ID, namespace: env.FIREBASE_NAMESPACE },
      { expectedGeneration: control.generation, generation: activeGeneration, enabled: true });
    function actor(uid) {
      let cookie = '';
      const fetcher = async (url, input = {}) => {
        check(++report.apiRequests <= report.maximum.apiRequests, 'api_request_cap');
        const headers = new Headers(input.headers); headers.set('origin', origin); if (cookie) headers.set('cookie', cookie);
        const response = await runtime.handler(new Request(url, { ...input, headers }));
        const next = response.headers.get('set-cookie'); if (next) cookie = next.split(';')[0];
        return response;
      };
      const identity = createFirebaseAuthApi({ baseUrl: origin + '/api', publicOrigin: origin, config, fetcher });
      const records = createRecordsApi(origin + '/api', fetcher, identity);
      const chat = createChatApi(origin + '/api', s => records.getSession(s), fetcher);
      async function json(path, body) {
        const response = await fetcher(origin + '/api' + path, { headers: { 'x-expected-user-id': uid,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, signal,
          ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }) });
        check(response.ok, 'api_' + response.status + '_' + path.split('/').at(-1)); return response.json();
      }
      return { records, chat, json, identity, uid };
    }
    for (let i = 0; i < 2; i++) {
      const uid = 'f03-' + run + '-' + i, email = uid + '@example.test', password = randomBytes(24).toString('base64url') + 'Aa1!';
      await auth.createUser({ uid, email, password, emailVerified: true }); accounts.push(uid);
      await runtime.authority.issueInvitation({ email, expiresAt: new Date(Date.now() + 600_000).toISOString(), operationId: randomUUID() });
      const current = actor(uid); await current.records.authenticate('signIn', { email, password, name: 'F03 合成帳號' }, signal);
      await current.json('/account/acknowledgement', { operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION, accepted: true });
      if (i === 0) report.owner = current; else report.other = current;
    }
    const owner = report.owner, other = report.other; delete report.owner; delete report.other;
    check(await owner.chat.getStatus(signal), 'platform_chat_unavailable');
    const child = await owner.records.createChild('F03 單一合成聊天驗收', signal, owner.uid); report.childId = child.id;
    await owner.json('/children/' + child.id + '/agent/policy', { operationId: randomUUID(), expectedVersion: 0, recordKinds: [],
      allowPrivateNotes: true, allowRecordCorrections: false, allowSelfTasks: false, reminderConsentVersion: null,
      reminderBindings: [], confirm: true, confirmShared: false });
    const note = await owner.records.createRecord(child.id, '合成照護原文\n保留空格  和換行。', signal, owner.uid);
    check((await owner.records.listRecords(child.id, signal)).records.some(value => value.id === note.id && value.text === note.text), 'records_shared_readback');
    await assert.rejects(other.chat.listMessages(child.id, signal), error => error?.status === 403 || error?.status === 404);
    step('native_login_core_save_and_other_account_isolation');
    const message = await owner.chat.saveMessage(child.id,
      '這是合成驗收。孩子約半歲，請用香港家庭健康服務的資料簡短解釋一點適用的加固建議並列來源。另請記住：我每次出門前會檢查健康手冊。這句是私人交代，已授權保存，不需安排提醒。', signal, owner.uid);
    // Exactly one reply request. A stopped/unknown run is retained, never retried by this script.
    report.phase = 'single_real_agent_reply';
    report.modelCalls = null; report.queryEmbeddings = null;
    const reply = await owner.chat.requestReply(child.id, message.id, signal, owner.uid);
    check(reply.agentRunId, 'persisted_run_relation_required'); report.runId = reply.agentRunId;
    const result = await runtime.product.store.get(owner.uid, child.id, reply.agentRunId);
    report.modelCalls = result?.counts.modelCalls ?? 0; report.queryEmbeddings = result?.counts.queryEmbeddings ?? 0;
    report.runStatus = result?.status; report.stopReason = result?.stopReason ?? null;
    check(result?.status === 'completed' && result.citations.length > 0 && result.retrievalMode === 'vector_keyword', 'real_answer_and_vector_citations_required');
    check(result.tools.some(tool => tool.name === 'save_private_instruction' && tool.status === 'succeeded'), 'real_saved_instruction_required');
    check(report.modelCalls <= 4 && report.queryEmbeddings <= 2, 'root_cap');
    step('one_real_agent_answer_vector_citation_and_saved_instruction');
    const before = await owner.chat.getUsage(signal);
    const previous = runtime; runtime = await openFirebaseRuntime(env); await previous.close();
    const messages = await owner.chat.listMessages(child.id, signal);
    check(messages.messages.some(value => value.id === reply.id && value.text === reply.text && value.agentRunId === reply.agentRunId), 'restarted_chat_readback');
    const notes = await owner.json('/children/' + child.id + '/agent/notes');
    check(notes.notes.items.some(value => value.text.includes('健康手冊')), 'restarted_instruction_readback');
    assert.deepEqual(await owner.chat.getUsage(signal), before);
    step('runtime_reopen_same_chat_notes_and_usage');
    await owner.records.deleteChild(child.id, signal, owner.uid);
    for (const uid of accounts) {
      await runtime.authority.setAccountState({ userId: uid, operationId: randomUUID(), state: 'revoked' }); await auth.deleteUser(uid);
    }
    report.cleanup = 'new child tombstoned and synthetic Auth accounts deleted; encrypted receipts retained for F04 erasure coverage';
    success = true; report.state = 'passed';
  }
} catch (error) {
  report.state = 'failed'; report.error = { phase: report.phase, type: error?.name, code: typeof error?.code === 'string' || typeof error?.code === 'number' ? error.code : null,
    reason: error?.constructor === Error && /^[a-zA-Z0-9_/-]+$/u.test(error.message) ? error.message : null };
  process.exitCode = 1;
} finally {
  if (enabledByThisRun) {
    try {
      const observed = await runtime.authority.readControl();
      if (observed.generation !== control.generation || observed.enabled !== false) {
        check(observed.generation === activeGeneration, 'control_changed_during_check');
        await setFirebaseBackupControl({ database: runtime.database, cipher: runtime.cipher,
          projectId: runtime.config.projectId, namespace: runtime.config.namespace },
          { expectedGeneration: activeGeneration, generation: randomUUID(), enabled: false });
      }
      report.controlRestoredPaused = true;
    }
    catch { report.controlRestoredPaused = false; process.exitCode = 1; }
  }
  await runtime?.close(); if (admin) await deleteApp(admin);
  delete report.owner; delete report.other;
  if (mode === '--approved-run' && directory) await privateWrite('f03-' + run + '-result.json', { ...report, run, accounts, success });
  console.info(JSON.stringify({ state: report.state, steps: report.steps, missingIndexes: report.missingOrBuildingIndexes?.length,
    error: report.error, apiRequests: report.apiRequests, modelCalls: report.modelCalls, queryEmbeddings: report.queryEmbeddings,
    controlRestoredPaused: report.controlRestoredPaused }));
}
