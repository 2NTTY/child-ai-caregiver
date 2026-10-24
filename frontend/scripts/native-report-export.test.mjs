import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const root = new URL('../../', import.meta.url);
function compile(file, dependencies = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL(file, root), 'utf8'), {
    fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'module', 'exports', code)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unmocked dependency: ${name}`);
    return dependencies[name];
  }, module, module.exports);
  return module.exports;
}
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = () => new Promise(resolve => setImmediate(resolve));
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];

// Deterministic hooks and in-memory native ports exercise shipped composition and adapter code.
// This is not a React scheduler, OS permission, share-sheet, device or PDF-rendering test.
function hooks() {
  const slots = [], effects = []; let cursor = 0, updates = 0;
  const slot = create => { const i = cursor++; if (!(i in slots)) slots[i] = create(); return i; };
  const effect = (callback, deps) => {
    const i = cursor++, previous = slots[i];
    if (!previous || deps.some((value, key) => !Object.is(value, previous.deps[key]))) {
      const next = { deps, cleanup: previous?.cleanup }; slots[i] = next;
      effects.push(() => { next.cleanup?.(); next.cleanup = callback(); });
    }
  };
  return {
    react: {
      useState(value) { const i = slot(() => value); return [slots[i], next => { updates++; slots[i] = next; }]; },
      useRef: value => slots[slot(() => ({ current: value }))], useEffect: effect, useLayoutEffect: effect,
    },
    render(callback) { cursor = 0; const value = callback(); while (effects.length) effects.shift()(); return value; },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); }, get updates() { return updates; },
  };
}
function native(h = hooks()) {
  const files = [], shares = [], probes = []; let availability = async () => true, shareError = null;
  class Directory { create() {} list() { return files.filter(file => file.exists); } }
  class File {
    exists = false; creationTime = Date.now();
    constructor(_directory, name) { this.uri = `file:///synthetic-cache/${name}`; files.push(this); }
    create() { this.exists = true; } write(bytes) { this.bytes = bytes; } delete() { this.exists = false; }
  }
  const adapter = compile('frontend/src/platform/file-export.native.ts', {
    react: h.react, 'expo-file-system': { Directory, File, Paths: { cache: 'synthetic-cache' } },
    'expo-sharing': {
      isAvailableAsync() { probes.push('availability'); return availability(); },
      async shareAsync(uri, options) { shares.push({ uri, options }); if (shareError) throw shareError; },
    },
    '../../../src/client/blob-bytes': compile('src/client/blob-bytes.ts'),
  });
  return { ...adapter, h, files, shares, probes,
    availability(value) { availability = value; }, failShare(error) { shareError = error; },
  };
}
function summary(adapter, h) {
  const exportReport = async () => ({ state: 'ready', message: 'Synthetic handoff' });
  let documents = { exportReport, exportBusy: false };
  const dependencies = {
    react: h.react, 'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': { View: 'View', StyleSheet: { create: value => value } }, 'react-native-paper': { Text: 'Text' },
    'expo-router': { Redirect: 'Redirect', useLocalSearchParams: () => ({ tab: 'archive' }), usePathname: () => '/summary', useRouter: () => ({}) },
    '../production/ProductionProvider': { useProduction: () => ({ scopeKey: 'scope', model: { selectedChildId: 'child', children: [{ id: 'child' }] }, actions: {} }) },
    '../production/useProductionAvatar': { useProductionAvatar: () => ({ state: { key: 'scope', uri: null } }) },
    '../production/TaskKnowledgeDomains': { useProductionFamilyDocuments: () => documents },
    '../platform/file-export': adapter,
    '../workspaces/GrowthWorkspace': { useGrowthWorkspace: () => ({ scopeKey: 'scope', model: { online: true }, actions: {} }) },
    '../workspaces/ProfileWorkspace': { useProfileWorkspace: () => null },
    '../components/useContainerWidth': { useContainerWidth: () => ({ width: 390 }) },
    '../preview/PreviewNavigationGuard': { usePreviewNavigation: () => action => action() },
    '../components/ui': { AppButton: 'AppButton', AppTabPanel: 'AppTabPanel', UnderlineTabs: 'UnderlineTabs' },
    '../theme': { colors: {}, readingType: {}, spacing: {} },
  };
  for (const name of ['components/avatar/AvatarView', 'components/child-overview/ChildOverviewConcerns', 'components/child-overview/ChildOverviewContent',
    'components/growth/GrowthArchive', 'components/ReadStateNotice', 'production/FamilyReportControls', 'components/PageFrame', 'production/TaskKnowledgeSummaryContent']) {
    const symbol = name.split('/').at(-1); dependencies['../' + name] = { [symbol]: symbol };
  }
  const { SummaryScreen } = compile('frontend/src/screens/SummaryScreen.tsx', dependencies);
  return { exportReport, documents: value => { documents = value; },
    render: () => nodes(h.render(SummaryScreen)).find(node => node.type === 'GrowthArchive').props };
}

