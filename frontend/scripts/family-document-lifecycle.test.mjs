import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import { archiveReadingView, growthReportExportRequest } from '../src/components/growth/growth-archive-view.ts';

const require = createRequire(import.meta.url);
const root = new URL('../../', import.meta.url);
function compile(file, resolve = require, suffix = '') {
  const module = { exports: {} };
  const output = ts.transpileModule(readFileSync(new URL(file, root), 'utf8'), {
    fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'module', 'exports', output + suffix)(resolve, module, module.exports);
  return module.exports;
}
const schemas = compile('src/shared/family-documents.ts');
const apiModule = compile('src/client/family-documents-api.ts', name => name.includes('/family-documents') ? schemas
  : name.includes('/api-base-url') ? { resolveApiBaseUrl: value => value } : require(name));
const preparationModel = compile('frontend/src/preparation-view-model.ts');
const child = '00000000-0000-4000-8000-000000000001';
const a = '00000000-0000-4000-8000-000000000002', b = '00000000-0000-4000-8000-000000000003';
const created = '00000000-0000-4000-8000-000000000004';
const snapshot = (id, version = 1) => ({ id: '10000000-0000-4000-8000-' + id.slice(-12), version,
  generatedAt: '2026-10-07T00:00:00Z', sourceBasis: 'basis', title: 'Synthetic ' + id.slice(-1), summary: 'Synthetic',
  ageLabel: 'unknown', period: { from: '2026-10-01', to: '2026-10-07' }, eventDate: null, coverageNote: 'Synthetic',
  sections: [{ id: 'checklist', title: 'Checklist', kind: 'checklist', domain: null,
    items: [{ id: 'one', text: 'Synthetic checklist', sourceIds: [], checked: false }] }], sources: [], changes: [] });
const item = id => ({ id, childId: child, kind: 'preparation', purpose: 'appointment', version: 1, status: 'active',
  archivedAt: null, current: snapshot(id), history: [], readState: 'ready', autoRefresh: false });
const request = { kind: 'preparation', title: 'My unsent title', purpose: 'appointment', eventDate: null, period: { from: '2026-10-01', to: '2026-10-07' } };
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };

