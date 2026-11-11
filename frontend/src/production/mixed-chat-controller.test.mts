import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createMixedChatApi } from '../../../src/client/mixed-chat-api.ts';
import { MixedChatController } from './MixedChatController.ts';

test('mixed conversations recover original writes, read and stop only original runs, and discard stale identity or class replies', async () => {
  const spaceId = randomUUID(), childId = randomUUID(), roomId = randomUUID(), messageId = randomUUID();
  const at = '2026-11-11T12:00:00.000Z';
  let room = { id: roomId, version: 1, scope: { kind: 'class', spaceId }, childIds: [childId], createdAt: at, updatedAt: at };
  const message = { id: messageId, roomId, version: 2, role: 'user', text: 'What should I prepare?', createdAt: at };
  const result = { runId: randomUUID(), status: 'running', stopReason: null, text: '', citations: [], retrievalMode: 'not_used',
    tools: [], countsKnown: false, counts: { modelCalls: 0, toolCalls: 0, queryEmbeddings: 0 }, proposals: [], provenance: null };
  const requests = [], createBodies = [], appendBodies = [];
  let loseCreate = true, loseAppend = true, loseReply = true, saved = false, original = null, hold = false, release,
    holdReply = false, releaseReply, stopUnresolved = false;
  const api = createMixedChatApi('https://example.test', async (input, init) => {
    const url = new URL(input), method = init.method;
    requests.push([method, url.pathname]);
    assert.equal(init.credentials, 'include'); assert.equal(init.cache, 'no-store');
    assert.equal(new Headers(init.headers).get('x-expected-user-id'), 'teacher');
    if (url.pathname.endsWith('/reply')) {
      assert.equal(url.pathname, `/api/account/mixed-chats/${roomId}/messages/${messageId}/reply`);
      if (method === 'POST') {
        original = result;
        if (loseReply) { loseReply = false; throw Error('lost reply response'); }
        if (holdReply) return new Promise(resolve => { releaseReply = () => resolve(Response.json({ result })); });
      }
      if (method === 'DELETE') {
        if (stopUnresolved) { stopUnresolved = false; return Response.json({ result: null }); }
        original = { ...result, status: 'stopped', stopReason: 'cancelled', text: 'Partial official answer' };
      }
      return Response.json({ result: original });
    }
    if (method === 'POST' && url.pathname.endsWith('/messages')) {
      appendBodies.push(JSON.parse(init.body)); saved = true; room = { ...room, version: 2 };
      if (loseAppend) { loseAppend = false; throw Error('lost append response'); }
      return Response.json({ message });
    }
    if (method === 'POST') {
      createBodies.push(JSON.parse(init.body));
      if (loseCreate) { loseCreate = false; throw Error('lost create response'); }
      return Response.json({ room });
    }
    if (url.pathname.endsWith(roomId)) {
      if (hold) return new Promise(resolve => { release = () => resolve(Response.json({ room, messages: saved ? [message] : [], nextCursor: null })); });
      return Response.json({ room, messages: saved ? [message] : [], nextCursor: null });
    }
    return Response.json({ rooms: [room], nextCursor: url.searchParams.has('cursor') ? null : 'older-rooms' });
  });
  const owner = new MixedChatController(api);
  const scope = { kind: 'class', spaceId, spaceVersion: 2, teacherSpaceVersion: null };
  owner.syncContext('teacher', 'teacher:session1', true, scope, 'roster:1');
  await owner.loadRooms(); await owner.loadRooms(true);
  assert.equal(owner.getSnapshot().rooms.length, 1, 'Room continuation does not duplicate a room');
  await owner.openRoom(roomId);
  assert.equal(requests.filter(([method]) => method !== 'GET').length, 0, 'Opening existing rooms never starts a run');
  await owner.create([childId]);
  assert.equal(owner.getSnapshot().pending.kind, 'create');
  await owner.create([childId]);
  assert.equal(createBodies.length, 1, 'Unknown creates block a fresh operation ID');
  await owner.checkOriginal();
  assert.deepEqual(createBodies[1], createBodies[0]);
  assert.equal(owner.getSnapshot().room.id, roomId);
  owner.setDraft(message.text); await owner.send();
  assert.equal(owner.getSnapshot().pending.kind, 'append');
  await owner.checkOriginal();
  assert.deepEqual(appendBodies[1], appendBodies[0]);
  assert.equal(appendBodies[1].expectedVersion, 1);
  assert.equal(owner.getSnapshot().messages[0].text, message.text);
  assert.equal(Object.values(owner.getSnapshot().results).filter(Boolean).length, 0, 'Saving ordinary input cannot fabricate an assistant answer');
  await owner.startReply(messageId);
  assert.equal(owner.getSnapshot().pending.kind, 'reply');
  const starts = requests.filter(([method, path]) => method === 'POST' && path.endsWith('/reply')).length;
  await owner.checkOriginal();
  assert.equal(owner.getSnapshot().results[messageId].status, 'running');
  assert.equal(requests.filter(([method, path]) => method === 'POST' && path.endsWith('/reply')).length, starts);
  holdReply = true; const stillWaiting = owner.startReply(messageId); await new Promise(resolve => setImmediate(resolve));
  assert.equal(owner.getSnapshot().busy, 'reply');
  stopUnresolved = true;
  await owner.stopReply(messageId);
  assert.equal(owner.getSnapshot().pending.method, 'DELETE', 'A null cancellation reply does not prove that the original run stopped');
  await owner.checkOriginal();
  assert.equal(owner.getSnapshot().pending.checked, true, 'A still-running original result retains the cancellation intent');
  await owner.retryOriginal();
  releaseReply(); await stillWaiting;
  assert.equal(owner.getSnapshot().results[messageId].stopReason, 'cancelled');
  await owner.openRoom(roomId);
  assert.equal(owner.getSnapshot().results[messageId].text, 'Partial official answer', 'Reopening retrieves the formal saved result');
  hold = true; const staleClass = owner.openRoom(roomId); await new Promise(resolve => setImmediate(resolve));
  owner.syncContext('teacher', 'teacher:session1', true, { ...scope, spaceVersion: 3 }, 'roster:2');
  release(); await staleClass;
  assert.equal(owner.getSnapshot().room, null);
  const staleIdentity = owner.openRoom(roomId); await new Promise(resolve => setImmediate(resolve));
  owner.syncContext('other', 'other:session1', true, null, ''); release(); await staleIdentity;
  assert.deepEqual(owner.getSnapshot().rooms, []); assert.deepEqual(owner.getSnapshot().messages, []);
  assert.deepEqual(owner.getSnapshot().results, {}); assert.equal(owner.getSnapshot().pending, null);
  owner.dispose();
});
