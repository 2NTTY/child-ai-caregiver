import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createMixedChatApi } from '../../../src/client/mixed-chat-api.ts';
import { MixedChatController } from './MixedChatController.ts';
import { careRecordCitationId } from '../../../src/shared/assistant-care-citation.ts';

test('mixed task batches confirm once, recover original bounded progress and stop without applying stale results', async () => {
  const childIds = Array.from({ length: 12 }, () => randomUUID()), roomId = randomUUID(), messageId = randomUUID(), runId = randomUUID();
  const at = '2026-11-11T12:00:00.000Z', digest = 'c'.repeat(64);
  const room = { id: roomId, version: 2, scope: { kind: 'personal' }, childIds, createdAt: at, updatedAt: at };
  const message = { id: messageId, roomId, version: 2, role: 'user', text: 'Prepare a task for these children', createdAt: at };
  let result = { runId, status: 'completed', stopReason: null, text: 'A preview is ready', citations: [], retrievalMode: 'not_used',
    tools: [], counts: { modelCalls: 1, toolCalls: 1, queryEmbeddings: 0 }, proposals: [], provenance: null };
  let batch = { id: randomUUID(), runId, digest, state: 'awaiting_confirmation',
    action: { kind: 'create', title: 'Pack water', details: 'For the trip', type: 'ordinary', dueAt: '2028-03-01T10:00:00+08:00', timeZone: 'Asia/Hong_Kong' },
    items: childIds.map((childId, index) => ({ childId, childName: `Child ${index + 1}`, taskId: null, title: 'Pack water', expectedVersion: null,
      operationId: randomUUID(), status: 'pending', version: null, reason: null })) };
  let reads = 0, lost = true, hold = false, release;
  const controls = [], segments = [];
  const api = createMixedChatApi('https://example.test', async (input, init) => {
    const path = new URL(input).pathname;
    assert.equal(new Headers(init.headers).get('x-expected-user-id'), 'parent');
    assert.equal(init.credentials, 'include'); assert.equal(init.cache, 'no-store');
    if (path.endsWith('/task-batch/advance')) {
      const body = JSON.parse(init.body); segments.push(body); assert.equal(body.digest, digest);
      const items = batch.items.map((item, index) => index >= body.position && index < body.position + 5 && item.status === 'pending'
        ? { ...item, status: 'completed', taskId: randomUUID(), version: 1 } : item);
      batch = { ...batch, items, state: items.some(item => item.status === 'pending') ? 'running' : 'completed' };
      if (lost) { lost = false; throw Error('lost original segment reply'); }
      const saved = structuredClone(batch);
      if (hold) return new Promise(resolve => { release = () => resolve(Response.json({ batch: saved })); });
      return Response.json({ batch });
    }
    if (path.endsWith('/task-batch')) {
      if (init.method === 'GET') { reads++; return Response.json({ batch }); }
      const body = JSON.parse(init.body); controls.push(body); assert.equal(body.digest, digest);
      batch = { ...batch, state: body.action === 'confirm' ? 'running' : 'cancelled',
        items: batch.items.map(item => body.action === 'cancel' && item.status === 'pending' ? { ...item, status: 'cancelled', reason: 'batch_cancelled' } : item) };
      return Response.json({ batch });
    }
    if (path.endsWith('/reply')) return Response.json({ result });
    return Response.json({ room, messages: [message], nextCursor: null });
  });
  const owner = new MixedChatController(api);
  owner.syncContext('parent', 'parent:session1', true, { kind: 'personal' }, 'owned-children');
  await owner.openRoom(roomId);
  assert.equal(reads, 0, 'Ordinary multi-child conversations do not query task batches');
  assert.equal(typeof owner.readBatch, 'function', 'The shared conversation needs original batch recovery');
  result = { ...result, tools: [{ name: 'prepare_selected_tasks', status: 'succeeded', reference: batch.id }] };
  await owner.readReply(messageId);
  assert.equal(reads, 1); assert.equal(owner.getSnapshot().batches[messageId].state, 'awaiting_confirmation');
  await owner.confirmBatch(messageId, digest);
  assert.deepEqual(controls, [{ action: 'confirm', digest }]);
  assert.deepEqual(segments, [{ position: 0, digest }]);
  assert.equal(owner.getSnapshot().pending.kind, 'batch');
  await owner.continueBatch(messageId, digest);
  assert.equal(segments.length, 1, 'An unknown segment cannot be blindly resent');
  await owner.checkOriginal();
  assert.equal(owner.getSnapshot().batches[messageId].items.filter(item => item.status === 'completed').length, 5);
  hold = true; const continuing = owner.continueBatch(messageId, digest); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(segments.at(-1), { position: 5, digest });
  await owner.cancelBatch(messageId, digest);
  release(); await continuing;
  assert.equal(owner.getSnapshot().batches[messageId].state, 'cancelled');
  assert.equal(owner.getSnapshot().batches[messageId].items.filter(item => item.status === 'completed').length, 10);
  assert.equal(owner.getSnapshot().batches[messageId].items.filter(item => item.status === 'cancelled').length, 2);
  await owner.openRoom(roomId);
  assert.equal(owner.getSnapshot().batches[messageId].state, 'cancelled', 'Reopening finds the same original batch and its real receipts');
  owner.syncContext('different-parent', 'different-parent:session1', true, { kind: 'personal' }, 'other-children');
  assert.deepEqual(owner.getSnapshot().batches, {}); assert.equal(owner.getSnapshot().pending, null);
  owner.dispose();
});