// Execute shipped hooks/components and the real API replay owner with synthetic HTTP.
// Deterministic hook slots are not real React scheduler, browser, or layout evidence.
function hooks() {
  const slots = [], effects = []; let cursor = 0;
  const slot = create => { const i = cursor++; if (!(i in slots)) slots[i] = create(); return i; };
  const effect = (callback, dependencies) => {
    const i = cursor++, previous = slots[i];
    if (!previous || dependencies.some((value, k) => !Object.is(value, previous.dependencies[k]))) {
      const next = { dependencies, cleanup: previous?.cleanup }; slots[i] = next;
      effects.push(() => { next.cleanup?.(); next.cleanup = callback(); });
    }
  };
  return { react: {
    useState(value) { const i = slot(() => typeof value === 'function' ? value() : value); return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useRef: value => slots[slot(() => ({ current: value }))], useMemo: callback => slots[slot(callback)],
    useEffect: effect, useLayoutEffect: effect, useId: () => slots[slot(() => 'synthetic-form')],
  }, render(callback) { cursor = 0; const value = callback(); while (effects.length) effects.shift()(); return value; } };
}
function owner(items = [item(a), item(b)]) {
  const h = hooks(), calls = [], jobs = [];
  let page = { authorityVersion: 'auth:1', canManage: true, items: structuredClone(items), hasMore: false };
  let readStatus = 200, writeStatus = 200, readGate = null, writeGate = null, active = true;
  const env = { apiBaseUrl: '/api', userId: 'synthetic', childId: child, childName: 'Synthetic', role: 'owner', online: true,
    scopeKey: 'synthetic-scope', current: () => active, canStartWrite: () => true, invalidate() {} };
  const runtime = { lost: false, live: () => env.current() && !runtime.lost,
    accessError(error) { if (![401, 403, 404].includes(error.status)) return false; runtime.lost = true; return true; },
    read: (_key, action, signal) => action(signal),
    request(action) { const job = action(new AbortController().signal, () => runtime.live()); jobs.push(job); return job; } };
  const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
  const fetcher = async (url, options) => {
    if (options.method === 'GET') {
      if (readGate) await readGate.promise;
      if (readStatus !== 200) return response({ error: { code: 'synthetic_read_failure' } }, readStatus);
      const id = url.split('/').at(-1);
      return response(id === 'documents' ? { page: structuredClone(page) } : { item: page.items.find(value => value.id === id) });
    }
    const body = JSON.parse(options.body); calls.push({ url, body: structuredClone(body) });
    if (writeGate) await writeGate.promise;
    if (writeStatus === 0) throw new Error('Synthetic connection lost');
    if (writeStatus !== 200) return response({ error: { code: 'synthetic_write_failure' } }, writeStatus);
    if (url.endsWith('/pdf')) return new Response(new Blob(['synthetic-pdf']), { headers: { 'Content-Type': 'application/pdf' } });
    if (body.request) { const next = { ...item(created), kind: body.request.kind, purpose: body.request.purpose }; page.items.unshift(next); return response({ item: next }); }
    const id = url.split('/').at(-2), old = page.items.find(value => value.id === id), next = structuredClone(old);
    next.version++;
    if (body.change.action === 'archive') { next.status = 'archived'; next.archivedAt = '2026-10-07T00:00:00Z'; }
    if (body.change.action === 'restore') { next.status = 'active'; next.archivedAt = null; }
    if (body.change.action === 'check_item') next.current.sections[0].items[0].checked = body.change.checked;
    page.items = page.items.map(value => value.id === id ? next : value); return response({ item: next });
  };
  const api = apiModule.createFamilyDocumentsApi('/api', fetcher);
  const { useFamilyDocuments } = compile('frontend/src/production/useFamilyDocuments.ts', name => {
    if (name === 'react') return h.react;
    if (name.endsWith('/family-documents-api')) return { ...apiModule, createFamilyDocumentsApi: () => api };
    if (name.endsWith('/family-documents')) return schemas;
    if (name === './useDomainEnvironment') return { useDomainWriteGuard() {} };
    if (name === './task-knowledge-runtime') return { useTaskKnowledgeRuntime: () => runtime, useTaskKnowledgeRefresh() {} };
    throw new Error('Unmocked owner dependency: ' + name);
  });
  return { env, calls, render: () => h.render(() => useFamilyDocuments(env)),
    async load() { this.render().refresh(); await this.settle(); return this.render(); },
    async settle() { while (jobs.length) await jobs.shift(); },
    holdWrite() { return writeGate = deferred(); }, holdRead() { return readGate = deferred(); },
    failRead(status = 503) { readStatus = status; }, failWrite(status = 409) { writeStatus = status; },
    changePage(update) { page = update(structuredClone(page)); }, revoke() { active = false; },
  };
}
const jsx = (type, props, key) => ({ type, props, key });
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
const button = (tree, label) => nodes(tree).find(node => node.type === 'AppButton' && node.props.label === label);
function view(symbol, owner, props = {}) {
  const h = hooks();
  const value = compile('frontend/src/components/preparations/PreparationWorkspace.tsx', name => {
    if (name === 'react') return h.react;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === 'react-native') return { View: 'View', Pressable: 'Pressable', StyleSheet: { create: value => value }, Platform: { OS: 'web' } };
    if (name === 'react-native-paper') return { Text: 'Text' };
    if (name.endsWith('/preparation-view-model')) return preparationModel;
    if (name.endsWith('/workspaces/PreparationWorkspace')) return { usePreparationWorkspace: () => owner.render().preparation };
    if (name.endsWith('/useContainerWidth')) return { useContainerWidth: () => ({ width: 1024 }) };
    if (name.endsWith('/theme')) return { colors: {}, radius: {}, readingType: {}, spacing: {} };
    if (name.endsWith('/ui')) return { AppButton: 'AppButton', AppSelect: 'AppSelect' };
    const components = ['WriteRecoveryNotice', 'AppCheckbox', 'AppStatusBadge', 'SummaryDisclosure', 'DocumentCreateForm'];
    const component = components.find(value => name.endsWith('/' + value));
    if (component) return { [component]: component };
    throw new Error('Unmocked preparation dependency: ' + name);
  }, '\nexports.PreparationDocumentDetail = PreparationDocumentDetail; exports.PreparationReader = PreparationReader; exports.PreparationEmptyState = PreparationEmptyState;');
  return { render(extra = {}) {
    const workspace = owner.render().preparation;
    return h.render(() => value[symbol]({ workspace, documents: workspace.model.documents, document: workspace.model.selected,
      onClose: workspace.actions.closeDocument, searchText: '', dateRange: { from: null, to: null }, ...props, ...extra }));
  } };
}
function form(owner) {
  const h = hooks(); let fields = {}, resets = 0;
  const reset = value => { fields = { ...value }; resets++; };
  const rhf = { Controller: 'Controller', useForm() { return { control: {}, handleSubmit: callback => () => callback(fields), reset,
    setError() {}, setFocus() {}, formState: { errors: {} } }; } };
  const { DocumentCreateForm } = compile('frontend/src/components/preparations/DocumentCreateForm.tsx', name => {
    if (name === 'react') return h.react;
    if (name === 'react-hook-form') return rhf;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === 'react-native') return { View: 'View', StyleSheet: { create: value => value } };
    if (name === 'react-native-paper') return { Text: 'Text' };
    if (name.endsWith('/family-documents')) return schemas;
    if (name.endsWith('/preparation-view-model')) return preparationModel;
    if (name.endsWith('/theme')) return { colors: {}, readingType: {}, spacing: {} };
    if (name.endsWith('/ui')) return { AppButton: 'AppButton', AppSelect: 'AppSelect', AppTextField: 'AppTextField' };
    if (name.endsWith('/FormErrorSummary')) return { FormErrorSummary: 'FormErrorSummary', FormFieldMessage: 'FormFieldMessage' };
    if (name.endsWith('/DateTimeFields')) return { AppDateField: 'AppDateField' };
    if (name.endsWith('/AppCheckbox')) return { AppCheckbox: 'AppCheckbox' };
    throw new Error('Unmocked form dependency: ' + name);
  });
  return { render() { return h.render(() => DocumentCreateForm({ owner: owner.render(), kind: 'preparation' })); },
    editTitle(value) {
      const title = nodes(this.render()).find(node => node.type === 'Controller' && node.props.name === 'title');
      const control = title.props.render({ field: { value: fields.title, onChange: value => { fields.title = value; } } });
      nodes(control).find(node => node.type === 'AppTextField').props.onChangeText(value);
    }, get fields() { return fields; }, get resets() { return resets; } };
}
const check = h => h.render().preparation.actions.checkItem(a, 1, 'checklist', 'one', true);

