import assert from 'node:assert/strict';
import test from 'node:test';
import { FinishReason } from '@google/genai';
import { createAgentRuntime } from '../server/agent-runtime.ts';
import { readAiConfig } from '../server/ai-config.ts';
import { createHighWatermarkMonitor } from '../server/agent-high-watermark.ts';

const never = () => new Promise<never>(() => {});
const sample = { runCategory: 'interactive', sampleId: 'sample-1', usedModelCalls: 1, hardModelCalls: 1 };

for (const blocked of ['monitor', 'alert'] as const) {
  test(`completed runtime returns despite pending ${blocked}`, { timeout: 2500 }, async () => {
    let calls = 0;
    const monitor = createHighWatermarkMonitor({ minHighRuns: 1, consecutiveHighRuns: 1, thresholdRatio: 0 });
    const runtime = createAgentRuntime({
      config: readAiConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: 'synthetic-project' }),
      usage: { reserve: async () => true, record: async () => {} },
      provider: { generate: async () => {
        calls++;
        return { content: { role: 'model', parts: [{ text: 'Completed reply' }] }, finishReason: FinishReason.STOP };
      } },
      highWatermarkMonitor: blocked === 'monitor' ? { ...monitor, recordSample: never } : monitor,
      onHighWatermarkAlert: blocked === 'alert' ? never : undefined,
    });
    const result = await runtime.run({
      scope: { userId: `synthetic-${blocked}`, childId: 'child', workspaceId: 'ws', authorizationVersion: '1', dataVersion: '1' },
      recipeId: 'p1-chat', trigger: { kind: 'interactive', reference: 'message' },
      messages: [{ role: 'user', text: 'Synthetic reply' }], tools: [], authorize: async () => true,
    });
    assert.equal(result.status, 'completed');
    assert.equal(result.text, 'Completed reply');
    assert.equal(calls, 1);
  });
}

test('pending persistence and error observer do not poison the category queue', { timeout: 2500 }, async () => {
  let writes = 0;
  const monitor = createHighWatermarkMonitor({
    appendDurableSample: async value => { if (++writes === 1) return never(); return [value]; },
    onPersistenceError: never,
  });
  const first = await monitor.recordSample(sample);
  assert.equal(first.persistenceDegraded, true);
  assert.equal(monitor.persistenceStatus('interactive').status, 'degraded');
  const second = await monitor.recordSample({ ...sample, sampleId: 'sample-2' });
  assert.equal(second.persisted, true);
  assert.equal(writes, 2);
});

for (const blocked of ['load', 'persist'] as const) {
  test(`pending legacy ${blocked} hook degrades and returns`, { timeout: 2500 }, async () => {
    const monitor = createHighWatermarkMonitor({
      loadWindow: blocked === 'load' ? never : async () => [],
      persistWindow: blocked === 'persist' ? never : async () => {},
    });
    const result = await monitor.recordSample(sample);
    assert.equal(result.persistenceDegraded, true);
    assert.equal(monitor.persistenceStatus('interactive').lastFailureStage, blocked);
  });
}

test('late append settlement cannot replace a later confirmed monitor state', { timeout: 2500 }, async () => {
  let resolveLate!: (value: typeof sample[]) => void;
  let writes = 0;
  const monitor = createHighWatermarkMonitor({ appendDurableSample: async value => {
    if (++writes === 1) return new Promise<typeof sample[]>(resolve => { resolveLate = resolve; });
    return [value as typeof sample];
  } });
  assert.equal((await monitor.recordSample(sample)).persistenceDegraded, true);
  const next = { ...sample, sampleId: 'next', usedModelCalls: 0 };
  assert.equal((await monitor.recordSample(next)).persisted, true);
  resolveLate([sample]);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal((await monitor.evaluateCategory('interactive')).highWatermarkCount, 0);
  assert.equal(monitor.persistenceStatus('interactive').status, 'persisted');
});

test('timed-out legacy replace write fences successors until actual settlement', { timeout: 3000 }, async () => {
  let release!: () => void;
  let stored: typeof sample[] = [];
  let writes = 0;
  const monitor = createHighWatermarkMonitor({
    loadWindow: () => stored,
    persistWindow: async (_category, values) => {
      if (++writes === 1) await new Promise<void>(resolve => { release = resolve; });
      stored = values.map(value => ({ ...value })) as typeof sample[];
    },
  });
  assert.equal((await monitor.recordSample(sample)).persistenceDegraded, true);
  const second = await monitor.recordSample({ ...sample, sampleId: 'second' });
  assert.equal(second.persistenceDegraded, true, 'Uncertain replace write must not admit another replace');
  assert.equal(writes, 1);
  release();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal((await monitor.recordSample({ ...sample, sampleId: 'third' })).persisted, true);
  assert.equal(writes, 2);
  assert.equal(stored.at(-1)?.sampleId, 'third');
});
