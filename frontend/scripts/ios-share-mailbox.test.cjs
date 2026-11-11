const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL, fileURLToPath } = require('node:url');
const ts = require('typescript');
const { randomUUID } = require('node:crypto');

test('iOS mailbox bounds owned receipts, binds acknowledged identities and durably consumes items without touching staging', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ios-share-mailbox-'));
  const group = path.join(temporary, 'group'), root = path.join(group, 'incoming-v1');
  fs.mkdirSync(root, { recursive: true });
  const deniedDeletes = new Set(), textReads = [];
  function location(parent, names) { return path.join(typeof parent === 'string' ? fileURLToPath(parent) : parent.location, ...names); }
  class Directory {
    constructor(parent, ...names) { this.location = location(parent, names); }
    get uri() { return pathToFileURL(this.location).href; } get name() { return path.basename(this.location); }
    get exists() { return fs.existsSync(this.location) && fs.statSync(this.location).isDirectory(); }
    create() { fs.mkdirSync(this.location, { recursive: true }); }
    list() { return fs.readdirSync(this.location, { withFileTypes: true }).map(entry => entry.isDirectory() ? new Directory(this, entry.name) : new File(this, entry.name)); }
    rename(name) { const next = path.join(path.dirname(this.location), name); fs.renameSync(this.location, next); this.location = next; }
    delete() { if (deniedDeletes.has(this.location)) throw Error('Synthetic cleanup failure'); fs.rmSync(this.location, { recursive: true }); }
  }
  class File {
    constructor(parent, ...names) { this.location = location(parent, names); }
    get uri() { return pathToFileURL(this.location).href; } get name() { return path.basename(this.location); }
    get exists() { return fs.existsSync(this.location) && fs.statSync(this.location).isFile(); }
    get size() { return this.exists ? fs.statSync(this.location).size : 0; }
    textSync() { textReads.push(this.location); return fs.readFileSync(this.location, 'utf8'); }
    create(options = {}) { fs.writeFileSync(this.location, '', { flag: options.overwrite ? 'w' : 'wx' }); }
    write(value) { fs.writeFileSync(this.location, value); }
    delete() { if (deniedDeletes.has(this.location)) throw Error('Synthetic cleanup failure'); fs.unlinkSync(this.location); }
    rename(name) { const next = path.join(path.dirname(this.location), name); fs.renameSync(this.location, next); this.location = next; }
  }
  const shared = new Directory(pathToFileURL(group).href), Paths = { appleSharedContainers: { 'group.org.yuyoufang.app': shared } };
  const source = path.resolve(__dirname, '../src/platform/ios-share-mailbox.ts');
  const uuid = n => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
  function item(receipt, index, manifest, content = 'private shared body', epoch = fs.existsSync(path.join(root, 'device-epoch')) ? fs.readFileSync(path.join(root, 'device-epoch'), 'utf8') : 'initial') {
    const directory = path.join(root, 'ready-' + uuid(receipt), String(index)); fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(path.dirname(directory), 'epoch'), epoch);
    fs.writeFileSync(path.join(directory, 'item.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
    if (manifest && typeof manifest === 'object' && manifest.fileName && !/[\\/?:\u0000]/.test(manifest.fileName)
      && Buffer.byteLength(manifest.fileName) <= 255 && !['.', '..'].includes(manifest.fileName)) {
      fs.mkdirSync(path.join(directory, 'body')); fs.writeFileSync(path.join(directory, 'body', manifest.fileName), content);
    }
    return directory;
  }
  function create() {
    const module = { exports: {} };
    const code = ts.transpileModule(fs.readFileSync(source, 'utf8'), { fileName: source, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    new Function('require', 'module', 'exports', code)(name => {
      if (name === 'expo-crypto') return { randomUUID };
      assert.equal(name, 'expo-file-system', 'The mailbox only needs the installed local filesystem port'); return { Directory, File, Paths };
    }, module, module.exports);
    return module.exports.createIosShareMailbox();
  }
  try {
    const firstPath = item(1, 0, { shareType: 'file', fileName: 'same.txt', mimeType: 'text/plain' });
    item(2, 0, { shareType: 'file', fileName: 'same.txt', mimeType: 'text/plain' }, 'second body');
    item(2, 1, { shareType: 'text', text: 'Original shared text' });
    const staging = path.join(root, 'staging-' + uuid(3)); fs.mkdirSync(staging); fs.writeFileSync(path.join(staging, 'pending'), 'writer owns this');
    const unrelated = path.join(group, 'unrelated.txt'); fs.writeFileSync(unrelated, 'other group data');
    let mailbox = create();
    assert.deepEqual(mailbox.read(), []); assert.deepEqual(mailbox.read(20, null), [], 'Logged-out reads never disclose pending content');
    const one = mailbox.read(1, 'owner-a'); assert.equal(one.length, 1); assert.equal(one[0].localShareId, uuid(1) + ':0');
    assert.ok(mailbox.file(one[0]) instanceof File); assert.equal(fs.readFileSync(mailbox.file(one[0]).location, 'utf8'), 'private shared body');
    mailbox.acknowledge(one, 'owner-a');
    const remaining = mailbox.read(20, 'owner-a'); assert.equal(remaining.length, 2);
    mailbox.acknowledge(remaining, 'owner-a'); assert.deepEqual(mailbox.read(20, 'owner-a'), []);
    const cold = create(); assert.deepEqual(cold.read(20, 'owner-b'), [], 'Acknowledged receipts remain private after restart');
    const recovered = cold.read(20, 'owner-a'); assert.equal(recovered.length, 3, 'Acknowledgement does not consume cold-launch pending items');
    cold.acknowledge(recovered, 'owner-a');
    const duplicates = recovered.filter(value => value.shareType === 'file');
    assert.notEqual(cold.file(duplicates[0]).uri, cold.file(duplicates[1]).uri, 'Same names in different receipts cannot replace each other');
    assert.throws(() => cold.file({ ...duplicates[0], localShareId: '../../unrelated.txt' }));
    assert.throws(() => cold.file({ ...duplicates[0], value: 'file:///private/app/database' }));
    const body = cold.file(duplicates[0]);
    deniedDeletes.add(firstPath);
    deniedDeletes.add(path.dirname(firstPath));
    cold.discard(duplicates[0]); assert.equal(body.exists, true, 'Cleanup may fail after durable consumption');
    assert.ok(!create().read(20, 'owner-a').some(value => value.localShareId === duplicates[0].localShareId));
    deniedDeletes.clear(); cold.discard(duplicates[1]);
    assert.equal(fs.existsSync(path.join(root, 'ready-' + uuid(2), '0')), false);
    assert.equal(create().read(20, 'owner-a').length, 1, 'Single item consumption preserves its siblings');
    assert.equal(fs.existsSync(path.dirname(firstPath)), false, 'A later read retries consumed receipt cleanup');

    item(4, 0, '{broken JSON');
    const oversized = item(4, 1, ' '.repeat(50 * 1024));
    item(4, 2, { shareType: 'text', text: 'Invalid\u0000shared text' });
    for (const [index, fileName] of ['../escape', '%2e%2e.txt', '.', '..', '.hidden', 'bad\\name', 'bad\u0000name', 'name:stream', 'a'.repeat(201), '字'.repeat(86), '\ud800'].entries())
      item(5, index, { shareType: 'file', fileName, mimeType: 'text/plain' });
    item(6, 0, { shareType: 'url', text: 'https://example.test/original' });
    item(6, 1, { shareType: 'file', fileName: 'Care 20% #.txt', mimeType: 'text/plain' });
    mailbox = create(); const valid = mailbox.read(20, 'owner-a');
    assert.equal(valid.length, 3, 'Damaged and unsafe entries do not prevent valid neighboring receipts');
    const literalName = valid.find(value => value.shareType === 'file');
    assert.equal(mailbox.file(literalName).name, 'Care 20% #.txt');
    mailbox.discard(literalName);
    assert.ok(fs.existsSync(path.join(root, 'ready-' + uuid(6))), 'An unconsumed URL keeps the receipt alive');
    mailbox.discard(valid.find(value => value.shareType === 'url'));
    assert.equal(fs.existsSync(path.join(root, 'ready-' + uuid(6))), false, 'Last item consumption removes its receipt');
    assert.ok(!textReads.includes(path.join(oversized, 'item.json')), 'Oversized manifests must be rejected before synchronous text allocation');
    const url = valid.find(value => value.shareType === 'url'); assert.equal(url.value, 'https://example.test/original');
    assert.throws(() => mailbox.file(url));
    const blockReceipt = path.join(root, 'ready-' + uuid(2)); deniedDeletes.add(blockReceipt);
    assert.throws(() => mailbox.clear(), /cleanup/);
    assert.deepEqual(mailbox.read(20, 'owner-b'), []); assert.deepEqual(create().read(20, 'owner-b'), [], 'Interrupted identity cleanup remains fail-closed after restart');
    deniedDeletes.clear(); const recoveredClear = create(); assert.deepEqual(recoveredClear.read(20, 'owner-b'), []);
    assert.equal(fs.existsSync(path.join(root, 'clear-pending.json')), false, 'An ordinary cold-launch read retries interrupted account cleanup');
    const epochAfterClear = fs.readFileSync(path.join(root, 'device-epoch'), 'utf8');
    assert.match(epochAfterClear, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    item(8, 0, { shareType: 'text', text: 'Old account extension published after clear' }, '', 'initial');
    item(7, 0, { shareType: 'text', text: 'A future share after cleanup' });
    const future = recoveredClear.read(20, 'owner-b'); assert.equal(future.length, 1);
    assert.equal(future[0].value, 'A future share after cleanup');
    assert.equal(fs.existsSync(path.join(root, 'ready-' + uuid(8))), false, 'Late publication from an old device epoch is discarded');
    recoveredClear.acknowledge(future, 'owner-b'); recoveredClear.discard(future[0]);
    assert.deepEqual(create().read(20, 'owner-b'), [], 'Cleanup recovery remains idempotent after successful future intake');
    item(9, 0, { shareType: 'file', fileName: 'epoch.txt', mimeType: 'text/plain' });
    const missingEpoch = item(10, 0, { shareType: 'text', text: 'Missing receipt epoch' });
    fs.unlinkSync(path.join(path.dirname(missingEpoch), 'epoch'));
    const invalidEpoch = item(11, 0, { shareType: 'text', text: 'Invalid receipt epoch' });
    fs.writeFileSync(path.join(path.dirname(invalidEpoch), 'epoch'), 'not-an-epoch');
    const validating = create(), offered = validating.read(20, 'owner-b');
    assert.equal(offered.length, 1, 'Missing or malformed receipt epochs never disclose their payloads');
    fs.writeFileSync(path.join(root, 'device-epoch'), randomUUID());
    assert.throws(() => validating.file(offered[0]), /mailbox_invalid/);
    assert.throws(() => validating.acknowledge(offered, 'owner-b'), /mailbox_invalid/);
    assert.throws(() => validating.discard(offered[0]), /mailbox_invalid/);
    assert.deepEqual(create().read(20, 'owner-b'), [], 'A cold reader revalidates the device epoch');
    fs.writeFileSync(path.join(root, 'device-epoch'), 'invalid');
    item(12, 0, { shareType: 'text', text: 'Matching malformed epochs are still invalid' });
    assert.deepEqual(create().read(20, 'owner-b'), [], 'An invalid device epoch fails closed even if a receipt matches');
    create().clear();
    assert.ok(fs.existsSync(staging)); assert.equal(fs.readFileSync(unrelated, 'utf8'), 'other group data');
    assert.deepEqual(fs.readdirSync(root), ['device-epoch', 'staging-' + uuid(3)]);
    delete Paths.appleSharedContainers['group.org.yuyoufang.app']; assert.deepEqual(create().read(20, 'owner-a'), []);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});
