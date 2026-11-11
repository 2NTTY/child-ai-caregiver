import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createHandoverApi } from '../../../src/client/handover-api.ts';
import { HandoverOwner } from './HandoverOwner.ts';

test('mixed conversation exports negotiate capability, preserve original package requests and reuse the private download path', async () => {
  const childIds = [randomUUID(), randomUUID()], roomId = randomUUID(), spaceId = randomUUID(), commands = [], jobs = new Map();
  const selection = { childIds, modules: [], period: null, mixedRooms: [{ id: roomId, version: 3, childIds }] };
  let supported = false, lost = true, hold = false, release, downloads = 0;
  const api = createHandoverApi('https://example.test', async (input, init) => {
    const url = new URL(input), headers = new Headers(init.headers);
    assert.equal(init.credentials, 'include'); assert.equal(init.cache, 'no-store');
    assert.equal(headers.get('x-expected-user-id'), 'parent');
    if (url.pathname.endsWith('/capabilities')) {
      if (supported) assert.ok(headers.get('x-handover-account-features').split(',').includes('mixed-conversations'));
      const value = { classModules: [], ...(supported ? { mixedConversations: true } : {}) };
      if (hold) return new Promise(resolve => { release = () => resolve(Response.json(value)); });
      return Response.json(value);
    }
    if (url.pathname.endsWith('/download')) {
      downloads++; assert.ok(jobs.has(url.pathname.split('/').at(-2)));
      return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'application/zip', 'Content-Length': '3' } });
    }
    if (init.method === 'POST') {
      const body = JSON.parse(init.body); commands.push(body);
      if (lost) { lost = false; throw Error('lost original create response'); }
      const row = { id: body.opId, version: 1, purpose: body.purpose, selection: body.selection, state: 'ready',
        createdAt: '2026-11-11T12:00:00Z', expiresAt: '2026-11-12T12:00:00Z', bytes: 3, error: null };
      jobs.set(row.id, row); return Response.json(row);
    }
    const row = jobs.get(url.pathname.split('/').at(-1));
    return row ? Response.json(row) : Response.json({ error: { code: 'not_found' } }, { status: 404 });
  });
  const owner = new HandoverOwner(api);
  owner.syncContext('parent', 'parent:1', true);
  await owner.readExportCapabilities();
  await owner.create(selection, 'backup');
  assert.equal(commands.length, 0, 'An older service cannot receive the new optional mixed-room selection');
  supported = true; await owner.readExportCapabilities();
  assert.equal(owner.getSnapshot().mixedConversations, true);
  await owner.create(selection, 'backup');
  assert.equal(owner.getSnapshot().pending.kind, 'create');
  await owner.checkOriginal(); await owner.retryOriginal();
  assert.deepEqual(commands[1], commands[0]); assert.deepEqual(commands[1].selection, selection);
  const originalId = commands[0].opId;
  await owner.download(originalId, async (response, filename, bytes, current) => {
    assert.ok(current()); assert.ok(filename.includes(originalId)); assert.equal(bytes, 3);
    assert.equal((await response.arrayBuffer()).byteLength, 3); return 'Synthetic download consumed';
  });
  assert.equal(downloads, 1); assert.equal(owner.getSnapshot().items[0].id, originalId);
  await owner.createClass(selection, spaceId);
  assert.deepEqual(commands.at(-1).source, { kind: 'class', spaceId });
  assert.equal(commands.at(-1).purpose, 'handover'); assert.deepEqual(commands.at(-1).selection.mixedRooms, selection.mixedRooms);
  hold = true; const late = owner.readExportCapabilities();
  owner.syncContext('another-parent', 'another-parent:1', true); release(); await late;
  assert.equal(owner.getSnapshot().mixedConversations, false); assert.deepEqual(owner.getSnapshot().items, []);
  owner.dispose();
});
