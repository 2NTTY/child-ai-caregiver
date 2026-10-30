import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreChatStore } from '../server/firestore-chat.ts';
import { createFirestoreCareStore } from '../server/firestore-care.ts';
import { createFirestoreMemoryStore } from '../server/firestore-memory.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirestoreAgentRuns } from '../server/firestore-agent-runs.ts';
import { createFirestoreAgentProposals } from '../server/firestore-agent-proposals.ts';
import { createFirestoreAgentActions } from '../server/firestore-agent-actions.ts';
import { createFirestoreAgentHistory } from '../server/firestore-agent-history.ts';
import { createFirestoreHandoverImportItems, type HandoverImportItemCommand } from '../server/firestore-handover-import-items.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { importedChatMessageSchema, type ImportedChatMessage } from '../src/shared/chat-imports.ts';
import { createAgentWorkTools } from '../server/agent-work-tools.ts';
import type { ProductAgentStore } from '../server/product-agent-store.ts';
import type { AgentRunContext } from '../server/agent-runtime.ts';
import { createFirestoreVoiceTranscripts } from '../server/firestore-voice-transcripts.ts';
import { FirestoreDomainError } from '../server/firestore-domain-data.ts';
import { agentHistoryMessageSchema, agentHistoryPageSchema } from '../src/shared/agent-work.ts';