test('mixed care citations reauthorize exact reviewed records and clear originals on close, room and identity changes', async () => {
  const roomId=randomUUID(),messageId=randomUUID(),recordId=randomUUID(),otherRecord=randomUUID(),childIds=[randomUUID(),randomUUID()];
  const at='2026-11-12T00:00:00.000Z',runId=randomUUID(),hash='a'.repeat(64),requests=[];
  const room={id:roomId,version:2,scope:{kind:'personal'},childIds,createdAt:at,updatedAt:at};
  const message={id:messageId,roomId,version:2,role:'user',text:'Compare care records',createdAt:at};
  const citation={citationId:careRecordCitationId(0,recordId,2),recordId,version:2,childId:childIds[0],childName:'First child',
    text:'Exact private care original',source:'Parent entry',eventTimeLabel:null};
  let review={draftHash:hash,sourceVersions:[{citationId:careRecordCitationId(1,otherRecord,3),version:'3',contentHash:hash},
      {citationId:'care:'+hash,version:hash,contentHash:hash},{citationId:citation.citationId,version:'2',contentHash:hash}],
    scope:{userId:'parent',workspaceId:roomId,childId:roomId,authorizationVersion:'a',dataVersion:'d'},visibility:'private',decision:'pass',
    model:'test',promptVersion:'1',policyVersion:'test'};
  let result={runId,status:'completed',stopReason:null,text:'See [照護記錄 1].',citations:[],retrievalMode:'not_used',tools:[],
    counts:{modelCalls:1,toolCalls:0,queryEmbeddings:0},proposals:[],provenance:null,deliveryReview:review};
  let status=200,mismatch=null,hold=false,release,signal,archived=false;
  const api=createMixedChatApi('https://example.test',async (input,init)=>{
    const path=new URL(input).pathname;requests.push([init.method,path]);
    assert.equal(init.method,'GET','Opening a care source never starts a model or writes');
    assert.equal(new Headers(init.headers).get('x-expected-user-id'),'parent');
    assert.equal(init.credentials,'include');assert.equal(init.cache,'no-store');
    if(path.includes('/care-citations/')){
      assert.equal(path,`/api/account/mixed-chats/${roomId}/messages/${messageId}/care-citations/1`);
      signal=init.signal;
      const response=status===200?Response.json({citation:{...citation,...mismatch}}):Response.json({error:{code:'unavailable'}},{status});
      return hold?new Promise(resolve=>{release=()=>resolve(response);}):response;
    }
    if(path.endsWith('/reply'))return Response.json({result});
    return Response.json({room,messages:[message],nextCursor:null,...(archived?{archivedReplies:[{messageId,reply:{status:'completed',text:'[照護記錄 1]',citations:[]}}]}:{})});
  });
  const owner=new MixedChatController(api);owner.syncContext('parent','parent:1',true,{kind:'personal'},'children');
  await owner.openRoom(roomId);assert.equal(typeof owner.readCareCitation,'function');
  const careReads=()=>requests.filter(([,path])=>path.includes('/care-citations/')).length;
  for(const ordinal of [0,3,1.5])await owner.readCareCitation(messageId,ordinal);
  assert.equal(careReads(),0,'Coverage and invalid ordinals do not become record links');
  await owner.readCareCitation(messageId,1);assert.deepEqual(owner.getSnapshot().careCitation.citation,citation);
  owner.closeCareCitation();assert.equal(owner.getSnapshot().careCitation,null);
  await owner.readCareCitation(messageId,1);assert.equal(careReads(),2,'Every reopen reauthorizes instead of reusing plaintext');
  for(const changed of [{childId:childIds[1]},{recordId:otherRecord},{version:3},{citationId:'wrong'}]){
    mismatch=changed;await owner.readCareCitation(messageId,1);
    assert.equal(owner.getSnapshot().careCitation.citation,null,'A response cannot move the reference to another record or child');
    assert.ok(owner.getSnapshot().careCitation.error);
  }
  mismatch=null;
  for(const denied of [409,403,404]){status=denied;await owner.readCareCitation(messageId,1);assert.equal(owner.getSnapshot().careCitation.citation,null);
    assert.match(owner.getSnapshot().careCitation.error,denied===409?/來源已更改/:/無法查看/);}
  status=200;hold=true;let late=owner.readCareCitation(messageId,1);await new Promise(resolve=>setImmediate(resolve));
  owner.closeCareCitation();assert.equal(signal.aborted,true);release();await late;assert.equal(owner.getSnapshot().careCitation,null);
  late=owner.readCareCitation(messageId,1);await new Promise(resolve=>setImmediate(resolve));
  await owner.openRoom(roomId);release();await late;assert.equal(owner.getSnapshot().careCitation,null);
  late=owner.readCareCitation(messageId,1);await new Promise(resolve=>setImmediate(resolve));
  owner.syncContext('other','other:1',true,{kind:'personal'},'other');release();await late;assert.equal(owner.getSnapshot().careCitation,null);
  hold=false;owner.syncContext('parent','parent:2',true,{kind:'personal'},'children');
  for(const changes of [{status:'running'},{status:'stopped'},{deliveryReview:{...review,decision:'insufficient_evidence'}},{deliveryReview:undefined}]){
    const original=result;result={...result,...changes};await owner.openRoom(roomId);const before=careReads();
    await owner.readCareCitation(messageId,1);assert.equal(careReads(),before,'Only a passed local completed result exposes a source');result=original;
  }
  archived=true;await owner.openRoom(roomId);const beforeArchive=careReads();await owner.readCareCitation(messageId,1);
  assert.equal(careReads(),beforeArchive,'An archived marker never points to a local source');
  owner.dispose();
});

