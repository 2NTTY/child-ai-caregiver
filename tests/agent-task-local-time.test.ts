import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAgentConfirmationQuestion } from '../server/agent-work-tool-descriptions.ts';
import { AgentTaskTimeError, resolveAgentTaskTime } from '../server/agent-task-time.ts';
import { createAgentActionTools } from '../server/agent-action-tools.ts';
import { createProductAgentTools } from '../server/product-agent-tools.ts';
import type { AgentProposalValue } from '../src/shared/product-agent.ts';
import { AgentBudget } from '../server/agent-budget.ts';
import { randomUUID } from 'node:crypto';

const zone = 'Asia/Hong_Kong';

test('an assistant task stores the requested local clock and confirms the same day and time', () => {
  const dueAt = resolveAgentTaskTime('2026-11-23T16:00', zone);
  assert.equal(dueAt, '2026-11-23T08:00:00Z');
  const question = buildAgentConfirmationQuestion({ targetLabel: null,
    value: { kind: 'task_create', values: { title: 'Library visit', dueAt, timeZone: zone } } }, true);
  assert.match(question, /2026-11-23 16:00:00 \+08:00/u);
  assert.match(question, /Asia\/Hong_Kong/u);
  assert.throws(() => resolveAgentTaskTime('2026-11-23T16:00:00Z', zone),
    (e: unknown) => e instanceof AgentTaskTimeError && e.code === 'task_time_zone_mismatch');
  assert.equal(Date.parse(resolveAgentTaskTime('2026-11-23T16:00:00+08:00', zone)), Date.parse(dueAt));
});

test('task scheduling distinguishes missing and repeated local times and accepts the specified offset', () => {
  const ny = 'America/New_York';
  for (const local of ['2026-03-08T02:30', '2026-11-01T01:30']) {
    assert.throws(() => resolveAgentTaskTime(local, ny), AgentTaskTimeError);
  }
  for (const offset of ['-04:00', '-05:00']) {
    const at = '2026-11-01T01:30:00' + offset;
    assert.equal(resolveAgentTaskTime(at, ny), at);
  }
  assert.equal(resolveAgentTaskTime('2026-11-23T16:00:00Z', 'UTC'), '2026-11-23T16:00:00Z');
});

test('the native reminder tool rejects a crossed time zone before writing and stores the corrected local time', async t => {
  const budget = new AgentBudget();
  t.after(() => budget.close());
  const scope = { userId: 'parent', childId: randomUUID(), workspaceId: 'family', authorizationVersion: '1', dataVersion: 'one' };
  const run = { scope, runId: randomUUID(), budget };
  const saved: string[] = [];
  const actions = { execute: async (_scope: unknown, _run: string, _call: string, action: { dueAt: string }) => {
    saved.push(action.dueAt);
    return { id: randomUUID() };
  } } as unknown as Parameters<typeof createAgentActionTools>[0];
  const tool = createAgentActionTools(actions, run, async () => true).find(entry => entry.name === 'create_ordinary_reminder')!;
  const args = { title: 'Library visit', details: 'Bring the card', expectedPolicyVersion: 1,
    sourceQuote: 'Return the books at four', timeZone: zone };
  const call = { scope, runId: run.runId, callId: 'reminder', signal: budget.signal };
  const bad = await tool.execute({ ...args, dueAt: '2026-11-23T16:00:00Z' }, call);
  assert.equal(bad.data?.code, 'task_time_zone_mismatch');
  assert.deepEqual(saved, []);
  const local = { ...args, dueAt: '2026-11-23T16:00' };
  assert.ok(tool.parameters.safeParse(local).success);
  assert.equal((await tool.execute(local, call)).status, 'succeeded');
  assert.deepEqual(saved, ['2026-11-23T08:00:00Z']);
});

test('a family task proposal resolves the displayed local date before preparing the draft', async t => {
  const budget = new AgentBudget();
  t.after(() => budget.close());
  const scope = { userId: 'parent', childId: randomUUID(), workspaceId: 'family', authorizationVersion: '1', dataVersion: 'one' };
  const run = { scope, runId: randomUUID(), budget };
  const drafts: AgentProposalValue[] = [];
  const store = { propose: async (_scope: unknown, _run: string, _call: string, value: AgentProposalValue) => {
    drafts.push(value);
    return { id: randomUUID(), status: 'pending', runId: run.runId, version: 1, value };
  } };
  const tools = createProductAgentTools({ run, store, knowledge: { createRun: () => ({}) },
    authorize: async () => true } as unknown as Parameters<typeof createProductAgentTools>[0]).tools;
  const propose = tools.find(t => t.name === 'propose_task')!;
  const call = { scope, runId: run.runId, callId: 'draft', signal: budget.signal };
  const values = { title: 'Library visit', details: 'Bring the card', assigneeUserId: scope.userId, kind: 'ordinary', timeZone: zone };
  const rejected = await propose.execute({ values: { ...values, dueAt: '2026-11-23T16:00:00Z' } }, call);
  assert.equal(rejected.data?.code, 'task_time_zone_mismatch');
  assert.equal(drafts.length, 0);
  assert.equal((await propose.execute({ values: { ...values, dueAt: '2026-11-23T16:00' } }, call)).status, 'succeeded');
  assert.deepEqual(drafts, [{ kind: 'task_create', values: { ...values, dueAt: '2026-11-23T08:00:00Z' } }]);
});
