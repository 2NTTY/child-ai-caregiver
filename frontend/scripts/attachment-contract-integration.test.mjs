import assert from 'node:assert/strict';
import test from 'node:test';
import { createVoiceApi } from '../../src/client/voice-api.ts';
import { createChatFileApi } from '../../src/client/chat-file-api.ts';
import { handleFirebaseVoiceRequest } from '../../server/firebase-voice-api.ts';
import { handleFirebaseChatFileRequest } from '../../server/firebase-chat-files-api.ts';
import { FirestoreDomainError } from '../../server/firestore-domain-data.ts';
import { harness } from './scope-transition-harness.mjs';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const childId = id(90), createdAt = '2026-10-23T12:00:00.000Z';
const attachment = (n, mimeType) => ({ id: id(n), childId, version: 3, createdAt, state: 'ready',
  fileName: `synthetic-${n}`, mimeType, bytes: 4, sha256: 'a'.repeat(64), messageId: id(80 + n),
  ...(mimeType.startsWith('audio/') ? { durationMs: 1000 } : {}) });
const complete = items => ({ items, nextCursor: null, complete: true, scanned: items.length });

// Real UI read projection -> shared clients -> HTTP handlers. Only the store and host are synthetic.
// This is a bounded in-process contract check, not a deployed API or browser acceptance result.
test('attachment projection includes imported originals across pages and refresh with bound private transcripts', async () => {
  const calls = [], errors = [], listeners = new Set(); let available = true, value;
  const importedVoice = { ...attachment(1, 'audio/wav'), messageId: null };
  const importedFrom = { current: { source: { serverId: 'source-server', accountId: 'source-account', childId, section: 'voices', resourceId: id(1), resourceVersion: 3,
    authorUserId: null, createdAt, confirmedBy: null, confirmedAt: null, confirmationBasis: null, assigneeUserId: null },
    sourceHash: 'a'.repeat(64), packageId: id(70), packageVersion: 1, manifestSha256: 'b'.repeat(64), integrity: 'missing_proof', importedBy: 'synthetic-parent', importedAt: createdAt }, previous: [] };
  let transcript = { voice: { id: importedVoice.id, version: 3, mimeType: 'audio/wav', bytes: 4, sha256: importedVoice.sha256, durationMs: 1000 },
    messageId: null, version: 1, state: 'available', automatic: true, updatedAt: createdAt, reason: null, retryAt: null,
    content: { complete: true, segments: [{ text: 'Imported transcript', startMs: null, endMs: null, unclear: false }] }, importedFrom,
    origin: { messageId: id(81), version: 2, state: 'available', reason: null } };
  const queries = [];
  const voices = { list: async (_user, _child, query) => { queries.push(query); return complete([importedVoice]); }, transcripts: { get: async () => transcript } };
  const files = { list: async (_user, _child, query) => query.cursor
    ? (queries.push(query), complete([attachment(3, 'video/mp4'), { ...attachment(2, 'application/pdf'), messageId: null }]))
    : (queries.push(query), { items: [], nextCursor: 'opaque_cursor', complete: false, scanned: 2 }) };
  const fetcher = async (url, init) => {
    const request = new Request(url, init), voice = new URL(url).pathname.includes('/voices');
    calls.push({ url: request.url, method: request.method, user: request.headers.get('x-expected-user-id') });
    try {
      return voice ? await handleFirebaseVoiceRequest(request, 'synthetic-parent', available ? voices : {}, async () => true)
        : await handleFirebaseChatFileRequest(request, 'synthetic-parent', available ? files : {}, async () => true);
    } catch (error) {
      if (!(error instanceof FirestoreDomainError)) throw error;
      return Response.json({ code: error.code }, { status: error.status });
    }
  };
  const owner = { voiceApi: createVoiceApi(fetcher, 'https://example.test'), fileApi: createChatFileApi(fetcher, 'https://example.test') };
  const h = harness({
    '../../../src/client/online-refresh-events': { subscribeOnlineRefresh: listener => { listeners.add(listener); return () => listeners.delete(listener); } },
    './useDomainEnvironment': { forSharedModule:env=>env,useDomainWriteGuard(){},useDomainEnvironment: () => ({ owner, scopeKey: 'synthetic-scope', userId: 'synthetic-parent', childId, online: true, current: () => true, accessError: error => errors.push(error) }) },
    '../photo-view-model': { photoTime: date => date }, './VoiceMessage': { VoiceMessage: 'VoiceMessage' }, './ChatFileMessage': { ChatFileMessage: 'ChatFileMessage' },
  });
  const { useAttachmentReview } = h.load('src/production/useAttachmentReview.tsx');
  function Host() { value = useAttachmentReview(); return h.jsx('ReadHost', {}); }
  const settle = async () => { await new Promise(resolve => setImmediate(resolve)); h.render(); };
  h.render(h.jsx(Host, {})); await settle();
  assert.equal(value.voices.state, 'ready'); assert.equal(value.voices.items[0].kind, 'voice');
  assert.equal(value.voices.items[0].content.type, 'VoiceMessage');
  assert.equal(value.voices.items[0].content.props.messageId, null);
  assert.equal(value.voices.items[0].content.props.library, true);
  assert.deepEqual(value.files.items, []); assert.equal(value.files.hasMore, true);
  value.files.loadMore(); await settle();
  assert.deepEqual(value.files.items.map(item => item.kind), ['video', 'file']);
  assert.ok(value.files.items.every(item => item.content.type === 'ChatFileMessage' && item.content.props.compact && item.content.props.library === true));
  assert.equal(value.files.hasMore, false); assert.equal(calls.length, 3);
  assert.ok(calls.every(call => call.method === 'GET' && call.user === 'synthetic-parent'));
  assert.equal(new URL(calls[2].url).searchParams.get('cursor'), 'opaque_cursor');
  assert.ok(calls.every(call => !new URL(call.url).searchParams.has('limit')));
  for (const listener of listeners) listener(); await settle(); await settle();
  assert.equal(calls.length, 6, 'refresh rebuilds the already loaded depth');
  assert.ok(calls.every(call => new URL(call.url).searchParams.get('includeImported') === 'true'));
  assert.ok(queries.every(query => query.includeImported === true));
  const signal = new AbortController().signal;
  assert.deepEqual(await owner.voiceApi.transcript(childId, id(1), signal, 'synthetic-parent'), transcript);
  const shared = createVoiceApi(async () => Response.json({ transcript }), 'https://example.test', undefined, { spaceId: id(71) });
  await assert.rejects(shared.transcript(childId, id(1), signal, 'synthetic-parent'), { code: 'voice_response_invalid' });
  transcript = { ...transcript, sharedSpaceId: id(72) };
  await assert.rejects(shared.transcript(childId, id(1), signal, 'synthetic-parent'), { code: 'voice_response_invalid' });
  await assert.rejects(owner.voiceApi.transcript(childId, id(1), signal, 'synthetic-parent'), { code: 'voice_response_invalid' });
  transcript = { ...transcript, sharedSpaceId: id(71) };
  assert.equal((await shared.transcript(childId, id(1), signal, 'synthetic-parent')).sharedSpaceId, id(71));
  available = false; for (const listener of listeners) listener(); await settle();
  assert.equal(value.voices.state, 'unavailable'); assert.equal(value.files.state, 'unavailable');
  assert.deepEqual(value.voices.items, []); assert.deepEqual(value.files.items, []); assert.deepEqual(errors, []);
  h.unmount(); assert.equal(listeners.size, 0);
});
