const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const source = path.resolve(process.env.CONTACT_PROJECTION_SOURCE || path.join(__dirname, '../..'));
const root = path.join(source, 'frontend');
const req = Module.createRequire(path.join(root, 'package.json'));
if (!process.env.JSDOM_MODULE) throw new Error('Supply JSDOM_MODULE for an existing jsdom installation.');
const { JSDOM } = require(process.env.JSDOM_MODULE);
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'ShadowRoot', 'MutationObserver', 'getComputedStyle']) global[key] = dom.window[key];
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
global.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
global.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
global.IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
const React = req('react'), { createRoot } = req('react-dom/client'), ts = req('typescript'), rn = req('react-native-web');
const { QueryClient } = req('@tanstack/react-query');
const originalLoad = Module._load;
Module._load = function(name, parent, isMain) {
  return originalLoad.call(this, name === 'react-native' ? 'react-native-web' : name, parent, isMain);
};
const paper = {
  Text: req('react-native-paper/lib/commonjs/components/Typography/Text').default,
  HelperText: req('react-native-paper/lib/commonjs/components/HelperText/HelperText').default,
};
const Empty = () => null;
const Container = ({ children }) => React.createElement('div', null, children);
const Button = ({ label, onPress, disabled, accessibilityLabel, expanded }) => React.createElement('button', { onClick: onPress, disabled, 'aria-label': accessibilityLabel, 'aria-expanded': expanded }, label);
const ui = { AppButton: Button, SectionCard: Container, SectionHeader: ({ title, action }) => React.createElement('div', null, title, action) };
const theme = { colors: {}, spacing: {}, radius: {}, typeScale: {}, readingType: {}, mobileType: {}, mobileLayout: { breakpoint: 650 }, mobileIcons: {} };
const motion = { MotionDisclosure: ({ expanded, children }) => expanded ? children : null, MotionFeedback: Container,
  MotionList: ({ items, keyExtractor, renderItem }) => items.map(item => React.createElement(React.Fragment, { key: keyExtractor(item) }, renderItem(item, { exiting: false }))) };
