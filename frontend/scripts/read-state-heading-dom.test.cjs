const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const {execFileSync} = require('node:child_process');
if (!process.env.JSDOM_MODULE) throw new Error('Supply JSDOM_MODULE for an existing jsdom installation.');
const {JSDOM} = require(process.env.JSDOM_MODULE);
const dom = new JSDOM('<!doctype html><html><body><main id="root"></main></body></html>', {pretendToBeVisual: true, url: 'http://localhost/'});
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'ShadowRoot', 'Document']) global[key] = dom.window[key];
Object.defineProperty(global, 'navigator', {value: dom.window.navigator, configurable: true});
global.requestAnimationFrame = window.requestAnimationFrame.bind(window);
global.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
global.IS_REACT_ACT_ENVIRONMENT = true;
global.fetch = () => {throw new Error('Real network is forbidden');};
Object.defineProperty(HTMLElement.prototype, 'getClientRects', {configurable: true, value() {return this.isConnected && !this.closest('[hidden],[aria-hidden="true"]') ? [{}] : [];}});
const root = path.resolve(__dirname, '..'), req = Module.createRequire(path.join(root, 'package.json'));
const React = req('react'), {createRoot} = req('react-dom/client'), {renderToStaticMarkup} = req('react-dom/server');
const native = req('react-native-web'), ts = req('typescript'), e = React.createElement;
const originalLoad = Module._load;
Module._load = function(name, ...args) {
  if (name === 'react-native') return native;
  if (name === 'react-native-safe-area-context') return {useSafeAreaInsets: () => ({top: 0, right: 0, bottom: 0, left: 0}), SafeAreaView: native.View};
  if (name.endsWith('/SafeAreaProviderCompat')) return {__esModule: true, default: p => p.children};
  if (name.endsWith('/MaterialCommunityIcon')) return {__esModule: true, default: () => null};
  return originalLoad.call(this, name, ...args);
};
const paper = req('react-native-paper'), Empty = () => null, cache = new Map();
let owner, retryCalls = 0, searches = [];
const Button = React.forwardRef((p, ref) => e(native.Pressable, {ref, accessibilityRole: 'button', accessibilityLabel: p.accessibilityLabel ?? p.label, onPress: p.onPress, disabled: p.disabled}, e(native.Text, null, p.label)));
function source(relative) {
  return process.env.READ_STATE_SOURCE_REF
    ? execFileSync('git', ['show', `${process.env.READ_STATE_SOURCE_REF}:frontend/${relative}`], {cwd: root, encoding: 'utf8'})
    : fs.readFileSync(path.join(root, relative), 'utf8');
}
// Actual RN Web, Paper, notices, bell, AppDialog, FormDialog and reader components.
// Only data owners, navigation, decorative icons and motion are ports. This is
// DOM/SSR semantics, not browser layout, visible focus or screen-reader acceptance.
function load(relative) {
  const filename = path.resolve(root, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = {exports: {}}; cache.set(filename, module);
  const code = ts.transpileModule(source(relative), {fileName: filename, compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}}).outputText;
  new Function('require', 'module', 'exports', code)(name => {
    if (name === 'react-native') return native;
    if (name === 'expo-router') return {useRouter: () => ({push() {throw new Error('Navigation is outside this test');}})};
    if (name.endsWith('/production/usePersonalHistory')) return {usePersonalHistoryWorkspace: () => owner};
    if (name.endsWith('/PreviewNavigationGuard')) return {usePreviewNavigation: () => callback => callback()};
    if (name.endsWith('/ui')) return {AppButton: Button};
    if (name.endsWith('/ToolbarIconButton')) return {ToolbarIconButton: Button};
    if (name.endsWith('/AppScrollView')) return {AppScrollView: native.ScrollView};
    if (name.endsWith('/AppIcon') || name.endsWith('/VoiceMessage')) return {AppIcon: Empty, VoiceMessage: Empty};
    if (name.endsWith('/motion') || name.endsWith('/motion/preferences')) return {motionTokens: {dialog: {distance: 12, duration: 0}}, useMotionPreferences: () => ({enabled: false, epoch: 0}), MotionBackdrop: Empty, MotionDisclosure: p => p.expanded ? p.children : null};
    if (name.endsWith('/MotionPaperScope')) return {MotionPaperScope: p => p.children};
    if (name.endsWith('/useModalBackdrop')) return {useModalBackdrop: () => ({})};
    if (name.startsWith('.')) {
      const base = path.resolve(path.dirname(filename), name), found = [base, base + '.tsx', base + '.ts'].find(file => fs.existsSync(file) && fs.statSync(file).isFile());
      if (found) return load(path.relative(root, found));
    }
    return req(name);
  }, module, module.exports);
  return module.exports;
}
const {ReadStateNotice, READ_NOTICE_DELAY_MS} = load('src/components/ReadStateNotice.tsx');
const {NotificationBell} = load('src/components/NotificationBell.tsx');
const {PersonalConversationHistoryView, PersonalNotificationHistoryView} = load('src/components/history/PersonalHistoryViews.tsx');
const {HistoryMessageDetail} = load('src/components/history/HistoryMessageDetail.tsx');
const {FormDialog} = load('src/components/FormDialog.tsx');
const {paperTheme} = load('src/theme.ts');
const renderer = createRoot(document.getElementById('root'));
const dialogHeading = 'H1', dialogNoticeHeading = 'H2';
const headings = () => [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(node => !node.closest('[aria-hidden="true"]')).map(node => [node.tagName, node.textContent]);
const byLabel = label => document.querySelector(`[aria-label="${label}"]`);
const byId = id => document.querySelector(`[data-testid="${id}"]`);
async function render(content) {await React.act(async () => renderer.render(e(paper.PaperProvider, {theme: paperTheme, settings: {rippleEffectEnabled: false}}, content)));}
async function reset() {await render(null); retryCalls = 0; searches = [];}
async function settleLoading() {await React.act(async () => {await new Promise(resolve => setTimeout(resolve, READ_NOTICE_DELAY_MS + 30));});}
function fixture(state) {
  const read = {state, scopeKey: 'synthetic-scope', data: state === 'ready' || state === 'stale' ? {items: [], complete: true, nextCursor: null} : null};
  return {scopeKey: 'synthetic-scope', childName: '合成孩子', access: 'ready', online: true, busy: {notifications: false, history: false, message: false}, notificationUnavailable: false,
    notifications: read, history: {...read, data: state === 'ready' || state === 'stale' ? {query: '', matches: [], complete: true, scanned: 0, nextCursor: null} : null}, message: {state: 'unavailable', scopeKey: 'synthetic-scope', data: null},
    actions: {loadNotifications() {retryCalls++;}, searchHistory(query) {searches.push(query);}, closeMessage() {}, moreNotifications() {}, moreHistory() {}}};
}
test('installed RN Web maps an unlevelled header to h1, not an inferred section level', () => {
  assert.match(renderToStaticMarkup(e(paper.Text, {accessibilityRole: 'header'}, 'Original notice')), /<h1\b/);
});
test('titled notices default to h2 while message-only, empty and ready remain non-headings', async () => {
  await reset();
  for (const state of ['error', 'stale', 'unavailable']) {
    await render(e(ReadStateNotice, {state, title: '資料狀態', message: '原有細節'}));
    assert.deepEqual(headings(), [['H2', '資料狀態']]); assert.ok(document.body.textContent.includes('原有細節'));
    await render(e(ReadStateNotice, {state, message: '只有正文', headingLevel: 3})); assert.deepEqual(headings(), []);
  }
  for (const state of ['empty', 'ready']) {
    await render(e(ReadStateNotice, {state, title: '資料狀態', headingLevel: 3})); assert.deepEqual(headings(), []);
    assert.equal(!!byId('read-state-empty'), state === 'empty');
  }
});
test('delayed loading respects explicit heading level, scope reset and quiet refresh', async () => {
  await reset();
  await render(e(ReadStateNotice, {state: 'loading', title: '正在讀取', headingLevel: 3, scopeKey: 'synthetic-a'}));
  assert.deepEqual(headings(), []); await settleLoading(); assert.deepEqual(headings(), [['H3', '正在讀取']]);
  await render(e(ReadStateNotice, {state: 'loading', title: '正在讀取', headingLevel: 4, scopeKey: 'synthetic-b'}));
  assert.deepEqual(headings(), []); await settleLoading(); assert.deepEqual(headings(), [['H4', '正在讀取']]);
  await render(e(ReadStateNotice, {state: 'loading', title: '正在讀取', headingLevel: 3, scopeKey: 'synthetic-b', refreshing: true}));
  assert.deepEqual(headings(), []); assert.equal(byId('read-state-loading'), null);
});
test('actual notification bell keeps error h2 under dialog h1 and retains retry guards', async () => {
  await reset(); owner = fixture('error'); await render(e(NotificationBell));
  await React.act(async () => byLabel('開啟最近消息').click());
  assert.deepEqual(headings(), [[dialogHeading, '最近消息'], [dialogNoticeHeading, '暫時讀不到消息']]);
  await React.act(async () => byLabel('重新讀取消息').click()); assert.equal(retryCalls, 1);
  owner = {...owner, busy: {...owner.busy, notifications: true}}; await render(e(NotificationBell));
  assert.equal(byLabel('重新讀取消息').getAttribute('aria-disabled'), 'true');
  await React.act(async () => byLabel('重新讀取消息').click()); assert.equal(retryCalls, 1);
  owner = fixture('loading'); await render(e(NotificationBell));
  assert.ok(byId('recent-notification-loading')); assert.deepEqual(headings(), [[dialogHeading, '最近消息']]);
  owner = fixture('ready'); await render(e(NotificationBell));
  assert.ok(byId('notification-history-empty')); assert.deepEqual(headings(), [[dialogHeading, '最近消息']]);
  await React.act(async () => byLabel('關閉').click()); assert.deepEqual(headings(), []);
});
for (const kind of ['notifications', 'conversations']) test(`${kind} history uses h3 notices beneath its existing category and leaves empty results plain`, async () => {
  await reset(); const Component = kind === 'notifications' ? PersonalNotificationHistoryView : PersonalConversationHistoryView;
  const content = () => e(native.View, null, e(paper.Text, {accessibilityRole: 'header', 'aria-level': 2}, '歷史分類'), e(Component, {searchText: '', dateRange: {from: null, to: null}, onPrepareQuestion() {}}));
  owner = fixture('loading'); await render(content()); await settleLoading();
  assert.deepEqual(headings().map(([tag]) => tag), ['H2', 'H3']);
  owner = fixture('error'); await render(content()); assert.deepEqual(headings().map(([tag]) => tag), ['H2', 'H3']);
  owner = fixture('ready'); await render(content()); assert.deepEqual(headings(), [['H2', '歷史分類']]);
  assert.ok(byId(kind === 'notifications' ? 'notification-history-empty' : 'conversation-history-empty'));
});
test('message reader notices are h3 under inline h2 and h2 under actual form dialog h1', async () => {
  await reset();
  for (const state of ['error', 'loading']) {
    const read = {state, data: null, scopeKey: 'synthetic-scope'};
    await render(e(HistoryMessageDetail, {read, online: true})); if (state === 'loading') await settleLoading();
    assert.deepEqual(headings().map(([tag]) => tag), ['H2', 'H3']);
    await render(e(FormDialog, {visible: true, scopeKey: 'synthetic-scope', title: '訊息原文', onClose() {}}, e(HistoryMessageDetail, {read, online: true, embedded: true})));
    if (state === 'loading') await settleLoading();
    assert.deepEqual(headings().map(([tag]) => tag), [dialogHeading, dialogNoticeHeading]);
    await render(null);
  }
});
test('remaining scoped callers choose their containing heading level without changing page-root defaults', () => {
  for (const file of ['profile/ProfileHistoryView.tsx', 'growth/GrowthHistoryView.tsx']) {
    const text = source(`src/components/${file}`), notices = [...text.matchAll(/<ReadStateNotice\s([^>]+)>/g)];
    assert.ok(notices.length); for (const [, attrs] of notices) assert.match(attrs, /headingLevel=\{3\}/);
  }
  assert.match(source('src/components/care/CareReviewHistoryView.tsx'), /<ReadStateNotice headingLevel=\{history \? 3 : 2\} state=\{review.state/);
  for (const file of ['memory/MemoryReferenceView.tsx', 'contact/ContactView.tsx']) assert.doesNotMatch(source(`src/components/${file}`), /<ReadStateNotice headingLevel=\{3\}/);
});
test.after(async () => {await React.act(async () => renderer.unmount()); Module._load = originalLoad; dom.window.close();});
