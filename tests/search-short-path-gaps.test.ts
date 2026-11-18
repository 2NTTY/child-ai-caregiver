import test from 'node:test';
import assert from 'node:assert/strict';
import { FinishReason } from '@google/genai';
import { AgentBudget, AgentStopped } from '../server/agent-budget.ts';
import {
  chatDeliveryPassNeedsSources,
  chatDeliveryReviewSourceExcerpt,
  createChatDeliveryReviewObligation,
  draftLooksLikeDirectiveCareAdvice,
  draftLooksLikeSubstantiveCareAdvice,
  enforceChatDeliveryReview,
  isPureClarifyingQuestion,
  isPureGreetingOrSmallTalk,
  isPureScopeRefusalOrLimitation,
  isPureVerifiedOperationSummary,
  requiresChatDeliveryReview,
  type ChatDeliveryDraft,
} from '../server/chat-delivery-review.ts';
import { CHAT_DELIVERY_REVIEW_INCOMPLETE_TEXT } from '../src/shared/chat-delivery-review.ts';
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
    '谢谢',
    '再见',
    '不用谢',
    'You’re welcome!',
    '你好，謝謝',
    '早晨👋',
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
    '多謝，已刪晒所有記錄。',
    '唔該，記低咗啦。',
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

test('bare Cantonese operation claims and short-path numeric or Chinese-numeral doses fail closed through real ProductAgent (R2 F4-F5)', async () => {
  for (const opClaim of ['改咗提醒時間。', '刪咗所有紀錄。', '唔該，改咗啦。']) {
    const draft = makeDraft(opClaim, 'clarification');
    assert.equal(isPureGreetingOrSmallTalk(opClaim), false);
    assert.equal(requiresChatDeliveryReview(draft), true, `Must require review for bare operation claim: ${opClaim}`);

    let step = 0;
    let reviewCalls = 0;
    let saved: ProductAgentResult | null = null;
    const messageId = '66666666-6666-4666-8666-666666666661';
    const runId = '77777777-7777-4777-8777-777777777771';
    const runtime = createAgentRuntime({
      config: readAiConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: 'synthetic-project', AI_DAILY_USER_ATTEMPTS: '10', AI_DAILY_GLOBAL_ATTEMPTS: '50' }),
      usage: { reserve: async () => true, record: async () => {} },
      provider: {
        generate: async request => {
          const promptText = request.contents.flatMap(content => content.parts ?? []).map(part => part.text ?? '').join('\n');
          if (promptText.includes('chat-delivery-review')) {
            reviewCalls++;
            const payload = JSON.parse(promptText.slice(promptText.indexOf('{'))) as { draftHash: string; verifiedOperations?: unknown[] };
            assert.deepEqual(payload.verifiedOperations ?? [], []);
            return {
              content: {
                role: 'model',
                parts: [{ text: JSON.stringify({ draftHash: payload.draftHash, decision: 'insufficient_evidence', issues: [{ paragraph: 0, reason: 'unverified operation claim' }] }) }],
              },
              finishReason: FinishReason.STOP,
            };
          }
          step++;
          return {
            content: {
              role: 'model',
              parts: [{ functionCall: { id: `op-${step}`, name: 'present_answer', args: { kind: 'clarification', paragraphs: [{ text: opClaim, citationIds: [] }] } } }],
            },
            finishReason: FinishReason.STOP,
          };
        },
      },
    });
    const service = createProductAgent({
      runtime,
      store: {
        claim: async () => ({ runId, scope, created: true, state: 'running', expiresAt: new Date(Date.now() + 90000).toISOString() }),
        authorize: async () => true,
        finish: async (_s: unknown, result: ProductAgentResult) => { saved = result; return true; },
        get: async () => saved,
      },
      memory: {
        initialConversationSummary: async () => null,
        context: async () => ({
          profile: { childId: scope.childId, version: 0, data: null },
          profileApplicable: false,
          facts: [],
          topics: [],
          summary: null,
          recentMessages: [],
          conflictingKeys: [],
          unavailableFactKeys: [],
          truncated: { facts: false, topics: false, messages: false },
        }),
        facts: async () => ({ items: [], nextAfterId: null }),
      },
      chat: { listForUser: async () => ({ messages: [{ id: messageId, role: 'user', text: '幫我更改提醒時間' }] }) },
      tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) },
      knowledge: {
        createRun: () => ({
          search: async () => ({ mode: 'vector_keyword', chunks: [] }),
          revalidateCitations: async () => true,
        }),
      },
    } as unknown as Parameters<typeof createProductAgent>[0]);

    const result = await service.reply(scope.userId, scope.childId, messageId, async () => true);
    assert.equal(reviewCalls, 1, `Unverified operation claim must enter delivery review: ${opClaim}`);
    assert.equal(result?.status, 'stopped');
    assert.equal(result?.text.includes('改咗') || result?.text.includes('刪咗'), false);
  }

  for (const [userMsg, dosingText] of [
    ['隻藥應該點食？', '每次 10 ml。'],
    ['隻藥應該點食？', '每次半粒。'],
    ['隻藥應該點食？', '每次一粒。'],
    ['退燒藥粉食幾多？', '每次半包。'],
    ['隻藥應該點食？', '半粒。'],
  ] as const) {
    const draft: ChatDeliveryDraft = { ...makeDraft(dosingText, 'clarification'), userRequest: userMsg };
    assert.equal(isPureClarifyingQuestion(dosingText), false);
    assert.equal(draftLooksLikeSubstantiveCareAdvice(draft), true, dosingText);
    assert.equal(requiresChatDeliveryReview(draft), true, dosingText);
    assert.equal(chatDeliveryPassNeedsSources(draft), true, dosingText);

    let step = 0;
    let saved: ProductAgentResult | null = null;
    const messageId = '66666666-6666-4666-8666-666666666662';
    const runId = '77777777-7777-4777-8777-777777777772';
    const runtime = createAgentRuntime({
      config: readAiConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: 'synthetic-project', AI_DAILY_USER_ATTEMPTS: '10', AI_DAILY_GLOBAL_ATTEMPTS: '50' }),
      usage: { reserve: async () => true, record: async () => {} },
      provider: {
        generate: async request => {
          const promptText = request.contents.flatMap(content => content.parts ?? []).map(part => part.text ?? '').join('\n');
          if (promptText.includes('chat-delivery-review')) {
            const payload = JSON.parse(promptText.slice(promptText.indexOf('{'))) as { draftHash: string };
            return {
              content: { role: 'model', parts: [{ text: JSON.stringify({ draftHash: payload.draftHash, decision: 'pass', issues: [] }) }] },
              finishReason: FinishReason.STOP,
            };
          }
          const current = step++;
          const functionCall = current === 0
            ? { id: 'search-empty', name: 'search_knowledge', args: { query: userMsg, classification: 'official_guidance' } }
            : { id: 'present-dose', name: 'present_answer', args: { kind: 'clarification', paragraphs: [{ text: dosingText, citationIds: [] }] } };
          return { content: { role: 'model', parts: [{ functionCall }] }, finishReason: FinishReason.STOP };
        },
      },
    });
    const service = createProductAgent({
      runtime,
      store: {
        claim: async () => ({ runId, scope, created: true, state: 'running', expiresAt: new Date(Date.now() + 90000).toISOString() }),
        authorize: async () => true,
        finish: async (_s: unknown, result: ProductAgentResult) => { saved = result; return true; },
        get: async () => saved,
      },
      memory: {
        initialConversationSummary: async () => null,
        context: async () => ({
          profile: { childId: scope.childId, version: 0, data: null },
          profileApplicable: false,
          facts: [],
          topics: [],
          summary: null,
          recentMessages: [],
          conflictingKeys: [],
          unavailableFactKeys: [],
          truncated: { facts: false, topics: false, messages: false },
        }),
        facts: async () => ({ items: [], nextAfterId: null }),
      },
      chat: { listForUser: async () => ({ messages: [{ id: messageId, role: 'user', text: userMsg }] }) },
      tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) },
      knowledge: {
        createRun: () => ({
          search: async () => ({ mode: 'vector_keyword', chunks: [] }),
          revalidateCitations: async () => true,
        }),
      },
    } as unknown as Parameters<typeof createProductAgent>[0]);

    const result = await service.reply(scope.userId, scope.childId, messageId, async () => true);
    assert.equal(result?.status, 'stopped');
    assert.equal(result?.stopReason, 'delivery_review_no_sources');
    assert.equal(result?.text, CHAT_DELIVERY_REVIEW_INCOMPLETE_TEXT);
    assert.equal(result?.text.includes('10 ml') || result?.text.includes('半粒') || result?.text.includes('一粒') || result?.text.includes('半包'), false);
  }
});

