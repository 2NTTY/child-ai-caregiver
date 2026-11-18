import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { privateSummaryFixture } from './helpers/private-summary-work.ts';
import { createAgentWorkTools } from '../server/agent-work-tools.ts';
import { createFirestoreAgentHistory } from '../server/firestore-agent-history.ts';
import { createFirestoreAgentRuns } from '../server/firestore-agent-runs.ts';
import type { FirestoreAgentActions } from '../server/firestore-agent-actions.ts';
import type { AgentRunContext } from '../server/agent-runtime.ts';
import type { ProductAgentStore } from '../server/product-agent-store.ts';
import type { AgentHistoryMessage } from '../src/shared/agent-work.ts';
import { FirestoreDomainData } from '../server/firestore-domain-data.ts';
import { createFirestoreRestoreCodec } from '../server/firestore-restore-codec.ts';
import { replayContentErasures } from '../server/firestore-restore-content-erasure.ts';
import { contentErasureSchema } from '../server/firestore-content-erasure.ts';
import { privateSummaryRevisionErasedBy } from '../server/firestore-private-summary-erasure.ts';
import { createFirestorePrivateSummaryScan } from '../server/firestore-private-summary-scan.ts';
import { firestoreChatMessageStorageSchema } from '../server/chat-message-schema.ts';

test('spoken and written queries recall only the corrected confirmed fact and its current parent source', async () => {
  const f = await privateSummaryFixture(), user = 'owner';
  const { child: sibling } = await f.authority.createChild({ userId: user, displayName: 'Synthetic child', operationId: randomUUID() });
  async function save(childId: string, content: string, key = '接種日安排') {
    const original = await f.chat.createUserMessageForUser(user, childId, content);
    const values = { key, content, source: { kind: 'private_chat' as const, messageId: original!.id, description: '家長原話' }, validUntil: null };
    const pending = await f.memory.createFact(user, childId, { values, intendedVisibility: 'private' });
    return (await f.memory.confirmFact(user, childId, pending!.id, { confirm: true, expectedVersion: 1, confirmShared: false }))!;
  }
  const fact = await save(f.childId, '疫苗接種時帶綠色手巾。');
  await save(sibling.id, '疫苗接種時帶黃色小熊。');
  await save(f.childId, '上學要帶水樽。', '返學安排');
  const correction = (await f.chat.createUserMessageForUser(user, f.childId, '疫苗接種時改帶藍色布兔。'))!;
  const revised = (await f.memory.reviseFact(user, f.childId, fact.id, { expectedVersion: fact.version, confirm: true, confirmShared: false,
    reason: '家長更正', values: { key: fact.key, content: correction.text, source: { kind: 'private_chat', messageId: correction.id, description: '家長更正原句' },
      validUntil: new Date(Date.now() + 86400000).toISOString() } }))!;
  const run = { scope: { userId: user, childId: f.childId }, budget: { toolResponseCharacters: 12000 } } as AgentRunContext;
  const runs = createFirestoreAgentRuns({ ...f.options, chat: f.chat, memory: f.memory });
  const history = createFirestoreAgentHistory({ runs, chat: f.chat, memory: f.memory, actions: {} as FirestoreAgentActions });
  const sources: { message: AgentHistoryMessage; reread: () => Promise<AgentHistoryMessage | null> }[] = [];
  const tools = createAgentWorkTools(history as ProductAgentStore, f.memory, run, async () => true, undefined, undefined, (message, reread) => {
    sources.push({ message, reread });
    return { citationId: 'chat:' + message.id, quoteHistory: 'H' + sources.length };
  });
  const call = { scope: run.scope, callId: 'read', runId: randomUUID(), signal: new AbortController().signal };
  const search = tools.find(tool => tool.name === 'search_history')!;
  const lookup = async (query: string) => {
    const out = await search.execute({ kind: 'memory_fact', query }, call);
    assert.equal(out.status, 'succeeded', JSON.stringify(out.data));
    return (out.data as { result: { matches: { id: string; version: number; excerpt: string; quoteHistory?: string; applicable?: boolean }[]; complete: boolean } }).result;
  };
  for (const query of ['打針要帶咩？', '接種疫苗要帶甚麼？']) {
    const result = await lookup(query);
    assert.deepEqual(result.matches.map(item => [item.id, item.version]), [[revised.id, revised.version]]);
    assert.ok(result.matches[0].excerpt.includes(correction.text));
    assert.ok(result.matches[0].applicable && result.matches[0].quoteHistory);
    assert.equal(sources.at(-1)!.message.id, correction.id);
    assert.equal(sources.at(-1)!.message.text, correction.text);
    assert.equal(result.complete, true);
  }
  const read = await tools.find(tool => tool.name === 'read_memory_facts')!.execute({ factId: revised.id }, call);
  assert.equal((read.data as { result: typeof revised }).result.version, revised.version);
  const original = await history.readHistory(user, f.childId, { messageId: correction.id, offset: 0, limit: 200 });
  assert.equal(original!.role, 'user');
  assert.equal(original!.text, correction.text);
  await f.memory.delete(user, f.childId, 'facts', revised.id, revised.version);
  assert.deepEqual((await lookup('打針')).matches, []);
  assert.equal(await sources[0].reread(), null);
  const propose = (messageId: string) => f.memory.createFact(user, f.childId, { intendedVisibility: 'private', values: { key: '疫苗日', content: correction.text,
    validUntil: null, source: { kind: 'private_chat', messageId, description: 'Candidate' } } });
  await assert.rejects(propose(correction.id), { code: 'source_changed' });
  const freshStatement = (await f.chat.createUserMessageForUser(user, f.childId, correction.text))!;
  const pending = await propose(freshStatement.id);
  assert.equal(pending?.status, 'candidate');
  assert.deepEqual((await lookup('打針')).matches, []);
  const historical = await lookup('疫苗日');
  assert.deepEqual(historical.matches.map(item => [item.id, item.applicable, item.quoteHistory]), [[pending!.id, false, undefined]]);
});

