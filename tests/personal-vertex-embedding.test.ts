import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { GoogleAuth } from 'google-auth-library';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreModelRouting } from '../server/firestore-model-routing.ts';
import { createPersonalModelProviders } from '../server/personal-model-providers.ts';
import { handleModelSettingsRequest } from '../server/model-settings-api.ts';
import { readAiConfig } from '../server/ai-config.ts';
import { readLocalAgentModel } from '../server/local-agent-model.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { MODEL_SETTINGS_V3_MEDIA_TYPE, MODEL_SETTINGS_V4_MEDIA_TYPE, type ModelSettingsCommand } from '../src/shared/model-settings.ts';

test('personal Vertex embedding saves once, protects older clients and uses only the explicit key and target', async context => {
  const f = firestoreDomainFixture(), options = { database: f.database, cipher: createStorageCipher(Buffer.alloc(32, 19)),
    projectId: 'synthetic-data', namespace: 'synthetic_vertex_embedding' };
  const authority = createFirestoreAuthority(options);
  await authority.initializeControl({ generation: randomUUID(), enabled: true });
  for (const userId of ['owner', 'other']) {
    await authority.issueInvitation({ email: `${userId}@example.test`, expiresAt: new Date(Date.now() + 60000).toISOString(), operationId: randomUUID() });
    await authority.admitIdentity({ userId, email: `${userId}@example.test`, emailVerified: true });
    await authority.acknowledge({ userId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  }
  const config = readAiConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: 'platform-must-not-be-used' });
  const routing = createFirestoreModelRouting(options, config);
  const call = (method: string, body?: unknown, accept = MODEL_SETTINGS_V4_MEDIA_TYPE, suffix = '') =>
    handleModelSettingsRequest(new Request(`https://local.test/api/ai/settings${suffix}`, {
      method, headers: { accept, 'content-type': 'application/json', 'x-expected-user-id': 'owner' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), 'owner', routing);
  const command: ModelSettingsCommand = { opId: randomUUID(), expectedVersion: 0, mode: 'personal',
    provider: 'vertex', model: 'gemini-3.1-flash-lite', apiKey: 'synthetic-chat-key',
    embeddingProvider: 'vertex', embeddingProject: 'personal-project', embeddingLocation: 'us-central1', embeddingApiKey: 'synthetic-vector-key',
    consent: true, backgroundEnabled: true, dailyLimit: 20, maxModelCalls: 4, maxQueryEmbeddings: 2 };
  const saved = await call('POST', command);
  assert.equal(saved.status, 200);
  const state = await saved.json();
  assert.equal(state.version, 1);
  assert.equal(state.embeddingProvider, 'vertex');
  assert.equal(state.embeddingKeyConfigured, true);
  assert.equal(JSON.stringify(state).includes('synthetic-vector-key'), false);
  assert.deepEqual(await (await call('POST', command)).json(), state);
  assert.equal((await call('GET', undefined, MODEL_SETTINGS_V3_MEDIA_TYPE)).status, 409);
  const oldCommand = { opId: randomUUID(), expectedVersion: 1, mode: 'personal', provider: 'vertex', model: command.model,
    consent: true, backgroundEnabled: true, dailyLimit: 20, maxModelCalls: 4, maxQueryEmbeddings: 2 };
  assert.equal((await call('POST', oldCommand, MODEL_SETTINGS_V3_MEDIA_TYPE)).status, 409);
  assert.equal((await call('POST', { ...oldCommand, embeddingProject: 'another-project' })).status, 400);
  assert.equal((await call('POST', { ...command, opId: randomUUID() })).status, 409);
  const operation = await (await call('GET', undefined, MODEL_SETTINGS_V4_MEDIA_TYPE, `/operations/${command.opId}`)).json();
  assert.deepEqual(operation.settings, state);
  assert.equal((await routing.settings.get('other')).embeddingKeyConfigured, undefined);
  const snapshot = await routing.settings.resolve('owner');
  context.mock.method(GoogleAuth.prototype, 'getRequestHeaders', async () => { throw Error('ADC must never be requested'); });
  const calls: { url: string; headers: Headers; body: any }[] = [];
  let deny = false;
  context.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), headers: new Headers(init.headers), body: JSON.parse(String(init.body)) });
    return deny ? Response.json({ error: { code: 403, message: 'Permission denied', status: 'PERMISSION_DENIED' } }, { status: 403 })
      : Response.json({ predictions: [{ embeddings: { values: [1, ...Array(1023).fill(0)],
        statistics: { truncated: false, token_count: 2 } } }], metadata: { billableCharacterCount: 10 } });
  });
  const provider = createPersonalModelProviders(config, snapshot.apiKey!, snapshot.settings.provider,
    { ...snapshot.settings, embeddingApiKey: snapshot.embeddingApiKey });
  // Reopen the saved settings through the production router, including its personal usage ledger.
  const reopened = createFirestoreModelRouting(options, config);
  const selected = await reopened.resolve('owner', 'interactive');
  assert.equal(selected.billingSource, 'personal');
  const rootRunId = randomUUID();
  const input = { task: 'RETRIEVAL_QUERY' as const, text: 'child care' };
  const actor = { kind: 'query_embedding' as const, actorId: 'owner', operationId: rootRunId };
  const durable = { adapter: selected.dailyUsage, attemptKey: 'embedding:knowledge-search:1',
    context: { generation: 1, binding: { rootRunId, ownerId: 'owner', workspaceId: randomUUID(), childId: randomUUID(),
      authorizationVersion: '1', storageEpoch: 'synthetic-epoch', trigger: { kind: 'interactive', reference: randomUUID() },
      workflowVersion: 'synthetic-routing-v1', promptPackVersion: 'synthetic', settingsVersion: selected.settingsVersion,
      billingVersion: 'personal:v1', limits: { modelCalls: 4, toolCalls: 8, queryEmbeddings: 2 }, deadlineAtMs: Date.now() + 60000 } },
    revalidate: async () => { assert.equal(await selected.authorize(), true); } };
  const embed = () => selected.embeddings.embed(input, actor, new AbortController().signal, async () => true, durable);
  assert.equal((await embed()).length, 1024);
  const usage = (await reopened.view('owner')).usage;
  assert.equal(usage.personal.attempts, 1);
  assert.equal(usage.personal.inputTokens, 2);
  assert.equal(usage.personal.unknownUsageAttempts, 0);
  assert.equal(usage.platform.attempts, 0);
  await assert.rejects(embed(), { reason: 'unavailable' });
  assert.equal((await reopened.view('owner')).usage.personal.attempts, 1, 'original attempt cannot reserve or dispatch again');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://us-central1-aiplatform.googleapis.com/v1/projects/personal-project/locations/us-central1/publishers/google/models/gemini-embedding-001:predict');
  assert.equal(calls[0].headers.get('x-goog-api-key'), 'synthetic-vector-key');
  assert.equal(calls[0].headers.has('authorization'), false);
  assert.deepEqual(calls[0].body, { instances: [{ content: 'child care', task_type: 'RETRIEVAL_QUERY' }],
    parameters: { outputDimensionality: 1024, autoTruncate: false } });
  deny = true;
  await assert.rejects(provider.embedding.embed({ task: 'RETRIEVAL_QUERY', text: 'child care' }, new AbortController().signal), { reason: 'embedding_permission_denied' });
  assert.equal(calls.length, 2, 'provider error is not retried');
  const noKey = createPersonalModelProviders(config, 'synthetic-chat-key', 'gemini', { embeddingProvider: 'vertex',
    embeddingProject: 'personal-project', embeddingLocation: 'us-central1' });
  await assert.rejects(noKey.embedding.embed({ task: 'RETRIEVAL_QUERY', text: 'child care' }, new AbortController().signal), { reason: 'embedding_not_configured' });
  assert.equal(calls.length, 2);
  const removed = await call('POST', { ...oldCommand, opId: randomUUID(), removeEmbeddingKey: true });
  assert.equal(removed.status, 200);
  assert.equal((await removed.json()).embeddingKeyConfigured, false);
  assert.equal((await routing.settings.resolve('owner')).embeddingApiKey, null);
});

test('local Vertex vector configuration is explicit and changes the reuse binding', () => {
  const env = { YUYF_LOCAL_DEVELOPMENT: '1', AI_ENABLED: 'true', GCP_PROJECT_ID: 'demo-local', LOCAL_MODEL_PROVIDER: 'vertex',
    LOCAL_MODEL_API_KEY: 'synthetic-chat', LOCAL_MODEL_EMBEDDING_API_KEY: 'synthetic-vector',
    LOCAL_MODEL_EMBEDDING_PROVIDER: 'vertex', LOCAL_MODEL_EMBEDDING_PROJECT: 'personal-project', LOCAL_MODEL_EMBEDDING_LOCATION: 'global' };
  const result = readLocalAgentModel(env);
  assert.equal(result.embeddingConfigured, true);
  assert.notEqual(result.credentialBinding, readLocalAgentModel({ ...env, LOCAL_MODEL_EMBEDDING_LOCATION: 'us-central1' }).credentialBinding);
  assert.throws(() => readLocalAgentModel({ ...env, LOCAL_MODEL_EMBEDDING_PROJECT: undefined }), /requires its own key, project and location/);
});
