const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createRequire } = require('node:module');
if (!process.env.JSDOM_MODULE) throw new Error('Supply JSDOM_MODULE for an existing jsdom installation.');
const { JSDOM } = require(process.env.JSDOM_MODULE);
const dom = new JSDOM('<!doctype html><html><body><main id="root"></main></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'ShadowRoot', 'Document']) global[key] = dom.window[key];
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
global.requestAnimationFrame = window.requestAnimationFrame.bind(window);
global.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
global.IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(HTMLElement.prototype, 'getClientRects', { configurable: true, value() { return this.isConnected && !this.closest('[hidden],[aria-hidden="true"]') ? [{}] : []; } });
const root = path.resolve(__dirname, '../..'), req = createRequire(path.join(root, 'frontend/package.json'));
const React = req('react'), { createRoot } = req('react-dom/client'), native = req('react-native-web'), ts = req('typescript');
const Module = require('node:module'), originalLoad = Module._load;
Module._load = function(name, parent, isMain) {
  if (name === 'react-native') return native;
  if (name === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }), SafeAreaView: native.View };
  if (name.endsWith('/SafeAreaProviderCompat')) return { __esModule: true, default: p => p.children };
  if (name.endsWith('/MaterialCommunityIcon')) return { __esModule: true, default: () => null };
  return originalLoad.call(this, name, parent, isMain);
};
const paper = req('react-native-paper'), e = React.createElement, cache = new Map();
let productionOwner;
// Actual avatar owner, hook, editor, web picker, FormDialog and navigation guard.
// The API is synthetic. Motion/scroll are bounded ports; Paper Button preserves
// names, focus, disabled semantics and callbacks without the unrelated UI module.
function load(file) {
  const filename = path.resolve(root, file); if (cache.has(filename)) return cache.get(filename).exports;
  const module = { exports: {} }; cache.set(filename, module);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('require', 'module', 'exports', code)(name => {
    if (name === 'react-native') return native;
    if (name.endsWith('/ProductionProvider')) return { useProductionOwner: () => productionOwner };
    if (name === 'expo-router') return { usePathname: () => '/settings', useRouter: () => ({ push() {} }), Link: native.View };
    if (name === 'expo-router/react-navigation') return { useNavigation: () => ({ dispatch() {} }), usePreventRemove() {} };
    if (name === './browser-history-guard') return { guardBrowserHistory: () => () => {} };
    if (name.endsWith('/AppScrollView')) return { AppScrollView: native.ScrollView };
    if (name.endsWith('/ui')) return { AppButton: p => e(paper.Button, { ref: p.ref, onPress: p.onPress, disabled: p.disabled, accessibilityLabel: p.accessibilityLabel ?? p.label }, p.label) };
    if (name.endsWith('/motion')) return { motionTokens: { dialog: { distance: 12, duration: 0 } }, useMotionPreferences: () => ({ enabled: false, epoch: 0 }), MotionBackdrop: () => null };
    if (name.endsWith('/MotionPaperScope')) return { MotionPaperScope: p => p.children };
    if (name.endsWith('/useModalBackdrop')) return { useModalBackdrop: () => ({}) };
    if (name.startsWith('.')) {
      const base = path.resolve(path.dirname(filename), name), found = [base, base + '.web.tsx', base + '.tsx', base + '.ts'].find(value => fs.existsSync(value) && fs.statSync(value).isFile());
      if (found) return load(found);
    }
    return req(name);
  }, module, module.exports);
  return module.exports;
}
const { AvatarOwner } = load('frontend/src/production/AvatarOwner.ts');
const { AvatarApiError } = load('src/client/avatars-api.ts');
const { AvatarEditor } = load('frontend/src/components/avatar/AvatarEditor.tsx');
const { useProductionAvatar } = load('frontend/src/production/useProductionAvatar.ts');
const { PreviewNavigationGuard } = load('frontend/src/preview/PreviewNavigationGuard.tsx');
const { paperTheme } = load('frontend/src/theme.ts');
const renderer = createRoot(document.getElementById('root'));
const button = label => document.querySelector(`[aria-label="${label}"]`);
const byId = id => document.querySelector(`[data-testid="${id}"]`);
async function click(label) { const node = button(label); assert.ok(node, label); await React.act(async () => { node.focus(); node.click(); }); }
async function render(child) { await React.act(async () => renderer.render(e(paper.PaperProvider, { theme: paperTheme, settings: { rippleEffectEnabled: false } }, child))); }
function Driver() { const props = useProductionAvatar('self', true); return e(AvatarEditor, { ...props, kind: 'self', name: '合成家長' }); }
function fixture(withAsset = false) {
  const target = { kind: 'self' }, policy = { policyId: 'synthetic-v1', acceptedMimeTypes: ['image/jpeg', 'image/png'], maxInputBytes: 1024, maxInputPixels: 1e6, maxInputDimension: 2000, outputSize: 256, maxOutputBytes: 1024, maxCropZoom: 8 };
  const asset = { id: '33333333-3333-4333-8333-333333333333', mimeType: 'image/jpeg', bytes: 3, sha256: 'a'.repeat(64), width: 256, height: 256 };
  const data = { current: { target, version: withAsset ? 1 : 0, asset: withAsset ? asset : null, canManage: true, updatedAt: withAsset ? '2026-10-23T00:00:00Z' : null }, pending: false, receipt: null, writes: [] };
  const api = {
    read: async () => ({ avatar: data.current, policy }), content: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }),
    reserve: async (_target, input) => { data.writes.push(['reserve', input]); data.pending = true; throw new AvatarApiError(); },
    remove: async (_target, input) => { data.writes.push(['remove', input]); data.current = { ...data.current, version: data.current.version + 1, asset: null }; return { avatar: data.current, cleanupPending: true }; },
    hasPendingOnline: () => data.pending, resetOnline: () => { data.pending = false; },
    reconcilePending: async () => { if (data.receipt?.state === 'confirmed') data.pending = false; return data.receipt; },
  };
  const owner = new AvatarOwner(api, () => {}, () => true, () => {}), pending = new Map();
  productionOwner = { avatarOwner: owner, setDomainPending: (id, value) => value ? pending.set(id, true) : pending.delete(id) };
  owner.syncContext({ key: 'synthetic-identity', userId: 'synthetic-user' }, null, true);
  const image = { uri: 'blob:synthetic-crop', width: 120, height: 80, mimeType: 'image/png', bytes: new Uint8Array([1, 2, 3]), disposed: 0, dispose() { this.disposed++; this.bytes.fill(0); } };
  return { owner, lane: owner.self, data, image, pending,
    async select() { await React.act(async () => owner.self.select(owner.self.beginSelection(), image)); },
    async mount() { await render(e(PreviewNavigationGuard, {}, e(Driver))); },
    async close() { await render(null); owner.dispose(); },
  };
}

