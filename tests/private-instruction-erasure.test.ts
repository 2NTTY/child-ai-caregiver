import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { z } from 'zod';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAccountExport } from '../server/firestore-account-export.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { FirestoreDomainData } from '../server/firestore-domain-data.ts';
import { createFirestorePrivateInstructions } from '../server/firestore-private-instructions.ts';
import { createFirestoreChatStore } from '../server/firestore-chat.ts';
import { createFirestoreCareStore } from '../server/firestore-care.ts';
import { createFirestoreMemoryStore } from '../server/firestore-memory.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirestoreAgentRuns } from '../server/firestore-agent-runs.ts';
import { createFirestoreAgentProposals } from '../server/firestore-agent-proposals.ts';
import { createFirestoreAgentActions, firestoreAgentActionSavedSchema } from '../server/firestore-agent-actions.ts';
import { createFirestoreContentErasure, contentErasureSchema } from '../server/firestore-content-erasure.ts';
import { createFirebaseErasureJournal, firebaseErasureIntentHash } from '../server/firebase-erasure-journal.ts';
import type { FirebasePhotoBucketPort } from '../server/firebase-photo-objects.ts';
import { createFirestoreRestoreCodec } from '../server/firestore-restore-codec.ts';
import { replayContentErasures } from '../server/firestore-restore-content-erasure.ts';

