import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { InMemorySessionService } from '@google/adk';
import { FinishReason } from '@google/genai';
import { createAgentRuntime } from '../server/agent-runtime.ts';
import { createProductAgent } from '../server/product-agent.ts';
import { readAiConfig } from '../server/ai-config.ts';
import type { ProductAgentResult } from '../src/shared/product-agent.ts';
import type { PhotoMessageReference } from '../src/shared/photos.ts';
import { chatDeliveryDraftHash } from '../server/chat-delivery-review.ts';

test('photo chat and later library reads share original pixels with review without persisting binary or bypassing revocation', async () => {
  // Signature bytes cover transport, not image interpretation quality.
  const bytes = Buffer.alloc(33000); bytes[0] = 255; bytes[1] = 216; bytes[2] = 255;
  const reference: PhotoMessageReference = { id: randomUUID(), version: 2, fileName: 'blocks.jpg', mimeType: 'image/jpeg',
    bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), source: '本人上傳' };
  const image = { data: bytes.toString('base64'), mimeType: reference.mimeType, reference };
  const userId = 'photo-parent', childId = randomUUID();
  let available = true, reads = 0;
  const events: string[] = [];
  class Sessions extends InMemorySessionService {
    override async appendEvent(input: Parameters<InMemorySessionService['appendEvent']>[0]) {
      events.push(JSON.stringify(input.event)); return super.appendEvent(input);
    }
  }
  const photo = { ...reference, childId, ownerUserId: userId, createdAt: new Date().toISOString(), state: 'ready' as const,
    visibility: 'private' as const, canManage: true, recordId: null,
    extraction: { state: 'not_requested' as const, runId: null, draft: null, stopReason: null, processedAt: null, model: null } };
  for (const mode of ['attached', 'library', 'revoked'] as const) {
    available = true;
    const messageId = randomUUID(), runId = randomUUID();
    const scope = { userId, childId, workspaceId: 'photo-workspace', authorizationVersion: '1', dataVersion: 'epoch:1' };
    let claimed = false, saved: ProductAgentResult | null = null, modelCalls = 0, reviewed = 0, steps = 0;
    const runtime = createAgentRuntime({ config: readAiConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: 'synthetic-photo' }),
      usage: { reserve: async () => true, record: async () => {} }, nativeSessionService: new Sessions(),
      provider: { generate: async request => {
        modelCalls++;
        const parts = request.contents.flatMap(content => content.parts ?? []);
        const reviewText = parts.find(part => part.text?.startsWith('Server evidence payload for chat-delivery-review.'))?.text;
        if (reviewText) {
          reviewed++;
          assert.deepEqual(parts.filter(part => part.inlineData).map(part => part.inlineData), [{ data: image.data, mimeType: image.mimeType }]);
          assert.ok(!parts.some(part => part.functionResponse), 'review never inherits generator tool results');
          const payload = JSON.parse(reviewText.slice(reviewText.indexOf('\n') + 1));
          assert.deepEqual(payload.privatePhotoOriginals, [reference]);
          if (mode === 'revoked') available = false;
          return { content: { role: 'model', parts: [{ text: JSON.stringify({ draftHash: payload.draftHash, decision: 'pass', issues: [] }) }] }, finishReason: FinishReason.STOP };
        }
        const index = steps++;
        if (mode !== 'library' || index >= 2) {
          assert.deepEqual(parts.filter(part => part.inlineData).map(part => part.inlineData), [{ data: image.data, mimeType: image.mimeType }]);
        } else assert.equal(parts.some(part => part.inlineData), false, 'listing alone does not load pixels');
        for (const part of parts) if (part.functionResponse) assert.ok(!JSON.stringify(part.functionResponse).includes(image.data));
        const call = mode === 'library' && index === 0 ? { name: 'list_chat_photos', args: {} }
          : mode === 'library' && index === 1 ? { name: 'read_chat_photo', args: { id: reference.id, expectedVersion: reference.version } }
          : { name: 'present_answer', args: { kind: 'private_reference', paragraphs: [{ text: '照片中有紅色積木。', citationIds: [] }] } };
        return { content: { role: 'model', parts: [{ functionCall: { id: `photo-step-${index}`, ...call } }] }, finishReason: FinishReason.STOP };
      } } });
    const options = {
      runtime, photos: {
        get: async () => photo, list: async () => ({ photos: [photo], complete: true, nextCursor: null, canCreate: true }),
        agentImage: async () => { reads++; assert.equal(available, true); return image; }, authorizeImage: async () => available,
      },
      store: {
        claim: async () => { const created = !claimed; claimed = true; return { runId, scope, created, sourceMessageId: messageId, state: 'running', expiresAt: new Date(Date.now() + 90000).toISOString() }; },
        authorize: async () => true, finish: async (_scope: unknown, result: ProductAgentResult) => { saved = result; return true; }, get: async () => saved,
      },
      memory: { context: async () => ({ profile: { childId, version: 0, data: null }, profileApplicable: false, facts: [], topics: [],
        summary: null, recentMessages: [], conflictingKeys: [], unavailableFactKeys: [], truncated: { facts: false, topics: false, messages: false } }) },
      chat: { listForUser: async () => ({ messages: [{ id: messageId, role: 'user', text: '請說明這張照片。', ...(mode === 'library' ? {} : { photo: reference }) }] }) },
      tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) },
      knowledge: { createRun: () => ({ search: async () => { throw new Error('No official advice requested'); }, revalidateCitations: async () => true }) },
    } as unknown as Parameters<typeof createProductAgent>[0];
    const service = createProductAgent(options), result = await service.reply(userId, childId, messageId, async () => true);
    assert.equal(reviewed, 1);
    assert.equal(result?.status, mode === 'revoked' ? 'stopped' : 'completed', JSON.stringify(result));
    if (mode === 'revoked') assert.equal(result?.stopReason, 'unauthorized');
    else {
      assert.equal(result?.text, '照片中有紅色積木。');
      assert.equal(result?.deliveryReview?.decision, 'pass');
      const count = modelCalls;
      assert.deepEqual(await service.reply(userId, childId, messageId, async () => true), result);
      assert.equal(modelCalls, count, 'original run lookup never repeats model calls');
    }
  }
  assert.equal(reads, 3);
  assert.ok(events.length > 0);
  assert.ok(events.every(event => !event.includes(image.data) && !event.includes('inlineData')));
  const basis = { kind: 'private_reference' as const, visibility: 'private' as const, serverSubstitutedSourceText: false,
    paragraphs: [{ text: '照片', citationIds: [] }], sources: [], scope: { userId, childId, workspaceId: 'w', authorizationVersion: '1', dataVersion: '1' } };
  assert.notEqual(chatDeliveryDraftHash({ ...basis, images: [reference] }), chatDeliveryDraftHash({ ...basis, images: [{ ...reference, sha256: 'b'.repeat(64) }] }));
});
