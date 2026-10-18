import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { Firestore, FieldValue } from '@google-cloud/firestore';
import { createLocalAgentBuckets } from '../server/local-agent-storage.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { createChatApi } from '../src/client/chat-api.ts';
import { createProductAgentApi } from '../src/client/product-agent-api.ts';

// Explicit bounded checks only; startup never runs this. --real-agent spends one run.
const mode = process.argv[2];
if (!['--data-only', '--persistence-only', '--readback', '--real-agent'].includes(mode)) throw Error('Choose an explicit local verification mode; --real-agent spends at most one run');
const root = resolve(import.meta.dirname, '..'), directory = resolve(root, '.cache/agent-local');
const state = JSON.parse(await readFile(resolve(directory, 'state.json'), 'utf8'));
const fingerprint = createHash('sha256').update(root).digest('hex').slice(0, 8);
const port = 17000 + parseInt(fingerprint.slice(0, 4), 16) % 2500 * 10, origin = 'http://127.0.0.1:' + port;
assert.equal(state.projectId, 'demo-yuyf-' + fingerprint);
const env = { NODE_ENV: 'development', YUYF_LOCAL_DEVELOPMENT: '1', HOST: '127.0.0.1', PORT: String(port),
  SERVER_ORIGIN: origin, WEB_ORIGIN: origin, GCP_PROJECT_ID: state.projectId, FIREBASE_DATABASE_ID: '(default)', FIREBASE_NAMESPACE: 'local_agent',
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:' + (port + 2), FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:' + (port + 3),
  FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:' + (port + 4), STORAGE_EMULATOR_HOST: 'http://127.0.0.1:' + (port + 4),
  FIREBASE_PHOTO_BUCKET: state.projectId + '-private', FIREBASE_ERASURE_BUCKET: state.projectId + '-journal',
  WEB_PUSH_ENABLED: 'false', ANDROID_PUSH_ENABLED: 'false', TELEGRAM_ENABLED: 'false', FIREBASE_AUTH_EMAIL_ENABLED: 'false',
};
Object.assign(process.env, env);
const steps = [], run = randomUUID(); let calls = 0, cookie = '', uid = '', database;
let agentEvidence;
async function call(path, method = 'GET', body) {
  assert.ok(++calls <= 24);
  const response = await fetch(origin + path, { method, headers: { Origin: origin, 'Content-Type': 'application/json',
    ...(cookie ? { Cookie: cookie } : {}), ...(uid ? { 'x-expected-user-id': uid } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
  return response;
}
async function json(path, method, body) {
  const response = await call(path, method, body), value = await response.json();
  assert.ok(response.ok, JSON.stringify({ path, status: response.status, code: value.code })); return value;
}
try {
  const status = await json('/__local/status'); assert.equal(status.enabled, mode === '--real-agent'); assert.equal(status.project, state.projectId);
  const proof = await fetch('http://' + env.FIREBASE_AUTH_EMULATOR_HOST + '/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=local-emulator-public-key-only', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: state.email, password: state.password, returnSecureToken: true }),
  });
  assert.equal(proof.status, 200); const token = await proof.json(); uid = token.localId;
  const exchanged = await call('/api/auth/session', 'POST', { idToken: token.idToken });
  assert.equal(exchanged.status, 200);
  cookie = exchanged.headers.getSetCookie().map(value => value.split(';', 1)[0]).join('; '); assert.ok(cookie);
  assert.ok(cookie.startsWith('__local_session_'));
  assert.deepEqual(await json('/api/admin/session'), { administrator: true });
  if (mode !== '--readback') await json('/api/account/acknowledgement', 'POST', { operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION, accepted: true });
  steps.push('emulator-login-through-production-session-and-admission');
  if (mode === '--readback') {
    const prior = JSON.parse(await readFile(resolve(directory, 'verification-readback.json'), 'utf8'));
    assert.deepEqual(await json('/api/online/operations/' + prior.run), prior.receipt);
    assert.ok(JSON.stringify(await json('/api/children')).includes('本地入口核對'));
    steps.push('restarted-auth-session-production-data-and-original-receipt-readback');
  } else {
  const command = { path: '/api/children', payload: { displayName: '本地入口核對' } };
  const context = await json('/api/online/context', 'POST', command);
  const submission = { ...command, operation: { opId: run, deviceId: randomUUID(), workspaceId: context.workspaceId, storageEpoch: context.storageEpoch } };
  const receipt = await json('/api/online/submit', 'POST', submission);
  assert.deepEqual(await json('/api/online/submit', 'POST', submission), receipt);
  const children = await json('/api/children'); assert.ok(JSON.stringify(children).includes('本地入口核對'));
  await writeFile(resolve(directory, 'verification-readback.json'), JSON.stringify({ run, receipt }), { mode: 0o600 });
  steps.push('production-save-original-operation-replay-and-readback');
  if (mode === '--real-agent') {
    const childId = children.children.find(child => child.displayName === '本地入口核對').id;
    const clientFetch = (url, init = {}) => {
      assert.ok(++calls <= 24); assert.equal(new URL(url).origin, origin);
      const headers = new Headers(init.headers); headers.set('Origin', origin); headers.set('Cookie', cookie);
      return fetch(url, { ...init, headers });
    };
    const signal = AbortSignal.timeout(330_000), progress = [];
    const chat = createChatApi(origin, async () => ({ id: uid, email: state.email, name: '本地開發帳號' }), clientFetch);
    const message = await chat.saveMessage(childId, 'BB差唔多半歲，想開始加固，應該點開始？請附官方來源，再整理一份到母嬰健康院問加固問題的準備單草稿。', signal, uid);
    // Exactly one POST. A stopped/unknown run is retained, never automatically rerun.
    const reply = await chat.requestReply(childId, message.id, signal, uid, event => progress.push(event.phase));
    const result = await createProductAgentApi(origin, clientFetch).getRun(childId, reply.agentRunId, signal, uid);
    agentEvidence = { runId: result.runId, status: result.status, stopReason: result.stopReason, counts: result.counts,
      tools: result.tools.map(tool => ({ name: tool.name, status: tool.status })),
      citations: result.citations.map(item => ({ sourceId: item.sourceId, versionId: item.versionId, chunkId: item.chunkId })), progress };
    await writeFile(resolve(directory, 'real-agent-result-' + run + '.json'), JSON.stringify({ childId, message, reply, result }, null, 2));
    assert.equal(result.status, 'completed', result.stopReason ?? 'Agent incomplete');
    assert.ok(result.citations.some(item => item.sourceId === 'fhs-solid-food'));
    const history = await chat.listMessages(childId, signal);
    assert.ok(history.messages.some(item => item.id === reply.id && item.text === reply.text));
    steps.push('same-production-client-agent-real-provider-citation-and-saved-history');
  }
  }
  if (mode === '--data-only') {
  cookie = ''; const denied = await call('/api/children'); assert.equal(denied.status, 401);
  steps.push('anonymous-data-read-rejected');
  const buckets = createLocalAgentBuckets(env), bucket = buckets(env.FIREBASE_PHOTO_BUCKET), object = 'local-verification/' + run;
  const data = Buffer.from('local encrypted-object transport fixture');
  const meta = await bucket.writeNew(object, data, { resumable: false, preconditionOpts: { ifGenerationMatch: 0 }, metadata: { contentType: 'application/octet-stream' } });
  await assert.rejects(bucket.writeNew(object, data, { resumable: false, preconditionOpts: { ifGenerationMatch: 0 } }), error => error.code === 412);
  const stream = bucket.readPinned(object, String(meta.generation)); let responseSeen = false;
  stream.once('response', () => { responseSeen = true; }); const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  assert.ok(responseSeen); assert.deepEqual(Buffer.concat(chunks), data);
  await bucket.removePinned(object, String(meta.generation));
  steps.push('emulator-object-create-only-pinned-read-and-delete');
  database = new Firestore({ projectId: state.projectId, databaseId: '(default)' });
  const vector = database.collection('local_capability_probe').doc(run);
  await vector.set({ embedding: FieldValue.vector([1, 0, 0]) });
  try {
    const result = await database.collection('local_capability_probe').findNearest('embedding', FieldValue.vector([1, 0, 0]), { limit: 1, distanceMeasure: 'COSINE' }).get();
    assert.equal(result.docs[0].id, run); steps.push('emulator-native-findNearest-supported');
  } catch (error) {
    if (error.code !== 12) throw error;
    steps.push('emulator-findNearest-unimplemented-local-candidate-adapter-required');
  }
  await vector.delete();
  }
} catch (error) {
  const evidence = { run, status: 'failed', calls, steps, agent: agentEvidence, error: String(error.message).slice(0, 300) };
  await writeFile(resolve(directory, 'verification-' + run + '.json'), JSON.stringify(evidence, null, 2));
  console.error(JSON.stringify(evidence)); process.exitCode = 1;
} finally { await database?.terminate(); }
if (!process.exitCode) {
  const evidence = { run, status: 'passed', calls, steps, modelCalls: agentEvidence?.counts.modelCalls ?? 0, agent: agentEvidence, notifications: 0,
    limitation: 'Current branch only; no four-role review, visual browser or cloud IAM acceptance' };
  await writeFile(resolve(directory, 'verification-' + run + '.json'), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence));
}
