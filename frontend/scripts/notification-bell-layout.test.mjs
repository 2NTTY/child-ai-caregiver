import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as historyModel from '../src/history-view-model.ts';

// Structural flex/ordering regression only. Viewport pixels are checked separately by CUA.
const jsx = (type, props) => ({ type, props });
const elements = new Proxy({}, { get: (_target, key) => String(key) });
const nodes = value => !value || typeof value !== 'object' ? [] : Array.isArray(value) ? value.flatMap(nodes) : [value, ...nodes(value.props?.children)];
const text = value => !value ? '' : typeof value === 'string' ? value : Array.isArray(value) ? value.map(text).join(' ') : typeof value === 'object' ? text(value.props?.children) : '';
const dialog = Object.assign('Dialog', { Title: 'Title', Content: 'Content', Actions: 'Actions' });
function load(file, owner) {
  const output = ts.transpileModule(readFileSync(new URL('../src/' + file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output)(name => {
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
    if (name === 'react') return { useState: () => [true, () => {}], useRef: current => ({ current }), useEffect() {} };
    if (name === 'react-native') return { View: 'View', StyleSheet: { create: value => value } };
    if (name === 'react-native-paper') return { Portal: 'Portal', Text: 'Text' };
    if (name === './AppDialog') return { AppDialog: dialog };
    if (name === 'expo-router') return { useRouter: () => ({ push() {} }) };
    if (name.endsWith('/PreviewNavigationGuard')) return { usePreviewNavigation: () => action => action() };
    if (name.endsWith('/usePersonalHistory')) return { usePersonalHistoryWorkspace: () => owner };
    if (name.endsWith('/history-view-model')) return historyModel;
    if (name.endsWith('/theme')) return { colors: {}, spacing: { xs: 4, sm: 8, md: 12, lg: 16 }, radius: { large: 22 }, readingType: {} };
    return elements;
  }, module, module.exports);
  return module.exports;
}
const item = { id: 'synthetic-message', scope: { kind: 'account' }, sentAt: '2026-10-22T00:00:00Z',
  contents: [{ channel: 'telegram', title: 'Saved title', body: 'Saved body comes first', contentVersion: '1', sentAt: '2026-10-22T00:00:00Z' }] };
const owner = { scopeKey: 'synthetic-account', online: true, access: 'active', busy: { notifications: false },
  notifications: { state: 'ready', data: { items: [item], complete: true, nextCursor: null } }, actions: { loadNotifications() {} } };

test('bell confines scrolling to a shrinkable message region and keeps both footer actions outside it', () => {
  const { NotificationBell } = load('components/NotificationBell.tsx', owner), tree = NotificationBell(), all = nodes(tree);
  const content = all.find(node => node.type === 'Content'), messages = all.find(node => node.type === 'AppScrollView');
  const footer = all.find(node => node.type === 'Actions'), title = all.find(node => node.type === 'Title');
  assert.equal(content.props.style.flexShrink, 1); assert.equal(content.props.style.minHeight, 0);
  assert.equal(messages.props.style.flexShrink, 1); assert.equal(messages.props.style.minHeight, 0);
  assert.equal(title.props.style.flexShrink, 0); assert.equal(footer.props.style.flexShrink, 0); assert.equal(footer.props.style.flexGrow, 0);
  assert.deepEqual(nodes(footer).filter(node => node.type === 'AppButton').map(node => node.props.label), ['查看消息歷史', '關閉']);
  assert.equal(nodes(content).some(node => node.type === 'AppButton'), false);
  assert.equal(all.find(node => node.type === dialog).props.style.maxHeight, undefined, 'keep the shared AppDialog viewport boundary');
});

test('both recent and full history put complete coverage copy after actual messages, not before the first body', () => {
  const { PersonalNotificationContent } = load('components/history/PersonalHistoryViews.tsx', owner);
  for (const recent of [true, false]) {
    const copy = text(PersonalNotificationContent({ owner, recent }));
    assert.ok(copy.indexOf('Saved body comes first') < copy.indexOf('只顯示已保存的通知內容'));
    assert.ok(copy.includes('較早記錄可能不齊，不包括帳戶驗證電郵。'));
  }
});

test('empty, partial-empty, loading, error and unavailable views do not force the coverage paragraph', () => {
  const { PersonalNotificationContent } = load('components/history/PersonalHistoryViews.tsx', owner);
  for (const recent of [true, false]) for (const state of ['ready', 'loading', 'error', 'unavailable']) for (const complete of [true, false]) {
    const empty = { ...owner, notifications: { state, data: state === 'ready' ? { items: [], complete, nextCursor: complete ? null : 'synthetic-cursor' } : null } };
    assert.equal(text(PersonalNotificationContent({ owner: empty, recent })).includes('只顯示已保存的通知內容'), false);
  }
});
