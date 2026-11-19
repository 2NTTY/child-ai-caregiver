import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { CHILD_PROFILES_CHAT_TEXT, requestedWorkspaceView } from '../src/shared/chat-workspace-view.ts';
import { AgentBudget } from '../server/agent-budget.ts';
import { createProductAgentTools } from '../server/product-agent-tools.ts';
import { enforceChatDeliveryReview } from '../server/chat-delivery-review.ts';

test('personal chat can show authorized workspace views; the model cannot supply the result', async () => {
  const scope = { userId: 'parent', childId: randomUUID(), workspaceId: 'home', authorizationVersion: '1', dataVersion: '1' };
  const budget = new AgentBudget(), run = { scope, runId: randomUUID(), budget };
  let current = true;
  const ports = { run, memory: {}, tasks: {}, store: {}, knowledge: { createRun: () => ({}) },
    authorize: async () => current, conversationWindow: { messages: 4, complete: false } };
  try {
    const make = (extra = {}) => createProductAgentTools({ ...ports, ...extra } as unknown as Parameters<typeof createProductAgentTools>[0]);
    const tools = make({ trustedUserMessage: '我有甚麼小孩', currentMessageId: randomUUID() }), terminal = tools.tools.find(t => t.name === 'present_answer')!;
    const args = (view: string) => ({ kind: 'operation', paragraphs: [{ showView: view }] });
    const execute = (input: Record<string, unknown>) => terminal.execute(input, { scope, runId: run.runId, callId: randomUUID(), signal: budget.signal });
    for (const view of ['child_profiles', 'conversation_memory']) {
      const owner = view === 'child_profiles' ? tools : make({ trustedUserMessage: '你能不能檢查看看短期記憶有什麼問題', currentMessageId: randomUUID() });
      const response = await owner.tools.find(t => t.name === 'present_answer')!.execute(args(view), { scope, runId: run.runId, callId: randomUUID(), signal: budget.signal }); assert.equal(response.status, 'succeeded');
      const presentation = await owner.presentation(); assert.ok(presentation);
      const delivered = await enforceChatDeliveryReview({ presentation, tools: owner, context: run, provenance: null });
      assert.match(delivered.presentation.text, view === 'child_profiles' ? /子女檔案/ : /4 則/);
      assert.equal(delivered.review, null);
    }
    assert.equal((await execute({ kind: 'operation', paragraphs: [{ showView: 'conversation_memory' }, { text: 'invented', citationIds: [] }] })).status, 'rejected');
    for (const extra of [{ background: true }, { visibility: 'family' }]) {
      assert.equal(make(extra).tools.find(t => t.name === 'present_answer')!.parameters.safeParse(args('child_profiles')).success, false);
    }
    for (const [question, clarification] of [
      ['我是誰', '你想問帳戶身份，還是我怎樣稱呼你？'],
      ['幫我填寫孩子的資訊', '你想填寫哪位孩子的哪些資料？'],
    ]) {
      const turn = make({ trustedUserMessage: question, currentMessageId: randomUUID() });
      const present = turn.tools.find(t => t.name === 'present_answer')!;
      const call = { scope, runId: randomUUID(), callId: randomUUID(), signal: budget.signal };
      assert.equal(present.parameters.safeParse(args('child_profiles')).success, false);
      assert.equal((await present.execute(args('child_profiles'), call)).status, 'rejected');
      assert.equal((await present.execute({ kind: 'operation', paragraphs: [{ text: CHILD_PROFILES_CHAT_TEXT, citationIds: [] }] }, call)).status, 'rejected');
      assert.equal(await turn.presentation(), null);
      const answer = { kind: 'clarification', paragraphs: [{ text: clarification, citationIds: [] }] };
      assert.equal((await present.execute(answer, { ...call, callId: randomUUID() })).status, 'succeeded');
      const result = await turn.presentation();
      assert.ok(result);
      assert.equal(result.text, clarification);
      assert.equal(turn.deliveryDraft()?.serverSubstitutedReceiptText, false);
    }
    for (const question of ['不要列出我的孩子名單', '我有什麼小孩？再幫我填寫資料', '你剛才說「我有甚麼小孩」，我是誰？']) {
      assert.equal(requestedWorkspaceView(question), null);
    }
    current = false;
    await assert.rejects(tools.presentation());
  } finally { budget.close(); }
});