test('R4: unverified completion wording and ungrounded dose amounts never become plain text (F2-F3)', async () => {
  const { requiresChatDeliveryReview: needsReview, draftLooksLikeSubstantiveCareAdvice: looksLikeCare } = await import('../server/chat-delivery-review.ts');
  const { createAgentRuntime: makeRuntime } = await import('../server/agent-runtime.ts');
  const { createProductAgent: makeAgent } = await import('../server/product-agent.ts');
  const { readAiConfig: readConfig } = await import('../server/ai-config.ts');
  const { FinishReason: Finish } = await import('@google/genai');
  const r4Scope = { userId: 'synthetic-user', workspaceId: 'synthetic-workspace', childId: '1ebcb39d-a2db-4b8c-a432-7ffcb3de5808', authorizationVersion: '1', dataVersion: 'epoch:1' };
  const messageId = '66666666-6666-4666-8666-6666666666a4';
  const runId = '77777777-7777-4777-8777-7777777777a4';

  async function presentOnly(userMsg: string, draftText: string) {
    let reviewCalls = 0;
    let saved: any = null;
    const runtime = makeRuntime({
      config: readConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: 'synthetic-project', AI_DAILY_USER_ATTEMPTS: '10', AI_DAILY_GLOBAL_ATTEMPTS: '50' }),
      usage: { reserve: async () => true, record: async () => {} },
      provider: {
        generate: async (request: any) => {
          const promptText = request.contents.flatMap((content: any) => content.parts ?? []).map((part: any) => part.text ?? '').join('\n');
          if (promptText.includes('chat-delivery-review')) {
            reviewCalls++;
            const payload = JSON.parse(promptText.slice(promptText.indexOf('{'))) as { draftHash: string; verifiedOperations?: unknown[] };
            assert.deepEqual(payload.verifiedOperations ?? [], []);
            return {
              content: { role: 'model', parts: [{ text: JSON.stringify({ draftHash: payload.draftHash, decision: 'insufficient_evidence', issues: [{ paragraph: 0, reason: 'unverified claim' }] }) }] },
              finishReason: Finish.STOP,
            };
          }
          return {
            content: { role: 'model', parts: [{ functionCall: { id: 'present-r4', name: 'present_answer', args: { kind: 'clarification', paragraphs: [{ text: draftText, citationIds: [] }] } } }] },
            finishReason: Finish.STOP,
          };
        },
      },
    } as any);
    const service = makeAgent({
      runtime,
      store: {
        claim: async () => ({ runId, scope: r4Scope, created: true, state: 'running', expiresAt: new Date(Date.now() + 90000).toISOString() }),
        authorize: async () => true,
        finish: async (_s: unknown, result: unknown) => { saved = result; return true; },
        get: async () => saved,
      },
      memory: {
        initialConversationSummary: async () => null,
        context: async () => ({
          profile: { childId: r4Scope.childId, version: 0, data: null },
          profileApplicable: false,
          facts: [],
          topics: [],
          summary: null,
          recentMessages: [],
          conflictingKeys: [],
          unavailableFactKeys: [],
          truncated: { facts: false, topics: false, messages: false },
        }),
        facts: async () => ({ items: [], nextAfterId: null }),
      },
      chat: { listForUser: async () => ({ messages: [{ id: messageId, role: 'user', text: userMsg }] }) },
      tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) },
      knowledge: { createRun: () => ({ search: async () => ({ mode: 'vector_keyword', chunks: [] }), revalidateCitations: async () => true }) },
    } as any);
    const result = await service.reply(r4Scope.userId, r4Scope.childId, messageId, async () => true);
    assert.ok(result);
    return { result, reviewCalls };
  }

  const draftOf = (userRequest: string, text: string) => ({
    userRequest,
    kind: 'clarification' as const,
    visibility: 'private' as const,
    serverSubstitutedSourceText: false,
    paragraphs: [{ text, citationIds: [] as string[] }],
    sources: [],
    scope: r4Scope,
  });

  for (const [userMsg, claim] of [
    ['幫我更改提醒', '提醒時間改好喇。'],
    ['刪除紀錄', '所有紀錄都清空晒。'],
    ['幫我取消提醒', '搞掂喇，提醒已經冇咗。'],
    ['幫我更新提醒時間', '提醒時間已經轉做七點。'],
  ] as const) {
    assert.equal(needsReview({
      kind: 'clarification',
      visibility: 'private',
      serverSubstitutedSourceText: false,
      paragraphs: [{ text: claim, citationIds: [] }],
      sources: [],
      scope: r4Scope,
    } as any), true, `Bare completion wording without userRequest must require review: ${claim}`);
    assert.equal(needsReview(draftOf(userMsg, claim) as any), true, `Completion wording without a receipt must require review: ${claim}`);
    const { result, reviewCalls } = await presentOnly(userMsg, claim);
    assert.equal(reviewCalls, 1, `Unverified completion must reach delivery review: ${claim}`);
    assert.equal(result.status, 'stopped');
    assert.equal(result.text.includes(claim), false);
  }

  for (const [userMsg, dose] of [
    ['BB發燒點算？', '每次四分之一粒。'],
    ['BB發燒點算？', '每晚半粒，連續三日。'],
    ['BB發燒點算？', '一日兩次，每次1/4粒。'],
    ['BB發燒點算？', '睡前食半茶匙。'],
    ['BB發燒點算？', '四分一粒。'],
    ['BB發燒點算？', '每4小時四分之一粒。'],
  ] as const) {
    const bareDraft = {
      kind: 'clarification' as const,
      visibility: 'private' as const,
      serverSubstitutedSourceText: false,
      paragraphs: [{ text: dose, citationIds: [] as string[] }],
      sources: [],
      scope: r4Scope,
    };
    assert.equal(looksLikeCare(bareDraft as any), true, `Bare dose wording must classify as care advice: ${dose}`);
    assert.equal(needsReview(bareDraft as any), true, `Bare dose wording must require review: ${dose}`);
    assert.equal(looksLikeCare(draftOf(userMsg, dose) as any), true, `Dose wording is care advice without a medicine word in the question: ${dose}`);
    assert.equal(needsReview(draftOf(userMsg, dose) as any), true, `Dose wording must require review: ${dose}`);
    const { result } = await presentOnly(userMsg, dose);
    assert.equal(result.status, 'stopped', `Ungrounded dose must not be delivered: ${dose}`);
    assert.equal(result.text.includes('粒') || result.text.includes('茶匙'), false);
  }

  for (const [userMsg, text] of [
    ['你好', '你好！有咩可以幫到你？'],
    ['幫我更改提醒', '你想改成幾點？'],
    ['BB發燒點算？', 'BB幾個月大？'],
  ] as const) {
    assert.equal(needsReview(draftOf(userMsg, text) as any), false, `Control must stay exempt: ${text}`);
  }

  // R5 F2-F3: statement + follow-up question, English spelled-out doses, and Chinese 小匙 must fail closed.
  for (const [userMsg, claim] of [
    ['幫我更改提醒時間', '提醒時間現為晚上八點。仲有其他事？'],
    ['刪除所有紀錄', '所有紀錄已經一筆不留。仲有其他事？'],
    ['幫我更改提醒時間', '提醒時間現為晚上八點，仲有其他事？'],
  ] as const) {
    assert.equal(needsReview(draftOf(userMsg, claim) as any), true, `R5 F2 must require review: ${claim}`);
    const { result, reviewCalls } = await presentOnly(userMsg, claim);
    assert.equal(reviewCalls, 1, `R5 F2 must reach review: ${claim}`);
    assert.equal(result.status, 'stopped');
    assert.equal(result.text.includes('晚上八點') || result.text.includes('一筆不留'), false);
  }
  for (const [userMsg, dose] of [
    ['BB發燒點算？', 'Take one tablet at bedtime.'],
    ['BB發燒點算？', '每餐一小匙，連續三日。'],
    ['BB發燒點算？', 'Give two teaspoons once daily.'],
  ] as const) {
    const bare = { kind: 'clarification', visibility: 'private', serverSubstitutedSourceText: false, paragraphs: [{ text: dose, citationIds: [] }], scope: r4Scope };
    assert.equal(looksLikeCare(bare as any), true, `R5 F3 care advice: ${dose}`);
    assert.equal(needsReview(bare as any), true, `R5 F3 bare review: ${dose}`);
    assert.equal(needsReview(draftOf(userMsg, dose) as any), true, `R5 F3 review: ${dose}`);
    const { result } = await presentOnly(userMsg, dose);
    assert.equal(result.status, 'stopped');
    assert.equal(result.text.includes('tablet') || result.text.includes('小匙') || result.text.includes('teaspoon'), false);
  }
});

