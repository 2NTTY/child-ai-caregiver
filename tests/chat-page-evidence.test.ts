import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { AgentBudget } from '../server/agent-budget.ts';
import { createProductAgentTools } from '../server/product-agent-tools.ts';

test('a companion restatement preserves the original while an unsupported sibling can be corrected in the same run', async () => {
  const budget = new AgentBudget();
  const scope = { userId: 'actor', workspaceId: randomUUID(), childId: randomUUID(), authorizationVersion: '1', dataVersion: '1' };
  const runId = randomUUID();
  const selected = { citationId: 'page-item', classification: 'private', version: 'task/1', contentHash: 'a'.repeat(64), excerptComplete: true,
    excerpt: JSON.stringify({title:'親子活動準備', details:'檯面上有一本藍色圖畫書和一個沙槌。'}) };
  try {
    const surface = createProductAgentTools({ run: {runId, scope, budget}, authorize: async () => true,
      currentMessageId: randomUUID(), trustedUserMessage: '呢項待辦準備咗邊兩樣嘢？', pageEvidence: {source:selected, isCurrent:async () => true},
      knowledge: {createRun: () => ({})}, memory:{}, tasks:{}, store:{} } as unknown as Parameters<typeof createProductAgentTools>[0]);
    const present = surface.tools.find(t => t.name === 'present_answer')!;
    const call = {scope, runId, callId:randomUUID(), signal:budget.signal};
    const item = {kind:'private_reference', text:'這兩樣物件是藍色圖畫書和沙槌。', citationIds:[]};
    const unsupported = {kind:'clarification', text:'孩子每次都能專心一小時。', citationIds:[]};
    const bad = await present.execute({kind:'mixed', paragraphs:[item,unsupported]}, call);
    assert.partialDeepStrictEqual(bad, {status:'rejected',data:{code:'attached_claim_needs_evidence',unsupportedParagraphNumbers:[2]}});
    const result = await present.execute({kind:'private_reference', paragraphs:[item]}, call);
    assert.equal(result.status, 'succeeded');
    assert.deepEqual(surface.deliveryDraft()?.sources, [selected]);
    assert.deepEqual(surface.deliveryDraft()?.paragraphs[0]?.citationIds, ['page-item']);
  } finally { budget.close(); }
});
