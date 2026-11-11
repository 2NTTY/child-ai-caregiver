import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { assertLocalDemoBootstrap } from '../scripts/agent-local-demo.mjs';

test('notification demo bootstrap rejects production, external projects, live models and another checkout', () => {
  const root = resolve('synthetic-demo-checkout'), project = 'demo-yuyf-' + createHash('sha256').update(root).digest('hex').slice(0, 8);
  const env = { NODE_ENV: 'development', YUYF_LOCAL_DEVELOPMENT: '1', AI_ENABLED: 'false', HOST: '127.0.0.1', PORT: '17000',
    SERVER_ORIGIN: 'http://127.0.0.1:17000', WEB_ORIGIN: 'http://127.0.0.1:17000', GCP_PROJECT_ID: project, GCLOUD_PROJECT: project,
    FIREBASE_DATABASE_ID: '(default)', FIREBASE_NAMESPACE: 'local_agent', FIREBASE_PHOTO_BUCKET: project + '-private', FIREBASE_ERASURE_BUCKET: project + '-journal',
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:17002', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:17003', FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:17004',
    STORAGE_EMULATOR_HOST: 'http://127.0.0.1:17004', WEB_PUSH_ENABLED: 'false', ANDROID_PUSH_ENABLED: 'false', TELEGRAM_ENABLED: 'false',
    FIREBASE_AUTH_EMAIL_ENABLED: 'true', YUBAN_FIREBASE_STORAGE_KEY: 'synthetic-only', LOCAL_AGENT_STATE_FILE: join(root, '.cache', 'agent-local', 'state.json') };
  const state = { format: 1, projectId: project, storageKey: env.YUBAN_FIREBASE_STORAGE_KEY, email: 'developer@local.yuyoufang.test' };
  assert.equal(assertLocalDemoBootstrap(env, root, state).projectId, project);
  for (const change of [{ NODE_ENV: 'production' }, { AI_ENABLED: 'true' }, { GCP_PROJECT_ID: 'production-project' },
    { FIRESTORE_EMULATOR_HOST: 'external.test:17002' }, { ANDROID_PUSH_ENABLED: 'true' }, { LOCAL_AGENT_STATE_FILE: join(root, 'other-state.json') }])
    assert.throws(() => assertLocalDemoBootstrap({ ...env, ...change }, root, state));
  assert.throws(() => assertLocalDemoBootstrap(env, root, { ...state, email: 'another@local.test' }));
  assert.throws(() => assertLocalDemoBootstrap(env, root + '-another', state));
});
