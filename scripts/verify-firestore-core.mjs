import assert from 'node:assert/strict';
import { readFile, writeFile, lstat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve, relative, isAbsolute, join, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openFirebaseRuntime } from '../server/firebase-runtime.ts';
import { setFirebaseBackupControl } from '../server/firestore-backup.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';

// One native persistence check, deliberately independent of login screens and model generation.
// Requires a separately approved data-only scope after the stopped interactive check.
const [mode, directory, previousName] = process.argv.slice(2);
const run = randomUUID(), root = fileURLToPath(new URL('..', import.meta.url));
const report = { format: 1, package: 'P2-F03', run, maximumBusinessCalls: 40,
  businessCalls: 0, modelCalls: 0, embeddings: 0, notifications: 0, deployments: 0,
  evidence: 'native Firestore adapters; synthetic authority identities; no Auth or interactive Agent acceptance', steps: [] };
let runtime, control, enabledGeneration, outputReady = false;
const controlOptions = () => ({ database: runtime.database, cipher: runtime.cipher,
  projectId: runtime.config.projectId, namespace: runtime.config.namespace });
const check = (value, code) => { if (!value) throw Error(code); };
async function call(action) { check(++report.businessCalls <= 40, 'business_call_limit'); return action(); }
const step = value => { report.steps.push(value); console.info(JSON.stringify({ step: value })); };
try {
  check(mode === '--approved-data-only', 'explicit_approval_required');
  const outside = relative(root, resolve(directory ?? '.'));
  check(directory && isAbsolute(directory) && (outside === '..' || outside.startsWith('..' + sep) || isAbsolute(outside)), 'protected_directory_required');
  const stat = await lstat(directory); check(stat.isDirectory() && !stat.isSymbolicLink(), 'protected_directory_required');
  check(/^f03-[a-f0-9-]{36}-result\.json$/u.test(previousName ?? '') && basename(previousName) === previousName, 'previous_report_required');
  const previous = JSON.parse(await readFile(join(directory, previousName), 'utf8'));
  check(previous.state === 'failed' && previous.error?.reason === 'api_400_acknowledgement' && previous.controlRestoredPaused === true
    && previous.accounts?.length === 1 && previous.modelCalls === 0 && !previous.childId, 'expected_stopped_scene_required');
  const owner = previous.accounts[0], other = 'f03-' + previous.run + '-1';
  check(owner === 'f03-' + previous.run + '-0', 'synthetic_identity_required');
  report.previousRun = previous.run; report.authorityAccounts = [owner, other];
  const env = { ...process.env };
  for (const line of (await readFile(join(directory, 'firebase.env'), 'utf8')).split(/\r?\n/u)) {
    if (!/^[A-Z_0-9]+=/u.test(line)) continue;
    const at = line.indexOf('='); env[line.slice(0, at)] = line.slice(at + 1);
  }
  check(env.GCP_PROJECT_ID === 'ai-caregivers-for-children' && env.FIREBASE_DATABASE_ID === 'yuban-firebase-20261011'
    && env.FIREBASE_NAMESPACE === 'yuban_authority', 'approved_target_required');
  check(process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.FIRESTORE_EMULATOR_HOST, 'native_credentials_required');
  Object.assign(env, { STORAGE_KEY_FILE: join(directory, 'storage.key'), AI_ENABLED: 'false', FIREBASE_TASK_WORKER_ENABLED: 'false' });
  outputReady = true; runtime = await openFirebaseRuntime(env);
  control = await call(() => runtime.authority.readControl()); check(control.enabled === false, 'source_must_be_paused');
  enabledGeneration = randomUUID();
  await call(() => setFirebaseBackupControl(controlOptions(), { expectedGeneration: control.generation, generation: enabledGeneration, enabled: true }));
  await call(() => runtime.authority.acknowledge({ userId: owner, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION }));
  const email = other + '@example.test';
  await call(() => runtime.authority.issueInvitation({ email, operationId: randomUUID(), expiresAt: new Date(Date.now() + 600_000).toISOString() }));
  await call(() => runtime.authority.admitIdentity({ userId: other, email, emailVerified: true }));
  await call(() => runtime.authority.acknowledge({ userId: other, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION }));
  async function command(path, payload) {
    return { path, payload, operation: { ...await call(() => runtime.online.context(owner, { path, payload })), opId: randomUUID(), deviceId: randomUUID() } };
  }
  const submit = value => call(() => runtime.online.submit(owner, value));
  const create = await command('/api/children', { displayName: 'F03 資料層合成孩子' });
  const child = (await submit(create)).result.child; report.childId = child.id;
  const base = '/api/children/' + child.id;
  const write = await command(base + '/messages', { text: '資料層合成原文\n 保留兩個  空格。' });
  const first = await submit(write), repeated = await submit(write);
  assert.deepEqual(repeated.result, first.result);
  const careCommand = await command(base + '/records', { text: '合成記錄：昨天 120 ml。' });
  const record = (await submit(careCommand)).result.record;
  const revise = await command(base + '/care/' + record.id + '/revise', { expectedVersion: 1, text: '合成更正：昨天約 100 ml。',
    details: record.details, source: record.source, reason: '資料層核對', confirmShared: true });
  const changed = (await submit(revise)).result.record; assert.equal(changed.version, 2);
  const stale = await command(revise.path, revise.payload);
  await assert.rejects(submit(stale), error => error?.code === 'version_conflict');
  await assert.rejects(call(() => runtime.chat.listForUser(other, child.id)), error => [403, 404].includes(error?.status));
  step('native_original_receipt_care_revision_conflict_and_account_isolation');
  const claim = await call(() => runtime.product.store.claim(owner, child.id, { kind: 'interactive', reference: first.result.message.id }, 'product-interactive'));
  report.agentRunId = claim.runId;
  const work = await call(() => runtime.product.store.saveWork(claim.scope, claim.runId, 'data-only-work', {
    operationId: randomUUID(), workId: null, expectedVersion: 0,
    values: { goal: '資料層合成接續', focus: '等待家長補充', questions: [], sourceMessageIds: [first.result.message.id],
      resources: [], pending: [], status: 'waiting', followUp: null } }));
  check(await call(() => runtime.product.store.cancelReply(owner, child.id, first.result.message.id)), 'durable_cancel_required');
  const previousRuntime = runtime; runtime = await openFirebaseRuntime(env); await previousRuntime.close();
  const messages = await call(() => runtime.chat.listForUser(owner, child.id));
  assert.equal(messages.messages.length, 1); assert.equal(messages.messages[0].text, write.payload.text);
  assert.equal((await call(() => runtime.care.get(owner, child.id, record.id))).version, 2);
  assert.equal((await call(() => runtime.product.store.readWork(owner, child.id, { workId: work.id, cursor: null }))).items[0].id, work.id);
  const same = await call(() => runtime.product.store.claim(owner, child.id, { kind: 'interactive', reference: first.result.message.id }, 'product-interactive'));
  assert.equal(same.created, false); assert.equal(same.state, 'stopped');
  step('reconnected_original_text_versions_work_and_cancelled_run');
  for (const userId of [owner, other]) await call(() => runtime.authority.setAccountState({ userId, state: 'revoked', operationId: randomUUID() }));
  report.cleanup = 'two synthetic product authorities revoked; child, original Auth fixture and encrypted history retained for F04 erasure, not a physical-erasure claim';
  report.state = 'passed';
} catch (error) {
  report.state = 'failed'; report.error = { name: error?.name, code: typeof error?.code === 'string' || typeof error?.code === 'number' ? error.code : null,
    reason: error?.constructor === Error && /^[a-zA-Z0-9_-]+$/u.test(error.message) ? error.message : null };
  process.exitCode = 1;
} finally {
  if (enabledGeneration && runtime && control) {
    try {
      const current = await call(() => runtime.authority.readControl());
      check(current.generation === enabledGeneration, 'control_changed');
      await call(() => setFirebaseBackupControl(controlOptions(), { expectedGeneration: enabledGeneration, generation: randomUUID(), enabled: false }));
      report.controlRestoredPaused = true;
    } catch { report.controlRestoredPaused = false; process.exitCode = 1; }
  }
  await runtime?.close();
  if (outputReady) await writeFile(join(directory, 'f03-core-' + run + '-result.json'), JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
  console.info(JSON.stringify({ state: report.state, steps: report.steps, businessCalls: report.businessCalls,
    modelCalls: 0, error: report.error, controlRestoredPaused: report.controlRestoredPaused }));
}