test('personal multi-child conversations need no class, retain original writes and stay isolated from class and identity changes', async () => {
  const childIds = [randomUUID(), randomUUID()], roomId = randomUUID(), classId = randomUUID();
  const at = '2026-11-11T12:00:00.000Z';
  const personal = { id: roomId, version: 1, scope: { kind: 'personal' }, childIds, createdAt: at, updatedAt: at };
  const classroom = { ...personal, id: randomUUID(), scope: { kind: 'class', spaceId: classId } };
  const bodies = []; let lost = true, hold = false, release;
  const api = createMixedChatApi('https://example.test', async (input, init) => {
    const url = new URL(input);
    assert.equal(new Headers(init.headers).get('x-expected-user-id'), 'parent');
    if (init.method === 'POST') {
      const body = JSON.parse(init.body); bodies.push(body);
      assert.deepEqual(body.scope, { kind: 'personal' }); assert.deepEqual(body.childIds, childIds);
      if (lost) { lost = false; throw Error('lost original personal create'); }
      return Response.json({ room: personal });
    }
    if (url.pathname.endsWith(roomId)) {
      const reply = { room: personal, messages: [], nextCursor: null };
      if (hold) return new Promise(resolve => { release = () => resolve(Response.json(reply)); });
      return Response.json(reply);
    }
    return Response.json({ rooms: [classroom, personal], nextCursor: null });
  });
  const owner = new MixedChatController(api);
  owner.syncContext('parent', 'parent:session1', true, { kind: 'personal' }, 'owned-children');
  await owner.loadRooms();
  assert.deepEqual(owner.getSnapshot().rooms.map(room => room.id), [roomId], 'Personal account queries exclude class rooms');
  await owner.create(childIds); await owner.create(childIds);
  assert.equal(bodies.length, 1); assert.equal(owner.getSnapshot().pending.kind, 'create');
  await owner.checkOriginal(); assert.deepEqual(bodies[1], bodies[0]);
  assert.equal(owner.getSnapshot().room.id, roomId);
  hold = true; const stale = owner.openRoom(roomId); await new Promise(resolve => setImmediate(resolve));
  const scope = { kind: 'class', spaceId: classId, spaceVersion: 1, teacherSpaceVersion: null };
  owner.syncContext('parent', 'parent:session1', true, scope, 'class-roster'); release(); await stale;
  assert.equal(owner.getSnapshot().room, null); assert.deepEqual(owner.getSnapshot().messages, []);
  await owner.loadRooms();
  assert.deepEqual(owner.getSnapshot().rooms.map(room => room.id), [classroom.id], 'Class queries exclude personal rooms');
  owner.syncContext('parent', 'parent:session1', true, { kind: 'personal' }, 'owned-children');
  const staleIdentity = owner.openRoom(roomId); await new Promise(resolve => setImmediate(resolve));
  owner.syncContext('another-parent', 'another-parent:session1', true, { kind: 'personal' }, 'other-children'); release(); await staleIdentity;
  assert.equal(owner.getSnapshot().room, null); assert.deepEqual(owner.getSnapshot().rooms, []);
  assert.deepEqual(owner.getSnapshot().results, {}); assert.equal(owner.getSnapshot().pending, null);
  owner.dispose();
});

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
