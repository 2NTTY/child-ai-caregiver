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

test('selected backgrounds are persistent Home decoration, not children of the transient greeting', () => {
  const source = readFileSync(new URL('../src/components/HomeDashboard.tsx', import.meta.url), 'utf8');
  const mobile = readFileSync(new URL('../src/components/MobileHomeDashboard.tsx', import.meta.url), 'utf8');
  assert.ok(source.includes('return <HomeBackdrop><ScrollView')); assert.ok(mobile.includes('return <HomeBackdrop><ScrollView'));
  for (const code of [source, mobile]) assert.ok(code.includes('customBackground && styles.readingSurface'));
  const mocks = { '../../preview/BackgroundContext': { useBackground: () => ({ selected: picture('synthetic'), source: { uri: 'blob:synthetic' }, imageFailed() {} }) } };
  const h = harness(mocks), { HomeBackdrop } = h.load('src/components/appearance/HomeBackdrop.tsx');
  h.render(h.jsx(HomeBackdrop, { children: null })); // Greeting absent/settled: backdrop is still mounted.
  assert.ok(h.node('custom-home-background'));
  assert.ok(h.hosts().some(node => node.props.pointerEvents === 'none' && node.props['aria-hidden']));
  assert.equal(h.node('custom-home-background').props.accessible, false);
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
