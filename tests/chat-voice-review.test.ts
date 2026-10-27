import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { InMemorySessionService } from '@google/adk';
import { FinishReason } from '@google/genai';
import { createAgentRuntime } from '../server/agent-runtime.ts';
import { createProductAgent } from '../server/product-agent.ts';
import { readAiConfig } from '../server/ai-config.ts';
import { chatDeliveryDraftHash, chatDeliveryPassNeedsSources } from '../server/chat-delivery-review.ts';
import type { ProductAgentResult } from '../src/shared/product-agent.ts';

test('voice delivery reviews the same authorized original, binds its version and retains root accounting', async () => {
  const bytes = Buffer.alloc(2000, 1), voice = { id: randomUUID(), version: 3, mimeType: 'audio/wav' as const,
    bytes: bytes.length, durationMs: 1000, sha256: createHash('sha256').update(bytes).digest('hex') };
  const { id: _id, version: _version, ...metadata } = voice;
  const audio = { data: bytes.toString('base64'), mimeType: voice.mimeType, metadata };
  const events: string[] = [];
  class Sessions extends InMemorySessionService {
    override async appendEvent(input: Parameters<InMemorySessionService['appendEvent']>[0]) {
      events.push(JSON.stringify(input.event)); return super.appendEvent(input);
    }
  }
  const userId = 'voice-parent', childId = randomUUID();
  for (const revoke of [false, true]) {
    const runId = randomUUID(), messageId = randomUUID();
    const scope = { userId, childId, workspaceId: 'voice-workspace', authorizationVersion: '1', dataVersion: 'epoch:1' };
    let available = true, claimed = false, calls = 0, reads = 0, reviewed = 0, saved: ProductAgentResult | null = null;
    const runtime = createAgentRuntime({ config: readAiConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: 'synthetic-project' }),
      nativeSessionService: new Sessions(), usage: { reserve: async () => true, record: async () => {} },
      provider: { async generate(request) {
        calls++;
        const parts = request.contents.flatMap(content => content.parts ?? []);
        assert.deepEqual(parts.filter(part => part.inlineData).map(part => part.inlineData), [{ data: audio.data, mimeType: audio.mimeType }]);
        const reviewText = parts.find(part => part.text?.startsWith('Server evidence payload for chat-delivery-review.'))?.text;
        if (reviewText) {
          reviewed++;
          assert.equal(parts.some(part => part.functionResponse), false);
          const payload = JSON.parse(reviewText.slice(reviewText.indexOf('\n') + 1));
          assert.deepEqual(payload.privateVoiceOriginal, voice);
          assert.deepEqual(payload.outputContract.required, ['draftHash', 'decision', 'issues']);
          if (revoke) available = false;
          return { content: { role: 'model', parts: [{ text: JSON.stringify({ draftHash: payload.draftHash, decision: 'pass', issues: [] }) }] }, finishReason: FinishReason.STOP };
        }
        return { content: { role: 'model', parts: [{ functionCall: { id: 'voice-answer', name: 'present_answer',
          args: { kind: 'private_reference', paragraphs: [{ text: '你說今天買了三個蘋果。', citationIds: [] }] } } }] }, finishReason: FinishReason.STOP };
      } } });
    const service = createProductAgent({ runtime,
      voices: { authorizeAudio: async () => available, agentAudio: async () => { reads++; assert.equal(available, true); return audio; } },
      store: { claim: async () => { const created = !claimed; claimed = true; return { runId, scope, created, sourceMessageId: messageId,
        state: 'running', expiresAt: new Date(Date.now() + 90000).toISOString() }; },
        authorize: async () => true, finish: async (_scope: unknown, result: ProductAgentResult) => { saved = result; return true; }, get: async () => saved },
      memory: { context: async () => ({ profile: { childId, version: 0, data: null }, profileApplicable: false, facts: [], topics: [], summary: null,
        recentMessages: [], conflictingKeys: [], unavailableFactKeys: [], truncated: { facts: false, topics: false, messages: false } }) },
      chat: { listForUser: async () => ({ messages: [{ id: messageId, role: 'user', text: '', voice }] }) },
      tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) },
      knowledge: { createRun: () => ({ search: async () => { throw Error('No official advice requested'); }, revalidateCitations: async () => true }) },
    } as unknown as Parameters<typeof createProductAgent>[0]);
    const result = await service.reply(userId, childId, messageId, async () => true);
    assert.equal(reviewed, 1); assert.equal(reads, 2); assert.equal(calls, 2);
    assert.equal(result?.status, revoke ? 'stopped' : 'completed', JSON.stringify(result));
    if (revoke) assert.equal(result?.stopReason, 'unauthorized');
    else {
      assert.equal(result?.deliveryReview?.decision, 'pass');
      assert.deepEqual(await service.reply(userId, childId, messageId, async () => true), result);
      assert.equal(calls, 2, 'original result lookup must not dispatch again');
    }
    const draft = { kind: 'private_reference' as const, visibility: 'private' as const, serverSubstitutedSourceText: false,
      paragraphs: [{ text: 'three apples', citationIds: [] }], sources: [], scope, voice };
    assert.notEqual(chatDeliveryDraftHash(draft), chatDeliveryDraftHash({ ...draft, voice: { ...voice, version: 4 } }));
    assert.equal(chatDeliveryPassNeedsSources(draft), false);
    assert.equal(chatDeliveryPassNeedsSources({ ...draft, kind: 'caregiving' }), true);
  }
  assert.ok(events.length); assert.ok(events.every(event => !event.includes(audio.data) && !event.includes('inlineData')));
});
