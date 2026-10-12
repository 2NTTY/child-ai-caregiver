import assert from 'node:assert/strict';
import { readFile, writeFile, lstat } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { resolve, relative, isAbsolute, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openFirebaseRuntime } from '../server/firebase-runtime.ts';
import { createFirestoreErasureCleanup } from '../server/firestore-erasure-cleanup.ts';
import { setFirebaseBackupControl } from '../server/firestore-backup.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';

// One explicitly approved data-only scene. No model, Auth provisioning, HTTP, notification or deployment.
const [mode, directory, previousRun] = process.argv.slice(2), run = randomUUID();
const root = fileURLToPath(new URL('..', import.meta.url)), maxCalls = mode === '--approved-resume' ? 110 : 130;
const report = { format: 1, package: 'P2-F04', run, maximumBusinessCalls: maxCalls, businessCalls: 0,
  models: 0, embeddings: 0, notifications: 0, deployments: 0, authProvisioning: 0, steps: [] };
let runtime, control, enabledGeneration, outputReady = false;
let accounts = ['f04-' + run + '-owner', 'f04-' + run + '-peer'];
const checked = (condition, code) => { if (!condition) throw Error(code); };
async function call(action) { checked(++report.businessCalls <= maxCalls, 'business_call_limit'); return action(); }
const step = value => { report.steps.push(value); console.info(JSON.stringify({ step: value })); };
const ports = () => ({ database: runtime.database, cipher: runtime.cipher, projectId: runtime.config.projectId, namespace: runtime.config.namespace });
try {
  checked(mode === '--approved-data-only' || mode === '--approved-resume', 'explicit_approval_required');
  const outside = relative(root, resolve(directory ?? '.'));
  checked(directory && isAbsolute(directory) && (outside === '..' || outside.startsWith('..' + sep) || isAbsolute(outside)), 'protected_directory_required');
  const info = await lstat(directory); checked(info.isDirectory() && !info.isSymbolicLink(), 'protected_directory_required');
  let previous;
  if (mode === '--approved-resume') {
    checked(previousRun === '9f3b3992-51ae-49ae-aabf-d28b1b5793e9', 'approved_previous_run_required');
    previous = JSON.parse(await readFile(join(directory, 'f04-' + previousRun + '-result.json'), 'utf8'));
    checked(previous.state === 'failed' && previous.error?.name === 'ZodError' && previous.businessCalls === 17
      && previous.controlRestoredPaused && previous.steps.length === 0 && previous.childId && previous.documentId,
      'previous_failure_mismatch');
    accounts = previous.authorityAccounts;
    checked(JSON.stringify(accounts) === JSON.stringify(['f04-' + previousRun + '-owner', 'f04-' + previousRun + '-peer']), 'account_binding');
    report.resumes = previousRun;
  }
  const env = { ...process.env };
  for (const line of (await readFile(join(directory, 'firebase.env'), 'utf8')).split(/\r?\n/u)) {
    if (!/^[A-Z_0-9]+=/u.test(line)) continue;
    const at = line.indexOf('='); env[line.slice(0, at)] = line.slice(at + 1);
  }
  checked(env.GCP_PROJECT_ID === 'ai-caregivers-for-children' && env.FIREBASE_DATABASE_ID === 'yuban-firebase-20261011'
    && env.FIREBASE_NAMESPACE === 'yuban_authority', 'approved_target_required');
  checked(process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.FIRESTORE_EMULATOR_HOST, 'native_credentials_required');
  Object.assign(env, { STORAGE_KEY_FILE: join(directory, 'storage.key'), AI_ENABLED: 'false', FIREBASE_TASK_WORKER_ENABLED: 'false' });
  outputReady = true; runtime = await openFirebaseRuntime(env);
  control = await call(() => runtime.authority.readControl()); checked(!control.enabled, 'source_must_be_paused');
  enabledGeneration = randomUUID();
  await call(() => setFirebaseBackupControl(ports(), { expectedGeneration: control.generation, generation: enabledGeneration, enabled: true }));
  report.authorityAccounts = accounts;
  for (const userId of previous ? [] : accounts) {
    const email = userId + '@example.test';
    await call(() => runtime.authority.issueInvitation({ email, operationId: randomUUID(), expiresAt: new Date(Date.now() + 900_000).toISOString() }));
    await call(() => runtime.authority.admitIdentity({ userId, email, emailVerified: true }));
    await call(() => runtime.authority.acknowledge({ userId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION }));
  }
  const [owner, peer] = accounts;
  async function command(path, payload) {
    return { path, payload, operation: { ...await call(() => runtime.online.context(owner, { path, payload })), opId: randomUUID(), deviceId: randomUUID() } };
  }
  const create = previous ? null : await command('/api/children', { displayName: 'F04 資料層合成孩子' });
  const child = previous ? { id: previous.childId } : (await call(() => runtime.online.submit(owner, create))).result.child;
  report.childId = child.id;
  const base = '/api/children/' + child.id;
  let document;
  if (previous) {
    document = await call(() => runtime.documents.get(owner, child.id, previous.documentId));
    checked(document?.version === 1 && document.current?.title === '合成到診準備'
      && document.current.sources.some(source => source.kind === 'record'), 'unchanged_document_required');
  } else {
    const recordInput = await command(base + '/records', { text: '合成資料：到診時帶手冊。' });
    const record = (await call(() => runtime.online.submit(owner, recordInput))).result.record;
    document = await call(() => runtime.documents.create(owner, child.id, { kind: 'preparation', purpose: 'appointment',
      title: '合成到診準備', eventDate: null, period: { from: '2026-01-01', to: '2026-12-31' } }, randomUUID()));
    checked(document?.current?.sources.some(source => source.resourceId === record.id), 'canonical_record_source_required');
  }
  report.documentId = document.id;
  const originalSections = structuredClone(document.current.sections);
  const description = await call(() => runtime.documents.describe(owner, child.id, document.id));
  const patch = { action: 'patch', confirmShared: true, expectedVersion: document.version, authorityVersion: description.authorityVersion,
    edits: [{ op: 'set_metadata', title: '合成到診準備已更正' }] }, operationId = randomUUID();
  const changed = await call(() => runtime.documents.change(owner, child.id, document.id, patch, operationId));
  assert.equal(changed.version, 2); assert.deepEqual(changed.current.sections, originalSections);
  assert.deepEqual(await call(() => runtime.documents.change(owner, child.id, document.id, patch, operationId)), changed);
  await assert.rejects(call(() => runtime.documents.change(owner, child.id, document.id, patch, randomUUID())), error => error.code === 'document_changed');
  await assert.rejects(call(() => runtime.documents.get(peer, child.id, document.id)), error => [403, 404].includes(error.status));
  const snapshot = await call(() => runtime.documents.exportSnapshot(owner, child.id, document.id, {
    snapshotId: changed.current.id, snapshotVersion: changed.current.version, authorityVersion: description.authorityVersion,
    purpose: 'family', includeSources: true, includeRevision: false }));
  assert.equal(snapshot.title, changed.current.title);
  step('document_canonical_source_patch_original_operation_conflict_isolation_and_export_snapshot');
  // Fixed synthetic PNG; no user-provided photograph or extraction.
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==', 'base64');
  const photoInput = await command(base + '/photos', { fileName: 'f04-synthetic.png', source: 'F04 synthetic data',
    mimeType: 'image/png', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  const photo = (await call(() => runtime.online.submit(owner, photoInput))).result.photo; report.photoId = photo.id;
  await call(() => runtime.photos.upload(owner, child.id, photo.id, bytes.toString('base64')));
  const old = runtime; runtime = await openFirebaseRuntime(env); await old.close();
  assert.equal((await call(() => runtime.documents.get(owner, child.id, document.id))).current.title, changed.current.title);
  const exported = await call(() => runtime.exporter.page(owner, { section: 'document_content', childId: child.id }));
  checked(exported.items.length === 1, 'persisted_document_export_required');
  const image = await call(() => runtime.exporter.page(owner, { section: 'photo_content', childId: child.id }));
  assert.equal(image.items[0].base64, bytes.toString('base64'));
  step('reconnected_document_and_private_storage_export');
  const deletion = await command(base + '/delete', { confirmChildId: child.id });
  const receipt = await call(() => runtime.online.submit(owner, deletion)); report.erasureOperationId = deletion.operation.opId;
  assert.equal(receipt.result.deleted, true);
  // No run, model or upload is in flight in this fixture; advance only the cleanup clock past the grace period.
  const cleaner = createFirestoreErasureCleanup({ ...ports(), serverClock: () => Date.now() + 121_000,
    journal: runtime.journal, erasures: runtime.erasures, photos: runtime.photos,
    async deleteAgentSession() { throw Error('unexpected_agent_session'); },
    async eraseAgentUserPage() { throw Error('unexpected_account_erasure'); },
    async eraseDeviceSessions() { throw Error('unexpected_account_erasure'); },
    async eraseAuthUser() { throw Error('unexpected_account_erasure'); } });
  let state;
  for (let page = 0; page < 85; page++) {
    state = await call(() => cleaner.advance(owner, deletion.operation.opId));
    if (state.state === 'completed') break;
  }
  checked(state?.state === 'completed', 'cleanup_incomplete');
  assert.deepEqual(await call(() => runtime.online.lookup(owner, deletion.operation.opId)), receipt);
  if (create) await assert.rejects(call(() => runtime.online.submit(owner, create)), error => error.code === 'operation_erased');
  await assert.rejects(call(() => runtime.documents.get(owner, child.id, document.id)), error => [403, 404].includes(error.status));
  step('independent_journal_physical_attachment_cleanup_and_erased_operation_barrier');
  for (const userId of accounts) await call(() => runtime.authority.setAccountState({ userId, operationId: randomUUID(), state: 'revoked' }));
  report.cleanup = 'only this synthetic child and attachment erased; minimal operation barriers and independent journal retained; two synthetic authority identities revoked; prior data unchanged';
  report.state = 'passed';
} catch (error) {
  report.state = 'failed'; report.error = { name: error?.name, code: typeof error?.code === 'string' || typeof error?.code === 'number' ? error.code : null,
    reason: error?.constructor === Error && /^[a-zA-Z0-9_-]+$/u.test(error.message) ? error.message : null,
    ...(error?.name === 'ZodError' ? { issues: error.issues.map(issue => ({ code: issue.code, path: issue.path })) } : {}) };
  process.exitCode = 1;
} finally {
  if (runtime && control && enabledGeneration) {
    try {
      const current = await call(() => runtime.authority.readControl()); checked(current.generation === enabledGeneration, 'control_changed');
      await call(() => setFirebaseBackupControl(ports(), { expectedGeneration: enabledGeneration, generation: randomUUID(), enabled: false }));
      report.controlRestoredPaused = true;
    } catch { report.controlRestoredPaused = false; process.exitCode = 1; }
  }
  await runtime?.close();
  if (outputReady) await writeFile(join(directory, 'f04-' + run + '-result.json'), JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
  console.info(JSON.stringify({ state: report.state, steps: report.steps, businessCalls: report.businessCalls,
    error: report.error, controlRestoredPaused: report.controlRestoredPaused }));
}
