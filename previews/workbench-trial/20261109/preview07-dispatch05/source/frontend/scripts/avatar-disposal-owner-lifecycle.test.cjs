const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createRequire } = require('node:module');
const root = path.resolve(process.env.PROJECT_UNDER_TEST || path.join(__dirname, '../..')), req = createRequire(path.join(root, 'package.json')), ts = req('typescript');
const cache = new Map();
function compile(file) {
  file = path.resolve(root, file); if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require','module','exports',js)(name => {
    if (!name.startsWith('.')) return req(name);
    const target = path.resolve(path.dirname(file), name);
    return compile(fs.existsSync(target) ? target : target + '.ts');
  }, module, module.exports); return module.exports;
}
const { AvatarOwner } = compile('frontend/src/production/AvatarOwner.ts');
const { AvatarApiError } = compile('src/client/avatars-api.ts');
const childA = 'c0b00000-0000-4000-8000-000000000001';
const childB = 'c0b00000-0000-4000-8000-000000000002';
const policy = { policyId: 'synthetic-lifecycle-v1', acceptedMimeTypes: ['image/jpeg', 'image/png'],
  maxInputBytes: 1024, maxInputPixels: 1000000, maxInputDimension: 2000,
  outputSize: 256, maxOutputBytes: 1024, maxCropZoom: 8 };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const turn = () => new Promise(resolve => setImmediate(resolve));
function fixture({ connected = true } = {}) {
  let changed = 0, pending = false;
  const entered = deferred(), reserve = deferred(), resets = [];
  const api = {
    async read(target) { return { avatar: { target, version: 0, asset: null, updatedAt: null, canManage: true }, policy }; },
    async reserve() { entered.resolve(); try { return await reserve.promise; } catch (error) { pending = true; throw error; } },
    hasPendingOnline: () => pending,
    resetOnline(target) { pending = false; resets.push(target); },
  };
  const owner = new AvatarOwner(api, () => assert.fail('Unexpected access loss'), () => true, () => { changed++; });
  const sync = (key = 'identity-a', childId = childA) => owner.syncContext({ key, userId: 'synthetic-user' }, { key: key + ':' + childId, childId }, true);
  if (connected) sync();
  const image = (label = 'image') => ({ uri: 'blob:synthetic-' + label, width: 80, height: 80, mimeType: 'image/png',
    bytes: new Uint8Array([1, 2, 3]), disposed: 0, dispose() { this.disposed++; this.bytes.fill(0); } });
  const select = (lane, value = image()) => { const attempt = lane.beginSelection(); assert.notEqual(attempt, null); lane.select(attempt, value); return value; };
  return { owner, sync, image, select, entered, reserve, resets, changed: () => changed };
}
// Break caught: no-context cleanup still emits and reaches disposed parent callbacks.
test('initial, cleared, and disposed lanes refuse cancellation without changing snapshots or notifying', async () => {
  const f = fixture({ connected: false });
  try {
    for (const phase of ['initial', 'context-cleared', 'disposed']) {
      if (phase !== 'initial') { f.sync(); await f.owner.self.load(); f.select(f.owner.self); }
      if (phase === 'context-cleared') f.owner.syncContext(null, null, true);
      if (phase === 'disposed') f.owner.dispose();
      for (const lane of [f.owner.self, f.owner.child]) {
        const before = lane.getSnapshot(), changed = f.changed(); let notices = 0;
        const unsubscribe = lane.subscribe(() => notices++);
        assert.equal(lane.cancelSelection(), false, phase);
        assert.equal(lane.cancelSelection(), false, phase + ' repeated');
        assert.equal(lane.getSnapshot(), before, phase + ' keeps snapshot identity');
        assert.equal(f.changed(), changed, phase + ' does not notify parent');
        assert.equal(notices, 0, phase + ' does not notify lane'); unsubscribe();
      }
    }
  } finally { f.owner.dispose(); }
});

// Break caught: an overbroad lifecycle guard suppresses valid cancellation/resource cleanup.
test('valid cancellation clears staging, aborts picker and preserves available avatar and other lane', async () => {
  const f = fixture();
  try {
    await f.owner.self.load(); await f.owner.child.load();
    const selected = f.select(f.owner.self), childSelected = f.select(f.owner.child, f.image('child'));
    f.owner.self.setCrop({ centerX: .2, centerY: .7, zoom: 2 });
    const ticket = f.owner.self.beginSelection(), signal = f.owner.self.selectionSignal(ticket);
    const childBefore = f.owner.child.getSnapshot(), before = f.owner.self.getSnapshot();
    assert.equal(f.owner.self.cancelSelection(), true);
    assert.equal(signal.aborted, true); assert.equal(selected.disposed, 1);
    assert.deepEqual([...selected.bytes], [0, 0, 0]);
    const state = f.owner.self.getSnapshot();
    assert.equal(state.selected, null); assert.deepEqual(state.crop, { centerX: .5, centerY: .5, zoom: 1 });
    assert.equal(state.avatar, before.avatar); assert.equal(state.policy, before.policy); assert.equal(state.available, true);
    assert.equal(f.owner.child.getSnapshot(), childBefore); assert.equal(childSelected.disposed, 0);
    const late = f.image('late'); f.owner.self.select(ticket, late); assert.equal(late.disposed, 1); assert.equal(state, f.owner.self.getSnapshot());
  } finally { f.owner.dispose(); }
});

