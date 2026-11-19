import assert from 'node:assert/strict';
import test from 'node:test';
import { createRegisteredSourceTools } from '../server/agent-registered-source-tools.ts';
import { createProductAgentTools } from '../server/product-agent-tools.ts';
import { AgentBudget } from '../server/agent-budget.ts';
import { FunctionTool } from '@google/adk';
import type { RegisteredSourceCard } from '../src/shared/registered-source-card.ts';

test('chat updates the same account card, joins a repeated command and returns only a card link for login', async () => {
  const url = 'https://school.example/notices';
  const scope = { userId: 'parent', workspaceId: 'workspace', childId: 'child', authorizationVersion: '1', dataVersion: '1' };
  let card: RegisteredSourceCard | null = null;
  const ids = new Set<string>();
  const commands: string[] = [];
  const tools = createRegisteredSourceTools({
    list: async () => ({ items: card ? [card] : [], nextCursor: null }),
    get: async (owner, id) => owner === scope.userId && card?.cardId === id ? card : null,
    command: async (owner, command) => {
      assert.equal(owner, scope.userId);
      if (!ids.has(command.operationId)) {
        ids.add(command.operationId);
        commands.push(command.action);
        if (command.action === 'create') card = { ...command.settings, cardId: command.cardId, revision: 1, enabled: true,
          credentialRef: 'sensitive-pointer', checking: false, lastCheckedAt: null, nextCheckAt: null, lastResult: null };
        if (command.action === 'set_enabled' && card) Object.assign(card, { enabled: command.enabled, revision: card.revision + 1 });
      }
      return { card };
    },
  }, scope.userId, 'message-1', '訂閱學校通告 ' + url, async () => true);
  const invoke = (name: string, args: Record<string, unknown>, callId = 'call') => {
    const tool = tools.tools.find(candidate => candidate.name === name)!;
    return tool.execute(tool.parameters.parse(args), { scope, runId: 'run', callId, signal: new AbortController().signal });
  };
  const settings = { name: '學校通告', kind: 'bulletin', url, frequencyMinutes: 1440 };
  const created = await invoke('register_source_card', settings);
  assert.equal(created.status, 'succeeded');
  assert.equal((await invoke('register_source_card', settings, 'retry')).reference, created.reference);
  assert.deepEqual(commands, ['create']);
  assert.equal((await invoke('register_source_card', { ...settings, url: 'https://elsewhere.example/path' })).status, 'rejected');
  const login = await invoke('open_source_card_login', { cardId: created.reference });
  assert.equal(login.reference, created.reference);
  assert.doesNotMatch(JSON.stringify([created, login, await invoke('read_source_cards', {})]), /sensitive-pointer|credentialRef/);
  await invoke('manage_source_card', { cardId: created.reference, expectedRevision: 1, action: 'pause' });
  assert.deepEqual(commands, ['create', 'set_enabled']);
  assert.equal(tools.operations().at(-1)?.state, 'committed');
});

test('formal chat advertises source settings only in the account owner conversation', () => {
  const budget = new AgentBudget();
  try {
    const options = { run: { scope: { userId: 'parent' }, runId: 'run', budget }, store: {}, registeredSourceCards: {},
      knowledge: { createRun: () => ({}) }, authorize: async () => true, trustedUserMessage: '把通告改成每天查一次', currentMessageId: 'message' };
    const assemble = (extra: object) => createProductAgentTools({ ...options, ...extra } as unknown as Parameters<typeof createProductAgentTools>[0]).tools;
    const tool = assemble({}).find(item => item.name === 'manage_source_card')!;
    const schema = new FunctionTool({ name: tool.name, description: tool.description, parameters: tool.parameters.strict(), execute: async () => ({}) })._getDeclaration();
    assert.equal(schema?.parameters?.properties?.frequencyMinutes?.minimum, 1);
    for (const mode of [{ background: true }, { visibility: 'family' }, { reviewedGrowthPresentation: true }, { currentMessageId: undefined }])
      assert.equal(assemble(mode).some(item => item.name === tool.name), false);
  } finally { budget.close(); }
});
