import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { compatibleContextPreflight, nativeContextPreflight, nativeTokenCounter } from '../server/model-context-preflight.ts';
import { createPersonalModelProviders } from '../server/personal-model-providers.ts';

import { AgentGatewayModel, createVertexAgentProvider } from '../server/agent-model-gateway.ts';
import { AgentBudget } from '../server/agent-budget.ts';
import { FinishReason } from '@google/genai';
import { readAiConfig } from '../server/ai-config.ts';

const model = 'gemini-3.1-flash-lite';
const config = readAiConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: 'synthetic-project' });
const request = { contents: [{ role: 'user', parts: [{ text: '繁體中文 / English' }] }], toolsDict: {}, liveConnectConfig: {} };
const payload = { model, contents: request.contents, config: { maxOutputTokens: 100 } };

test('separate model input and output limits and advisory combined soft target retain their units', () => {
  const near = nativeContextPreflight(payload, undefined, 127900);
  assert.equal(near.measurement, 'counted');
  assert.equal(near.softExceeded, false);
  assert.equal(nativeContextPreflight(payload, undefined, 127901).softExceeded, true);
  assert.equal(nativeContextPreflight(payload, undefined, 1048576).exceedsCapacity, false);
  assert.equal(nativeContextPreflight(payload, undefined, 1048577).exceedsCapacity, true);
  assert.equal(nativeContextPreflight({ ...payload, config: { maxOutputTokens: 65537 } }).exceedsCapacity, true);
  assert.equal(nativeContextPreflight({ ...payload, model: 'another-model' }).inputLimit, null);
});

test('native preflight measures tool/schema/system growth and accounts for media independently of base64 size', () => {
  const measure = (data: string, duration?: number) => nativeContextPreflight({ model,
    contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/png', data } },
      { inlineData: { mimeType: 'audio/wav', data } }] }],
    config: { maxOutputTokens: 123 } }, duration);
  assert.deepEqual(measure('AA==', 1501), measure('A'.repeat(200000), 1501));
  assert.equal(measure('AAAA', 1501).mediaTokens, 1158);
  assert.equal(measure('AAAA').measurement, 'unknown');
  assert.equal(measure('AAAA').inputTokens, null);
  const baseline = nativeContextPreflight(payload);
  const expanded = nativeContextPreflight({ ...payload,
    contents: [...request.contents, { role: 'user', parts: [{ functionResponse: { name: 'read', response: { data: '資料'.repeat(100) } } }] }],
    config: { ...payload.config, systemInstruction: '規則'.repeat(100), tools: [{ functionDeclarations: [{ name: 'read' }] }] } });
  assert.equal(expanded.measurement, 'estimated');
  assert.ok(expanded.estimatedTextTokens > baseline.estimatedTextTokens + 300);
});

test('all production agent adapters inspect selected payload; compatible model aliases retain unknown capacity', () => {
  const providers = [createVertexAgentProvider(config), createPersonalModelProviders(config, 'synthetic', 'gemini').agent,
    createPersonalModelProviders(config, 'synthetic', 'vertex').agent];
  for (const provider of providers) {
    assert.equal(provider.preflight!(request).inputLimit, 1048576);
    assert.equal(provider.preflight!(request).outputReserve, config.maxOutputTokens);
  }
  const compatible = createPersonalModelProviders(config, 'synthetic', 'openai-compatible', { baseUrl: 'https://example.org' });
  assert.equal(compatible.agent.preflight!(request).inputLimit, null);
  const withMedia = compatibleContextPreflight({ messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: 'AAA=' } }] }],
    max_completion_tokens: 99 });
  assert.equal(withMedia.measurement, 'unknown');
  assert.equal(withMedia.mediaParts, 1);
  assert.equal(withMedia.outputReserve, 99);
});

test('hard rejection precedes provider start and daily admission; crossing only the soft target still permits work', async () => {
  const calls: string[] = [];
  const budget = new AgentBudget();
  let count = 1048577;
  const gateway = new AgentGatewayModel({ config, budget, userId: 'user', childId: 'child', authorize: async () => true,
    provider: { preflight: () => nativeContextPreflight(payload, undefined, count),
      generate: async () => { calls.push('generate'); return { content: { role: 'model', parts: [{ text: 'OK' }] }, finishReason: FinishReason.STOP }; } },
    usage: { reserve: async () => { calls.push('reserve'); return true; }, record: async () => { calls.push('record'); } } });
  const complete = async () => { for await (const result of gateway.generateContentAsync(request)) assert.equal(result.content?.parts?.[0]?.text, 'OK'); };
  try {
    await assert.rejects(complete, { reason: 'model_context_exceeded' });
    assert.deepEqual(calls, []);
    count = 128001;
    await complete();
    assert.deepEqual(calls, ['reserve', 'generate', 'record']);
  } finally { budget.close(); }
});

test('opt-in SDK counter uses eligible native text and system instructions; opaque parts, schemas and other models fall back', async () => {
  const calls: unknown[][] = [];
  let warmed!: () => void;
  const ready = new Promise<void>(resolve => { warmed = resolve; });
  class Tokenizer {
    async countTokens(...args: unknown[]) {
      calls.push(args);
      if (args[0] === 'warmup') warmed();
      return { totalTokens: 17 };
    }
  }
  const shim = mock.module('@google/genai/tokenizer/node', { namedExports: { LocalTokenizer: Tokenizer } });
  try {
    assert.equal(nativeTokenCounter('gemini-3.1-flash-lite', true), undefined);
    assert.equal(nativeTokenCounter('gemini-2.5-flash', false), undefined);
    const count = nativeTokenCounter('gemini-2.5-flash', true)!;
    await ready;
    await new Promise<void>(resolve => setImmediate(resolve));
    const input = { ...payload, model: 'gemini-2.5-flash', config: { ...payload.config, systemInstruction: 'rules' } };
    assert.equal(await count(input), 17);
    assert.deepEqual(calls[1], [request.contents, { systemInstruction: 'rules' }]);
    assert.equal(await count({ ...input, config: { tools: [{}] } }), undefined);
    assert.equal(await count({ ...input, contents: [{ role: 'model', parts: [{ text: 'private', thoughtSignature: 'XX==' }] }] }), undefined);
    assert.equal(calls.length, 2);
  } finally { shim.restore(); }
});

test('a soft overflow leaves room for the explicit coverage marker without dropping the latest question', async () => {
  const budget = new AgentBudget();
  const sent: string[] = [];
  const gateway = new AgentGatewayModel({ config, budget, userId: 'user', childId: 'child', authorize: async () => true,
    initialConversationSummary: { summary: { id: 'summary', version: 1, text: 'old summary body', createdAt: '2026-10-09T00:00:00Z',
      lastCoveredMessageId: 'source' }, basis: 'a'.repeat(64), validUntil: null },
    provider: { preflight: () => nativeContextPreflight(payload, undefined, 128001), generate: async outgoing => {
      sent.push(JSON.stringify(outgoing.contents));
      return { content: { role: 'model', parts: [{ text: 'OK' }] }, finishReason: FinishReason.STOP };
    } }, usage: { reserve: async () => true, record: async () => {} } });
  try {
    for await (const response of gateway.generateContentAsync(request)) assert.equal(response.finishReason, FinishReason.STOP);
    assert.equal(sent.length, 1);
    assert.match(sent[0]!, /繁體中文/);
    assert.match(sent[0]!, /historical summary omitted/);
    assert.doesNotMatch(sent[0]!, /old summary body/);
  } finally { budget.close(); }
});
