import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
let pathname = '/';
const source = readFileSync(new URL('../app/_layout.tsx', import.meta.url), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
}, reportDiagnostics: true });
assert.deepEqual(output.diagnostics, []);
const module = { exports: {} };
const components = new Proxy({}, { get: (_target, key) => String(key) });
new Function('require', 'module', 'exports', output.outputText)(name => {
  if (name === 'react/jsx-runtime') return require(name);
  if (name === 'expo-router') return { Stack: 'Stack', usePathname: () => pathname };
  if (name === 'expo-router/head') return { default: 'Head' };
  if (name === 'react-native') return { View: 'View', StyleSheet: { create: value => value }, useWindowDimensions: () => ({ width: 1440 }) };
  if (name.endsWith('/branding')) return { brand: { name: '育有方' } };
  if (name.endsWith('/theme')) return { spacing: { lg: 24 } };
  return components;
}, module, module.exports);

function find(node, predicate) {
  if (!node || typeof node !== 'object') return [];
  return [...(predicate(node) ? [node] : []), ...[node.props?.children].flat(Infinity).flatMap(child => find(child, predicate))];
}
function render(path) {
  pathname = path;
  return module.exports.default();
}
function scale(tree) {
  const styles = find(tree, node => node.type === 'style' && node.props.id === 'app-default-scale');
  assert.equal(styles.length, 1);
  return styles[0].props.children;
}
const normal = 'html { zoom: 1.4; }\n@media (width < 900px) {\n  html { zoom: 1.2; }\n}';

test('login uses original scale without a narrow-screen override', () => {
  assert.equal(scale(render('/login')), 'html { zoom: 1; }');
});

test('all other representative routes retain the existing responsive scale', () => {
  for (const path of ['/', '/chat', '/profile', '/settings', '/photos', '/admin']) {
    assert.equal(scale(render(path)), normal, path);
  }
});

test('route changes restore the proper rule without changing the navigation stack', () => {
  for (const path of ['/login', '/', '/login', '/settings', '/login']) {
    const tree = render(path);
    assert.equal(scale(tree), path === '/login' ? 'html { zoom: 1; }' : normal);
    const stacks = find(tree, node => node.type === 'Stack');
    assert.equal(stacks.length, 1);
    assert.deepEqual(stacks[0].props.screenOptions, { headerShown: false, animation: 'none' });
  }
});
