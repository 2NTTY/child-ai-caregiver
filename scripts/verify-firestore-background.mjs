import assert from 'node:assert/strict';
import { readFile, writeFile, lstat } from 'node:fs/promises';
import { randomUUID, randomBytes, createECDH } from 'node:crypto';
import { resolve, relative, isAbsolute, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openFirebaseRuntime } from '../server/firebase-runtime.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirestoreTaskWorker } from '../server/firestore-task-worker.ts';
import { createFirestoreWebPush } from '../server/firestore-web-push.ts';
import { createFirestoreTelegram } from '../server/firestore-telegram.ts';
import { createFirestoreContact } from '../server/firestore-contact.ts';
import { createFirestoreBackgroundQueue, prepareFirestoreBackgroundWork, firestoreBackgroundWorkSchema } from '../server/firestore-background-work.ts';
import { createFirestoreBackgroundMaintenance } from '../server/firestore-background-maintenance.ts';
import { createFirestoreErasureCleanup } from '../server/firestore-erasure-cleanup.ts';
import { FirestoreSessionService } from '../server/firestore-session-service.ts';
import { FirestoreDomainData, firestoreDomainHash, FIRESTORE_TASK_DISPATCH_SCOPE as SYSTEM } from '../server/firestore-domain-data.ts';
import { setFirebaseBackupControl } from '../server/firestore-backup.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';

// One bounded native persistence scene. Gateways are scripted: no model, provider send, Auth account or Cloud Task is created.
const [mode, directory] = process.argv.slice(2), run = randomUUID();
const root = fileURLToPath(new URL('..', import.meta.url));
const report = { format: 1, package: 'P2-F06', run, businessCalls: 0, maximumBusinessCalls: 180,
  models: 0, embeddings: 0, notifications: 0, deployments: 0, externalSourceFetches: 0, steps: [] };
