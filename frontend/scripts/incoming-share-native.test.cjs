const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');

test('Android incoming sharing keeps native config, local media ownership and strict redirects bounded', async () => {
  const configKeys = ['EAS_BUILD_PROFILE', 'EAS_BUILD_PLATFORM', 'EXPO_PUBLIC_AUTH_PROVIDERS', 'ANDROID_GOOGLE_SERVICES_FILE'];
  const savedEnv = configKeys.map(key => [key, process.env[key]]);
  for (const key of configKeys) delete process.env[key];
  try {
    const { default: configure } = await import('../app.config.js');
    const original = JSON.parse(fs.readFileSync(path.join(root, 'frontend/app.json'), 'utf8')).expo;
    const configured = configure({ config: original });
    const sharing = configured.plugins.find(item => Array.isArray(item) && item[0] === 'expo-sharing');
    assert.deepEqual(sharing, ['expo-sharing', { android: { enabled: true, singleShareMimeTypes: ['*/*'], multipleShareMimeTypes: ['*/*'] }, ios: { enabled: false } }]);
    assert.deepEqual(configured.plugins.filter(item => !(Array.isArray(item) && item[0] === 'expo-sharing')), original.plugins);
    assert.deepEqual(configured.runtimeVersion, { policy: 'fingerprint' });
    assert.deepEqual(configure({ config: configured }).plugins, configured.plugins);
  } finally { for (const [key, value] of savedEnv) value === undefined ? delete process.env[key] : process.env[key] = value; }

  let platformOS = 'android', raw = [{ shareType: 'url', value: 'https://example.test/shared' }], cleared = 0, appListener, urlListener, removed = 0;
  const routes = [], opened = [], fixtures = new Map(), cache = new Map();
  const sample = (uri, mime, bytes, name = uri.split('/').at(-1)) => fixtures.set(uri, { mime, bytes: Uint8Array.from(bytes), name });
  sample('file:///photo.png', 'image/png', [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,1]);
  sample('file:///photo.jpg', 'image/jpeg', [0xff,0xd8,0xff,1]);
  sample('file:///original.heic', 'image/heic', [0,0,0,12,0x66,0x74,0x79,0x70]);
  sample('content://downloads/msf%3A12', 'audio/mp4', [1,2,3], 'msf:12');
  sample('file:///provider-copy', 'audio/mp4', [1,2,3], 'Real recording.m4a');
  sample('file:///music.flac', 'audio/flac', [1,2,3]);
  sample('file:///movie.mp4', 'video/mp4', [1,2,3]);
  sample('file:///private-provider-copy', 'text/plain', [1,2,3], 'Private note.txt');
  const staged = new Map([['content://photos/png','file:///photo.png'], ['content://photos/jpeg','file:///photo.jpg'],
    ['content://photos/heic','file:///original.heic'], ['content://downloads/msf%3A12','file:///provider-copy'],
    ['content://downloads/flac','file:///music.flac'], ['content://downloads/video','file:///movie.mp4']]);
  for (const [uri, local] of staged) { const fixture = fixtures.get(local); sample(uri, fixture.mime, fixture.bytes, 'opaque-provider-id'); }
  for (const authority of ['org.yuyoufang.app.SharingFileProvider', 'org.yuyoufang.app.FileSystemFileProvider']) {
    const uri = `content://${authority}/cached_expo_files/private.txt`; staged.set(uri, 'file:///private-provider-copy'); sample(uri, 'text/plain', [1,2,3]);
  }
  class File {
    constructor(uri) { opened.push(uri); this.uri = uri; this.fixture = fixtures.get(uri); assert.ok(this.fixture, 'Only registered local fixtures may open'); }
    get name() { return this.fixture.name; } get type() { return this.fixture.mime; } get size() { return this.fixture.bytes.length; } get exists() { return true; }
    async bytes() { return this.fixture.bytes; }
    delete() { assert.fail('Never delete an incoming source'); }
  }
  const owned = (kind, file, mimeType, fileName) => { const value = { kind, fileName, mimeType, bytes: file.size, localUri: 'file:///owned/' + kind, dispose() { this.released = true; } }; routes.push(value); return value; };
  const mocks = {
    'react-native': { Platform: { get OS() { return platformOS; } }, AppState: { addEventListener(_name, listener) { appListener = listener; return { remove() { removed++; } }; } }, Linking: { addEventListener(_name, listener) { urlListener = listener; return { remove() { removed++; } }; } } },
    'expo-sharing': { getSharedPayloads: () => raw, clearSharedPayloads: () => { cleared++; raw = []; }, getResolvedSharedPayloadsAsync() { assert.fail('No remote resolving'); }, useIncomingShare() { assert.fail('No auto-resolving hook'); } },
    'expo-file-system': { File },
    '../components/agent/native-picked-file': { async withNativePickedFile(file, maxBytes, consume) { assert.equal(maxBytes, 20 * 1024 * 1024); const selected = file.uri.startsWith('content://') ? new File(staged.get(file.uri)) : file; return consume(selected, file.type, selected.name); } },
    '../components/agent/native-chat-file': { copyNativeFile: async (...args) => owned('file', ...args) },
    '../components/agent/native-voice-file': { copyNativeVoice: async (...args) => owned('voice', ...args) },
    '../production/photo-original': { async photoOriginalFromBytes(bytes, fileName, mimeType) { routes.push({ kind: 'photo', fileName, mimeType, bytes: bytes.length }); return { fileName, mimeType, bytes: bytes.length, readBase64: async () => 'encoded', dispose() {} }; } },
  };
  function load(relative) {
    const filename = path.resolve(root, relative); if (cache.has(filename)) return cache.get(filename).exports;
    if (filename.endsWith('.json')) return JSON.parse(fs.readFileSync(filename, 'utf8'));
    const module = { exports: {} }; cache.set(filename, module);
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    new Function('require', 'module', 'exports', code)(name => {
      if (name in mocks) return mocks[name];
      if (!name.startsWith('.')) return require(name);
      const target = path.resolve(path.dirname(filename), name);
      return load(path.relative(root, fs.existsSync(target) ? target : target + '.ts'));
    }, module, module.exports);
    return module.exports;
  }
  const native = load('frontend/src/platform/incoming-share.native.ts').createIncomingSharePlatform();
  assert.deepEqual(native.read(), raw); native.clear(); assert.equal(cleared, 1); assert.deepEqual(native.read(), []);
  let events = 0; const unsubscribe = native.subscribe(() => { events++; }); appListener('background'); appListener('active'); urlListener({ url: 'yuyoufang://expo-sharing' }); assert.equal(events, 2); unsubscribe(); assert.equal(removed, 2);
  await assert.rejects(native.prepare({ shareType: 'image', value: 'file:///photo.png' }), /incoming_share/);
  const png = await native.prepare({ shareType: 'image', value: 'content://photos/png', mimeType: 'image/jpeg' }); assert.equal(png.kind, 'photo'); assert.equal(png.mimeType, 'image/png'); assert.ok(png.photo.readBase64);
  assert.equal((await native.prepare({ shareType: 'image', value: 'content://photos/jpeg' })).mimeType, 'image/jpeg');
  const unsupported = await native.prepare({ shareType: 'image', value: 'content://photos/heic', mimeType: 'image/jpeg' }); assert.equal(unsupported.kind, 'file'); assert.equal(unsupported.mimeType, 'image/heic');
  const audio = await native.prepare({ shareType: 'audio', value: 'content://downloads/msf%3A12' }); assert.equal(audio.kind, 'voice'); assert.equal(audio.fileName, 'Real recording.m4a'); assert.ok(audio.localUri.startsWith('file:///owned/')); audio.dispose(); assert.equal(audio.released, true);
  assert.equal((await native.prepare({ shareType: 'audio', value: 'content://downloads/flac' })).kind, 'file');
  assert.equal((await native.prepare({ shareType: 'video', value: 'content://downloads/video' })).kind, 'file');
  const previousOpens = opened.length;
  for (const authority of ['org.yuyoufang.app.SharingFileProvider', 'org.yuyoufang.app.FileSystemFileProvider'])
    await assert.rejects(native.prepare({ shareType: 'file', value: `content://${authority}/cached_expo_files/private.txt` }), /incoming_share_own_provider_rejected/);
  assert.equal(opened.length, previousOpens, 'Self-provider intents never open App-private sources');
  for (const value of ['https://example.test/image.jpg', 'file://remote.example/image.jpg', 'file:///data/user/0/org.yuyoufang.app/files/private.txt', 'file:///data/user/0/org.yuyoufang.app/cache/private.txt', 'data:image/png;base64,AAA', 'ftp://example.test/a']) await assert.rejects(native.prepare({ shareType: 'image', value }));
  await assert.rejects(native.prepare({ shareType: 'url', value: 'https://example.test/shared' })); assert.equal(opened.length, previousOpens);
  platformOS = 'ios'; assert.deepEqual(native.read(), []); native.clear(); assert.equal(cleared, 1); await assert.rejects(native.prepare({ shareType: 'image', value: 'file:///photo.png' }));
  const base = load('frontend/src/platform/incoming-share.ts').createIncomingSharePlatform(); assert.deepEqual(base.read(), []); await assert.rejects(base.prepare({ shareType: 'image', value: 'file:///photo.png' }));
  const redirect = load('frontend/app/+native-intent.ts').redirectSystemPath;
  for (const value of ['yuyoufang://expo-sharing', 'org.yuyoufang.app://expo-sharing']) assert.equal(redirect({ path: value, initial: true }), '/share');
  for (const value of ['/settings', 'yuyoufang://settings', 'https://expo-sharing', 'evil://expo-sharing', 'yuyoufang://expo-sharing/unrelated']) assert.equal(redirect({ path: value, initial: false }), value);
});