test('private instruction deletion journals once and replays only the erased instruction and its own key', async () => {
  const fixture = serialFirestoreFixture(), options = { database: fixture.database, cipher: createStorageCipher(Buffer.alloc(32, 107)),
    projectId: 'synthetic-note-erasure', namespace: 'unit_note_erasure' };
  const authority = createFirestoreAuthority(options), data = new FirestoreDomainData(options), notes = createFirestorePrivateInstructions(data);
  await authority.initializeControl({ enabled: true, generation: randomUUID() });
  const children = new Map<string, string>();
  for (const userId of ['parent', 'other']) {
    const email = userId + '@example.test';
    await authority.issueInvitation({ email, operationId: randomUUID(), expiresAt: new Date(Date.now() + 60_000).toISOString() });
    await authority.admitIdentity({ userId, email, emailVerified: true });
    await authority.acknowledge({ userId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
    children.set(userId, (await authority.createChild({ userId, operationId: randomUUID(), displayName: 'Synthetic child' })).child.id);
  }
  const childId = children.get('parent')!, otherChildId = children.get('other')!;
  async function save(userId: string, id: string, key: string, text: string) {
    const childId = children.get(userId)!, at = '2026-11-01T00:00:00.000Z';
    const value = { id, childId, version: 1, title: 'Same instruction title', text, memoryKey: key,
      sourceMessageId: randomUUID(), provenance: 'user_statement' as const, createdAt: at, updatedAt: at };
    await authority.runTransaction(userId, childId, async b => { const prepared = await notes.prepareWrite(b, randomUUID(), value, null); prepared.commit(); });
    return value;
  }
  const erased = await save('parent', randomUUID(), 'rest', 'ERASED_INSTRUCTION_SECRET');
  const other = await save('other', randomUUID(), 'rest', 'OTHER_OWNER_RETAINED');
  const chat = createFirestoreChatStore(options), care = createFirestoreCareStore(options), memory = createFirestoreMemoryStore({ ...options, chat, care });
  const online = createFirestoreOnlineStore(options), runs = createFirestoreAgentRuns({ ...options, chat, memory });
  const actions = createFirestoreAgentActions({ runs, online, care, proposals: createFirestoreAgentProposals({ runs, chat, memory, online }) });
  // A real codec-valid index entry in another domain can have the same target UUID.
  const factKey = await authority.runTransaction('parent', childId, async b => {
    const id = JSON.stringify(['parent', childId, 'facts', 'private', 'rest']);
    b.transaction.create(data.ref('memory_keys', 'memory-key', id), { ...data.tags(b.scope),
      ...data.seal('memory-key', id, b.scope, z.object({ id: z.uuid() }).strict(), { id: erased.id }) });
    return id;
  });
  const receiptId = randomUUID(), runId = randomUUID();
  await authority.runTransaction('parent', childId, async b => {
    const saved = firestoreAgentActionSavedSchema.parse({ receipt: { id: receiptId, runId, kind: 'save_private_note',
      resource: { kind: 'private_note', id: erased.id, version: erased.version }, state: 'saved', notification: 'not_authorized',
      channels: [], createdAt: erased.createdAt, sourceBasis: 'voice_interpretation' }, hash: 'a'.repeat(64),
      sourceMessageId: erased.sourceMessageId, sourceMessageIds: [erased.sourceMessageId], policyVersion: 1,
      voiceEvidence: { kind: 'voice_interpretation', voiceId: randomUUID(), voiceVersion: 1, sha256: 'b'.repeat(64),
        sourceMessageId: erased.sourceMessageId, interpretedQuote: 'ERASED_VOICE_QUOTE' } });
    b.transaction.create(data.ref('agent_action_receipts', 'agent-action-receipt', receiptId), { ...data.tags(b.scope),
      receiptId, runId, createdAt: erased.createdAt, ...data.seal('agent-action-receipt', receiptId, b.scope, firestoreAgentActionSavedSchema, saved) });
  });
  const codec = createFirestoreRestoreCodec(options);
  const snapshot = () => [...fixture.records].filter(([path]) => path.startsWith(options.namespace + '_private_instructions/')
    || path.startsWith(options.namespace + '_memory_keys/') || path.startsWith(options.namespace + '_agent_action_receipts/'))
    .map(([path, record]) => codec.decode({ path, data: structuredClone(record) }));
  const backup = snapshot();
  const v1Database = [...fixture.records].map(([path, record]) => ({ path, data: structuredClone(record) }));
  const higherNote = { ...erased, version: 2, text: 'ERASED_OLD_EPOCH_V2_NOTE', updatedAt: '2026-11-02T00:00:00.000Z' };
  await authority.runTransaction('parent', childId, async b => {
    const prepared = await notes.prepareWrite(b, randomUUID(), higherNote, erased);
    const original = firestoreAgentActionSavedSchema.parse(backup.find(row => row.context.kind === 'agent-action-receipt')!.value);
    const receipt = firestoreAgentActionSavedSchema.parse({ ...original,
      receipt: { ...original.receipt, resource: { ...original.receipt.resource, version: higherNote.version } },
      voiceEvidence: { ...original.voiceEvidence, interpretedQuote: 'ERASED_OLD_EPOCH_V2_QUOTE' } });
    prepared.commit();
    b.transaction.set(data.ref('agent_action_receipts', 'agent-action-receipt', receiptId), { ...data.tags(b.scope), receiptId, runId,
      createdAt: erased.createdAt, ...data.seal('agent-action-receipt', receiptId, b.scope, firestoreAgentActionSavedSchema, receipt) });
  });
  const higherBackup = snapshot();
  // Apply the real codec's v1 restore/rebinding in the isolated fixture; retain its enabled operator control.
  const newEpochByWorkspace = new Map(v1Database.map(row => codec.decode(row)).flatMap(row => row.context.family !== 'knowledge'
    && row.context.scope.workspaceId !== '00000000-0000-0000-0000-000000000000' ? [[row.context.scope.workspaceId, randomUUID()] as const] : []));
  const transform = { newEpochByWorkspace, generation: randomUUID(), photoDescriptors: new Map() };
  const restoredV1 = v1Database.map(row => {
    const decoded = codec.decode(row);
    return decoded.context.kind === 'control' ? row : codec.transform(decoded, transform);
  });
  fixture.records.clear();
  for (const row of restoredV1) fixture.records.set(row.path, row.data);
  assert.equal((await actions.notes('parent', childId))?.items[0]?.version, 1);
  const deletion = { operationId: randomUUID(), expectedVersion: erased.version, confirmDelete: true as const };
  assert.equal(await actions.deleteNote('parent', childId, erased.id, deletion), true);
  assert.equal(await actions.deleteNote('parent', childId, erased.id, deletion), true);
  const exporter = createFirestoreAccountExport({ ...options, photos: { async content() { throw Error('Unexpected attachment read'); } } });
  const page = await exporter.page('parent', { section: 'agent_receipts', childId });
  const exported = firestoreAgentActionSavedSchema.parse(page.items[0]);
  assert.equal(exported.receipt.id, receiptId); assert.equal(exported.voiceEvidence, undefined);
  const jobs = (await data.collection('content_erasures').get()).docs;
  assert.equal(jobs.length, 1, 'A permanent private-instruction deletion needs one durable independent-journal obligation, including exact-op replay');
  const job = jobs[0]!, intent = contentErasureSchema.parse(codec.decode({ path: job.ref.path, data: job.data()! }).value).intent;
  assert.equal(intent.assetId, erased.id);
  assert.equal(intent.content?.kind, 'private_instruction');
  assert.equal(intent.content?.throughVersion, erased.version);
  assert.equal('sourceOperationId' in intent.content! && intent.content.sourceOperationId, deletion.operationId);
  // Reusing the title/key creates another identity, not a resurrection of the old note.
  const replacement = await save('parent', randomUUID(), 'rest', 'SAME_TITLE_NEW_ID_RETAINED');
  const manualId = JSON.stringify(['parent', deletion.operationId]);
  const manualSnapshot = await data.ref('agent_manual_operations', 'agent-manual-operation', manualId).get();
  const originalManual = codec.decode({ path: manualSnapshot.ref.path, data: manualSnapshot.data()! });
  const legacyLive = [...snapshot(), originalManual];
  assert.throws(() => replayContentErasures(data, codec, structuredClone(backup), legacyLive, [], new Map()),
    { code: 'restore_instruction_legacy_delete_unresolved' }, 'A legacy boolean/hash deletion receipt cannot prove which absent instruction may be restored');
  const existingOnly = legacyLive.filter(row => row.context.kind === 'private-instruction');
  assert.doesNotThrow(() => replayContentErasures(data, codec, structuredClone(existingOnly), legacyLive, [], new Map()),
    'A legacy receipt does not block instructions that still exist in the same live scope');

  const newRows = snapshot().filter(row => row.context.id === replacement.id
    || row.context.kind === 'memory-key' && 'id' in row.value && row.value.id === replacement.id);
  const restoreRows = [...backup, ...newRows.filter(row => !backup.some(old => old.path === row.path))];
  const live = () => jobs.map(row => codec.decode({ path: row.ref.path, data: fixture.records.get(row.ref.path) }));
  assert.throws(() => replayContentErasures(data, codec, structuredClone(restoreRows), live(), [], new Map()),
    { code: 'restore_content_journal_pending' }, 'A business backup cannot substitute for the independent deletion journal');

  const stored = new Map<string, { ciphertext: Buffer; metadata: Record<string, unknown> }>();
  const bucketName = 'independent-instruction-erasure-journal';
  const bucket: FirebasePhotoBucketPort = {
    async writeNew(name, bytes, writeOptions) {
      if (stored.has(name)) throw Object.assign(new Error('Already journaled'), { code: 412 });
      const metadata = { name, bucket: bucketName, generation: '1', size: String(bytes.length), metadata: writeOptions.metadata!.metadata };
      stored.set(name, { ciphertext: Buffer.from(bytes), metadata }); return metadata;
    },
    async metadata(name) {
      const value = stored.get(name); if (!value) throw Object.assign(new Error('Missing journal'), { code: 404 }); return structuredClone(value.metadata);
    },
    readPinned(name, generation) {
      let sent = false;
      return new Readable({ read() { if (sent) return; sent = true;
        this.emit('response', { statusCode: 206, headers: { 'x-goog-generation': generation } });
        this.push(stored.get(name)!.ciphertext); this.push(null);
      } });
    },
  };
  const journal = createFirebaseErasureJournal({ config: { projectId: options.projectId, namespace: options.namespace, bucketName },
    cipher: createStorageCipher(Buffer.alloc(32, 108)), bucket });
  const worker = createFirestoreContentErasure({ ...options, journal });
  for (let page = 0; page < 8; page++) {
    const current = await options.database.runTransaction(tx => tx.get(job.ref));
    if (contentErasureSchema.parse(codec.decode({ path: current.ref.path, data: current.data()! }).value).stage === 'done') break;
    await worker.advance(current);
  }
  const completed = contentErasureSchema.parse(live()[0]!.value);
  assert.equal(completed.stage, 'done'); assert.ok(completed.journal);
  assert.equal(stored.size, 1);
  const descriptor = await journal.writeOnce(intent);
  assert.equal(stored.size, 1, 'Independent journal retries reuse the same immutable object');
  const checked = await journal.read(intent, descriptor);
  const descriptors = new Map([[firebaseErasureIntentHash(checked), descriptor]]);
  const removed = replayContentErasures(data, codec, restoreRows, live(), [checked], new Map(), descriptors);
  const retained = restoreRows.filter(row => !removed.has(row.path));
  const replantedManual = retained.find(row => row.context.kind === 'agent-manual-operation' && row.context.id === manualId);
  assert.ok(replantedManual, 'Restore replants the successful exact-op receipt rather than changing a retry into null');
  assert.deepEqual(replantedManual.value, originalManual.value);
  assert.equal('result' in replantedManual.value && replantedManual.value.result, true);
  assert.equal(JSON.stringify(replantedManual.value).includes(erased.text), false);
  assert.equal(retained.some(row => row.context.kind === 'private-instruction' && row.context.id === erased.id), false);
  assert.equal(retained.some(row => row.context.kind === 'memory-key' && 'id' in row.value && row.value.id === erased.id
    && row.context.id === JSON.stringify(['parent', childId, 'instructions', 'private', 'rest'])), false);
  assert.equal(retained.some(row => row.context.kind === 'memory-key' && row.context.id === factKey), true);
  assert.equal(retained.some(row => row.context.kind === 'private-instruction' && row.context.id === other.id), true);
  assert.equal(retained.some(row => row.context.kind === 'private-instruction' && row.context.id === replacement.id), true);
  assert.equal(JSON.stringify(retained).includes(erased.text), false);
  const restoredReceipt = firestoreAgentActionSavedSchema.parse(retained.find(row => row.context.kind === 'agent-action-receipt')!.value);
  assert.equal(restoredReceipt.receipt.id, receiptId); assert.equal(restoredReceipt.voiceEvidence, undefined);
  const liveReceipt = await data.ref('agent_action_receipts', 'agent-action-receipt', receiptId).get();
  assert.equal(firestoreAgentActionSavedSchema.parse(codec.decode({ path: liveReceipt.ref.path, data: liveReceipt.data()! }).value).voiceEvidence, undefined);
  const newerKeyRows = [...new Map([...backup, ...newRows].map(row => [row.path, row])).values()];
  const removedWithNewKey = replayContentErasures(data, codec, newerKeyRows, live(), [checked], new Map(), descriptors);
  assert.equal(newerKeyRows.some(row => !removedWithNewKey.has(row.path) && row.context.kind === 'memory-key'
    && row.context.id === JSON.stringify(['parent', childId, 'instructions', 'private', 'rest'])
    && 'id' in row.value && row.value.id === replacement.id), true, 'An old deletion never removes a key rebound to a new instruction ID');
  assert.equal(await actions.deleteNote('parent', childId, erased.id, deletion), true);
  assert.equal((await actions.notes('parent', childId))?.items[0]?.id, replacement.id);
  assert.equal((await actions.notes('other', otherChildId))?.items[0]?.id, other.id);
  const oldEpochNote = higherBackup.find(row => row.context.kind === 'private-instruction' && row.context.id === erased.id)!;
  assert.ok(oldEpochNote.context.family !== 'knowledge' && oldEpochNote.context.scope.storageEpoch !== intent.scope.storageEpoch);
  const higherRows = [...higherBackup, ...newRows.filter(row => !higherBackup.some(old => old.path === row.path))];
  const removedHigher = replayContentErasures(data, codec, higherRows, live(), [checked], new Map(), descriptors);
  const retainedHigher = higherRows.filter(row => !removedHigher.has(row.path));
  assert.equal(retainedHigher.some(row => row.context.kind === 'private-instruction' && row.context.id === erased.id), false,
    'A permanently retired ID cannot return from an older epoch backup even when its note version is higher');
  assert.equal(retainedHigher.some(row => row.context.kind === 'memory-key'
    && row.context.id === JSON.stringify(['parent', childId, 'instructions', 'private', 'rest'])), false);
  const higherReceipt = firestoreAgentActionSavedSchema.parse(retainedHigher.find(row => row.context.kind === 'agent-action-receipt')!.value);
  assert.equal(higherReceipt.receipt.id, receiptId); assert.equal(higherReceipt.voiceEvidence, undefined);
  assert.equal(JSON.stringify(retainedHigher).includes(higherNote.text), false);
  assert.equal(JSON.stringify(retainedHigher).includes('ERASED_OLD_EPOCH_V2_QUOTE'), false);
  assert.equal(retainedHigher.some(row => row.context.kind === 'private-instruction' && row.context.id === replacement.id), true);
});