test('actual editor offers named crop controls and guarded close without uploading a local selection', async () => {
  const f = fixture(); try {
    await f.mount(); const trigger = button('調整本人頭像'); await click('調整本人頭像'); await f.select();
    assert.ok(document.querySelector('input[type="file"][accept="image/jpeg,image/png"][tabindex="-1"]'));
    await click('放大頭像裁切'); assert.equal(f.lane.getSnapshot().crop.zoom, 1.25);
    await click('裁切範圍向右'); assert.ok(f.lane.getSnapshot().crop.centerX > .5);
    await click('重設裁切'); assert.deepEqual(f.lane.getSnapshot().crop, { centerX: .5, centerY: .5, zoom: 1 });
    assert.equal(button('縮小頭像裁切').getAttribute('aria-disabled'), 'true');
    await click('關閉本人頭像'); assert.ok(byId('leave-preview-dialog')); assert.ok(f.lane.getSnapshot().selected);
    await click('繼續編輯'); assert.ok(byId('manual-form-dialog')); assert.equal(f.image.disposed, 0);
    await click('關閉本人頭像'); await click('捨棄草稿並離開');
    assert.equal(byId('manual-form-dialog'), null); assert.equal(f.lane.getSnapshot().selected, null);
    assert.equal(f.image.disposed, 1); assert.equal(document.activeElement, trigger); assert.deepEqual(f.data.writes, []);
  } finally { await f.close(); }
});

test('actual editor blocks close and second writes while the original operation is unknown', async () => {
  const f = fixture(); try {
    await f.mount(); await click('調整本人頭像'); await f.select(); await click('保存頭像');
    assert.equal(f.lane.getSnapshot().unknown, true); assert.equal(f.pending.size, 1);
    for (const label of ['選擇圖片', '保存頭像', '取消選圖', '取消並關閉']) assert.equal(button(label).getAttribute('aria-disabled'), 'true', label);
    await click('關閉本人頭像'); assert.ok(byId('leave-preview-dialog')); assert.equal(button('捨棄草稿並離開'), null);
    await click('留在此頁查核'); assert.equal(f.data.writes.length, 1);
    f.data.receipt = { state: 'confirmed', kind: 'reserve', target: { kind: 'self' }, result: null };
    await click('查核原頭像操作'); assert.equal(f.lane.getSnapshot().unknown, false); assert.equal(f.pending.size, 0);
    assert.equal(f.image.disposed, 1); assert.equal(f.data.writes.length, 1); assert.equal(button('保存頭像'), null);
    await click('取消並關閉'); assert.equal(byId('manual-form-dialog'), null);
  } finally { await f.close(); }
});

test('remove confirmation is invalidated when a different avatar version becomes current', async () => {
  const f = fixture(true); try {
    await f.mount(); await click('調整本人頭像'); await click('移除頭像'); assert.ok(button('確認移除頭像'));
    f.data.current = { ...f.data.current, version: 2, asset: { ...f.data.current.asset, id: '44444444-4444-4444-8444-444444444444' } };
    await React.act(async () => f.lane.load());
    assert.equal(!!button('確認移除頭像'), false, 'Review of a previous head must not authorize removal of a newer head');
    assert.deepEqual(f.data.writes, []);
    await click('移除頭像'); await click('確認移除頭像');
    assert.deepEqual(f.data.writes, [['remove', { expectedVersion: 2, confirmRemove: true }]]);
    assert.match(f.lane.getSnapshot().notice, /移除.*清理中/);
  } finally { await f.close(); }
});

test.after(async () => { await React.act(async () => renderer.unmount()); Module._load = originalLoad; dom.window.close(); });
