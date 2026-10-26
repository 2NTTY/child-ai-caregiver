import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import * as RNW from 'react-native-web';
import ts from 'typescript';

const require = createRequire(import.meta.url), root = fileURLToPath(new URL('../src/', import.meta.url)), cache = new Map();
const e = React.createElement, Empty = () => null;
let width = 1180, workspace;
const theme = {colors: {}, radius: {}, readingType: {}, spacing: {sm: 8, md: 12, lg: 16}, chineseFont: 'sans-serif'};
// Actual shipped calendar and preparation workspace/reader/rows through RN Web.
// The owner and container-width measurement are ports; SSR is not browser layout.
function load(relative) {
  const filename = path.join(root, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = {exports: {}}; cache.set(filename, module);
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), {fileName: filename, compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}}).outputText;
  new Function('require', 'module', 'exports', code)(name => {
    if (name === 'react-native') return RNW;
    if (name === 'react-native-paper') return {Text: RNW.Text};
    if (name.endsWith('/theme')) return theme;
    if (name.endsWith('/workspaces/PreparationWorkspace')) return {usePreparationWorkspace: () => workspace};
    if (name.endsWith('/useContainerWidth')) return {useContainerWidth: () => ({width, ref: null, onLayout() {}})};
    if (name.endsWith('/ui')) return {AppSelect: Empty, AppButton: ({label}) => e(RNW.Text, null, label)};
    if (name.endsWith('/AppIcon')) return {AppIcon: Empty};
    if (name.endsWith('/AppStatusBadge')) return {AppStatusBadge: ({label}) => e(RNW.Text, null, label)};
    if (name.endsWith('/AppCheckbox')) return {AppCheckbox: ({label}) => e(RNW.Text, null, label)};
    if (name.endsWith('/WriteRecoveryNotice')) return {WriteRecoveryNotice: Empty};
    if (name.endsWith('/FormDialog')) return {FormDialog: Empty, ManualFormDialog: Empty};
    if (name.endsWith('/DocumentCreateForm')) return {DocumentCreateForm: Empty};
    if (name.endsWith('/SummaryDisclosure')) return {SummaryDisclosure: Empty};
    if (name.startsWith('.')) {
      const base = path.resolve(path.dirname(filename), name), target = [base, base + '.ts', base + '.tsx'].find(file => existsSync(file));
      if (target) return load(path.relative(root, target));
    }
    return require(name);
  }, module, module.exports);
  return module.exports;
}
const {TasksCalendar} = load('components/tasks/TasksCalendar.tsx');
const {PreparationWorkspace} = load('components/preparations/PreparationWorkspace.tsx');
const headings = html => [...html.matchAll(/<(h[1-6])\b[^>]*>(.*?)<\/\1>/gs)].map(([, tag, text]) => [tag, text.replace(/<[^>]*>/g, '')]);
function owner(selected) {
  const documents = ['週末公園小旅行', '開學準備'].map((title, index) => ({id: `synthetic-${index}`, childId: 'synthetic-child', version: 1, status: 'active', purpose: 'outing', archivedAt: null, historical: false, readState: 'ready',
    revision: {id: `synthetic-revision-${index}`, number: 1, title, summary: '合成準備單', eventDate: null, updatedAt: '2026-10-26T00:00:00Z', sourceAsOf: '2026-10-26T00:00:00Z', sourceRefs: [],
      sections: [{id: 'bag', kind: 'checklist', title: '小背包', items: [{id: 'water', text: '飲用水', checked: false}]}, {id: 'plans', kind: 'notes', title: '想一起做', items: [{id: 'walk', text: '散步'}]}]}}));
  return {scopeKey: 'synthetic-scope', model: {documents, selected: selected ? documents[0] : null, child: {id: 'synthetic-child', displayName: '合成孩子'}, condition: 'ready', online: true,
    scope: {childId: 'synthetic-child', online: true, role: 'owner', condition: 'ready'}, capabilities: {checkItem: false, archive: false}, busy: false, dirty: false, operation: null, checkSave: 'idle', notice: ''},
    actions: {selectDocument() {assert.fail('SSR must not select');}, closeDocument() {assert.fail('SSR must not close');}}};
}
test('wide calendar month is h2 rather than a second page-level h1', () => {
  const html = renderToStaticMarkup(e(TasksCalendar, {items: [], context: {asOf: '2026-10-26T00:00:00Z', timeZone: 'Asia/Hong_Kong'}, month: '2026-10', selectedDay: null, disabled: false,
    onSelectDay() {assert.fail('SSR must not select');}, onChangeMonth() {assert.fail('SSR must not change month');}}));
  assert.deepEqual(headings(html), [['h2', '2026年10月']]);
});
test('wide preparation list cards remain h3 while their h2 list title is visible', () => {
  width = 1180; workspace = owner(false);
  assert.deepEqual(headings(renderToStaticMarkup(e(PreparationWorkspace))), [['h2', '待用準備單 · 2 份'], ['h3', '週末公園小旅行'], ['h3', '開學準備']]);
});
test('wide preparation selection promotes visible list cards when their list title disappears', () => {
  width = 1180; workspace = owner(true);
  const html = renderToStaticMarkup(e(PreparationWorkspace));
  assert.deepEqual(headings(html), [['h2', '週末公園小旅行'], ['h2', '開學準備'], ['h2', '週末公園小旅行'], ['h3', '小背包'], ['h3', '想一起做']]);
  assert.match(html, /data-testid="preparation-document-list"/);
});
test('narrow preparation selection still hides the list and keeps the reader hierarchy', () => {
  width = 390; workspace = owner(true);
  const html = renderToStaticMarkup(e(PreparationWorkspace));
  assert.deepEqual(headings(html), [['h2', '週末公園小旅行'], ['h3', '小背包'], ['h3', '想一起做']]);
  assert.doesNotMatch(html, /data-testid="preparation-document-list"/);
});
