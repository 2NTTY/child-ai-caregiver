import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '../..');
const base64 = require('base64-js');
function compile(file, resolve) {
  const output = ts.transpileModule(readFileSync(path.join(root, file), 'utf8'), {
    fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output)(resolve, module, module.exports);
  return module.exports;
}
const photos = compile('src/shared/photos.ts', require);
const photoBytes = compile('frontend/src/platform/photo-bytes.native.ts', name => name === 'base64-js' ? base64
  : name === 'expo-crypto' ? { CryptoDigestAlgorithm: { SHA256: 'sha256' }, digest: async (algorithm, bytes) => createHash(algorithm).update(bytes).digest() }
    : assert.fail(name));
const originals = compile('frontend/src/production/photo-original.ts', name => name === 'base64-js' ? base64
  : name.endsWith('/shared/photos') ? photos : name.endsWith('/platform/photo-bytes') ? photoBytes : assert.fail(name));
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 0xff, 0xd9]);
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const heic = Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]);

// Execute the adapter and shared metadata/hash path with native picker/file ports replaced.
function harness({ os = 'ios', bytes = heic, encoded = base64.fromByteArray(jpeg), fileName = 'IMG_0001.HEIC', size = bytes.length, canceled = false } = {}) {
  const asset = { uri: 'file:///picker/photo', fileName, base64: encoded };
  const calls = { decode: 0, read: 0, files: 0, permissions: 0, launches: [] };
  const launch = source => async options => { calls.launches.push({ source, options }); return { canceled, assets: canceled ? null : [asset] }; };
  const picker = compile('frontend/src/components/photos/native-photo-picker.ts', name => {
    if (name === 'react-native') return { Platform: { OS: os } };
    if (name === 'expo-image-picker') return {
      UIImagePickerPreferredAssetRepresentationMode: { Compatible: 'compatible' },
      requestCameraPermissionsAsync: async () => { calls.permissions++; return { granted: true }; },
      launchCameraAsync: launch('camera'), launchImageLibraryAsync: launch('library'),
    };
    if (name === 'expo-file-system') return { File: class {
      constructor(uri) { assert.equal(uri, asset.uri); calls.files++; }
      exists = true;
      size = size;
      async bytes() { calls.read++; return bytes; }
      delete() { assert.fail('The picker source must not be deleted'); }
    } };
    if (name === 'base64-js') return { toByteArray: value => { calls.decode++; return base64.toByteArray(value); } };
    if (name.endsWith('/shared/photos')) return photos;
    if (name.endsWith('/production/photo-original')) return originals;
    return assert.fail(name);
  });
  return { ...picker, asset, calls };
}
async function assertOriginal(original, bytes, name, mime) {
  assert.equal(original.fileName, name);
  assert.equal(original.mimeType, mime);
  assert.equal(original.bytes, bytes.length);
  assert.equal(original.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(base64.toByteArray(await original.readBase64()), bytes);
  original.dispose();
  await assert.rejects(original.readBase64(), /Original released/);
}

test('iOS uses the JPEG copy for HEIC and prefers existing JPEG/PNG bytes', async () => {
  const copy = harness();
  await assertOriginal(await copy.captureNativePhoto(), jpeg, 'IMG_0001.jpg', 'image/jpeg');
  assert.equal(copy.calls.decode, 1);
  assert.equal(copy.calls.permissions, 1);
  assert.equal(copy.asset.base64, null);
  assert.deepEqual(copy.calls.launches, [{ source: 'camera', options: {
    mediaTypes: ['images'], allowsEditing: false, allowsMultipleSelection: false, base64: true, exif: false, quality: 1,
    preferredAssetRepresentationMode: 'compatible',
  } }]);
  for (const [bytes, mime, suffix] of [[jpeg, 'image/jpeg', 'jpg'], [png, 'image/png', 'png']]) {
    const original = harness({ bytes, encoded: 'unused invalid copy' });
    await assertOriginal(await original.selectNativePhoto(), bytes, `IMG_0001.${suffix}`, mime);
    assert.equal(original.calls.decode, 0);
    assert.equal(original.asset.base64, null);
  }
});

test('Android keeps its original bytes and options; cancellation does not read a file', async () => {
  const original = harness({ os: 'android', bytes: jpeg, fileName: 'camera.jpeg', encoded: null });
  await assertOriginal(await original.selectNativePhoto(), jpeg, 'camera.jpeg', 'image/jpeg');
  assert.equal(original.calls.decode, 0);
  assert.deepEqual(original.calls.launches, [{ source: 'library', options: {
    mediaTypes: ['images'], allowsEditing: false, allowsMultipleSelection: false, base64: false, exif: false, quality: 1,
  } }]);
  const unsupported = harness({ os: 'android' });
  await assert.rejects(unsupported.selectNativePhoto(), /Only JPEG and PNG/);
  assert.equal(unsupported.calls.decode, 0);
  const canceled = harness({ os: 'android', canceled: true });
  assert.equal(await canceled.selectNativePhoto(), null);
  assert.equal(canceled.calls.files, 0);
});

test('bounded base64 validation precedes decoding and decoded copies must be JPEG', async () => {
  const maxEncoded = Math.ceil(photos.PHOTO_LIMITS.bytes / 3) * 4;
  for (const encoded of [null, '%%%=', 'AAAA===', 'A'.repeat(maxEncoded + 4), 'A'.repeat(maxEncoded)]) {
    const invalid = harness({ encoded });
    await assert.rejects(invalid.selectNativePhoto(), /Invalid JPEG copy|Photo exceeds limit/);
    assert.equal(invalid.calls.decode, 0);
    assert.equal(invalid.asset.base64, null);
  }
  const wrongFormat = harness({ encoded: base64.fromByteArray(png) });
  await assert.rejects(wrongFormat.selectNativePhoto(), /Invalid JPEG copy/);
  assert.equal(wrongFormat.calls.decode, 1);
  assert.equal(wrongFormat.asset.base64, null);
  const tooLarge = harness({ size: photos.PHOTO_LIMITS.bytes + 1 });
  await assert.rejects(tooLarge.selectNativePhoto(), /Photo exceeds limit/);
  assert.equal(tooLarge.calls.read, 0);
  assert.equal(tooLarge.calls.decode, 0);
  assert.equal(tooLarge.asset.base64, null);
});
