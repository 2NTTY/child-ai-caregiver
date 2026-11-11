import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentBudget } from '../server/agent-budget.ts';
import { createProductAgentTools } from '../server/product-agent-tools.ts';
import { emptyCareDetails } from '../src/shared/care.ts';
import { selectedCareRecordCitations } from '../src/shared/assistant-care-citation.ts';

test('numbered marks identify only the cited record versions in the reviewed source list', async () => {
  const budget = new AgentBudget();
  try {
    const records = [2, 1].map(n => ({
      id: `00000000-0000-4000-8000-00000000000${n}`, version: n, text: `照護原話 ${n}`,
      textComplete: true, createdAt: '2026-11-11T00:00:00Z', details: emptyCareDetails(),
    }));
    const product = createProductAgentTools({
      run: { scope: {}, runId: 'synthetic', budget }, memory: {}, tasks: {}, store: {},
      authorize: async () => true, knowledge: { createRun: () => ({}) },
      mixedTasks: async () => ({ children: [], nextFrom: null }),
      mixedCare: async () => ({ children: [{ childId: '00000000-0000-4000-8000-000000000003', childName: '小晴',
        records, scanned: 2, undatedMatches: 0, nextCursor: null }], nextFrom: null }),
    });
    const read = product.tools.find(tool => tool.name === 'search_selected_care');
    const answer = product.tools.find(tool => tool.name === 'present_answer');
    const { data: { result: { children: [page] } } } = await read.execute({ filters: {} }, {});
    const [second, first] = page.records.map(record => record.citationId);
    const proposed = await answer.execute({ kind: 'private_reference', paragraphs: [
      { text: '原話包含 [照護記錄 1]。', citationIds: [second] }, { text: '第一筆。', citationIds: [first] },
      { text: '這次查詢的範圍。', citationIds: [page.coverageCitationId] },
    ] }, {});
    assert.equal(proposed.status, 'succeeded');
    const shown = await product.presentation();
    assert.equal(shown.text, '原話包含 ［照護記錄 1］。 [照護記錄 2]\n\n第一筆。 [照護記錄 1]\n\n這次查詢的範圍。 [查詢範圍]');
    const draft = product.deliveryDraft();
    const references = selectedCareRecordCitations(draft.sources);
    assert.deepEqual(references.map(r => [r.childIndex, r.recordId, r.version]), [
      [0, records[1].id, 1], [0, records[0].id, 2],
    ]);
    assert.deepEqual(selectedCareRecordCitations([{ citationId: 'care:' + 'a'.repeat(64), version: 'old' }]), []);
  } finally { budget.close(); }
});
