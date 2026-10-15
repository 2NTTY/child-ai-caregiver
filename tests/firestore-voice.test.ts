import { FirestoreSessionService } from '../server/firestore-session-service.ts';
import { createFirestoreAccountExport } from '../server/firestore-account-export.ts';
import { createFirestoreVoiceTranscripts } from '../server/firestore-voice-transcripts.ts';
import { createFirestoreBackgroundQueue, type FirestoreBackgroundDelivery } from '../server/firestore-background-work.ts';
import type { Firestore } from '@google-cloud/firestore';
import { FinishReason } from '@google/genai';
import { createFirestoreCareStore } from '../server/firestore-care.ts';
import { createFirestoreMemoryStore } from '../server/firestore-memory.ts';
import { createFirestoreProductAgent } from '../server/firestore-product-agent.ts';
import { readAiConfig } from '../server/ai-config.ts';
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

test('voice upload and original chat operation keep one authorized attachment across uncertain replies', async t => {
  const fake = firestoreDomainFixture();
  function query(raw: any): any { return new Proxy(raw, { get(target, key) {
    if (key === 'id') return target.path.split('/').at(-1);
    if (key === 'get') return () => fake.database.runTransaction(tx => tx.get(target));
    const value = target[key]; return typeof value === 'function' ? (...args: any[]) => {
      const result = value(...args); return result?.path ? query(result) : result;
    } : value;
  } }); }
  const database = { ...fake.database, collection: (path: string) => query(fake.database.collection(path)) } as Firestore;
  const options = { database, cipher: createStorageCipher(Buffer.alloc(32, 39)),
    projectId: 'synthetic-voice-project', namespace: 'voice_lifecycle' };
  const authority = createFirestoreAuthority(options);
  await authority.initializeControl({ generation: randomUUID(), enabled: true });
  for (const userId of ['parent', 'other']) {
    const email = userId + '@example.test';
    await authority.issueInvitation({ email, expiresAt: new Date(Date.now() + 60_000).toISOString(), operationId: randomUUID() });
    await authority.admitIdentity({ userId, email, emailVerified: true });
    await authority.acknowledge({ userId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  }
  const bytes = Buffer.alloc(1024 * 1024, 7) // Larger than an ADK Firestore event; codec validity has its separate media check.
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
  const sessions=new FirestoreSessionService({...options,namespace:options.namespace+'_adk'});
  const voice = createFirestoreVoiceStore({ ...options, objects, journal,
    eraseTranscriptionRun:(userId,sessionId)=>sessions.deleteSession({appName:'yuban_hk',userId,sessionId}) });
  const transcripts = createFirestoreVoiceTranscripts({ ...options, voices: voice });
  const chat = createFirestoreChatStore({ ...options, voice });
  const online = createFirestoreOnlineStore({ ...options, mutations: [chat.mutation] });
  const origin = 'https://voice.example.test'; let sessionUser: string | null = 'parent', requests = 0;
  const handler = createFirebaseRequestHandler({ authority, online, chat, voice: { ...voice, transcripts }, publicOrigin: origin, mailConfigured: false,
    auth: { getSession: async () => sessionUser ? { user: { id: sessionUser } } : null,
      handler: async () => new Response(null, { status: 404 }) } as unknown as FirebaseAuthPort });
  const client = createVoiceApi(async (url, init) => {
    requests++; assert.ok(requests <= 14);
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
  const care = createFirestoreCareStore(options), memory = createFirestoreMemoryStore({ ...options, chat, care });
  let modelCalls = 0, providerFailure: unknown, transcription = false;
  const product = await createFirestoreProductAgent({ ...options, chat, care, memory, online, voices: voice,
    config: readAiConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: options.projectId }),
    platformProvider: { async generate(request) { try {
      modelCalls++; assert.ok(modelCalls <= 5);
      const audio = request.contents.flatMap(content => content.parts ?? []).filter(part => part.inlineData);
      assert.equal(audio.length, 1); assert.equal(audio[0].inlineData!.data, bytes.toString('base64'));
      if (transcription) {
        const declarations = request.config?.tools?.flatMap(tool => 'functionDeclarations' in tool ? tool.functionDeclarations ?? [] : []) ?? [];
        assert.deepEqual(declarations.map(tool => tool.name), ['stage_voice_transcript']);
        return { content: { role: 'model', parts: [{ functionCall: { id: 'transcribe-once', name: 'stage_voice_transcript',
          args: { complete: true, segments: [{ text: '記得我習慣先準備手冊', startMs: 0, endMs: 1000, unclear: false }] } } }] }, finishReason: FinishReason.STOP };
      }
      const functionCall = modelCalls === 1 ? { id: 'load-private', name: 'load_capabilities', args: { capabilities: ['private_instructions'] } }
        : modelCalls === 2 ? { id: 'save-voice-note', name: 'save_private_instruction', args: {
          sourceBasis: 'voice_interpretation', sourceQuote: '記得我習慣先準備手冊', expectedPolicyVersion: 1,
          title: '準備手冊', text: '使用前先準備手冊。', memoryKey: 'prepare-handbook' } }
        : modelCalls === 3 ? { id: 'present-voice-result', name: 'present_answer', args: {
          kind: 'operation', paragraphs: [{ text: '已記下先準備手冊的交代。', citationIds: [] }] } } : null;
      return { content: { role: 'model', parts: functionCall ? [{ functionCall }] : [{ text: 'done' }] }, finishReason: FinishReason.STOP };
    } catch (error) { providerFailure = error; throw error; } } } });
  await product.actions.savePolicy('parent', childId, { operationId: randomUUID(), expectedVersion: 0, recordKinds: [],
    allowPrivateNotes: true, allowSelfTasks: false, allowRecordCorrections: false, reminderConsentVersion: null,
    reminderBindings: [], confirm: true, confirmShared: false });
  const result = await product.agent.reply('parent', childId, message.id, async () => true);
  if (providerFailure) throw providerFailure;
  assert.equal(result?.status, 'completed', JSON.stringify(result));
  const receipts = await product.actions.receipts('parent', childId, result!.runId);
  assert.equal(receipts?.length, 1); assert.equal(receipts![0].sourceBasis, 'voice_interpretation');
  const evidence = await authority.runTransaction('parent', childId, b => product.actions.readReceipts(b, result!.runId));
  assert.equal(evidence[0].voiceEvidence?.sha256, sha256);
  assert.equal((await chat.listForUser('parent', childId))!.messages.find(row => row.id === message.id)?.text, '');
  // A resumed request returns the original run; neither the voice command nor its model repeats.
  const before = modelCalls; assert.equal((await product.agent.reply('parent', childId, message.id, async () => true))?.runId, result!.runId);
  assert.equal(modelCalls, before);
  // The queued maintenance uses the production runtime, a canonical worker lease and one read-only-purpose tool.
  assert.equal((await client.transcript(childId, id, signal, 'parent')).state, 'pending');
  const deliveries: FirestoreBackgroundDelivery[] = [];
  const queue = createFirestoreBackgroundQueue({ ...options, enabled: true, readControl: tx => authority.readControl(tx),
    transport: { async enqueue(job) { deliveries.push(job); return { state: 'confirmed' }; }, async probe() { return { state: 'confirmed' }; } },
    execute: (job, abort) => job.kind === 'voice-transcription' ? product.transcribeVoice!(job, async () => true, abort) : Promise.resolve({ state: 'stopped' }) });
  await queue.dispatch();
  const scheduled = deliveries.find(job => Date.parse(job.scheduledAt) > Date.now()); assert.ok(scheduled);
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() }); t.mock.timers.tick(120001); transcription = true;
  assert.equal((await queue.process(scheduled)).state, 'completed');
  if (providerFailure) throw providerFailure;
  const transcript = await client.transcript(childId, id, signal, 'parent');
  assert.equal(transcript.state, 'available'); assert.equal(transcript.messageId, message.id);
  assert.equal(transcript.content?.segments[0].text, '記得我習慣先準備手冊');
  assert.equal(modelCalls, before + 1);
  assert.equal((await queue.process(scheduled)).state, 'completed'); assert.equal(modelCalls, before + 1);
  assert.equal((await product.actions.receipts('parent', childId, result!.runId))!.length, 1);
  await assert.rejects(transcripts.get('other', childId, id));
  t.mock.timers.reset();
  const exporter=createFirestoreAccountExport({...options,voices:voice,transcripts,photos:{async content(){throw new Error('No photos in this scenario');}}});
  assert.equal((await exporter.page('parent',{section:'voice_transcripts',childId})).items.length,1);
  assert.equal((await exporter.page('parent',{section:'voice_content',childId})).items.length,1);
  const current = await voice.get('parent', childId, id), deleteOp = randomUUID();
  assert.equal((await client.delete(current, deleteOp, signal, 'parent')).deleted, true);
  await assert.rejects(voice.content('parent', childId, id), (e: any) => e.code === 'voice_deleted');
  assert.equal((await voice.reserve('parent', childId, input)).fileName, null);
  assert.equal((await exporter.page('parent',{section:'voice_transcripts',childId})).items.length,0);
  assert.equal((await exporter.page('parent',{section:'voice_content',childId})).items.length,0);
  await assert.rejects(transcripts.get('parent', childId, id), (e: any) => e.code === 'voice_deleted');
  await assert.rejects(voice.agentAudio('parent', childId, message.id, message.voice), (e: any) => e.code === 'voice_deleted');
  assert.equal((await voice.delete('parent', childId, id, current.version, deleteOp)).deleted, true);
  const scope = await authority.runTransaction('parent', childId, async b => b.scope);
  assert.equal((await voice.cleanupDeleted(scope, id)).state, 'complete'); assert.equal(stored.size, 0);
  assert.equal((await voice.delete('parent', childId, id, current.version, deleteOp)).cleanupPending, false);
  assert.equal((await exporter.page('parent',{section:'voice_transcripts',childId})).items.length,0);
  await assert.rejects(voice.reserve('parent',childId,{...input,opId:deleteOp}), (e:any)=>e.code==='operation_conflict');
});
