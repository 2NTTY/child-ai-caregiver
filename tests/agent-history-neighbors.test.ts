import test from 'node:test';
import assert from 'node:assert/strict';
import { historyNeighbors } from '../server/agent-history-neighbors.ts';
import { randomUUID } from 'node:crypto';
import { AgentBudget } from '../server/agent-budget.ts';
import type { AgentRunContext } from '../server/agent-runtime.ts';
import { createProductAgentTools } from '../server/product-agent-tools.ts';
import { enforceChatDeliveryReview } from '../server/chat-delivery-review.ts';

test('a subjectless correction follows the matching message in time and context stays bounded to its own scan', () => {
  const window = historyNeighbors();
  const message = (id: string, text: string) => ({ id, text, role: 'user' as const, version: 1, createdAt: '2026-11-18T09:00:00Z' });
  window.observe(message('later', 'x'.repeat(500)));
  window.observe(message('correction', '改咗去青竹室'));
  const snippets = window.following();
  assert.deepEqual(snippets.map(s => s.id), ['correction', 'later']);
  assert.equal(snippets[0].text, '改咗去青竹室');
  assert.equal(snippets[1].text.length, 140);
  assert.equal(snippets[1].totalCharacters, 500);
  window.observe(message('original', '學校簡介會喺海星室'));
  assert.deepEqual(snippets.map(s => s.id), ['correction', 'later']);
  assert.equal(window.following().length, 2);
  assert.equal(window.following().length, 2);
  assert.equal(window.following().length, 0);
  assert.deepEqual(historyNeighbors().following(), []);
});

test('a search can cite the returned correction; replacing or revoking that exact source stops delivery', async () => {
  const scope = { userId: 'parent', childId: randomUUID(), workspaceId: 'home', authorizationVersion: '1', dataVersion: '1' };
  const budget = new AgentBudget(), run: AgentRunContext = { scope, runId: randomUUID(), budget };
  const createdAt = new Date().toISOString(), text = '改咗去青竹室';
  const subject = { id: randomUUID(), role: 'user' as const, version: 1, createdAt, text: '學校簡介會喺海星室' };
  const correction = { id: randomUUID(), role: 'user' as const, version: 1, createdAt, text, totalCharacters: text.length };
  const currentQuestion = { ...correction, id: randomUUID(), text: '最後去邊間房？' };
  let current = true;
  const store = {
    async searchHistory(user: string, child: string, _args: unknown, includeNeighbors: boolean) {
      assert.equal(includeNeighbors, true); assert.equal(user, scope.userId); assert.equal(child, scope.childId);
      return { matches: [{ ...subject, kind: 'message',
        excerpt: subject.text, excerptRange: { offset: 0, totalCharacters: subject.text.length }, followingMessages: [correction, currentQuestion] }],
        scanned: 2, complete: true, nextCursor: null, scanLimit: 100 };
    },
    async readHistory(user: string, child: string, input: { messageId: string; offset: number; limit: number }) {
      assert.equal(user, scope.userId); assert.equal(child, scope.childId);
      if (input.messageId === subject.id) return { ...subject, totalCharacters: subject.text.length, childId: child, offset: 0, nextOffset: null };
      assert.equal(input.messageId, correction.id);
      assert.equal(input.offset, 0); assert.equal(input.limit, text.length);
      return current ? { ...correction, childId: child, offset: 0, nextOffset: null } : null;
    },
  };
  try {
    const tools = createProductAgentTools({ run, store, memory: {}, tasks: {}, currentMessageId: currentQuestion.id, authorize: async () => true,
      knowledge: { createRun: () => ({}) } } as unknown as Parameters<typeof createProductAgentTools>[0]);
    const execute = (name: string, args: Record<string, unknown>) => tools.tools.find(tool => tool.name === name)!
      .execute(args, { scope, runId: run.runId, callId: randomUUID(), signal: budget.signal });
    const found = await execute('search_history', { query: '學校簡介會' });
    assert.equal(found.status, 'succeeded');
    const { matches } = (found.data as { result: { matches: { followingMessages: { citationId: string; quoteHistory: string }[] }[] } }).result;
    const id = matches[0]!.followingMessages[0]!.citationId;
    assert.equal(matches[0]!.followingMessages.length, 1);
    assert.equal(id, 'chat:' + correction.id + ':0:' + text.length);
    const unsupported = await execute('present_answer', { kind: 'mixed',
      paragraphs: [{ kind: 'private_reference', text: '地點已由海星室更改為青竹室。', citationIds: [id] }] });
    assert.equal(unsupported.status, 'rejected');
    assert.equal(unsupported.data?.code, 'history_excerpt_mismatch');
    assert.deepEqual(unsupported.data?.quoteOptions, [{ text, quoteHistory: id }]);
    assert.equal((await execute('present_answer', { kind: 'private_reference', paragraphs: [{ quoteHistory: 'chat:unknown:0:6' }] })).status, 'rejected');
    const handle = matches[0]!.followingMessages[0]!.quoteHistory;
    assert.match(handle, /^H\d+$/u);
    assert.equal((await execute('present_answer', { kind: 'private_reference', paragraphs: [{ quoteHistory: 'H9999' }] })).status, 'rejected');
    assert.equal((await execute('present_answer', { kind: 'private_reference', paragraphs: [{ quoteHistory: handle }] })).status, 'succeeded');
    assert.match((await tools.presentation())!.text, /青竹室.*\[聊天原文\]/u);
    assert.equal(run.deliveryReview?.required, true);
    assert.equal(tools.deliveryDraft()?.sources.length, 2);
    run.completeText = async input => JSON.stringify({ draftHash: input.attemptKey.split(':').at(-1), decision: 'pass', issues: [] });
    const validated = await enforceChatDeliveryReview({ presentation: (await tools.presentation())!, tools, context: run,
      provenance: { model: 'synthetic', packVersion: 'synthetic' } });
    assert.match(validated.presentation.text, /你當時說：「改咗去青竹室」/u);
    assert.equal(validated.review?.decision, 'pass');
    const draft = tools.deliveryDraft()!;
    for (const [text, failure] of [[correction.text, /delivery_review_rejected/u],
      ['我已幫你修改待辦。', /delivery_review_no_sources/u],
      ['你當時說：「改咗去青竹室」我已幫你刪除待辦。', /delivery_review_no_sources/u]] as const) {
      const changed = { ...draft, paragraphs: [{ ...draft.paragraphs[0]!, text }] };
      await assert.rejects(enforceChatDeliveryReview({ presentation: validated.presentation, tools: { ...tools, deliveryDraft: () => changed },
        context: run, provenance: { model: 'synthetic', packVersion: 'synthetic' } }), failure);
    }
    current = false;
    await assert.rejects(tools.presentation(), /delivery_review_incomplete/u);
  } finally { budget.close(); }
});
