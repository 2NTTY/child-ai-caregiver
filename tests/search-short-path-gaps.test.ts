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
});