for (const action of ['check', 'refresh', 'archive']) for (const navigation of ['close', 'select-b']) {
  test(`${action} completion preserves newer ${navigation} and updates only the target document`, async () => {
    const h = owner(); await h.load(); h.render().preparation.actions.selectDocument(a);
    const gate = h.holdWrite();
    if (action === 'check') check(h);
    else h.render().preparation.actions[action === 'refresh' ? 'refreshDocument' : 'archiveDocument'](a, 1);
    const detail = view('PreparationDocumentDetail', h);
    assert.equal(button(detail.render(), '返回準備單清單').props.disabled, undefined);
    if (navigation === 'close') button(detail.render(), '返回準備單清單').props.onPress();
    else {
      const reader = view('PreparationReader', h), tree = reader.render();
      const row = nodes(tree).find(node => typeof node.type === 'function' && node.type.name === 'PreparationRow' && node.props.document.id === b);
      const pressable = row.type(row.props); assert.equal(pressable.props.disabled, undefined); pressable.props.onPress();
    }
    gate.resolve(); await h.settle(); const state = h.render();
    assert.equal(state.preparation.model.selected?.id ?? null, navigation === 'close' ? null : b);
    assert.equal(state.preparation.model.justArchivedId, null);
    assert.equal(state.preparation.model.documents.find(value => value.id === a).version, 2);
    assert.equal(state.preparation.model.documents.find(value => value.id === b).version, 1);
    assert.equal(h.calls.length, 1);
  });
}

