'use strict';
// Portable source-execution regression, not a React mount, picker, DOM or browser test.
// The complete production hook and component bodies are compiled unchanged. Hook scheduling,
// UI, router and owner subinterfaces are explicit shallow ports; effects are not executed.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');
const source = path.resolve(process.env.HOME_PHOTO_SOURCE_ROOT || path.join(__dirname, '../..'));
const loaded = new Map();
const extracted = new Map();
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const deny = () => { throw new Error('Unexpected side effect in home photo admission test'); };
const jsx = (type, props, key) => ({ type, props, key });
let frame;
function hooks() {
  const cells = [];
  return { index: 0, cells, run(fn) { const previous = frame; frame = this; this.index = 0; try { return fn(); } finally { frame = previous; } } };
}
const shallowReact = {
  useState(initial) {
    const current = frame, index = current.index++;
    if (!(index in current.cells)) current.cells[index] = typeof initial === 'function' ? initial() : initial;
    return [current.cells[index], value => { current.cells[index] = typeof value === 'function' ? value(current.cells[index]) : value; }];
  },
  useRef(initial) { const index = frame.index++; return frame.cells[index] ??= { current: initial }; },
  useMemo: fn => fn(), useCallback: fn => fn, useSyncExternalStore: (_subscribe, get) => get(),
  useEffect() {}, useLayoutEffect() {},
};
function read(filename) {
  const bytes = fs.readFileSync(filename);
  loaded.set(filename, { path: path.relative(source, filename), sha256: digest(bytes) });
  return bytes.toString();
}
function compile(text, filename, ports = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(text, { fileName: filename, compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, console, Date, Intl,
    URL, URLSearchParams, AbortController, AbortSignal, structuredClone,
    fetch: deny, WebSocket: deny, EventSource: deny, ...ports }, { filename });
  return module.exports;
}
function loader(overrides) {
  const cache = new Map();
  function load(relative) {
    const filename = path.resolve(source, relative);
    assert.ok(filename.startsWith(source + path.sep));
    if (cache.has(filename)) return cache.get(filename);
    const requireLocal = name => {
      if (Object.hasOwn(overrides, name)) return overrides[name];
      if (name === 'zod') return require('zod');
      assert.ok(name.startsWith('.'), `Unexpected dependency: ${name}`);
      const base = path.resolve(path.dirname(filename), name);
      const found = [base, base + '.ts', base + '.tsx'].find(p => fs.existsSync(p) && fs.statSync(p).isFile());
      assert.ok(found, `Missing source dependency: ${name}`);
      return load(path.relative(source, found));
    };
    const result = compile(read(filename), filename, { require: requireLocal });
    cache.set(filename, result);
    return result;
  }
  return load;
}
function nodes(value, result = []) {
  if (Array.isArray(value)) value.forEach(x => nodes(x, result));
  else if (value && typeof value === 'object' && value.props) { result.push(value); nodes(value.props.children, result); }
  return result;
}
const CHILD = '11111111-1111-4111-8111-111111111111';
const SPACE = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
function store(initial) { let value = initial; return { getSnapshot: () => value, subscribe: () => () => {}, set(next) { value = next; } }; }
function fixture(t, { shared = false, oldKind = null, upload = false, blockNavigation = false } = {}) {
  let pathname = '/', value, tree;
  const navigation = [], requested = [];
  const theme = { chineseFont: 'synthetic', colors: {}, mobileIcons: {}, mobileLayout: {}, mobileType: {}, radius: {}, spacing: {} };
  const load = loader({ react: shallowReact, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'expo-router': { usePathname: () => pathname },
    'react-native': { Platform: { OS: 'web' }, Pressable: 'Pressable', View: 'View', StyleSheet: { create: x => x } },
    'react-native-paper': { Text: 'Text' }, '../theme': theme,
    './appearance/BackgroundSurface': { BackgroundSurface: 'BackgroundSurface' },
    './AppIcon': { AppIcon: 'AppIcon' }, './photos/PhotoFilePicker': { PhotoFilePicker: 'PhotoFilePicker' },
  });
  const draftModule = load('frontend/src/assistant-draft.ts');
  const { sharedChildScopeKey } = load('src/client/shared-child-controller.ts');
  const { sharedChildViewSchema } = load('src/shared/sharing-control.ts');
  const sharedView = shared ? sharedChildViewSchema.parse({ spaceId: SPACE, childId: CHILD,
    childName: 'Synthetic child', spaceName: 'Synthetic family', role: 'viewer', modules: ['care'],
    basis: { spaceVersion: 1, membershipVersion: 1, shareVersion: 1, actorAuthorizationVersion: '1', sourceAuthorizationVersion: '1' },
  }) : null;
  const sharedChild = { identityKey: 'identity-a', userId: USER, online: true, phase: 'ready', error: null,
    target: shared ? { spaceId: SPACE, childId: CHILD } : null, view: sharedView };
  const scopeKey = shared ? sharedChildScopeKey(sharedChild) : 'personal-a';
  const child = { id: CHILD, displayName: 'Synthetic child', accessRole: 'owner' };
  const records = { user: { id: USER, name: 'Synthetic caregiver' }, children: [child], childrenLoadedAt: '2026-11-05T00:00:00Z',
    childrenLoading: false, childrenError: null, online: true, auth: 'signedIn', records: [], recordsLoading: false,
    recordsError: null, recordsLoadedAt: '2026-11-05T00:00:00Z', childOutcome: 'draft', childMessage: null,
    busy: null, drafts: {}, notice: null, deletion: null, logoutConfirmation: false };
  const chat = { selectedChildId: CHILD, messages: [], drafts: { [CHILD]: { text: 'Existing text', phase: 'draft' } }, busy: false };
  const draftOwner = draftModule.createAssistantDraftOwner(); draftOwner.retainScope(shared ? null : scopeKey);
  let oldDisposed = 0;
  const old = oldKind ? { id: 'existing', kind: oldKind, fileName: 'synthetic.bin', mimeType: 'application/octet-stream', bytes: 3, dispose() { oldDisposed++; } } : null;
  if (old) assert.equal(draftOwner.add(scopeKey, old), true);
  const idle = { localId: null, voice: null, file: null, photo: null, busy: false, unknown: false };
  const owner = Object.assign(store({ scopeKey, identityKey: 'identity-a', sharedChild, records, activeChild: child,
    chat, account: { gate: 'ready' }, sessionGeneration: 1, homeIntroductionPending: false }), {
    draftOwner, apiBaseUrl: '/synthetic', agentOwner: store({ model: { busy: null, pendingDecision: null }, inbox: null, runs: [], pending: null }),
    authorizationOwner: store({ busy: null, pending: null }), voiceOwner: store({ ...idle }), fileOwner: store({ ...idle }),
    photoOwner: store({ ...idle, localId: upload ? 'existing' : null }),
    controller: { getSnapshot: () => records }, chatController: { getSnapshot: () => chat, hasUnsavedInput: () => true, setText: deny },
    canStartDomainWrite: () => false, chatWritesAllowed: () => !owner.getSnapshot().sharedChild.target,
    markHomeIntroductionPresented: deny,
  });
  t.after(() => draftOwner.dispose());
  const filename = path.join(source, 'frontend/src/production/ProductionProvider.tsx');
  const original = read(filename), ast = ts.createSourceFile(filename, original, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'useProductionValue');
  assert.ok(declaration, 'The complete original useProductionValue hook must exist');
  const body = original.slice(declaration.getStart(ast), declaration.end);
  extracted.set(filename, { path: path.relative(source, filename), start: declaration.getStart(ast), end: declaration.end, sha256: digest(body) });
  const useProductionValue = compile(body + '\nexports.useProductionValue = useProductionValue;', filename, {
    ...shallowReact, ...draftModule,
    projectProductionHome: load('frontend/src/production/home-projection.ts').projectProductionHome,
    productionDestinations: load('frontend/src/production/routes.ts').productionDestinations,
    usePathname: () => pathname, useRouter: () => ({ push: target => navigation.push(target) }),
    usePreviewNavigation: () => (callback, reason) => { requested.push(reason); if (!blockNavigation) callback(); },
    useNativePushNavigation() {}, Linking: { openURL: deny },
  }).useProductionValue;
  const HomeQuickActions = load('frontend/src/components/HomeQuickActions.tsx').HomeQuickActions;
  const providerHooks = hooks(), captureHooks = hooks();
  function render() {
    value = providerHooks.run(() => useProductionValue(owner));
    const outer = HomeQuickActions({ model: value.model, actions: value.actions });
    tree = captureHooks.run(() => outer.type(outer.props));
  }
  render();
  const picker = () => nodes(tree).find(node => node.type === 'PhotoFilePicker');
  const entries = () => [picker().props.renderTrigger({ disabled: picker().props.disabled, reading: false, onPress: deny }),
    ...nodes(tree).filter(node => node.type === 'Pressable')];
  return { owner, old, oldDisposed: () => oldDisposed, navigation, requested, render,
    value: () => value, pick(original) { picker().props.onPick(original); render(); },
    controls(disabled) { assert.equal(picker().props.disabled, disabled); assert.equal(entries().length, 3);
      for (const entry of entries()) assert.equal(entry.props.disabled, disabled);
      assert.equal(entries()[0].props['aria-busy'], disabled);
    },
    changePath(next) { pathname = next; render(); }, hookHash: digest(body),
  };
}
function photo() { let disposed = 0; return { value: { fileName: 'synthetic.png', mimeType: 'image/png', bytes: 1,
  sha256: '0'.repeat(64), imageSource: { uri: 'synthetic:photo' }, dispose() { disposed++; } }, disposed: () => disposed }; }

