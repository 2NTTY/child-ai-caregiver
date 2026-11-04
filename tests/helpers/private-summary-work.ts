import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { firestoreDomainFixture } from './firestore-domain-memory.ts';
import { createStorageCipher } from '../../server/storage-crypto.ts';
import { SERVICE_POLICY_VERSION } from '../../src/shared/account-service.ts';
import { createFirestoreAuthority } from '../../server/firestore-authority.ts';
import { createFirestoreOnlineStore } from '../../server/firestore-online.ts';
import { createFirestoreChatStore } from '../../server/firestore-chat.ts';
import { createFirestoreCareStore } from '../../server/firestore-care.ts';
import { createFirestoreMemoryStore } from '../../server/firestore-memory.ts';
import { summaryRevisionId, summaryManifestHash, type PrivateSummarySourceRevision } from '../../server/private-summary-work.ts';

export async function privateSummaryFixture(ownerUserId = 'owner') {
  const fake = firestoreDomainFixture(), options = { database: fake.database, cipher: createStorageCipher(Buffer.alloc(32, 47)),
    projectId: 'synthetic-summary-work', namespace: 'synthetic_summary_work' };
  const authority = createFirestoreAuthority(options), generation = randomUUID();
  await authority.initializeControl({ generation, enabled: true });
  await authority.issueInvitation({ email: 'owner@example.test', expiresAt: new Date(Date.now() + 60000).toISOString(), operationId: randomUUID() });
  await authority.admitIdentity({ userId: ownerUserId, email: 'owner@example.test', emailVerified: true });
  await authority.acknowledge({ userId: ownerUserId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  const online = createFirestoreOnlineStore(options);
  const context = await online.context(ownerUserId, { path: '/api/children', payload: { displayName: 'Synthetic child' } });
  const created = await online.submit(ownerUserId, { path: '/api/children', payload: { displayName: 'Synthetic child' },
    operation: { ...context, opId: randomUUID(), deviceId: randomUUID() } });
  const childId = (created.result as { child: { id: string } }).child.id;
  const chat = createFirestoreChatStore(options), care = createFirestoreCareStore(options), memory = createFirestoreMemoryStore({ ...options, chat, care });
  async function select(target: Parameters<typeof memory.selectSource>[1] = { kind: 'next_fresh' }) {
    const workId = randomUUID();
    return authority.runTransaction(ownerUserId, childId, async b => {
      const decision = await memory.selectSource(b, target);
      assert.equal(decision.kind, 'eligible');
      if (decision.kind !== 'eligible') throw new Error('Expected an authoritative complete source snapshot');
      const revision: PrivateSummarySourceRevision = { format: 'private-summary-source-revision/v1',
        id: summaryRevisionId(workId, 1), workId, sourceRevision: 1, scope: b.scope, authorizationVersion: b.authorizationVersion,
        workerGeneration: b.generation, manifest: decision.manifest, manifestHash: summaryManifestHash(decision.manifest),
        createdAt: new Date().toISOString() };
      return { decision, revision };
    });
  }
  const revalidate = (revision: PrivateSummarySourceRevision) => authority.runTransaction(ownerUserId, childId, b => memory.revalidateSource(b, revision));
  async function saveAll(text = 'Synthetic completed summary') {
    const input = (await memory.prepareSummary(ownerUserId, childId))!;
    return (await memory.saveSummary(ownerUserId, childId, { previousVersion: input.previousVersion, basis: input.basis,
      text, coveredMessageIds: input.messages.map(message => message.id) }))!;
  }
  return { fake, options, authority, generation, chat, care, memory, childId, select, revalidate, saveAll };
}

