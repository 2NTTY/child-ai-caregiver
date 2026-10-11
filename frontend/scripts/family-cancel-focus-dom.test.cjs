const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');
const sourceRoot = path.resolve(process.env.FAMILY_FOCUS_SOURCE || path.join(__dirname, '../..'));
const frontend = path.join(sourceRoot, 'frontend');
const source = path.join(frontend, 'src');
const req = Module.createRequire(path.join(frontend, 'package.json'));
// Reuse an explicit existing DOM runtime without adding a product dependency.
if (!process.env.JSDOM_MODULE) throw new Error('Supply JSDOM_MODULE for an existing jsdom installation.');
const { JSDOM } = require(process.env.JSDOM_MODULE);
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true, url: 'http://localhost/family' });
// Supply viewport metrics for RN Web Dimensions; jsdom has no layout engine.
Object.defineProperty(dom.window.document.documentElement, 'clientWidth', { value: 1180 });
Object.defineProperty(dom.window.document.documentElement, 'clientHeight', { value: 757 });
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'ShadowRoot', 'MutationObserver', 'getComputedStyle']) global[key] = dom.window[key];
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
global.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
global.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
global.IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
const React = req('react'), { createRoot } = req('react-dom/client'), ts = req('typescript'), rn = req('react-native-web');
const originalLoad = Module._load;
Module._load = function(name, parent, isMain) {
  if (name === 'react-native') return rn;
  return originalLoad.call(this, name, parent, isMain);
};
const paper = {
  MD3LightTheme: req('react-native-paper/lib/commonjs/styles/themes/v3/LightTheme').MD3LightTheme,
  configureFonts: req('react-native-paper/lib/commonjs/styles/fonts').default,
  Text: req('react-native-paper/lib/commonjs/components/Typography/Text').default,
  Button: req('react-native-paper/lib/commonjs/components/Button/Button').default,
  TextInput: req('react-native-paper/lib/commonjs/components/TextInput/TextInput').default,
  HelperText: req('react-native-paper/lib/commonjs/components/HelperText/HelperText').default,
  Portal: ({ children }) => children,
};
const empty = () => null;
const view = React.forwardRef(({ children, preset, triggerKey, scopeKey, enabled, ...props }, ref) => React.createElement(rn.View, { ...props, ref }, children));
const modal = Object.assign(empty, { Title: empty, Content: empty, Actions: empty, ScrollArea: empty });
const Workspace = React.createContext(null);
const cache = new Map(), loaded = [], observations = [];
let networkCalls = 0, writes = 0, ownerCalls = [];
const originalFetch = global.fetch;
global.fetch = () => { networkCalls++; throw new Error('Network forbidden in this diagnostic'); };
const family = { id: 'family-a', ownerName: 'Synthetic owner', role: 'owner', version: 1, members: [{ userId: 'self', name: 'Synthetic owner', role: 'owner' }], invitations: [] };
const records = { children: [{ id: 'child-a', workspaceId: family.id, displayName: 'Synthetic child' }] };
const env = { userId: 'self', childId: 'child-a', identityKey: 'self:1', scopeKey: 'self:child-a:1', online: true,
  apiBaseUrl: 'https://synthetic.invalid', currentIdentity: () => true, current: () => true, canStartWrite: () => true,
  owner: { getSnapshot: () => ({ records, sessionGeneration: 1 }), setDomainPending: empty, controller: { reloadChildren: empty } },
  queryClient: { fetchQuery: ({ queryFn }) => queryFn() }, invalidate: empty, accessError: empty };
const forbidden = () => { writes++; throw new Error('A family mutation is forbidden in this diagnostic'); };
const api = { getSession: async () => 'self', listFamilies: async () => [structuredClone(family)], resetOnline: empty, hasPendingOnline: () => false,
  createInvitation: forbidden, changeMember: forbidden, revokeInvitation: forbidden, acceptInvitation: forbidden, previewInvitation: forbidden };
