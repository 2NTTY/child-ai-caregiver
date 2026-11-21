import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { originalChatMessageSchema } from '../server/chat-message-schema.ts';
import { FinishReason } from '@google/genai';
import { createAgentRuntime } from '../server/agent-runtime.ts';
import { readAiConfig } from '../server/ai-config.ts';
import { createProductAgent } from '../server/product-agent.ts';
import { createQuestionDiscussion, discussionToolNames } from '../server/chat-discussion.ts';
import { AgentBudget, AgentStopped } from '../server/agent-budget.ts';
import { chatDeliveryContentHash, enforceChatDeliveryReview, type ChatDeliveryDraft } from '../server/chat-delivery-review.ts';
import type { AgentRunContext } from '../server/agent-runtime.ts';
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
  let modelLimit = 7;
  let invalidClosing = false;
  let truncateClosing = false;
  let dailySlots: number | undefined;
  const earlierRunId = '9a3c4c60-d3e6-42b1-98ad-91bc539f6b7a';
  let earlierRun: ProductAgentResult | null = null;
  const task = { kind: 'task', id: '6dd5227c-0b41-46a3-98ff-12156dc387fe', version: 2 } as const;
  let taskReads = 0;
  let changeTaskDuringReview = false, taskChanged = false;
  const previousAnswer = { ...base, id: '65078aba-e634-4afd-8d18-bafba4598389', role: 'model', authorUserId: null,
    inReplyTo: base.id, text: 'The earlier reply covered books and songs.' };
  const linkedQuestion = { ...base, id: 'b955733f-1f95-42fa-bfb4-da02c7ad90c0', discussion: true,
    discussionOf: previousAnswer.id, text: '討論這個回答。' };
  const turns = ['一起看書可以跟孩子喜歡的圖畫談天。', '如果家長只顧完成待辦，孩子想行開時怎麼辦？', '回應家長的疑問，可以先唱熟悉的童謠，周末再試圖畫書。'];
  const main = ['孩子拿起圖畫書時，可以一起看。', '想省準備，可以唱熟悉的童謠。', '讓遊戲成為探索的過程而非一定要完成的任務。'];
  const taskDetails = '已經準備藍色圖畫書。';
  const taskRestatement = '按這項待辦，準備好了的是那本藍色的圖畫書。';
  const paraphrase = '照顧者可以讀故事，也可以唱歌。';
  const config = readAiConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: 'synthetic-project' });
  const unused = async () => { throw new Error('Unexpected provider or usage call'); };
  const usage = { reserve: async () => true, record: async () => {}, getForUser: unused };
  const provider: import('../server/agent-model-gateway.ts').AgentModelProvider = { generate: async request => {
      const i = calls++, inputs = request.contents.flatMap(c => c.parts ?? []);
      if (modelLimit !== 7) {
        if (i === 0) assert.ok(inputs.some(p => p.text?.includes('"passage":' + JSON.stringify(chunk.text))),
          'a reused citation must carry the revalidated passage containing the activity choices');
        const review = inputs.find(p => p.text?.startsWith('Server evidence payload for chat-delivery-review.'))?.text;
        const previous = inputs.map(p => p.functionResponse?.response?.data as { contribution?: { text: string } } | undefined)
          .findLast(p => p?.contribution);
        if (review) {
          const payload = JSON.parse(review.slice(review.indexOf('{')));
          const expected = Math.min(3, (dailySlots ?? modelLimit) - 1) - (invalidClosing || truncateClosing ? 1 : 0);
          assert.deepEqual(payload.discussionRoles, ['knowledge','parent','methods'].slice(0, expected));
          assert.deepEqual(payload.paragraphs.slice(0,expected).map((p: { text: string }) => p.text), turns.slice(0,expected));
          return { content: { role: 'model', parts: [{ text: JSON.stringify({ draftHash:payload.draftHash, decision:'pass', issues:[], claimedAppChanges:[] }) }] }, finishReason:FinishReason.STOP };
        }
        if (i > 0) assert.equal(previous?.contribution?.text, turns[i - 1]);
        const view = { text:turns[i], citationIds:[chunkId] };
        const finish = i === Math.min(2, (dailySlots ?? modelLimit) - 2);
        const name = finish ? 'present_answer' : discussionToolNames[i];
        const allowed = request.config?.toolConfig?.functionCallingConfig?.allowedFunctionNames ?? [];
        if (finish) {
          assert.deepEqual(Object.keys(request.toolsDict), ['present_answer']);
          const declaration = request.config?.tools?.flatMap(t => 'functionDeclarations' in t ? t.functionDeclarations ?? [] : []).find(d=>d.name==='present_answer');
          assert.ok(declaration?.parameters?.required?.includes('closingView'));
        } else {
          assert.ok(allowed.includes(name));
          assert.ok(allowed.includes('show_official_help'));
          assert.ok(!allowed.includes('present_answer'));
        }
        if (finish && truncateClosing) return { content: { role: 'model', parts: [{text:'truncated output'}] }, finishReason: FinishReason.MAX_TOKENS };
        if (!finish) assert.deepEqual(discussionToolNames.filter(n => n in request.toolsDict), [name]);
        const args = finish ? { kind:'caregiving', paragraphs:[{text:main[0] + ' [' + chunkId + ']',citationIds:[chunkId]}],
          closingView: { ...view, citationIds: invalidClosing ? ['missing-source'] : view.citationIds } } : view;
        return {content:{role:'model',parts:[{functionCall:{id:'discussion-'+i,name,args}}]},finishReason:FinishReason.STOP};
      }
      if (inputs.some(p => p.text?.includes('Please summarize the interactions concisely'))) {
        return { content: { role: 'model', parts: [{ text: 'The three speakers have contributed.' }] }, finishReason: FinishReason.STOP };
      }
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
        if (followup) assert.ok(content.includes(chunk.sourceExcerpt) && !content.includes(paraphrase));
        assert.deepEqual(payload.discussionRoles, ['knowledge', 'parent', 'methods']);
        assert.ok(payload.outputContract.required.includes('claimedAppChanges'));
        return { content: { role: 'model', parts: [{ text: JSON.stringify({ decision: 'pass', issues: [],
          claimedAppChanges: [], draftHash: payload.draftHash }) }] }, finishReason: FinishReason.STOP };
      }
      assert.ok(!('propose_fact' in request.toolsDict));
      if (i === 5) {
        const rejection = inputs.filter(p => p.functionResponse?.name === 'present_answer').at(-1)?.functionResponse?.response?.data;
        assert.partialDeepStrictEqual(rejection, followup
          ? { code: 'original_quote_mismatch', chunkId, originalExcerpt: chunk.sourceExcerpt }
          : { code: 'discussion_main_too_long', maxParagraphs: 3 });
      }
      const previous = inputs.map(p => p.functionResponse?.response?.data).filter(Boolean).at(-1) as { contribution?: { text: string }; maxMainParagraphs?: number } | undefined;
      if (i === 2 || i === 3) assert.equal(previous?.contribution?.text, turns[i - 2]);
      if (i >= 2 && i <= 4) assert.equal(previous?.maxMainParagraphs, i === 2 ? 5 : 3);
      const name = i === 0 ? 'search_knowledge' : i <= 3 ? discussionToolNames[i - 1] : 'present_answer';
      const args = i === 0 ? { query: '親子共讀童謠', classification: 'official_guidance' }
        : i <= 3 ? { kind: 'caregiving', text: turns[i - 1], citationIds: [chunkId] }
        : { kind: followup ? 'mixed' : 'caregiving',
            ...(followup && { originalQuotes: [{ chunkId, text: i === 4 ? paraphrase : chunk.sourceExcerpt }] }),
            paragraphs: (i === 4 && !followup ? [...main, '可以遲些再揀。'] : main).map((text, n) =>
            followup && n === 0 ? { kind:'record_restatement', text:taskRestatement, citationIds:[] }
              : { kind:'caregiving', text, citationIds:[chunkId] }) };
      const parts = [{ functionCall: { id: 'step-' + i, name, args } }];
      // ADK compacts only across distinct event timestamps. Match the real threshold on the rejected call.
      if (followup) await new Promise(resolve => setTimeout(resolve, 5));
      return { content: { role: 'model', parts: followup && i === 0
        ? [{ functionCall: { id: 'page-task', name: 'read_context', args: {} } }, ...parts] : parts }, finishReason: FinishReason.STOP,
        ...(followup && i === 4 && { usageMetadata: { promptTokenCount: 16045, totalTokenCount: 16379 } }) };
    } };
  const runtime = createAgentRuntime({ config, usage, provider, resolve: async () => ({
    config, provider, usage, authorize: async () => true, model: { generate: unused }, embeddings: { embed: unused },
    runLimits: { modelCalls: modelLimit, queryEmbeddings: 1 },
  }) });
  const service = createProductAgent({ runtime: { run(input: Parameters<typeof runtime.run>[0]) {
    return runtime.run(input.discussion && dailySlots !== undefined
      ? { ...input, discussion: { ...input.discussion, dailyAttemptsAtStart: dailySlots } } : input);
  } },
    readPageItem: async (userId: string, childId: string, item: unknown) => {
      assert.equal(userId, scope.userId);
      assert.equal(childId, scope.childId);
      assert.deepEqual(item, task);
      taskReads++;
      return taskChanged ? { status: 'unavailable' } : { title: 'Prepare the picture book', details:taskDetails };
    },
    store: { claim: async () => { const created = !claimed; claimed = true; return { runId, scope, created, state: 'running', expiresAt: new Date(Date.now()+90000).toISOString() }; },
      authorize: async () => allowed, get: async (_user: string, _child: string, id: string) => allowed ? id === earlierRunId ? earlierRun : saved : null, finish: async (_scope: unknown, result: ProductAgentResult) => { saved = result; return true; } },
    chat: { listForUser: async (_u: string, child: string) => child === base.childId ? { messages: followup ? [linkedQuestion] : [{ ...base, text: discussion ? base.text : '你好', ...(discussion && { discussion }) }] } : null,
      getOriginalMessageForUser: async (_u: string, child: string, id: string, purpose: string) => {
        assert.equal(purpose, 'memory');
        return allowed && child === base.childId ? [{ ...base, pageContext: { page: '/tasks', item: task } },
          { ...previousAnswer, ...(earlierRun && { agentRunId: earlierRunId }) }].find(item => item.id === id) ?? null : null;
      } },
    memory: { context: async () => ({ profile: { childId: base.childId, version: 0, data: null }, profileApplicable: false,
      facts: [], topics: [], summary: null, recentMessages: [], conflictingKeys: [], unavailableFactKeys: [], truncated: { facts: false, topics: false, messages: false } }) },
    tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) },
    knowledge: { createRun: () => ({ search: async () => ({ mode: 'keyword_degraded', chunks: [chunk] }), revalidateCitations: async () => true,
      supportsScopedEvidenceReuse: true, revalidateAndSeedEvidence: async () => ({valid:[chunk],invalidated:[]}) }) },
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
  assert.equal(later.citations[0]?.citedExcerpt, chunk.sourceExcerpt);
  assert.equal(later.counts.modelCalls, 7);
  assert.deepEqual(await reply(), later);
  assert.equal(calls, 7, 'Reopening the completed follow-up reads its receipt');
  assert.ok(taskReads >= 2);
  earlierRun = { ...later, runId:earlierRunId };
  modelLimit = 4; claimed = false; calls = 0;
  const capped = await reply();
  assert.equal(capped?.status, 'completed', JSON.stringify({stop:capped?.stopReason, tools:capped?.tools}));
  assert.deepEqual(capped.discussion?.map(t => t.text), turns.map(text => text+' [1]'));
  assert.equal(capped.text, main[0] + ' [1]');
  assert.equal(capped.counts.modelCalls, 4);
  assert.deepEqual(await reply(), capped);
  assert.equal(calls, 4);
  for (const rejected of [false, true]) {
    invalidClosing = rejected; modelLimit = 3; claimed = false; calls = 0;
    const partial = await reply();
    assert.equal(partial?.status, 'completed', JSON.stringify({stop:partial?.stopReason, tools:partial?.tools}));
    assert.deepEqual(partial.discussion?.map(t => t.text), capped.discussion?.slice(0, rejected ? 1 : 2).map(t => t.text));
    assert.equal(partial.deliveryReview?.decision, 'pass');
    assert.equal(partial.counts.modelCalls, 3);
    assert.deepEqual(await reply(), partial);
    assert.equal(calls, 3);
  }
  invalidClosing = false;
  truncateClosing = true; modelLimit = 8; claimed = false; calls = 0;
  const truncated = await reply();
  assert.equal(truncated?.status, 'completed', JSON.stringify(truncated));
  assert.deepEqual(truncated.discussion, capped.discussion?.slice(0,2));
  assert.equal(truncated.text, capped.discussion?.[0].text);
  assert.equal(truncated.deliveryReview?.decision, 'pass');
  assert.deepEqual(await reply(), truncated);
  assert.equal(calls, 4);
  truncateClosing = false;
  dailySlots = 3; claimed = false; calls = 0;
  const dailyLimited = await reply();
  assert.equal(dailyLimited?.status, 'completed');
  assert.deepEqual(dailyLimited.discussion, capped.discussion?.slice(0,2));
  assert.equal(calls, 3);
  dailySlots = undefined;
  modelLimit = 1; claimed = false; calls = 0;
  const insufficient = await reply();
  assert.equal(insufficient?.stopReason, 'discussion_budget');
  assert.equal(calls, 0);
  modelLimit = 7;
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
  const view = { kind:'clarification', text:'哪一種？', citationIds:[] };
  discussion.beginNativeTurn();
  assert.equal((await discussion.tools[1].execute(view, {} as never)).status,'rejected');
  assert.equal((await discussion.tools[0].execute(view, {} as never)).status,'succeeded');
  assert.equal((await discussion.tools[1].execute(view, {} as never)).status,'rejected');
  assert.throws(() => discussion.closingParagraph(view as never), /discussion_turn_order/);
  discussion.beginNativeTurn();
  assert.equal((await discussion.tools[1].execute(view, {} as never)).status,'succeeded');
});