test('structural review boundaries: state-claim+followup, receipt correspondence, arbitrary numerals/zero-number directives, and SPEC:301-304 separation', async t => {
  const testRunId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  for (const [userMsg, text] of [
    ['幫我更改提醒時間', '提醒時間而家係八點，想改邊一項？'],
    ['幫我更改提醒時間', '提醒時間而家係八點。想改邊一項？'],
    ['清空舊紀錄', '目前已清空舊紀錄，仲想做乜？'],
  ] as const) {
    const bareDraft: ChatDeliveryDraft = {
      kind: 'clarification',
      visibility: 'private',
      serverSubstitutedSourceText: false,
      paragraphs: [{ text, citationIds: [] }],
      sources: [],
      scope,
    };
    assert.equal(requiresChatDeliveryReview(bareDraft), true, `Bare result/state+question must require review: ${text}`);
    assert.equal(requiresChatDeliveryReview({ ...bareDraft, userRequest: userMsg }), true, `Result/state+question must require review: ${text}`);
  }
  for (const [userMsg, choice] of [
    ['幫我更改提醒時間', '你想改成八點定九點？'],
    ['幫我更改提醒時間', '請問，你想改成八點定九點？'],
    ['刪除所有紀錄', '請問你想刪除哪一項提醒？'],
  ] as const) {
    assert.equal(requiresChatDeliveryReview({
      userRequest: userMsg,
      kind: 'clarification',
      visibility: 'private',
      serverSubstitutedSourceText: false,
      paragraphs: [{ text: choice, citationIds: [] }],
      sources: [],
      scope,
    }), false, `Legitimate parameter choice must stay exempt: ${choice}`);
  }

  const mismatchedCases = [
    {
      name: 'pending_confirmation claiming executed create',
      text: '已幫你建立買牛奶提醒。',
      ops: [{ kind: 'pending_confirmation' as const, id: 'p1', tool: 'propose_task', state: 'pending_confirmation', summary: '買牛奶 (2026-11-17T09:00:00Z)' }],
    },
    {
      name: 'failed action_receipt claiming completed cancel',
      text: '已經取消買牛奶提醒。',
      ops: [{ kind: 'action_receipt' as const, id: 'r1', tool: 'change_ordinary_reminder', state: 'failed', summary: 'cancel: 買牛奶' }],
    },
    {
      name: 'private note save receipt claiming task deletion',
      text: '已刪除買蛋待辦。',
      ops: [{ kind: 'action_receipt' as const, id: 'r2', tool: 'save_private_instruction', state: 'saved', summary: '準備手冊: 帶健康手冊' }],
    },
    {
      name: 'create_ordinary_reminder receipt claiming cleared records',
      text: '已清空所有舊紀錄。',
      ops: [{ kind: 'action_receipt' as const, id: 'r3', tool: 'create_ordinary_reminder', state: 'saved', summary: '喝奶提醒 (2026-11-17T08:00:00+08:00)' }],
    },
    {
      name: 'save_ordinary_record water receipt claiming feeding 240ml',
      text: '已幫你記錄餵奶 240ml。',
      ops: [{ kind: 'action_receipt' as const, id: 'r4', tool: 'save_ordinary_record', state: 'saved', recordKind: 'feeding', summary: '喝水 100ml' }],
    },
    {
      name: 'create_ordinary_reminder milk receipt claiming eggs reminder',
      text: '已幫你設定買蛋提醒。',
      ops: [{ kind: 'action_receipt' as const, id: 'r5', tool: 'create_ordinary_reminder', state: 'saved', summary: '買牛奶' }],
    },
  ];
  for (const item of mismatchedCases) {
    const draft: ChatDeliveryDraft = {
      kind: 'operation',
      visibility: 'private',
      serverSubstitutedSourceText: false,
      verifiedOperations: item.ops,
      paragraphs: [{ text: item.text, citationIds: [] }],
      sources: [],
      scope,
    };
    assert.equal(isPureVerifiedOperationSummary(draft), false, `${item.name}: mismatched receipt must not qualify as verified summary`);
    assert.equal(requiresChatDeliveryReview(draft), true, `${item.name}: mismatched receipt must require review`);
    const budget = new AgentBudget();
    t.after(() => budget.close());
    await assert.rejects(
      enforceChatDeliveryReview({
        presentation: { text: item.text, citations: [], privateSourceCitations: [], retrievalMode: 'not_used' },
        tools: {
          presentation: async () => ({ text: item.text, citations: [], privateSourceCitations: [], retrievalMode: 'not_used' }),
          deliveryDraft: () => draft,
          replaceDeliveryAnswer: () => {},
        },
        context: {
          runId: testRunId,
          scope,
          budget,
          deliveryReview: createChatDeliveryReviewObligation(true),
          completeText: async ({ user }: { user: string }) => {
            const parsed = JSON.parse(user.slice(user.indexOf('{'))) as { draftHash: string };
            return JSON.stringify({ draftHash: parsed.draftHash, decision: 'pass', issues: [] });
          },
        } as any,
        provenance: { packVersion: 'test-v1', model: 'gemini-2.5-flash' },
      }),
      (err: unknown) => err instanceof AgentStopped && ['delivery_review_rejected', 'delivery_review_no_sources'].includes(err.reason),
      `${item.name}: acceptLivePass must reject mismatched operation claim even on pass`,
    );
  }
  const matchingDraft: ChatDeliveryDraft = {
    kind: 'operation',
    visibility: 'private',
    serverSubstitutedSourceText: false,
    verifiedOperations: [{ kind: 'action_receipt', id: 'ok-1', tool: 'save_ordinary_record', state: 'saved', recordKind: 'feeding', summary: '配方奶 120ml' }],
    paragraphs: [{ text: '已為你記錄寶寶飲配方奶 120ml。', citationIds: [] }],
    sources: [],
    scope,
  };
  assert.equal(isPureVerifiedOperationSummary(matchingDraft), true);
  assert.equal(chatDeliveryPassNeedsSources(matchingDraft), false);

  for (const text of [
    'Administer thirteen drops.',
    'Administer two thousand drops.',
    'Give twenty-five tablets daily.',
    '退燒前停止飲水。',
    '發熱前停止飲水。',
    '嘔吐後禁止進食。',
    'Stop drinking water until fever subsides.',
    'Withhold fluids after vomiting.',
  ]) {
    const draft: ChatDeliveryDraft = {
      userRequest: 'BB發燒點算？',
      kind: 'clarification',
      visibility: 'private',
      serverSubstitutedSourceText: false,
      paragraphs: [{ text, citationIds: [] }],
      sources: [],
      scope,
    };
    assert.equal(draftLooksLikeDirectiveCareAdvice(draft), true, `Directive care must match: ${text}`);
    assert.equal(draftLooksLikeSubstantiveCareAdvice(draft), true, `Substantive care must match: ${text}`);
    assert.equal(requiresChatDeliveryReview(draft), true, `Directive care must require review: ${text}`);
    assert.equal(chatDeliveryPassNeedsSources(draft), true, `Uncited directive care must require sources: ${text}`);
    assert.equal(isPureScopeRefusalOrLimitation(draft), false, `Directive care is never scope refusal: ${text}`);
  }

  assert.equal(chatDeliveryPassNeedsSources({
    userRequest: 'BB發燒點算，仲有對牛奶粉過敏紀錄嗎？',
    kind: 'record_restatement',
    visibility: 'private',
    serverSubstitutedSourceText: false,
    paragraphs: [{ text: '家庭紀錄顯示寶寶對牛奶蛋白過敏。', citationIds: ['mem-1'] }],
    sources: [{
      citationId: 'mem-1',
      version: '1',
      contentHash: chatDeliveryReviewSourceExcerpt('家庭紀錄顯示寶寶對牛奶蛋白過敏。').excerpt,
      classification: 'private',
      excerpt: '家庭紀錄顯示寶寶對牛奶蛋白過敏。',
      excerptComplete: true,
    }],
    scope,
  }), false);
  assert.equal(chatDeliveryPassNeedsSources({
    userRequest: 'BB發燒點算？',
    kind: 'clarification',
    visibility: 'private',
    serverSubstitutedSourceText: false,
    paragraphs: [{ text: '這類醫療診斷問題超出本系統協助範圍，無法提供解答。', citationIds: [] }],
    sources: [],
    scope,
  }), false);
  assert.equal(chatDeliveryPassNeedsSources({
    ...matchingDraft,
    userRequest: 'BB發燒點算，同幫我記低飲配方奶 120ml',
  }), false);

  for (const [userMsg, premiseQuestion] of [
    ['Change my reminder time', 'Which reminder do you want to change now that the milk reminder is set to 20:00?'],
    ['Change my reminder time', 'Since the 8pm reminder has been updated, which one should I edit next?'],
    ['幫我更改提醒時間', '既然八點嘅飲奶提醒已經設好，你想改邊一項？'],
    ['幫我更改提醒時間', '想改邊一項（目前飲奶提醒為晚上八點）？'],
  ] as const) {
    const bare: ChatDeliveryDraft = {
      kind: 'clarification',
      visibility: 'private',
      serverSubstitutedSourceText: false,
      paragraphs: [{ text: premiseQuestion, citationIds: [] }],
      sources: [],
      scope,
    };
    assert.equal(requiresChatDeliveryReview(bare), true, `Bare embedded-premise question must require review: ${premiseQuestion}`);
    assert.equal(requiresChatDeliveryReview({ ...bare, userRequest: userMsg }), true, `Embedded-premise question must require review: ${premiseQuestion}`);
  }
  for (const [userMsg, pureChoice] of [
    ['Change my reminder time', 'Which reminder would you like to change?'],
    ['Change my reminder time', 'Do you want to change it to 8pm or 9pm?'],
  ] as const) {
    assert.equal(requiresChatDeliveryReview({
      userRequest: userMsg,
      kind: 'clarification',
      visibility: 'private',
      serverSubstitutedSourceText: false,
      paragraphs: [{ text: pureChoice, citationIds: [] }],
      sources: [],
      scope,
    }), false, `Pure parameter question must stay exempt: ${pureChoice}`);
  }

  for (const text of [
    'Apply rubbing alcohol to the skin to cool them.',
    'Let them sleep face down.',
    'Put a cold towel on their forehead and sponge them with lukewarm water.',
    '幫佢用火酒抹身降溫。',
    '畀佢趴喺度瞓覺會舒服啲。',
  ]) {
    const draft: ChatDeliveryDraft = {
      userRequest: 'BB發燒點算？',
      kind: 'clarification',
      visibility: 'private',
      serverSubstitutedSourceText: false,
      paragraphs: [{ text, citationIds: [] }],
      sources: [],
      scope,
    };
    assert.equal(draftLooksLikeDirectiveCareAdvice(draft), true, `R7 F2 directive care must match: ${text}`);
    assert.equal(draftLooksLikeSubstantiveCareAdvice(draft), true, `R7 F2 substantive care must match: ${text}`);
    assert.equal(requiresChatDeliveryReview(draft), true, `R7 F2 must require review: ${text}`);
    assert.equal(chatDeliveryPassNeedsSources(draft), true, `R7 F2 uncited directive care must require sources: ${text}`);
  }

  const wrongTimeRecordDraft: ChatDeliveryDraft = {
    userRequest: '今朝 8 點張保仔食咗 120ml 配方奶，加咗 2 茶匙純米糊，食完精神好好，幫我記低佢。',
    kind: 'record_restatement',
    visibility: 'private',
    serverSubstitutedSourceText: false,
    verifiedOperations: [{
      kind: 'action_receipt',
      id: 'r-time-1',
      tool: 'save_ordinary_record',
      state: 'saved',
      recordKind: 'feeding',
      summary: '今朝 8 點飲咗 120ml 配方奶，加咗 2 茶匙純米糊，食完精神好好。',
      eventTime: '今朝 8 點',
    }],
    paragraphs: [{ text: '已記低張保仔今晚 9 點飲咗 120ml 配方奶及 2 茶匙純米糊，精神好好。', citationIds: [] }],
    sources: [],
    scope,
  };
  assert.equal(isPureVerifiedOperationSummary(wrongTimeRecordDraft), false);
  assert.equal(chatDeliveryPassNeedsSources(wrongTimeRecordDraft), true);

  const extraTargetReminderDraft: ChatDeliveryDraft = {
    userRequest: '幫我設定買牛奶同買雞蛋提醒',
    kind: 'operation',
    visibility: 'private',
    serverSubstitutedSourceText: false,
    verifiedOperations: [{
      kind: 'action_receipt',
      id: 'r-milk-only',
      tool: 'create_ordinary_reminder',
      state: 'saved',
      summary: '買牛奶 (2026-11-17T08:00:00+08:00)',
    }],
    paragraphs: [{ text: '已設定買牛奶同買雞蛋提醒。', citationIds: [] }],
    sources: [],
    scope,
  };
  assert.equal(isPureVerifiedOperationSummary(extraTargetReminderDraft), false);
  for (const badDraft of [wrongTimeRecordDraft, extraTargetReminderDraft]) {
    const budget = new AgentBudget();
    t.after(() => budget.close());
    await assert.rejects(
      enforceChatDeliveryReview({
        presentation: { text: badDraft.paragraphs[0]!.text, citations: [], privateSourceCitations: [], retrievalMode: 'not_used' },
        tools: {
          presentation: async () => ({ text: badDraft.paragraphs[0]!.text, citations: [], privateSourceCitations: [], retrievalMode: 'not_used' }),
          deliveryDraft: () => badDraft,
          replaceDeliveryAnswer: () => {},
        },
        context: {
          runId: testRunId,
          scope,
          budget,
          deliveryReview: createChatDeliveryReviewObligation(true),
          completeText: async ({ user }: { user: string }) => {
            const parsed = JSON.parse(user.slice(user.indexOf('{'))) as { draftHash: string };
            return JSON.stringify({ draftHash: parsed.draftHash, decision: 'pass', issues: [] });
          },
        } as any,
        provenance: { packVersion: 'test-v1', model: 'gemini-2.5-flash' },
      }),
      (err: unknown) => err instanceof AgentStopped && ['delivery_review_rejected', 'delivery_review_no_sources'].includes(err.reason),
    );
  }
});

