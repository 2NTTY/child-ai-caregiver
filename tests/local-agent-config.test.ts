import assert from 'node:assert/strict';
import test from 'node:test';
import { assertLocalAgentEnvironment } from '../server/local-agent-config.ts';
import { readFirebaseServerConfig } from '../server/firebase-config.ts';

test('local entry requires isolated loopback emulators and cannot enable production delivery', () => {
  const env = { NODE_ENV: 'development', YUYF_LOCAL_DEVELOPMENT: '1', HOST: '127.0.0.1', PORT: '23000',
    SERVER_ORIGIN: 'http://127.0.0.1:23000', WEB_ORIGIN: 'http://127.0.0.1:23000',
    GCP_PROJECT_ID: 'demo-local-agent', FIREBASE_DATABASE_ID: '(default)', FIREBASE_NAMESPACE: 'local_agent',
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:23002', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:23003',
    FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:23004', STORAGE_EMULATOR_HOST: 'http://127.0.0.1:23004',
    FIREBASE_PHOTO_BUCKET: 'demo-local-agent-private', FIREBASE_ERASURE_BUCKET: 'demo-local-agent-journal',
    WEB_PUSH_ENABLED: 'false', ANDROID_PUSH_ENABLED: 'false', TELEGRAM_ENABLED: 'false', FIREBASE_AUTH_EMAIL_ENABLED: 'false',
  };
  assert.equal(assertLocalAgentEnvironment(env).projectId, 'demo-local-agent');
  assert.throws(() => assertLocalAgentEnvironment({ ...env, FIRESTORE_EMULATOR_HOST: undefined }));
  assert.throws(() => assertLocalAgentEnvironment({ ...env, FIREBASE_AUTH_EMULATOR_HOST: 'example.com:23003' }));
  assert.throws(() => assertLocalAgentEnvironment({ ...env, TELEGRAM_ENABLED: 'true' }));
  assert.throws(() => readFirebaseServerConfig({ ...env, NODE_ENV: 'production', SERVER_ORIGIN: 'https://example.com', WEB_ORIGIN: 'https://example.com' }));
});
