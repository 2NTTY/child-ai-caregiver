import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import { archiveReadingView } from '../src/components/growth/growth-archive-view.ts';
const require = createRequire(import.meta.url), root = new URL('../../', import.meta.url);
const compile = (file, resolve = require, suffix = '', globals = {}) => {
  const module = { exports: {} }, output = ts.transpileModule(readFileSync(new URL(file, root), 'utf8'), {
    fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'module', 'exports', ...Object.keys(globals), output + suffix)(resolve, module, module.exports, ...Object.values(globals)); return module.exports;
};
const schemas = compile('src/shared/family-documents.ts');
const apiModule = compile('src/client/family-documents-api.ts', name => name.includes('/family-documents') ? schemas
  : name.includes('/api-base-url') ? { resolveApiBaseUrl: value => value } : require(name));
const preparationModel = compile('frontend/src/preparation-view-model.ts');
const uuid = number => '00000000-0000-4000-8000-' + String(number).padStart(12, '0');
const child = uuid(1), a = uuid(2), b = uuid(3), archived = uuid(4), later = uuid(5), created = uuid(6);
const snapshot = (id, version = 1, text = 'Synthetic checklist') => ({ id: uuid(100 + Number(id.slice(-3))), version,
  generatedAt: '2026-10-08T00:00:00Z', sourceBasis: 'basis', title: 'Synthetic ' + id.slice(-2), summary: 'Synthetic',
  ageLabel: 'unknown', period: { from: '2026-10-01', to: '2026-10-08' }, eventDate: null, coverageNote: 'Synthetic partial coverage',
  sections: [{ id: 'checklist', title: 'Checklist', kind: 'checklist', domain: null,
    items: [{ id: 'one', text, sourceIds: [], checked: false }] }], sources: [], changes: [] });
const item = id => ({ id, childId: child, kind: 'preparation', purpose: 'appointment', version: 1, status: 'active',
  archivedAt: null, current: snapshot(id), history: [], readState: 'ready', autoRefresh: false });
const request = { kind: 'preparation', title: 'Unsent title', purpose: 'appointment', eventDate: null, period: { from: '2026-10-01', to: '2026-10-08' } };
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
// Actual owner and adapter under deterministic hook slots and synthetic HTTP; no browser/layout claims.
function hooks() {
  const slots = [], effects = []; let cursor = 0;
  const slot = create => { const i = cursor++; if (!(i in slots)) slots[i] = create(); return i; };
  const effect = (callback, deps) => {
    const i = cursor++, old = slots[i];
    if (!old || deps.some((value, key) => !Object.is(value, old.deps[key]))) {
      const next = { deps, cleanup: old?.cleanup }; slots[i] = next; effects.push(() => { next.cleanup?.(); next.cleanup = callback(); });
    }
  };
  return { react: { useState(value) { const i = slot(() => typeof value === 'function' ? value() : value); return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useRef: value => slots[slot(() => ({ current: value }))], useMemo: callback => slots[slot(callback)], useEffect: effect, useLayoutEffect: effect },
    render(callback) { cursor = 0; const value = callback(); while (effects.length) effects.shift()(); return value; } };
}
function owner(items = [item(a), item(b)], more = false, refreshOptions = null) {
  const h = hooks(), calls = [], reads = [], jobs = [], extraItems = new Map(), versionPages = new Map(), contentSnapshots = new Map(), gates = new Map();
  let page = { authorityVersion: 'auth:1', canManage: true, items: structuredClone(items), hasMore: more, nextCursor: more ? 'active_cursor' : null };
  let readStatus = 200, writeStatus = 200, writeGate = null, active = true, invalidations = 0;
  const events = new EventTarget();
  const refreshHook = refreshOptions ? compile('frontend/src/production/task-knowledge-runtime.ts', name => name === 'react' ? h.react : require(name), '', { window: events }).useTaskKnowledgeRefresh : () => {};
  const env = { apiBaseUrl: '/api', userId: 'synthetic', childId: child, childName: 'Synthetic', role: 'owner', online: true,
    scopeKey: 'synthetic-scope', current: () => active, canStartWrite: () => true, invalidate() { if (refreshOptions) { invalidations++; if (refreshOptions.onInvalidate) page = refreshOptions.onInvalidate(page); events.dispatchEvent(new Event('yuban-online-refresh')); } } };
  const runtime = { lost: false, live: () => active && !runtime.lost,
    accessError(error) { if (![401, 403, 404].includes(error.status)) return false; runtime.lost = true; return true; },
    read: (_key, action, signal) => action(signal), request(action) { const job = action(new AbortController().signal, () => runtime.live()); jobs.push(job); return job; } };
  const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
  const fetcher = async (rawUrl, options) => {
    const url = new URL(rawUrl, 'https://synthetic.test'), parts = url.pathname.split('/'), id = parts.at(-2);
    if (options.method === 'GET') {
      reads.push({ pathname: url.pathname, query: Object.fromEntries(url.searchParams), user: options.headers['x-expected-user-id'] });
      let value;
      if (url.pathname.endsWith('/versions')) value = { page: structuredClone(versionPages.get(id + ':' + (url.searchParams.get('cursor') ?? ''))) };
      else if (url.pathname.endsWith('/content')) {
        const snapshotId = url.searchParams.get('snapshotId'), found = contentSnapshots.get(snapshotId);
        const text = JSON.stringify(found), offset = Number(url.searchParams.get('offset')), end = Math.min(offset + 4000, text.length);
        value = { page: { documentId: id, documentVersion: page.items.find(item => item.id === id).version, authorityVersion: page.authorityVersion,
          snapshotId, snapshotVersion: Number(url.searchParams.get('snapshotVersion')), offset, text: text.slice(offset, end), totalCharacters: text.length,
          nextOffset: end === text.length ? null : end, complete: end === text.length, invalidated: false, contentKind: 'snapshot_json' } };
      } else if (url.pathname.endsWith('/documents')) {
        const status = url.searchParams.get('status');
        if (status === 'archived') value = { page: { ...page, items: [extraItems.get(archived) ?? { ...item(archived), status: 'archived', archivedAt: '2026-10-08T00:00:00Z' }], hasMore: false, nextCursor: null } };
        else if (url.searchParams.has('cursor')) value = { page: { ...page, items: [extraItems.get(later) ?? item(later)], hasMore: false, nextCursor: null } };
        else value = { page: structuredClone(page) };
      } else value = { item: page.items.find(value => value.id === parts.at(-1)) ?? extraItems.get(parts.at(-1)) };
      const gate = gates.get(url.pathname); if (gate) { gates.delete(url.pathname); await gate.promise; }
      return readStatus === 200 ? response(value) : response({ error: { code: 'synthetic_read_failure' } }, readStatus);
    }
    const body = JSON.parse(options.body); calls.push({ body: structuredClone(body), rawUrl });
    if (writeGate) await writeGate.promise;
    if (writeStatus === 0) throw Error('Synthetic connection lost');
    if (writeStatus !== 200) return response({ error: { code: 'synthetic_write_failure' } }, writeStatus);
    if (body.request) { const value = item(created); page.items.unshift(value); return response({ item: value }); }
    const value = structuredClone(page.items.find(value => value.id === id)); value.version++;
    if (body.change.action === 'archive') { value.status = 'archived'; value.archivedAt = '2026-10-08T00:00:00Z'; }
    if (body.change.action === 'check_item') value.current.sections[0].items[0].checked = body.change.checked;
    page.items = page.items.map(old => old.id === id ? value : old); return response({ item: value });
  };
  const api = apiModule.createFamilyDocumentsApi('/api', fetcher);
  const { useFamilyDocuments } = compile('frontend/src/production/useFamilyDocuments.ts', name => {
    if (name === 'react') return h.react;
    if (name.endsWith('/family-documents-api')) return { ...apiModule, createFamilyDocumentsApi: () => api };
    if (name.endsWith('/family-documents')) return schemas;
    if (name === './useDomainEnvironment') return { useDomainWriteGuard() {} };
    if (name === './task-knowledge-runtime') return { useTaskKnowledgeRuntime: () => runtime, useTaskKnowledgeRefresh: refreshHook };
    throw Error('Unexpected dependency ' + name);
  });
  return { env, calls, reads, versionPages, contentSnapshots, extraItems, get invalidations() { return invalidations; }, changePage(update) { page = update(page); }, render: () => h.render(() => useFamilyDocuments(env)),
    async load() { this.render().refresh(); await this.settle(); return this.render(); },
    async settle() { while (jobs.length) { await jobs.shift(); if (refreshOptions) this.render(); } }, holdWrite() { return writeGate = deferred(); },
    holdRead(suffix) { const gate = deferred(); gates.set('/api/children/' + child + '/documents/' + suffix, gate); return gate; },
    failRead(status) { readStatus = status; }, failWrite(status) { writeStatus = status; }, revoke() { active = false; } };
}
const jsx = (type, props, key) => ({ type, props, key });
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
function preparationView(symbol, host, extra = {}) {
  const h = hooks(), component = compile('frontend/src/components/preparations/PreparationWorkspace.tsx', name => {
    if (name === 'react') return h.react;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === 'react-native') return { View: 'View', Pressable: 'Pressable', StyleSheet: { create: value => value }, Platform: { OS: 'web' } };
    if (name === 'react-native-paper') return { Text: 'Text' };
    if (name.endsWith('/preparation-view-model')) return preparationModel;
    if (name.endsWith('/workspaces/PreparationWorkspace')) return { usePreparationWorkspace: () => host.render().preparation };
    if (name.endsWith('/theme')) return { colors: {}, radius: {}, readingType: {}, spacing: {} };
    return new Proxy({}, { get: (_target, key) => String(key) });
  }, '\nexports.Detail = PreparationDocumentDetail; exports.Empty = PreparationEmptyState;');
  return () => h.render(() => component[symbol]({ workspace: host.render().preparation, document: host.render().preparation.model.selected, onClose() {}, ...extra }));
}
const versions = (id, values, cursor = null) => ({ documentId: id, authorityVersion: 'auth:1', items: values.map(value => ({ snapshotId: value.id, snapshotVersion: value.version, generatedAt: value.generatedAt, invalidated: false })), nextCursor: cursor });

test('bounded document/version reading preserves fixed snapshots, current content and late callback isolation', async () => {
  const h = owner(undefined, true); let value = await h.load();
  assert.deepEqual(h.reads[0].query, { status: 'active', limit: '20' }); assert.equal(value.preparation.model.documents.length, 2);
  assert.equal(h.reads.length, 1);
  value.preparation.model.reading.ensureArchived(); await h.settle(); value = h.render();
  assert.deepEqual(h.reads[1].query, { status: 'archived', limit: '20' }); assert.equal(value.preparation.model.documents.find(item => item.id === archived).status, 'archived');
  value.preparation.model.reading.loadMoreDocuments('active'); await h.settle(); value = h.render();
  assert.deepEqual(h.reads[2].query, { status: 'active', limit: '20', cursor: 'active_cursor' }); assert.equal(value.preparation.model.reading.activeHasMore, false);
  const long = { ...snapshot(a, 2, 'Synthetic long text '.repeat(280)), id: uuid(900) };
  const laterLong = { ...long, id: uuid(901), version: 3 };
  h.versionPages.set(a + ':', versions(a, [long], 'version_cursor')); h.versionPages.set(a + ':version_cursor', versions(a, [laterLong]));
  h.contentSnapshots.set(long.id, long); h.contentSnapshots.set(laterLong.id, laterLong);
  value.preparation.model.reading.loadVersions(a); await h.settle(); value = h.render();
  assert.equal(value.preparation.model.reading.indexes.find(item => item.documentId === a).hasMore, true);
  value.preparation.model.reading.loadVersions(a); await h.settle(); value = h.render();
  assert.equal(h.reads.at(-1).query.cursor, 'version_cursor'); assert.equal(value.preparation.model.reading.indexes.find(item => item.documentId === a).versions.length, 2);
  value.preparation.actions.selectDocument(a); value = h.render(); const readCount = h.reads.length;
  value.preparation.model.reading.readVersion(a, snapshot(a).id, 1); await h.settle(); value = h.render();
  assert.equal(h.reads.length, readCount); assert.equal(value.preparation.model.selected.revision.number, 1);
  value.preparation.model.reading.readVersion(a, long.id, 2); await h.settle(); value = h.render();
  assert.equal(value.preparation.model.reading.content.loadedCharacters, 4000); assert.equal(value.preparation.model.reading.content.complete, false);
  assert.equal(value.preparation.model.selected.revision, null); assert.equal(value.preparation.model.documents.find(item => item.id === a).revision.number, 1);
  value.preparation.model.reading.continueVersion(); await h.settle(); value = h.render();
  assert.equal(value.preparation.model.reading.content.complete, true); assert.equal(value.preparation.model.selected.revision.number, 2);
  assert.equal(value.preparation.model.selected.historical, true); assert.equal(preparationModel.canArchivePreparation(value.preparation.model.selected, value.preparation.model.scope), false);
  const contentReads = h.reads.filter(value => value.pathname.endsWith('/content'));
  assert.deepEqual(contentReads.map(value => value.query.offset), ['0', '4000']); assert.ok(contentReads.every(value => value.query.snapshotId === long.id && value.query.snapshotVersion === '2'));
  const gate = h.holdRead(a + '/content'); value.preparation.model.reading.readVersion(a, laterLong.id, 3); value = h.render();
  value.preparation.actions.selectDocument(b); value = h.render(); value.preparation.model.reading.readVersion(b, snapshot(b).id, 1); h.render(); gate.resolve(); await h.settle(); value = h.render();
  assert.equal(value.preparation.model.reading.content.documentId, b); assert.equal(value.preparation.model.selected.id, b);
  const scopeGate = h.holdRead(a + '/content'); value.preparation.model.reading.readVersion(a, laterLong.id, 3); h.render(); h.revoke(); scopeGate.resolve(); await h.settle();
  assert.equal(h.render().preparation.model.reading.content.complete, false);
  const denied = owner(); await denied.load(); denied.failRead(403); denied.render().preparation.model.reading.loadVersions(a); await denied.settle();
  assert.equal(denied.render().preparation.model.condition, 'lost'); assert.equal(denied.render().preparation.model.reading.indexes.length, 0);
});

test('adapted lifecycle preserves selection/create draft and original unknown receipt while reports remain isolated', async () => {
  const h = owner(); let value = await h.load(); value.preparation.actions.selectDocument(a); h.render().markDraft(); value = h.render(); const epoch = value.epoch;
  const gate = h.holdWrite(); value.preparation.actions.checkItem(a, 1, 'checklist', 'one', true); value = h.render(); value.preparation.actions.closeDocument(); value = h.render(); value.preparation.actions.selectDocument(b); h.render();
  gate.resolve(); await h.settle(); value = h.render(); assert.equal(value.preparation.model.selected.id, b); assert.equal(value.dirty, true); assert.equal(value.epoch, epoch);
  value.preparation.actions.closeDocument(); h.render(); h.failRead(503); h.render().refresh(); await h.settle(); value = h.render();
  assert.equal(value.preparation.model.condition, 'refresh_failed'); assert.equal(value.preparation.model.documents.length, 2);
  const tree = preparationView('PreparationWorkspace', h)(); assert.equal(nodes(tree).filter(value => value.props?.testID === 'preparation-refresh-error').length, 1);
  const unknown = owner(); await unknown.load(); unknown.failWrite(0); unknown.render().preparation.actions.checkItem(a, 1, 'checklist', 'one', true); await unknown.settle();
  assert.equal(unknown.render().operation.state, 'unknown'); unknown.render().recovery.checkOriginalOperation(); await unknown.settle(); unknown.render();
  unknown.failWrite(409); unknown.render().recovery.retryOriginalOperation(); await unknown.settle(); assert.equal(unknown.render().operation.state, 'unknown');
  unknown.render().recovery.checkOriginalOperation(); await unknown.settle(); value = unknown.render(); assert.equal(value.operation.recovery, 'retry'); assert.equal(value.locked, true);
  assert.deepEqual(unknown.calls[0].body, unknown.calls[1].body);
  const rejected = owner(); await rejected.load(); rejected.failWrite(409); rejected.render().preparation.actions.checkItem(a, 1, 'checklist', 'one', true); await rejected.settle();
  rejected.render().recovery.checkOriginalOperation(); await rejected.settle(); value = rejected.render(); assert.equal(value.operation.state, 'conflict'); assert.equal(value.operation.recovery, undefined); assert.equal(value.locked, false);
  value.preparation.actions.selectDocument(a); rejected.render(); const detail = preparationView('Detail', rejected)();
  assert.equal(nodes(detail).find(value => value.props?.label === '使用完畢，歸檔').props.disabled, false);
  const invalid = { ...item(a), kind: 'growth_report', purpose: 'family', readState: 'invalidated', current: null };
  const legal = { ...item(b), kind: 'growth_report', purpose: 'appointment' };
  legal.current.reportCoverage = { status: 'complete', mode: 'fixed', periodKind: 'annual', sourceRevision: 'source:1', completedAt: '2026-10-08T00:00:00Z', validUntil: null,
    scanned: 0, counts: { recordsInPeriod: 0, recordsUnknownTime: 0, tasksInPeriod: 0, observationsInPeriod: 0, confirmedFacts: 0, recordKinds: {} } };
  const reports = owner([invalid, legal]); value = await reports.load(); assert.equal(value.archive.state, 'ready'); assert.equal(value.archive.periods[0].kind, 'year'); assert.equal(value.archive.periods[0].coverage, 'complete');
  assert.equal(archiveReadingView({ scopeKey: value.archive.scopeKey, childId: child, access: 'editable', load: 'ready', page: { authorityVersion: 'auth:1', items: [], archive: value.archive } }).items.length, 1);
});

for (const destination of ['active', 'archived', 'later']) test(`late write preserves a newer ${destination} fixed-version selection after authoritative recheck`, async () => {
  const targetId = destination === 'active' ? b : destination === 'archived' ? archived : later;
  const old = { ...snapshot(targetId, 2, 'Selected synthetic older revision'), id: uuid(920) };
  const target = { ...item(targetId), history: [old], ...(destination === 'archived' ? { status: 'archived', archivedAt: '2026-10-08T00:00:00Z' } : {}) };
  const h = owner(destination === 'active' ? [item(a), target] : [item(a)], destination === 'later');
  h.extraItems.set(targetId, target); await h.load();
  if (destination !== 'active') { h.render().preparation.model.reading.loadMoreDocuments(destination === 'archived' ? 'archived' : 'active'); await h.settle(); }
  h.render().preparation.actions.selectDocument(a); const gate = h.holdWrite();
  h.render().preparation.actions.checkItem(a, 1, 'checklist', 'one', true); h.render().preparation.actions.selectDocument(targetId);
  h.render().preparation.model.reading.readVersion(targetId, old.id, old.version); h.render();
  gate.resolve(); await h.settle(); const state = h.render();
  assert.equal(state.preparation.model.selected?.id, targetId);
  assert.equal(state.preparation.model.selected?.revision?.id, old.id);
  assert.equal(state.preparation.model.selected?.historical, true);
  assert.equal(state.preparation.model.reading.content?.snapshotId, old.id);
  if (destination !== 'active') assert.ok(h.reads.some(read => read.pathname.endsWith('/' + targetId)), 'Selected out-of-page document must be authoritatively reread');
});

for (const change of ['authority', 'version', 'invalidated']) test(`late write does not retain fixed content after selected document ${change} changes`, async () => {
  const old = { ...snapshot(b, 2, 'Old synthetic content'), id: uuid(921) };
  const h = owner([item(a), { ...item(b), history: [old] }]); await h.load();
  const gate = h.holdWrite(); h.render().preparation.actions.checkItem(a, 1, 'checklist', 'one', true);
  h.render().preparation.actions.selectDocument(b); h.render().preparation.model.reading.readVersion(b, old.id, old.version); h.render();
  h.changePage(page => ({ ...page, ...(change === 'authority' ? { authorityVersion: 'auth:2' } : {}), items: page.items.map(value => value.id !== b ? value : change === 'version' ? { ...value, version: value.version + 1 } : change === 'invalidated' ? { ...value, current: null, history: [], readState: 'invalidated' } : value) }));
  gate.resolve(); await h.settle(); const state = h.render();
  assert.equal(state.preparation.model.reading.content, null);
  assert.notEqual(state.preparation.model.selected?.revision?.id, old.id);
  if (change === 'invalidated') assert.equal(state.preparation.model.selected.revision, null);
});


test('archive empty/count claims wait for a successful page and partial active emptiness stays bounded', async () => {
  const h = owner([]); await h.load(); const base = h.render();
  for (const reading of [
    { archiveStarted: false, pageBusy: false, pageError: false },
    { archiveStarted: true, pageBusy: true, pageError: false },
    { archiveStarted: true, pageBusy: false, pageError: true },
  ]) {
    const host = { render: () => ({ ...base, preparation: { ...base.preparation, model: { ...base.preparation.model,
      reading: { ...base.preparation.model.reading, ...reading, ensureArchived() {} } } } }) };
    assert.notEqual(preparationView('Empty', host, { history: true })()?.type, 'EmptyListCard');
    const history = preparationView('PreparationHistoryView', host, { searchText: '', dateRange: { from: null, to: null } })();
    assert.equal(nodes(history).some(node => Array.isArray(node.props?.children) && node.props.children.includes(' 份符合')), false);
  }
  const partial = { render: () => ({ ...base, preparation: { ...base.preparation, model: { ...base.preparation.model,
    reading: { ...base.preparation.model.reading, activeHasMore: true } } } }) };
  const card = preparationView('Empty', partial)();
  assert.equal(card.type, 'EmptyListCard'); assert.match(card.props.title, /已載入/); assert.match(card.props.detail, /更多/);
});


test('second navigation during selected item recheck retains intent and hides unverified content until explicit refresh', async () => {
  const old = { ...snapshot(later, 2, 'Selected C historical text'), id: uuid(922) };
  const h = owner([item(a)], true);
  h.extraItems.set(archived, { ...item(archived), status: 'archived', archivedAt: '2026-10-08T00:00:00Z' });
  h.extraItems.set(later, { ...item(later), history: [old] }); await h.load();
  h.render().preparation.model.reading.loadMoreDocuments('archived'); await h.settle();
  h.render().preparation.model.reading.loadMoreDocuments('active'); await h.settle();
  const writeGate = h.holdWrite(); h.render().preparation.actions.checkItem(a, 1, 'checklist', 'one', true);
  h.render().preparation.actions.selectDocument(archived); const itemGate = h.holdRead(archived);
  writeGate.resolve(); const settling = h.settle(); await new Promise(resolve => setTimeout(resolve, 0));
  h.render().preparation.actions.selectDocument(later); h.render().preparation.model.reading.readVersion(later, old.id, old.version); h.render();
  itemGate.resolve(); await settling;
  assert.equal(h.render().preparation.model.reading.content, null);
  assert.equal(h.render().preparation.model.condition, 'unavailable');
  assert.equal(h.render().operation.state, 'saved');
  await h.load();
  assert.equal(h.render().preparation.model.selected?.id, later, 'Explicit reread retains latest C intent rather than reopening B');
  assert.equal(h.calls.length, 1, 'Recovery does not repeat the confirmed write');
});


test('active-page success cannot certify an archived page whose first read failed', async () => {
  const h = owner([item(a)], true); await h.load(); h.failRead(503);
  h.render().preparation.model.reading.ensureArchived(); await h.settle();
  h.failRead(200); h.render().preparation.model.reading.loadMoreDocuments('active'); await h.settle();
  assert.equal(h.render().preparation.model.reading.pageError, false);
  assert.equal(h.render().preparation.model.reading.archiveReady, false);
  assert.notEqual(preparationView('Empty', h, { history: true })()?.type, 'EmptyListCard');
  h.render().preparation.model.reading.loadMoreDocuments('archived'); await h.settle();
  assert.equal(h.render().preparation.model.reading.archiveReady, true);
});


for (const destination of ['active', 'archived', 'later']) test(`real refresh hook preserves newer ${destination} fixed reader after queued save invalidation settles`, async () => {
  const targetId = destination === 'active' ? b : destination === 'archived' ? archived : later;
  const old = { ...snapshot(targetId, 2, 'Stable old reader after online refresh'), id: uuid(930) };
  const target = { ...item(targetId), history: [old], ...(destination === 'archived' ? { status: 'archived', archivedAt: '2026-10-08T00:00:00Z' } : {}) };
  const h = owner(destination === 'active' ? [item(a), target] : [item(a)], destination === 'later', {});
  h.extraItems.set(targetId, target); h.render(); await h.settle();
  if (destination !== 'active') { h.render().preparation.model.reading.loadMoreDocuments(destination === 'archived' ? 'archived' : 'active'); await h.settle(); }
  const gate = h.holdWrite(); h.render().preparation.actions.checkItem(a, 1, 'checklist', 'one', true);
  h.render().preparation.actions.selectDocument(targetId); h.render().preparation.model.reading.readVersion(targetId, old.id, old.version); h.render();
  const activeReads = () => h.reads.filter(read => read.pathname.endsWith('/documents') && read.query.status === 'active' && !read.query.cursor).length;
  const before = activeReads(); gate.resolve(); await h.settle(); const state = h.render();
  assert.equal(h.invalidations, 1); assert.equal(activeReads() - before, 2, 'Both immediate readback and queued real refresh hook must finish');
  assert.equal(state.preparation.model.selected?.id, targetId);
  assert.equal(state.preparation.model.selected?.revision?.id, old.id);
  assert.equal(state.preparation.model.selected?.historical, true);
  assert.equal(state.preparation.model.reading.content?.snapshotId, old.id);
  assert.equal(h.calls.length, 1, 'The stable reader does not require another mutation');
  h.render().refresh(); await h.settle();
  assert.equal(h.render().preparation.model.reading.content, null, 'Explicit manual refresh still resets the reader');
});

for (const change of ['authority', 'version', 'invalidated']) test(`queued automatic refresh still clears fixed content on ${change} change`, async () => {
  const old = { ...snapshot(b, 2, 'Old reader must not survive changed authority'), id: uuid(931) };
  const h = owner([item(a), { ...item(b), history: [old] }], false, { onInvalidate: page => ({ ...page,
    ...(change === 'authority' ? { authorityVersion: 'auth:2' } : {}), items: page.items.map(value => value.id !== b ? value
      : change === 'version' ? { ...value, version: value.version + 1 }
      : change === 'invalidated' ? { ...value, current: null, history: [], readState: 'invalidated' } : value) }) });
  h.render(); await h.settle(); const gate = h.holdWrite();
  h.render().preparation.actions.checkItem(a, 1, 'checklist', 'one', true); h.render().preparation.actions.selectDocument(b);
  h.render().preparation.model.reading.readVersion(b, old.id, old.version); h.render();
  gate.resolve(); await h.settle(); const state = h.render();
  assert.equal(h.invalidations, 1); assert.equal(state.preparation.model.reading.content, null);
  assert.notEqual(state.preparation.model.selected?.revision?.id, old.id);
  if (change === 'invalidated') assert.equal(state.preparation.model.selected.revision, null);
  assert.equal(h.calls.length, 1);
});

for (const recovery of ['retry', 'revoked']) test(`real refresh hook cannot bypass the second-navigation explicit recheck boundary: ${recovery}`, async () => {
  const old = { ...snapshot(later, 2, 'Selected C historical text'), id: uuid(922) };
  const h = owner([item(a)], true, {});
  h.extraItems.set(archived, { ...item(archived), status: 'archived', archivedAt: '2026-10-08T00:00:00Z' });
  h.extraItems.set(later, { ...item(later), history: [old] }); await h.load();
  h.render().preparation.model.reading.loadMoreDocuments('archived'); await h.settle();
  h.render().preparation.model.reading.loadMoreDocuments('active'); await h.settle();
  const writeGate = h.holdWrite(); h.render().preparation.actions.checkItem(a, 1, 'checklist', 'one', true);
  h.render().preparation.actions.selectDocument(archived); const itemGate = h.holdRead(archived);
  writeGate.resolve(); const settling = h.settle(); await new Promise(resolve => setTimeout(resolve, 0));
  h.render().preparation.actions.selectDocument(later); h.render().preparation.model.reading.readVersion(later, old.id, old.version); h.render();
  itemGate.resolve(); await settling;
  assert.equal(h.render().preparation.model.reading.content, null);
  assert.equal(h.render().preparation.model.condition, 'unavailable');
  assert.equal(h.render().operation.state, 'saved');
  const savedOperation = h.render().operation; assert.match(savedOperation.message, /目前選取的文件仍待重新讀取/);
  h.failRead(503); await h.load();
  assert.deepEqual(h.render().operation, savedOperation, 'A failed explicit recheck must retain the saved receipt and pending-read status');
  assert.equal(h.render().preparation.model.condition, 'unavailable', 'Failed manual read does not release the explicit recheck boundary');
  h.failRead(recovery === 'revoked' ? 403 : 200); h.env.invalidate(); await h.settle();
  assert.equal(h.render().preparation.model.reading.content, null);
  if (recovery === 'revoked') { assert.equal(h.render().preparation.model.condition, 'lost'); assert.deepEqual(h.render().preparation.model.documents, []); return; }
  assert.equal(h.render().preparation.model.condition, 'unavailable', 'An automatic successful read still cannot reveal the suspended selection');
  await h.load();
  assert.equal(h.render().preparation.model.selected?.id, later, 'Explicit reread retains latest C intent rather than reopening B');
  assert.deepEqual(h.render().operation, { ...savedOperation, message: '先前文件的保存已確認。' }, 'Successful explicit recheck clears only its obsolete pending-read wording, retaining the saved receipt');
  assert.equal(h.calls.length, 1, 'Recovery does not repeat the confirmed write');
});