const checked = (condition, code) => { if (!condition) throw Error(code); };
const step = value => { report.steps.push(value); console.info(JSON.stringify({ step: value, calls: report.businessCalls })); };
async function call(fn) { checked(++report.businessCalls <= 178, 'business_call_limit'); return fn(); }
let runtime, control, generation, outputReady = false;
const ports = () => ({ database: runtime.database, cipher: runtime.cipher, projectId: runtime.config.projectId, namespace: runtime.config.namespace });
try {
  checked(mode === '--approved-data-only', 'explicit_scope_required');
  const outside = relative(root, resolve(directory ?? '.'));
  checked(directory && isAbsolute(directory) && (outside === '..' || outside.startsWith('..' + sep) || isAbsolute(outside)), 'protected_directory_required');
  const info = await lstat(directory); checked(info.isDirectory() && !info.isSymbolicLink(), 'protected_directory_required');
  const env = { ...process.env };
  for (const line of (await readFile(join(directory, 'firebase.env'), 'utf8')).split(/\r?\n/u)) {
    if (!/^[A-Z_0-9]+=/u.test(line)) continue; const at = line.indexOf('='); env[line.slice(0, at)] = line.slice(at + 1);
  }
  checked(env.GCP_PROJECT_ID === 'ai-caregivers-for-children' && env.FIREBASE_DATABASE_ID === 'yuban-firebase-20261011'
    && env.FIREBASE_NAMESPACE === 'yuban_authority' && process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.FIRESTORE_EMULATOR_HOST, 'approved_native_target_required');
  Object.assign(env, { STORAGE_KEY_FILE: join(directory, 'storage.key'), AI_ENABLED: 'false', FIREBASE_TASK_WORKER_ENABLED: 'true', WEB_PUSH_ENABLED: 'false', TELEGRAM_ENABLED: 'false' });
  outputReady = true; runtime = await openFirebaseRuntime(env, { worker: true });
  control = await call(() => runtime.authority.readControl()); checked(!control.enabled, 'source_must_be_paused');
  generation = randomUUID(); await call(() => setFirebaseBackupControl(ports(), { expectedGeneration: control.generation, generation, enabled: true }));
  const data = new FirestoreDomainData(ports()), accounts = ['f06-' + run + '-owner', 'f06-' + run + '-peer']; report.authorityAccounts = accounts;
  const [owner, peer] = accounts;
  for (const userId of accounts) {
    const email = userId + '@example.test';
    await call(() => runtime.authority.issueInvitation({ email, operationId: randomUUID(), expiresAt: new Date(Date.now() + 1800000).toISOString() }));
    await call(() => runtime.authority.admitIdentity({ userId, email, emailVerified: true }));
    await call(() => runtime.authority.acknowledge({ userId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION }));
  }
  const currentAuth = async userId => { checked(accounts.includes(userId), 'synthetic_identity_required'); return { userId, disabled: false, emailVerified: true, email: userId + '@example.test' }; };
  const key = createECDH('prime256v1'); key.generateKeys(); let pushCalls = 0, telegramCalls = 0, lastTelegram;
  const pushGateway = { publicKey: key.getPublicKey().toString('base64url'), async send(_subscription, _payload, signal, authorize) {
    assert.ok(!signal.aborted && await authorize()); checked(++pushCalls === 1, 'unexpected_push_repeat');
    return { status: 'unknown', reason: 'transport_unknown', providerStatus: null };
  } };
  const telegramGateway = { async send(input, signal, authorize) {
    assert.ok(!signal.aborted && await authorize()); checked(++telegramCalls <= 2, 'unexpected_telegram_repeat');
    lastTelegram = input; return { status: 'accepted', reason: null, providerStatus: 200, messageId: 700 + telegramCalls };
  }, async acknowledge() { throw Error('unexpected_provider_call'); } };
  const config = { botId: '777000111', botUsername: 'f06_synthetic_bot', token: 'synthetic_not_a_token', webhookSecret: 'synthetic' };
  const push = createFirestoreWebPush({ ...ports(), enabled: true, gateway: pushGateway, currentAuth });
  const telegram = createFirestoreTelegram({ ...ports(), config, gateway: telegramGateway, currentAuth });
  const reminders = createFirestoreTaskWorker({ ...ports(), enabled: true, currentAuth });
  const contact = createFirestoreContact({ ...ports(), push, telegram, pushGateway, telegramGateway, telegramBotId: config.botId,
    growth: runtime.growth, runs: () => runtime.product.runs, currentAuth });
  const online = createFirestoreOnlineStore({ ...ports(), photos: runtime.photos, erasures: runtime.erasures, reminders,
    mutations: [runtime.chat.mutation, runtime.care.mutation, runtime.memory.mutation, runtime.sources.mutation, push.mutation, telegram.mutation, contact.mutation] });
  const command = async (path, payload) => ({ path, payload, operation: { ...await call(() => online.context(owner, { path, payload })), opId: randomUUID(), deviceId: randomUUID() } });
  const send = async (path, payload) => { const input = await command(path, payload); return call(() => online.submit(owner, input)); };
  const child = (await send('/api/children', { displayName: 'F06 背景合成孩子' })).result.child; report.childId = child.id;
  const base = '/api/children/' + child.id;
  const binding = async childId => call(() => runtime.authority.runTransaction(owner, childId, b => Promise.resolve({ scope: b.scope, authorizationVersion: b.authorizationVersion, generation: b.generation })));
  const scoped = await binding(child.id), personal = await binding(null);
  const job = async (identity) => {
    const id = firestoreDomainHash(['product-work', identity]);
    const row = await call(() => data.ref('background_work', 'background-work', id).get()); checked(row.exists, 'atomic_background_job_missing');
    return data.open('background-work', id, identity.scope, firestoreBackgroundWorkSchema, row);
  };
  const identity = (b, kind, resourceId, basis) => ({ ...b, kind, resourceId, basis });
  const request = j => ({ kind: 'product-work', id: j.id, generation: j.generation, dispatchRevision: j.dispatchRevision, scheduledAt: j.dueAt });
  const nativeSessions = new FirestoreSessionService({ ...ports(), namespace: runtime.config.namespace + '_adk' });
  const cleaner = createFirestoreErasureCleanup({ ...ports(), serverClock: () => Date.now() + 121000,
    journal: runtime.journal, erasures: runtime.erasures, photos: runtime.photos,
    deleteAgentSession: (userId, sessionId) => nativeSessions.deleteSession({ appName: 'yuban_hk', userId, sessionId }),
    async eraseAgentUserPage() { throw Error('unexpected_account'); },
    async eraseDeviceSessions() { throw Error('unexpected_account'); }, async eraseAuthUser() { throw Error('unexpected_account'); } });
  const maintenance = createFirestoreBackgroundMaintenance({ ...ports(), enabled: true, knowledge: runtime.knowledgeRefresh,
    photos: runtime.photos, erasures: runtime.erasures, cleanup: cleaner });
  const makeQueue = () => createFirestoreBackgroundQueue({ ...ports(), enabled: true, readControl: tx => runtime.authority.readControl(tx),
    transport: { async enqueue() { throw Error('unexpected_cloud_task'); }, async probe() { throw Error('unexpected_cloud_task'); } },
    async execute(j, signal) {
      if (j.kind === 'push') return push.process(j, signal);
      if (j.kind === 'telegram') return telegram.process(j, signal);
      if (j.kind === 'contact') return contact.process(j, signal);
      if (j.kind === 'child-change') { await runtime.growth.evaluate(j); return maintenance.childChange(j); }
      if (j.kind === 'document-refresh') return runtime.documents.processRefresh(j);
      if (j.kind === 'work-check') return runtime.product.continuation.check(j);
      if (j.kind === 'scope-erasure') return maintenance.process(j, signal);
      throw Error('unexpected_background_consumer');
    } });
  let queue = makeQueue();
  const registration = await command('/api/web-push/subscriptions', { label: 'F06 synthetic', subscription: {
    endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/' + run, expirationTime: null,
    keys: { p256dh: key.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } } });
  const pb = (await call(() => online.submit(owner, registration))).result.binding; report.pushBinding = pb.id;
  assert.equal((await call(() => online.submit(owner, registration))).result.binding.id, pb.id);
  const pd = (await send('/api/web-push/subscriptions/' + pb.id + '/test', { expectedVersion: pb.version, confirmImmediate: true })).result.delivery;
  const pj = await job(identity(personal, 'push', pd.id, pd.id));
  assert.equal((await call(() => queue.process(request(pj)))).state, 'unknown');
  queue = makeQueue(); assert.equal((await call(() => queue.process(request(pj)))).state, 'unknown'); assert.equal(pushCalls, 1);
  assert.equal((await call(() => push.status(owner))).deliveries[0].status, 'unknown');
  assert.equal((await call(() => push.status(peer))).bindings.length, 0);
  step('push_original_operation_unknown_receipt_reconstruction_no_resend_and_isolation');
  const pending = (await send('/api/telegram/challenges', { confirmPrivateChannel: true })).result.challenge;
  const chatId = 880000000 + parseInt(run.slice(0, 6), 16), token = new URL(pending.startUrl).searchParams.get('start');
  await call(() => telegram.webhook({ kind: 'start', updateId: chatId, chatId, senderId: chatId, token, label: 'F06 synthetic' }));
  const seen = (await call(() => telegram.status(owner))).challenge;
  const tb = (await send('/api/telegram/challenges/' + seen.id + '/confirm', { expectedVersion: seen.version, confirmAccount: true })).result.binding; report.telegramBinding = tb.id;
  const td = (await send('/api/telegram/bindings/' + tb.id + '/test', { expectedVersion: tb.version, confirmImmediate: true })).result.delivery;
  const tj = await job(identity(personal, 'telegram', td.id, td.id));
  const competition = await call(() => Promise.all([queue.process(request(tj)), makeQueue().process(request(tj))]));
  assert.ok(competition.some(v => v.state === 'completed')); assert.equal(telegramCalls, 1);
  await call(() => telegram.webhook({ kind: 'ack', updateId: chatId + 1, chatId, senderId: chatId, messageId: 701, callbackQueryId: 'synthetic', token: lastTelegram.callbackToken }));
  assert.ok((await call(() => telegram.status(owner))).deliveries[0].acknowledgedAt);
  step('telegram_confirmed_binding_two_workers_one_scripted_send_and_received_receipt');
  const prefs = await call(() => online.notificationPreferences(owner));
  await send('/api/notification-preferences', { expectedVersion: prefs.version, timeZone: 'Asia/Hong_Kong', quietStart: '22:00', quietEnd: '08:00', allowAppointmentDuringQuiet: true });
  const task = (await send(base + '/tasks', { values: { title: 'F06 合成提醒', details: '', kind: 'appointment', assigneeUserId: owner,
    dueAt: new Date(Date.now() - 1000).toISOString(), timeZone: 'Asia/Hong_Kong' }, confirm: true })).result.task; report.taskId = task.id;
  await send(base + '/contact/consent', { expectedVersion: 0, enabled: true, allowBackup: false,
    bindings: [{ channel: 'telegram', bindingId: tb.id, bindingVersion: tb.version }], confirm: true });
  const grant = (await send(base + '/contact/tasks/' + task.id + '/authorization', { expectedVersion: 0, expectedTaskVersion: task.version,
    enabled: true, allowFollowUp: false, allowFallback: false, backupUserId: null, validUntil: new Date(Date.now() + 3600000).toISOString(),
    confirm: true, content: 'generic_notice', trigger: 'task_due' })).result.grant;
  const due = await call(() => reminders.due(owner, child.id, 1)); assert.equal(due.length, 1);
  assert.equal((await call(() => reminders.process(due[0]))).state, 'processed');
  const message = (await send(base + '/messages', { text: 'F06 synthetic data-only operation' })).result.message;
  const claim = await call(() => runtime.product.store.claim(owner, child.id, { kind: 'interactive', reference: message.id }, 'product-interactive')); report.runId = claim.runId;
  const contactInput = { taskId: task.id, taskVersion: task.version, grantVersion: grant.version, recipientUserId: owner, runId: claim.runId };
  const cr = await call(() => contact.request(owner, child.id, contactInput)); report.contactRequest = cr.id;
  assert.equal((await call(() => contact.request(owner, child.id, contactInput))).id, cr.id);
  const work = await call(() => runtime.product.store.saveWork(claim.scope, claim.runId, 'synthetic-work', { operationId: randomUUID(), workId: null, expectedVersion: 0,
    values: { goal: 'F06 private pending work', focus: 'One synthetic due follow-up', questions: [], sourceMessageIds: [message.id], resources: [], pending: [], status: 'waiting',
      followUp: { reason: 'Synthetic due item', dueAt: new Date(Date.now() - 1000).toISOString(), watchResources: true, knowledgeSourceIds: [] } } })); report.workId = work.id;
  await call(() => runtime.product.store.cancelReply(owner, child.id, message.id));
  const cj = await job(identity(scoped, 'contact', cr.id, cr.id));
  const remaining = Date.parse(cj.dueAt) - Date.now(); if (remaining > 0) await new Promise(resolve => setTimeout(resolve, Math.min(31000, remaining + 50)));
  assert.equal((await call(() => queue.process(request(cj)))).state, 'completed'); assert.equal(telegramCalls, 2);
  assert.equal((await call(() => contact.page(owner, child.id))).requests[0].state, 'accepted');
  await send(base + '/tasks/' + task.id + '/change', { action: 'complete', expectedVersion: task.version, confirm: true, note: 'Synthetic completion' });
  assert.equal((await call(() => makeQueue().process(request(cj)))).state, 'completed'); assert.equal(telegramCalls, 2);
  step('due_reminder_consent_grant_contact_original_receipt_and_terminal_no_resend');
  const wj = await job(identity(scoped, 'work-check', work.id, 'version:1'));
  assert.equal((await call(() => queue.process(request(wj)))).state, 'completed');
  const projected = await call(() => runtime.product.store.readWork(owner, child.id, { workId: work.id, cursor: null }));
  assert.equal(projected.items[0].latestFollowUp.state, 'queued');
  const eventId = projected.items[0].latestFollowUp.eventId, follow = await job(identity(scoped, 'work-continuation', eventId, eventId));
  const context = await call(() => runtime.authority.runTransaction(owner, child.id, b => runtime.product.continuation.input(b, follow)));
  assert.ok(context); assert.equal((await call(() => runtime.product.continuation.finish(follow))).state, 'stopped');
  step('private_due_work_context_persisted_and_absent_model_run_not_claimed_success');
  const concern = await call(() => runtime.concerns.create(owner, child.id, { title: 'F06 合成關注', reason: 'Synthetic', observation: 'Synthetic observation',
    observedAt: new Date().toISOString(), links: { recordId: null, taskId: task.id, attentionId: null }, followUpAt: new Date(Date.now() + 10000).toISOString() }, randomUUID()));
  const cp = await call(() => runtime.concerns.list(owner, child.id));
  await call(() => runtime.concerns.change(owner, child.id, concern.id, { action: 'archive', expectedVersion: concern.version, authorityVersion: cp.authorityVersion, confirm: true }, randomUUID()));
  const oldConcernJob = await job(identity(scoped, 'concern', concern.id, concern.followUp.id));
  assert.equal(await call(() => runtime.concerns.beginBackground(oldConcernJob)), null);
  const document = await call(() => runtime.documents.create(owner, child.id, { kind: 'growth_report', purpose: 'family', title: 'F06 成長合成資料', eventDate: null,
    period: { from: '2026-01-01', to: '2026-12-31' } }, randomUUID())); report.documentId = document.id;
  const recordCommand = await command(base + '/records', { text: 'F06 synthetic source update' });
  await call(() => online.submit(owner, recordCommand));
  const change = await job(identity(scoped, 'child-change', child.id, 'care:' + recordCommand.operation.opId));
  assert.equal((await call(() => queue.process(request(change)))).state, 'completed');
  const dj = await job(identity(scoped, 'document-refresh', document.id, 'change:' + change.id));
  assert.equal((await call(() => queue.process(request(dj)))).state, 'completed');
  const fresh = await call(() => runtime.documents.get(owner, child.id, document.id)); assert.ok(fresh.version > document.version);
  await assert.rejects(call(() => runtime.concerns.list(peer, child.id)), e => [403, 404].includes(e.status));
  step('concern_archive_stops_followup_child_change_refreshes_same_document_and_isolates');
  await send('/api/web-push/subscriptions/' + pb.id + '/revoke', { expectedVersion: pb.version });
  await send('/api/telegram/bindings/' + tb.id + '/revoke', { expectedVersion: tb.version });
  const erase = await command(base + '/delete', { confirmChildId: child.id }); await call(() => online.submit(owner, erase)); report.erasureOperationId = erase.operation.opId;
  const erasures = [{ userId: owner, opId: erase.operation.opId },
    { userId: 'f05-c984f42b-c281-410e-b23d-2824913fefe6-owner', opId: '2cc357cf-6a08-4434-a6f4-17f7395ec47f' }];
  for (const target of erasures) {
    const row = await call(() => runtime.database.runTransaction(tx => runtime.erasures.read(tx, target.userId, target.opId)));
    checked(row && row.intent.scope.ownerUserId === target.userId && row.intent.type === 'child-delete', 'original_erasure_required');
    const erasureId = JSON.stringify([target.userId, target.opId]);
    const resourceId = data.ref('erasures', 'scope-erasure', erasureId).id;
    const descriptor = { kind: 'scope-erasure', scope: SYSTEM, resourceId, basis: firestoreDomainHash(erasureId), generation, authorizationVersion: '0' };
    await call(() => runtime.database.runTransaction(async tx => { const queued = await prepareFirestoreBackgroundWork(data, tx, descriptor, new Date().toISOString()); queued.commit(); }));
    const ej = await job(descriptor); let done;
    // Resume each existing cursor, eight bounded pages per invocation, no repeated fixture creation.
    for (let i = 0; i < 20; i++) {
      done = await call(() => maintenance.process(ej, new AbortController().signal));
      console.info(JSON.stringify({ cleanup: target.userId === owner ? 'current-scene' : 'original-f05', pageGroup: i + 1, state: done.state, calls: report.businessCalls }));
      if (done.state === 'completed') break;
    }
    checked(done?.state === 'completed', 'erasure_remaining');
  }
  for (const userId of accounts) await call(() => runtime.authority.setAccountState({ userId, operationId: randomUUID(), state: 'revoked' }));
  step('current_synthetic_child_and_original_f05_cleanup_completed_bindings_and_authorities_revoked');
  report.state = 'passed'; report.scriptedPushCalls = pushCalls; report.scriptedTelegramCalls = telegramCalls;
} catch (error) {
  report.state = 'failed'; report.error = { name: error?.name, code: typeof error?.code === 'string' || typeof error?.code === 'number' ? error.code : null,
    location: error?.stack?.split('\n').filter(line => line.includes('/server/') || line.includes('/scripts/')).slice(0, 3),
    reason: error?.constructor === Error && /^[a-zA-Z0-9_-]+$/u.test(error.message) ? error.message : null,
    ...(error?.name === 'ZodError' ? { issues: error.issues.map(issue => ({ code: issue.code, path: issue.path })) } : {}) };
  process.exitCode = 1;
} finally {
  if (runtime && control && generation) try {
    report.businessCalls++; const current = await runtime.authority.readControl(); checked(current.generation === generation, 'control_changed');
    report.businessCalls++; await setFirebaseBackupControl(ports(), { expectedGeneration: generation, generation: randomUUID(), enabled: false }); report.controlRestoredPaused = true;
  } catch { report.controlRestoredPaused = false; process.exitCode = 1; }
  await runtime?.close();
  if (outputReady) await writeFile(join(directory, 'f06-' + run + '-result.json'), JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
  console.info(JSON.stringify({ run, state: report.state, steps: report.steps, businessCalls: report.businessCalls, error: report.error, controlRestoredPaused: report.controlRestoredPaused }));
}