test('a revision retires even summaries and in-flight sources that predate the fact', async () => {
  const f = await privateSummaryFixture(), user = 'owner';
  const before = (await f.chat.createUserMessageForUser(user, f.childId, 'Synthetic former arrangement'))!;
  const oldWork = await f.select();
  const batch = await f.saveAll(before.text);
  const values = { key: 'arrangement', content: before.text,
    source: { kind: 'private_chat' as const, messageId: before.id, description: 'Parent statement' },
    validUntil: new Date(Date.now() + 86400000).toISOString() };
  const candidate = (await f.memory.createFact(user, f.childId, { values, intendedVisibility: 'private' }))!;
  const fact = (await f.memory.confirmFact(user, f.childId, candidate.id, { expectedVersion: 1, confirm: true, confirmShared: false }))!;
  const projection = await f.memory.initialConversationSummary(user, f.childId);
  assert.equal(projection?.validUntil, values.validUntil);
  const after = (await f.chat.createUserMessageForUser(user, f.childId, 'Synthetic corrected arrangement'))!;
  const data = new FirestoreDomainData(f.options), codec = createFirestoreRestoreCodec(f.options);
  const loadChat = (id: string) => {
    const path = data.ref('chat_messages', 'chat-message', id).path;
    return codec.decode({ path, data: f.fake.records.get(path) });
  };
  const originalBackup = [loadChat(before.id), loadChat(after.id)];
  const unlinkedOriginal = structuredClone(originalBackup[0]);
  const revised = (await f.memory.reviseFact(user, f.childId, fact.id, { expectedVersion: fact.version, confirm: true, confirmShared: false,
    reason: 'Synthetic correction', values: { ...values, content: after.text, source: { ...values.source, messageId: after.id } } }))!;
  assert.equal(await f.memory.initialConversationSummary(user, f.childId), null);
  assert.equal((await f.revalidate(oldWork.revision)).kind, 'suppressed');
  assert.equal((await f.authority.runTransaction(user, f.childId, b => f.memory.selectSource(b, { kind: 'repair_batch', summaryId: batch.id }))).kind, 'suppressed');
  const currentWork = await f.select();
  assert.deepEqual(currentWork.revision.manifest.coveredMessageIds, [after.id]);
  const inFlight = (await f.memory.prepareSummary(user, f.childId))!;
  await f.memory.delete(user, f.childId, 'facts', revised.id, revised.version);
  const [jobPath, jobBody] = [...f.fake.records].find(([path]) => path.startsWith(f.options.namespace + '_content_erasures/'))!;
  const deletion = contentErasureSchema.parse(codec.decode({ path: jobPath, data: jobBody }).value).intent;
  assert.ok(privateSummaryRevisionErasedBy({ ...currentWork.revision, manifest: { ...currentWork.revision.manifest, dependencies: [] } }, deletion));
  replayContentErasures(data, codec, originalBackup, [loadChat(before.id)], [deletion], new Map());
  for (const record of originalBackup) {
    const scope = oldWork.revision.scope;
    const restored = codec.transform(record, { generation: randomUUID(), newEpochByWorkspace: new Map([[scope.workspaceId, randomUUID()]]), photoDescriptors: new Map() });
    assert.ok('memorySummaryUntil' in codec.decode(restored).value);
  }
  assert.equal((await f.revalidate(currentWork.revision)).kind, 'suppressed');
  await assert.rejects(f.memory.saveSummary(user, f.childId, { basis: inFlight.basis, previousVersion: inFlight.previousVersion,
    text: after.text, coveredMessageIds: [after.id] }), { code: 'summary_coverage_changed' });
  assert.equal((await f.authority.runTransaction(user, f.childId, b => f.memory.rebuildSummarySource(b, currentWork.revision))).kind, 'suppressed');
  assert.equal(await f.memory.initialConversationSummary(user, f.childId), null);
  const later = (await f.chat.createUserMessageForUser(user, f.childId, 'Unrelated eligible history'))!;
  assert.deepEqual((await f.select()).revision.manifest.coveredMessageIds, [later.id]);
  const legacyJournal = structuredClone(deletion);
  assert.ok(legacyJournal.content?.kind === 'fact');
  delete legacyJournal.content.sourceMessageId;
  const unlinked = [unlinkedOriginal, loadChat(later.id)];
  replayContentErasures(data, codec, unlinked, [], [legacyJournal], new Map());
  assert.equal(firestoreChatMessageStorageSchema.parse(unlinked[0].value).memorySummaryUntil, deletion.at);
  assert.equal(firestoreChatMessageStorageSchema.parse(unlinked[1].value).memorySummaryUntil, undefined);
  await f.saveAll(later.text);
  assert.deepEqual((await f.memory.initialConversationSummary(user, f.childId))?.batchProjection?.batches.flatMap(item => item.sourceMessageIds), [later.id]);
  assert.equal((await f.chat.getOriginalMessageForUser(user, f.childId, before.id))?.text, before.text);
  await f.authority.setAccountState({ userId: user, state: 'revoked', operationId: randomUUID() });
  await assert.rejects(f.revalidate(currentWork.revision), { status: 403 });
  await assert.rejects(f.memory.initialConversationSummary(user, f.childId), { status: 403 });
});

