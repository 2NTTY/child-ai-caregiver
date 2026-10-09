import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgentDocumentTools } from '../server/agent-document-tools.ts';
import type { AgentRunContext } from '../server/agent-runtime.ts';

// Schema-only boundary; the store and real-services scenario separately validate execution.
test('document tool schemas accept a nonblank one-character original quote without widening blank evidence', () => {
  const tools = createAgentDocumentTools({} as never, {} as never, {
    scope: { userId: 'synthetic-parent', childId: 'synthetic-child', workspaceId: 'synthetic-space', authorizationVersion: '1', dataVersion: 'epoch:1' },
    runId: '33333333-3333-4333-8333-333333333333', budget: { toolResponseCharacters: 8000 },
  } as unknown as AgentRunContext, async () => true);
  for (const [name, rest] of [
    ['generate_family_document', { kind: 'preparation', purpose: 'school', eventDate: null, period: { from: '2026-10-09', to: '2026-10-09' } }],
    ['change_family_document', { documentId: '11111111-1111-4111-8111-111111111111', change: {
      action: 'check_item', expectedVersion: 3, authorityVersion: 'epoch:1', sectionId: 'checklist', itemId: 'bag', checked: true,
    } }],
  ] as const) {
    const parameters = tools.find(tool => tool.name === name)!.parameters;
    for (const sourceQuote of ['二', '請把準備單的書包勾好。']) {
      const parsed = parameters.safeParse({ ...rest, sourceQuote });
      assert.equal(parsed.success, true, `${name} must allow a literal single-character clarification`);
      if (parsed.success) assert.equal(parsed.data.sourceQuote, sourceQuote);
    }
    for (const sourceQuote of ['', ' ', '\t\n']) assert.equal(parameters.safeParse({ ...rest, sourceQuote }).success, false);
  }
});
