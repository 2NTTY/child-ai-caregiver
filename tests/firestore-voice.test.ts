import { createFirebaseRequestHandler } from '../server/firebase-app.ts';
import type { FirebaseAuthPort } from '../server/firebase-auth.ts';
import { createVoiceApi } from '../src/client/voice-api.ts';
import { firebaseErasureIntentHash, type FirebaseErasureJournal, type FirebaseErasureIntent } from '../server/firebase-erasure-journal.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirestoreChatStore } from '../server/firestore-chat.ts';
import { createFirestoreVoiceStore } from '../server/firestore-voice.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { VoiceFileError } from '../server/voice-files.ts';
import type { VoiceObjects, VoiceObjectDescriptor } from '../server/firebase-voice-objects.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';

test('voice upload and original chat operation keep one authorized attachment across uncertain replies', async () => {
  const fake = firestoreDomainFixture(), options = { database: fake.database, cipher: createStorageCipher(Buffer.alloc(32, 39)),
    projectId: 'synthetic-voice-project', namespace: 'voice_lifecycle' };
  const authority = createFirestoreAuthority(options);
  await authority.initializeControl({ generation: randomUUID(), enabled: true });
  for (const userId of ['parent', 'other']) {
    const email = userId + '@example.test';
    await authority.issueInvitation({ email, expiresAt: new Date(Date.now() + 60_000).toISOString(), operationId: randomUUID() });
    await authority.admitIdentity({ userId, email, emailVerified: true });
    await authority.acknowledge({ userId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  }
  const bytes = Buffer.from('synthetic voice bytes; media validity has its separate parser check');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const stored = new Map<string, VoiceObjectDescriptor>();
  let failValidation = true, loseObjectReply = true, writes = 0;
  const objects: VoiceObjects = {
    address(scope, id) { return 'voice/v1/' + createHash('sha256').update(JSON.stringify(scope)).digest('hex') + '/' + id; },
    async write(scope, id) {
      if (failValidation) { failValidation = false; throw new VoiceFileError('invalid_voice'); }
      const objectName = this.address(scope, id);
      assert.equal(stored.has(objectName), false, 'No repeated object upload'); writes++;
      const descriptor: VoiceObjectDescriptor = { objectName, generation: '9007199254740993123', cipherSha256: 'b'.repeat(64),
        sha256, bytes: bytes.length, mimeType: 'audio/wav', durationMs: 1000 };
      stored.set(objectName, descriptor);
      if (loseObjectReply) { loseObjectReply = false; throw new Error('lost object reply'); }
      return descriptor;
    },
    async inspect(scope, id) { return stored.get(this.address(scope, id)) ?? null; },
    async read(scope, id, descriptor) {
      assert.deepEqual(stored.get(this.address(scope, id)), descriptor);
      return { descriptor, buffer: bytes, base64: bytes.toString('base64') };
    },
    async remove(scope, id) { stored.delete(this.address(scope, id)); },
  };
  const intents = new Map<string, FirebaseErasureIntent>();
  const journal: Pick<FirebaseErasureJournal, 'writeOnce' | 'read'> = {
    async writeOnce(intent) {
      const hash = firebaseErasureIntentHash(intent); intents.set(hash, intent);
      return { objectName: 'erasures/v1/' + hash, generation: '1', cipherSha256: 'c'.repeat(64), intentSha256: hash, bytes: 1, format: 'yuban-erasure-journal/v1' };
    },
    async read(intent, proof) { assert.deepEqual(intents.get(proof.intentSha256), intent); return intent; },
  };
  const voice = createFirestoreVoiceStore({ ...options, objects, journal });
  const chat = createFirestoreChatStore({ ...options, voice });
  const online = createFirestoreOnlineStore({ ...options, mutations: [chat.mutation] });
  const origin = 'https://voice.example.test'; let sessionUser: string | null = 'parent', requests = 0;
  const handler = createFirebaseRequestHandler({ authority, online, chat, voice, publicOrigin: origin, mailConfigured: false,
    auth: { getSession: async () => sessionUser ? { user: { id: sessionUser } } : null,
      handler: async () => new Response(null, { status: 404 }) } as unknown as FirebaseAuthPort });
  const client = createVoiceApi(async (url, init) => {
    requests++; assert.ok(requests <= 12);
    return handler(new Request(url, { ...init, headers: { ...init?.headers, origin } }));
  }, origin);
  const signal = new AbortController().signal;
  const command = async (path: string, payload: unknown) => ({ path, payload,
    operation: { ...await online.context('parent', { path, payload }), opId: randomUUID(), deviceId: randomUUID() } });
  const created = await online.submit('parent', await command('/api/children', { displayName: '合成語音孩子' }));
  const childId = (created.result as any).child.id, id = randomUUID();
  const input = { opId: id, fileName: 'recording.wav', bytes: bytes.length, sha256, mimeType: 'audio/wav' as const };
  const reserved = await client.reserve(childId, input, signal, 'parent');
  assert.deepEqual(await voice.reserve('parent', childId, input), reserved);
  await assert.rejects(voice.reserve('parent', childId, { ...input, fileName: 'other.wav' }), (e: any) => e.code === 'operation_conflict');
  await assert.rejects(voice.upload('parent', childId, id, reserved.version, bytes.toString('base64')), (e: any) => e.code === 'invalid_voice');
  const retryable = await voice.get('parent', childId, id);
  assert.equal(retryable.state, 'reserved'); assert.equal(writes, 0);
  await assert.rejects(voice.upload('parent', childId, id, retryable.version, bytes.toString('base64')), (e: any) => e.code === 'voice_upload_unknown');
  assert.equal((await voice.get('parent', childId, id)).state, 'unknown');
  const ready = await client.resolve(childId, id, signal, 'parent');
  assert.equal(ready.state, 'ready'); assert.equal(writes, 1);
  assert.deepEqual(await voice.upload('parent', childId, id, retryable.version, bytes.toString('base64')), ready);
  await assert.rejects(voice.content('other', childId, id));
  const path = '/api/children/' + childId + '/messages';
  const submission = await command(path, { text: '', voice: { id, expectedVersion: ready.version } });
  fake.loseReply();
  await assert.rejects(online.submit('parent', submission), /lost commit acknowledgement/);
  const original = await online.submit('parent', submission);
  const message = (original.result as any).message;
  assert.equal(message.voice.id, id); assert.equal(message.voice.sha256, sha256); assert.equal(message.text, '');
  const reconnectedVoice = createFirestoreVoiceStore({ ...options, objects, journal });
  const reconnectedChat = createFirestoreChatStore({ ...options, voice: reconnectedVoice });
  assert.equal((await reconnectedVoice.get('parent', childId, id)).messageId, message.id);
  assert.deepEqual((await reconnectedChat.listForUser('parent', childId))!.messages, [message]);
  assert.equal((await reconnectedVoice.content('parent', childId, id)).base64, bytes.toString('base64'));
  assert.deepEqual(Buffer.from((await client.content(ready, signal, 'parent')).bytes), bytes);
  sessionUser = 'other'; await assert.rejects(client.get(childId, id, signal, 'parent'), (e: any) => e.status === 409);
  sessionUser = null; await assert.rejects(client.get(childId, id, signal, 'parent'), (e: any) => e.status === 401);
  sessionUser = 'parent';
  await assert.rejects(online.submit('parent', await command(path, { text: '不能重複綁定', voice: { id, expectedVersion: ready.version } })),
    (e: any) => e.code === 'voice_not_available');
  assert.equal(writes, 1);
  const current = await voice.get('parent', childId, id), deleteOp = randomUUID();
  assert.equal((await client.delete(current, deleteOp, signal, 'parent')).deleted, true);
  await assert.rejects(voice.content('parent', childId, id), (e: any) => e.code === 'voice_deleted');
  assert.equal((await voice.reserve('parent', childId, input)).fileName, null);
  assert.equal((await voice.delete('parent', childId, id, current.version, deleteOp)).deleted, true);
  const scope = await authority.runTransaction('parent', childId, async b => b.scope);
  assert.equal((await voice.cleanupDeleted(scope, id)).state, 'complete'); assert.equal(stored.size, 0);
  assert.equal((await voice.delete('parent', childId, id, current.version, deleteOp)).cleanupPending, false);
});
