import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { FirestoreDomainData } from '../server/firestore-domain-data.ts';
import { createFirestorePrivateInstructions } from '../server/firestore-private-instructions.ts';
import { createFirestoreChatStore } from '../server/firestore-chat.ts';
import { createFirestoreCareStore } from '../server/firestore-care.ts';
import { createFirestoreMemoryStore } from '../server/firestore-memory.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirestoreAgentRuns } from '../server/firestore-agent-runs.ts';
import { createFirestoreAgentProposals } from '../server/firestore-agent-proposals.ts';
import { createFirestoreAgentActions } from '../server/firestore-agent-actions.ts';
import { createFirestoreRestoreCodec } from '../server/firestore-restore-codec.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import type { HandoverImportRow } from '../server/handover-import.ts';

test('imported private instructions use the existing notes, key index, deletion and restore paths without a fake agent run', async () => {
  const fixture = serialFirestoreFixture(), options = { database: fixture.database, cipher: createStorageCipher(Buffer.alloc(32, 96)),
    projectId: 'demo-instruction-import', namespace: 'unit_instruction_import' };
  const authority = createFirestoreAuthority(options), data = new FirestoreDomainData(options), notes = createFirestorePrivateInstructions(data);
  await authority.initializeControl({ enabled: true, generation: randomUUID() });
  await authority.issueInvitation({ email: 'parent@example.test', operationId: randomUUID(), expiresAt: new Date(Date.now() + 3600000).toISOString() });
  await authority.admitIdentity({ userId: 'parent', email: 'parent@example.test', emailVerified: true });
  await authority.acknowledge({ userId: 'parent', operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  const childId = (await authority.createChild({ userId: 'parent', operationId: randomUUID(), displayName: '孩子' })).child.id;
  const original = { id: randomUUID(), childId: randomUUID(), version: 3, title: '休息習慣', text: '活動前先休息',
    sourceMessageId: randomUUID(), provenance: 'user_statement' as const, memoryKey: 'rest', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-02-01T00:00:00Z' };
  const row: HandoverImportRow = { section: 'instructions', childId: original.childId, value: original,
    source: { serverId: 'https://source.test', accountId: 'source', packageId: randomUUID(), packageVersion: 1,
      manifestSha256: 'a'.repeat(64), path: 'data/1.json', rowIndex: 0 } };
  const imported = await authority.runTransaction('parent', childId, async b => {
    const prepared = await notes.prepareImported(b, randomUUID(), row, 'trusted'); prepared.commit(); return prepared.value;
  });
  assert.equal(imported.provenance, 'imported_source'); assert.equal(imported.sourceMessageId, null);
  assert.equal(imported.importedFrom?.current.source.sourceMessageId, original.sourceMessageId);
  const chat = createFirestoreChatStore(options), care = createFirestoreCareStore(options), memory = createFirestoreMemoryStore({ ...options, chat, care });
  const online = createFirestoreOnlineStore(options), runs = createFirestoreAgentRuns({ ...options, chat, memory });
  const actions = createFirestoreAgentActions({ runs, online, care, proposals: createFirestoreAgentProposals({ runs, chat, memory, online }) });
  assert.equal((await actions.notes('parent', childId))?.items[0]?.id, imported.id);
  assert.equal((await actions.notesByKeys!('parent', childId, ['rest'])).items[0]?.sourceMessageId, null);
  assert.equal((await actions.policy('parent', childId))?.allowPrivateNotes, false);
  await assert.rejects(authority.runTransaction('parent', childId, b => notes.prepareImported(b, randomUUID(), row, 'trusted')), { code: 'instruction_key_conflict' });
  await assert.rejects(authority.runTransaction('parent', childId, b => notes.prepareImported(b, randomUUID(), row, 'trusted',
    { id: imported.id, expectedVersion: imported.version + 1 })), { code: 'version_conflict' });
  const codec = createFirestoreRestoreCodec(options);
  for (const [path, record] of fixture.records) if (path.includes('_private_instructions/')) codec.decode({ path, data: record });
  const policy = await actions.savePolicy('parent', childId, { operationId: randomUUID(), expectedVersion: 0, recordKinds: [],
    allowPrivateNotes: true, allowRecordCorrections: false, allowSelfTasks: false, reminderConsentVersion: null, reminderBindings: [], confirm: true, confirmShared: false });
  assert.ok(policy);
  const message = await chat.createUserMessageForUser('parent', childId, '活動前先喝水'); assert.ok(message);
  const claim = await runs.claim('parent', childId, { kind: 'interactive', reference: message.id }, 'product-interactive');
  const corrected = await actions.execute(claim.scope, claim.runId, 'revise-imported', { kind: 'revise_private_note',
    noteId: imported.id, expectedVersion: imported.version, expectedPolicyVersion: policy.version,
    title: original.title, text: message.text, sourceQuote: message.text });
  assert.ok(corrected);
  const local = (await actions.notes('parent', childId))?.items[0]; assert.ok(local);
  assert.equal(local.sourceMessageId, message.id); assert.equal(local.provenance, 'user_statement');
  assert.equal(local.importedFrom?.current.source.sourceMessageId, original.sourceMessageId);
  const deletion = { operationId: randomUUID(), expectedVersion: corrected.resource.version, confirmDelete: true as const };
  assert.equal(await actions.deleteNote('parent', childId, imported.id, deletion), true);
  assert.equal(await actions.deleteNote('parent', childId, imported.id, deletion), true);
  assert.equal((await actions.notesByKeys!('parent', childId, ['rest'])).items.length, 0);
  assert.equal((await actions.notes('parent', childId))?.items.length, 0);
});
