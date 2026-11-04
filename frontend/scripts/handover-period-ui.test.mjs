import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url), ts = require('typescript');
const jsx = (type, props, key) => ({ type, props, key }), noop = () => {};
let current, production;
const hooks = { useState(initial) { const instance = current, index = instance.cursor++;
  if (!(index in instance.slots)) instance.slots[index] = initial;
  return [instance.slots[index], next => { instance.slots[index] = typeof next === 'function' ? next(instance.slots[index]) : next; }]; },
  useEffect: noop, useLayoutEffect: noop, useRef: () => ({ current: null }), useSyncExternalStore: (_subscribe, get) => get() };
const cache = new Map();
function load(path) {
  if (cache.has(path)) return cache.get(path);
  const module = { exports: {} }, source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const resolve = name => name === 'react' ? hooks : name === 'react/jsx-runtime' ? { jsx, jsxs: jsx }
    : name === 'react-native' ? { View: 'View', StyleSheet: { create: value => value }, Platform: { OS: 'web' }, AppState: { currentState: 'active' } }
    : name === 'react-native-paper' ? { Text: 'Text' }
    : name.endsWith('/ProductionProvider') ? { useProduction: () => production }
    : name.endsWith('/HandoverOwner') ? { handoverErrorText: String }
    : name.endsWith('/handover') ? load('../../src/shared/handover.ts')
    : name.endsWith('/date-time') ? load('../src/components/date-time.ts')
    : name.endsWith('/file-export') ? { useFileExportAvailable: () => true }
    : name.endsWith('/theme') ? { colors: {}, readingType: {}, spacing: {} }
    : name === 'luxon' || name === 'zod' ? require(name)
    : new Proxy({}, { get: (_value, key) => String(key) });
  new Function('require', 'module', 'exports', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText)(resolve, module, module.exports);
  cache.set(path, module.exports); return module.exports;
}
function render(component, instance = { slots: [] }) { current = instance; instance.cursor = 0; instance.tree = component(); return instance; }
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
const text = tree => tree == null || tree === false ? '' : Array.isArray(tree) ? tree.map(text).join(' ') : typeof tree === 'object' ? text(tree.props?.children) : String(tree);
const control = (view, label) => nodes(view.tree).find(node => node.props?.label === label);

// Real shared export component and existing date utilities; synthetic account/controller, no network or picker.
test('handover period selection preserves Hong Kong inclusive days and blocks unsupported module changes', async () => {
  const id = '00000000-0000-4000-8000-000000000001', sent = [];
  const state = { userId: 'owner', identityKey: 'owner:1', busy: null, pending: null, items: [] };
  const controller = { subscribe: noop, getSnapshot: () => state, create: async (...args) => sent.push(args) };
  production = { owner: { handoverOwner: controller }, userId: 'owner', identityKey: 'owner:1', online: true,
    recordsState: { children: [{ id, displayName: 'Own child', accessRole: 'owner' }] }, account: { gate: 'ready', deletion: { phase: 'idle' } } };
  const component = load('../src/components/account/HandoverControls.tsx').HandoverControls, view = render(component);
  const again = () => render(component, view);
  const open = () => { control(view, '選擇要匯出的資料').props.onPress(); again(); control(view, 'Own child').props.onChange(true); again(); };
  open(); control(view, '照護記錄').props.onChange(true); again();
  const periodToggle = control(view, '指定開始及結束日期'); assert.ok(periodToggle, 'the existing export entry must offer a date range');
  assert.equal(periodToggle.props.checked, false);
  control(view, '建立資料包').props.onPress(); await Promise.resolve();
  assert.equal(sent[0][0].period, null, 'all-time remains the original default');
  open();
  for (const label of ['照護記錄', '待辦', '私人聊天', '持續關注']) { control(view, label).props.onChange(true); again(); }
  control(view, '指定開始及結束日期').props.onChange(true); again();
  const from = () => control(view, '開始日期'), to = () => control(view, '結束日期');
  assert.ok(from() && to(), 'use the common date fields');
  assert.equal(control(view, '建立資料包').props.disabled, true);
  from().props.onChange('2026-02-30'); to().props.onChange('2026-11-04'); again();
  assert.equal(control(view, '建立資料包').props.disabled, true, 'invalid dates cannot broaden into all-time');
  from().props.onChange('2026-11-05'); again();
  assert.equal(control(view, '建立資料包').props.disabled, true, 'the end date must follow the start');
  from().props.onChange('2026-11-04'); again();
  control(view, '記憶與摘要').props.onChange(true); again();
  assert.equal(control(view, '指定開始及結束日期').props.checked, true, 'module changes preserve the requested period');
  assert.equal(from().props.value, '2026-11-04');
  assert.equal(control(view, '建立資料包').props.disabled, true);
  assert.match(text(view.tree), /所選模組.*日期範圍/);
  assert.doesNotMatch(text(view.tree), /歷史不完整/);
  control(view, '建立資料包').props.onPress(); await Promise.resolve();
  assert.equal(sent.length, 1, 'a stale activation cannot silently submit all-time');
  control(view, '記憶與摘要').props.onChange(false); again();
  assert.equal(control(view, '建立資料包').props.disabled, false);
  control(view, '建立資料包').props.onPress(); await Promise.resolve();
  assert.deepEqual(sent[1], [{ childIds: [id], modules: ['care', 'tasks', 'chat', 'concerns'],
    period: { from: '2026-11-03T16:00:00.000Z', to: '2026-11-04T15:59:59.999Z' } }, 'handover']);
  const importState = { ...state, items: [], uploads: [], upload: { id, state: 'ready', filename: 'period.zip', bytes: 3,
    preview: { integrity: 'trusted', children: [], coverage: [], header: { source: { serverId: 'source.test' }, selection: sent[1][0] } } } };
  production.owner.handoverImportOwner = { subscribe: noop, getSnapshot: () => importState };
  production.owner.sharedChild = { subscribe: noop, getSnapshot: () => ({ phase: 'idle' }) };
  const importComponent = load('../src/components/account/HandoverImportControls.tsx').HandoverImportControls, preview = render(importComponent);
  control(preview, '查看上載與匯入選擇').props.onPress(); render(importComponent, preview);
  assert.match(text(preview.tree), /來源指定日期（香港時間）：\s*2026-11-04\s*至\s*2026-11-04/);
});