test('successful create still opens its document unless a newer selection intent supersedes it', async () => {
  for (const dismissed of [false, true]) {
    const h = owner(); await h.load(); const gate = h.holdWrite(); h.render().createDocument(request);
    if (dismissed) h.render().preparation.actions.closeDocument();
    gate.resolve(); await h.settle(); assert.equal(h.render().preparation.model.selected?.id ?? null, dismissed ? null : created);
  }
});

test('archive keeps its normal success notice when no newer navigation supersedes it', async () => {
  const h = owner(); await h.load(); h.render().preparation.actions.selectDocument(a);
  h.render().preparation.actions.archiveDocument(a, 1); await h.settle();
  assert.equal(h.render().preparation.model.selected, null); assert.equal(h.render().preparation.model.justArchivedId, a);
});

test('existing-document writes preserve mounted manual draft values and dirty state; its create and cancel reset it', async () => {
  for (const action of ['check', 'refresh', 'archive']) {
    const h = owner(); await h.load(); const f = form(h); f.render(); f.editTitle('Keep this unsent title'); f.render();
    const before = { epoch: h.render().epoch, resets: f.resets };
    if (action === 'check') check(h); else h.render().preparation.actions[action === 'refresh' ? 'refreshDocument' : 'archiveDocument'](a, 1);
    await h.settle(); f.render();
    assert.equal(h.render().dirty, true); assert.equal(h.render().epoch, before.epoch);
    assert.equal(f.fields.title, 'Keep this unsent title'); assert.equal(f.resets, before.resets);
    h.render().discardDraft(); f.render(); assert.equal(f.fields.title, ''); assert.equal(h.render().dirty, false);
    f.editTitle('My submitted title'); h.render().createDocument(request); await h.settle(); f.render();
    assert.equal(f.fields.title, ''); assert.equal(h.render().dirty, false);
  }
});

test('quiet cached refresh keeps selection/data and exposes a compact failure in preparations and history until success', async () => {
  const h = owner(); await h.load(); h.render().preparation.actions.selectDocument(a);
  const before = h.render().preparation.model.documents, gate = h.holdRead(); h.render().refresh();
  assert.deepEqual(h.render().preparation.model.documents, before); assert.equal(h.render().preparation.model.condition, 'ready');
  assert.equal(h.render().preparation.model.selected.id, a);
  h.failRead(); gate.resolve(); await h.settle();
  assert.equal(h.render().preparation.model.condition, 'refresh_failed'); assert.equal(h.render().locked, true);
  for (const symbol of ['PreparationWorkspace', 'PreparationHistoryView']) {
    const tree = view(symbol, h).render(), notice = nodes(tree).find(node => node.props?.testID === 'preparation-refresh-error');
    assert.ok(notice); assert.equal(notice.props.accessibilityRole, 'alert');
    assert.deepEqual(h.render().preparation.model.documents, before);
  }
  h.failRead(200); await h.load();
  assert.equal(h.render().preparation.model.condition, 'ready'); assert.equal(h.render().locked, false);
  assert.equal(nodes(view('PreparationWorkspace', h).render()).some(node => node.props?.testID === 'preparation-refresh-error'), false);
});

test('first read failure and access loss never claim an empty or cached-ready page', async () => {
  const cold = owner(); cold.failRead(); await cold.load(); assert.equal(cold.render().preparation.model.condition, 'unavailable');
  assert.deepEqual(cold.render().preparation.model.documents, []);
  const h = owner(); await h.load(); h.render().markDraft(); h.render().preparation.actions.selectDocument(a);
  h.failRead(403); await h.load(); const state = h.render();
  assert.equal(state.preparation.model.condition, 'lost'); assert.deepEqual(state.preparation.model.documents, []);
  assert.equal(state.dirty, false); assert.equal(state.preparation.model.selected, null); assert.equal(state.locked, true);
});

