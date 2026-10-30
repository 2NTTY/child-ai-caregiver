import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreChatStore } from '../server/firestore-chat.ts';
import { createFirestoreSharingStore } from '../server/firestore-sharing.ts';
import { createFirestoreHandoverImportItems } from '../server/firestore-handover-import-items.ts';
import { createFirestoreRestoreCodec } from '../server/firestore-restore-codec.ts';
import { createFirestoreAccountExport } from '../server/firestore-account-export.ts';
import { FirestoreDomainData } from '../server/firestore-domain-data.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { importedChatMessageSchema } from '../src/shared/chat-imports.ts';
import { handleChatRequest } from '../server/chat-api.ts';
import type { HandoverImportRow } from '../server/handover-import.ts';

test('private chat imports retain source evidence without local chat execution and survive restore and re-export', async () => {
  const fake = serialFirestoreFixture(), options = { database: fake.database, cipher: createStorageCipher(Buffer.alloc(32, 89)),
    projectId: 'synthetic-chat-import', namespace: 'unit_chat_import' };
  const authority = createFirestoreAuthority(options), chat = createFirestoreChatStore(options);
  await authority.initializeControl({ enabled: true, generation: randomUUID() });
  async function admit(userId: string) {
    await authority.issueInvitation({ email: `${userId}@example.test`, operationId: randomUUID(), expiresAt: new Date(Date.now() + 3600000).toISOString() });
    await authority.admitIdentity({ userId, email: `${userId}@example.test`, emailVerified: true });
    await authority.acknowledge({ userId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
    return (await authority.createChild({ userId, operationId: randomUUID(), displayName: userId })).child.id;
  }
  const childId = await admit('recipient'), sourceChildId = await admit('source');
  const originalUser = await chat.createUserMessageForUser('source', sourceChildId, 'Original user statement');
  assert.ok(originalUser);
  const originalModel = await chat.createModelMessageForUser('source', sourceChildId, originalUser.id, 'Original model reply');
  assert.ok(originalModel);
  const nativeMessages = [originalUser, { ...originalModel, agentRunId: randomUUID(), officialHelp: ['medical-consult-hk-v1'] }];
  const source = { serverId: 'https://source.test', accountId: 'source', packageId: randomUUID(), packageVersion: 1,
    manifestSha256: 'a'.repeat(64), path: 'data/chat.json', rowIndex: 0 };
  const rows: HandoverImportRow[] = nativeMessages.map((value, rowIndex) => ({ section: 'chat', childId: sourceChildId,
    value: { ...value }, source: { ...source, rowIndex } }));
  const items = createFirestoreHandoverImportItems(options), target = { childId, spaceId: null };
  const batchId = randomUUID();
  const commands = rows.map(row => ({ opId: randomUUID(), batchId, target, row, integrity: 'trusted' as const,
    resolution: { mode: 'preserve' as const } }));
  const first = await items.apply('recipient', commands[0]);
  assert.equal(first.outcome, 'created'); assert.ok(first.resource); assert.equal(first.resource.version, 1, 'native messages without a version start at one');
  const firstResource = first.resource;
  assert.notEqual(firstResource.id, originalUser.id, 'the destination history has its own local identity');
  const second = await items.apply('recipient', commands[1]);
  assert.equal(second.outcome, 'created'); assert.ok(second.resource);
  assert.deepEqual(await items.apply('recipient', commands[0]), first, 'the original operation returns its original receipt');
  const sameSource = await items.apply('recipient', { ...commands[0], opId: randomUUID(), batchId: randomUUID() });
  assert.equal(sameSource.outcome, 'skipped'); assert.equal(sameSource.reason, 'already_imported');
  const changed = await items.apply('recipient', { ...commands[0], opId: randomUUID(),
    row: { ...rows[0], value: { ...rows[0].value, text: 'Different text at the same source version' } } });
  assert.equal(changed.outcome, 'conflict'); assert.equal(changed.reason, 'source_version_conflict');
  const page = await chat.listImportedForUser('recipient', childId);
  assert.equal(page.items.length, 2); assert.equal(page.nextCursor, null);
  const importedUrl = `https://recipient.test/api/children/${childId}/messages/imported`;
  const request = (url: string) => new Request(url, { headers: { 'x-expected-user-id': 'recipient' } });
  const listed = await handleChatRequest(request(importedUrl), 'recipient', chat);
  assert.equal(listed.status, 200); assert.deepEqual(await listed.json(), page);
  const detail = await handleChatRequest(request(`${importedUrl}/${firstResource.id}`), 'recipient', chat);
  assert.equal(detail.status, 200); assert.deepEqual(await detail.json(), page.items.find(value => value.id === firstResource.id));
  const ordinaryStore = { listForUser: chat.listForUser, createUserMessageForUser: chat.createUserMessageForUser };
  for (const url of [importedUrl, `${importedUrl}/${firstResource.id}`]) {
    assert.equal((await handleChatRequest(request(url), 'recipient', ordinaryStore)).status, 503);
    assert.equal((await handleChatRequest(request(url), null, ordinaryStore)).status, 401);
  }
  for (const [index, receipt] of [first, second].entries()) {
    const resource = receipt.resource; assert.ok(resource);
    const stored = page.items.find(value => value.id === resource.id);
    assert.ok(stored); assert.equal(stored.childId, childId); assert.equal(stored.version, resource.version);
    const { agentRunId: _run, officialHelp: _help, ...expected } = nativeMessages[index];
    assert.deepEqual(stored.message, expected, 'source author, IDs, reply linkage and original text are immutable evidence');
    assert.equal('agentRunId' in stored.message, false); assert.equal('officialHelp' in stored.message, false);
    assert.equal(stored.importedFrom.current.source.resourceId, nativeMessages[index].id);
    assert.equal(stored.importedFrom.current.source.resourceVersion, 1);
    assert.equal(stored.importedFrom.current.source.authorUserId, nativeMessages[index].authorUserId);
    assert.equal(stored.importedFrom.current.importedBy, 'recipient');
    await authority.runTransaction('recipient', childId, async binding => {
      assert.deepEqual(await chat.readImportedMessage(binding, childId, stored.id), stored);
      assert.equal(await chat.readMessage(binding, childId, stored.id), null, 'imported IDs cannot become live chat input');
    });
  }
  const ordinary = await chat.listForUser('recipient', childId); assert.ok(ordinary); assert.deepEqual(ordinary.messages, []);
  await assert.rejects(chat.listImportedForUser('source', childId));
  assert.equal([...fake.records.keys()].filter(path => /_(agent_runs|agent_claims|agent_confirmations)\//u.test(path)).length, 0);
  const sharing = createFirestoreSharingStore(options);
  const family = await sharing.create('recipient', { operationId: randomUUID(), name: 'Private chat boundary', kind: 'family' });
  await sharing.share('recipient', { operationId: randomUUID(), spaceId: family.id, expectedVersion: family.version, childId, modules: ['care'] });
  await assert.rejects(items.apply('recipient', { ...commands[0], opId: randomUUID(), target: { childId, spaceId: family.id } }),
    { code: 'private_scope_unavailable' });
  const codec = createFirestoreRestoreCodec(options), domain = new FirestoreDomainData(options), epoch = randomUUID();
  const records = [...fake.records].filter(([path]) => path.includes('_chat_imported_messages/'));
  assert.equal(records.length, 2);
  for (const [path, data] of records) {
    const decoded = codec.decode({ path, data });
    assert.equal(decoded.context.family, 'domain');
    if (decoded.context.family !== 'domain') throw new Error('Expected private domain');
    const value = importedChatMessageSchema.parse(decoded.value);
    const rotated = codec.transform(decoded, { newEpochByWorkspace: new Map([[decoded.context.scope.workspaceId, epoch]]),
      generation: randomUUID(), photoDescriptors: new Map() });
    const tags = domain.tags({ ...decoded.context.scope, storageEpoch: epoch });
    for (const [key, expected] of Object.entries(tags)) assert.equal(rotated.data[key], expected, `restored ${key}`);
    assert.notEqual(rotated.data.epochTag, data.epochTag);
    assert.equal(rotated.data.recordVersion, value.version);
    assert.equal(rotated.data.messageId, value.id);
    assert.equal(rotated.data.createdAt, value.message.createdAt, 'query metadata is rebuilt from authenticated source content');
    const checked = codec.decode(rotated);
    assert.equal(checked.context.family === 'domain' && checked.context.scope.storageEpoch, epoch);
    assert.deepEqual(checked.value, decoded.value, 'epoch rotation preserves the source message and provenance');
  }
  assert.deepEqual(await chat.listImportedForUser('recipient', childId), page, 'restore verification leaves the live old epoch untouched');
  const exporter = createFirestoreAccountExport({ ...options, photos: { async content() { throw new Error('Unexpected attachment read'); } } });
  const exported = await exporter.page('recipient', { section: 'chat_imports', childId });
  assert.equal(exported.complete, true); assert.equal(exported.items.length, 2);
  for (const value of page.items) assert.deepEqual(exported.items.find((row: any) => row.id === value.id), value);
  const copiedChildId = (await authority.createChild({ userId: 'recipient', operationId: randomUUID(), displayName: 'Second destination' })).child.id;
  const exportedUser = exported.items.find((value: any) => value.id === firstResource.id) as Record<string, unknown>;
  const roundtrip = await items.apply('recipient', { ...commands[0], opId: randomUUID(), batchId: randomUUID(),
    target: { childId: copiedChildId, spaceId: null }, row: { section: 'chat_imports', childId, value: exportedUser,
      source: { ...source, serverId: 'https://recipient.test', accountId: 'recipient', packageId: randomUUID(), path: 'data/chat-imports.json' } } });
  assert.equal(roundtrip.outcome, 'created'); assert.ok(roundtrip.resource);
  const copied = await authority.runTransaction('recipient', copiedChildId, binding => chat.readImportedMessage(binding, copiedChildId, roundtrip.resource!.id));
  assert.ok(copied); assert.deepEqual(copied.message, originalUser);
  assert.deepEqual(copied.importedFrom.previous[0], page.items.find(value => value.id === firstResource.id)!.importedFrom.current);
  const copiedOrdinary = await chat.listForUser('recipient', copiedChildId); assert.ok(copiedOrdinary); assert.deepEqual(copiedOrdinary.messages, []);
});