function load(file) {
  const filename = path.resolve(source, file);
  if (cache.has(filename)) return cache.get(filename).exports;
  const overlay = process.env.FAMILY_FOCUS_OVERLAY && path.join(process.env.FAMILY_FOCUS_OVERLAY, path.relative(sourceRoot, filename));
  const raw = fs.readFileSync(overlay && fs.existsSync(overlay) ? overlay : filename);
  loaded.push({ path: path.relative(source, filename), sha256: crypto.createHash('sha256').update(raw).digest('hex') });
  const module = { exports: {} }; cache.set(filename, module);
  const code = ts.transpileModule(raw.toString('utf8'), { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('require', 'module', 'exports', code)(name => {
    if (name === 'react-native') return rn;
    if (name === 'react-native-paper') return paper;
    if (name.endsWith('/family-api.ts')) return { createFamilyApi: () => api, FamilyApiError: class extends Error {} };
    if (name.endsWith('/useDomainEnvironment')) return { useDomainWriteGuard: empty };
    if (name.endsWith('/PreviewNavigationGuard')) return { usePreviewLeaveGuard: empty };
    if (name.endsWith('/AppIcon')) return { AppIcon: empty };
    if (name.endsWith('/StatusAnnouncement')) return { StatusAnnouncement: empty };
    if (name.endsWith('/AppScrollView')) return { AppScrollView: rn.ScrollView };
    if (name.endsWith('/AppDialog')) return { AppDialog: modal };
    if (name.endsWith('/AppRadioItem')) return { AppRadioItem: empty };
    if (name.endsWith('/HorizontalOverflowRail')) return { HorizontalOverflowRail: view };
    if (name.endsWith('/useInteractionDensity')) return { useInteractionDensity: () => false };
    if (name.endsWith('/motion/preferences')) return { useMotionPreferences: () => ({ enabled: false, epoch: 0 }) };
    if (name.endsWith('/MotionSelectionMarker')) return { MotionSelectionMarker: empty };
    if (name.endsWith('/motion')) return { MotionEntrance: view, MotionFeedback: ({ children }) => children, MotionDisclosure: ({ expanded, children }) => expanded ? children : null,
      MotionList: ({ items, renderItem }) => items.map(item => renderItem(item, { exiting: false })) };
    if (!name.startsWith('.')) return req(name);
    const target = path.resolve(path.dirname(filename), name);
    const resolved = fs.existsSync(target + '.tsx') ? target + '.tsx' : fs.existsSync(target + '.ts') ? target + '.ts' : target;
    return load(path.relative(source, resolved));
  }, module, module.exports);
  return module.exports;
}
const { FamilyView } = load('components/family/FamilyView.tsx');
const { useProductionFamily } = load('production/useProductionFamily.ts');
let currentOwner;
let cancelAcknowledgments = 0;
const observedActions = actions => ({ ...actions, cancel(onCancelled) { actions.cancel(() => { cancelAcknowledgments++; onCancelled?.(); }); } });
const LayoutPublishingOwner = React.memo(function LayoutPublishingOwner({ publish }) {
  const owner = useProductionFamily(env); currentOwner = owner;
  React.useLayoutEffect(() => { publish(owner); });
  return null;
});
function Host() {
  const [projection, publish] = React.useState(null);
  return React.createElement(React.Fragment, null, React.createElement(LayoutPublishingOwner, { publish }),
    projection && React.createElement(FamilyView, { production: true, model: projection.model, actions: observedActions(projection.actions), writeNotice: null, previewControls: null }));
}
const root = createRoot(document.getElementById('root'));
const byLabel = label => document.querySelector(`[aria-label="${label}"]`);
const delay = () => new Promise(resolve => setTimeout(resolve, 0));
async function click(label) {
  const target = byLabel(label); assert.ok(target, `Control exists: ${label}`);
  await React.act(async () => { target.focus(); assert.equal(document.activeElement, target); target.click(); await delay(); });
}
async function fill(label, value) {
  const input = byLabel(label); assert.ok(input);
  await React.act(async () => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, value); input.dispatchEvent(new window.Event('input', { bubbles: true })); await delay(); });
}
function inspect(stage) {
  const active = document.activeElement;
  const result = { stage, activeTag: active?.tagName, activeId: active?.id, activeLabel: active?.getAttribute('aria-label'),
    logicalTarget: !!active && active !== document.body && active !== document.documentElement && document.getElementById('root').contains(active),
    draftMounted: !!byLabel('取消草稿'), email: byLabel('受邀人的電郵')?.value, inviteFormKey: currentOwner?.model.inviteFormKey, networkCalls, writes };
  observations.push(result); console.log(JSON.stringify(result)); return result;
}
let stopped = false;
function register(name, body) { test(name, async context => { if (stopped) { context.skip('Stopped after first failure'); return; } try { await body(); } catch (error) { stopped = true; throw error; } }); }
register('explicit local invitation cancellation preserves active UI focus after actual owner cleanup', async () => {
  await React.act(async () => { root.render(React.createElement(Host)); await delay(); });
  assert.equal(currentOwner.model.canStartAction, true);
  await click('邀請一位成員');
  assert.equal(document.activeElement, byLabel('收起邀請表單'), 'Persistent disclosure demonstrates RN Web focus support');
  await fill('受邀人的電郵', 'qa-family-cancel@example.invalid');
  await click('核對邀請內容');
  assert.ok(byLabel('取消草稿')); assert.equal(currentOwner.model.draft.kind, 'invite');
  assert.equal(currentOwner.model.draft.scopeConfirmed, false);
  assert.equal(byLabel('再次確認操作').getAttribute('aria-disabled'), 'true');
  const priorKey = currentOwner.model.inviteFormKey;
  const returnTarget = byLabel('收起邀請表單');
  const focusCalls = [];
  const originalFocus = returnTarget.focus;
  assert.equal(Object.hasOwn(returnTarget, 'focus'), false, 'The disclosure uses the DOM focus method');
  // Observe arguments while retaining native DOM focus; jsdom cannot prove scrolling or visibility.
  returnTarget.focus = function (...args) {
    focusCalls.push({ argumentCount: args.length, preventScroll: args[0]?.preventScroll ?? false });
    return originalFocus.apply(this, args);
  };
  try { await click('取消草稿'); } finally { delete returnTarget.focus; }
  const observed = inspect('cancel-local-invite');
  observed.returnFocusCalls = focusCalls;
  console.log(JSON.stringify({ stage: 'accepted-cancel-focus-options', focusCalls }));
  assert.equal(currentOwner.model.draft, null); assert.equal(observed.email, ''); assert.equal(observed.inviteFormKey, priorKey + 1);
  assert.equal(observed.draftMounted, false); assert.equal(networkCalls, 0); assert.equal(writes, 0);
  assert.equal(observed.logicalTarget, true, 'An explicit inline cancel should restore connected, non-BODY active UI focus; no exact target or Tab sequence is prescribed');
  assert.equal(document.activeElement, returnTarget, 'Accepted cancellation returns to the persistent invitation disclosure');
  assert.equal(focusCalls.length, 1, 'The accepted cleanup requests one return focus');
  assert.equal(focusCalls[0].preventScroll, false, 'Accepted cancellation must allow native focus scrolling to its persistent disclosure');
});
register('busy production owner refuses cancellation without acknowledging or clearing the local draft', async () => {
  await React.act(async () => root.render(null));
  await React.act(async () => { root.render(React.createElement(Host)); await delay(); });
  await click('邀請一位成員'); await fill('受邀人的電郵', 'qa-family-cancel@example.invalid'); await click('核對邀請內容');
  const originalList = api.listFamilies, priorKey = currentOwner.model.inviteFormKey, priorDraft = currentOwner.model.draft;
  let releaseRead; api.listFamilies = () => new Promise(resolve => { releaseRead = resolve; });
  await React.act(async () => { currentOwner.actions.refresh(); await delay(); });
  assert.equal(currentOwner.model.locked, true); assert.equal(currentOwner.busy, true); assert.ok(releaseRead);
  const callbacksBefore = cancelAcknowledgments;
  await click('取消草稿');
  assert.equal(cancelAcknowledgments, callbacksBefore); assert.equal(currentOwner.model.draft, priorDraft);
  assert.equal(currentOwner.model.inviteFormKey, priorKey); assert.ok(byLabel('取消草稿'));
  const sentinel = document.createElement('button'); sentinel.id = 'synthetic-unrelated'; document.body.append(sentinel);
  await React.act(async () => { sentinel.focus(); releaseRead([structuredClone(family)]); await delay(); });
  assert.equal(document.activeElement, sentinel); assert.equal(cancelAcknowledgments, callbacksBefore);
  assert.ok(currentOwner.model.draft); assert.equal(currentOwner.model.inviteFormKey, priorKey);
  observations.push({ stage: 'production-busy-refusal', cancelAcknowledgments: cancelAcknowledgments - callbacksBefore, retainedFormKey: priorKey, activeId: document.activeElement.id, networkCalls, writes });
  api.listFamilies = originalList; sentinel.remove();
  assert.equal(networkCalls, 0); assert.equal(writes, 0);
});
register('preview local cancellation acknowledges once and retains its existing formKey semantics', async () => {
  const { useFamilyPreview } = load('preview/useFamilyPreview.ts');
  function PreviewHost() {
    const owner = useFamilyPreview({ perspective: 'owner', incomingCondition: 'pending', ownerName: 'Synthetic owner', children: [], online: true, reading: false });
    currentOwner = owner;
    return React.createElement(FamilyView, { model: owner.model, actions: observedActions(owner.actions), writeNotice: null, previewControls: null });
  }
  await React.act(async () => root.render(null));
  await React.act(async () => root.render(React.createElement(PreviewHost)));
  await click('邀請一位成員'); await fill('受邀人的電郵', 'qa-family-cancel@example.invalid'); await click('核對邀請內容');
  assert.equal(currentOwner.model.draft.kind, 'invite'); const priorKey = currentOwner.model.inviteFormKey, priorCallbacks = cancelAcknowledgments;
  await click('取消草稿');
  const observed = inspect('preview-local-cancel');
  assert.equal(cancelAcknowledgments, priorCallbacks + 1); assert.equal(currentOwner.model.draft, null);
  assert.equal(observed.inviteFormKey, priorKey, 'Do not add a form reset to the old preview cancellation behavior');
  assert.equal(observed.email, 'qa-family-cancel@example.invalid', 'Preview composer text retains its existing behavior');
  assert.equal(observed.logicalTarget, true); assert.equal(observed.activeLabel, '收起邀請表單');
  assert.equal(networkCalls, 0); assert.equal(writes, 0);
});
test.after(async () => {
  await React.act(async () => root.unmount());
  if (process.env.OUTPUT_DIR) {
    const output = path.resolve(process.env.OUTPUT_DIR);
    if (output === sourceRoot || output.startsWith(sourceRoot + path.sep)) throw new Error('Output must be outside product source.');
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'family-cancel-observations.json'), JSON.stringify({ sourceRoot, observations, networkCalls, writes, loaded,
      boundary: 'Actual FamilyView, InviteComposer/DraftReview, useProductionFamily, SettingsDomainSupport, Paper/RNWeb and RHF. Synthetic API port and environment; memoized owner publishes via useLayoutEffect like SettingsIdentityBridge. Animation, decorative icons, external navigation guard and unused dialogs are bounded doubles. The accepted-cancel focus method is observed without replacing DOM focusing; options do not prove scrolling. No live network, real invitation, layout/visibility, screen-reader, browser Tab or WCAG claim.' }, null, 2));
  }
  Module._load = originalLoad; global.fetch = originalFetch; dom.window.close();
});
