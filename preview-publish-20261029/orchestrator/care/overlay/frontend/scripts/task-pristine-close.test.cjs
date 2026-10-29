const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
if (!process.env.JSDOM_MODULE) throw Error('Supply an existing test-only JSDOM_MODULE');
const { JSDOM } = require(process.env.JSDOM_MODULE);
const dom = new JSDOM('<main id="root"></main>', { pretendToBeVisual: true, url: 'https://synthetic.invalid/tasks' });
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'ShadowRoot', 'Document', 'MutationObserver', 'getComputedStyle']) global[key] = dom.window[key];
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
global.IS_REACT_ACT_ENVIRONMENT = true;
global.requestAnimationFrame = window.requestAnimationFrame.bind(window);
global.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
global.fetch = () => { throw Error('Real network forbidden'); };
HTMLElement.prototype.scrollIntoView = function() {};
// JSDOM cannot measure layout; this port distinguishes only connected/hidden nodes.
Object.defineProperty(HTMLElement.prototype, 'getClientRects', { configurable: true, value() {
  return this.isConnected && !this.closest('[hidden],[aria-hidden="true"]') ? [{}] : [];
} });
const source = path.resolve(__dirname, '../..'), req = createRequire(path.join(source, 'frontend/package.json'));
const React = req('react'), { act } = React, { createRoot } = req('react-dom/client'), rn = req('react-native-web');
const { QueryClient } = req('@tanstack/react-query'), ts = req('typescript');
const Module = require('node:module'), originalLoad = Module._load;
Module._load = function(name, ...args) {
  if (name === 'react-native') return rn;
  if (name === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }), SafeAreaView: rn.View };
  if (name.endsWith('/SafeAreaProviderCompat')) return { __esModule: true, default: p => p.children };
  if (name.endsWith('/MaterialCommunityIcon')) return { __esModule: true, default: () => null };
  return originalLoad.call(this, name, ...args);
};
const paper = req('react-native-paper'), e = React.createElement, Empty = () => null;
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const json = (value, status = 200) => Response.json(value, { status });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const childId = '11111111-1111-4111-8111-111111111111', taskId = '22222222-2222-4222-8222-222222222222';
const otherId = '33333333-3333-4333-8333-333333333333', at = '2026-10-27T00:00:00Z';
const original = { id: taskId, childId, version: 1, title: 'Synthetic family task', details: 'Synthetic content', kind: 'ordinary',
  assigneeUserId: 'parent', createdBy: 'parent', createdAt: at, updatedAt: at,
  occurrence: { id: otherId, dueAt: at, timeZone: 'Asia/Hong_Kong', state: 'scheduled', terminalBasisVersion: null } };
const context = { workspaceId: childId, storageEpoch: otherId };
const Button = p => e(paper.Button, { ref: p.ref, onPress: p.onPress, disabled: p.disabled,
  accessibilityLabel: p.accessibilityLabel ?? p.label }, p.label);