const originalFetch = global.fetch;
let networkCalls = 0, currentApi;
global.fetch = () => { networkCalls++; throw new Error('Network forbidden'); };
const modules = new Map();
function evaluate(file) {
  if (modules.has(file)) return modules.get(file);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    if (name === 'react-native') return rn;
    if (name === 'react-native-paper') return paper;
    if (!name.startsWith('.')) return req(name);
    if (name.endsWith('/theme')) return theme;
    if (name.endsWith('/ui')) return ui;
    if (name.endsWith('/AppIcon')) return { AppIcon: Empty };
    if (name.endsWith('/AppStatusBadge')) return { AppStatusBadge: Empty };
    if (name.endsWith('/motion')) return motion;
    if (name.endsWith('/PreviewNavigationGuard')) return { usePreviewLeaveGuard() {} };
    if (name.endsWith('/useDomainEnvironment')) return { useDomainWriteGuard() {} };
    if (name.endsWith('/contact-api.ts')) return { createContactApi: () => currentApi };
    const stem = path.resolve(path.dirname(file), name);
    const resolved = [stem, `${stem}.ts`, `${stem}.tsx`].find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    if (!resolved) throw new Error(`Unexpected import ${name} from ${file}`);
    return evaluate(resolved);
  }, module, module.exports);
  modules.set(file, module.exports);
  return module.exports;
}
// Real owner, request/read lifecycle, QueryClient, form/RHF/schema and AppCheckbox/RN Web.
// Only the API port and unrelated navigation, appearance and motion are bounded doubles.
const { useProductionContact } = evaluate(path.join(root, 'src/production/useProductionContact.ts'));
const { ContactConsentCard } = evaluate(path.join(root, 'src/components/contact/ContactConsentCard.tsx'));
const observations = [];
const mainLabel = '允許透過以下本人渠道接收一般任務提示';
const confirmLabel = '我確認保存以上本人接收及後備同意';
const saveLabel = '確認保存本人接收同意';
const consentDecision = { kind: 'consent', input: { expectedVersion: 0, enabled: false, allowBackup: false, bindings: [], confirm: true } };
const checkbox = label => [...document.querySelectorAll('[role="checkbox"]')].find(node => node.getAttribute('aria-label') === label);
const button = label => [...document.querySelectorAll('button')].find(node => node.textContent === label);
const semantics = () => [mainLabel, confirmLabel].map(label => { const node = checkbox(label); assert.ok(node, label); return { label, disabled: node.getAttribute('aria-disabled') === 'true', tabIndex: node.tabIndex, checked: node.getAttribute('aria-checked') }; });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
async function settle(fn = () => {}) { await React.act(async () => { fn(); await new Promise(resolve => setImmediate(resolve)); }); }
async function space(node) { await settle(() => node.dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true }))); }
async function fixture({ role = 'owner', canManage = true } = {}) {
  let owner, online = true, read = null, write = null, pendingOnline = false;
  const counts = { reads: 0, writes: 0, invalidations: 0, accessErrors: 0 };
  const bodies = [];
  const page = { canManage, workerEnabled: false, consent: { userId: 'synthetic-user', version: 0, enabled: false, allowBackup: false, bindings: [] }, availableBindings: [], recipients: [], tasks: [], tasksHaveMore: false, grants: [], requests: [], historyLimited: false };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const api = { page: async () => { counts.reads++; return read ? await read.promise : structuredClone(page); },
    consent: async (_child, input) => { counts.writes++; bodies.push(structuredClone(input)); pendingOnline = true; if (write) await write.promise; pendingOnline = false; },
    authorization: async () => { counts.writes++; throw new Error('Unexpected authorization'); },
    acknowledge: async () => { counts.writes++; throw new Error('Unexpected acknowledgement'); },
    hasPendingOnline: () => pendingOnline, reconcilePending: async () => ({ state: 'unconfirmed' }), resetOnline: () => { pendingOnline = false; } };
  currentApi = api;
  const envBase = { scopeKey: 'synthetic-scope', identityKey: 'synthetic-identity', childName: '合成孩子', childId: 'synthetic-child', userId: 'synthetic-user', role, apiBaseUrl: 'https://synthetic.invalid', queryClient,
    current: () => true, currentIdentity: () => true, canStartWrite: () => true, accessError: () => { counts.accessErrors++; }, invalidate: () => { counts.invalidations++; },
    owner: { getSnapshot: () => ({ sessionGeneration: 1 }), setDomainPending() {} } };
  function Harness() { owner = useProductionContact({ ...envBase, online }); return owner.model.page ? React.createElement(ContactConsentCard, { ...owner, onSettings() {} }) : null; }
  const rootNode = createRoot(document.getElementById('root'));
  const render = () => rootNode.render(React.createElement(Harness));
  await settle(render);
  assert.equal(owner.model.load, 'ready');
  await settle(() => button('管理同意').click());
  return { get owner() { return owner; }, page, counts, bodies, async close() { await settle(() => rootNode.unmount()); queryClient.clear(); },
    async refresh() { await settle(() => owner.actions.refresh()); },
    holdRead() { read = deferred(); return read; }, clearRead() { read = null; }, holdWrite() { write = deferred(); return write; },
    async setOnline(value) { online = value; await settle(render); } };
}
function assertLocked() {
  assert.deepEqual(semantics().map(({ disabled, tabIndex }) => ({ disabled, tabIndex })), [{ disabled: true, tabIndex: -1 }, { disabled: true, tabIndex: -1 }]);
  assert.equal(button(saveLabel).disabled, true);
}
for (const options of [{ role: 'owner', canManage: false }, { role: 'viewer', canManage: true }]) {
  test(`ready ${options.role}/canManage=${options.canManage} locks consent and preserves the save guard`, async () => {
    const f = await fixture(options);
    try {
      assert.equal(f.owner.model.access, 'read_only');
      await settle(() => f.owner.actions.save(consentDecision, ['Synthetic consent']));
      assert.equal(f.counts.writes, 0, 'The existing owner save guard rejects read-only writes');
      observations.push({ case: `${options.role}/${options.canManage}`, controls: semantics(), locked: f.owner.model.locked, writes: f.counts.writes });
      assertLocked();
      await space(checkbox(mainLabel)); await space(checkbox(confirmLabel));
      await settle(() => { checkbox(mainLabel).click(); checkbox(confirmLabel).click(); });
      assert.equal(f.owner.model.dirty, false);
      assert.deepEqual(semantics().map(item => item.checked), ['false', 'false']);
      assert.equal(f.counts.writes, 0); assert.equal(networkCalls, 0);
    } finally { await f.close(); }
  });
}
test('editable manager keeps keyboard editing and locks during saving', async () => {
  const f = await fixture();
  try {
    assert.equal(f.owner.model.access, 'editable'); assert.equal(f.owner.model.locked, false);
    assert.deepEqual(semantics().map(item => [item.disabled, item.tabIndex]), [[false, 0], [false, 0]]);
    await space(checkbox(mainLabel)); assert.equal(checkbox(mainLabel).getAttribute('aria-checked'), 'true');
    assert.equal(f.owner.model.dirty, true);
    await space(checkbox(mainLabel)); await space(checkbox(confirmLabel));
    assert.equal(checkbox(confirmLabel).getAttribute('aria-checked'), 'true'); assert.equal(button(saveLabel).disabled, false);
    const writing = f.holdWrite();
    await settle(() => button(saveLabel).click());
    assert.equal(f.counts.writes, 1); assert.equal(f.owner.model.operation, 'saving'); assertLocked();
    assert.deepEqual(f.bodies, [consentDecision.input]);
    await settle(() => writing.resolve());
    assert.equal(f.owner.model.operation, 'saved'); assert.equal(f.owner.model.locked, false);
    assert.equal(f.owner.model.dirty, false); assert.equal(f.counts.invalidations, 1); assert.equal(networkCalls, 0);
    observations.push({ case: 'editable-manager', keyboardEdit: true, savingLocked: true, recoveredEditable: true, syntheticWrites: f.counts.writes });
  } finally { await f.close(); }
});
test('busy, failed reads and recovery retain the ready access projection', async () => {
  for (const canManage of [false, true]) {
    const f = await fixture({ canManage });
    try {
      const reading = f.holdRead(); await f.refresh();
      assert.equal(f.owner.model.busy, true); assertLocked();
      await settle(() => reading.reject({ status: 503 }));
      assert.equal(f.owner.model.load, 'error'); assert.equal(f.owner.model.busy, false); assertLocked();
      f.clearRead(); await f.refresh();
      assert.equal(f.owner.model.load, 'ready'); assert.equal(f.owner.model.locked, !canManage);
      if (!canManage) assertLocked();
      await f.setOnline(false); assertLocked();
      await f.setOnline(true); assert.equal(f.owner.model.load, 'ready'); assert.equal(f.owner.model.locked, !canManage);
      assert.equal(f.counts.writes, 0); assert.equal(networkCalls, 0);
      observations.push({ case: `read-recovery/${canManage}`, busyLocked: true, failedLocked: true, offlineLocked: true, recoveredLocked: f.owner.model.locked });
    } finally { await f.close(); }
  }
});
test('unknown original decision stays locked after readback and reuses its original retry', async () => {
  const f = await fixture();
  try {
    const writing = f.holdWrite(); await settle(() => f.owner.actions.save(consentDecision, ['Synthetic consent']));
    await settle(() => writing.reject({ status: 503 }));
    assert.equal(f.owner.model.operation, 'unknown'); assert.equal(f.owner.model.load, 'error'); assertLocked();
    const body = f.owner.model.pending.body;
    await f.refresh();
    assert.equal(f.owner.model.load, 'ready'); assert.equal(f.owner.model.pending.reviewed, true); assert.equal(f.owner.model.operation, 'unknown'); assertLocked();
    await settle(() => f.owner.actions.save(consentDecision, ['Must not create a new write']));
    assert.equal(f.counts.writes, 1); assert.equal(f.owner.model.pending.body, body);
    await settle(() => f.owner.actions.setOriginalConsent(true));
    const retry = f.holdWrite(); await settle(() => f.owner.actions.retryOriginal());
    assert.equal(f.owner.model.operation, 'saving'); assertLocked();
    await settle(() => retry.resolve());
    assert.equal(f.owner.model.operation, 'saved'); assert.equal(f.owner.model.pending, null); assert.equal(f.owner.model.locked, false);
    assert.deepEqual(f.bodies, [consentDecision.input, consentDecision.input]); assert.equal(networkCalls, 0);
    observations.push({ case: 'unknown-recovery', readbackLocked: true, originalBodyPreserved: true, recoveredEditable: true, syntheticWrites: f.counts.writes });
  } finally { await f.close(); }
});
test.after(() => {
  if (process.env.CONTACT_PROJECTION_EVIDENCE) fs.writeFileSync(process.env.CONTACT_PROJECTION_EVIDENCE, JSON.stringify({ observations, networkCalls, boundary: 'Real owner and checkbox DOM; synthetic in-memory API only. No real network, backend authorization, browser Tab traversal, screen reader or visual claim.' }, null, 2) + '\n');
  Module._load = originalLoad; global.fetch = originalFetch; dom.window.close();
});
