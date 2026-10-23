import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { LlmRequest } from '@google/adk';
import { readAiConfig } from '../server/ai-config.ts';
import { createCompatibleProviders, compatibleRequest } from '../server/openai-compatible-provider.ts';
import { createPersonalModelProviders } from '../server/personal-model-providers.ts';
import { postPersonalModel } from '../server/personal-model-transport.ts';
import { personalProviderHttpError } from '../server/personal-provider-error.ts';
import { agentStopMessage } from '../src/shared/agent-stop-message.ts';
import { createFirestoreModelSettings } from '../server/firestore-model-settings.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';
import { AgentBudget } from '../server/agent-budget.ts';
import { AgentGatewayModel } from '../server/agent-model-gateway.ts';

const config = { ...readAiConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: 'synthetic-personal' }), model: 'vendor/Custom-Chat' };
const signal = () => new AbortController().signal;
test('compatible chat preserves a complete tool round trip, capabilities and unknown usage without qualification calls', async () => {
  const sent: Record<string, unknown>[] = [];
  const provider = createCompatibleProviders(config, 'short-key', 'https://models.example.test/v1', async (url, key, body) => {
    assert.equal(url, 'https://models.example.test/v1'); assert.equal(key, 'short-key'); sent.push(body);
    return { choices: [{ message: sent.length === 1 ? { role: 'assistant', content: null,
      tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'read_records', arguments: '{"limit":1}' } }] }
      : { role: 'assistant', content: 'Saved result' }, finish_reason: sent.length === 1 ? 'tool_calls' : 'stop' }],
      ...(sent.length === 1 ? { usage: { prompt_tokens: 9, completion_tokens: 2 } } : {}) };
  });
  const request: LlmRequest = { model: 'ignored', contents: [{ role: 'user', parts: [{ text: 'Check my record' }] }],
    config: { systemInstruction: 'Instruction', tools: [{ functionDeclarations: [{ name: 'read_records',
      parametersJsonSchema: { type: 'object', properties: { limit: { type: 'integer' } } } }] }] },
    toolsDict: {}, liveConnectConfig: {} };
  const first = await provider.agent.generate(request, signal());
  const second = await provider.agent.generate({ ...request, contents: [...request.contents, first.content!,
    { role: 'user', parts: [{ functionResponse: { id: 'call-1', name: 'read_records', response: { records: ['one'] } } }] }] }, signal());
  assert.equal(sent.length, 2); assert.equal(sent[0]!.model, config.model);
  assert.equal(first.usageMetadata?.promptTokenCount, 9); assert.equal(second.usageMetadata, undefined);
  const messages = sent[1]!.messages as Record<string, unknown>[];
  assert.deepEqual(messages.at(-1), { role: 'tool', tool_call_id: 'call-1', content: '{"records":["one"]}' });
  assert.equal(second.content?.parts?.[0]?.text, 'Saved result');
  assert.throws(() => compatibleRequest({ ...request, contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'audio/mp4', data: 'AA==' } }] }] }, config.model, 100),
    error => (error as Error).message === 'model_input_unsupported');
  for (const url of ['http://example.test/v1', 'https://127.0.0.1/v1', 'https://169.254.169.254/v1'])
    await assert.rejects(postPersonalModel(url, 'secret', {}, signal()), error => (error as Error).message === 'model_endpoint_invalid');
});