let value, productionOwner;
const cache = new Map();
// Real production owner/API/runtime, useDomainWriteGuard, navigation guard, TasksView,
// TaskForm/RHF, FormDialog, AppDialog and installed RN Web modal/focus ownership.
// Router, layout, unrelated readers, date/select controls and transport are bounded ports.
function load(relative) {
  const filename = path.resolve(source, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const m = { exports: {} }; cache.set(filename, m);
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('require', 'module', 'exports', output)(name => {
    if (name === 'react-native') return rn;
    if (name === 'expo-router') return { usePathname: () => '/tasks', useRouter: () => ({ push() {} }), Link: p => p.children };
    if (name === 'expo-router/react-navigation') return { useNavigation: () => ({ dispatch() {} }), usePreventRemove() {} };
    if (name === './browser-history-guard') return { guardBrowserHistory: () => () => {} };
    if (name.endsWith('/ProductionProvider')) return { useProductionOwner: () => productionOwner };
    if (name.endsWith('/useContainerWidth')) return { useContainerWidth: () => ({ width: 1024, ref: React.useRef(null), onLayout() {} }) };
    if (name.endsWith('/appearance/BackgroundSurface')) return { BackgroundSurface: rn.View, useCustomBackground: () => false };
    if (name.endsWith('/ui')) return { AppButton: Button, AppTextField: paper.TextInput, AppSelect: p => e(rn.Text, null, p.label),
      AppSelectionTrigger: Empty, SectionCard: rn.View, SectionHeader: p => e(rn.Text, null, p.title), AppTabPanel: p => p.active ? p.children : null };
    if (name.endsWith('/workspace/WorkspaceSwitch')) return { WorkspaceSwitch: Empty };
    if (name.endsWith('/AppScrollView')) return { AppScrollView: rn.ScrollView };
    if (name.endsWith('/TaskDetail') || name.endsWith('/TasksCalendar')) return { TaskDetail: Empty, TasksCalendar: Empty };
    if (name.endsWith('/DateTimeFields')) return { AppDateTimeField: Empty, AppTimeZoneSelect: Empty };
    if (name.endsWith('/AppIcon')) return { AppIcon: Empty };
    if (name.endsWith('/motion')) return { motionTokens: { dialog: { distance: 12, duration: 0 } },
      useMotionPreferences: () => ({ enabled: false, epoch: 0 }), MotionBackdrop: Empty, MotionDetail: rn.View,
      MotionDisclosure: p => p.expanded ? p.children : null, MotionList: p => e(rn.View, null,
        p.items.map(item => e(React.Fragment, { key: item.id }, p.renderItem(item, { exiting: false })))),
      MotionEntrance: p => e(rn.View, { style: p.style, testID: p.testID }, p.children), MotionFeedback: p => p.children };
    if (name.endsWith('/MotionPaperScope')) return { MotionPaperScope: p => p.children };
    if (name.endsWith('/useModalBackdrop')) return { useModalBackdrop: () => ({}) };
    if (name.startsWith('.')) {
      const base = path.resolve(path.dirname(filename), name);
      const found = [base, base + '.ts', base + '.tsx'].find(file => fs.existsSync(file) && fs.statSync(file).isFile());
      if (found) return load(found);
    }
    return req(name);
  }, m, m.exports);
  return m.exports;
}
const { useTaskKnowledgeTasks } = load('frontend/src/production/task-knowledge-tasks.ts');
const { TasksView } = load('frontend/src/components/tasks/TasksView.tsx');
const { PreviewNavigationGuard } = load('frontend/src/preview/PreviewNavigationGuard.tsx');
const { paperTheme } = load('frontend/src/theme.ts');
const byId = id => document.querySelector(`[data-testid="${id}"]`);
const button = label => document.querySelector(`[aria-label="${label}"]`);
async function click(label) { const node = button(label); assert.ok(node, label); await act(async () => { node.focus(); node.click(); await tick(); }); }
async function fill(label, text) {
  const node = button(label); assert.ok(node, label);
  await act(async () => {
    Object.getOwnPropertyDescriptor(node.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype, 'value').set.call(node, text);
    node.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}
async function fixture({ existing = false, pending = false, rejectedOperation = false } = {}) {
  let current = true, submission;
  const held = deferred(), requests = [], domainPending = new Map();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const transport = async (url, init) => {
    const route = new URL(url, 'https://synthetic.invalid').pathname;
    const entry = { path: route, method: init.method, body: init.body ? JSON.parse(init.body) : null }; requests.push(entry);
    if (route === '/api/auth/get-session') return json({ user: { id: 'parent' } });
    if (route === '/api/online/context') return json(context);
    if (route === '/api/online/submit') {
      submission = entry.body;
      if (rejectedOperation) return json({ error: { code: 'operation_conflict' } }, 409);
      if (pending) { await held.promise; throw Error('Synthetic lost response'); }
      throw Error('Unexpected synthetic write');
    }
    if (route === `/api/children/${childId}/tasks`) return json({ items: existing ? [original] : [], eligibleAssignees: [{ userId: 'parent', name: 'Synthetic parent' }], nextAfterId: null });
    throw Error(`Unexpected synthetic route: ${route}`);
  };
  productionOwner = { fetcher: transport, setDomainPending: (id, next) => domainPending.set(id, next) };
  const env = { scopeKey: 'parent:child', identityKey: 'parent', childId, childName: 'Synthetic child', userId: 'parent', role: 'owner', online: true,
    apiBaseUrl: '/api', queryClient, owner: productionOwner, current: () => current, currentIdentity: () => current,
    canStartWrite: () => true, invalidate() {}, accessError() {} };
  function Owner() {
    value = useTaskKnowledgeTasks(env);
    return e(TasksView, { ...value, route: { tab: 'pending', filter: 'all', page: 0, day: null, month: null, taskId: value.model.selected?.id ?? null },
      query: '', onQueryChange() {}, onRouteChange() {}, onAgent() {}, onHistory() {} });
  }
  const app = createRoot(document.getElementById('root'));
  await act(async () => { app.render(e(paper.PaperProvider, { theme: paperTheme }, e(PreviewNavigationGuard, null, e(Owner)))); await tick(); });
  await act(async () => { await tick(); });
  assert.equal(value.model.readState, 'ready');
  const action = fn => act(async () => { fn(value); await tick(); });
  return { get: () => value, requests, domainPending, action, expireScope() { current = false; },
    async open() { await click('手動新增共享事項'); assert.ok(byId('manual-form-dialog')); assert.equal(button('事項標題').value, ''); },
    async review() { await action(v => v.actions.reviewDraft({ ...v.model.draft.initialValues, title: original.title, details: original.details,
      assigneeUserId: 'parent', dueAt: at, timeZone: 'Asia/Hong_Kong', note: 'Synthetic reason' })); assert.equal(value.model.operation.state, 'needs_confirmation'); },
    async release() { await act(async () => { held.resolve(); await tick(); }); },
    submission: () => submission,
    async close() { await act(async () => { held.resolve(); await tick(); app.unmount(); }); queryClient.clear(); },
  };
}
let failed = false;
function scenario(name, run) {
  test(name, async t => {
    if (failed) return t.skip('Stopped after the first failure');
    try { await run(); } catch (error) { failed = true; throw error; }
  });
}

// A regression to dirty=!!draft must fail this first consumer-visible close result.
scenario('untouched new task closes without an unsaved-change prompt', async () => {
  const h = await fixture();
  try {
    await h.open(); assert.equal(h.get().model.operation.state, 'none');
    await click('關閉安排事項');
    assert.equal(!!byId('leave-preview-dialog'), false, 'An untouched new task must not claim unsaved changes');
    assert.equal(h.get().model.draft, null); assert.equal(!!byId('manual-form-dialog'), false);
    assert.equal(h.requests.filter(r => r.method === 'POST').length, 0);
  } finally { await h.close(); }
});
scenario('real input keeps the draft on Continue and accepted discard permits a clean new draft', async () => {
  const h = await fixture();
  try {
    await h.open(); await fill('事項標題', 'Synthetic unsaved edit'); await click('關閉安排事項');
    assert.ok(byId('leave-preview-dialog')); await click('繼續編輯');
    assert.equal(button('事項標題').value, 'Synthetic unsaved edit'); assert.ok(h.get().model.draft);
    await click('關閉安排事項'); await click('捨棄並離開'); assert.equal(h.get().model.draft, null);
    await h.open(); await click('關閉安排事項');
    assert.equal(!!byId('leave-preview-dialog'), false); assert.equal(h.get().model.draft, null);
    assert.equal(h.requests.filter(r => r.method === 'POST').length, 0);
  } finally { await h.close(); }
});
scenario('previewed create stays guarded after returning to an RHF-pristine editor', async () => {
  const h = await fixture();
  try {
    await h.open(); await h.review(); await click('關閉安排事項'); assert.ok(byId('leave-preview-dialog'));
    await click('繼續編輯'); await click('繼續修改草稿'); assert.equal(h.get().model.operation.state, 'none');
    assert.equal(button('事項標題').value, '', 'The owner review did not dirty the mounted RHF fields');
    await click('關閉安排事項'); assert.ok(byId('leave-preview-dialog'));
    await click('繼續編輯'); assert.ok(h.get().model.draft);
    assert.equal(h.requests.filter(r => r.method === 'POST').length, 0);
  } finally { await h.close(); }
});
scenario('an existing task cancellation remains guarded before changing its fields', async () => {
  const h = await fixture({ existing: true });
  try {
    await h.action(v => v.actions.startChange(taskId, 'cancel')); const draft = h.get().model.draft;
    await click('關閉安排事項'); assert.ok(byId('leave-preview-dialog')); await click('繼續編輯');
    assert.equal(h.get().model.draft, draft); assert.equal(h.get().model.selected.id, taskId);
    assert.equal(h.requests.filter(r => r.method === 'POST').length, 0);
  } finally { await h.close(); }
});
scenario('a previously reviewed create never becomes pristine after unknown recovery releases its attempt', async () => {
  const h = await fixture({ rejectedOperation: true });
  try {
    await h.open(); await h.review(); await h.action(v => v.actions.submitReviewed());
    assert.equal(h.get().model.operation.state, 'unknown');
    await h.action(v => v.recovery.checkOriginalOperation());
    assert.equal(h.get().model.operation.state, 'unknown'); assert.equal(h.get().model.operation.recovery, 'retry');
    await h.action(v => v.recovery.retryOriginalOperation());
    assert.equal(h.get().model.operation.state, 'none'); assert.equal(h.get().model.draft.reviewedValues, null);
    assert.equal(button('事項標題').value, '', 'No editDraft event was needed for the accepted owner review');
    await click('關閉安排事項'); assert.ok(byId('leave-preview-dialog'), 'A previously reviewed operation must not requalify as untouched');
    await click('繼續編輯'); assert.ok(h.get().model.draft);
    assert.equal(h.requests.filter(r => r.path === '/api/online/submit').length, 1, 'Recovery only released the attempt; it did not resubmit');
  } finally { await h.close(); }
});
scenario('saving and unknown preserve the original task operation and prohibit discard', async () => {
  const h = await fixture({ pending: true });
  try {
    await h.open(); await h.review(); await h.action(v => v.actions.submitReviewed());
    assert.equal(h.get().model.operation.state, 'saving'); const draft = h.get().model.draft;
    await click('關閉安排事項'); assert.ok(byId('leave-preview-dialog')); assert.equal(button('捨棄並離開'), null);
    assert.ok([...h.domainPending.values()].some(Boolean)); await click('留在此頁');
    assert.equal(h.get().actions.closePanel(), false); assert.equal(h.get().model.draft, draft);
    const originalSubmission = h.submission(); assert.ok(originalSubmission?.operation?.opId);
    await h.release(); assert.equal(h.get().model.operation.state, 'unknown');
    await click('關閉安排事項'); assert.ok(byId('leave-preview-dialog')); assert.equal(button('捨棄並離開'), null);
    await click('留在此頁'); assert.equal(h.get().model.draft, draft); assert.equal(h.get().actions.closePanel(), false);
    assert.equal(h.submission(), originalSubmission); assert.equal(h.requests.filter(r => r.path === '/api/online/submit').length, 1);
  } finally { await h.close(); }
});
scenario('a clean create close still cannot mutate an expired owner scope', async () => {
  const h = await fixture();
  try {
    await h.open(); const draft = h.get().model.draft; h.expireScope(); await click('關閉安排事項');
    assert.equal(h.get().model.draft, draft); assert.ok(byId('manual-form-dialog'));
    assert.equal(h.requests.filter(r => r.method === 'POST').length, 0);
  } finally { await h.close(); }
});
test.after(() => { Module._load = originalLoad; dom.window.close(); });