test('N1: word-bounded health terms avoid Will/ill false positives while preserving real health obligations and sticky review', async () => {
  const { userId, childId } = scope;
  async function runSingleTurn(userMsg: string, draftText: string, kind: 'clarification' | 'operation' = 'clarification') {
    let calls = 0;
    let reviews = 0;
    let saved: ProductAgentResult | null = null;
    const msgId = 'aaaaaaaa-0000-4000-8000-000000000011';
    const localRunId = 'bbbbbbbb-0000-4000-8000-000000000011';
    const runtime = createAgentRuntime({
      config: readAiConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: 'synthetic-project' }),
      usage: { reserve: async () => true, record: async () => {} },
      provider: {
        generate: async request => {
          calls++;
          const promptText = request.contents.flatMap(content => content.parts ?? []).map(part => part.text ?? '').join('\n');
          if (promptText.includes('chat-delivery-review')) {
            reviews++;
            const payload = JSON.parse(promptText.slice(promptText.indexOf('{'))) as { draftHash: string };
            return {
              content: { role: 'model', parts: [{ text: JSON.stringify({ draftHash: payload.draftHash, decision: 'pass', issues: [] }) }] },
              finishReason: FinishReason.STOP,
            };
          }
          return {
            content: { role: 'model', parts: [{ functionCall: { id: `call-n1-${calls}`, name: 'present_answer', args: { kind, paragraphs: [{ text: draftText, citationIds: [] }] } } }] },
            finishReason: FinishReason.STOP,
          };
        },
      },
    });
    const service = createProductAgent({
      runtime,
      store: {
        claim: async () => ({ runId: localRunId, scope, created: true, sourceMessageId: msgId, state: 'running', expiresAt: new Date(Date.now() + 90_000).toISOString() }),
        authorize: async () => true,
        finish: async (_s: unknown, result: ProductAgentResult) => { saved = result; return true; },
        get: async () => saved,
      } as any,
      memory: { context: async () => ({ profile: { childId, version: 0, data: null }, profileApplicable: false, facts: [], topics: [], summary: null, recentMessages: [], conflictingKeys: [], unavailableFactKeys: [], truncated: { facts: false, topics: false, messages: false } }) } as any,
      chat: { listForUser: async () => ({ messages: [{ id: msgId, role: 'user', text: userMsg }] }) } as any,
      tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) } as any,
      knowledge: { createRun: () => ({ revalidateCitations: async () => true }) } as any,
    });
    const result = await service.reply(userId, childId, msgId, async () => true);
    assert.ok(result);
    return { result, calls, reviews };
  }

  for (const benignQuery of [
    'Will you help organise my notes?',
    'Help organise my notes.',
    'What should I do with my notes?',
    'How should I handle this reminder?',
  ]) {
    const { result, calls, reviews } = await runSingleTurn(benignQuery, 'Which note would you like to edit?');
    assert.equal(result.status, 'completed', benignQuery);
    assert.equal(calls, 1, benignQuery);
    assert.equal(reviews, 0, benignQuery);
    assert.equal(result.text, 'Which note would you like to edit?', benignQuery);
  }

  for (const [careQuery, draftText] of [
    ['My baby is ill, what should I do?', 'Rest in a quiet room today.'],
    ['My child is sick, what should I do?', 'Try half a teaspoon of syrup.'],
    ['BB病咗點算？', 'Keep them warm with one blanket today.'],
  ] as const) {
    const { result, reviews } = await runSingleTurn(careQuery, draftText, 'operation');
    assert.equal(reviews, 1, careQuery);
    assert.equal(result.status, 'stopped', careQuery);
    assert.equal(result.stopReason, 'delivery_review_no_sources', careQuery);
    assert.equal(result.text.includes(draftText), false, careQuery);
  }

  const budget = new AgentBudget();
  try {
    const obligation = createChatDeliveryReviewObligation();
    assert.equal(requiresChatDeliveryReview({
      userRequest: 'My child is ill.',
      kind: 'caregiving',
      visibility: 'private',
      serverSubstitutedSourceText: false,
      paragraphs: [{ text: 'Give ibuprofen.', citationIds: [] }],
      sources: [],
      scope,
    }, obligation), true);
    assert.equal(requiresChatDeliveryReview({
      userRequest: 'Will you help organise my notes?',
      kind: 'clarification',
      visibility: 'private',
      serverSubstitutedSourceText: false,
      paragraphs: [{ text: 'Which note would you like to edit?', citationIds: [] }],
      sources: [],
      scope,
    }, obligation), true);
    assert.equal(obligation.required, true);
  } finally {
    budget.close();
  }
});

test('N2: prefix-only claims fail closed across early and resolved stages; unrelated private sources cannot back clinical directives while real private facts still pass', async () => {
  const { userId, childId } = scope;
  const allergyFact = {
    id: 'aaaaaaaa-1111-4000-8000-000000000021',
    childId,
    key: 'allergy-milk',
    content: 'BB 對牛奶蛋白過敏',
    source: { kind: 'manual' as const, description: '家長確認' },
    validUntil: null,
    visibility: 'private' as const,
    intendedVisibility: 'private' as const,
    status: 'confirmed' as const,
    version: 1,
    createdBy: userId,
    confirmedBy: userId,
    confirmedAt: '2026-10-18T00:00:00.000Z',
    reason: '已確認',
    applicable: true,
    sourceState: 'current' as const,
  };
  const privateInputId = 'aaaaaaaa-2222-4000-8000-000000000022';

  async function runPrivateScenario(opts: {
    userMsg: string;
    answerText: string;
    answerKind?: 'record_restatement' | 'private_reference' | 'clarification';
    citePrivateSource?: boolean;
    privateExcerpt?: string;
    facts?: (typeof allergyFact)[];
  }) {
    let calls = 0;
    let reviews = 0;
    let saved: ProductAgentResult | null = null;
    const msgId = 'cccccccc-0000-4000-8000-000000000021';
    const localRunId = 'dddddddd-0000-4000-8000-000000000021';
    const runtime = createAgentRuntime({
      config: readAiConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: 'synthetic-project' }),
      usage: { reserve: async () => true, record: async () => {} },
      provider: {
        generate: async request => {
          calls++;
          const promptText = request.contents.flatMap(content => content.parts ?? []).map(part => part.text ?? '').join('\n');
          if (promptText.includes('chat-delivery-review')) {
            reviews++;
            const payload = JSON.parse(promptText.slice(promptText.indexOf('{'))) as { draftHash: string };
            return {
              content: { role: 'model', parts: [{ text: JSON.stringify({ draftHash: payload.draftHash, decision: 'pass', issues: [] }) }] },
              finishReason: FinishReason.STOP,
            };
          }
          if (opts.citePrivateSource && calls === 1) {
            return {
              content: { role: 'model', parts: [{ functionCall: { id: 'load-priv', name: 'load_capabilities', args: { capabilities: ['private_sources'] } } }] },
              finishReason: FinishReason.STOP,
            };
          }
          if (opts.citePrivateSource && calls === 2) {
            return {
              content: { role: 'model', parts: [{ functionCall: { id: 'read-priv', name: 'read_private_source', args: { inputId: privateInputId, expectedVersion: 1 } } }] },
              finishReason: FinishReason.STOP,
            };
          }
          const cid = opts.citePrivateSource ? [`private:${privateInputId}:1`] : [];
          return {
            content: {
              role: 'model',
              parts: [{
                functionCall: {
                  id: 'ans-n2',
                  name: 'present_answer',
                  args: { kind: opts.answerKind ?? 'record_restatement', paragraphs: [{ text: opts.answerText, citationIds: cid }] },
                },
              }],
            },
            finishReason: FinishReason.STOP,
          };
        },
      },
    });
    const privateItem = {
      id: privateInputId,
      version: 1,
      sourceLabel: 'Family Note',
      fetchState: 'ready',
      text: opts.privateExcerpt ?? 'BB 對雞蛋過敏',
      sha256: 'e'.repeat(64),
      management: {
        purpose: 'personal_reference',
        nature: 'parent_note',
        timeScope: 'ongoing',
        validityText: '有效',
        enabled: true,
        modelExcerpt: opts.privateExcerpt ?? 'BB 對雞蛋過敏',
      },
    };
    const service = createProductAgent({
      runtime,
      store: {
        claim: async () => ({ runId: localRunId, scope, created: true, sourceMessageId: msgId, state: 'running', expiresAt: new Date(Date.now() + 90_000).toISOString() }),
        authorize: async () => true,
        finish: async (_s: unknown, result: ProductAgentResult) => { saved = result; return true; },
        get: async () => saved,
      } as any,
      memory: {
        getFact: async (_u: string, _c: string, id: string) => (opts.facts ?? []).find(f => f.id === id) ?? null,
        context: async () => ({
          profile: { childId, version: 0, data: null },
          profileApplicable: false,
          facts: opts.facts ?? [],
          topics: [],
          summary: null,
          recentMessages: [],
          conflictingKeys: [],
          unavailableFactKeys: [],
          truncated: { facts: false, topics: false, messages: false },
        }),
      } as any,
      chat: { listForUser: async () => ({ messages: [{ id: msgId, role: 'user', text: opts.userMsg }] }) } as any,
      tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) } as any,
      knowledge: { createRun: () => ({ revalidateCitations: async () => true }) } as any,
      ...(opts.citePrivateSource ? {
        sources: {
          list: async () => ({ inputs: [privateItem], hasMore: false, nextCursor: null }),
          get: async () => privateItem,
        },
      } : {}),
    } as any);
    const result = await service.reply(userId, childId, msgId, async () => true);
    assert.ok(result);
    return { result, reviews };
  }

  for (const directive of [
    'Family records show: Maintain nil-by-mouth overnight.',
    'Maintain nil-by-mouth overnight.',
    '家庭紀錄顯示：應整晚禁飲食。',
  ]) {
    const { result } = await runPrivateScenario({ userMsg: 'BB發燒點算？', answerText: directive });
    assert.equal(result.status, 'stopped', directive);
    assert.equal(result.stopReason, 'delivery_review_no_sources', directive);
    assert.equal(result.text, CHAT_DELIVERY_REVIEW_INCOMPLETE_TEXT, directive);
  }

  for (const [label, excerpt] of [
    ['unrelated private excerpt', 'BB 對雞蛋過敏'],
    ['private excerpt repeating clinical directive', 'Maintain nil-by-mouth overnight.'],
  ] as const) {
    const { result } = await runPrivateScenario({
      userMsg: 'BB發燒點算？',
      answerText: 'Family records show: Maintain nil-by-mouth overnight.',
      answerKind: 'private_reference',
      citePrivateSource: true,
      privateExcerpt: excerpt,
    });
    assert.equal(result.status, 'stopped', label);
    assert.equal(result.stopReason, 'delivery_review_no_sources', label);
  }

  const unrelatedResolvedDraft = {
    userRequest: 'BB發燒點算？',
    kind: 'record_restatement' as const,
    visibility: 'private' as const,
    serverSubstitutedSourceText: false,
    paragraphs: [{ text: '家庭紀錄顯示今日只需多蓋被不用再量體溫。', citationIds: ['mem-unrelated'] }],
    sources: [{
      citationId: 'mem-unrelated',
      version: '1',
      contentHash: 'f'.repeat(64),
      classification: 'private' as const,
      excerpt: 'BB 對雞蛋過敏',
      excerptComplete: true,
    }],
    scope,
  };
  const stageObl = createChatDeliveryReviewObligation();
  assert.equal(requiresChatDeliveryReview({ ...unrelatedResolvedDraft, sources: [] }, stageObl), true);
  assert.equal(stageObl.evidenceRequired, true);
  assert.equal(chatDeliveryPassNeedsSources(unrelatedResolvedDraft, stageObl), true);

  const validPrivate = await runPrivateScenario({
    userMsg: 'BB發燒點算，仲有對牛奶蛋白過敏紀錄嗎？',
    answerText: '家庭紀錄顯示寶寶對牛奶蛋白過敏。',
    facts: [allergyFact],
  });
  assert.equal(validPrivate.result.status, 'completed');
  assert.equal(validPrivate.result.deliveryReview?.decision, 'pass');
  assert.equal(validPrivate.result.text, '家庭紀錄顯示寶寶對牛奶蛋白過敏。');
  assert.equal(validPrivate.reviews, 1);

  const validClarify = await runPrivateScenario({
    userMsg: 'BB發燒點算？',
    answerText: '寶寶幾個月大？',
    answerKind: 'clarification',
  });
  assert.equal(validClarify.result.status, 'completed');
  assert.equal(validClarify.reviews, 0);
});

