import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Module, { createRequire } from 'node:module';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DOMParser } from '@xmldom/xmldom';
import ts from 'typescript';
import { DateTime } from 'luxon';
import * as taskViewModel from '../src/task-view-model.ts';
import * as calendar from '../src/components/tasks/task-calendar.ts';
import { createTaskFixture, taskPreviewClock } from '../src/preview/task-fixture.ts';

// Project the real consumers, then render their field through AppTextField,
// installed Paper and RN Web. Synthetic data only; no browser or API claims.
const require = createRequire(import.meta.url), rn = require('react-native-web');
const originalLoad = Module._load;
Module._load = function (name, parent, isMain) {
  return name === 'react-native' ? rn : originalLoad.call(this, name, parent, isMain);
};
test.after(() => { Module._load = originalLoad; });
const PaperTextInput = require('react-native-paper/lib/commonjs/components/TextInput/TextInput').default;
const elements = new Proxy({}, { get: (_target, key) => String(key) });
const theme = new Proxy({ chineseFont: 'sans-serif', spacing: { sm: 8, md: 12, lg: 16 }, mobileLayout: { breakpoint: 650 } },
  { get: (target, key) => target[key] ?? {} });
const jsx = (type, props) => ({ type, props });
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
const find = (tree, type) => nodes(tree).find(node => node.type === type);
function load(relative, overrides = {}, suffix = '') {
  const file = new URL(`../src/${relative}`, import.meta.url);
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { fileName: file.pathname, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code + suffix)(name => {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (name.endsWith('/theme')) return theme;
    if (name === 'react-native') return { ...rn, StyleSheet: { create: value => value } };
    if (name === 'react-native-paper') return { Text: 'Text', TextInput: PaperTextInput };
    if (name === 'luxon') return { DateTime };
    if (name.endsWith('/task-view-model')) return taskViewModel;
    if (name === './task-calendar') return calendar;
    if (name.endsWith('/care-view-model')) return { careKindOptions: [] };
    if (name.endsWith('/useContainerWidth')) return { useContainerWidth: () => ({ width: 1024, ref: null, onLayout() {} }) };
    if (!name.startsWith('.')) return require(name);
    return elements;
  }, module, module.exports);
  return module.exports;
}
const { AppTextField } = load('components/ui.tsx');
function renderer(relative, symbol, suffix = '') {
  const slots = []; let cursor = 0;
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], value => { slots[index] = value; }]; },
    useRef: value => ({ current: value }), useEffect() {}, useLayoutEffect() {}, useId: () => 'synthetic-tasks',
  };
  const component = load(relative, { react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native-paper': { Text: 'Text', TextInput: { Icon: 'Icon' } } }, suffix)[symbol];
  return props => { cursor = 0; return component(props); };
}
function assertNamedInput(field, label, value) {
  assert.equal(field.props.label, label);
  assert.equal(field.props.accessibilityLabel, label);
  assert.equal(field.props.value, value);
  // Clear-icon interactions are checked below; render only the real input here.
  const html = renderToStaticMarkup(React.createElement(AppTextField, { ...field.props, right: undefined }));
  const dom = new DOMParser().parseFromString(`<main>${html}</main>`, 'text/html');
  const inputs = Array.from(dom.getElementsByTagName('input'));
  assert.equal(inputs.length, 1);
  assert.equal(inputs[0].getAttribute('aria-label'), label);
  assert.equal(inputs[0].getAttribute('value'), value);
}

test('task search keeps its accessible name before typing, after typing and after clearing', () => {
  const render = renderer('components/tasks/TasksView.tsx', 'TasksView');
  const fixture = createTaskFixture('search-child', 'normal'); let closed = 0;
  const model = { ...fixture, child: { id: 'search-child' }, access: 'editable', online: true, reading: false,
    readState: 'ready', scheduleContext: taskPreviewClock, selected: null, draft: null, operation: { state: 'none' } };
  const props = { model, actions: { closePanel() { closed++; } }, onAgent() {}, onHistory() {} };
  let tree = render(props), field = find(tree, 'AppTextField');
  assertNamedInput(field, '搜尋已載入事項', '');
  field.props.onChangeText('Synthetic unmatched task');
  tree = render(props); field = find(tree, 'AppTextField');
  assertNamedInput(field, '搜尋已載入事項', 'Synthetic unmatched task');
  assert.equal(find(tree, 'EmptyListCard').props.title, '沒有符合篩選的事項');
  assert.equal(field.props.right.props.accessibilityLabel, '清除搜尋');
  field.props.right.props.onPress(); tree = render(props);
  assertNamedInput(find(tree, 'AppTextField'), '搜尋已載入事項', '');
  assert.equal(closed, 2);
});

test('saved-record search keeps its accessible name and submits the unchanged query and kind', () => {
  const render = renderer('components/care/CareSavedRecordsView.tsx', '__body', '\nmodule.exports.__body = CareSavedRecordsBody;');
  const calls = [], model = { child: { id: 'search-child' }, access: 'editable', online: true,
    operation: { state: 'none' }, draft: null, deletion: null, detail: null,
    list: { state: 'ready', records: [], activeQuery: '', activeKind: 'all', hasMore: true, hasPrevious: false, message: null } };
  const props = { model, actions: { search: (...args) => calls.push(args) } };
  let tree = render(props), field = find(tree, 'AppTextField');
  assertNamedInput(field, '搜尋已保存記錄', '');
  field.props.onChangeText('Synthetic record'); tree = render(props);
  assertNamedInput(find(tree, 'AppTextField'), '搜尋已保存記錄', 'Synthetic record');
  nodes(tree).find(node => node.type === 'AppButton' && node.props.label === '搜尋').props.onPress();
  assert.deepEqual(calls, [['Synthetic record', 'all']]);
  find(tree, 'AppTextField').props.onChangeText(''); tree = render(props);
  assertNamedInput(find(tree, 'AppTextField'), '搜尋已保存記錄', '');
});