// Break caught: cancellation discards a busy/unknown original operation or its raw input.
test('busy and unknown operations remain uncancellable with exactly retained snapshots and input', async () => {
  const f = fixture();
  try {
    await f.owner.self.load(); const image = f.select(f.owner.self); const saving = f.owner.self.save();
    await f.entered.promise;
    assert.equal(f.owner.self.getSnapshot().busy, true);
    let before = f.owner.self.getSnapshot(), changes = f.changed();
    assert.equal(f.owner.self.cancelSelection(), false); assert.equal(f.owner.self.getSnapshot(), before); assert.equal(f.changed(), changes);
    assert.equal(image.disposed, 0); assert.deepEqual([...image.bytes], [1, 2, 3]);
    f.reserve.reject(new AvatarApiError()); await saving;
    assert.equal(f.owner.self.getSnapshot().unknown, true); assert.equal(f.owner.self.getSnapshot().busy, false);
    before = f.owner.self.getSnapshot(); changes = f.changed();
    assert.equal(f.owner.self.cancelSelection(), false); assert.equal(f.owner.self.getSnapshot(), before); assert.equal(f.changed(), changes);
    assert.equal(image.disposed, 0); assert.deepEqual([...image.bytes], [1, 2, 3]);
  } finally { f.owner.dispose(); }
});

// Break caught: a permanent disposed flag prevents connect/scope reuse.
test('same-key and new-key context reuse restore valid cancellation after dispose', async () => {
  const f = fixture();
  try {
    for (const key of ['identity-a', 'identity-b']) {
      await f.owner.self.load(); const old = f.select(f.owner.self); f.owner.dispose();
      assert.equal(old.disposed, 1);
      f.sync(key); await f.owner.self.load(); const current = f.select(f.owner.self, f.image(key));
      assert.equal(f.owner.self.cancelSelection(), true); assert.equal(current.disposed, 1);
      assert.equal(f.owner.self.getSnapshot().key, key); assert.equal(f.owner.self.getSnapshot().available, true);
    }
  } finally { f.owner.dispose(); }
});

// Break caught: child scope reset/cancellation alters the identity-scoped self editor.
test('child scope replacement rejects stale picker while retaining independent self selection', async () => {
  const f = fixture();
  try {
    await f.owner.self.load(); await f.owner.child.load();
    const selfImage = f.select(f.owner.self), oldChild = f.select(f.owner.child);
    const ticket = f.owner.child.beginSelection(), signal = f.owner.child.selectionSignal(ticket);
    const selfBefore = f.owner.self.getSnapshot();
    f.sync('identity-a', childB);
    assert.equal(signal.aborted, true); assert.equal(oldChild.disposed, 1);
    assert.equal(f.owner.self.getSnapshot(), selfBefore); assert.equal(selfImage.disposed, 0);
    const stale = f.image('stale-child'); f.owner.child.select(ticket, stale); assert.equal(stale.disposed, 1);
    await f.owner.child.load(); const next = f.select(f.owner.child, f.image('next-child'));
    assert.equal(f.owner.child.cancelSelection(), true); assert.equal(next.disposed, 1);
    assert.equal(f.owner.self.getSnapshot(), selfBefore); assert.equal(f.owner.self.cancelSelection(), true); assert.equal(selfImage.disposed, 1);
  } finally { f.owner.dispose(); }
});


// This separate case reaches dispose even when the earlier initial-state assertion fails.
test('late repeated cleanup after real AvatarOwner disposal preserves both lanes and all callbacks', async () => {
  const f = fixture();
  try {
    await f.owner.self.load(); await f.owner.child.load();
    const selfImage = f.select(f.owner.self), childImage = f.select(f.owner.child);
    f.owner.dispose();
    assert.equal(selfImage.disposed, 1); assert.equal(childImage.disposed, 1);
    const before = [f.owner.self.getSnapshot(), f.owner.child.getSnapshot()];
    const changes = f.changed(); let notifications = 0;
    const off = [f.owner.self.subscribe(() => notifications++), f.owner.child.subscribe(() => notifications++)];
    try {
      for (let repeat = 0; repeat < 3; repeat++) {
        assert.equal(f.owner.self.cancelSelection(), false);
        assert.equal(f.owner.child.cancelSelection(), false);
      }
      assert.equal(f.owner.self.getSnapshot(), before[0]); assert.equal(f.owner.child.getSnapshot(), before[1]);
      assert.equal(f.changed(), changes); assert.equal(notifications, 0);
      assert.equal(selfImage.disposed, 1); assert.equal(childImage.disposed, 1);
    } finally { off.forEach(fn => fn()); }
  } finally { f.owner.dispose(); }
});
