import assert from 'node:assert/strict';
import test from 'node:test';
import { originalChatMessageSchema } from '../server/chat-message-schema.ts';
import { FinishReason } from '@google/genai';
import { createAgentRuntime } from '../server/agent-runtime.ts';
import { readAiConfig } from '../server/ai-config.ts';
import { createProductAgent } from '../server/product-agent.ts';
import { createQuestionDiscussion, discussionToolNames } from '../server/chat-discussion.ts';
import type { ProductAgentResult } from '../src/shared/product-agent.ts';
import { productAgentResultSchema } from '../src/shared/product-agent-result.ts';

const base = { id: '7de5a0e8-e106-4485-b7d2-3b572741da39', childId: '1ebcb39d-a2db-4b8c-a432-7ffcb3de5808',
  authorUserId: 'parent', role: 'user', text: 'Which book should we start with?', inReplyTo: null, createdAt: '2026-11-19T00:00:00Z' };

test('discussion opt-in belongs to the saved question and ordinary questions retain their wire shape', () => {
  assert.equal(originalChatMessageSchema.safeParse({ ...base, discussion: true }).success, true);
  assert.deepEqual(originalChatMessageSchema.parse(base), base);
  assert.equal(originalChatMessageSchema.safeParse({ ...base, discussionOf: base.id }).success, false);
});

