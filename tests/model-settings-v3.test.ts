import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { handleModelSettingsRequest } from '../server/model-settings-api.ts';
import { ModelSettingsError } from '../server/model-settings-contract.ts';
import { MODEL_SETTINGS_V3_MEDIA_TYPE as MODEL_SETTINGS_MEDIA_TYPE, PERSONAL_MODEL, type ModelSettings, type ModelSettingsCommand, type ModelSettingsOperation } from '../src/shared/model-settings.ts';

test('v3 settings preserve v2 Google clients and protect new settings from old writes', async () => {
  const v2 = 'application/vnd.yuyoufang.model-settings.v2+json';
  const opId = 'f59ee9dc-25b2-4c89-b564-84ea8558ed6c';
  let state: ModelSettings = { version: 0, mode: 'platform', provider: 'gemini', model: PERSONAL_MODEL,
    keyConfigured: false, embeddingKeyConfigured: false, backgroundEnabled: false, dailyLimit: 100,
    maxModelCalls: 4, maxQueryEmbeddings: 2, updatedAt: null };
  const operations = new Map<string, ModelSettingsOperation>();
  let writes = 0;
  const routing: Parameters<typeof handleModelSettingsRequest>[2] = {
    settings: {
      async get() { return state; },
      async save(_userId, command, client) {
        if (client?.maxSettingsVersion === 2 && (state.provider === 'openai-compatible' || state.embeddingKeyConfigured))
          throw new ModelSettingsError('client_update_required', 409);
        if (command.expectedVersion !== state.version) throw new ModelSettingsError('version_conflict', 409);
        writes++;
        const provider = command.provider ?? state.provider;
        state = { ...state, version: state.version + 1, mode: command.mode, provider, model: command.model ?? state.model,
          ...(provider === 'openai-compatible' ? { baseUrl: command.baseUrl } : { baseUrl: undefined }),
          keyConfigured: command.removeKey ? false : Boolean(command.apiKey || state.keyConfigured),
          embeddingKeyConfigured: command.removeEmbeddingKey ? false : Boolean(command.embeddingApiKey || state.embeddingKeyConfigured) };
        if (command.opId) operations.set(command.opId, { opId: command.opId, settings: state });
        return state;
      },
      async resolve() { throw new Error('Public API must not resolve credentials'); },
      async isCurrent(_userId, version) { return version === state.version; },
      async getOperation(_userId, id) { return operations.get(id) ?? null; },
    },
    async view() {
      const usage = { day: '2026-10-23', attempts: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, unknownUsageAttempts: 0 };
      return { settings: state, enabled: true, platformAvailable: true, personalAvailable: true,
        personalGlobalLimit: 1000, usage: { platform: usage, personal: usage } };
    },
    async check() { return { version: state.version, status: 'unavailable', scope: 'model_metadata_only', reason: 'metadata_unsupported' }; },
    async catalog(_userId, version, _refresh, _signal, provider = state.provider) {
      return { version, provider, models: [], scope: 'model_metadata_only', status: 'unavailable',
        reason: 'metadata_unsupported', truncated: false, embedding: { model: 'embedding', dimensions: 1024, status: 'unsupported' } };
    },
  };
  const call = (method: string, suffix = '', body?: unknown, accept?: string) => handleModelSettingsRequest(
    new Request('https://local.test/api/ai/settings' + suffix, { method,
      headers: { 'x-expected-user-id': 'owner', 'content-type': 'application/json', ...(accept ? { accept } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), 'owner', routing);
  const command: ModelSettingsCommand = { opId, expectedVersion: 0, mode: 'personal', provider: 'vertex', model: 'gemini-future-chat',
    apiKey: 'short-key', backgroundEnabled: false, dailyLimit: 100, maxModelCalls: 4, maxQueryEmbeddings: 2, consent: true };
  assert.equal((await call('GET')).status, 200);
  assert.equal('embeddingKeyConfigured' in (await (await call('GET', '', undefined, v2)).json()).settings, false);
  assert.equal((await call('POST', '', { ...command, opId: undefined }, v2)).status, 400);
  assert.equal((await call('POST', '', { ...command, removeEmbeddingKey: false }, v2)).status, 409);
  assert.equal((await call('POST', '', command, v2)).status, 200);
  assert.equal((await (await call('GET', '/operations/' + opId, undefined, v2)).json()).settings.provider, 'vertex');
  const catalog = await (await call('GET', '/models?provider=vertex', undefined, v2)).json();
  assert.equal(catalog.provider, 'vertex'); assert.equal(catalog.reason, 'metadata_unsupported');
  assert.equal((await call('GET', '/models?provider=openai-compatible', undefined, v2)).status, 400);
  assert.equal((await call('GET', '/models?provider=openai-compatible', undefined, MODEL_SETTINGS_MEDIA_TYPE)).status, 200);

  const compatible = { ...command, opId: randomUUID(), expectedVersion: 1, provider: 'openai-compatible', model: 'custom-chat',
    baseUrl: 'https://models.example.test/v1', apiKey: 'a', embeddingApiKey: 'b' };
  assert.equal((await call('POST', '', { ...compatible, opId: undefined }, MODEL_SETTINGS_MEDIA_TYPE)).status, 400);
  const saved = await call('POST', '', compatible, MODEL_SETTINGS_MEDIA_TYPE);
  assert.equal(saved.status, 200); assert.equal(writes, 2);
  const operation = await (await call('GET', '/operations/' + compatible.opId, undefined, MODEL_SETTINGS_MEDIA_TYPE)).json();
  assert.equal(operation.settings.baseUrl, compatible.baseUrl); assert.equal(operation.settings.embeddingKeyConfigured, true);
  assert.doesNotMatch(JSON.stringify(operation), /apiKey|embeddingApiKey|ciphertext|fingerprint/);
  for (const accept of [undefined, v2]) {
    for (const [method, suffix, body] of [['GET', '', undefined], ['POST', '/check', { expectedVersion: 2 }],
      ['POST', '', { ...command, expectedVersion: 2, ...(accept ? {} : { opId: undefined, provider: undefined, model: undefined }) }]] as const) {
      const response = await call(method, suffix, body, accept);
      assert.equal(response.status, 409); assert.equal((await response.json()).error.code, 'client_update_required');
    }
  }
  assert.equal((await call('GET', '/operations/' + compatible.opId, undefined, v2)).status, 409);
  assert.equal((await call('GET', '/models', undefined, v2)).status, 409); assert.equal(writes, 2);
  assert.equal((await call('POST', '', { ...command, opId: randomUUID(), expectedVersion: 2 }, MODEL_SETTINGS_MEDIA_TYPE)).status, 200);
  assert.equal((await call('GET', '', undefined, v2)).status, 409, 'A separate embedding key also requires v3 for Google settings');
  assert.equal((await call('POST', '', { ...command, opId: randomUUID(), expectedVersion: 3, removeEmbeddingKey: true }, MODEL_SETTINGS_MEDIA_TYPE)).status, 200);
  assert.equal((await call('GET', '', undefined, v2)).status, 200);
});