test('a fully retired source page checkpoints without generation and later work starts at the first eligible original', async () => {
  const f = await privateSummaryFixture(), data = new FirestoreDomainData(f.options), owner = 'owner';
  // Populate a historical run with the same authenticated cutoff representation used by fact revisions.
  const scope = await f.authority.runTransaction(owner, f.childId, async b => b.scope);
  for (let index = 0; index < 51; index++) {
    const message = (await f.chat.createUserMessageForUser(owner, f.childId, 'Historical synthetic item'))!;
    const path = data.ref('chat_messages', 'chat-message', message.id).path;
    f.fake.records.set(path, { ...f.fake.records.get(path), ...data.seal('chat-message', message.id, scope,
      firestoreChatMessageStorageSchema, { ...message, memorySummaryUntil: new Date(0).toISOString() }) });
  }
  const fresh = (await f.chat.createUserMessageForUser(owner, f.childId, 'Eligible synthetic item'))!;
  const scan = createFirestorePrivateSummaryScan({ ...f.options, memory: f.memory });
  await f.authority.runTransaction(owner, f.childId, async b => {
    assert.equal((await f.memory.readSummaryScanHead(b)).freshCaughtUp, false);
    const first = await scan.prepare(b, { readFresh: async () => null, readRepair: async () => ({ kind: 'resolved' }), readWork: async () => null });
    assert.ok(first.scan.retiredChatPrefix);
    first.commit();
  });
  assert.deepEqual((await f.select()).revision.manifest.coveredMessageIds, [fresh.id]);
});
