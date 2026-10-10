import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url), ts = require('typescript');
let params = {};
function load(relative, port) {
  const module = { exports: {} };
  const source = ts.transpileModule(readFileSync(new URL(relative, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  new Function('require', 'module', 'exports', source)(port, module, module.exports);
  return module.exports;
}
const screen = load('../src/screens/careScreen.tsx', name => {
  if (name === 'react' || name === 'react/jsx-runtime') return require(name);
  if (name === 'expo-router') return { usePathname: () => '/care', useLocalSearchParams: () => params, useRouter: () => ({ push() {} }) };
  if (name.endsWith('/ProductionProvider')) return { useProduction: () => ({ scopeKey: 'synthetic:B', model: { selectedChildId: 'B', children: [{ id: 'B' }] }, actions: {} }) };
  if (name.endsWith('/PreviewNavigationGuard')) return { usePreviewNavigation: () => () => {} };
  if (name.endsWith('/care-view-model')) return { careKindOptions: [{ value: 'feeding' }] };
  if (name === './photosScreen') return { PhotoWorkspace: 'PhotoWorkspace' };
  return new Proxy({}, { get: (_, key) => typeof key === 'string' ? key : undefined });
});
const { routeStartupRequirements } = load('../src/startup/dataReadiness.ts', require);

test('care screen and readiness use the same first-value view query', () => {
  for (const view of ['photos', ['photos', 'records'], ['records', 'photos'], [], undefined]) {
    params = { view };
    const required = routeStartupRequirements('/care', { view: Array.isArray(view) ? view[0] : view });
    assert.equal(screen.default().type === 'PhotoWorkspace', required.includes('photos'),
      'the route must not mount CareWorkspace while readiness waits for photos');
  }
});

test('view normalization preserves the existing compose and record selection policy', () => {
  params = { view: ['records', 'photos'], compose: 'feeding', recordId: 'chosen', record: 'fallback' };
  const selected = screen.default();
  assert.equal(selected.props.initialKind, 'feeding');
  assert.equal(selected.props.initialRecordId, 'chosen');
  params = { compose: ['feeding'], recordId: ['ignored'], record: 'fallback' };
  assert.equal(screen.default().props.initialKind, undefined);
  assert.equal(screen.default().props.initialRecordId, 'fallback');
});
