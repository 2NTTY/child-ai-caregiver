import assert from 'node:assert/strict';
import { readFile, writeFile, lstat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve, relative, isAbsolute, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openFirebaseRuntime } from '../server/firebase-runtime.ts';
import { createFirestoreKnowledgeStore } from '../server/firestore-knowledge.ts';
import { createFirestoreKnowledgeRefresh } from '../server/firestore-knowledge-refresh.ts';
import { observationHash } from '../server/knowledge-observation.ts';
import { embeddingDocument } from '../server/knowledge-inputs.ts';
import { KNOWLEDGE_EMBEDDING } from '../src/shared/knowledge.ts';
import { createFirestoreErasureCleanup } from '../server/firestore-erasure-cleanup.ts';
import { setFirebaseBackupControl } from '../server/firestore-backup.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';

// One separately approved native data scene; synthetic vectors are not semantic retrieval evidence.
const [mode, directory] = process.argv.slice(2), run = randomUUID(), sourceId = 'f05-' + run;
const root = fileURLToPath(new URL('..', import.meta.url));
const report = { format: 1, package: 'P2-F05', run, sourceId, businessCalls: 0, maximumBusinessCalls: 110,
  models: 0, embeddings: 0, notifications: 0, deployments: 0, externalSourceFetches: 0, steps: [] };
