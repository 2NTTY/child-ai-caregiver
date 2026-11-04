const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Real inbox, native package adapter/hash and import owner; synthetic Expo files and API only.
test('Android package sharing requires a choice and preserves existing import recovery and scope guards', async () => {
  const root = path.resolve(__dirname, '../..'), files = new Map(), dirs = new Set(), opened = [];
  let raw = [], pauseCopy = null, platformOS = 'android';
  const bytes = Uint8Array.from([0x50, 0x4b, 3, 4, 1, 2, 3]);
  const source = 'content://documents/external-opaque-id';
  files.set(source, { bytes, name: 'opaque-id', displayName: 'Care handover.zip' });
  const uriFor = (parent, name) => (typeof parent === 'string' ? parent : parent.uri).replace(/\/$/, '') + (name ? '/' + name : '');
  class Directory {
    constructor(parent, name) { this.uri = uriFor(parent, name); this.name = this.uri.split('/').at(-1); }
    create() { dirs.add(this.uri); }
    list() { return [...dirs].filter(uri => uri.startsWith(this.uri + '/') && !uri.slice(this.uri.length + 1).includes('/')).map(uri => new Directory(uri))
      .concat([...files.keys()].filter(uri => uri.startsWith(this.uri + '/') && !uri.slice(this.uri.length + 1).includes('/')).map(uri => new File(uri))); }
    delete() { for (const uri of [...files.keys()]) if (uri.startsWith(this.uri + '/')) files.delete(uri); dirs.delete(this.uri); }
  }
  class File {
    constructor(parent, name) { this.uri = name ? uriFor(parent, name) : parent; opened.push(this.uri); }
    get entry() { return files.get(this.uri); }
    get exists() { return files.has(this.uri); } get name() { return this.entry?.name ?? this.uri.split('/').at(-1); }
    get type() { return 'application/zip'; } get size() { return this.entry?.size ?? this.entry?.bytes.length ?? 0; }
    get creationTime() { return Date.now(); }
    async copy(target) {
      if (this.uri === source && pauseCopy) await pauseCopy;
      const uri = target instanceof Directory ? uriFor(target, this.entry.displayName ?? this.name) : target.uri;
      files.set(uri, { bytes: new Uint8Array(this.entry.bytes), name: uri.split('/').at(-1) });
    }
    readableStream() { const content = new Uint8Array(this.entry.bytes); return new ReadableStream({ start(c) { c.enqueue(content); c.close(); } }); }
    async bytes() { return new Uint8Array(this.entry.bytes); }
    delete() { assert.ok(this.uri.startsWith('file:///cache/'), 'never delete the external source'); files.delete(this.uri); }
  }
  let production, share, routes = [];
  const jsx = (type, props, key) => ({ type, props, key }), noop = () => {};
  const mocks = {
    react: { useEffect: noop, useLayoutEffect: noop, useRef: () => ({ current: null }), useState: initial => [initial, noop], useSyncExternalStore: (_s, get) => get() },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'View', StyleSheet: { create: value => value }, Platform: { get OS() { return platformOS; } }, AppState: {}, Linking: {} },
    'react-native-paper': { Text: 'Text' },
    'expo-sharing': { getSharedPayloads: () => raw, clearSharedPayloads: () => { raw = []; } },
    'expo-file-system': { File, Directory, Paths: { cache: 'file:///cache' } },
    '../components/agent/native-chat-file': { copyNativeFile: async () => ({ kind: 'file', dispose: noop }) },
    '../components/agent/native-voice-file': { copyNativeVoice: async () => { throw Error('No voice'); } },
    '../production/photo-original': { photoOriginalFromBytes: async () => { throw Error('No photo'); } },
    '../production/ProductionProvider': { useProduction: () => production },
    '../production/IncomingShareProvider': { useIncomingShare: () => share },
    '../preview/PreviewNavigationGuard': { usePreviewLeaveGuard: noop, usePreviewNavigation: () => action => action() },
    '../components/PageFrame': { PageFrame: 'PageFrame' }, '../components/ChildPicker': { ChildPicker: 'ChildPicker' },
    '../components/ui': { AppButton: 'Button', SectionCard: 'Card' },
    '../theme': { spacing: {}, chineseFont: 'sans' },
    'expo-router': { useRouter: () => ({ push: value => routes.push(value) }) },
  };
  const cache = new Map();
  function load(relative) {
    const filename = path.resolve(root, relative);
    if (cache.has(filename)) return cache.get(filename).exports;
    if (filename.endsWith('.json')) return JSON.parse(fs.readFileSync(filename, 'utf8'));
    const module = { exports: {} }; cache.set(filename, module);
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    new Function('require', 'module', 'exports', output)(name => {
      if (name in mocks) return mocks[name];
      if (!name.startsWith('.')) return require(name);
      let target = path.resolve(path.dirname(filename), name);
      if (!fs.existsSync(target)) target += '.ts';
      return load(path.relative(root, target));
    }, module, module.exports); return module.exports;
  }
  const native = load('frontend/src/platform/incoming-share.native.ts').createIncomingSharePlatform();
  assert.equal(typeof native.preparePackage, 'function', 'shared ZIPs must enter the existing package adapter');
  const controller = new AbortController();
  const selected = await native.preparePackage({ shareType: 'file', value: source }, controller.signal);
  assert.equal(selected.filename, 'Care handover.zip'); assert.equal(selected.bytes, bytes.length);
  assert.equal(selected.sha256.length, 64); selected.release(); assert.ok(selected.body.every(value => value === 0));
  const before = opened.length;
  await assert.rejects(native.preparePackage({ shareType: 'file', value: 'content://org.yuyoufang.app.SharingFileProvider/private.zip' }, controller.signal), /own_provider/);
  await assert.rejects(native.preparePackage({ shareType: 'file', value: 'file:///private.zip' }, controller.signal), /content_uri/);
  assert.equal(opened.length, before);
  files.get(source).size = 20 * 1024 * 1024 + 1;
  await assert.rejects(native.preparePackage({ shareType: 'file', value: source }, controller.signal)); delete files.get(source).size;
  platformOS = 'ios'; await assert.rejects(native.preparePackage({ shareType: 'file', value: source }, controller.signal)); platformOS = 'android';

  const { createIncomingShareInbox } = load('frontend/src/incoming-share.ts');
  const { HandoverImportOwner } = load('frontend/src/production/HandoverImportOwner.ts');
  const { createProductionPackageShareTarget } = load('frontend/src/production/incoming-share-package-target.ts');
  const Screen = load('frontend/src/screens/shareScreen.tsx').default;
  const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
  function flow() {
    let reserves = 0, uploads = 0, unknown = false, currentUpload, holdUpload = false, began;
    const uploadBegan = new Promise(resolve => { began = resolve; });
    const importer = new HandoverImportOwner({ setIdentity: noop,
      async reserveUpload(_user, command) { reserves++; currentUpload = { ...command, id: command.opId, state: 'reserved', version: 1 }; return currentUpload; },
      async uploadContent(_user, _id, _body, signal) { uploads++; began();
        if (holdUpload) await new Promise((_resolve, reject) => { signal.addEventListener('abort', () => reject(signal.reason), { once: true }); });
        if (unknown) throw Error('response lost'); return { ...currentUpload, state: 'ready', version: 2, preview: { children: [] } }; },
      async createImport() { assert.fail('Sharing cannot begin an import batch'); } });
    importer.syncContext('owner', 'owner:1', true);
    const state = { identityKey: 'owner:1', scopeKey: 'child:1', account: { gate: 'ready', busy: null, deletion: { phase: 'idle' } }, records: { user: { id: 'owner' }, online: true } };
    const observers = new Set();
    const owner = { handoverImportOwner: importer, getSnapshot: () => state, subscribe(fn) { observers.add(fn); return () => observers.delete(fn); },
      chatController: { getSnapshot: () => ({ busy: true }) }, draftOwner: { getSnapshot: () => ({}) } };
    const inbox = createIncomingShareInbox(native); inbox.observeIdentity(state.identityKey); inbox.observeScope(state.scopeKey);
    owner.subscribe(() => { inbox.observeIdentity(state.identityKey); inbox.observeScope(state.scopeKey); });
    raw = [{ shareType: 'file', value: source }]; inbox.receive();
    production = { owner, identityKey: state.identityKey, recordsState: { children: [] }, selectedChildId: null,
      sharedChild: { target: null }, actions: {}, model: { children: [] }, agentAttachments: [], online: true, account: state.account };
    share = { inbox, snapshot: inbox.getSnapshot() }; routes = [];
    const scope = value => { state.scopeKey = value; for (const observe of observers) observe(); };
    return { importer, inbox, owner, scope, state, uploadBegan, counts: () => [reserves, uploads], loseResponse: () => { unknown = true; }, holdUpload: () => { holdUpload = true; } };
  }
  const first = flow(), tree = Screen();
  assert.deepEqual(first.counts(), [0, 0], 'receiving and rendering never upload');
  assert.equal(nodes(tree).filter(node => node.props?.label === '加入目前聊天草稿').length, 1);
  const button = nodes(tree).find(node => node.props?.label === '作為資料包匯入'); assert.ok(button); assert.equal(button.props.disabled, false);
  await button.props.onPress();
  assert.deepEqual(first.counts(), [1, 1]); assert.equal(first.inbox.getSnapshot().items.length, 0);
  assert.equal(first.importer.getSnapshot().upload.state, 'ready'); assert.equal(first.importer.getSnapshot().panelRequested, true);
  assert.deepEqual(routes, ['/settings?section=account']);
  await button.props.onPress(); assert.deepEqual(first.counts(), [1, 1], 'double taps cannot create another upload');

  for (const change of ['scope', 'discard', 'identity']) {
    const pending = flow(); let finish; pauseCopy = new Promise(resolve => { finish = resolve; });
    const item = pending.inbox.getSnapshot().items[0];
    const taking = pending.inbox.takePackage(item.id, createProductionPackageShareTarget(pending.owner));
    await Promise.resolve();
    if (change === 'scope') { pending.scope('other'); pending.scope('child:1'); }
    else if (change === 'discard') pending.inbox.discard(item.id);
    else { pending.state.identityKey = 'other'; pending.importer.syncContext('other', 'other', true); pending.inbox.observeIdentity('other'); }
    finish(); await taking; pauseCopy = null;
    assert.deepEqual(pending.counts(), [0, 0], change + ' cannot upload a late copy');
    assert.equal(pending.importer.getSnapshot().upload, null);
  }
  const invalid = flow(); files.get(source).displayName = 'Ordinary attachment.pdf';
  assert.equal(await invalid.inbox.takePackage(invalid.inbox.getSnapshot().items[0].id, createProductionPackageShareTarget(invalid.owner)), false);
  assert.deepEqual(invalid.counts(), [0, 0]); assert.ok(invalid.inbox.getSnapshot().error);
  assert.equal(invalid.inbox.getSnapshot().items.length, 1, 'a failed choice remains available as an ordinary attachment');
  files.get(source).displayName = 'Care handover.zip';
  const interrupted = flow(); interrupted.holdUpload();
  const interruptedId = interrupted.inbox.getSnapshot().items[0].id;
  const uploading = interrupted.inbox.takePackage(interruptedId, createProductionPackageShareTarget(interrupted.owner));
  await interrupted.uploadBegan; interrupted.scope('other');
  assert.equal(await uploading, false);
  assert.equal(interrupted.importer.getSnapshot().pending.kind, 'upload');
  assert.equal(interrupted.importer.getSnapshot().pending.checked, false, 'interruption requires the original receipt, not another upload');
  assert.equal(interrupted.importer.getSnapshot().upload.state, 'reserved');
  assert.equal(interrupted.importer.getSnapshot().panelRequested, undefined);
  assert.equal(interrupted.inbox.getSnapshot().items.length, 0, 'an adopted file cannot be submitted as another request');
  interrupted.importer.syncContext(null, null, false);
  const lost = flow(); lost.loseResponse();
  const lostId = lost.inbox.getSnapshot().items[0].id;
  assert.equal(await lost.inbox.takePackage(lostId, createProductionPackageShareTarget(lost.owner)), true);
  assert.equal(lost.importer.getSnapshot().pending.kind, 'upload'); assert.equal(lost.importer.getSnapshot().pending.checked, false);
  assert.equal(lost.importer.getSnapshot().upload.state, 'reserved', 'a lost result is never shown as completed');
  assert.equal(await lost.inbox.takePackage(lostId, createProductionPackageShareTarget(lost.owner)), false);
  assert.deepEqual(lost.counts(), [1, 1]);
  assert.ok(files.has(source), 'external input is retained');
});
