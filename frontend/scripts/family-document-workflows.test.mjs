import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), require = createRequire(import.meta.url);
const compile = (file, resolve, suffix = '') => {
  const filename = path.join(root, file), source = readFileSync(filename, 'utf8').replaceAll('import.meta.url', JSON.stringify(pathToFileURL(filename).href));
  const output = ts.transpileModule(source, { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} }; new Function('require', 'module', 'exports', output + suffix)(resolve, module, module.exports); return module.exports;
};
const model = compile('frontend/src/preparation-view-model.ts', require);
const schemas = compile('src/shared/family-documents.ts', require);
const child = '00000000-0000-4000-8000-000000000001', id = '00000000-0000-4000-8000-000000000002';
const snapshot = () => ({ id: '00000000-0000-4000-8000-000000000003', version: 2, generatedAt: '2026-10-07T00:00:00Z', sourceBasis: 'original-basis', title: 'Synthetic preparation', summary: 'Synthetic shared summary', ageLabel: '年齡未確認', period: { from: '2026-10-01', to: '2026-10-07' }, eventDate: null, coverageNote: 'Synthetic limited coverage',
  sections: [{ id: 'checklist', title: '準備清單', kind: 'checklist', domain: null, items: [{ id: 'template-0', text: 'Synthetic checked item', sourceIds: [], checked: true }] }], sources: [], changes: [] });
const item = () => ({ id, childId: child, kind: 'preparation', purpose: 'appointment', version: 2, status: 'active', archivedAt: null, current: snapshot(), history: [], readState: 'stale', autoRefresh: false });
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...(Array.isArray(tree) ? tree : [tree.props?.children]).flatMap(nodes)];
const label = (tree, text) => nodes(tree).find(node => node.props?.label === text);
function hooks() {
  const slots = []; let cursor = 0;
  const slot = create => { const index = cursor++; if (!(index in slots)) slots[index] = create(); return index; };
  return { reset() { cursor = 0; }, react: {
    useState(value) { const index = slot(() => typeof value === 'function' ? value() : value); return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }]; },
    useRef(value) { return slots[slot(() => ({ current: value }))]; }, useMemo(create) { return slots[slot(create)]; }, useEffect() {}, useLayoutEffect() {},
  } };
}
function ownerHarness() {
  const h = hooks(), actions = [], jobs = [];
  const env = { apiBaseUrl: '/api', userId: 'synthetic-parent', childId: child, childName: '甲', role: 'owner', online: true, scopeKey: 'synthetic-scope', current: () => true, canStartWrite: () => true, invalidate() {} };
  let page = { authorityVersion: 'synthetic:1', canManage: true, items: [item()], hasMore: false };
  const runtime = { lost: false, live: () => !runtime.lost && env.current(), accessError: () => false,
    read: (_key, operation, signal) => operation(signal),
    request(operation) { const promise = operation(new AbortController().signal, () => runtime.live()); jobs.push(promise); return promise; } };
  const api = { reset() {}, async create(childId, input) {
    actions.push({ childId, input });
    const next = { ...item(), id: '00000000-0000-4000-8000-000000000004', kind: input.kind, purpose: input.purpose, version: 1, readState: 'ready', current: { ...snapshot(), period: input.period, version: 1 } };
    page = { ...page, items: [...page.items, next] }; return structuredClone(next);
  }, getPage: async () => structuredClone(page), async change(childId, documentId, input) {
    actions.push({ childId, documentId, input });
    const next = { ...page.items[0], version: input.expectedVersion + 1, status: 'archived', archivedAt: '2026-10-07T01:00:00Z' };
    page = { ...page, items: [next] }; return structuredClone(next);
  } };
  const { useFamilyDocuments } = compile('frontend/src/production/useFamilyDocuments.ts', name => {
    if (name === 'react') return h.react;
    if (name.endsWith('/family-documents-api')) return { createFamilyDocumentsApi: () => api, FamilyDocumentApiError: Error, requiresFreshDocumentConfirmation: () => false };
    if (name.endsWith('/family-documents')) return schemas;
    if (name === './useDomainEnvironment') return { useDomainWriteGuard() {} };
    if (name === './task-knowledge-runtime') return { useTaskKnowledgeRuntime: () => runtime, useTaskKnowledgeRefresh() {} };
    throw new Error('Unexpected import ' + name);
  });
  return { env, runtime, actions, setItem(value) { page.items = [value]; }, render() { h.reset(); return useFamilyDocuments(env); }, async settle() { while (jobs.length) await jobs.shift(); } };
}
function detailHarness(document) {
  const h = hooks(), calls = [];
  const workspace = { scopeKey: 'synthetic-scope', model: { child: { displayName: '甲' }, scope: { childId: child, condition: 'ready', online: true, role: 'owner' }, online: true,
    capabilities: { archive: true, checkItem: true }, operation: { state: 'none' } }, actions: { archiveDocument: (...args) => calls.push(args) } };
  const { Detail } = compile('frontend/src/components/preparations/PreparationWorkspace.tsx', name => {
    if (name === 'react') return h.react;
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name === 'react-native') return { View: 'View', StyleSheet: { create: value => value }, Platform: { OS: 'web' } };
    if (name === 'react-native-paper') return { Text: 'Text' };
    if (name.endsWith('/preparation-view-model')) return model;
    if (name.endsWith('/theme')) return { colors: {}, radius: {}, readingType: {}, spacing: {} };
    return new Proxy({}, { get: (_target, key) => String(key) });
  }, '\nexports.Detail = PreparationDocumentDetail;');
  return { workspace, calls, render() { h.reset(); return Detail({ document, workspace, onClose() {} }); } };
}