test('agent imported history preserves source evidence and bounded continuations without entering native chat', async () => {
  const fixture = serialFirestoreFixture(), options = { database: fixture.database, cipher: createStorageCipher(Buffer.alloc(32, 91)),
    projectId: 'synthetic-imported-agent-history', namespace: 'unit_imported_agent_history' };
  const authority = createFirestoreAuthority(options), chat = createFirestoreChatStore(options), care = createFirestoreCareStore(options);
  const memory = createFirestoreMemoryStore({ ...options, chat, care }), online = createFirestoreOnlineStore(options);
  const runs = createFirestoreAgentRuns({ ...options, chat, memory });
  const proposals = createFirestoreAgentProposals({ runs, chat, memory, online });
  const actions = createFirestoreAgentActions({ runs, proposals, care, online });
  const history = createFirestoreAgentHistory({ runs, chat, memory, actions }), items = createFirestoreHandoverImportItems(options);
  await authority.initializeControl({ enabled: true, generation: randomUUID() });
  async function admit(userId: string) {
    await authority.issueInvitation({ email: `${userId}@example.test`, operationId: randomUUID(), expiresAt: new Date(Date.now() + 3600000).toISOString() });
    await authority.admitIdentity({ userId, email: `${userId}@example.test`, emailVerified: true });
    await authority.acknowledge({ userId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
    return (await authority.createChild({ userId, operationId: randomUUID(), displayName: userId })).child.id;
  }
  const childId = await admit('recipient'), sourceChildId = await admit('source');
  const sourceUser = await chat.createUserMessageForUser('source', sourceChildId, 'history-marker ' + 'Original long statement. '.repeat(70)); assert.ok(sourceUser);
  const sourceModel = await chat.createModelMessageForUser('source', sourceChildId, sourceUser.id, 'history-marker Original model reply'); assert.ok(sourceModel);
  const native = await chat.createUserMessageForUser('recipient', childId, 'history-marker Local chat only'); assert.ok(native);
  const originals = [sourceUser, sourceModel, ...Array.from({ length: 9 }, (_, index) => ({ ...sourceUser, id: randomUUID(),
    text: `history-marker Earlier statement ${index}`, createdAt: `2026-10-29T00:00:${String(index).padStart(2, '0')}Z` }))];
  const commands: HandoverImportItemCommand[] = [], imported: ImportedChatMessage[] = [];
  const packageId = randomUUID(), batchId = randomUUID();
  for (const [rowIndex, original] of originals.entries()) {
    const saved = await items.apply('source', { opId: randomUUID(), batchId, target: { childId: sourceChildId, spaceId: null },
      row: { section: 'chat', childId: sourceChildId, value: { ...original }, source: { serverId: 'https://upstream.test', accountId: 'source',
        packageId, packageVersion: 1, manifestSha256: 'a'.repeat(64), path: 'data/chat.json', rowIndex } }, integrity: 'trusted', resolution: { mode: 'preserve' } });
    assert.ok(saved.resource);
    const wrapper = await chat.getImportedForUser('source', sourceChildId, saved.resource.id); assert.ok(wrapper);
    const command: HandoverImportItemCommand = { opId: randomUUID(), batchId, target: { childId, spaceId: null }, integrity: 'trusted', resolution: { mode: 'preserve' },
      row: { section: 'chat_imports', childId: sourceChildId, value: { ...wrapper }, source: { serverId: 'https://source.test', accountId: 'source',
        packageId, packageVersion: 1, manifestSha256: 'b'.repeat(64), path: 'data/chat-imports.json', rowIndex } } };
    commands.push(command);
    const result = await items.apply('recipient', command); assert.ok(result.resource);
    const value = await chat.getImportedForUser('recipient', childId, result.resource.id); assert.ok(value); imported.push(value);
  }
  const query = { kind: 'imported_message' as const, query: 'history-marker', cursor: null };
  const first = await history.searchHistory('recipient', childId, query);
  assert.deepEqual(agentHistoryPageSchema.parse(first), first);
  assert.equal(first.matches.length, 10); assert.equal(first.scanLimit, 100); assert.ok(first.scanned <= 100);
  assert.equal(first.complete, false); assert.ok(first.nextCursor);
  const cursor = first.nextCursor;
  const remaining = await history.searchHistory('recipient', childId, { ...query, cursor });
  assert.equal(remaining.matches.length, 1); assert.equal(remaining.complete, true); assert.equal(remaining.nextCursor, null);
  const expectedOrder = [...imported].sort((left, right) => right.message.createdAt.localeCompare(left.message.createdAt) || right.id.localeCompare(left.id));
  const matches = [...first.matches, ...remaining.matches];
  assert.deepEqual(matches.map(match => match.id), expectedOrder.map(value => value.id));
  for (const match of matches) {
    const original = imported.find(value => value.id === match.id); assert.ok(original);
    assert.equal(match.kind, 'imported_message'); assert.equal(match.version, original.version);
    assert.equal(match.role, original.message.role); assert.equal(match.createdAt, original.message.createdAt);
  }
  const importedUser = imported[0], importedModel = imported[1];
  const read = { kind: 'imported_message' as const, messageId: importedUser.id, offset: 0, limit: 64 };
  const start = await history.readHistory('recipient', childId, read); assert.ok(start);
  assert.deepEqual(agentHistoryMessageSchema.parse(start), start);
  assert.equal(start.version, importedUser.version); assert.equal(start.role, 'user'); assert.equal(start.text, sourceUser.text.slice(0, 64));
  assert.deepEqual(start.importedSource, { message: { id: sourceUser.id, childId: sourceChildId, authorUserId: 'source', inReplyTo: null },
    provenance: importedUser.importedFrom.current, attachment: null });
  const contentVersion = start.contentVersion; assert.ok(contentVersion); assert.match(contentVersion, /^[a-f0-9]{64}$/u);
  assert.equal(start.nextOffset, 64); assert.equal(start.totalCharacters, sourceUser.text.length);
  const continuation = await history.readHistory('recipient', childId, { ...read, offset: 64, limit: 4000, contentVersion }); assert.ok(continuation);
  assert.equal(start.text + continuation.text, sourceUser.text); assert.equal(continuation.nextOffset, null);
  await assert.rejects(history.readHistory('recipient', childId, { ...read, offset: 64 }), { code: 'version_conflict' });
  const model = await history.readHistory('recipient', childId, { ...read, messageId: importedModel.id, limit: 4000 }); assert.ok(model);
  assert.equal(model.role, 'model'); assert.equal(model.importedSource!.message.inReplyTo, sourceUser.id); assert.equal(model.importedSource!.message.authorUserId, null);
  const nativeSearch = await history.searchHistory('recipient', childId, { ...query, kind: 'message' });
  assert.deepEqual(nativeSearch.matches.map(match => match.id), [native.id]);
  const nativeRead = await history.readHistory('recipient', childId, { messageId: native.id, offset: 0, limit: 4000 });
  assert.ok(nativeRead); assert.equal(nativeRead.text, native.text); assert.equal(nativeRead.importedSource, undefined);
  assert.equal(await history.readHistory('recipient', childId, { messageId: importedUser.id, offset: 0, limit: 64 }), null);
  await assert.rejects(history.searchHistory('source', childId, query));
  await assert.rejects(history.readHistory('source', childId, read));
  await assert.rejects(history.searchHistory('source', sourceChildId, { ...query, cursor }), { code: 'invalid_cursor' });
  await assert.rejects(history.readHistory('recipient', childId, { ...read, spaceId: randomUUID() } as typeof read), { code: 'invalid_input' });
  // Exercise the original tool wrappers without claiming or dispatching a model run.
  const tools = createAgentWorkTools(history as unknown as ProductAgentStore, memory, { scope: { userId: 'recipient', childId },
    runId: randomUUID(), budget: { toolResponseCharacters: 12000 } } as AgentRunContext, async () => true);
  const searched = await tools.find(tool => tool.name === 'search_history')!.execute(query, {} as any);
  assert.equal(searched.status, 'succeeded'); assert.deepEqual((searched.data as any).result, first);
  const toolRead = await tools.find(tool => tool.name === 'read_history')!.execute(read, {} as any);
  assert.equal(toolRead.status, 'succeeded'); assert.deepEqual((toolRead.data as any).result, start);
  const prior = commands[0], wrapper = importedChatMessageSchema.parse(prior.row.value);
  const updated = await items.apply('recipient', { ...prior, opId: randomUUID(), row: { ...prior.row,
    value: { ...wrapper, version: 2, message: { ...wrapper.message, text: sourceUser.text + ' Updated source wrapper.' } } } });
  assert.equal(updated.outcome, 'updated'); assert.ok(updated.resource); assert.equal(updated.resource.id, importedUser.id); assert.equal(updated.resource.version, 2);
  await assert.rejects(history.searchHistory('recipient', childId, { ...query, cursor }), { code: 'version_conflict' });
  await assert.rejects(history.readHistory('recipient', childId, { ...read, offset: 64, contentVersion }), { code: 'version_conflict' });
  const current = await history.readHistory('recipient', childId, { ...read, limit: 4000 }); assert.ok(current);
  assert.equal(current.version, 2); assert.notEqual(current.contentVersion, contentVersion); assert.equal(current.text, sourceUser.text + ' Updated source wrapper.');
  const localVoiceId = randomUUID(), sourceVoice = { id: randomUUID(), version: 3, mimeType: 'audio/wav' as const,
    bytes: 16044, durationMs: 1000, sha256: 'c'.repeat(64) };
  const voiceMessage = { ...sourceUser, id: randomUUID(), text: 'voice-marker Original accompanying text', voice: sourceVoice };
  const voiceHistory = await authority.runTransaction('recipient', childId, async binding => {
    const prepared = await chat.prepareImported(binding, randomUUID(), { section: 'chat', childId: sourceChildId, value: voiceMessage,
      source: { ...commands[0].row.source, path: 'data/voice-chat.json', rowIndex: 0 } }, 'trusted', undefined,
      { kind: 'voices', resource: { id: localVoiceId, version: 4 } });
    prepared.commit(); return prepared.value;
  });
  const transcripts = createFirestoreVoiceTranscripts({ ...options, voices: { async readEvidence() { throw Error('A missing transcript must not read evidence'); } } });
  let mediaMode: 'missing' | 'binding-failure' | 'foreign' = 'missing', transcriptReads = 0;
  const mediaHistory = createFirestoreAgentHistory({ runs, chat, memory, actions,
    voices: { async readMetadata(binding, id) {
      assert.equal(binding.scope.ownerUserId, 'recipient'); assert.equal(binding.scope.childId, childId);
      assert.equal(id, localVoiceId, 'source voice IDs must never be used as local metadata keys');
      return { ...sourceVoice, id: localVoiceId, childId: mediaMode === 'foreign' ? sourceChildId : childId, version: 4,
        createdAt: sourceUser.createdAt, state: 'ready', fileName: 'retained.wav', messageId: null };
    } }, transcripts: { async readIn(binding, id) {
      transcriptReads++; assert.equal(id, localVoiceId);
      if (mediaMode === 'binding-failure') throw new FirestoreDomainError(503, 'voice_transcript_binding');
      return transcripts.readIn(binding, id);
    } } });
  const workBefore = [...fixture.records.keys()].filter(path => path.includes('_background_work/')).sort();
  const voiceRead = { kind: 'imported_message' as const, messageId: voiceHistory.id, offset: 0, limit: 4000 };
  const unavailable = await mediaHistory.readHistory('recipient', childId, voiceRead); assert.ok(unavailable);
  assert.deepEqual(agentHistoryMessageSchema.parse(unavailable), unavailable);
  assert.ok(unavailable.text.startsWith(voiceMessage.text)); assert.match(unavailable.text, /錄音轉錄目前不可讀/);
  assert.equal(unavailable.voice!.id, localVoiceId);
  const voiceSearch = await mediaHistory.searchHistory('recipient', childId, { kind: 'imported_message', query: 'voice-marker', cursor: null });
  assert.deepEqual(voiceSearch.matches.map(match => match.id), [voiceHistory.id]); assert.match(voiceSearch.matches[0].excerpt, /錄音轉錄目前不可讀/);
  mediaMode = 'binding-failure';
  await assert.rejects(mediaHistory.readHistory('recipient', childId, voiceRead), { code: 'voice_transcript_binding' });
  mediaMode = 'foreign'; const beforeForeign = transcriptReads;
  const foreign = await mediaHistory.readHistory('recipient', childId, voiceRead); assert.ok(foreign);
  assert.match(foreign.text, /匯入錄音原件未包含或目前不可讀/); assert.equal(foreign.voice, undefined); assert.equal(transcriptReads, beforeForeign);
  assert.deepEqual([...fixture.records.keys()].filter(path => path.includes('_background_work/')).sort(), workBefore);
  assert.equal([...fixture.records.keys()].filter(path => /_(agent_runs|agent_claims|agent_confirmations)\//u.test(path)).length, 0);
});
