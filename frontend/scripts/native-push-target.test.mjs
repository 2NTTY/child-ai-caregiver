import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

// Execute the real production callback after the existing notification API has authorized its target.
// Only the router, leave guard and child-selection ports are replaced; no notification is sent.
function navigationHarness() {
  const path = new URL('../src/production/ProductionProvider.tsx', import.meta.url);
  const text = readFileSync(path, 'utf8');
  const source = ts.createSourceFile(path.pathname, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'useNativePushNavigation') {
      assert.equal(callback, undefined, 'one production notification subscription');
      callback = node.arguments[3];
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(callback && ts.isArrowFunction(callback));
  const js = ts.transpileModule(`return (${callback.getText(source)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  let identityKey = 'parent-a', pending, finishSelection;
  const events = [], snapshot = { identityKey };
  const owner = { getSnapshot: () => ({ identityKey }), controller: {
    selectChild(id) { events.push(['child', id]); return new Promise(resolve => { finishSelection = resolve; }); },
  } };
  const navigate = new Function('owner', 'snapshot', 'leave', 'router', 'setLocalNotice', js)(
    owner, snapshot, action => { pending = action; }, { push: route => events.push(['route', route]) },
    message => events.push(['notice', message]),
  );
  return { navigate, events, approve: () => pending(), selected: () => finishSelection(),
    switchIdentity: () => { identityKey = 'parent-b'; } };
}

test('authorized care notification retains its exact task after child selection and identity guards', async () => {
  const target = { kind: 'care', childId: '11111111-1111-4111-8111-111111111111', taskId: '22222222-2222-4222-8222-222222222222' };
  const h = navigationHarness();
  h.navigate(target);
  assert.deepEqual(h.events, [], 'leave guard still owns navigation');
  h.approve();
  assert.deepEqual(h.events, [['child', target.childId]], 'wait for the target child before opening a task');
  h.selected(); await new Promise(setImmediate);
  assert.deepEqual(h.events[1], ['route', { pathname: '/tasks', params: { taskId: target.taskId } }]);

  const stale = navigationHarness();
  stale.navigate(target); stale.approve(); stale.switchIdentity(); stale.selected();
  await new Promise(setImmediate);
  assert.deepEqual(stale.events, [['child', target.childId]], 'late child response cannot navigate another identity');

  const channelTest = navigationHarness();
  channelTest.navigate({ kind: 'test', childId: null, taskId: null }); channelTest.approve();
  await new Promise(setImmediate);
  assert.deepEqual(channelTest.events, [['route', '/settings']], 'channel tests keep the settings destination');
});
