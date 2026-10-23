import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { harness } from './scope-transition-harness.mjs';

// Real picker source; deterministic decoder, URL and UI ports, not a browser/codec test.
const maxBytes = 4 * 1024 * 1024;
const pngHeader = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]);
const file = size => new File([pngHeader, new Uint8Array(size - pngHeader.length)], 'synthetic.png', { type: 'image/png' });
async function flush() { await nextTurn(); await nextTurn(); }

test('Web picker exact bounds, rejected image ownership and late unmount completion', async () => {
  const originalWindow = globalThis.window;
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  const originalFetch = globalThis.fetch;
  const decoders = [], created = [], revoked = [], selected = [], errors = [], reading = [];
  let networkCalls = 0, mounted = true;
  class ImagePort {
    set src(uri) { this.uri = uri; decoders.push(this); }
    load(width, height) { this.naturalWidth = width; this.naturalHeight = height; this.onload(); }
  }
  globalThis.window = { Image: ImagePort };
  globalThis.fetch = () => { networkCalls++; throw new Error('Network forbidden in local picker contract test'); };
  URL.createObjectURL = blob => { const uri = `blob:synthetic-picker-${created.length + 1}`; created.push({ uri, blob }); return uri; };
  URL.revokeObjectURL = uri => revoked.push(uri);
  const h = harness();
  const { BackgroundImagePicker } = h.load('src/components/appearance/BackgroundImagePicker.web.tsx');
  h.render(h.jsx(BackgroundImagePicker, {
    onSelected: image => { selected.push(image); image.dispose(); image.dispose(); },
    onError: value => errors.push(value), onReadingChange: value => reading.push(value),
  }));
  async function choose(value) {
    const target = { files: [value], value: 'synthetic input path' };
    h.hosts().find(node => node.type === 'input').props.onChange({ target });
    assert.equal(target.value, '', 'the native input resets for reselection');
    await flush(); h.render();
  }
  try {
    // Exact limits are inclusive. The decoder dimensions are supplied by the port.
    const boundary = file(maxBytes);
    await choose(boundary);
    assert.equal(decoders.length, 1);
    assert.equal(reading.at(-1), true);
    decoders[0].load(4000, 4000);
    await flush(); h.render();
    assert.equal(selected.length, 1);
    assert.equal(selected[0].blob, boundary);
    assert.equal(errors.length, 0);
    assert.equal(reading.at(-1), false);
    assert.deepEqual(revoked, ['blob:synthetic-picker-1'], 'transferred URL disposal is idempotent');
    console.log('PASS exact 4 MiB and 16,000,000 pixels accepted; one URL release after transfer');

    await choose(file(maxBytes + 1));
    assert.equal(created.length, 1, 'oversized bytes fail before object URL or decoder allocation');
    assert.equal(decoders.length, 1);
    assert.equal(selected.length, 1, 'invalid input never reaches the save/selection callback');
    assert.match(errors.at(-1), /4 MiB.*原有背景仍然保留/);
    assert.equal(reading.at(-1), false);
    console.log('PASS 4 MiB + 1 byte rejected before decoding and selection');

    await choose(file(32));
    assert.equal(decoders.length, 2);
    decoders[1].load(4000, 4001);
    await flush(); h.render();
    assert.equal(selected.length, 1);
    assert.equal(errors.length, 2);
    assert.match(errors.at(-1), /未能讀取.*原有背景仍然保留/);
    assert.deepEqual(revoked, ['blob:synthetic-picker-1', 'blob:synthetic-picker-2']);
    assert.equal(reading.at(-1), false);
    assert.equal(decoders[1].onload, null);
    assert.equal(decoders[1].onerror, null);
    console.log('PASS >16M pixels rejected; transient URL released; no selection delegate');

    await choose(file(32));
    assert.equal(decoders.length, 3);
    h.unmount(); mounted = false;
    const readingBeforeCompletion = reading.length;
    decoders[2].load(1600, 1000);
    await flush();
    assert.equal(selected.length, 1, 'decoded image cannot cross a picker unmount');
    assert.equal(errors.length, 2, 'late completion cannot publish stale notices');
    assert.equal(reading.length, readingBeforeCompletion, 'late completion cannot publish stale busy state');
    assert.deepEqual(revoked, ['blob:synthetic-picker-1', 'blob:synthetic-picker-2', 'blob:synthetic-picker-3']);
    assert.equal(networkCalls, 0);
    console.log('PASS unmounted picker rejects late decode and releases URL; network calls 0');
  } finally {
    if (mounted) h.unmount();
    if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
    URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke;
    globalThis.fetch = originalFetch;
  }
});
