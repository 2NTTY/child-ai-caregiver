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

import { createFirestoreAgentHistory } from '../server/firestore-agent-history.ts';
import { createAgentActionTools } from '../server/agent-action-tools.ts';
import { createAgentWorkTools } from '../server/agent-work-tools.ts';

test('current keyed memory survives repeated years, correction and reconnect without reviving terminal topics', async () => {
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
  const scope = await online.context('parent', { path: '/api/children', payload: { displayName: '合成孩子' } });
  const created = await online.submit('parent', { path: '/api/children', payload: { displayName: '合成孩子' },
    operation: { ...scope, opId: randomUUID(), deviceId: randomUUID() } });
  const childId = (created.result as any).child.id as string;
  const policy = await actions.savePolicy('parent', childId, { operationId: randomUUID(), expectedVersion: 0,
    recordKinds: [], allowPrivateNotes: true, allowRecordCorrections: false, allowSelfTasks: false,
    reminderConsentVersion: null, reminderBindings: [], confirm: true, confirmShared: false });

  async function start(text: string) {
    const message = await chat.createUserMessageForUser('parent', childId, text);
    const claim = await runs.claim('parent', childId, { kind: 'interactive', reference: message!.id }, 'product-interactive');
    return { message: message!, claim };
  }
  async function finish(claim: Awaited<ReturnType<typeof start>>['claim']) {
    await runs.finish(claim.scope, { runId: claim.runId, provenance: null, status: 'completed', stopReason: null,
      text: '已核對實際結果。', citations: [], retrievalMode: 'not_used', tools: [], counts: { modelCalls: 0, toolCalls: 0, queryEmbeddings: 0 }, proposals: [] });
  }
  const values = { kind: 'save_private_note' as const, memoryKey: '閱讀偏好', title: '閱讀偏好', text: '自 2024 年起喜歡先看圖畫。', expectedPolicyVersion: policy!.version };
  const first = await start(values.text);
  const saved = await actions.execute(first.claim.scope, first.claim.runId, 'first', { ...values, sourceQuote: first.message.text });
  assert.equal(saved!.memoryOutcome, 'created'); await finish(first.claim);
  const repeated = await start('仍然是：' + values.text);
  const repeatedInput = { ...values, sourceQuote: repeated.message.text };
  fake.loseReply();
  await assert.rejects(actions.execute(repeated.claim.scope, repeated.claim.runId, 'repeat', repeatedInput), /lost commit acknowledgement/);
  const duplicate = await actions.execute(repeated.claim.scope, repeated.claim.runId, 'repeat', repeatedInput);
  assert.equal(duplicate!.memoryOutcome, 'duplicate'); assert.deepEqual(duplicate!.resource, saved!.resource);
  assert.equal((await actions.notes('parent', childId))!.items.length, 1); await finish(repeated.claim);
  const changed = await start('2025 年起改為先聽故事，其他不變。');
  await assert.rejects(actions.execute(changed.claim.scope, changed.claim.runId, 'wrong-create', {
    ...values, text: changed.message.text, sourceQuote: changed.message.text,
  }), (e: any) => e.code === 'instruction_key_conflict');
  const revised = await actions.execute(changed.claim.scope, changed.claim.runId, 'revise', {
    kind: 'revise_private_note', expectedPolicyVersion: policy!.version, noteId: saved!.resource.id, expectedVersion: 1,
    title: values.title, text: changed.message.text, sourceQuote: changed.message.text,
  });
  assert.equal(revised!.resource.id, saved!.resource.id); assert.equal(revised!.resource.version, 2); await finish(changed.claim);
  const reconnected = createFirestoreAgentActions({ runs, proposals, care, online });
  const current = await reconnected.notesByKeys!('parent', childId, ['閱讀偏好']);
  assert.equal(current.items[0].text, changed.message.text); assert.equal(current.items[0].memoryKey, values.memoryKey);
  assert.equal(current.legacyUnkeyedNotSearched, true);
  await assert.rejects(reconnected.notesByKeys!('other', childId, ['閱讀偏好']));
  const original = (await chat.listForUser('parent', childId))!.messages.find(message => message.id === first.message.id);
  assert.equal(original!.text, values.text);
  // Existing fact keys and topic terminal states remain authoritative, not the old note or summary.
  const factValues = { key: '閱讀偏好', content: '先看圖畫', source: { kind: 'manual' as const, description: '家長核對' }, validUntil: null };
  const candidate = await memory.createFact('parent', childId, { values: factValues, intendedVisibility: 'private' });
  const fact = await memory.confirmFact('parent', childId, candidate!.id, { expectedVersion: 1, confirm: true, confirmShared: false });
  await memory.reviseFact('parent', childId, fact!.id, { expectedVersion: 2, confirm: true, confirmShared: false,
    values: { ...factValues, content: '先聽故事' }, reason: '家長更正' });
  const topic = await memory.createTopic('parent', childId, { title: '閱讀偏好', note: '', visibility: 'private', confirmShared: false });
  await memory.changeTopic('parent', childId, topic!.id, { expectedVersion: 1, status: 'resolved', note: '已處理', resumeAfter: null });
  const recalled = await memory.recall!('parent', childId, ['閱讀偏好']);
  assert.equal(recalled.facts[0].content, '先聽故事'); assert.equal(recalled.facts[0].applicable, true);
  assert.equal(recalled.topics[0].status, 'resolved'); assert.equal(recalled.topics[0].mayAsk, false);
  await assert.rejects(memory.changeTopic('parent', childId, topic!.id, { expectedVersion: 2, status: 'pending', note: '', resumeAfter: null }), (e: any) => e.code === 'terminal_topic');
  await memory.deactivateFact('parent', childId, fact!.id, { expectedVersion: 3, reason: '已不再適用' });
  assert.equal((await memory.recall!('parent', childId, ['閱讀偏好'])).facts.length, 0);
  assert.equal((await memory.getFact('parent', childId, fact!.id))!.status, 'inactive');
  const history = createFirestoreAgentHistory({ runs, chat, memory, actions });
  const range = { kind: 'message' as const, query: '2024', cursor: null,
    createdFrom: new Date(Date.parse(first.message.createdAt) - 1).toISOString(),
    createdBefore: new Date(Date.parse(first.message.createdAt) + 1).toISOString() };
  const found = await history.searchHistory('parent', childId, range);
  assert.ok(found.matches.some(match => match.id === first.message.id));
  assert.ok(found.matches.every(match => match.createdAt >= range.createdFrom && match.createdAt < range.createdBefore));
  // Use the real tool factories: no UI or replacement memory implementation.
  const next = await start('查回閱讀偏好');
  const run = { scope: next.claim.scope, runId: next.claim.runId, budget: { toolResponseCharacters: 12000 } } as any;
  const actionTools = createAgentActionTools(reconnected, run, async () => true);
  const notes = await actionTools.find(t => t.name === 'read_private_instructions')!.execute({ query: '', afterId: null, memoryKeys: ['閱讀偏好'] }, {} as any);
  assert.equal((notes.data as any).items[0].version, 2);
  const workTools = createAgentWorkTools({} as any, memory, run, async () => true);
  const facts = await workTools.find(t => t.name === 'read_memory_facts')!.execute({ factId: null, afterId: null, keys: ['閱讀偏好'] }, {} as any);
  assert.equal((facts.data as any).result.topics[0].mayAsk, false); await finish(next.claim);
  await actions.deleteNote('parent', childId, saved!.resource.id, { expectedVersion: 2, confirmDelete: true, operationId: randomUUID() });
  assert.equal((await reconnected.notesByKeys!('parent', childId, ['閱讀偏好'])).items.length, 0);
  for (const row of fake.records.values()) assert.equal(JSON.stringify(row).includes('閱讀偏好'), false);
});