let runtime, control, generation, outputReady = false, refresh, knowledge;
const checked = (value, code) => { if (!value) throw Error(code); };
async function call(action) { checked(++report.businessCalls <= 108, 'business_call_limit'); return action(); }
const step = value => { report.steps.push(value); console.info(JSON.stringify({ step: value })); };
const ports = () => ({ database: runtime.database, cipher: runtime.cipher, projectId: runtime.config.projectId, namespace: runtime.config.namespace });
try {
  checked(mode === '--approved-data-only', 'explicit_approval_required');
  const outside = relative(root, resolve(directory ?? '.'));
  checked(directory && isAbsolute(directory) && (outside === '..' || outside.startsWith('..' + sep) || isAbsolute(outside)), 'protected_directory_required');
  const info = await lstat(directory); checked(info.isDirectory() && !info.isSymbolicLink(), 'protected_directory_required');
  const env = { ...process.env };
  for (const line of (await readFile(join(directory, 'firebase.env'), 'utf8')).split(/\r?\n/u)) {
    if (!/^[A-Z_0-9]+=/u.test(line)) continue; const at = line.indexOf('='); env[line.slice(0, at)] = line.slice(at + 1);
  }
  checked(env.GCP_PROJECT_ID === 'ai-caregivers-for-children' && env.FIREBASE_DATABASE_ID === 'yuban-firebase-20261011'
    && env.FIREBASE_NAMESPACE === 'yuban_authority', 'approved_target_required');
  checked(process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.FIRESTORE_EMULATOR_HOST, 'native_credentials_required');
  Object.assign(env, { STORAGE_KEY_FILE: join(directory, 'storage.key'), AI_ENABLED: 'false', FIREBASE_TASK_WORKER_ENABLED: 'false' });
  outputReady = true; runtime = await openFirebaseRuntime(env);
  control = await call(() => runtime.authority.readControl()); checked(!control.enabled, 'source_must_be_paused');
  generation = randomUUID(); await call(() => setFirebaseBackupControl(ports(), { expectedGeneration: control.generation, generation, enabled: true }));
  const watch = { id: sourceId, url: 'https://www.fhs.gov.hk/' + sourceId, publisher: 'Synthetic publisher',
    termsUrl: 'https://www.fhs.gov.hk/terms', kind: 'page', classification: 'official_guidance', audience: 'public_noncommercial' };
  refresh = createFirestoreKnowledgeRefresh({ ...ports(), definitions: [watch], readControl: tx => runtime.authority.readControl(tx) });
  knowledge = createFirestoreKnowledgeStore({ ...ports(), sourceIds: [sourceId], observations: refresh.gate });
  await call(() => refresh.register(sourceId, 'f05-acceptance'));
  const observed = { url: watch.url, title: 'F05 synthetic guidance', text: 'Synthetic section one. Synthetic section two.',
    sourcePublishedAt: null, sourceUpdatedAt: null, sourceDateText: null };
  const job = (await call(() => refresh.jobs()))[0].data;
  const fetchResult = { status: 'ok', items: [observed] };
  await call(() => refresh.process(job, randomUUID(), async () => fetchResult, new AbortController().signal));
  const applicability = { region: 'HK', ageBasis: 'any', minAgeMonths: null, maxAgeMonths: null, topics: ['care'], conditions: [] };
  const document = { sourceId, url: watch.url, title: observed.title, publisher: watch.publisher, termsUrl: watch.termsUrl,
    classification: 'official_guidance', sourcePublishedAt: null, sourceUpdatedAt: null, fetchedAt: new Date().toISOString(),
    chunks: ['one', 'two'].map(key => ({ key, section: key, sourceExcerpt: 'Synthetic section ' + key + '.',
      originalText: 'Synthetic section ' + key + '.', text: 'Synthetic needle ' + key, keywords: ['合成資料'], applicability })) };
  const assessment = (doc, previous = null) => ({ comparedVersionId: previous?.versionId ?? null, comparedHash: previous?.hash ?? null,
    observationHash: observationHash(observed), changes: doc.chunks.map((chunk, index) => ({ key: chunk.key,
      oldQuote: previous ? document.chunks[index].sourceExcerpt : null, newQuote: chunk.sourceExcerpt,
      meaning: !previous ? 'new' : index === 0 ? 'changed' : 'unchanged', explanation: 'Synthetic fixture comparison, not clinical evidence' })),
    checks: { age: 'Synthetic', numbersAndUnits: 'Synthetic', timing: 'Synthetic', conditions: 'Synthetic', exceptions: 'Synthetic', prohibitions: 'Synthetic', withdrawal: 'Synthetic' },
    questions: [{ query: 'Synthetic needle', expectedKeys: ['one', 'two'], reason: 'Synthetic native index scene' }],
    growthRuleImpact: 'none', growthRuleReason: 'No product rule touched', decision: 'approve' });
  const prepare = async version => { let stage; for (let i = 0; i < 4; i++) {
    stage = await call(() => knowledge.prepareSearch(version.versionId, version.hash)); if (stage.complete) break;
  } checked(stage?.complete, 'lexical_index_incomplete'); };
  const vector = [1, ...Array(1023).fill(0)];
  const first = await call(() => knowledge.importSource(document)); await prepare(first);
  await call(() => knowledge.review(first.versionId, first.hash, 'f05-acceptance', assessment(document), { sourceId, contentHash: observationHash(observed) }));
  await call(() => knowledge.publish(first.versionId, first.hash, document.chunks.map(chunk => ({ chunkKey: chunk.key,
    inputHash: embeddingDocument(document.title, chunk.section, chunk.text).hash, ...KNOWLEDGE_EMBEDDING, values: vector }))));
  const filter = { region: 'HK', classification: 'official_guidance', age: null, ageMatch: 'unknown', topics: [] };
  const found = await call(() => knowledge.candidates(filter, vector, { query: 'needle', limit: 6 }));
  assert.equal(found.length, 2); assert.ok(found.every(row => row.versionId === first.versionId && row.sourceExcerpt.startsWith('Synthetic section')));
  const next = structuredClone(document); next.chunks[0].text += ' updated'; observed.text += ' Updated meaning.';
  await call(() => refresh.process(job, randomUUID(), async () => ({ status: 'ok', items: [observed] }), new AbortController().signal));
  assert.equal((await call(() => knowledge.candidates(filter, null, { query: 'needle', limit: 6 }))).length, 0);
  const second = await call(() => knowledge.importSource(next)); await prepare(second);
  await call(() => knowledge.review(second.versionId, second.hash, 'f05-acceptance', assessment(next, first), { sourceId, contentHash: observationHash(observed) }));
  const pending = await call(() => knowledge.missingDocuments(second.versionId)); assert.equal(pending.length, 1);
  await call(() => knowledge.embedDocument(pending[0], async () => vector));
  await call(() => knowledge.publish(second.versionId, second.hash));
  assert.equal((await call(() => knowledge.candidates(filter, vector, { query: 'updated', limit: 6 })))[0].versionId, second.versionId);
  await call(() => refresh.process(job, randomUUID(), async () => ({ status: 'failed', reason: 'network' }), new AbortController().signal));
  assert.equal((await call(() => knowledge.candidates(filter, null, { query: 'needle', limit: 6 }))).length, 2);
  await call(() => refresh.process(job, randomUUID(), async () => ({ status: 'unavailable', httpStatus: 410 }), new AbortController().signal));
  assert.equal((await call(() => knowledge.candidates(filter, vector, { query: 'needle', limit: 6 }))).length, 0);
  await call(() => knowledge.disable(sourceId, 'Synthetic F05 acceptance complete'));
  await call(() => refresh.disable(sourceId));
  step('native_vector_keyword_evidence_version_fencing_partial_vector_reuse_transient_and_unavailable');
  const accounts = ['f05-' + run + '-owner', 'f05-' + run + '-peer']; report.authorityAccounts = accounts;
  for (const userId of accounts) {
    const email = userId + '@example.test';
    await call(() => runtime.authority.issueInvitation({ email, operationId: randomUUID(), expiresAt: new Date(Date.now() + 900000).toISOString() }));
    await call(() => runtime.authority.admitIdentity({ userId, email, emailVerified: true }));
    await call(() => runtime.authority.acknowledge({ userId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION }));
  }
  const [owner, peer] = accounts;
  const command = async (path, payload) => ({ path, payload, operation: { ...await call(() => runtime.online.context(owner, { path, payload })), opId: randomUUID(), deviceId: randomUUID() } });
  const create = await command('/api/children', { displayName: 'F05 來源合成孩子' });
  const child = (await call(() => runtime.online.submit(owner, create))).result.child; report.childId = child.id;
  const path = '/api/children/' + child.id + '/inputs';
  const inputCommand = await command(path, { kind: 'personal_source', sourceLabel: 'F05 private source', sourceUrl: null, sourceDateText: null,
    sourceNotes: 'Synthetic only', text: '合成私人原文\n第二項' });
  let item = (await call(() => runtime.online.submit(owner, inputCommand))).result.input; report.inputId = item.id;
  assert.equal((await call(() => runtime.online.submit(owner, inputCommand))).result.input.id, item.id);
  const management = { intention: '合成參考', purpose: 'answer_reference', nature: 'external_material', timeScope: 'long_reference',
    validityText: '', enabled: true, modelExcerpt: '合成私人原文' };
  const manage = await command(path + '/' + item.id + '/manage', { expectedVersion: item.version, management, content: null, reason: '合成選段授權' });
  item = (await call(() => runtime.online.submit(owner, manage))).result.input;
  const old = runtime; runtime = await openFirebaseRuntime(env); await old.close();
  assert.equal((await call(() => runtime.sources.get(owner, child.id, item.id))).management.modelExcerpt, management.modelExcerpt);
  await assert.rejects(call(() => runtime.sources.get(peer, child.id, item.id)), error => [403, 404].includes(error.status));
  assert.equal((await call(() => runtime.sources.managementHistory(owner, child.id, item.id))).revisions.length, 1);
  assert.equal((await call(() => runtime.exporter.page(owner, { section: 'private_sources', childId: child.id }))).items[0].text, item.text);
  const deletion = await command(path + '/' + item.id + '/delete', { expectedVersion: item.version, confirmDelete: true });
  assert.equal((await call(() => runtime.online.submit(owner, deletion))).result.deleted, true);
  assert.equal((await call(() => runtime.online.submit(owner, manage))).result, null);
  assert.equal((await call(() => runtime.sources.list(owner, child.id))).inputs.length, 0);
  step('private_source_frontend_routes_original_receipt_consent_reconnect_isolation_export_delete');
  const erase = await command('/api/children/' + child.id + '/delete', { confirmChildId: child.id });
  await call(() => runtime.online.submit(owner, erase)); report.erasureOperationId = erase.operation.opId;
  const cleaner = createFirestoreErasureCleanup({ ...ports(), serverClock: () => Date.now() + 121000,
    journal: runtime.journal, erasures: runtime.erasures, photos: runtime.photos,
    async deleteAgentSession() { throw Error('unexpected_session'); }, async eraseAgentUserPage() { throw Error('unexpected_account'); },
    async eraseDeviceSessions() { throw Error('unexpected_account'); }, async eraseAuthUser() { throw Error('unexpected_account'); } });
  let cleaned;
  for (let page = 0; page < 40; page++) { cleaned = await call(() => cleaner.advance(owner, erase.operation.opId)); if (cleaned.state === 'completed') break; }
  checked(cleaned?.state === 'completed', 'cleanup_incomplete');
  for (const userId of accounts) await call(() => runtime.authority.setAccountState({ userId, operationId: randomUUID(), state: 'revoked' }));
  step('new_private_source_child_erased_with_journal_and_synthetic_identities_revoked');
  report.state = 'passed';
} catch (error) {
  report.state = 'failed'; report.error = { name: error?.name, code: typeof error?.code === 'string' || typeof error?.code === 'number' ? error.code : null,
    reason: error?.constructor === Error && /^[a-zA-Z0-9_-]+$/u.test(error.message) ? error.message : null,
    ...(error?.name === 'ZodError' ? { issues: error.issues.map(issue => ({ code: issue.code, path: issue.path })) } : {}) }; process.exitCode = 1;
} finally {
  if (runtime && control && generation) {
    try {
      // These two cleanup calls are reserved even after a failed assertion or exhausted business budget.
      report.businessCalls++; const current = await runtime.authority.readControl(); checked(current.generation === generation, 'control_changed');
      report.businessCalls++; await setFirebaseBackupControl(ports(), { expectedGeneration: generation, generation: randomUUID(), enabled: false });
      report.controlRestoredPaused = true;
    } catch { report.controlRestoredPaused = false; process.exitCode = 1; }
  }
  await runtime?.close();
  if (outputReady) await writeFile(join(directory, 'f05-' + run + '-result.json'), JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
  console.info(JSON.stringify({ state: report.state, steps: report.steps, businessCalls: report.businessCalls, error: report.error,
    controlRestoredPaused: report.controlRestoredPaused }));
}
