import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createSharingApi } from '../../../src/client/sharing-api.ts';
import { SharingController } from './SharingController.ts';

test('class task queries batch roster selections, continue individual pages and reject stale scope or session responses', async () => {
  const spaceId = randomUUID(), teacherSpaceId = randomUUID();
  let space = { id: spaceId, kind: 'class', name: 'Class A', role: 'caregiver', managerUserId: 'teacher',
    transferTargetUserId: null, version: 2, teacherSpaceId, teacherSpaceVersion: 3,
    createdAt: '2026-11-11T00:00:00Z', updatedAt: '2026-11-11T00:00:00Z' };
  const children = Array.from({ length: 7 }, (_, index) => ({ childId: randomUUID(), childName: `Child ${index + 1}`,
    modules: ['tasks'], sharedBy: 'teacher', version: 1, canWithdraw: false }));
  const tasks = Array.from({ length: 9 }, (_, index) => ({ id: randomUUID(), version: 1, title: `Task ${index + 1}`,
    dueAt: '2026-11-12T00:00:00Z', state: 'scheduled' }));
  const cursor = { afterId: tasks[7].id, basis: 'a'.repeat(64) }, requests = [], reads = [];
  let conflict = false, hold = false, release;
  const api = createSharingApi('https://example.test', async (input, init) => {
    const url = new URL(input); requests.push(url.pathname);
    assert.equal(init.credentials, 'include'); assert.equal(init.cache, 'no-store');
    assert.equal(new Headers(init.headers).get('x-expected-user-id'), 'teacher');
    if (url.pathname === '/api/assistant/task-context') {
      assert.equal(init.method, 'POST');
      const body = JSON.parse(init.body); reads.push(body);
      assert.deepEqual(body.scope, { kind: 'class', spaceId, spaceVersion: space.version, teacherSpaceVersion: space.teacherSpaceVersion });
      assert.ok(body.targets.length <= 5);
      if (conflict) { conflict = false; space = { ...space, version: 3 }; return Response.json({ error: { code: 'scope_changed' } }, { status: 409 }); }
      const reply = { children: body.targets.map(target => ({ childId: target.childId,
        childName: children.find(child => child.childId === target.childId).childName,
        tasks: target.cursor ? tasks.slice(8) : tasks.slice(0, 8), nextCursor: target.cursor ? null : cursor })) };
      if (hold) return new Promise(resolve => { release = () => resolve(Response.json(reply)); });
      return Response.json(reply);
    }
    assert.equal(init.method, 'GET', 'Task queries do not create chat or other business writes');
    if (url.pathname.endsWith('/roster')) return Response.json({ items: url.searchParams.has('cursor') ? children.slice(5) : children.slice(0, 5),
      nextCursor: url.searchParams.has('cursor') ? null : 'roster-next' });
    if (url.pathname.endsWith('/members') || url.pathname.endsWith('/invitations')) return Response.json({ items: [], nextCursor: null });
    if (url.pathname.endsWith('/classes')) return Response.json({ items: [space], nextCursor: null });
    assert.equal(url.pathname, '/api/shared-spaces/' + spaceId);
    return Response.json(space);
  });
  const controller = new SharingController(api, 'class');
  controller.syncContext('teacher', 'teacher:1', true);
  try {
    await controller.selectSpace(spaceId);
    assert.equal(reads.length, 0, 'Opening a roster does not automatically query tasks');
    for (const child of children.slice(0, 5)) controller.selectClassTaskChild(child.childId, true);
    await controller.more('shares');
    for (const child of children.slice(5)) controller.selectClassTaskChild(child.childId, true);
    assert.equal(controller.getSnapshot().classTasks.selected.length, 7, 'Five is a per-request bound, not a roster selection cap');
    await controller.loadClassTasks();
    assert.deepEqual(reads.map(read => read.targets.length), [5, 2]);
    assert.equal(controller.getSnapshot().classTasks.children.length, 7);
    assert.equal(controller.getSnapshot().classTasks.children[0].tasks.length, 8);
    await controller.loadClassTasks(children[0].childId);
    assert.deepEqual(reads.at(-1).targets, [{ childId: children[0].childId, cursor }]);
    assert.equal(controller.getSnapshot().classTasks.children[0].tasks.length, 9);
    assert.equal(controller.getSnapshot().classTasks.children[0].nextCursor, null);
    assert.equal(controller.getSnapshot().classTasks.children[1].tasks.length, 8, 'Other children keep their own continuation cursor');

    conflict = true; await controller.loadClassTasks(children[1].childId);
    assert.equal(controller.getSnapshot().selected.version, 3, 'A conflict refreshes the authoritative class and roster');
    assert.deepEqual(controller.getSnapshot().classTasks.selected, []);
    assert.deepEqual(controller.getSnapshot().classTasks.children, []);
    assert.match(controller.getSnapshot().classTasks.notice, /重新選擇/);
    controller.selectClassTaskChild(children[0].childId, true);
    await controller.loadClassTasks();
    space = { ...space, teacherSpaceVersion: 4 };
    await controller.refreshSelected();
    assert.deepEqual(controller.getSnapshot().classTasks.children, [], 'A new teacher-space basis cannot retain earlier query results');

    controller.selectClassTaskChild(children[0].childId, true);
    hold = true; const stale = controller.loadClassTasks();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(typeof release, 'function');
    controller.syncContext('teacher', 'teacher:2', true);
    release(); await stale;
    assert.deepEqual(controller.getSnapshot().classTasks.children, []);
    assert.deepEqual(controller.getSnapshot().classTasks.selected, []);
    assert.equal(controller.getSnapshot().busy, null);
    assert.ok(requests.every(path => !path.includes('/chat') && !path.includes('/messages')));
  } finally { controller.dispose(); }
});
