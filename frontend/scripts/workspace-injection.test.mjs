import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
function loadDomain(domain) {
  const filename = new URL(`../src/workspaces/${domain}Workspace.tsx`, import.meta.url);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename.pathname,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    // Formal injection must not load any preview state owner, fixture or router.
    assert.ok(['react', 'react/jsx-runtime'].includes(name), `Unexpected runtime dependency ${name}`);
    return require(name);
  }, module, module.exports);
  return module.exports;
}

for (const domain of ['Care', 'Profile', 'Tasks', 'Preparation']) {
  test(`${domain} consumers share the exact injected value and receive the owner's next projection`, () => {
    const api = loadDomain(domain), Provider = api[`${domain}WorkspaceProvider`], read = api[`use${domain}Workspace`];
    const first = { scopeKey: 'server:user:child:owner', model: { scopeKey: 'server:user:child:owner', version: 1 }, actions: { save() {} } };
    const second = { ...first, model: { ...first.model, version: 2 } };
    const seen = [];
    function Consumer() { const value = read(); seen.push(value); return React.createElement('span', null, value?.model.version ?? 'masked'); }
    function render(value, scopeKey = first.scopeKey) {
      seen.length = 0;
      return renderToStaticMarkup(React.createElement(Provider, { scopeKey, value }, React.createElement(Consumer), React.createElement(Consumer)));
    }
    assert.equal(render(first), '<span>1</span><span>1</span>');
    assert.equal(seen[0], first); assert.equal(seen[1], first);
    assert.equal(render(second), '<span>2</span><span>2</span>');
    assert.equal(seen[0], second); assert.equal(seen[1], second);
    assert.equal(render(second, 'server:user:other-child:owner'), '<span>masked</span><span>masked</span>');
    assert.deepEqual(seen, [null, null]);
    assert.equal(render(null), '<span>masked</span><span>masked</span>');
  });
}

test('Care rejects a model from a different scope even when its envelope matches', () => {
  const { CareWorkspaceProvider, useCareWorkspace } = loadDomain('Care');
  let observed = 'not rendered';
  function Consumer() { observed = useCareWorkspace(); return null; }
  renderToStaticMarkup(React.createElement(CareWorkspaceProvider, { scopeKey: 'current', value: { scopeKey: 'current', model: { scopeKey: 'previous' }, actions: {} } }, React.createElement(Consumer)));
  assert.equal(observed, null);
});

test('Profile measurement projection passes by reference and an absent adapter stays absent', () => {
  const { ProfileWorkspaceProvider, useProfileWorkspace } = loadDomain('Profile');
  const measurements = { scopeKey: 'current', childId: 'child', state: 'ready', height: { recordId: 'canonical-record', recordVersion: 3, valueLabel: '99 cm', state: 'current' }, weight: null };
  let observed;
  function Consumer() { observed = useProfileWorkspace(); return null; }
  const value = { scopeKey: 'current', model: {}, actions: {}, measurements };
  renderToStaticMarkup(React.createElement(ProfileWorkspaceProvider, { scopeKey: 'current', value }, React.createElement(Consumer)));
  assert.equal(observed.measurements, measurements);
  renderToStaticMarkup(React.createElement(ProfileWorkspaceProvider, { scopeKey: 'current', value: { scopeKey: 'current', model: {}, actions: {} } }, React.createElement(Consumer)));
  assert.equal(observed.measurements, undefined);
});

test('formal consumers do not import preview controllers or require scenario controls', () => {
  for (const filename of ['components/preparations/PreparationWorkspace.tsx', 'components/tasks/TaskHistoryView.tsx', 'components/tasks/TasksView.tsx', 'components/child-overview/ChildOverviewContent.tsx', 'components/care/ImportantRecordConfirmation.tsx']) {
    const source = fs.readFileSync(new URL(`../src/${filename}`, import.meta.url), 'utf8');
    assert.ok(!/from\s+["'][^"']*preview\//.test(source), filename);
  }
  const summary = fs.readFileSync(new URL('../src/screens/SummaryScreen.tsx', import.meta.url), 'utf8');
  assert.ok(summary.includes('measurements={profile?.measurements}'));
  assert.ok(!summary.includes('state: "unavailable", height: null'));
});

test('recovery UI never invents an action and only exposes the original operation mode', () => {
  const filename = new URL('../src/components/WriteRecoveryNotice.tsx', import.meta.url);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename.pathname,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => name === 'react/jsx-runtime' ? { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }
    : name === './ui' ? { AppButton: 'Button' } : name === './OperationNotice' ? { OperationNotice: 'Notice' } : assert.fail(name), module, module.exports);
  const render = module.exports.WriteRecoveryNotice;
  const operation = { state: 'unknown', reference: 'same-op', message: 'Awaiting the original receipt' };
  const calls = [], recovery = { checkOriginalOperation: () => calls.push('check'), retryOriginalOperation: () => calls.push('retry'), reloadCurrent: () => calls.push('reload') };
  const buttons = value => value.props.children.filter(Boolean);
  assert.equal(buttons(render({ operation })).length, 0);
  assert.deepEqual(buttons(render({ operation, recovery })).map(button => button.props.label), ['查核原操作']);
  const retry = buttons(render({ operation: { ...operation, recovery: 'retry' }, recovery }));
  assert.deepEqual(retry.map(button => button.props.label), ['查核原操作', '重試同一原操作']);
  const reload = buttons(render({ operation: { ...operation, recovery: 'reload' }, recovery }));
  assert.deepEqual(reload.map(button => button.props.label), ['重新讀取目前資料']);
  assert.deepEqual(calls, []);
  reload[0].props.onPress(); assert.deepEqual(calls, ['reload']);
  assert.ok(buttons(render({ operation, recovery, online: false })).every(button => button.props.disabled));
});
