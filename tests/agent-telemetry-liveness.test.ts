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

test('unsettled telemetry I/O stays bounded across categories and monitors; settlement restores capacity', { timeout: 6000 }, async () => {
  let calls = 0;
  const releases: (() => void)[] = [];
  const monitors = Array.from({ length: 3 }, () => createHighWatermarkMonitor({
    appendDurableSample: async value => { calls++; await new Promise<void>(resolve => releases.push(resolve)); return [value]; },
  }));
  for (let round = 0; round < 3; round++) {
    const results = await Promise.all(Array.from({ length: 20 }, (_, index) => monitors[index % 3]!.recordSample({ ...sample, runCategory: `category-${round}-${index}` })));
    assert.ok(results.every(result => result.persistenceDegraded && !result.persisted), 'Timeout and overload must never claim durability');
  }
  assert.ok(calls <= 16, `Actual unsettled operations must be bounded, got ${calls}`);
  const saturatedCalls = calls;
  releases.forEach(release => release());
  await new Promise(resolve => setTimeout(resolve, 0));
  const recovered = monitors[0]!.recordSample({ ...sample, sampleId: 'recovered' });
  await new Promise(resolve => setTimeout(resolve, 0));
  releases.at(-1)!();
  assert.equal((await recovered).persisted, true);
  assert.equal(calls, saturatedCalls + 1);
});

test('category admission queue rejects overflow without enqueuing unbounded work', { timeout: 3000 }, async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const monitor = createHighWatermarkMonitor({ appendDurableSample: async value => { await gate; return [value]; } });
  const pending = Array.from({ length: 100 }, (_, index) => monitor.recordSample({ ...sample, sampleId: `queued-${index}` }));
  const settled = Promise.allSettled(pending);
  assert.equal(monitor.persistenceStatus('interactive').status, 'degraded');
  release();
  const result = await settled;
  assert.equal(result.filter(item => item.status === 'fulfilled').length, 32);
  assert.equal(result.filter(item => item.status === 'rejected').length, 68);
});

for (const blocked of ['monitor', 'alert'] as const) {
  test(`runtime bounds unsettled ${blocked} callbacks and recovers after actual settlement`, { timeout: 20000 }, async () => {
    let callbacks = 0, providerCalls = 0;
    const releases: (() => void)[] = [];
    const monitor = createHighWatermarkMonitor({ minHighRuns: 1, consecutiveHighRuns: 1, thresholdRatio: 0 });
    const pendingCallback = async () => { callbacks++; await new Promise<void>(resolve => releases.push(resolve)); };
    const runtime = createAgentRuntime({
      config: readAiConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: 'synthetic-project' }),
      usage: { reserve: async () => true, record: async () => {} },
      provider: { generate: async () => { providerCalls++; return { content: { role: 'model', parts: [{ text: 'Completed reply' }] }, finishReason: FinishReason.STOP }; } },
      highWatermarkMonitor: blocked === 'monitor' ? { ...monitor, recordSample: async value => { await pendingCallback(); return monitor.recordSample(value); } } : monitor,
      onHighWatermarkAlert: blocked === 'alert' ? pendingCallback : undefined,
    });
    const run = (index: number) => runtime.run({
      scope: { userId: `callback-${blocked}-${index}`, childId: 'child', workspaceId: 'ws', authorizationVersion: '1', dataVersion: '1' },
      recipeId: 'p1-chat', trigger: { kind: 'interactive', reference: `message-${index}` },
      messages: [{ role: 'user', text: 'Synthetic reply' }], tools: [], authorize: async () => true,
    });
    const results = [];
    // Respect the runtime's existing four-run admission limit; overload only telemetry.
    for (let batch = 0; batch < 10; batch++) {
      results.push(...await Promise.all(Array.from({ length: 4 }, (_, index) => run(batch * 4 + index))));
    }
    assert.ok(callbacks > 0 && callbacks <= 16, `Unsettled ${blocked} callbacks: ${callbacks}`);
    assert.equal(providerCalls, 40, 'Observation overload must not limit authorized model work');
    assert.ok(results.every(result => result.status === 'completed' && result.text === 'Completed reply'));
    const previous = callbacks;
    releases.forEach(release => release());
    await new Promise(resolve => setTimeout(resolve, 0));
    const recovered = run(100);
    // Let runtime reach its observation callback without guessing a scheduling delay.
    for (let i = 0; i < 100 && callbacks === previous; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(callbacks, previous + 1);
    releases.at(-1)!();
    assert.equal((await recovered).status, 'completed');
  });
}