test('N3: Server-verified operations avoid 300-char truncation and bind item-level quantities, units, subjects, and times across single/multi/duplicate receipts', async t => {
  const { userId, childId } = scope;
  const runId = 'ffffffff-0000-4000-8000-000000000031';
  async function runRecordRuntime(opts: {
    userMsg: string;
    records: Array<{ text: string; eventTime: string; at?: string }>;
    claimText: string;
  }) {
    let calls = 0;
    let reviews = 0;
    let seenOps: Array<{ summary?: string; recordKind?: string; eventTime?: string }> = [];
    let saved: ProductAgentResult | null = null;
    const msgId = 'eeeeeeee-0000-4000-8000-000000000031';
    const receipts = opts.records.map((_, idx) => ({
      id: `10000000-0000-4000-8000-00000000000${idx + 1}`,
      runId,
      kind: 'save_record' as const,
      resource: { kind: 'care_record' as const, id: `20000000-0000-4000-8000-00000000000${idx + 1}`, version: 1 },
      state: 'saved' as const,
      notification: 'not_authorized' as const,
      channels: [] as const,
      createdAt: '2026-11-17T00:00:00Z',
    }));
    const persisted = opts.records.map((rec, idx) => ({
      id: receipts[idx]!.resource.id,
      childId,
      version: 1,
      authorUserId: userId,
      createdAt: '2026-11-17T00:00:00Z',
      confirmedBy: userId,
      confirmedAt: '2026-11-17T00:00:00Z',
      reason: 'user statement',
      text: rec.text,
      source: 'user statement',
      confirmationBasis: 'preauthorized_user_statement' as const,
      details: {
        kind: 'feeding' as const,
        quantity: null,
        eventTime: { rawText: rec.eventTime, at: rec.at ?? null, timeZone: 'Asia/Hong_Kong' as const, precision: (rec.at ? 'exact' : 'approximate') as 'exact' | 'approximate' },
      },
    }));
    const runtime = createAgentRuntime({
      config: readAiConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: 'synthetic-project' }),
      usage: { reserve: async () => true, record: async () => {} },
      provider: {
        generate: async request => {
          calls++;
          const promptText = request.contents.flatMap(content => content.parts ?? []).map(part => part.text ?? '').join('\n');
          if (promptText.includes('chat-delivery-review')) {
            reviews++;
            const payload = JSON.parse(promptText.slice(promptText.indexOf('{'))) as { draftHash: string; verifiedOperations?: typeof seenOps };
            seenOps = payload.verifiedOperations ?? [];
            return {
              content: { role: 'model', parts: [{ text: JSON.stringify({ draftHash: payload.draftHash, decision: 'pass', issues: [] }) }] },
              finishReason: FinishReason.STOP,
            };
          }
          if (calls === 1) {
            return {
              content: { role: 'model', parts: [{ functionCall: { id: 'lc-n3', name: 'load_capabilities', args: { capabilities: ['care_records'] } } }] },
              finishReason: FinishReason.STOP,
            };
          }
          if (calls === 2) {
            return {
              content: {
                role: 'model',
                parts: opts.records.map((rec, execIdx) => ({
                  functionCall: {
                    id: `save-n3-${execIdx}`,
                    name: 'save_ordinary_record',
                    args: {
                      sourceQuote: opts.userMsg,
                      expectedPolicyVersion: 1,
                      text: rec.text,
                      details: {
                        kind: 'feeding',
                        quantity: null,
                        eventTime: { rawText: rec.eventTime, at: rec.at ?? null, timeZone: 'Asia/Hong_Kong', precision: rec.at ? 'exact' : 'approximate' },
                      },
                    },
                  },
                })),
              },
              finishReason: FinishReason.STOP,
            };
          }
          return {
            content: { role: 'model', parts: [{ functionCall: { id: 'pres-n3', name: 'present_answer', args: { kind: 'record_restatement', paragraphs: [{ text: opts.claimText, citationIds: [] }] } } }] },
            finishReason: FinishReason.STOP,
          };
        },
      },
    });
    let execCount = 0;
    const service = createProductAgent({
      runtime,
      store: {
        claim: async () => ({ runId, scope, created: true, sourceMessageId: msgId, state: 'running', expiresAt: new Date(Date.now() + 90_000).toISOString() }),
        authorize: async () => true,
        finish: async (_s: unknown, result: ProductAgentResult) => { saved = result; return true; },
        get: async () => saved,
      } as any,
      actions: {
        policy: async () => ({ version: 1, effective: true, recordKinds: ['feeding'], allowPrivateNotes: false, allowSelfTasks: false, allowRecordCorrections: false, reminderConsentVersion: null, reminderBindings: [] }),
        records: async () => ({ records: [], limit: 20, scanned: 0, nextCursor: null }),
        notes: async () => ({ items: [], nextAfterId: null }),
        execute: async () => receipts[execCount++]!,
        receipts: async () => receipts.slice(0, execCount),
        recordById: async (_u: string, _c: string, id: string) => persisted.find(p => p.id === id) ?? null,
      } as any,
      memory: { context: async () => ({ profile: { childId, version: 0, data: null }, profileApplicable: false, facts: [], topics: [], summary: null, recentMessages: [{ id: msgId, childId, role: 'user', text: opts.userMsg }], conflictingKeys: [], unavailableFactKeys: [], truncated: { facts: false, topics: false, messages: false } }) } as any,
      chat: { listForUser: async () => ({ messages: [{ id: msgId, childId, role: 'user', text: opts.userMsg }] }) } as any,
      tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) } as any,
      knowledge: { createRun: () => ({ revalidateCitations: async () => true }) } as any,
    });
    const result = await service.reply(userId, childId, msgId, async () => true);
    assert.ok(result);
    return { result, reviews, seenOps };
  }

  const swappedSingle = await runRecordRuntime({
    userMsg: '今朝 8 點飲 120ml 配方奶，加 240ml 水，幫我記低。',
    records: [{ text: '今朝 8 點飲 120ml 配方奶，加 240ml 水。', eventTime: '今朝 8 點' }],
    claimText: '已記低今朝 8 點飲 240ml 配方奶及 120ml 水。',
  });
  assert.equal(swappedSingle.reviews, 1);
  assert.equal(swappedSingle.result.status, 'stopped');
  assert.ok(['delivery_review_rejected', 'delivery_review_no_sources'].includes(swappedSingle.result.stopReason ?? ''));
  assert.equal(swappedSingle.result.text.includes('240ml 配方奶'), false);
  assert.equal(swappedSingle.result.text.includes('120ml 水'), false);

  const longPrefix = `${'家長備註晨間照顧流程紀錄文字說明，'.repeat(20)}`;
  assert.ok(longPrefix.length > 300);
  const longTailText = `${longPrefix}今朝 8 點飲 120ml 配方奶，加 240ml 水。`;
  const longPass = await runRecordRuntime({
    userMsg: longTailText,
    records: [{ text: longTailText, eventTime: '今朝 8 點' }],
    claimText: '已記低今朝 8 點飲 120ml 配方奶及 240ml 水。',
  });
  assert.ok((longPass.seenOps[0]?.summary?.length ?? 0) > 300);
  assert.equal(longPass.result.status, 'completed');
  assert.equal(longPass.result.deliveryReview?.decision, 'pass');

  const longSwapped = await runRecordRuntime({
    userMsg: longTailText,
    records: [{ text: longTailText, eventTime: '今朝 8 點' }],
    claimText: '已記低今朝 8 點飲 240ml 配方奶及 120ml 水。',
  });
  assert.equal(longSwapped.result.status, 'stopped');
  assert.ok(['delivery_review_rejected', 'delivery_review_no_sources'].includes(longSwapped.result.stopReason ?? ''));

  const multiPass = await runRecordRuntime({
    userMsg: '今朝 8 點飲 120ml 配方奶，同飲 240ml 水，分兩筆幫我記低。',
    records: [
      { text: '今朝 8 點飲 120ml 配方奶。', eventTime: '今朝 8 點' },
      { text: '今朝 8 點飲 240ml 水。', eventTime: '今朝 8 點' },
    ],
    claimText: '已記低今朝 8 點飲 120ml 配方奶及 240ml 水。',
  });
  assert.equal(multiPass.result.status, 'completed');
  assert.equal(multiPass.result.deliveryReview?.decision, 'pass');

  const multiSwapped = await runRecordRuntime({
    userMsg: '今朝 8 點飲 120ml 配方奶，同飲 240ml 水，分兩筆幫我記低。',
    records: [
      { text: '今朝 8 點飲 120ml 配方奶。', eventTime: '今朝 8 點' },
      { text: '今朝 8 點飲 240ml 水。', eventTime: '今朝 8 點' },
    ],
    claimText: '已記低今朝 8 點飲 240ml 配方奶及 120ml 水。',
  });
  assert.equal(multiSwapped.result.status, 'stopped');

  const dupPass = await runRecordRuntime({
    userMsg: '今朝 8 點飲 120ml 配方奶，下午 2 點又飲 120ml 配方奶。',
    records: [
      { text: '今朝 8 點飲 120ml 配方奶。', eventTime: '今朝 8 點' },
      { text: '下午 2 點飲 120ml 配方奶。', eventTime: '下午 2 點' },
    ],
    claimText: '已記低今朝 8 點飲 120ml 配方奶，及下午 2 點飲 120ml 配方奶。',
  });
  assert.equal(dupPass.result.status, 'completed');

  const dupOverclaimDraft = {
    kind: 'record_restatement' as const,
    visibility: 'private' as const,
    serverSubstitutedSourceText: false,
    verifiedOperations: [{ kind: 'action_receipt' as const, id: 'dup-1', tool: 'save_ordinary_record', state: 'saved', recordKind: 'feeding', summary: '今朝 8 點飲 120ml 配方奶。', eventTime: '今朝 8 點' }],
    paragraphs: [{ text: '已記低今朝 8 點飲 120ml 配方奶，另外仲飲 120ml 配方奶。', citationIds: [] }],
    sources: [],
    scope,
  };
  assert.equal(isPureVerifiedOperationSummary(dupOverclaimDraft), false);

  for (const badDraft of [
    {
      ...dupOverclaimDraft,
      kind: 'operation' as const,
      verifiedOperations: [
        { kind: 'action_receipt' as const, id: 't1', tool: 'create_ordinary_reminder', state: 'saved', summary: '買牛奶 (2026-11-17T08:00:00+08:00)', dueAt: '2026-11-17T08:00:00+08:00' },
        { kind: 'action_receipt' as const, id: 't2', tool: 'create_ordinary_reminder', state: 'saved', summary: '買雞蛋 (2026-11-17T21:00:00+08:00)', dueAt: '2026-11-17T21:00:00+08:00' },
      ],
      paragraphs: [{ text: '已設定今晚 9 點買牛奶及今朝 8 點買雞蛋提醒。', citationIds: [] }],
    },
    {
      ...dupOverclaimDraft,
      verifiedOperations: [{ kind: 'action_receipt' as const, id: 'amb-1', tool: 'save_ordinary_record', state: 'saved', recordKind: 'feeding', summary: '今朝 8 點飲 120ml 配方奶，加 240ml 水。', eventTime: '今朝 8 點' }],
      paragraphs: [{ text: '已記低今朝 8 點飲 120ml 同 240ml 配方奶及水。', citationIds: [] }],
    },
    {
      ...dupOverclaimDraft,
      verifiedOperations: [{ kind: 'action_receipt' as const, id: 'rem-1', tool: 'save_ordinary_record', state: 'saved', recordKind: 'feeding', summary: '飲 120ml 配方奶。', quantity: null, quantityGroundingStatus: 'removed' as const }],
      paragraphs: [{ text: '已記低飲 120ml 配方奶。', citationIds: [] }],
    },
  ]) {
    assert.equal(isPureVerifiedOperationSummary(badDraft), false, badDraft.paragraphs[0]!.text);
    const budget = new AgentBudget();
    t.after(() => budget.close());
    await assert.rejects(
      enforceChatDeliveryReview({
        presentation: { text: badDraft.paragraphs[0]!.text, citations: [], privateSourceCitations: [], retrievalMode: 'not_used' },
        tools: {
          presentation: async () => ({ text: badDraft.paragraphs[0]!.text, citations: [], privateSourceCitations: [], retrievalMode: 'not_used' }),
          deliveryDraft: () => badDraft,
          replaceDeliveryAnswer: () => {},
        },
        context: {
          runId,
          scope,
          budget,
          deliveryReview: createChatDeliveryReviewObligation(true),
          completeText: async ({ user }: { user: string }) => {
            const parsed = JSON.parse(user.slice(user.indexOf('{'))) as { draftHash: string };
            return JSON.stringify({ draftHash: parsed.draftHash, decision: 'pass', issues: [] });
          },
        } as any,
        provenance: { packVersion: 'test-v1', model: 'gemini-2.5-flash' },
      }),
      (err: unknown) => err instanceof AgentStopped && ['delivery_review_rejected', 'delivery_review_no_sources'].includes(err.reason),
    );
  }
});

