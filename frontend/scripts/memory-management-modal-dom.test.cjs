const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
if (!process.env.JSDOM_MODULE) throw new Error('Supply JSDOM_MODULE for an existing jsdom installation.');
const { JSDOM } = require(process.env.JSDOM_MODULE);
const dom = new JSDOM('<!doctype html><html><body><main id="root"></main></body></html>', { pretendToBeVisual: true, url: 'http://localhost/memory' });
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'ShadowRoot', 'Document']) global[key] = dom.window[key];
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
global.IS_REACT_ACT_ENVIRONMENT = true;
// Layout is not available in jsdom; this port only distinguishes connected/hidden nodes.
Object.defineProperty(HTMLElement.prototype, 'getClientRects', { configurable: true, value() { return this.isConnected && !this.closest('[hidden],[aria-hidden="true"]') ? [{}] : []; } });
const root = path.resolve(__dirname, '../..'), req = createRequire(path.join(root, 'frontend/package.json'));
const React = req('react'), { createRoot } = req('react-dom/client'), native = req('react-native-web'), ts = req('typescript');
const e = React.createElement;
let networkCalls = 0, containerWidth = 1440;
const originalFetch = global.fetch;
global.fetch = () => { networkCalls++; throw new Error('Real network is forbidden in this synthetic test.'); };
// RN Web's installed Modal, focus trap and portal are real. Appearance and native inputs
// are bounded host ports; the Memory renderer, forms, RHF, owner, runtime and guard are real.
function Dialog({ visible, onDismiss, onClosed, children, testID, accessibilityLabel }) {
  return e(native.Modal, { visible, transparent: true, animationType: 'none', onRequestClose: onDismiss, onDismiss: onClosed, 'aria-label': accessibilityLabel },
    e('section', { 'data-testid': testID }, children));
}
Dialog.Title = p => e('h2', null, p.children);
Dialog.Content = Dialog.ScrollArea = Dialog.Actions = p => e('div', null, p.children);
const Button = React.forwardRef(({ label, accessibilityLabel, onPress, disabled }, ref) => e('button', { ref, disabled, 'aria-label': accessibilityLabel, onClick: onPress }, label));
const Field = React.forwardRef(({ label, multiline, value, onChangeText, disabled }, ref) => e(multiline ? 'textarea' : 'input', { ref, 'aria-label': label, value, disabled, onChange: event => onChangeText(event.target.value) }));
const Select = ({ label, value, options, onChange, disabled }) => e('select', { 'aria-label': label, value, disabled, onChange: event => onChange(event.target.value) }, options.map(o => e('option', { key: o.value, value: o.value }, o.label)));
const Checkbox = ({ label, checked, onChange, disabled }) => e('input', { type: 'checkbox', 'aria-label': label, checked, disabled, onChange: event => onChange(event.target.checked) });
const Context = React.createContext(null), productionOwner = { setDomainPending() {} }, cache = new Map();
function load(relative) {
  const filename = path.resolve(root, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = { exports: {} }; cache.set(filename, module);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('require', 'module', 'exports', code)(name => {
    if (name === 'react-native') return native;
    if (name === 'react-native-paper') return { Text: p => e('p', null, p.children) };
    if (name.endsWith('/AppDialog')) return { AppDialog: Dialog };
    if (name.endsWith('/AppScrollView')) return { AppScrollView: p => e('div', null, p.children) };
    if (name.endsWith('/ui')) return { AppButton: Button, AppTextField: Field, AppSelect: Select,
      TabToolbar: ({ children, actions, stacked }) => e('header', { 'data-testid': 'memory-toolbar', 'data-stacked': String(stacked) }, children, e('div', { 'data-testid': 'memory-toolbar-actions' }, actions)),
      UnderlineTabs: ({ items, value, onChange }) => e('div', { role: 'tablist' }, items.map(item => e('button', { key: item.key, role: 'tab', 'aria-selected': item.key === value, onClick: () => onChange(item.key) }, item.label))),
      AppTabPanel: ({ active, children }) => active ? e('section', { role: 'tabpanel' }, children) : null };
    if (name.endsWith('/MemoryReferenceWorkspace')) return { useMemoryReferenceWorkspace: () => React.useContext(Context)?.value };
    if (name.endsWith('/SettingsDomains')) return { useProductionSettingsDomains: () => ({ family: { model: { selfUserId: 'user-a', loadState: 'ready', families: [] } } }) };
    if (name.endsWith('/PageFrame')) return { PageFrame: ({ children }) => e('main', null, children) };
    if (name.endsWith('/BackgroundSurface')) return { BackgroundSurface: ({ children }) => e('div', null, children) };
    if (name.endsWith('/ReadStateNotice')) return { ReadStateNotice: ({ title, children }) => e('div', null, title, children) };
    if (name.endsWith('/useContainerWidth')) return { useContainerWidth: () => ({ width: containerWidth, ref: null, onLayout() {} }) };
    if (/\/(AppIcon|AppStatusBadge|EmptyListCard|HistoryMessageDetail|PersistentWorkCards)$/.test(name)) return new Proxy({}, { get: () => () => null });
    if (name.endsWith('/AppCheckbox')) return { AppCheckbox: Checkbox };
    if (name.endsWith('/DateTimeFields')) return { AppDateTimeField: ({ onChange, ...props }) => e(Field, { ...props, onChangeText: onChange }) };
    if (name.endsWith('/TaskKnowledgeDomains')) return { useProductionTaskKnowledgeMemory: () => React.useContext(Context) };
    if (name.endsWith('/ProductionProvider')) return { useProductionOwner: () => productionOwner,
      useProduction: () => ({ model: { children: [{ id: activeScope === 'scope-a' ? 'child-a' : 'child-b' }], selectedChildId: activeScope === 'scope-a' ? 'child-a' : 'child-b' }, actions: {}, online: true, recordsState: { children: [] }, auth: 'signedIn', userId: 'user-a', scopeKey: activeScope }) };
    if (name.endsWith('/theme')) return { colors: {}, radius: {}, spacing: {}, typeScale: {}, readingType: {}, workspaceType: {} };
    if (name.endsWith('/browser-history-guard')) return { guardBrowserHistory: () => () => {} };
    if (name.endsWith('/production/routes')) return { isProductionRouteConnected: () => true };
    if (name === 'expo-router') return { usePathname: () => '/memory', useRouter: () => ({}), Link: 'a' };
    if (name === 'expo-router/react-navigation') return { useNavigation: () => ({}), usePreventRemove() {} };
    if (name.startsWith('.')) {
      const base = path.resolve(path.dirname(filename), name);
      const found = [base, base + '.tsx', base + '.ts'].find(p => fs.existsSync(p) && fs.statSync(p).isFile());
      if (found) return load(path.relative(root, found));
    }
    return req(name);
  }, module, module.exports);
  return module.exports;
}
const { PreviewNavigationGuard } = load('frontend/src/preview/PreviewNavigationGuard.tsx');
const { useTaskKnowledgeMemoryManagement } = load('frontend/src/production/task-knowledge-memory-management.ts');
const { useTaskKnowledgeRuntime } = load('frontend/src/production/task-knowledge-runtime.ts');
const { default: MemoryPage } = load('frontend/src/screens/memoryScreen.tsx');
const { QueryClient } = req('@tanstack/react-query');
const renderer = createRoot(document.getElementById('root'));
const fact = { id: 'synthetic-fact', childId: 'child-a', key: 'Synthetic fact', content: 'Original synthetic content', source: { kind: 'manual', description: 'Synthetic source' }, validUntil: null, visibility: 'private', intendedVisibility: 'private', status: 'candidate', version: 4, authorSelf: true, reason: '', sourceState: 'current' };
const topic = { id: 'synthetic-topic', childId: 'child-a', title: 'Synthetic topic', note: 'Original note', visibility: 'private', status: 'pending', version: 3, authorSelf: true, resumeAfter: null };
let owner, calls, reads, historyReads, mode, session, pendingOnline, activeScope, role, facts;
const api = {
  async getSession() { return session; },
  hasPendingOnline() { return pendingOnline; }, resetOnline() { pendingOnline = false; },
  async reconcilePending() { calls.push({ method: 'reconcile' }); return { state: 'unconfirmed' }; },
};
for (const method of ['createFact', 'confirmFact', 'reviseFact', 'deactivateFact', 'deleteFact', 'createTopic', 'changeTopic', 'reopenTopic', 'deleteTopic']) api[method] = async (childId, idOrInput, inputOrSignal) => {
  const creating = method.startsWith('create'), input = creating ? idOrInput : inputOrSignal;
  calls.push({ method, childId, id: creating ? null : idOrInput, input });
  if (mode === 'unknown') { pendingOnline = true; throw { status: 0 }; }
  pendingOnline = false;
  return method.endsWith('Fact') ? { ...fact, ...input.values, version: 5 } : { ...topic, version: 4 };
};
function Owner({ scope }) {
  const queryClient = React.useMemo(() => new QueryClient(), []);
  const env = { scopeKey: scope, childId: scope === 'scope-a' ? 'child-a' : 'child-b', userId: 'user-a', role, online: true, queryClient,
    current: () => activeScope === scope, canStartWrite: () => true, invalidate() {}, accessError() {} };
  const runtime = useTaskKnowledgeRuntime(env, 'memory');
  const management = useTaskKnowledgeMemoryManagement({ env, api, runtime, reading: () => false, readFailed() {},
    async loadAll() { reads++; }, changed() {},
    currentEntity(entity) { return entity.kind === 'fact' ? { kind: 'fact', item: facts.find(value => value.id === entity.item.id) } : { kind: 'topic', item: topic }; },
    async latestEntity(entity) { return entity; } });
  owner = { management, facts, topics: [topic], role, busy: management.busy, lost: runtime.lost, hasMoreTopics: false, topicHistories: {},
    refresh() { reads++; }, topicHistory() { historyReads++; },
    value: { scopeKey: scope, model: { scopeKey: scope, childId: env.childId, childName: 'Synthetic child', access: 'active', online: true,
      shortTerm: { scopeKey: scope, state: 'unavailable', data: null }, references: { scopeKey: scope, state: 'unavailable', data: null },
      longTerm: { scopeKey: scope, state: 'ready', data: { childId: env.childId, facts, summary: null, hasMoreFacts: false, histories: {} } } }, reads: { readFactHistory() { historyReads++; } } } };
  return e(Context.Provider, { value: owner }, e(MemoryPage));
}
function Page() { return e(PreviewNavigationGuard, null, e(Owner, { key: activeScope, scope: activeScope })); }
async function render() { await React.act(async () => renderer.render(e(Page))); }
async function reset(options = {}) {
  await React.act(async () => renderer.render(null));
  calls = []; reads = historyReads = 0; mode = 'saved'; session = 'user-a'; pendingOnline = false; activeScope = 'scope-a'; role = options.role || 'owner'; facts = options.facts || [{ ...fact }]; containerWidth = 1440;
  await render();
}
const buttons = label => [...document.querySelectorAll('button')].filter(node => node.textContent === label);
function button(label) { const target = buttons(label).at(-1); assert.ok(target, label); return target; }
async function click(label) { await React.act(async () => { const target = button(label); target.focus(); target.click(); }); }
async function escape() { await React.act(async () => document.dispatchEvent(new window.KeyboardEvent('keyup', { key: 'Escape', bubbles: true }))); }
function field(label) { const target = document.querySelector(`[aria-label="${label}"]`); assert.ok(target, label); return target; }
async function input(label, value) {
  const target = field(label), prototype = target.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : target.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  await React.act(async () => { Object.getOwnPropertyDescriptor(prototype, 'value').set.call(target, value); target.dispatchEvent(new window.Event(target.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); });
}
async function check(label) { await React.act(async () => field(label).click()); }
function activeDialog() { const dialogs = document.querySelectorAll('[role="dialog"]'); assert.equal(dialogs.length, 1); assert.ok(dialogs[0].contains(document.activeElement)); return dialogs[0]; }
const confirmation = '我已核對原內容、來源、可見範圍及版本，明確確認這次操作';

test('Memory width changes keep the same tabs, management trigger and open-modal focus across the opt-in breakpoint', async () => {
  await reset();
  const entry = button('管理記憶'), tabs = [...document.querySelectorAll('[role="tab"]')];
  tabs[1].focus();
  for (const width of [320, 390, 480, 1024]) {
    containerWidth = width; await render();
    assert.equal(document.querySelector('[data-testid="memory-toolbar"]').dataset.stacked, String(width < 480));
    assert.equal(button('管理記憶'), entry); assert.equal(document.activeElement, tabs[1]);
    assert.deepEqual([...document.querySelectorAll('[role="tab"]')], tabs);
  }
  await click('管理記憶'); const add = button('人工新增候選事實'); add.focus();
  for (const width of [320, 390, 480, 1024]) {
    containerWidth = width; await render(); assert.equal(button('人工新增候選事實'), add); assert.equal(document.activeElement, add); activeDialog();
  }
  await escape(); assert.equal(document.activeElement, entry); assert.equal(calls.length, 0);
});

test('only a compact entry is on the page; nested editor Escape returns to the exact list trigger, then outer Escape returns to entry', async () => {
  await reset();
  assert.equal(document.body.textContent.includes('已取得的事實'), false);
  assert.equal(buttons('管理記憶').length, 1); assert.doesNotMatch(document.body.textContent, /人工管理記憶（備援）|owner/);
  const entry = button('管理記憶'), toolbar = document.querySelector('[data-testid="memory-toolbar-actions"]');
  assert.ok(toolbar.contains(entry)); assert.equal(buttons('重讀').length, 0); assert.equal(buttons('重試讀取').length, 0);
  for (const tab of ['短期脈絡', '參考資料', '長期記憶']) {
    await click(tab); assert.equal(buttons('管理記憶').length, 1); assert.equal(button('管理記憶'), entry, 'Tab changes keep the exact single management trigger');
    assert.equal(document.querySelector('[role="tabpanel"]').contains(entry), false);
  }
  await click('管理記憶'); assert.match(activeDialog().textContent, /候選未確認前只供本人/);
  const edit = button('人工確認／更正／停用／刪除');
  await click('人工確認／更正／停用／刪除'); assert.ok(activeDialog().contains(field('內容（最多 4,000 字）')));
  await click('讀取這項事實的版本歷史'); assert.equal(historyReads, 1);
  await escape(); assert.equal(document.querySelector('textarea'), null); assert.equal(document.activeElement, edit); activeDialog();
  await escape(); assert.equal(document.querySelectorAll('[role="dialog"]').length, 0); assert.equal(document.activeElement, button('管理記憶'));
  assert.equal(calls.length, 0);
});

test('dirty editor stay/Escape preserve original RHF fields; explicit discard returns to list and scope change removes stale modal', async () => {
  await reset(); await click('管理記憶'); await click('人工新增候選事實');
  await input('內容（最多 4,000 字）', 'Synthetic unsaved draft'); const draft = field('內容（最多 4,000 字）');
  await escape(); assert.match(activeDialog().textContent, /捨棄草稿並離開/); await click('繼續編輯');
  assert.equal(field('內容（最多 4,000 字）'), draft); assert.equal(draft.value, 'Synthetic unsaved draft');
  await click('返回記憶管理'); await escape(); assert.equal(field('內容（最多 4,000 字）'), draft); activeDialog();
  await click('返回記憶管理'); await click('捨棄草稿並離開');
  assert.equal(document.querySelector('textarea'), null); assert.equal(document.activeElement, button('人工新增候選事實')); assert.equal(owner.management.dirty, false);
  await click('關閉'); assert.equal(document.activeElement, button('管理記憶'));
  await click('管理記憶'); await click('人工新增候選事實'); assert.equal(field('內容（最多 4,000 字）').value, '');
  activeScope = 'scope-b'; facts = []; await render(); assert.equal(document.querySelectorAll('[role="dialog"]').length, 0); assert.equal(document.querySelector('textarea'), null);
  assert.equal(calls.length, 0);
});

test('original unknown operation blocks dismissal and preserves payload for receipt check plus explicit retry', async () => {
  await reset(); await click('管理記憶'); await click('人工確認／更正／停用／刪除');
  await check(confirmation); mode = 'unknown'; await click('確認提交這次人工操作');
  assert.equal(owner.management.operation, 'unknown'); assert.equal(calls.length, 1); const original = calls[0];
  await escape(); assert.match(activeDialog().textContent, /先處理原操作/); assert.equal(buttons('捨棄草稿並離開').length, 0);
  await click('留在此頁查核'); assert.equal(owner.management.pending.intent.input.expectedVersion, 4);
  await click('查原收據並讀取目前清單'); assert.equal(calls.filter(value => value.method === 'reconcile').length, 1); assert.equal(owner.management.pending.checked, true);
  assert.equal(button('明確重試原記憶操作').disabled, true);
  await check('我已核對，明確同意沿原識別及內容重試'); mode = 'saved'; await click('明確重試原記憶操作');
  const writes = calls.filter(value => value.method === 'confirmFact'); assert.equal(writes.length, 2); assert.equal(writes[1].input, original.input); assert.equal(writes[1].id, original.id);
  assert.equal(owner.management.pending, null); assert.equal(document.querySelector('textarea'), null); assert.match(activeDialog().textContent, /記憶操作已確認。/);
  await click('關閉'); assert.equal(document.activeElement, button('管理記憶'));
});

test('fact correction, deactivation and delete retain exact owner intents and explicit destructive confirmation', async () => {
  for (const [operation, method] of [['revise', 'reviseFact'], ['deactivate', 'deactivateFact'], ['delete', 'deleteFact']]) {
    await reset(); await click('管理記憶'); await click('人工確認／更正／停用／刪除');
    await input('這次人工操作', operation);
    if (operation !== 'delete') await input('更正／停用原因（最多 500 字）', 'Synthetic reason');
    if (operation === 'revise') await input('內容（最多 4,000 字）', 'Synthetic correction');
    const submit = operation === 'delete' ? '確認永久刪除事實與全部歷史' : '確認提交這次人工操作';
    assert.equal(button(submit).disabled, true);
    await check(operation === 'delete' ? '我明確同意永久刪除這項事實及全部歷史，無法復原' : confirmation);
    await click(submit); assert.equal(calls.length, 1); assert.equal(calls[0].method, method); assert.equal(calls[0].input.expectedVersion, 4);
    if (operation === 'delete') assert.equal(calls[0].input.confirmDelete, true);
    else assert.equal(calls[0].input.reason, 'Synthetic reason');
    assert.equal(document.querySelector('textarea'), null); activeDialog();
  }
  await reset({ role: 'viewer', facts: [{ ...fact, visibility: 'family' }, { ...fact, id: 'not-mine', authorSelf: false }] }); await click('管理記憶');
  assert.equal(buttons('人工確認／更正／停用／刪除').length, 0);
  await React.act(async () => owner.management.submit({ kind: 'delete_fact', basis: { ...fact, visibility: 'family' }, input: { expectedVersion: 4, confirmDelete: true } }));
  assert.equal(calls.length, 0);
});

test('topic history, update and destructive confirmation remain inside the original management flow', async () => {
  await reset(); await click('管理記憶'); await click('人工更新／按原因重開／刪除');
  await click('讀取原話題版本歷史'); assert.equal(historyReads, 1);
  await input('備註（最多 2,000 字）', 'Synthetic updated note');
  await check('我已核對內容、可見範圍及原版本，明確確認這次操作'); await click('確認提交話題');
  assert.equal(calls[0].method, 'changeTopic'); assert.equal(calls[0].input.expectedVersion, 3); assert.equal(calls[0].input.note, 'Synthetic updated note');
  assert.equal(document.querySelector('textarea'), null); activeDialog();
  await click('人工更新／按原因重開／刪除'); await input('這次人工操作', 'delete');
  assert.equal(button('確認永久刪除話題與全部歷史').disabled, true);
  await check('我明確同意永久刪除此話題及全部歷史，無法復原'); await click('確認永久刪除話題與全部歷史');
  assert.equal(calls[1].method, 'deleteTopic'); assert.deepEqual(calls[1].input, { expectedVersion: 3, confirmDelete: true });
  assert.equal(document.querySelector('textarea'), null); activeDialog();
});

test.after(async () => {
  await React.act(async () => renderer.unmount()); assert.equal(networkCalls, 0); global.fetch = originalFetch; dom.window.close();
});
