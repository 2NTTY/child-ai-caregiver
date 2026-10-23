import assert from 'node:assert/strict';
import test from 'node:test';
import { assertLocalAgentEnvironment } from '../server/local-agent-config.ts';
import { readFirebaseServerConfig } from '../server/firebase-config.ts';
import { readLocalAgentModel } from '../server/local-agent-model.ts';
import { readAiConfig } from '../server/ai-config.ts';
import { createHash, randomUUID } from 'node:crypto';
import { createFirestoreModelRouting } from '../server/firestore-model-routing.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';

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

test('local compatible credentials use production routing and independent embeddings without changing policy limits', async context => {
  const env = { NODE_ENV: 'development', YUYF_LOCAL_DEVELOPMENT: '1', AI_ENABLED: 'true', GCP_PROJECT_ID: 'demo-local-model',
    LOCAL_MODEL_PROVIDER: 'openai-compatible', LOCAL_MODEL_API_KEY: 'chat-secret',
    LOCAL_MODEL_BASE_URL: 'https://models.example.test/v1', GEMINI_MODEL: 'vendor/Custom-Chat' };
  const local = readLocalAgentModel(env);
  assert.equal(local.modelConfig.localModelOverride, 'vendor/Custom-Chat');
  assert.equal(local.embeddingConfigured, false);
  assert.doesNotMatch(JSON.stringify(local), /chat-secret/);
  const f = firestoreDomainFixture(), domain = { database: f.database, cipher: createStorageCipher(Buffer.alloc(32, 29)),
    projectId: env.GCP_PROJECT_ID, namespace: 'local_agent' };
  const authority = createFirestoreAuthority(domain);
  await authority.initializeControl({ generation: randomUUID(), enabled: true });
  await authority.issueInvitation({ email: 'developer@example.test', operationId: randomUUID(), expiresAt: new Date(Date.now() + 60000).toISOString() });
  await authority.admitIdentity({ userId: 'developer', email: 'developer@example.test', emailVerified: true });
  await authority.acknowledge({ userId: 'developer', operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  const routed = await createFirestoreModelRouting(domain, local.modelConfig, local.providers).resolve('developer', 'interactive');
  assert.equal(routed.config.model, env.GEMINI_MODEL, 'The admin platform model must not overwrite the explicitly configured local model');
  assert.equal(routed.config.dailyUserAttempts, local.modelConfig.dailyUserAttempts);
  assert.equal(routed.config.dailyGlobalAttempts, local.modelConfig.dailyGlobalAttempts);
  await assert.rejects(local.providers!(routed.config).embedding.embed({ task: 'RETRIEVAL_QUERY', text: 'question' }, new AbortController().signal),
    error => (error as Error).message === 'embedding_not_configured');
  const operator = readLocalAgentModel({ ...env, LOCAL_MODEL_EMBEDDING_API_KEY: 'embedding-secret' }, { documentEmbeddings: true });
  assert.equal(operator.embeddingConfigured, true);
  assert.notEqual(operator.credentialBinding, local.credentialBinding);
  assert.notEqual(readLocalAgentModel({ ...env, LOCAL_MODEL_BASE_URL: 'https://other.example.test/v1' }).credentialBinding, local.credentialBinding);
  let calls = 0;
  context.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    calls++; assert.equal(new Headers(init.headers).get('x-goog-api-key'), 'embedding-secret');
    assert.equal(JSON.parse(String(init.body)).requests[0].taskType, 'RETRIEVAL_DOCUMENT');
    return Response.json({ error: { code: 403, message: 'permission denied' } }, { status: 403 });
  });
  await assert.rejects(operator.providers!(routed.config).embedding.embed({ task: 'RETRIEVAL_DOCUMENT', text: 'source', title: 'Title' }, new AbortController().signal),
    error => (error as Error).message === 'embedding_permission_denied');
  assert.equal(calls, 1);
  const googleEnv = { ...env, LOCAL_MODEL_PROVIDER: 'gemini', LOCAL_MODEL_BASE_URL: undefined, GEMINI_MODEL: 'gemini-3.1-flash-lite' };
  const google = readLocalAgentModel(googleEnv);
  assert.equal(google.modelConfig.localModelOverride, undefined);
  assert.equal(google.credentialBinding, createHash('sha256').update(JSON.stringify(['gemini', env.GCP_PROJECT_ID, 'chat-secret'])).digest('hex'));
  for (const override of [{ NODE_ENV: 'production' }, { LOCAL_MODEL_API_KEY: undefined }, { GEMINI_MODEL: undefined },
    { LOCAL_MODEL_BASE_URL: 'http://localhost:8080' }]) assert.throws(() => readLocalAgentModel({ ...env, ...override }));
  assert.equal(readAiConfig({ LOCAL_MODEL_OVERRIDE: 'vendor/Custom-Chat' }).localModelOverride, undefined, 'Production env has no override switch');
});
