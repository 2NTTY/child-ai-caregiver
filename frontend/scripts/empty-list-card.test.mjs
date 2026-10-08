import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const native = require('react-native-web');
const cache = new Map();
const announcements = [];
function load(relative) {
  if (cache.has(relative)) return cache.get(relative);
  const file = new URL(`../src/${relative}.tsx`, import.meta.url);
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { fileName: file.pathname,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  const resolve = name => {
    if (name === 'react' || name === 'react/jsx-runtime') return require(name);
    if (name === 'react-native') return native;
    if (name === 'react-native-paper') return { Text: native.Text, ActivityIndicator: native.ActivityIndicator };
    if (name === '../theme') return { chineseFont: 'sans-serif', colors: { neutralSurface: '#F7FCFC', softLine: '#E6E6EA', ink: '#272343', muted: '#2D334A', errorInk: '#954026' },
      spacing: { sm: 8, md: 12, lg: 16 }, radius: { medium: 16 }, readingType: { body: { fontSize: 16, lineHeight: 26 }, tool: { fontSize: 14, lineHeight: 22 } } };
    if (name === './AppIcon') return { AppIcon: ({ name }) => React.createElement('span', { 'data-icon': name, 'aria-hidden': true }) };
    if (name === '../motion/preferences') return { useMotionPreferences: () => ({ enabled: false }) };
    if (name === './StatusAnnouncement') return { StatusAnnouncement: props => { announcements.push(props); return null; } };
    if (name === './EmptyListCard') return load('components/EmptyListCard');
    assert.fail(`Unexpected shared empty-card dependency: ${name}`);
  };
  new Function('require', 'module', 'exports', code)(resolve, module, module.exports);
  cache.set(relative, module.exports);
  return module.exports;
}
const { EmptyListCard } = load('components/EmptyListCard');
const { ReadStateNotice } = load('components/ReadStateNotice');
const render = (Component, props) => {
  announcements.length = 0;
  return renderToStaticMarkup(React.createElement(Component, props));
};

// Real React and RN Web semantic rendering with synthetic copy/actions.
// This is not a browser layout, native device, or live-service verification.
test('successful empty results render a light card with a readable title and existing actions', () => {
  const html = render(ReadStateNotice, { state: 'empty', title: '暫無已保存記錄', message: '可先記下想留意的事情。',
    children: React.createElement('button', { type: 'button' }, '前往記錄') });
  assert.match(html, /data-testid="read-state-empty"/);
  const card = EmptyListCard({ title: '暫無已保存記錄' });
  const cardStyle = native.StyleSheet.flatten(card.props.style);
  assert.equal(cardStyle.padding, 16); assert.equal(cardStyle.borderWidth, 1);
  assert.equal(cardStyle.backgroundColor, '#F7FCFC');
  assert.equal(native.StyleSheet.flatten(card.props.children[0].props.children[1].props.style).fontSize, 16);
  assert.match(html, />暫無已保存記錄<\/div>/);
  assert.doesNotMatch(html, /role="heading"|<h[1-6]\b/);
  assert.match(html, /可先記下想留意的事情。/);
  assert.match(html, /<button type="button">前往記錄<\/button>/);
  assert.doesNotMatch(html, /role="alert"|aria-disabled|aria-hidden/);
  assert.deepEqual(announcements, [{ eventKey: 'empty:暫無已保存記錄。可先記下想留意的事情。', message: '暫無已保存記錄。可先記下想留意的事情。', urgent: false }]);
});

test('message-only and fallback empty copy remain concise, with no duplicate line', () => {
  const html = render(ReadStateNotice, { state: 'empty', message: '沒有符合篩選的事項。' });
  assert.doesNotMatch(html, /role="heading"|<h[1-6]\b/);
  assert.equal(html.split('沒有符合篩選的事項。').length - 1, 1);
  const repeated = render(ReadStateNotice, { state: 'empty', title: '暫無記錄', message: '暫無記錄' });
  assert.equal(repeated.split('暫無記錄').length - 1, 1);
  assert.match(render(ReadStateNotice, { state: 'empty' }), /目前沒有資料/);
});

test('the shared card keeps decorative icons hidden and accepts local spacing without disabling children', () => {
  const html = render(EmptyListCard, { title: '暫無持續關注', icon: 'sprout', testID: 'concern-empty',
    style: { minHeight: 120, padding: 24 }, children: React.createElement('button', null, '與助手討論') });
  assert.match(html, /data-testid="concern-empty"/);
  assert.match(html, /data-icon="sprout" aria-hidden="true"/);
  assert.match(html, /<button>與助手討論<\/button>/);
  assert.doesNotMatch(html, /role="button"|disabled/);
});

test('ready content and quiet loading remain unaltered and never render an empty card', () => {
  for (const props of [{ state: 'ready' }, { state: 'loading' }, { state: 'loading', refreshing: true }]) {
    const html = render(ReadStateNotice, { ...props, message: 'Synthetic read status', children: React.createElement('button', null, 'Synthetic action') });
    assert.equal(html, '');
    assert.deepEqual(announcements, [{ eventKey: 'quiet', message: '', urgent: false }]);
  }
  const html = render(() => React.createElement(React.Fragment, null,
    React.createElement(ReadStateNotice, { state: 'ready' }), React.createElement('article', null, 'Synthetic retained item')));
  assert.equal(html, '<article>Synthetic retained item</article>');
});

test('errors, stale snapshots and unavailable reads retain notices, recovery, and announcement urgency', () => {
  for (const state of ['error', 'stale', 'unavailable']) {
    const html = render(ReadStateNotice, { state, message: 'Synthetic read status', children: React.createElement('button', null, '重新讀取') });
    assert.match(html, new RegExp(`data-testid="read-state-${state}"`));
    assert.doesNotMatch(html, /empty-list-card|read-state-empty|role="heading"/);
    assert.equal(html.split('Synthetic read status').length - 1, 1);
    assert.match(html, /<button>重新讀取<\/button>/);
    assert.deepEqual(announcements, [{ eventKey: `${state}:Synthetic read status`, message: 'Synthetic read status', urgent: state === 'error' }]);
  }
});

test('empty filtered or partial windows preserve owner-provided qualifiers and pagination controls', () => {
  const html = render(ReadStateNotice, { state: 'empty', message: '近期暫無待確認記錄',
    children: React.createElement(React.Fragment, null, React.createElement('span', null, '仍有較早記錄未載入'), React.createElement('button', null, '載入較早記錄')) });
  assert.match(html, /近期暫無待確認記錄/);
  assert.match(html, /仍有較早記錄未載入/);
  assert.match(html, /<button>載入較早記錄<\/button>/);
  assert.doesNotMatch(html, /全部完成|沒有任何記錄/);
});


test('multiple empty cards do not add page or section headings', () => {
  const html = render(() => React.createElement(React.Fragment, null,
    React.createElement('h1', null, 'Synthetic page title'),
    React.createElement(EmptyListCard, { title: '暫無持續關注' }),
    React.createElement(ReadStateNotice, { state: 'empty', message: '暫無已保存記錄' }),
    React.createElement(ReadStateNotice, { state: 'empty', title: '暫無待確認提案' })));
  assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
  assert.doesNotMatch(html, /role="heading"|<h[2-6]\b/);
});