test('grounded discussions require speaker turns and may explicitly finish a single-option question', async () => {
  const discussion = createQuestionDiscussion(async () => true, () => {});
  discussion.beginNativeTurn('speaker');
  assert.throws(() => discussion.checkPresentation(false), /discussion_turn_order/);
  const contribution = await discussion.tools[0].execute({
    text: '這個問題只問家長想選哪一天。', kind: 'clarification', citationIds: [], endDiscussion: 'no_tradeoff',
  }, {} as never);
  assert.equal(contribution.status, 'succeeded');
  assert.equal(contribution.data?.next, 'present_answer');
  assert.equal(discussion.noTradeoff(), true);
  discussion.beginNativeTurn();
  assert.doesNotThrow(() => discussion.checkPresentation(false));
  const comparison = createQuestionDiscussion(async () => true, () => {});
  comparison.beginNativeTurn('closing');
  assert.throws(() => comparison.checkPresentation(false), /discussion_turn_order/);
  assert.doesNotThrow(() => comparison.checkPresentation(true));
});

test('replays the reviewed Web discussion and rejects unsupported app changes in either a role or the main reply', async () => {
  const { reviewInput, reviewOutput } = JSON.parse(await readFile(
    new URL('../artifacts/verification/REQ009_DISCUSSION_REVIEW_REPLAY_20261120.json', import.meta.url), 'utf8'));
  const scope = { userId: 'parent', childId: base.childId, workspaceId: 'test-family', authorizationVersion: '1', dataVersion: 'epoch:1' };
  const draft: ChatDeliveryDraft = {
    scope, serverSubstitutedSourceText: false, userRequest: reviewInput.userRequest,
    kind: reviewInput.kind, visibility: reviewInput.visibility, discussionRoles: reviewInput.discussionRoles,
    paragraphs: reviewInput.paragraphs.map(({ index, ...p }: ChatDeliveryDraft['paragraphs'][number] & { index: number }) => p),
    sources: reviewInput.sources,
  };
  const presentation = { text: 'Test presentation', citations: [], retrievalMode: 'not_used' as const };
  async function review(candidate: ChatDeliveryDraft, result: (payload: typeof reviewInput) => object) {
    const budget = new AgentBudget();
    try {
      return await enforceChatDeliveryReview({ presentation,
        tools: { deliveryDraft: () => candidate, presentation: async () => presentation, replaceDeliveryAnswer: () => assert.fail('Unexpected discussion repair') },
        context: { budget, scope, completeText: async ({ user }) => JSON.stringify(result(JSON.parse(user.slice(user.indexOf('{'))))) } as AgentRunContext,
        provenance: { packVersion: 'test', model: 'recorded' } });
    } finally { budget.close(); }
  }
  const replay = await review(draft, payload => { assert.deepEqual(payload, reviewInput); return reviewOutput; });
  assert.equal(replay.review?.draftHash, reviewOutput.draftHash);

  const withClaim = (index: number, text: string) => ({ ...draft,
    paragraphs: draft.paragraphs.map((p, i) => i === index ? { ...p, text } : p) });
  const rejected = (reason: string) => (error: unknown) => error instanceof AgentStopped && error.reason === reason;
  const pass = (draftHash: string, claimedAppChanges?: number[]) => ({ decision: 'pass', issues: [], draftHash, claimedAppChanges });
  for (const index of [1, 4]) {
    // An implicit notification is still an external action; a citation cannot serve as its receipt.
    await assert.rejects(review(withClaim(index, '已經通知其他家庭成員。'), p => pass(p.draftHash, [index])), rejected('delivery_review_rejected'));
  }
  await assert.rejects(review(withClaim(0, '我已經刪除待辦。'), p => pass(p.draftHash, [])), rejected('delivery_review_rejected'));
  await assert.rejects(review(withClaim(4, '已替你通知其他照顧者。'), p => pass(p.draftHash, [])), rejected('delivery_review_rejected'));
  await assert.rejects(review(draft, p => pass(p.draftHash)), rejected('delivery_review_incomplete'));
  await assert.rejects(review(draft, p => pass(p.draftHash, [draft.paragraphs.length])), rejected('delivery_review_incomplete'));
  const hypothetical = await review(withClaim(0, '如果我已經完成待辦，是否可以陪孩子玩？'), p => pass(p.draftHash, []));
  assert.equal(hypothetical.review?.decision, 'pass');
  const excerpt = JSON.stringify({ children: [{ displayName: '小悠' }] });
  const workspaceSource = { citationId: 'workspace:children:1', version: '1', contentHash: chatDeliveryContentHash(excerpt),
    classification: 'private' as const, excerpt, excerptComplete: true };
  const workspace: ChatDeliveryDraft = { ...draft, kind: 'private_reference', sources: [workspaceSource], userRequest: '我登記了哪些孩子？',
    paragraphs: draft.paragraphs.map(() => ({ text: '你帳戶登記了小悠。', citationIds: [workspaceSource.citationId] })) };
  await assert.rejects(review(workspace, p => ({ ...pass(p.draftHash, []), observedReadOnly: false })), rejected('delivery_review_rejected'));
});
