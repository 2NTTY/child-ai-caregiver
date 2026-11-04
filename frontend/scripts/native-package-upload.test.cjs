const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

test('prepared native package files stream only through the original authenticated transport and old APKs retain bounded buffering', async () => {
  const root = path.resolve(__dirname, '../..'), uploadId = '00000000-0000-4000-8000-000000000001';
  for (const modern of [true, false]) {
    const files = new Map(), dirs = new Set(), cache = new Map(), requests = [];
    let copies = 0, moves = 0, byteReads = 0, arrayReads = 0, streamReads = 0, hold = false;
    const sourceUri = 'content://documents/external-opaque-id';
    const uriFor = (parent, name) => (typeof parent === 'string' ? parent : parent.uri).replace(/\/$/, '') + (name ? '/' + name : '');
    class Directory {
      constructor(parent, name) { this.uri = uriFor(parent, name); }
      create() { dirs.add(this.uri); }
      list() { return [...dirs].filter(uri => uri.startsWith(this.uri + '/') && !uri.slice(this.uri.length + 1).includes('/')).map(uri => new Directory(uri))
        .concat([...files.keys()].filter(uri => uri.startsWith(this.uri + '/') && !uri.slice(this.uri.length + 1).includes('/')).map(uri => new File(uri))); }
      delete() { for (const uri of files.keys()) if (uri.startsWith(this.uri + '/')) files.delete(uri); dirs.delete(this.uri); }
    }
    class File {
      constructor(parent, name) { this.uri = uriFor(parent, name); }
      get entry() { return files.get(this.uri); }
      get name() { return this.entry?.name ?? this.uri.split('/').at(-1); }
      get size() { return this.entry?.size ?? 0; } get type() { return 'application/zip'; }
      get exists() { return files.has(this.uri); } get creationTime() { return Date.now(); }
      async copy(target) {
        copies++; const uri = target instanceof Directory ? uriFor(target, this.entry.displayName ?? this.name) : target.uri;
        files.set(uri, { ...this.entry, name: uri.split('/').at(-1) });
      }
      async move(target) { moves++; files.set(target.uri, { ...this.entry, name: target.uri.split('/').at(-1) }); files.delete(this.uri); this.uri = target.uri; }
      readableStream() {
        streamReads++; let offset = 0; const entry = this.entry;
        return new ReadableStream({ pull(controller) {
          if (entry.abortDuringHash) { entry.abortDuringHash.abort(); return; }
          if (offset === entry.size) { if (entry.mutateAfterHash) entry.size++; controller.close(); return; }
          const length = Math.min(65536, entry.size - offset); offset += length; controller.enqueue(new Uint8Array(length).fill(7));
        } });
      }
      async bytes() { byteReads++; return new Uint8Array(this.size).fill(7); }
      async arrayBuffer() { arrayReads++; throw Error('Native file path cannot enter JS arrayBuffer'); }
      delete() { assert.ok(this.uri.startsWith('file:///cache/'), 'Never delete an external source'); files.delete(this.uri); }
    }
    const packageFiles = () => [...files.keys()].filter(uri => uri.startsWith('file:///cache/yuyoufang-package-imports/'));
    const mocks = {
      'expo-file-system': { Directory, File, Paths: { cache: 'file:///cache/' } },
      'expo-modules-core': { requireNativeModule: name => { assert.equal(name, 'ExpoFetchModule'); return { supportsCacheFileBody: modern }; } },
      'expo-secure-store': { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only',
        async getItemAsync() { return JSON.stringify({ credential: 'yuban-native-v1.synthetic', expiresAtMs: Date.now() + 3600000 }); },
        async setItemAsync() { assert.fail('Package uploads must not exchange or cache another session'); }, async deleteItemAsync() {} },
      'expo/fetch': { async fetch(url, init) {
        requests.push({ url, init });
        assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error');
        assert.equal(new Headers(init.headers).get('authorization'), 'Bearer yuban-native-v1.synthetic');
        assert.equal(new Headers(init.headers).get('x-expected-user-id'), 'parent');
        assert.equal(new Headers(init.headers).get('content-type'), 'application/zip');
        assert.equal(url, `https://example.test/api/account/package-uploads/${uploadId}/content`);
        if (modern) {
          assert.match(init.cacheFileBody, /^yuyoufang-package-imports\/[0-9a-f-]{36}\.zip$/u);
          assert.ok(init.body == null); assert.ok(files.has('file:///cache/' + init.cacheFileBody));
        } else { assert.equal(init.cacheFileBody, undefined); assert.ok(init.body instanceof Uint8Array); }
        if (hold) return new Promise((_resolve, reject) => { init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }); });
        return Response.json({ id: uploadId, version: 2, state: 'ready', filename: 'Care backup.zip', bytes: 3, error: null, preview: null,
          createdAt: '2026-11-05T00:00:00Z', expiresAt: '2026-11-06T00:00:00Z' });
      } },
    };
    function load(relative) {
      const filename = path.resolve(root, relative); if (cache.has(filename)) return cache.get(filename).exports;
      const module = { exports: {} }; cache.set(filename, module);
      const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename,
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
      new Function('require', 'module', 'exports', output)(name => {
        if (name in mocks) return mocks[name]; if (!name.startsWith('.')) return require(name);
        let target = path.resolve(path.dirname(filename), name); if (!fs.existsSync(target)) target += '.ts';
        return load(path.relative(root, target));
      }, module, module.exports); return module.exports;
    }
    const picker = load('frontend/src/platform/package-import.native.ts');
    assert.equal(picker.PACKAGE_IMPORT_MAX_BYTES, modern ? 256 * 1024 * 1024 : 20 * 1024 * 1024);
    const { importErrorText } = load('frontend/src/production/HandoverImportOwner.ts');
    files.set(sourceUri, { size: picker.PACKAGE_IMPORT_MAX_BYTES + 1, name: 'opaque-id', displayName: 'Care backup.zip' });
    await assert.rejects(picker.prepareImportPackage(new File(sourceUri), new AbortController().signal), error => {
      assert.equal(error.message, 'package_native_size_exceeded');
      assert.match(importErrorText(error), new RegExp(`${modern ? 256 : 20} MiB`));
      return true;
    });
    assert.match(importErrorText(new Error('package_native_size_exceeded')), /20 MiB/, 'Old errors without capacity metadata retain the legacy bound');
    const large = 21 * 1024 * 1024;
    files.set(sourceUri, { size: large, name: 'opaque-id', displayName: 'Care backup.zip' });
    if (!modern) { await assert.rejects(picker.prepareImportPackage(new File(sourceUri), new AbortController().signal), /package_native_size_exceeded/); files.get(sourceUri).size = 7; }
    const selected = await picker.prepareImportPackage(new File(sourceUri), new AbortController().signal);
    assert.equal(selected.filename, 'Care backup.zip'); assert.equal(selected.bytes, modern ? large : 7); assert.equal(selected.sha256.length, 64);
    assert.equal(copies, modern ? 1 : 2); assert.equal(moves, modern ? 1 : 0); assert.equal(byteReads, modern ? 0 : 1); assert.equal(arrayReads, 0);
    assert.equal(streamReads, 1); assert.equal(packageFiles().length, 1); assert.ok(files.has(sourceUri));
    const transport = load('frontend/src/production/production-transport.native.ts').createProductionTransport('https://example.test/api');
    const api = load('src/client/handover-api.ts').createHandoverApi('https://example.test/api', transport.fetcher); api.setIdentity('parent');
    const init = { method: 'POST', body: selected.body, headers: { 'x-expected-user-id': 'parent', 'content-type': 'application/zip' } };
    await assert.rejects(transport.fetcher('https://external.test/api/account/package-uploads/' + uploadId + '/content', init));
    await assert.rejects(transport.fetcher(`https://example.test/api/account/package-uploads/${uploadId}/content`,
      { ...init, headers: { ...init.headers, authorization: 'Bearer caller-supplied' } }));
    if (modern) {
      await assert.rejects(transport.fetcher('https://example.test/api/account/package-imports', init));
      await assert.rejects(transport.fetcher(`https://example.test/api/account/package-uploads/${uploadId}/content`, { ...init, cacheFileBody: '../private/session' }));
    }
    assert.equal(requests.length, 0);
    await api.uploadContent('parent', uploadId, selected.body, new AbortController().signal);
    assert.equal(requests.length, 1); selected.release(); selected.release(); assert.equal(packageFiles().length, 0); assert.ok(files.has(sourceUri));
    if (!modern) assert.ok(selected.body.every(value => value === 0));
    if (modern) {
      await assert.rejects(api.uploadContent('parent', uploadId, selected.body, new AbortController().signal)); assert.equal(requests.length, 1);
      files.get(sourceUri).size = 7;
      const retryable = await picker.prepareImportPackage(new File(sourceUri), new AbortController().signal), abort = new AbortController();
      hold = true; const pending = api.uploadContent('parent', uploadId, retryable.body, abort.signal);
      await new Promise(resolve => setImmediate(resolve)); abort.abort(); await assert.rejects(pending);
      assert.equal(packageFiles().length, 1, 'Unknown upload results retain the same file for original-ID recovery');
      hold = false; await api.uploadContent('parent', uploadId, retryable.body, new AbortController().signal); retryable.release();
      assert.equal(packageFiles().length, 0);
      files.get(sourceUri).mutateAfterHash = true;
      await assert.rejects(picker.prepareImportPackage(new File(sourceUri), new AbortController().signal), /invalid_package_file/);
      assert.equal(packageFiles().length, 0, 'Changed length after hashing disposes the owned cache file');
      files.get(sourceUri).mutateAfterHash = false;
      const hashing = new AbortController(); files.get(sourceUri).abortDuringHash = hashing;
      await assert.rejects(picker.prepareImportPackage(new File(sourceUri), hashing.signal));
      assert.equal(packageFiles().length, 0, 'Cancellation during hashing removes only the owned temporary file');
      delete files.get(sourceUri).abortDuringHash;
      const cancelled = new AbortController(); cancelled.abort();
      await assert.rejects(picker.prepareImportPackage(new File(sourceUri), cancelled.signal)); assert.equal(packageFiles().length, 0);
      assert.equal(byteReads, 0); assert.equal(arrayReads, 0);
    }
  }
});
