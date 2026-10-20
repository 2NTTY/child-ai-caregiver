import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID, createHash, createECDH, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { Firestore, FieldValue } from '@google-cloud/firestore';
import { createLocalAgentBuckets } from '../server/local-agent-storage.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { createChatApi } from '../src/client/chat-api.ts';
import { createProductAgentApi } from '../src/client/product-agent-api.ts';
import { createFamilyDocumentsApi } from '../src/client/family-documents-api.ts';
import { createChatFileApi } from '../src/client/chat-file-api.ts';
import { createTelegramApi } from '../src/client/telegram-api.ts';
import { createWebPushApi } from '../src/client/web-push-api.ts';

// Explicit bounded checks only; startup never runs this. --real-agent spends one run.
const mode = process.argv[2];
if (!['--data-only', '--persistence-only', '--readback', '--real-agent', '--real-compose', '--artifacts', '--deliveries'].includes(mode)) throw Error('Choose an explicit local verification mode; real modes spend at most one run');
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
const maximumCalls = mode === '--deliveries' ? 56 : 24;
let agentEvidence, originalAgent;
async function call(path, method = 'GET', body) {
  assert.ok(++calls <= maximumCalls);
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
  const status = await json('/__local/status'); assert.equal(status.enabled, ['--real-agent', '--real-compose'].includes(mode)); assert.equal(status.project, state.projectId);
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
  if (mode === '--deliveries') {
    assert.equal(status.externalDelivery, 'local-inbox-not-sent');
    const initial = await json('/__local/inbox'), initialIds = new Set(initial.deliveries.map(row => row.id));
    const signal = AbortSignal.timeout(45_000); let lastSubmission;
    const clientFetch = (url, init = {}) => {
      assert.ok(++calls <= maximumCalls); assert.equal(new URL(url).origin, origin);
      if (url.endsWith('/online/submit')) lastSubmission = JSON.parse(init.body);
      const headers = new Headers(init.headers); headers.set('Origin', origin); headers.set('Cookie', cookie);
      return fetch(url, { ...init, headers });
    };
    const telegram = createTelegramApi(origin, clientFetch), push = createWebPushApi(origin, clientFetch);
    const challenge = await telegram.begin(signal, uid), localUrl = new URL(challenge.startUrl);
    assert.equal(localUrl.origin, origin); assert.equal(localUrl.pathname, '/__local/telegram/start');
    assert.ok(++calls <= maximumCalls);
    const started = await fetch(localUrl, { method: 'POST', signal,
      headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: localUrl.searchParams.get('token') }) });
    assert.equal(started.status, 200);
    const seen = await telegram.status(signal, uid);
    assert.equal(seen.challenge.state, 'seen'); assert.notEqual(seen.binding?.status, 'active');
    const binding = await telegram.confirm(challenge.id, seen.challenge.version, signal, uid);
    const keys = createECDH('prime256v1'); keys.generateKeys();
    const subscription = await push.register({ label: 'Local inbox verification', subscription: {
      endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/local-' + run, expirationTime: null,
      keys: { p256dh: keys.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') },
    } }, signal, uid);
    const queued = await telegram.test(binding.id, binding.version, signal, uid);
    const originalSubmission = lastSubmission;
    const queuedPush = await push.test(subscription.id, subscription.version, signal, uid);
    let sent, sentPush;
    for (let probe = 0; probe < 8; probe++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      sent = (await telegram.status(signal, uid)).deliveries.find(row => row.id === queued.id);
      sentPush = (await push.status(signal, uid)).deliveries.find(row => row.id === queuedPush.id);
      if (sent?.status === 'stopped' && sentPush?.status === 'stopped') break;
    }
    for (const row of [sent, sentPush]) {
      assert.equal(row?.status, 'stopped');
      assert.equal(row.reason, 'local_preview_not_sent'); assert.equal(row.providerStatus, null);
    }
    assert.equal(sent.messageId, null); assert.equal(sent.acknowledgedAt, null);
    steps.push('formal-clients-confirm-bindings-and-worker-captures-without-provider-acceptance');
    const replay = await json('/api/online/submit', 'POST', originalSubmission);
    assert.equal(replay.result.delivery.id, queued.id);
    const inbox = await json('/__local/inbox'), added = inbox.deliveries.filter(row => !initialIds.has(row.id));
    assert.deepEqual(added.map(row => row.channel).sort(), ['telegram', 'web_push']);
    assert.ok(added.every(row => row.delivery === 'local-only-not-sent'));
    assert.ok(!JSON.stringify(added).includes('updates.push.services.mozilla.com'));
    steps.push('original-operation-replay-and-bounded-inbox-without-raw-destination');
    const revoked = await telegram.revoke(binding.id, binding.version, signal, uid);
    await push.revoke(subscription.id, subscription.version, signal, uid);
    await assert.rejects(telegram.test(binding.id, revoked.version, signal, uid), error => error.status === 409);
    assert.equal((await json('/__local/inbox')).deliveries.filter(row => !initialIds.has(row.id)).length, 2);
    steps.push('revoked-binding-cannot-add-another-preview');
  } else if (mode === '--readback') {
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
  if (mode === '--artifacts') {
    const childId = receipt.result.child.id;
    const clientFetch = (url, init = {}) => {
      assert.ok(++calls <= 24); assert.equal(new URL(url).origin, origin);
      const headers = new Headers(init.headers); headers.set('Origin', origin); headers.set('Cookie', cookie);
      return fetch(url, { ...init, headers });
    };
    const signal = AbortSignal.timeout(90_000), documents = createFamilyDocumentsApi(origin, clientFetch);
    const draft = await documents.create(childId, { kind: 'preparation', purpose: 'appointment', title: '本地到診準備',
      eventDate: null, period: { from: '2026-10-01', to: '2026-10-31' } }, signal, uid);
    const listed = await documents.getPage(childId, signal, uid);
    const changed = await documents.change(childId, draft.id, { action: 'patch', expectedVersion: draft.version,
      authorityVersion: listed.authorityVersion, confirmShared: true, edits: [{ op: 'set_metadata', title: '下次到診準備' }] }, signal, uid);
    assert.equal(changed.current.title, '下次到診準備'); assert.deepEqual(changed.current.sections, draft.current.sections);
    assert.equal((await createFamilyDocumentsApi(origin, clientFetch).getItem(childId, draft.id, signal, uid)).version, changed.version);
    await assert.rejects(documents.change(childId, draft.id, { action: 'archive', expectedVersion: draft.version,
      authorityVersion: listed.authorityVersion }, signal, uid), error => error.status === 409);
    steps.push('same-production-document-client-create-patch-readback-and-conflict');
    const bytes = Buffer.from('Local private attachment: preparation notes.\n'), fileId = randomUUID();
    const files = createChatFileApi(clientFetch, origin, async input => createHash('sha256').update(input).digest('hex'));
    const reserved = await files.reserve(childId, { opId: fileId, fileName: 'local-preparation.txt', mimeType: 'text/plain',
      bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }, signal, uid);
    const uploaded = await files.upload(reserved, bytes.toString('base64'), signal, uid);
    const reopened = await createChatFileApi(clientFetch, origin).get(childId, fileId, signal, uid);
    assert.equal(reopened.version, uploaded.version);
    assert.deepEqual(Buffer.from((await files.content(reopened, signal, uid)).bytes), bytes);
    const deleted = await files.delete(reopened, randomUUID(), signal, uid); assert.equal(deleted.deleted, true);
    await assert.rejects(files.content(reopened, signal, uid), error => error.status === 410);
    steps.push('production-encrypted-attachment-reserve-save-readback-and-delete');
  }
  if (mode === '--real-agent' || mode === '--real-compose') {
    const childId = receipt.result.child.id;
    const clientFetch = (url, init = {}) => {
      assert.ok(++calls <= 24); assert.equal(new URL(url).origin, origin);
      const headers = new Headers(init.headers); headers.set('Origin', origin); headers.set('Cookie', cookie);
      return fetch(url, { ...init, headers });
    };
    const signal = AbortSignal.timeout(330_000), progress = [];
    const chat = createChatApi(origin, async () => ({ id: uid, email: state.email, name: '本地開發帳號' }), clientFetch);
    let document;
    if (mode === '--real-compose') document = await createFamilyDocumentsApi(origin, clientFetch).create(childId,
      { kind: 'preparation', purpose: 'appointment', title: '本地到診準備', eventDate: null, period: { from: '2026-10-01', to: '2026-10-31' } }, signal, uid);
    const message = await chat.saveMessage(childId, mode === '--real-compose'
      ? '請用資料編製能力，把《本地到診準備》的標題整理為《下次到診問題》，其他內容保持不變。先讓我確認。'
      : 'BB差唔多半歲，想開始加固，應該點開始？請附官方來源，再整理一份到母嬰健康院問加固問題的準備單草稿。', signal, uid);
    originalAgent = { childId, messageId: message.id, documentId: document?.id };
    await writeFile(resolve(directory, 'original-agent-' + run + '.json'), JSON.stringify(originalAgent), { mode: 0o600 });
    // Exactly one POST. A stopped/unknown run is retained, never automatically rerun.
    const reply = await chat.requestReply(childId, message.id, signal, uid, event => progress.push(event.phase));
    const result = await createProductAgentApi(origin, clientFetch).getRun(childId, reply.agentRunId, signal, uid);
    agentEvidence = { runId: result.runId, status: result.status, stopReason: result.stopReason, counts: result.counts,
      tools: result.tools.map(tool => ({ name: tool.name, status: tool.status })),
      citations: result.citations.map(item => ({ sourceId: item.sourceId, versionId: item.versionId, chunkId: item.chunkId })), progress };
    await writeFile(resolve(directory, 'real-agent-result-' + run + '.json'), JSON.stringify({ childId, document, message, reply, result }, null, 2));
    assert.equal(result.status, 'completed', result.stopReason ?? 'Agent incomplete');
    if (mode === '--real-compose') {
      assert.ok(result.tools.some(item => item.name === 'compose_family_data' && item.status === 'succeeded'));
      assert.equal((await createFamilyDocumentsApi(origin, clientFetch).getItem(childId, document.id, signal, uid)).version, document.version);
      const proposals = result.proposals.filter(item => item.status === 'pending' && item.value.kind === 'family_document_change'
        && item.value.documentId === document.id);
      assert.equal(proposals.length, 1, 'Expected one confirmation for this synthetic document');
      const proposal = proposals[0];
      assert.equal(proposal.value.change.expectedVersion, document.version);
      assert.equal(proposal.value.change.edits.length, 1);
      const edit = proposal.value.change.edits[0];
      assert.equal(edit.op, 'set_metadata'); assert.equal(edit.title, '下次到診問題');
      for (const [key, value] of Object.entries(edit)) {
        if (key !== 'op' && key !== 'title') assert.deepEqual(value, document.current[key], 'Unrequested metadata must stay unchanged');
      }
      // Explicit synthetic acceptance only after checking the exact requested change.
      const accepted = await createProductAgentApi(origin, clientFetch).decideProposal(childId, result.runId, proposal.id,
        { expectedVersion: proposal.version, decision: 'accept', confirmShared: true }, signal, uid);
      assert.equal(accepted.status, 'accepted');
      const saved = await createFamilyDocumentsApi(origin, clientFetch).getItem(childId, document.id, signal, uid);
      assert.equal(saved.id, document.id); assert.equal(saved.current.title, '下次到診問題');
      assert.equal(saved.version, document.version + 1); assert.deepEqual(saved.current.sections, document.current.sections);
      agentEvidence.document = { id: saved.id, version: saved.version, proposalId: proposal.id, status: accepted.status };
      steps.push('real-compose-review-explicit-confirmation-and-same-document-readback');
    } else assert.ok(result.citations.some(item => item.sourceId === 'fhs-solid-food'));
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
  const evidence = { run, status: 'failed', calls, steps, agent: agentEvidence, originalAgent,
    error: String(error.message).slice(0, 300), httpStatus: error.status, code: error.code, onlineCode: error.onlineCode };
  await writeFile(resolve(directory, 'verification-' + run + '.json'), JSON.stringify(evidence, null, 2));
  console.error(JSON.stringify(evidence)); process.exitCode = 1;
} finally { await database?.terminate(); }
if (!process.exitCode) {
  const evidence = { run, status: 'passed', calls, steps, modelCalls: agentEvidence?.counts.modelCalls ?? 0, agent: agentEvidence, notifications: 0,
    limitation: 'Current branch only; no background knowledge model, visual browser or cloud IAM acceptance' };
  await writeFile(resolve(directory, 'verification-' + run + '.json'), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence));
}
