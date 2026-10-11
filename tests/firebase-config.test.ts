import assert from 'node:assert/strict';
import test from 'node:test';
import { readFirebaseServerConfig, serverStorageBackend } from '../server/firebase-config.ts';

const env = { NODE_ENV: 'production', SERVER_ORIGIN: 'https://care.example', GCP_PROJECT_ID: 'synthetic-care-project',
  FIREBASE_DATABASE_ID: 'synthetic-care', FIREBASE_NAMESPACE: 'synthetic_care', FIREBASE_PHOTO_BUCKET: 'synthetic-care-photos', FIREBASE_ERASURE_BUCKET: 'synthetic-care-erasures' };
test('Firebase startup needs no SQL URL or Better Auth secret and requires explicit storage identities', () => {
  const config = readFirebaseServerConfig(env);
  assert.equal(config.projectId, env.GCP_PROJECT_ID);
  assert.equal(config.sessionNamespace, 'synthetic_care_sessions');
  assert.equal('databaseUrl' in config, false);
  assert.equal('authSecret' in config, false);
  for (const key of ['GCP_PROJECT_ID', 'FIREBASE_DATABASE_ID', 'FIREBASE_NAMESPACE', 'FIREBASE_PHOTO_BUCKET', 'FIREBASE_ERASURE_BUCKET']) {
    assert.throws(() => readFirebaseServerConfig({ ...env, [key]: undefined }), /Invalid/);
  }
});

test('photo and erasure buckets are explicit and different, and worker enablement defaults false', () => {
  const config = readFirebaseServerConfig(env); assert.equal(config.photoBucket, env.FIREBASE_PHOTO_BUCKET); assert.equal(config.erasureBucket, env.FIREBASE_ERASURE_BUCKET);
  assert.equal(config.taskWorkerEnabled, false); assert.equal(readFirebaseServerConfig({ ...env, FIREBASE_TASK_WORKER_ENABLED: 'true' }).taskWorkerEnabled, true);
  assert.throws(() => readFirebaseServerConfig({ ...env, FIREBASE_ERASURE_BUCKET: env.FIREBASE_PHOTO_BUCKET }), /must differ/u);
  for (const value of ['UPPERCASE', '192.168.5.4', 'goog-photo-bucket', 'abc/' , 'a'.repeat(64)]) assert.throws(() => readFirebaseServerConfig({ ...env, FIREBASE_PHOTO_BUCKET: value }), /Invalid FIREBASE_PHOTO_BUCKET/u);
  for (const value of ['TRUE', '1', '']) assert.throws(() => readFirebaseServerConfig({ ...env, FIREBASE_TASK_WORKER_ENABLED: value }), /Invalid FIREBASE_TASK_WORKER_ENABLED/u);
});
test('Firebase production rejects emulator redirection and cross-origin session deployments', () => {
  assert.throws(() => readFirebaseServerConfig({ ...env, FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }), /Emulator/);
  assert.throws(() => readFirebaseServerConfig({ ...env, FIREBASE_AUTH_EMULATOR_HOST: '' }), /Emulator/);
  assert.throws(() => readFirebaseServerConfig({ ...env, WEB_ORIGIN: 'https://other.example' }), /same-origin/);
});
test('backend selection is explicit and never silently falls back after an invalid value', () => {
  assert.equal(serverStorageBackend({}), 'postgres');
  assert.equal(serverStorageBackend({ STORAGE_BACKEND: 'firestore' }), 'firestore');
  assert.throws(() => serverStorageBackend({ STORAGE_BACKEND: 'firebase' }), /Invalid/);
});

test('Firebase email actions are explicitly configured and never claim delivery', () => {
  assert.equal(readFirebaseServerConfig(env).authEmailEnabled, false);
  assert.equal(readFirebaseServerConfig({ ...env, FIREBASE_AUTH_EMAIL_ENABLED: 'false' }).authEmailEnabled, false);
  assert.equal(readFirebaseServerConfig({ ...env, FIREBASE_AUTH_EMAIL_ENABLED: 'true' }).authEmailEnabled, true);
  for (const value of ['', 'yes', 'TRUE']) assert.throws(() => readFirebaseServerConfig({ ...env, FIREBASE_AUTH_EMAIL_ENABLED: value }), /Invalid/);
});

test('knowledge composition needs an explicit bounded source allowlist without empty or duplicate entries', () => {
  assert.equal(readFirebaseServerConfig(env).knowledgeSourceIds, null);
  assert.deepEqual(readFirebaseServerConfig({ ...env, FIREBASE_KNOWLEDGE_SOURCE_IDS: 'first-source,second-source' }).knowledgeSourceIds, ['first-source', 'second-source']);
  for (const value of ['', 'first-source,', ',first-source', 'first-source,first-source', ' first-source', 'UPPER', Array.from({ length: 11 }, (_, i) => 'source-' + i).join(',')]) {
    assert.throws(() => readFirebaseServerConfig({ ...env, FIREBASE_KNOWLEDGE_SOURCE_IDS: value }), /Invalid FIREBASE_KNOWLEDGE_SOURCE_IDS/u);
  }
});
