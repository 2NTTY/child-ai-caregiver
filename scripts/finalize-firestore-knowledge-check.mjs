import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openFirebaseRuntime } from '../server/firebase-runtime.ts';
import { FirestoreDomainData } from '../server/firestore-domain-data.ts';
import { setFirebaseBackupControl } from '../server/firestore-backup.ts';

// Finish only the original F05 batch's remaining safety obligations; combined limit stays 110.
const [mode, directory, file] = process.argv.slice(2);
assert.equal(mode, '--remaining-approved-budget');
assert.match(file ?? '', /^f05-[0-9a-f-]{36}-result\.json$/u);
const prior = JSON.parse(await readFile(join(directory, file), 'utf8'));
assert.equal(prior.package, 'P2-F05'); assert.equal(prior.state, 'failed');
assert.equal(prior.error?.reason, 'cleanup_incomplete'); assert.equal(prior.controlRestoredPaused, true);
assert.equal(prior.maximumBusinessCalls, 110); assert.ok(prior.businessCalls <= 103);
assert.match(prior.inputId, /^[0-9a-f-]{36}$/u); assert.equal(prior.authorityAccounts.length, 2);
assert.ok(prior.authorityAccounts.every(id => id.startsWith('f05-' + prior.run + '-')));
const report = { package: 'P2-F05', resumedRun: prior.run, scope: 'remaining-budget-safety-closeout',
  priorBusinessCalls: prior.businessCalls, businessCalls: 0, maximumCombinedBusinessCalls: 110,
  models: 0, embeddings: 0, notifications: 0, deployments: 0 };
let runtime, control, generation;
async function call(fn) { assert.ok(prior.businessCalls + ++report.businessCalls <= 108); return fn(); }
const ports = () => ({ database: runtime.database, cipher: runtime.cipher, projectId: runtime.config.projectId, namespace: runtime.config.namespace });
try {
  const env = { ...process.env };
  for (const line of (await readFile(join(directory, 'firebase.env'), 'utf8')).split(/\r?\n/u)) {
    if (!/^[A-Z_0-9]+=/u.test(line)) continue;
    const at = line.indexOf('='); env[line.slice(0, at)] = line.slice(at + 1);
  }
  assert.equal(env.GCP_PROJECT_ID, 'ai-caregivers-for-children'); assert.equal(env.FIREBASE_DATABASE_ID, 'yuban-firebase-20261011');
  assert.equal(env.FIREBASE_NAMESPACE, 'yuban_authority'); assert.ok(env.GOOGLE_APPLICATION_CREDENTIALS); assert.ok(!env.FIRESTORE_EMULATOR_HOST);
  Object.assign(env, { STORAGE_KEY_FILE: join(directory, 'storage.key'), AI_ENABLED: 'false', FIREBASE_TASK_WORKER_ENABLED: 'false' });
  runtime = await openFirebaseRuntime(env); control = await call(() => runtime.authority.readControl()); assert.equal(control.enabled, false);
  generation = randomUUID(); await call(() => setFirebaseBackupControl(ports(), { expectedGeneration: control.generation, generation, enabled: true }));
  const data = new FirestoreDomainData(ports()), id = prior.inputId;
  const references = [data.ref('shared_inputs', 'shared-input', id),
    ...Array.from({ length: 4 }, (_, index) => data.ref('shared_input_parts', 'shared-input-part', JSON.stringify([id, index]))),
    data.ref('shared_input_management_revisions', 'shared-input-management', JSON.stringify([id, 2]))];
  const snapshots = await call(() => runtime.database.getAll(...references));
  assert.ok(snapshots.every(row => !row.exists)); report.newPrivateSourceDataErased = true;
  for (const userId of prior.authorityAccounts) await call(() => runtime.authority.setAccountState({ userId, operationId: randomUUID(), state: 'revoked' }));
  report.syntheticIdentitiesRevoked = true;
  report.genericErasureJob = 'remaining-collection-stages-pending-F06';
  report.state = 'passed';
} catch (error) {
  report.state = 'failed'; report.error = { name: error?.name, code: error?.code ?? null }; process.exitCode = 1;
} finally {
  if (runtime && generation) {
    try {
      report.businessCalls++; const current = await runtime.authority.readControl(); assert.equal(current.generation, generation);
      report.businessCalls++; await setFirebaseBackupControl(ports(), { expectedGeneration: generation, generation: randomUUID(), enabled: false });
      report.controlRestoredPaused = true;
    } catch { report.controlRestoredPaused = false; process.exitCode = 1; }
  }
  await runtime?.close(); report.combinedBusinessCalls = prior.businessCalls + report.businessCalls;
  await writeFile(join(directory, 'f05-' + prior.run + '-closeout.json'), JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
  console.info(JSON.stringify(report));
}
