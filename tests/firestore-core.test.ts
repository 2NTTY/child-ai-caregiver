import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirestoreChatStore } from '../server/firestore-chat.ts';
import { createFirestoreCareStore } from '../server/firestore-care.ts';
import { createFirestoreMemoryStore } from '../server/firestore-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';

test('Firestore core preserves original chat receipt, care versions, memory source and private summary across reconnect', async () => {
  const fake = firestoreDomainFixture();
  const options = { database: fake.database, cipher: createStorageCipher(Buffer.alloc(32, 41)),
    projectId: 'synthetic-core-project', namespace: 'synthetic_core' };
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
  async function command(path: string, payload: any) {
    return { path, payload, operation: { ...await online.context('parent', { path, payload }), opId: randomUUID(), deviceId: randomUUID() } };
  }
  async function submit(path: string, payload: any) { return (await online.submit('parent', await command(path, payload))).result as any; }
  const { child } = await submit('/api/children', { displayName: '合成孩子' }), base = '/api/children/' + child.id;
  const raw = '  昨晚喝了約 120 ml\n先保持原文。';
  const original = await command(base + '/messages', { text: raw });
  fake.loseReply();
  await assert.rejects(online.submit('parent', original), /lost commit acknowledgement/);
  const recovered = await online.submit('parent', original);
  const reconnectedChat = createFirestoreChatStore(options);
  const messages = await reconnectedChat.listForUser('parent', child.id);
  assert.equal(messages!.messages.length, 1);
  assert.equal(messages!.messages[0].text, raw);
  assert.equal((await online.lookup('parent', original.operation.opId)).state, 'confirmed');
  assert.equal((recovered.result as any).message.id, messages!.messages[0].id);
  await assert.rejects(reconnectedChat.listForUser('other', child.id));

  const { record } = await submit(base + '/records', { text: raw });
  const source = { kind: 'care_record', recordId: record.id, version: record.version, description: '家長原文' };
  const { fact } = await submit(base + '/memory/facts', { values: { key: '昨晚餵食', content: raw, source, validUntil: null }, intendedVisibility: 'private' });
  const { fact: confirmed } = await submit(base + '/memory/facts/' + fact.id + '/confirm', { expectedVersion: 1, confirm: true, confirmShared: false });
  assert.equal(confirmed.applicable, true);
  const input = await memory.prepareSummary('parent', child.id);
  await memory.saveSummary('parent', child.id, { previousVersion: input!.previousVersion, basis: input!.basis,
    text: '家長說昨晚喝了約 120 ml。', coveredMessageIds: input!.messages.map(message => message.id) });
  assert.ok((await memory.summary('parent', child.id))!.summary);
  const more = await submit(base + '/messages', { text: '只把昨晚那筆改成約 100 ml。' });
  const nextSummary = await memory.prepareSummary('parent', child.id);
  assert.ok(nextSummary!.previous);
  assert.deepEqual(nextSummary!.messages.map(message => message.id), [more.message.id]);
  const changed = await submit(base + '/care/' + record.id + '/revise', {
    text: '昨晚約 100 ml', details: record.details, source: record.source, expectedVersion: 1, reason: '家長更正', confirmShared: true,
  });
  assert.equal(changed.record.version, 2);
  await assert.rejects(submit(base + '/care/' + record.id + '/revise', {
    text: '舊版本不能覆寫', details: record.details, source: record.source, expectedVersion: 1, reason: '過時', confirmShared: true,
  }), (error: any) => error.code === 'version_conflict');
  assert.equal((await memory.getFact('parent', child.id, fact.id))!.sourceState, 'changed');
  assert.equal((await memory.summary('parent', child.id))!.summary, null);
  assert.equal((await care.search('parent', child.id, {}))!.records[0].text, '昨晚約 100 ml');
  const history = await care.history('parent', child.id, record.id);
  assert.deepEqual(history!.revisions.map(value => value.version), [2, 1]);
  for (const saved of fake.records.values()) assert.equal(JSON.stringify(saved).includes('昨晚'), false);
});
