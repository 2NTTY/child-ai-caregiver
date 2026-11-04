import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { HandoverOwner } from '../src/production/HandoverOwner.ts';
import { classExportScope, classExportPupils, classExportModules } from '../src/production/handover-class-export.ts';
import { createHandoverApi } from '../../src/client/handover-api.ts';

test('class export retains only chosen current readable pupils and uses capability-gated original job retries', async () => {
  const spaceId = randomUUID(), first = randomUUID(), second = randomUUID(), commands = [];
  const teachers = { identityKey: 'teacher:1', userId: 'actor', online: true, spaces: { items: [] }, teacherClasses: { items: [] }, selected: null };
  const state = { identityKey: 'class:1', userId: 'actor', online: true, pending: null, busy: null, rosterLoaded: true,
    spaces: { items: [] },
    selected: { id: spaceId, kind: 'class', version: 4, role: 'viewer' }, shares: { items: [
      { childId: first, childName: 'First', version: 2, modules: ['profile', 'care', 'memory'] },
    ] } };
  assert.ok(classExportScope(state, teachers), 'a current viewer has readable export access');
  const chosen = classExportPupils(state, teachers, [])[0];
  const nextPage = { ...state, shares: { items: [{ childId: second, childName: 'Second', version: 1, modules: ['care', 'tasks', 'chat'] }] } };
  const pupils = classExportPupils(nextPage, teachers, [chosen]);
  assert.deepEqual(pupils.map(row => row.childId), [first, second]);
  assert.deepEqual(classExportModules(pupils, ['profile', 'care', 'tasks']), ['care']);
  assert.deepEqual(classExportModules(pupils, []), []);
  assert.ok(!pupils.some(row => row.modules.includes('chat') || row.modules.includes('memory')));
  assert.ok(!classExportPupils({ ...nextPage, selected: { ...state.selected, role: 'caregiver' } }, teachers, [chosen]).some(row => row.childId === first));
  const changedGrant = { ...state, shares: { items: [{ ...state.shares.items[0], version: 3, modules: ['tasks'] }] } };
  assert.notEqual(classExportPupils(changedGrant, teachers, [chosen])[0].basis, chosen.basis);
  assert.equal(classExportScope({ ...state, spaces: { items: [{ ...state.selected, version: 5 }] } }, teachers), null,
    'a refreshed class list invalidates a stale selected detail');

  let enabled = false, failWrite = true, holdCapabilities = false, heldCapabilities, rejection = null, accessErrors = 0;
  const api = createHandoverApi('https://example.test', async (input, init) => {
    const path = new URL(input).pathname;
    assert.equal(new Headers(init.headers).get('x-expected-user-id'), 'actor');
    if (path.endsWith('/capabilities')) return holdCapabilities ? new Promise(resolve => { heldCapabilities = resolve; })
      : enabled ? Response.json({ classModules: ['profile', 'care', 'tasks', 'future_module'] }) : Response.json({}, { status: 404 });
    if (init.method === 'GET') return Response.json({}, { status: 404 });
    assert.equal(path, '/api/account/packages');
    const command = JSON.parse(init.body); commands.push(command);
    if (rejection) return Response.json({ error: { code: rejection } }, { status: 403 });
    if (failWrite) { failWrite = false; return Response.json({}, { status: 503 }); }
    return Response.json({ id: command.opId, version: 1, purpose: command.purpose, selection: command.selection, state: 'queued',
      createdAt: '2026-11-04T00:00:00Z', expiresAt: '2026-11-05T00:00:00Z', bytes: null, error: null });
  });
  const owner = new HandoverOwner(api, () => { accessErrors++; }); owner.syncContext('actor', 'actor:1', true);
  const selection = { childIds: [first, second], modules: ['care'], period: { from: '2026-11-01T00:00:00+08:00', to: '2026-11-07T23:59:59.999+08:00' } };
  await owner.readExportCapabilities(); await owner.createClass(selection, spaceId);
  assert.equal(commands.length, 0, 'an older server leaves personal export as the only path');
  enabled = true; await owner.readExportCapabilities();
  assert.deepEqual(owner.getSnapshot().classModules, ['profile', 'care', 'tasks'], 'unknown future modules do not disable supported capabilities');
  await owner.createClass(selection, spaceId);
  assert.equal(owner.getSnapshot().pending.kind, 'create');
  await owner.checkOriginal(); await owner.retryOriginal();
  assert.equal(commands.length, 2); assert.deepEqual(commands[0], commands[1]);
  assert.deepEqual(commands[0].source, { kind: 'class', spaceId }); assert.equal(commands[0].purpose, 'handover');
  assert.deepEqual(commands[0].selection, selection); assert.equal(owner.getSnapshot().items[0].id, commands[0].opId);
  assert.equal(owner.getSnapshot().pending, null);
  rejection = 'module_not_shared'; await owner.createClass(selection, spaceId);
  assert.equal(owner.getSnapshot().pending, null, 'a definitive class refusal releases the original request');
  assert.equal(owner.getSnapshot().identityKey, 'actor:1'); assert.equal(accessErrors, 0, 'class access loss does not invalidate the account');
  assert.match(owner.getSnapshot().notice, /未分享/);
  rejection = null; await owner.create({ ...selection, childIds: [first] }, 'handover');
  assert.equal(commands.at(-1).source, undefined, 'a subsequent personal export is not trapped behind the rejected class request');
  assert.equal(owner.getSnapshot().pending, null);
  holdCapabilities = true; const oldCapability = owner.readExportCapabilities();
  owner.syncContext('other', 'other:1', true); heldCapabilities(Response.json({ classModules: ['care'] })); await oldCapability;
  assert.equal(owner.getSnapshot().classModules, null, 'late capability reads cannot cross account scope');
});
