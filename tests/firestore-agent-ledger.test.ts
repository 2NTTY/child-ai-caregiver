import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirestoreChatStore } from '../server/firestore-chat.ts';
import { createFirestoreCareStore } from '../server/firestore-care.ts';
import { createFirestoreMemoryStore } from '../server/firestore-memory.ts';
import { createFirestoreAgentRuns } from '../server/firestore-agent-runs.ts';
import { createFirestoreAgentProposals } from '../server/firestore-agent-proposals.ts';
import { createFirestoreAgentActions } from '../server/firestore-agent-actions.ts';
import { createFirestoreAgentWork } from '../server/firestore-agent-work.ts';
import { createFirestoreAgentConfirmations } from '../server/firestore-agent-confirmations.ts';
import type { ProductAgentResult } from '../src/shared/product-agent.ts';
import { createFirestoreProductAgent } from '../server/firestore-product-agent.ts';
import { readAiConfig } from '../server/ai-config.ts';
import { FinishReason } from '@google/genai';

test('one Firestore conversation preserves action receipts, bound confirmation, work and cancellation after lost acknowledgement', async () => {
  const fake = firestoreDomainFixture(), options = { database: fake.database, cipher: createStorageCipher(Buffer.alloc(32, 42)),
    projectId: 'synthetic-agent-project', namespace: 'synthetic_agent' };
  const authority = createFirestoreAuthority(options);
  await authority.initializeControl({ generation: randomUUID(), enabled: true });
  for (const userId of ['parent', 'other']) {
    const email = userId + '@example.test';
    await authority.issueInvitation({ email, expiresAt: new Date(Date.now() + 60_000).toISOString(), operationId: randomUUID() });
    await authority.admitIdentity({ userId, email, emailVerified: true });
    await authority.acknowledge({ userId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  }
  const chat = createFirestoreChatStore(options), care = createFirestoreCareStore(options);
  const memory = createFirestoreMemoryStore({ ...options, chat, care });
  const online = createFirestoreOnlineStore({ ...options, mutations: [chat.mutation, care.mutation, memory.mutation] });
  const runs = createFirestoreAgentRuns({ ...options, chat, memory });
  const proposals = createFirestoreAgentProposals({ runs, chat, memory, online });
  const actions = createFirestoreAgentActions({ runs, proposals, care, online });
  const work = createFirestoreAgentWork({ runs, proposals,
    validateResource: async () => { throw Error('This scenario has no resource reference'); },
    validateKnowledge: async () => { throw Error('This scenario has no knowledge reference'); } });
  const confirmations = createFirestoreAgentConfirmations({ runs, proposals, chat, policyVersion: async b => (await actions.readPolicy(b)).version });
  const scope = await online.context('parent', { path: '/api/children', payload: { displayName: '合成孩子' } });
  const created = await online.submit('parent', { path: '/api/children', payload: { displayName: '合成孩子' },
    operation: { ...scope, opId: randomUUID(), deviceId: randomUUID() } });
  const childId = (created.result as any).child.id as string;
  const policy = await actions.savePolicy('parent', childId, { operationId: randomUUID(), expectedVersion: 0,
    recordKinds: [], allowPrivateNotes: true, allowRecordCorrections: false, allowSelfTasks: false,
    reminderConsentVersion: null, reminderBindings: [], confirm: true, confirmShared: false });
  const message = await chat.createUserMessageForUser('parent', childId, '記住我想先整理手冊，下次帶去見醫生。');
  const claim = await runs.claim('parent', childId, { kind: 'interactive', reference: message!.id }, 'product-interactive');
  const receipt = await actions.execute(claim.scope, claim.runId, 'note-call', { kind: 'save_private_note',
    sourceQuote: message!.text, expectedPolicyVersion: policy!.version, title: '整理手冊', text: '先整理手冊，下次帶去見醫生。' });
  assert.deepEqual(await actions.execute(claim.scope, claim.runId, 'note-call', { kind: 'save_private_note',
    sourceQuote: message!.text, expectedPolicyVersion: policy!.version, title: '整理手冊', text: '先整理手冊，下次帶去見醫生。' }), receipt);
  const savedWork = await work.saveWork(claim.scope, claim.runId, 'work-call', { operationId: randomUUID(), workId: null,
    expectedVersion: 0, values: { goal: '整理手冊', focus: '核對準備時間', questions: [], sourceMessageIds: [message!.id],
      resources: [], pending: [], status: 'waiting', followUp: null } });
  const candidate = await proposals.propose(claim.scope, claim.runId, 'task-call', { kind: 'task_create',
    values: { title: '帶健康手冊', details: '', kind: 'ordinary', assigneeUserId: 'parent',
      dueAt: new Date(Date.now() + 3_600_000).toISOString(), timeZone: 'Asia/Hong_Kong' } });
  const ask = await confirmations.requestConfirmation(claim.scope, claim.runId, { runId: claim.runId,
    proposalId: candidate.id, expectedVersion: 1, workId: savedWork.id });
  const result: ProductAgentResult = { runId: claim.runId, provenance: null, status: 'completed', stopReason: null,
    text: ask!.question, citations: [], retrievalMode: 'not_used', tools: [], counts: { modelCalls: 0, toolCalls: 3, queryEmbeddings: 0 }, proposals: [] };
  assert.equal(await runs.finish(claim.scope, result), true);
  const reply = await chat.createModelMessageForUser('parent', childId, message!.id, result.text);
  await confirmations.bindConfirmationQuestion('parent', childId, reply!.id);
  const yes = await chat.createUserMessageForUser('parent', childId, '好');
  fake.loseReply();
  await assert.rejects(confirmations.consumeConfirmation('parent', childId, yes!.id), /lost commit acknowledgement/);
  const confirmed = await confirmations.consumeConfirmation('parent', childId, yes!.id);
  assert.equal(confirmed!.status, 'accepted');
  assert.equal((await online.tasks.list('parent', childId)).items.length, 1);
  assert.deepEqual(await confirmations.recordedConfirmation('parent', childId, yes!.id), { proposalId: candidate.id });
  assert.equal((await work.readWork('parent', childId, { workId: null, cursor: null })).items[0].id, savedWork.id);
  assert.equal((await proposals.pendingProposals('parent', childId)).proposals.length, 0);
  await assert.rejects(runs.claim('other', childId, { kind: 'interactive', reference: yes!.id }, 'product-interactive'));
  const next = await runs.claim('parent', childId, { kind: 'interactive', reference: yes!.id }, 'product-interactive');
  const reconnected = createFirestoreAgentRuns({ ...options, chat, memory });
  assert.equal(await reconnected.cancelReply('parent', childId, yes!.id), true);
  assert.equal(await runs.authorize(next.scope, next.runId), false);
  assert.equal((await reconnected.claim('parent', childId, { kind: 'interactive', reference: yes!.id }, 'product-interactive')).created, false);
  // The same scenario now crosses the real Runner/native-session/root-budget composition.
  const later = await chat.createUserMessageForUser('parent', childId, '記住我出門前會整理手冊。');
  let calls = 0;
  const product = await createFirestoreProductAgent({ ...options, chat, care, memory, online,
    config: readAiConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: options.projectId }), platformProvider: {
      async generate(request) {
        calls++;
        if (calls > 3) throw Error('Unexpected extra generation');
        const parts = calls === 1 ? [
          { functionCall: { id: 'read-1', name: 'read_context', args: {} } },
          { functionCall: { id: 'load-1', name: 'load_capabilities', args: { capabilities: ['private_instructions'] } } },
        ] : calls === 2 ? [{ functionCall: { id: 'save-1', name: 'save_private_instruction', args: {
          sourceQuote: later!.text, expectedPolicyVersion: policy!.version, title: '出門前整理', text: '出門前會整理手冊。' } } }]
          : [{ functionCall: { id: 'answer-1', name: 'present_answer', args: {
            kind: 'operation', paragraphs: [{ text: '已保存這項私人交代。', citationIds: [] }] } } }];
        if (calls > 1) assert.ok(request.contents.some(value => value.parts?.some(part => part.functionResponse)));
        return { content: { role: 'model', parts }, finishReason: FinishReason.STOP,
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } };
      },
    } });
  const answered = await product.agent.reply('parent', childId, later!.id, async () => true);
  assert.equal(answered?.status, 'completed', JSON.stringify(answered));
  assert.equal(answered?.tools.find(tool => tool.name === 'save_private_instruction')?.status, 'succeeded');
  assert.equal((await product.routing.currentUsage('parent')).attempts, 3);
  const persistedReply = await chat.createModelMessageForUser('parent', childId, later!.id, answered!.text);
  assert.equal(persistedReply?.agentRunId, answered?.runId);
  const history = await product.store.searchHistory('parent', childId, { kind: 'private_instruction', query: '出門前', cursor: null });
  assert.equal(history!.matches.length, 1);
  assert.equal((await product.store.get('parent', childId, answered!.runId))?.tools.some(tool => tool.name === 'save_private_instruction'), true);
  for (const row of fake.records.values()) assert.equal(JSON.stringify(row).includes('手冊'), false);
});

