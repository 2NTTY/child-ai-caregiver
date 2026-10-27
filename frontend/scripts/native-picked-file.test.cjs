const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');

test('content-provider selections preserve the native display name and dispose only temporary copies', async () => {
  let deleted = 0, copies = 0, consumed = 0;
  class File {
    constructor(name, uri = 'file:///cache/' + name) { this.name = name; this.uri = uri; }
    type = 'text/plain'; size = 108;
    async copy(directory) { copies++; directory.entries = [new File('download-check.txt')]; }
  }
  class Directory {
    constructor() { this.entries = []; }
    create() {}
    list() { return this.entries; }
    delete() { deleted++; }
  }
  const module = { exports: {} };
  const source = fs.readFileSync('frontend/src/components/agent/native-picked-file.ts', 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'module', 'exports', js)(name => {
    assert.equal(name, 'expo-file-system'); return { File, Directory, Paths: { cache: 'file:///cache/' } };
  }, module, module.exports);
  const { withNativePickedFile } = module.exports;
  const selected = new File('msf:1000049733', 'content://downloads/document/msf%3A1000049733');
  const result = await withNativePickedFile(selected, 1024, async (file, mime, name) => {
    consumed++; assert.equal(name, 'download-check.txt'); assert.equal(mime, 'text/plain');
    assert.ok(file.uri.startsWith('file://')); return 'owned-draft';
  });
  assert.equal(result, 'owned-draft'); assert.equal(deleted, 1);
  await assert.rejects(withNativePickedFile(selected, 1024, async () => { throw new Error('rejected'); }), /rejected/);
  assert.equal(deleted, 2); assert.equal(selected.uri, 'content://downloads/document/msf%3A1000049733');
  await assert.rejects(withNativePickedFile(selected, 100, async () => { consumed++; }), /invalid_file/);
  assert.equal(copies, 2); assert.equal(consumed, 1);
  const local = new File('voice.m4a');
  await withNativePickedFile(local, 1024, async (file, mime, name) => { assert.equal(file, local); assert.equal(name, 'voice.m4a'); });
  assert.equal(copies, 2); assert.equal(deleted, 2);
});