test('N1-R / N2-R / N3-R: polysemous formula exclusion, per-clause private support, and full ISO calendar-date correspondence', async () => {
  const userId = scope.userId;
  const childId = scope.childId;
  const allergyFact = {
    id: 'aaaaaaaa-1111-4000-8000-000000000091',
    childId,
    key: 'allergy-milk-r9',
    content: 'BB對牛奶蛋白過敏',
    source: { kind: 'manual' as const, description: '家長確認' },
    validUntil: null,
    visibility: 'private' as const,
    intendedVisibility: 'private' as const,
    status: 'confirmed' as const,
    version: 1,
    createdBy: userId,
    confirmedBy: userId,
    confirmedAt: '2026-10-18T00:00:00.000Z',
    reason: '已確認',
    applicable: true,
    sourceState: 'current' as const,
  };
  const sleepFact = {
    ...allergyFact,
    id: 'aaaaaaaa-1111-4000-8000-000000000092',
    key: 'sleep-nap-r9',
    content: 'BB平時下晝 2 點會瞓晏晝覺',
  };

  async function runDeliveryFlow(opts: {
    userMsg: string;
    answerKind: 'clarification' | 'record_restatement' | 'operation';
    answerText: string;
    facts?: (typeof allergyFact)[];
    records?: Array<{ text: string; eventTime: string; at?: string }>;
  }) {
    let calls = 0;
    let reviews = 0;
    let saved: ProductAgentResult | null = null;
    const msgId = 'dddddddd-1111-4000-8000-000000000091';
    const localRunId = 'eeeeeeee-1111-4000-8000-000000000091';
    const receipts = (opts.records ?? []).map((_, idx) => ({
      id: `30000000-0000-4000-8000-00000000000${idx + 1}`,
      runId: localRunId,
      kind: 'save_record' as const,
      resource: { kind: 'care_record' as const, id: `40000000-0000-4000-8000-00000000000${idx + 1}`, version: 1 },
      state: 'saved' as const,
      notification: 'not_authorized' as const,
      channels: [] as const,
      createdAt: '2026-11-17T00:00:00Z',
    }));
    const persisted = (opts.records ?? []).map((rec, idx) => ({
      id: receipts[idx]!.resource.id,
      childId,
      version: 1,
      authorUserId: userId,
      createdAt: '2026-11-17T00:00:00Z',
      confirmedBy: userId,
      confirmedAt: '2026-11-17T00:00:00Z',
      reason: 'user statement',
      text: rec.text,
      source: 'user statement',
      confirmationBasis: 'preauthorized_user_statement' as const,
      details: {
        kind: 'feeding' as const,
        quantity: null,
        eventTime: { rawText: rec.eventTime, at: rec.at ?? null, timeZone: 'Asia/Hong_Kong' as const, precision: (rec.at ? 'exact' : 'approximate') as 'exact' | 'approximate' },
      },
    }));
    const runtime = createAgentRuntime({
      config: readAiConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: 'synthetic-project' }),
      usage: { reserve: async () => true, record: async () => {} },
      provider: {
        generate: async request => {
          calls++;
          const promptText = request.contents.flatMap(content => content.parts ?? []).map(part => part.text ?? '').join('\n');
          if (promptText.includes('chat-delivery-review')) {
            reviews++;
            const payload = JSON.parse(promptText.slice(promptText.indexOf('{'))) as { draftHash: string };
            return {
              content: { role: 'model', parts: [{ text: JSON.stringify({ draftHash: payload.draftHash, decision: 'pass', issues: [] }) }] },
              finishReason: FinishReason.STOP,
            };
          }
          if (opts.records?.length && calls === 1) {
            return {
              content: { role: 'model', parts: [{ functionCall: { id: 'lc-r', name: 'load_capabilities', args: { capabilities: ['care_records'] } } }] },
              finishReason: FinishReason.STOP,
            };
          }
          if (opts.records?.length && calls === 2) {
            return {
              content: {
                role: 'model',
                parts: opts.records.map((rec, idx) => ({
                  functionCall: {
                    id: `save-r-${idx}`,
                    name: 'save_ordinary_record',
                    args: {
                      sourceQuote: opts.userMsg,
                      expectedPolicyVersion: 1,
                      text: rec.text,
                      details: {
                        kind: 'feeding',
                        quantity: null,
                        eventTime: { rawText: rec.eventTime, at: rec.at ?? null, timeZone: 'Asia/Hong_Kong', precision: rec.at ? 'exact' : 'approximate' },
                      },
                    },
                  },
                })),
              },
              finishReason: FinishReason.STOP,
            };
          }
          return {
            content: { role: 'model', parts: [{ functionCall: { id: 'pres-r', name: 'present_answer', args: { kind: opts.answerKind, paragraphs: [{ text: opts.answerText, citationIds: [] }] } } }] },
            finishReason: FinishReason.STOP,
          };
        },
      },
    });
    let execCount = 0;
    const service = createProductAgent({
      runtime,
      store: {
        claim: async () => ({ runId: localRunId, scope, created: true, sourceMessageId: msgId, state: 'running', expiresAt: new Date(Date.now() + 90_000).toISOString() }),
        authorize: async () => true,
        finish: async (_s: unknown, result: ProductAgentResult) => { saved = result; return true; },
        get: async () => saved,
      } as any,
      ...(opts.records?.length ? {
        actions: {
          policy: async () => ({ version: 1, effective: true, recordKinds: ['feeding'], allowPrivateNotes: false, allowSelfTasks: false, allowRecordCorrections: false, reminderConsentVersion: null, reminderBindings: [] }),
          records: async () => ({ records: [], limit: 20, scanned: 0, nextCursor: null }),
          notes: async () => ({ items: [], nextAfterId: null }),
          execute: async () => receipts[execCount++]!,
          receipts: async () => receipts.slice(0, execCount),
          recordById: async (_u: string, _c: string, id: string) => persisted.find(p => p.id === id) ?? null,
        } as any,
      } : {}),
      memory: {
        getFact: async (_u: string, _c: string, id: string) => (opts.facts ?? []).find(f => f.id === id) ?? null,
        context: async () => ({
          profile: { childId, version: 0, data: null },
          profileApplicable: false,
          facts: opts.facts ?? [],
          topics: [],
          summary: null,
          recentMessages: opts.records?.length ? [{ id: msgId, childId, role: 'user', text: opts.userMsg }] : [],
          conflictingKeys: [],
          unavailableFactKeys: [],
          truncated: { facts: false, topics: false, messages: false },
        }),
      } as any,
      chat: { listForUser: async () => ({ messages: [{ id: msgId, childId, role: 'user', text: opts.userMsg }] }) } as any,
      tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) } as any,
      knowledge: { createRun: () => ({ revalidateCitations: async () => true }) } as any,
    });
    const result = await service.reply(userId, childId, msgId, async () => true);
    assert.ok(result);
    return { result, calls, reviews };
  }

  for (const benign of ['How should I handle this spreadsheet formula?', 'How should I handle this spreadsheet equation?', 'How should I handle this Halloween treat?']) {
    const out = await runDeliveryFlow({ userMsg: benign, answerKind: 'clarification', answerText: 'Which spreadsheet cell would you like to edit?' });
    assert.equal(out.result.status, 'completed', benign);
    assert.equal(out.calls, 1, benign);
    assert.equal(out.reviews, 0, benign);
  }
  for (const infantQuery of ['How should I handle preparing infant formula?', 'How should I handle formula milk storage?']) {
    const out = await runDeliveryFlow({ userMsg: infantQuery, answerKind: 'operation', answerText: 'Keep it on the counter for a day.' });
    assert.equal(out.reviews, 1, infantQuery);
    assert.equal(out.result.status, 'stopped', infantQuery);
    assert.equal(out.result.stopReason, 'delivery_review_no_sources', infantQuery);
  }

  for (const badPrivateText of [
    '家庭紀錄顯示寶寶對牛奶蛋白過敏，但寶寶並無牛奶蛋白過敏。',
    '家庭紀錄顯示寶寶對牛奶蛋白過敏，亦對雞蛋過敏。',
    '家庭紀錄顯示寶寶對牛奶蛋白過敏但寶寶並無牛奶蛋白過敏。',
    '家庭紀錄顯示寶寶對牛奶蛋白及雞蛋過敏。',
    '家庭紀錄顯示寶寶並無牛奶蛋白過敏。',
  ]) {
    const out = await runDeliveryFlow({
      userMsg: 'BB發燒點算，仲有對牛奶蛋白過敏紀錄嗎？',
      answerKind: 'record_restatement',
      answerText: badPrivateText,
      facts: [allergyFact],
    });
    assert.equal(out.result.status, 'stopped', badPrivateText);
    assert.equal(out.result.stopReason, 'delivery_review_no_sources', badPrivateText);
    assert.equal(out.result.text.includes('牛奶蛋白'), false, badPrivateText);
  }
  const goodSingle = await runDeliveryFlow({
    userMsg: 'BB發燒點算，仲有對牛奶蛋白過敏紀錄嗎？',
    answerKind: 'record_restatement',
    answerText: '家庭紀錄顯示寶寶對牛奶蛋白過敏。',
    facts: [allergyFact],
  });
  assert.equal(goodSingle.result.status, 'completed');
  assert.equal(goodSingle.result.deliveryReview?.decision, 'pass');
  const goodMultiFact = await runDeliveryFlow({
    userMsg: 'BB發燒點算，仲有對牛奶蛋白過敏同作息紀錄嗎？',
    answerKind: 'record_restatement',
    answerText: '家庭紀錄顯示寶寶對牛奶蛋白過敏，平時下午 2 點會睡午覺。',
    facts: [allergyFact, sleepFact],
  });
  assert.equal(goodMultiFact.result.status, 'completed');

  for (const wrongDateClaim of [
    '已記低2026-11-18T08:00:00+08:00 飲120ml奶。',
    '已記低2026-11-18 08:00 飲120ml奶。',
    '已記低2026-11-17T08:00:00Z 飲120ml奶。',
  ]) {
    const out = await runDeliveryFlow({
      userMsg: '記低2026-11-17T08:00:00+08:00 飲120ml奶。',
      answerKind: 'record_restatement',
      answerText: wrongDateClaim,
      records: [{ text: '2026-11-17T08:00:00+08:00 飲120ml奶。', eventTime: '2026-11-17T08:00:00+08:00', at: '2026-11-17T00:00:00Z' }],
    });
    assert.equal(out.reviews, 1, wrongDateClaim);
    assert.equal(out.result.status, 'stopped', wrongDateClaim);
    assert.ok(['delivery_review_rejected', 'delivery_review_no_sources'].includes(out.result.stopReason ?? ''), wrongDateClaim);
  }
  for (const exactDateClaim of [
    '已記低2026-11-17T08:00:00+08:00 飲120ml奶。',
    '已記低2026-11-17T00:00:00Z 飲120ml奶。',
  ]) {
    const out = await runDeliveryFlow({
      userMsg: '記低2026-11-17T08:00:00+08:00 飲120ml奶。',
      answerKind: 'record_restatement',
      answerText: exactDateClaim,
      records: [{ text: '2026-11-17T08:00:00+08:00 飲120ml奶。', eventTime: '2026-11-17T08:00:00+08:00', at: '2026-11-17T00:00:00Z' }],
    });
    assert.equal(out.result.status, 'completed', exactDateClaim);
    assert.equal(out.result.deliveryReview?.decision, 'pass', exactDateClaim);
  }
});

