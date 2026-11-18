import assert from 'node:assert/strict';
import test from 'node:test';
import { FinishReason } from '@google/genai';
import { z } from 'zod';
import { createAgentRuntime } from '../server/agent-runtime.ts';
import { readAiConfig } from '../server/ai-config.ts';

for (const transition of ['tighten', 'revoke'] as const) {
  test(`compaction rechecks ${transition} after usage reservation before dispatch`, async () => {
    let reservations = 0, calls = 0, changed = false;
    const runtime = createAgentRuntime({
      config: readAiConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: 'synthetic-project' }),
      usage: {
        reserve: async () => { if (++reservations === 2) changed = true; return true; },
        record: async () => {},
      },
      provider: { generate: async () => {
        calls++;
        return calls === 1
          ? { content: { role: 'model', parts: [{ functionCall: { id: 'call', name: 'read_context', args: {} } }] }, finishReason: FinishReason.STOP,
              usageMetadata: { promptTokenCount: 240, totalTokenCount: 260 } }
          : { content: { role: 'model', parts: [{ text: 'Synthetic compacted context' }] }, finishReason: FinishReason.STOP };
      } },
    });
    const result = await runtime.run({
      scope: { userId: `synthetic-${transition}`, childId: 'child', workspaceId: 'ws', authorizationVersion: '1', dataVersion: '1' },
      recipeId: 'p1-chat', trigger: { kind: 'interactive', reference: 'message' },
      messages: [{ role: 'user', text: 'Synthetic compaction test' }],
      contextCompaction: { tokenThreshold: 80, eventRetentionSize: 1 },
      tools: [{ name: 'read_context', description: 'Read synthetic context', parameters: z.object({}), authorize: async () => true,
        execute: async () => ({ status: 'succeeded', data: { note: 'Synthetic result' } }) }],
      authorize: async () => true,
      readPolicyTransition: async () => changed ? transition === 'revoke' ? { enabled: false } : { enabled: true, maxModelCalls: 1 } : null,
    });
    assert.equal(reservations, 2, 'Compaction must reach the asynchronous reservation boundary');
    assert.equal(calls, 1, 'No compaction provider call may dispatch under stale policy');
    assert.equal(result.status, 'stopped');
    assert.equal(result.counts.modelCalls, 2, 'Reserved usage is not refunded or replayed');
  });
}