test('native summary wires the original PDF callback only after sharing capability is confirmed, without requiring document', async () => {
  assert.equal(typeof document, 'undefined');
  const adapter = native(), gate = deferred(); adapter.availability(() => gate.promise);
  const screen = summary(adapter, adapter.h);
  assert.equal(screen.render().onExportReport, undefined);
  gate.resolve(true); await settle();
  assert.equal(screen.render().onExportReport, screen.exportReport);
  assert.deepEqual(await screen.render().onExportReport(), { state: 'ready', message: 'Synthetic handoff' });
  assert.equal(screen.render().exportBusy, false);
  screen.documents({ exportReport: screen.exportReport, exportBusy: true });
  assert.equal(screen.render().exportBusy, true);
  screen.documents(null); assert.equal(screen.render().onExportReport, undefined);
  assert.equal(adapter.probes.length, 1); assert.deepEqual(adapter.files, []); assert.deepEqual(adapter.shares, []);
  adapter.h.unmount();
});

test('native summary stays unavailable when capability is absent or fails and ignores a probe after unmount', async () => {
  for (const availability of [async () => false, async () => { throw new Error('Synthetic unavailable adapter'); }]) {
    const adapter = native(); adapter.availability(availability); const screen = summary(adapter, adapter.h);
    assert.equal(screen.render().onExportReport, undefined); await settle();
    assert.equal(screen.render().onExportReport, undefined); assert.deepEqual(adapter.files, []); assert.deepEqual(adapter.shares, []);
    adapter.h.unmount();
  }
  const adapter = native(), gate = deferred(); adapter.availability(() => gate.promise);
  summary(adapter, adapter.h).render(); adapter.h.unmount(); gate.resolve(true); await settle();
  assert.equal(adapter.h.updates, 0);
});

test('web summary retains the document gate and original callback without a native capability probe', () => {
  const adapter = compile('frontend/src/platform/file-export.ts'), h = hooks(), screen = summary(adapter, h);
  assert.equal(screen.render().onExportReport, undefined);
  globalThis.document = {};
  try { assert.equal(screen.render().onExportReport, screen.exportReport); }
  finally { delete globalThis.document; h.unmount(); }
});

test('native export preserves PDF bytes and scope, and reports handoff rather than claiming save completion', async () => {
  const adapter = native(), blob = new Blob(['synthetic-pdf'], { type: 'application/pdf' });
  const message = await adapter.exportBlob(blob, 'growth-report-synthetic-v1.pdf', () => true);
  assert.equal(adapter.files.length, 1); assert.deepEqual(adapter.files[0].bytes, new TextEncoder().encode('synthetic-pdf'));
  assert.equal(adapter.files[0].exists, true); assert.equal(adapter.shares.length, 1);
  assert.equal(adapter.shares[0].options.mimeType, 'application/pdf');
  assert.match(adapter.shares[0].uri, /growth-report-synthetic-v1\.pdf$/);
  assert.equal(message, '已開啟系統保存／分享；請核對是否已保存，取消不代表完成。');
});

test('native export rechecks capability and rejects denied sharing or stale scope without a successful handoff', async () => {
  const adapter = native(), blob = new Blob(['synthetic-pdf'], { type: 'application/pdf' });
  adapter.availability(async () => false);
  await assert.rejects(adapter.exportBlob(blob, 'report.pdf'), /Sharing unavailable/);
  assert.equal(adapter.files.length, 0); assert.equal(adapter.shares.length, 0);
  adapter.availability(async () => true); adapter.failShare(new Error('Synthetic share permission denied'));
  await assert.rejects(adapter.exportBlob(blob, 'report.pdf'), /permission denied/);
  assert.equal(adapter.files.length, 1); assert.equal(adapter.files[0].exists, false);
  adapter.failShare(null);
  await assert.rejects(adapter.exportBlob(blob, 'report.pdf', () => false), /Export scope changed/);
  assert.equal(adapter.files.length, 1); assert.equal(adapter.shares.length, 1);
  const gate = deferred(); let current = true; adapter.availability(() => gate.promise);
  const pending = adapter.exportBlob(blob, 'report.pdf', () => current);
  current = false; gate.resolve(true); await assert.rejects(pending, /Sharing unavailable|Export unavailable/);
  assert.equal(adapter.files.length, 1); assert.equal(adapter.shares.length, 1);
});
