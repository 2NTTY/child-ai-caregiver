import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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
    const tools = make(), terminal = tools.tools.find(t => t.name === 'present_answer')!;
    const args = (view: string) => ({ kind: 'operation', paragraphs: [{ showView: view }] });
    const execute = (input: Record<string, unknown>) => terminal.execute(input, { scope, runId: run.runId, callId: randomUUID(), signal: budget.signal });
    for (const view of ['child_profiles', 'conversation_memory']) {
      const response = await execute(args(view)); assert.equal(response.status, 'succeeded');
      const presentation = await tools.presentation(); assert.ok(presentation);
      const delivered = await enforceChatDeliveryReview({ presentation, tools, context: run, provenance: null });
      assert.match(delivered.presentation.text, view === 'child_profiles' ? /子女檔案/ : /4 則/);
      assert.equal(delivered.review, null);
    }
    assert.equal((await execute({ kind: 'operation', paragraphs: [{ showView: 'conversation_memory' }, { text: 'invented', citationIds: [] }] })).status, 'rejected');
    for (const extra of [{ background: true }, { visibility: 'family' }]) {
      assert.equal(make(extra).tools.find(t => t.name === 'present_answer')!.parameters.safeParse(args('child_profiles')).success, false);
    }
    current = false;
    await assert.rejects(tools.presentation());
  } finally { budget.close(); }
});
