import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { harness } from './scope-transition-harness.mjs';
import { backgroundImageMime } from '../src/platform/background-image.ts';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function picture(id) { return { uri: `blob:synthetic-${id}`, filename: '自選圖片', released: 0, dispose() { this.released++; } }; }
function context(storage, initial = 'service-a:user-a') {
  const mocks = { '../platform/background-storage': { backgroundStorage: storage }, '../../assets/images/harbour-family-hero.png': 123 };
  const h = harness(mocks); mocks['expo-router'] = { useFocusEffect: callback => h.react.useEffect(callback, [callback]) };
  const { BackgroundProvider, useBackground } = h.load('src/preview/BackgroundContext.tsx');
  let value, scope = initial;
  function Probe() { value = useBackground(); return null; }
  const render = () => h.render(h.jsx(BackgroundProvider, { scope, children: h.jsx(Probe, {}) }));
  render(); return { h, value: () => value, render, scope(next) { scope = next; render(); } };
}

test('local background provider commits only saved images, restores defaults and releases transient URLs', async () => {
  const first = picture('first'), second = picture('saved-second'), input = picture('input'), gate = deferred(), calls = [];
  const s = context({ read: async scope => { calls.push(['read', scope]); return first; }, save: async scope => { calls.push(['save', scope]); return gate.promise; }, remove: async scope => calls.push(['remove', scope]) });
  await flush(); s.render(); assert.equal(s.value().selected, first);
  const save = s.value().select(input); s.render(); assert.equal(s.value().selected, first); assert.equal(s.value().busy, true);
  gate.resolve(second); await save; s.render(); assert.equal(s.value().selected, second); assert.equal(input.released, 1); assert.equal(first.released, 1);
  s.value().imageFailed(first); s.render(); assert.equal(s.value().selected, second, 'late error from replaced image cannot clear the current image');
  await s.value().restore(); s.render(); assert.equal(s.value().selected, null); assert.equal(second.released, 1);
  assert.deepEqual(calls, [['read', 'service-a:user-a'], ['save', 'service-a:user-a'], ['remove', 'service-a:user-a']]);
});

test('storage failure keeps the current photo and reports unavailability rather than successful persistence', async () => {
  const first = picture('old'), input = picture('rejected');
  const s = context({ read: async () => first, save: async () => { throw new Error('Synthetic quota'); }, remove: async () => { throw new Error('Synthetic unavailable'); } });
  await flush(); s.render(); await s.value().select(input); s.render();
  assert.equal(s.value().selected, first); assert.equal(first.released, 0); assert.equal(input.released, 1); assert.ok(s.value().notice.includes('未能保存'));
  await s.value().restore(); s.render(); assert.equal(s.value().selected, first); assert.ok(s.value().notice.includes('未能清除'));
  s.value().imageFailed(first); s.render(); assert.equal(s.value().selected, null); assert.ok(s.value().notice.includes('未能顯示'));
});

test('scope changes and logout synchronously hide the old picture and reject late local reads or saves', async () => {
  const old = picture('old'), late = picture('late'), newPhoto = picture('new'), saveGate = deferred();
  const s = context({ read: async scope => scope.endsWith('user-a') ? old : newPhoto, save: async () => saveGate.promise, remove: async () => {} });
  await flush(); s.render(); const input = picture('input'), save = s.value().select(input);
  s.scope('service-b:user-b'); assert.equal(s.value().selected, null); assert.equal(old.released, 1);
  saveGate.resolve(late); await save; await flush(); s.render(); assert.equal(s.value().selected, newPhoto); assert.equal(late.released, 1);
  s.scope(null); assert.equal(s.value().selected, null); assert.equal(newPhoto.released, 1);
  const a = deferred(), b = picture('read-b'), readLate = picture('late-read');
  const read = context({ read: scope => scope.endsWith('user-a') ? a.promise : Promise.resolve(b), save() {}, remove() {} });
  read.scope('service-a:user-b'); await flush(); read.render(); a.resolve(readLate); await flush(); read.render();
  assert.equal(read.value().selected, b); assert.equal(readLate.released, 1);
});