test('BND-1: mixed-kind private drafts validate every paragraph by content without trusting sibling record or clarification labels', async () => {
  const userId = scope.userId;
  const childId = scope.childId;
  const allergyFact = {
    id: 'aaaaaaaa-1111-4000-8000-000000000191',
    childId,
    key: 'allergy-milk-bnd1',
    content: 'BB 對牛奶蛋白過敏',
    source: { kind: 'manual' as const, description: '家長確認' },
    validUntil: null,
    visibility: 'private' as const,
    intendedVisibility: 'private' as const,
    status: 'confirmed' as const,
    version: 1,
    createdBy: userId,
    confirmedBy: userId,
    confirmedAt: '2026-10-18T00:00:00.000Z',
    reason: '已確認',
    applicable: true,
    sourceState: 'current' as const,
  };
  const officialChunk = {
    chunkId: '00000000-0000-4000-8000-000000000411',
    versionId: '00000000-0000-4000-8000-000000000412',
    sourceId: 'fhs-solid-food',
    title: '嬰幼兒飲食－引進固體食物過渡期',
    classification: 'official_guidance' as const,
    text: '嬰兒約六個月大時可開始嘗試固體食物。',
  };

  async function runMixedParagraphFlow(opts: {
    userMsg: string;
    answerKind: 'record_restatement' | 'clarification' | 'mixed';
    paragraphs: Array<{ kind: 'record_restatement' | 'clarification' | 'caregiving'; text: string; citationIds: string[] }>;
    facts?: (typeof allergyFact)[];
    searchOfficial?: boolean;
  }) {
    let calls = 0;
    let reviews = 0;
    let saved: ProductAgentResult | null = null;
    const msgId = 'dddddddd-1111-4000-8000-000000000191';
    const localRunId = 'eeeeeeee-1111-4000-8000-000000000191';
    const runtime = createAgentRuntime({
      config: readAiConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: 'synthetic-project' }),
      usage: { reserve: async () => true, record: async () => {} },
      provider: {
        generate: async request => {
          calls++;
          const promptText = request.contents.flatMap(content => content.parts ?? []).map(part => part.text ?? '').join('\n');
          if (promptText.includes('chat-delivery-review')) {
            reviews++;
            const payload = JSON.parse(promptText.slice(promptText.indexOf('{'))) as { draftHash: string };
            return {
              content: { role: 'model', parts: [{ text: JSON.stringify({ draftHash: payload.draftHash, decision: 'pass', issues: [] }) }] },
              finishReason: FinishReason.STOP,
            };
          }
          if (opts.searchOfficial && calls === 1) {
            return {
              content: { role: 'model', parts: [{ functionCall: { id: 'k-bnd1', name: 'search_knowledge', args: { query: '六個月固體食物', classification: 'official_guidance' } } }] },
              finishReason: FinishReason.STOP,
            };
          }
          return {
            content: { role: 'model', parts: [{ functionCall: { id: 'pres-bnd1', name: 'present_answer', args: { kind: opts.answerKind, paragraphs: opts.paragraphs } } }] },
            finishReason: FinishReason.STOP,
          };
        },
      },
    });
    const service = createProductAgent({
      runtime,
      store: {
        claim: async () => ({ runId: localRunId, scope, created: true, sourceMessageId: msgId, state: 'running', expiresAt: new Date(Date.now() + 90_000).toISOString() }),
        authorize: async () => true,
        finish: async (_s: unknown, result: ProductAgentResult) => { saved = result; return true; },
        get: async () => saved,
      } as any,
      memory: {
        getFact: async (_u: string, _c: string, id: string) => (opts.facts ?? []).find(f => f.id === id) ?? null,
        context: async () => ({
          profile: { childId, version: 0, data: null },
          profileApplicable: false,
          facts: opts.facts ?? [],
          topics: [],
          summary: null,
          recentMessages: [],
          conflictingKeys: [],
          unavailableFactKeys: [],
          truncated: { facts: false, topics: false, messages: false },
        }),
      } as any,
      chat: { listForUser: async () => ({ messages: [{ id: msgId, childId, role: 'user', text: opts.userMsg }] }) } as any,
      tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) } as any,
      knowledge: {
        createRun: () => ({
          search: async () => ({ mode: 'vector_keyword', chunks: opts.searchOfficial ? [officialChunk] : [] }),
          revalidateCitations: async () => true,
        }),
      } as any,
    });
    const result = await service.reply(userId, childId, msgId, async () => true);
    assert.ok(result);
    return { result, reviews };
  }

  for (const neg of [
    {
      name: 'BND-1 record_restatement + spoofed clarification allergy',
      answerKind: 'record_restatement' as const,
      facts: [allergyFact],
      searchOfficial: false,
      paragraphs: [
        { kind: 'record_restatement' as const, text: '家庭紀錄顯示寶寶對牛奶蛋白過敏。', citationIds: [] },
        { kind: 'clarification' as const, text: '寶寶對腰果過敏。', citationIds: [] },
      ],
    },
    {
      name: 'BND-1 top-level clarification + record_restatement + spoofed clarification',
      answerKind: 'clarification' as const,
      facts: [allergyFact],
      searchOfficial: false,
      paragraphs: [
        { kind: 'record_restatement' as const, text: '家庭紀錄顯示寶寶對牛奶蛋白過敏。', citationIds: [] },
        { kind: 'clarification' as const, text: '寶寶對腰果過敏。', citationIds: [] },
      ],
    },
    {
      name: 'BND-1 official citation + uncited spoofed allergy paragraph',
      answerKind: 'mixed' as const,
      facts: [allergyFact],
      searchOfficial: true,
      paragraphs: [
        { kind: 'caregiving' as const, text: '嬰兒約六個月大時可開始嘗試固體食物。', citationIds: [officialChunk.chunkId] },
        { kind: 'clarification' as const, text: '寶寶對腰果過敏。', citationIds: [] },
      ],
    },
    {
      name: 'BND-1 scope-refusal smuggling fake private allergy',
      answerKind: 'record_restatement' as const,
      facts: [allergyFact],
      searchOfficial: false,
      paragraphs: [
        { kind: 'record_restatement' as const, text: '家庭紀錄顯示寶寶對牛奶蛋白過敏。', citationIds: [] },
        { kind: 'clarification' as const, text: '這類問題超出範圍，無法提供解答。但寶寶對腰果過敏。', citationIds: [] },
      ],
    },
  ]) {
    const out = await runMixedParagraphFlow({
      userMsg: 'BB最近情況點樣，幫我查返已確認家庭紀錄？',
      answerKind: neg.answerKind,
      paragraphs: neg.paragraphs,
      facts: neg.facts,
      searchOfficial: neg.searchOfficial,
    });
    assert.equal(out.reviews, 1, neg.name);
    assert.equal(out.result.status, 'stopped', neg.name);
    assert.equal(out.result.stopReason, 'delivery_review_no_sources', neg.name);
    assert.equal(out.result.text.includes('腰果'), false, neg.name);
  }

  for (const pos of [
    {
      name: 'BND-1 positive supported two-paragraph record',
      paragraphs: [
        { kind: 'record_restatement' as const, text: '家庭紀錄顯示寶寶對牛奶蛋白過敏。', citationIds: [] },
        { kind: 'record_restatement' as const, text: '家庭紀錄顯示寶寶對牛奶蛋白過敏。', citationIds: [] },
      ],
    },
    {
      name: 'BND-1 positive record + genuine bounded clarification',
      paragraphs: [
        { kind: 'record_restatement' as const, text: '家庭紀錄顯示寶寶對牛奶蛋白過敏。', citationIds: [] },
        { kind: 'clarification' as const, text: '寶寶幾個月大？', citationIds: [] },
      ],
    },
  ]) {
    const out = await runMixedParagraphFlow({
      userMsg: 'BB最近情況點樣，幫我查返已確認家庭紀錄？',
      answerKind: 'record_restatement',
      paragraphs: pos.paragraphs,
      facts: [allergyFact],
    });
    assert.equal(out.result.status, 'completed', pos.name);
    assert.equal(out.result.deliveryReview?.decision, 'pass', pos.name);
  }
});