test('a question binds three successive native turns, the main reply and one independent review to its original run', async () => {
  const scope = { userId: 'parent', childId: base.childId, workspaceId: 'test-family', authorizationVersion: '1', dataVersion: 'epoch:1' };
  const runId = 'd4a1b662-d13d-476b-bf52-40a28aa1a1a7', chunkId = '708737a1-28a5-4ebe-833f-446a7ad13042';
  const chunk = { chunkId, classification: 'official_guidance', text: '可以一同看圖畫書或唱童謠。', sourceExcerpt: '一同看圖畫書或唱童謠。',
    sourceId: 'sample-reading', versionId: 'e7d04db3-65ab-4d67-85ac-57cde623124a', contentHash: 'a'.repeat(64), title: '合成例子', section: '一起玩' };
  let discussion = true, claimed = false, calls = 0, allowed = true, saved: ProductAgentResult | null = null;
  let followup = false, interrupt: AbortController | undefined;
  const task = { kind: 'task', id: '6dd5227c-0b41-46a3-98ff-12156dc387fe', version: 2 } as const;
  let taskReads = 0;
  let changeTaskDuringReview = false, taskChanged = false;
  const previousAnswer = { ...base, id: '65078aba-e634-4afd-8d18-bafba4598389', role: 'model', authorUserId: null,
    inReplyTo: base.id, text: 'The earlier reply covered books and songs.' };
  const linkedQuestion = { ...base, id: 'b955733f-1f95-42fa-bfb4-da02c7ad90c0', discussion: true,
    discussionOf: previousAnswer.id, text: '討論這個回答。' };
  const turns = ['一起看書可以跟孩子喜歡的圖畫談天。', '看書要預備甚麼？放工後家長可能只想輕鬆唱歌。', '回應預備時間的問題，可以先唱熟悉的童謠，周末再試圖畫書。'];
  const main = ['孩子拿起圖畫書時，可以一起看。', '想省準備，可以唱熟悉的童謠。', '讓遊戲成為探索的過程而非一定要完成的任務。'];
  const taskDetails = '已經準備藍色圖畫書。';
  const taskRestatement = '按這項待辦，準備好了的是那本藍色的圖畫書。';
  const config = readAiConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: 'synthetic-project' });
  const unused = async () => { throw new Error('Unexpected provider or usage call'); };
  const usage = { reserve: async () => true, record: async () => {}, getForUser: unused };
  const provider: import('../server/agent-model-gateway.ts').AgentModelProvider = { generate: async request => {
      const i = calls++, inputs = request.contents.flatMap(c => c.parts ?? []);
      if (followup && i === 0) {
        const context = inputs.map(p => p.text ?? '').join('');
        assert.ok(context.includes(base.text) && context.includes(previousAnswer.text) && context.includes(task.id));
        assert.ok(context.includes('Prepare the picture book') && context.includes('page-item'), 'selected task and its reviewable citation must reach the first model request');
      }
      if (followup && i === 1) {
        assert.ok(inputs.some(p => JSON.stringify(p.functionResponse?.response ?? {}).includes('Prepare the picture book')));
      }
      if (i === 2 && interrupt) interrupt.abort();
      if (!discussion) {
        assert.ok(discussionToolNames.every(n => !(n in request.toolsDict)));
        return { content: { role: 'model', parts: [{ functionCall: { id: 'hi', name: 'present_answer',
          args: { kind: 'operation', paragraphs: [{ text: '你好！', citationIds: [] }] } } }] }, finishReason: FinishReason.STOP };
      }
      if (i === 6) {
        const content = inputs.map(p => p.text ?? '').join('');
        if (followup) {
          assert.ok(content.includes('page-item') && content.includes('Prepare the picture book'), 'review must see the same private original');
          if (changeTaskDuringReview) taskChanged = true;
        }
        const payload = JSON.parse(content.slice(content.indexOf('{')));
        assert.deepEqual(payload.paragraphs.map((p: { text: string }) => p.text), [...turns, ...(followup ? [taskRestatement, ...main.slice(1)] : main)]);
        if (followup) assert.deepEqual(payload.paragraphs[3].citationIds, ['page-item']);
        assert.deepEqual(payload.discussionRoles, ['knowledge', 'parent', 'methods']);
        return { content: { role: 'model', parts: [{ text: JSON.stringify({ decision: 'pass', issues: [], draftHash: payload.draftHash }) }] }, finishReason: FinishReason.STOP };
      }
      assert.ok(!('propose_fact' in request.toolsDict));
      if (i === 5) {
        const rejection = inputs.filter(p => p.functionResponse?.name === 'present_answer').at(-1)?.functionResponse?.response?.data;
        assert.partialDeepStrictEqual(rejection, { code: 'discussion_main_too_long', maxParagraphs: 3 });
      }
      const previous = inputs.map(p => p.functionResponse?.response?.data).filter(Boolean).at(-1) as { nextTurn?: string; contribution?: { text: string }; maxMainParagraphs?: number } | undefined;
      if (i === 2 || i === 3) assert.equal(previous?.contribution?.text, turns[i - 2]);
      if (i >= 2 && i <= 4) assert.equal(previous?.maxMainParagraphs, 7 - i);
      const name = i === 0 ? 'search_knowledge' : i <= 3 ? discussionToolNames[i - 1] : 'present_answer';
      const args = i === 0 ? { query: '親子共讀童謠', classification: 'official_guidance' }
        : i <= 3 ? { previous: previous?.nextTurn ?? 'start', kind: 'caregiving', text: turns[i - 1], citationIds: [chunkId] }
        : { kind: followup ? 'mixed' : 'caregiving', paragraphs: (i === 4 ? [...main, '可以遲些再揀。'] : main).map((text, n) =>
            followup && n === 0 ? { kind:'record_restatement', text:taskRestatement, citationIds:[] }
              : { kind:'caregiving', text, citationIds:[chunkId] }) };
      const parts = [{ functionCall: { id: 'step-' + i, name, args } }];
      return { content: { role: 'model', parts: followup && i === 0
        ? [{ functionCall: { id: 'page-task', name: 'read_context', args: {} } }, ...parts] : parts }, finishReason: FinishReason.STOP };
    } };
  const runtime = createAgentRuntime({ config, usage, provider, resolve: async () => ({
    config, provider, usage, authorize: async () => true, model: { generate: unused }, embeddings: { embed: unused },
    runLimits: { modelCalls: 7, queryEmbeddings: 1 },
  }) });
  const service = createProductAgent({ runtime,
    readPageItem: async (userId: string, childId: string, item: unknown) => {
      assert.equal(userId, scope.userId);
      assert.equal(childId, scope.childId);
      assert.deepEqual(item, task);
      taskReads++;
      return taskChanged ? { status: 'unavailable' } : { title: 'Prepare the picture book', details:taskDetails };
    },
    store: { claim: async () => { const created = !claimed; claimed = true; return { runId, scope, created, state: 'running', expiresAt: new Date(Date.now()+90000).toISOString() }; },
      authorize: async () => allowed, get: async () => allowed ? saved : null, finish: async (_scope: unknown, result: ProductAgentResult) => { saved = result; return true; } },
    chat: { listForUser: async (_u: string, child: string) => child === base.childId ? { messages: followup ? [linkedQuestion] : [{ ...base, text: discussion ? base.text : '你好', ...(discussion && { discussion }) }] } : null,
      getOriginalMessageForUser: async (_u: string, child: string, id: string, purpose: string) => {
        assert.equal(purpose, 'memory');
        return allowed && child === base.childId ? [{ ...base, pageContext: { page: '/tasks', item: task } }, previousAnswer].find(item => item.id === id) ?? null : null;
      } },
    memory: { context: async () => ({ profile: { childId: base.childId, version: 0, data: null }, profileApplicable: false,
      facts: [], topics: [], summary: null, recentMessages: [], conflictingKeys: [], unavailableFactKeys: [], truncated: { facts: false, topics: false, messages: false } }) },
    tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) },
    knowledge: { createRun: () => ({ search: async () => ({ mode: 'keyword_degraded', chunks: [chunk] }), revalidateCitations: async () => true }) },
  } as unknown as Parameters<typeof createProductAgent>[0]);
  const reply = (childId = base.childId) => service.reply('parent', childId, followup ? linkedQuestion.id : base.id, async () => true, interrupt?.signal);
  const result = await reply();
  assert.equal(result?.status, 'completed', JSON.stringify(result));
  assert.deepEqual(result.discussion?.map(t => t.text), turns.map(t => t + ' [1]'));
  assert.equal(result.text, main.map(text => text + ' [1]').join('\n\n'));
  assert.equal(result.deliveryReview?.decision, 'pass');
  assert.equal(result.counts.modelCalls, 7);
  const wire = { ...result, citations: [] };
  assert.ok(productAgentResultSchema.safeParse(wire).success);
  assert.equal(productAgentResultSchema.safeParse({ ...wire, deliveryReview: undefined }).success, false);
  assert.equal(productAgentResultSchema.safeParse({ ...wire, status: 'stopped' }).success, false);
  assert.deepEqual(await reply(), result);
  assert.equal(await reply('another-child'), null);
  allowed = false;
  assert.equal(await reply(), null);
  assert.equal(calls, 7);
  allowed = true; discussion = false; claimed = false; calls = 0;
  const ordinary = await reply();
  assert.equal(ordinary?.status, 'completed');
  assert.equal(ordinary.discussion, undefined);
  assert.equal(calls, 1);
  discussion = true; claimed = false; calls = 0; followup = true;
  const later = await reply();
  assert.equal(later?.status, 'completed', JSON.stringify({ later, calls, taskReads }));
  assert.deepEqual(later?.discussion, result.discussion);
  assert.ok(taskReads >= 2);
  changeTaskDuringReview = true; claimed = false; calls = 0;
  const changed = await reply();
  assert.equal(changed?.status, 'stopped');
  assert.deepEqual(changed.discussion, []);
  followup = false; claimed = false; calls = 0; interrupt = new AbortController();
  const stopped = await reply();
  assert.equal(stopped?.status, 'stopped');
  assert.equal(stopped.stopReason, 'cancelled');
  assert.deepEqual(stopped.discussion, []);
  assert.equal(calls, 3);
});

test('a parallel or out-of-order viewpoint cannot observe a fabricated predecessor', async () => {
  const discussion = createQuestionDiscussion(async () => true, () => {});
  const parallel = await discussion.tools[1].execute({ previous:'start', kind:'clarification', text:'哪一種？', citationIds:[] }, {} as never);
  assert.equal(parallel.status,'rejected');
  assert.deepEqual(discussion.render(['主回答']), { text:'主回答', discussion:[] });
});
