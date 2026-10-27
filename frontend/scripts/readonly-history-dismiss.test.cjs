const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const {createRequire} = require('node:module');
if (!process.env.JSDOM_MODULE) throw new Error('Supply JSDOM_MODULE for an existing jsdom installation.');
const {JSDOM} = require(process.env.JSDOM_MODULE);
const dom = new JSDOM('<!doctype html><html><body><main id="root"></main></body></html>', {pretendToBeVisual: true, url: 'http://localhost/history'});
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'ShadowRoot', 'Document']) global[key] = dom.window[key];
Object.defineProperty(global, 'navigator', {value: dom.window.navigator, configurable: true});
global.requestAnimationFrame = window.requestAnimationFrame.bind(window);
global.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
global.IS_REACT_ACT_ENVIRONMENT = true;
let networkCalls = 0;
global.fetch = () => {networkCalls++; throw new Error('Real network is forbidden');};
Object.defineProperty(HTMLElement.prototype, 'getClientRects', {configurable: true, value() {return this.isConnected && !this.closest('[hidden],[aria-hidden="true"]') ? [{}] : [];}});
const root = path.resolve(__dirname, '..'), req = createRequire(path.join(root, 'package.json'));
const React = req('react'), {createRoot} = req('react-dom/client'), native = req('react-native-web'), ts = req('typescript'), e = React.createElement;
const Module = require('node:module'), originalLoad = Module._load;
Module._load = function(name, ...args) {
  if (name === 'react-native') return native;
  if (name === 'react-native-safe-area-context') return {useSafeAreaInsets: () => ({top: 0, right: 0, bottom: 0, left: 0}), SafeAreaView: native.View};
  if (name.endsWith('/SafeAreaProviderCompat')) return {__esModule: true, default: p => p.children};
  if (name.endsWith('/MaterialCommunityIcon')) return {__esModule: true, default: () => null};
  return originalLoad.call(this, name, ...args);
};
const paper = req('react-native-paper'), Empty = () => null;
const Button = React.forwardRef((p, ref) => e(native.Pressable, {ref, onPress: p.onPress, disabled: p.disabled, accessibilityRole: 'button', accessibilityLabel: p.accessibilityLabel ?? p.label}, e(native.Text, null, p.label)));
let personal, profile, foreignOperation, editorDirty, writes, closeReads, navigationCalls, foreignUnmounts;
const cache = new Map();
// Actual readers, FormDialog, AppDialog, PreviewNavigationGuard and installed RN Web
// Modal/focus trap. Owners and routing are synthetic ports; decoration/motion are
// bounded doubles. This is not browser geometry, production HTTP or native QA.
function load(relative) {
  const filename = path.resolve(root, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = {exports: {}}; cache.set(filename, module);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {fileName: filename, compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}}).outputText;
  new Function('require', 'module', 'exports', code)(name => {
    if (name === 'react-native') return native;
    if (name === 'expo-router') return {usePathname: () => '/history', useRouter: () => ({push() {navigationCalls++;}}), Link: Empty};
    if (name === 'expo-router/react-navigation') return {useNavigation: () => ({dispatch() {navigationCalls++;}}), usePreventRemove() {}};
    if (name.endsWith('/production/usePersonalHistory')) return {usePersonalHistoryWorkspace: () => personal};
    if (name.endsWith('/production/VoiceMessage')) return {VoiceMessage: Empty};
    if (name.endsWith('/useContainerWidth')) return {useContainerWidth: () => ({width: 1100, ref: null, onLayout() {}})};
    if (name.endsWith('/appearance/BackgroundSurface')) return {BackgroundSurface: native.View};
    if (name.endsWith('/AppScrollView')) return {AppScrollView: native.ScrollView};
    if (name.endsWith('/ui')) return {AppButton: Button, SectionCard: native.View, SectionHeader: Empty};
    if (name.endsWith('/motion')) return {motionTokens: {dialog: {distance: 12, duration: 0}}, useMotionPreferences: () => ({enabled: false, epoch: 0}), MotionBackdrop: Empty};
    if (name.endsWith('/MotionPaperScope')) return {MotionPaperScope: p => p.children};
    if (name.endsWith('/useModalBackdrop')) return {useModalBackdrop: () => ({})};
    if (name.endsWith('/EmptyListCard')) return {EmptyListCard: Empty};
    if (name.endsWith('/ReadStateNotice')) return {ReadStateNotice: p => p.children};
    if (name.startsWith('.')) {
      const base = path.resolve(path.dirname(filename), name), found = [base, base + '.tsx', base + '.ts'].find(file => fs.existsSync(file) && fs.statSync(file).isFile());
      if (found) return load(path.relative(root, found));
    }
    return req(name);
  }, module, module.exports);
  return module.exports;
}
const {PersonalConversationHistoryView, PersonalNotificationContent} = load('src/components/history/PersonalHistoryViews.tsx');
const {ProfileHistoryView} = load('src/components/profile/ProfileHistoryView.tsx');
const {ManualFormDialog} = load('src/components/FormDialog.tsx');
const guard = load('src/preview/PreviewNavigationGuard.tsx'), {paperTheme} = load('src/theme.ts');
const renderer = createRoot(document.getElementById('root')), range = {from: null, to: null};
const byId = id => document.querySelector(`[data-testid="${id}"]`), labelled = label => document.querySelector(`[aria-label="${label}"]`);
const write = () => {writes++;};
function ForeignOwner() {
  guard.usePreviewLeaveGuard(false, foreignOperation !== null, 'child', undefined, true);
  React.useEffect(() => () => {foreignUnmounts++;}, []);
  return null;
}
function NavigationProbe() {
  const leave = guard.usePreviewNavigation();
  return e(Button, {label: 'Leave synthetic workspace', onPress: () => leave(() => {navigationCalls++;})});
}
function Editor() {guard.usePreviewLeaveGuard(editorDirty); return e(native.TextInput, {value: 'Synthetic unsaved draft', onChangeText: write});}
let renderCurrent;
async function setup(kind, state) {
  await React.act(async () => renderer.render(null));
  writes = 0; closeReads = 0; navigationCalls = 0; foreignUnmounts = 0; editorDirty = false;
  foreignOperation = state ? Object.freeze({state, opId: 'synthetic-original-operation', body: Object.freeze({original: 'Synthetic retained body'})}) : null;
  const scope = 'parent:synthetic-child', time = '2026-10-22T00:00:00Z';
  const message = {id: 'message-a', childId: 'synthetic-child', role: 'user', version: 1, createdAt: time, text: 'Synthetic original message', nextOffset: null, totalCharacters: 26, contentVersion: 'v1'};
  personal = {scopeKey: scope, childName: 'Synthetic child', access: 'active', online: true, busy: {},
    history: {state: 'ready', data: {query: '', matches: [{id: message.id, role: 'user', excerpt: 'Synthetic excerpt', createdAt: time}], scanned: 1, complete: true}},
    message: {state: 'unavailable', scopeKey: scope, data: null},
    notifications: {state: 'ready', data: {complete: true, items: [{id: 'notice-a', sentAt: time, scope: {kind: 'account'}, contents: [{channel: 'telegram', title: 'Synthetic notification', body: 'Synthetic full content', contentVersion: 'v1', sentAt: time}]}]}},
    actions: {readMessage() {personal.message = {state: 'ready', scopeKey: scope, data: message};}, closeMessage() {closeReads++; personal.message = {state: 'unavailable', scopeKey: scope, data: null};},
      searchHistory() {assert.fail('This close regression must not initiate a new search');}, moreMessage: write, loadNotifications: write, moreNotifications: write}};
  const revision = {version: 3, reason: 'Synthetic revision', data: {age: {kind: 'unknown'}, source: 'Synthetic source'}};
  profile = {access: 'editable', child: {id: 'synthetic-child'}, online: true, current: {version: 4}, history: [revision], historyOpen: true, operation: {state: 'none'}};
  const component = () => kind === 'conversation' ? e(PersonalConversationHistoryView, {searchText: '', dateRange: range, onPrepareQuestion: write})
    : kind === 'notification' ? e(PersonalNotificationContent, {owner: personal, searchText: '', dateRange: range})
      : kind === 'profile' ? e(ProfileHistoryView, {model: profile, actions: new Proxy({}, {get: () => write}), scopeKey: scope})
        : e(ManualFormDialog, {label: 'Edit synthetic record', scopeKey: scope}, e(Editor));
  renderCurrent = () => React.act(async () => renderer.render(e(paper.PaperProvider, {theme: paperTheme, settings: {rippleEffectEnabled: false}},
    e(guard.PreviewNavigationGuard, null, e(ForeignOwner), e(NavigationProbe), component()))));
  await renderCurrent();
}
async function click(node) {assert.ok(node); await React.act(async () => {node.focus(); node.click();}); await renderCurrent();}
async function escape() {await React.act(async () => document.dispatchEvent(new window.KeyboardEvent('keyup', {key: 'Escape', bubbles: true}))); await renderCurrent();}
const entries = {conversation: 'history-message-message-a', notification: 'personal-notification-entry', profile: 'profile-history-version-3'};
const titles = {conversation: '訊息原文', notification: '消息內容', profile: '檔案版本 3'};
for (const kind of Object.keys(entries)) test(`${kind}: local close and Escape preserve a foreign retained pending/unknown operation and its guard`, async () => {
  for (const [state, method] of [['saving', 'button'], ['unknown', 'escape']]) {
    await setup(kind, state);
    const operation = foreignOperation, body = operation.body, ownOperation = profile.operation, original = byId(entries[kind]);
    await click(original); assert.ok(byId('manual-form-dialog')); assert.equal(byId('leave-preview-dialog'), null);
    if (method === 'button') await click(labelled(`關閉${titles[kind]}`)); else await escape();
    assert.equal(byId('manual-form-dialog'), null, 'Only the local reader selection is dismissed');
    assert.equal(byId('leave-preview-dialog'), null); assert.equal(document.activeElement, original);
    assert.equal(foreignOperation, operation); assert.equal(foreignOperation.body, body); assert.equal(profile.operation, ownOperation);
    assert.equal(foreignUnmounts, 0); assert.equal(closeReads, kind === 'conversation' ? 1 : 0); assert.equal(writes, 0); assert.equal(networkCalls, 0);
    await renderCurrent(); assert.equal(byId('manual-form-dialog'), null, 'A re-render does not reopen the old selection');
    await click(labelled('Leave synthetic workspace'));
    assert.ok(byId('leave-preview-dialog'), 'The original foreign lease remains registered after local dismissal');
    assert.ok(labelled('留在此頁')); assert.equal(labelled('捨棄並離開'), null); assert.equal(navigationCalls, 0);
    await click(labelled('留在此頁')); assert.equal(foreignOperation, operation);
  }
});
test('the unchanged default editor still protects pending operations and genuine unsaved drafts', async () => {
  await setup('editor', 'unknown'); await click(labelled('Edit synthetic record'));
  await click(labelled('關閉Edit synthetic record'));
  assert.ok(byId('manual-form-dialog')); assert.ok(byId('leave-preview-dialog')); assert.ok(labelled('留在此頁'));
  assert.equal(labelled('捨棄並離開'), null); assert.equal(foreignOperation.opId, 'synthetic-original-operation');
  await click(labelled('留在此頁'));
  foreignOperation = null; editorDirty = true; await renderCurrent(); await escape();
  assert.ok(byId('manual-form-dialog')); assert.ok(byId('leave-preview-dialog')); assert.ok(labelled('捨棄並離開'));
  await click(labelled('繼續編輯')); assert.ok(byId('manual-form-dialog')); assert.equal(writes, 0); assert.equal(networkCalls, 0);
});
test.after(async () => {await React.act(async () => renderer.unmount()); Module._load = originalLoad; dom.window.close();});
