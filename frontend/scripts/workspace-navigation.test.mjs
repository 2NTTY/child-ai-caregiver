import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../src/preview/PreviewNavigationGuard.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled)(name => {
  if (name === 'react' || name === 'react/jsx-runtime') return require(name);
  if (name === 'react-native') return { StyleSheet: { create: value => value } };
  if (name === '../theme') return { colors: {}, typeScale: {} };
  return {};
}, module, module.exports);

test('dashboard navigation retains original work without relaxing scope changes or discarding local forms', () => {
  const { navigationStates } = module.exports;
  const original = Object.freeze({ dirty: true, pending: true, scope: 'child', retainedInWorkspace: true });
  const entries = [['original-operation', original]];
  const blocked = intent => navigationStates(entries, intent).some(state => state.dirty || state.pending);
  assert.equal(blocked('workspace'), false, 'a persistent provider does not require staying on its page');
  assert.equal(blocked('child'), true, 'changing children still checks the unresolved original operation');
  assert.equal(blocked('navigation'), true, 'leaving the dashboard still protects the original operation');
  assert.equal(entries[0][1], original);
  assert.equal(original.pending, true, 'navigation must not settle or erase a pending write');
  const local = { dirty: true, pending: false, scope: 'child' };
  const combined = navigationStates([...entries, ['local-form', local]], 'workspace');
  assert.equal(combined[1].dirty, true, 'a page-local draft still requires an explicit decision');
  const racing = navigationStates([['local-form', { ...local, pending: true }]], 'workspace', ['local-form']);
  assert.equal(racing[0].pending, true, 'a retained-draft exception never exempts a local pending write');
  assert.equal(navigationStates([['account', { ...original, scope: 'account' }]], 'child').length, 0);
});