test('provider failures remain specific and secret-free; independent embeddings never borrow the chat key', async context => {
  const cases = [
    [401, 'invalid_api_key', 'Key short-key rejected', 'model_key_invalid'],
    [404, 'model_not_found', 'No such model', 'model_not_available'],
    [429, 'insufficient_quota', 'No credits', 'model_provider_quota'],
    [429, 'rate_limit_exceeded', 'Slow down', 'model_provider_rate_limit'],
    [400, 'unsupported_parameter', 'This model does not support tools', 'model_tools_unsupported'],
  ] as const;
  for (const [status, code, message, reason] of cases) {
    const error = personalProviderHttpError(status, { error: { code, message } });
    assert.equal(error.diagnostic.reason, reason); assert.equal(error.diagnostic.httpStatus, status);
    assert.doesNotMatch(JSON.stringify(error), /short-key|No credits|No such model/);
    assert.ok(agentStopMessage(reason)?.length);
  }
  const budget = new AgentBudget(); let attempts = 0, recorded = 0;
  try {
    const gateway = new AgentGatewayModel({ config: { ...config, agentMaxRetries: 3 }, budget, userId: 'owner', childId: 'child',
      authorize: async () => true, usage: { reserve: async () => true, record: async () => { recorded++; } },
      provider: { async generate() { attempts++; throw personalProviderHttpError(429, { error: { code: 'insufficient_quota' } }); } } });
    await assert.rejects(gateway.generateContentAsync({ contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
      toolsDict: {}, liveConnectConfig: {} }).next(), error => (error as Error).message === 'model_provider_quota');
    assert.equal(gateway.failure?.reason, 'model_provider_quota');
    assert.equal(attempts, 1); assert.equal(recorded, 1, 'An exhausted provider balance is metered, not retried three times');
  } finally { budget.close(); }
  const missing = createPersonalModelProviders(config, 'chat-secret', 'openai-compatible');
  await assert.rejects(missing.embedding.embed({ task: 'RETRIEVAL_QUERY', text: 'question' }, signal()),
    error => (error as Error).message === 'embedding_not_configured');
  let calls = 0;
  context.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    calls++; assert.equal(new Headers(init.headers).get('x-goog-api-key'), 'embedding-secret');
    return Response.json({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded; embedding-secret' } }, { status: 429 });
  });
  const separate = createPersonalModelProviders(config, 'chat-secret', 'openai-compatible', { embeddingApiKey: 'embedding-secret' });
  await assert.rejects(separate.embedding.embed({ task: 'RETRIEVAL_QUERY', text: 'question' }, signal()),
    error => (error as Error).message === 'embedding_provider_quota');
  assert.equal(calls, 1);
});

test('encrypted compatible settings preserve receipts, isolation and key ownership when the endpoint changes', async () => {
  const f = firestoreDomainFixture(), options = { database: f.database, cipher: createStorageCipher(Buffer.alloc(32, 23)),
    projectId: 'synthetic-personal', namespace: 'synthetic_personal' };
  const authority = createFirestoreAuthority(options);
  await authority.initializeControl({ generation: randomUUID(), enabled: true });
  for (const userId of ['owner', 'other']) {
    await authority.issueInvitation({ email: userId + '@example.test', expiresAt: new Date(Date.now() + 60000).toISOString(), operationId: randomUUID() });
    await authority.admitIdentity({ userId, email: userId + '@example.test', emailVerified: true });
    await authority.acknowledge({ userId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  }
  const store = createFirestoreModelSettings(options);
  const command = { opId: randomUUID(), expectedVersion: 0, mode: 'personal' as const, provider: 'openai-compatible' as const,
    model: config.model, baseUrl: 'https://models.example.test/v1', apiKey: 'short-key', embeddingApiKey: 'embedding-key',
    backgroundEnabled: false, dailyLimit: 100, maxModelCalls: 4, maxQueryEmbeddings: 2, consent: true };
  const saved = await store.save('owner', command);
  assert.deepEqual(await store.save('owner', command), saved);
  assert.equal((await store.getOperation!('owner', command.opId))?.settings.version, 1);
  assert.equal(await store.getOperation!('other', command.opId), null);
  assert.doesNotMatch(JSON.stringify(saved), /short-key|embedding-key|apiKey|embeddingApiKey/);
  assert.equal(saved.embeddingKeyConfigured, true);
  await assert.rejects(store.save('owner', { ...command, opId: randomUUID(), expectedVersion: 1 }, { maxSettingsVersion: 2 }),
    error => (error as { code: string }).code === 'client_update_required');
  const { apiKey, embeddingApiKey, ...retained } = command;
  await assert.rejects(store.save('owner', { ...retained, opId: randomUUID(), expectedVersion: 1, baseUrl: 'https://another.example.test/v1' }),
    error => (error as { code: string }).code === 'key_required');
  await assert.rejects(store.save('owner', { ...command, opId: randomUUID() }), error => (error as { code: string }).code === 'version_conflict');
  const removed = await store.save('owner', { ...retained, opId: randomUUID(), expectedVersion: 1, mode: 'disabled', removeKey: true });
  assert.equal(removed.keyConfigured, false); assert.equal(removed.embeddingKeyConfigured, false);
});
