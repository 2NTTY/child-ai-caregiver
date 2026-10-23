import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import ts from 'typescript';

// Actual component branches with shallow synthetic hosts. Not DOM/focus or browser QA.
const root = path.resolve(import.meta.dirname, '..'), require = createRequire(import.meta.url);
const nodes = value => !value || typeof value !== 'object' ? [] : Array.isArray(value) ? value.flatMap(nodes) : [value, ...nodes(value.props?.children), ...nodes(value.props?.action)];
const button = (tree, label) => nodes(tree).find(node => node.type === 'AppButton' && node.props.label === label);
function load(file) {
  const code = ts.transpileModule(readFileSync(path.join(root, file), 'utf8'), { fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    if (name === 'react') return { useId: () => 'synthetic', useRef: value => ({ current: value }), useState: value => [value, () => {}], useLayoutEffect() {} };
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name === 'react-native') return { Platform: { OS: 'web' }, View: 'View', Pressable: 'Pressable', StyleSheet: { create: value => value } };
    if (name === 'react-native-paper') return { Text: 'Text' };
    if (name === 'react-hook-form') return { Controller: 'Controller', useForm: () => ({}) };
    if (name === '@hookform/resolvers/zod') return { zodResolver: () => ({}) };
    if (name === 'zod') return require(name);
    if (name.endsWith('/channel-view-model')) return { blocksAnotherTelegramTest: () => false, telegramBeginAllowed: model => model.configured && !model.binding, channelTime: value => value };
    if (name.endsWith('/useContainerWidth')) return { useContainerWidth: () => ({ width: 900, ref: null, onLayout() {} }) };
    if (name.endsWith('/theme')) return { colors: {}, radius: {}, readingType: {}, spacing: {} };
    if (name.endsWith('/contact-styles')) return { contactStyles: {} };
    return new Proxy({}, { get: (_target, key) => String(key) });
  }, module, module.exports);
  return module.exports;
}
const channels = load('src/components/notifications/ChannelCards.tsx'), { ContactView } = load('src/components/contact/ContactView.tsx');
function channel(kind, patch = {}) {
  const calls = [], actions = Object.fromEntries(['refresh', 'stageBegin', 'stageConfirm', 'stageEnable', 'stageRevoke', 'stageTest', 'submit', 'useLatest', 'openStartLink'].map(key => [key, () => calls.push(key)]));
  const model = { readState: 'ready', online: true, locked: false, conflict: false, review: null, available: true, configured: true, workerEnabled: true,
    browserSupported: true, permission: 'granted', bindings: [], deliveries: [], binding: null, challenge: null, nextTestAt: null, ...patch };
  const render = () => channels[kind === 'push' ? 'WebPushSettingsCard' : 'TelegramSettingsCard']({ model, actions, scopeKey: 'synthetic-scope', confirmedOperation: null, production: true });
  return { model, calls, render };
}

test('ready push and Telegram cards have no persistent read control and perform no automatic write', () => {
  for (const kind of ['push', 'telegram']) {
    const h = channel(kind), tree = h.render();
    assert.equal(nodes(tree).some(node => node.type === 'AppButton' && /重新讀取/.test(node.props.label)), false);
    assert.deepEqual(h.calls, []);
  }
});

test('push permission and channel-conflict recovery retain only the original explicit read callback', () => {
  for (const [kind, patch, label] of [['push', { permission: 'denied' }, '重新讀取瀏覽器狀態'], ['push', { conflict: true }, '重新讀取瀏覽器狀態'], ['telegram', { conflict: true }, '重新讀取 Telegram 狀態']]) {
    const h = channel(kind, patch); button(h.render(), label).props.onPress(); assert.deepEqual(h.calls, ['refresh']);
    h.model.online = false; assert.equal(button(h.render(), label).props.disabled, true);
    h.model.online = true; h.model.review = { kind: 'revoke' }; assert.equal(button(h.render(), label).props.disabled, true);
  }
});

test('Telegram cross-app challenge retains its only candidate status read without beginning or confirming a bind', () => {
  const h = channel('telegram', { challenge: { id: 'challenge', version: 1, state: 'waiting', expiresAt: '2099-01-01T00:00:00Z', candidate: null } });
  button(h.render(), '重新讀取 Telegram 狀態').props.onPress(); assert.deepEqual(h.calls, ['refresh']);
  assert.equal(button(h.render(), '核對這個 Telegram 帳號'), undefined);
  h.model.locked = true; assert.equal(button(h.render(), '重新讀取 Telegram 狀態').props.disabled, true);
});

test('channel failed reads keep a contextual retry while cold loading has no extra read', () => {
  for (const kind of ['push', 'telegram']) {
    const h = channel(kind, { readState: 'failed' });
    const read = nodes(h.render()).find(node => node.type?.name === 'ReadState');
    button(read.type(read.props), '重新讀取本人渠道狀態').props.onPress(); assert.deepEqual(h.calls, ['refresh']);
    h.model.readState = 'loading'; const loading = nodes(h.render()).find(node => node.type?.name === 'ReadState');
    assert.equal(button(loading.type(loading.props), '重新讀取本人渠道狀態'), undefined);
  }
});

test('contact ready hides refresh, but failed, conflict, dirty-deferred and original-receipt checks remain gated', () => {
  const calls = [], model = { epoch: 1, scopeKey: 'synthetic-scope', userId: 'synthetic-user', childName: 'Synthetic child', page: null, online: true, busy: false,
    access: 'editable', load: 'ready', operation: 'none', pending: null, dirty: false }, actions = { refresh: () => calls.push('read') };
  const render = () => ContactView({ model, actions, onSettings() {}, onTask() {} });
  assert.equal(nodes(render()).some(node => node.type === 'AppButton' && /聯絡資料/.test(node.props.label)), false);
  for (const [patch, label] of [[{ load: 'error' }, '重試讀取聯絡資料'], [{ operation: 'conflict' }, '重試讀取聯絡資料'], [{ dirty: true }, '核對目前聯絡資料並保留選項'], [{ pending: { reviewed: false, confirmed: false, labels: [] } }, '先查原收據及更新聯絡資料']]) {
    Object.assign(model, { load: 'ready', operation: 'none', pending: null, dirty: false, online: true, access: 'editable' }, patch);
    button(render(), label).props.onPress(); assert.equal(calls.at(-1), 'read');
    model.online = false; assert.equal(button(render(), label).props.disabled, true);
    model.online = true; model.access = 'lost'; assert.equal(button(render(), label).props.disabled, true);
  }
  assert.equal(calls.length, 4);
});