test('failed refresh has one concise warning across empty, filtered, selected and nonempty list/history views', async () => {
  const archived = { ...item(a), status: 'archived', archivedAt: '2026-10-07T00:00:00Z' };
  for (const scenario of [
    { symbol: 'PreparationWorkspace', items: [] },
    { symbol: 'PreparationWorkspace', items: [item(a)], shown: true },
    { symbol: 'PreparationWorkspace', items: [item(a)], selected: true, shown: true },
    { symbol: 'PreparationWorkspace', items: [archived] },
    { symbol: 'PreparationHistoryView', items: [] },
    { symbol: 'PreparationHistoryView', items: [archived], shown: true },
    { symbol: 'PreparationHistoryView', items: [archived], selected: true, shown: true },
    { symbol: 'PreparationHistoryView', items: [item(a)] },
    { symbol: 'PreparationHistoryView', items: [archived], searchText: 'no matching title' },
  ]) {
    const h = owner(scenario.items); await h.load();
    if (scenario.selected) h.render().preparation.actions.selectDocument(a);
    const v = view(scenario.symbol, h, { searchText: scenario.searchText ?? '' });
    assert.equal(nodes(v.render()).filter(node => node.props?.testID === 'preparation-refresh-error').length, 0);
    h.failRead(); await h.load();
    const warnings = nodes(v.render()).filter(node => node.props?.testID === 'preparation-refresh-error');
    assert.equal(warnings.length, 1); assert.equal(warnings[0].props.accessibilityRole, 'alert');
    assert.equal(warnings[0].props.children, scenario.shown ? '更新失敗，顯示上次內容' : '準備單更新失敗');
    assert.equal(view('PreparationEmptyState', h).render(), null, 'Cached empty/filtered results must not add a duplicate warning or a fresh-empty claim');
    if (scenario.selected) {
      const texts = nodes(view('PreparationDocumentDetail', h).render()).filter(node => node.type === 'Text');
      assert.equal(texts.some(node => node.props.children === h.render().notice), false, 'Selected detail must not repeat the global failure notice');
    }
    h.failRead(200); await h.load();
    assert.equal(nodes(v.render()).filter(node => node.props?.testID === 'preparation-refresh-error').length, 0);
  }
});

test('409 recheck preserves the rejection, reloads authoritative version, and restores usable checklist/archive actions without replay', async () => {
  const h = owner(); await h.load(); h.render().preparation.actions.selectDocument(a); h.failWrite(409); check(h); await h.settle();
  assert.equal(h.render().operation.recovery, 'check'); assert.equal(h.render().locked, true);
  h.changePage(page => ({ ...page, items: page.items.map(value => value.id === a ? { ...value, version: 3 } : value) }));
  h.failWrite(200); await h.load();
  const state = h.render(), tree = view('PreparationDocumentDetail', h).render();
  assert.equal(state.operation.state, 'conflict'); assert.equal(state.operation.recovery, undefined); assert.equal(state.locked, false);
  assert.equal(button(tree, '使用完畢，歸檔').props.disabled, false);
  const checkbox = nodes(tree).find(node => node.type === 'AppCheckbox'); assert.ok(checkbox);
  assert.equal(h.calls.length, 1, 'Fresh read does not silently retry the rejected change');
  checkbox.props.onChange(true); await h.settle();
  assert.equal(h.calls.length, 2); assert.equal(h.calls[1].body.change.expectedVersion, 3);
  assert.notEqual(h.calls[0].body.opId, h.calls[1].body.opId);
});

test('unknown original stays locked after read or later 409 and explicit retry preserves its exact opId and input', async () => {
  const h = owner(); await h.load(); h.render().preparation.actions.selectDocument(a); h.failWrite(0); check(h); await h.settle();
  const original = h.calls[0].body; assert.equal(h.render().operation.state, 'unknown');
  await h.load(); assert.equal(h.render().locked, true); assert.equal(h.render().operation.recovery, 'retry');
  assert.equal(nodes(view('PreparationDocumentDetail', h).render()).filter(node => node.type === 'AppCheckbox').length, 0);
  h.render().createDocument(request); assert.equal(h.calls.length, 1);
  h.failWrite(409); h.render().recovery.retryOriginalOperation(); await h.settle();
  assert.equal(h.render().operation.state, 'unknown'); await h.load(); assert.equal(h.render().locked, true);
  h.failWrite(200); h.render().recovery.retryOriginalOperation(); await h.settle();
  assert.equal(h.render().locked, false); assert.deepEqual(h.calls.map(value => value.body), [original, original, original]);
});

