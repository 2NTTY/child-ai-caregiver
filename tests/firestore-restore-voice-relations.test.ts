import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { FirestoreDomainData } from '../server/firestore-domain-data.ts';
import { createFirestoreRestoreCodec } from '../server/firestore-restore-codec.ts';
import { firestoreVoiceRowSchema } from '../server/firestore-voice.ts';
import { firestoreVoiceTranscriptSchema } from '../server/firestore-voice-transcripts.ts';
import { firestoreChatMessageSchema } from '../server/firestore-chat.ts';
import { voiceObjectAddress } from '../server/firebase-voice-objects.ts';
import { assertRestoredVoiceRelations } from '../server/firestore-restore-voice.ts';

test('restore keeps imported unlinked transcripts fail-closed and accepts the matching local message', () => {
  const fake = firestoreDomainFixture();
  const options = { database: fake.database, cipher: createStorageCipher(Buffer.alloc(32, 91)),
    projectId: 'synthetic-voice-relations', namespace: 'unit_voice_relations' };
  const data = new FirestoreDomainData(options), codec = createFirestoreRestoreCodec(options);
  const at = '2026-11-03T00:00:00.000Z', id = randomUUID(), sourceMessageId = randomUUID();
  const scope = { ownerUserId: 'synthetic-owner', workspaceId: randomUUID(), childId: randomUUID(), storageEpoch: randomUUID() };
  const stage = { batchId: randomUUID(), operationId: randomUUID(), actorUserId: scope.ownerUserId, sourceHash: 'c'.repeat(64) };
  const provenance = { current: { source: { serverId: 'synthetic-source', accountId: 'source-owner', childId: randomUUID(),
    section: 'voices', resourceId: randomUUID(), resourceVersion: 3, authorUserId: null, createdAt: at,
    confirmedBy: null, confirmedAt: null, confirmationBasis: null, assigneeUserId: null },
    sourceHash: stage.sourceHash, packageId: randomUUID(), packageVersion: 1, manifestSha256: 'd'.repeat(64),
    integrity: 'trusted', importedBy: scope.ownerUserId, importedAt: at }, previous: [] };
  const descriptor = { objectName: voiceObjectAddress({ ...options, bucketName: 'synthetic-voices' }, scope, id).objectName,
    generation: '1', cipherSha256: 'a'.repeat(64), sha256: 'b'.repeat(64), bytes: 44, mimeType: 'audio/wav', durationMs: 1000 };
  const voice = firestoreVoiceRowSchema.parse({ id, scope, objectScope: scope, version: 3, createdAt: at, updatedAt: at,
    fingerprint: 'e'.repeat(64), metadata: { fileName: 'synthetic.wav', mimeType: descriptor.mimeType,
      bytes: descriptor.bytes, sha256: descriptor.sha256 }, state: 'ready', upload: null, descriptor, messageId: null,
    importStage: stage, importedFrom: provenance, deletion: null });
  const reference = { id, version: 3, sha256: descriptor.sha256, bytes: descriptor.bytes,
    mimeType: descriptor.mimeType, durationMs: descriptor.durationMs };
  const transcript = firestoreVoiceTranscriptSchema.parse({ scope, value: { voice: reference, messageId: null,
    version: 1, state: 'available', automatic: true, updatedAt: at, reason: null, retryAt: null,
    content: { complete: true, segments: [{ text: 'Synthetic retained transcript', startMs: 0, endMs: 1000, unclear: false }] },
    importedFrom: provenance,
    origin: { messageId: sourceMessageId, version: 2, state: 'available', reason: null } },
    attempt: null, modelAttempted: true, quotaDeferrals: 0 });
  function record<T>(suffix: string, kind: string, recordId: string, schema: z.ZodType<T>, value: T, version: number) {
    return codec.decode({ path: data.ref(suffix, kind, recordId).path,
      data: { ...(kind === 'chat-message' ? { sortKey: '0000000000000000001' } : {}),
        ...data.seal(kind, recordId, scope, schema, value, version) } });
  }
  const voiceRecord = (value: typeof voice) => record('voice_assets', 'voice-asset', id, firestoreVoiceRowSchema, value, value.version);
  const transcriptRecord = (value: typeof transcript) => record('voice_transcripts', 'voice-transcript', id,
    firestoreVoiceTranscriptSchema, value, value.value.version);
  // Existing unsupported case: this type-only correction must not silently admit it.
  assert.throws(() => assertRestoredVoiceRelations([voiceRecord(voice), transcriptRecord(transcript)]),
    { code: 'restore_voice_binding', status: 409 });
  const messageId = randomUUID();
  const message = firestoreChatMessageSchema.parse({ id: messageId, childId: scope.childId, authorUserId: scope.ownerUserId,
    role: 'user', text: '', inReplyTo: null, createdAt: at, voice: reference });
  assert.doesNotThrow(() => assertRestoredVoiceRelations([
    voiceRecord({ ...voice, messageId }), transcriptRecord({ ...transcript, value: { ...transcript.value, messageId } }),
    record('chat_messages', 'chat-message', messageId, firestoreChatMessageSchema, message, 1),
  ]));
});
