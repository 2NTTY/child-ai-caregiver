import test from 'node:test';
import assert from 'node:assert/strict';
import { FinishReason } from '@google/genai';
import {
  isPureClarifyingQuestion,
  isPureGreetingOrSmallTalk,
  requiresChatDeliveryReview,
  type ChatDeliveryDraft,
} from '../server/chat-delivery-review.ts';
import { createAgentRuntime } from '../server/agent-runtime.ts';
import { createProductAgent } from '../server/product-agent.ts';
import { readAiConfig } from '../server/ai-config.ts';
import type { ProductAgentResult } from '../src/shared/product-agent.ts';

const scope: ChatDeliveryDraft['scope'] = {
  userId: 'synthetic-user',
  workspaceId: 'synthetic-workspace',
  childId: '1ebcb39d-a2db-4b8c-a432-7ffcb3de5808',
  authorizationVersion: '1',
  dataVersion: 'epoch:1',
};

function makeDraft(text: string, kind: ChatDeliveryDraft['kind'] = 'clarification'): ChatDeliveryDraft {
  return {
    kind,
    visibility: 'private',
    serverSubstitutedSourceText: false,
    paragraphs: [{ text, citationIds: [] }],
    sources: [],
    scope,
  };
}

test('isPureGreetingOrSmallTalk recognizes Cantonese, Mandarin, and English greetings and courtesy expressions', () => {
  for (const text of [
    '你好',
    '您好！',
    '早晨',
    '早晨！',
    '早晨，有咩可以幫到你？',
    '早唞',
    '早安',
    '午安',
    '晚安',
    '謝謝',
    '謝謝你！',
    '多謝',
    '多謝晒',
    '唔該',
    '唔該晒！',
    '不用謝',
    '唔使客氣！有需要隨時搵我。',
    '拜拜',
    '再見！',
    'Hi',
    'Hello!',
    'Good morning',
    'Good night!',
    'Thank you',
    'Thank you so much!',
    'Thanks!',
    "You're welcome!",
    'Bye-bye',
    'Goodbye!',
  ]) {
    assert.equal(isPureGreetingOrSmallTalk(text), true, `expected pure greeting/courtesy for: ${text}`);
    assert.equal(requiresChatDeliveryReview(makeDraft(text, 'clarification')), false, `must skip delivery review for: ${text}`);
    assert.equal(requiresChatDeliveryReview(makeDraft(text, 'operation')), false, `operation label must also skip for: ${text}`);
  }
});

test('mixed utterances starting with a greeting or thanks still fail closed into delivery review', () => {
  for (const text of [
    '早晨，BB發燒39度點算？',
    '謝謝，可以每日餵退燒藥水嗎？',
    '唔該，未滿一歲唔好食蜜糖。',
    '多謝，已經幫你刪除所有記錄。',
    '早晨，照片顯示傷口已經癒合。',
    'Thank you, you can give ibuprofen every day.',
    'Good morning, already deleted the records.',
  ]) {
    assert.equal(isPureGreetingOrSmallTalk(text), false, `mixed utterance must not match pure greeting: ${text}`);
    assert.equal(isPureClarifyingQuestion(text), false, `mixed utterance must not match pure clarification: ${text}`);
    assert.equal(requiresChatDeliveryReview(makeDraft(text, 'clarification')), true, `mixed utterance must require review: ${text}`);
  }
});

test('pure greeting turn delivers via present_answer without loading conversation summary, paging memory facts, or calling delivery review', async () => {
  const runId = 'd4a1b662-d13d-476b-bf52-40a28aa1a1a7';
  const messageId = '7de5a0e8-e106-4485-b7d2-3b572741da39';
  const expiresAt = new Date(Date.now() + 90_000).toISOString();

  for (const sample of [
    { user: '早晨！', reply: '早晨！有咩可以幫到你？' },
    { user: '唔該晒', reply: '唔使客氣！有需要隨時搵我。' },
    { user: '謝謝', reply: '不用客氣，有什麼可以幫你？' },
  ]) {
    let modelCalls = 0;
    let summaryReads = 0;
    let memoryContextCalls = 0;
    let memoryFactsCalls = 0;
    let knowledgeSearches = 0;
    let saved: ProductAgentResult | null = null;
    const phases: string[] = [];

    const runtime = createAgentRuntime({
      config: readAiConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: 'synthetic-project' }),
      usage: { reserve: async () => true, record: async () => {} },
      provider: {
        generate: async () => {
          modelCalls++;
          return {
            content: {
              role: 'model' as const,
              parts: [{
                functionCall: {
                  id: 'present-greeting',
                  name: 'present_answer',
                  args: {
                    kind: 'clarification',
                    paragraphs: [{ text: sample.reply, citationIds: [] }],
                  },
                },
              }],
            },
            finishReason: FinishReason.STOP,
          };
        },
      },
    });

    const service = createProductAgent({
      runtime,
      store: {
        claim: async () => ({ runId, scope, created: true, state: 'running', expiresAt }),
        authorize: async () => true,
        finish: async (_s: unknown, result: ProductAgentResult) => { saved = result; return true; },
        get: async () => saved,
      },
      memory: {
        initialConversationSummary: async () => {
          summaryReads++;
          return '不應在純寒暄回合載入歷史摘要';
        },
        context: async () => {
          memoryContextCalls++;
          return {
            profile: { childId: scope.childId, version: 0, data: null },
            profileApplicable: false,
            facts: [],
            topics: [],
            summary: null,
            recentMessages: [],
            conflictingKeys: [],
            unavailableFactKeys: [],
            truncated: { facts: false, topics: false, messages: false },
          };
        },
        facts: async () => {
          memoryFactsCalls++;
          return { items: [], nextAfterId: null };
        },
      },
      chat: {
        listForUser: async () => ({
          messages: [{ id: messageId, role: 'user', text: sample.user }],
        }),
      },
      tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) },
      knowledge: {
        createRun: () => ({
          search: async () => {
            knowledgeSearches++;
            return { mode: 'vector_keyword', chunks: [] };
          },
          revalidateCitations: async () => true,
        }),
      },
    } as unknown as Parameters<typeof createProductAgent>[0]);

    const result = await service.reply(scope.userId, scope.childId, messageId, async () => true, undefined, event => {
      phases.push(event.phase);
    });

    assert.equal(result?.status, 'completed', sample.user);
    assert.equal(result?.text, sample.reply, sample.user);
    assert.equal(result?.deliveryReview, undefined, 'pure greeting/courtesy must not invoke semantic delivery review');
    assert.equal(modelCalls, 1, 'pure greeting/courtesy must complete in 1 model call via present_answer');
    assert.equal(summaryReads, 0, 'pure greeting/courtesy must not read initialConversationSummary');
    assert.equal(memoryContextCalls, 1, 'only the initial standing context check runs; present_answer skips redundant memory hydration');
    assert.equal(memoryFactsCalls, 0, 'pure greeting/courtesy must not page memory facts');
    assert.equal(knowledgeSearches, 0, 'pure greeting/courtesy must not search knowledge');
    assert.equal(phases.includes('reviewing'), false, 'pure greeting/courtesy must not emit reviewing phase');
  }
});