test('recovered create cannot reopen the reader after the user has closed it', async () => {
  const h = owner(); await h.load(); h.failWrite(0); h.render().createDocument(request); await h.settle();
  h.render().preparation.actions.closeDocument(); await h.load(); h.failWrite(200);
  h.render().recovery.retryOriginalOperation(); await h.settle();
  assert.equal(h.render().preparation.model.selected, null); assert.equal(h.calls.length, 2);
  assert.deepEqual(h.calls[0].body, h.calls[1].body);
});

test('scope/child replacement ignores delayed mutation success and does not clear the original draft', async () => {
  const h = owner(); await h.load(); h.render().markDraft(); const gate = h.holdWrite(); check(h); h.revoke();
  gate.resolve(); await h.settle();
  assert.equal(h.render().preparation.model.documents[0].version, 1); assert.equal(h.render().dirty, true);
});

test('one invalid current report cannot hide other authorized reports or resurrect invalid versions', async () => {
  const invalid = { ...item(a), kind: 'growth_report', purpose: 'family', readState: 'invalidated', current: null, history: [snapshot(a)] };
  const valid = { ...item(b), kind: 'growth_report', purpose: 'handoff' };
  const h = owner([invalid, valid]); await h.load();
  const model = { scopeKey: h.env.scopeKey, childId: child, access: 'editable', load: 'ready', page: { authorityVersion: 'auth:1', archive: h.render().archive, items: [] } };
  const reading = archiveReadingView(model); assert.equal(reading.items.length, 1); assert.equal(reading.items[0].snapshot.id, valid.current.id);
  assert.equal(growthReportExportRequest(model, reading.items[0], 'family', true, false).snapshotId, valid.current.id);
  for (const changed of [{ ...model, scopeKey: 'other' }, { ...model, childId: 'other' }, { ...model, access: 'lost' },
    { ...model, page: { ...model.page, authorityVersion: 'changed' } }]) assert.deepEqual(archiveReadingView(changed).items, []);
  const allInvalid = owner([invalid]); await allInvalid.load();
  assert.equal(allInvalid.render().archive.state, 'invalidated'); assert.deepEqual(allInvalid.render().archive.history, []);
});

test('report export keeps exact document, scope, authority and version guards plus single-flight and late-scope protection', async () => {
  const invalid = { ...item(a), kind: 'growth_report', purpose: 'family', readState: 'invalidated', current: null, history: [snapshot(a)] };
  const valid = { ...item(b), kind: 'growth_report', purpose: 'handoff' }, h = owner([invalid, valid]); await h.load();
  let downloads = 0; const previousDocument = globalThis.document;
  globalThis.document = { createElement: () => ({ click() { downloads++; }, remove() {} }), body: { appendChild() {} } };
  try {
    const input = { scopeKey: h.env.scopeKey, childId: child, authorityVersion: 'auth:1', snapshotId: valid.current.id,
      snapshotVersion: 1, periodId: valid.current.id + ':1', purpose: 'family', includeSources: true, includeRevision: false };
    for (const changed of [{ ...input, scopeKey: 'other' }, { ...input, childId: 'other' }, { ...input, authorityVersion: 'other' },
      { ...input, snapshotVersion: 2 }, { ...input, periodId: 'other' }, { ...input, snapshotId: invalid.history[0].id, periodId: invalid.history[0].id + ':1' }])
      await h.render().exportReport(changed);
    assert.equal(h.calls.length, 0);
    await h.render().exportReport(input); await h.settle(); assert.equal(downloads, 1); assert.ok(h.calls[0].url.includes('/' + b + '/pdf'));
    const gate = h.holdWrite(), first = h.render().exportReport(input), repeated = h.render().exportReport(input);
    assert.equal(h.calls.length, 2); h.revoke(); gate.resolve(); await Promise.all([first, repeated]); await h.settle();
    assert.equal(downloads, 1, 'The delayed blob cannot download into another scope');
  } finally { if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument; }
});
