import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { summaryLineageKeyForTarget } from '../server/private-summary-work.ts';
import { firestoreAgentRunSchema } from '../server/firestore-agent-runs.ts';

function fixture() {
  const messageId = randomUUID(), id = randomUUID(), childId = randomUUID(), workspaceId = randomUUID(), storageEpoch = randomUUID();
  const reference = randomUUID(), expiresAt = new Date(Date.now() + 90000).toISOString();
  const binding = { format: 'private-summary-fast/v1', target: { kind: 'fresh_message', messageId }, lineageKey: summaryLineageKeyForTarget({ ownerUserId: 'owner', childId, workspaceId, storageEpoch }, { kind: 'fresh_message', messageId }),
    manifestHash: 'b'.repeat(64), candidate: { target: { kind: 'fresh_prefix', firstMessageId: messageId, messageCount: 2 }, sourceHash: 'c'.repeat(64) },
    rootContext: null, selected: null, noDispatch: null, transferredToWorkId: null };
  const run = { id, childId, ownerUserId: 'owner', workspaceId, storageEpoch, authorizationVersion: '1', dataVersion: storageEpoch + ':1',
    trigger: { kind: 'worker', reference }, workerGeneration: randomUUID(), sourceMessageId: null, recipeId: 'memory-refresh',
    state: 'running', stopReason: null, createdAt: new Date().toISOString(), expiresAt, result: null, summaryFast: binding };
  const rootContext = { generation: 1, binding: { rootRunId: id, ownerId: 'owner', workspaceId, childId, storageEpoch,
    authorizationVersion: '1', trigger: run.trigger, workflowVersion: 'synthetic', promptPackVersion: '1.0.0',
    settingsVersion: 'synthetic', billingVersion: 'synthetic', limits: { modelCalls: 1, toolCalls: 1, queryEmbeddings: 1 }, deadlineAtMs: Date.parse(expiresAt) } };
  return { run, binding, rootContext };
}

test('a private fast probe persists both candidate and fallback identities on its original worker run', () => {
  const { run } = fixture();
  assert.equal(firestoreAgentRunSchema.safeParse(run).success, true);
  assert.equal(firestoreAgentRunSchema.safeParse({ ...run, summaryFast: { ...run.summaryFast,
    selected: { sourceHash: 'd'.repeat(64), coveredMessageIds: [run.summaryFast.target.messageId] } } }).success, true);
});

test('fast probe metadata cannot be used by another recipe, an interactive run or a durable part', () => {
  const { run, binding } = fixture();
  for (const bad of [{ ...run, recipeId: 'product-background' }, { ...run, trigger: { ...run.trigger, kind: 'interactive' } },
    { ...run, summaryWork: { workId: randomUUID(), sourceRevision: 1, step: 0, attempt: 0 }, summaryRetirementId: null },
    { ...run, summaryFast: { ...binding, candidate: { ...binding.candidate, target: { ...binding.candidate.target, firstMessageId: randomUUID() } } } },
    { ...run, summaryFast: { ...binding, selected: { sourceHash: 'd'.repeat(64), coveredMessageIds: [randomUUID()] } } },
    { ...run, summaryFast: { ...binding, transferredToWorkId: randomUUID() } },
    { ...run, summaryFast: { ...binding, noDispatch: { evidenceId: 'e'.repeat(64) } } }])
    assert.equal(firestoreAgentRunSchema.safeParse(bad).success, false);
});

test('the persisted root context belongs to the same original fast run and deadline', () => {
  const { run, binding, rootContext } = fixture();
  assert.equal(firestoreAgentRunSchema.safeParse({ ...run, summaryFast: { ...binding, rootContext } }).success, true);
  for (const wrong of [{ ...rootContext.binding, rootRunId: randomUUID() }, { ...rootContext.binding, storageEpoch: randomUUID() },
    { ...rootContext.binding, deadlineAtMs: rootContext.binding.deadlineAtMs + 1 }, { ...rootContext.binding, authorizationVersion: '2' }])
    assert.equal(firestoreAgentRunSchema.safeParse({ ...run, summaryFast: { ...binding, rootContext: { ...rootContext, binding: wrong } } }).success, false);
});

test('fast metadata validates its derived lineage and worker-only source identity, not just digest shape', () => {
  const { run, binding } = fixture();
  for (const bad of [{ ...run, summaryFast: { ...binding, lineageKey: 'a'.repeat(64) } },
    { ...run, sourceMessageId: randomUUID() }, { ...run, workspaceId: randomUUID() }])
    assert.equal(firestoreAgentRunSchema.safeParse(bad).success, false);
});
