const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../..'), req = createRequire(path.join(root, 'package.json')), ts = req('typescript');

test('native avatar picker admits the cropped square, disposes bytes and leaves cancellation empty', async () => {
  const png = new Uint8Array(33), view = new DataView(png.buffer);
  png.set([137, 80, 78, 71, 13, 10, 26, 10]); view.setUint32(8, 13); png.set([73, 72, 68, 82], 12);
  view.setUint32(16, 80); view.setUint32(20, 80);
  const policy = { acceptedMimeTypes: ['image/png'], maxInputBytes: 1024, maxInputPixels: 1e6, maxInputDimension: 2000 };
  let result = { canceled: false, assets: [{ uri: 'file://cropped.png' }] }, options, files = 0, previews = 0, disposed = 0, bytes;
  let decodedSize = { width: 80, height: 80 };
  const mocks = {
    'expo-image-picker': { async launchImageLibraryAsync(value) { options = value; return result; } },
    'expo-file-system': { File: class {
      constructor(uri) { assert.equal(uri, 'file://cropped.png'); files++; }
      exists = true; size = png.length;
      async bytes() { bytes = png.slice(); return bytes; }
    } },
    'react-native': { Image: { async getSize(uri) { assert.equal(uri, 'file://cropped.png'); return decodedSize; } } },
    './photo-bytes': { photoPreview(value, mimeType) {
      assert.equal(value, bytes); assert.equal(mimeType, 'image/png'); previews++;
      return { uri: 'blob:cropped-preview', dispose() { disposed++; } };
    } },
  };
  const cache = new Map();
  function compile(file) {
    file = path.resolve(root, file); if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    new Function('require', 'module', 'exports', js)(name => {
      if (mocks[name]) return mocks[name];
      assert.ok(name.startsWith('.'), `Unexpected dependency: ${name}`);
      const target = path.resolve(path.dirname(file), name);
      return compile(fs.existsSync(target) ? target : target + '.ts');
    }, module, module.exports);
    return module.exports;
  }
  const { pickAvatarImage } = compile('frontend/src/platform/avatar-picker.native.ts');
  const image = await pickAvatarImage(policy, new AbortController().signal);
  assert.deepEqual(options, { mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], shape: 'rectangle', allowsMultipleSelection: false, base64: false, exif: false, quality: 1 });
  assert.deepEqual({ width: image.width, height: image.height, uri: image.uri }, { width: 80, height: 80, uri: 'blob:cropped-preview' });
  assert.equal(image.bytes, bytes); assert.equal(previews, 1);
  image.dispose(); assert.equal(disposed, 1); assert.ok(bytes.every(value => value === 0));

  result = { canceled: true, assets: null };
  assert.equal(await pickAvatarImage(policy, new AbortController().signal), null);
  assert.equal(files, 1); assert.equal(previews, 1);

  result = { canceled: false, assets: [{ uri: 'file://cropped.png' }] };
  await assert.rejects(pickAvatarImage({ ...policy, maxInputBytes: png.length - 1 }, new AbortController().signal), /avatar_input_too_large/);
  decodedSize = { width: 100, height: 80 };
  await assert.rejects(pickAvatarImage(policy, new AbortController().signal), /avatar_orientation_unavailable/);
  assert.ok(bytes.every(value => value === 0)); assert.equal(previews, 1);
});