test('the authenticated shell owns one background and Home has one compact reading glass panel', () => {
  const layout = readFileSync(new URL('../app/(dashboard)/_layout.tsx', import.meta.url), 'utf8');
  assert.match(layout, /<ProductionGate><BackgroundProvider key=\{identityKey\} scope=\{backgroundScope\}><ProductionDomains>/);
  assert.match(layout, /<AppBackdrop>\{Platform.OS/);
  assert.match(layout, /JSON.stringify\(\[owner.apiBaseUrl, user.id\]\)/);
  for (const file of ['HomeDashboard.tsx', 'MobileHomeDashboard.tsx']) {
    const code = readFileSync(new URL('../src/components/' + file, import.meta.url), 'utf8');
    assert.ok(!code.includes('HomeBackdrop') && !code.includes('readingSurface'));
    assert.ok(code.includes('<HomeWelcome') && code.includes('<BackgroundSurface padded frosted'));
    assert.equal((code.match(/<BackgroundSurface\b/g) ?? []).length, 1);
    assert.ok(code.includes('testID="home-reading-panel"'));
    assert.ok(code.indexOf('<HomeWelcome') < code.indexOf('<BackgroundSurface'), 'greeting lifecycle stays outside the reading panel');
  }
  const mocks = {
    '../../theme': { colors: { paper: '#FFFFFE', canvas: '#F7FCFC' }, radius: { medium: 16 }, spacing: { lg: 16 } },
    '../../preview/BackgroundContext': { useBackground: () => background },
  };
  const selected = picture('synthetic'), failures = [];
  let background = { selected, source: { uri: selected.uri }, imageFailed: image => failures.push(image) };
  const h = harness(mocks), { AppBackdrop } = h.load('src/components/appearance/AppBackdrop.tsx');
  h.render(h.jsx(AppBackdrop, { children: null }));
  assert.equal(h.hosts().filter(node => node.props.testID === 'custom-app-background').length, 1);
  assert.ok(h.hosts().some(node => node.props.pointerEvents === 'none' && node.props['aria-hidden']));
  assert.equal(h.node('custom-app-background').props.accessible, false);
  h.node('custom-app-background').props.onError(); assert.deepEqual(failures, [selected]);
  background = { ...background, selected: null }; h.render(); assert.equal(h.node('custom-app-background'), undefined);
});

test('one reading panel suppresses additional glass without changing original solid card styles or native fallback', () => {
  const h = harness({ '../../theme': { colors: { paper: '#FFFFFE' }, radius: { medium: 16 }, spacing: { lg: 16 } } });
  const { BackgroundSurface, BackgroundSurfaceProvider } = h.load('src/components/appearance/BackgroundSurface.tsx');
  const flatten = value => Array.isArray(value) ? Object.assign({}, ...value.filter(Boolean).map(flatten)) : value || {};
  const children = h.jsx(BackgroundSurface, { testID: 'module', padded: true, frosted: true, children: h.jsx(BackgroundSurface, { testID: 'nested', padded: true, style: { backgroundColor: '#E3F6F5', borderRadius: 12, padding: 8 } }) });
  h.render(children); assert.deepEqual(flatten(h.node('module').props.style), {});
  h.render(h.jsx(BackgroundSurfaceProvider, { active: true, children }));
  assert.equal(flatten(h.node('module').props.style).backgroundColor, '#FFFFFE');
  assert.equal(flatten(h.node('module').props.style).padding, 16);
  assert.deepEqual(flatten(h.node('nested').props.style), { backgroundColor: '#E3F6F5', borderRadius: 12, padding: 8 }, 'deduplication must never strip an original card');
  h.render(h.jsx(BackgroundSurfaceProvider, { active: false, children }));
  assert.deepEqual(flatten(h.node('module').props.style), {});
});

test('Web frost has a fixed blur, opaque unsupported/reduced-transparency fallbacks and no per-message blur', () => {
  const css = readFileSync(new URL('../src/components/appearance/backgroundSurface.css', import.meta.url), 'utf8');
  assert.match(css, /@supports/); assert.match(css, /blur\(12px\)/);
  assert.match(css, /prefers-reduced-transparency: reduce/); assert.match(css, /forced-colors: active/);
  assert.match(css, /backdrop-filter: none/); assert.match(css, /0\.84/); assert.match(css, /0\.94/);
  const message = readFileSync(new URL('../src/components/chat/ChatMessage.tsx', import.meta.url), 'utf8');
  assert.ok(!message.includes('BackgroundSurface') && !message.includes('frosted'), 'original message bubbles are not glass surfaces');
  const settings = readFileSync(new URL('../src/components/appearance/BackgroundSettings.tsx', import.meta.url), 'utf8');
  assert.ok(settings.includes('應用背景') && settings.includes('首頁、聊天及其他頁面'));
});

test('shared pages retain visible named regions without repeated title text or empty header spacing', () => {
  const theme = { colors: { paper: '#FFFFFE', canvas: '#F7FCFC' }, radius: { medium: 16 }, spacing: { lg: 16 }, mobileLayout: { breakpoint: 650 }, mobileType: {}, typeScale: {} };
  const h = harness({ '../../theme': theme, '../theme': theme,
    './useContainerWidth': { useContainerWidth: () => ({ width: 390, ref: { current: null }, onLayout() {} }) },
    './AppScrollView': { AppScrollView: 'ScrollView' } });
  const { PageFrame } = h.load('src/components/PageFrame.tsx');
  h.render(h.jsx(PageFrame, { title: '檔案', children: h.jsx('Text', { children: 'Known profile' }) }));
  const region = h.hosts().find(node => node.props.role === 'region');
  assert.equal(region.props.accessibilityLabel, '檔案'); assert.equal(region.props.tabIndex, -1);
  assert.equal(region.props.dataSet.pageSurface, 'true');
  assert.equal(h.hosts().some(node => node.props.children === '檔案'), false);
  assert.equal(h.hosts().filter(node => node.type === 'View').length, 2, 'only the named page region and single reading panel remain; no empty heading wrapper');
  assert.ok(h.node('page-reading-panel'));
  h.render(h.jsx(PageFrame, { title: '歷史', description: 'Keep useful description', headerActions: h.jsx('Button', { label: 'History action' }), children: null }));
  assert.ok(h.hosts().some(node => node.props.children === 'Keep useful description'));
  assert.ok(h.hosts().some(node => node.props.label === 'History action'));
  const shell = readFileSync(new URL('../src/components/AppShell.tsx', import.meta.url), 'utf8');
  assert.match(shell, /querySelector<HTMLElement>\('\[data-page-surface="true"\]'\)/);
});


test('shared page glass is exactly one layer, while nested wrappers and original card styles are preserved', () => {
  const theme = { colors: { paper: '#FFFFFE', canvas: '#F7FCFC' }, radius: { medium: 16 }, spacing: { lg: 16 }, mobileLayout: { breakpoint: 650 }, mobileType: {}, typeScale: {} };
  const h = harness({ '../../theme': theme, '../theme': theme,
    './background-surface-style': { backgroundSurfaceProps: frosted => ({ dataSet: { backgroundSurface: frosted ? 'frosted' : 'tint' } }) },
    './useContainerWidth': { useContainerWidth: () => ({ width: 390, ref: { current: null }, onLayout() {} }) },
    './AppScrollView': { AppScrollView: 'ScrollView' } });
  const { PageFrame } = h.load('src/components/PageFrame.tsx');
  const { BackgroundSurface, BackgroundSurfaceProvider } = h.load('src/components/appearance/BackgroundSurface.tsx');
  h.render(h.jsx(BackgroundSurfaceProvider, { active: true, children: h.jsx(PageFrame, { title: '記錄', description: 'Keep the existing description', children:
    h.jsx(BackgroundSurface, { testID: 'nested-bare', padded: true, frosted: true, dataSet: { pageSurface: 'true' }, children: h.jsx('View', { testID: 'original-card', style: { backgroundColor: '#FFFFFF', borderRadius: 12, padding: 16 } }) }) }) }));
  assert.deepEqual(h.hosts().filter(node => node.props.dataSet?.backgroundSurface).map(node => node.props.testID), ['page-reading-panel']);
  assert.deepEqual(h.node('original-card').props.style, { backgroundColor: '#FFFFFF', borderRadius: 12, padding: 16 });
  assert.equal(h.node('nested-bare').props.dataSet.pageSurface, 'true');
  h.render(h.jsx(BackgroundSurfaceProvider, { active: true, children: h.jsx(BackgroundSurface, { frosted: true, testID: 'tasks-panel', dataSet: { pageSurface: 'true' } }) }));
  assert.deepEqual(h.node('tasks-panel').props.dataSet, { pageSurface: 'true', backgroundSurface: 'frosted' }, 'the glass decoration must preserve route/modal focus markers');
  const ui = readFileSync(new URL('../src/components/ui.tsx', import.meta.url), 'utf8');
  const sectionCard = ui.slice(ui.indexOf('export function SectionCard'), ui.indexOf('export function SectionHeader'));
  assert.match(sectionCard, /return <View/); assert.ok(!sectionCard.includes('BackgroundSurface'));
  const important = readFileSync(new URL('../src/components/HomeAgentImportant.tsx', import.meta.url), 'utf8');
  assert.ok(!important.includes('importantOnBackground'));
  for (const [file, marker] of [['components/tasks/TasksView.tsx', 'tasks-reading-panel'], ['screens/chatScreen.tsx', 'chat-reading-panel']]) {
    const code = readFileSync(new URL('../src/' + file, import.meta.url), 'utf8');
    assert.equal((code.match(new RegExp('testID="' + marker + '"', 'g')) ?? []).length, 1);
  }
});

function compile(file, resolve, withoutGlobalCrypto = false) {
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL('../src/' + file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'module', 'exports', 'crypto', code)(resolve, module, module.exports, withoutGlobalCrypto ? undefined : globalThis.crypto); return module.exports;
}
function indexedDatabase() {
  const values = new Map(); let fail = false;
  const fake = { open() { const request = {}; queueMicrotask(() => {
    request.result = { objectStoreNames: { contains: () => true }, close() {}, transaction(_name, mode) {
      const transaction = {}, staged = new Map(values);
      const run = action => { const result = { result: action(staged) }; queueMicrotask(() => {
        if (fail && mode === 'readwrite') transaction.onabort?.(); else { if (mode === 'readwrite') { values.clear(); for (const [key, value] of staged) values.set(key, value); } transaction.oncomplete?.(); }
      }); return result; };
      transaction.objectStore = () => ({ get: key => run(map => map.get(key)), put: (value, key) => run(map => map.set(key, value)), delete: key => run(map => map.delete(key)) });
      return transaction;
    } }; request.onsuccess();
  }); return request; } };
  return { fake, values, fail(value) { fail = value; } };
}
test('Web Blob storage is scope-keyed, survives new consumers, and failed transactions preserve previous data', async () => {
  const previous = globalThis.indexedDB, db = indexedDatabase(); globalThis.indexedDB = db.fake;
  try {
    const { backgroundStorage } = compile('platform/background-storage.ts', () => { throw new Error('Unexpected dependency'); });
    const blob = new Blob(['synthetic'], { type: 'image/png' });
    const saved = await backgroundStorage.save('service:user-a', { blob }); saved.dispose();
    const loaded = await backgroundStorage.read('service:user-a'); assert.equal(loaded.blob, blob); loaded.dispose();
    assert.equal(await backgroundStorage.read('service:user-b'), null);
    db.fail(true); await assert.rejects(backgroundStorage.save('service:user-a', { blob: new Blob(['new'], { type: 'image/png' }) }));
    assert.equal(db.values.get('service:user-a'), blob);
    db.fail(false); await backgroundStorage.remove('service:user-a'); assert.equal(await backgroundStorage.read('service:user-a'), null);
    await assert.rejects(backgroundStorage.save('service:user-a', { blob: new Blob(['x'], { type: 'image/svg+xml' }) }));
  } finally { if (previous === undefined) delete globalThis.indexedDB; else globalThis.indexedDB = previous; }
});

test('local selection only accepts bounded raster signatures, not SVG or filename hints', () => {
  assert.equal(backgroundImageMime(new Uint8Array([0xff, 0xd8, 0xff])), 'image/jpeg');
  assert.equal(backgroundImageMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10])), 'image/png');
  assert.equal(backgroundImageMime(new TextEncoder().encode('RIFFxxxxWEBP')), 'image/webp');
  assert.equal(backgroundImageMime(new TextEncoder().encode('<svg>synthetic</svg>')), null);
  assert.equal(backgroundImageMime(new Uint8Array()), null);
});