test('production owner archives a readable stale snapshot using the original version without refresh', async () => {
  const h = ownerHarness(); h.render().refresh(); await h.settle();
  const current = h.render(); assert.equal(current.preparation.model.documents[0].readState, 'stale');
  current.preparation.actions.archiveDocument(id, 2); await h.settle();
  assert.deepEqual(h.actions, [{ childId: child, documentId: id, input: { action: 'archive', expectedVersion: 2, authorityVersion: 'synthetic:1' } }]);
  const archived = h.render().preparation.model.documents[0];
  assert.equal(archived.status, 'archived'); assert.equal(archived.revision.id, snapshot().id); assert.equal(archived.revision.sections[0].items[0].checked, true);
  assert.equal(archived.readState, 'stale');
});

test('production owner retains invalidated, old-version, foreign-child, offline, role and pending guards', async () => {
  for (const scenario of ['invalidated', 'missing-snapshot', 'old-version', 'foreign-child', 'offline', 'viewer', 'lost', 'stale-check']) {
    const h = ownerHarness(), value = item();
    if (scenario === 'invalidated') { value.readState = 'invalidated'; value.current = null; }
    if (scenario === 'missing-snapshot') value.current = null;
    if (scenario === 'foreign-child') value.childId = 'another-child';
    h.setItem(value); h.render().refresh(); await h.settle();
    if (scenario === 'offline') h.env.online = false;
    if (scenario === 'viewer') h.env.role = 'viewer';
    if (scenario === 'lost') h.runtime.lost = true;
    const current = h.render();
    if (scenario === 'stale-check') current.preparation.actions.checkItem(id, 2, 'checklist', 'template-0', false);
    else current.preparation.actions.archiveDocument(id, scenario === 'old-version' ? 1 : 2);
    await h.settle(); assert.equal(h.actions.length, 0, scenario);
  }
  const h = ownerHarness(); h.render().refresh(); await h.settle(); const current = h.render();
  current.preparation.actions.archiveDocument(id, 2); current.preparation.actions.archiveDocument(id, 2); await h.settle(); assert.equal(h.actions.length, 1);
});

test('production creation guard rejects only the same family-report period and allows another fixed period', async () => {
  const h = ownerHarness(), report = { ...item(), kind: 'growth_report', purpose: 'family', readState: 'ready', autoRefresh: true };
  h.setItem(report); h.render().refresh(); await h.settle();
  const input = { kind: 'growth_report', purpose: 'family', title: 'Synthetic report', eventDate: null, period: { from: '2026-10-01', to: '2026-10-07' } };
  h.render().createDocument(input); await h.settle(); assert.equal(h.actions.length, 0);
  assert.match(h.render().notice, /這個期間/u);
  const quarter = { ...input, period: { from: '2026-07-01', to: '2026-09-30' } };
  h.render().createDocument(quarter); await h.settle(); assert.deepEqual(h.actions, [{ childId: child, input: quarter }]);
});

test('readable stale preparation exposes archive confirmation while checklist editing remains disabled', () => {
  const value = item(), view = { ...value, revision: { ...value.current, number: 2, updatedAt: value.current.generatedAt, sourceAsOf: value.current.generatedAt, sourceRefs: [] }, sources: [] };
  const h = detailHarness(view); let tree = h.render();
  assert.equal(label(tree, '使用完畢，歸檔').props.disabled, false);
  assert.ok(!nodes(tree).some(node => node.type === 'AppCheckbox'));
  label(tree, '使用完畢，歸檔').props.onPress(); tree = h.render();
  label(tree, '歸檔這份準備').props.onPress(); assert.deepEqual(h.calls, [[id, 2]]);
  for (const state of ['invalidated', 'restricted', 'unknown']) { view.readState = state; view.revision = null; assert.equal(label(h.render(), '使用完畢，歸檔').props.disabled, true); }
  view.readState = 'stale'; view.revision = { ...value.current, sourceRefs: [] }; h.workspace.model.operation.state = 'unknown';
  assert.equal(label(h.render(), '使用完畢，歸檔').props.disabled, true);
});

test('PDF composition includes undated concern body with sources omitted and keeps the exact snapshot', async () => {
  let tree;
  const { renderFamilyDocumentPdf } = compile('server/family-document-pdf.ts', name => {
    if (name === 'react') return { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) };
    if (name === 'node:url') return require(name);
    if (name === '@react-pdf/renderer') return { Document: 'Document', Page: 'Page', Text: 'Text', View: 'View', Font: { register() {} }, StyleSheet: { create: value => value }, renderToBuffer: async value => { tree = value; return Buffer.from('synthetic-renderer'); } };
    throw new Error('Unexpected import ' + name);
  });
  const value = snapshot(); value.sections = [{ id: 'undated-concerns', title: '目前持續關注（未提供觀察日期；未計入期間）', kind: 'notes', domain: 'concerns', items: [{ id: 'concern:active', text: 'Synthetic active concern without observation', sourceIds: ['concern:active'] }] }];
  value.sources = [{ id: 'concern:active', at: null, label: '家庭持續關注', text: value.sections[0].items[0].text, version: 1 }];
  const before = structuredClone(value), input = { snapshotId: value.id, snapshotVersion: value.version, authorityVersion: 'synthetic:1', purpose: 'family', includeSources: false, includeRevision: false };
  await renderFamilyDocumentPdf(value, input);
  const rendered = JSON.stringify(tree);
  assert.ok(rendered.includes(value.sections[0].title)); assert.ok(rendered.includes(value.sections[0].items[0].text));
  assert.ok(!rendered.includes('原始資料及依據')); assert.deepEqual(value, before);
  await assert.rejects(renderFamilyDocumentPdf(value, { ...input, snapshotVersion: value.version + 1 }), /document_snapshot_changed/u);
});
