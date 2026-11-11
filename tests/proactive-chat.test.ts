import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreChatStore } from '../server/firestore-chat.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';

test('a lost acknowledgement preserves one original proactive message and one outbox receipt', async () => {
  const fake = firestoreDomainFixture();
  const options = { database: fake.database, cipher: createStorageCipher(Buffer.alloc(32, 59)), projectId: 'demo-notice', namespace: 'notice' };
  const authority = createFirestoreAuthority(options);
  await authority.initializeControl({ generation: randomUUID(), enabled: true });
  const user = 'parent', email = 'parent@example.test';
  await authority.issueInvitation({ email, expiresAt: new Date(Date.now() + 60000).toISOString(), operationId: randomUUID() });
  await authority.admitIdentity({ userId: user, email, emailVerified: true });
  await authority.acknowledge({ userId: user, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  const online = createFirestoreOnlineStore(options), path = '/api/children', payload = { displayName: 'Demo' };
  const created = await online.submit(user, { path, payload, operation: { ...await online.context(user, { path, payload }), opId: randomUUID(), deviceId: randomUUID() } });
  const childId = (created.result as { child: {id: string} }).child.id;
  const delivery = randomUUID(), opId = randomUUID(), text = 'A new message from the assistant.';
  let commits = 0;
  const chat = createFirestoreChatStore({ ...options, notifications: {
    async prepareChatDeliveries() { return { ids: [delivery], commit() { commits++; } }; },
  } });
  const publish = (body = text) => authority.runTransaction(user, childId, b =>
    chat.contactParent(b, { opId, origin: 'demo', text: body }));
  fake.loseReply();
  await assert.rejects(publish(), /lost commit acknowledgement/);
  const receipt = await publish();
  assert.equal(commits, 1);
  assert.deepEqual(receipt.deliveryIds, [delivery]);
  const page = await chat.listForUser(user, childId);
  assert.deepEqual(page!.messages.map(m => [m.id, m.text, m.inReplyTo, m.proactive]), [[receipt.messageId, text, null, true]]);
  assert.equal(JSON.stringify(page).includes(delivery), false);
  await assert.rejects(publish('different content'), /./);
  await assert.rejects(chat.listForUser('another-parent', childId));
});