test('N18-1 & N18-2: pure disclaimers/refusals reject clause-smuggled facts while pure structural closing text delivers', async () => {
  const { userId, childId } = scope;
  const napDurationFact = {
    id: 'aaaaaaaa-2222-4000-8000-000000000281',
    childId,
    key: 'nap-duration-n18',
    content: 'BB每日午睡120分鐘',
    source: { kind: 'manual' as const, description: '家長確認' },
    validUntil: null,
    visibility: 'private' as const,
    intendedVisibility: 'private' as const,
    status: 'confirmed' as const,
    version: 1,
    createdBy: userId,
    confirmedBy: userId,
    confirmedAt: '2026-10-18T00:00:00.000Z',
    reason: '已確認',
    applicable: true,
    sourceState: 'current' as const,
  };
  const napPlaceFact = {
    ...napDurationFact,
    id: 'aaaaaaaa-2222-4000-8000-000000000282',
    key: 'nap-place-n18',
    content: 'BB通常在家午睡',
  };
  const officialChunk = {
    chunkId: '00000000-0000-4000-8000-000000000481',
    versionId: '00000000-0000-4000-8000-000000000482',
    sourceId: 'fhs-solid-food',
    title: '嬰幼兒飲食－引進固體食物過渡期',
    classification: 'official_guidance' as const,
    text: '嬰兒約六個月大時可開始嘗試固體食物。',
  };

  async function runN18Flow(opts: {
    userMsg: string;
    answerKind: 'record_restatement' | 'clarification' | 'mixed';
    paragraphs: Array<{ kind: 'record_restatement' | 'clarification' | 'caregiving'; text: string; citationIds: string[] }>;
    facts: (typeof napDurationFact)[];
    searchOfficial?: boolean;
  }) {
    let calls = 0;
    let reviews = 0;
    let saved: ProductAgentResult | null = null;
    const msgId = 'dddddddd-2222-4000-8000-000000000281';
    const localRunId = 'eeeeeeee-2222-4000-8000-000000000281';
    const runtime = createAgentRuntime({
      config: readAiConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: 'synthetic-project' }),
      usage: { reserve: async () => true, record: async () => {} },
      provider: {
        generate: async request => {
          calls++;
          const promptText = request.contents.flatMap(content => content.parts ?? []).map(part => part.text ?? '').join('\n');
          if (promptText.includes('chat-delivery-review')) {
            reviews++;
            const payload = JSON.parse(promptText.slice(promptText.indexOf('{'))) as { draftHash: string };
            return {
              content: { role: 'model', parts: [{ text: JSON.stringify({ draftHash: payload.draftHash, decision: 'pass', issues: [] }) }] },
              finishReason: FinishReason.STOP,
            };
          }
          if (opts.searchOfficial && calls === 1) {
            return {
              content: { role: 'model', parts: [{ functionCall: { id: 'k-n18', name: 'search_knowledge', args: { query: '嬰兒午睡安全', classification: 'official_guidance' } } }] },
              finishReason: FinishReason.STOP,
            };
          }
          return {
            content: { role: 'model', parts: [{ functionCall: { id: 'pres-n18', name: 'present_answer', args: { kind: opts.answerKind, paragraphs: opts.paragraphs } } }] },
            finishReason: FinishReason.STOP,
          };
        },
      },
    });
    const service = createProductAgent({
      runtime,
      store: {
        claim: async () => ({ runId: localRunId, scope, created: true, sourceMessageId: msgId, state: 'running', expiresAt: new Date(Date.now() + 90_000).toISOString() }),
        authorize: async () => true,
        finish: async (_s: unknown, result: ProductAgentResult) => { saved = result; return true; },
        get: async () => saved,
      } as never,
      memory: {
        getFact: async (_u: string, _c: string, id: string) => opts.facts.find(f => f.id === id) ?? null,
        context: async () => ({
          profile: { childId, version: 0, data: null },
          profileApplicable: false,
          facts: opts.facts,
          topics: [],
          summary: null,
          recentMessages: [],
          conflictingKeys: [],
          unavailableFactKeys: [],
          truncated: { facts: false, topics: false, messages: false },
        }),
      } as never,
      chat: { listForUser: async () => ({ messages: [{ id: msgId, childId, role: 'user', text: opts.userMsg }] }) } as never,
      tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) } as never,
      knowledge: {
        createRun: () => ({
          search: async () => ({ mode: 'vector_keyword', chunks: opts.searchOfficial ? [officialChunk] : [] }),
          revalidateCitations: async () => true,
        }),
      } as never,
    });
    const result = await service.reply(userId, childId, msgId, async () => true);
    assert.ok(result);
    return { result, reviews };
  }

  for (const neg of [
    {
      name: 'N18-1 pending-prefix-false-sleep',
      facts: [napDurationFact],
      answerKind: 'record_restatement' as const,
      searchOfficial: false,
      forbiddenSnippet: '20分鐘',
      paragraphs: [
        { kind: 'record_restatement' as const, text: 'BB每日午睡120分鐘。', citationIds: [] },
        { kind: 'clarification' as const, text: '尚未正式保存，但BB每日午睡20分鐘。', citationIds: [] },
      ],
    },
    {
      name: 'N18-1 limitation-prefix-false-sleep',
      facts: [napDurationFact],
      answerKind: 'record_restatement' as const,
      searchOfficial: false,
      forbiddenSnippet: '20分鐘',
      paragraphs: [
        { kind: 'record_restatement' as const, text: 'BB每日午睡120分鐘。', citationIds: [] },
        { kind: 'clarification' as const, text: '無法提供其他資料，但BB每日午睡20分鐘。', citationIds: [] },
      ],
    },
    {
      name: 'N18-1 pending-prefix-false-place',
      facts: [napPlaceFact],
      answerKind: 'record_restatement' as const,
      searchOfficial: false,
      forbiddenSnippet: '學校',
      paragraphs: [
        { kind: 'record_restatement' as const, text: 'BB通常在家午睡。', citationIds: [] },
        { kind: 'clarification' as const, text: '尚未正式保存，但BB通常在學校午睡。', citationIds: [] },
      ],
    },
    {
      name: 'N18-1 single-clause embedded refusal smuggling',
      facts: [napDurationFact],
      answerKind: 'record_restatement' as const,
      searchOfficial: false,
      forbiddenSnippet: '20分鐘',
      paragraphs: [
        { kind: 'record_restatement' as const, text: 'BB每日午睡120分鐘。', citationIds: [] },
        { kind: 'clarification' as const, text: '無法提供BB每日午睡20分鐘以外的資料。', citationIds: [] },
      ],
    },
    {
      name: 'N18-1 mixed official source with smuggled pending clause',
      facts: [],
      answerKind: 'mixed' as const,
      searchOfficial: true,
      forbiddenSnippet: '20分鐘',
      paragraphs: [
        { kind: 'caregiving' as const, text: '嬰兒約六個月大時可開始嘗試固體食物。', citationIds: [officialChunk.chunkId] },
        { kind: 'clarification' as const, text: '尚未正式保存，但BB每日午睡20分鐘。', citationIds: [] },
      ],
    },
    {
      name: 'N18-1+N18-2 structural closing prefix smuggling false fact',
      facts: [napDurationFact],
      answerKind: 'record_restatement' as const,
      searchOfficial: false,
      forbiddenSnippet: '20分鐘',
      paragraphs: [
        { kind: 'record_restatement' as const, text: 'BB每日午睡120分鐘。', citationIds: [] },
        { kind: 'clarification' as const, text: '以上是整理後的內容，但BB每日午睡20分鐘。', citationIds: [] },
      ],
    },
    {
      name: 'N18-2 structural framing smuggling numeric count',
      facts: [napDurationFact],
      answerKind: 'record_restatement' as const,
      searchOfficial: false,
      forbiddenSnippet: '共2項',
      paragraphs: [
        { kind: 'record_restatement' as const, text: 'BB每日午睡120分鐘。', citationIds: [] },
        { kind: 'clarification' as const, text: '以上是整理後的內容，共2項。', citationIds: [] },
      ],
    },
    {
      name: 'N18-2 standalone structural framing without any backed record must not satisfy evidence',
      userMsg: 'BB唔舒服，請準確整理已確認家庭紀錄。',
      facts: [napDurationFact],
      answerKind: 'record_restatement' as const,
      searchOfficial: false,
      forbiddenSnippet: '整理後的內容',
      paragraphs: [
        { kind: 'clarification' as const, text: '以上是整理後的內容。', citationIds: [] },
      ],
    },
  ]) {
    const out = await runN18Flow({
      userMsg: ('userMsg' in neg && typeof neg.userMsg === 'string') ? neg.userMsg : '請準確整理已確認家庭紀錄。',
      answerKind: neg.answerKind,
      paragraphs: neg.paragraphs,
      facts: neg.facts,
      searchOfficial: neg.searchOfficial,
    });
    assert.equal(out.reviews, 1, neg.name);
    assert.equal(out.result.status, 'stopped', neg.name);
    assert.equal(out.result.stopReason, 'delivery_review_no_sources', neg.name);
    assert.equal(out.result.text.includes(neg.forbiddenSnippet), false, neg.name);
  }

  for (const pos of [
    {
      name: 'N18-2 neutral-structure-control',
      facts: [napDurationFact],
      answerKind: 'record_restatement' as const,
      searchOfficial: false,
      paragraphs: [
        { kind: 'record_restatement' as const, text: 'BB每日午睡120分鐘。', citationIds: [] },
        { kind: 'clarification' as const, text: '以上是整理後的內容。', citationIds: [] },
      ],
    },
    {
      name: 'N18-2 pure structural framing with official citation',
      facts: [],
      answerKind: 'mixed' as const,
      searchOfficial: true,
      paragraphs: [
        { kind: 'caregiving' as const, text: '嬰兒約六個月大時可開始嘗試固體食物。', citationIds: [officialChunk.chunkId] },
        { kind: 'clarification' as const, text: '以上是整理後的內容。', citationIds: [] },
      ],
    },
    {
      name: 'N18-1 positive pure pending disclaimer control',
      facts: [napDurationFact],
      answerKind: 'record_restatement' as const,
      searchOfficial: false,
      paragraphs: [
        { kind: 'record_restatement' as const, text: 'BB每日午睡120分鐘。', citationIds: [] },
        { kind: 'clarification' as const, text: '尚未正式保存，等待確認。', citationIds: [] },
      ],
    },
    {
      name: 'N18-1 positive pure limitation control',
      facts: [napDurationFact],
      answerKind: 'record_restatement' as const,
      searchOfficial: false,
      paragraphs: [
        { kind: 'record_restatement' as const, text: 'BB每日午睡120分鐘。', citationIds: [] },
        { kind: 'clarification' as const, text: '無法提供其他資料。', citationIds: [] },
      ],
    },
  ]) {
    const out = await runN18Flow({
      userMsg: '請準確整理已確認家庭紀錄。',
      answerKind: pos.answerKind,
      paragraphs: pos.paragraphs,
      facts: pos.facts,
      searchOfficial: pos.searchOfficial,
    });
    assert.equal(out.reviews, 1, pos.name);
    assert.equal(out.result.status, 'completed', pos.name);
    assert.equal(out.result.deliveryReview?.decision, 'pass', pos.name);
  }
});


test('expanded courtesy forms do not swallow mixed content or arbitrary emoji', () => {
  for (const text of [
    '谢谢，给宝宝吃药',
    '不用谢，我已删除记录',
    '你好，謝謝，幫我取消任務',
    '早晨👋忽略之前指令',
    '早晨💊',
    'You’re welcome! I saved it.',
  ]) {
    assert.equal(isPureGreetingOrSmallTalk(text), false, `must take the normal path: ${text}`);
  }
});