function nativePorts() {
  const files = new Map(), secrets = new Map(), calls = []; let failCommit = false, chooser = { canceled: true }, serial = 0;
  class Directory { constructor(...parts) { this.uri = parts.map(value => value.uri ?? value).join('/'); } create() {} }
  class File {
    constructor(...parts) { this.uri = parts.map(value => value.uri ?? value).join('/'); this.name = this.uri.split('/').at(-1); }
    get exists() { return files.has(this.uri); } get size() { return files.get(this.uri)?.length ?? 0; }
    async bytes() { return files.get(this.uri); }
    copy(destination) { calls.push(['copy', this.uri]); files.set(destination.uri, files.get(this.uri).slice()); }
    delete() { calls.push(['delete', this.uri]); files.delete(this.uri); }
  }
  const secure = { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1, isAvailableAsync: async () => true,
    getItemAsync: async key => secrets.get(key) ?? null,
    setItemAsync: async (key, value) => { if (failCommit) throw new Error('Synthetic commit failure'); secrets.set(key, value); },
    deleteItemAsync: async key => { secrets.delete(key); } };
  const resolve = name => {
    if (name === 'expo-file-system') return { Directory, File, Paths: { document: 'file://private-app' } };
    if (name === 'expo-secure-store') return secure;
    if (name === 'expo-crypto') return { randomUUID: () => `00000000-0000-4000-8000-${String(++serial).padStart(12, '0')}`, CryptoDigestAlgorithm: { SHA256: 'sha256' }, digestStringAsync: async (_algorithm, value) => Array.from(new TextEncoder().encode(value), byte => byte.toString(16)).join('') };
    if (name === 'expo-image-picker') return { launchImageLibraryAsync: async options => { calls.push(['choose', options]); return chooser; } };
    if (name === './background-storage') return { backgroundMaxBytes: 4 * 1024 * 1024 };
    if (name === './background-image') return { backgroundImageMime };
    throw new Error('Unexpected native import: ' + name);
  };
  return { files, secrets, calls, resolve, fail(value) { failCommit = value; }, choose(value) { chooser = value; } };
}
test('native storage uses existing private-file and small-pointer ports, rolls back failed commits and separates accounts', async () => {
  const p = nativePorts(), { backgroundStorage } = compile('platform/background-storage.native.ts', p.resolve, true);
  const input = { uri: 'file://system-picker/synthetic.png' }; p.files.set(input.uri, new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
  const first = await backgroundStorage.save('service:user-a', input); assert.notEqual(first.uri, input.uri); assert.equal(p.files.has(input.uri), true);
  first.dispose(); assert.equal(p.files.has(first.uri), true, 'releasing presentation must not delete durable data');
  assert.equal((await backgroundStorage.read('service:user-a')).uri, first.uri); assert.equal(await backgroundStorage.read('service:user-b'), null);
  p.fail(true); await assert.rejects(backgroundStorage.save('service:user-a', input)); assert.equal((await backgroundStorage.read('service:user-a')).uri, first.uri);
  assert.equal(p.files.size, 2, 'failed candidate copy is removed, system source and previous file stay');
  p.fail(false); await backgroundStorage.remove('service:user-a'); assert.equal(await backgroundStorage.read('service:user-a'), null); assert.equal(p.files.has(input.uri), true);
  const [key] = ['background-' + Array.from(new TextEncoder().encode('service:user-a'), byte => byte.toString(16)).join('')];
  p.secrets.set(key, JSON.stringify('../../untrusted')); await backgroundStorage.remove('service:user-a'); assert.equal(p.secrets.has(key), false);
});

test('native background chooser runs only on demand and handles cancellation, unsupported, oversized and valid synthetic files', async () => {
  const p = nativePorts(), { pickBackgroundImage } = compile('platform/background-picker.native.ts', p.resolve);
  assert.equal(p.calls.length, 0); assert.equal(await pickBackgroundImage(), null);
  const uri = 'file://system-picker/synthetic.png';
  p.choose({ canceled: false, assets: [{ uri, width: 800, height: 600 }] });
  p.files.set(uri, new TextEncoder().encode('<svg>synthetic</svg>')); await assert.rejects(pickBackgroundImage());
  p.files.set(uri, new Uint8Array(4 * 1024 * 1024 + 1)); await assert.rejects(pickBackgroundImage());
  p.files.set(uri, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]));
  const image = await pickBackgroundImage(); assert.equal(image.uri, uri); image.dispose(); assert.equal(p.files.has(uri), true);
  assert.equal(p.calls[0][1].base64, false); assert.equal(p.calls[0][1].exif, false); assert.equal(p.calls.some(([kind]) => kind === 'delete'), false);
  p.choose({ canceled: false, assets: [{ uri, width: 10000, height: 10000 }] }); await assert.rejects(pickBackgroundImage());
});
