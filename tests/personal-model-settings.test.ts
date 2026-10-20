import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ApiError } from '@google/genai';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreModelRouting } from '../server/firestore-model-routing.ts';
import { handleModelSettingsRequest } from '../server/model-settings-api.ts';
import { createModelSettingsApi } from '../src/client/model-settings-api.ts';
import { readAiConfig } from '../server/ai-config.ts';
import { createGeminiKeyProviders } from '../server/gemini-key-provider.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { MODEL_SETTINGS_MEDIA_TYPE, type ModelSettingsCommand } from '../src/shared/model-settings.ts';
import { restoreOperationRecord } from '../server/firestore-restore-operation-records.ts';
import { FirestoreDomainData } from '../server/firestore-domain-data.ts';
import { openRecoveryEnvelope } from '../server/firestore-recovery-envelope.ts';
import { FIREBASE_BACKUP_COLLECTION_SUFFIXES } from '../server/firestore-backup.ts';
import { resolvePersonalModelLimits } from '../server/personal-model-policy.ts';
import { platformPolicySchema } from '../src/shared/admin.ts';

const config = readAiConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: 'synthetic-personal' });
const key = 'synthetic-personal-key-not-a-credential';
test('personal settings share policy, recover the original write, isolate accounts and retain legacy HTTP', async () => {
  const f = firestoreDomainFixture(), options = { database: f.database, cipher: createStorageCipher(Buffer.alloc(32, 23)),
    projectId: 'synthetic-personal', namespace: 'synthetic_personal' };
  const authority = createFirestoreAuthority(options);
  await authority.initializeControl({ generation: randomUUID(), enabled: true });
  for (const userId of ['owner', 'other']) {
    await authority.issueInvitation({ email: userId + '@example.test', expiresAt: new Date(Date.now() + 60000).toISOString(), operationId: randomUUID() });
    await authority.admitIdentity({ userId, email: userId + '@example.test', emailVerified: true });
    await authority.acknowledge({ userId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  }
  let platformSelected = 0;
  const routing = createFirestoreModelRouting(options, config, selected => { platformSelected++; return createGeminiKeyProviders(selected, key); });
  const call = (method: string, suffix = '', body?: unknown, user = 'owner', v2 = true) => handleModelSettingsRequest(new Request('https://local.test/api/ai/settings' + suffix, {
    method, headers: { accept: v2 ? MODEL_SETTINGS_MEDIA_TYPE : 'application/json', 'content-type': 'application/json', 'x-expected-user-id': user },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), user, routing);
  const before = await routing.view('owner');
  const client = createModelSettingsApi('https://local.test', async (url, init) =>
    handleModelSettingsRequest(new Request(url, init), 'owner', routing));
  const choices = await client.catalog(0, false, new AbortController().signal, 'owner', 'vertex');
  assert.equal(choices.provider, 'vertex');
  assert.deepEqual(choices.models.map(model => model.id), ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro']);
  assert.equal(choices.status, 'not_checked');
  assert.deepEqual(await routing.view('owner'), before, 'Reading a different provider catalog must not change settings, usage or credentials');
  assert.equal((await call('GET', '/models?provider=vertex&provider=gemini')).status, 400);
  const policy = platformPolicySchema.parse({ version: 0, enabled: true, model: config.model,
    dailyUserAttempts: 12, dailyGlobalAttempts: 20, personalDailyGlobalAttempts: 1000,
    maxModelCalls: 4, maxQueryEmbeddings: 2, maxToolCalls: 16, maxRunSeconds: 300, modelRequestSeconds: 90, maxModelRetries: 3, updatedAt: null });
  assert.equal(resolvePersonalModelLimits({ ...before.settings, mode: 'personal', maxModelCalls: 8 }, policy).maxModelCalls, 8);
  assert.equal(resolvePersonalModelLimits({ ...before.settings, mode: 'personal', maxModelCalls: 8, limitPolicyVersion: 2 }, policy).maxModelCalls, 4);
  const command: ModelSettingsCommand = { opId: randomUUID(), expectedVersion: 0, mode: 'personal', provider: 'gemini', model: 'gemini-2.5-flash',
    apiKey: key, dailyLimit: 200, maxModelCalls: 12, maxQueryEmbeddings: 6, maxToolCalls: 5, maxRunSeconds: 60,
    modelRequestSeconds: 15, maxModelRetries: 1, backgroundEnabled: false, consent: true };
  f.loseReply();
  assert.equal((await call('POST', '', command)).status, 503);
  const recovered = await (await call('GET', '/operations/' + command.opId)).json();
  assert.equal(recovered.opId, command.opId); assert.equal(recovered.settings.version, 1);
  assert.equal(recovered.settings.model, 'gemini-2.5-flash');
  assert.deepEqual(await (await call('POST', '', command)).json(), recovered.settings);
  assert.equal((await call('POST', '', { ...command, dailyLimit: 201 })).status, 409);
  assert.equal((await call('POST', '', { ...command, opId: randomUUID() })).status, 409);
  assert.equal(await (await call('GET', '/operations/' + command.opId, undefined, 'other')).json(), null);
  const view = await routing.view('owner'), selected = await routing.resolve('owner', 'interactive');
  assert.equal(selected.config.model, command.model); assert.equal(selected.config.timeoutMs, 15000);
  assert.equal(selected.config.agentMaxRetries, 1); assert.equal(selected.billingSource, 'personal');
  assert.equal(selected.runLimits.modelCalls, Math.min(command.maxModelCalls, before.effective!.maxModelCalls));
  assert.equal(selected.runLimits.toolCalls, 5); assert.equal(selected.runLimits.deadlineMs, 60000);
  assert.deepEqual(view.usage, before.usage); assert.equal(platformSelected, 0);
  assert.equal((await routing.resolve('owner', 'worker')).config.enabled, false);
  assert.equal((await call('GET', '', undefined, 'owner', false)).status, 409);
  const legacy = await (await call('GET', '', undefined, 'other', false)).json();
  assert.equal('effective' in legacy, false); assert.equal('maxToolCalls' in legacy.settings, false);
  assert.equal((await call('POST', '', { ...command, opId: randomUUID(), expectedVersion: 1, provider: 'vertex', apiKey: undefined })).status, 400);
  await assert.rejects(routing.settings.save('owner', { ...command, opId: randomUUID(), expectedVersion: 1,
    provider: 'vertex', model: 'gemini-3.1-flash-lite', apiKey: key + '-vertex' }), { code: 'model_unsupported' });
  assert.equal((await routing.settings.get('owner')).version, 1);
  const vertex = await routing.settings.save('owner', { ...command, opId: randomUUID(), expectedVersion: 1, provider: 'vertex',
    model: 'gemini-2.5-pro', apiKey: key + '-vertex' });
  assert.equal(vertex.version, 2); assert.equal(vertex.provider, 'vertex');
  assert.equal((await routing.catalog('owner', 2, false, new AbortController().signal)).embedding.status, 'unsupported');
  const { apiKey: ignoredKey, ...withoutKey } = command;
  const removed = await routing.settings.save('owner', { ...withoutKey, opId: randomUUID(), expectedVersion: 2,
    mode: 'disabled', model: 'gemini-3.1-flash-lite', removeKey: true, backgroundEnabled: false, consent: false });
  assert.equal(removed.keyConfigured, false);
  assert.equal((await routing.settings.resolve('owner')).apiKey, null);
  const operation = [...f.records.entries()].find(([path]) => path.includes('_model_settings_operations/'))!;
  assert.doesNotMatch(JSON.stringify([...f.records.values()]), /synthetic-personal-key-not-a-credential/);
  assert.doesNotMatch(JSON.stringify(recovered), /apiKey|fingerprint|ciphertext/);
  assert.ok(FIREBASE_BACKUP_COLLECTION_SUFFIXES.includes('_model_settings_operations'));
  const opened = openRecoveryEnvelope({ ...options, envelope: { family: 'domain', version: 1,
    recordVersion: operation[1].recordVersion, ciphertext: operation[1].ciphertext }, locator: operation[1].recovery });
  assert.equal(opened.context.kind, 'model-settings-operation');
  restoreOperationRecord(new FirestoreDomainData(options), { ...opened.context, kind: 'model-settings-operation' }, opened.value as never);
});

test('Google personal adapters use the chosen protocol, bounded catalog and no platform fallback', async context => {
  const calls: { url: URL; body: any }[] = [];
  let response: unknown = { candidates: [{ content: { role: 'model', parts: [{ text: 'Synthetic answer' }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 1, totalTokenCount: 2 } };
  let status = 200;
  context.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: new URL(url instanceof Request ? url.url : String(url)), body: init.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify(response), { status, headers: { 'content-type': 'application/json' } });
  });
  const input = { systemInstruction: 'Synthetic instruction', messages: [{ role: 'user' as const, text: 'Hello' }] };
  const signal = new AbortController().signal;
  const gemini = createGeminiKeyProviders({ ...config, model: 'gemini-2.5-flash' }, key);
  await gemini.model.generate(input, { signal, maxOutputTokens: 100 });
  assert.equal(calls[0].url.origin, 'https://generativelanguage.googleapis.com');
  assert.deepEqual(calls[0].body.generationConfig.thinkingConfig, { thinkingBudget: 0 });
  const vertex = createGeminiKeyProviders({ ...config, model: 'gemini-2.5-pro' }, key, 'vertex');
  await vertex.model.generate(input, { signal, maxOutputTokens: 100 });
  assert.equal(calls[1].url.origin, 'https://aiplatform.googleapis.com');
  assert.equal(calls[1].url.pathname, '/v1/publishers/google/models/gemini-2.5-pro:generateContent');
  assert.equal(calls[1].url.searchParams.has('key'), false);
  assert.deepEqual(calls[1].body.generationConfig.thinkingConfig, { thinkingBudget: -1 });
  const count = calls.length;
  assert.equal((await vertex.inspect(signal)).reason, 'metadata_unsupported');
  await assert.rejects(vertex.embedding.embed({ task: 'RETRIEVAL_QUERY', text: 'Synthetic' }, signal), { code: 'unavailable' });
  assert.equal(calls.length, count);
  const unsupported = createGeminiKeyProviders({ ...config, model: 'gemini-3.1-flash-lite' }, key, 'vertex');
  await assert.rejects(unsupported.agent.generate({ model: config.model, contents: [], config: {}, liveConnectConfig: {}, toolsDict: {} }, signal),
    { reason: 'model_not_available' });
  assert.equal(calls.length, count, 'Unsupported Express selections must fail before a paid request');
  response = { models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/unknown-future-model', supportedGenerationMethods: ['generateContent'] }], nextPageToken: 'more' };
  const catalog = await gemini.catalog(2, true, signal);
  assert.equal(calls.length, count + 2); assert.equal(catalog.truncated, true);
  assert.deepEqual(catalog.models.map(model => model.id), ['gemini-2.5-flash']);
  status = 429; response = { error: { code: 429, message: 'Synthetic quota failure', status: 'RESOURCE_EXHAUSTED' } };
  assert.equal((await gemini.inspect(signal)).reason, 'quota_exceeded');
  await assert.rejects(gemini.agent.generate({ model: 'gemini-2.5-flash', contents: [{ role: 'user', parts: [{ text: 'Hello' }] }], config: {}, liveConnectConfig: {}, toolsDict: {} }, signal), error => error instanceof ApiError && error.status === 429);
  status = 400; response = { error: { code: 400, message: 'API key not valid. Synthetic only.', status: 'INVALID_ARGUMENT' } };
  await assert.rejects(gemini.agent.generate({ model: 'gemini-2.5-flash', contents: [{ role: 'user', parts: [{ text: 'Hello' }] }], config: {}, liveConnectConfig: {}, toolsDict: {} }, signal), { reason: 'model_key_invalid' });
});