test('shared admission rejection restores all home controls and allows a fresh attempt', t => {
  const f = fixture(t, { shared: true }); f.controls(false);
  for (let i = 0; i < 2; i++) { const p = photo(); f.pick(p.value); f.controls(false);
    assert.equal(p.disposed(), 1); assert.equal(f.owner.draftOwner.getSnapshot().attachments.length, 0); }
  assert.equal(f.navigation.length, 0); assert.equal(f.requested.length, 0);
});
test('existing file rejection preserves its owner and unlocks home controls', t => {
  const f = fixture(t, { oldKind: 'file' }), p = photo(); f.pick(p.value); f.controls(false);
  assert.equal(f.owner.draftOwner.getSnapshot().attachments[0], f.old); assert.equal(f.oldDisposed(), 0);
  assert.equal(p.disposed(), 1); assert.equal(f.navigation.length, 0);
  assert.equal(f.owner.getSnapshot().chat.drafts[CHILD].text, 'Existing text');
});
test('an existing upload localId rejects only the incoming photo and restores controls', t => {
  const f = fixture(t, { oldKind: 'photo', upload: true }), p = photo(); f.pick(p.value); f.controls(false);
  assert.equal(f.owner.photoOwner.getSnapshot().localId, 'existing'); assert.equal(f.oldDisposed(), 0);
  assert.equal(f.owner.draftOwner.getSnapshot().attachments[0], f.old); assert.equal(p.disposed(), 1);
  assert.equal(f.navigation.length, 0);
});
test('a retained callback after scope replacement returns false and disposes the incoming photo', t => {
  const f = fixture(t), stale = f.value().actions, p = photo();
  f.owner.draftOwner.retainScope('personal-b'); f.owner.set({ ...f.owner.getSnapshot(), scopeKey: 'personal-b' }); f.render();
  assert.equal(stale.openAgentPhoto(p.value), false); assert.equal(p.disposed(), 1);
  assert.equal(f.owner.draftOwner.getSnapshot().attachments.length, 0); assert.equal(f.navigation.length, 0);
});
test('a retained home callback after route departure returns false without requesting navigation', t => {
  const f = fixture(t), stale = f.value().actions, p = photo(); f.changePath('/care');
  assert.equal(stale.openAgentPhoto(p.value), false); assert.equal(p.disposed(), 1); assert.equal(f.requested.length, 0);
});
test('private admission reports true and transfers ownership without releasing the photo', t => {
  const f = fixture(t), p = photo(); assert.equal(f.value().actions.openAgentPhoto(p.value), true);
  assert.equal(f.owner.draftOwner.getSnapshot().attachments[0].photo, p.value); assert.equal(p.disposed(), 0);
  assert.deepEqual(f.navigation, ['/chat']); assert.deepEqual(f.requested, ['workspace']);
});
test('accepted photo keeps the opening latch while synthetic navigation remains blocked', t => {
  const f = fixture(t, { blockNavigation: true }), p = photo(); f.pick(p.value); f.controls(true);
  assert.equal(f.owner.draftOwner.getSnapshot().attachments[0].photo, p.value); assert.equal(p.disposed(), 0);
  assert.equal(f.navigation.length, 0); assert.deepEqual(f.requested, ['workspace']);
});
test('a draft-owner admission failure reports false and releases the new original once', t => {
  const f = fixture(t), p = photo(); f.owner.draftOwner.retainScope(null);
  assert.equal(f.value().actions.openAgentPhoto(p.value), false); assert.equal(p.disposed(), 1);
  assert.equal(f.owner.draftOwner.getSnapshot().attachments.length, 0); assert.equal(f.requested.length, 0);
});
test.after(() => {
  for (const [filename, pin] of loaded) assert.equal(digest(fs.readFileSync(filename)), pin.sha256, filename);
  if (process.env.HOME_PHOTO_WIRING_RESULT) fs.writeFileSync(process.env.HOME_PHOTO_WIRING_RESULT, JSON.stringify({
    sourceFiles: [...loaded.values()], completeHookExtractions: [...extracted.values()], boundary: 'Complete original hook and component with shallow hooks/UI/router ports; effects and picker not executed. Not mounted/browser acceptance.',
  }, null, 2) + '\n');
});