test('stale delivery preserves a readable original receipt after a concurrent change', async () => {
  const fake = firestoreDomainFixture(), options = { database: fake.database, cipher: createStorageCipher(Buffer.alloc(32, 42)),
    projectId: 'synthetic-stale-project', namespace: 'synthetic_stale' };
  const authority = createFirestoreAuthority(options);
  await authority.initializeControl({ generation: randomUUID(), enabled: true });
  await authority.issueInvitation({ email: 'parent@example.test', expiresAt: new Date(Date.now() + 60_000).toISOString(), operationId: randomUUID() });
  await authority.admitIdentity({ userId: 'parent', email: 'parent@example.test', emailVerified: true });
  await authority.acknowledge({ userId: 'parent', operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  const chat = createFirestoreChatStore(options), care = createFirestoreCareStore(options);
  const memory = createFirestoreMemoryStore({ ...options, chat, care });
  const online = createFirestoreOnlineStore(options), runs = createFirestoreAgentRuns({ ...options, chat, memory });
  const scope = await online.context('parent', { path: '/api/children', payload: { displayName: '合成孩子' } });
  const created = await online.submit('parent', { path: '/api/children', payload: { displayName: '合成孩子' },
    operation: { ...scope, opId: randomUUID(), deviceId: randomUUID() } });
  const childId = (created.result as any).child.id as string;
  const source = await chat.createUserMessageForUser('parent', childId, '核對目前資料。');
  const stale = await runs.claim('parent', childId, { kind: 'interactive', reference: source!.id }, 'product-interactive');
  await chat.createUserMessageForUser('parent', childId, '稍後補充。');
  const result: ProductAgentResult = { runId: stale.runId, provenance: null, status: 'completed', stopReason: null,
    text: '已核對。', citations: [], retrievalMode: 'not_used', tools: [], counts: { modelCalls: 0, toolCalls: 0, queryEmbeddings: 0 }, proposals: [] };
  assert.equal(await runs.finish(stale.scope, result), true);
  const loaded = await runs.result('parent', childId, stale.runId, { read: async (_b, _run, value) => value });
  assert.equal(loaded?.status, 'stopped');
  assert.equal(loaded?.stopReason, 'unauthorized');
  assert.equal(Object.hasOwn(loaded!, 'outcome'), false);
  assert.equal(Object.hasOwn(loaded!, 'deliveryReview'), false);
});
