const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const sourceRoot = path.resolve(process.env.SETTINGS_PARENT_SOURCE || path.join(__dirname, '../..'));
const req = createRequire(path.join(sourceRoot, 'frontend/package.json'));
if (!process.env.JSDOM_MODULE) throw new Error('Supply JSDOM_MODULE for an existing installation; no product dependency is added.');
const { JSDOM } = require(process.env.JSDOM_MODULE);
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://synthetic.invalid/settings' });
Object.assign(global, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
let network = 0;
global.fetch = () => { network++; throw new Error('Real network forbidden'); };
const React = req('react'), { act } = React, { createRoot } = req('react-dom/client'), ts = req('typescript');
const h = React.createElement, fields = new Map(), guards = [];
const appStateListeners = new Set();
// Real view components, React hooks, RHF and schemas. UI/motion/layout and owner ports
// are synthetic; DOM order and callbacks are tested, not browser pixels or transport.
const block = ({ children, testID, accessibilityRole, accessibilityLiveRegion }) => h('div', { 'data-testid': testID, role: accessibilityRole, 'aria-live': accessibilityLiveRegion }, children);
const AppButton = ({ label, accessibilityLabel = label, onPress, variant = 'primary', density = 'standard', disabled, loading }) => h('button', {
  'aria-label': accessibilityLabel, 'data-variant': variant, 'data-density': density, disabled: disabled || loading, onClick: onPress,
}, label);
function Field(props) {
  const label = props.accessibilityLabel || props.label || '通知時區'; fields.set(label, props);
  return h('input', { ref: props.ref, 'aria-label': label, value: props.value, type: props.secureTextEntry ? 'password' : 'text', disabled: props.disabled,
    onBlur: props.onBlur, onChange: event => (props.onChangeText || props.onChange)(event.target.value) });
}
function Check(props) {
  const label = props.accessibilityLabel || props.label; fields.set(label, props);
  return h('label', null, h('input', { ref: props.ref, type: 'checkbox', 'aria-label': label, checked: props.checked ?? props.value,
    disabled: props.disabled, onChange: event => (props.onChange || props.onValueChange)(event.target.checked) }), props.label, props.description);
}
const SectionHeader = ({ title, subtitle, action }) => h('header', null, h('h2', null, title), action, subtitle && h('p', null, subtitle));
const Dialog = ({ visible, children }) => visible ? h('section', { role: 'dialog' }, children) : null;
Dialog.Title = Dialog.Content = Dialog.Actions = block;
const noop = () => {};
const never = () => { throw new Error('Unrelated settings owner must not mount in this view test'); };
const cache = new Map();
function compile(relative) {
  const filename = path.resolve(sourceRoot, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = { exports: {} }; cache.set(filename, module);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('require', 'module', 'exports', code + (relative.endsWith('/SettingsDomains.tsx') ? '\nexports.TestPersonalContext = PersonalContext;' : ''))(name => {
    if (name === 'react-native') return { View: block, StyleSheet: { create: value => value }, Platform: { OS: 'web', select: values => values.web ?? values.default },
      AppState: { addEventListener: (_event, listener) => { appStateListeners.add(listener); return { remove: () => appStateListeners.delete(listener) }; } } };
    if (name === 'react-native-paper') return { Text: block, ActivityIndicator: () => h('span', null, 'Busy'), MD3LightTheme: { colors: {}, fonts: {} }, configureFonts: value => value };
    if (name.endsWith('/ui')) return { AppButton, AppSelect: Field, AppTextField: Field, SectionHeader, OperationPill: ({ state }) => h('span', { 'data-operation': state }, state) };
    if (name.endsWith('/SettingsSection')) return { SettingsSection: block };
    if (name.endsWith('/DateTimeFields')) return { AppTimeField: Field, AppTimeZoneSelect: Field };
    if (name.endsWith('/AppCheckbox')) return { AppCheckbox: Check };
    if (name.endsWith('/AppSwitch')) return { Switch: Check };
    if (name.endsWith('/AppDialog')) return { AppDialog: Dialog };
    if (name.endsWith('/AppStatusBadge')) return { AppStatusBadge: ({ label }) => h('span', null, label) };
    if (name.endsWith('/ReadStateNotice')) return { ReadStateNotice: ({ message }) => h('p', null, message) };
    if (name.endsWith('/StatusAnnouncement')) return { StatusAnnouncement: () => null };
    if (name.endsWith('/FormErrorSummary')) return { FormErrorSummary: ({ entries }) => h('div', { 'data-errors': true }, entries.map(entry => h('p', { key: entry.field }, entry.message))),
      FormFieldMessage: ({ error, help }) => h('span', null, error || help) };
    if (name.endsWith('/useContainerWidth')) return { useContainerWidth: () => ({ width: 390, ref: null, onLayout: noop }) };
    if (name.endsWith('/PreviewNavigationGuard')) return { usePreviewLeaveGuard: (dirty, pending) => guards.push({ dirty, pending }) };
    if (name === './useDomainEnvironment') return { useDomainEnvironment: never, useDomainWriteGuard: (dirty, pending) => guards.push({ dirty, pending }) };
    if (name === './ProductionProvider') return { useProduction: never };
    if (/^\.\/useProduction/.test(name)) return new Proxy({}, { get: () => never });
    if (name.endsWith('/ChannelCards')) return { WebPushSettingsCard: never, TelegramSettingsCard: never };
    if (name.endsWith('/motion')) return { MotionFeedback: block, MotionReveal: ({ children, value }) => children(value) };
    if (!name.startsWith('.')) return req(name);
    const target = path.resolve(path.dirname(filename), name);
    const resolved = fs.existsSync(target) ? target : fs.existsSync(target + '.ts') ? target + '.ts' : target + '.tsx';
    return compile(path.relative(sourceRoot, resolved));
  }, module, module.exports);
  return module.exports;
}
const { ProductionNotificationPreferences, TestPersonalContext } = compile('frontend/src/production/SettingsDomains.tsx');
const { ModelSettingsView } = compile('frontend/src/components/model-settings/ModelSettingsView.tsx');
const { modelLimitFields } = compile('frontend/src/components/model-settings/model-settings-form.ts');
const root = createRoot(document.getElementById('root'));
const buttons = () => [...document.querySelectorAll('button')];
const button = label => { const node = buttons().find(node => node.getAttribute('aria-label') === label); assert.ok(node, label); return node; };
const field = label => { const node = [...document.querySelectorAll('input')].find(node => node.getAttribute('aria-label') === label); assert.ok(node, label); return node; };
const copy = () => document.body.textContent;
const before = (first, second) => !!(first.compareDocumentPosition(second) & window.Node.DOCUMENT_POSITION_FOLLOWING);
const textNode = text => [...document.querySelectorAll('div,p,span')].find(node => node.childNodes.length === 1 && node.textContent === text);
async function change(label, value) { await act(async () => { const props = fields.get(label); assert.ok(props, label); (props.onChangeText || props.onChange || props.onValueChange)(value); }); }
async function click(label) { await act(async () => button(label).click()); }
async function clear() { await act(async () => root.render(null)); fields.clear(); guards.length = 0; }
function notification(overrides = {}) {
  const calls = [], editing = [];
  const domain = { scopeKey: 'synthetic-parent:1', setDraftEditing: value => editing.push(value), preferences: { version: 7, timeZone: 'Asia/Hong_Kong', quietStart: '22:00', quietEnd: '08:00', allowAppointmentDuringQuiet: false },
    online: true, busy: false, original: null, fresh: true, notice: '目前通知偏好已讀取。',
    refresh: () => calls.push(['refresh']), save: (...args) => calls.push(['save', ...args]), confirmOriginal: value => calls.push(['confirm', value]), retryOriginal: () => calls.push(['retry']), ...overrides };
  return { calls, domain, editing, render: async () => act(async () => root.render(h(TestPersonalContext.Provider, { value: { preferences: domain } }, h(ProductionNotificationPreferences)))) };
}
function model(overrides = {}) {
  const calls = [], editing = [], usage = { day: '2026-10-22', attempts: 2, inputTokens: 30, outputTokens: 20, cachedTokens: 0, unknownUsageAttempts: 1 };
  const settings = { version: 7, mode: 'personal', provider: 'vertex', model: 'gemini-3.1-flash-lite', keyConfigured: true, backgroundEnabled: false,
    dailyLimit: 100, maxModelCalls: 4, maxQueryEmbeddings: 2, updatedAt: null };
  const state = { scopeKey: 'synthetic-parent', accountName: '合成家長', serverLabel: '/api', online: true, authorized: true, busy: null, operation: 'none', notice: '',
    needsRead: false, formRevision: 0, secretRevision: 0, keyCheck: null, originalOperationId: null,
    catalog: { provider: 'vertex', models: [{ id: settings.model, provider: 'vertex', label: 'Synthetic model', capabilities: { tools: true, image: false, audio: false, textStreaming: true } }] },
    snapshot: { enabled: true, platformAvailable: true, personalAvailable: true, settings, personalGlobalLimit: 500, usage: { platform: usage, personal: usage } }, ...overrides };
  const actions = { setDraftEditing: value => editing.push(value), refresh: () => calls.push(['refresh']), save: command => calls.push(['save', command]), check: version => calls.push(['check', version]),
    refreshCatalog: version => calls.push(['catalog', version]), selectProvider: value => calls.push(['provider', value]) };
  return { state, calls, editing, render: async (active = true) => act(async () => root.render(h(ModelSettingsView, { model: state, actions, active }))) };
}

test('notification controls have no ready refresh, but retain dirty-deferred reads and unchanged save confirmation', async () => {
  await clear(); const f = notification(); await f.render();
  assert.equal(buttons().some(node => node.getAttribute('aria-label') === '重新讀取通知偏好'), false);
  assert.doesNotMatch(copy(), /目前版本 7/); assert.match(copy(), /設定本人的安靜時段，不會綁定通知渠道或授權發送/);
  assert.ok(before(field('安靜時段開始'), field('安靜時段結束'))); assert.ok(before(field('安靜時段結束'), field('通知時區')));
  assert.ok(before(button('核對通知偏好'), textNode(f.domain.notice)));
  await change('安靜時段開始', '21:30');
  const refresh = button('重新讀取通知偏好');
  assert.equal(refresh.textContent, '重新讀取'); assert.equal(refresh.dataset.variant, 'quiet'); assert.equal(refresh.dataset.density, 'compact'); assert.equal(refresh.parentElement.tagName, 'HEADER');
  await click('重新讀取通知偏好'); assert.deepEqual(f.calls, [['refresh']]);
  await click('核對通知偏好');
  assert.match(copy(), /待確認 · 尚未保存 · 版本 7/); assert.deepEqual(f.calls, [['refresh']]);
  await click('返回修改'); assert.equal(field('安靜時段開始').value, '21:30');
  await click('核對通知偏好'); await click('確認保存本人偏好');
  assert.equal(f.calls[1][0], 'save'); assert.equal(f.calls[1][1].quietStart, '21:30'); assert.equal(f.calls[1][2], 7); assert.ok(guards.some(value => value.dirty));
});

test('notification errors and original-operation recovery stay before the locked form and retain their exact callbacks', async () => {
  await clear(); const f = notification({ fresh: false, notice: '通知偏好版本已改變；請讀取目前版本後重新核對。' }); await f.render();
  assert.ok(before(textNode(f.domain.notice), field('安靜時段開始'))); assert.equal(field('安靜時段開始').disabled, true);
  assert.equal(button('重新讀取通知偏好').disabled, false); await click('重新讀取通知偏好');
  f.domain.original = { confirmed: false, reviewed: false, consent: false, input: { ...f.domain.preferences, expectedVersion: 7 } };
  f.domain.notice = '保存結果待查核；請先查原收據及讀取目前偏好。'; await f.render();
  assert.ok(before(button('查原收據及目前狀態'), field('安靜時段開始'))); assert.equal(button('明確重試原操作').disabled, true);
  await click('查原收據及目前狀態'); assert.deepEqual(f.calls, [['refresh'], ['refresh']]);
  f.domain.original.reviewed = true; await f.render();
  await change('我已核對目前資料，同意以原內容及版本重試', true); assert.deepEqual(f.calls.at(-1), ['confirm', true]);
  f.domain.original.consent = true; await f.render(); await click('明確重試原操作'); assert.deepEqual(f.calls.at(-1), ['retry']);
  f.domain.original.confirmed = true; await f.render(); assert.equal(buttons().some(node => node.textContent === '明確重試原操作'), false);
  f.domain.online = false; await f.render(); assert.equal(button('查原收據及目前狀態').disabled, true); assert.match(copy(), /目前離線/);
  assert.equal(buttons().some(node => node.getAttribute('aria-label') === '重新讀取通知偏好'), false);
});

test('notification validation and missing reads remain visible without fabricating a saved state', async () => {
  await clear(); const f = notification(); await f.render();
  await change('安靜時段結束', '22:00'); await click('核對通知偏好');
  assert.match(copy(), /開始及結束時間須不同/); assert.equal(f.calls.length, 0); assert.ok(before(document.querySelector('[data-errors]'), field('安靜時段開始')));
  await clear(); const missing = notification({ preferences: null, fresh: false, notice: '', busy: true }); await missing.render();
  assert.match(copy(), /正在讀取通知偏好/); assert.equal(button('核對通知偏好').disabled, true);
  missing.domain.busy = false; await missing.render(); assert.match(copy(), /尚未讀取通知偏好，請重新讀取/); assert.equal(button('重新讀取通知偏好').disabled, false);
});

test('model copy prioritizes personal choices while preserving advanced limits, endpoint, consent and capability boundaries', async () => {
  await clear(); const f = model(); await f.render();
  assert.doesNotMatch(copy(), /ADC|本地開發|接線|metadata|最後讀到的版本|管理政策版本/);
  assert.match(copy(), /上次讀取：我的個人密鑰/); assert.match(copy(), /連接服務：\/api/);
  assert.match(copy(), /知識搜尋可另填下方 Gemini 向量密鑰/); assert.match(copy(), /不會借用平台額度/);
  assert.doesNotMatch(copy(), /Vertex Express key 目前不支援/);
  assert.match(copy(), /不接受服務帳戶 JSON/); assert.match(copy(), /不會自動替換模型/); assert.match(copy(), /回覆也不一定會逐字顯示/);
  assert.match(copy(), /並加密儲存/); assert.match(copy(), /Google/); assert.match(copy(), /必要對話/);
  assert.equal(field('個人 API 密鑰').type, 'password'); assert.equal(field('聊天模型 ID').value, f.state.snapshot.settings.model);
  for (const [, label] of modelLimitFields) assert.ok(field(label)); assert.ok(field('另行允許背景任務使用此密鑰'));
  assert.equal(buttons().some(node => node.getAttribute('aria-label') === '重新讀取模型設定'), false);
  assert.equal(buttons().some(node => node.textContent === '檢查已保存密鑰'), false);
  assert.deepEqual(f.calls, []); assert.equal(button('保存模型設定').disabled, true);
  await change('我同意個人服務的費用及資料外送', true); await change('個人每日呼叫上限', '80');
  const refresh = button('重新讀取模型設定'); assert.equal(refresh.textContent, '重新讀取'); assert.equal(refresh.dataset.density, 'compact');
  await click('重新讀取模型設定'); assert.deepEqual(f.calls.at(-1), ['refresh']); await click('保存模型設定');
  assert.equal(f.calls.at(-1)[0], 'save'); assert.equal(f.calls.at(-1)[1].expectedVersion, 7); assert.equal(f.calls.at(-1)[1].dailyLimit, 80);
  assert.equal(f.calls.at(-1)[1].model, f.state.snapshot.settings.model); assert.equal('apiKey' in f.calls.at(-1)[1], false);
});

test('model unknown, metadata-unavailable and read failures retain recovery instead of success or credential replay', async () => {
  await clear(); const f = model({ originalOperationId: 'synthetic-original', operation: 'unknown', needsRead: true,
    notice: '保存結果未知；密鑰已清除。請查回原操作及目前設定，系統不會重播密鑰。', keyCheck: { version: 7, status: 'unavailable', reason: 'metadata_unsupported' } }); await f.render();
  assert.match(copy(), /保存結果未知/); assert.match(copy(), /可直接到助手試用已保存的模型/);
  assert.match(copy(), /上次讀取：我的個人密鑰/); assert.doesNotMatch(copy(), /目前使用：/);
  assert.equal(buttons().some(node => node.getAttribute('aria-label') === '重新讀取模型設定'), false);
  assert.equal(button('保存模型設定').disabled, true); await click('查回原操作及目前設定'); assert.deepEqual(f.calls, [['refresh']]); assert.equal(field('個人 API 密鑰').value, '');
  f.state.snapshot = null; f.state.originalOperationId = null; f.state.notice = '模型設定未能確認，請核對連線後重新讀取。'; f.state.operation = 'failed'; await f.render();
  assert.match(copy(), /模型設定未能確認/); assert.equal(button('重新讀取模型設定').disabled, false); assert.equal(buttons().some(node => node.textContent === '保存模型設定'), false);
});

test('compatible model form submits both credentials once and clears them on save, route leave and background', async () => {
  await clear(); const f = model(); await f.render();
  await change('模型服務', 'openai-compatible');
  await change('API 基底地址', 'https://api.synthetic.invalid/v1');
  await change('聊天模型 ID', 'vendor/model-1');
  await change('個人 API 密鑰', 'synthetic-chat-key');
  await change('Gemini 向量密鑰', 'synthetic-embedding-key');
  await change('我同意個人服務的費用及資料外送', true);
  assert.equal(field('Gemini 向量密鑰').type, 'password');
  assert.match(copy(), /你填寫的 API 服務/);
  assert.equal(button('保存模型設定').disabled, false);
  await click('保存模型設定');
  const saves = f.calls.filter(call => call[0] === 'save');
  assert.equal(saves.length, 1);
  assert.equal(saves[0][1].provider, 'openai-compatible');
  assert.equal(saves[0][1].baseUrl, 'https://api.synthetic.invalid/v1');
  assert.equal(saves[0][1].apiKey, 'synthetic-chat-key');
  assert.equal(saves[0][1].embeddingApiKey, 'synthetic-embedding-key');
  assert.equal(saves[0][1].expectedVersion, 7);
  assert.equal(field('個人 API 密鑰').value, '');
  assert.equal(field('Gemini 向量密鑰').value, '');
  await change('個人 API 密鑰', 'unsent-chat-key');
  await change('Gemini 向量密鑰', 'unsent-vector-key');
  await f.render(false); assert.equal(guards.at(-1).dirty, false); await f.render(true);
  assert.equal(field('個人 API 密鑰').value, '');
  assert.equal(field('Gemini 向量密鑰').value, '');
  await change('個人 API 密鑰', 'unsent-chat-key');
  await change('Gemini 向量密鑰', 'unsent-vector-key');
  await act(async () => { for (const listener of appStateListeners) listener('background'); });
  assert.equal(field('個人 API 密鑰').value, '');
  assert.equal(field('Gemini 向量密鑰').value, '');
  assert.equal(f.calls.filter(call => call[0] === 'save').length, 1);
  assert.equal(network, 0);
});

test('notification review survives equal reads and busy locking without losing its focused DOM node', async () => {
  await clear(); const f = notification(); await f.render();
  await click('核對通知偏好'); assert.equal(f.editing.at(-1), true);
  const confirm = button('確認保存本人偏好'); confirm.focus();
  f.domain.busy = true; await f.render();
  assert.equal(button('確認保存本人偏好'), confirm); assert.equal(confirm.disabled, true);
  assert.equal(document.activeElement, confirm); await click('確認保存本人偏好'); assert.equal(f.calls.length, 0);
  f.domain.preferences = Object.fromEntries(Object.entries(f.domain.preferences).reverse()); f.domain.busy = false; await f.render();
  assert.equal(button('確認保存本人偏好'), confirm); assert.equal(document.activeElement, confirm);
  assert.equal(confirm.disabled, false); assert.match(copy(), /待確認 · 尚未保存 · 版本 7/);
  await click('返回修改'); assert.equal(f.editing.at(-1), false);
});

test('notification basis changes invalidate review but retain the draft; identity and access loss clear it', async () => {
  await clear(); const f = notification(); await f.render();
  await change('安靜時段開始', '21:30'); assert.equal(f.editing.at(-1), true); await click('核對通知偏好');
  f.domain.preferences = { ...f.domain.preferences, version: 8, quietStart: '20:00' }; await f.render();
  assert.equal(buttons().some(node => node.textContent === '確認保存本人偏好'), false);
  assert.match(copy(), /原確認已失效/); assert.equal(field('安靜時段開始').value, '21:30'); assert.equal(f.calls.length, 0);
  await click('核對通知偏好'); assert.match(copy(), /待確認 · 尚未保存 · 版本 8/);
  f.domain.original = { confirmed: false, reviewed: false, consent: false, input: { ...f.domain.preferences, expectedVersion: 8 } }; await f.render();
  assert.equal(button('確認保存本人偏好').disabled, true); await click('確認保存本人偏好'); assert.equal(f.calls.length, 0);
  f.domain.original = null; f.domain.scopeKey = 'synthetic-other:2'; await f.render();
  assert.equal(field('安靜時段開始').value, '20:00'); assert.doesNotMatch(copy(), /待確認/); assert.equal(f.editing.at(-1), false);
  await change('安靜時段開始', '21:00'); await click('核對通知偏好');
  f.domain.preferences = null; f.domain.fresh = false; await f.render();
  assert.equal(field('安靜時段開始').value, '22:00'); assert.doesNotMatch(copy(), /待確認/); assert.equal(button('核對通知偏好').disabled, true);
});

test('model deletion pins the reviewed basis and preserves the same dialog through a same-basis read', async () => {
  await clear(); const f = model(); await f.render(); await click('刪除個人密鑰');
  assert.equal(f.editing.at(-1), true); const dialog = document.querySelector('[role=dialog]');
  await change('我確認刪除密鑰並停用 AI', true); const confirm = button('確認刪除並停用'); confirm.focus();
  f.state.busy = 'read'; f.state.secretRevision++; await f.render();
  assert.equal(document.querySelector('[role=dialog]'), dialog); assert.equal(document.activeElement, confirm); assert.equal(confirm.disabled, true);
  await click('確認刪除並停用'); assert.equal(f.calls.length, 0);
  f.state.snapshot = structuredClone(f.state.snapshot); f.state.busy = null; f.state.secretRevision++; await f.render();
  assert.equal(document.querySelector('[role=dialog]'), dialog); assert.equal(document.activeElement, confirm);
  assert.equal(field('我確認刪除密鑰並停用 AI').checked, true); assert.equal(confirm.disabled, false);
  await click('確認刪除並停用'); assert.equal(f.calls.length, 1); assert.equal(f.calls[0][1].expectedVersion, 7);
  assert.equal(f.calls[0][1].removeKey, true); assert.equal('apiKey' in f.calls[0][1], false);
});

test('model newer settings, unknown results, revoked access and identity changes never inherit delete consent', async () => {
  for (const changeState of [
    state => { state.snapshot = { ...state.snapshot, settings: { ...state.snapshot.settings, version: 8 } }; state.formRevision++; },
    state => { state.snapshot = { ...state.snapshot, settings: { ...state.snapshot.settings, dailyLimit: 50 } }; },
    state => { state.needsRead = true; state.operation = 'unknown'; state.originalOperationId = 'synthetic-original'; },
    state => { state.authorized = false; state.snapshot = null; },
  ]) {
    await clear(); const f = model(); await f.render(); await click('刪除個人密鑰'); await change('我確認刪除密鑰並停用 AI', true);
    changeState(f.state); await f.render(); assert.equal(document.querySelector('[role=dialog]'), null); assert.match(copy(), /刪除確認已失效/); assert.equal(f.calls.length, 0);
    if (f.state.snapshot && !f.state.needsRead) { await click('刪除個人密鑰'); assert.equal(field('我確認刪除密鑰並停用 AI').checked, false); assert.equal(button('確認刪除並停用').disabled, true); }
  }
  await clear(); const f = model(); await f.render(); await change('個人每日呼叫上限', '80'); await click('刪除個人密鑰');
  f.state.scopeKey = 'synthetic-other:2'; await f.render(); assert.equal(document.querySelector('[role=dialog]'), null); assert.equal(field('個人每日呼叫上限').value, '100'); assert.equal(f.calls.length, 0);
});

test.after(async () => { await act(async () => root.unmount()); dom.window.close(); assert.equal(network, 0); });
